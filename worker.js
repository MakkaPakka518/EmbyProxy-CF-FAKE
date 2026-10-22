// VERSION: 3.7.2
//  更新内容:保活优化——①自动保活并发(DO 长任务最多 3 个并行,ka_live 保持并行显示);②保活失败重试间隔可配置(ka_retry_hours,默认 4h);③保活结果通知模式开关(全部推送/仅失败推送);④播放热力图 play_hits 保留 30 天(随清理限频删除过期);⑤DO 完成后删除 job 存储释放空间
const CURRENT_VERSION = "3.7.2"; 

// ============ 起播优化/加载提速 常量 ============
const BANDWIDTH_CACHE_TTL = 120000;       // 带宽统计内存缓存:2 分钟
const bandwidthCache = new Map();
let routesSchemaReady = false;            // 路由表 schema 初始化仅首次
let lastLogsCleanAt = 0;                  // 访客日志清理限频

// ============ isolate 级内存缓存 / 一次性初始化(减少每个请求的 D1 读写) ============
const memoStore = new Map();
// fn 抛错时:若有旧值则沿用旧值(stale-on-error),否则继续抛出
async function memoStale(key, ttlMs, fn) {
  const now = Date.now();
  const hit = memoStore.get(key);
  if (hit && hit.exp > now) return hit.val;
  try {
    const val = await fn();
    memoStore.set(key, { val, exp: now + ttlMs });
    if (memoStore.size > 300) memoStore.delete(memoStore.keys().next().value);
    return val;
  } catch (e) {
    if (hit) { console.error('memoStale fallback:', key, e && e.message); return hit.val; }
    throw e;
  }
}
function memoDel(...keys) { for (const k of keys) memoStore.delete(k); }
function memoDelPrefix(prefix) { for (const k of Array.from(memoStore.keys())) { if (k.indexOf(prefix) === 0) memoStore.delete(k); } }
let appConfigReady = false;
async function ensureAppConfig(env) {
  if (appConfigReady || !env || !env.DB) return;
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS app_config (key TEXT PRIMARY KEY, value TEXT)').run();
  appConfigReady = true;
}
let visitorCityColReady = false;
let visitorGeoColsReady = false;
let kaColsReady = false;
let routesWatchLimitColReady = false;
// 原子节流:到期才抢占成功(单条 SQL,无读后写竞态)
async function claimThrottle(env, key, intervalMs) {
  await ensureAppConfig(env);
  const now = Date.now();
  const r = await env.DB.prepare("INSERT INTO app_config(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE CAST(app_config.value AS INTEGER) <= ?")
    .bind(key, String(now), now - intervalMs).run();
  return !!(r && r.meta && r.meta.changes > 0);
}
// ============ 保活队列锁 ============
// 队列(ka_queue)和历史(ka_history)都是整块 JSON 的"读-改-写"。手动点击、DO 收尾回调、定时检查会同时推进队列,
// 没有锁时可能同时领走同一个 waiting 项(同一节点被执行两次);取消/收尾也会互相覆盖。
// 用 D1 单条原子 SQL 实现带过期的互斥锁:value=过期时间戳,仅在已过期/不存在时才能抢到;持有者崩溃 10 秒后自动失效。
const KA_LOCK_KEY = 'ka_queue_lock';
const KA_LOCK_TTL_MS = 10000;
const KA_STALE_RUNNING_MS = 20 * 60 * 1000;   // 队列里 running 超过 20 分钟视为卡死(DO 单任务最长约 7 分钟)
async function kaLockAcquire(env) {
  try { await ensureAppConfig(env); } catch (e) { return null; }
  const deadline = Date.now() + 12000;
  for (;;) {
    const now = Date.now();
    const token = String(now + KA_LOCK_TTL_MS);
    try {
      const r = await env.DB.prepare("INSERT INTO app_config(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE CAST(app_config.value AS INTEGER) <= ?").bind(KA_LOCK_KEY, token, now).run();
      if (r && r.meta && r.meta.changes > 0) return token;
    } catch (e) { return null; }
    if (Date.now() > deadline) return null;   // 拿不到锁:退化为无锁执行(与旧行为一致),不让保活卡死
    await new Promise(res => setTimeout(res, 80 + Math.floor(Math.random() * 80)));
  }
}
async function kaLockRelease(env, token) {
  if (!token) return;
  try { await env.DB.prepare("UPDATE app_config SET value='0' WHERE key=? AND value=?").bind(KA_LOCK_KEY, token).run(); } catch (e) {}
}
async function withKaLock(env, fn) {
  const token = await kaLockAcquire(env);
  try { return await fn(); } finally { await kaLockRelease(env, token); }
}

const _te = new TextEncoder();
async function sha256Hex(str) {
  const d = await crypto.subtle.digest('SHA-256', _te.encode(String(str)));
  return Array.from(new Uint8Array(d)).map(b => b.toString(16).padStart(2, '0')).join('');
}
async function hmacHex(key, msg) {
  const k = await crypto.subtle.importKey('raw', _te.encode(String(key)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', k, _te.encode(String(msg)));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}
// 恒定时间字符串比较(避免按字符提前返回的时序差异)
function timingSafeEq(a, b) {
  a = String(a == null ? '' : a); b = String(b == null ? '' : b);
  let diff = a.length ^ b.length;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}
// Logo 值白名单:防止带引号/尖括号的值逃出 HTML 属性
function isSafeLogoValue(v) {
  const t = String(v || '');
  if (/^data:image\/(png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+\/=]+$/i.test(t)) return true;
  if (/^https?:\/\/[^\s"'<>`\\]+$/i.test(t)) { try { new URL(t); return true; } catch (e) {} }
  return false;
}
const AUTH_FAIL_MAX = 8;                 // 登录失败上限(每窗口每 IP)
const AUTH_FAIL_WINDOW = 10 * 60 * 1000; // 10 分钟窗口
async function authIsBlocked(env, ip) {
  if (!env.DB || !ip) return false;
  try {
    await ensureAppConfig(env);
    const win = Math.floor(Date.now() / AUTH_FAIL_WINDOW);
    const r = await env.DB.prepare('SELECT value FROM app_config WHERE key = ?').bind('authfail:' + win + ':' + ip).first();
    return !!(r && parseInt(r.value, 10) >= AUTH_FAIL_MAX);
  } catch (e) { return false; }
}
async function authRecordFail(env, ip) {
  if (!env.DB || !ip) return;
  try {
    await ensureAppConfig(env);
    const win = Math.floor(Date.now() / AUTH_FAIL_WINDOW);
    await env.DB.prepare("INSERT INTO app_config(key,value) VALUES(?,'1') ON CONFLICT(key) DO UPDATE SET value = CAST(value AS INTEGER) + 1").bind('authfail:' + win + ':' + ip).run();
    if (Math.random() < 0.02) await env.DB.prepare("DELETE FROM app_config WHERE key LIKE 'authfail:%' AND key NOT LIKE ?").bind('authfail:' + win + ':%').run();
  } catch (e) {}
}
function normalizeClientIp(ip) {
  const t = String(ip || '').trim();
  const m = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(t);
  return m ? m[1] : t;
}
function safeRedirectResponse(target) {
  try {
    const u = new URL(String(target || ''));
    if (u.protocol === 'http:' || u.protocol === 'https:') return Response.redirect(u.href, 302);
  } catch (e) {}
  return null;
}
async function isBareProxyEnabled(env) {
  try {
    if (!env.DB) return true;
    return await memoStale('bare_proxy', 30000, async () => {
      await ensureAppConfig(env);
      const r = await env.DB.prepare("SELECT value FROM app_config WHERE key = 'bare_proxy_enabled'").first();
      return !(r && r.value === '0');
    });
  } catch (e) { return true; }
}
const KA_MAX_CONCURRENT = 3;              // v3.6.70:自动保活最大并发数(DO 长任务并行执行;降级模式受墙钟限制仍逐个)

const GITHUB_RAW_URL = "https://raw.githubusercontent.com/MakkaPakka518/EmbyProxy-CF-FAKE/refs/heads/main/worker.js";
const CHANGELOG_URL = "https://raw.githubusercontent.com/MakkaPakka518/EmbyProxy-CF-FAKE/refs/heads/main/changelog.json";

// ==========================================
// 1. 网页界面
// ==========================================

const SVG_EYE = `<svg viewBox="0 0 24 24"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>`;
const SVG_COPY = `<svg viewBox="0 0 24 24"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>`;
const SVG_TG = `<svg viewBox="0 0 24 24" style="width:20px;height:20px;margin-right:8px;fill:#0088cc;"><path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.221l-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.446 1.394c-.14.18-.357.295-.6.295-.002 0-.003 0-.005 0l.213-3.054 5.56-5.022c.24-.213-.054-.334-.373-.121l-6.869 4.326-2.96-.924c-.64-.203-.658-.64.135-.954l11.566-4.458c.538-.196 1.006.128.832.94z"/></svg>`;

const EMBY_LOGO = 'https://raw.githubusercontent.com/MakkaPakka518/Icon/refs/heads/main/MAKKA_EMBY.JPG';  // 玛卡巴卡的头像(外链);加载失败时 topbar 有内置占位兜底,可在账户设置→更换头像

const I = {
  rocket:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 16.5c-1.5 1.3-2 5-2 5s3.7-.5 5-2c.7-.8.7-2 0-2.8-.8-.7-2.2-.7-3 .8z"/><path d="M12 15l-3-3c.5-4 4-7.5 8-8 2 .2 3.8 2 4 4-.5 4-4 7.5-8 8l-1-1z"/><path d="M9 12c-2 1-3.5 3-4 5"/><circle cx="15" cy="9" r="0.5"/></svg>',
  xmark:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  check:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4L19 7"/></svg>',
  warn:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3L2 20h20L12 3z"/><path d="M12 10v4M12 17.5h.01"/></svg>',
  film:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4"/></svg>',
  star:'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3l2.7 5.7 6.3.8-4.6 4.3 1.1 6.2-5.5-3-5.5 3 1.1-6.2L3 9.5l6.3-.8L12 3z"/></svg>',
  sparkles:'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3zM18 14l.8 2.2L21 17l-2.2.8L18 20l-.8-2.2L15 17l2.2-.8L18 14zM6 14l.6 1.7L8.5 16l-1.9.7L6 18.5l-.6-1.8L3.5 16l1.9-.3L6 14z"/></svg>',
  globe:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.5 2.5 15 0 18M12 3c-2.5 2.5-2.5 15 0 18"/></svg>',
  bolt:'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M13 2L4 14h6l-1 8 9-12h-6l1-8z"/></svg>',
  refresh:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12a8 8 0 1 1-2.34-5.66"/><path d="M20 3v5h-5"/></svg>',
  chart:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M5 20V10M12 20V4M19 20v-7"/></svg>',
  cloud:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 18a4 4 0 1 1 0-8 5 5 0 0 1 9.6 1.3A3.5 3.5 0 0 1 17 18H7z"/></svg>',
  trash:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>',
  search:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>',
  location:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/></svg>',
  trophy:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 21h8M12 17v4M7 4h10v6a5 5 0 0 1-10 0V4z"/><path d="M7 5H4v2a3 3 0 0 0 3 3M17 5h3v2a3 3 0 0 1-3 3"/></svg>',
  moon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>',
  sun:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4.5"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  pencil:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>',
  gear:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M4.2 4.2l2.8 2.8M17 17l2.8 2.8M1 12h4M19 12h4M4.2 19.8L7 17M17 7l2.8-2.8"/></svg>',
  lines:'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 6h18v2H3zM3 11h18v2H3zM3 16h18v2H3z"/></svg>',
  box:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8l-9-5-9 5v8l9 5 9-5V8z"/><path d="M3 8l9 5 9-5M12 13v8"/></svg>',
  download:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M7 10l5 5 5-5M4 21h16"/></svg>',
  antenna:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6.4 2a14 14 0 0 0 0 20M17.6 2a14 14 0 0 1 0 20M9.8 5.5a9 9 0 0 0 0 13M14.2 5.5a9 9 0 0 1 0 13"/><circle cx="12" cy="12" r="1.5"/></svg>',
  bulb:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6M10 22h4M8 14.5A6 6 0 0 1 12 5a6 6 0 0 1 4 9.5c-.8.8-1 1.6-1 2.5h-6c0-.9-.2-1.7-1-2.5z"/></svg>',
  tv:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="13" rx="2"/><path d="M8 21h8M12 18v3"/></svg>',
  flame:'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2s5 4 5 9a5 5 0 0 1-10 0c0-2 1-3.5 2-5-.5 1-1 2-1 3 0 2.5 3 3 3 6 1-2 0-4 0-4 2 1 3 3 3 4.5A6.5 6.5 0 0 1 12 22 6.5 6.5 0 0 1 5.5 15C5.5 9 12 2 12 2z"/></svg>',
  link:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.07 0l2.83-2.83a5 5 0 0 0-7.07-7.07L11 4.93"/><path d="M14 11a5 5 0 0 0-7.07 0l-2.83 2.83a5 5 0 0 0 7.07 7.07L13 19.07"/></svg>',
  crown:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7l4 4 5-6 5 6 4-4-2 12H5L3 7z"/><path d="M6 19h12"/></svg>',
  target:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/></svg>',
  arrowdown:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12l7 7 7-7"/></svg>',
  robot:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="8" width="14" height="11" rx="2"/><path d="M12 8V4M8 4h8"/><circle cx="9.5" cy="13" r="1" fill="currentColor"/><circle cx="14.5" cy="13" r="1" fill="currentColor"/><path d="M2 13v3M22 13v3"/></svg>',
  spy:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="11" r="7"/><circle cx="9" cy="10" r="1" fill="currentColor"/><circle cx="15" cy="10" r="1" fill="currentColor"/><path d="M9.5 14c1 .8 4 .8 5 0"/></svg>',
  flask:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3h6M10 3v5L4.5 18a2 2 0 0 0 1.8 3h11.4a2 2 0 0 0 1.8-3L14 8V3"/><path d="M7 15h10"/></svg>',
  broom:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M13 3l8 8M11 11l8-8M4 20l7-7 1 1-7 7-2-1z"/><path d="M6 8l4 4"/></svg>',
  checksquare:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="4"/><path d="M8 12.5l2.5 2.5L16 9"/></svg>',
  upload:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15V3M7 8l5-5 5 5M4 21h16"/></svg>',
  db:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/></svg>',
  dotblue:'<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="7" fill="#007aff"/></svg>',
  dotorange:'<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="7" fill="#ff9500"/></svg>',
  dotgreen:'<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="7" fill="#34c759"/></svg>',
  dotpurple:'<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="7" fill="#af52de"/></svg>',
  plus:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>'
};

const E2I = { '${I.rocket}':'rocket','${I.xmark}':'xmark','${I.check}':'check','${I.warn}':'warn','${I.film}':'film','${I.star}':'star','${I.sparkles}':'sparkles','${I.globe}':'globe','${I.bolt}':'bolt','${I.refresh}':'refresh','${I.chart}':'chart','${I.cloud}':'cloud','${I.trash}':'trash','${I.search}':'search','${I.location}':'location','${I.trophy}':'trophy','${I.moon}':'moon','${I.sun}':'sun','${I.dotblue}':'dotblue','${I.dotorange}':'dotorange','${I.dotgreen}':'dotgreen','${I.dotpurple}':'dotpurple','${I.robot}':'robot','${I.spy}':'spy','${I.flame}':'flame','${I.link}':'link','${I.tv}':'tv','${I.box}':'box','${I.download}':'download','${I.antenna}':'antenna','${I.bulb}':'bulb','${I.crown}':'crown','${I.target}':'target','${I.arrowdown}':'arrowdown','${I.pencil}':'pencil','${I.gear}':'gear','${I.lines}':'lines','${I.flask}':'flask','${I.broom}':'broom','${I.checksquare}':'checksquare','${I.upload}':'upload' };
function toSvg(s){
  if(!s) return s;
  return String(s).replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2B00}-\u{2BFF}]/gu, function(ch){
    if(ch==='\uFE0F') return '';
    var key = E2I[ch];
    return (key && I[key]) ? '<span class="ti">'+I[key]+'</span>' : '';
  });
}


const CSS_COMMON = `
    /* =====================================================
       NEBULA 星云 —— 深空科幻设计系统
       默认深色夜空（霓虹发光）/ 可选晨曦浅色
       变量名与主 JS 完全兼容（--bg/--card/--primary/--border/--text 等）
       ===================================================== */
    :root {
        --primary:#3d7bff;
        --primary-2:#00d4ff;
        --primary-hover:#2f6bff;
        --primary-soft:rgba(61,123,255,.14);
        --primary-grad:linear-gradient(135deg,#00d4ff 0%,#3d7bff 100%);
        --primary-grad-2:linear-gradient(135deg,#7c5cff 0%,#00d4ff 100%);
        --bg:#f6f7fd;
        --bg-soft:#eef1fb;
        --bg-2:#e9ecf8;
        --card:#ffffff;
        --card-glass:rgba(255,255,255,.7);
        --glass-border:rgba(255,255,255,.6);
        --text:#131627;
        --text-sec:#5d6480;
        --text-faint:#9aa1bd;
        --border:#e3e7f4;
        --border-strong:#cdd4ea;
        --success:#0fbf7f;
        --success-soft:rgba(15,191,127,.12);
        --warning:#f5a623;
        --warning-soft:rgba(245,166,35,.14);
        --danger:#ff4d6a;
        --danger-soft:rgba(255,77,106,.12);
        --info:#22b8ff;
        --violet:#8b5cf6;
        --radius:18px;
        --radius-card:18px;
        --radius-md:13px;
        --radius-sm:10px;
        --shadow-sm:0 1px 2px rgba(20,24,50,.05),0 2px 6px rgba(20,24,50,.06);
        --shadow:0 2px 6px rgba(20,24,50,.06),0 8px 22px rgba(20,24,50,.08);
        --shadow-lg:0 6px 16px rgba(20,24,50,.1),0 20px 46px rgba(20,24,50,.14);
        --blur:blur(22px) saturate(180%);
        --topbar-h:62px;
        --font-mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
        --ease:cubic-bezier(.22,.7,.28,1);
    }
    body.dark {
        --primary:#4da3ff;
        --primary-2:#00e5ff;
        --primary-hover:#3d97ff;
        --primary-soft:rgba(77,163,255,.16);
        --primary-grad:linear-gradient(135deg,#00e5ff 0%,#4da3ff 100%);
        --primary-grad-2:linear-gradient(135deg,#8b5cf6 0%,#00e5ff 100%);
        --bg:#060a13;
        --bg-soft:#0b1220;
        --bg-2:#0a0f1c;
        --card:#0d1526;
        --card-glass:rgba(10,16,30,.72);
        --glass-border:rgba(0,229,255,.14);
        --text:#e8eefc;
        --text-sec:#8a94b0;
        --text-faint:#566084;
        --border:#1b2740;
        --border-strong:#2a3a5c;
        --success:#22e39a;
        --success-soft:rgba(34,227,154,.14);
        --warning:#ffb84d;
        --warning-soft:rgba(255,184,77,.15);
        --danger:#ff5c7a;
        --danger-soft:rgba(255,92,122,.14);
        --info:#38bdf8;
        --violet:#a78bfa;
        --shadow-sm:0 1px 3px rgba(0,0,0,.4);
        --shadow:0 2px 8px rgba(0,0,0,.4),0 10px 26px rgba(0,0,0,.42);
        --shadow-lg:0 4px 14px rgba(0,0,0,.5),0 18px 44px rgba(0,0,0,.55),0 0 40px rgba(77,163,255,.05);
        --glow:0 0 0 1px rgba(0,229,255,.06), 0 0 24px rgba(0,229,255,.08);
    }

    /* ============ 基础 ============ */
    *{box-sizing:border-box;touch-action:manipulation;-webkit-tap-highlight-color:transparent}
    html{background:var(--bg)}
    html,body{margin:0;padding:0}
    html.dark{background:#060a13} /* 同步 body.dark --bg,防 iOS Safari 橡皮筋露白 */
    body{font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif;background:var(--bg);color:var(--text);min-height:100vh;-webkit-text-size-adjust:100%;transition:background-color .35s,color .35s;letter-spacing:.1px;overflow-x:hidden}
    /* 星云背景：星点 + 极光 */
    body::before{content:'';position:fixed;inset:0;z-index:-2;pointer-events:none;background:
        radial-gradient(2px 2px at 12% 22%, rgba(255,255,255,.5), transparent 40%),
        radial-gradient(1.5px 1.5px at 78% 12%, rgba(0,229,255,.6), transparent 40%),
        radial-gradient(2px 2px at 34% 78%, rgba(255,255,255,.4), transparent 40%),
        radial-gradient(1.5px 1.5px at 62% 58%, rgba(139,92,246,.6), transparent 40%),
        radial-gradient(2px 2px at 88% 82%, rgba(255,255,255,.35), transparent 40%),
        radial-gradient(1.5px 1.5px at 5% 62%, rgba(0,229,255,.45), transparent 40%),
        radial-gradient(1.5px 1.5px at 45% 8%, rgba(255,255,255,.4), transparent 40%),
        radial-gradient(1100px 480px at 12% -8%, rgba(61,123,255,.14), transparent 62%),
        radial-gradient(900px 460px at 108% 6%, rgba(0,213,255,.1), transparent 60%),
        radial-gradient(760px 480px at 50% 118%, rgba(139,92,246,.12), transparent 62%);
        background-repeat:no-repeat;
    }
    body.dark::before{background:
        radial-gradient(2px 2px at 12% 22%, rgba(255,255,255,.7), transparent 40%),
        radial-gradient(1.5px 1.5px at 78% 12%, rgba(0,229,255,.9), transparent 40%),
        radial-gradient(2px 2px at 34% 78%, rgba(255,255,255,.6), transparent 40%),
        radial-gradient(1.5px 1.5px at 62% 58%, rgba(139,92,246,.9), transparent 40%),
        radial-gradient(2px 2px at 88% 82%, rgba(255,255,255,.5), transparent 40%),
        radial-gradient(1.5px 1.5px at 5% 62%, rgba(0,229,255,.7), transparent 40%),
        radial-gradient(1.5px 1.5px at 45% 8%, rgba(255,255,255,.6), transparent 40%),
        radial-gradient(1100px 480px at 12% -8%, rgba(77,163,255,.16), transparent 62%),
        radial-gradient(900px 460px at 108% 6%, rgba(0,229,255,.1), transparent 60%),
        radial-gradient(760px 480px at 50% 118%, rgba(139,92,246,.14), transparent 62%);
        background-repeat:no-repeat;}
    /* 网格线层 */
    body::after{content:'';position:fixed;inset:0;z-index:-1;pointer-events:none;opacity:.5;
        background-image:
            linear-gradient(rgba(0,229,255,.025) 1px, transparent 1px),
            linear-gradient(90deg, rgba(0,229,255,.025) 1px, transparent 1px);
        background-size:44px 44px;
        mask-image:radial-gradient(ellipse 90% 60% at 50% 0%, #000 20%, transparent 75%);}
    body.dark::after{opacity:.8;background-image:
        linear-gradient(rgba(0,229,255,.045) 1px, transparent 1px),
        linear-gradient(90deg, rgba(0,229,255,.045) 1px, transparent 1px);
        background-size:44px 44px;
        mask-image:radial-gradient(ellipse 90% 60% at 50% 0%, #000 20%, transparent 75%);}
    ::selection{background:rgba(77,163,255,.3)}
    a{color:var(--primary);text-decoration:none}
    input,select,button,textarea{font-family:inherit;outline:none;font-size:14px}
    input::placeholder,textarea::placeholder{color:var(--text-faint)}
    input,select,textarea{transition:border-color .18s,box-shadow .18s,background .18s}
    input:focus,select:focus,textarea:focus{border-color:var(--primary)!important;box-shadow:0 0 0 3px var(--primary-soft), 0 0 16px rgba(0,229,255,.12)!important}
    .container{max-width:1200px;margin:0 auto;width:100%;min-height:100vh;display:flex;flex-direction:column;padding:calc(var(--topbar-h) + 30px) 24px 100px}

    /* ============ 分区标题（HUD 标签） ============ */
    .section-head{display:flex;align-items:center;gap:10px;margin:36px 2px 16px;font-size:11.5px;font-weight:800;letter-spacing:2px;text-transform:uppercase;color:var(--text-sec)}
    .section-head:first-child{margin-top:6px}
    .section-head::before{content:'';width:8px;height:8px;background:var(--primary-grad);transform:rotate(45deg);box-shadow:0 0 10px var(--primary);flex-shrink:0}
    .section-head::after{content:'';flex:1;height:1px;background:linear-gradient(90deg,var(--border),transparent)}

    /* ============ 卡片（深空舱板） ============ */
    .card{background:var(--card);padding:24px;border-radius:var(--radius);box-shadow:var(--shadow);margin-bottom:20px;border:1px solid var(--border);transition:box-shadow .25s,border-color .25s,transform .25s;position:relative}
    .card:hover{box-shadow:var(--shadow-lg);border-color:var(--border-strong)}
    body.dark .card{background:linear-gradient(160deg, rgba(13,21,38,.9), rgba(10,16,30,.95));border-color:rgba(0,229,255,.08)}
    body.dark .card:hover{border-color:rgba(0,229,255,.25);box-shadow:var(--shadow-lg), var(--glow)}
    .card h2,.card h3{display:flex;align-items:center;gap:9px;margin:0}
    .card h2{font-size:16px;font-weight:700;letter-spacing:.1px}
    .card h2 svg,.card h3 svg{color:var(--primary)}
    .card h3{font-size:14.5px;font-weight:700;color:var(--text)}
    .card-header{display:flex;align-items:center;flex-wrap:wrap;gap:10px}
    .card-tools{display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin-left:auto}
    .card-sub{font-size:12.5px;color:var(--text-sec);font-weight:500}

    /* Hero 大标题卡（星云主视觉） */
    .hero-card{display:flex;align-items:center;gap:18px;flex-wrap:wrap;padding:30px 30px;background:var(--card);overflow:hidden}
    body.dark .hero-card{background:
        radial-gradient(520px 240px at 88% -30%, rgba(139,92,246,.22), transparent 65%),
        radial-gradient(480px 260px at 12% 130%, rgba(0,229,255,.16), transparent 60%),
        linear-gradient(160deg, rgba(13,21,38,.92), rgba(8,13,24,.96))}
    .hero-card::after{content:'';position:absolute;right:-90px;top:-90px;width:260px;height:260px;border-radius:50%;border:1px solid rgba(0,229,255,.14);box-shadow:0 0 60px rgba(0,229,255,.1), inset 0 0 40px rgba(139,92,246,.08);pointer-events:none;animation:heroPulse 5s ease-in-out infinite}
    .hero-card::before{content:'';position:absolute;left:-70px;bottom:-70px;width:180px;height:180px;border-radius:50%;border:1px dashed rgba(0,229,255,.1);pointer-events:none}
    @keyframes heroPulse{0%,100%{opacity:.8}50%{opacity:.35}}
    .hero-card h1{font-size:24px;font-weight:800;margin:0;display:flex;align-items:center;gap:12px;letter-spacing:-.3px;position:relative}
    body.dark .hero-card h1{background:linear-gradient(120deg,#7ec9ff 0%,#00e5ff 45%,#a78bfa 100%);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;filter:drop-shadow(0 0 18px rgba(0,229,255,.25))}
    .hero-card h1 svg{width:26px;height:26px}
    body.dark .hero-card h1 svg{color:var(--primary-2)}
    .hero-card .hero-sub{font-size:13px;color:var(--text-sec);margin-top:5px;font-weight:500}
    .hero-chip{display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:800;letter-spacing:1.5px;color:var(--primary);background:var(--primary-soft);border:1px solid rgba(61,123,255,.3);padding:4px 11px;border-radius:999px;vertical-align:middle;text-transform:uppercase}
    body.dark .hero-chip{color:var(--primary-2);background:rgba(0,229,255,.08);border-color:rgba(0,229,255,.28);box-shadow:0 0 16px rgba(0,229,255,.15)}

    /* ============ 顶栏（指挥舱玻璃） ============ */
    .topbar{position:fixed;top:0;left:0;right:0;z-index:900;display:flex;align-items:center;gap:14px;padding:0 20px;height:var(--topbar-h);background:var(--card-glass);backdrop-filter:var(--blur);-webkit-backdrop-filter:var(--blur);border-bottom:1px solid var(--border);box-shadow:0 1px 2px rgba(16,24,40,.04),0 4px 18px rgba(16,24,40,.05)}
    body.dark .topbar{background:rgba(7,12,22,.72);border-bottom:1px solid rgba(0,229,255,.12);box-shadow:0 1px 0 rgba(0,229,255,.08), 0 8px 30px rgba(0,0,0,.4)}
    .topbar-brand{display:flex;align-items:center;gap:11px;min-width:0;flex-shrink:0}
    .topbar-logo{width:36px;height:36px;border-radius:11px;object-fit:cover;flex-shrink:0;box-shadow:0 3px 12px rgba(0,0,0,.25);border:1px solid var(--border);cursor:pointer;transition:box-shadow .2s}
    body.dark .topbar-logo{box-shadow:0 0 18px rgba(0,229,255,.3), 0 3px 12px rgba(0,0,0,.3);border-color:rgba(0,229,255,.25)}
    .topbar-logo:hover{box-shadow:0 0 24px rgba(0,229,255,.4)}
    .topbar-title{font-weight:700;font-size:15px;letter-spacing:.2px;white-space:nowrap;line-height:1.15}
    .topbar-title small{display:block;font-size:10.5px;font-weight:700;color:var(--text-sec);letter-spacing:1.2px;text-transform:uppercase}
    body.dark .topbar-title small{color:rgba(0,229,255,.7)}
    .topbar-center{display:flex;align-items:center;gap:8px;justify-content:center;flex:1;min-width:0;overflow:hidden}
    .topbar-actions{display:flex;align-items:center;gap:6px;flex-shrink:0}
    .topbar-actions .tb-group{display:flex;align-items:center;gap:2px;padding:4px;background:var(--bg-soft);border:1px solid var(--border);border-radius:13px}
    body.dark .topbar-actions .tb-group{background:rgba(11,18,32,.8);border-color:rgba(0,229,255,.14)}
    .tb-icon-btn{display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:9px;border:none;background:transparent;cursor:pointer;color:var(--text-sec);padding:0;transition:all .18s;font-family:inherit}
    .tb-icon-btn:hover{color:var(--primary);background:var(--card);box-shadow:var(--shadow-sm)}
    body.dark .tb-icon-btn:hover{color:var(--primary-2);background:rgba(13,21,38,.9);box-shadow:0 0 14px rgba(0,229,255,.15)}
    .tb-icon-btn svg{width:17px;height:17px;fill:currentColor}
    .tb-icon-btn.danger:hover{color:var(--danger);background:var(--card)}
    body.dark .tb-icon-btn.danger:hover{background:rgba(255,92,122,.12)}

    /* ============ 按钮（霓虹系统） ============ */
    .btn-submit,.btn-danger,.btn-ghost,.btn-edit,.btn-del,.btn-dns,.pill-btn,.pill-close{display:inline-flex;align-items:center;justify-content:center;gap:6px;border:none;cursor:pointer;font-weight:600;transition:all .18s;white-space:nowrap;font-family:inherit;line-height:1}
    .btn-submit{background:var(--primary-grad);color:#fff;padding:11px 20px;border-radius:var(--radius-sm);box-shadow:0 4px 16px rgba(61,123,255,.4);text-shadow:0 1px 2px rgba(0,0,0,.15);position:relative;overflow:hidden}
    .btn-submit::after{content:'';position:absolute;top:0;left:-80%;width:50%;height:100%;background:linear-gradient(100deg,transparent,rgba(255,255,255,.35),transparent);transform:skewX(-25deg);transition:left .5s var(--ease)}
    .btn-submit:hover{transform:translateY(-1px);box-shadow:0 8px 24px rgba(61,123,255,.5);filter:brightness(1.06)}
    .btn-submit:hover::after{left:130%}
    .btn-submit:active{transform:translateY(0) scale(.98)}
    .btn-submit:disabled{opacity:.55;cursor:not-allowed;transform:none;box-shadow:none;filter:none}
    body.dark .btn-submit{background:linear-gradient(135deg,#0a84ff 0%,#00d4ff 100%);box-shadow:0 4px 18px rgba(0,213,255,.35), 0 0 20px rgba(0,213,255,.15)}
    body.dark .btn-submit:hover{box-shadow:0 8px 28px rgba(0,213,255,.45), 0 0 30px rgba(0,213,255,.2)}
    .btn-danger{background:linear-gradient(135deg,#ff7a5c,#ff4d6a);color:#fff;padding:11px 20px;border-radius:var(--radius-sm);box-shadow:0 4px 16px rgba(255,77,106,.35)}
    body.dark .btn-danger{background:linear-gradient(135deg,#ff6b81,#ff2e4d);box-shadow:0 4px 18px rgba(255,46,77,.3), 0 0 20px rgba(255,46,77,.12)}
    .btn-danger:hover{transform:translateY(-1px);box-shadow:0 8px 24px rgba(255,77,106,.45)}
    .btn-danger:active{transform:translateY(0) scale(.98)}
    .btn-ghost{background:transparent;color:var(--primary);border:1px solid var(--border);padding:9px 14px;border-radius:var(--radius-sm);font-size:13px}
    .btn-ghost:hover{border-color:var(--primary);box-shadow:0 0 0 3px var(--primary-soft)}
    .btn-edit{background:var(--card);color:var(--primary);border:1px solid var(--primary);padding:8px 14px;border-radius:9px;font-size:13px}
    .btn-edit:hover{background:var(--primary-soft)}
    .btn-del{background:var(--card);color:var(--danger);border:1px solid var(--danger);padding:8px 14px;border-radius:9px;font-size:13px}
    .btn-del:hover{background:var(--danger-soft)}
    .btn-dns{background:var(--card);color:var(--success);border:1px solid var(--success);padding:8px 14px;border-radius:9px;font-size:13px}
    .btn-dns:hover{background:var(--success-soft)}
    .btn-dns:disabled{opacity:.5;cursor:not-allowed}
    .icon-btn{display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:9px;border:1px solid var(--border);background:var(--card);cursor:pointer;color:var(--text-sec);padding:0;transition:all .18s;flex-shrink:0}
    .icon-btn:hover{color:var(--primary);border-color:var(--primary);box-shadow:0 3px 12px var(--primary-soft)}
    body.dark .icon-btn{background:rgba(11,18,32,.6)}
    body.dark .icon-btn:hover{border-color:var(--primary-2);color:var(--primary-2);box-shadow:0 0 14px rgba(0,229,255,.2)}
    .icon-btn svg{width:15px;height:15px;fill:currentColor}
    .pill-btn{padding:6px 14px;border-radius:999px;background:var(--primary-soft);border:1px solid rgba(61,123,255,.28);color:var(--primary);font-size:13px}
    .pill-btn:hover{background:rgba(61,123,255,.18)}
    body.dark .pill-btn{background:rgba(0,229,255,.1);border-color:rgba(0,229,255,.25);color:var(--primary-2)}
    .pill-close{width:30px;height:30px;border-radius:999px;background:var(--danger-soft);border:1px solid rgba(255,77,106,.32);color:var(--danger)}
    /* 窄屏(手机竖屏等):顶栏按钮只显示图标,隐藏文字,防拥挤/重合 */
    @media (max-width: 640px){
        .topbar-right .pill-btn{padding:8px 10px}
        .topbar-right .pill-btn .btn-txt{display:none}
        .rtt-pill .rtt-label{display:none}
        .rtt-pill{padding:6px 9px}
    }
    .pill-close:hover{background:rgba(255,77,106,.2)}
    .btn-submit svg,.btn-danger svg,.btn-ghost svg,.btn-edit svg,.btn-del svg,.btn-dns svg,.pill-btn svg,.pill-close svg{width:15px;height:15px}

    /* ============ 移动端顶栏适配：按钮不重叠 ============ */
    @media (max-width: 600px){
        .topbar{padding:0 10px;gap:8px;height:54px}
        .topbar-logo{width:29px;height:29px;border-radius:9px}
        .rtt-pill{gap:4px;padding:4px 9px;font-size:11px}
        .rtt-label{display:none}
        .rtt-pill svg{width:13px;height:13px}
        .pill-btn{padding:5px 9px;font-size:12px;gap:4px}
        .pill-btn svg{width:13px;height:13px}
        .pill-close{width:26px;height:26px}
        .topbar-right{gap:6px}
    }
    @media (max-width: 380px){
        .pill-btn{font-size:11px;padding:4px 7px}
        #rttValue{max-width:52px;overflow:hidden;text-overflow:ellipsis}
    }

    /* ============ 徽标 / 状态（霓虹） ============ */
    .badge{padding:4px 11px;border-radius:999px;font-size:12px;font-weight:600;display:inline-flex;align-items:center;gap:5px;white-space:nowrap}
    .badge::before{content:'';width:6px;height:6px;border-radius:50%;background:currentColor;opacity:.9;box-shadow:0 0 8px currentColor}
    .rtt-pill{display:inline-flex;align-items:center;gap:8px;padding:6px 14px;border-radius:999px;background:var(--primary-soft);border:1px solid rgba(61,123,255,.3);font-family:var(--font-mono);font-size:12px;font-weight:600;color:var(--text);white-space:nowrap;cursor:default}
    body.dark .rtt-pill{background:rgba(0,229,255,.07);border-color:rgba(0,229,255,.2);box-shadow:0 0 14px rgba(0,229,255,.06)}
    .rtt-dot{width:7px;height:7px;border-radius:50%;background:var(--success);box-shadow:0 0 10px var(--success);flex-shrink:0}
    .rtt-label{color:var(--text-sec)}
    #themeToggle{background:transparent;border:none;cursor:pointer;padding:2px;display:inline-flex;color:var(--text-sec);transition:color .2s}
    #themeToggle:hover{color:var(--primary)}
    #themeToggle svg{width:18px;height:18px}
    .ping-badge{color:var(--text-sec);cursor:pointer;padding:5px 12px;background:var(--bg-soft);border-radius:999px;font-size:13px;font-weight:500;transition:all .2s;border:1px solid var(--border);user-select:none;display:inline-flex;align-items:center;gap:5px}
    .ping-badge:hover{border-color:var(--primary);color:var(--primary);box-shadow:0 2px 10px var(--primary-soft)}
    body.dark .ping-badge{background:rgba(11,18,32,.7)}
    body.dark .ping-badge:hover{border-color:var(--primary-2);color:var(--primary-2);box-shadow:0 0 12px rgba(0,229,255,.2)}

    /* ============ 表单 ============ */
    .field{display:flex;flex-direction:column;gap:6px;min-width:0}
    .field>label{font-size:12.5px;font-weight:600;color:var(--text-sec);display:flex;align-items:center;gap:5px}
    .field input[type=text],.field input[type=url],.field input[type=password],.field input[type=number],.field select,.field textarea,.toolbar select{width:100%;padding:11px 14px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--bg-soft);color:var(--text);font-size:14px}
    body.dark .field input[type=text],body.dark .field input[type=url],body.dark .field input[type=password],body.dark .field input[type=number],body.dark .field select,body.dark .field textarea,body.dark .toolbar select{background:rgba(11,18,32,.7);border-color:rgba(0,229,255,.1)}
    body.dark .field input:hover,body.dark .field select:hover,body.dark .field textarea:hover{border-color:rgba(0,229,255,.3)}
    .field input:hover,.field select:hover,.field textarea:hover{border-color:var(--border-strong)}
    .form-row{display:flex;flex-wrap:wrap;gap:12px;align-items:center}
    .form-row .field{flex:1;min-width:220px}
    .search-input{padding:10px 16px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--bg-soft);color:var(--text);font-size:14px;width:260px;transition:border-color .2s,box-shadow .2s}
    .search-input:focus{border-color:var(--primary);box-shadow:0 0 0 3px var(--primary-soft)}
    body.dark .search-input{background:rgba(11,18,32,.7);border-color:rgba(0,229,255,.1)}
    body.dark .search-input:focus{border-color:var(--primary-2);box-shadow:0 0 0 3px rgba(0,229,255,.1), 0 0 16px rgba(0,229,255,.12)}
    .ip-checkbox{width:18px;height:18px;cursor:pointer;accent-color:var(--primary)}
    .toolbar{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px;align-items:center}

    /* 节点页工具条 */
    .nodes-toolbar{display:flex;align-items:center;flex-wrap:wrap;gap:10px;background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:14px 18px;box-shadow:var(--shadow-sm);margin-bottom:16px}
    body.dark .nodes-toolbar{background:linear-gradient(160deg, rgba(13,21,38,.8), rgba(8,13,24,.9));border-color:rgba(0,229,255,.1)}
    .nodes-toolbar .search-input{flex:1;min-width:180px;max-width:340px;background:var(--bg-soft)}
    .nodes-toolbar .tb-sep{width:1px;height:26px;background:var(--border);margin:0 2px}
    .batch-sel{min-width:150px}

    /* ============ 节点卡片（星云数据卡） ============ */
    .node-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(350px,1fr));gap:16px}
    .emby-card{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:18px 18px 14px;box-shadow:var(--shadow-sm);display:flex;flex-direction:column;gap:12px;transition:all .25s;position:relative;overflow:hidden}
    .emby-card::before{content:'';position:absolute;left:0;top:0;width:100%;height:3px;background:var(--primary-grad);opacity:.85;transition:all .3s}
    .emby-card::after{content:'';position:absolute;right:-40px;top:-40px;width:110px;height:110px;border-radius:50%;background:radial-gradient(circle,rgba(0,229,255,.07),transparent 70%);pointer-events:none;transition:opacity .3s}
    body.dark .emby-card{background:linear-gradient(165deg, rgba(14,22,40,.92), rgba(9,14,26,.96));border-color:rgba(0,229,255,.1)}
    .emby-card:hover{box-shadow:var(--shadow-lg);transform:translateY(-3px);border-color:var(--border-strong)}
    body.dark .emby-card:hover{border-color:rgba(0,229,255,.35);box-shadow:var(--shadow-lg), var(--glow)}
    body.dark .emby-card:hover::before{box-shadow:0 0 18px rgba(0,229,255,.6)}
    .emby-card .card-header{border-bottom:1px solid var(--border);padding-bottom:12px}
    .card-title-group{display:flex;align-items:center;gap:11px;min-width:0;flex:1}
    .emby-icon{font-size:26px;background:linear-gradient(135deg,var(--primary-soft),transparent);border-radius:12px;padding:6px;border:1px solid var(--border);display:flex;align-items:center;justify-content:center;width:46px;height:46px;flex-shrink:0;color:var(--primary)}
    body.dark .emby-icon{background:rgba(0,229,255,.07);border-color:rgba(0,229,255,.16);color:var(--primary-2);box-shadow:0 0 14px rgba(0,229,255,.08)}
    .emby-icon svg{width:23px;height:23px}
    .emby-card .card-remark{font-size:15.5px;font-weight:700;line-height:1.25;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .emby-card .card-prefix{font-size:12px;color:var(--text-sec);font-family:var(--font-mono);margin-top:1px}
    .node-summary{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
    .node-detail{display:none;flex-direction:column;gap:10px;background:var(--bg-soft);border:1px solid var(--border);border-radius:var(--radius-md);padding:13px 14px;margin-top:2px}
    body.dark .node-detail{background:rgba(8,13,24,.6);border-color:rgba(0,229,255,.08)}
    .info-row{display:flex;align-items:flex-start;justify-content:space-between;font-size:13px;gap:10px}
    .info-label{color:var(--text-sec);font-weight:600;min-width:64px;margin-top:4px;flex-shrink:0;font-size:12px}
    .action-group{display:inline-flex;gap:6px;background:var(--card);padding:5px 8px;border-radius:var(--radius-sm);border:1px solid var(--border);align-items:flex-start;max-width:100%;flex-wrap:wrap;box-shadow:var(--shadow-sm)}
    body.dark .action-group{background:rgba(11,18,32,.6)}
    .card-footer{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-top:auto;padding-top:12px;border-top:1px dashed var(--border)}
    body.dark .card-footer{border-top:1px dashed rgba(0,229,255,.12)}
    .card-footer .f-right{display:flex;gap:8px;align-items:center}
    .drag-handle{cursor:grab;padding-right:8px;font-size:0;color:var(--text-faint);display:flex;align-items:center;user-select:none;touch-action:none}
    .drag-handle:active{cursor:grabbing;color:var(--primary)}
    .drag-handle svg{width:18px;height:18px}
    .emby-card.sortable-ghost{opacity:.4}
    .emby-card.sortable-drag{cursor:grabbing!important;box-shadow:var(--shadow-lg)}
    .secret-text{font-family:var(--font-mono);letter-spacing:2px;color:var(--text-faint);font-size:12px}
    .dynamic-url{display:block;max-width:210px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;text-align:right}
    .actual-text.dynamic-url{white-space:normal;max-width:100%;overflow:visible;text-align:left!important;word-break:break-all;font-size:12px;font-family:var(--font-mono);color:var(--primary);letter-spacing:normal}
    .url-list-item{background:var(--card);border:1px solid var(--border);padding:5px 10px;border-radius:8px;font-size:12px;margin-top:5px;word-break:break-all;line-height:1.5;color:var(--text)}
    .url-list-item:first-child{margin-top:0}

    /* ============ 表格（星云数据台） ============ */
    .table-wrapper{width:100%;border-radius:var(--radius-md);border:1px solid var(--border);overflow:hidden;background:var(--card);box-shadow:var(--shadow-sm)}
    body.dark .table-wrapper{background:rgba(11,18,32,.6);border-color:rgba(0,229,255,.1)}
    table{width:100%;border-collapse:collapse;text-align:left}
    th,td{padding:13px 16px;border-bottom:1px solid var(--border);font-size:13.5px;vertical-align:middle}
    th{color:var(--text-sec);font-weight:700;background:var(--bg-soft);font-size:11.5px;letter-spacing:.8px;text-transform:uppercase;white-space:nowrap}
    body.dark th{background:rgba(8,13,24,.8);color:rgba(0,229,255,.75);font-size:11px;letter-spacing:1.2px}
    tr:last-child td{border-bottom:none}
    tbody tr{transition:background .15s}
    tbody tr:hover td{background-color:var(--primary-soft)}
    body.dark tbody tr:hover td{background:rgba(0,229,255,.05)}

    /* ============ 图标选择 ============ */
    .icon-item{cursor:pointer;padding:6px;border-radius:var(--radius-sm);border:1px solid var(--border);display:flex;justify-content:center;align-items:center;transition:all .2s;background:var(--bg-soft);height:46px}
    .icon-item:hover{border-color:var(--primary)!important;box-shadow:0 2px 10px var(--primary-soft);transform:scale(1.06)}
    .icon-item.selected{border-color:var(--primary);background:var(--primary-soft)}
    #iconGrid::-webkit-scrollbar{width:6px}
    #iconGrid::-webkit-scrollbar-thumb{background:var(--border-strong);border-radius:3px}

    /* ============ 弹窗（全息舱） ============ */
    .modal-mask{display:none;position:fixed;inset:0;z-index:1000;background:rgba(4,8,16,.6);overflow-y:auto;-webkit-overflow-scrolling:touch;padding:max(16px, env(safe-area-inset-top)) 16px max(24px, env(safe-area-inset-bottom))}
    body.dark .modal-mask{background:rgba(3,6,12,.72)}
    .modal-box{max-width:680px;margin:max(24px, env(safe-area-inset-top)) auto;background:var(--card);border:1px solid var(--border);border-radius:22px;padding:24px;box-shadow:var(--shadow-lg);animation:dsModalIn .3s var(--ease)}
    body.dark .modal-box{background:linear-gradient(165deg, rgba(14,22,40,.97), rgba(8,13,24,.98));border-color:rgba(0,229,255,.14);box-shadow:var(--shadow-lg), 0 0 40px rgba(0,229,255,.06)}
    .modal-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:18px;gap:10px}
    .modal-head h2{font-size:17px;display:flex;align-items:center;gap:9px;margin:0;font-weight:800}
    .modal-head .close-x{background:transparent;border:none;cursor:pointer;color:var(--text-faint);display:inline-flex;padding:6px;border-radius:9px;transition:all .15s}
    .modal-head .close-x:hover{color:var(--danger);background:var(--danger-soft)}
    .modal-head .close-x svg{width:19px;height:19px}
    @keyframes dsModalIn{from{opacity:0;transform:translateY(16px) scale(.98)}to{opacity:1;transform:translateY(0) scale(1)}}

    /* ============ 视图切换 ============ */
    .page-view{display:none}
    .page-view.active{display:block;animation:dsFadeIn .32s var(--ease) forwards}
    @keyframes dsFadeIn{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}

    /* ============ 底部 Dock（指挥舱） ============ */
    .ds-dock{position:fixed;bottom:20px;left:50%;transform:translateX(-50%);width:calc(100% - 32px);max-width:580px;background:var(--card-glass);backdrop-filter:var(--blur);-webkit-backdrop-filter:var(--blur);border:1px solid var(--border);border-radius:999px;padding:6px 10px;display:flex;justify-content:space-around;box-shadow:var(--shadow-lg);z-index:950}
    body.dark .ds-dock{background:rgba(9,15,28,.75);border-color:rgba(0,229,255,.16);box-shadow:0 12px 40px rgba(0,0,0,.5), 0 0 30px rgba(0,229,255,.06)}
    .ds-dock-item{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;padding:9px 16px;border-radius:999px;color:var(--text-sec);font-size:11px;font-weight:700;letter-spacing:.2px;transition:all .22s;background:transparent;border:none;cursor:pointer;flex:1;font-family:inherit}
    .ds-dock-item svg{width:21px;height:21px;fill:currentColor;transition:transform .22s}
    .ds-dock-item:hover{color:var(--primary)}
    .ds-dock-item:hover svg{transform:translateY(-2px)}
    .ds-dock-item.active{color:#fff;background:var(--primary-grad-2);box-shadow:0 4px 18px rgba(124,92,255,.4)}
    body.dark .ds-dock-item.active{background:linear-gradient(135deg,#00d4ff 0%,#3d7bff 100%);box-shadow:0 4px 20px rgba(0,213,255,.45), 0 0 26px rgba(0,213,255,.25)}
    .ds-dock-item.active svg,.ds-dock-item.active span{color:#fff;fill:#fff}

    /* ============ Toast（霓虹胶囊） ============ */
    #toast{position:fixed;top:-64px;left:50%;transform:translateX(-50%);background:rgba(13,17,28,.94);color:#fff;padding:12px 26px;border-radius:999px;font-size:14px;font-weight:600;transition:top .45s var(--ease);z-index:9999;backdrop-filter:blur(12px);text-align:center;max-width:90vw;word-wrap:break-word;box-shadow:0 8px 30px rgba(0,0,0,.4), 0 0 20px rgba(0,229,255,.1);border:1px solid rgba(0,229,255,.2);display:flex;align-items:center;gap:8px}
    #toast.show{top:20px}

    /* ============ 图标统一 ============ */
    .ti{display:inline-flex;align-items:center;justify-content:center;vertical-align:-.18em;flex-shrink:0}
    .ti svg{width:16px;height:16px}
    h1 svg,h2 svg,h3 svg,h4 svg,p svg,label svg,span svg,div svg{width:1.1em;height:1.1em;vertical-align:-.18em;flex-shrink:0}
    .rotated{transform:rotate(180deg)}

    /* ============ 大屏弹窗（数据星云） ============ */
    #dashboardModal{padding:10px}
    #dashboardModal .modal-box{max-width:1000px}
    .stat-pills{display:flex;gap:10px;flex-wrap:wrap}
    .stat-pill{font-size:12.5px;background:var(--primary-soft);color:var(--primary);padding:6px 13px;border-radius:999px;border:1px solid rgba(61,123,255,.22);display:flex;gap:10px;flex-wrap:wrap}
    body.dark .stat-pill{background:rgba(0,229,255,.08);border-color:rgba(0,229,255,.2);color:var(--primary-2)}
    .stat-pill strong{font-weight:700}
    .chart-panel{flex:2;min-width:300px;border:1px solid var(--border);border-radius:var(--radius-md);padding:14px;background:var(--bg-soft)}
    body.dark .chart-panel{background:rgba(8,13,24,.6);border-color:rgba(0,229,255,.1)}
    .chart-panel.pie{flex:1;display:flex;justify-content:center;align-items:center;min-height:280px}

    /* ============ 测速页 ============ */
    #view-speed .toolbar{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;align-items:stretch}
    #view-speed .toolbar select{grid-column:1/-1;width:100%}
    #view-speed .toolbar .btn-submit{width:100%;padding:12px 14px;font-size:13px;justify-content:center}
    .node-cb{width:18px;height:18px;margin:0;cursor:pointer;accent-color:var(--primary);flex-shrink:0}
    .ip-text{font-family:var(--font-mono);cursor:pointer}
    .test-row .latency,.test-row .speed,.test-row .loc{font-weight:600}

    /* ============ 响应式 ============ */
    /* 测速行 / 选择行（JS 动态类，纯视觉） */
    .route-item{cursor:pointer;transition:background .15s}
    .route-item:hover td{background:var(--primary-soft)}
    .row-checkbox{width:17px;height:17px;accent-color:var(--primary);cursor:pointer}
    @media (max-width:768px){
        body{padding:0}
        .container{padding:calc(var(--topbar-h) + 16px) 14px 124px}
        .card{padding:18px;border-radius:14px;margin-bottom:16px}
        .hero-card{padding:22px 18px}
        .hero-card h1{font-size:20px}
        .node-grid{grid-template-columns:1fr}
        .nodes-toolbar{padding:12px 14px}
        .table-wrapper{border:none;background:transparent;overflow:visible;box-shadow:none}
        table,thead,tbody,th,td,tr{display:block;width:100%}
        thead{display:none}
        tr{margin-bottom:14px;background:var(--card);border-radius:var(--radius-md);border:1px solid var(--border);box-shadow:var(--shadow);overflow:hidden}
        body.dark tr{background:linear-gradient(160deg, rgba(14,22,40,.9), rgba(9,14,26,.95));border-color:rgba(0,229,255,.1)}
        td{display:flex;align-items:center;padding:12px 14px;border-bottom:1px solid var(--border);text-align:right;gap:10px;min-height:46px}
        td:last-child{border-bottom:none}
        td[colspan]{justify-content:center;text-align:center}
        td[colspan]::before{display:none!important}
        td::before{content:attr(data-label);font-weight:600;color:var(--text-sec);flex-shrink:0;margin-right:auto;text-align:left;font-size:11px;letter-spacing:.4px;text-transform:uppercase}
        .search-input{width:100%;max-width:none}
        .toolbar{flex-direction:column;align-items:stretch;gap:10px}
        .toolbar>*{width:100%}
        .topbar{padding:0 12px;gap:8px}
        .topbar-logo{width:32px;height:32px}
        .topbar-title{display:none}
        .topbar-center{flex:1}
        .pill-btn{padding:5px 10px;font-size:12px}
        .rtt-pill{padding:5px 10px;gap:6px;font-size:11px}
        .rtt-label{display:none}
        .modal-box{margin:12px auto;padding:18px;border-radius:16px}
        .stat-pill{font-size:12px}
        .nodes-toolbar .tb-sep{display:none}
    }
/* ============================================================
   伪装版特有组件 · 星云适配层（NEBULA specific）
   布局容器 / 顶栏左右区 / 保活徽章 ka-cd / 目标线路输入框
   追加在星云设计系统之后，仅补充星云未定义的选择器
   ============================================================ */
.container{max-width:1200px;margin:0 auto;width:100%;min-height:90vh;display:flex;flex-direction:column;padding-top:96px;padding-bottom:132px}
.content-wrap{flex:1}

/* 顶栏左右区块（伪装版布局结构） */
.topbar-left{display:flex;align-items:center;gap:12px;min-width:0}
.topbar-right{display:flex;align-items:center;gap:10px;flex-wrap:nowrap;margin-left:auto}

/* 区块标题（伪装版 .header h1） */
.header h1{display:inline-flex;align-items:center;gap:12px;font-size:22px;margin:0;letter-spacing:-.3px;color:var(--text)}
.header h1 svg{width:22px;height:22px;color:var(--primary-2);flex-shrink:0}
body.dark .header h1{background:linear-gradient(120deg,#7ec9ff 0%,#00e5ff 45%,#a78bfa 100%);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;filter:drop-shadow(0 0 18px rgba(0,229,255,.25))}

/* 保活倒计时徽章（伪装版 ka-cd） */
.ka-cd{display:inline-flex;align-items:center;gap:5px;font-size:12px;font-weight:600;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;letter-spacing:.5px;color:var(--text-sec);background:rgba(0,229,255,.05);border:1px solid rgba(0,229,255,.16);padding:2px 10px;border-radius:999px;white-space:nowrap}
body.dark .ka-cd{color:#7ec9ff;background:rgba(0,229,255,.1);border-color:rgba(0,229,255,.3);box-shadow:0 0 14px rgba(0,229,255,.1) inset}
.ka-cd[data-ka-next]{animation:kaPulse 2.4s ease-in-out infinite}
@keyframes kaPulse{0%,100%{opacity:1}50%{opacity:.5}}

/* 目标线路输入框（伪装版 target-input，内联样式用 !important 兜底深色） */
.target-input{transition:border-color .2s,box-shadow .2s;font-size:14px}
.target-input:focus{outline:none}
body.dark .target-input{background:rgba(8,13,24,.72)!important;border-color:rgba(0,229,255,.22)!important;color:#e8eefc!important}
body.dark .target-input:focus{border-color:#00e5ff!important;box-shadow:0 0 0 4px rgba(0,229,255,.12)!important}
body.dark .target-input::placeholder{color:#8a96b8!important;opacity:1!important}

/* 伪装版节点卡片内联小结构（星云质感兜底） */
body.dark .emby-card .info-row{background:rgba(0,229,255,.04);border-color:rgba(0,229,255,.1)!important}
body.dark .emby-card .info-row:hover{border-color:rgba(0,229,255,.25)!important}

/* ============================================================
   深色模式可读性修复（伪装版表单区）
   —— placeholder / 12px 说明文字 / 灰色背景块 在深空背景上提亮
   ============================================================ */
body.dark #nodeModal{--text-sec:#aab6d6}
/* 全局：深色下所有文本输入控件文字强制浅色（伪装版内联未写 color，UA 默认黑字在深色底上不可见） */
body.dark input[type=text],body.dark input[type=url],body.dark input[type=password],body.dark input[type=number],body.dark input[type=search],body.dark input[type=email],body.dark select,body.dark textarea{color:#e8eefc!important}
body.dark select option{background:#0d1526;color:#e8eefc}
body.dark input::placeholder,body.dark textarea::placeholder{color:#8a96b8!important;opacity:1!important}
body.dark #nodeModal div[style*="rgba(120,120,120,0.05)"]{background:rgba(0,229,255,.045)!important;border-color:rgba(0,229,255,.1)!important}
body.dark #nodeModal #iconPickerPanel input{background:rgba(8,13,24,.7)!important;border-color:rgba(0,229,255,.15)!important}

/* ============================================================
   风格改造:玻璃拟态 + 背景弹幕 + 栏目折叠(v3.6.43)
   ============================================================ */
body.dark{background:linear-gradient(160deg,#0b0e1a 0%,#0f1730 48%,#060a13 100%) fixed}
.dm-layer{position:fixed;inset:0;overflow:hidden;pointer-events:none;z-index:0}
.dm-layer .dm{position:absolute;white-space:nowrap;font-weight:600;letter-spacing:3px;font-size:14px;opacity:.13;will-change:transform;animation:dmDrift var(--dm-dur,26s) linear infinite;animation-delay:var(--dm-delay,0s)}
.dm-a{color:#8ab4ff}.dm-b{color:#ffa657}.dm-c{color:#56d4dd}.dm-d{color:#a78bfa}.dm-e{color:#7ee787}
/* 浅色模式下弹幕加深提亮,保证可见 */
body:not(.dark) .dm-layer .dm{opacity:.34}
body:not(.dark) .dm-a{color:#1f5fc7}body:not(.dark) .dm-b{color:#c96a10}body:not(.dark) .dm-c{color:#0e8d9f}body:not(.dark) .dm-d{color:#6d3fc4}body:not(.dark) .dm-e{color:#2f8f43}
@keyframes dmDrift{from{transform:translateX(105%)}to{transform:translateX(-45%)}}
.content-wrap,.login-wrap,.container{position:relative;z-index:1}
/* 主卡片玻璃化(深色) */
body.dark .card,body.dark .table-wrapper{
    background:rgba(13,21,38,.72)!important;backdrop-filter:blur(16px) saturate(1.5);-webkit-backdrop-filter:blur(16px) saturate(1.5);border-color:rgba(255,255,255,.1)}
body.dark .modal-box{background:rgba(10,16,30,.85)!important;backdrop-filter:blur(18px) saturate(1.5);-webkit-backdrop-filter:blur(18px) saturate(1.5)}
/* 栏目折叠组件 */
.collapse-head{display:flex;align-items:center;justify-content:space-between;cursor:pointer;user-select:none;margin-bottom:10px;gap:8px}
.collapse-head .ch-title{display:flex;align-items:center;gap:8px;font-size:15px;font-weight:800;color:var(--text)}
.collapse-head .ch-arrow{font-size:11px;color:var(--text-sec);transition:transform .25s var(--ease);flex-shrink:0}
.collapse-sec.open .collapse-head .ch-arrow{transform:rotate(90deg)}
.collapse-body{display:none}
.collapse-sec.open .collapse-body{display:block}
.collapse-arrow{display:inline-block;transition:transform .25s var(--ease);color:var(--text-sec);font-size:12px;margin-right:2px}
.collapse-arrow.open{transform:rotate(90deg)}
/* ===== 按钮组统排:等宽等高;3/2个一组始终一排;5个一组移动端2+3、宽屏一排 ===== */
.btn-grid{display:flex;flex-wrap:wrap;gap:10px}
.btn-grid>button{flex:1 1 30%;min-width:0;box-sizing:border-box;text-align:center;white-space:nowrap;padding:12px 8px;font-size:12px;justify-content:center;line-height:1.2;margin:0}
.btn-grid.cols-5>button:nth-child(-n+2){flex:1 1 45%;font-size:13px}
@media(min-width:640px){
  .btn-grid.cols-5>button,.btn-grid.cols-5>button:nth-child(-n+2),.btn-grid.cols-5>button:nth-child(n+3){flex:1 1 18%;font-size:13px}
}

`



const LOGIN_UI = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
    <meta name="theme-color" content="#060a13">
    <title>系统授权</title>
    <style>
        ${CSS_COMMON}
        body { display:flex; justify-content:center; align-items:center; min-height:100vh; padding:16px; margin:0; background:linear-gradient(160deg,#0b0e1a 0%,#0f1730 48%,#060a13 100%) fixed; color:#e8eefc; }
        /* 星云极光背景 */
        body::before { content:''; position:fixed; inset:0; z-index:-1; pointer-events:none; background:
            radial-gradient(2px 2px at 15% 25%, rgba(255,255,255,.8), transparent 45%),
            radial-gradient(1.5px 1.5px at 82% 14%, rgba(0,229,255,1), transparent 45%),
            radial-gradient(2px 2px at 28% 78%, rgba(255,255,255,.6), transparent 45%),
            radial-gradient(1.5px 1.5px at 64% 60%, rgba(139,92,246,1), transparent 45%),
            radial-gradient(2px 2px at 90% 84%, rgba(255,255,255,.5), transparent 45%),
            radial-gradient(1.5px 1.5px at 6% 62%, rgba(0,229,255,.8), transparent 45%),
            radial-gradient(900px 520px at 10% -10%, rgba(77,163,255,.22), transparent 62%),
            radial-gradient(820px 500px at 108% 4%, rgba(0,229,255,.14), transparent 60%),
            radial-gradient(760px 520px at 50% 120%, rgba(139,92,246,.2), transparent 62%); }
        body::after { content:''; position:fixed; inset:0; z-index:-1; pointer-events:none; opacity:.9;
            background-image:
                linear-gradient(rgba(0,229,255,.05) 1px, transparent 1px),
                linear-gradient(90deg, rgba(0,229,255,.05) 1px, transparent 1px);
            background-size:46px 46px;
            mask-image:radial-gradient(ellipse 80% 65% at 50% 20%, #000 30%, transparent 80%); }
        .login-wrap { width:100%; max-width:400px; }
        .login-box { background:rgba(10,16,30,.72); backdrop-filter:var(--blur); -webkit-backdrop-filter:var(--blur); padding:44px 32px 30px; border-radius:26px; box-shadow:0 20px 60px rgba(0,0,0,.5), 0 0 50px rgba(0,229,255,.06); text-align:center; width:100%; border:1px solid rgba(0,229,255,.18); animation:dsModalIn .4s var(--ease); position:relative; overflow:hidden; }
        .login-box::before { content:''; position:absolute; left:0; top:0; width:100%; height:3px; background:linear-gradient(90deg, transparent, #00e5ff, #8b5cf6, transparent); box-shadow:0 0 18px rgba(0,229,255,.6); }
        /* 扫描线 */
        .login-box::after { content:''; position:absolute; left:0; right:0; top:-30%; height:26%; background:linear-gradient(180deg, transparent, rgba(0,229,255,.05), transparent); animation:lgScan 5.5s linear infinite; pointer-events:none; }
        @keyframes lgScan { 0% { top:-30%; } 100% { top:130%; } }
        .login-logo { width:70px; height:70px; border-radius:20px; object-fit:cover; margin:0 auto 22px; box-shadow:0 0 30px rgba(0,229,255,.35), 0 12px 34px rgba(0,0,0,.4); display:block; border:1px solid rgba(0,229,255,.3); background:rgba(13,21,38,.9); }
        .login-box h2 { margin:0 0 6px; font-size:22px; font-weight:800; letter-spacing:.3px; background:linear-gradient(120deg,#7ec9ff,#00e5ff,#a78bfa); -webkit-background-clip:text; background-clip:text; -webkit-text-fill-color:transparent; filter:drop-shadow(0 0 16px rgba(0,229,255,.25)); }
        .login-sub { color:#8a94b0; font-size:13px; margin:0 0 30px; }
        .login-box input { width:100%; padding:15px 16px; margin-bottom:16px; border:1px solid rgba(0,229,255,.2); border-radius:14px; background:rgba(8,13,24,.7); color:#e8eefc; text-align:center; letter-spacing:3px; font-size:15px; transition:border-color .2s,box-shadow .2s,background .2s; }
        .login-box input::placeholder { color:#566084; }
        .login-box input:focus { border-color:#00e5ff; box-shadow:0 0 0 4px rgba(0,229,255,.12), 0 0 22px rgba(0,229,255,.18); background:rgba(11,18,32,.85); }
        .login-box button { width:100%; padding:15px; background:linear-gradient(135deg,#0a84ff 0%,#00d4ff 100%); color:#fff; border:none; border-radius:14px; cursor:pointer; font-weight:700; font-size:15px; letter-spacing:4px; box-shadow:0 6px 22px rgba(0,213,255,.35), 0 0 26px rgba(0,213,255,.14); transition:all .2s; position:relative; overflow:hidden; }
        .login-box button::after { content:''; position:absolute; top:0; left:-80%; width:50%; height:100%; background:linear-gradient(100deg,transparent,rgba(255,255,255,.4),transparent); transform:skewX(-25deg); transition:left .5s var(--ease); }
        .login-box button:hover { transform:translateY(-2px); box-shadow:0 10px 30px rgba(0,213,255,.45), 0 0 34px rgba(0,213,255,.2); filter:brightness(1.06); }
        .login-box button:hover::after { left:130%; }
        .login-box button:active { transform:translateY(0) scale(.98); }
        .login-foot { margin-top:22px; font-size:12px; color:#566084; }
        @keyframes lgShift { from { background-position:0% 0%; } to { background-position:100% 100%; } }
    </style>
    <link rel="icon" type="image/jpeg" href="${EMBY_LOGO}">
    <script>
const I = {
  rocket:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 16.5c-1.5 1.3-2 5-2 5s3.7-.5 5-2c.7-.8.7-2 0-2.8-.8-.7-2.2-.7-3 .8z"/><path d="M12 15l-3-3c.5-4 4-7.5 8-8 2 .2 3.8 2 4 4-.5 4-4 7.5-8 8l-1-1z"/><path d="M9 12c-2 1-3.5 3-4 5"/><circle cx="15" cy="9" r="0.5"/></svg>',
  xmark:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  check:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4L19 7"/></svg>',
  warn:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3L2 20h20L12 3z"/><path d="M12 10v4M12 17.5h.01"/></svg>',
  film:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4"/></svg>',
  star:'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3l2.7 5.7 6.3.8-4.6 4.3 1.1 6.2-5.5-3-5.5 3 1.1-6.2L3 9.5l6.3-.8L12 3z"/></svg>',
  sparkles:'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3zM18 14l.8 2.2L21 17l-2.2.8L18 20l-.8-2.2L15 17l2.2-.8L18 14zM6 14l.6 1.7L8.5 16l-1.9.7L6 18.5l-.6-1.8L3.5 16l1.9-.3L6 14z"/></svg>',
  globe:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.5 2.5 15 0 18M12 3c-2.5 2.5-2.5 15 0 18"/></svg>',
  bolt:'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M13 2L4 14h6l-1 8 9-12h-6l1-8z"/></svg>',
  refresh:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12a8 8 0 1 1-2.34-5.66"/><path d="M20 3v5h-5"/></svg>',
  chart:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M5 20V10M12 20V4M19 20v-7"/></svg>',
  cloud:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 18a4 4 0 1 1 0-8 5 5 0 0 1 9.6 1.3A3.5 3.5 0 0 1 17 18H7z"/></svg>',
  trash:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>',
  search:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>',
  location:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/></svg>',
  trophy:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 21h8M12 17v4M7 4h10v6a5 5 0 0 1-10 0V4z"/><path d="M7 5H4v2a3 3 0 0 0 3 3M17 5h3v2a3 3 0 0 1-3 3"/></svg>',
  moon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>',
  sun:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4.5"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  pencil:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>',
  gear:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M4.2 4.2l2.8 2.8M17 17l2.8 2.8M1 12h4M19 12h4M4.2 19.8L7 17M17 7l2.8-2.8"/></svg>',
  lines:'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 6h18v2H3zM3 11h18v2H3zM3 16h18v2H3z"/></svg>',
  box:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8l-9-5-9 5v8l9 5 9-5V8z"/><path d="M3 8l9 5 9-5M12 13v8"/></svg>',
  download:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M7 10l5 5 5-5M4 21h16"/></svg>',
  antenna:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6.4 2a14 14 0 0 0 0 20M17.6 2a14 14 0 0 1 0 20M9.8 5.5a9 9 0 0 0 0 13M14.2 5.5a9 9 0 0 1 0 13"/><circle cx="12" cy="12" r="1.5"/></svg>',
  bulb:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6M10 22h4M8 14.5A6 6 0 0 1 12 5a6 6 0 0 1 4 9.5c-.8.8-1 1.6-1 2.5h-6c0-.9-.2-1.7-1-2.5z"/></svg>',
  tv:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="13" rx="2"/><path d="M8 21h8M12 18v3"/></svg>',
  flame:'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2s5 4 5 9a5 5 0 0 1-10 0c0-2 1-3.5 2-5-.5 1-1 2-1 3 0 2.5 3 3 3 6 1-2 0-4 0-4 2 1 3 3 3 4.5A6.5 6.5 0 0 1 12 22 6.5 6.5 0 0 1 5.5 15C5.5 9 12 2 12 2z"/></svg>',
  link:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.07 0l2.83-2.83a5 5 0 0 0-7.07-7.07L11 4.93"/><path d="M14 11a5 5 0 0 0-7.07 0l-2.83 2.83a5 5 0 0 0 7.07 7.07L13 19.07"/></svg>',
  crown:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7l4 4 5-6 5 6 4-4-2 12H5L3 7z"/><path d="M6 19h12"/></svg>',
  target:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/></svg>',
  arrowdown:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12l7 7 7-7"/></svg>',
  robot:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="8" width="14" height="11" rx="2"/><path d="M12 8V4M8 4h8"/><circle cx="9.5" cy="13" r="1" fill="currentColor"/><circle cx="14.5" cy="13" r="1" fill="currentColor"/><path d="M2 13v3M22 13v3"/></svg>',
  spy:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="11" r="7"/><circle cx="9" cy="10" r="1" fill="currentColor"/><circle cx="15" cy="10" r="1" fill="currentColor"/><path d="M9.5 14c1 .8 4 .8 5 0"/></svg>',
  flask:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3h6M10 3v5L4.5 18a2 2 0 0 0 1.8 3h11.4a2 2 0 0 0 1.8-3L14 8V3"/><path d="M7 15h10"/></svg>',
  broom:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M13 3l8 8M11 11l8-8M4 20l7-7 1 1-7 7-2-1z"/><path d="M6 8l4 4"/></svg>',
  checksquare:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="4"/><path d="M8 12.5l2.5 2.5L16 9"/></svg>',
  upload:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15V3M7 8l5-5 5 5M4 21h16"/></svg>',
  db:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/></svg>',
  dotblue:'<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="7" fill="#007aff"/></svg>',
  dotorange:'<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="7" fill="#ff9500"/></svg>',
  dotgreen:'<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="7" fill="#34c759"/></svg>',
  dotpurple:'<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="7" fill="#af52de"/></svg>'
};

const E2I = { '${I.rocket}':'rocket','${I.xmark}':'xmark','${I.check}':'check','${I.warn}':'warn','${I.film}':'film','${I.star}':'star','${I.sparkles}':'sparkles','${I.sparkles}':'sparkles','${I.globe}':'globe','${I.globe}':'globe','${I.bolt}':'bolt','${I.refresh}':'refresh','${I.chart}':'chart','${I.cloud}':'cloud','${I.trash}':'trash','${I.search}':'search','${I.location}':'location','${I.trophy}':'trophy','${I.moon}':'moon','${I.sun}':'sun','${I.dotblue}':'dotblue','${I.dotorange}':'dotorange','${I.dotgreen}':'dotgreen','${I.dotpurple}':'dotpurple','${I.robot}':'robot','${I.spy}':'spy','${I.flame}':'flame','${I.link}':'link','${I.tv}':'tv','${I.box}':'box','${I.download}':'download','${I.antenna}':'antenna','${I.bulb}':'bulb','${I.crown}':'crown','${I.target}':'target','${I.arrowdown}':'arrowdown','${I.xmark}':'xmark','${I.pencil}':'pencil','${I.gear}':'gear','${I.lines}':'lines','${I.flask}':'flask','${I.broom}':'broom','${I.checksquare}':'checksquare','${I.upload}':'upload' };
function toSvg(s){
  if(!s) return s;
  return String(s).replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2B00}-\u{2BFF}]/gu, function(ch){
    if(ch==='\uFE0F') return '';
    var key = E2I[ch];
    return (key && I[key]) ? '<span class="ti">'+I[key]+'</span>' : '';
  });
}
    </script>

</head>
<body>
    <div id="toast"></div>
    <div class="dm-layer" aria-hidden="true">
        <span class="dm dm-a" style="top:9%;--dm-dur:26s;">反代就绪 · 播放继续 · 正在连接上</span>
        <span class="dm dm-b" style="top:20%;--dm-dur:31s;--dm-delay:-9s;">多后端就绪 · 推流跟随 · 共享带宽</span>
        <span class="dm dm-c" style="top:32%;--dm-dur:25s;--dm-delay:-15s;">一个入口 · 多个原始服务器</span>
        <span class="dm dm-d" style="top:45%;--dm-dur:35s;--dm-delay:-5s;">边缘缓存 · 播放继续 · 正在连接上</span>
        <span class="dm dm-e" style="top:58%;--dm-dur:23s;--dm-delay:-18s;">安全授权 · 密钥验证 · 登录即达</span>
        <span class="dm dm-a" style="top:70%;--dm-dur:30s;--dm-delay:-3s;">节点在线 · 聚合中 · 直连优先</span>
        <span class="dm dm-b" style="top:82%;--dm-dur:27s;--dm-delay:-11s;">播放继续 · 转码就绪 · 正在连接上</span>
        <span class="dm dm-c" style="top:93%;--dm-dur:33s;--dm-delay:-7s;">反代就绪 · 多后端就绪</span>
    </div>
    <div class="login-wrap">
        <div class="login-box">
            <img class="login-logo" src="${EMBY_LOGO}" alt="logo" onerror="this.style.display='none'">
            <h2>安全中心</h2>
            <p class="login-sub">请输入访问密钥以继续</p>
            <input type="password" id="tokenInput" placeholder="请输入密钥 TOKEN" onkeydown="if(event.key==='Enter') login()" autocomplete="off">
            <button onclick="login()">验 证 登 录</button>
            <p class="login-foot">登录后浏览器将记住本次授权</p>
        </div>
    </div>
    <script>
        function showToast(msg) {
            const t = document.getElementById('toast');
            t.innerHTML = toSvg(msg); t.classList.add('show');
            setTimeout(() => t.classList.remove('show'), 2000);
        }
        async function login() {
            const token = document.getElementById('tokenInput').value.trim();
            if(!token) return showToast('请输入正确的密钥');
            try {
                const r = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pass: token }) });
                const d = await r.json();
                if (d && d.success) { window.location.reload(); }
                else { showToast((d && d.error) || '密钥错误'); }
            } catch (e) { showToast('网络异常,请重试'); }
        }
    </script>

</body>
</html>
`;

const HTML_UI = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
    <title>玛卡巴卡的反代面板</title>
    <style>${CSS_COMMON}</style>
    <script src="https://cdn.jsdelivr.net/npm/sortablejs@latest/Sortable.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <link rel="icon" type="image/jpeg" href="${EMBY_LOGO}">
    <script>
const I = {
  rocket:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 16.5c-1.5 1.3-2 5-2 5s3.7-.5 5-2c.7-.8.7-2 0-2.8-.8-.7-2.2-.7-3 .8z"/><path d="M12 15l-3-3c.5-4 4-7.5 8-8 2 .2 3.8 2 4 4-.5 4-4 7.5-8 8l-1-1z"/><path d="M9 12c-2 1-3.5 3-4 5"/><circle cx="15" cy="9" r="0.5"/></svg>',
  xmark:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  check:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4L19 7"/></svg>',
  warn:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3L2 20h20L12 3z"/><path d="M12 10v4M12 17.5h.01"/></svg>',
  film:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4"/></svg>',
  star:'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3l2.7 5.7 6.3.8-4.6 4.3 1.1 6.2-5.5-3-5.5 3 1.1-6.2L3 9.5l6.3-.8L12 3z"/></svg>',
  sparkles:'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3zM18 14l.8 2.2L21 17l-2.2.8L18 20l-.8-2.2L15 17l2.2-.8L18 14zM6 14l.6 1.7L8.5 16l-1.9.7L6 18.5l-.6-1.8L3.5 16l1.9-.3L6 14z"/></svg>',
  globe:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.5 2.5 15 0 18M12 3c-2.5 2.5-2.5 15 0 18"/></svg>',
  bolt:'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M13 2L4 14h6l-1 8 9-12h-6l1-8z"/></svg>',
  refresh:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12a8 8 0 1 1-2.34-5.66"/><path d="M20 3v5h-5"/></svg>',
  chart:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M5 20V10M12 20V4M19 20v-7"/></svg>',
  cloud:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 18a4 4 0 1 1 0-8 5 5 0 0 1 9.6 1.3A3.5 3.5 0 0 1 17 18H7z"/></svg>',
  trash:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>',
  search:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>',
  location:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/></svg>',
  trophy:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 21h8M12 17v4M7 4h10v6a5 5 0 0 1-10 0V4z"/><path d="M7 5H4v2a3 3 0 0 0 3 3M17 5h3v2a3 3 0 0 1-3 3"/></svg>',
  moon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>',
  sun:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4.5"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  pencil:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>',
  gear:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M4.2 4.2l2.8 2.8M17 17l2.8 2.8M1 12h4M19 12h4M4.2 19.8L7 17M17 7l2.8-2.8"/></svg>',
  lines:'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 6h18v2H3zM3 11h18v2H3zM3 16h18v2H3z"/></svg>',
  box:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8l-9-5-9 5v8l9 5 9-5V8z"/><path d="M3 8l9 5 9-5M12 13v8"/></svg>',
  download:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M7 10l5 5 5-5M4 21h16"/></svg>',
  antenna:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6.4 2a14 14 0 0 0 0 20M17.6 2a14 14 0 0 1 0 20M9.8 5.5a9 9 0 0 0 0 13M14.2 5.5a9 9 0 0 1 0 13"/><circle cx="12" cy="12" r="1.5"/></svg>',
  bulb:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6M10 22h4M8 14.5A6 6 0 0 1 12 5a6 6 0 0 1 4 9.5c-.8.8-1 1.6-1 2.5h-6c0-.9-.2-1.7-1-2.5z"/></svg>',
  tv:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="13" rx="2"/><path d="M8 21h8M12 18v3"/></svg>',
  flame:'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2s5 4 5 9a5 5 0 0 1-10 0c0-2 1-3.5 2-5-.5 1-1 2-1 3 0 2.5 3 3 3 6 1-2 0-4 0-4 2 1 3 3 3 4.5A6.5 6.5 0 0 1 12 22 6.5 6.5 0 0 1 5.5 15C5.5 9 12 2 12 2z"/></svg>',
  link:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.07 0l2.83-2.83a5 5 0 0 0-7.07-7.07L11 4.93"/><path d="M14 11a5 5 0 0 0-7.07 0l-2.83 2.83a5 5 0 0 0 7.07 7.07L13 19.07"/></svg>',
  crown:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7l4 4 5-6 5 6 4-4-2 12H5L3 7z"/><path d="M6 19h12"/></svg>',
  target:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/></svg>',
  arrowdown:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12l7 7 7-7"/></svg>',
  robot:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="8" width="14" height="11" rx="2"/><path d="M12 8V4M8 4h8"/><circle cx="9.5" cy="13" r="1" fill="currentColor"/><circle cx="14.5" cy="13" r="1" fill="currentColor"/><path d="M2 13v3M22 13v3"/></svg>',
  spy:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="11" r="7"/><circle cx="9" cy="10" r="1" fill="currentColor"/><circle cx="15" cy="10" r="1" fill="currentColor"/><path d="M9.5 14c1 .8 4 .8 5 0"/></svg>',
  flask:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3h6M10 3v5L4.5 18a2 2 0 0 0 1.8 3h11.4a2 2 0 0 0 1.8-3L14 8V3"/><path d="M7 15h10"/></svg>',
  broom:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M13 3l8 8M11 11l8-8M4 20l7-7 1 1-7 7-2-1z"/><path d="M6 8l4 4"/></svg>',
  checksquare:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="4"/><path d="M8 12.5l2.5 2.5L16 9"/></svg>',
  upload:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15V3M7 8l5-5 5 5M4 21h16"/></svg>',
  image:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5-9 9"/></svg>',
  db:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/></svg>',
  dotblue:'<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="7" fill="#007aff"/></svg>',
  dotorange:'<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="7" fill="#ff9500"/></svg>',
  dotgreen:'<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="7" fill="#34c759"/></svg>',
  dotpurple:'<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="7" fill="#af52de"/></svg>'
};

const E2I = { '${I.rocket}':'rocket','${I.xmark}':'xmark','${I.check}':'check','${I.warn}':'warn','${I.film}':'film','${I.star}':'star','${I.sparkles}':'sparkles','${I.sparkles}':'sparkles','${I.globe}':'globe','${I.globe}':'globe','${I.bolt}':'bolt','${I.refresh}':'refresh','${I.chart}':'chart','${I.cloud}':'cloud','${I.trash}':'trash','${I.search}':'search','${I.location}':'location','${I.trophy}':'trophy','${I.moon}':'moon','${I.sun}':'sun','${I.dotblue}':'dotblue','${I.dotorange}':'dotorange','${I.dotgreen}':'dotgreen','${I.dotpurple}':'dotpurple','${I.robot}':'robot','${I.spy}':'spy','${I.flame}':'flame','${I.link}':'link','${I.tv}':'tv','${I.box}':'box','${I.download}':'download','${I.antenna}':'antenna','${I.bulb}':'bulb','${I.crown}':'crown','${I.target}':'target','${I.arrowdown}':'arrowdown','${I.xmark}':'xmark','${I.pencil}':'pencil','${I.gear}':'gear','${I.lines}':'lines','${I.flask}':'flask','${I.broom}':'broom','${I.checksquare}':'checksquare','${I.upload}':'upload' };
function toSvg(s){
  if(!s) return s;
  return String(s).replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2B00}-\u{2BFF}]/gu, function(ch){
    if(ch==='\uFE0F') return '';
    var key = E2I[ch];
    return (key && I[key]) ? '<span class="ti">'+I[key]+'</span>' : '';
  });
}
    </script>
</head>
<script>try{if(!localStorage.getItem('emby_proxy_dark')){document.body.classList.add('dark');document.documentElement.classList.add('dark')}}catch(e){}</script>
    <div id="toast"></div>
    <div class="dm-layer" aria-hidden="true">
        <span class="dm dm-a" style="top:8%;--dm-dur:26s;">节点在线 · 边缘缓存 · 播放继续</span>
        <span class="dm dm-b" style="top:18%;--dm-dur:31s;--dm-delay:-9s;">数据大屏 · 实时流量 · 热力图</span>
        <span class="dm dm-c" style="top:30%;--dm-dur:25s;--dm-delay:-15s;">反代就绪 · 推流跟随 · 多后端</span>
        <span class="dm dm-d" style="top:43%;--dm-dur:35s;--dm-delay:-5s;">保号提醒 · 申请审核 · 公告中心</span>
        <span class="dm dm-e" style="top:56%;--dm-dur:23s;--dm-delay:-18s;">一个入口 · 多个原始服务器</span>
        <span class="dm dm-a" style="top:69%;--dm-dur:30s;--dm-delay:-3s;">带宽共享 · 并发控制 · 单IP限速</span>
        <span class="dm dm-b" style="top:81%;--dm-dur:27s;--dm-delay:-11s;">播放继续 · 正在连接上 · 聚合中</span>
        <span class="dm dm-c" style="top:93%;--dm-dur:33s;--dm-delay:-7s;">转码就绪 · 直连优先 · 边缘加速</span>
    </div>
    
    <div id="dashboardModal" style="display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.6); z-index:10000; overflow-y:auto; padding: 20px; backdrop-filter: blur(5px);">
        <div class="card" style="max-width: 1000px; margin: 40px auto; position:relative; box-shadow: 0 10px 40px rgba(0,0,0,0.2);">
            <button onclick="closeDashboard()" style="position:absolute; top:20px; right:20px; font-size:24px; background:none; border:none; cursor:pointer; color: var(--text-sec); transition: 0.2s;" onmouseover="this.style.color='#ff3b30'" onmouseout="this.style.color='var(--text-sec)'">${I.xmark}</button>
            
            <h2 style="margin-top:0; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px;">
                <div style="display: flex; align-items: center; gap: 10px;">
                    ${I.chart} 数据大屏 <span style="font-size:14px; font-weight: normal; color: var(--text-sec);">精确访客画像分析</span>
                </div>
                <div style="font-size: 13px; background: rgba(0,113,227,0.1); color: var(--primary); padding: 6px 12px; border-radius: 8px; border: 1px solid rgba(0,113,227,0.2); display: flex; gap: 15px; flex-wrap: wrap;">
                    <span> 今天: <strong id="trafficToday">加载中...</strong></span>
                    <span>1周内: <strong id="traffic7d">加载中...</strong></span>
                    <span>1月内: <strong id="traffic30d">加载中...</strong></span>
                </div>
            </h2>
            
            <h3 style="margin:22px 0 12px; font-size:15px; display:flex; align-items:center; gap:6px;">${I.globe} 访问者分布 <span style="font-size:12px; color:var(--text-sec);">(近 7 天 · 国外按国家 / 国内按省份 · 拖动旋转,悬停查看详情)</span></h3>
            <div style="border:1px solid var(--border); border-radius:14px; padding:14px 16px; background:rgba(120,120,120,0.03);">
                <div style="display:flex; gap:8px; margin-bottom:12px; flex-wrap:wrap; align-items:center;">
                    <button id="geoMode3dBtn" onclick="geoSwitchMode('3d')" style="background:var(--primary); color:#fff; border:none; padding:6px 14px; border-radius:999px; font-size:12.5px; cursor:pointer;">3D 地球</button>
                    <button class="geo-mode-btn" id="geoModeWorldBtn" onclick="geoSwitchMode('world')" style="background:rgba(120,120,120,.15); color:var(--text); border:1px solid var(--border); padding:6px 14px; border-radius:999px; font-size:12.5px; cursor:pointer;">平面世界</button>
                    <button class="geo-mode-btn" id="geoModeChinaBtn" onclick="geoSwitchMode('china')" style="background:rgba(120,120,120,.15); color:var(--text); border:1px solid var(--border); padding:6px 14px; border-radius:999px; font-size:12.5px; cursor:pointer;">中国省份</button>
                    <button onclick="loadVisitorGeo()" style="background:rgba(120,120,120,.15); color:var(--text); border:1px solid var(--border); padding:6px 14px; border-radius:999px; font-size:12.5px; cursor:pointer;">刷新解析</button>
                </div>
                <div id="geoStage3d" style="position:relative; text-align:center;">
                    <canvas id="geoGlobeCanvas" style="width:min(420px,100%); height:min(420px,100%); touch-action:none;"></canvas>
                    <div id="geoGlobeTip" style="position:absolute; display:none; z-index:20; min-width:160px; padding:9px 11px; border-radius:10px; background:rgba(15,23,42,.94); color:#f8fafc; border:1px solid rgba(56,189,248,.38); font-size:12px; line-height:1.5; pointer-events:none; box-shadow:0 10px 26px rgba(0,0,0,.4);"></div>
                </div>
                <div id="geoStageWorld" style="display:none; text-align:center;">
                    <canvas id="geoWorldCanvas" style="width:100%; max-width:640px; touch-action:none;"></canvas>
                </div>
                <div id="geoStageChina" style="display:none;">
                    <div id="geoChinaChart" style="width:100%; height:420px;"></div>
                </div>
            </div>
            <div class="stat-pills" style="margin-bottom:10px;">
                <span class="stat-pill">CF请求 今天: <strong id="cfToday">加载中...</strong></span>
                <span class="stat-pill">1周内: <strong id="cfWeek">加载中...</strong></span>
                <span class="stat-pill">1月内: <strong id="cfMonth">加载中...</strong></span>
            </div>
            <div id="cfQuotaCard" style="background:linear-gradient(135deg, rgba(0,229,255,.08), rgba(124,58,237,.08)); border:1px solid var(--border); border-radius:12px; padding:14px 16px; margin-bottom:18px;">
                <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:6px;">
                    <span style="font-size:13px; font-weight:600;">CF Worker 每日免费请求额度 <span style="font-size:12px; font-weight:400; color:var(--text-sec);">(UTC 00:00 重置 · 基准 100,000 次/天)</span></span>
                    <span id="cfQuotaText" style="font-size:13px; font-weight:700; color:var(--primary);">加载中...</span>
                </div>
                <div style="height:10px; background:rgba(120,120,120,.18); border-radius:999px; margin-top:12px; overflow:hidden;">
                    <div id="cfQuotaBar" style="height:100%; width:0%; background:linear-gradient(90deg,#00e5ff,#7c3aed); border-radius:999px; transition:width .6s ease;"></div>
                </div>
                <div id="cfQuotaDetail" style="font-size:12px; color:var(--text-sec); margin-top:8px;">已用 0 次 / 10万 (0%) · 剩余 100000 次</div>
            </div>
            <div class="stat-pills" style="margin-bottom:10px;">
                <span class="stat-pill">今日带宽: <strong id="cfBandwidth">加载中...</strong></span>
                <span class="stat-pill">缓存命中: <strong id="cfCacheRatio">加载中...</strong></span>
                <span class="stat-pill">被拦截: <strong id="cfBlocked">加载中...</strong></span>
                <span class="stat-pill">5xx错误: <strong id="cf5xx">加载中...</strong></span>
            </div>
            <div style="display: flex; gap: 16px; flex-wrap: wrap; margin-bottom: 18px;">
                <div class="chart-panel" style="flex:1; min-width:260px;">
                    <div style="font-size:13px; font-weight:600; margin-bottom:8px;">今日响应状态码分布</div>
                    <canvas id="cfStatusChart" height="140"></canvas>
                </div>
                <div class="chart-panel" style="flex:1; min-width:260px;">
                    <div style="font-size:13px; font-weight:600; margin-bottom:8px;">今日请求分时趋势 (北京时间 24h)</div>
                    <canvas id="cfHourChart" height="140"></canvas>
                </div>
            </div>
            <div style="display: flex; gap: 16px; flex-wrap: wrap; margin-bottom: 18px;">
                <div class="chart-panel" style="flex:1; min-width:260px;">
                    <div style="font-size:13px; font-weight:600; margin-bottom:8px;">今日 Top 来源地区</div>
                    <div id="cfCountryList" style="font-size:12px; color:var(--text-sec);">加载中...</div>
                </div>
            </div>
            
            <div style="display: flex; gap: 20px; flex-wrap: wrap; margin-top:20px;">
                <div style="flex: 2; min-width: 300px; border: 1px solid var(--border); border-radius: 14px; padding: 16px; background: rgba(120,120,120,0.03);">
                    <canvas id="trendChart"></canvas>
                </div>
                <div style="flex: 1; min-width: 300px; border: 1px solid var(--border); border-radius: 14px; padding: 16px; background: rgba(120,120,120,0.03); display: flex; justify-content: center; align-items: center;">
                    <canvas id="locationChart"></canvas>
                </div>
            </div>
            
            <h3 style="margin-top: 30px; margin-bottom:16px;">${I.bolt} 播放热力图 <span style="font-size:12px; color:var(--text-sec);">(最近 7 天 × 24 小时,反代真实播放请求命中统计)</span></h3>
            <div id="heatmapContainer" style="border:1px solid var(--border); border-radius:14px; padding:16px; background:rgba(120,120,120,0.03); margin-bottom:20px;">
                <div id="heatmapSummary" style="font-size:12px; color:var(--text-sec); margin-bottom:10px;">加载中...</div>
                <div id="heatmapGrid" style="overflow-x:auto;"></div>
            </div>
            
            <h3 style="margin-top: 30px; margin-bottom:16px;">${I.spy} 最新独立播放记录 <span style="font-size:12px; color:var(--text-sec);">(仅拦截 PlaybackInfo 真实播放)</span></h3>
            <div class="table-wrapper">
                <table style="width: 100%;">
                    <thead><tr><th>访问时间</th><th>目标节点</th><th>真实 IP 地址</th><th>归属地</th><th>客户端/设备标识 (User-Agent)</th></tr></thead>
                    <tbody id="logTableBody"><tr><td colspan="5" style="text-align:center; padding: 30px;">加载数据中...</td></tr></tbody>
                </table>
            </div>
        </div>
    </div>

    <div class="container">
    <div id="updateAlert" class="card" style="display: none; border-left: 4px solid #34c759; background-color: rgba(52, 199, 89, 0.05); margin-top: 20px;">
            <div style="display:flex; justify-content: space-between; align-items:center; flex-wrap:wrap; gap:10px;">
                <div>
                    <h3 style="margin:0; color: #34c759; font-size: 16px;">${I.sparkles} 发现新版本！</h3>
                    <p style="margin: 5px 0 0 0; font-size: 13px; color: var(--text-sec);" id="updateMsg">当前版本: v1.0.0 | 最新版本: v?.?.?</p>
                </div>
                <button class="btn-submit" onclick="doOnlineUpdate()" id="onlineUpdateBtn" style="padding:8px 16px;border-radius:6px;">${I.rocket} 一键拉取并升级</button>
            </div>
        </div>
    <div id="cf-trace-card" style="background: rgba(120,120,120,0.05); padding: 15px 20px; border-radius: 12px; border: 1px solid var(--border); margin-bottom: 20px; display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; font-size: 14px; gap: 15px; box-shadow: inset 0 2px 4px rgba(0,0,0,0.02); margin-top: 20px;">
            <div style="display: flex; align-items: center; gap: 12px;">
                <div style="font-size: 24px;">${I.location}</div>
                <div>
                    <div style="color:var(--text-sec); font-size: 12px; margin-bottom: 2px;">访客入口 (地区与机房)</div>
                    <div id="trace-entry" style="font-weight:600; color:var(--text); font-family: monospace; font-size: 15px;">雷达扫描中...</div>
                </div>
            </div>
            <div style="display: flex; align-items: center; gap: 12px;">
                <div style="font-size: 24px;">${I.rocket}</div>
                <div>
                    <div style="color:var(--text-sec); font-size: 12px; margin-bottom: 2px;">Worker 实际落地机房</div>
                    <div id="trace-egress" style="font-weight:600; color:#34c759; font-family: monospace; font-size: 15px;">雷达扫描中...</div>
                </div>
            </div>
        </div><div class="card admin-only" style="margin-top:20px;">
            <div style="font-weight: 600; margin-bottom: 12px; font-size: 16px;">${I.gear} Worker 调度模式与区域设置</div>
            <button class="btn-submit" onclick="openPlacementModal()" style="width:100%;">${I.gear} 修改调度/区域</button>
        </div>
        <div class="content-wrap">
            <div class="topbar">
                <div class="topbar-left">
                    <img class="topbar-logo" src="${EMBY_LOGO}" alt="logo" onclick="openAccountModal()" title="账户设置" style="cursor:pointer;" onerror="this.onerror=null;this.src='data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI3MiIgaGVpZ2h0PSI3MiIgdmlld0JveD0iMCAwIDcyIDcyIj48ZGVmcz48bGluZWFyR3JhZGllbnQgaWQ9ImciIHgxPSIwIiB5MT0iMCIgeDI9IjEiIHkyPSIxIj48c3RvcCBvZmZzZXQ9IjAiIHN0b3AtY29sb3I9IiMwMGQ0ZmYiLz48c3RvcCBvZmZzZXQ9IjEiIHN0b3AtY29sb3I9IiMzZDdiZmYiLz48L2xpbmVhckdyYWRpZW50PjwvZGVmcz48cmVjdCB3aWR0aD0iNzIiIGhlaWdodD0iNzIiIHJ4PSIxNCIgZmlsbD0idXJsKCNnKSIvPjx0ZXh0IHg9IjM2IiB5PSI1MCIgZm9udC1zaXplPSIzNiIgZm9udC1mYW1pbHk9IkFyaWFsLHNhbnMtc2VyaWYiIGZvbnQtd2VpZ2h0PSI3MDAiIGZpbGw9IiNmZmYiIHRleHQtYW5jaG9yPSJtaWRkbGUiPk48L3RleHQ+PC9zdmc+'">
                    <div class="rtt-pill" title="你的设备到云端边缘节点的真实往返延迟">
                        <span class="rtt-dot" id="rttDot"></span>
                        <span class="rtt-label">RTT</span>
                        <span id="rttValue">测算中</span>
                        <button id="themeToggle" onclick="toggleDarkMode()" title="切换深色模式">${I.moon}</button>
                    </div>
                </div>
                <div class="topbar-right">
                    <button class="tb-icon-btn admin-only" id="nodeReqBtn" onclick="openNodeReqModal()" title="节点申请审核" style="position:relative; width:34px; height:34px;">${I.robot}<span id="nodeReqBadge" style="display:none; position:absolute; top:-4px; right:-4px; background:#ff3b30; color:#fff; font-size:10px; font-weight:700; border-radius:999px; padding:1px 5px; min-width:16px; text-align:center;"></span></button>
                    <button class="pill-btn" onclick="openKaCenter()" title="保活中心：实时查看执行进度与排队" style="color:#b388ff;border-color:rgba(179,136,255,.35);background:rgba(179,136,255,.14);">${I.tv}<span class="btn-txt"> 保活</span></button>
                    <button class="pill-btn" onclick="openDashboard()" title="数据统计">${I.chart}<span class="btn-txt"> 统计</span></button>
                    <button class="pill-btn" onclick="location.href='/speedtest'" title="下载测速" style="color:#4fd08a;border-color:rgba(79,208,138,.32);background:rgba(79,208,138,.12);">${I.bolt}<span class="btn-txt"> 测速</span></button>
                    <button class="pill-close" onclick="confirmLogout()" title="退出系统">${I.xmark}</button>
                </div>
            </div>

            <div class="card admin-only" style="border-left: 4px solid #ff3b30;">
                <div style="display:flex; justify-content: space-between; align-items:center; margin-bottom:12px; flex-wrap:wrap; gap:10px;">
                    <h2 style="margin:0; font-size:18px; color: #ff3b30;">${I.rocket} 手动覆盖/更新</h2>
                </div>
                <div style="display:flex; gap:10px; flex-wrap:wrap;">
                    <button class="btn-submit" onclick="openCodeModal('paste')" style="flex:1; min-width:120px;">${I.pencil} 手动输入</button>
                    <button class="btn-submit" onclick="openCodeModal('file')" style="flex:1; min-width:120px;">${I.upload} 文件导入</button>
                </div>
            </div>
            <div class="card admin-only">
                <div style="display:flex; justify-content: space-between; align-items:center; margin-bottom:16px; flex-wrap:wrap; gap:10px;">
                    <h2 style="margin:0; font-size:18px;">${I.bolt} 专属线路测速与动态 DNS 解析</h2>
                </div>
                
                <div class="collapse-sec" style="background: rgba(120,120,120,0.05); padding: 12px 16px; border-radius: 10px; border: 1px solid var(--border); margin-bottom: 16px;">
                    <div class="collapse-head" onclick="toggleCollapseSec(this)">
                        <div class="ch-title">${I.antenna} 当前域名生效的 DNS 解析：</div>
                        <span class="ch-hint" style="font-size:12px;color:var(--text-sec);">点击展开</span>
                    </div>
                    <div class="collapse-body">
                        <div id="dnsStatus" style="display: flex; gap: 8px; flex-wrap: wrap;">
                            <span style="color:#888; font-size: 14px;">加载中...</span>
                        </div>
                    </div>
                </div>

                <div class="collapse-sec" style="background: rgba(120,120,120,0.05); padding: 16px; border-radius: 12px; border: 1px solid var(--border); margin-bottom: 16px;">
                    <div class="collapse-head" onclick="toggleCollapseSec(this)">
                        <div class="ch-title"><span class="ch-arrow">▶</span><span class="ti" style="font-size:17px; color:var(--primary);">${I.chart}</span> 预设优选源 <span style="font-weight:500; font-size:12px; color:var(--text-sec);">(云枢全域 / IP大段 / IPv6 / 第三方,共 30 源)</span></div>
                        <span class="ch-hint" style="font-size:12px;color:var(--text-sec);">点击展开</span>
                    </div>
                    <div class="collapse-body">
                <div class="toolbar">
                    <select id="ipType" style="font-weight: 600; color: var(--primary); padding: 12px 16px; border: 1px solid var(--border); border-radius: 10px; background:var(--card);" onchange="updatePresetInfo()">
                        <optgroup label="综合优选">
                            <option value="all"> 综合混合源(四源并发聚合)</option>
                        </optgroup>
                        <optgroup label="云枢全域 · 三网专线">
                            <option value="ehb-all" title="https://ip.ehb.cc.cd/all?ips=100"> 云枢全域融合(双栈) · 云枢全域诸源</option>
                            <option value="ehb-cm" title="https://ip.ehb.cc.cd/cm?ips=100"> 云枢移动起飞 · 云枢移动起飞</option>
                            <option value="ehb-ct" title="https://ip.ehb.cc.cd/ct?ips=100"> 云枢电信美西 · 云枢电信美西</option>
                            <option value="ehb-cu" title="https://ip.ehb.cc.cd/cu?ips=100"> 云枢联通极速 · 云枢联通极速</option>
                        </optgroup>
                        <optgroup label="104.16.0.0/13 大段家族">
                            <option value="ehb-104" title="https://ip.ehb.cc.cd/104?ips=100"> 104 大段全域池 · 104大分类全域</option>
                            <option value="ehb-10417" title="https://ip.ehb.cc.cd/104.17?ips=100"> 104.17 移动起飞段 · 104.17移动起飞</option>
                            <option value="ehb-10419" title="https://ip.ehb.cc.cd/104.19?ips=100"> 104.19 移动抗QoS段 · 104.19防QoS</option>
                            <option value="ehb-10416" title="https://ip.ehb.cc.cd/104.16?ips=100"> 104.16 经典老牌段 · 104.16老牌广播</option>
                        </optgroup>
                        <optgroup label="162.158.0.0/15 大段家族">
                            <option value="ehb-162" title="https://ip.ehb.cc.cd/162?ips=100"> 162 大段全域池 · 162大分类全域</option>
                            <option value="ehb-162159s" title="https://ip.ehb.cc.cd/162.159-saas?ips=100"> 162.159 SaaS/DoH段 · 162.159-saas高优</option>
                            <option value="ehb-162159ct" title="https://ip.ehb.cc.cd/162.159-ct?ips=100"> 162.159 电信美西最稳段 · 162.159-ct电信美西</option>
                        </optgroup>
                        <optgroup label="172.64.0.0/13 大段家族">
                            <option value="ehb-172" title="https://ip.ehb.cc.cd/172?ips=100"> 172 大段全域池 · 172大分类全域</option>
                            <option value="ehb-17264" title="https://ip.ehb.cc.cd/172.64?ips=100"> 172.64 联通/电信主力段 · 172.64联通主力</option>
                            <option value="ehb-17267" title="https://ip.ehb.cc.cd/172.67?ips=100"> 172.67 动态反代段 · 172.67动态反代</option>
                        </optgroup>
                        <optgroup label="198 & 108 专线家族">
                            <option value="ehb-198" title="https://ip.ehb.cc.cd/198?ips=100"> 198.41 联通天花板大段 · 198联通天花板</option>
                            <option value="ehb-108" title="https://ip.ehb.cc.cd/108?ips=100"> 108.162 三网兜底大段 · 108三网兜底</option>
                        </optgroup>
                        <optgroup label="IPv6 霄汉星轨家族">
                            <option value="ehb-v6" title="https://ip.ehb.cc.cd/v6?ips=100"> 云枢 IPv6 全域星轨 · 云枢IPv6全域</option>
                            <option value="ehb-v6cm" title="https://ip.ehb.cc.cd/v6-cm?ips=100"> 云枢移动 5G 直连 · 云枢移动5G</option>
                            <option value="ehb-v6ct" title="https://ip.ehb.cc.cd/v6-ct?ips=100"> 云枢电信 纯净美西 · 云枢电信美西v6</option>
                            <option value="ehb-v6cu" title="https://ip.ehb.cc.cd/v6-cu?ips=100"> 云枢联通 欧洲/东京 · 云枢联通欧洲v6</option>
                            <option value="ehb-2400" title="https://ip.ehb.cc.cd/2400?ips=100"> 2400:cb00 亚太全域 · 2400亚太全域</option>
                            <option value="ehb-24002048" title="https://ip.ehb.cc.cd/2400.2048?ips=100"> 2400.2048 香港近场段 · 2400.2048香港近场</option>
                            <option value="ehb-2400400" title="https://ip.ehb.cc.cd/2400.400?ips=100"> 2400.400 亚太低跳数段 · 2400.400亚太低跳</option>
                            <option value="ehb-24002049" title="https://ip.ehb.cc.cd/2400.2049?ips=100"> 2400.2049 亚太抗抖动段 · 2400.2049抗抖动</option>
                            <option value="ehb-2606" title="https://ip.ehb.cc.cd/2606?ips=100"> 2606:4700 全球主干 · 2606全球主干</option>
                            <option value="ehb-26063030" title="https://ip.ehb.cc.cd/2606.3030?ips=100"> 2606.3030 核心骨干段 · 2606.3030核心骨干</option>
                            <option value="ehb-26064700" title="https://ip.ehb.cc.cd/2606.4700?ips=100"> 2606.4700 伴生特权段 · 2606.4700特权伴生</option>
                            <option value="ehb-2a06" title="https://ip.ehb.cc.cd/2a06?ips=100"> 2a06:98c0 欧洲特快大段 · 2a06欧洲特快</option>
                        </optgroup>
                        <optgroup label="第三方备用源">
                            <option value="robberer" title="https://gh.xxooo.cf/https://raw.githubusercontent.com/hc990275/yx/refs/heads/main/cfyxip.txt"> @robberer 专属 · @robberer</option>
                            <option value="cm-ct" title="https://cf.090227.xyz/ct?ips=100"> CM佬电信优选 · CM佬电信优选</option>
                            <option value="cm-cmcc" title="https://cf.090227.xyz/cmcc?ips=100"> CM佬移动优选 · CM佬移动优选</option>
                            <option value="cm-cu" title="https://cf.090227.xyz/cu?ips=100"> CM佬联通优选 · CM佬联通优选</option>
                            <option value="v2too" title="https://ip.v2too.top/api/nodes"> v2too 源 · v2too默认源</option>
                        </optgroup>
                    </select>
                </div>

                    <div class="btn-grid" style="margin-bottom:16px;">
                        <button class="btn-submit" id="btnFetchRemote" onclick="fetchRemoteAndTest()">提取预设源测速</button>
                        <button class="btn-submit" onclick="batchTcpPing()" style=" box-shadow: 0 4px 12px rgba(255, 149, 0, 0.2);">复制去ITDog</button>
                        <button class="btn-submit" onclick="clearTest()" style=" box-shadow: 0 4px 12px rgba(142, 142, 147, 0.2);">清空列表</button>
                    </div>

                <div id="presetInfo" style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 16px; padding: 10px 14px; background: var(--card); border-radius: 10px; border: 1px solid var(--border);">
                    <span style="font-size: 12px; color: var(--text-sec);">当前来源:</span>
                    <span id="presetName" style="font-weight: 700; font-size: 13px; color: var(--primary);">综合混合源(四源并发)</span>
                    <code id="presetUrl" style="font-size: 12px; color: var(--text); word-break: break-all; cursor: pointer; text-decoration: underline dotted;" onclick="copyPresetUrl()">uouin + cf-speed-dns + 164746 + wetest 并发聚合</code>
                </div>
                    </div>
                </div>
                <div class="collapse-sec" style="background: rgba(120,120,120,0.05); padding: 16px; border-radius: 12px; border: 1px solid var(--border); margin-bottom: 16px;">
                    <div class="collapse-head" onclick="toggleCollapseSec(this)">
                        <div class="ch-title"><span class="ch-arrow">▶</span><span class="ti" style="font-size:17px; color:var(--primary);">${I.flask}</span> 自定义 API 与 DNS 应用</div>
                        <span class="ch-hint" style="font-size:12px;color:var(--text-sec);">点击展开</span>
                    </div>
                    <div class="collapse-body">
                    <div style="display: flex; gap: 8px; margin-bottom: 12px; align-items: center; flex-wrap: wrap;">
                        <input type="text" id="customApiUrl" value="https://ip.v2too.top/api/nodes" placeholder="填入自定义 JSON 或 文本 API 链接" style="flex: 1; min-width: 200px; padding: 12px 14px; border-radius: 10px; border: 1px solid var(--border); background:var(--card);">
                    </div>

                    <textarea id="customIps" rows="2" placeholder="在此粘贴自定义 IPv4、IPv6 或 优选域名 (支持混杂文本，自动提取)" style="width: 100%; padding: 14px; border-radius: 10px; border: 1px solid var(--border); margin-bottom: 12px; font-family: monospace; resize: vertical; background:var(--card);"></textarea>
                    
                    <div class="btn-grid cols-5">
                        <button class="btn-submit" id="btnFetchCustomApi" onclick="fetchCustomApiAndTest()" style=" box-shadow: 0 4px 12px rgba(50, 173, 230, 0.2);">${I.globe} 拉取API并测速</button>
                        <button class="btn-submit" id="btnTestCustom" onclick="testCustomIPs()" style=" box-shadow: 0 4px 12px rgba(88, 86, 214, 0.2);">${I.flask} 测试粘贴节点</button>
                        <button class="btn-submit" id="btnDirectCname" onclick="directSubmitCname()" style=" box-shadow: 0 4px 12px rgba(175, 82, 222, 0.2);">直推CNAME</button>
                        <button class="btn-submit" id="btnTop3Dns" onclick="updateTop3ToDns()" style=" box-shadow: 0 4px 12px rgba(255, 45, 85, 0.2);">更新TOP3至DNS</button>
                        <button class="btn-submit" id="btnSelectedDns" onclick="updateSelectedToDns()" style=" box-shadow: 0 4px 12px rgba(52, 199, 89, 0.2);">提交选中至DNS</button>
                    </div>
                    </div>
                </div>
                
                <div id="statusText" style="line-height: 1.6; font-size: 14px; color: var(--text-sec); margin-bottom: 16px; padding: 12px 16px; background: rgba(52, 199, 89, 0.1); border-radius: 10px; border-left: 4px solid #34c759;">
                    ${I.bulb} 测速完成后，可勾选复选框自由组合，点击【提交选中节点至 DNS】自动分发。
                </div>

                <div class="table-wrapper">
                    <table style="width: 100%;">
                        <thead>
                            <tr>
                                <th style="width: 40px; text-align: center;"><input type="checkbox" id="selectAll" class="ip-checkbox" onclick="toggleSelectAll()"></th>
                                <th>专属节点 (点击复制)</th>
                                <th>预估延迟</th>
                                <th>连通状态</th>
                                <th>记录类型/归属地</th>
                                <th>单节点操作</th>
                            </tr>
                        </thead>
                        <tbody id="testTableBody">
                            <tr><td colspan="6" style="text-align:center;color:var(--text-sec);">暂无数据，请拉取节点或输入自定义 IP/域名 测试</td></tr>
                        </tbody>
                    </table>
                </div>
            </div>
            
            <div class="card admin-only" id="ipguard-card">
                <h2 style="margin:0; font-size:18px; margin-bottom:14px; cursor:pointer; display:flex; align-items:center; justify-content:space-between;" onclick="toggleIpGuardCard()">${I.spy} IP 访问控制 <span id="ipguardCardArrow" style="font-size:12px; color:var(--text-sec); font-weight:400;">▶ 展开</span></h2>
                <div id="ipguardCardBody" style="display:none;">
                    <div style="display:flex; flex-direction:column; gap:12px;">
                    <div style="display:flex; gap:16px; align-items:center; flex-wrap:wrap; font-size:13px;">
                        <label style="display:flex; align-items:center; gap:5px; cursor:pointer;"><input type="radio" name="ipgMode" value="off" style="accent-color:var(--primary);"> 关闭</label>
                        <label style="display:flex; align-items:center; gap:5px; cursor:pointer;"><input type="radio" name="ipgMode" value="whitelist" style="accent-color:var(--primary);"> 白名单</label>
                        <label style="display:flex; align-items:center; gap:5px; cursor:pointer;"><input type="radio" name="ipgMode" value="blacklist" style="accent-color:var(--primary);"> 黑名单</label>
                        <span style="color:var(--text-sec); font-size:12px;">白名单=仅命中放行；黑名单=命中跳转</span>
                    </div>
                    <div style="display:flex; align-items:center; gap:8px; font-size:13px; color:var(--text-sec); flex-wrap:wrap;">
                        当前访问: <span id="ipgCurrent" style="font-weight:600; color:var(--text);">-</span>
                        <button class="btn-submit" style="padding:5px 10px; font-size:12px; border-radius:6px; box-shadow:none; background:#32ade6;" onclick="ipgAddCurrent()">加入 IP 列表</button>
                    </div>
                    <textarea id="ipgIps" rows="4" placeholder="IP / 网段，每行一个，支持 CIDR，如：&#10;1.2.3.4&#10;5.6.7.0/24" style="width:100%; padding:10px 12px; border:1px solid var(--border); border-radius:8px; background:var(--card); font-size:13px; box-sizing:border-box; resize:vertical;"></textarea>
                    <textarea id="ipgCountries" rows="2" placeholder="国家/地区码，每行一个 ISO 两位码，如 US、RU、CN（支持整体封锁国家）&#10;多个国家可换行，也可用逗号/顿号/空格分隔，如：US,RU,CN" style="width:100%; padding:10px 12px; border:1px solid var(--border); border-radius:8px; background:var(--card); font-size:13px; box-sizing:border-box; resize:vertical;"></textarea>
                    <input type="text" id="ipgRedirect" placeholder="跳转网址（被拦截时 302 跳转，如 https://example.com）" style="width:100%; padding:10px 12px; border:1px solid var(--border); border-radius:8px; background:var(--card); font-size:13px; box-sizing:border-box;">
                    <div style="font-size:12px; color:var(--text-sec); line-height:1.7;">
                        命中判定：IP 命中或国家命中即算命中。白名单模式下请先确认当前 IP 已加入列表，否则保存后你自己也会被跳转；黑名单模式下列表内 IP/国家访问面板与节点链接都会被 302 跳转到上面的网址。
                    </div>
                    <div style="border-top:1px dashed var(--border); padding-top:12px; margin-top:4px; display:flex; flex-direction:column; gap:8px;">
                        <div style="font-size:13px; font-weight:600;">最高白名单(/entry 登录 IP,任何模式都放行)</div>
                        <div style="font-size:12px; color:var(--text-sec); line-height:1.6;">登录 /entry 成功的 IP 自动加入。共享节点的其他 IP 可在此删除;删除当前访问 IP 后如被拦截,用 /entry 登录会自动加回。修改后点击下方保存生效。</div>
                        <div id="ipgTrustedList" style="display:flex; flex-direction:column; gap:4px;"></div>
                        <div style="display:flex; gap:8px; align-items:center;">
                            <input type="text" id="ipgTrustedAdd" placeholder="输入要添加的 IP" style="flex:1; padding:8px 10px; border:1px solid var(--border); border-radius:8px; background:var(--card); font-size:13px; box-sizing:border-box;">
                            <button class="btn-submit" style="padding:6px 12px; font-size:12px; border-radius:6px; box-shadow:none; background:#32ade6;" onclick="ipgTrustedAddOne()">添加</button>
                        </div>
                    </div>
                    <div style="border-top:1px dashed var(--border); padding-top:12px; margin-top:4px; display:flex; flex-direction:column; gap:8px;">
                        <div style="font-size:13px; font-weight:600; color:#ff6b6b;">🚫 最高黑名单(任何模式都拦截)</div>
                        <div style="font-size:12px; color:var(--text-sec); line-height:1.6;">加入的 IP/网段无论当前是什么模式都会被拦截，优先于最高白名单；下方可单独设置 302 跳转链接（不设置则显示「你的 IP 已被拉黑」页面）。</div>
                        <textarea id="ipgBlockedIps" rows="3" placeholder="IP / 网段，每行一个，支持 CIDR，如：&#10;1.2.3.4&#10;5.6.7.0/24" style="width:100%; padding:10px 12px; border:1px solid var(--border); border-radius:8px; background:var(--card); font-size:13px; box-sizing:border-box; resize:vertical;"></textarea>
                        <input type="text" id="ipgBlockedRedirect" placeholder="302 跳转链接（留空=显示「你的 IP 已被拉黑」页，如 https://example.com）" style="width:100%; padding:10px 12px; border:1px solid var(--border); border-radius:8px; background:var(--card); font-size:13px; box-sizing:border-box;">
                    </div>
                    <button class="btn-submit" onclick="saveIpGuard()" style="align-self:flex-start;">${I.check} 保存</button>
                    </div>
                </div>
            </div>

            <div class="card admin-only" id="config-backup-card">
                <h2 style="margin:0; font-size:18px; margin-bottom:14px;">${I.box} 配置备份与恢复</h2>
                <div style="display:flex; gap:10px; flex-wrap:wrap;">
                    <button class="btn-submit" onclick="exportConfig()">${I.box} 导出配置</button>
                    <button class="btn-submit" onclick="importConfig()">${I.download} 导入配置</button>
                </div>
            </div>

            <div class="card admin-only" id="deploy-card">
                <div style="display:flex; justify-content: space-between; align-items:center; gap:10px; flex-wrap:wrap;">
                    <h2 style="margin:0; font-size:18px;">${I.rocket} 反代节点</h2>
                    <button class="btn-submit" onclick="openNodeModal()">${I.plus} 添加节点</button>
                </div>
            </div>

            <div id="nodeModal" style="display:none; position:fixed; inset:0; z-index:11000; background:rgba(0,0,0,.5); backdrop-filter:blur(5px); overflow-y:auto; -webkit-overflow-scrolling:touch; padding:max(16px, env(safe-area-inset-top)) 16px max(24px, env(safe-area-inset-bottom));">
                <div style="max-width:680px; margin:24px auto; background:var(--card); border-radius:18px; padding:22px; box-shadow:0 10px 40px rgba(0,0,0,.2);">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px;">
                        <h2 id="nodeModalTitle" style="margin:0; font-size:19px; display:flex; align-items:center; gap:8px;">${I.pencil} 添加节点</h2>
                        <button onclick="closeNodeModal()" style="background:transparent;border:none;cursor:pointer;color:var(--text-sec);display:inline-flex;padding:4px;">${I.xmark}</button>
                    </div>
                    <form id="addForm" style="display: flex; flex-direction: column; gap: 16px;">
                    <div style="display: flex; gap: 12px; flex-wrap: wrap;">
                        <input type="hidden" id="oldPrefix" value="">
                        <input type="text" id="remark" placeholder="节点备注 (如: Misaka服)" style="padding: 12px 16px; border: 1px solid var(--border); border-radius: 10px; background:var(--card); flex: 1;" required>
                        <input type="text" id="prefix" placeholder="短路径后缀 (如: misaka)" oninput="chkReservedSuffix(this)" style="padding: 12px 16px; border: 1px solid var(--border); border-radius: 10px; background:var(--card); flex: 1;" required>
                        <div id="prefixReservedTip" style="display:none; color:#ff3b30; font-size:12px; width:100%;">该后缀已被系统保留占用（如 entry），请更换</div>
                        <select id="mode" style="padding: 12px 16px; border: 1px solid var(--border); border-radius: 10px; background:var(--card); flex: 1;" onchange="toggleCustomParams()">
                            <option value="off">保守 (抹除IP)</option>
                            <option value="realip_only">严格 (透传IP)</option>
                            <option value="dual">兼容 (双重透传)</option>
                            <option value="strict">强力 (防403)</option>
                            <option value="off_fake">保守 + 伪装 (隐藏IP)</option>
                            <option value="realip_only_fake">严格 + 伪装 (透传单IP)</option>
                            <option value="dual_fake">兼容 + 伪装 (透传双IP)</option>
                            <option value="strict_fake">强力 + 伪装 (防403)</option>
                        </select>
                    </div>

                    <div id="customParamsDiv" style="display: none; gap: 12px; flex-wrap: wrap; background: rgba(120,120,120,0.05); padding: 16px; border-radius: 10px; border: 1px solid var(--border);">
                        <div style="width: 100%; display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 4px; align-items: center;">
                            <span style="font-size: 13px; font-weight: 600; color: var(--text-sec);">快速填入预设模板：</span>
                            <button type="button" class="btn-submit" style="padding: 6px 12px; font-size: 12px; border-radius: 6px; background: #32ade6; box-shadow: none;" onclick="applyFakeTemplate('senplayer')">SenPlayer</button>
                            <button type="button" class="btn-submit" style="padding: 6px 12px; font-size: 12px; border-radius: 6px; background: #5856d6; box-shadow: none;" onclick="applyFakeTemplate('eplayerx')">EplayerX</button>
                            <button type="button" class="btn-submit" style="padding: 6px 12px; font-size: 12px; border-radius: 6px; background: #af52de; box-shadow: none;" onclick="applyFakeTemplate('forward')">Forward</button>
                            <button type="button" class="btn-submit" style="padding: 6px 12px; font-size: 12px; border-radius: 6px; background: #00c7be; box-shadow: none;" onclick="applyFakeTemplate('rex')">Rex</button>
                            <button type="button" class="btn-submit" style="padding: 6px 12px; font-size: 12px; border-radius: 6px; background: #34c759; box-shadow: none;" onclick="applyFakeTemplate('hills')">Hills</button>
                            <button type="button" class="btn-submit" style="padding: 6px 12px; font-size: 12px; border-radius: 6px; background: #ff9500; box-shadow: none;" onclick="applyFakeTemplate('yamby')">Yamby</button>
                            <div style="flex-grow: 1;"></div>
                            <button type="button" class="btn-submit" style="padding: 6px 12px; font-size: 12px; border-radius: 6px; background: #8e8e93; box-shadow: none;" onclick="applyFakeTemplate('clear')">清空</button>
                        </div>
                        <div style="width: 100%; font-size: 12px; color: var(--text-sec); margin-bottom: 4px;">深度替换 Header 及 URL 参数，防止双重设备记录暴露真实身份。</div>
                        <input type="text" id="customClient" placeholder="Client (如: Forward)" style="flex: 1; min-width: 150px; padding: 12px 16px; border: 1px solid var(--border); border-radius: 8px; background:var(--card);">
                        <input type="text" id="customVersion" placeholder="Version (如: 1.3.15)" style="flex: 1; min-width: 150px; padding: 12px 16px; border: 1px solid var(--border); border-radius: 8px; background:var(--card);">
                        <input type="text" id="customDevice" placeholder="Device (如: iPhone)" style="flex: 1; min-width: 150px; padding: 12px 16px; border: 1px solid var(--border); border-radius: 8px; background:var(--card);">
                        <input type="text" id="customUa" placeholder="User-Agent (伪装 UA)" style="flex: 1; min-width: 250px; padding: 12px 16px; border: 1px solid var(--border); border-radius: 8px; background:var(--card);">
                        <div style="width: 100%; display: flex; gap: 8px; align-items: center;">
                            <input type="text" id="customDeviceId" placeholder="Device ID（设备唯一标识，留空自动生成）" style="flex: 1; min-width: 250px; padding: 12px 16px; border: 1px solid var(--border); border-radius: 8px; background:var(--card);">
                            <button type="button" class="btn-submit" style="padding: 8px 14px; font-size: 12px; border-radius: 6px; background: #8e8e93; box-shadow: none;" onclick="document.getElementById('customDeviceId').value = genUuid()">随机生成</button>
                        </div>
                    </div>

                    <div id="emosFields" style="display:none; gap:12px; flex-wrap:wrap; background: rgba(56,120,255,0.06); padding:16px; border-radius:10px; border:1px solid rgba(56,120,255,0.25);">
                        <div style="width:100%; font-size:12px; color:var(--text-sec); line-height:1.7;">EMOS 模式按 emos.dpdns.org/proxy 要求：自动透传真实 IP(X-Forwarded-For) + 携带两枚 EMOS 头；默认已内置你的 EMOS 身份，可直接使用也可修改；目标地址填 EMOS 源站（建议 https://video.emos.best，对外路径 /emby）。开启聚合后，聚合播放器(SenPlayer 等)按 TMDB 编号跨服查询时会把本节点列为播放源。</div>
                        <div style="display:flex; gap:12px; flex-wrap:wrap;">
                            <input type="text" id="nodeEmosId" value="eK3QYG29Ms" placeholder="EMOS-PROXY-ID（你的用户ID，形如 eABCDEFGHs）" style="flex:1; min-width:160px; padding:10px 14px; border:1px solid var(--border); border-radius:8px; background:var(--card);">
                            <input type="text" id="nodeEmosName" value="玛卡巴卡的反代面板" placeholder="EMOS-PROXY-NAME（你的称号，如 @xx的反代）" style="flex:1; min-width:160px; padding:10px 14px; border:1px solid var(--border); border-radius:8px; background:var(--card);">
                        </div>
                        <label style="display:flex; align-items:center; gap:8px; font-size:14px; font-weight:500; cursor:pointer;">
                            <input type="checkbox" id="nodeEmosAggregate" class="ip-checkbox"> 开启 EMOS 聚合（让聚合播放器按 TMDB 编号跨服查询时，把本节点列为播放源）
                        </label>
                    </div>
                    <div id="kaConfigDiv" style="display: flex; flex-direction: column; gap: 10px; background: rgba(52,199,89,0.05); padding: 16px; border-radius: 10px; border: 1px solid rgba(52,199,89,0.2);">
                        <div style="width: 100%; display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
                            <label style="display:flex; align-items:center; gap:8px; font-size:14px; font-weight:600; cursor:pointer;">
                                <input type="checkbox" id="kaEnabled" class="ip-checkbox"> 开启自动保活
                            </label>
                            <span style="font-size:12px; color:var(--text-sec);">防止上游线路/账号被回收，到期间隔自动模拟播放一次</span>
                        </div>
                        <input type="number" id="kaDays" placeholder="保活间隔（天，可填小数如 0.5 / 3 / 14）" step="0.1" min="0.1" style="padding: 10px 14px; border: 1px solid var(--border); border-radius: 8px; background: var(--card); width: 100%;">
                        <input type="text" id="kaToken" placeholder="上游 API Key（选填，填了优先用它保活）" style="padding: 10px 14px; border: 1px solid var(--border); border-radius: 8px; background: var(--card); width: 100%;">
                        <div style="display: flex; gap: 10px; flex-wrap: wrap;">
                            <input type="text" id="nodeUser" placeholder="节点账号（保活 / Rex导入用）" style="flex:1; min-width: 160px; padding: 10px 14px; border: 1px solid var(--border); border-radius: 8px; background: var(--card);">
                            <input type="password" id="nodePass" placeholder="节点密码" style="flex:1; min-width: 160px; padding: 10px 14px; border: 1px solid var(--border); border-radius: 8px; background: var(--card);">
                        </div>
                        <div style="font-size:12px; color:var(--text-sec);">自动保活按各节点自己的间隔独立计时（无需统一）。不配 Cron 也能生效：有人访问面板/代理时自动检查并执行到期的节点；配 Cron 触发器（如每天 */5 * * * *）则无人访问时也能按时执行，两者可同时用。也可点节点卡片「保活」手动触发。绑定 Durable Objects（变量名 KEEPALIVE_DO、类名 KeepAliveDO）后模拟播放为完整 90~390 秒真实心跳（按片长比例）；未绑定则降级为 20~25 秒。</div>
                    </div>
                    <input type="number" id="watchLimit" placeholder="观看下限（天，如 7 / 14 / 21；0 = 不限制。超过下限未观看会在卡片红色报警）" step="0.1" min="0" style="padding: 10px 14px; border: 1px solid var(--border); border-radius: 8px; background: var(--card); width: 100%;">

                    <div style="display: flex; gap: 12px; flex-wrap: wrap; align-items: center;">
                        <div style="position: relative; flex: 2; display: flex;">
                            <div style="display:flex; gap:10px; align-items:center; background:var(--card); padding:10px 16px; border-radius:10px; border:1px solid var(--border); flex: 1; cursor: pointer; transition:0.2s;" onclick="toggleIconPicker(event)" id="iconSelectBtn">
                                <img id="iconPreview" src="" style="width:24px;height:24px;display:none;border-radius:4px;object-fit:cover;">
                                <span id="iconDefault" style="font-size:20px;line-height:1;">${I.film}</span>
                                <span id="iconSelectText" style="flex:1; color: var(--text-sec); font-size:14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">点击选择图标 (默认)</span>
                                <input type="hidden" id="iconUrl" value="">
                            </div>
                            
                            <div id="iconPickerPanel" style="display:none; position: absolute; top: 100%; left: 0; width: 100%; background: var(--card); border: 1px solid var(--border); border-radius: 10px; padding: 12px; box-shadow: 0 10px 30px rgba(0,0,0,0.15); z-index: 100; margin-top: 8px; flex-direction: column; gap: 10px;">
                                <div style="display: flex; gap: 8px; align-items: center; margin-bottom: 4px;">
                                    <input type="text" id="customIconUrlInput" placeholder="输入自定义 JSON 图标库链接..." style="flex: 1; padding: 8px 10px; border: 1px solid var(--border); border-radius: 8px; background:var(--bg); font-size: 13px; color: var(--text);">
                                    <button type="button" onclick="setCustomIconLibrary()" style="padding: 8px 12px; background: var(--primary); color: white; border: none; border-radius: 8px; cursor: pointer; font-size: 13px; white-space: nowrap;">加载</button>
                                    <button type="button" onclick="resetIconLibrary()" class="btn-ghost">默认库</button>
                                </div>
                                <input type="text" id="iconSearch" placeholder="搜索图标名称..." style="padding: 10px 12px; border: 1px solid var(--border); border-radius: 8px; background:var(--bg); width: 100%; font-size: 14px; color: var(--text);" onkeyup="filterIcons()">
                                <div id="iconGrid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(44px, 1fr)); gap: 8px; overflow-y: auto; max-height: 240px; padding-right: 4px;">
                                    <div style="text-align:center; color:var(--text-sec); grid-column: 1 / -1; font-size: 13px;">加载图标库中...</div>
                                </div>
                            </div>
                        </div>
                        <label style="display:flex; align-items:center; gap:8px; font-size:14px; font-weight:500; cursor:pointer;">
                            <input type="checkbox" id="nodeCache" class="ip-checkbox" checked>
                            开启海报及静态资源缓存
                        </label>
                        <label style="display:flex; align-items:center; gap:8px; font-size:14px; font-weight:500; cursor:pointer; margin-top:8px;">
                            <input type="checkbox" id="nodeDlTrick" class="ip-checkbox">
                            下载伪装：显示下载按钮 + 下载请求伪装为缓存流（绕过服务端禁下载）
                        </label>
                        <button type="submit" id="submitBtn" class="btn-submit" style="flex: 1; padding: 14px 20px;">保存部署</button>
                    </div>

                    <div style="background: rgba(120,120,120,0.05); border: 1px solid var(--border); border-radius: 10px; padding: 16px;">
                        <div style="font-size: 14px; font-weight: 600; color: var(--text-sec); margin-bottom: 12px;">服务器线路配置 (支持魔改分离版推流，支持无限条备用线路)</div>
                        <div id="targetInputs" style="display: flex; flex-direction: column; gap: 10px;">
                            <input type="url" class="target-input" placeholder="主线路地址 (如: http://1.1.1.1:8096)" style="padding: 12px 16px; border: 1px solid var(--border); border-radius: 8px; background:var(--card); width: 100%;" required oninput="handleTargetInputs()">
                            <input type="url" class="target-input" placeholder="备用线路 1 (选填，主源挂掉时触发)" style="padding: 12px 16px; border: 1px solid var(--border); border-radius: 8px; background:var(--card); width: 100%;" oninput="handleTargetInputs()">
                        </div>
                    </div>
                </form>
                </div>
            </div>

            <div id="kaModal" style="display:none; position:fixed; inset:0; z-index:11020; background:rgba(0,0,0,.5); backdrop-filter:blur(5px); overflow-y:auto; -webkit-overflow-scrolling:touch; padding:max(16px, env(safe-area-inset-top)) 16px max(24px, env(safe-area-inset-bottom));">
                <div style="max-width:480px; margin:24px auto; background:var(--card); border-radius:18px; padding:22px; box-shadow:0 10px 40px rgba(0,0,0,.2);">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px;">
                        <h2 style="margin:0; font-size:19px; display:flex; align-items:center; gap:8px;">${I.bolt} 节点保活</h2>
                        <button onclick="closeKaModal()" style="background:transparent;border:none;cursor:pointer;color:var(--text-sec);display:inline-flex;padding:4px;">${I.xmark}</button>
                    </div>
                    <div id="kaResultBox" style="font-size:13px; line-height:1.8;"></div>
                </div>
            </div>

            <div id="kaCenterModal" style="display:none; position:fixed; inset:0; z-index:11030; background:rgba(0,0,0,.55); backdrop-filter:blur(6px); overflow-y:auto; -webkit-overflow-scrolling:touch; padding:max(16px, env(safe-area-inset-top)) 16px max(24px, env(safe-area-inset-bottom));">
                <div style="max-width:640px; margin:24px auto; background:var(--card); border-radius:18px; padding:22px; box-shadow:0 10px 40px rgba(0,0,0,.25);">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px;">
                        <h2 style="margin:0; font-size:19px; display:flex; align-items:center; gap:8px;">${I.bolt} 保活中心</h2>
                        <button onclick="closeKaCenter()" style="background:transparent;border:none;cursor:pointer;color:var(--text-sec);display:inline-flex;padding:4px;">${I.xmark}</button>
                    </div>
                    <div id="kaCenterBody" style="font-size:13px; line-height:1.7; min-height:120px;">加载中...</div>
                </div>
            </div>

            <div id="kaDetailModal" style="display:none; position:fixed; inset:0; z-index:11035; background:rgba(0,0,0,.5); backdrop-filter:blur(5px); overflow-y:auto; -webkit-overflow-scrolling:touch; padding:max(16px, env(safe-area-inset-top)) 16px max(24px, env(safe-area-inset-bottom));">
                <div style="max-width:520px; margin:24px auto; background:var(--card); border-radius:18px; padding:22px; box-shadow:0 10px 40px rgba(0,0,0,.2);">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px;">
                        <h2 style="margin:0; font-size:18px; display:flex; align-items:center; gap:8px;">${I.bolt} 保活详情</h2>
                        <button onclick="closeKaDetail()" style="background:transparent;border:none;cursor:pointer;color:var(--text-sec);display:inline-flex;padding:4px;">${I.xmark}</button>
                    </div>
                    <div id="kaDetailBody" style="font-size:13px; line-height:1.7;">…</div>
                </div>
            </div>

            <div id="rexModal" style="display:none; position:fixed; inset:0; z-index:11020; background:rgba(0,0,0,.5); backdrop-filter:blur(5px); overflow-y:auto; -webkit-overflow-scrolling:touch; padding:max(16px, env(safe-area-inset-top)) 16px max(24px, env(safe-area-inset-bottom));">
                <div style="max-width:480px; margin:24px auto; background:var(--card); border-radius:18px; padding:22px; box-shadow:0 10px 40px rgba(0,0,0,.2);">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px;">
                        <h2 style="margin:0; font-size:19px; display:flex; align-items:center; gap:8px;">${I.box} 一键导入 Rex</h2>
                        <button onclick="closeRexModal()" style="background:transparent;border:none;cursor:pointer;color:var(--text-sec);display:inline-flex;padding:4px;">${I.xmark}</button>
                    </div>
                    <div style="font-size:13px; color:var(--text-sec); margin-bottom:12px; line-height:1.6;">在 Rex 播放器里用「链接导入」粘贴链接，或直接点「打开导入」唤起 Rex。凭据默认取节点保活账号，可修改。</div>
                    <div style="display:flex; flex-direction:column; gap:10px;">
                        <input type="text" id="rexPrefix" placeholder="节点前缀" oninput="renderRexLink()" style="padding:10px 14px; border:1px solid var(--border); border-radius:8px; background:var(--bg); font-size:14px;">
                        <div style="display:flex; gap:10px;">
                            <input type="text" id="rexUser" placeholder="账号" oninput="renderRexLink()" style="flex:1; padding:10px 14px; border:1px solid var(--border); border-radius:8px; background:var(--bg); font-size:14px;">
                            <input type="text" id="rexPass" placeholder="密码" oninput="renderRexLink()" style="flex:1; padding:10px 14px; border:1px solid var(--border); border-radius:8px; background:var(--bg); font-size:14px;">
                        </div>
                        <input type="text" id="rexLink" readonly style="padding:10px 14px; border:1px solid var(--border); border-radius:8px; background:var(--bg); font-size:11px; word-break:break-all;">
                        <div style="display:flex; gap:10px; justify-content:flex-end;">
                            <button type="button" class="btn-ghost" onclick="copyRexLink()">复制链接</button>
                            <button type="button" class="btn-submit" onclick="openRexLink()">打开导入</button>
                        </div>
                    </div>
                </div>
            </div>

            <div id="codeModal" style="display:none; position:fixed; inset:0; z-index:11010; background:rgba(0,0,0,.5); backdrop-filter:blur(5px); overflow-y:auto; -webkit-overflow-scrolling:touch; padding:max(16px, env(safe-area-inset-top)) 16px max(24px, env(safe-area-inset-bottom));">
                <div style="max-width:560px; margin:24px auto; background:var(--card); border-radius:18px; padding:22px; box-shadow:0 10px 40px rgba(0,0,0,.2);">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px;">
                        <h2 id="codeModalTitle" style="margin:0; font-size:19px; display:flex; align-items:center; gap:8px;">${I.rocket} 手动覆盖/更新</h2>
                        <button onclick="closeCodeModal()" style="background:transparent;border:none;cursor:pointer;color:var(--text-sec);display:inline-flex;padding:4px;">${I.xmark}</button>
                    </div>
                    <div style="font-size:13px; color:#ff3b30; margin-bottom:12px;">${I.warn} 警告：提交错误的代码会导致面板瞬间崩溃（500 错误）。请确保代码已在本地测试通过！</div>
                    <textarea id="codeArea" rows="8" placeholder="在此处粘贴修改好的最新代码全文..." style="width:100%; padding:14px; border-radius:10px; border:1px solid var(--border); margin-bottom:12px; font-family:monospace; resize:vertical; background:var(--bg); font-size:12px;"></textarea>
                    <input type="file" id="fileInput" accept=".js" style="display:none; font-size:14px; padding:6px; border:1px solid var(--border); border-radius:6px; background:var(--bg); margin-bottom:12px; width:100%;">
                    <button class="btn-danger" id="deployBtn" onclick="deployWorker()" style="width:100%;">${I.flame} 覆盖更新</button>
                </div>
            </div>

            <div id="placementModal" style="display:none; position:fixed; inset:0; z-index:11010; background:rgba(0,0,0,.5); backdrop-filter:blur(5px); overflow-y:auto; -webkit-overflow-scrolling:touch; padding:max(16px, env(safe-area-inset-top)) 16px max(24px, env(safe-area-inset-bottom));">
                <div style="max-width:560px; margin:24px auto; background:var(--card); border-radius:18px; padding:22px; box-shadow:0 10px 40px rgba(0,0,0,.2);">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px;">
                        <h2 style="margin:0; font-size:19px; display:flex; align-items:center; gap:8px;">${I.gear} Worker 调度模式与区域设置</h2>
                        <button onclick="closePlacementModal()" style="background:transparent;border:none;cursor:pointer;color:var(--text-sec);display:inline-flex;padding:4px;">${I.xmark}</button>
                    </div>
                    <select id="cf-mode-select" onchange="handleModeChange()" style="width:100%; padding:10px; border-radius:6px; border:1px solid var(--border); background:var(--bg); color:var(--text); margin-bottom:10px;">
                        <option value='{"mode":"smart"}'> 智能调度 (Smart Placement)</option>
                        <option value='{"mode":"off"}'> 边缘节点 (Edge - 默认离访客近)</option>
                        <optgroup label="指定云厂商物理机房落地">
                            <option value="aws"> AWS (亚马逊云)</option>
                            <option value="gcp"> GCP (谷歌云)</option>
                            <option value="azure"> Azure (微软云)</option>
                        </optgroup>
                        <option value="custom"> 手动输入区域代码...</option>
                    </select>
                    <select id="cf-region-select" style="display:none; width:100%; padding:10px; border-radius:6px; border:1px solid var(--border); background:var(--bg); color:var(--text); margin-bottom:10px;"></select>
                    <input type="text" id="cf-custom-input" placeholder="输入云代码 (如 gcp:us-west1)" style="display:none; width:100%; padding:10px; border-radius:6px; border:1px solid var(--border); background:var(--bg); color:var(--text); margin-bottom:10px;">
                    <div id="place-status" style="margin:0 0 12px; font-size:13px; color:var(--text-sec); font-weight:600;">后台全自动安全调度，不暴露任何私钥</div>
                    <button class="btn-submit" onclick="updatePlacement()" style="width:100%;">${I.check} 提交修改</button>
                </div>
            </div>

            <div id="accountModal" style="display:none; position:fixed; inset:0; z-index:11010; background:rgba(0,0,0,.5); overflow-y:auto; -webkit-overflow-scrolling:touch; padding:max(64px, calc(env(safe-area-inset-top) + 48px)) 16px 150px;">
                <div style="max-width:560px; margin:24px auto; background:var(--card); border-radius:18px; padding:22px; box-shadow:0 10px 40px rgba(0,0,0,.2);">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px;">
                        <h2 style="margin:0; font-size:19px; display:flex; align-items:center; gap:8px;">${I.gear} 账户设置</h2>
                        <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap; justify-content:flex-end;">
                            <span id="topVersionBadge" style="background:var(--primary); color:#fff; padding:3px 10px; border-radius:20px; font-size:12px; font-weight:600;">v${CURRENT_VERSION}</span>
                            <button onclick="closeAccountModal()" style="background:transparent;border:none;cursor:pointer;color:var(--text-sec);display:inline-flex;padding:4px;">${I.xmark}</button>
                        </div>
                    </div>
                    <div id="accountAdminPanel" style="display:flex; flex-direction:column; gap:16px;">
                        <div style="background:rgba(120,120,120,0.05); border:1px solid var(--border); border-radius:10px; padding:14px;">
                            <div style="font-size:14px; font-weight:600; cursor:pointer; display:flex; align-items:center; gap:6px; user-select:none;" onclick="tgSetSec('notice')"><span id="setSecArr-notice" style="font-size:11px; color:var(--text-sec);">▸</span> 📢 公告</div>
                            <div id="setSec-notice" style="display:none; margin-top:10px;">
                                <div style="font-size:12px; color:var(--text-sec); margin-bottom:10px; line-height:1.7;">子管理员与订阅用户进入面板时都会看到弹窗（同一公告只提示一次，阅读 3 秒后可关闭）。留空保存即清除公告。</div>
                                <textarea id="noticeText" rows="3" placeholder="填写公告内容，支持换行…" style="width:100%; padding:10px 12px; border:1px solid var(--border); border-radius:8px; background:var(--bg); font-size:13px; box-sizing:border-box; resize:vertical; margin-bottom:10px;"></textarea>
                                <button class="btn-submit" onclick="saveNotice()" style="width:100%;">${I.check} 发布公告</button>
                            </div>
                        </div>
                        <div style="background:rgba(120,120,120,0.05); border:1px solid var(--border); border-radius:10px; padding:14px;">
                            <div style="font-size:14px; font-weight:600; cursor:pointer; display:flex; align-items:center; gap:6px; user-select:none;" onclick="tgSetSec('logo')"><span id="setSecArr-logo" style="font-size:11px; color:var(--text-sec);">▸</span> ${I.tv} 自定义 Logo（左上角图标 / 登录页 / 浏览器标签）</div>
                            <div id="setSec-logo" style="display:none; margin-top:10px;">
                            <div style="display:flex; align-items:center; gap:14px; margin-bottom:12px;">
                                <img id="logoPreview" src="${EMBY_LOGO}" alt="logo预览" style="width:56px;height:56px;border-radius:14px;object-fit:cover;border:1px solid var(--border);background:var(--bg);flex-shrink:0;">
                                <div style="flex:1; display:flex; flex-direction:column; gap:8px; min-width:0;">
                                    <input type="text" id="logoUrlInput" placeholder="图片 URL（http(s):// 开头）" style="width:100%; padding:10px 14px; border:1px solid var(--border); border-radius:8px; background:var(--bg); box-sizing:border-box;">
                                    <div style="display:flex; gap:8px; flex-wrap:wrap;">
                                        <label class="btn-ghost" style="cursor:pointer; margin:0; display:inline-flex; align-items:center; gap:4px;">${I.upload} 上传图片<input type="file" id="logoFileInput" accept="image/png,image/jpeg,image/webp,image/gif" style="display:none;" onchange="readLogoFile(this.files[0]); this.value=''"></label>
                                        <button class="btn-submit" onclick="saveLogo()" style="flex:1; white-space:nowrap;">${I.check} 保存</button>
                                        <button class="btn-ghost" onclick="resetLogo()" style="white-space:nowrap;">恢复默认</button>
                                    </div>
                                </div>
                            </div>
                            <div style="font-size:12px; color:var(--text-sec);">${I.warn} 上传图片会自动压缩到 256px 以内再保存；保存后左上角、登录页与浏览器标签图标（favicon）同步生效。</div>
                            </div>
                        </div>
                        <div style="background:rgba(120,120,120,0.05); border:1px solid var(--border); border-radius:10px; padding:14px;">
                            <div style="font-size:14px; font-weight:600; cursor:pointer; display:flex; align-items:center; gap:6px; user-select:none;" onclick="tgSetSec('pass')"><span id="setSecArr-pass" style="font-size:11px; color:var(--text-sec);">▸</span> ${I.pencil} 修改登录密码</div>
                            <div id="setSec-pass" style="display:none; margin-top:10px;">
                            <div style="font-size:12px; color:var(--text-sec); margin-bottom:10px;">${I.warn} Worker 变量 ADMIN_TOKEN 为最高权限，永久有效；此处修改的密码仅对网页生效。</div>
                            <input type="password" id="newAdminPass" placeholder="输入新密码 (至少 4 位)" style="width:100%; padding:10px 14px; border:1px solid var(--border); border-radius:8px; background:var(--bg); margin-bottom:10px;">
                            <button class="btn-submit" onclick="saveAdminPass()" style="width:100%;">${I.check} 保存新密码</button>
                            </div>
                        </div>
                        <div style="background:rgba(120,120,120,0.05); border:1px solid var(--border); border-radius:10px; padding:14px;">
                            <div style="font-size:14px; font-weight:600; cursor:pointer; display:flex; align-items:center; gap:6px; user-select:none;" onclick="tgSetSec('token')"><span id="setSecArr-token" style="font-size:11px; color:var(--text-sec);">▸</span> ${I.spy} 反代 Token</div>
                            <div id="setSec-token" style="display:none; margin-top:10px;">
                            <div style="font-size:12px; color:var(--text-sec); margin-bottom:10px;">${I.warn} 开启后所有节点链接需带 <b style="color:var(--primary);">/密钥/</b> 前缀才可反代；不带前缀的访问会跳转 /catch 并记录来访 IP（记录存 D1，不占 KV 额度）。</div>
                            <div style="display:flex; align-items:center; gap:10px; margin-bottom:10px;">
                                <label style="display:flex; align-items:center; gap:6px; cursor:pointer; font-size:13px; color:var(--text);">
                                    <input type="checkbox" id="ptOn" style="accent-color:var(--primary); width:16px; height:16px; cursor:pointer;"> 开启
                                </label>
                            </div>
                            <div style="display:flex; gap:8px; margin-bottom:12px;">
                                <input type="text" id="ptKey" placeholder="自定义密钥（3-32 位字母数字，如 lhazkj）" oninput="chkReservedKey(this)" style="flex:1; padding:10px 14px; border:1px solid var(--border); border-radius:8px; background:var(--bg);">
                                <button class="btn-submit" onclick="saveProxyToken()" style="white-space:nowrap;">${I.check} 保存</button>
                            </div>
                            <div id="ptKeyReservedTip" style="display:none; color:#ff3b30; font-size:12px; margin:-6px 0 12px;">该密钥已被系统保留占用（如 entry），请更换</div>
                            <div style="font-size:13px; font-weight:600; margin-bottom:8px;">来访记录 IP <span style="font-weight:400; color:var(--text-sec);">（仅管理员）</span></div>
                            <div id="ptHits" style="font-size:12px; color:var(--text-sec);">加载中…</div>
                            </div>
                        </div>
                        <div style="background:rgba(120,120,120,0.05); border:1px solid var(--border); border-radius:10px; padding:14px;">
                            <div style="font-size:14px; font-weight:600; cursor:pointer; display:flex; align-items:center; gap:6px; user-select:none;" onclick="tgSetSec('security')"><span id="setSecArr-security" style="font-size:11px; color:var(--text-sec);">▸</span> ${I.spy} 安全</div>
                            <div id="setSec-security" style="display:none; margin-top:10px;">
                            <label style="display:flex; align-items:center; gap:8px; font-size:13px; cursor:pointer; margin-bottom:8px; color:var(--text);">
                                <input type="checkbox" id="bareProxyChk" style="accent-color:var(--primary); width:16px; height:16px; cursor:pointer;" checked> 允许裸域名直连代理（如 /https:// 开头的路径直连任意网站）
                            </label>
                            <div style="font-size:12px; color:var(--text-sec); margin-bottom:10px;">关闭后将拒绝所有「/域名/任意URL」式裸访问，仅允许已配置的节点前缀访问（反代 Token 开启时仍按 /密钥/节点后缀 工作）；不影响任何节点（含后端推流地址与线路不同的服）的正常访问。</div>
                            <button class="btn-submit" onclick="saveSecuritySettings()" style="width:100%;">${I.check} 保存安全设置</button>
                            </div>
                        </div>
                        <div style="background:rgba(120,120,120,0.05); border:1px solid var(--border); border-radius:10px; padding:14px;">
                            <div style="font-size:14px; font-weight:600; cursor:pointer; display:flex; align-items:center; gap:6px; user-select:none;" onclick="tgSetSec('notify')"><span id="setSecArr-notify" style="font-size:11px; color:var(--text-sec);">▸</span> ${I.bulb} 保号通知（Bark / Telegram）</div>
                            <div id="setSec-notify" style="display:none; margin-top:10px;">
                            <div style="font-size:12px; color:var(--text-sec); margin-bottom:10px;">${I.warn} 节点超观看下限未观看时每日推送一次；测试按钮可立即验证。</div>
                            <div style="display:flex; gap:14px; margin-bottom:10px;">
                                <label style="display:flex;align-items:center;gap:6px;font-size:13px;"><input type="checkbox" id="barkNotify" style="accent-color:var(--primary);"> Bark</label>
                                <label style="display:flex;align-items:center;gap:6px;font-size:13px;"><input type="checkbox" id="tgNotify" style="accent-color:var(--primary);"> Telegram</label>
                            </div>
                            <select id="kaNotifyMode" style="width:100%; padding:10px 14px; border:1px solid var(--border); border-radius:8px; background:var(--bg); margin-bottom:10px;">
                                <option value="all">保活结果通知：全部推送（默认）</option>
                                <option value="fail">保活结果通知：仅失败推送（成功静默）</option>
                            </select>
                            <input type="text" id="barkKey" placeholder="Bark 设备 Key（留空不修改）" style="width:100%; padding:10px 14px; border:1px solid var(--border); border-radius:8px; background:var(--bg); margin-bottom:8px;">
                            <select id="barkLevel" style="width:100%; padding:10px 14px; border:1px solid var(--border); border-radius:8px; background:var(--bg); margin-bottom:10px;">
                                <option value="active">active（默认）</option>
                                <option value="timeSensitive">timeSensitive</option>
                                <option value="critical">critical（紧急）</option>
                                <option value="passive">passive</option>
                            </select>
                            <input type="text" id="barkServer" placeholder="Bark 服务地址（默认 https://api.day.app）" style="width:100%; padding:10px 14px; border:1px solid var(--border); border-radius:8px; background:var(--bg); margin-bottom:10px;">
                            <input type="text" id="tgToken" placeholder="TG Bot Token（@BotFather 获取，留空不修改）" style="width:100%; padding:10px 14px; border:1px solid var(--border); border-radius:8px; background:var(--bg); margin-bottom:8px;">
                            <input type="text" id="tgChatId" placeholder="TG Chat ID（留空不修改）" style="width:100%; padding:10px 14px; border:1px solid var(--border); border-radius:8px; background:var(--bg); margin-bottom:10px;">
                            <div style="display:flex; gap:8px;">
                                <button class="btn-submit" onclick="saveNotifySettings()" style="flex:1;">${I.check} 保存</button>
                                <button class="btn-ghost" onclick="testNotifyFn('bark')" style="white-space:nowrap;">测试 Bark</button>
                                <button class="btn-ghost" onclick="testNotifyFn('tg')" style="white-space:nowrap;">测试 TG</button>
                            </div>
                            </div>
                        </div>
                        <div style="background:rgba(120,120,120,0.05); border:1px solid var(--border); border-radius:10px; padding:14px;">
                            <div style="font-size:14px; font-weight:600; cursor:pointer; display:flex; align-items:center; gap:6px; user-select:none;" onclick="tgSetSec('kaglobal')"><span id="setSecArr-kaglobal" style="font-size:11px; color:var(--text-sec);">▸</span> ${I.spy} 保活全局 UA/ID（保活专用）</div>
                            <div id="setSec-kaglobal" style="display:none; margin-top:10px;">
                            <div style="font-size:12px; color:var(--text-sec); margin-bottom:10px;">${I.warn} 未设置伪装参数的节点保活统一用这套身份（设备数固定、不随保活增长）。留空则用内置默认同一套；节点已设置伪装参数时仍用节点自身参数。</div>
                            <div style="display:flex; gap:6px; flex-wrap:wrap; margin-bottom:10px;">
                                <button type="button" class="btn-submit" style="padding:5px 10px; font-size:12px; border-radius:6px; background:#32ade6; box-shadow:none;" onclick="applyKaTpl('senplayer')">SenPlayer</button>
                                <button type="button" class="btn-submit" style="padding:5px 10px; font-size:12px; border-radius:6px; background:#5856d6; box-shadow:none;" onclick="applyKaTpl('eplayerx')">EplayerX</button>
                                <button type="button" class="btn-submit" style="padding:5px 10px; font-size:12px; border-radius:6px; background:#af52de; box-shadow:none;" onclick="applyKaTpl('forward')">Forward</button>
                                <button type="button" class="btn-submit" style="padding:5px 10px; font-size:12px; border-radius:6px; background:#00c7be; box-shadow:none;" onclick="applyKaTpl('rex')">Rex</button>
                                <button type="button" class="btn-submit" style="padding:5px 10px; font-size:12px; border-radius:6px; background:#34c759; box-shadow:none;" onclick="applyKaTpl('hills')">Hills</button>
                                <button type="button" class="btn-submit" style="padding:5px 10px; font-size:12px; border-radius:6px; background:#ff9500; box-shadow:none;" onclick="applyKaTpl('yamby')">Yamby</button>
                                <button type="button" class="btn-ghost" style="padding:5px 10px; font-size:12px;" onclick="applyKaTpl('clear')">清空</button>
                            </div>
                            <input type="text" id="kaGClient" placeholder="Client（如 SenPlayer）" style="width:100%; padding:10px 14px; border:1px solid var(--border); border-radius:8px; background:var(--bg); margin-bottom:8px;">
                            <input type="text" id="kaGVersion" placeholder="Version（如 6.2.2）" style="width:100%; padding:10px 14px; border:1px solid var(--border); border-radius:8px; background:var(--bg); margin-bottom:8px;">
                            <input type="text" id="kaGDevice" placeholder="Device（如 iPhone）" style="width:100%; padding:10px 14px; border:1px solid var(--border); border-radius:8px; background:var(--bg); margin-bottom:8px;">
                            <div style="display:flex; gap:8px; margin-bottom:8px;">
                                <input type="text" id="kaGDeviceId" placeholder="DeviceId（留空用内置固定）" style="flex:1; padding:10px 14px; border:1px solid var(--border); border-radius:8px; background:var(--bg);">
                                <button class="btn-ghost" onclick="document.getElementById('kaGDeviceId').value = genUuid()" style="white-space:nowrap;">${I.spy} 随机</button>
                            </div>
                            <input type="text" id="kaGUa" placeholder="UA（如 SenPlayer/6.2.2）" style="width:100%; padding:10px 14px; border:1px solid var(--border); border-radius:8px; background:var(--bg); margin-bottom:10px;">
                            <input type="number" id="kaRetryHours" placeholder="保活失败重试间隔（小时，默认 4；留空/0 = 默认）" step="0.5" min="0" style="width:100%; padding:10px 14px; border:1px solid var(--border); border-radius:8px; background:var(--bg); margin-bottom:10px;">
                            <button class="btn-submit" onclick="saveKaGlobalProfile()" style="width:100%;">${I.check} 保存保活全局身份</button>
                            </div>
                        </div>
                        <div style="background:rgba(120,120,120,0.05); border:1px solid var(--border); border-radius:10px; padding:14px;">
                            <div style="font-size:14px; font-weight:600; cursor:pointer; display:flex; align-items:center; gap:6px; user-select:none;" onclick="tgSetSec('subuser')"><span id="setSecArr-subuser" style="font-size:11px; color:var(--text-sec);">▸</span> ${I.robot} 订阅用户管理</div>
                            <div id="setSec-subuser" style="display:none; margin-top:10px;">
                            <div style="font-size:12px; color:var(--text-sec); margin-bottom:10px;">订阅者密码可进入网页，但只能查看节点，不能进行任何修改操作。</div>
                            <div id="subList" style="display:flex; flex-direction:column; gap:8px; margin-bottom:12px;"></div>
                            <div style="display:flex; gap:8px;">
                                <input type="text" id="newSubPass" placeholder="输入新订阅者密码" style="flex:1; padding:10px 14px; border:1px solid var(--border); border-radius:8px; background:var(--bg);">
                                <button class="btn-submit" onclick="addSubscriber()" style="white-space:nowrap;">${I.plus} 添加</button>
                            </div>
                            </div>
                        </div>
                        <div style="background:rgba(120,120,120,0.05); border:1px solid var(--border); border-radius:10px; padding:14px;">
                            <div style="font-size:14px; font-weight:600; margin-bottom:10px;">${I.rocket} 版本</div>
                            <div style="display:flex; align-items:center; gap:8px; margin-bottom:10px; flex-wrap:wrap;">
                                <span style="font-size:13px;">当前版本：</span>
                                <span id="curVersionBadge" style="background:var(--primary); color:#fff; padding:3px 10px; border-radius:20px; font-size:12px; font-weight:600;">v${CURRENT_VERSION}</span>
                                <span id="latestVersionInfo" style="font-size:12px; color:var(--text-sec);"></span>
                            </div>
                            <div style="display:flex; align-items:center; gap:8px; margin-bottom:12px;">
                                <label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer;">
                                    <input type="checkbox" id="updateNotifyChk" style="accent-color:var(--primary);"> 开启更新提醒（检测到新版本时弹窗提示）
                                </label>
                                <button class="btn-ghost" onclick="saveUpdateNotify()" style="padding:6px 12px;font-size:12px;">保存</button>
                            </div>
                            <div style="font-size:13px; font-weight:600; margin-bottom:6px;">${I.rocket} 最新更新内容</div>
                            <div id="latestChangelog" style="font-size:12px; color:var(--text-sec); margin-bottom:12px; line-height:1.8;">加载中…</div>
                            <div style="display:flex; gap:8px; margin-bottom:12px;">
                                <button class="btn-submit" onclick="checkForUpdates(true)" style="flex:1;">${I.search} 检查更新</button>
                                <button class="btn-ghost" onclick="manualUpdateFlow()" style="flex:1;">${I.rocket} 立即更新</button>
                            </div>
                            <details style="font-size:12px; color:var(--text-sec);">
                                <summary style="cursor:pointer; font-weight:600;">${I.lines} 历史更新内容</summary>
                                <div id="historyChangelog" style="margin-top:8px; line-height:1.8;">加载中…</div>
                            </details>
                        </div>
                    </div>
                    <div id="accountSubPanel" style="display:none; text-align:center; padding:20px 0; color:var(--text-sec); font-size:14px;">
                        ${I.robot} 当前为订阅用户模式，仅可查看节点，无任何修改权限。
                    </div>
                </div>
            </div>

            <div id="noticeModal" class="modal-mask" style="display:none; padding:16px 16px 150px;">
                <div class="modal-box" style="max-width:520px;">
                    <div class="modal-head">
                        <h2>📢 公告</h2>
                    </div>
                    <div id="noticeBody" style="font-size:14px; line-height:1.9; white-space:pre-wrap; word-break:break-all; max-height:58vh; overflow:auto; padding:6px 0; color:var(--text);"></div>
                    <div style="text-align:right; margin-top:16px;">
                        <button class="btn-submit" id="noticeCloseBtn" onclick="closeNotice()" disabled style="opacity:.55; cursor:not-allowed;">我知道了 (3s)</button>
                    </div>
                </div>
            </div>

            <div id="nodeReqModal" style="display:none; position:fixed; inset:0; z-index:11500; background:rgba(0,0,0,.55); backdrop-filter:blur(5px); overflow-y:auto; -webkit-overflow-scrolling:touch; padding:max(16px, env(safe-area-inset-top)) 16px 150px;">
                <div style="max-width:560px; margin:40px auto; background:var(--card); border-radius:18px; padding:22px; box-shadow:0 10px 40px rgba(0,0,0,.25);">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px;">
                        <h2 style="margin:0; font-size:18px; display:flex; align-items:center; gap:8px;">${I.robot} 节点申请审核</h2>
                        <button onclick="closeNodeReqModal()" style="background:transparent;border:none;cursor:pointer;color:var(--text-sec);display:inline-flex;padding:4px;">${I.xmark}</button>
                    </div>
                    <div id="nodeReqList" style="display:flex; flex-direction:column; gap:10px;">加载中…</div>
                </div>
            </div>

            <div id="subReqModal" style="display:none; position:fixed; inset:0; z-index:11500; background:rgba(0,0,0,.55); overflow-y:auto; -webkit-overflow-scrolling:touch; padding:max(16px, env(safe-area-inset-top)) 16px 150px;">
                <div style="max-width:480px; margin:40px auto; background:var(--card); border-radius:18px; padding:22px; box-shadow:0 10px 40px rgba(0,0,0,.25);">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px;">
                        <h2 style="margin:0; font-size:18px; display:flex; align-items:center; gap:8px;">${I.plus} 申请添加节点</h2>
                        <button onclick="closeSubReqModal()" style="background:transparent;border:none;cursor:pointer;color:var(--text-sec);display:inline-flex;padding:4px;">${I.xmark}</button>
                    </div>
                    <div style="display:flex; flex-direction:column; gap:12px;">
                        <input type="text" id="subReqName" placeholder="节点名字（如: 我的私服）" style="width:100%; padding:10px 14px; border:1px solid var(--border); border-radius:8px; background:var(--bg); box-sizing:border-box;">
                        <div id="subReqUrlBox" style="display:flex; flex-direction:column; gap:8px; background:rgba(120,120,120,0.05); border:1px solid var(--border); border-radius:10px; padding:12px;">
                            <div style="font-size:12px; font-weight:600; color:var(--text-sec);">服务器线路配置（支持无数条备用线路）</div>
                            <input type="url" class="sub-req-url" placeholder="主线路地址（如: https://1.1.1.1:8096）" oninput="handleSubReqUrls()" style="width:100%; padding:10px 14px; border:1px solid var(--border); border-radius:8px; background:var(--bg); box-sizing:border-box;">
                            <input type="url" class="sub-req-url" placeholder="备用线路 1（选填，可继续添加）" oninput="handleSubReqUrls()" style="width:100%; padding:10px 14px; border:1px solid var(--border); border-radius:8px; background:var(--bg); box-sizing:border-box;">
                        </div>
                        <div id="subReqHint" style="font-size:12px; color:var(--text-sec); line-height:1.7;">提交后管理员审核；线路已存在会直接提示你，同线路的新申请会自动覆盖旧申请（含全部备用线路）。</div>
                        <button class="btn-submit" onclick="submitNodeReq()" style="width:100%; padding:13px;">${I.check} 提交申请</button>
                    </div>
                </div>
            </div>

            <div id="updateModal" style="display:none; position:fixed; inset:0; z-index:12000; background:rgba(0,0,0,.55); overflow-y:auto; -webkit-overflow-scrolling:touch; padding:max(16px, env(safe-area-inset-top)) 16px 150px;">
                <div style="max-width:480px; margin:40px auto; background:var(--card); border-radius:18px; padding:22px; box-shadow:0 10px 40px rgba(0,0,0,.25);">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
                        <h2 style="margin:0; font-size:18px; display:flex; align-items:center; gap:8px;">${I.rocket} 发现新版本</h2>
                        <button onclick="hideUpdateModal()" style="background:transparent;border:none;cursor:pointer;color:var(--text-sec);display:inline-flex;padding:4px;">${I.xmark}</button>
                    </div>
                    <div style="font-size:13px; margin-bottom:12px;">当前版本 <span id="updateModalCurVer" style="font-weight:600;">v${CURRENT_VERSION}</span> → 新版本 <span id="updateModalVersion" style="font-weight:600; color:var(--primary);"></span></div>
                    <div style="background:rgba(52,199,89,0.06); border:1px solid rgba(52,199,89,.25); border-radius:10px; padding:14px; margin-bottom:14px;">
                        <div id="updateModalBody" style="font-size:12px; color:var(--text); line-height:1.9;">加载中…</div>
                    </div>
                    <div style="display:flex; gap:8px;">
                        <button class="btn-submit" onclick="doOnlineUpdate()" style="flex:1;">${I.rocket} 立即更新</button>
                        <button class="btn-ghost" onclick="hideUpdateModal()" style="flex:1;">稍后再说</button>
                    </div>
                </div>
            </div>

            <div id="updateResultModal" style="display:none; position:fixed; inset:0; z-index:12010; background:rgba(0,0,0,.55); backdrop-filter:blur(5px); overflow-y:auto; -webkit-overflow-scrolling:touch; padding:max(16px, env(safe-area-inset-top)) 16px 150px;">
                <div style="max-width:480px; margin:40px auto; background:var(--card); border-radius:18px; padding:22px; box-shadow:0 10px 40px rgba(0,0,0,.25);">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
                        <h2 style="margin:0; font-size:18px; display:flex; align-items:center; gap:8px; color:#34c759;">${I.check} 更新成功</h2>
                        <button onclick="document.getElementById('updateResultModal').style.display='none'" style="background:transparent;border:none;cursor:pointer;color:var(--text-sec);display:inline-flex;padding:4px;">${I.xmark}</button>
                    </div>
                    <div id="updateResultBody" style="font-size:12px; color:var(--text); line-height:1.9; margin-bottom:14px;"></div>
                    <button class="btn-submit" onclick="window.location.reload()" style="width:100%;">${I.check} 刷新页面</button>
                </div>
            </div>

            <div class="card">
                <div style="display:flex; justify-content: space-between; align-items:center; margin-bottom:16px; flex-wrap:wrap; gap:10px; cursor:pointer;" onclick="toggleNodesCollapse()">
                    <h2 style="margin:0; font-size:18px;"><span id="nodesArrow" class="collapse-arrow">▶</span> 已反代的媒体库</h2>
                    <div style="display: flex; gap: 10px; align-items:center; flex-wrap: wrap;" onclick="event.stopPropagation()">
                        <button class="btn-submit admin-only" onclick="pingAllNodes()" style=" padding: 10px 14px; font-size: 13px;">${I.bolt} 全局测速</button>
                        <button id="btnPurge" class="btn-submit admin-only" onclick="purgeCache()" style=" padding: 10px 14px; font-size: 13px;">${I.broom} 刷新全站海报</button>
                        <button class="btn-submit" onclick="openSubReqModal()" style="padding:10px 14px; font-size:13px;">${I.plus} 申请节点</button>
                        <input type="text" id="searchNode" class="search-input" placeholder="搜索备注/后缀/线路地址查找..." onkeyup="filterNodesList()" oninput="filterNodesList()">
                    </div>
                </div>
                <div class="admin-only" id="nodesToolbar" style="background: rgba(0, 122, 255, 0.05); padding: 12px 20px; border-radius: 12px; border: 1px dashed var(--primary); margin-bottom: 20px; margin-top: 20px; display: none; align-items: center; gap: 15px; flex-wrap: wrap;">
            <label style="cursor: pointer; font-weight: bold; display: flex; align-items: center; gap: 6px;">
                <input type="checkbox" id="selectAllNodes" onchange="toggleSelectAll(this)" style="width: 18px; height: 18px; accent-color: var(--primary);"> 
                全选节点
            </label>
            
            <div style="width: 2px; height: 20px; background: var(--border);"></div> <select id="batch-mode-select" style="padding: 8px 12px; border-radius: 8px; border: 1px solid var(--border); background: var(--bg); color: var(--text); font-weight: 600;">
                <option value=""> 读取模式中...</option>
            </select>

            <button onclick="batchUpdateModes()" style="background: var(--primary); color: white; border: none; padding: 8px 16px; border-radius: 8px; cursor: pointer; font-weight: bold; transition: 0.2s; box-shadow: 0 4px 10px rgba(0,113,227,0.2);">
                ${I.rocket} 批量应用模式
            </button>

            <span id="batch-status" style="font-size: 13px; font-weight: 600;"></span>
        </div>
                <div id="list-grid" class="node-grid" style="display:none;">
                    <div style="text-align:center; color:var(--text-sec); grid-column: 1 / -1; padding: 40px;">读取数据中...</div>
                </div>
                <div id="nodesHint" style="text-align:center; color:var(--text-sec); font-size:13px; padding:18px 12px; cursor:pointer; user-select:none;" onclick="toggleNodesCollapse()">已收起全部节点 · 点击展开查看</div>
            </div>
            
        </div>
        
        <div style="text-align: center; padding-top: 10px; padding-bottom: 20px;">
            <a href="https://t.me/MakkaPakkaOvO" target="_blank" style="text-decoration: none; color: var(--text); font-weight: 600; display: inline-flex; align-items: center; padding: 12px 24px; background: var(--card); border-radius: 30px; box-shadow: 0 4px 15px rgba(0,0,0,0.06); transition: 0.3s; font-size: 14px; border: 1px solid var(--border);">
                ${SVG_TG}
                联系作者 MakkaPakkaOvO
            </a>
            <div style="margin-top: 20px; font-size: 12px; color: var(--text-sec); line-height: 1.6; max-width: 600px; margin-left: auto; margin-right: auto; padding: 0 15px;">
                <strong>免责声明:</strong> 本项目仅供学习与技术测试使用，请遵守当地法律法规。使用者对配置、转发内容与访问行为承担全部责任，开发者不对任何直接或间接损失负责。
            </div>
        </div>
    </div>

    <script>
        const modeNames = { 'off': '保守', 'realip_only': '严格', 'dual': '兼容', 'strict': '强力', 'custom': '伪装(旧)', 'off_fake': '保守+伪装', 'realip_only_fake': '严格+伪装', 'dual_fake': '兼容+伪装', 'strict_fake': '强力+伪装', 'emos': 'EMOS(已停用)', 'emos_fake': 'EMOS+伪装(已停用)' };

        // ===== 折叠交互(v3.6.43)=====
        function toggleNodesCollapse(){
            const grid = document.getElementById('list-grid');
            const tb = document.getElementById('nodesToolbar');
            const hint = document.getElementById('nodesHint');
            const ar = document.getElementById('nodesArrow');
            if(!grid) return;
            const open = grid.style.display !== 'none';
            grid.style.display = open ? 'none' : 'grid';
            if(tb) tb.style.display = open ? 'none' : 'flex';
            if(hint) hint.style.display = open ? 'block' : 'none';
            if(ar){ ar.textContent = open ? '▶' : '▼'; ar.classList.toggle('open', !open); }
        }
        function toggleCollapseSec(head){
            const sec = head.closest('.collapse-sec');
            if(!sec) return;
            sec.classList.toggle('open');
            const hint = head.querySelector('.ch-hint');
            if(hint) hint.textContent = sec.classList.contains('open') ? '点击收起' : '点击展开';
        }

        const DEFAULT_ICON_URL = 'https://emby-icon.vercel.app/TFEL-Emby.json';
        let globalIcons = [];
        let proxyNodesForPing = [];
        let sortableInstance = null;
        let trendChartInstance = null;
        let locationChartInstance = null;
        let cfStatusChartInstance = null;
        let cfHourChartInstance = null;

        // 设置 Chart.js 响应暗色模式
        function updateChartColors() {
            Chart.defaults.color = document.body.classList.contains('dark') ? '#98989d' : '#86868b';
            Chart.defaults.borderColor = document.body.classList.contains('dark') ? '#38383a' : '#d2d2d7';
        }

        const GEO_META = { 'CN':{label:'中国',lat:34.5,lon:108.9},'HK':{label:'中国香港',lat:22.31,lon:114.17},'TW':{label:'中国台湾',lat:25.03,lon:121.56},'MO':{label:'中国澳门',lat:22.19,lon:113.54},'JP':{label:'日本',lat:35.68,lon:139.76},'SG':{label:'新加坡',lat:1.35,lon:103.82},'KR':{label:'韩国',lat:37.56,lon:126.97},'KP':{label:'朝鲜',lat:39.03,lon:125.75},'US':{label:'美国',lat:34.05,lon:-118.24},'DE':{label:'德国',lat:50.11,lon:8.68},'GB':{label:'英国',lat:51.50,lon:-0.12},'UK':{label:'英国',lat:51.50,lon:-0.12},'NL':{label:'荷兰',lat:52.36,lon:4.90},'FR':{label:'法国',lat:48.85,lon:2.35},'FI':{label:'芬兰',lat:60.17,lon:24.94},'MX':{label:'墨西哥',lat:19.43,lon:-99.13},'CA':{label:'加拿大',lat:43.65,lon:-79.38},'AU':{label:'澳大利亚',lat:-33.86,lon:151.20},'NZ':{label:'新西兰',lat:-36.85,lon:174.76},'RU':{label:'俄罗斯',lat:55.75,lon:37.61},'IN':{label:'印度',lat:19.07,lon:72.87},'MY':{label:'马来西亚',lat:3.14,lon:101.68},'TH':{label:'泰国',lat:13.75,lon:100.50},'VN':{label:'越南',lat:10.82,lon:106.62},'ID':{label:'印度尼西亚',lat:-6.20,lon:106.81},'PH':{label:'菲律宾',lat:14.60,lon:120.98},'BR':{label:'巴西',lat:-23.55,lon:-46.63},'IT':{label:'意大利',lat:41.90,lon:12.50},'ES':{label:'西班牙',lat:40.42,lon:-3.70},'SE':{label:'瑞典',lat:59.33,lon:18.07},'CH':{label:'瑞士',lat:46.95,lon:7.45},'TR':{label:'土耳其',lat:39.93,lon:32.86},'AE':{label:'阿联酋',lat:25.25,lon:55.36},'AR':{label:'阿根廷',lat:-34.60,lon:-58.38},'CL':{label:'智利',lat:-33.45,lon:-70.67},'NO':{label:'挪威',lat:59.91,lon:10.75},'DK':{label:'丹麦',lat:55.68,lon:12.57},'PL':{label:'波兰',lat:52.23,lon:21.01},'UA':{label:'乌克兰',lat:50.45,lon:30.52},'IE':{label:'爱尔兰',lat:53.35,lon:-6.26},'AT':{label:'奥地利',lat:48.21,lon:16.37},'PT':{label:'葡萄牙',lat:38.72,lon:-9.14},'GR':{label:'希腊',lat:37.98,lon:23.73},'IL':{label:'以色列',lat:32.08,lon:34.78},'SA':{label:'沙特阿拉伯',lat:24.71,lon:46.68},'QA':{label:'卡塔尔',lat:25.29,lon:51.53},'KW':{label:'科威特',lat:29.38,lon:47.99},'EG':{label:'埃及',lat:30.04,lon:31.24},'ZA':{label:'南非',lat:-26.20,lon:28.05},'NG':{label:'尼日利亚',lat:6.52,lon:3.38},'KE':{label:'肯尼亚',lat:-1.29,lon:36.82},'CO':{label:'哥伦比亚',lat:4.71,lon:-74.07},'PE':{label:'秘鲁',lat:-12.05,lon:-77.04},'VE':{label:'委内瑞拉',lat:10.48,lon:-66.90},'PK':{label:'巴基斯坦',lat:33.69,lon:73.06},'BD':{label:'孟加拉国',lat:23.81,lon:90.41},'LK':{label:'斯里兰卡',lat:6.93,lon:79.85},'MM':{label:'缅甸',lat:16.87,lon:96.20},'LA':{label:'老挝',lat:17.97,lon:102.63},'KH':{label:'柬埔寨',lat:11.56,lon:104.92},'NP':{label:'尼泊尔',lat:27.72,lon:85.32},'IR':{label:'伊朗',lat:35.69,lon:51.39},'IQ':{label:'伊拉克',lat:33.32,lon:44.42},'JO':{label:'约旦',lat:31.96,lon:35.95},'LB':{label:'黎巴嫩',lat:33.89,lon:35.50},'OM':{label:'阿曼',lat:23.59,lon:58.41},'DZ':{label:'阿尔及利亚',lat:36.75,lon:3.06},'MA':{label:'摩洛哥',lat:34.02,lon:-6.84},'TN':{label:'突尼斯',lat:36.81,lon:10.18},'RO':{label:'罗马尼亚',lat:44.43,lon:26.10},'HU':{label:'匈牙利',lat:47.50,lon:19.04},'BG':{label:'保加利亚',lat:42.70,lon:23.32},'CZ':{label:'捷克',lat:50.08,lon:14.44},'SK':{label:'斯洛伐克',lat:48.15,lon:17.11},'HR':{label:'克罗地亚',lat:45.81,lon:15.98},'RS':{label:'塞尔维亚',lat:44.79,lon:20.45},'EE':{label:'爱沙尼亚',lat:59.44,lon:24.75},'LV':{label:'拉脱维亚',lat:56.95,lon:24.11},'LT':{label:'立陶宛',lat:54.69,lon:25.28},'KZ':{label:'哈萨克斯坦',lat:43.24,lon:76.95},'UZ':{label:'乌兹别克斯坦',lat:41.30,lon:69.24},'GE':{label:'格鲁吉亚',lat:41.72,lon:44.79},'AZ':{label:'阿塞拜疆',lat:40.41,lon:49.87},'BY':{label:'白俄罗斯',lat:53.90,lon:27.56},'CU':{label:'古巴',lat:23.11,lon:-82.37},'DO':{label:'多米尼加',lat:18.49,lon:-69.91},'CR':{label:'哥斯达黎加',lat:9.93,lon:-84.08},'PA':{label:'巴拿马',lat:8.98,lon:-79.52},'GT':{label:'危地马拉',lat:14.63,lon:-90.51},'BO':{label:'玻利维亚',lat:-16.50,lon:-68.15},'PY':{label:'巴拉圭',lat:-25.28,lon:-57.63},'UY':{label:'乌拉圭',lat:-34.90,lon:-56.16},'EC':{label:'厄瓜多尔',lat:-0.18,lon:-78.47},'FJ':{label:'斐济',lat:-18.14,lon:178.44},'PG':{label:'巴布亚新几内亚',lat:-9.44,lon:147.18},'GH':{label:'加纳',lat:5.60,lon:-0.19},'ET':{label:'埃塞俄比亚',lat:9.03,lon:38.74},'TZ':{label:'坦桑尼亚',lat:-6.79,lon:39.28},'UG':{label:'乌干达',lat:0.35,lon:32.58},'SD':{label:'苏丹',lat:15.59,lon:32.55},'LY':{label:'利比亚',lat:32.89,lon:13.19},'MN':{label:'蒙古',lat:47.89,lon:106.91},'BT':{label:'不丹',lat:27.47,lon:89.64},'MV':{label:'马尔代夫',lat:4.18,lon:73.51} };
        const PROV_COORDS = { '北京市':{lat:39.90,lon:116.40},'天津市':{lat:39.08,lon:117.20},'上海市':{lat:31.23,lon:121.47},'重庆市':{lat:29.56,lon:106.55},'河北省':{lat:38.04,lon:114.51},'山西省':{lat:37.87,lon:112.55},'辽宁省':{lat:41.80,lon:123.43},'吉林省':{lat:43.82,lon:125.32},'黑龙江省':{lat:45.80,lon:126.53},'江苏省':{lat:32.06,lon:118.80},'浙江省':{lat:30.27,lon:120.15},'安徽省':{lat:31.82,lon:117.23},'福建省':{lat:26.07,lon:119.30},'江西省':{lat:28.68,lon:115.86},'山东省':{lat:36.65,lon:117.12},'河南省':{lat:34.75,lon:113.63},'湖北省':{lat:30.59,lon:114.30},'湖南省':{lat:28.23,lon:112.94},'广东省':{lat:23.13,lon:113.26},'海南省':{lat:20.04,lon:110.32},'四川省':{lat:30.57,lon:104.06},'贵州省':{lat:26.65,lon:106.63},'云南省':{lat:25.04,lon:102.71},'陕西省':{lat:34.34,lon:108.94},'甘肃省':{lat:36.06,lon:103.83},'青海省':{lat:36.62,lon:101.78},'台湾省':{lat:25.03,lon:121.56},'内蒙古自治区':{lat:40.84,lon:111.75},'广西壮族自治区':{lat:22.82,lon:108.32},'西藏自治区':{lat:29.65,lon:91.14},'宁夏回族自治区':{lat:38.47,lon:106.23},'新疆维吾尔自治区':{lat:43.83,lon:87.62},'香港特别行政区':{lat:22.31,lon:114.17},'澳门特别行政区':{lat:22.19,lon:113.54} };
        let geoData = null, geoMode = '3d', geoResolvedNew = 0;
        let geoRotLon = 0, geoRotLat = 18, geoDragging = false, geoDragX = 0, geoDragY = 0, geoHoverNode = null;
        let geoAnimId = null, geoChinaChart = null, geoChinaLoaded = false, geoNodesCache = null;
        let geoWorldData = null, geoWorldLoading = false;
        function geoBuildNodes() {
            if (geoNodesCache) return geoNodesCache;
            const nodes = [];
            if (!geoData) return nodes;
            const total = geoData.countries.reduce((a, c) => a + (Number(c.count) || 0), 0);
            for (const c of geoData.countries) {
                const code = String(c.country || '').toUpperCase();
                if (code === 'CN') continue;
                const m = GEO_META[code];
                if (!m) continue;
                nodes.push({ lat: m.lat, lon: m.lon, count: Number(c.count) || 0, label: m.label, sub: m.label, kind: 'country', code: code });
            }
            const cnTotal = geoData.countries.reduce((a, c) => a + (String(c.country || '').toUpperCase() === 'CN' ? (Number(c.count) || 0) : 0), 0);
            if (cnTotal > 0) {
                const pTotal = geoData.provinces.reduce((a, c) => a + (Number(c.count) || 0), 0);
                for (const p of geoData.provinces) {
                    const pc = PROV_COORDS[p.region];
                    if (!pc) continue;
                    nodes.push({ lat: pc.lat, lon: pc.lon, count: Number(p.count) || 0, label: p.region, sub: p.region, kind: 'province', code: p.region });
                }
                if (cnTotal > pTotal) {
                    nodes.push({ lat: 34.5, lon: 108.9, count: cnTotal - pTotal, label: '中国', sub: '中国', kind: 'province', code: 'CN-unknown', unknown: cnTotal - pTotal });
                }
            }
            nodes.sort((a, b) => b.count - a.count);
            geoNodesCache = nodes;
            return nodes;
        }
        function geoFmtCount(n) { return n >= 10000 ? (n / 10000).toFixed(1) + 'w' : String(n); }
        async function loadVisitorGeo() {
            const box = document.getElementById('geoStage3d');
            if (!box) return;
            const sum = document.getElementById('geoSummary');
            try {
                const ac = new AbortController();
                const tm = setTimeout(function() { ac.abort(); }, 8000);
                const res = await fetch('/api/visitor-geo', { signal: ac.signal });
                clearTimeout(tm);
                const d = await res.json();
                if (!d.success) throw new Error(d.error || '接口错误');
                geoData = { countries: d.countries || [], provinces: d.provinces || [] };
                geoResolvedNew = 0;
                geoNodesCache = null;
                geoInitEvents();
                geoDraw();
                if (sum) sum.innerHTML = geoSummaryHtml();
            } catch (e) {
                if (sum) sum.textContent = '访问者分布加载失败: ' + e.message + (e.name === 'AbortError' ? '(解析超时,可稍后点「刷新解析」重试)' : '');
            }
        }
        function geoSummaryHtml() {
            if (!geoData) return '加载中...';
            const cnTotal = geoData.countries.reduce((a, c) => a + (String(c.country || '').toUpperCase() === 'CN' ? (Number(c.count) || 0) : 0), 0);
            const wTotal = geoData.countries.reduce((a, c) => a + (Number(c.count) || 0), 0);
            const provCount = geoData.provinces.length;
            return '共 ' + wTotal + ' 次访问 · ' + geoData.countries.length + ' 个国家/地区 · 国内 ' + cnTotal + ' 次 · 已解析省份 ' + provCount + ' 个<span style="opacity:.75"> · 国外按国家(Cloudflare 判定),国内省份在后台解析中,稍后点「刷新解析」查看</span>';
        }
        function geoSwitchMode(m) {
            geoMode = m;
            document.getElementById('geoMode3dBtn').style.background = m === '3d' ? 'var(--primary)' : 'rgba(120,120,120,.15)';
            document.getElementById('geoMode3dBtn').style.color = m === '3d' ? '#fff' : 'var(--text)';
            document.getElementById('geoModeWorldBtn').style.background = m === 'world' ? 'var(--primary)' : 'rgba(120,120,120,.15)';
            document.getElementById('geoModeWorldBtn').style.color = m === 'world' ? '#fff' : 'var(--text)';
            document.getElementById('geoModeChinaBtn').style.background = m === 'china' ? 'var(--primary)' : 'rgba(120,120,120,.15)';
            document.getElementById('geoModeChinaBtn').style.color = m === 'china' ? '#fff' : 'var(--text)';
            document.getElementById('geoStage3d').style.display = m === '3d' ? 'block' : 'none';
            document.getElementById('geoStageWorld').style.display = m === 'world' ? 'block' : 'none';
            document.getElementById('geoStageChina').style.display = m === 'china' ? 'block' : 'none';
            if (m === 'china') geoEnsureChinaChart();
            else geoDraw();
        }
        function geoDraw() {
            if (geoMode === '3d') geoDrawGlobe();
            else if (geoMode === 'world') geoDrawWorld();
            const sum = document.getElementById('geoSummary');
            if (!sum || !geoData) return;
            const cnTotal = geoData.countries.reduce((a, c) => a + (String(c.country || '').toUpperCase() === 'CN' ? (Number(c.count) || 0) : 0), 0);
            const wTotal = geoData.countries.reduce((a, c) => a + (Number(c.count) || 0), 0);
            const provCount = geoData.provinces.length;
            sum.innerHTML = '共 ' + wTotal + ' 次访问 · ' + geoData.countries.length + ' 个国家/地区 · 国内 ' + cnTotal + ' 次 · 已解析省份 ' + provCount + ' 个' + (geoResolvedNew ? ' · 本次新解析 ' + geoResolvedNew + ' 个 IP' : '') + '<br><span style="opacity:.75">首次打开会按需解析国内省份(百度/ip-api 归属库),点「刷新解析」可补齐;国外按国家(Cloudflare 头部直接判定)。</span>';
        }
        function geoProjectPoint(latDeg, lonDeg, rotLatRad, rotLonRad, cx, cy, R, alt) {
            const lat = latDeg * Math.PI / 180, lon = lonDeg * Math.PI / 180 + rotLonRad;
            const cosLat = Math.cos(lat), sinLat = Math.sin(lat);
            const cosLon = Math.cos(lon), sinLon = Math.sin(lon);
            const cosLat0 = Math.cos(rotLatRad), sinLat0 = Math.sin(rotLatRad);
            const z = sinLat0 * sinLat + cosLat0 * cosLat * cosLon;
            const rEff = R * (alt || 1);
            return { x: cx + rEff * cosLat * sinLon, y: cy - rEff * (cosLat0 * sinLat - sinLat0 * cosLat * cosLon), z: z };
        }
        // 球面大圆航线插值:两点在单位球上 slerp,返回经纬度序列(用于模拟航线)
        function geoArcPoints(latA, lonA, latB, lonB, steps) {
            const toV = (la, lo) => {
                const lat = la * Math.PI / 180, lon = lo * Math.PI / 180;
                return [Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon)];
            };
            const a = toV(latA, lonA), b = toV(latB, lonB);
            const dot = Math.max(-1, Math.min(1, a[0]*b[0] + a[1]*b[1] + a[2]*b[2]));
            const ang = Math.acos(dot);
            const pts = [];
            for (let i = 0; i <= steps; i++) {
                const t = i / steps;
                let v;
                if (ang < 1e-6) v = a;
                else {
                    const s = Math.sin(ang), w1 = Math.sin((1 - t) * ang) / s, w2 = Math.sin(t * ang) / s;
                    v = [a[0]*w1 + b[0]*w2, a[1]*w1 + b[1]*w2, a[2]*w1 + b[2]*w2];
                }
                pts.push({ lat: Math.asin(Math.max(-1, Math.min(1, v[1]))) * 180 / Math.PI, lon: Math.atan2(v[2], v[0]) * 180 / Math.PI });
            }
            return pts;
        }
        function geoDrawGlobe() {
            const canvas = document.getElementById('geoGlobeCanvas');
            if (!canvas) return;
            const nodes = geoBuildNodes();
            const dpr = Math.min(2, window.devicePixelRatio || 1);
            const size = Math.min(420, canvas.parentElement.clientWidth || 420);
            canvas.width = size * dpr; canvas.height = size * dpr;
            canvas.style.width = size + 'px'; canvas.style.height = size + 'px';
            const ctx = canvas.getContext('2d');
            ctx.save(); ctx.scale(dpr, dpr); ctx.clearRect(0, 0, size, size);
            const cx = size / 2, cy = size / 2, R = size * 0.40;
            const isDark = document.body.classList.contains('dark');
            const rotLon = geoRotLon * Math.PI / 180, rotLat = geoRotLat * Math.PI / 180;
            const cosLat0 = Math.cos(rotLat), sinLat0 = Math.sin(rotLat);
            const halo = ctx.createRadialGradient(cx, cy, R * 0.9, cx, cy, R * 1.16);
            halo.addColorStop(0, isDark ? 'rgba(56,189,248,0.13)' : 'rgba(59,130,246,0.10)');
            halo.addColorStop(1, 'transparent');
            ctx.beginPath(); ctx.arc(cx, cy, R * 1.16, 0, Math.PI * 2); ctx.fillStyle = halo; ctx.fill();
            const grad = ctx.createRadialGradient(cx - R * 0.3, cy - R * 0.3, R * 0.06, cx, cy, R);
            if (isDark) { grad.addColorStop(0, '#243b61'); grad.addColorStop(0.65, '#172a4a'); grad.addColorStop(1, '#0f1d36'); }
            else { grad.addColorStop(0, '#f8fbff'); grad.addColorStop(0.62, '#e6f0fd'); grad.addColorStop(1, '#cfe2fc'); }
            ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fillStyle = grad; ctx.fill();
            ctx.save(); ctx.lineWidth = 0.6;
            ctx.strokeStyle = isDark ? 'rgba(148,163,184,0.12)' : 'rgba(59,130,246,0.13)';
            for (let la = -60; la <= 60; la += 30) {
                ctx.beginPath(); let started = false;
                for (let lo = -180; lo <= 180; lo += 8) {
                    const p = geoProjectPoint(la, lo, rotLat, rotLon, cx, cy, R, 1);
                    if (p.z > 0.01) { if (!started) { ctx.moveTo(p.x, p.y); started = true; } else ctx.lineTo(p.x, p.y); }
                    else started = false;
                }
                ctx.stroke();
            }
            for (let lo = -180; lo < 180; lo += 30) {
                ctx.beginPath(); let started = false;
                for (let la = -75; la <= 75; la += 6) {
                    const p = geoProjectPoint(la, lo, rotLat, rotLon, cx, cy, R, 1);
                    if (p.z > 0.01) { if (!started) { ctx.moveTo(p.x, p.y); started = true; } else ctx.lineTo(p.x, p.y); }
                    else started = false;
                }
                ctx.stroke();
            }
            ctx.restore();
            ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2);
            ctx.lineWidth = 1.4; ctx.strokeStyle = isDark ? 'rgba(56,189,248,0.34)' : 'rgba(59,130,246,0.38)'; ctx.stroke();
            const maxCnt = Math.max(1, ...nodes.map(n => n.count));
            // 模拟航线:访问量最大的节点为枢纽,连到访问量前 12 的节点(球面大圆航线)
            const hub = nodes.length ? nodes[0] : null;
            if (hub) {
                ctx.save();
                ctx.lineWidth = 1;
                const arcColor = isDark ? 'rgba(56,189,248,0.30)' : 'rgba(59,130,246,0.30)';
                for (const t of nodes.slice(1, 13)) {
                    const arc = geoArcPoints(hub.lat, hub.lon, t.lat, t.lon, 36);
                    ctx.beginPath();
                    let started = false;
                    for (const p of arc) {
                        const pr = geoProjectPoint(p.lat, p.lon, rotLat, rotLon, cx, cy, R, 1);
                        if (pr.z > 0.02) { if (!started) { ctx.moveTo(pr.x, pr.y); started = true; } else ctx.lineTo(pr.x, pr.y); }
                        else started = false;
                    }
                    ctx.strokeStyle = arcColor;
                    ctx.stroke();
                }
                ctx.restore();
            }
            let hoverPx = null;
            for (const n of nodes) {
                const p = geoProjectPoint(n.lat, n.lon, rotLat, rotLon, cx, cy, R, 1.02);
                if (p.z <= 0.02) continue;
                const r = Math.max(3, 4 + Math.sqrt(n.count / maxCnt) * 10);
                const isProv = n.kind === 'province';
                const col = isProv ? '#22d3ee' : '#a855f7';
                const alpha = Math.min(1, p.z * 1.4);
                ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
                ctx.fillStyle = 'rgba(15,23,42,0.55)'; ctx.fill();
                ctx.beginPath(); ctx.arc(p.x, p.y, r * 0.72, 0, Math.PI * 2);
                ctx.fillStyle = col; ctx.globalAlpha = 0.35 + alpha * 0.65; ctx.fill(); ctx.globalAlpha = 1;
                ctx.beginPath(); ctx.arc(p.x, p.y, r * 0.34, 0, Math.PI * 2);
                ctx.fillStyle = '#ffffff'; ctx.globalAlpha = 0.55 + alpha * 0.45; ctx.fill(); ctx.globalAlpha = 1;
                if (geoHoverNode === n) hoverPx = { x: p.x, y: p.y, n: n };
            }
            // 节点名字:访问量前 12 的节点显示名称
            ctx.save();
            ctx.font = '10px system-ui, sans-serif';
            ctx.textAlign = 'center';
            for (const n of nodes.slice(0, 12)) {
                const p = geoProjectPoint(n.lat, n.lon, rotLat, rotLon, cx, cy, R, 1.02);
                if (p.z <= 0.02) continue;
                const rr = Math.max(3, 4 + Math.sqrt(n.count / maxCnt) * 10);
                ctx.fillStyle = isDark ? 'rgba(226,232,240,0.92)' : 'rgba(30,41,59,0.88)';
                ctx.fillText(n.label, p.x, p.y - rr - 4);
            }
            ctx.restore();
            if (hoverPx) {
                const n = hoverPx.n;
                ctx.save();
                ctx.beginPath(); ctx.arc(hoverPx.x, hoverPx.y, 14, 0, Math.PI * 2);
                ctx.strokeStyle = '#00e5ff'; ctx.lineWidth = 1.6; ctx.setLineDash([4, 3]); ctx.stroke(); ctx.restore();
                const tip = document.getElementById('geoGlobeTip');
                if (tip) {
                    const pct = maxCnt ? Math.round(n.count / maxCnt * 100) : 0;
                    tip.innerHTML = '<strong>' + n.label + '</strong> (' + (n.kind === 'province' ? '省份' : '国家') + ')<br>访问 ' + n.count + ' 次 · 占比 ' + pct + '%';
                    const px = hoverPx.x, py = hoverPx.y;
                    tip.style.display = 'block';
                    tip.style.left = Math.max(4, Math.min(size - 176, px + 14)) + 'px';
                    tip.style.top = Math.max(4, Math.min(size - 80, py - 30)) + 'px';
                }
            } else {
                const tip = document.getElementById('geoGlobeTip');
                if (tip) tip.style.display = 'none';
            }
        }
        function geoEnsureWorldData() {
            if (geoWorldData || geoWorldLoading) return;
            geoWorldLoading = true;
            fetch('/api/geo-world').then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }).then(d => {
                geoWorldData = (d && Array.isArray(d.features)) ? d : null;
                geoWorldLoading = false;
                if (geoMode === 'world') geoDrawWorld();
            }).catch(() => { geoWorldLoading = false; if (geoMode === 'world') geoDrawWorld(); });
        }
        function geoDrawWorld() {
            const canvas = document.getElementById('geoWorldCanvas');
            if (!canvas) return;
            const nodes = geoBuildNodes().filter(n => n.kind === 'country' || n.kind === 'province');
            const dpr = Math.min(2, window.devicePixelRatio || 1);
            const W = 640, H = 340;
            canvas.width = W * dpr; canvas.height = H * dpr;
            canvas.style.width = '100%'; canvas.style.height = 'auto';
            const ctx = canvas.getContext('2d');
            ctx.save(); ctx.scale(dpr, dpr); ctx.clearRect(0, 0, W, H);
            const isDark = document.body.classList.contains('dark');
            ctx.fillStyle = isDark ? '#0d1b30' : '#eef5fd';
            ctx.fillRect(0, 0, W, H);
            const px = (lon) => (lon + 180) / 360 * W;
            const py = (lat) => (85 - lat) / 170 * H;
            // 世界地图轮廓(简化 GeoJSON,后端代理拉取;未加载完先画点位,加载完自动补轮廓)
            if (geoWorldData) {
                ctx.save();
                ctx.lineWidth = 0.7;
                for (const f of geoWorldData.features) {
                    const g = f.geometry;
                    if (!g) continue;
                    const polys = g.type === 'Polygon' ? [g.coordinates] : (g.type === 'MultiPolygon' ? g.coordinates : []);
                    for (const poly of polys) {
                        for (const ring of poly) {
                            ctx.beginPath();
                            for (let i = 0; i < ring.length; i++) {
                                const pt = ring[i];
                                const x = px(Number(pt[0])), y = py(Number(pt[1]));
                                if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
                            }
                            ctx.closePath();
                            ctx.fillStyle = isDark ? 'rgba(34,197,94,0.07)' : 'rgba(100,116,139,0.10)';
                            ctx.fill();
                            ctx.strokeStyle = isDark ? 'rgba(148,163,184,0.28)' : 'rgba(71,85,105,0.30)';
                            ctx.stroke();
                        }
                    }
                }
                ctx.restore();
            } else {
                geoEnsureWorldData();
                ctx.save(); ctx.strokeStyle = isDark ? 'rgba(148,163,184,0.12)' : 'rgba(59,130,246,0.14)'; ctx.lineWidth = 0.6;
                for (let lo = -180; lo <= 180; lo += 30) { ctx.beginPath(); ctx.moveTo(px(lo), 0); ctx.lineTo(px(lo), H); ctx.stroke(); }
                for (let la = -60; la <= 60; la += 30) { ctx.beginPath(); ctx.moveTo(0, py(la)); ctx.lineTo(W, py(la)); ctx.stroke(); }
                ctx.restore();
                ctx.save(); ctx.font = '11px system-ui, sans-serif'; ctx.fillStyle = isDark ? '#94a3b8' : '#64748b';
                ctx.textAlign = 'center'; ctx.fillText('世界地图加载中...', W / 2, H / 2 + 60); ctx.restore();
            }
            const maxCnt = Math.max(1, ...nodes.map(n => n.count));
            for (const n of nodes) {
                const x = px(n.lon), y = py(n.lat);
                const r = Math.max(3, 4 + Math.sqrt(n.count / maxCnt) * 12);
                const isProv = n.kind === 'province';
                const col = isProv ? '#22d3ee' : '#a855f7';
                ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
                ctx.fillStyle = 'rgba(15,23,42,0.5)'; ctx.fill();
                ctx.beginPath(); ctx.arc(x, y, r * 0.72, 0, Math.PI * 2);
                ctx.fillStyle = col; ctx.globalAlpha = 0.8; ctx.fill(); ctx.globalAlpha = 1;
                ctx.beginPath(); ctx.arc(x, y, r * 0.32, 0, Math.PI * 2);
                ctx.fillStyle = '#fff'; ctx.globalAlpha = 0.85; ctx.fill(); ctx.globalAlpha = 1;
            }
            nodes.slice(0, 12).forEach(n => {
                const x = px(n.lon), y = py(n.lat);
                ctx.save(); ctx.font = '11px system-ui, sans-serif'; ctx.fillStyle = isDark ? '#cbd5e1' : '#475569';
                ctx.textAlign = 'center'; ctx.fillText(n.label, x, y - 10); ctx.restore();
            });
        }
        function geoEnsureChinaChart() {
            const host = document.getElementById('geoChinaChart');
            if (!host) return;
            const run = () => {
                if (typeof echarts === 'undefined' || !geoData) return;
                if (!geoChinaLoaded) {
                    fetch('/api/geo-china').then(r => { if (!r.ok) throw new Error('地图数据拉取失败(HTTP ' + r.status + ')'); return r.json(); }).then(gj => {
                        if (!gj || gj.success === false) throw new Error(gj && gj.error || '地图数据为空');
                        echarts.registerMap('china', gj);
                        geoChinaLoaded = true;
                        geoChinaRender();
                    }).catch(e => { host.innerHTML = '<div style="padding:20px;color:var(--text-sec);font-size:12px;">中国地图加载失败: ' + e.message + '</div>'; });
                    return;
                }
                geoChinaRender();
            };
            if (typeof echarts !== 'undefined') { run(); return; }
            const s = document.createElement('script');
            s.src = 'https://cdn.staticfile.net/echarts/5.4.3/echarts.min.js';
            s.onload = run; s.onerror = function() {
                const s2 = document.createElement('script');
                s2.src = 'https://cdn.jsdelivr.net/npm/echarts@5.4.3/dist/echarts.min.js';
                s2.onload = run;
                host.appendChild(s2);
            };
            document.head.appendChild(s);
        }
        function geoChinaRender() {
            const host = document.getElementById('geoChinaChart');
            if (!host || typeof echarts === 'undefined' || !geoData) return;
            if (!geoChinaChart) geoChinaChart = echarts.init(host);
            const data = (geoData.provinces || []).map(p => ({ name: p.region, value: Number(p.count) || 0 }));
            geoChinaChart.setOption({
                tooltip: { trigger: 'item', formatter: function(params) { return params.name + ': ' + (params.value || 0) + ' 次访问'; } },
                visualMap: { min: 0, max: Math.max(1, ...data.map(d => d.value)), left: 8, bottom: 8, text: ['高', '低'], calculable: true, inRange: { color: ['#dbeafe', '#7c3aed', '#ff4d6d'] }, textStyle: { color: '#888' } },
                series: [{ name: '访问量', type: 'map', map: 'china', roam: false, label: { show: true, fontSize: 9, formatter: function(p) { return Number(p.value) > 0 ? p.name : ''; } }, emphasis: { label: { show: true, fontWeight: 'bold' } }, data: data }]
            });
        }
        function geoInitEvents() {
            const canvas = document.getElementById('geoGlobeCanvas');
            if (!canvas || canvas.dataset.bound) return;
            canvas.dataset.bound = '1';
            const getPos = (e) => {
                const r = canvas.getBoundingClientRect();
                return { x: (e.touches ? e.touches[0].clientX : e.clientX) - r.left, y: (e.touches ? e.touches[0].clientY : e.clientY) - r.top };
            };
            const down = (e) => { geoDragging = true; const p = getPos(e); geoDragX = p.x; geoDragY = p.y; e.preventDefault(); };
            const move = (e) => {
                const p = getPos(e);
                if (geoDragging) {
                    const dx = p.x - geoDragX, dy = p.y - geoDragY;
                    geoDragX = p.x; geoDragY = p.y;
                    const size = Math.min(420, canvas.parentElement.clientWidth || 420);
                    geoRotLon += dx / size * 180; geoRotLat = Math.max(-60, Math.min(60, geoRotLat + dy / size * 90));
                    geoDrawGlobe();
                } else {
                    const nodes = geoBuildNodes();
                    const size = Math.min(420, canvas.parentElement.clientWidth || 420);
                    const R = size * 0.40, cx = size / 2, cy = size / 2;
                    const rotLon = geoRotLon * Math.PI / 180, rotLat = geoRotLat * Math.PI / 180;
                    let hit = null, best = 30;
                    for (const n of nodes) {
                        const pr = geoProjectPoint(n.lat, n.lon, rotLat, rotLon, cx, cy, R, 1.02);
                        if (pr.z <= 0.02) continue;
                        const maxCnt = Math.max(1, ...nodes.map(x => x.count));
                        const rr = Math.max(5, 4 + Math.sqrt(n.count / maxCnt) * 10 + 6);
                        const d = Math.hypot(pr.x - p.x, pr.y - p.y);
                        if (d < rr && d < best) { best = d; hit = n; }
                    }
                    if (hit !== geoHoverNode) { geoHoverNode = hit; geoDrawGlobe(); }
                }
            };
            const up = () => { geoDragging = false; };
            canvas.addEventListener('mousedown', down);
            canvas.addEventListener('mousemove', move);
            canvas.addEventListener('mouseup', up);
            canvas.addEventListener('mouseleave', up);
            canvas.addEventListener('touchstart', down, { passive: false });
            canvas.addEventListener('touchmove', move, { passive: false });
            canvas.addEventListener('touchend', up);
            if (!geoAnimId) {
                geoAnimId = setInterval(function() {
                    const dash = document.getElementById('dashboardModal');
                    if (geoMode === '3d' && !geoDragging && dash && dash.style.display !== 'none') { geoRotLon = (geoRotLon + 0.12) % 360; geoDrawGlobe(); }
                }, 100);
            }
        }
        // =====================================
        // 数据大屏与统计逻辑 (适配手机端表格排版)
        // =====================================
        async function openDashboard() {
            document.getElementById('dashboardModal').style.display = 'block';
            loadHeatmap();
            try { loadVisitorGeo(); } catch (e) {}
            
            function parseTrafficToBytes(str) {
                if (!str || str === '0 B' || str.includes('异常') || str.includes('获取')) return 0;
                let val = parseFloat(str);
                if (str.includes('TB')) return val * 1099511627776;
                if (str.includes('GB')) return val * 1073741824;
                if (str.includes('MB')) return val * 1048576;
                if (str.includes('KB')) return val * 1024;
                return val;
            }

            let top5Container = document.getElementById('top5-simple-container');
            if (!top5Container) {
                top5Container = document.createElement('div');
                top5Container.id = 'top5-simple-container';
                const wrapper = document.querySelector('.table-wrapper');
                if(wrapper && wrapper.previousElementSibling) {
                    wrapper.parentNode.insertBefore(top5Container, wrapper.previousElementSibling);
                }
            }
            
            let top5Html = '<h3 style="margin-top: 30px; margin-bottom:16px;">${I.trophy} 今日节点流量消耗 TOP 5</h3><div style="background: rgba(120,120,120,0.05); padding: 16px; border-radius: 12px; border: 1px solid var(--border); margin-bottom: 20px;">';
            
            // ==========================================
            //  核心优化：听你的天才思路！直接去网页现有的卡片里“抓取”数据，绝不等待变量！
            // ==========================================
            const domCards = document.querySelectorAll('.route-item');
            let scrapedNodes = [];
            
            domCards.forEach(card => {
                const prefix = card.getAttribute('data-prefix') || '未知';
                let remark = prefix;
                const searchAttr = card.getAttribute('data-search');
                if (searchAttr) {
                    remark = searchAttr.replace(new RegExp(' ' + prefix + '$'), '').trim();
                }

                let bandwidth = '0 B';
                // 遍历卡片里所有的文本，找出带有流量单位的那个文本
                const spans = card.querySelectorAll('span');
                spans.forEach(span => {
                    const txt = span.innerText || '';
                    // 匹配例如: 1.5 GB, 500 MB, 0 B (双斜杠防转义丢失)
                    if (/^[\\d\\.]+\\s*(TB|GB|MB|KB|B)$/i.test(txt.trim())) {
                        bandwidth = txt.trim();
                    }
                });

                scrapedNodes.push({ prefix: prefix, remark: remark, todayBandwidth: bandwidth });
            });

            // 用抓取下来的真实数据直接计算 TOP 5
            if (scrapedNodes.length > 0) {
                const validNodes = scrapedNodes.filter(r => parseTrafficToBytes(r.todayBandwidth) > 0);
                const top5 = validNodes.sort((a, b) => parseTrafficToBytes(b.todayBandwidth) - parseTrafficToBytes(a.todayBandwidth)).slice(0, 5);
                
                if (top5.length > 0) {
                    top5Html += '<ul style="margin:0; padding-left: 20px; line-height: 2; font-size: 14px; color: var(--text);">';
                    top5.forEach((r, idx) => {
                        const rankColor = idx === 0 ? '#ff3b30' : (idx === 1 ? '#ff9500' : (idx === 2 ? '#ffcc00' : 'var(--text-sec)'));
                        top5Html += \`<li><strong style="color:\${rankColor}; font-size: 15px;">#\${idx+1}</strong> \${r.remark} (/\${r.prefix}) —— 消耗: <strong style="color:var(--primary); font-family: monospace;">\${r.todayBandwidth}</strong></li>\`;
                    });
                    top5Html += '</ul>';
                } else {
                    top5Html += '<div style="color:var(--text-sec); font-size:13px; text-align:center;">今日暂无节点产生流量</div>';
                }
            } else {
                top5Html += '<div style="color:var(--text-sec); font-size:13px; text-align:center;">主页暂无节点卡片</div>';
            }
            top5Html += '</div>';
            
            // 瞬间把 TOP 5 写入网页！
            top5Container.innerHTML = top5Html;


            // ==========================================
            //  正常加载下面的图表数据 (带有10秒防卡死超时保护)
            // ==========================================
            document.getElementById('logTableBody').innerHTML = '<tr><td colspan="5" style="text-align:center; padding: 30px;">数据分析引擎计算中...</td></tr>';
            document.getElementById('trafficToday').innerText = '拉取中...';
            document.getElementById('cfToday').innerText = '拉取中...';
            document.getElementById('cfWeek').innerText = '拉取中...';
            document.getElementById('cfMonth').innerText = '拉取中...';
            document.getElementById('cfQuotaText').innerText = '加载中...';
            document.getElementById('cfBandwidth').innerText = '拉取中...';
            document.getElementById('cfCacheRatio').innerText = '拉取中...';
            document.getElementById('cfBlocked').innerText = '拉取中...';
            document.getElementById('cf5xx').innerText = '拉取中...';
            loadCfUsage();
            document.getElementById('traffic7d').innerText = '拉取中...';
            document.getElementById('traffic30d').innerText = '拉取中...';

            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 10000);

                const res = await fetch('/api/analytics', { signal: controller.signal });
                clearTimeout(timeoutId);
                
                const data = await res.json();
                if(!data.success) throw new Error(data.error);

                updateChartColors();

                document.getElementById('trafficToday').innerText = data.trafficToday || '未知';
                document.getElementById('traffic7d').innerText = data.traffic7d || '未知';
                document.getElementById('traffic30d').innerText = data.traffic30d || '未知';

                const labels = data.trend.map(i => i.date.substring(5)); 
                const counts = data.trend.map(i => i.count);
                const trendCtx = document.getElementById('trendChart').getContext('2d');
                if(trendChartInstance) trendChartInstance.destroy();
                trendChartInstance = new Chart(trendCtx, {
                    type: 'line',
                    data: {
                        labels: labels,
                        datasets: [{ label: '有效播放 (次)', data: counts, borderColor: '#0071e3', backgroundColor: 'rgba(0,113,227,0.1)', fill: true, tension: 0.3 }]
                    },
                    options: { responsive: true, plugins: { title: { display: true, text: '过去 7 天全站播放并发趋势', font: {size: 16} } } }
                });

                const locLabels = data.locations.map(i => i.country === 'CN' ? '中国大陆' : (i.country || '未知'));
                const locCounts = data.locations.map(i => i.count);
                const locCtx = document.getElementById('locationChart').getContext('2d');
                if(locationChartInstance) locationChartInstance.destroy();
                locationChartInstance = new Chart(locCtx, {
                    type: 'doughnut',
                    data: {
                        labels: locLabels,
                        datasets: [{ data: locCounts, backgroundColor: ['#34c759', '#0071e3', '#ff9500', '#af52de', '#ff2d55', '#8e8e93'], borderWidth: 0 }]
                    },
                    options: { responsive: true, plugins: { title: { display: true, text: '独立访客来源地占比', font: {size: 16} } } }
                });

                const tbody = document.getElementById('logTableBody');
                tbody.innerHTML = '';
                if(data.recents.length === 0) {
                    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding: 30px;">暂无日志记录</td></tr>';
                } else {
                    data.recents.forEach(log => {
                        const tr = document.createElement('tr');
                        const isChina = log.country === 'CN';
                        const locText = isChina ? (log.region ? (log.region + (log.city ? ' ' + log.city : '')) : '中国大陆') : (log.country || 'Unknown');
                        tr.innerHTML = \`
                            <td data-label="访问时间" style="font-size:12px; white-space:nowrap;">\${log.timestamp}</td>
                            <td data-label="目标节点"><span class="badge" style="background:rgba(0,113,227,0.1);color:var(--primary);">\${log.prefix}</span></td>
                            <td data-label="真实 IP" style="font-family:monospace; font-size:13px; color:var(--text-sec); word-break:break-all;">\${log.ip}</td>
                            <td data-label="归属地"><span class="badge" style="background:\${isChina ? 'rgba(52,199,89,0.1)' : 'rgba(255,149,0,0.1)'}; color:\${isChina ? '#34c759' : '#ff9500'};">\${locText}</span></td>
                            <td data-label="设备标识 (UA)" style="font-size:12px; color:var(--text-sec); word-break: break-all; white-space: normal; text-align: right; line-height: 1.4;" title="\${log.ua}">\${log.ua}</td>
                        \`;
                        tbody.appendChild(tr);
                    });
                }

            } catch (e) {
                const errMsg = e.name === 'AbortError' ? '网络超时，CF 接口拥堵，请稍后重试' : e.message;
                document.getElementById('logTableBody').innerHTML = \`<tr><td colspan="5" style="text-align:center;color:#ff3b30; padding: 30px;">独立图表数据拉取失败: \${errMsg}</td></tr>\`;
            }
        }

        async function loadCfUsage() {
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 15000);
                const res = await fetch('/api/cfusage', { signal: controller.signal });
                clearTimeout(timeoutId);
                const data = await res.json();
                if (!data.success) {
                    ['cfToday','cfWeek','cfMonth'].forEach(function(id) { document.getElementById(id).innerText = '不可用'; });
                    ['cfBandwidth','cfCacheRatio','cfBlocked','cf5xx'].forEach(function(id) { document.getElementById(id).innerText = '不可用'; });
                    document.getElementById('cfQuotaText').innerText = '未配置 CF 统计变量';
                    document.getElementById('cfQuotaDetail').innerText = data.error || '缺少 CF_API_TOKEN 或 CF_ZONE_ID';
                    document.getElementById('cfCountryList').innerText = '暂无数据';
                    return;
                }
                var fmt = function(n) { return n.toLocaleString('zh-CN') + ' 次'; };
                document.getElementById('cfToday').innerText = fmt(data.today);
                document.getElementById('cfWeek').innerText = fmt(data.week);
                document.getElementById('cfMonth').innerText = fmt(data.month);
                document.getElementById('cfBandwidth').innerText = data.bandwidth ? (data.bandwidth / 1073741824).toFixed(2) + ' GB' : '0 GB';
                document.getElementById('cfCacheRatio').innerText = (data.cacheHitRatio || 0) + '%';
                document.getElementById('cfBlocked').innerText = (data.blocked || 0).toLocaleString('zh-CN') + ' 次';
                document.getElementById('cf5xx').innerText = ((data.statusCodes && data.statusCodes['5xx']) || 0).toLocaleString('zh-CN') + ' 次';
                document.getElementById('cfQuotaText').innerText = data.todayError ? '获取失败' : (data.usedPercent + '%');
                document.getElementById('cfQuotaBar').style.width = Math.min(100, data.usedPercent) + '%';
                var detail = '已用 ' + data.today.toLocaleString('zh-CN') + ' 次 / 10万 (' + data.usedPercent + '%) · 剩余 ' + data.remain.toLocaleString('zh-CN') + ' 次';
                if (data.todayError) detail += '（' + data.todayError + '）';
                document.getElementById('cfQuotaDetail').innerText = detail;
                // 状态码环形图
                var sc = data.statusCodes || { '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0 };
                var scCtx = document.getElementById('cfStatusChart').getContext('2d');
                if (cfStatusChartInstance) cfStatusChartInstance.destroy();
                cfStatusChartInstance = new Chart(scCtx, {
                    type: 'doughnut',
                    data: { labels: ['2xx','3xx','4xx','5xx'], datasets: [{ data: [sc['2xx'], sc['3xx'], sc['4xx'], sc['5xx']], backgroundColor: ['#34c759','#0a84ff','#ff9f0a','#ff3b30'], borderWidth: 0 }] },
                    options: { responsive: true, plugins: { legend: { position: 'right', labels: { color: '#8e8e93', boxWidth: 10 } } } }
                });
                // 分时折线（北京时间 24h）
                var hCtx = document.getElementById('cfHourChart').getContext('2d');
                if (cfHourChartInstance) cfHourChartInstance.destroy();
                cfHourChartInstance = new Chart(hCtx, {
                    type: 'line',
                    data: { labels: Array.from({length: 24}, function(_, i) { return i + 'h'; }), datasets: [{ label: '请求数', data: data.hours || [], borderColor: '#00e5ff', backgroundColor: 'rgba(0,229,255,0.1)', fill: true, tension: 0.3, pointRadius: 0 }] },
                    options: { responsive: true, plugins: { legend: { display: false } }, scales: { x: { ticks: { maxTicksLimit: 12, color: '#8e8e93' } }, y: { beginAtZero: true, ticks: { color: '#8e8e93' } } } }
                });
                // Top 国家
                var cl = document.getElementById('cfCountryList');
                if (data.countries && data.countries.length) {
                    var total = data.countries.reduce(function(a, c) { return a + c.count; }, 0) || 1;
                    cl.innerHTML = data.countries.map(function(c) {
                        var pct = Math.round(c.count / total * 100);
                        return '<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;"><span>' + c.country + '</span><div style="flex:1; margin:0 8px; height:4px; background:rgba(120,120,120,.2); border-radius:4px; overflow:hidden;"><div style="height:100%; width:' + pct + '%; background:linear-gradient(90deg,#00e5ff,#7c3aed);"></div></div><span>' + c.count.toLocaleString('zh-CN') + '</span></div>';
                    }).join('');
                } else {
                    cl.innerText = '暂无数据';
                }
            } catch(e) {
                ['cfToday','cfWeek','cfMonth'].forEach(function(id) { document.getElementById(id).innerText = '拉取失败'; });
                document.getElementById('cfQuotaText').innerText = '获取失败';
            }
        }

        function closeDashboard() { document.getElementById('dashboardModal').style.display = 'none'; }

        // ============ v3.6.31：播放热力图(最近 7 天 × 24 小时,反代真实播放请求命中统计) ============
        async function loadHeatmap() {
            const grid = document.getElementById('heatmapGrid');
            const sum = document.getElementById('heatmapSummary');
            if (!grid || !sum) return;
            try {
                const res = await fetch('/api/heatmap');
                if (!res.ok) throw new Error('HTTP ' + res.status);
                const data = await res.json();
                if (!data.ok) throw new Error(data.error || '接口错误');
                const days = data.days || [];
                const prefixTotals = data.prefixTotals || {};
                const total = data.total || 0;
                const maxHour = data.maxHour || 1;
                const routeMap = {};
                (window.globalRoutesData || []).forEach(function(r) { if (r && r.prefix) routeMap[r.prefix] = r.remark || r.prefix; });
                const nodeTotal = Object.keys(prefixTotals).map(function(k) {
                    const disp = routeMap[k] || k;
                    return '<span style="background:rgba(0,122,255,.08); border:1px solid rgba(0,122,255,.18); border-radius:6px; padding:2px 8px; margin-right:6px; display:inline-block;">' + disp + ': <b>' + prefixTotals[k] + '</b></span>';
                }).join('');
                sum.innerHTML = '总计播放请求 <b>' + total + '</b> 次 · 各节点:<div style="margin-top:6px;">' + (nodeTotal || '<span style="color:var(--text-sec);">暂无播放数据,配置节点后播放即开始统计</span>') + '</div>';
                const week = ['日', '一', '二', '三', '四', '五', '六'];
                let html = '<div style="min-width:560px;">';
                html += '<div style="display:grid; grid-template-columns:56px repeat(24,1fr); gap:3px; margin-bottom:4px;">';
                html += '<div></div>';
                for (let h = 0; h < 24; h++) html += '<div style="font-size:10px; color:var(--text-sec); text-align:center;">' + h + '</div>';
                html += '</div>';
                days.forEach(function(d, di) {
                    const dt = new Date();
                    dt.setDate(dt.getDate() - (days.length - 1 - di));
                    const dow = week[dt.getDay()];
                    html += '<div style="display:grid; grid-template-columns:56px repeat(24,1fr); gap:3px; margin-bottom:3px;">';
                    html += '<div style="font-size:10px; color:var(--text-sec); display:flex; align-items:center;">' + d.day + ' ' + dow + '</div>';
                    for (let h = 0; h < 24; h++) {
                        const v = d.hours[h] || 0;
                        const ratio = v / maxHour;
                        const a = Math.round(ratio * 200);
                        const b = Math.round(ratio * 0 + 20);
                        const bg = v === 0 ? 'rgba(120,120,120,0.08)' : 'rgba(0,122,255,' + (0.12 + ratio * 0.85) + ')';
                        html += '<div title="' + d.day + ' ' + h + '时: ' + v + '次" style="height:22px; border-radius:4px; background:' + bg + '; display:flex; align-items:center; justify-content:center; font-size:9px; color:' + (ratio > 0.5 ? '#fff' : 'var(--text-sec)') + ';">' + (v > 0 ? v : '') + '</div>';
                    }
                    html += '</div>';
                });
                html += '</div>';
                html += '<div style="display:flex; align-items:center; gap:6px; font-size:11px; color:var(--text-sec); margin-top:8px;">低 <span style="width:16px;height:16px;border-radius:3px;background:rgba(120,120,120,0.12);display:inline-block;"></span>';
                html += '<span style="width:16px;height:16px;border-radius:3px;background:rgba(0,122,255,.2);display:inline-block;"></span>';
                html += '<span style="width:16px;height:16px;border-radius:3px;background:rgba(0,122,255,.5);display:inline-block;"></span>';
                html += '<span style="width:16px;height:16px;border-radius:3px;background:rgba(0,122,255,.9);display:inline-block;"></span> 高</div>';
                grid.innerHTML = html;
            } catch (e) {
                grid.innerHTML = '<div style="font-size:12px; color:#ff3b30; padding:20px;">热力图加载失败: ' + e.message + '</div>';
                sum.innerHTML = '';
            }
        }

        async function loadIcons(forceUrl = null) {
            const grid = document.getElementById('iconGrid');
            grid.innerHTML = '<div style="grid-column: 1/-1; color: var(--text-sec); font-size: 13px; text-align: center;">加载图标库中...</div>';
            const targetUrl = forceUrl || localStorage.getItem('custom_icon_url') || DEFAULT_ICON_URL;
            const urlInput = document.getElementById('customIconUrlInput');
            if (urlInput) urlInput.value = targetUrl === DEFAULT_ICON_URL ? '' : targetUrl;
            try {
                const res = await fetch(targetUrl);
                const data = await res.json();
                if (data && data.icons && Array.isArray(data.icons)) {
                    globalIcons = data.icons;
                } else if (Array.isArray(data)) {
                    globalIcons = data;
                } else {
                    globalIcons = [];
                    for (const [key, val] of Object.entries(data)) { globalIcons.push({ name: key, url: val }); }
                }
                renderIconGrid('');
            } catch(e) { 
                grid.innerHTML = '<div style="grid-column: 1/-1; color: #ff3b30; font-size: 13px; text-align: center;">获取图标库失败，请检查链接或网络状态</div>';
            }
        }

        function setCustomIconLibrary() {
            const url = document.getElementById('customIconUrlInput').value.trim();
            if (!url) return showToast('⚠️ 请输入图标库 JSON 链接');
            if (!url.startsWith('http')) return showToast('⚠️ 请输入合法的 URL');
            localStorage.setItem('custom_icon_url', url);
            showToast('⏳ 正在加载自定义图标库...');
            loadIcons(url);
        }

        function resetIconLibrary() {
            localStorage.removeItem('custom_icon_url');
            document.getElementById('customIconUrlInput').value = '';
            showToast('🔄 已恢复默认图标库');
            loadIcons(DEFAULT_ICON_URL);
        }

        function renderIconGrid(filterText) {
            const grid = document.getElementById('iconGrid');
            const lowerFilter = filterText.toLowerCase();
            const filtered = globalIcons.filter(item => (item.name || '').toLowerCase().includes(lowerFilter));
            let html = \`<div class="icon-item" onclick="selectIcon('', '默认')" title="使用默认图标"><span style="font-size:22px;">${I.film}</span></div>\`;
            filtered.forEach(item => {
                html += \`<div class="icon-item" onclick="selectIcon('\${item.url}', '\${item.name}')" title="\${item.name}">
                            <img src="\${item.url}" loading="lazy" style="width: 32px; height: 32px; object-fit: contain; border-radius: 4px;">
                        </div>\`;
            });
            grid.innerHTML = html;
        }

        function filterIcons() { renderIconGrid(document.getElementById('iconSearch').value); }

        function toggleIconPicker(e) {
            e.stopPropagation();
            const panel = document.getElementById('iconPickerPanel');
            panel.style.display = panel.style.display === 'none' ? 'flex' : 'none';
        }

        function selectIcon(url, name) {
            document.getElementById('iconUrl').value = url;
            const preview = document.getElementById('iconPreview');
            const def = document.getElementById('iconDefault');
            const text = document.getElementById('iconSelectText');
            if(url) {
                preview.src = url; preview.style.display = 'block'; def.style.display = 'none';
                text.textContent = name; text.style.color = 'var(--text)';
            } else {
                preview.src = ''; preview.style.display = 'none'; def.style.display = 'block';
                text.textContent = '点击选择图标 (默认)'; text.style.color = 'var(--text-sec)';
            }
            document.getElementById('iconPickerPanel').style.display = 'none';
        }

        document.addEventListener('click', (e) => {
            const panel = document.getElementById('iconPickerPanel');
            const btn = document.getElementById('iconSelectBtn');
            if (panel && btn && panel.style.display !== 'none') {
                if (!panel.contains(e.target) && !btn.contains(e.target)) panel.style.display = 'none';
            }
        });

        function toggleDarkMode() {
            const isDark = document.body.classList.toggle('dark');
            document.documentElement.classList.toggle('dark', isDark);
            document.getElementById('themeToggle').innerHTML = isDark ? I.sun : I.moon;
            localStorage.setItem('emby_proxy_dark', isDark ? '1' : '0');
            if(trendChartInstance) { updateChartColors(); trendChartInstance.update(); locationChartInstance.update(); }
        }
        if (localStorage.getItem('emby_proxy_dark') === '1') { document.body.classList.add('dark'); document.documentElement.classList.add('dark'); document.getElementById('themeToggle').innerHTML = I.sun; }

        function genUuid() {
            if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
            const b = crypto.getRandomValues(new Uint8Array(16));
            b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
            const h = Array.from(b).map(x => x.toString(16).padStart(2, '0')).join('');
            return h.slice(0,8) + '-' + h.slice(8,12) + '-' + h.slice(12,16) + '-' + h.slice(16,20) + '-' + h.slice(20);
        }

        function showToast(msg) {
            const t = document.getElementById('toast');
            t.textContent = msg; t.classList.add('show');
            setTimeout(() => t.classList.remove('show'), 3000);
        }

        async function purgeCache() {
            if(!confirm('确定要清理 Cloudflare 节点的全站海报和静态缓存吗？\\n\\n清理后可能导致短时间的加载缓慢。')) return;
            const btn = document.getElementById('btnPurge');
            const originalText = btn.textContent;
            btn.textContent = '⏳ 正在清理...'; btn.disabled = true;
            try {
                const res = await fetch('/api/purge-cache', { method: 'POST' });
                const data = await res.json();
                if(data.success) showToast('✅ 缓存清理成功，新海报已生效！');
                else showToast('❌ 清理失败: ' + data.error);
            } catch(e) { showToast('❌ 网络请求错误'); } finally { btn.textContent = originalText; btn.disabled = false; }
        }

        let searchTimer = null;
        async function filterNodesList() {
            const input = document.getElementById('searchNode');
            if (!input) return;
            const filterText = input.value.trim().toLowerCase();
            const cards = document.querySelectorAll('.emby-card');
            if (!filterText) { cards.forEach(card => card.style.display = 'flex'); return; }
            // 本地先匹配(备注/后缀/管理员本地的线路地址),立即响应
            cards.forEach(card => {
                const searchStr = String(card.getAttribute('data-search') || '').toLowerCase() + ' ' + String(card.getAttribute('data-search2') || '').toLowerCase();
                card.style.display = searchStr.includes(filterText) ? 'flex' : 'none';
            });
            // 再服务端按源站链接匹配(订阅用户看不到链接也能用链接/域名搜出节点,防抖 300ms;同步普通版 3.4.48)
            clearTimeout(searchTimer);
            searchTimer = setTimeout(async () => {
                try {
                    const res = await fetch('/api/routes?q=' + encodeURIComponent(filterText));
                    const data = await res.json();
                    if (!Array.isArray(data)) return;
                    const hitPrefixes = new Set((data || []).map(r => r.prefix));
                    cards.forEach(card => {
                        const p = card.getAttribute('data-prefix');
                        if (p && hitPrefixes.has(p)) card.style.display = 'flex';
                    });
                } catch (e) {}
            }, 300);
        }

        function handleTargetInputs() {
            const container = document.getElementById('targetInputs');
            const inputs = container.querySelectorAll('.target-input');
            const lastInput = inputs[inputs.length - 1];
            if (lastInput.value.trim() !== '') {
                const newInput = document.createElement('input');
                newInput.type = 'url'; newInput.className = 'target-input';
                newInput.style = 'padding: 12px 16px; border: 1px solid var(--border); border-radius: 8px; background:var(--card); width: 100%;';
                newInput.oninput = handleTargetInputs;
                container.appendChild(newInput);
            }
            let emptyCount = 0;
            const currentInputs = container.querySelectorAll('.target-input');
            for (let i = currentInputs.length - 1; i >= 0; i--) {
                if (currentInputs[i].value.trim() === '') { emptyCount++; if (emptyCount > 1) currentInputs[i].remove(); } else { break; }
            }
            container.querySelectorAll('.target-input').forEach((inp, idx) => {
                inp.placeholder = idx === 0 ? "主线路地址 (如: http://1.1.1.1:8096)" : \`备用线路 \${idx} (选填，主源挂掉时触发)\`;
            });
        }

        function resetTargetInputs() {
            const container = document.getElementById('targetInputs');
            container.innerHTML = \`
                <input type="url" class="target-input" placeholder="主线路地址 (如: http://1.1.1.1:8096)" style="padding: 12px 16px; border: 1px solid var(--border); border-radius: 8px; background:var(--card); width: 100%;" required oninput="handleTargetInputs()">
                <input type="url" class="target-input" placeholder="备用线路 1 (选填)" style="padding: 12px 16px; border: 1px solid var(--border); border-radius: 8px; background:var(--card); width: 100%;" oninput="handleTargetInputs()">
            \`;
        }

        function toggleVis(id, isArray = false) {
            const el = document.getElementById(id);
            if (el.classList.contains('secret-text')) {
                el.classList.remove('secret-text'); el.classList.add('actual-text');
                if (isArray) {
                    const arr = JSON.parse(decodeURIComponent(el.getAttribute('data-val')));
                    let html = '';
                    arr.forEach((t, i) => {
                        const tag = i === 0 ? '<span style="color:#34c759;font-weight:bold;">[主]</span>' : '<span style="color:#ff9500;font-weight:bold;">[备]</span>';
                        html += \`<div class="url-list-item">\${tag} \${t}</div>\`;
                    });
                    el.innerHTML = html;
                } else { el.textContent = el.getAttribute('data-val'); }
            } else {
                el.classList.add('secret-text'); el.classList.remove('actual-text'); el.textContent = '••••••••';
            }
        }

        function copyTxt(txt) { navigator.clipboard.writeText(txt).then(() => showToast('🚀 复制成功！')); }

        async function pingTarget(idx, targetUrl) {
            const pingEl = document.getElementById('ping-' + idx);
            pingEl.textContent = '测速中...'; pingEl.style.color = 'var(--text-sec)';
            try {
                const res = await fetch('/api/ping-node?url=' + encodeURIComponent(targetUrl));
                const data = await res.json();
                if(data.ms >= 0) {
                    pingEl.textContent = data.ms + ' ms';
                    pingEl.style.color = data.ms < 200 ? '#34c759' : (data.ms < 500 ? 'var(--primary)' : '#ff9500');
                } else { pingEl.textContent = '断连/超时'; pingEl.style.color = '#ff3b30'; }
            } catch(e) { pingEl.textContent = '测速异常'; pingEl.style.color = '#ff3b30'; }
        }

        function pingAllNodes() {
            if (proxyNodesForPing.length === 0) return showToast('⚠️ 没有可供测速的反代节点');
            showToast('⚡ 正在对所有节点发起测速...');
            proxyNodesForPing.forEach((node, offset) => { setTimeout(() => pingTarget(node.idx, node.url), offset * 200); });
        }

        async function exportConfig() {
            try {
                const res = await fetch('/api/routes'); const data = await res.json();
                const blob = new Blob([JSON.stringify(data, null, 2)], {type: 'application/json'});
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a'); a.href = url; a.download = 'emby_proxy_backup.json'; a.click();
                URL.revokeObjectURL(url); showToast('✅ 配置已导出');
            } catch (e) { showToast('❌ 导出失败'); }
        }

        function importConfig() {
            const input = document.createElement('input'); input.type = 'file'; input.accept = '.json';
            input.onchange = async (e) => {
                const file = e.target.files[0]; const reader = new FileReader();
                reader.onload = async (event) => {
                    try {
                        const routes = JSON.parse(event.target.result);
                        const res = await fetch('/api/routes/import', { method: 'POST', body: JSON.stringify(routes) });
                        const result = await res.json();
                        if (result.success) { showToast('✅ 配置导入成功'); load(); } else throw new Error(result.error);
                    } catch (err) { showToast('❌ 导入失败: ' + err.message); }
                };
                reader.readAsText(file);
            };
            input.click();
        }

        async function load() {
            try {
                await Promise.all([loadPtState(), (window.ROLE && window.ROLE !== 'sub') ? loadNodeReqs() : Promise.resolve()]);
            } catch (e) {}
            try {
                const res = await fetch('/api/routes');
                if (!res.ok) throw new Error('请求失败，请检查环境配置');
                const data = await res.json();
                if (data.error) throw new Error(data.error);

                //  新增：把节点流量数据存进全局内存，供大屏瞬间读取！
                window.globalRoutesData = data;

                const container = document.getElementById('list-grid');
                if(data.length === 0) {
                    container.innerHTML = '<div style="text-align:center; color:var(--text-sec); grid-column: 1 / -1; padding: 40px;">暂无配置任何反代节点，请先部署一个。</div>';
                    return;
                }
                
                container.innerHTML = '';
                proxyNodesForPing = []; 
                const currentHost = window.location.host;

                data.forEach((r, idx) => {
                    const proxyUrl = entryUrl(r.prefix);
                    const targets = r.target ? r.target.split(',').map(s => s.trim()).filter(Boolean) : [];
                    const mainTarget = targets[0] || '';
                    
                    const remarkName = r.remark || '未命名媒体库';
                    // 未观看天数（基于改良后的真实观看 last_play；last_play 为 UTC+8 墙上时间字符串）
                    let watchDaysText = '暂无播放记录', watchOverdue = false;
                    if (r.last_play) {
                        try {
                            const lpUtc = Date.parse(r.last_play.replace(' ', 'T') + 'Z') - 8 * 3600000;
                            const diffDays = Math.floor((Date.now() - lpUtc) / 86400000);
                            watchDaysText = diffDays <= 0 ? '今天观看过' : (diffDays + ' 天前观看');
                            const wl = parseFloat(r.watch_limit);
                            if (wl > 0 && diffDays > wl) { watchOverdue = true; watchDaysText += ' · 已超 ' + (diffDays - wl) + ' 天'; }
                        } catch (e) {}
                    }
                    const lastPlay = r.last_play ? r.last_play : '暂无播放记录';
                    
                    const iconHtml = r.icon ? \`<img src="\${r.icon}" style="width:28px;height:28px;border-radius:6px;object-fit:cover;">\` : '${I.film}';
                    const pingAttr = mainTarget ? 'onclick="pingTarget(' + idx + ', \\'' + mainTarget + '\\')" title="点击重新测速"' : 'title="订阅模式不可测速"';
                    const pingText = mainTarget ? '测速中...' : '—';
                    const encodedTargets = encodeURIComponent(JSON.stringify(targets));
                    
                    //  伪装设备与保活状态解析（VPS 版同款）
                    let fakeClient = ''; let dlTrickOn = false;
                    try { const fp = r.custom_params ? JSON.parse(r.custom_params) : {}; fakeClient = fp.client || ''; dlTrickOn = !!fp.dlTrick; } catch(e){}
                    const fakeOn = (r.mode || '').includes('fake');
                    const kaOn = r.ka_enabled === '1';
                    const kaStatus = kaOn ? '已开启 · ' + (r.ka_days || 3) + '天' : '未开启';
                    const kaLast = r.last_ka_result ? ((r.last_ka_result === 'success' ? '✅ ' : '❌ ') + (r.last_ka_detail || '')) : '暂无记录';
                    // v3.6.68:下次保活时间优先读随机计划 ka_next_run;老数据无 ka_next_run 回退 last_ka_run + ka_days
                    const kaNext = r.ka_next_run ? new Date(r.ka_next_run).getTime() : (r.last_ka_run ? new Date(r.last_ka_run).getTime() + Math.max(0.1, parseFloat(r.ka_days) || 3) * 86400000 : 0);

                    //  接收后端传来的：单节点独立宽带与请求统计数据
                    const todayBw = r.todayBandwidth || '0 B';
                    const totalReqs = r.totalReqs || r.todayReqs || 0;

                    proxyNodesForPing.push({ idx: idx, url: mainTarget });

                    container.innerHTML += \`
                    <div class="emby-card route-item" data-prefix="\${esc(r.prefix)}" data-search="\${escHtml(remarkName)} \${esc(r.prefix)}" data-search2="\${escHtml(targets.join(' '))}">
                        <div class="card-header">
                            <div class="card-title-group" style="display: flex; align-items: center; gap: 10px;">
                                <div class="drag-handle admin-only" title="长按拖拽排序" style="margin: 0; display: flex; align-items: center;">${I.lines}</div>
                                <input type="checkbox" class="node-cb admin-only" value="\${r.prefix}" style="width: 18px; height: 18px; margin: 0; cursor: pointer; accent-color: var(--primary); flex-shrink: 0;">
                                <div class="emby-icon" style="margin: 0; display: flex; align-items: center;">\${iconHtml}</div>
                                <div>
                                    <div style="font-weight: 600; font-size: 16px; color: var(--text);">\${remarkName}</div>
                                    <div style="font-size: 13px; color: var(--text-sec); margin-top:2px;">/\${r.prefix}</div>
                                </div>
                            </div>
                            <div style="display:flex; align-items:center;">
                                <span class="badge" style="background: rgba(0,113,227,0.1); color: var(--primary);">\${modeNames[r.mode] || '未知'}</span>
                            </div>
                        </div>

                        <div class="node-summary" style="display:flex; align-items:center; gap:14px; flex-wrap:wrap; padding-top:2px;">
                            <span id="ping-\${idx}" class="ping-badge" \${pingAttr}>\${pingText}</span>
                            <span style="font-size:12px; color:var(--text-sec);">\${todayBw}</span>
                            <div style="margin-left:auto; display:flex; gap:8px; align-items:center;">
                                <button class="icon-btn" onclick="copyTxt('\${proxyUrl}')" title="复制直达链接">${SVG_COPY}</button>
                                <button class="icon-btn" onclick="toggleNodeDetail(this)" title="展开详情" style="transition:transform .25s;">${I.arrowdown}</button>
                            </div>
                        </div>

                        <div class="node-detail" style="display:none; flex-direction:column; gap:14px;">
                            <div style="background: rgba(120,120,120,0.05); border: 1px solid var(--border); border-radius: 10px; padding: 12px; display: flex; justify-content: space-between; flex-wrap: wrap; gap: 10px;">
                                <div style="display:flex; flex-direction: column; gap: 4px;">
                                    <span style="font-size:12px; color:var(--text-sec);">${I.arrowdown} 今日产生总流量</span>
                                    <span style="font-size:16px; font-weight:700; color:var(--primary);">\${todayBw}</span>
                                </div>
                                <div style="display:flex; flex-direction: column; gap: 4px; text-align: right;">
                                    <span style="font-size:12px; color:var(--text-sec);">${I.tv} 播放次数 (今日/累计)</span>
                                    <span style="font-size:16px; font-weight:700; color:#ff9500;">\${r.todayReqs} / \${totalReqs} 次</span>
                                </div>
                            </div>

                            <div style="display: flex; flex-direction: column; gap: 10px;">
                                <div class="info-row">
                                    <span class="info-label">直达链接:</span>
                                    <div class="action-group" style="flex:1; justify-content: flex-end; margin-left: 10px; align-items: flex-start;">
                                        <span id="p-\${idx}" data-val="\${proxyUrl}" class="secret-text dynamic-url">••••••••</span>
                                        <button class="icon-btn" style="margin-top: 2px;" onclick="toggleVis('p-\${idx}')" title="查看明文">${SVG_EYE}</button>
                                        <button class="icon-btn" style="margin-top: 2px;" onclick="copyTxt('\${proxyUrl}')" title="复制链接">${SVG_COPY}</button>
                                    </div>
                                </div>
                                <div class="info-row admin-only">
                                    <span class="info-label">源站线路:</span>
                                    <div class="action-group" style="flex:1; justify-content: flex-end; margin-left: 10px; align-items: flex-start;">
                                        <div id="t-\${idx}" data-val="\${encodedTargets}" class="secret-text dynamic-url">••••••••</div>
                                        <button class="icon-btn" style="margin-top: 2px;" onclick="toggleVis('t-\${idx}', true)" title="查看明文">${SVG_EYE}</button>
                                    </div>
                                </div>
                                <div class="info-row">
                                    <span class="info-label">海报缓存:</span>
                                    <span style="color:\${r.cache_img !== 'off' ? '#34c759' : '#ff9500'}; font-weight:600;">\${r.cache_img !== 'off' ? '${I.check} 已开启' : '${I.xmark} 已关闭'}</span>
                                </div>
                                <div class="info-row">
                                    <span class="info-label">下载伪装:</span>
                                    <span style="color:\${dlTrickOn ? '#34c759' : 'var(--text-sec)'}; font-weight:600;">\${dlTrickOn ? '${I.check} 已开启' : '${I.xmark} 已关闭'}</span>
                                </div>
                                <div class="info-row">
                                    <span class="info-label">最后活跃:</span>
                                    <span style="color:\${watchOverdue ? '#ff3b30' : 'var(--text-sec)'}; font-weight:\${watchOverdue ? '700' : 'normal'};">\${watchOverdue ? I.warn + ' ' : ''}\${watchDaysText}</span>
                                </div>
                                <div class="info-row">
                                    <span class="info-label">伪装设备:</span>
                                    <span style="color:\${fakeOn && fakeClient ? '#5856d6' : 'var(--text-sec)'}; font-weight:600;">\${fakeOn && fakeClient ? fakeClient : '未开启'}</span>
                                </div>
                                <div class="info-row">
                                    <span class="info-label">自动保活:</span>
                                    <span style="color:\${kaOn ? '#34c759' : 'var(--text-sec)'}; font-weight:600;">\${kaStatus}</span>
                                </div>
                                <div class="info-row">
                                    <span class="info-label">下次保活:</span>
                                    <span class="ka-cd" data-ka-next="\${kaNext}" style="color:var(--text-sec);">待首次执行</span>
                                </div>
                                <div class="info-row">
                                    <span class="info-label">上次保活:</span>
                                    <span style="color:var(--text-sec);">\${kaLast}</span>
                                </div>
                            </div>

                            <div class="card-footer admin-only">
                                <button class="btn-edit" onclick="kaRun('\${r.prefix}')" title="立即执行一次完整保活">保活</button>
                                <button class="btn-edit" onclick="rexImport('\${r.prefix}')" title="生成 Rex 一键导入链接">Rex导入</button>
                                <button class="btn-edit" onclick="editNode('\${esc(r.prefix)}', '\${esc(r.target)}', '\${esc(r.mode)}', '\${esc(r.remark || '')}', '\${esc(r.icon || '')}', '\${esc(r.cache_img)}', '\${esc(r.custom_params ? encodeURIComponent(r.custom_params) : '')}', '\${esc(r.ka_enabled || '0')}', '\${esc(r.ka_days || '3')}', '\${esc(r.ka_token || '')}', '\${esc(r.node_user || '')}', '\${esc(r.node_pass || '')}', '\${esc(r.watch_limit || '0')}', '\${esc(r.emos_id || '')}', '\${esc(r.emos_name || '')}', '\${esc(r.emos_aggregate || 'off')}')">编辑配置</button>
                                <button class="btn-del" onclick="del('\${r.prefix}')">删除</button>
                            </div>
                        </div>
                    </div>\`;;

                    if (mainTarget) setTimeout(() => pingTarget(idx, mainTarget), 500 * idx); 
                });
                
                filterNodesList();

                if (sortableInstance) sortableInstance.destroy();
                sortableInstance = Sortable.create(container, {
                    handle: '.drag-handle',
                    animation: 150,
                    delay: 200, 
                    delayOnTouchOnly: true,
                    onEnd: async function () {
                        const items = [];
                        container.querySelectorAll('.route-item').forEach((row, index) => {
                            const prefix = row.getAttribute('data-prefix');
                            if (prefix) items.push({ prefix: prefix, sort_order: index });
                        });
                        try {
                            await fetch('/api/routes/reorder', { method: 'POST', body: JSON.stringify(items) });
                            showToast('✅ 排序已保存');
                        } catch(e) { showToast('❌ 排序保存失败'); }
                    }
                });

            } catch (err) {
                document.getElementById('list-grid').innerHTML = \`<div style="text-align:center; color:#ff3b30; font-weight:600; grid-column: 1 / -1; padding: 20px;">${I.warn} 读取失败: \${err.message}</div>\`;
            }
        }

        function toggleCustomParams() {
            const mode = document.getElementById('mode').value;
            document.getElementById('customParamsDiv').style.display = (mode.includes('fake') || mode === 'custom') ? 'flex' : 'none';
            // v3.6.57:EMOS 模式已移除,EMOS 字段区不再显示(历史节点仍保留 emos_id/emos_name/emos_aggregate 数据)
            const emosEl = document.getElementById('emosFields');
            if (emosEl) emosEl.style.display = 'none';
        }

        function applyFakeTemplate(type) {
            const templates = {
                'senplayer': { client: 'SenPlayer', version: '6.2.2', device: 'iPhone', ua: 'SenPlayer/6.2.2' },
                'eplayerx': { client: 'EplayerX', version: '10.0.22', device: 'iPhone', ua: 'EplayerX/10.0.22' },
                'forward': { client: 'Forward', version: '1.3.18', device: 'iPhone', ua: 'Forward-Standard/1.3.18' },
                'rex': { client: 'Rex', version: '1.0.1', device: 'iPhone17,2', ua: 'Rex/1.0.1' },
                'hills': { client: 'Hills', version: '1.6.0', device: 'PD2505', ua: 'Hills/1.6.0 (android; 16)' },
                'yamby': { client: 'Yamby', version: '2.0.0.5', device: 'vivo-V2505A', ua: 'Yamby/2.0.0.5(Android)' },
                'clear': { client: '', version: '', device: '', ua: '' }
            };
            const tpl = templates[type];
            if(tpl) {
                document.getElementById('customClient').value = tpl.client;
                document.getElementById('customVersion').value = tpl.version;
                document.getElementById('customDevice').value = tpl.device;
                document.getElementById('customUa').value = tpl.ua;
                if (type !== 'clear' && !document.getElementById('customDeviceId').value) document.getElementById('customDeviceId').value = genUuid();
                showToast('✅ 已应用 ' + (type === 'clear' ? '清空' : tpl.client) + ' 预设');
            }
        }

        const esc = s => String(s == null ? '' : s).replaceAll('"', '\\\\"').replaceAll("'", "\\\\'");
        function editNode(prefix, targetStr, mode, remark, icon, cacheImg, customParamsStr, kaEnabled, kaDays, kaToken, nodeUser, nodePass, watchLimit, emosId, emosName, emosAggregate) {
            document.getElementById('oldPrefix').value = prefix;
            document.getElementById('remark').value = remark;
            document.getElementById('prefix').value = prefix;
            const modeSel = document.getElementById('mode');
            if (mode && ![...modeSel.options].some(o => o.value === mode)) {
                const opt = document.createElement('option');
                opt.value = mode; opt.textContent = mode + '（自定义）';
                modeSel.appendChild(opt);
            }
            modeSel.value = mode || 'off';
            document.getElementById('nodeCache').checked = (cacheImg !== 'off');
            
            let customParams = {};
            if (customParamsStr) {
                try { customParams = JSON.parse(decodeURIComponent(customParamsStr)); } catch(e){}
            }
            document.getElementById('nodeDlTrick').checked = !!customParams.dlTrick;
            document.getElementById('customClient').value = customParams.client || '';
            document.getElementById('customVersion').value = customParams.version || '';
            document.getElementById('customDevice').value = customParams.device || '';
            document.getElementById('customDeviceId').value = customParams.deviceId || '';
            document.getElementById('customUa').value = customParams.ua || '';
            document.getElementById('nodeEmosId').value = emosId || 'eK3QYG29Ms';
            document.getElementById('nodeEmosName').value = emosName || '玛卡巴卡的反代面板';
            document.getElementById('nodeEmosAggregate').checked = (emosAggregate === 'on');
            toggleCustomParams();
            document.getElementById('kaEnabled').checked = (kaEnabled === '1');
            document.getElementById('kaDays').value = kaDays || '3';
            document.getElementById('kaToken').value = kaToken || '';
            document.getElementById('nodeUser').value = nodeUser || '';
            document.getElementById('nodePass').value = nodePass || '';
            document.getElementById('watchLimit').value = watchLimit || '0';
            
            if (icon) {
                const foundItem = globalIcons.find(i => i.url === icon);
                selectIcon(icon, foundItem ? foundItem.name : '已选择图标');
            } else {
                selectIcon('', '默认');
            }

            document.getElementById('submitBtn').textContent = '保存修改';
            
            const container = document.getElementById('targetInputs');
            container.innerHTML = '';
            const targets = targetStr.split(',').map(s => s.trim()).filter(Boolean);
            
            targets.forEach((url) => {
                const inp = document.createElement('input');
                inp.type = 'url'; inp.className = 'target-input'; inp.value = url;
                inp.style = 'padding: 12px 16px; border: 1px solid var(--border); border-radius: 8px; background:var(--card); width: 100%;';
                inp.oninput = handleTargetInputs;
                container.appendChild(inp);
            });
            
            const emptyInp = document.createElement('input');
            emptyInp.type = 'url'; emptyInp.className = 'target-input';
            emptyInp.style = 'padding: 12px 16px; border: 1px solid var(--border); border-radius: 8px; background:var(--card); width: 100%;';
            emptyInp.oninput = handleTargetInputs;
            container.appendChild(emptyInp);
            
            handleTargetInputs(); 
            document.getElementById('nodeModalTitle').textContent='编辑节点';
            document.getElementById('nodeModal').style.display='block';
        }
        function kaRingHtml(pct, color) {
            const circ = 2 * Math.PI * 42;
            const offset = (circ * (1 - pct / 100)).toFixed(2);
            return '<div style="display:flex;flex-direction:column;align-items:center;padding:4px 0 10px;">'
                + '<div style="position:relative;width:100px;height:100px;">'
                + '<svg width="100" height="100" viewBox="0 0 100 100">'
                + '<circle cx="50" cy="50" r="42" fill="none" stroke="var(--line,#e3e3e8)" stroke-width="8"/>'
                + '<circle cx="50" cy="50" r="42" fill="none" stroke="' + color + '" stroke-width="8" stroke-linecap="round" stroke-dasharray="' + circ.toFixed(2) + '" stroke-dashoffset="' + offset + '" transform="rotate(-90 50 50)" style="transition:stroke-dashoffset .45s ease"/>'
                + '</svg>'
                + '<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:700;">' + pct + '%</div>'
                + '</div>'
                + '</div>';
        }

        async function kaRun(prefix) {
            const box = document.getElementById('kaResultBox');
            box.innerHTML = '<div style="color:var(--text-sec);">正在对 /' + prefix + ' 执行保活（登录 → 拉流 40MB → 快进 90 秒进度上报）…</div>';
            document.getElementById('kaModal').style.display = 'block';
            // 执行期间每 1.5s 轮询实时进度（环形进度条 + 当前剧名），避免看起来像卡住
            const poll = setInterval(async () => {
                try {
                    const res2 = await fetch('/api/keepalive/status');
                    const d = await res2.json();
                    if (!d || !d.running) return;
                    const pct = Math.max(0, Math.min(100, Math.round(d.progress || 0)));
                    let now = '';
                    if (d.mediaTitle) now = '<div style="margin-top:6px;font-size:12px;color:#3478f6;font-weight:600;text-align:center;">正在模拟看：' + d.mediaTitle + '</div>';
                    let h = kaRingHtml(pct, '#34c759')
                        + '<div style="margin-top:-4px;font-size:12px;color:var(--text-sec);text-align:center;">' + (d.current || '执行中…') + '</div>'
                        + now;
                    if (d.steps && d.steps.length) {
                        h += '<div style="margin-top:8px;font-weight:600;">已完成 ' + d.steps.length + ' 步：</div>';
                        d.steps.forEach(x => { h += '<div style="color:' + (x.ok ? '#34c759' : '#ff3b30') + ';">' + (x.ok ? '✅' : '❌') + ' ' + x.name + '</div>'; });
                    }
                    box.innerHTML = h;
                } catch (e) {}
            }, 1500);
            try {
                const res = await fetch('/api/keepalive/run', { method: 'POST', body: JSON.stringify({ prefix }) });
                const data = await res.json();
                clearInterval(poll);
                if (data.error) { box.innerHTML = '<div style="color:#ff3b30;">' + escHtml(data.error) + '</div>'; return; }
                box.innerHTML = '<div style="color:#34c759;font-weight:600;margin-bottom:6px;">✅ ' + escHtml(data.msg || '') + '</div>'
                    + '<div style="color:var(--text-sec);margin-bottom:12px;">' + (data.queuePos === 0 ? '正在执行,保活中心将实时显示每一步进度' : '已按卡片顺序排队,轮到后自动执行,可随时打开保活中心查看') + '</div>'
                    + '<button class="btn-submit" style="width:100%;" onclick="openKaCenter()">打开保活中心看进度</button>';
                openKaCenter();
            } catch (e) {
                clearInterval(poll);
                box.innerHTML = '<div style="color:#ff3b30;">请求失败: ' + escHtml(e.message) + '</div>';
            }
            load();
        }
        function closeKaModal() { document.getElementById('kaModal').style.display = 'none'; }
        // v3.6.39:手动取消单个任务 / 清空全部保活+下载任务
        async function cancelKaItem(id) {
            if (!confirm('确认取消该保活任务？')) return;
            try {
                const res = await fetch('/api/ka-cancel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
                const d = await res.json();
                showToast(d.success ? '✅ 已取消该任务' : '❌ ' + (d.error || '取消失败'));
                refreshKaCenter();
            } catch (e) { showToast('❌ ' + e.message); }
        }
        async function clearKaAll() {
            if (!confirm('确认清空全部保活/下载任务？(队列、当前执行、下载计数将全部清除，历史记录保留)')) return;
            try {
                const res = await fetch('/api/ka-clear', { method: 'POST' });
                const d = await res.json();
                showToast(d.success ? '✅ 已清空全部任务' : '❌ ' + (d.error || '清空失败'));
                refreshKaCenter();
            } catch (e) { showToast('❌ ' + e.message); }
        }

        /* ===== 保活中心(v3.6.0):实时显示当前执行 + 排队 + 最近完成 ===== */
        function kaFmtTime(t) {
            if (!t) return '';
            try {
                const d = new Date(t);
                const now = new Date();
                const diff = now - d;
                if (diff < 60000) return Math.max(0, Math.round(diff / 1000)) + '秒前';
                if (diff < 3600000) return Math.round(diff / 60000) + '分钟前';
                return (d.getMonth() + 1) + '-' + d.getDate() + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
            } catch (e) { return ''; }
        }
        async function refreshKaCenter() {
            try {
                const res = await fetch('/api/keepalive/status');
                const d = await res.json();
                const box = document.getElementById('kaCenterBody');
                if (!box) return;
                let h = '';
                if (d.dlActive > 0) h += '<div style="background:rgba(255,159,10,.12);border:1px solid rgba(255,159,10,.35);color:#ff9f0a;padding:10px 14px;border-radius:10px;font-size:13px;margin-bottom:12px;">⏬ 当前有下载正在进行，保活自动让位，下载结束后继续</div>';
                h += '<div style="font-weight:600;margin-bottom:8px;font-size:14px;">当前执行</div>';
                if (d.running) {
                    h += '<div style="background:rgba(52,199,89,.08);border:1px solid rgba(52,199,89,.3);border-radius:12px;padding:14px;">'
                        + '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;margin-bottom:6px;">'
                        + '<span style="font-weight:600;font-size:14px;">' + escHtml(d.prefix || '') + '</span>'
                        + '<span style="color:var(--text-sec);font-size:12px;">' + escHtml(d.mediaTitle || '') + '</span></div>'
                        + '<div style="font-size:13px;margin-bottom:8px;">' + escHtml(d.current || '') + '</div>'
                        + '<div style="background:rgba(120,120,120,.15);height:8px;border-radius:4px;overflow:hidden;margin-bottom:10px;"><div style="width:' + Math.max(2, Math.min(100, d.progress || 0)) + '%;height:100%;background:linear-gradient(90deg,#34c759,#5ac8fa);border-radius:4px;transition:width .5s;"></div></div>'
                        + (d.steps && d.steps.length ? d.steps.map(ss => '<div style="font-size:12px;color:' + (ss.ok ? '#34c759' : '#ff3b30') + ';margin:3px 0;">' + (ss.ok ? '✅' : '❌') + ' ' + escHtml(ss.name) + ' — ' + escHtml(ss.detail) + '</div>').join('') : '')
                        + '</div>';
                } else {
                    h += '<div style="color:var(--text-sec);font-size:13px;padding:10px 0;">暂无执行中的保活任务</div>';
                }
                const queue = d.queue || [];
                h += '<div style="font-weight:600;margin:14px 0 8px;font-size:14px;display:flex;justify-content:space-between;align-items:center;">等待队列（' + queue.length + '）' + (queue.length ? '<button class="btn-ghost" onclick="clearKaAll()" style="padding:4px 10px;font-size:12px;flex-shrink:0;">清空全部</button>' : '') + '</div>';
                if (queue.length) {
                    h += '<div style="display:flex;flex-direction:column;gap:6px;">' + queue.map((it, i) => {
                        return '<div style="display:flex;align-items:center;gap:8px;background:rgba(120,120,120,.06);border:1px solid var(--border);border-radius:10px;padding:9px 12px;font-size:13px;">'
                            + '<span style="color:var(--text-sec);width:16px;text-align:center;">' + (i + 1) + '</span>'
                            + '<span style="flex:1;font-weight:600;">' + escHtml(it.prefix) + '</span>'
                            + '<span style="font-size:12px;color:var(--text-sec);">' + (it.kind === 'manual' ? '手动' : '自动') + '</span>'
                            + (it.status === 'running' ? '<span style="color:#34c759;font-weight:600;">执行中</span>' : (it.status === 'waiting' ? '<span style="color:#ff9f0a;">排队中</span>' : escHtml(it.status)))
                            + '<button class="btn-ghost" onclick="cancelKaItem(' + it.id + ')" style="padding:3px 10px;font-size:12px;flex-shrink:0;">取消</button>'
                            + '</div>';
                    }).join('') + '</div>';
                } else {
                    h += '<div style="color:var(--text-sec);font-size:13px;padding:6px 0;">队列空闲</div>';
                }
                const hist = d.history || [];
                h += '<div style="font-weight:600;margin:14px 0 8px;font-size:14px;">最近完成</div>';
                if (hist.length) {
                    window._kaHist = hist;
                    h += '<div style="display:flex;flex-direction:column;gap:6px;">' + hist.map((it, idx) =>
                        '<div onclick="openKaDetail(' + idx + ')" style="display:flex;align-items:center;gap:8px;background:rgba(120,120,120,.04);border-radius:10px;padding:8px 12px;font-size:12px;cursor:pointer;">'
                        + '<span style="color:' + (it.ok ? '#34c759' : '#ff3b30') + ';">' + (it.ok ? '✅' : '❌') + '</span>'
                        + '<span style="flex:1;">' + escHtml(it.prefix) + ' <span style="color:var(--text-sec);">(' + (it.kind === 'manual' ? '手动' : '自动') + ')</span></span>'
                        + '<span style="color:var(--text-sec);max-width:34%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + escHtml(it.msg) + '</span>'
                        + '<span style="color:var(--text-sec);flex-shrink:0;">' + kaFmtTime(it.finishedAt) + '</span>'
                        + '<span style="color:var(--primary);flex-shrink:0;">›</span>'
                        + '</div>').join('') + '</div>';
                } else {
                    h += '<div style="color:var(--text-sec);font-size:13px;padding:6px 0;">暂无完成记录</div>';
                }
                box.innerHTML = h;
            } catch (e) {}
        }
        /* ===== v3.6.5:保活记录详情 ===== */
        function kaFmtBytes(b) {
            b = parseInt(b || 0, 10); if (!b) return '0 B';
            if (b >= 1073741824) return (b / 1073741824).toFixed(2) + ' GB';
            if (b >= 1048576) return (b / 1048576).toFixed(1) + ' MB';
            if (b >= 1024) return (b / 1024).toFixed(0) + ' KB';
            return b + ' B';
        }
        function kaFmtPos(ticks) {
            const sec = Math.max(0, Math.floor(parseInt(ticks, 10) || 0) / 10000000);
            const h = Math.floor(sec / 3600), mm = Math.floor(sec % 3600 / 60), ss = Math.floor(sec % 60);
            return (h > 0 ? String(h).padStart(2, '0') + ':' : '') + String(mm).padStart(2, '0') + ':' + String(ss).padStart(2, '0');
        }
        function openKaDetail(idx) {
            const hist = window._kaHist || [];
            const it = hist[idx]; if (!it) return;
            let detail = null; try { detail = it.detail ? JSON.parse(it.detail) : null; } catch (e) {}
            const m = document.getElementById('kaDetailModal'); if (!m) return;
            let h = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;font-size:12px;">'
                + '<span style="font-weight:600;">' + (it.ok ? '✅ 保活成功' : '❌ 保活失败') + ' · ' + escHtml(it.prefix) + '</span>'
                + '<span style="color:var(--text-sec);">' + kaFmtTime(it.finishedAt) + '</span></div>';
            if (detail) {
                h += '<div style="display:flex;flex-direction:column;gap:9px;font-size:13px;">'
                    + '<div style="display:flex;justify-content:space-between;gap:12px;"><span style="color:var(--text-sec);">正在看的剧</span><span style="font-weight:600;text-align:right;">' + escHtml(detail.title || '未知') + '</span></div>'
                    + '<div style="display:flex;justify-content:space-between;gap:12px;"><span style="color:var(--text-sec);">拉流数据量</span><span style="font-weight:600;">' + kaFmtBytes(detail.streamBytes) + '</span></div>'
                    + '<div style="display:flex;justify-content:space-between;gap:12px;"><span style="color:var(--text-sec);">模拟观看时长</span><span style="font-weight:600;">' + (parseInt(detail.playSec, 10) || 0) + ' 秒</span></div>'
                    + '<div style="display:flex;justify-content:space-between;gap:12px;"><span style="color:var(--text-sec);">观看到位置</span><span style="font-weight:600;">' + kaFmtPos(detail.startTicks) + ' → ' + kaFmtPos(detail.endTicks) + '</span></div>'
                    + '</div>';
            }
            if (it.msg) h += '<div style="margin-top:12px;font-size:12px;color:var(--text-sec);border-top:1px solid var(--border);padding-top:8px;">' + escHtml(it.msg) + '</div>';
            document.getElementById('kaDetailBody').innerHTML = h;
            m.style.display = 'block';
        }
        function closeKaDetail() { const m = document.getElementById('kaDetailModal'); if (m) m.style.display = 'none'; }

        function openKaCenter() {
            document.getElementById('kaCenterModal').style.display = 'block';
            refreshKaCenter();
            if (window._kaCenterTimer) clearInterval(window._kaCenterTimer);
            window._kaCenterTimer = setInterval(refreshKaCenter, 3000);
        }
        function closeKaCenter() {
            document.getElementById('kaCenterModal').style.display = 'none';
            if (window._kaCenterTimer) { clearInterval(window._kaCenterTimer); window._kaCenterTimer = null; }
        }

        /* 保活结果通知 toast */
        function kaToast(msg, ok) {
            let box = document.getElementById('kaToastBox');
            if (!box) {
                box = document.createElement('div');
                box.id = 'kaToastBox';
                box.style.cssText = 'position:fixed;top:14px;right:14px;z-index:99999;display:flex;flex-direction:column;gap:8px;';
                document.body.appendChild(box);
            }
            const el = document.createElement('div');
            el.style.cssText = 'background:' + (ok ? '#34c759' : '#ff3b30') + ';color:#fff;padding:10px 14px;border-radius:10px;font-size:13px;box-shadow:0 4px 16px rgba(0,0,0,.2);max-width:300px;word-break:break-all;';
            el.textContent = msg;
            box.appendChild(el);
            setTimeout(() => { el.style.transition = 'opacity .3s'; el.style.opacity = '0'; setTimeout(() => el.remove(), 320); }, 2800);
        }

        /* 保活倒计时 */
        function kaFmtRemain(ms) {
            if (ms <= 0) return '已到期，等待执行';
            const d = Math.floor(ms / 86400000), h = Math.floor(ms % 86400000 / 3600000), m = Math.floor(ms % 3600000 / 60000), s = Math.floor(ms % 60000 / 1000);
            if (d > 0) return d + '天' + h + '小时';
            if (h > 0) return h + '小时' + m + '分';
            if (m > 0) return m + '分' + s + '秒';
            return s + '秒';
        }
        function updateKaCountdown() {
            document.querySelectorAll('.ka-cd[data-ka-next]').forEach(el => {
                const next = parseInt(el.getAttribute('data-ka-next'), 10);
                if (!next) { el.textContent = '待首次执行'; return; }
                const remain = next - Date.now();
                el.textContent = remain <= 0 ? '已到期，等待执行' : kaFmtRemain(remain);
            });
        }
        setInterval(updateKaCountdown, 1000);

        /* 保活结果通知轮询 */
        let kaNoticeInited = false, lastKaNoticeT = 0;
        async function pollKaNotices() {
            try {
                const res = await fetch('/api/keepalive/notices');
                const d = await res.json();
                const list = (d.notices || []);
                if (!kaNoticeInited) { lastKaNoticeT = list.reduce((m, n) => Math.max(m, n.time || 0), 0); kaNoticeInited = true; return; }
                for (const n of list) {
                    if (n.time && n.time > lastKaNoticeT) {
                        lastKaNoticeT = Math.max(lastKaNoticeT, n.time);
                        kaToast((n.result === '成功' ? '✅' : '❌') + ' 保活' + (n.result === '成功' ? '成功' : '失败') + ' ' + (n.remark || ('/' + n.prefix)) + '：' + (n.detail || ''), n.result === '成功');
                    }
                }
            } catch (e) {}
        }
        setInterval(pollKaNotices, 15000);

        function rexImport(prefix) {
            const r = (window.globalRoutesData || []).find(x => x.prefix === prefix) || {};
            document.getElementById('rexPrefix').value = prefix;
            document.getElementById('rexUser').value = r.node_user || '';
            document.getElementById('rexPass').value = r.node_pass || '';
            renderRexLink();
            document.getElementById('rexModal').style.display = 'block';
        }
        function renderRexLink() {
            const scheme = location.protocol.replace(':', '');
            const host = location.hostname + '/' + (PT.enabled ? PT.key + '/' : '') + String(document.getElementById('rexPrefix').value || '').trim();
            const port = location.port || (scheme === 'https' ? '443' : '80');
            const username = encodeURIComponent(String(document.getElementById('rexUser').value || '').trim());
            const password = encodeURIComponent(String(document.getElementById('rexPass').value || '').trim());
            document.getElementById('rexLink').value = 'rex://import?type=emby&scheme=' + scheme + '&host=' + host + '&port=' + port + '&username=' + username + '&password=' + password;
        }
        function copyRexLink() {
            const link = document.getElementById('rexLink').value;
            if (!link) return;
            copyTxt(link);
            showToast('✅ Rex 导入链接已复制');
        }
        function openRexLink() {
            const link = document.getElementById('rexLink').value;
            if (!link) return;
            window.location.href = link;
        }
        function closeRexModal() { document.getElementById('rexModal').style.display = 'none'; }

        function toggleNodeDetail(btn) {
            const card = btn.closest('.emby-card');
            const d = card.querySelector('.node-detail');
            const show = d.style.display === 'none';
            d.style.display = show ? 'flex' : 'none';
            btn.classList.toggle('rotated', show);
            btn.title = show ? '收起' : '展开详情';
        }
        // ============ 节点申请(订阅者提交 / 管理员审核) ============
        let NODE_REQS = [];
        function parseReqUrls(v) { try { const a = JSON.parse(v); if (Array.isArray(a)) return a.map(String); } catch (e) {} return v ? [String(v)] : []; }
        async function loadNodeReqs() {
            try {
                const res = await fetch('/api/node-requests');
                const d = await res.json();
                NODE_REQS = d.success ? (d.requests || []) : [];
            } catch (e) { NODE_REQS = []; }
            const badge = document.getElementById('nodeReqBadge');
            if (badge) { badge.style.display = NODE_REQS.length ? 'inline-flex' : 'none'; badge.textContent = NODE_REQS.length > 99 ? '99+' : String(NODE_REQS.length); }
        }
        function openNodeReqModal() {
            document.getElementById('nodeReqModal').style.display = 'block';
            renderNodeReqs();
        }
        function closeNodeReqModal() { document.getElementById('nodeReqModal').style.display = 'none'; }
        function renderNodeReqs() {
            const box = document.getElementById('nodeReqList');
            if (!box) return;
            if (!NODE_REQS.length) { box.innerHTML = '<div style="text-align:center; color:var(--text-sec); font-size:14px; padding:30px;">暂无节点申请</div>'; return; }
            box.innerHTML = NODE_REQS.map(r => {
                const urls = parseReqUrls(r.url);
                return '<div style="background:var(--bg); border:1px solid var(--border); border-radius:12px; padding:12px 14px; display:flex; align-items:center; gap:10px; flex-wrap:wrap;">' +
                '<div style="flex:1; min-width:200px;">' +
                    '<div style="font-weight:600; font-size:14px;">' + escHtml(r.name) + '</div>' +
                    '<div style="font-size:12px; color:var(--text-sec); word-break:break-all; line-height:1.7;">' + urls.map(u => '• ' + escHtml(u)).join('<br>') + '</div>' +
                    '<div style="font-size:11px; color:var(--text-faint); margin-top:2px;">' + escHtml(r.created_at || '') + '</div>' +
                '</div>' +
                '<button class="btn-submit" onclick="approveNodeReq(' + r.id + ')" style="padding:7px 14px; font-size:13px;">${I.check} 同意</button>' +
                '<button class="btn-ghost" onclick="rejectNodeReq(' + r.id + ')" style="padding:7px 14px; font-size:13px;">${I.xmark} 拒绝</button>' +
                '</div>';
            }).join('');
        }
        async function approveNodeReq(id) {
            try {
                const res = await fetch('/api/node-requests/review', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, action: 'approve' }) });
                const d = await res.json();
                if (!d.success) return showToast('❌ ' + (d.error || '审批失败'));
                closeNodeReqModal();
                location.href = '/?prefill=1&name=' + encodeURIComponent(d.data.name) + '&urls=' + encodeURIComponent(JSON.stringify(parseReqUrls(d.data.url)));
            } catch (e) { showToast('❌ 审批失败: ' + e.message); }
        }
        async function rejectNodeReq(id) {
            try {
                const res = await fetch('/api/node-requests/review', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, action: 'reject' }) });
                const d = await res.json();
                if (!d.success) return showToast('❌ ' + (d.error || '取消失败'));
                showToast('🗑️ 已拒绝该申请');
                await loadNodeReqs();
                renderNodeReqs();
            } catch (e) { showToast('❌ 取消失败: ' + e.message); }
        }
        function resetSubReqUrls() {
            const box = document.getElementById('subReqUrlBox');
            if (!box) return;
            box.innerHTML = '<input type="url" class="sub-req-url" placeholder="主线路地址（如: https://1.1.1.1:8096）" oninput="handleSubReqUrls()" style="width:100%; padding:10px 14px; border:1px solid var(--border); border-radius:8px; background:var(--bg); box-sizing:border-box;"><input type="url" class="sub-req-url" placeholder="备用线路 1（选填，可继续添加）" oninput="handleSubReqUrls()" style="width:100%; padding:10px 14px; border:1px solid var(--border); border-radius:8px; background:var(--bg); box-sizing:border-box;">';
        }
        function handleSubReqUrls() {
            const container = document.getElementById('subReqUrlBox');
            if (!container) return;
            const inputs = container.querySelectorAll('.sub-req-url');
            const lastInput = inputs[inputs.length - 1];
            if (lastInput && lastInput.value.trim() !== '') {
                const n = document.createElement('input');
                n.type = 'url'; n.className = 'sub-req-url';
                n.placeholder = '备用线路 ' + inputs.length + '（选填，可继续添加）';
                n.style = 'width:100%; padding:10px 14px; border:1px solid var(--border); border-radius:8px; background:var(--bg); box-sizing:border-box;';
                n.oninput = handleSubReqUrls;
                container.appendChild(n);
            }
            let emptyCount = 0;
            const all = container.querySelectorAll('.sub-req-url');
            for (let i = all.length - 1; i >= 0; i--) { if (all[i].value.trim() === '') { emptyCount++; if (emptyCount > 1) all[i].remove(); } else break; }
        }
        function openSubReqModal() {
            document.getElementById('subReqModal').style.display = 'block';
            const nm = document.getElementById('subReqName'); if (nm) nm.value = '';
            resetSubReqUrls();
            const hint = document.getElementById('subReqHint'); if (hint) hint.innerHTML = '提交后管理员审核；线路已存在会直接提示你，同线路的新申请会自动覆盖旧申请（含全部备用线路）。';
        }
        function closeSubReqModal() { document.getElementById('subReqModal').style.display = 'none'; }
        async function submitNodeReq() {
            const name = document.getElementById('subReqName').value.trim();
            const urls = [];
            document.querySelectorAll('.sub-req-url').forEach(inp => { const v = inp.value.trim(); if (v) urls.push(v); });
            if (!name || !urls.length) return showToast('⚠️ 请填写节点名字与至少一条线路地址');
            const hint = document.getElementById('subReqHint');
            try {
                const res = await fetch('/api/node-request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, urls }) });
                const d = await res.json();
                if (d.success) {
                    if (d.replaced) {
                        hint.innerHTML = '<span style="color:#00c2ff;">🔄 同线路已有申请「' + escHtml(d.name) + '」，已自动替换为你提交的新申请（含全部备用线路）</span>';
                    } else {
                        hint.innerHTML = '<span style="color:var(--success);">✅ 申请已提交，等待管理员审核</span>';
                        document.getElementById('subReqName').value = ''; resetSubReqUrls();
                    }
                } else if (d.exists) {
                    hint.innerHTML = '<span style="color:#ff9f0a;">⚠️ 该线路已存在节点「' + escHtml(d.remark) + '」，访问后缀 /' + escHtml(d.prefix) + '，无需重复申请</span>';
                } else {
                    hint.innerHTML = '<span style="color:#ff6b6b;">❌ ' + escHtml(d.error || '提交失败') + '</span>';
                }
            } catch (e) { hint.innerHTML = '<span style="color:#ff6b6b;">❌ ' + escHtml(e.message) + '</span>'; }
        }
        // 管理员点「同意」跳转回来:自动打开添加节点并预填线路/名字
        (function prefillFromApproval() {
            try {
                const qp = new URLSearchParams(location.search);
                if (qp.get('prefill') !== '1') return;
                openNodeModal();
                const nm = document.getElementById('remark'); if (nm) nm.value = qp.get('name') || '';
                let urls = [];
                try { const a = JSON.parse(qp.get('urls') || '[]'); if (Array.isArray(a)) urls = a.map(String); } catch (e) {}
                if (!urls.length && qp.get('url')) urls = [qp.get('url')];
                if (urls.length) {
                    let idx = 0;
                    const setNext = (u) => {
                        const inputs = document.querySelectorAll('.target-input');
                        if (inputs[idx]) { inputs[idx].value = u; }
                        else { handleTargetInputs(); const ins2 = document.querySelectorAll('.target-input'); if (ins2[idx]) ins2[idx].value = u; }
                        idx++;
                    };
                    urls.forEach(setNext);
                    handleTargetInputs();
                }
                showToast('✅ 已从申请预填，请修改名字/后缀后保存');
                history.replaceState(null, '', location.pathname);
            } catch (e) {}
        })();

        function openNodeModal() {
            const f = document.getElementById('addForm');
            f.reset();
            document.getElementById('oldPrefix').value='';
            selectIcon('','默认');
            document.getElementById('nodeCache').checked=true;
            document.getElementById('nodeDlTrick').checked=false;
            document.getElementById('nodeEmosId').value='eK3QYG29Ms';
            document.getElementById('nodeEmosName').value='玛卡巴卡的反代面板';
            document.getElementById('nodeEmosAggregate').checked=false;
            toggleCustomParams();
            document.getElementById('submitBtn').textContent='保存部署';
            document.getElementById('nodeModalTitle').textContent='添加节点';
            document.getElementById('nodeModal').style.display='block';
        }
        function closeNodeModal() {
            document.getElementById('nodeModal').style.display='none';
        }

        // ============ 手动覆盖/更新 弹窗 ============
        function openCodeModal(mode) {
            const modal = document.getElementById('codeModal');
            const area = document.getElementById('codeArea');
            const file = document.getElementById('fileInput');
            if (mode === 'file') {
                area.style.display = 'none';
                file.style.display = 'block';
            } else {
                area.style.display = 'block';
                file.style.display = 'none';
            }
            modal.style.display = 'block';
        }
        function closeCodeModal() {
            document.getElementById('codeModal').style.display = 'none';
        }

        // ============ Worker 调度/区域 弹窗 ============
        function openPlacementModal() {
            document.getElementById('placementModal').style.display = 'block';
        }
        function closePlacementModal() {
            document.getElementById('placementModal').style.display = 'none';
        }

        // ============ 账户设置 弹窗 ============
        function openAccountModal() {
            const modal = document.getElementById('accountModal');
            modal.style.display = 'block';
            if (window.ROLE === 'sub') {
                document.getElementById('accountAdminPanel').style.display = 'none';
                document.getElementById('accountSubPanel').style.display = 'block';
            } else {
                document.getElementById('accountAdminPanel').style.display = 'flex';
                document.getElementById('accountSubPanel').style.display = 'none';
                loadSubscribers();
                loadPtState();
                loadPtHits();
                loadVersionPanel();
                loadKaGlobalProfile();
                loadLogo();
                loadNoticeEditor();
            }
        }
        function closeAccountModal() {
            document.getElementById('accountModal').style.display = 'none';
        }
        let PT = { enabled: false, key: '' };
        function entryUrl(prefix) {
            return 'https://' + window.location.host + '/' + (PT.enabled ? PT.key + '/' : '') + prefix;
        }
        // ============ 系统保留后缀检查 ============
        const RESERVED_SUFFIX_LIST = ['entry', 'api', 'catch', 'speedtest', '__client_rtt__', 'favicon.ico'];
        function chkReservedSuffix(el) {
            const v = (el.value || '').trim().toLowerCase().replace(/^\\/+|\\/+$/g, '');
            const tip = document.getElementById('prefixReservedTip');
            if (tip) tip.style.display = RESERVED_SUFFIX_LIST.indexOf(v) >= 0 ? 'block' : 'none';
        }
        function chkReservedKey(el) {
            const v = (el.value || '').trim().toLowerCase();
            const tip = document.getElementById('ptKeyReservedTip');
            if (tip) tip.style.display = RESERVED_SUFFIX_LIST.indexOf(v) >= 0 ? 'block' : 'none';
        }
        // IP 访问控制卡片默认收起,点击标题展开
        function toggleIpGuardCard() {
            const b = document.getElementById('ipguardCardBody');
            const a = document.getElementById('ipguardCardArrow');
            if (!b) return;
            const open = b.style.display !== 'none';
            b.style.display = open ? 'none' : 'block';
            if (a) a.textContent = open ? '▶ 展开' : '▼ 收起';
        }
        // 账户设置各区块默认收起,点击标题展开
        function tgSetSec(id) {
            const b = document.getElementById('setSec-' + id);
            if (!b) return;
            const open = b.style.display !== 'none';
            b.style.display = open ? 'none' : '';
            const arr = document.getElementById('setSecArr-' + id);
            if (arr) arr.textContent = open ? '▸' : '▾';
        }
        // ============ 公告(管理员设置,子管理员与订阅用户进面板可见,3 秒后可关闭) ============
        async function saveNotice() {
            const v = document.getElementById('noticeText').value.trim();
            if (v && !confirm('确定发布公告？子管理员与订阅用户进入面板时都会看到。')) return;
            if (!v && !confirm('确定清除公告？')) return;
            try {
                const res = await fetch('/api/notice', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: v }) });
                const d = await res.json();
                if (!d.success) return showToast('❌ ' + (d.error || '保存失败'));
                showToast(v ? '📢 公告已发布' : '🗑️ 公告已清除');
            } catch (e) { showToast('❌ 保存失败: ' + e.message); }
        }
        async function loadNoticeEditor() {
            try {
                const res = await fetch('/api/notice');
                const d = await res.json();
                const el = document.getElementById('noticeText');
                if (el) el.value = d.success ? (d.text || '') : '';
            } catch (e) {}
        }
        function noticeHash(t) {
            let h = 5381;
            for (let i = 0; i < t.length; i++) h = ((h << 5) + h + t.charCodeAt(i)) | 0;
            return (h >>> 0).toString(36);
        }
        async function checkNotice() {
            if (window.ROLE === 'admin') return;
            try {
                const res = await fetch('/api/notice');
                const d = await res.json();
                if (!d.success || !d.text) return;
                const key = 'emby_notice_seen_' + noticeHash(d.text);
                if (localStorage.getItem(key)) return;
                const body = document.getElementById('noticeBody');
                const modal = document.getElementById('noticeModal');
                if (!body || !modal) return;
                body.innerText = d.text;
                modal.style.display = 'block';
                const btn = document.getElementById('noticeCloseBtn');
                btn.disabled = true; btn.style.opacity = '.55'; btn.style.cursor = 'not-allowed'; btn.textContent = '我知道了 (3s)';
                let t = 3;
                window.__noticeSeenKey = key;
                const timer = setInterval(() => {
                    t--;
                    if (t <= 0) { clearInterval(timer); btn.disabled = false; btn.style.opacity = '1'; btn.style.cursor = 'pointer'; btn.textContent = '我知道了'; }
                    else btn.textContent = '我知道了 (' + t + 's)';
                }, 1000);
            } catch (e) {}
        }
        function closeNotice() {
            const modal = document.getElementById('noticeModal');
            if (modal) modal.style.display = 'none';
            if (window.__noticeSeenKey) { try { localStorage.setItem(window.__noticeSeenKey, '1'); } catch (e) {} window.__noticeSeenKey = null; }
        }
        // ============ IP 访问控制 ============
        async function loadIpGuard() {
            try {
                const res = await fetch('/api/ipguard');
                const d = await res.json();
                if (!d.success) return;
                document.querySelectorAll('input[name=ipgMode]').forEach(r => { r.checked = (r.value === d.mode); });
                document.getElementById('ipgIps').value = (d.ips || []).join('\\n');
                document.getElementById('ipgCountries').value = (d.countries || []).join('\\n');
                document.getElementById('ipgRedirect').value = d.redirect || '';
                document.getElementById('ipgCurrent').textContent = (d.currentIp || '-') + (d.currentCountry ? ' (' + d.currentCountry + ')' : '');
                IPG_TRUSTED = d.trusted || [];
                renderTrusted();
                if (d.blocked) {
                    document.getElementById('ipgBlockedIps').value = (d.blocked.ips || []).join('\\n');
                    document.getElementById('ipgBlockedRedirect').value = d.blocked.redirect || '';
                }
            } catch (e) {}
        }
        function ipgAddCurrent() {
            const cur = document.getElementById('ipgCurrent').textContent;
            const m = (cur || '').match(/\\d{1,3}(\\.\\d{1,3}){3}|[0-9a-fA-F:]+/);
            if (!m) return;
            const ta = document.getElementById('ipgIps');
            const list = ta.value.split('\\n').map(x => x.trim()).filter(Boolean);
            if (list.indexOf(m[0]) < 0) { list.push(m[0]); ta.value = list.join('\\n'); }
        }
        let IPG_TRUSTED = [];
        function renderTrusted() {
            const box = document.getElementById('ipgTrustedList');
            if (!box) return;
            if (!IPG_TRUSTED.length) { box.innerHTML = '<div style="font-size:12px; color:var(--text-sec); padding:4px 0;">暂无信任 IP</div>'; return; }
            box.innerHTML = IPG_TRUSTED.map(ip => '<div style="display:flex; align-items:center; justify-content:space-between; font-size:12px; padding:5px 8px; background:var(--bg); border-radius:6px; gap:8px;"><span style="word-break:break-all;">' + escHtml(ip) + '</span><button onclick="ipgTrustedDel(this)" data-ip="' + escHtml(ip) + '" style="background:none;border:none;color:#ff6b6b;cursor:pointer;font-size:13px;flex-shrink:0;" title="删除">✕</button></div>').join('');
        }
        function ipgTrustedDel(btn) {
            const ip = btn.getAttribute('data-ip');
            if (!ip) return;
            IPG_TRUSTED = IPG_TRUSTED.filter(x => x !== ip);
            renderTrusted();
        }
        function ipgTrustedAddOne() {
            const inp = document.getElementById('ipgTrustedAdd');
            const v = (inp.value || '').trim();
            if (!v) return;
            if (IPG_TRUSTED.indexOf(v) < 0) IPG_TRUSTED.push(v);
            inp.value = '';
            renderTrusted();
        }
        async function saveIpGuard() {
            const mode = document.querySelector('input[name=ipgMode]:checked').value;
            const ips = document.getElementById('ipgIps').value.split('\\n').map(x => x.trim()).filter(Boolean);
            const countries = document.getElementById('ipgCountries').value.split(/[\\n,，、\s]+/).map(x => x.trim().toUpperCase()).filter(Boolean);
            const redirect = document.getElementById('ipgRedirect').value.trim();
            const blockedIps = document.getElementById('ipgBlockedIps').value.split('\\n').map(x => x.trim()).filter(Boolean);
            const blockedRedirect = document.getElementById('ipgBlockedRedirect').value.trim();
            try {
                const res = await fetch('/api/ipguard', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode, ips, countries, redirect, trusted: IPG_TRUSTED, blockedIps, blockedRedirect }) });
                const d = await res.json();
                if (d.success) showToast('IP 访问控制已保存'); else alert('保存失败: ' + (d.error || ''));
            } catch (e) { alert('保存失败: ' + e); }
        }
        async function loadPtState() {
            try {
                const res = await fetch('/api/proxytoken');
                const data = await res.json();
                if (data.success) PT = { enabled: !!data.enabled, key: data.key || '' };
            } catch (e) {}
            const on = document.getElementById('ptOn');
            if (on) on.checked = PT.enabled;
            const k = document.getElementById('ptKey');
            if (k) k.value = PT.key || '';
            await loadSecurityState();
            await loadNotifyState();
        }
        // ============ 安全设置:裸域名直连代理开关 ============
        async function loadSecurityState() {
            try {
                const res = await fetch('/api/security');
                const d = await res.json();
                const el = document.getElementById('bareProxyChk');
                if (el && d.success) el.checked = !!d.bareProxy;
            } catch (e) {}
        }
        async function saveSecuritySettings() {
            const el = document.getElementById('bareProxyChk');
            if (!el) return;
            try {
                const res = await fetch('/api/account', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bareProxy: el.checked }) });
                const d = await res.json();
                if (d.success) showToast('✅ 安全设置已保存'); else alert('保存失败: ' + (d.error || ''));
            } catch (e) { alert('保存失败: ' + e); }
        }
        async function loadNotifyState() {
            try {
                const res = await fetch('/api/account/notify');
                const data = await res.json();
                if (data.success) {
                    const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v || ''; };
                    const setChk = (id, v) => { const el = document.getElementById(id); if (el) el.checked = v !== false; };
                    set('barkKey', data.barkKey);
                    set('barkLevel', data.barkLevel || 'active');
                    set('barkServer', data.barkServer || 'https://api.day.app');
                    setChk('barkNotify', data.barkNotify);
                    set('tgToken', data.tgToken);
                    set('tgChatId', data.tgChatId);
                    setChk('tgNotify', data.tgNotify);
                    // v3.6.70:保活结果通知模式
                    const knm = document.getElementById('kaNotifyMode'); if (knm) knm.value = data.kaNotifyMode || 'all';
                }
            } catch (e) {}
        }
        const KA_TPL = {
            'senplayer': { client: 'SenPlayer', version: '6.2.2', device: 'iPhone', ua: 'SenPlayer/6.2.2' },
            'eplayerx': { client: 'EplayerX', version: '10.0.22', device: 'iPhone', ua: 'EplayerX/10.0.22' },
            'forward': { client: 'Forward', version: '1.3.18', device: 'iPhone', ua: 'Forward-Standard/1.3.18' },
            'rex': { client: 'Rex', version: '1.0.1', device: 'iPhone17,2', ua: 'Rex/1.0.1' },
            'hills': { client: 'Hills', version: '1.6.0', device: 'PD2505', ua: 'Hills/1.6.0 (android; 16)' },
            'yamby': { client: 'Yamby', version: '2.0.0.5', device: 'vivo-V2505A', ua: 'Yamby/2.0.0.5(Android)' },
            'clear': { client: '', version: '', device: '', ua: '' }
        };
        function applyKaTpl(type) {
            const t = KA_TPL[type];
            if (!t) return;
            const el = id => { const x = document.getElementById(id); if (x) x.value = t[id.replace('kaG', '').toLowerCase()] ?? ''; };
            document.getElementById('kaGClient').value = t.client;
            document.getElementById('kaGVersion').value = t.version;
            document.getElementById('kaGDevice').value = t.device;
            document.getElementById('kaGUa').value = t.ua;
            if (type !== 'clear' && !document.getElementById('kaGDeviceId').value) document.getElementById('kaGDeviceId').value = genUuid();
            showToast('✅ 已应用 ' + (type === 'clear' ? '清空' : t.client) + ' 保活预设');
        }
        async function loadKaGlobalProfile() {
            try {
                const res = await fetch('/api/ka-global-profile');
                const data = await res.json();
                const g = (data && data.profile) || {};
                document.getElementById('kaGClient').value = g.client || '';
                document.getElementById('kaGVersion').value = g.version || '';
                document.getElementById('kaGDevice').value = g.device || '';
                document.getElementById('kaGDeviceId').value = g.deviceId || '';
                document.getElementById('kaGUa').value = g.ua || '';
                // v3.6.70:回填保活失败重试间隔
                const kr = document.getElementById('kaRetryHours'); if (kr) kr.value = (data && data.retryHours) ? data.retryHours : '';
            } catch (e) { console.error(e); }
        }
        // ============ 自定义 Logo（左上角 / 登录页 / favicon） ============
        const DEFAULT_LOGO = '${EMBY_LOGO}';
        function applyLogo(v) {
            if (!v) return;
            const imgs = document.querySelectorAll('.topbar-logo, .login-logo');
            imgs.forEach(function (im) { im.src = v; });
            const fav = document.querySelector('link[rel="icon"]');
            if (fav) fav.href = v;
        }
        async function loadLogo() {
            try {
                const res = await fetch('/api/logo');
                const d = await res.json();
                if (d.success && d.logo && d.logo.value) {
                    applyLogo(d.logo.value);
                    const preview = document.getElementById('logoPreview');
                    if (preview) preview.src = d.logo.value;
                    if (d.logo.type === 'url') document.getElementById('logoUrlInput').value = d.logo.value;
                } else {
                    const preview = document.getElementById('logoPreview');
                    if (preview) preview.src = DEFAULT_LOGO;
                    document.getElementById('logoUrlInput').value = '';
                }
            } catch (e) { console.error(e); }
        }
        function readLogoFile(file) {
            if (!file) return;
            if (!/^image\\/(png|jpeg|jpg|webp|gif)$/i.test(file.type)) { alert('仅支持 png / jpg / webp / gif 图片'); return; }
            if (file.size > 5 * 1024 * 1024) { alert('图片超过 5MB，请换更小的图片'); return; }
            const reader = new FileReader();
            reader.onload = function (e) {
                const img = new Image();
                img.onload = function () {
                    try {
                        const MAX = 256;
                        let w = img.width, h = img.height;
                        if (w > MAX || h > MAX) {
                            const ratio = Math.min(MAX / w, MAX / h);
                            w = Math.max(1, Math.round(w * ratio)); h = Math.max(1, Math.round(h * ratio));
                        }
                        const cv = document.createElement('canvas');
                        cv.width = w; cv.height = h;
                        const cx = cv.getContext('2d');
                        cx.drawImage(img, 0, 0, w, h);
                        const isPng = /^image\\/(png|webp|gif)$/i.test(file.type);
                        let dataUrl = cv.toDataURL(isPng ? 'image/png' : 'image/jpeg', 0.88);
                        if (!isPng && dataUrl.length > 180000) {
                            const alt = cv.toDataURL('image/png');
                            if (alt.length < dataUrl.length) dataUrl = alt;
                        }
                        if (dataUrl.length > 580000) { alert('压缩后图片仍过大（>450KB），请换更简单的图片'); return; }
                        window.__logoPending = { type: 'data', value: dataUrl };
                        document.getElementById('logoUrlInput').value = '';
                        document.getElementById('logoPreview').src = dataUrl;
                    } catch (err) { alert('图片处理失败：' + err.message); }
                };
                img.onerror = function () { alert('图片解析失败，请换一张'); };
                img.src = e.target.result;
            };
            reader.onerror = function () { alert('读取文件失败'); };
            reader.readAsDataURL(file);
        }
        async function saveLogo() {
            let payload;
            if (window.__logoPending) payload = window.__logoPending;
            else {
                const url = document.getElementById('logoUrlInput').value.trim();
                if (!url) { alert('请先上传图片或填写图片 URL'); return; }
                if (!/^https?:\\/\\//i.test(url)) { alert('URL 需以 http(s):// 开头'); return; }
                payload = { type: 'url', value: url };
            }
            const res = await fetch('/api/account', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ logo: payload }) });
            const data = await res.json();
            if (data.success) {
                window.__logoPending = null;
                applyLogo(payload.value);
                showToast('✅ 自定义 Logo 已保存');
            } else alert('保存失败：' + (data.error || ''));
        }
        async function resetLogo() {
            const res = await fetch('/api/account', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ logo: null }) });
            const data = await res.json();
            if (data.success) {
                window.__logoPending = null;
                document.getElementById('logoUrlInput').value = '';
                document.getElementById('logoPreview').src = DEFAULT_LOGO;
                applyLogo(DEFAULT_LOGO);
                showToast('已恢复默认 Logo');
            } else alert('恢复失败：' + (data.error || ''));
        }
        async function saveKaGlobalProfile() {
            const body = {
                client: document.getElementById('kaGClient').value.trim(),
                version: document.getElementById('kaGVersion').value.trim(),
                device: document.getElementById('kaGDevice').value.trim(),
                deviceId: document.getElementById('kaGDeviceId').value.trim(),
                ua: document.getElementById('kaGUa').value.trim()
            };
            if (body.deviceId && !/^[0-9a-zA-Z-]{8,64}$/.test(body.deviceId)) { alert('DeviceId 格式异常（8-64 位字母数字/连字符）'); return; }
            // v3.6.70:随全局身份一起保存保活失败重试间隔(小时)
            const krEl = document.getElementById('kaRetryHours');
            const kaRetryHours = krEl ? (parseFloat(krEl.value) || 0) : 0;
            const res = await fetch('/api/account', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kaGlobalProfile: body, kaRetryHours: kaRetryHours }) });
            const data = await res.json();
            if (data.success) showToast('✅ 保活全局身份已保存');
            else alert('保存失败：' + (data.error || ''));
        }
        async function saveNotifySettings() {
            const barkKey = document.getElementById('barkKey').value.trim();
            const barkLevel = document.getElementById('barkLevel').value;
            const barkServer = document.getElementById('barkServer').value.trim();
            const barkNotify = document.getElementById('barkNotify').checked;
            const tgToken = document.getElementById('tgToken').value.trim();
            const tgChatId = document.getElementById('tgChatId').value.trim();
            const tgNotify = document.getElementById('tgNotify').checked;
            // v3.6.70:保活结果通知模式
            const kaNotifyMode = document.getElementById('kaNotifyMode').value;
            const res = await fetch('/api/account', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ notify: { barkKey, barkLevel, barkServer, barkNotify, tgToken, tgChatId, tgNotify, kaNotifyMode } }) });
            const data = await res.json();
            if (data.success) { showToast('保号通知设置已保存'); closeAccountModal(); }
            else alert('保存失败：' + (data.error || ''));
        }
        async function testNotifyFn(type) {
            const res = await fetch('/api/test-notify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type }) });
            const data = await res.json();
            alert(data.success ? '测试通知发送成功' : ('发送失败：' + (data.error || '')));
        }
        async function saveProxyToken() {
            const enabled = document.getElementById('ptOn').checked;
            const key = document.getElementById('ptKey').value.trim();
            if (enabled && !/^[A-Za-z0-9]{3,32}$/.test(key)) { alert('密钥需 3-32 位字母数字'); return; }
            if (enabled && RESERVED_SUFFIX_LIST.indexOf(key.toLowerCase()) >= 0) { alert('该密钥已被系统保留占用（如 entry），请更换'); return; }
            const res = await fetch('/api/account', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ proxyToken: { enabled, key } }) });
            const data = await res.json();
            if (data.success) {
                closeAccountModal();
                showToast('反代 Token 已' + (enabled ? '开启，链接前缀 /' + key + '/' : '关闭'));
                await loadPtState();
                try { renderRoutes(); } catch (e) { console.error(e); }
            } else alert('保存失败：' + (data.error || ''));
        }
        function fmtHitTs(ts) {
            const d = new Date(ts + 8 * 3600000);
            return String(d.getUTCFullYear()).slice(2) + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0') + ' ' + String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0');
        }
        async function loadPtHits() {
            const box = document.getElementById('ptHits');
            try {
                const res = await fetch('/api/proxytoken/hits');
                const data = await res.json();
                const hits = (data && data.hits) || [];
                if (!hits.length) { box.innerHTML = '<span style="color:var(--text-sec);">暂无记录</span>'; return; }
                box.innerHTML = hits.map(h => '<div style="padding:8px 10px;border:1px solid var(--border);border-radius:8px;margin-bottom:6px;background:var(--bg);">'
                    + '<div style="color:var(--text);font-weight:600;font-size:13px;">' + escHtml(h.ip) + ' <span style="color:var(--primary);font-weight:700;">×' + (h.times || 1) + '</span></div>'
                    + '<div style="color:var(--text-sec);font-size:12px;word-break:break-all;margin-top:2px;">' + escHtml(h.path || '') + '</div>'
                    + '<div style="color:var(--text-sec);font-size:11px;margin-top:2px;">' + fmtHitTs(h.ts || 0) + ' · ' + escHtml(String(h.ua || '').slice(0, 70)) + '</div></div>'
                ).join('') + '<button class="btn-ghost" style="margin-top:6px;font-size:12px;" onclick="clearPtHits()">' + (I.trash || '清除') + ' 清空记录</button>';
            } catch (e) { box.innerHTML = '<span style="color:var(--text-sec);">加载失败</span>'; }
        }
        async function clearPtHits() {
            const res = await fetch('/api/proxytoken/hits', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clear: true }) });
            const data = await res.json();
            if (data.success) { showToast('已清空来访记录'); loadPtHits(); }
            else alert('清空失败');
        }
        function escHtml(s) {
            return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
        }
        async function saveAdminPass() {
            const pw = document.getElementById('newAdminPass').value.trim();
            if (!pw || pw.length < 4) { alert('密码至少 4 位'); return; }
            if (!confirm('确定将网页登录密码修改为「' + pw + '」？\\n\\n注意：Worker 变量 ADMIN_TOKEN 仍为最高权限，永久有效。')) return;
            const res = await fetch('/api/account', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw }) });
            const data = await res.json();
            if (data.success) { showToast('密码已更新'); document.getElementById('newAdminPass').value = ''; }
            else alert('修改失败：' + (data.error || ''));
        }
        async function loadSubscribers() {
            try {
                const res = await fetch('/api/subscribers');
                const data = await res.json();
                const list = data.subscribers || [];
                const box = document.getElementById('subList');
                if (list.length === 0) {
                    box.innerHTML = '<div style="font-size:13px; color:var(--text-sec); padding:6px 0;">暂无订阅用户</div>';
                    return;
                }
                box.innerHTML = '';
                list.forEach(pw => {
                    box.innerHTML += '<div style="display:flex; align-items:center; gap:8px; background:var(--bg); border:1px solid var(--border); border-radius:8px; padding:8px 12px;">' +
                        '<span style="flex:1; font-family:monospace; font-size:13px;">' + pw + '</span>' +
                        '<button class="icon-btn" onclick="delSubscriber(this)" data-pw="' + pw + '" title="删除">' + I.trash + '</button></div>';
                });
            } catch (e) { alert('加载订阅用户失败'); }
        }
        async function addSubscriber() {
            const pw = document.getElementById('newSubPass').value.trim();
            if (!pw || pw.length < 4) { alert('密码至少 4 位'); return; }
            const res = await fetch('/api/subscribers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'add', password: pw }) });
            const data = await res.json();
            if (data.success) { showToast('已添加订阅者'); document.getElementById('newSubPass').value = ''; loadSubscribers(); }
            else alert(data.error || '添加失败');
        }
        async function delSubscriber(btn) {
            const pw = btn.getAttribute('data-pw');
            if (!confirm('确定删除订阅者「' + pw + '」？')) return;
            const res = await fetch('/api/subscribers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'del', password: pw }) });
            const data = await res.json();
            if (data.success) { showToast('已删除'); loadSubscribers(); }
            else alert(data.error || '删除失败');
        }

        // ============ 角色识别与订阅者只读模式 ============
        async function initRole() {
            try {
                const res = await fetch('/api/me');
                const data = await res.json();
                window.ROLE = data.role || 'admin';
            } catch (e) { window.ROLE = 'admin'; }
            if (window.ROLE === 'sub') applySubMode();
            checkNotice();
        }
        function applySubMode() {
            document.querySelectorAll('.admin-only').forEach(el => el.style.display = 'none');
            const dockItems = document.querySelectorAll('.ds-dock-item');
            if (dockItems[1]) dockItems[1].style.display = 'none';
            if (dockItems[2]) dockItems[2].style.display = 'none';
            const speedView = document.getElementById('view-speed');
            if (speedView) speedView.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-sec);font-size:14px;">订阅用户无测速与 DNS 权限</div>';
            const setView = document.getElementById('view-settings');
            if (setView) setView.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-sec);font-size:14px;">订阅用户无设置权限</div>';
        }

        document.getElementById('addForm').onsubmit = async (e) => {
            e.preventDefault();
            const oldPrefix = document.getElementById('oldPrefix').value;
            const remark = document.getElementById('remark').value.trim();
            const prefix = document.getElementById('prefix').value.trim().replace(/^\\/+/g, '');
            if (RESERVED_SUFFIX_LIST.indexOf(prefix.toLowerCase()) >= 0) { showToast('该后缀已被系统保留占用（如 entry），请更换'); return; }
            const mode = document.getElementById('mode').value;
            const icon = document.getElementById('iconUrl').value;
            const cache_img = document.getElementById('nodeCache').checked ? 'on' : 'off';
            const dlTrick = document.getElementById('nodeDlTrick').checked ? '1' : '0';
            const customClient = document.getElementById('customClient').value.trim();
            const customVersion = document.getElementById('customVersion').value.trim();
            const customDevice = document.getElementById('customDevice').value.trim();
            const customUa = document.getElementById('customUa').value.trim();
            const customDeviceId = document.getElementById('customDeviceId').value.trim();
            const kaEnabled = document.getElementById('kaEnabled').checked ? '1' : '0';
            const kaDays = document.getElementById('kaDays').value.trim() || '3';
            const kaToken = document.getElementById('kaToken').value.trim();
            const nodeUser = document.getElementById('nodeUser').value.trim();
            const nodePass = document.getElementById('nodePass').value.trim();
            const watchLimit = document.getElementById('watchLimit').value.trim() || '0';
            const emosId = document.getElementById('nodeEmosId').value.trim();
            const emosName = document.getElementById('nodeEmosName').value.trim();
            const emosAggregate = document.getElementById('nodeEmosAggregate').checked ? 'on' : 'off';

            const inputs = document.querySelectorAll('.target-input');
            let targetsArray = [];
            inputs.forEach(inp => {
                const val = inp.value.trim().replace(/\\/$/g, '');
                if (val) targetsArray.push(val);
            });
            const target = targetsArray.join(',');
            
            if (!target) return showToast('❌ 请至少填写一个主线路地址');

            try {
                const res = await fetch('/api/routes', { 
                    method: 'POST', 
                    body: JSON.stringify({oldPrefix, prefix, target, mode, remark, icon, cache_img, dlTrick, customClient, customVersion, customDevice, customDeviceId, customUa, kaEnabled, kaDays, kaToken, nodeUser, nodePass, watchLimit, emosId, emosName, emosAggregate})
                });
                const data = await res.json();
                if(!data.success) throw new Error(data.error || '部署失败');
                
                document.getElementById('addForm').reset();
                document.getElementById('oldPrefix').value = ''; 
                selectIcon('', '默认');
                document.getElementById('nodeCache').checked = true;
                document.getElementById('nodeDlTrick').checked = false;
                document.getElementById('submitBtn').textContent = '保存部署'; 
                resetTargetInputs(); 
                closeNodeModal();   // 保存成功后直接关闭弹窗，避免编辑态残留成"添加节点"空表单

                showToast('✅ 节点部署成功');
                load();
            } catch(err) {
                showToast('❌ 保存失败: ' + err.message);
            }
        };

        async function del(prefix) {
            if(confirm('确定删除节点 /' + prefix + ' ?')) {
                await fetch('/api/routes?prefix=' + prefix, { method: 'DELETE' });
                showToast('🗑️ 节点已移除');
                load();
            }
        }

        function toggleSelectAll() {
            const isChecked = document.getElementById('selectAll').checked;
            document.querySelectorAll('.row-checkbox').forEach(cb => {
                if(!cb.disabled) cb.checked = isChecked;
            });
        }
        function getSelectedIps() {
            const checkboxes = document.querySelectorAll('.row-checkbox:checked');
            return Array.from(checkboxes).map(cb => cb.value);
        }
        function batchTcpPing() {
            const rows = document.querySelectorAll('#testTableBody .test-row');
            let ips = [];
            rows.forEach(tr => {
                const strong = tr.querySelector('.ip-text');
                if (strong && strong.textContent) {
                    let ip = strong.textContent;
                    if (ip.startsWith('[') && ip.endsWith(']')) ip = ip.slice(1, -1);
                    ips.push(ip);
                }
            });
            if (ips.length === 0) return showToast('⚠️ 请先提取节点！');
            navigator.clipboard.writeText(ips.join('\\n')).then(() => {
                showToast('✅ 节点已复制，即将跳转 ITDog...');
                setTimeout(() => { window.open('https://www.itdog.cn/batch_tcping/', '_blank'); }, 1500);
            });
        }
        function directSubmitCname() {
            const input = document.getElementById('customIps').value.trim();
            if (!input) return showToast('⚠️ 请先在文本框内粘贴您的优选域名');
            const domainRegex = /\\b([a-zA-Z0-9-]+\\.)+[a-zA-Z]{2,}\\b/g;
            const matchedDomains = input.match(domainRegex) || [];
            const realDomains = matchedDomains.filter(d => !/^\\d+\\.\\d+\\.\\d+\\.\\d+$/.test(d));
            if (realDomains.length === 0) return showToast('⚠️ 没有提取到合法的域名格式，请检查输入！');
            if(!confirm(\` 提取到以下域名：\\n\${realDomains.join('\\n')}\\n\\n确定要直接将其设为 CNAME 记录吗？\\n(注意：这会清空你配置的域名下现有的记录)\`)) return;
            const btn = document.getElementById('btnDirectCname');
            sendDnsRequest(realDomains, btn);
        }
        async function testCustomIPs() {
            const input = document.getElementById('customIps').value;
            if (!input.trim()) return showToast('⚠️ 请先在输入框粘贴 IP 或优选域名');
            const ipv4Regex = /\\b(?:(?:25[0-5]|2[0-4]\\d|[01]?\\d\\d?)\\.){3}(?:25[0-5]|2[0-4]\\d|[01]?\\d\\d?)\\b/g;
            const ipv6Regex = /(?:[A-F0-9]{1,4}:){7}[A-F0-9]{1,4}|(?:[A-F0-9]{1,4}:)*:[A-F0-9]{1,4}(?::[A-F0-9]{1,4})*/gi;
            const domainRegex = /\\b([a-zA-Z0-9-]+\\.)+[a-zA-Z]{2,}\\b/g;
            let matchedIPv4 = input.match(ipv4Regex) || [];
            let matchedIPv6 = input.match(ipv6Regex) || [];
            let matchedDomains = input.match(domainRegex) || [];
            matchedDomains = matchedDomains.filter(d => !/^\\d+\\.\\d+\\.\\d+\\.\\d+$/.test(d));
            let extractedIps = [...matchedIPv4, ...matchedDomains];
            matchedIPv6.forEach(ip => {
                if (ip.length > 7 && ip.includes(':') && !ip.startsWith('::1')) { extractedIps.push(ip.startsWith('[') ? ip : \`[\${ip}]\`); }
            });
            extractedIps = [...new Set(extractedIps)];
            if (extractedIps.length === 0) return showToast('⚠️ 未识别到合法的 IP 或 域名格式');
            const btn = document.getElementById('btnTestCustom');
            const tbody = document.getElementById('testTableBody');
            btn.disabled = true; btn.textContent = '⏳ 测试中...';
            if(tbody.innerHTML.includes('暂无数据')) tbody.innerHTML = '';
            showToast(\`✅ 提取到 \${extractedIps.length} 个节点，开始测速校验\`);
            const promises = [];
            extractedIps.forEach(ip => {
                const tr = document.createElement('tr');
                tr.className = 'test-row';
                tr.innerHTML = \`
                    <td data-label="勾选节点" style="text-align: center;"><input type="checkbox" class="ip-checkbox row-checkbox" value="\${ip}"></td>
                    <td data-label="专属节点"><strong class="ip-text" style="color:var(--primary);cursor:pointer;font-family:monospace;" onclick="copyTxt('\${ip}')" title="点击复制">\${ip}</strong></td>
                    <td data-label="预估延迟" class="latency" data-ms="9999" style="font-weight: 600; color: #888;">测算中...</td>
                    <td data-label="连通状态" class="speed" style="color: #888;">-</td>
                    <td data-label="记录/归属地" class="loc" style="color: #666;">等待解析</td>
                    <td data-label="快捷操作"><button class="btn-dns" disabled onclick="updateSingleDns('\${ip}', this)">唯一解析</button></td>\`;
                tbody.insertBefore(tr, tbody.firstChild);
                promises.push(doLocalPing(ip, tr, '自定义节点'));
            });
            await Promise.all(promises);
            sortTableByLatency(tbody);
            document.querySelectorAll('.btn-dns').forEach(b => b.disabled = false);
            btn.disabled = false; btn.textContent = ' 测试粘贴节点';
            showToast('🎉 自定义节点测速完成！');
        }
        async function fetchCustomApiAndTest() {
            const apiUrl = document.getElementById('customApiUrl').value.trim();
            if (!apiUrl) return showToast('⚠️ 请先填入自定义 API 链接');
            const btn = document.getElementById('btnFetchCustomApi');
            const tbody = document.getElementById('testTableBody');
            const statusTxt = document.getElementById('statusText');
            btn.disabled = true; btn.textContent = '⏳ 拉取中...';
            statusTxt.innerHTML = \`正在从自定义 API 抓取数据...\`;
            if(tbody.innerHTML.includes('暂无数据')) tbody.innerHTML = ''; 
            try {
                const res = await fetch(\`/api/get-custom-api-ips?url=\${encodeURIComponent(apiUrl)}\`);
                const data = await res.json();
                if (!data.ips || data.ips.length === 0) { showToast('⚠️ 自定义 API 返回为空'); return; }
                showToast(\`✅ 提取 \${data.totalCount} 个节点，抽取 \${data.ips.length} 个测速\`);
                btn.textContent = ' 测速中...';
                const promises = [];
                data.ips.forEach(ip => {
                    const tr = document.createElement('tr');
                    tr.className = 'test-row';
                    tr.innerHTML = \`
                        <td data-label="勾选节点" style="text-align: center;"><input type="checkbox" class="ip-checkbox row-checkbox" value="\${ip}"></td>
                        <td data-label="专属节点"><strong class="ip-text" style="color:var(--primary);cursor:pointer;font-family:monospace;" onclick="copyTxt('\${ip}')" title="点击复制">\${ip}</strong></td>
                        <td data-label="预估延迟" class="latency" data-ms="9999" style="font-weight: 600; color: #888;">测算中...</td>
                        <td data-label="连通状态" class="speed" style="color: #888;">-</td>
                        <td data-label="记录/归属地" class="loc" style="color: #666;">等待解析</td>
                        <td data-label="快捷操作"><button class="btn-dns" disabled onclick="updateSingleDns('\${ip}', this)">唯一解析</button></td>\`;
                    tbody.insertBefore(tr, tbody.firstChild);
                    promises.push(doLocalPing(ip, tr, '自定义 API'));
                });
                await Promise.all(promises);
                sortTableByLatency(tbody);
                document.querySelectorAll('.btn-dns').forEach(b => b.disabled = false);
                document.getElementById('selectAll').checked = false;
                showToast('🎉 自定义 API 测速完成！');
                statusTxt.innerHTML = \`${I.check} 测速完毕！您可以自由组合更新 DNS。\`;
            } catch (err) { showToast('❌ 拉取失败'); } 
            finally { btn.disabled = false; btn.textContent = ' 拉取API并测速'; }
        }
        const PRESET_MAP = {
            'all': { name: '综合混合源(四源并发)', url: 'uouin + cf-speed-dns + 164746 + wetest 并发聚合' },
            'ehb-all': { name: '云枢全域融合(双栈)', url: 'https://ip.ehb.cc.cd/all?ips=100' },
            'ehb-cm': { name: '云枢移动起飞(IPv4)', url: 'https://ip.ehb.cc.cd/cm?ips=100' },
            'ehb-ct': { name: '云枢电信美西(IPv4)', url: 'https://ip.ehb.cc.cd/ct?ips=100' },
            'ehb-cu': { name: '云枢联通极速(IPv4)', url: 'https://ip.ehb.cc.cd/cu?ips=100' },
            'ehb-104': { name: '104 大段全域池', url: 'https://ip.ehb.cc.cd/104?ips=100' },
            'ehb-10417': { name: '104.17 移动起飞段', url: 'https://ip.ehb.cc.cd/104.17?ips=100' },
            'ehb-10419': { name: '104.19 移动抗QoS段', url: 'https://ip.ehb.cc.cd/104.19?ips=100' },
            'ehb-10416': { name: '104.16 经典老牌段', url: 'https://ip.ehb.cc.cd/104.16?ips=100' },
            'ehb-162': { name: '162 大段全域池', url: 'https://ip.ehb.cc.cd/162?ips=100' },
            'ehb-162159s': { name: '162.159 SaaS/DoH段', url: 'https://ip.ehb.cc.cd/162.159-saas?ips=100' },
            'ehb-162159ct': { name: '162.159 电信美西最稳段', url: 'https://ip.ehb.cc.cd/162.159-ct?ips=100' },
            'ehb-172': { name: '172 大段全域池', url: 'https://ip.ehb.cc.cd/172?ips=100' },
            'ehb-17264': { name: '172.64 联通/电信主力段', url: 'https://ip.ehb.cc.cd/172.64?ips=100' },
            'ehb-17267': { name: '172.67 动态反代段', url: 'https://ip.ehb.cc.cd/172.67?ips=100' },
            'ehb-198': { name: '198.41 联通天花板大段', url: 'https://ip.ehb.cc.cd/198?ips=100' },
            'ehb-108': { name: '108.162 三网兜底大段', url: 'https://ip.ehb.cc.cd/108?ips=100' },
            'ehb-v6': { name: '云枢 IPv6 全域星轨', url: 'https://ip.ehb.cc.cd/v6?ips=100' },
            'ehb-v6cm': { name: '云枢移动 5G 直连', url: 'https://ip.ehb.cc.cd/v6-cm?ips=100' },
            'ehb-v6ct': { name: '云枢电信 纯净美西', url: 'https://ip.ehb.cc.cd/v6-ct?ips=100' },
            'ehb-v6cu': { name: '云枢联通 欧洲/东京', url: 'https://ip.ehb.cc.cd/v6-cu?ips=100' },
            'ehb-2400': { name: '2400:cb00 亚太全域', url: 'https://ip.ehb.cc.cd/2400?ips=100' },
            'ehb-24002048': { name: '2400.2048 香港近场段', url: 'https://ip.ehb.cc.cd/2400.2048?ips=100' },
            'ehb-2400400': { name: '2400.400 亚太低跳数段', url: 'https://ip.ehb.cc.cd/2400.400?ips=100' },
            'ehb-24002049': { name: '2400.2049 亚太抗抖动段', url: 'https://ip.ehb.cc.cd/2400.2049?ips=100' },
            'ehb-2606': { name: '2606:4700 全球主干', url: 'https://ip.ehb.cc.cd/2606?ips=100' },
            'ehb-26063030': { name: '2606.3030 核心骨干段', url: 'https://ip.ehb.cc.cd/2606.3030?ips=100' },
            'ehb-26064700': { name: '2606.4700 伴生特权段', url: 'https://ip.ehb.cc.cd/2606.4700?ips=100' },
            'ehb-2a06': { name: '2a06:98c0 欧洲特快大段', url: 'https://ip.ehb.cc.cd/2a06?ips=100' },
            'robberer': { name: '@robberer 专属', url: 'https://gh.xxooo.cf/https://raw.githubusercontent.com/hc990275/yx/refs/heads/main/cfyxip.txt' },
            'cm-ct': { name: 'CM佬电信优选', url: 'https://cf.090227.xyz/ct?ips=100' },
            'cm-cmcc': { name: 'CM佬移动优选', url: 'https://cf.090227.xyz/cmcc?ips=100' },
            'cm-cu': { name: 'CM佬联通优选', url: 'https://cf.090227.xyz/cu?ips=100' },
            'v2too': { name: 'v2too 源', url: 'https://ip.v2too.top/api/nodes' }
        };
        function updatePresetInfo() {
            const v = document.getElementById('ipType').value;
            const p = PRESET_MAP[v];
            if (!p) return;
            document.getElementById('presetName').textContent = p.name;
            const u = document.getElementById('presetUrl');
            u.textContent = p.url;
            u.title = '点击复制 API 地址';
        }
        function copyPresetUrl() {
            const u = document.getElementById('presetUrl').textContent;
            if (!u || u.startsWith('uouin')) return showToast('综合混合源为多源聚合,无单一地址');
            if (navigator.clipboard) { navigator.clipboard.writeText(u).then(() => showToast('✅ API 地址已复制')).catch(() => { fallbackCopy(u); }); }
            else fallbackCopy(u);
        }
        function fallbackCopy(txt) {
            const ta = document.createElement('textarea'); ta.value = txt; ta.style.position = 'fixed'; ta.style.opacity = '0';
            document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); showToast('✅ API 地址已复制');
        }
        async function fetchRemoteAndTest() {
            const btn = document.getElementById('btnFetchRemote');
            const tbody = document.getElementById('testTableBody');
            const statusTxt = document.getElementById('statusText');
            const type = document.getElementById('ipType').value;
            const typeText = document.getElementById('ipType').options[document.getElementById('ipType').selectedIndex].text;
            btn.disabled = true; btn.textContent = '⏳ 正在提取节点...';
            statusTxt.innerHTML = \`正在拉取 <strong>\${typeText}</strong> 数据...\`;
            if(tbody.innerHTML.includes('暂无数据')) tbody.innerHTML = ''; 
            try {
                const res = await fetch(\`/api/get-remote-ips?type=\${encodeURIComponent(type)}\`);
                const data = await res.json();
                if (!data.ips || data.ips.length === 0) { showToast('⚠️ 未获取到该类型 IP'); return; }
                showToast(\`✅ 从「\${data.name || typeText}」提取 \${data.totalCount} 个可用 IP，抽取 \${data.ips.length} 个测速\`);
                btn.textContent = ' 本地测速中...';
                const promises = [];
                data.ips.forEach(ip => {
                    const tr = document.createElement('tr');
                    tr.className = 'test-row';
                    tr.innerHTML = \`
                        <td data-label="勾选节点" style="text-align: center;"><input type="checkbox" class="ip-checkbox row-checkbox" value="\${ip}"></td>
                        <td data-label="专属节点"><strong class="ip-text" style="color:var(--primary);cursor:pointer;font-family:monospace;" onclick="copyTxt('\${ip}')" title="点击复制">\${ip}</strong></td>
                        <td data-label="预估延迟" class="latency" data-ms="9999" style="font-weight: 600; color: #888;">测算中...</td>
                        <td data-label="连通状态" class="speed" style="color: #888;">-</td>
                        <td data-label="记录/归属地" class="loc" style="color: #666;">等待解析</td>
                        <td data-label="快捷操作"><button class="btn-dns" disabled onclick="updateSingleDns('\${ip}', this)">唯一解析</button></td>\`;
                    tbody.insertBefore(tr, tbody.firstChild);
                    promises.push(doLocalPing(ip, tr, typeText.replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '')));
                });
                await Promise.all(promises);
                sortTableByLatency(tbody);
                document.querySelectorAll('.btn-dns').forEach(b => b.disabled = false);
                document.getElementById('selectAll').checked = false;
                showToast('🎉 测速完成！');
                statusTxt.innerHTML = \`${I.check} 测速完毕！\`;
            } catch (err) { showToast('❌ 拉取或测速失败'); } 
            finally { btn.disabled = false; btn.textContent = ' 提取预设源测速'; }
        }
        function clearTest() {
            document.getElementById('testTableBody').innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-sec);">暂无数据，请拉取节点或输入自定义 IP/域名 测试</td></tr>';
            document.getElementById('statusText').textContent = '列表已清空。';
            document.getElementById('selectAll').checked = false;
        }
        function markTimeout(latTd, spdTd, tr) {
            latTd.textContent = '超时抛弃'; latTd.setAttribute('data-ms', 9999); latTd.style.color = '#ff3b30';
            spdTd.textContent = ' 超时 (>2000ms)'; spdTd.style.color = '#ff3b30';
            const cb = tr.querySelector('.row-checkbox');
            if(cb) { cb.disabled = true; cb.title = '不可用的节点无法被勾选'; }
        }
        async function doLocalPing(ip, tr, sourceLabel) {
            const latTd = tr.querySelector('.latency');
            const spdTd = tr.querySelector('.speed');
            const locTd = tr.querySelector('.loc');
            const queryIp = ip.replace(/[\\[\\]]/g, '');
            const isIPv6 = ip.includes(':'); 
            const isDomain = /[a-zA-Z]/.test(queryIp) && !isIPv6;
            if (isDomain) { locTd.innerHTML = \`<span class="badge" style="background:rgba(175,82,222,0.1);color:#af52de;margin-right:4px;">CNAME</span> \${sourceLabel} | 优选域名\`;
            } else {
                const recordLabel = isIPv6 ? '<span class="badge" style="background:rgba(50,173,230,0.1);color:#32ade6;margin-right:4px;">AAAA</span>' : '<span class="badge" style="background:rgba(0,113,227,0.1);color:#0071e3;margin-right:4px;">A记录</span>';
                fetch(\`https://api.ip.sb/geoip/\${queryIp}\`).then(res => res.json()).then(data => locTd.innerHTML = \`\${recordLabel} \${sourceLabel} | \${data.country || '未知'}\`).catch(() => locTd.innerHTML = \`\${recordLabel} \${sourceLabel} | 解析失败\`);
            }
            const start = performance.now();
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 2000); 
            const processResult = () => {
                const rawLatency = Math.round(performance.now() - start);
                if (rawLatency > 2000) return markTimeout(latTd, spdTd, tr);
                let displayLatency = rawLatency;
                if (!isIPv6 && !isDomain) {
                    if (rawLatency >= 500) { displayLatency = rawLatency - 400; } 
                    else { const base = 40 + (rawLatency / 500) * 60; displayLatency = Math.floor(base) + Math.floor(Math.random() * 10); }
                }
                updateRowState(latTd, spdTd, displayLatency);
            };
            try { await fetch(\`https://\${ip}/cdn-cgi/trace\`, { mode: 'no-cors', signal: controller.signal }); clearTimeout(timeoutId); processResult();
            } catch (err) { clearTimeout(timeoutId); if (err.name === 'AbortError') markTimeout(latTd, spdTd, tr); else processResult(); }
        }
        function updateRowState(latTd, spdTd, latency) {
            latTd.textContent = latency + ' ms'; latTd.setAttribute('data-ms', latency);
            if (latency < 300) { latTd.style.color = '#34c759'; spdTd.textContent = ' 极佳'; spdTd.style.color = '#34c759'; } 
            else if (latency <= 500) { latTd.style.color = 'var(--primary)'; spdTd.textContent = ' 正常'; spdTd.style.color = 'var(--primary)'; } 
            else { latTd.style.color = '#ff9500'; spdTd.textContent = ' 较高'; spdTd.style.color = '#ff9500'; }
        }
        function sortTableByLatency(tbody) {
            const rows = Array.from(tbody.querySelectorAll('.test-row'));
            rows.sort((a, b) => {
                const msA = parseInt(a.querySelector('.latency').getAttribute('data-ms') || 9999);
                const msB = parseInt(b.querySelector('.latency').getAttribute('data-ms') || 9999);
                return msA - msB;
            });
            rows.forEach(row => tbody.appendChild(row));
        }
        async function sendDnsRequest(ips, btnElement) {
            const originalText = btnElement.textContent;
            btnElement.textContent = ' 更新 DNS 中...'; btnElement.disabled = true;
            try {
                const res = await fetch('/api/update-dns', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ips }) });
                const data = await res.json();
                if(data.success) { showToast(data.message); btnElement.textContent = '✅ 更新成功'; loadDNS(); } 
                else { showToast('❌ 错误: ' + (data.error || '')); btnElement.textContent = originalText; }
            } catch(e) { showToast('❌ 网络异常，请重试'); btnElement.textContent = originalText; } 
            finally { setTimeout(() => { if(btnElement.textContent === ' 更新成功') btnElement.textContent = originalText; btnElement.disabled = false; }, 3000); }
        }
        function updateSingleDns(ip, btnElement) {
            if(!confirm(\`确定要将域名解析到：\\n\${ip} \\n警告：这会覆盖域名下的所有解析记录！\`)) return;
            sendDnsRequest([ip], btnElement);
        }
        function updateSelectedToDns() {
            const btn = document.getElementById('btnSelectedDns');
            const ips = getSelectedIps();
            if (ips.length === 0) return showToast('⚠️ 请先勾选您想使用的节点');
            if(!confirm(\`将应用勾选的 \${ips.length} 个节点：\\n\${ips.join('\\n')}\\n确定更新 DNS 记录吗？\`)) return;
            sendDnsRequest(ips, btn);
        }
        function updateTop3ToDns() {
            const btn = document.getElementById('btnTop3Dns');
            const rows = document.querySelectorAll('#testTableBody .test-row');
            let topIps = [];
            for(let i = 0; i < rows.length; i++) {
                const ms = parseInt(rows[i].querySelector('.latency').getAttribute('data-ms'));
                if(ms < 2000) topIps.push(rows[i].querySelector('.ip-text').textContent);
                if(topIps.length === 3) break;
            }
            if(topIps.length === 0) return showToast('⚠️ 没找到可用节点，请先测速');
            if(!confirm(\`将为您分发当前最快的 \${topIps.length} 个节点：\\n\${topIps.join('\\n')}\\n确定更新 DNS 记录吗？\`)) return;
            sendDnsRequest(topIps, btn);
        }
        async function loadDNS() {
            try {
                const res = await fetch('/api/get-dns'); const data = await res.json(); const container = document.getElementById('dnsStatus');
                if (data.success && data.result) {
                    const records = data.result.filter(r => r.type === 'A' || r.type === 'AAAA' || r.type === 'CNAME');
                    if (records.length === 0) container.innerHTML = '<span class="badge" style="background:rgba(255,149,0,0.1);color:#ff9500;">暂无解析记录</span>';
                    else container.innerHTML = records.map(r => \`<span class="badge" style="background:rgba(0,113,227,0.1);color:var(--primary);border:1px solid rgba(0,113,227,0.2);">\${r.type} | \${r.content}</span>\`).join('');
                } else container.innerHTML = \`<span class="badge" style="background:rgba(255,59,48,0.1);color:#ff3b30;">\${data.error || '获取失败'}</span>\`;
            } catch (e) { document.getElementById('dnsStatus').innerHTML = '<span class="badge" style="background:rgba(255,59,48,0.1);color:#ff3b30;">网络异常</span>'; }
        }
        
        function logout() {
            fetch('/api/logout', { method: 'POST' }).catch(function(){}).then(function(){ window.location.reload(); });
        }
        function confirmLogout() {
            if (window.confirm('确定要退出系统吗？')) { logout(); }
        }

        // 初始化加载
        loadIcons().then(() => {
            load();
            loadDNS();
        });

        // ==========================================
        //  新增：RTT 实时监测引擎 (每隔 3 秒探测一次)
        // ==========================================
        async function measureRTT() {
            const start = performance.now();
            try {
                // 加上时间戳强制绕过浏览器本地缓存
                await fetch('/__client_rtt__?t=' + Date.now(), { mode: 'no-cors', cache: 'no-store' });
                const rtt = Math.round(performance.now() - start);
                const rttEl = document.getElementById('rttValue');
                const dotEl = document.getElementById('rttDot');
                
                rttEl.textContent = rtt + ' ms';
                
                // 根据延迟改变呼吸灯颜色
                if (rtt < 80) {
                    dotEl.style.background = '#34c759'; dotEl.style.boxShadow = '0 0 8px #34c759';
                    rttEl.style.color = '#34c759';
                } else if (rtt < 200) {
                    dotEl.style.background = '#ff9500'; dotEl.style.boxShadow = '0 0 8px #ff9500';
                    rttEl.style.color = '#ff9500';
                } else {
                    dotEl.style.background = '#ff3b30'; dotEl.style.boxShadow = '0 0 8px #ff3b30';
                    rttEl.style.color = '#ff3b30';
                }
            } catch (e) {
                document.getElementById('rttValue').textContent = '断连';
                document.getElementById('rttDot').style.background = '#ff3b30';
            }
        }
        
        // 先立即执行一次，然后每 3 秒循环探测
        measureRTT();
        setInterval(measureRTT, 3000);

    //  新增：前端探针自动检测脚本
        async function fetchCfTrace() {
            try {
                const res = await fetch('/api/trace');
                const data = await res.json();
                if (data.success) {
                    // 拼接访客入口信息：国家 城市 (机房代码)
                    let entryText = data.entryCountry;
                    if (data.entryCity && data.entryCity !== '未知') entryText += ' ' + data.entryCity;
                    entryText += ' (' + data.entryColo + ')';
                    
                    document.getElementById('trace-entry').innerText = entryText;
                    
                    // 落地机房处理
                    const egressText = data.egressColo;
                    const egressElem = document.getElementById('trace-egress');
                    egressElem.innerText = egressText;
                    
                    // 核心逻辑：如果入口和落地机房不一致，显示高亮提示（智能调度触发）
                    if (data.entryColo !== egressText && egressText !== '探测中...' && egressText !== '获取失败') {
                        egressElem.style.color = '#ff9500'; // 变成橘黄色警示
                        egressElem.innerText += ' (智能放置/回源)';
                    }
                }
            } catch(e) {
                document.getElementById('trace-entry').innerText = '获取超时';
                document.getElementById('trace-egress').innerText = '获取超时';
            }
        }
        
        // 当网页加载完成时，延迟0.5秒执行探针扫描（避免卡顿主页渲染）
        window.addEventListener('DOMContentLoaded', () => {
            setTimeout(fetchCfTrace, 500);
            loadLogo();
        });
    //  新增：全云厂商节点数据库 (包含 Cloudflare 支持的所有主要区域)
        var cfRegions = {
            aws: [
                { label: " 中国香港", value: "aws:ap-east-1" },
                { label: " 日本 (东京)", value: "aws:ap-northeast-1" },
                { label: " 日本 (大阪)", value: "aws:ap-northeast-3" },
                { label: " 新加坡", value: "aws:ap-southeast-1" },
                { label: " 韩国 (首尔)", value: "aws:ap-northeast-2" },
                { label: " 美国西部 (加州)", value: "aws:us-west-1" },
                { label: " 美国西部 (俄勒冈)", value: "aws:us-west-2" },
                { label: " 美国东部 (弗吉尼亚)", value: "aws:us-east-1" },
                { label: " 澳大利亚 (悉尼)", value: "aws:ap-southeast-2" },
                { label: " 印度 (孟买)", value: "aws:ap-south-1" },
                { label: " 英国 (伦敦)", value: "aws:eu-west-2" },
                { label: " 德国 (法兰克福)", value: "aws:eu-central-1" }
            ],
            gcp: [
                { label: " 中国台湾 (彰化)", value: "gcp:asia-east1" },
                { label: " 中国香港", value: "gcp:asia-east2" },
                { label: " 日本 (东京)", value: "gcp:asia-northeast1" },
                { label: " 日本 (大阪)", value: "gcp:asia-northeast2" },
                { label: " 韩国 (首尔)", value: "gcp:asia-northeast3" },
                { label: " 新加坡", value: "gcp:asia-southeast1" },
                { label: " 美国西部 (洛杉矶)", value: "gcp:us-west2" },
                { label: " 美国西部 (俄勒冈)", value: "gcp:us-west1" },
                { label: " 美国东部 (弗吉尼亚)", value: "gcp:us-east4" },
                { label: " 澳大利亚 (悉尼)", value: "gcp:australia-southeast1" },
                { label: " 英国 (伦敦)", value: "gcp:europe-west2" },
                { label: " 德国 (法兰克福)", value: "gcp:europe-west3" }
            ],
            azure: [
                { label: " 中国香港 (East Asia)", value: "azure:eastasia" },
                { label: " 新加坡 (Southeast Asia)", value: "azure:southeastasia" },
                { label: " 日本东部 (东京)", value: "azure:japaneast" },
                { label: " 日本西部 (大阪)", value: "azure:japanwest" },
                { label: " 韩国中部 (首尔)", value: "azure:koreacentral" },
                { label: " 美国西部 (West US)", value: "azure:westus" },
                { label: " 美国东部 (East US)", value: "azure:eastus" },
                { label: " 英国南部 (伦敦)", value: "azure:uksouth" },
                { label: " 西欧 (荷兰)", value: "azure:westeurope" }
            ]
        };

        //  新增：联动菜单处理逻辑
        function handleModeChange() {
            var mode = document.getElementById('cf-mode-select').value;
            var regionSelect = document.getElementById('cf-region-select');
            var customInput = document.getElementById('cf-custom-input');
            
            regionSelect.style.display = 'none';
            customInput.style.display = 'none';
            
            if (mode === 'aws' || mode === 'gcp' || mode === 'azure') {
                regionSelect.style.display = 'block';
                regionSelect.innerHTML = ''; 
                var regions = cfRegions[mode];
                regions.forEach(function(r) {
                    var opt = document.createElement('option');
                    opt.value = r.value;
                    opt.innerText = r.label;
                    regionSelect.appendChild(opt);
                });
            } else if (mode === 'custom') {
                customInput.style.display = 'block';
            }
        }

        //  新增：调用部署修改接口
        async function updatePlacement() {
            var statusElem = document.getElementById('place-status');
            var modeVal = document.getElementById('cf-mode-select').value;
            var placementPayload = {};
            
            if (modeVal === 'aws' || modeVal === 'gcp' || modeVal === 'azure') {
                var regionVal = document.getElementById('cf-region-select').value;
                placementPayload = { region: regionVal };
            } else if (modeVal === 'custom') {
                var customVal = document.getElementById('cf-custom-input').value;
                if (!customVal || customVal.trim() === '') {
                    statusElem.innerText = " 请填写自定义区域代码（如 gcp:asia-east2）";
                    statusElem.style.color = "#ff3b30";
                    return;
                }
                placementPayload = { region: customVal.trim() };
            } else {
                placementPayload = JSON.parse(modeVal);
            }

            statusElem.innerText = "⏳ 正在提交请求，请稍候...";
            statusElem.style.color = "#ff9500";
            
            try {
                var res = await fetch('/api/placement', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ placement: placementPayload })
                });
                if (!res.ok) {
                    statusElem.innerText = ' 请求被拒绝(' + res.status + ')，请重新登录后重试';
                    statusElem.style.color = "#ff3b30";
                    return;
                }
                var data = await res.json();
                if (data.success) {
                    statusElem.innerText = " " + data.msg;
                    statusElem.style.color = "#34c759";
                } else {
                    statusElem.innerText = " " + data.msg;
                    statusElem.style.color = "#ff3b30";
                }
            } catch(e) {
                statusElem.innerText = " 网络错误: " + e.message;
                statusElem.style.color = "#ff3b30";
            }
        }
    //  魔法功能：自动继承现有的模式选项 (增强稳定版)
        setTimeout(() => {
            const sourceSelect = document.getElementById('mode');
            const batchSelect = document.getElementById('batch-mode-select');
            if (sourceSelect && batchSelect) {
                batchSelect.innerHTML = sourceSelect.innerHTML;
            }
        }, 100); 

        //  全选 / 取消全选逻辑
        function toggleSelectAll(checkbox) {
            const checkboxes = document.querySelectorAll('.node-cb');
            checkboxes.forEach(cb => cb.checked = checkbox.checked);
        }

        //  并发批量修改模式逻辑 (终极多线程逐个击破版)
        async function batchUpdateModes() {
            const statusElem = document.getElementById('batch-status');
            const newMode = document.getElementById('batch-mode-select').value;
            
            const selectedPrefixes = Array.from(document.querySelectorAll('.node-cb:checked')).map(cb => cb.value);

            if (selectedPrefixes.length === 0) {
                statusElem.innerText = " 请先打勾需要修改的节点！";
                statusElem.style.color = "#ff9500";
                return;
            }

            if (!confirm("确定要将勾选的 " + selectedPrefixes.length + " 个节点切换为该模式吗？")) return;

            statusElem.innerText = "⏳ 正在多线程并发修改节点...";
            statusElem.style.color = "var(--primary)";

            try {
                // 1. 先获取当前所有的节点详细数据
                const getRes = await fetch('/api/routes');
                const allRoutes = await getRes.json();
                
                // 2. 筛选出你要修改的那些节点
                const nodesToUpdate = allRoutes.filter(r => selectedPrefixes.includes(r.prefix));

                // 3. 核心魔法：Promise.all 并发！瞬间发出多个独立的保存请求
                await Promise.all(nodesToUpdate.map(async (r) => {
                    const payload = Object.assign({}, r);
                    payload.oldPrefix = r.prefix; 
                    payload.mode = newMode; 
                    
                    const postRes = await fetch('/api/routes', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                    });
                    
                    if (!postRes.ok) {
                        throw new Error("节点 " + r.prefix + " 保存失败");
                    }
                }));
                
                statusElem.innerText = " 批量修改成功！";
                statusElem.style.color = "#34c759";
                setTimeout(() => location.reload(), 1000); 

            } catch (e) {
                statusElem.innerText = " 失败: " + e.message;
                statusElem.style.color = "#ff3b30";
            }
        }
    async function deployWorker() {
            const codeArea = document.getElementById('codeArea');
            const fileInput = document.getElementById('fileInput');
            let codeContent = codeArea.value;
            if (fileInput.files.length > 0) {
                const file = fileInput.files[0];
                codeContent = await file.text();
            }
            if (!codeContent.trim()) {
                alert(' 失败：请先粘贴代码，或者选择一个 .js 文件！');
                return;
            }
            if (!confirm(' 危险操作确认 \\n\\n你即将强行覆盖当前 Worker 的代码。\\n如果新代码有错误，此面板将会瘫痪，只能去网页后台抢修！\\n\\n确定代码 100% 正确并覆盖吗？')) return;
            const btn = document.getElementById('deployBtn');
            const originalText = btn.innerText;
            btn.innerText = '⏳ 正在与 Cloudflare 通信并部署...';
            btn.disabled = true;
            btn.style.opacity = '0.7';
            try {
                const res = await fetch('/api/deploy', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ newCode: codeContent })
                });
                const data = await res.json();
                if (data.success) {
                    alert(' 成功！' + data.msg + '\\n\\n点击确定后页面将自动刷新。');
                    window.location.reload(); 
                } else {
                    alert(' 部署失败：\\n' + JSON.stringify(data.error));
                }
            } catch (e) {
                alert(' 异常：\\n' + e.message);
            } finally {
                btn.innerText = originalText;
                btn.disabled = false;
                btn.style.opacity = '1';
            }
        }
        // ==========================================
        //  在线更新模块
        // ==========================================
        // 这里的变量会自动从代码最顶端的配置区读取注入
        const CURRENT_VERSION = "${CURRENT_VERSION}"; 
        const GITHUB_RAW_URL = "${GITHUB_RAW_URL}"; 
        const CHANGELOG_URL = "${CHANGELOG_URL}"; 
        
        let latestCode = ""; 
        let latestVersion = "";
        let changelogCache = null;

        async function loadChangelog() {
            try {
                const res = await fetch(CHANGELOG_URL + '?t=' + new Date().getTime());
                if (!res.ok) return null;
                changelogCache = await res.json();
                return changelogCache;
            } catch (e) { console.log("拉取更新内容失败:", e); return null; }
        }

        async function loadVersionPanel() {
            try {
                const res = await fetch('/api/version');
                const data = await res.json();
                if (data.success) {
                    const badge = document.getElementById('curVersionBadge');
                    if (badge) badge.textContent = 'v' + data.version;
                    const chk = document.getElementById('updateNotifyChk');
                    if (chk) chk.checked = !!data.updateNotify;
                }
            } catch (e) {}
            const cl = await loadChangelog();
            if (cl && cl.versions && cl.versions.length) {
                const latest = cl.versions[0];
                const lc = document.getElementById('latestChangelog');
                if (lc) lc.innerHTML = '<div style="font-weight:600; color:var(--text);">v' + escHtml(latest.version) + ' · ' + escHtml(latest.date || '') + (latest.title ? ' · ' + escHtml(latest.title) : '') + '</div>' + (latest.items || []).map(i => '· ' + escHtml(i)).join('<br>');
                const hc = document.getElementById('historyChangelog');
                if (hc) hc.innerHTML = cl.versions.slice(1).map(v => '<div style="margin-bottom:10px;"><span style="font-weight:600;">v' + escHtml(v.version) + '</span> <span style="color:var(--text-sec);">(' + escHtml(v.date || '') + ')</span>' + (v.title ? ' ' + escHtml(v.title) : '') + '<br>' + (v.items || []).map(i => '&nbsp;&nbsp;· ' + escHtml(i)).join('<br>') + '</div>').join('') || '暂无更多历史记录';
            } else {
                const lc = document.getElementById('latestChangelog');
                if (lc) lc.textContent = '暂无更新内容';
            }
        }

        async function saveUpdateNotify() {
            const chk = document.getElementById('updateNotifyChk');
            const on = chk ? chk.checked : true;
            try {
                const res = await fetch('/api/account', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ updateNotify: on }) });
                const data = await res.json();
                if (data.success) showToast(on ? '更新提醒已开启' : '更新提醒已关闭');
                else alert('保存失败：' + (data.error || ''));
            } catch (e) { alert('保存失败：' + e.message); }
        }

        function verCmp(a, b) {
            const pa = String(a).replace(/[^0-9.]/g, '').split('.').map(Number);
            const pb = String(b).replace(/[^0-9.]/g, '').split('.').map(Number);
            for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
                const x = pa[i] || 0, y = pb[i] || 0;
                if (x > y) return 1; if (x < y) return -1;
            }
            return 0;
        }

        async function checkForUpdates(manual) {
            try {
                const res = await fetch(GITHUB_RAW_URL + '?t=' + new Date().getTime());
                if (!res.ok) { if (manual) alert('检查更新失败：无法访问更新源'); return; }
                latestCode = await res.text();
                
                //  核心修复：提取完整版本串（含 beta 后缀），防止 -beta/（beta） 被丢弃导致永远误判有新版本
                const versionMatch = latestCode.match(/\\/\\/\\s*VERSION:\\s*"?v?([^"\\n]+)"?/i);
                if (!versionMatch || !versionMatch[1]) { if (manual) alert('未获取到版本信息'); return; }
                latestVersion = versionMatch[1];
                if (latestVersion === CURRENT_VERSION) {
                    if (manual) alert('当前已是最新版本 v' + CURRENT_VERSION);
                    return;
                }
                // 本地版本高于公开版时静默(测试仓预览版不弹反向更新提示)
                if (verCmp(CURRENT_VERSION, latestVersion) > 0) {
                    if (manual) alert('当前已领先公开版:本地 v' + CURRENT_VERSION + ' ≥ 公开版 v' + latestVersion);
                    return;
                }
                const cl = changelogCache || await loadChangelog();
                let items = []; let title = '';
                if (cl && cl.versions && cl.versions.length) {
                    const v = cl.versions.find(x => x.version === latestVersion) || cl.versions[0];
                    items = v.items || []; title = v.title || '';
                }
                if (!manual) {
                    try {
                        const vres = await fetch('/api/version');
                        const vdata = await vres.json();
                        if (vdata.success && !vdata.updateNotify) return;   // 关闭了更新提醒则静默
                    } catch (e) {}
                }
                showUpdateModal(latestVersion, title, items);
            } catch (e) {
                console.log("检测更新失败:", e);
                if (manual) alert('检查更新失败：' + e.message);
            }
        }

        function showUpdateModal(version, title, items) {
            document.getElementById('updateModalVersion').textContent = 'v' + version;
            document.getElementById('updateModalCurVer').textContent = 'v' + CURRENT_VERSION;
            document.getElementById('updateModalBody').innerHTML = '<div style="font-size:13px; font-weight:600; margin-bottom:8px;">' + escHtml(title || '本次更新内容') + '</div>' + (items && items.length ? items.map(i => '· ' + escHtml(i)).join('<br>') : '<span style="color:var(--text-sec);">暂无详细更新内容</span>');
            document.getElementById('updateModal').style.display = 'block';
        }
        function hideUpdateModal() { document.getElementById('updateModal').style.display = 'none'; }

        async function manualUpdateFlow() {
            if (!latestCode) { checkForUpdates(true); return; }
            if (latestVersion === CURRENT_VERSION) { alert('当前已是最新版本 v' + CURRENT_VERSION); return; }
            const cl = changelogCache || await loadChangelog();
            let items = []; let title = '';
            if (cl && cl.versions && cl.versions.length) {
                const v = cl.versions.find(x => x.version === latestVersion) || cl.versions[0];
                items = v.items || []; title = v.title || '';
            }
            showUpdateModal(latestVersion, title, items);
        }

        async function doOnlineUpdate() {
            hideUpdateModal();
            if (!latestCode) { checkForUpdates(true); return; }
            
            const btn = document.getElementById('onlineUpdateBtn');
            if (btn) { btn.innerText = '⏳ 正在拉取并部署...'; btn.disabled = true; btn.style.opacity = '0.7'; }
            try {
                // 直接复用我们之前写好的防丢数据库高级 API
                const res = await fetch('/api/deploy', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ newCode: latestCode })
                });
                const data = await res.json();
                if (data.success) {
                    const cl = changelogCache || await loadChangelog();
                    let items = [];
                    if (cl && cl.versions && cl.versions.length) {
                        const v = cl.versions.find(x => x.version === latestVersion) || cl.versions[0];
                        items = v.items || [];
                    }
                    document.getElementById('updateResultBody').innerHTML = '<div style="font-size:13px; margin-bottom:8px;">已成功更新到 <b style="color:var(--primary);">v' + escHtml(latestVersion) + '</b>，本次更新内容：</div>' + (items.length ? items.map(i => '· ' + escHtml(i)).join('<br>') : '暂无详细更新内容');
                    document.getElementById('updateResultModal').style.display = 'block';
                } else {
                    alert(' 更新失败：\\n' + JSON.stringify(data.error));
                }
            } catch (e) {
                alert(' 异常：\\n' + e.message);
            } finally {
                if (btn) { btn.innerText = ' 一键拉取并升级'; btn.disabled = false; btn.style.opacity = '1'; }
            }
        }

        // 页面加载完成后自动在后台静默检测更新
        document.addEventListener('DOMContentLoaded', () => checkForUpdates(false));
    </script>
    <style>
    /* 修正页面底部留白，防止被 Dock 挡住 */
    body { padding-bottom: 90px !important; }
    
    /* 页面切换动画 */
    .page-view { display: none; opacity: 0; animation: dsFadeIn 0.3s forwards; }
    .page-view.active { display: block; opacity: 1; }
    @keyframes dsFadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }

    /* 底部dock栏UI */
    .ds-dock { 
        position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%); 
        width: calc(100% - 32px); max-width: 600px; 
        background: var(--card); backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); 
        border: 1px solid var(--border); border-radius: 36px; padding: 8px 12px; 
        display: flex; justify-content: space-around; 
        box-shadow: 0 20px 40px rgba(0,0,0,0.12), 0 4px 12px rgba(0,0,0,0.05); z-index: 9999; 
    }
    .ds-dock-item { 
        display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; 
        padding: 8px 16px; border-radius: 30px; color: var(--text-sec); font-size: 12px; 
        font-weight: 500; transition: all 0.2s; background: transparent; border: none; cursor: pointer; flex: 1; 
    }
    .ds-dock-item.active { color: var(--primary); background: rgba(0,113,227,0.1); }
    .ds-dock-item svg { width: 24px; height: 24px; fill: currentColor; }

    /* 页脚:内容后留空一截,显示"玛卡巴卡反代面板",点击跳公开仓库 */
    /* 页脚:margin-top auto 贴页面底部;渐变分隔线 + 渐变品牌字(点击跳公开仓库) */
    .page-footer{margin-top:auto;padding:44px 24px 44px;text-align:center;cursor:pointer;position:relative;-webkit-tap-highlight-color:transparent}
    .pf-line{position:absolute;top:0;left:50%;transform:translateX(-50%);width:min(320px,62%);height:1px;background:linear-gradient(90deg,transparent,#00d4ff,#7c5cff,transparent);opacity:.7}
    .pf-brand{display:flex;align-items:center;justify-content:center;gap:9px}
    .pf-brand svg{width:17px;height:17px;fill:#00d4ff;opacity:.9}
    .pf-brand span{font-size:14.5px;font-weight:800;letter-spacing:2.5px;background:linear-gradient(90deg,#00d4ff,#7c5cff);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
    .pf-arrow{margin-top:12px;font-size:11px;letter-spacing:1px;color:var(--text-sec);opacity:.75;transition:all .2s}
    .page-footer:hover .pf-arrow,.page-footer:active .pf-arrow{opacity:1;color:var(--primary)}
</style>

<div class="page-footer" onclick="window.open('https://github.com/MakkaPakka518/EmbyProxy-CF-FAKE','_blank')" title="前往公开仓库">
    <div class="pf-line"></div>
    <div class="pf-brand">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M4.5 16.5c-1.5 1.3-2 5-2 5s3.7-.5 5-2c.7-.8.7-2 0-2.8-.8-.7-2.2-.7-3 .8z"/><path d="M12 15l-3-3c.5-4 4-7.5 8-8 2 .2 3.8 2 4 4-.5 4-4 7.5-8 8l-1-1z"/></svg>
        <span>玛卡巴卡反代面板</span>
    </div>
    <div class="pf-arrow">查看公开仓库 ↗</div>
</div>

<nav class="ds-dock">
    <button class="ds-dock-item active" onclick="switchDsView('nodes', this)">
        <svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>
        <span>节点</span>
    </button>
    <button class="ds-dock-item" onclick="switchDsView('speed', this)">
        <svg viewBox="0 0 24 24"><path d="M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z"/></svg>
        <span>测速与DNS</span>
    </button>
    <button class="ds-dock-item" onclick="switchDsView('settings', this)">
        <svg viewBox="0 0 24 24"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.33-.02-.64-.06-.94l2.02-1.58c.18-.14.23-.38.12-.56l-1.89-3.28c-.12-.19-.36-.26-.56-.18l-2.38.96c-.5-.38-1.06-.68-1.66-.88L14.45 3.5c-.04-.2-.2-.34-.4-.34h-3.78c-.2 0-.36.14-.4.34l-.3 2.52c-.6.2-1.16.5-1.66.88l-2.38-.96c-.2-.08-.44-.01-.56.18l-1.89 3.28c-.12.19-.07.42.12.56l2.02 1.58c-.04.3-.06.61-.06.94 0 .33.02.64.06.94l-2.02 1.58c-.18.14-.23.38-.12.56l1.89 3.28c.12.19.36.26.56.18l2.38-.96c.5.38 1.06.68 1.66.88l.3 2.52c.04.2.2.34.4.34h3.78c.2 0 .36-.14.4-.34l.3-2.52c.6-.2 1.16-.5 1.66-.88l2.38.96c.2.08.44.01.56-.18l1.89-3.28c.12-.19.07-.42-.12-.56l-2.02-1.58zM12 15c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3z"/></svg>
        <span>控制面板</span>
    </button>
</nav>

<script>
// 1. 切换页面的核心逻辑
function switchDsView(viewId, btn) {
    document.querySelectorAll('.ds-dock-item').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.page-view').forEach(v => v.classList.remove('active'));
    document.getElementById('view-' + viewId).classList.add('active');
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// 2. 将原版超长页面，智能装进 3 个分类盒子中
window.addEventListener('DOMContentLoaded', () => {
    const container = document.querySelector('.container');
    const contentWrap = document.querySelector('.content-wrap');
    if (!container) return; 

    // 把弹窗移到 body 末尾，避免被 contentWrap.remove() 一并删除
    ['nodeModal', 'codeModal', 'placementModal', 'accountModal', 'kaModal', 'kaCenterModal', 'kaDetailModal', 'rexModal', 'updateModal', 'updateResultModal', 'nodeReqModal', 'subReqModal'].forEach(id => {
        const m = document.getElementById(id);
        if (m) document.body.appendChild(m);
    });

    // 把顶部固定栏移到 body 顶层，避免被 .page-view 的 transform 动画破坏 fixed 定位
    const topbarEl = document.querySelector('.topbar');
    if (topbarEl) document.body.appendChild(topbarEl);

    // 置顶最顶部的 header
    const header = document.querySelector('.header');
    if (header) container.insertBefore(header, container.firstChild);

    // 建立 3 个干净的虚拟房间
    const views = {
        'nodes': document.createElement('div'),
        'speed': document.createElement('div'),
        'settings': document.createElement('div')
    };
    for (let k in views) {
        views[k].id = 'view-' + k;
        views[k].className = 'page-view';
        if (k === 'nodes') views[k].classList.add('active');
    }

    // 用于暂存底部声明信息的数组
    let footers = []; 

    // 智能抓取并分类
    function sortCard(el) {
        if (!el || el === header || el.tagName === 'NAV' || el.id === 'toast' || el.id === 'nodeModal' || el.id === 'codeModal' || el.id === 'placementModal' || el.id === 'accountModal' || el.id === 'kaModal' || el.id === 'kaCenterModal' || el.id === 'kaDetailModal' || el.id === 'rexModal' || el.id === 'updateModal' || el.id === 'updateResultModal' || el.id === 'nodeReqModal' || el.id === 'subReqModal' || el.classList.contains('page-view') || el.classList.contains('content-wrap') || el.classList.contains('topbar')) return;
        const text = el.innerText || el.innerHTML || '';
        
        // 【1】免责声明与联系作者：先扣留，不要马上分配！
        if (text.includes('联系作者') || text.includes('免责声明') || text.includes('交流群')) {
            footers.push(el);
            return;
        }
        
        // 【2】分配到测速页
        if (text.includes('测速与动态 DNS') || text.includes('专属线路测速') || text.includes('提取预设源') || text.includes('ITDog')) {
            views['speed'].appendChild(el);
            return;
        }
        
        // 【3】分配到控制面板页（仅限 Worker 核心与区域调度）
        if (text.includes('手动覆盖') || text.includes('Worker 调度模式') || el.id === 'updateAlert' || el.id === 'cf-trace-card' || el.id === 'config-backup-card' || el.id === 'ipguard-card') {
            views['settings'].appendChild(el);
            return;
        }
        
        // 【4】剩下的统统丢进【节点管理页】（完美解决表单和列表分家的问题）
        if (text.trim() !== "") {
            views['nodes'].appendChild(el);
        }
    }

    // 执行所有卡片的搬家
    Array.from(container.children).forEach(sortCard);
    if (contentWrap) {
        Array.from(contentWrap.children).forEach(sortCard);
        contentWrap.remove(); // 销毁原本的包装盒
    }

    // 【解决 Bug】：把刚才扣留的免责声明等元素，追加到控制面板的最末尾
    footers.forEach(f => views['settings'].appendChild(f));

    // 将 3 个分好类的房间放回页面
    container.appendChild(views['nodes']);
    container.appendChild(views['speed']);
    container.appendChild(views['settings']);

    // 识别角色（管理员/订阅者），订阅者自动进入只读模式
    initRole();

    // 加载 IP 访问控制配置
    loadIpGuard();

    // 【体验优化】劫持编辑事件，点击编辑时平滑滚动到顶部的表单处
    const originalEditRoute = window.editRoute;
    if (typeof originalEditRoute === 'function') {
        window.editRoute = function(index) {
            originalEditRoute(index);
            // 因为现在表单和列表都在节点页，所以直接平滑滚动到最上面就能看到填好的表单了！
            window.scrollTo({ top: 0, behavior: 'smooth' });
        };
    }
});
</script>
</body>
</html>
`;

// ==========================================
// IP 封锁逃生入口(不受 IP 拦截与 token 模式影响,只认管理员密码)
// ==========================================
const ENTRY_UI = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>管理员逃生入口</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{min-height:100vh;display:flex;align-items:center;justify-content:center;flex-direction:column;background:linear-gradient(135deg,#0f2027,#203a43,#2c5364);font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif;color:#e8eaed;padding:20px}
.card{background:rgba(255,255,255,.06);backdrop-filter:blur(12px);border:1px solid rgba(255,255,255,.12);border-radius:18px;padding:32px;width:100%;max-width:420px;box-shadow:0 20px 60px rgba(0,0,0,.4);margin-bottom:16px}
h1{font-size:19px;margin-bottom:8px;text-align:center}
.sub{font-size:13px;color:#aab4c0;text-align:center;margin-bottom:18px;line-height:1.6}
input[type=password],input[type=text],textarea{width:100%;padding:12px 14px;border:1px solid rgba(255,255,255,.18);border-radius:10px;background:rgba(255,255,255,.07);color:#fff;font-size:14px;outline:none;margin-bottom:12px;box-sizing:border-box}
input:focus,textarea:focus{border-color:#4da3ff}
textarea{resize:vertical;min-height:80px}
button{width:100%;padding:13px;border:none;border-radius:10px;background:#4da3ff;color:#fff;font-size:15px;font-weight:600;cursor:pointer}
button:active{opacity:.85}
button.ghost{background:transparent;border:1px solid rgba(255,255,255,.3);margin-top:8px}
.row{display:flex;gap:14px;align-items:center;flex-wrap:wrap;font-size:13px;margin-bottom:12px}
.row label{display:flex;align-items:center;gap:5px;cursor:pointer}
.err{color:#ff6b6b;font-size:13px;text-align:center;margin-top:10px;min-height:18px}
.ok{color:#34c759;font-size:13px;text-align:center;margin-top:10px;min-height:18px}
.tip{margin-top:16px;font-size:12px;color:#8b96a3;text-align:center;line-height:1.7}
</style>
</head>
<body>
<div class="card" id="loginCard">
<h1>&#128274; 管理员逃生入口</h1>
<div class="sub">当前 IP 被访问控制拦截时,<br>输入管理员密码即可解锁并管理</div>
<input type="password" id="pass" placeholder="管理员密码" autocomplete="off">
<button onclick="go()">解锁</button>
<div class="err" id="err"></div>
</div>
<div class="card" id="manageCard" style="display:none; max-width:460px;">
<h1>&#9881; IP 访问控制</h1>
<div class="sub">你的 IP <b id="myIp" style="color:#fff;">-</b> 已加入最高白名单,<br>任何模式都可访问面板与节点</div>
<div class="row">
<label><input type="radio" name="m" value="off" style="accent-color:#4da3ff;"> 关闭</label>
<label><input type="radio" name="m" value="whitelist" style="accent-color:#4da3ff;"> 白名单</label>
<label><input type="radio" name="m" value="blacklist" style="accent-color:#4da3ff;"> 黑名单</label>
</div>
<textarea id="ips" placeholder="IP / 网段,每行一个,支持 CIDR&#10;如: 1.2.3.4&#10;5.6.7.0/24"></textarea>
<input type="text" id="countries" placeholder="国家/地区码,每行一个 ISO 两位码,如 US、RU、CN">
<input type="text" id="redirect" placeholder="跳转网址(被拦截时 302 跳转)">
<div style="margin-bottom:12px; border-top:1px solid rgba(255,255,255,.12); padding-top:12px;">
<div style="font-size:13px; font-weight:600; margin-bottom:6px;">最高白名单</div>
<div style="font-size:12px; color:#8b96a3; margin-bottom:8px; line-height:1.6;">你的 IP 已自动加入。共享节点的其他 IP 可在此删除,修改后点保存生效。</div>
<div id="tList" style="display:flex; flex-direction:column; gap:4px; margin-bottom:8px;"></div>
<div style="display:flex; gap:8px;">
<input type="text" id="tAdd" placeholder="输入要添加的 IP" style="flex:1; margin-bottom:0;">
<button onclick="tAddOne()" style="width:auto; padding:12px 14px; font-size:13px; background:rgba(255,255,255,.12);">添加</button>
</div>
</div>
<button onclick="save()">保存设置</button>
<div class="ok" id="sOk"></div>
<div class="err" id="sErr"></div>
<button class="ghost" onclick="goPanel()">进入面板 &rarr;</button>
<div class="tip">最高白名单在登录时自动加入,无需手动管理;<br>此入口不受 IP 封锁与 token 模式影响</div>
</div>
<script>
function $(id){return document.getElementById(id);}
async function go(){
  var p=$('pass').value.trim();
  var err=$('err');
  if(!p){err.textContent='请输入密码';return;}
  try{
    var r=await fetch('/api/entry',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pass:p})});
    var d=await r.json();
    if(d.success){
      err.textContent='';
      $('loginCard').style.display='none';
      $('manageCard').style.display='block';
      $('myIp').textContent=d.currentIp||'-';
      loadCfg();
    }else{err.textContent=d.error||'解锁失败';}
  }catch(e){err.textContent='请求失败: '+e.message;}
}
var ENTRY_TRUSTED=[];
function escHtmlE(v){return String(v||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function renderTList(){
  var box=$('tList');
  if(!box)return;
  if(!ENTRY_TRUSTED.length){box.innerHTML='<div style="font-size:12px;color:#8b96a3;">暂无信任 IP</div>';return;}
  box.innerHTML=ENTRY_TRUSTED.map(function(ip){return '<div style="display:flex;align-items:center;justify-content:space-between;font-size:12px;padding:5px 8px;background:rgba(255,255,255,.06);border-radius:6px;gap:8px;"><span style="word-break:break-all;">'+escHtmlE(ip)+'</span><button onclick="tDel(this)" data-ip="'+escHtmlE(ip)+'" style="background:none;border:none;color:#ff6b6b;cursor:pointer;font-size:13px;flex-shrink:0;">✕</button></div>';}).join('');
}
function tDel(btn){var ip=btn.getAttribute('data-ip');if(!ip)return;ENTRY_TRUSTED=ENTRY_TRUSTED.filter(function(x){return x!==ip;});renderTList();}
function tAddOne(){var v=$('tAdd').value.trim();if(!v)return;if(ENTRY_TRUSTED.indexOf(v)<0)ENTRY_TRUSTED.push(v);$('tAdd').value='';renderTList();}
async function loadCfg(){
  try{
    var r=await fetch('/api/ipguard');
    var d=await r.json();
    if(!d.success)return;
    var radios=document.querySelectorAll('input[name=m]');
    for(var i=0;i<radios.length;i++){radios[i].checked=(radios[i].value===d.mode);}
    $('ips').value=(d.ips||[]).join('\\n');
    $('countries').value=(d.countries||[]).join('\\n');
    $('redirect').value=d.redirect||'';
    ENTRY_TRUSTED=(d.trusted||[]).slice();
    renderTList();
  }catch(e){}
}
async function save(){
  var mode='off';
  var radios=document.querySelectorAll('input[name=m]');
  for(var i=0;i<radios.length;i++){if(radios[i].checked)mode=radios[i].value;}
  var ips=$('ips').value.split('\\n').map(function(x){return x.trim();}).filter(Boolean);
  var countries=$('countries').value.split('\\n').map(function(x){return x.trim().toUpperCase();}).filter(Boolean);
  var redirect=$('redirect').value.trim();
  $('sOk').textContent='';
  $('sErr').textContent='';
  try{
    var r=await fetch('/api/ipguard',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:mode,ips:ips,countries:countries,redirect:redirect,trusted:ENTRY_TRUSTED})});
    var d=await r.json();
    if(d.success){$('sOk').textContent='设置已保存';}else{$('sErr').textContent='保存失败: '+(d.error||'');}
  }catch(e){$('sErr').textContent='保存失败: '+e.message;}
}
function goPanel(){location.href='/';}
$('pass').addEventListener('keydown',function(e){if(e.key==='Enter'){go();}});
</script>
</body>
</html>`;

// ============ IP 被封提示页(未设置跳转网址时显示) ============
function escHtmlStr(v) { return String(v || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
const IP_BLOCKED_UI = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>访问已被禁止</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{min-height:100vh;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#1a1a2e,#16213e,#0f3460);font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif;color:#e8eaed;padding:20px}
.card{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);border-radius:18px;padding:36px;width:100%;max-width:400px;text-align:center}
h1{font-size:22px;margin-bottom:12px}
.sub{font-size:14px;color:#aab4c0;margin-bottom:20px;line-height:1.7;word-break:break-all}
.badge{display:inline-block;background:rgba(255,107,107,.15);border:1px solid rgba(255,107,107,.35);color:#ff6b6b;padding:4px 14px;border-radius:20px;font-size:13px;font-weight:600;margin-bottom:16px}
.tip{font-size:12px;color:#8b96a3;line-height:1.7}
</style>
</head>
<body>
<div class="card">
<span class="badge">&#128683; 访问已被禁止</span>
<h1>你的 IP 已被禁用</h1>
<div class="sub">当前 IP: <b style="color:#fff;">__IP__</b><br>地区: __COUNTRY__<br>该 IP 不在允许访问范围内</div>
<div class="tip">如有疑问请联系管理员</div>
</div>
</body>
</html>`;

const IP_BLOCKED_HARD_UI = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>访问已被禁止</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{min-height:100vh;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#2a0f0f,#1a1a2e,#0f3460);font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif;color:#e8eaed;padding:20px}
.card{background:rgba(255,255,255,.06);border:1px solid rgba(255,107,107,.25);border-radius:18px;padding:36px;width:100%;max-width:400px;text-align:center}
h1{font-size:22px;margin-bottom:12px}
.sub{font-size:14px;color:#aab4c0;margin-bottom:20px;line-height:1.7;word-break:break-all}
.badge{display:inline-block;background:rgba(255,107,107,.15);border:1px solid rgba(255,107,107,.35);color:#ff6b6b;padding:4px 14px;border-radius:20px;font-size:13px;font-weight:600;margin-bottom:16px}
.tip{font-size:12px;color:#8b96a3;line-height:1.7}
</style>
</head>
<body>
<div class="card">
<span class="badge">&#128683; 访问已被禁止</span>
<h1>你的 IP 已被拉黑</h1>
<div class="sub">当前 IP: <b style="color:#fff;">__IP__</b></div>
<div class="tip">该 IP 已被管理员加入最高黑名单，如有疑问请联系管理员</div>
</div>
</body>
</html>`;

// ==========================================
// 2. 后端 Worker 主逻辑处理区 (核心故障转移 + TG Bot播报 + 智能流量拉取)
// ==========================================

// 用于向 Cloudflare 获取对应时间段的总流量 (支持北京时间今日、近7天、近30天)
async function getCFTraffic(env, type) {
    if (!env.CF_API_TOKEN || !env.CF_ZONE_ID) return "缺少变量";
    try {
        const end = new Date();
        let graphqlQuery = {};

        if (type === 'today') {
            // 【今日流量】查询：从北京时间今日 00:00 算起，使用 AdaptiveGroups
            // 1. 获取北京时间并清零时分秒
            const beijingTime = new Date(end.getTime() + 8 * 3600000);
            beijingTime.setUTCHours(0, 0, 0, 0);
            // 2. 转回 UTC 供 API 查询
            const start = new Date(beijingTime.getTime() - 8 * 3600000);
            
            graphqlQuery = {
                query: `
                query {
                  viewer {
                    zones(filter: {zoneTag: "${env.CF_ZONE_ID}"}) {
                      httpRequestsAdaptiveGroups(
                        limit: 1,
                        filter: {
                          datetime_geq: "${start.toISOString()}",
                          datetime_leq: "${end.toISOString()}"
                        }
                      ) {
                        sum {
                          edgeResponseBytes
                        }
                      }
                    }
                  }
                }`
            };
        } else {
            // 【7天、30天】查询：传入数字代表天数，使用 1dGroups（按北京时间日期范围）
            const bjNow = new Date(end.getTime() + 8 * 3600000);
            const start = new Date(bjNow.getTime() - type * 24 * 3600000);
            const dateGeq = start.toISOString().split('T')[0];
            const dateLeq = bjNow.toISOString().split('T')[0];
            graphqlQuery = {
                query: `
                query {
                  viewer {
                    zones(filter: {zoneTag: "${env.CF_ZONE_ID}"}) {
                      httpRequests1dGroups(
                        limit: 10000,
                        filter: {
                          date_geq: "${dateGeq}",
                          date_leq: "${dateLeq}"
                        }
                      ) {
                        sum {
                          bytes
                        }
                      }
                    }
                  }
                }`
            };
        }

        const cfRes = await fetch('https://api.cloudflare.com/client/v4/graphql', {
            method: 'POST',
            headers: { 
                'Authorization': `Bearer ${env.CF_API_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(graphqlQuery)
        });
        
        const cfData = await cfRes.json();
        
        if (cfData.errors && cfData.errors.length > 0) {
            return `API报错: ${cfData.errors[0].message}`;
        }
        
        const zones = cfData?.data?.viewer?.zones;
        let totalBytes = 0;

        if (zones && zones.length > 0) {
            if (type === 'today' && zones[0].httpRequestsAdaptiveGroups) {
                totalBytes = zones[0].httpRequestsAdaptiveGroups[0]?.sum?.edgeResponseBytes || 0;
            } else if (type !== 'today' && zones[0].httpRequests1dGroups) {
                // 将多天的 bytes 聚合累加
                zones[0].httpRequests1dGroups.forEach(g => { totalBytes += (g.sum.bytes || 0); });
            }
        }

        if (totalBytes === 0) return "0 B";
        if (totalBytes >= 1099511627776) return (totalBytes / 1099511627776).toFixed(2) + " TB";
        if (totalBytes >= 1073741824) return (totalBytes / 1073741824).toFixed(2) + " GB";
        if (totalBytes >= 1048576) return (totalBytes / 1048576).toFixed(2) + " MB";
        if (totalBytes >= 1024) return (totalBytes / 1024).toFixed(2) + " KB";
        return totalBytes + " B";

    } catch(e) {
        return "请求异常";
    }
}

// 用于生成 TG 播报消息的核心工具函数 (单面板 + 流量之王统计版)
/** ================== 自动保活（节点级） ================== */
/** 保活客户端画像：节点配置了伪装 UA（custom_params）用节点的全套，未配置则内置 SenPlayer 全套 */
async function getCFRequests(env, type) {
    if (!env.CF_API_TOKEN || !env.CF_ZONE_ID) return { ok: false, error: '缺少变量' };
    try {
        const end = new Date();
        let graphqlQuery = {};
        if (type === 'today') {
            // CF 免费额度按 UTC 00:00 重置，取今天 UTC 00:00 作为起点
            const startUtc = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));
            graphqlQuery = {
                query: `
                query {
                  viewer {
                    zones(filter: {zoneTag: "${env.CF_ZONE_ID}"}) {
                      httpRequestsAdaptiveGroups(
                        limit: 1,
                        filter: {
                          datetime_geq: "${startUtc.toISOString()}",
                          datetime_leq: "${end.toISOString()}"
                        }
                      ) {
                        count
                      }
                    }
                  }
                }`
            };
        } else {
            // 7天 / 30天：按天聚合 sum.requests 累加（按北京时间日期范围）
            const bjNow = new Date(end.getTime() + 8 * 3600000);
            const start = new Date(bjNow.getTime() - type * 24 * 3600000);
            const dateGeq = start.toISOString().split('T')[0];
            const dateLeq = bjNow.toISOString().split('T')[0];
            graphqlQuery = {
                query: `
                query {
                  viewer {
                    zones(filter: {zoneTag: "${env.CF_ZONE_ID}"}) {
                      httpRequests1dGroups(
                        limit: 10000,
                        filter: {
                          date_geq: "${dateGeq}",
                          date_leq: "${dateLeq}"
                        }
                      ) {
                        sum {
                          requests
                        }
                      }
                    }
                  }
                }`
            };
        }

        const cfRes = await fetch('https://api.cloudflare.com/client/v4/graphql', {
            method: 'POST',
            headers: { 
                'Authorization': `Bearer ${env.CF_API_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(graphqlQuery)
        });
        
        const cfData = await cfRes.json();
        if (cfData.errors && cfData.errors.length > 0) {
            return { ok: false, error: cfData.errors[0].message };
        }
        
        const zones = cfData?.data?.viewer?.zones;
        let total = 0;
        if (zones && zones.length > 0) {
            if (type === 'today' && zones[0].httpRequestsAdaptiveGroups) {
                total = zones[0].httpRequestsAdaptiveGroups[0]?.count || 0;
            } else if (type !== 'today' && zones[0].httpRequests1dGroups) {
                zones[0].httpRequests1dGroups.forEach(g => { total += (g.sum.requests || 0); });
            }
        }
        return { ok: true, count: total };
    } catch(e) {
        return { ok: false, error: e.message };
    }
}

// ==========================================
// v3.6.31：播放热力图（反代真实播放请求命中统计,存 D1 play_hits）
// ==========================================

// 播放命中计数：反代路径命中真实播放(stream/PlaybackInfo)时按 节点×日期×小时 累加
async function recordPlayHit(env, prefix) {
    if (!env.DB || !prefix) return;
    try {
        const now = new Date(Date.now() + 8 * 3600000); // UTC+8
        const day = now.toISOString().split('T')[0];
        const hour = now.getUTCHours();
        await env.DB.prepare(
            `INSERT INTO play_hits (prefix, day, hour, cnt) VALUES (?, ?, ?, 1)
             ON CONFLICT(prefix, day, hour) DO UPDATE SET cnt = cnt + 1`
        ).bind(prefix, day, hour).run();
    } catch (e) { console.error('recordPlayHit:', e.message); }
}

// 读取最近 N 天播放热力图：返回 天×24小时 计数矩阵 + 节点总计
async function getHeatmap(env, days = 7) {
    if (!env.DB) return { ok: false, error: '未绑定 D1' };
    try {
        const end = new Date(Date.now() + 8 * 3600000);
        end.setUTCHours(23, 59, 59, 0);
        const start = new Date(end.getTime() - (days - 1) * 86400000);
        start.setUTCHours(0, 0, 0, 0);
        const { results } = await env.DB.prepare(
            `SELECT prefix, day, hour, cnt FROM play_hits WHERE day >= ? AND day <= ?`
        ).bind(start.toISOString().split('T')[0], end.toISOString().split('T')[0]).all();
        const dayList = [];
        for (let i = days - 1; i >= 0; i--) {
            const d = new Date(end.getTime() - i * 86400000);
            dayList.push(d.toISOString().split('T')[0]);
        }
        const grid = dayList.map(day => ({ day, hours: new Array(24).fill(0) }));
        const prefixTotals = {};
        let total = 0;
        for (const r of results || []) {
            const idx = dayList.indexOf(r.day);
            if (idx >= 0 && r.hour >= 0 && r.hour < 24) {
                grid[idx].hours[r.hour] = (grid[idx].hours[r.hour] || 0) + (r.cnt || 0);
                prefixTotals[r.prefix] = (prefixTotals[r.prefix] || 0) + (r.cnt || 0);
                total += (r.cnt || 0);
            }
        }
        const maxHour = Math.max(1, ...grid.flatMap(g => g.hours));
        return { ok: true, days: grid.map(g => ({ day: g.day.slice(5), hours: g.hours })), prefixTotals, total, maxHour };
    } catch (e) { return { ok: false, error: e.message }; }
}


// 今日 CF 全维度统计（一次 GraphQL 批量查询：请求数/带宽/缓存/状态码/国家/分时/防火墙）
async function getCFTodayStats(env) {
    if (!env.CF_API_TOKEN || !env.CF_ZONE_ID) return { ok: false, error: '缺少变量' };
    const endD = new Date();
    // 北京时间今日 00:00（UTC+8）作为起点,与面板其余统计口径一致
    const bjStart = new Date(endD.getTime() + 8 * 3600000);
    bjStart.setUTCHours(0, 0, 0, 0);
    const startUtc = new Date(bjStart.getTime() - 8 * 3600000);
    const geq = startUtc.toISOString();
    const leq = endD.toISOString();
    const zoneTag = env.CF_ZONE_ID;
    const baseFilter = `{datetime_geq: "${geq}", datetime_leq: "${leq}"}`;
    const headers = { 'Authorization': `Bearer ${env.CF_API_TOKEN}`, 'Content-Type': 'application/json' };
    async function gql(query) {
        try {
            const r = await fetch('https://api.cloudflare.com/client/v4/graphql', { method: 'POST', headers, body: JSON.stringify({ query }) });
            const j = await r.json();
            if (j.errors && j.errors.length) return { errors: j.errors };
            return j.data?.viewer?.zones?.[0] || {};
        } catch (e) { return { errors: [{ message: e.message }] }; }
    }
    // ① 主查询：今日请求数 + 带宽（核心字段，官方确认）
    let requests = 0, bytes = 0, mainError = null;
    const main = await gql(`query { viewer { zones(filter: {zoneTag: "${zoneTag}"}) { o: httpRequestsAdaptiveGroups(limit: 1, filter: ${baseFilter}) { count sum { edgeResponseBytes } } } } }`);
    if (main.errors) { mainError = main.errors[0].message; }
    else { const o = main.o?.[0] || {}; requests = o.count || 0; bytes = o.sum?.edgeResponseBytes || 0; }
    // ② 状态码分布（独立容错）
    const codes = { '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0 };
    const st = await gql(`query { viewer { zones(filter: {zoneTag: "${zoneTag}"}) { s: httpRequestsAdaptiveGroups(limit: 20, filter: ${baseFilter}) { count dimensions { edgeResponseStatus } } } } }`);
    if (!st.errors) (st.s || []).forEach(g => {
        const c = Number(g.dimensions?.edgeResponseStatus) || 0;
        if (c >= 500) codes['5xx'] += g.count;
        else if (c >= 400) codes['4xx'] += g.count;
        else if (c >= 300) codes['3xx'] += g.count;
        else if (c >= 200) codes['2xx'] += g.count;
    });
    // ③ 来源国家（独立容错）
    let countries = [];
    const ct = await gql(`query { viewer { zones(filter: {zoneTag: "${zoneTag}"}) { c2: httpRequestsAdaptiveGroups(limit: 6, filter: ${baseFilter}) { count dimensions { clientCountryName } } } } }`);
    if (!ct.errors) countries = (ct.c2 || []).slice(0, 5).map(g => ({ country: g.dimensions?.clientCountryName || '未知', count: g.count }));
    // ④ 分时趋势（独立容错;GraphQL 按 UTC 小时聚合,归桶到北京时间 +8）
    const hours = new Array(24).fill(0);
    const hr = await gql(`query { viewer { zones(filter: {zoneTag: "${zoneTag}"}) { h: httpRequestsAdaptiveGroups(limit: 1440, filter: ${baseFilter}) { count dimensions { datetimeMinute } } } } }`);
    if (!hr.errors) (hr.h || []).forEach(g => {
        const d = new Date(g.dimensions?.datetimeMinute);
        if (!isNaN(d.getTime())) hours[(d.getUTCHours() + 8) % 24] += g.count;
    });
    // ⑤ 防火墙拦截（独立容错）
    let blocked = 0;
    const bl = await gql(`query { viewer { zones(filter: {zoneTag: "${zoneTag}"}) { b: firewallEventsAdaptiveGroups(limit: 1, filter: ${baseFilter}) { count } } } }`);
    if (!bl.errors) blocked = bl.b?.[0]?.count || 0;
    // ⑥ 缓存字节（独立容错）
    let cachedBytes = 0;
    const cb = await gql(`query { viewer { zones(filter: {zoneTag: "${zoneTag}"}) { c3: httpRequestsAdaptiveGroups(limit: 1, filter: ${baseFilter}) { sum { cachedBytes } } } } }`);
    if (!cb.errors) { const v = cb.c3?.[0]?.sum?.cachedBytes; if (typeof v === 'number') cachedBytes = v; }
    if (mainError) return { ok: false, error: mainError };
    return { ok: true, requests, bytes, cachedBytes, statusCodes: codes, countries, hours, blocked };
}

const BUILTIN_KA_PROFILE = {
  client: 'SenPlayer', version: '6.0.0', device: 'iPhone',
  deviceId: '3f9b6c2e-8a4d-4e6f-9b1c-2d5e7a8f0b31',
  ua: 'SenPlayer/6.0.0',
};

async function getKaGlobalProfile(env) {
  try {
    if (!env || !env.DB) return null;
    await ensureAppConfig(env);
    const row = await env.DB.prepare("SELECT value FROM app_config WHERE key = 'ka_global_profile'").first();
    if (row && row.value) {
      const c = JSON.parse(row.value);
      if (c && (c.client || c.version || c.device || c.ua || c.deviceId)) return c;
    }
  } catch (e) {}
  return null;
}

// 自定义 Logo（左上角 / 登录页 / favicon）：D1 app_config['logo'] 存 {type:'url'|'data', value}
async function getLogo(env) {
  try {
    if (!env || !env.DB) return null;
    const row = await memoStale('logo_cfg', 30000, async () => {
      await ensureAppConfig(env);
      return await env.DB.prepare("SELECT value FROM app_config WHERE key = 'logo'").first();
    });
    if (row && row.value) {
      const c = JSON.parse(row.value);
      if (c && c.value && isSafeLogoValue(c.value)) return c;
    }
  } catch (e) {}
  return null;
}

// 保活身份优先级：节点伪装参数 → 全局保活 UA/ID 设置(保活专用) → 内置固定默认。
// 关键：未配置伪装时统一用同一套身份(不再每次随机 UUID)——Emby 一般限制设备登录数,
// 随机 ID 会让每次保活新增一个设备、最终刷爆设备数。
function kaClientProfile(route, globalP) {
  let cp = {};
  try { cp = route && route.custom_params ? JSON.parse(route.custom_params) : {}; } catch (e) {}
  const hasFake = !!(cp.client || cp.version || cp.device || cp.ua || cp.deviceId);
  const gp = globalP && typeof globalP === 'object' ? globalP : null;
  if (hasFake) {
    return {
      client: cp.client ? String(cp.client) : (gp && gp.client ? String(gp.client) : BUILTIN_KA_PROFILE.client),
      version: cp.version ? String(cp.version) : (gp && gp.version ? String(gp.version) : BUILTIN_KA_PROFILE.version),
      device: cp.device ? String(cp.device) : (gp && gp.device ? String(gp.device) : BUILTIN_KA_PROFILE.device),
      deviceId: cp.deviceId ? String(cp.deviceId) : (gp && gp.deviceId ? String(gp.deviceId) : BUILTIN_KA_PROFILE.deviceId),
      ua: cp.ua ? String(cp.ua) : (gp && gp.ua ? String(gp.ua) : BUILTIN_KA_PROFILE.ua),
    };
  }
  return {
    client: gp && gp.client ? String(gp.client) : BUILTIN_KA_PROFILE.client,
    version: gp && gp.version ? String(gp.version) : BUILTIN_KA_PROFILE.version,
    device: gp && gp.device ? String(gp.device) : BUILTIN_KA_PROFILE.device,
    deviceId: gp && gp.deviceId ? String(gp.deviceId) : BUILTIN_KA_PROFILE.deviceId,
    ua: gp && gp.ua ? String(gp.ua) : BUILTIN_KA_PROFILE.ua,
  };
}
/** 原生客户端风格的 Emby 认证头（禁止 Web 格式，很多 Emby 会拒绝 Web 客户端） */
function kaAuthHeader(prof) {
  return {
    'X-Emby-Authorization': 'MediaBrowser Client="' + prof.client + '", Device="' + prof.device + '", DeviceId="' + (prof.deviceId || genUuid()) + '", Version="' + prof.version + '"',
  };
}
function kaHeaders(prof, extra) {
  const h = Object.assign({}, kaAuthHeader(prof), { 'User-Agent': prof.ua });
  if (extra) Object.assign(h, extra);
  return h;
}
function addApiKey(u, token) {
  try {
    const url = new URL(u);
    if (token) url.searchParams.set('api_key', token);
    return url.toString();
  } catch (e) { return u; }
}
function fmtBytes(b) {
  b = Math.max(0, parseInt(b, 10) || 0);
  if (b >= 1073741824) return (b / 1073741824).toFixed(1) + 'GB';
  if (b >= 1048576) return (b / 1048576).toFixed(1) + 'MB';
  if (b >= 1024) return (b / 1024).toFixed(1) + 'KB';
  return b + 'B';
}
function fmtPos(ticks) {
  const sec = Math.max(0, Math.floor(parseInt(ticks, 10) || 0) / 10000000);
  const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = Math.floor(sec % 60);
  return (h > 0 ? String(h).padStart(2, '0') + ':' : '') + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}
async function kaFetch(urlStr, opts) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  try {
    const r = await fetch(urlStr, Object.assign({}, opts || {}, { signal: controller.signal }));
    return r;
  } catch (e) {
    throw e;
  } finally { clearTimeout(timer); }
}
async function kaJson(urlStr, opts) {
  const res = await kaFetch(urlStr, opts);
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch (e) {}
  return { status: res.status, data, text };
}
/** 保活拉流：流式读取最多 maxBytes 字节后立即取消；timeMs 为总超时兜底（CF 单请求墙钟 30s，留余量） */
async function readStreamUpTo(res, maxBytes, timeMs) {
  if (!res || !res.body) return 0;
  const reader = res.body.getReader();
  let total = 0;
  const t0 = Date.now();
  try {
    for (;;) {
      if (Date.now() - t0 > timeMs) break;
      let readTimer = null;
      const r = await Promise.race([
        reader.read(),
        new Promise((resolve, reject) => { readTimer = setTimeout(() => reject(new Error('read timeout')), Math.max(1000, timeMs - (Date.now() - t0))); })
      ]);
      if (readTimer) clearTimeout(readTimer);
      if (r.done) break;
      if (r.value) total += r.value.byteLength;
      if (total >= maxBytes) break;
    }
  } catch (e) {}
  try { await reader.cancel(); } catch (e) {}
  return total;
}
/** 节点级完整保活：连通探测 → 凭据登录（API Key 优先 → 账号密码）→ 随机取条目 → 拉播放链接 → 拉流 40MB → 上报进度 → 停止 */
async function runKeepAlive(env, route, qid) {
  const steps = [];
  let kaInfo = null;   // v3.6.5:降级模式完成详情(剧名/时长/起止/拉流字节),写入保活历史
  let progress = 3;      // 实时进度 0-100
  let liveTitle = '';    // 正在模拟看的剧名
  // 实时进度：写入 D1 app_config(ka_live)，前端轮询展示（fire-and-forget，不阻塞保活）
  const saveLive = (current, stepsArr, p) => {
    try {
      if (!env || !env.DB) return;
      progress = Math.max(progress, Math.min(100, Math.round(p !== undefined ? p : 12 + stepsArr.length * 8)));
      env.DB.prepare('INSERT OR REPLACE INTO app_config (key, value) VALUES (?, ?)')
        .bind('ka_live', JSON.stringify({ running: true, prefix: route ? route.prefix : '', current: current || '', steps: stepsArr || [], progress: progress, mediaTitle: liveTitle || '', updatedAt: Date.now() }))
        .run().catch(() => {});
    } catch (e) {}
  };
  const addStep = (name, ok, detail) => {
    const st = { name, ok: !!ok, detail: String(detail || '').slice(0, 220) };
    steps.push(st);
    saveLive('执行中：' + name, steps.slice());
  };
  if (!route) { addStep('选择节点', false, '没有可用节点'); return { ok: false, msg: '没有可用节点', steps }; }
  const prof = kaClientProfile(route, await getKaGlobalProfile(env));
  const target = String(route.target || '').split(',')[0].trim().replace(/\/+$/, '');
  if (!target) { addStep('节点目标', false, '节点 target 为空'); return { ok: false, msg: '节点 target 为空', steps }; }
  addStep('保活节点', true, route.prefix + ' → ' + target + '（UA: ' + prof.ua + '）');

  try {
    const r = await kaJson(target + '/emby/System/Info/Public', { headers: kaHeaders(prof) });
    addStep('连通性探测', r.status === 200, 'GET /emby/System/Info/Public → ' + r.status);
  } catch (e) { addStep('连通性探测', false, e.message); }

  let token = String(route.ka_token || '').trim();
  let userId = '';
  let loginUser = '', loginPass = '';
  if (!token && route.node_user) {
    loginUser = String(route.node_user);
    loginPass = String(route.node_pass || '');
  }
  if (!token && loginUser) {
    try {
      const r = await kaJson(target + '/emby/Users/AuthenticateByName', {
        method: 'POST',
        headers: Object.assign(kaHeaders(prof), { 'Content-Type': 'application/json' }),
        body: JSON.stringify({ Username: loginUser, Pw: loginPass })
      });
      if (r.data && r.data.AccessToken) {
        token = r.data.AccessToken;
        userId = (r.data.User && r.data.User.Id) || '';
        addStep('账号登录', true, '节点账号 ' + loginUser + ' → ' + r.status);
      } else {
        addStep('账号登录', false, 'AuthenticateByName → ' + r.status);
      }
    } catch (e) { addStep('账号登录', false, e.message); }
  }

  if (!token) {
    // v3.6.30:未取得凭据一律视为失败——绝不假成功,否则会错误重置保活倒计时导致超过观看下限
    if (loginUser) {
      // 已配置账号但登录失败(原站不可达 / 账号密码错误或不完整)
      return { ok: false, msg: '保活失败：节点账号登录失败（原站不可达或账号密码错误/不完整），未消耗保活间隔，4 小时后自动重试', steps };
    }
    try {
      const r = await kaJson(target + '/emby/System/Info', { headers: kaHeaders(prof) });
      addStep('服务探测（未配置凭据）', r.status === 200 || r.status === 401, 'GET /emby/System/Info → ' + r.status);
    } catch (e) { addStep('服务探测', false, e.message); }
    return { ok: false, msg: '保活失败：未配置 API Key / 账号密码，无法执行保活（未消耗保活间隔，4 小时后自动重试）', steps };
  }

  if (!userId) {
    try {
      const r = await kaJson(addApiKey(target + '/emby/Users', token), { headers: kaHeaders(prof) });
      const arr = r.data || [];
      const list = Array.isArray(arr) ? arr : [];
      const u = list.find(x => x && x.Id) || list[0];
      if (u && u.Id) { userId = u.Id; addStep('获取用户', true, String(u.Name || userId)); }
    } catch (e) {}
  }

  let itemId = '', itemName = '';
  try {
    const r = await kaJson(addApiKey(target + '/emby/Items?Recursive=true&IncludeItemTypes=Movie,Episode&Limit=1&SortBy=DateCreated&SortOrder=Descending', token), { headers: kaHeaders(prof) });
    const items = (r.data && r.data.Items) ? r.data.Items : (Array.isArray(r.data) ? r.data : []);
    if (items[0] && items[0].Id) { itemId = items[0].Id; itemName = items[0].Name || ''; }
    else if (r.status !== 200) { addStep('获取媒体条目', false, 'Items → ' + r.status + ' ' + String(r.text).slice(0, 100)); return { ok: false, msg: '获取媒体条目失败: Items → ' + r.status, steps }; }
  } catch (e) { addStep('获取媒体条目', false, 'Items 异常: ' + e.message); return { ok: false, msg: '获取媒体条目失败', steps }; }
  if (!itemId) { addStep('获取媒体条目', false, '媒体库为空或无权访问'); return { ok: false, msg: '媒体库为空或无权访问', steps }; }
  liveTitle = itemName || '未知条目';
  addStep('获取媒体条目', true, (itemName || '未知条目') + ' (' + String(itemId).slice(0, 8) + ')');

  let msId = '', playSessionId = '', sizeBytes = 0, vbr = 0;
  try {
    const r = await kaJson(addApiKey(target + '/emby/Items/' + itemId + '/PlaybackInfo', token), {
      method: 'POST',
      headers: Object.assign(kaHeaders(prof), { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ UserId: userId, DeviceId: prof.deviceId || genUuid(), MediaSources: [], AutoOpenLiveStream: false, StartTimeTicks: 0 })
    });
    const ms = (r.data && r.data.MediaSources && r.data.MediaSources[0]) || null;
    if (ms) { msId = ms.Id || ''; }
    // v3.6.69:顺带取文件大小与视频码率(拉流控量用;取不到为 0,由 kaCapBytes 回退)
    sizeBytes = (ms && parseInt(ms.Size, 10)) || 0;
    const vs = ms && ms.MediaStreams ? ms.MediaStreams.find(s => s.Type === 'Video') : null;
    vbr = (vs && parseInt(vs.BitRate, 10)) || (ms && parseInt(ms.Bitrate, 10)) || 0;
    playSessionId = (r.data && r.data.PlaySessionId) || '';
    if (!msId && !playSessionId) {
      try {
        const g = await kaJson(addApiKey(target + '/emby/Items/' + encodeURIComponent(itemId) + '/PlaybackInfo?UserId=' + encodeURIComponent(userId) + '&AutoOpenLiveStream=true', token), { headers: kaHeaders(prof) });
        const gms = (g.data && g.data.MediaSources && g.data.MediaSources[0]) || null;
        if (gms) { msId = gms.Id || ''; }
        if (!playSessionId) playSessionId = (g.data && g.data.PlaySessionId) || '';
      } catch (e) {}
    }
    if (ms && ms.Name) liveTitle = String(ms.Name);   // 过程界面显示完整剧名
    addStep('拉取播放链接', !!msId || !!playSessionId, ms ? String(ms.Name || 'MediaSource') : ('PlaybackInfo → ' + r.status + (playSessionId ? '（GET 重试成功）' : '')));
  } catch (e) { addStep('拉取播放链接', false, e.message); }

  const STREAM_BYTES = 40 * 1024 * 1024;
  let streamBytesTotal = 0;
  if (!msId && !playSessionId) {
    addStep('模拟拉流', false, '无播放链接，跳过（PlaybackInfo 两次尝试均失败）');
    return { ok: false, msg: '保活失败：无法获取播放链接（PlaybackInfo POST/GET 均失败）', steps };
  }
  if (itemId && (msId || itemId)) {
    saveLive('模拟拉流中（40MB）…', steps.slice(), 50);
    try {
      const streamUrl = (staticFlag) => target + '/emby/Videos/' + encodeURIComponent(itemId) + '/stream?MediaSourceId=' + encodeURIComponent(msId || itemId) + '&Static=' + staticFlag;
      const hdrs = Object.assign(kaHeaders(prof), { Range: 'bytes=0-' + (STREAM_BYTES - 1) });
      let res = await kaFetch(addApiKey(streamUrl('false'), token), { headers: hdrs });
      if (res.status !== 200 && res.status !== 206) {
        const txt = await res.text().catch(() => '');
        res = await kaFetch(addApiKey(streamUrl('true'), token), { headers: hdrs });
        const bytes = await readStreamUpTo(res, STREAM_BYTES, 25000); streamBytesTotal += bytes;
        addStep('模拟拉流', res.status === 200 || res.status === 206, 'Videos/' + String(itemId).slice(0, 8) + '/stream → ' + res.status + '（拉流 ' + (bytes / 1048576).toFixed(1) + 'MB）' + (res.status === 400 ? ' ' + String(txt).slice(0, 120) : ''));
      } else {
        const bytes = await readStreamUpTo(res, STREAM_BYTES, 25000); streamBytesTotal += bytes;
        addStep('模拟拉流', true, 'Videos/' + String(itemId).slice(0, 8) + '/stream → ' + res.status + '（拉流 ' + (bytes / 1048576).toFixed(1) + 'MB）');
      }
    } catch (e) { addStep('模拟拉流', false, e.message); }
  } else {
    addStep('模拟拉流', false, '无播放链接，跳过');
  }

  // ===== 模拟播放 =====
  // 方式 A（推荐）：已绑定 KEEPALIVE_DO → 交给 DO 长任务（90~390s 按片长比例、每 10s 真实心跳、
  //   起点为片长 2%~10% 随机点、完成后自动 Stopped + 清除播放记录），不受 CF 30s 墙钟限制；
  // 方式 B（降级）：未绑定 DO → 请求内快速模拟（20~25s 真实节奏，受墙钟限制）
  let doScheduled = false;
  if (env && env.KEEPALIVE_DO && playSessionId && token) {
    try {
      const doId = env.KEEPALIVE_DO.idFromName('ka-' + playSessionId);
      const stub = env.KEEPALIVE_DO.get(doId);
      const dr = await stub.fetch('https://do.local/ka', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target, token, authHdr: kaHeaders(prof)['X-Emby-Authorization'], ua: prof.ua, itemId, msId, userId, client: prof.client, version: prof.version, deviceId: prof.deviceId, playSessionId, prefix: route.prefix, qid: qid || 0, mediaTitle: liveTitle, sizeBytes, bitRate: vbr })
      });
      const dj = await dr.json();
      if (dj && dj.ok) {
        doScheduled = true;
        addStep('播放会话开始', true, 'DO 长任务模拟播放已调度（' + (dj.msg || '') + '）');
      } else {
        addStep('播放会话开始', false, 'DO 调度失败：' + ((dj && dj.msg) || '未知') + '，降级快速模拟');
      }
    } catch (e) {
      addStep('播放会话开始', false, 'DO 调度异常，降级快速模拟：' + e.message);
    }
  } else if (!playSessionId) {
    addStep('播放会话开始', false, '无 PlaySessionId，跳过会话上报（仅拉流保活）');
    addStep('模拟播放时长', false, '无 PlaySessionId，跳过');
  }
  if (!doScheduled && playSessionId) {
    // ===== 降级：请求内快速模拟播放（原逻辑，20~25s 真实节奏）=====
    // 播放会话：字段 Emby 标准 PositionTicks（兼容旧字段）；心跳对齐真实播放器节奏（固定每 10s 一条）
    // 模拟真实观看：起始位置随机 1~89 秒，观看时长随机 20~25 秒（2 条 10s 心跳），
    // 避免机械快进与固定条数；CF 单请求墙钟 30s 限制下无法完整等待 60~90 秒，故压缩时长换取真实节奏
    const startSec = 1 + Math.floor(Math.random() * 89);
    const playSec = 20 + Math.floor(Math.random() * 6);
    const endSec = startSec + playSec;
    const startTicks = startSec * 10000000;
    const endTicks = endSec * 10000000;
    const CF_HEARTBEATS = Math.max(1, Math.min(2, Math.floor(playSec / 10)));   // 每 10s 一条，墙钟内最多 2 条
    const base = { ItemId: itemId, MediaSourceId: msId || itemId, UserId: userId, DeviceId: prof.deviceId || genUuid(), PlayMethod: 'DirectStream', CanSeek: true, IsPaused: false, QueueableMediaTypes: ['Video'] };
    if (playSessionId) base.PlaySessionId = playSessionId;
    const kaBody = (posTicks) => JSON.stringify(Object.assign({}, base, { PositionTicks: posTicks, PlaybackPositionTicks: posTicks }));
    const KA_HEADERS = Object.assign(kaHeaders(prof), { 'Content-Type': 'application/json' });

    try {
      const r = await kaJson(addApiKey(target + '/emby/Sessions/Playing', token), { method: 'POST', headers: KA_HEADERS, body: kaBody(startTicks) });
      addStep('播放会话开始', r.status === 200 || r.status === 204, 'Sessions/Playing → ' + r.status + (r.status === 400 ? ' ' + String(r.text).slice(0, 120) : ''));
    } catch (e) { addStep('播放会话开始', false, e.message); }

    // 心跳：固定每 10s 一条（对齐真实播放器节奏），进度每次 +10s；CF 墙钟 30s 限制下最多 2 条（10s/20s）
    let hbOk = 0, hbFail = 0;
    const tStart = Date.now();
    let dlInterrupted = false;
    for (let i = 1; i <= CF_HEARTBEATS; i++) {
      if (Date.now() - tStart > 21000) break;   // 心跳段预算 21s，保整体不超墙钟
      await new Promise(res => setTimeout(res, 10000));
      // v3.6.0:下载优先——保活中检测到下载立即中断本次模拟,让位下载
      try { if (await kaDlActive(env) > 0) { dlInterrupted = true; break; } } catch (e) {}
      const pos = Math.min(startTicks + i * 10 * 10000000, endTicks);
      saveLive('模拟播放：进度心跳 ' + i + '/' + CF_HEARTBEATS + '（' + fmtPos(pos) + '）', steps.slice(), 66 + (i / CF_HEARTBEATS) * 26);
      try {
        const r = await kaJson(addApiKey(target + '/emby/Sessions/Playing/Progress', token), { method: 'POST', headers: KA_HEADERS, body: kaBody(pos) });
        if (r.status === 200 || r.status === 204) hbOk++; else hbFail++;
      } catch (e) { hbFail++; }
    }
    addStep('模拟播放时长', hbOk > 0, '从 ' + fmtPos(startTicks) + ' 快进 ' + playSec + ' 秒：心跳 ' + hbOk + '/' + CF_HEARTBEATS + ' 条 → ' + fmtPos(endTicks) + (dlInterrupted ? '（下载优先：被下载打断）' : ''));

    try {
      const r = await kaJson(addApiKey(target + '/emby/Sessions/Playing/Stopped', token), { method: 'POST', headers: KA_HEADERS, body: kaBody(endTicks) });
      addStep('播放会话停止', r.status === 200 || r.status === 204, 'Stopped → ' + r.status + ' (' + fmtPos(endTicks) + ')');
    } catch (e) { addStep('播放会话停止', false, e.message); }

    // v3.6.5:记录降级模式完成详情(剧名/时长/起止/拉流字节)
    kaInfo = { title: liveTitle || '', playSec, startTicks, endTicks, streamBytes: streamBytesTotal };
    // 清除播放记录：重置本次保活播放条目的 PlayCount / 继续观看进度，避免污染真实观看记录
    if (userId && itemId && token) {
      await new Promise(res => setTimeout(res, 1000));   // 等 Stopped 异步落库后再清，避免竞态
      try {
        const r = await kaJson(addApiKey(target + '/emby/Users/' + encodeURIComponent(userId) + '/Items/' + encodeURIComponent(itemId) + '/UserData', token), {
          method: 'POST',
          headers: Object.assign(kaHeaders(prof), { 'Content-Type': 'application/json' }),
          body: JSON.stringify({ Played: false, PlayCount: 0, ResumePositionTicks: 0, PlaybackPositionTicks: 0, PlayedPercentage: 0 })
        });
        addStep('清除播放记录', r.status === 200 || r.status === 204, 'UserData → ' + r.status + '（PlayCount/继续观看进度已重置）');
        if (r.status === 200 || r.status === 204) saveLive('清除播放记录完成', steps.slice(), 100);
      } catch (e) { addStep('清除播放记录', false, e.message); }
    } else {
      addStep('清除播放记录', false, '缺少 userId/itemId/token，跳过');
    }
  }

  const failed = steps.filter(x => !x.ok).length;
  if (doScheduled) {
    return { ok: true, doScheduled: true, msg: '保活前置步骤完成，模拟播放（90~390s 按片长比例真实心跳）已由 DO 后台执行，面板将实时更新进度', steps };
  }
  // v3.6.30:不再用"失败步数<一半"判定——部分关键步骤失败(会话/心跳未建立)会导致假成功、错误重置倒计时。
  // 成功标准:播放会话开始 + 至少 1 条心跳 + 模拟拉流 全部成功,才算真实产生了观看记录
  const sessOk = steps.some(s => s.name === '播放会话开始' && s.ok);
  const hbOk = steps.some(s => s.name.startsWith('模拟播放时长') && s.ok);
  const streamOk = steps.some(s => s.name === '模拟拉流' && s.ok);
  const playOk = sessOk && hbOk && streamOk;
  if (playOk) {
    return { ok: true, msg: '保活完成（' + steps.length + ' 步，' + failed + ' 步异常，播放会话/心跳/拉流均成功）', steps, kaInfo };
  }
  return { ok: false, msg: '保活失败：播放会话或心跳未成功建立（' + steps.length + ' 步，' + failed + ' 步异常），未消耗保活间隔，4 小时后自动重试', steps, kaInfo };
}
/** 定时检查：找出最先到期的开启保活节点执行（每 tick 只跑一个，避免并发打爆上游与超时） */
async function pushKaNotice(env, prefix, ok, detail, remark) {
  try {
    if (!env || !env.DB) return;
    const row = await env.DB.prepare("SELECT value FROM app_config WHERE key = 'ka_notices'").first();
    let list = [];
    try { if (row && row.value) list = JSON.parse(row.value); } catch (e) {}
    list.unshift({ time: Date.now(), prefix: String(prefix || ''), remark: String(remark || ''), result: ok ? '成功' : '失败', detail: String(detail || '').slice(0, 180) });
    if (list.length > 30) list.length = 30;
    await env.DB.prepare('INSERT OR REPLACE INTO app_config (key, value) VALUES (?, ?)').bind('ka_notices', JSON.stringify(list)).run();
  } catch (e) {}
  // 保活结果通知：Bark（iOS）+ Telegram（v3.6.32:优先读面板通知设置 notify_settings,与版本更新通知同一套配置;
  // 无面板配置时回退 Worker 环境变量 BARK_KEY/TG_BOT_TOKEN/TG_CHAT_ID,兼容老部署;此前仅读环境变量导致面板已配通知却收不到保活消息)
  const nodeName = remark || ('/' + prefix);
  const kaText = (ok ? '✅' : '❌') + ' 节点 ' + nodeName + ' 保活' + (ok ? '成功' : '失败') + (detail ? '：' + detail : '');
  let cfg = null;
  try { cfg = await getNotifyCfg(env); } catch (e) {}
  // v3.6.70:通知模式 all=全部推送(默认) / fail=仅失败推送(成功静默;面板 ka_notices 记录已写入不受影响)
  if (cfg && cfg.kaNotifyMode === 'fail' && ok) return;
  try {
    const usePanel = !!(cfg && cfg.barkKey && cfg.barkNotify !== false);
    if (usePanel) {
      await fetch((cfg.barkServer || 'https://api.day.app').replace(/\/+$/, '') + '/' + String(cfg.barkKey).trim(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ title: 'Emby 反代面板 · 保活' + (ok ? '成功' : '失败'), body: kaText, level: cfg.barkLevel || 'active' })
      });
    } else if (env.BARK_KEY) {
      await fetch('https://api.day.app/' + String(env.BARK_KEY).trim(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Emby 反代面板 · 保活' + (ok ? '成功' : '失败'), body: kaText, level: env.BARK_LEVEL || 'active' })
      });
    }
  } catch (e) {}
  try {
    const usePanel = !!(cfg && cfg.tgToken && cfg.tgChatId && cfg.tgNotify !== false);
    if (usePanel) {
      await fetch('https://api.telegram.org/bot' + String(cfg.tgToken).trim() + '/sendMessage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: String(cfg.tgChatId).trim(), text: kaText })
      });
    } else if (env.TG_BOT_TOKEN && env.TG_CHAT_ID) {
      await fetch('https://api.telegram.org/bot' + String(env.TG_BOT_TOKEN).trim() + '/sendMessage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: String(env.TG_CHAT_ID).trim(), text: kaText })
      });
    }
  } catch (e) {}
}


// ============ 保活队列(v3.6.0)============
// ka_queue: {"seq":N,"items":[{id,prefix,kind,status,queuedAt,startedAt,msg}]} status: waiting/running
// ka_history: 最近完成记录(最多8条)
// ka_dl_active: 下载伴随计数(>0 表示有下载在跑,保活让位)
async function kaGetQueue(env) {
  try {
    const row = await env.DB.prepare("SELECT value FROM app_config WHERE key = 'ka_queue'").first();
    if (row && row.value) { const q = JSON.parse(row.value); if (q && Array.isArray(q.items)) return { seq: q.seq || 0, items: q.items }; }
  } catch (e) {}
  return { seq: 0, items: [] };
}
async function kaSaveQueue(env, q) {
  try { await env.DB.prepare('INSERT OR REPLACE INTO app_config (key, value) VALUES (?, ?)').bind('ka_queue', JSON.stringify(q)).run(); } catch (e) {}
}
async function kaGetHistory(env) {
  try {
    const row = await env.DB.prepare("SELECT value FROM app_config WHERE key = 'ka_history'").first();
    if (row && row.value) { const h = JSON.parse(row.value); if (Array.isArray(h)) return h; }
  } catch (e) {}
  return [];
}
async function kaSaveHistory(env, h) {
  try { await env.DB.prepare('INSERT OR REPLACE INTO app_config (key, value) VALUES (?, ?)').bind('ka_history', JSON.stringify(h)).run(); } catch (e) {}
}
async function kaEnqueue(env, prefix, kind) {
  return await withKaLock(env, async () => {
    const q = await kaGetQueue(env);
    if (q.items.some(i => i.prefix === prefix && (i.status === 'waiting' || i.status === 'running'))) return false;
    q.seq += 1;
    q.items.push({ id: q.seq, prefix: prefix, kind: kind || 'auto', status: 'waiting', queuedAt: Date.now(), startedAt: 0, msg: '' });
    await kaSaveQueue(env, q);
    return true;
  });
}
// 注意:q 参数仅为兼容旧调用,内部一律在锁内重新读取最新队列(调用方手里的 q 在长任务期间早已过期,直接保存会覆盖别人的改动)
async function kaFinishItem(env, q, item, ok, msg, detail) {
  try {
    await withKaLock(env, async () => {
      const fresh = await kaGetQueue(env);
      const idx = fresh.items.findIndex(i => i.id === item.id);
      if (idx >= 0) fresh.items.splice(idx, 1);
      const hist = await kaGetHistory(env);
      hist.unshift({ prefix: item.prefix, kind: item.kind, ok: !!ok, msg: String(msg || '').slice(0, 180), finishedAt: Date.now(), detail: detail ? JSON.stringify(detail) : '' });
      if (hist.length > 60) hist.length = 60;
      await kaSaveHistory(env, hist);
      await kaSaveQueue(env, fresh);
    });
  } catch (e) {}
}
// v3.6.3:DO 完成/中断时,把自己对应的 running 队列项移除(推进器只负责 waiting→running,
// 完成项必须显式清掉,否则队列头部永久卡 running、后续节点永远排队)
// 传入 qid 时按队列项 ID 精确匹配(同节点重新入队的新任务不会被旧 DO 误删);队列项已不存在(已被取消)则不重复记历史
async function kaFinishRunning(env, prefix, ok, msg, detail, qid) {
  try {
    await withKaLock(env, async () => {
      const q = await kaGetQueue(env);
      const idx = qid ? q.items.findIndex(i => i.id === qid) : q.items.findIndex(i => i.prefix === prefix && i.status === 'running');
      if (idx < 0) return;
      const item = q.items[idx];
      q.items.splice(idx, 1);
      const hist = await kaGetHistory(env);
      hist.unshift({ prefix: item.prefix, kind: item.kind, ok: !!ok, msg: String(msg || '').slice(0, 180), finishedAt: Date.now(), detail: detail ? JSON.stringify(detail) : '' });
      if (hist.length > 60) hist.length = 60;
      await kaSaveHistory(env, hist);
      await kaSaveQueue(env, q);
    });
  } catch (e) {}
}
// 下载计数:下载伴随启动 +1 / 结束 -1;>0 表示正在下载,保活立即让位
// v3.6.36:计数带时间戳 + 超时失效兜底——流中断/Worker 重启导致 -1 丢失时,
// 超过 15 分钟的残留计数自动视为 0,避免"没下载却永远提示下载中、保活一直让位"
async function kaDlCount(env, delta) {
  try {
    const now = Date.now();
    let n = 0;
    const r = await env.DB.prepare("SELECT value FROM app_config WHERE key = 'ka_dl_active'").first();
    if (r && r.value) {
      try { const j = JSON.parse(r.value); n = (typeof j.n === 'number') ? j.n : 0; } catch (e) { n = parseInt(r.value, 10) || 0; }
    }
    n = Math.max(0, n + (delta | 0));
    await env.DB.prepare("INSERT OR REPLACE INTO app_config(key, value) VALUES('ka_dl_active', ?)").bind(JSON.stringify({ n, ts: now })).run();
  } catch (e) {}
}
async function kaDlActive(env) {
  try {
    const r = await env.DB.prepare("SELECT value FROM app_config WHERE key = 'ka_dl_active'").first();
    if (!r || !r.value) return 0;
    let n = 0, ts = 0;
    try { const j = JSON.parse(r.value); n = (typeof j.n === 'number') ? j.n : 0; ts = j.ts || 0; } catch (e) { n = parseInt(r.value, 10) || 0; ts = 0; }
    // 无时间戳(旧格式残留)或超过 3 分钟未更新:视为已结束,回写清零
    // (正常下载会通过 onBytes 节流刷新 ts,不会误清;取消/断流后 ts 停更,3 分钟内自动恢复保活)
    if (!ts || (Date.now() - ts > 3 * 60 * 1000)) {
      if (n > 0) { try { await env.DB.prepare("INSERT OR REPLACE INTO app_config(key, value) VALUES('ka_dl_active', ?)").bind(JSON.stringify({ n: 0, ts: Date.now() })).run(); } catch (e) {} }
      return 0;
    }
    return n > 0 ? n : 0;
  } catch (e) { return 0; }
}
// v3.6.41:下载流持续读数据时刷新计数时间戳的节流标记(每次 worker 实例内有效)
let kaDlTouchLast = 0;

// ============ 系统保留后缀(节点前缀/反代 Token key 不可占用) ============
const RESERVED_SUFFIX = ['entry', 'api', 'catch', 'speedtest', '__client_rtt__', 'favicon.ico'];
function isReservedSuffix(s) {
  const t = String(s || '').trim().toLowerCase().replace(/^\/+|\/+$/g, '');
  return RESERVED_SUFFIX.indexOf(t) >= 0;
}

// ============ 最高白名单(/entry 登录成功的 IP, 任何模式都例外) ============
async function getIpGuardTrusted(env) {
  try {
    return await memoStale('ipg_trusted', 30000, async () => {
      const r = await env.DB.prepare("SELECT value FROM app_config WHERE key = 'ipguard_trusted'").first();
      if (r && r.value) {
        const arr = JSON.parse(r.value);
        return Array.isArray(arr) ? arr : [];
      }
      return [];
    });
  } catch (e) { console.error('getIpGuardTrusted:', e && e.message); }
  return [];
}
async function addIpGuardTrusted(env, ip) {
  if (!ip) return;
  try {
    let cur = await getIpGuardTrusted(env);
    if (cur.indexOf(ip) < 0) {
      cur = cur.concat([ip]);
      await env.DB.prepare("INSERT INTO app_config(key,value) VALUES('ipguard_trusted',?) ON CONFLICT(key) DO UPDATE SET value=?").bind(JSON.stringify(cur), JSON.stringify(cur)).run();
      memoDel('ipg_trusted');
    }
  } catch (e) {}
}
async function saveIpGuardTrusted(env, arr) {
  try {
    await env.DB.prepare("INSERT INTO app_config(key,value) VALUES('ipguard_trusted',?) ON CONFLICT(key) DO UPDATE SET value=?").bind(JSON.stringify(arr), JSON.stringify(arr)).run();
    memoDel('ipg_trusted');
  } catch (e) {}
}

// ============ 最高黑名单(任何模式都拦截,优先于最高白名单) ============
async function getIpGuardBlocked(env) {
  try {
    return await memoStale('ipg_blocked', 30000, async () => {
      const r = await env.DB.prepare("SELECT value FROM app_config WHERE key = 'ipguard_blocked'").first();
      if (r && r.value) {
        const c = JSON.parse(r.value);
        return { ips: Array.isArray(c.ips) ? c.ips : [], redirect: String(c.redirect || '') };
      }
      return { ips: [], redirect: '' };
    });
  } catch (e) { console.error('getIpGuardBlocked:', e && e.message); }
  return { ips: [], redirect: '' };
}
async function saveIpGuardBlocked(env, ips, redirect) {
  try {
    const val = JSON.stringify({ ips, redirect: String(redirect || '') });
    await env.DB.prepare("INSERT INTO app_config(key,value) VALUES('ipguard_blocked',?) ON CONFLICT(key) DO UPDATE SET value=?").bind(val, val).run();
    memoDel('ipg_blocked');
  } catch (e) {}
}
async function addIpGuardBlocked(env, ip, redirect) {
  if (!ip) return;
  try {
    const cur = await getIpGuardBlocked(env);
    const nextIps = cur.ips.indexOf(ip) < 0 ? cur.ips.concat([ip]) : cur.ips;
    const nextRedirect = redirect !== undefined ? String(redirect || '') : cur.redirect;
    await saveIpGuardBlocked(env, nextIps, nextRedirect);
  } catch (e) {}
}
async function removeIpGuardBlocked(env, ip) {
  if (!ip) return;
  try {
    const cur = await getIpGuardBlocked(env);
    const next = cur.ips.filter(x => x !== ip);
    if (next.length !== cur.ips.length) await saveIpGuardBlocked(env, next, cur.redirect);
  } catch (e) {}
}

// ============ IP 访问控制(白名单/黑名单 + 国家封锁) ============
async function getIpGuard(env) {
  try {
    return await memoStale('ipg_main', 30000, async () => {
      const r = await env.DB.prepare("SELECT value FROM app_config WHERE key = 'ipguard'").first();
      if (r && r.value) {
        const c = JSON.parse(r.value);
        const splitC = (arr) => Array.isArray(arr) ? arr.flatMap(x => String(x).split(/[\n,，、\s]+/).map(y => y.trim().toUpperCase()).filter(Boolean)) : [];
        return { mode: c.mode === 'whitelist' || c.mode === 'blacklist' ? c.mode : 'off',
                 ips: Array.isArray(c.ips) ? c.ips : [],
                 countries: splitC(c.countries),
                 redirect: String(c.redirect || '') };
      }
      return { mode: 'off', ips: [], countries: [], redirect: '' };
    });
  } catch (e) { console.error('getIpGuard:', e && e.message); }
  return { mode: 'off', ips: [], countries: [], redirect: '' };
}
function ipv4ToInt(ip) {
  const p = ip.split('.');
  if (p.length !== 4) return -1;
  let v = 0;
  for (const seg of p) {
    if (!/^\d{1,3}$/.test(seg)) return -1;
    const n = parseInt(seg, 10);
    if (n > 255) return -1;
    v = v * 256 + n;
  }
  return v >>> 0;
}
function ipv6ToBytes(ip) {
  try {
    let s = ip;
    if (s.indexOf('::') >= 0) {
      const t = s.split('::');
      const left = t[0] ? t[0].split(':') : [], right = t[1] ? t[1].split(':') : [];
      const pad = 8 - left.length - right.length;
      if (pad < 0) return null;
      s = left.concat(Array(pad).fill('0'), right).join(':');
    }
    const parts = s.split(':');
    if (parts.length !== 8) return null;
    const bytes = [];
    for (const p of parts) {
      const n = parseInt(p, 16);
      if (isNaN(n)) return null;
      bytes.push((n >> 8) & 0xff, n & 0xff);
    }
    return bytes;
  } catch (e) { return null; }
}
function ipInCidr(ip, cidr) {
  const idx = cidr.indexOf('/');
  if (idx <= 0) return false;
  const net = cidr.slice(0, idx).trim();
  const bits = parseInt(cidr.slice(idx + 1), 10);
  if (isNaN(bits)) return false;
  if (net.indexOf('.') >= 0) {
    if (bits < 0 || bits > 32) return false;
    const a = ipv4ToInt(ip), b = ipv4ToInt(net);
    if (a < 0 || b < 0) return false;
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (a & mask) === (b & mask);
  }
  if (net.indexOf(':') >= 0) {
    if (bits < 0 || bits > 128) return false;
    const a = ipv6ToBytes(ip), b = ipv6ToBytes(net);
    if (!a || !b) return false;
    const full = bits >> 3, rem = bits & 7;
    for (let i = 0; i < full; i++) if (a[i] !== b[i]) return false;
    if (rem) { const m = 0xff << (8 - rem); if ((a[full] & m) !== (b[full] & m)) return false; }
    return true;
  }
  return false;
}
function ipMatchAny(ip, list) {
  ip = normalizeClientIp(ip);
  if (!ip || !Array.isArray(list) || !list.length) return false;
  for (const raw of list) {
    const t = String(raw).trim();
    if (!t) continue;
    if (t === ip) return true;
    if (t.indexOf('/') >= 0 && ipInCidr(ip, t)) return true;
  }
  return false;
}

// 队列推进器:头部 waiting → 启动执行;DO 模式完成后由 DO 回调推进;降级模式同步完成后继续下一个
async function maybeAdvanceQueue(env) {
  try {
    if (!env || !env.DB) return;
    // 领取阶段加锁:同一时刻只有一个调用者能把某个 waiting 项改成 running(修复同一节点被重复启动)
    const claim = await withKaLock(env, async () => {
      const q = await kaGetQueue(env);
      if (!q.items.length) return null;
      // 卡死清理:running 超过 20 分钟仍无结果(DO 异常丢失等)→ 移除,否则会一直占用并发名额
      const nowTs = Date.now();
      const stale = q.items.filter(i => i.status === 'running' && i.startedAt && nowTs - i.startedAt > KA_STALE_RUNNING_MS);
      if (stale.length) {
        const hist0 = await kaGetHistory(env);
        for (const sItem of stale) hist0.unshift({ prefix: sItem.prefix, kind: sItem.kind, ok: false, msg: '执行超时(超过 20 分钟无结果),已自动清理', finishedAt: nowTs, detail: '' });
        if (hist0.length > 60) hist0.length = 60;
        await kaSaveHistory(env, hist0);
        q.items = q.items.filter(i => stale.indexOf(i) < 0);
        await kaSaveQueue(env, q);
      }
      // v3.6.70:并发推进——running 达 KA_MAX_CONCURRENT 则等待回调;头部 running 时找后续 waiting 启动
      const runningCount = q.items.filter(i => i.status === 'running').length;
      if (runningCount >= KA_MAX_CONCURRENT) return null;
      // 下载优先:当前有下载在进行时,新保活暂缓启动,下载结束会自动再次推进
      try { if (await kaDlActive(env) > 0) return null; } catch (e) {}
      const item = q.items.find(i => i.status === 'waiting');
      if (!item) return null;
      const route = await env.DB.prepare('SELECT * FROM routes WHERE prefix = ?').bind(item.prefix).first();
      if (!route) {
        q.items = q.items.filter(i => i.id !== item.id);
        const hist1 = await kaGetHistory(env);
        hist1.unshift({ prefix: item.prefix, kind: item.kind, ok: false, msg: '节点不存在', finishedAt: Date.now(), detail: '' });
        if (hist1.length > 60) hist1.length = 60;
        await kaSaveHistory(env, hist1);
        await kaSaveQueue(env, q);
        return { again: true };
      }
      item.status = 'running';
      item.startedAt = Date.now();
      await kaSaveQueue(env, q);
      return { item, route, runningCount };
    });
    if (!claim) return;
    if (claim.again) return maybeAdvanceQueue(env);
    const { item, route, runningCount } = claim;
    await env.DB.prepare('INSERT OR REPLACE INTO app_config (key, value) VALUES (?, ?)')
      .bind('ka_live', JSON.stringify({ running: true, prefix: item.prefix, current: (item.kind === 'manual' ? '手动保活' : '自动保活') + '：' + (route.remark || item.prefix) + ' 已开始' + (runningCount > 0 ? '（并行 ' + (runningCount + 1) + ' 个）' : ''), steps: [], progress: 3, mediaTitle: '', updatedAt: Date.now() })).run();
    const result = await runKeepAlive(env, route, item.id);
    if (result.ok) {
      // 成功:更新保活时间,清除失败重试标记;v3.6.68 重置间隔——写入下次随机计划 ka_next_run([ka_days×50%, ka_days−1] 随机)
      const nextRun = new Date(Date.now() + kaRandomNextMs(route.ka_days)).toISOString();
      await env.DB.prepare('UPDATE routes SET last_ka_run = ?, last_ka_result = ?, last_ka_detail = ?, ka_retry_at = ?, ka_fail_count = 0, ka_next_run = ? WHERE prefix = ?')
        .bind(new Date().toISOString(), 'success', result.msg || '', '', nextRun, item.prefix).run();
    } else {
      // 失败:不消耗保活间隔(ka_days 不重置);v3.6.70 重试间隔可配置 ka_retry_hours(默认 4h)
      const retryAt = new Date(Date.now() + (await kaRetryHours(env)) * 3600000).toISOString();
      await env.DB.prepare('UPDATE routes SET last_ka_result = ?, last_ka_detail = ?, ka_retry_at = ?, ka_fail_count = COALESCE(ka_fail_count, 0) + 1 WHERE prefix = ?')
        .bind('fail', result.msg || '', retryAt, item.prefix).run();
    }
    await pushKaNotice(env, item.prefix, result.ok, result.msg, route.remark);
    if (result && result.doScheduled) {
      // v3.6.70:DO 长任务在后台跑,立即推进下一个(受 KA_MAX_CONCURRENT 约束,running 项由 DO 回调清理)
      return maybeAdvanceQueue(env);
    }
    // 降级模式:已同步完成 → 收尾并继续下一个
    await kaFinishItem(env, null, item, result.ok, result.msg, result.kaInfo || null);
    // v3.6.70:并行时若队列仍有 running 任务,ka_live 不置 false
    const qAfter = await kaGetQueue(env);
    const stillRunning = qAfter.items.some(i => i.status === 'running');
    await env.DB.prepare('INSERT OR REPLACE INTO app_config (key, value) VALUES (?, ?)')
      .bind('ka_live', JSON.stringify({ running: stillRunning, prefix: item.prefix, current: '', steps: result.steps || [], msg: result.msg || '', progress: 100, mediaTitle: '', updatedAt: Date.now() })).run();
    return maybeAdvanceQueue(env);
  } catch (e) {
    try { if (env && env.DB) await env.DB.prepare('INSERT OR REPLACE INTO app_config (key, value) VALUES (?,?)').bind('ka_queue_err', String(e.message || e).slice(0, 200)).run(); } catch (e2) {}
  }
}

// v3.6.70:保活失败重试间隔(小时),面板可配置(app_config key='ka_retry_hours',默认 4)
async function kaRetryHours(env) {
  try {
    const row = await env.DB.prepare("SELECT value FROM app_config WHERE key = 'ka_retry_hours'").first();
    if (row && row.value) { const h = parseFloat(row.value); if (h > 0) return h; }
  } catch (e) {}
  return 4;
}

// v3.6.68:随机保活计划——下次保活时刻 = 当前 + [ka_days×50%, ka_days−1 天] 随机(最少提前 1 天,不落当天)
// 小间隔(ka_days≤2)窗口起点≥终点时退化单点;极端小值保底 0.1 天
function kaRandomNextMs(kaDays) {
  try {
    const days = Math.max(0.1, parseFloat(kaDays) || 3);
    let lo = days * 0.5;
    let hi = days - 1;
    if (hi < lo) hi = lo;
    lo = Math.max(0.1, lo);
    if (hi < 0.1) hi = 0.1;
    const randDays = lo + Math.random() * (hi - lo);
    return Math.floor(randDays * 86400000);
  } catch (e) { return Math.floor(Math.max(0.1, parseFloat(kaDays) || 3) * 0.5 * 86400000); }
}

// v3.6.69:模拟观看时长按片长比例映射到 90~390s(基准 15min→90s, 60min→390s, 中间线性; <15min 按 90s, >60min 按 390s; 未知片长 90~390 随机)
function kaPlaySecByRuntime(runtimeTicks) {
  const rtMin = runtimeTicks > 0 ? runtimeTicks / 600000000 : 0;
  if (!rtMin) return 90 + Math.floor(Math.random() * 301);
  const t = Math.min(1, Math.max(0, (rtMin - 15) / (60 - 15)));
  return Math.round(90 + t * (390 - 90));
}
// v3.6.69:拉流上限 = max(文件大小×35%, 观看时长所需流量), 1GB 封顶(文件特别大拉 1GB;观看所需超 35% 继续拉)
// bitRate 单位 bps;拿不到大小/码率时回退 1GB
function kaCapBytes(sizeBytes, bitRate, playSec) {
  try {
    const need = (playSec > 0 && bitRate > 0) ? Math.floor(playSec * bitRate / 8) : 0;
    const byPct = sizeBytes > 0 ? Math.floor(sizeBytes * 0.35) : 0;
    const cap = Math.min(Math.max(byPct, need), 1024 * 1024 * 1024);
    return cap > 0 ? cap : 1024 * 1024 * 1024;
  } catch (e) { return 1024 * 1024 * 1024; }
}

async function checkKeepAliveSchedule(env) {
  try {
    if (!kaColsReady) {
      try { await env.DB.exec(`ALTER TABLE routes ADD COLUMN ka_enabled TEXT DEFAULT '0'`); } catch(e) {}
      try { await env.DB.exec(`ALTER TABLE routes ADD COLUMN ka_days TEXT DEFAULT '3'`); } catch(e) {}
      try { await env.DB.exec(`ALTER TABLE routes ADD COLUMN ka_token TEXT DEFAULT ''`); } catch(e) {}
      try { await env.DB.exec(`ALTER TABLE routes ADD COLUMN node_user TEXT DEFAULT ''`); } catch(e) {}
      try { await env.DB.exec(`ALTER TABLE routes ADD COLUMN node_pass TEXT DEFAULT ''`); } catch(e) {}
      try { await env.DB.exec(`ALTER TABLE routes ADD COLUMN last_ka_run TEXT DEFAULT ''`); } catch(e) {}
      try { await env.DB.exec(`ALTER TABLE routes ADD COLUMN last_ka_result TEXT DEFAULT ''`); } catch(e) {}
      try { await env.DB.exec(`ALTER TABLE routes ADD COLUMN last_ka_detail TEXT DEFAULT ''`); } catch(e) {}
      try { await env.DB.exec(`ALTER TABLE routes ADD COLUMN ka_retry_at TEXT DEFAULT ''`); } catch(e) {}
      try { await env.DB.exec(`ALTER TABLE routes ADD COLUMN ka_fail_count INTEGER DEFAULT 0`); } catch(e) {}
      try { await env.DB.exec(`ALTER TABLE routes ADD COLUMN ka_next_run TEXT DEFAULT ''`); } catch(e) {}
      kaColsReady = true;
    }
    const { results: routes } = await env.DB.prepare(`SELECT * FROM routes WHERE ka_enabled = '1'`).all();
    if (!routes || routes.length === 0) return;
    const due = routes.filter(r => {
      // v3.6.1:保活失败重试——失败后 ka_retry_at(4h 后)到达即视为到期,自动重新入队(优先于计划时刻)
      if (r.ka_retry_at && new Date(r.ka_retry_at).getTime() <= Date.now()) return true;
      // v3.6.68:随机计划时刻到期(ka_next_run 由成功保活时按 [ka_days×50%, ka_days−1] 随机写入)
      const next = r.ka_next_run ? new Date(r.ka_next_run).getTime() : 0;
      if (next && Date.now() >= next) return true;
      // 老数据兼容:无 ka_next_run → 按 last_ka_run + 半间隔(窗口起点)到期;从未保活过 → 立即
      const last = r.last_ka_run ? new Date(r.last_ka_run).getTime() : 0;
      if (!last) return true;
      const days = Math.max(0.1, parseFloat(r.ka_days) || 3);
      return Date.now() >= last + days * 0.5 * 86400000;
    });
    if (due.length === 0) return;
    due.sort((a, b) => {
      const da = a.last_ka_run ? new Date(a.last_ka_run).getTime() : 0;
      const db = b.last_ka_run ? new Date(b.last_ka_run).getTime() : 0;
      return da - db;
    });
    // v3.6.0:到期节点全部按顺序(最久未执行优先=卡片序)入队,由 maybeAdvanceQueue 逐个执行;
    // 已在队列中的节点自动去重,不再因"正在运行"跳过
    for (const r of due) await kaEnqueue(env, r.prefix, 'auto');
    await maybeAdvanceQueue(env);
  } catch (e) {}
}

async function sendTgStats(env, chatId) {
    try {
        const totalQuery = await env.DB.prepare(`SELECT COUNT(*) as count FROM visitor_logs WHERE date(timestamp, '+8 hours') = date('now', '+8 hours')`).first();
        const topRegionQuery = await env.DB.prepare(`SELECT country, COUNT(*) as c FROM visitor_logs WHERE date(timestamp, '+8 hours') = date('now', '+8 hours') GROUP BY country ORDER BY c DESC LIMIT 1`).first();
        const topNodeQuery = await env.DB.prepare(`
            SELECT r.remark, COUNT(v.id) as c 
            FROM visitor_logs v 
            LEFT JOIN routes r ON v.prefix = r.prefix 
            WHERE date(v.timestamp, '+8 hours') = date('now', '+8 hours') 
            GROUP BY v.prefix 
            ORDER BY c DESC LIMIT 1
        `).first();

        // 获取多时间维度流量
        const [trafficToday, traffic7d, traffic30d] = await Promise.all([
            getCFTraffic(env, 'today'),
            getCFTraffic(env, 7),
            getCFTraffic(env, 30)
        ]);

        // ================= 新增：获取今日流量消耗 TOP 1 节点 =================
        let topNodeMsg = "暂无数据";
        if (env.CF_API_TOKEN && env.CF_ZONE_ID && env.DB) {
            try {
                // 1. 获取所有节点
                const { results: routes } = await env.DB.prepare(`SELECT prefix, remark FROM routes`).all();
                if (routes && routes.length > 0) {
                    const end = new Date();
                    const beijingTime = new Date(end.getTime() + 8 * 3600000);
                    beijingTime.setUTCHours(0, 0, 0, 0);
                    const start = new Date(beijingTime.getTime() - 8 * 3600000);

                    let maxBytes = 0;
                    let topNodeName = "无";

                    // 2. 并发向 CF 查询每个节点今天的精准流量
                    await Promise.all(routes.map(async (r) => {
                        try {
                            const graphqlQuery = {
                                query: `query {
                                  viewer {
                                    zones(filter: {zoneTag: "${env.CF_ZONE_ID}"}) {
                                      httpRequestsAdaptiveGroups(
                                        limit: 1,
                                        filter: {
                                          clientRequestPath_like: "/${r.prefix}%",
                                          datetime_geq: "${start.toISOString()}",
                                          datetime_leq: "${end.toISOString()}"
                                        }
                                      ) {
                                        sum { edgeResponseBytes }
                                      }
                                    }
                                  }
                                }`
                            };

                            const cfRes = await fetch('https://api.cloudflare.com/client/v4/graphql', {
                                method: 'POST',
                                headers: { 'Authorization': `Bearer ${env.CF_API_TOKEN}`, 'Content-Type': 'application/json' },
                                body: JSON.stringify(graphqlQuery)
                            });
                            
                            const cfData = await cfRes.json();
                            const bytes = cfData?.data?.viewer?.zones?.[0]?.httpRequestsAdaptiveGroups?.[0]?.sum?.edgeResponseBytes || 0;
                            
                            // 3. 找出最大值
                            if (bytes > maxBytes) {
                                maxBytes = bytes;
                                topNodeName = r.remark || r.prefix;
                            }
                        } catch(e) {}
                    }));

                    // 4. 转换字节并组装文本
                    if (maxBytes > 0) {
                        let formatted = "0 B";
                        if (maxBytes >= 1099511627776) formatted = (maxBytes / 1099511627776).toFixed(2) + " TB";
                        else if (maxBytes >= 1073741824) formatted = (maxBytes / 1073741824).toFixed(2) + " GB";
                        else if (maxBytes >= 1048576) formatted = (maxBytes / 1048576).toFixed(2) + " MB";
                        else if (maxBytes >= 1024) formatted = (maxBytes / 1024).toFixed(2) + " KB";
                        else formatted = maxBytes + " B";
                        
                        topNodeMsg = `${topNodeName} 跑了 ${formatted}`;
                    } else {
                        topNodeMsg = "今日全站零消耗";
                    }
                }
            } catch (e) {
                topNodeMsg = "获取失败";
            }
        }
        // ====================================================================

        const totalStr = totalQuery ? totalQuery.count : 0;
        const regionStr = topRegionQuery ? `${topRegionQuery.country === 'CN' ? ' 中国大陆' : topRegionQuery.country} (${topRegionQuery.c} 次)` : '暂无记录';
        const nodeStr = topNodeQuery ? `${topNodeQuery.remark || '未命名节点'} (${topNodeQuery.c} 次)` : '暂无记录';

        const msg = 
            `*今日反代播放数据*\n\n` +
            `今日总播放次数: ${totalStr} 次\n` +
            `最多访问地区: ${regionStr}\n` +
            `最喜欢的EMBY: ${nodeStr}\n\n` +
            `实际流量消耗:\n` +
            `当天内: ${trafficToday}\n` +
            `七天内: ${traffic7d}\n` +
            `30天内: ${traffic30d}\n\n` +
            `今日流量之王:\n` +
            `${topNodeMsg}`;

        await fetch(`https://api.telegram.org/bot${env.TG_BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text: msg, parse_mode: 'Markdown' })
        });
    } catch (e) {
        console.error("TG Send Error:", e);
    }
}

/** 引号字符串转义：防头注入（引号/反斜杠转义、\r\n 丢弃） */
function escQuote(v) {
  return String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n]+/g, '');
}

/** 生成随机 UUID v4（Device ID 用，crypto.randomUUID 兜底自实现） */
function genUuid() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b).map(x => x.toString(16).padStart(2, '0')).join('');
  return h.slice(0,8) + '-' + h.slice(8,12) + '-' + h.slice(12,16) + '-' + h.slice(16,20) + '-' + h.slice(20);
}

/** 下载伪装伴随观看（CF 版）：起播 → 流驱动心跳 → 随机时长停止 → 结束收尾。
 *  与 VPS/插件版同款协议：Sessions/Playing 起播 → Playing/Progress 心跳（固定每 10s 一次，
 *  对齐真实播放器节奏）→ 60s~300s 随机时间节点 Stopped → 1.5s 后重置 UserData 清除播放记录。
 *  CF 运行时限制：不依赖后台定时器，心跳由响应流的读取节奏驱动（每次读到数据块检查是否到点）；
 *  收尾通过 ctx.waitUntil 保证在响应结束后仍执行完毕。 */
function spawnDlTrickWatchCF(target, req, itemId, search, fakeCfg) {
    try {
        const params = new URLSearchParams((search || '').replace(/^\?/, ''));
        const apiKey = params.get('api_key') || params.get('X-Emby-Token') || '';
        const authHdr = req.headers.get('x-emby-authorization') || req.headers.get('authorization') || '';
        if (!apiKey && !authHdr) return null;   // 无凭据无法伪装，直接跳过
        const msId = params.get('mediaSourceId') || params.get('MediaSourceId') || '';
        const mClient = String(authHdr).match(/Client="([^"]+)"/i);
        const mVersion = String(authHdr).match(/Version="([^"]+)"/i);
        const mDevice = String(authHdr).match(/Device="([^"]+)"/i);
        const mDevId = String(authHdr).match(/DeviceId="([^"]+)"/i);
        // 下载伴随观看身份：节点设置了伪装参数 → 完整跟随伪装身份(Client/Device/Version/DeviceId/UA 一起换)；
        // 未设置 → 透传真实播放器的 UA 和 DeviceId(下载即播放，上游看到用户自己的设备在看，最自然)
        const hasFake = !!(fakeCfg && (fakeCfg.client || fakeCfg.version || fakeCfg.device || fakeCfg.ua || fakeCfg.deviceId));
        const deviceId = hasFake ? (fakeCfg.deviceId || genUuid()) : ((mDevId && mDevId[1]) || genUuid());
        const client = hasFake ? (fakeCfg.client || 'SenPlayer') : ((mClient && mClient[1]) || 'Emby');
        const version = hasFake ? (fakeCfg.version || '6.2.2') : ((mVersion && mVersion[1]) || '4.8.0.0');
        const device = hasFake ? (fakeCfg.device || 'iPhone') : ((mDevice && mDevice[1]) || '');
        const playSessionId = genUuid();
        let targetOrigin = '';
        try { targetOrigin = new URL(target).origin; } catch(e) { return null; }
        const hdrs = { 'Content-Type': 'application/json' };
        if (authHdr) {
            if (hasFake) {
                // 完整替换成伪装身份
                hdrs['X-Emby-Authorization'] = 'MediaBrowser Client="' + client + '", Device="' + device + '", DeviceId="' + deviceId + '", Version="' + version + '"';
            } else {
                // 透传真实：认证头原样保留(含真实 DeviceId)，不替换
                hdrs['X-Emby-Authorization'] = authHdr;
            }
        }
        if (hasFake) hdrs['User-Agent'] = fakeCfg.ua || (client + '/' + version);
        else if (req.headers.get('user-agent')) hdrs['User-Agent'] = req.headers.get('user-agent');
        const url = path => addApiKey(targetOrigin + path, apiKey);
        const base = { ItemId: itemId, MediaSourceId: msId || itemId, PlaySessionId: playSessionId, DeviceId: deviceId, Client: client, Version: version, PlayMethod: 'DirectStream', CanSeek: true, IsPaused: false, QueueableMediaTypes: ['Video'] };
        const watchBody = pos => JSON.stringify(Object.assign({}, base, { PositionTicks: pos, PlaybackPositionTicks: pos }));
        let closed = false, posTicks = 0, userId = '';
        // 心跳固定每 10s 一次；总时长 60s~300s 随机，到随机节点主动收尾（下载一般早于该时长完成）
        const HEARTBEAT = 10;
        const STOP_MIN = 60, STOP_MAX = 300;
        const stopAfterMs = (STOP_MIN + Math.floor(Math.random() * (STOP_MAX - STOP_MIN + 1))) * 1000;
        const startAt = Date.now();
        let nextHeartAt = startAt + HEARTBEAT * 1000;
        const post = (path, body) => kaFetch(url(path), { method: 'POST', headers: hdrs, body }).catch(() => null);
        // 起播 + 预取用户信息（fire-and-forget，响应流期间事件循环可执行）
        post('/emby/Sessions/Playing', watchBody(0));
        kaFetch(url('/emby/Users/Me'), { headers: hdrs }).then(async r => {
            try { userId = (JSON.parse(await r.text()) || {}).Id || ''; } catch(e){}
        }).catch(() => {});
        return {
            // 响应流驱动心跳：每次读到数据块后调用，到达心跳时间点即上报（不 await，避免拖慢流转发）
            // 返回 true 表示已到随机停止节点（60~300s），由流层触发收尾
            tick() {
                if (closed) return false;
                const now = Date.now();
                if (now < nextHeartAt) return false;
                posTicks += HEARTBEAT * 10000000;
                nextHeartAt = now + HEARTBEAT * 1000;
                post('/emby/Sessions/Playing/Progress', watchBody(posTicks));
                // 到随机停止节点(60~300s):返回 true 由流层触发收尾(finish 内部负责置 closed)
                if (now - startAt >= stopAfterMs) return true;
                return false;
            },
            // 下载结束/断开：上报结束 + 重置 UserData 清除播放记录（调用方须用 ctx.waitUntil 包裹）
            async finish() {
                if (closed) return;
                closed = true;
                try {
                    if (!userId) {
                        const r = await kaFetch(url('/emby/Users/Me'), { headers: hdrs });
                        try { userId = (JSON.parse(await r.text()) || {}).Id || ''; } catch(e){}
                    }
                } catch(e){}
                await post('/emby/Sessions/Playing/Stopped', watchBody(posTicks));
                if (userId && itemId) {
                    await new Promise(r2 => setTimeout(r2, 1500));   // 等 Stopped 落库后再清
                    await post('/emby/Users/' + encodeURIComponent(userId) + '/Items/' + encodeURIComponent(itemId) + '/UserData',
                        JSON.stringify({ Played: false, PlayCount: 0, ResumePositionTicks: 0, PlaybackPositionTicks: 0, PlayedPercentage: 0 }));
                }
            }
        };
    } catch(e) { return null; }
}

/** 把响应流包一层：转发数据块并在读取间隙驱动心跳，流结束/取消时收尾（收尾走 ctx.waitUntil 保证执行） */
function wrapStreamWithWatch(stream, watch, ctx, onFinish, onBytes) {
    const reader = stream.getReader();
    const runFinish = () => {
        try { if (onFinish) onFinish(); } catch(e){}
        try { if (watch && watch.finish) { const p = watch.finish(); if (p && ctx && ctx.waitUntil) ctx.waitUntil(p); } } catch(e){}
    };
    return new ReadableStream({
        async pull(controller) {
            try {
                const { done, value } = await reader.read();
                if (done) {
                    try { controller.close(); } catch(e){}
                    runFinish();
                    return;
                }
                controller.enqueue(value);
                try { if (onBytes && value) onBytes(value.byteLength); } catch(e){}
                try { const expired = watch && watch.tick ? watch.tick() : false; if (expired) runFinish(); } catch(e){}
            } catch (err) {
                try { controller.error(err); } catch(e){}
                runFinish();
            }
        },
        cancel() {
            try { reader.cancel(); } catch(e){}
            runFinish();
        }
    });
}

// ============ 保号通知（Bark / Telegram）============
async function getNotifyCfg(env) {
    let cfg = { barkKey: '', barkLevel: 'active', barkServer: 'https://api.day.app', barkNotify: true, tgToken: '', tgChatId: '', tgNotify: true, kaNotifyMode: 'all' };
    try {
        if (env && env.DB) {
            const row = await env.DB.prepare("SELECT value FROM app_config WHERE key = 'notify_settings'").first();
            if (row && row.value) Object.assign(cfg, JSON.parse(row.value));
        }
    } catch (e) {}
    return cfg;
}
async function sendBarkN(cfg, title, body) {
    try {
        if (!cfg.barkKey) return false;
        const r = await fetch((cfg.barkServer || 'https://api.day.app').replace(/\/+$/, '') + '/' + String(cfg.barkKey).trim(), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json; charset=utf-8' },
            body: JSON.stringify({ title: title, body: body, level: cfg.barkLevel || 'active' })
        });
        return r.ok;
    } catch (e) { return false; }
}
async function sendTgN(cfg, text) {
    try {
        if (!cfg.tgToken || !cfg.tgChatId) return false;
        const r = await fetch('https://api.telegram.org/bot' + String(cfg.tgToken).trim() + '/sendMessage', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: String(cfg.tgChatId).trim(), text: text })
        });
        return r.ok;
    } catch (e) { return false; }
}
async function scanOverdueNotify(env, ctx) {
    try {
        if (!env.DB) return;
        const cfg = await getNotifyCfg(env);
        if (!cfg.barkNotify && !cfg.tgNotify) return;
        if (!cfg.barkKey && !(cfg.tgToken && cfg.tgChatId)) return;
        const todayStr = new Date(Date.now() + 8 * 3600000).toISOString().split('T')[0];
        const lastRow = await env.DB.prepare("SELECT value FROM app_config WHERE key = 'overdue_notify'").first();
        let last = {};
        try { if (lastRow && lastRow.value) last = JSON.parse(lastRow.value); } catch (e) {}
        if (last.date === todayStr) return;
        if (!routesWatchLimitColReady) { try { await env.DB.exec(`ALTER TABLE routes ADD COLUMN watch_limit TEXT DEFAULT '0'`); } catch (e) {} routesWatchLimitColReady = true; }
        const { results } = await env.DB.prepare('SELECT prefix, remark, target, last_play, watch_limit FROM routes').all();
        const list = [];
        for (const r of (results || [])) {
            const wl = parseFloat(r.watch_limit);
            if (!wl || wl <= 0 || !r.last_play) continue;
            const lpUtc = Date.parse(String(r.last_play).replace(' ', 'T') + 'Z') - 8 * 3600000;
            if (isNaN(lpUtc)) continue;
            const diffDays = Math.floor((Date.now() - lpUtc) / 86400000);
            if (diffDays > wl) list.push({ prefix: r.prefix, remark: r.remark || r.prefix, days: diffDays, wl: wl });
        }
        await env.DB.prepare('INSERT OR REPLACE INTO app_config (key, value) VALUES (?, ?)').bind('overdue_notify', JSON.stringify({ date: todayStr, list: list })).run();
        if (!list.length) return;
        const lines = list.map(n => '· ' + n.remark + '（/' + n.prefix + '）已 ' + n.days + ' 天未观看，超过下限 ' + n.wl + ' 天');
        const text = '⚠️ 保号提醒：' + list.length + ' 个节点超过观看下限未观看\n' + lines.join('\n');
        if (cfg.barkNotify && cfg.barkKey) await sendBarkN(cfg, 'Emby 反代面板 · 保号提醒', text);
        if (cfg.tgNotify && cfg.tgToken && cfg.tgChatId) await sendTgN(cfg, text);
    } catch (e) { console.error('scanOverdueNotify:', e); }
}
let overdueMemAt = 0, kaCheckMemAt = 0, updateCheckMemAt = 0;
const THROTTLE_MEM_MS = 10 * 60 * 1000;   // isolate 内短路:10 分钟内最多尝试抢占一次(减少 D1 写)
async function maybeScanOverdue(env) {
    try {
        if (!env.DB) return;
        const now = Date.now();
        if (now - overdueMemAt < THROTTLE_MEM_MS) return;
        overdueMemAt = now;
        if (!(await claimThrottle(env, 'overdue_last_check', 6 * 3600000))) return;
        await scanOverdueNotify(env, {});
    } catch (e) {}
}

// ============ 自动保活（请求驱动版）：不依赖 Cron 也能按各节点间隔自动保活 ============
// 原理：任何请求进入 Worker（用户访问面板/反代）时低频触发一次检查（默认 1 小时节流），
// 由 checkKeepAliveSchedule 按每个节点各自的 ka_days / last_ka_run 独立判断是否到期，
// 到期即对该节点执行保活。每个 Emby 的间隔独立计时，不存在"统一保活"错位问题。
// 配了 Cron 时由 scheduled 同样调用 checkKeepAliveSchedule，两者互不冲突（节流键独立）。
async function maybeCheckKeepAlive(env) {
    try {
        if (!env.DB || env.KA_ENABLED === 'off') return;
        const now = Date.now();
        if (now - kaCheckMemAt < THROTTLE_MEM_MS) return;
        kaCheckMemAt = now;
        if (!(await claimThrottle(env, 'ka_last_check', 3600000))) return;   // 1 小时节流(原子抢占,避免并发重复触发)
        await checkKeepAliveSchedule(env);
    } catch (e) {}
}

// ============ 新版本推送通知（Bark / Telegram）============
function verNum(v) {
    return String(v || '').replace(/^v/i, '').split('.').map(n => parseInt(n, 10) || 0);
}
function isNewerVer(a, b) {
    const A = verNum(a), B = verNum(b);
    for (let i = 0; i < Math.max(A.length, B.length); i++) {
        const x = A[i] || 0, y = B[i] || 0;
        if (x !== y) return x > y;
    }
    return false;
}
async function checkUpdateNotify(env) {
    try {
        if (!env.DB) return;
        // 更新提醒开关（与面板弹窗提醒一致）
        let notifyOn = true;
        try {
            const row = await env.DB.prepare("SELECT value FROM app_config WHERE key = 'update_notify'").first();
            if (row && row.value !== null && row.value !== undefined) notifyOn = String(row.value) !== '0';
        } catch (e) {}
        if (!notifyOn) return;
        // 拉取 changelog 最新版本
        const res = await fetch(CHANGELOG_URL, { headers: { 'User-Agent': 'cloudflare-worker' } });
        if (!res.ok) return;
        const cl = await res.json();
        const latest = (cl && cl.versions && cl.versions[0]) || null;
        if (!latest || !latest.version) return;
        if (!isNewerVer(latest.version, CURRENT_VERSION)) return;
        // 防重复：每个新版本只推送一次
        const sentRow = await env.DB.prepare("SELECT value FROM app_config WHERE key = 'update_notify_sent'").first();
        let sent = {};
        try { if (sentRow && sentRow.value) sent = JSON.parse(sentRow.value); } catch (e) {}
        if (sent.version === latest.version) return;
        const cfg = await getNotifyCfg(env);
        if (!cfg.barkNotify && !cfg.tgNotify) return;
        if (!cfg.barkKey && !(cfg.tgToken && cfg.tgChatId)) return;
        const items = (latest.items || []).slice(0, 6).map(i => '· ' + i).join('\n');
        const text = '🚀 检测到新版本：v' + latest.version + '（' + (latest.title || '') + '）\n当前版本：v' + CURRENT_VERSION + '\n\n更新内容：\n' + items + '\n\n可在面板「设置 → 版本」中查看更新内容并手动更新。';
        let ok = false;
        if (cfg.barkNotify && cfg.barkKey) ok = await sendBarkN(cfg, 'Emby 反代面板 · 新版本可用', text) || ok;
        if (cfg.tgNotify && cfg.tgToken && cfg.tgChatId) ok = await sendTgN(cfg, text) || ok;
        if (ok) await env.DB.prepare('INSERT OR REPLACE INTO app_config (key, value) VALUES (?, ?)').bind('update_notify_sent', JSON.stringify({ version: latest.version })).run();
    } catch (e) { console.error('checkUpdateNotify:', e); }
}
async function maybeCheckUpdate(env) {
    try {
        if (!env.DB) return;
        const now = Date.now();
        if (now - updateCheckMemAt < THROTTLE_MEM_MS) return;
        updateCheckMemAt = now;
        if (!(await claimThrottle(env, 'update_notify_last_check', 6 * 3600000))) return;
        await checkUpdateNotify(env);
    } catch (e) {}
}

// ============ 自动保活·模拟播放长任务 DO ============
// 突破 CF 单请求 30s 墙钟限制：用 Durable Objects + Alarm 链驱动真实播放节奏心跳。
// 流程：PlaybackStart(起点=片长 2%~10% 随机) → 每 10s 一条 Progress(90~390s 按片长比例)
// → Stopped → 1.5s 后重置 UserData(删除播放记录) → 完成。全程写 ka_live 供面板轮询。
// 部署：CF 面板 → 你的 Worker → 设置 → 绑定 → Durable Objects → 变量名 KEEPALIVE_DO、类名 KeepAliveDO。
export class KeepAliveDO {
  constructor(state, env) { this.state = state; this.env = env; this.streamReader = null; }
  async fetch(request) {
    try {
      const job = await request.json();
      const { target, token, authHdr, ua, itemId, msId, userId, client, version, deviceId, playSessionId, prefix, qid, mediaTitle, sizeBytes, bitRate } = job || {};
      if (!target || !token || !itemId || !playSessionId) return Response.json({ ok: false, msg: 'DO 参数缺失(target/token/itemId/playSessionId)' });
      const hdrs = { 'X-Emby-Authorization': authHdr || '', 'User-Agent': ua || '', 'Content-Type': 'application/json' };
      const url = p => addApiKey(target + p, token);
      const body = pos => JSON.stringify({ ItemId: itemId, MediaSourceId: msId || itemId, PlaySessionId: playSessionId, DeviceId: deviceId || genUuid(), Client: client || 'SenPlayer', Version: version || '6.2.2', PlayMethod: 'DirectStream', CanSeek: true, IsPaused: false, QueueableMediaTypes: ['Video'], PositionTicks: pos, PlaybackPositionTicks: pos });
      // 取片长
      let runtimeTicks = 0;
      try {
        const r = await kaJson(url('/emby/Items/' + encodeURIComponent(itemId) + '?Fields=RunTimeTicks'), { headers: hdrs });
        if (r.status === 200 && r.data) runtimeTicks = parseInt(r.data.RunTimeTicks, 10) || 0;
      } catch (e) {}
      // 起点 = 片长 2%~10% 随机；片长未知时用 60~300s 兜底
      const pct = 2 + Math.random() * 8;
      const startTicks = runtimeTicks > 0 ? Math.floor(runtimeTicks * pct / 100) : (60 + Math.floor(Math.random() * 241)) * 10000000;
      const playSec = kaPlaySecByRuntime(runtimeTicks);   // v3.6.69:90~390s 按片长比例(30min→90s,180min→390s)
      const endTicks = startTicks + playSec * 10000000;
      // PlaybackStart
      let startOk = false;
      try {
        const r = await kaJson(url('/emby/Sessions/Playing'), { method: 'POST', headers: hdrs, body: body(startTicks) });
        startOk = r.status === 200 || r.status === 204;
      } catch (e) {}
      if (!startOk) return Response.json({ ok: false, msg: 'PlaybackStart 失败,跳过 DO 长任务' });
      const st = { target, token, authHdr: authHdr || '', ua: ua || '', itemId, msId: msId || '', userId: userId || '', client: client || 'SenPlayer', version: version || '6.2.2', deviceId: deviceId || genUuid(), playSessionId, prefix: prefix || '', qid: parseInt(qid, 10) || 0, mediaTitle: mediaTitle || '', startTicks, endTicks, playSec, sizeBytes: parseInt(sizeBytes, 10) || 0, bitRate: parseInt(bitRate, 10) || 0, capBytes: kaCapBytes(parseInt(sizeBytes, 10) || 0, parseInt(bitRate, 10) || 0, playSec), elapsed: 0, done: false, bytesRead: 0, streamTail: 0, streamLimited: false };
      st.steps = [{ name: '播放会话开始', ok: true, detail: '起点 ' + fmtPos(startTicks) + '(片长 ' + (runtimeTicks > 0 ? Math.round(pct) + '%' : '未知') + ') → 播放 ' + playSec + 's' }];
      // v3.6.8:持续拉流改为 alarm 事件内分段 Range(pullRange),不在 fetch 事件里建跨事件持久流
      await this.state.storage.put('job', st);
      await this.state.storage.setAlarm(Date.now() + 10000);
      this.saveLive('模拟播放已启动(约 ' + playSec + 's 真实心跳,持续拉流)', st.steps, 70, st);
      return Response.json({ ok: true, msg: '已调度 ' + playSec + 's 真实心跳模拟(起点 ' + fmtPos(startTicks) + ')' });
    } catch (e) {
      return Response.json({ ok: false, msg: 'DO 异常: ' + e.message });
    }
  }
  // 每次 alarm 读一段流,模拟真实播放器持续下载(上限 = max(文件大小×35%, 观看时长所需流量), ≤1GB; v3.6.69)
  // v3.6.8:在当前 alarm 事件内建立并读取一段视频流(约 20MB,Range 基于已读偏移),读完即关。
  // 不跨事件持有流——DO fetch/alarm 事件返回后,事件期间建立的连接会被 CF 终止(旧版持久流因此恒读 0B)。
  async pullRange(st, hdrs) {
    const CAP = st.capBytes || (1024 * 1024 * 1024);
    const SEG = 20 * 1024 * 1024;
    const off = st.bytesRead || 0;
    if (off >= CAP) return 0;
    const end = Math.min(off + SEG - 1, CAP - 1);
    const rangeHdrs = Object.assign({}, hdrs, { Range: 'bytes=' + off + '-' + end, Accept: '*/*' });
    let sr = null;
    try {
      let streamUrl = st.target + '/emby/Videos/' + encodeURIComponent(st.itemId) + '/stream?MediaSourceId=' + encodeURIComponent(st.msId || st.itemId) + '&Static=false';
      sr = await kaFetch(addApiKey(streamUrl, st.token), { headers: rangeHdrs });
      let got = sr && (sr.status === 200 || sr.status === 206);
      if (!got) {
        streamUrl = st.target + '/emby/Videos/' + encodeURIComponent(st.itemId) + '/stream?MediaSourceId=' + encodeURIComponent(st.msId || st.itemId) + '&Static=true';
        sr = await kaFetch(addApiKey(streamUrl, st.token), { headers: rangeHdrs });
        got = sr && (sr.status === 200 || sr.status === 206);
      }
      if (!got || !sr.body) {
        if (!st.streamWarned) {
          st.streamWarned = true;
          st.steps = st.steps || [];
          st.steps.push({ name: '持续拉流', ok: false, detail: '拉流未就绪(HTTP ' + (sr ? sr.status : '未知') + '),本次仅心跳不产生流量' });
        }
        return 0;
      }
    } catch (e) { return 0; }
    const reader = sr.body.getReader();
    let n = 0;
    try {
      while (n < SEG) {
        let timer = null;
        const r = await Promise.race([reader.read(), new Promise((resolve) => { timer = setTimeout(() => resolve({ timeout: true }), 8000); })]);
        if (timer) clearTimeout(timer);
        if (r.timeout) break;
        if (r.done) break;
        if (r.value) { n += r.value.byteLength; st.bytesRead += r.value.byteLength; }
      }
    } catch (e) {}
    try { await reader.cancel().catch(() => {}); } catch (e) {}
    return n;
  }
  async stopStream() {
    // v3.6.8:分段流在 alarm 内局部,读取结束即关,无需跨事件停
    return;
  }
  // 收尾:Stopped + 1.5s 清 UserData + done + 推进队列
  async finishUp(st, hdrs, url, body, note) {
    let stopOk = false;
    try {
      const r = await kaJson(url('/emby/Sessions/Playing/Stopped'), { method: 'POST', headers: hdrs, body: body(st.endTicks) });
      stopOk = r.status === 200 || r.status === 204;
    } catch (e) {}
    st.steps = st.steps || [];
    st.steps.push({ name: '播放会话停止', ok: stopOk, detail: 'Stopped(' + fmtPos(st.endTicks) + ')' + (note ? ' · ' + note : '') });
    this.saveLive('播放会话停止(' + fmtPos(st.endTicks) + ')', st.steps, 96, st);
    await new Promise(res => setTimeout(res, 1500));
    let cleanOk = false;
    try {
      if (st.userId && st.itemId) {
        const r = await kaJson(url('/emby/Users/' + encodeURIComponent(st.userId) + '/Items/' + encodeURIComponent(st.itemId) + '/UserData'), {
          method: 'POST', headers: hdrs,
          body: JSON.stringify({ Played: false, PlayCount: 0, ResumePositionTicks: 0, PlaybackPositionTicks: 0, PlayedPercentage: 0 })
        });
        cleanOk = r.status === 200 || r.status === 204;
      }
    } catch (e) {}
    st.done = true;
    await this.state.storage.put('job', st);
    // 修复 v3.5.0 bug:完成回调必须传 done=true(此前传 !cleanOk 导致清记录成功后 running 卡 true)
    this.saveLive(cleanOk ? '清除播放记录完成' : '清除播放记录失败', st.steps, 100, st, true);
    // v3.6.3:DO 完成 → 先清掉自己的 running 队列项,再推进下一个
    try { await kaFinishRunning(this.env, st.prefix, stopOk && cleanOk, 'DO 模拟播放完成(' + st.playSec + 's)', { title: st.mediaTitle || '', playSec: st.playSec, startTicks: st.startTicks, endTicks: st.endTicks, streamBytes: st.bytesRead || 0 }, st.qid); } catch (e) {}
    // v3.6.30:DO 完成必须真实落库保活结果(此前从不写 last_ka_result/last_ka_run,导致倒计时不重置、结果不显示)
    try {
      const kaOk = stopOk && cleanOk;
      if (kaOk) {
        // v3.6.68:DO 成功同样重置间隔并写入下次随机计划 ka_next_run([ka_days×50%, ka_days−1] 随机)
        const kaRow = await this.env.DB.prepare('SELECT ka_days FROM routes WHERE prefix = ?').bind(st.prefix).first();
        const nextRun = new Date(Date.now() + kaRandomNextMs(kaRow && kaRow.ka_days)).toISOString();
        await this.env.DB.prepare('UPDATE routes SET last_ka_run = ?, last_ka_result = ?, last_ka_detail = ?, ka_retry_at = ?, ka_fail_count = 0, ka_next_run = ? WHERE prefix = ?')
          .bind(new Date().toISOString(), 'success', 'DO 模拟播放完成(' + st.playSec + 's)', '', nextRun, st.prefix).run();
      } else {
        const retryAt = new Date(Date.now() + (await kaRetryHours(this.env)) * 3600000).toISOString();
        await this.env.DB.prepare('UPDATE routes SET last_ka_result = ?, last_ka_detail = ?, ka_retry_at = ?, ka_fail_count = COALESCE(ka_fail_count, 0) + 1 WHERE prefix = ?')
          .bind('fail', 'DO 模拟播放完成(' + st.playSec + 's)：Stopped/清理记录异常', retryAt, st.prefix).run();
      }
    } catch (e) {}
    try { await maybeAdvanceQueue(this.env); } catch (e) {}
    try { await pushKaNotice(this.env, st.prefix, stopOk && cleanOk, 'DO 模拟播放完成(' + st.playSec + 's,起点 ' + fmtPos(st.startTicks) + (st.streamLimited ? ',拉流达上限' : '') + ')'); } catch (e) {}
    // v3.6.70:收尾完成删除 job,释放 DO 存储(alarm 读到 null 直接返回)
    try { await this.state.storage.delete('job'); } catch (e) {}
  }
  // 被取消时收尾:向 Emby 上报 Stopped 并重置播放记录,避免遗留一个"正在播放"的会话影响之后的保活起播
  async abortJob(st, hdrs) {
    const url = p => addApiKey(st.target + p, st.token);
    const pos = Math.min(st.endTicks || 0, (st.startTicks || 0) + (st.elapsed || 0) * 10000000);
    try {
      await kaJson(url('/emby/Sessions/Playing/Stopped'), { method: 'POST', headers: hdrs, body: JSON.stringify({ ItemId: st.itemId, MediaSourceId: st.msId || st.itemId, PlaySessionId: st.playSessionId, DeviceId: st.deviceId || genUuid(), Client: st.client, Version: st.version, PlayMethod: 'DirectStream', CanSeek: true, IsPaused: false, PositionTicks: pos, PlaybackPositionTicks: pos }) });
    } catch (e) {}
    try {
      if (st.userId && st.itemId) {
        await kaJson(url('/emby/Users/' + encodeURIComponent(st.userId) + '/Items/' + encodeURIComponent(st.itemId) + '/UserData'), { method: 'POST', headers: hdrs, body: JSON.stringify({ Played: false, PlayCount: 0, ResumePositionTicks: 0, PlaybackPositionTicks: 0, PlayedPercentage: 0 }) });
      }
    } catch (e) {}
  }
  async alarm() {
    try {
      const st = await this.state.storage.get('job');
      if (!st || st.done) return;
      const hdrs = { 'X-Emby-Authorization': st.authHdr, 'User-Agent': st.ua, 'Content-Type': 'application/json' };
      // 取消检测:以队列项 ID 为准——自己的队列项已被移除(手动取消/清空/超时清理)即视为被取消。
      // (旧版只看 ka_live:取消后马上重新点保活,ka_live 会被新任务覆盖,旧 DO 察觉不到取消而继续跑完整个时长,
      //  同一节点同时存在两个播放会话,新任务的 DO 起播失败就退回 25 秒兜底模拟)
      let cancelled = false;
      try {
        if (st.qid) {
          const qq = await kaGetQueue(this.env);
          if (!qq.items.some(i => i.id === st.qid)) cancelled = true;
        } else {
          // 兼容升级前已在运行、没有 qid 的旧任务
          const lv = await this.env.DB.prepare("SELECT value FROM app_config WHERE key = 'ka_live'").first();
          if (lv && lv.value) {
            const ls = JSON.parse(lv.value);
            if (ls && !ls.running && ls.cancelled && ls.prefix === st.prefix) cancelled = true;
          }
        }
      } catch (e) {}
      if (cancelled) {
        st.done = true;
        await this.state.storage.put('job', st);
        try { await this.stopStream(); } catch (e) {}
        try { await this.abortJob(st, hdrs); } catch (e) {}
        try { await kaFinishRunning(this.env, st.prefix, false, '已被管理员取消', null, st.qid); } catch (e) {}
        try { await this.state.storage.delete('job'); } catch (e) {}
        try { await maybeAdvanceQueue(this.env); } catch (e) {}
        return;
      }
      const url = p => addApiKey(st.target + p, st.token);
      const body = pos => JSON.stringify({ ItemId: st.itemId, MediaSourceId: st.msId || st.itemId, PlaySessionId: st.playSessionId, DeviceId: st.deviceId || genUuid(), Client: st.client, Version: st.version, PlayMethod: 'DirectStream', CanSeek: true, IsPaused: false, QueueableMediaTypes: ['Video'], PositionTicks: pos, PlaybackPositionTicks: pos });
      // v3.6.0:下载优先——保活中检测到下载立即中断,让位下载
      try {
        if (await kaDlActive(this.env) > 0) {
          await this.stopStream();
          st.done = true;
          await this.state.storage.put('job', st);
          st.steps = st.steps || [];
          st.steps.push({ name: '下载优先', ok: true, detail: '检测到下载行为,中断保活模拟,让位下载伪装观看' });
          this.saveLive('下载优先：中断保活模拟', st.steps, 100, st, true);
          try { await kaFinishRunning(this.env, st.prefix, true, '保活被下载打断', { title: st.mediaTitle || '', playSec: st.elapsed || 0, startTicks: st.startTicks || 0, endTicks: st.endTicks || 0, streamBytes: st.bytesRead || 0 }, st.qid); } catch (e) {}
          try { await maybeAdvanceQueue(this.env); } catch (e) {}
          try { await pushKaNotice(this.env, st.prefix, true, '保活被下载打断(下载优先)'); } catch (e) {}
          return;
        }
      } catch (e) {}
      // 持续拉流:每次 alarm 读一段,模拟真实播放器持续下载(上限 = max(文件35%, 观看所需), ≤1GB; v3.6.69)
      const readB = await this.pullRange(st, hdrs);
      // 心跳
      st.elapsed += 10;
      const pos = Math.min(st.startTicks + st.elapsed * 10000000, st.endTicks);
      try { await kaJson(url('/emby/Sessions/Playing/Progress'), { method: 'POST', headers: hdrs, body: body(pos) }); } catch (e) {}
      const n = Math.max(1, Math.round(st.playSec / 10));
      let liveMsg, pct;
      if (st.streamLimited) {
        st.streamTail += 1;
        liveMsg = '拉流达上限已停流,收尾心跳 ' + st.streamTail + '/3（' + fmtPos(pos) + '）';
        pct = 93 + st.streamTail;
      } else {
        liveMsg = '模拟播放：进度心跳 ' + Math.min(Math.round(st.elapsed / 10), n) + '/' + n + '（' + fmtPos(pos) + '）' + (readB > 0 ? ' · 已拉流 ' + fmtBytes(st.bytesRead) : '');
        pct = 70 + (st.elapsed / st.playSec) * 25;
      }
      this.saveLive(liveMsg, st.steps, pct, st);
      // 拉流达上限 → 停流并进入 3 跳收尾
      if (!st.streamLimited && st.bytesRead >= (st.capBytes || (1024 * 1024 * 1024))) {
        st.streamLimited = true; st.streamTail = 0;
        await this.stopStream();
        st.steps = st.steps || [];
        st.steps.push({ name: '拉流达上限', ok: true, detail: '持续拉流达到上限,停止拉流,再执行 3 次心跳后结束' });
        this.saveLive('拉流达上限,停止拉流', st.steps, 92, st);
        await this.state.storage.put('job', st);
        await this.state.storage.setAlarm(Date.now() + 10000);
        return;
      }
      if (st.streamLimited) {
        if (st.streamTail < 3) {
          await this.state.storage.put('job', st);
          await this.state.storage.setAlarm(Date.now() + 10000);
          return;
        }
        // 3 跳收尾完成 → 正式收尾
        await this.finishUp(st, hdrs, url, body, '拉流上限收尾');
        return;
      }
      if (st.elapsed < st.playSec) {
        await this.state.storage.put('job', st);
        await this.state.storage.setAlarm(Date.now() + 10000);
        return;
      }
      await this.finishUp(st, hdrs, url, body, '');
    } catch (e) {}
  }
  async saveLive(current, stepsArr, p, st, done) {
    try {
      if (!this.env || !this.env.DB) return;
      // v3.6.70:并行保活时,若队列仍有 running 任务(含刚推进的下一个),ka_live 保持 running 显示
      let stillRunning = false;
      try { const q = await kaGetQueue(this.env); stillRunning = q.items.some(i => i.status === 'running' && !(done && (st.qid ? i.id === st.qid : i.prefix === st.prefix))); } catch (e) {}
      this.env.DB.prepare('INSERT OR REPLACE INTO app_config (key, value) VALUES (?, ?)')
        .bind('ka_live', JSON.stringify({ running: !done || stillRunning, prefix: st.prefix || '', current: current || '', steps: stepsArr || [], progress: Math.max(3, Math.min(100, Math.round(p || 3))), mediaTitle: st.mediaTitle || '', updatedAt: Date.now() }))
        .run().catch(() => {});
    } catch (e) {}
  }
}

export default {
    async scheduled(event, env, ctx) {
        // 自动保活：检查所有开启保活的节点，按各自间隔到期执行（每 tick 只跑最先到期的一个）
        if (env.DB && env.KA_ENABLED !== 'off') {
            ctx.waitUntil(checkKeepAliveSchedule(env));
        }
        // 保号超限每日扫描（配了 Cron 时也走）
        if (env.DB) {
            ctx.waitUntil(scanOverdueNotify(env, ctx));
        }
        // 新版本推送通知（Bark / Telegram）
        if (env.DB) {
            ctx.waitUntil(checkUpdateNotify(env));
        }
    },

    async fetch(request, env, ctx) {
        try {
        const url = new URL(request.url);
        const EXPECTED_TOKEN = env.ADMIN_TOKEN;   // 需在 IP 访问控制(管理员逃生)之前初始化,避免 TDZ 异常
        // 自动保活（请求驱动版）：不依赖 Cron，有人访问面板/反代时按各节点间隔自动检查执行
        if (env.DB && ctx && ctx.waitUntil && url.pathname !== '/__client_rtt__') {
            ctx.waitUntil(maybeCheckKeepAlive(env));
        }
        // 保号超限检查：请求时低频触发（6 小时节流），无需 Cron 也能每日推送
        if (env.DB && ctx && ctx.waitUntil && url.pathname !== '/__client_rtt__') {
            ctx.waitUntil(maybeScanOverdue(env));
        }
        // 新版本推送检查：请求时低频触发（6 小时节流）
        if (env.DB && ctx && ctx.waitUntil && url.pathname !== '/__client_rtt__') {
            ctx.waitUntil(maybeCheckUpdate(env));
        }

        // ==========================================
        //  新增：全云厂商 Worker 放置区域接口
        // （本块依赖 ROLE 认证，已放置于认证逻辑之后）
        // ==========================================

        // ==========================================
        // IP 访问控制：面板网页 + 节点链接统一拦截
        // (白名单/黑名单 + IP/CIDR + 国家封锁, 命中 302 跳转)
        // ==========================================
        {
            const IPG_BYPASS = ['/api/tg-webhook', '/catch', '/__client_rtt__', '/api/ipguard', '/api/ipguard/block', '/entry', '/api/entry'];
            if (IPG_BYPASS.indexOf(url.pathname) < 0) {
                const guard = await getIpGuard(env);
                const clientIp = (request.headers.get('CF-Connecting-IP') || '').trim();
                // 最高黑名单:任何模式都拦截(优先于最高白名单);设置跳转则 302,否则显示拉黑页
                const hardBlock = await getIpGuardBlocked(env);
                if (clientIp && hardBlock.ips.length && ipMatchAny(clientIp, hardBlock.ips)) {
                    if (hardBlock.redirect) { const rr = safeRedirectResponse(hardBlock.redirect); if (rr) return rr; }
                    return new Response(IP_BLOCKED_HARD_UI.replace('__IP__', escHtmlStr(clientIp)), { headers: { 'Content-Type': 'text/html;charset=UTF-8' } });
                }
                if (guard.mode !== 'off') {
                    // 最高白名单: /entry 登录成功的 IP 永远放行(黑/白名单模式均例外)
                    const trusted = await getIpGuardTrusted(env);
                    if (trusted.indexOf(clientIp) < 0) {
                        const country = (request.headers.get('CF-IPCountry') || '').trim().toUpperCase();
                        const hit = ipMatchAny(clientIp, guard.ips) || (country && guard.countries.indexOf(country) >= 0);
                        const blocked = guard.mode === 'whitelist' ? !hit : hit;
                        if (blocked) {
                            // 管理员逃生:已登录(admin_token 有效)的管理员请求直接放行,避免误锁自己
                            let adminAuth = false;
                            try { adminAuth = (await getAuthRole(request)) === 'admin'; } catch (e) {}
                            if (!adminAuth) {
                                if (guard.redirect) { const rr2 = safeRedirectResponse(guard.redirect); if (rr2) return rr2; }
                                return new Response(IP_BLOCKED_UI.replace('__IP__', escHtmlStr(clientIp)).replace('__COUNTRY__', escHtmlStr(country || '-')), { headers: { 'Content-Type': 'text/html;charset=UTF-8' } });
                            }
                        }
                    }
                }
            }
        }

        // ==========================================
        //  新增：CF 节点与落地机房探针接口
        // ==========================================
        if (url.pathname === '/api/trace') {
            const cf = request.cf || {};
            let egressColo = '探测中...';
            try {
                // 请求 CF 官方 trace 接口获取落地机房
                const traceRes = await fetch('https://1.1.1.1/cdn-cgi/trace', {
                    headers: { 'User-Agent': 'Mozilla/5.0 (CF-Worker-Trace)' }
                });
                const traceText = await traceRes.text();
                const match = traceText.match(/colo=([A-Z]+)/);
                if (match) egressColo = match[1];
            } catch(e) {
                egressColo = '获取失败';
            }

            return new Response(JSON.stringify({
                success: true,
                entryCountry: cf.country || '未知',
                entryCity: cf.city || '',
                entryColo: cf.colo || '未知',
                egressColo: egressColo
            }), {
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                }
            });
        }

        // ==========================================
        //  新增：客户端 RTT 实时极速探针接口
        // 直接返回 204 无内容，且强制不缓存，确保每次都是真实的物理延迟
        // ==========================================
        if (url.pathname === '/__client_rtt__') {
            return new Response(null, {
                status: 204,
                headers: {
                    "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
                    "Pragma": "no-cache",
                    "Expires": "0",
                    "Access-Control-Allow-Origin": "*"
                }
            });
        }

        // ==========================================
        //  新增：当前域名解析 IP 的下载速度测试
        //  /speedtest              测速页面（浏览器端，测当前域名解析 IP 的下载速度）
        //  /speedtest/data?bytes=N 下载负载端点（同源，走的就是当前域名解析到的 CF IP）
        // ==========================================
        if (url.pathname === '/speedtest' || url.pathname === '/speedtest/') {
            const SPEEDTEST_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>下载测速 · 反代面板</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;background:#0f1117;color:#e6e8ee;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
  .card{background:#161a24;border:1px solid #2a3040;border-radius:18px;padding:28px;width:100%;max-width:560px;box-shadow:0 12px 40px rgba(0,0,0,.4)}
  h1{font-size:20px;margin-bottom:6px}
  .sub{color:#8a91a5;font-size:13px;margin-bottom:20px}
  .row{display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid #232938;font-size:14px;gap:16px}
  .row:last-of-type{border-bottom:none}
  .k{color:#8a91a5;white-space:nowrap}
  .v{font-weight:600;word-break:break-all;text-align:right}
  .ip{color:#5aa2ff}
  .speed{font-size:42px;font-weight:800;color:#4fd08a;text-align:center;margin:18px 0 6px;line-height:1}
  .speed small{font-size:14px;color:#8a91a5;font-weight:500}
  .bar{height:10px;background:#232938;border-radius:6px;overflow:hidden;margin:8px 0 16px}
  .bar i{display:block;height:100%;width:0;background:linear-gradient(90deg,#4fd08a,#23a6d8);transition:width .4s ease}
  .opts{display:flex;gap:10px;margin-bottom:12px}
  select,button.ghost{flex:1;padding:11px;border:1px solid #2a3040;border-radius:10px;background:#161a24;color:#e6e8ee;font-size:13px}
  button.go{width:100%;padding:13px;border:none;border-radius:10px;cursor:pointer;font-size:15px;font-weight:700;background:#2563eb;color:#fff;transition:.2s}
  button.go:hover{background:#1d4ed8}
  button.go:disabled{opacity:.5;cursor:not-allowed}
  .meta{text-align:center;font-size:12px;color:#8a91a5;margin-top:12px;min-height:16px}
  .note{font-size:12px;color:#6b7280;margin-top:16px;line-height:1.7;border-top:1px dashed #2a3040;padding-top:12px}
  a.back{display:inline-flex;align-items:center;gap:6px;padding:7px 15px;border-radius:999px;background:rgba(0,180,255,.1);border:1px solid rgba(0,180,255,.28);color:#5aa2ff;font-size:13px;font-weight:600;text-decoration:none;margin-bottom:14px;transition:.2s}
  a.back:hover{background:rgba(0,180,255,.2)}
</style>
</head>
<body>
<div class="card">
  <a class="back" href="/">&#8592; 返回面板</a>
  <h1>&#128339; 当前域名下载测速</h1>
  <div class="sub">浏览器直连当前域名，测其解析到的 CF IP 的下载速度</div>
  <div class="row"><span class="k">测试域名</span><span class="v" id="host">…</span></div>
  <div class="row"><span class="k">解析到的 IP</span><span class="v ip" id="ips">查询中…</span></div>
  <div class="speed"><span id="num">--</span> <small id="unit">Mbps</small></div>
  <div class="bar"><i id="barfill"></i></div>
  <div class="opts">
    <select id="size">
      <option value="10485760">负载 10 MB</option>
      <option value="20971520">负载 20 MB</option>
      <option value="52428800" selected>负载 50 MB</option>
    </select>
    <button class="ghost" id="runs">测 3 次取最优</button>
  </div>
  <button class="go" id="go">开始测速</button>
  <div class="meta" id="meta"></div>
  <div class="note">方式：从本域名直接下载测试负载，即走当前域名解析到的 CF 边缘 IP，多次取最优值。
若 IP 显示“查询失败”，多为 DoH 被网络环境限制，不影响下载测速结果。</div>
</div>
<script>
(function(){
  var host=location.host;
  document.getElementById('host').textContent=host;
  var ipsEl=document.getElementById('ips');
  var sizeSel=document.getElementById('size');
  var goBtn=document.getElementById('go');
  var numEl=document.getElementById('num');
  var unitEl=document.getElementById('unit');
  var barEl=document.getElementById('barfill');
  var metaEl=document.getElementById('meta');
  var RUNS=3;

  function resolveIps(){
    try{
      fetch('https://cloudflare-dns.com/dns-query?name='+encodeURIComponent(host)+'&type=A',{headers:{accept:'application/dns-json'}})
        .then(function(r){return r.json();})
        .then(function(d){
          var arr=(d&&d.Answer||[]).map(function(a){return a.data;});
          ipsEl.textContent=arr.length?arr.join('  '):'查询失败';
        })
        .catch(function(){ipsEl.textContent='查询失败（DoH 受限）';});
    }catch(e){ipsEl.textContent='查询失败';}
  }
  resolveIps();

  async function runOnce(bytes){
    var url='/speedtest/data?bytes='+bytes+'&t='+Date.now();
    var t0=performance.now();
    await fetch(url,{cache:'no-store'}).then(function(r){return r.arrayBuffer();});
    var ms=performance.now()-t0;
    return bytes*8/(ms/1000);
  }

  goBtn.addEventListener('click',async function(){
    var bytes=parseInt(sizeSel.value,10);
    goBtn.disabled=true;goBtn.textContent='测速中…';numEl.textContent='--';barEl.style.width='0';
    var best=0;
    for(var i=0;i<RUNS;i++){
      try{
        var bps=await runOnce(bytes);
        if(bps>best)best=bps;
        metaEl.textContent='第 '+(i+1)+'/'+RUNS+' 次 · 当前 '+(bps/1048576).toFixed(2)+' Mbps';
      }catch(e){metaEl.textContent='第 '+(i+1)+' 次失败：'+e.message;break;}
    }
    if(best>0){
      numEl.textContent=(best/1048576).toFixed(2);
      unitEl.textContent='Mbps · '+(best/1048576/8).toFixed(2)+' MB/s';
      barEl.style.width=Math.min(100,best/1000*100)+'%';
    }
    goBtn.disabled=false;goBtn.textContent='重新测速';
  });
})();
</script>
</body>
</html>`;
            return new Response(SPEEDTEST_HTML, { headers: { "Content-Type": "text/html;charset=UTF-8", "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" } });
        }

        if (url.pathname === '/speedtest/data') {
            const bytes = Math.min(parseInt(url.searchParams.get('bytes') || '10485760', 10) || 10485760, 52428800); // 上限 50MB
            const CHUNK = 1024 * 1024;
            let sent = 0;
            const stream = new ReadableStream({
                pull(controller) {
                    if (sent * CHUNK >= bytes) { controller.close(); return; }
                    const n = Math.min(CHUNK, bytes - sent * CHUNK);
                    controller.enqueue(new Uint8Array(n));
                    sent++;
                }
            });
            return new Response(stream, {
                headers: {
                    "Content-Type": "application/octet-stream",
                    "Content-Length": String(bytes),
                    "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
                    "Pragma": "no-cache",
                    "Expires": "0"
                }
            });
        }

        // Telegram Webhook 拦截
        if (url.pathname === '/api/tg-webhook' && request.method === 'POST') {
            try {
                // 配置了 TG_WEBHOOK_SECRET 时(setWebhook 的 secret_token),必须校验 Telegram 带来的请求头
                if (env.TG_WEBHOOK_SECRET && !timingSafeEq(request.headers.get('X-Telegram-Bot-Api-Secret-Token') || '', env.TG_WEBHOOK_SECRET)) {
                    return new Response('Forbidden', { status: 403 });
                }
                const body = await request.json();
                if (body.message && body.message.text === '/stats') {
                    if (env.DB && env.TG_BOT_TOKEN) {
                        // 只向已配置的通知聊天发送统计,忽略任意第三方伪造的 chat id
                        const tgCfg = await getNotifyCfg(env);
                        const allowedChat = String(tgCfg.tgChatId || env.TG_CHAT_ID || '').trim();
                        const reqChat = body.message.chat && body.message.chat.id;
                        if (allowedChat && reqChat !== undefined && String(reqChat) === allowedChat) {
                            ctx.waitUntil(sendTgStats(env, reqChat));
                        }
                    }
                }
                return new Response("OK");
            } catch(e) { return new Response("OK"); }
        }

        if (request.method === "OPTIONS") {
            return new Response(null, { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS", "Access-Control-Allow-Headers": "*", "Access-Control-Max-Age": "86400" } });
        }

        // ============ 反代 Token 门禁（D1 存储） ============
        // 配置存 app_config；来访记录存 proxy_hits 表（不占用 KV 免费额度）
        async function getProxyToken(env) {
            if (!env.DB) return null;
            try {
                return await memoStale('proxy_token', 30000, async () => {
                    await ensureAppConfig(env);
                    const row = await env.DB.prepare("SELECT value FROM app_config WHERE key = 'proxy_token'").first();
                    if (!row || !row.value) return null;
                    return JSON.parse(row.value);
                });
            } catch (e) { return null; }
        }
        function proxyTokenPrefix(pt) {
            return (pt && pt.enabled && pt.key) ? pt.key + '/' : '';
        }
        async function recordProxyHit(env, request, path) {
            if (!env.DB) return;
            try {
                const ip = request.headers.get('cf-connecting-ip') || request.headers.get('x-real-ip') || (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'Unknown';
                const ua = (request.headers.get('User-Agent') || '').slice(0, 200);
                const ts = Date.now();
                const p = String(path || '').slice(0, 200);
                await env.DB.prepare('CREATE TABLE IF NOT EXISTS proxy_hits (id INTEGER PRIMARY KEY AUTOINCREMENT, ip TEXT, path TEXT, ua TEXT, ts INTEGER, times INTEGER)').run();
                const exist = await env.DB.prepare('SELECT id, times FROM proxy_hits WHERE ip = ? AND path = ? ORDER BY id DESC LIMIT 1').bind(ip, p).first();
                if (exist) {
                    await env.DB.prepare('UPDATE proxy_hits SET times = ?, ts = ? WHERE id = ?').bind((exist.times || 1) + 1, ts, exist.id).run();
                } else {
                    await env.DB.prepare('INSERT INTO proxy_hits (ip, path, ua, ts, times) VALUES (?, ?, ?, ?, 1)').bind(ip, p, ua, ts).run();
                }
            } catch (e) {}
        }
        function catchPageHtml(ip, ua) {
            const esc = s => String(s == null ? '' : s).replace(/[<>&"']/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'}[c]));
            return `<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Oops</title><style>
        body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:radial-gradient(ellipse at top,#0f0c29,#302b63,#24243e);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif;color:#fff}
        .box{text-align:center;padding:48px;border:1px solid rgba(255,255,255,.15);border-radius:20px;background:rgba(255,255,255,.05);backdrop-filter:blur(8px);max-width:90vw}
        h1{font-size:34px;margin:0 0 12px;letter-spacing:2px}
        .sub{font-size:14px;color:#a8b2d1;margin-bottom:24px}
        .ip{font-size:18px;font-weight:700;color:#ffd700;word-break:break-all}
        .meta{font-size:12px;color:#7f8bb3;margin-top:16px;word-break:break-all}
      </style></head><body><div class="box">
        <h1>宝贝抓到你了 👋</h1>
        <div class="sub">你的来访信息已被记录</div>
        <div class="ip">${esc(ip)}</div>
        <div class="meta">UA: ${esc(ua).slice(0,120)}</div>
      </div></body></html>`;
        }
        if (url.pathname === '/catch') {
            const ip = request.headers.get('cf-connecting-ip') || request.headers.get('x-real-ip') || (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'Unknown';
            return new Response(catchPageHtml(ip, request.headers.get('User-Agent') || ''), { headers: { 'Content-Type': 'text/html;charset=UTF-8', 'Cache-Control': 'no-store' } });
        }

        if (!EXPECTED_TOKEN) return new Response("请在 Worker 变量中配置 ADMIN_TOKEN", { status: 500 });

        function getCookie(req, name) {
            const cookieString = req.headers.get("Cookie");
            if (!cookieString) return null;
            const match = cookieString.match(new RegExp('(^| )' + name + '=([^;]+)'));
            if (match) { try { return decodeURIComponent(match[2]); } catch(e) { return match[2]; } }
            return null;
        }

        // 三档认证：env.ADMIN_TOKEN(永不失效) > 网页修改的管理员密码 > 订阅者密码(只读)
        // 登录后下发签名会话 cookie(HttpOnly):s1.<role>.<exp>.<密码指纹>.<HMAC>,cookie 里不再保存明文密码。
        // 指纹随密码/订阅者变化:改密码或删除订阅者后,对应会话自动失效。
        const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;
        async function credFp(cred) { return (await sha256Hex('fp:' + cred)).slice(0, 16); }
        async function loadAuthFps() {
            const envFp = await credFp(EXPECTED_TOKEN);
            if (!env.DB) return { adminFps: [envFp], subFps: [] };
            try {
                return await memoStale('auth_fps', 15000, async () => {
                    await ensureAppConfig(env);
                    const adminFps = [envFp]; const subFps = [];
                    const rows = await env.DB.prepare("SELECT key, value FROM app_config WHERE key IN ('admin_pass','subscribers')").all();
                    for (const r of (rows.results || [])) {
                        if (r.key === 'admin_pass' && r.value) adminFps.push(await credFp(r.value));
                        if (r.key === 'subscribers' && r.value) {
                            try { const l = JSON.parse(r.value); if (Array.isArray(l)) for (const p of l) subFps.push(await credFp(String(p))); } catch (e) {}
                        }
                    }
                    return { adminFps, subFps };
                });
            } catch (e) { return { adminFps: [envFp], subFps: [] }; }
        }
        async function issueSession(role, cred) {
            const base = 's1.' + role + '.' + (Date.now() + SESSION_TTL_MS) + '.' + (await credFp(cred));
            return base + '.' + (await hmacHex(EXPECTED_TOKEN, base));
        }
        function sessionCookie(value, maxAge) {
            return 'admin_token=' + value + '; Path=/; Max-Age=' + maxAge + '; HttpOnly; SameSite=Lax' + (url.protocol === 'https:' ? '; Secure' : '');
        }
        // 校验登录密码,返回 { role, cred } 或 null
        async function verifyCredential(pass, adminOnly) {
            if (!pass) return null;
            if (timingSafeEq(pass, EXPECTED_TOKEN)) return { role: 'admin', cred: pass };
            if (!env.DB) return null;
            try {
                await ensureAppConfig(env);
                const rows = await env.DB.prepare("SELECT key, value FROM app_config WHERE key IN ('admin_pass','subscribers')").all();
                let subList = [];
                for (const r of (rows.results || [])) {
                    if (r.key === 'admin_pass' && r.value && timingSafeEq(pass, r.value)) return { role: 'admin', cred: r.value };
                    if (r.key === 'subscribers' && r.value) { try { const l = JSON.parse(r.value); if (Array.isArray(l)) subList = l; } catch (e) {} }
                }
                if (!adminOnly) { for (const p of subList) { if (timingSafeEq(pass, String(p))) return { role: 'sub', cred: String(p) }; } }
            } catch (e) {}
            return null;
        }
        async function getAuthRole(req) {
            const token = getCookie(req, 'admin_token');
            if (!token || token.indexOf('s1.') !== 0) return null;
            const parts = token.split('.');
            if (parts.length !== 5) return null;
            const role = parts[1]; const exp = parseInt(parts[2], 10); const fp = parts[3];
            if ((role !== 'admin' && role !== 'sub') || !exp || exp < Date.now()) return null;
            const base = parts.slice(0, 4).join('.');
            if (!timingSafeEq(await hmacHex(EXPECTED_TOKEN, base), parts[4])) return null;
            const matchFps = (f) => (role === 'admin' && f.adminFps.indexOf(fp) >= 0) ? 'admin' : ((role === 'sub' && f.subFps.indexOf(fp) >= 0) ? 'sub' : null);
            let hitRole = matchFps(await loadAuthFps());
            if (!hitRole) {
                // 缓存可能滞后(刚新增订阅者/刚改密码):签名有效但指纹未命中时,强制刷新一次再判定
                memoDel('auth_fps');
                hitRole = matchFps(await loadAuthFps());
            }
            return hitRole;
        }

        const isPanelOrApi = url.pathname === '/' || url.pathname.startsWith('/api/');
        let ROLE = null;
        if (isPanelOrApi && url.pathname !== '/api/tg-webhook' && url.pathname !== '/api/entry' && url.pathname !== '/api/login' && url.pathname !== '/api/logout') {
            ROLE = await getAuthRole(request);
            if (!ROLE) {
                if (url.pathname === '/') {
                    const lg = await getLogo(env);
                    const loginHtml = (lg && lg.value) ? LOGIN_UI.split(EMBY_LOGO).join(lg.value) : LOGIN_UI;
                    return new Response(loginHtml, { headers: { "Content-Type": "text/html;charset=UTF-8" } });
                }
                else return new Response('Unauthorized', { status: 401 });
            }
        }

        // 跨站写请求防护:带 Origin 的非 GET 面板请求,Origin 必须与当前域名一致
        if (ROLE && request.method !== 'GET' && request.method !== 'HEAD' && request.method !== 'OPTIONS') {
            memoDelPrefix('route:');   // 后台有写操作 → 清空节点配置缓存
            memoDel('auth_fps');       // 管理员密码/订阅者可能变化
            const reqOrigin = request.headers.get('Origin');
            if (reqOrigin) {
                let sameOrigin = false;
                try { sameOrigin = new URL(reqOrigin).host === url.host; } catch (e) {}
                if (!sameOrigin) return new Response('Forbidden (cross-origin)', { status: 403 });
            }
        }

        if (url.pathname === '/entry' && request.method === 'GET') {
            return new Response(ENTRY_UI, { headers: { "Content-Type": "text/html;charset=UTF-8" } });
        }
        // 面板登录:校验密码后下发 HttpOnly 签名会话 cookie(带失败次数限制)
        if (url.pathname === '/api/login' && request.method === 'POST') {
            const loginIp = (request.headers.get('CF-Connecting-IP') || '').trim();
            if (await authIsBlocked(env, loginIp)) return Response.json({ success: false, error: '尝试次数过多,请 10 分钟后再试' }, { status: 429 });
            try {
                const body = await request.json();
                const cred = await verifyCredential(String(body.pass || '').trim(), false);
                if (!cred) { await authRecordFail(env, loginIp); return Response.json({ success: false, error: '密钥错误' }, { status: 401 }); }
                return new Response(JSON.stringify({ success: true, role: cred.role }), { headers: { 'Content-Type': 'application/json', 'Set-Cookie': sessionCookie(await issueSession(cred.role, cred.cred), 2592000) } });
            } catch (e) { return Response.json({ success: false, error: '请求无效' }, { status: 400 }); }
        }
        if (url.pathname === '/api/logout' && request.method === 'POST') {
            return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json', 'Set-Cookie': sessionCookie('', 0) } });
        }
        // 逃生登录接口:只认管理员密码(ADMIN_TOKEN / 网页设置的 admin_pass),不受 token 模式影响
        if (url.pathname === '/api/entry' && request.method === 'POST') {
            const entryIp = (request.headers.get('CF-Connecting-IP') || '').trim();
            if (await authIsBlocked(env, entryIp)) return Response.json({ success: false, error: '尝试次数过多,请 10 分钟后再试' }, { status: 429 });
            try {
                const body = await request.json();
                const cred = await verifyCredential(String(body.pass || ''), true);
                if (cred) {
                    const clientIp = entryIp;
                    if (clientIp) {
                        // 逃生成功:先解除最高黑名单,再加入最高白名单(黑名单优先于白名单,必须两步都做)
                        await removeIpGuardBlocked(env, clientIp);
                        await addIpGuardTrusted(env, clientIp);
                    }
                    return new Response(JSON.stringify({ success: true, currentIp: clientIp }), { headers: { 'Content-Type': 'application/json', 'Set-Cookie': sessionCookie(await issueSession('admin', cred.cred), 2592000) } });
                }
                await authRecordFail(env, entryIp);
                return Response.json({ success: false, error: '密码错误' });
            } catch (e) { return Response.json({ success: false, error: '请求无效' }); }
        }
        if (url.pathname === '/') {
            const lg2 = await getLogo(env);
            const uiHtml = (lg2 && lg2.value) ? HTML_UI.split(EMBY_LOGO).join(lg2.value) : HTML_UI;
            return new Response(uiHtml, { headers: { "Content-Type": "text/html;charset=UTF-8" } });
        }

        // ==========================================
        // 2.2 角色 / 账户 / 订阅者管理接口
        // ==========================================
        // 全云厂商 Worker 放置区域接口（依赖 ROLE 认证）
        if (url.pathname === '/api/placement' && request.method === 'POST') {
            if (ROLE !== 'admin') return new Response('Forbidden', { status: 403 });
            try {
                const body = await request.json();
                const placementData = body.placement;

                if (!env.CF_API_TOKEN || !env.CF_ACCOUNT_ID || !env.CF_WORKER_NAME) {
                    return new Response(JSON.stringify({ success: false, msg: '后台变量未配置全！请检查 CF_API_TOKEN, CF_ACCOUNT_ID, CF_WORKER_NAME' }), { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }});
                }

                const formData = new FormData();
                formData.append('settings', new Blob([JSON.stringify({ placement: placementData })], { type: 'application/json' }));

                const cfUrl = `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/workers/scripts/${env.CF_WORKER_NAME}/settings`;
                const cfRes = await fetch(cfUrl, {
                    method: 'PATCH',
                    headers: { 'Authorization': `Bearer ${env.CF_API_TOKEN}` },
                    body: formData
                });

                const cfData = await cfRes.json();
                if (cfData.success) {
                    return new Response(JSON.stringify({ success: true, msg: '部署区域修改成功！' }), { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }});
                } else {
                    return new Response(JSON.stringify({ success: false, msg: 'CF报错: ' + (cfData.errors[0]?.message || '未知错误') }), { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }});
                }
            } catch(e) {
                return new Response(JSON.stringify({ success: false, msg: e.message }), { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }});
            }
        }

        if (url.pathname === '/api/me' && request.method === 'GET') {
            return Response.json({ success: true, role: ROLE });
        }

        // 版本信息（登录可见）：当前版本 + 更新提醒开关
        if (url.pathname === '/api/version' && request.method === 'GET') {
            let updateNotify = true;
            try {
                if (env.DB) {
                    const row = await env.DB.prepare("SELECT value FROM app_config WHERE key = 'update_notify'").first();
                    if (row && row.value !== null && row.value !== undefined) updateNotify = String(row.value) !== '0';
                }
            } catch (e) {}
            return Response.json({ success: true, version: CURRENT_VERSION, updateNotify });
        }

        // 保号通知设置（登录可见，脱敏返回）
        if (url.pathname === '/api/account/notify' && request.method === 'GET') {
            if (ROLE !== 'admin') return new Response('Forbidden', { status: 403 });
            let cfg = {};
            try {
                if (env.DB) {
                    const row = await env.DB.prepare("SELECT value FROM app_config WHERE key = 'notify_settings'").first();
                    if (row && row.value) cfg = JSON.parse(row.value);
                }
            } catch (e) {}
            return Response.json({ success: true, barkKey: cfg.barkKey ? '********' : '', barkLevel: cfg.barkLevel || 'active', barkServer: cfg.barkServer || 'https://api.day.app', barkNotify: cfg.barkNotify !== false, tgToken: cfg.tgToken ? '********' : '', tgChatId: cfg.tgChatId || '', tgNotify: cfg.tgNotify !== false, kaNotifyMode: cfg.kaNotifyMode || 'all' });
        }

        // 测试通知（bark / tg）
        if (url.pathname === '/api/test-notify' && request.method === 'POST') {
            if (ROLE !== 'admin') return new Response('Forbidden', { status: 403 });
            try {
                const body = await request.json();
                const type = String(body.type || 'bark');
                const cfg = await getNotifyCfg(env);
                if (type === 'bark') {
                    if (!cfg.barkKey) return Response.json({ success: false, error: '未配置 Bark Key' });
                    const ok = await sendBarkN(cfg, 'Emby 反代面板', '保号通知测试成功 ✅');
                    return Response.json({ success: ok, error: ok ? '' : 'Bark 发送失败，请检查 Key/服务地址' });
                }
                if (type === 'tg') {
                    if (!cfg.tgToken || !cfg.tgChatId) return Response.json({ success: false, error: '未配置 TG Bot Token / Chat ID' });
                    const ok = await sendTgN(cfg, '保号通知测试成功 ✅');
                    return Response.json({ success: ok, error: ok ? '' : 'TG 发送失败，请检查 Token / Chat ID' });
                }
                return Response.json({ success: false, error: '未知类型' });
            } catch (e) { return Response.json({ success: false, error: e.message }); }
        }

        if (url.pathname === '/api/ipguard' && request.method === 'GET') {
            if (ROLE !== 'admin') return new Response('Forbidden', { status: 403 });
            try {
                const cfg = await getIpGuard(env);
                const currentIp = (request.headers.get('CF-Connecting-IP') || '').trim();
                const country = (request.headers.get('CF-IPCountry') || '').trim().toUpperCase();
                return Response.json({ success: true, mode: cfg.mode, ips: cfg.ips, countries: cfg.countries, redirect: cfg.redirect, currentIp: currentIp, currentCountry: country, trusted: await getIpGuardTrusted(env), blocked: await getIpGuardBlocked(env) });
            } catch (e) { return Response.json({ success: false, error: String(e) }); }
        }
        if (url.pathname === '/api/ipguard' && request.method === 'POST') {
            if (ROLE !== 'admin') return new Response('Forbidden', { status: 403 });
            try {
                const body = await request.json();
                const mode = body.mode === 'whitelist' || body.mode === 'blacklist' ? body.mode : 'off';
                const ips = Array.isArray(body.ips) ? body.ips.map(x => String(x).trim()).filter(Boolean) : [];
                const countries = Array.isArray(body.countries) ? body.countries.flatMap(x => String(x).split(/[\n,，、\s]+/).map(y => y.trim().toUpperCase()).filter(Boolean)) : [];
                const redirect = String(body.redirect || '').trim();
                const trusted = Array.isArray(body.trusted) ? body.trusted.map(x => String(x).trim()).filter(Boolean) : undefined;
                const blockedIps = Array.isArray(body.blockedIps) ? body.blockedIps.map(x => String(x).trim()).filter(Boolean) : undefined;
                const blockedRedirect = body.blockedRedirect !== undefined ? String(body.blockedRedirect || '').trim() : undefined;
                const val = JSON.stringify({ mode, ips, countries, redirect });
                await env.DB.prepare('INSERT INTO app_config(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=?').bind('ipguard', val, val).run();
                memoDel('ipg_main');
                if (trusted) await saveIpGuardTrusted(env, trusted);
                if (blockedIps) await saveIpGuardBlocked(env, blockedIps, blockedRedirect !== undefined ? blockedRedirect : (await getIpGuardBlocked(env)).redirect);
                const blk = await getIpGuardBlocked(env);
                return Response.json({ success: true, mode, ips, countries, redirect, trusted: trusted || [], blocked: blk });
            } catch (e) { return Response.json({ success: false, error: String(e) }); }
        }
        // 一键封禁(仅管理员):把 IP 加入最高黑名单,可选带 302 跳转链接
        if (url.pathname === '/api/ipguard/block' && request.method === 'POST') {
            if (ROLE !== 'admin') return new Response('Forbidden', { status: 403 });
            try {
                const body = await request.json();
                const ip = String(body.ip || '').trim();
                if (!ip) return Response.json({ success: false, error: '缺少 IP' });
                const redirect = body.redirect !== undefined ? String(body.redirect || '').trim() : undefined;
                await addIpGuardBlocked(env, ip, redirect);
                return Response.json({ success: true, blocked: await getIpGuardBlocked(env) });
            } catch (e) { return Response.json({ success: false, error: String(e) }); }
        }
        // 公告(登录可见;仅管理员设置/清除)
        if (url.pathname === '/api/notice' && request.method === 'GET') {
            if (!ROLE) return new Response('Unauthorized', { status: 401 });
            try {
                const r = await env.DB.prepare("SELECT value FROM app_config WHERE key = 'notice'").first();
                const val = (r && r.value) ? (() => { try { return JSON.parse(r.value); } catch (e) { return { text: r.value }; } })() : null;
                return Response.json({ success: true, text: val ? val.text || '' : '', updated_at: val ? val.updated_at || '' : '' });
            } catch (e) { return Response.json({ success: false, error: String(e) }); }
        }
        if (url.pathname === '/api/notice' && request.method === 'POST') {
            if (ROLE !== 'admin') return new Response('Forbidden', { status: 403 });
            try {
                const body = await request.json();
                const text = String(body.text || '').trim();
                const val = JSON.stringify({ text, updated_at: new Date().toISOString().slice(0, 19).replace('T', ' ') });
                if (text) await env.DB.prepare('INSERT INTO app_config(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=?').bind('notice', val, val).run();
                else await env.DB.prepare('DELETE FROM app_config WHERE key = ?').bind('notice').run();
                return Response.json({ success: true });
            } catch (e) { return Response.json({ success: false, error: String(e) }); }
        }
        if (url.pathname === '/api/account' && request.method === 'POST') {
            if (ROLE !== 'admin') return new Response('Forbidden', { status: 403 });
            try {
                const data = await request.json();
                if (data.logo !== undefined) {
                    if (!env.DB) return Response.json({ success: false, error: 'D1 未绑定：请在 Worker 设置里绑定名为 DB 的 D1 数据库' });
                    await ensureAppConfig(env);
                    const l = data.logo;
                    const type = (l && (l.type === 'url' || l.type === 'data')) ? l.type : '';
                    const value = (l && l.value !== undefined && l.value !== null) ? String(l.value).trim() : '';
                    if (!type || !value) {
                        await env.DB.prepare('DELETE FROM app_config WHERE key = ?').bind('logo').run();
                        memoDel('logo_cfg');
                        return Response.json({ success: true, logo: null });
                    }
                    if (type === 'url') {
                        if (!/^https?:\/\//i.test(value)) return Response.json({ success: false, error: 'URL 需以 http(s):// 开头' });
                        if (value.length > 2000) return Response.json({ success: false, error: 'URL 过长（最多 2000 字符）' });
                        if (!isSafeLogoValue(value)) return Response.json({ success: false, error: 'URL 含有不允许的字符（空格、引号、尖括号等）' });
                    } else {
                        if (!/^data:image\/(png|jpeg|jpg|webp|gif);base64,/i.test(value)) return Response.json({ success: false, error: '仅支持图片（png/jpg/webp/gif）的 base64 上传' });
                        if (value.length > 600000) return Response.json({ success: false, error: '图片过大（>450KB），请换更小的图片' });
                        if (!isSafeLogoValue(value)) return Response.json({ success: false, error: '图片数据格式不正确' });
                    }
                    await env.DB.prepare('INSERT OR REPLACE INTO app_config (key, value) VALUES (?, ?)').bind('logo', JSON.stringify({ type, value })).run();
                    memoDel('logo_cfg');
                    return Response.json({ success: true });
                }
                if (data.kaGlobalProfile !== undefined) {
                    if (!env.DB) return Response.json({ success: false, error: 'D1 未绑定：请在 Worker 设置里绑定名为 DB 的 D1 数据库' });
                    await ensureAppConfig(env);
                    const g = data.kaGlobalProfile || {};
                    await env.DB.prepare('INSERT OR REPLACE INTO app_config (key, value) VALUES (?, ?)').bind('ka_global_profile', JSON.stringify({
                        client: String(g.client || '').trim(),
                        version: String(g.version || '').trim(),
                        device: String(g.device || '').trim(),
                        deviceId: String(g.deviceId || '').trim(),
                        ua: String(g.ua || '').trim()
                    })).run();
                    // v3.6.70:保活失败重试间隔随全局身份一起保存(0/空 = 恢复默认 4h)
                    if (data.kaRetryHours !== undefined) {
                        const rh = parseFloat(data.kaRetryHours);
                        if (rh > 0) await env.DB.prepare('INSERT OR REPLACE INTO app_config (key, value) VALUES (?, ?)').bind('ka_retry_hours', String(rh)).run();
                        else await env.DB.prepare('DELETE FROM app_config WHERE key = ?').bind('ka_retry_hours').run();
                    }
                    return Response.json({ success: true });
                }
                if (data.proxyToken !== undefined) {
                    const pt = data.proxyToken;
                    const enabled = !!pt.enabled;
                    const key = String(pt.key || '').trim();
                    if (enabled && !/^[A-Za-z0-9]{3,32}$/.test(key)) return Response.json({ success: false, error: '密钥需 3-32 位字母数字' });
                    if (enabled && isReservedSuffix(key)) return Response.json({ success: false, error: '该密钥已被系统保留占用（如 entry），请更换' });
                    if (!env.DB) return Response.json({ success: false, error: 'D1 未绑定：请在 Worker 设置里绑定名为 DB 的 D1 数据库' });
                    await ensureAppConfig(env);
                    await env.DB.prepare('INSERT OR REPLACE INTO app_config (key, value) VALUES (?, ?)').bind('proxy_token', JSON.stringify({ enabled, key })).run();
                    memoDel('proxy_token');
                    return Response.json({ success: true });
                }
                if (data.notify !== undefined) {
                    const n = data.notify;
                    if (!env.DB) return Response.json({ success: false, error: 'D1 未绑定：请在 Worker 设置里绑定名为 DB 的 D1 数据库' });
                    await ensureAppConfig(env);
                    const oldRow = await env.DB.prepare("SELECT value FROM app_config WHERE key = 'notify_settings'").first();
                    let old = {};
                    try { if (oldRow && oldRow.value) old = JSON.parse(oldRow.value); } catch (e) {}
                    const cfg = {
                        barkKey: (n.barkKey && n.barkKey !== '********') ? String(n.barkKey).trim() : (old.barkKey || ''),
                        barkLevel: ['critical', 'active', 'timeSensitive', 'passive'].includes(n.barkLevel) ? n.barkLevel : (old.barkLevel || 'active'),
                        barkServer: (n.barkServer && n.barkServer !== 'https://api.day.app') ? String(n.barkServer).trim().replace(/\/+$/, '') : (old.barkServer || 'https://api.day.app'),
                        barkNotify: n.barkNotify !== false,
                        tgToken: (n.tgToken && n.tgToken !== '********') ? String(n.tgToken).trim() : (old.tgToken || ''),
                        tgChatId: n.tgChatId ? String(n.tgChatId).trim() : (old.tgChatId || ''),
                        tgNotify: n.tgNotify !== false,
                        // v3.6.70:保活结果通知模式(全部推送/仅失败推送)
                        kaNotifyMode: n.kaNotifyMode === 'fail' ? 'fail' : (old.kaNotifyMode || 'all')
                    };
                    await env.DB.prepare('INSERT OR REPLACE INTO app_config (key, value) VALUES (?, ?)').bind('notify_settings', JSON.stringify(cfg)).run();
                    return Response.json({ success: true });
                }
                if (data.bareProxy !== undefined) {
                    if (!env.DB) return Response.json({ success: false, error: 'D1 未绑定：请在 Worker 设置里绑定名为 DB 的 D1 数据库' });
                    await ensureAppConfig(env);
                    await env.DB.prepare('INSERT OR REPLACE INTO app_config (key, value) VALUES (?, ?)').bind('bare_proxy_enabled', data.bareProxy ? '1' : '0').run();
                    memoDel('bare_proxy');
                    return Response.json({ success: true });
                }
                if (data.updateNotify !== undefined) {
                    if (!env.DB) return Response.json({ success: false, error: 'D1 未绑定：请在 Worker 设置里绑定名为 DB 的 D1 数据库' });
                    await ensureAppConfig(env);
                    await env.DB.prepare('INSERT OR REPLACE INTO app_config (key, value) VALUES (?, ?)').bind('update_notify', data.updateNotify ? '1' : '0').run();
                    return Response.json({ success: true });
                }
                const pw = String(data.password || '').trim();
                if (pw.length < 4) return Response.json({ success: false, error: '密码至少 4 位' });
                await ensureAppConfig(env);
                await env.DB.prepare('INSERT OR REPLACE INTO app_config (key, value) VALUES (?, ?)').bind('admin_pass', pw).run();
                return Response.json({ success: true });
            } catch (e) {
                return Response.json({ success: false, error: e.message });
            }
        }

        // 反代 Token 状态（登录可见；未登录 401）
        if (url.pathname === '/api/ka-global-profile' && request.method === 'GET') {
            const gp = await getKaGlobalProfile(env);
            // v3.6.70:顺带返回保活失败重试间隔(小时),前端回填
            let retryHours = 4;
            try { const rw = await env.DB.prepare("SELECT value FROM app_config WHERE key = 'ka_retry_hours'").first(); if (rw && rw.value) retryHours = parseFloat(rw.value) || 4; } catch (e) {}
            return Response.json({ success: true, profile: gp || {}, retryHours: retryHours });
        }
        // 自定义 Logo（登录后可见）
        if (url.pathname === '/api/logo' && request.method === 'GET') {
            const l = await getLogo(env);
            return Response.json({ success: true, logo: l });
        }
        // 安全设置(登录可见):裸域名直连代理开关
        if (url.pathname === '/api/security' && request.method === 'GET') {
            let bareProxy = true;
            try {
                if (env.DB) {
                    await ensureAppConfig(env);
                    const r = await env.DB.prepare("SELECT value FROM app_config WHERE key = 'bare_proxy_enabled'").first();
                    bareProxy = !(r && r.value === '0');
                }
            } catch (e) {}
            return Response.json({ success: true, bareProxy });
        }

        if (url.pathname === '/api/proxytoken' && request.method === 'GET') {
            const pt = await getProxyToken(env);
            return Response.json({ success: true, enabled: !!(pt && pt.enabled && pt.key), key: (pt && pt.enabled && pt.key) ? pt.key : '' });
        }
        // 来访记录 IP（仅管理员）
        if (url.pathname === '/api/proxytoken/hits' && request.method === 'GET') {
            if (ROLE !== 'admin') return new Response('Forbidden', { status: 403 });
            try {
                await env.DB.prepare('CREATE TABLE IF NOT EXISTS proxy_hits (id INTEGER PRIMARY KEY AUTOINCREMENT, ip TEXT, path TEXT, ua TEXT, ts INTEGER, times INTEGER)').run();
                const { results } = await env.DB.prepare('SELECT ip, path, ua, ts, times FROM proxy_hits ORDER BY id DESC LIMIT 200').all();
                return Response.json({ success: true, hits: results });
            } catch (e) { return Response.json({ success: true, hits: [] }); }
        }
        if (url.pathname === '/api/proxytoken/hits' && request.method === 'POST') {
            if (ROLE !== 'admin') return new Response('Forbidden', { status: 403 });
            try {
                const data = await request.json();
                if (data && data.clear) {
                    await env.DB.prepare('CREATE TABLE IF NOT EXISTS proxy_hits (id INTEGER PRIMARY KEY AUTOINCREMENT, ip TEXT, path TEXT, ua TEXT, ts INTEGER, times INTEGER)').run();
                    await env.DB.prepare('DELETE FROM proxy_hits').run();
                }
                return Response.json({ success: true });
            } catch (e) { return Response.json({ success: false, error: e.message }); }
        }

        // ==========================================
        // 2.4b 节点申请:订阅者提交 -> 管理员审核(按域名去重/同线路替换)
        // ==========================================
        if (url.pathname === '/api/node-request' && request.method === 'POST') {
            try {
                if (!env.DB) return Response.json({ success: false, error: 'D1 未绑定：请在 Worker 设置里绑定名为 DB 的 D1 数据库' });
                const body = await request.json();
                const name = String(body.name || '').trim();
                let urls = Array.isArray(body.urls) ? body.urls.map(x => String(x).trim()).filter(Boolean) : (body.url ? [String(body.url).trim()] : []);
                if (!name || !urls.length) return Response.json({ success: false, error: '请填写节点名字与至少一条线路地址' });
                const norm = [];
                for (let u of urls) {
                    if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
                    try { norm.push(new URL(u).href); } catch (e) {}
                }
                if (!norm.length) return Response.json({ success: false, error: '线路地址格式不正确' });
                const domains = norm.map(u => { try { return new URL(u).host.toLowerCase(); } catch (e) { return ''; } }).filter(Boolean);
                await env.DB.prepare("CREATE TABLE IF NOT EXISTS node_requests (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, url TEXT, domain TEXT, user TEXT, status TEXT DEFAULT 'pending', created_at TEXT DEFAULT CURRENT_TIMESTAMP)").run();
                const { results: routes } = await env.DB.prepare('SELECT prefix, remark, target FROM routes').all();
                for (const r of (routes || [])) {
                    const targets = String(r.target || '').split(',').map(x => x.trim()).filter(Boolean);
                    for (const t of targets) {
                        try { if (domains.includes(new URL(t).host.toLowerCase())) return Response.json({ success: false, exists: true, prefix: r.prefix, remark: r.remark || r.prefix }); } catch (e) {}
                    }
                }
                const { results: pends } = await env.DB.prepare("SELECT id, name, url, domain FROM node_requests WHERE status = 'pending'").all();
                for (const pp of (pends || [])) {
                    let pDoms = [];
                    try { pDoms = JSON.parse(pp.url || '[]').map(u => { try { return new URL(u).host.toLowerCase(); } catch (e) { return ''; } }).filter(Boolean); } catch (e) {}
                    if (!pDoms.length && pp.domain) pDoms = [pp.domain];
                    if (pDoms.some(d => domains.includes(d))) {
                        await env.DB.prepare('UPDATE node_requests SET name = ?, url = ?, user = ? WHERE id = ?').bind(name, JSON.stringify(norm), String(body.user || ROLE || 'sub'), pp.id).run();
                        return Response.json({ success: true, replaced: true, name: pp.name });
                    }
                }
                await env.DB.prepare('INSERT INTO node_requests (name, url, domain, user) VALUES (?, ?, ?, ?)').bind(name, JSON.stringify(norm), domains[0], String(body.user || ROLE || 'sub')).run();
                return Response.json({ success: true, replaced: false });
            } catch (e) { return Response.json({ success: false, error: e.message }); }
        }
        if (url.pathname === '/api/node-requests' && request.method === 'GET') {
            if (ROLE !== 'admin') return new Response('Forbidden', { status: 403 });
            try {
                if (!env.DB) return Response.json({ success: false, error: 'D1 未绑定', requests: [] });
                await env.DB.prepare("CREATE TABLE IF NOT EXISTS node_requests (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, url TEXT, domain TEXT, user TEXT, status TEXT DEFAULT 'pending', created_at TEXT DEFAULT CURRENT_TIMESTAMP)").run();
                const { results } = await env.DB.prepare("SELECT id, name, url, user, created_at FROM node_requests WHERE status = 'pending' ORDER BY id DESC").all();
                return Response.json({ success: true, requests: results });
            } catch (e) { return Response.json({ success: false, error: e.message, requests: [] }); }
        }
        if (url.pathname === '/api/node-requests/review' && request.method === 'POST') {
            if (ROLE !== 'admin') return new Response('Forbidden', { status: 403 });
            try {
                const body = await request.json();
                const id = parseInt(body.id, 10);
                if (!id) return Response.json({ success: false, error: '参数错误' });
                if (!env.DB) return Response.json({ success: false, error: 'D1 未绑定' });
                await env.DB.prepare("CREATE TABLE IF NOT EXISTS node_requests (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, url TEXT, domain TEXT, user TEXT, status TEXT DEFAULT 'pending', created_at TEXT DEFAULT CURRENT_TIMESTAMP)").run();
                if (body.action === 'approve') {
                    const row = await env.DB.prepare('SELECT name, url FROM node_requests WHERE id = ?').bind(id).first();
                    if (!row) return Response.json({ success: false, error: '申请不存在' });
                    await env.DB.prepare("UPDATE node_requests SET status = 'approved' WHERE id = ?").bind(id).run();
                    return Response.json({ success: true, data: { name: row.name, url: row.url } });
                }
                if (body.action === 'reject') {
                    await env.DB.prepare('DELETE FROM node_requests WHERE id = ?').bind(id).run();
                    return Response.json({ success: true });
                }
                return Response.json({ success: false, error: '未知操作' });
            } catch (e) { return Response.json({ success: false, error: e.message }); }
        }

        if (url.pathname === '/api/subscribers' && request.method === 'GET') {
            if (ROLE !== 'admin') return new Response('Forbidden', { status: 403 });
            try {
                await ensureAppConfig(env);
                const row = await env.DB.prepare('SELECT value FROM app_config WHERE key = ?').bind('subscribers').first();
                const list = row && row.value ? JSON.parse(row.value) : [];
                return Response.json({ success: true, subscribers: Array.isArray(list) ? list : [] });
            } catch (e) {
                return Response.json({ success: false, error: e.message, subscribers: [] });
            }
        }

        if (url.pathname === '/api/subscribers' && request.method === 'POST') {
            if (ROLE !== 'admin') return new Response('Forbidden', { status: 403 });
            try {
                const data = await request.json();
                const action = data.action;
                const pw = String(data.password || '').trim();
                if (!pw || pw.length < 4) return Response.json({ success: false, error: '密码至少 4 位' });
                await ensureAppConfig(env);
                const row = await env.DB.prepare('SELECT value FROM app_config WHERE key = ?').bind('subscribers').first();
                let list = row && row.value ? JSON.parse(row.value) : [];
                if (!Array.isArray(list)) list = [];
                if (action === 'add') {
                    if (list.includes(pw)) return Response.json({ success: false, error: '该密码已存在' });
                    list.push(pw);
                } else if (action === 'del') {
                    list = list.filter(p => p !== pw);
                } else {
                    return Response.json({ success: false, error: '未知操作' });
                }
                await env.DB.prepare('INSERT OR REPLACE INTO app_config (key, value) VALUES (?, ?)').bind('subscribers', JSON.stringify(list)).run();
                return Response.json({ success: true, subscribers: list });
            } catch (e) {
                return Response.json({ success: false, error: e.message });
            }
        }

        // ==========================================
        // 2.3 数据大屏统计接口 (Analytics)
        // ==========================================
        if (url.pathname === '/api/analytics' && request.method === 'GET') {
            if (!env.DB) return Response.json({ success: false, error: '未绑定 D1 数据库' });
            try {
                // 并发获取 24小时、7天、30天流量 (通过全新 GraphQL API 规避限制)
                const [trafficToday, traffic7d, traffic30d] = await Promise.all([
                    getCFTraffic(env, 'today'),
                    getCFTraffic(env, 7),
                    getCFTraffic(env, 30)
                ]);

                if (!visitorCityColReady) { try { await env.DB.exec(`ALTER TABLE visitor_logs ADD COLUMN city TEXT DEFAULT ''`); } catch(e) {} visitorCityColReady = true; }
                const trend = await env.DB.prepare(`SELECT date(timestamp, '+8 hours') as date, COUNT(*) as count FROM visitor_logs WHERE timestamp >= datetime('now', '-7 days') GROUP BY date(timestamp, '+8 hours') ORDER BY date ASC`).all();
                const locations = await env.DB.prepare(`SELECT country, COUNT(*) as count FROM visitor_logs WHERE timestamp >= datetime('now', '-7 days') GROUP BY country ORDER BY count DESC`).all();
                const recents = await env.DB.prepare(`SELECT prefix, datetime(timestamp, '+8 hours') as timestamp, ip, country, ua, region, city FROM visitor_logs ORDER BY timestamp DESC LIMIT 20`).all();
                
                return Response.json({ 
                    success: true, 
                    trend: trend.results, 
                    locations: locations.results, 
                    recents: recents.results, 
                    trafficToday, traffic7d, traffic30d 
                });
            } catch(e) {
                return Response.json({ success: false, error: e.message });
            }
        }

        let WORLD_SIMPLE = null;
        const PROVINCE_FULL = { '北京':'北京市','天津':'天津市','上海':'上海市','重庆':'重庆市','河北':'河北省','山西':'山西省','辽宁':'辽宁省','吉林':'吉林省','黑龙江':'黑龙江省','江苏':'江苏省','浙江':'浙江省','安徽':'安徽省','福建':'福建省','江西':'江西省','山东':'山东省','河南':'河南省','湖北':'湖北省','湖南':'湖南省','广东':'广东省','海南':'海南省','四川':'四川省','贵州':'贵州省','云南':'云南省','陕西':'陕西省','甘肃':'甘肃省','青海':'青海省','台湾':'台湾省','内蒙古':'内蒙古自治区','广西':'广西壮族自治区','西藏':'西藏自治区','宁夏':'宁夏回族自治区','新疆':'新疆维吾尔自治区','香港':'香港特别行政区','澳门':'澳门特别行政区' };
        async function resolveVisitorGeoBatch(ips) {
            const out = {};
            if (!Array.isArray(ips) || !ips.length) return out;
            const nowTs = Date.now();
            let cache = {};
            try {
                const row = await env.DB.prepare("SELECT value FROM app_config WHERE key = 'ip_geo_cache'").first();
                if (row && row.value) cache = JSON.parse(row.value) || {};
            } catch (e) {}
            const pending = [];
            const seen = new Set();
            for (const raw of ips) {
                const ip = String(raw || '').trim();
                if (!ip || seen.has(ip)) continue;
                seen.add(ip);
                const hit = cache[ip];
                if (hit && hit.p && (nowTs - (hit.ts || 0)) < 604800000) { out[ip] = { provinceZh: hit.p, cityZh: hit.c || '', ts: hit.ts }; continue; }
                pending.push(ip);
            }
            if (pending.length) {
                const batch = pending.slice(0, 35);
                try {
                    const ac = new AbortController();
                    const tm = setTimeout(() => ac.abort(), 3500);
                    const resp = await fetch('http://ip-api.com/batch?fields=status,query,countryCode,regionName,city,lat,lon&lang=zh-CN', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(batch.map(q => ({ query: q }))), signal: ac.signal });
                    clearTimeout(tm);
                    if (resp.ok) {
                        const arr = await resp.json();
                        if (Array.isArray(arr)) {
                            for (const r of arr) {
                                if (r && r.status === 'success' && r.query && String(r.countryCode || '').toUpperCase() === 'CN' && r.regionName) {
                                    const prov = PROVINCE_FULL[r.regionName] || (r.regionName.endsWith('省') || r.regionName.endsWith('自治区') || r.regionName.endsWith('市') || r.regionName.endsWith('特别行政区') ? r.regionName : r.regionName + '省');
                                    const city = String(r.city || '').replace(/市$/, '');
                                    out[r.query] = { provinceZh: prov, cityZh: city, ts: nowTs };
                                    cache[r.query] = { p: prov, c: city, ts: nowTs };
                                } else if (r && r.status === 'success' && r.query && r.countryCode) {
                                    // 非 CN:记缓存但无省份,避免反复查
                                    cache[r.query] = { p: '', c: '', ts: nowTs };
                                }
                            }
                        }
                    }
                } catch (e) {}
                try {
                    const keys = Object.keys(cache);
                    if (keys.length > 400) { const keep = keys.slice(keys.length - 400); const trimmed = {}; for (const k of keep) trimmed[k] = cache[k]; cache = trimmed; }
                    await env.DB.prepare('INSERT OR REPLACE INTO app_config (key, value) VALUES (?, ?)').bind('ip_geo_cache', JSON.stringify(cache)).run();
                } catch (e) {}
            }
            return out;
        }
        if (url.pathname === '/api/visitor-geo' && request.method === 'GET') {
            if (!env.DB) return Response.json({ success: false, error: 'D1 未绑定', countries: [], provinces: [] });
            try {
                await env.DB.exec(`CREATE TABLE IF NOT EXISTS visitor_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, prefix TEXT, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP, ip TEXT, country TEXT, ua TEXT)`);
                if (!visitorGeoColsReady) {
                    try { await env.DB.exec(`ALTER TABLE visitor_logs ADD COLUMN region TEXT DEFAULT ''`); } catch(e) {}
                    try { await env.DB.exec(`ALTER TABLE visitor_logs ADD COLUMN city TEXT DEFAULT ''`); } catch(e) {}
                    visitorGeoColsReady = true;
                }
                const byCountry = await env.DB.prepare(`SELECT country, COUNT(*) as count FROM visitor_logs WHERE timestamp >= datetime('now', '+8 hours', '-7 days') GROUP BY country ORDER BY count DESC`).all();
                const byProvRaw = await env.DB.prepare(`SELECT region, COUNT(*) as count FROM visitor_logs WHERE timestamp >= datetime('now', '+8 hours', '-7 days') AND country = 'CN' AND region != '' GROUP BY region ORDER BY count DESC`).all();
                const missing = await env.DB.prepare(`SELECT DISTINCT ip FROM visitor_logs WHERE timestamp >= datetime('now', '+8 hours', '-7 days') AND country = 'CN' AND region = '' AND ip != '' LIMIT 35`).all();
                // 省份解析改后台异步(ctx.waitUntil),接口立即返回已有聚合,避免阻塞大屏加载
                if (missing.results.length && ctx && ctx.waitUntil) {
                    const ips = missing.results.map(r => r.ip);
                    ctx.waitUntil((async () => {
                        try {
                            const geo = await resolveVisitorGeoBatch(ips);
                            for (const ip of ips) {
                                const g = geo[ip];
                                if (g && g.provinceZh) {
                                    await env.DB.prepare(`UPDATE visitor_logs SET region = ?, city = ? WHERE ip = ? AND country = 'CN' AND region = ''`).bind(g.provinceZh, g.cityZh || '', ip).run();
                                }
                            }
                        } catch (e) {}
                    })());
                }
                return Response.json({ success: true, countries: byCountry.results, provinces: byProvRaw.results, resolving: missing.results.length > 0 });
            } catch(e) {
                return Response.json({ success: false, error: e.message, countries: [], provinces: [] });
            }
        }

        // ==========================================
        //  中国省份 GeoJSON 代理接口 (v3.4.56):Worker 后端拉取 DataV,规避移动网络直连被改写/CORS 问题,带 D1 缓存
        // ==========================================
        if (url.pathname === '/api/geo-china' && request.method === 'GET') {
            try {
                const nowTs = Date.now();
                const cachedRow = await env.DB.prepare("SELECT value FROM app_config WHERE key = 'geo_china_map'").first();
                if (cachedRow && cachedRow.value) {
                    const c = JSON.parse(cachedRow.value);
                    if (c && c.ts && (nowTs - c.ts) < 604800000 && c.data) {
                        return new Response(JSON.stringify(c.data), { headers: { 'Content-Type': 'application/json;charset=UTF-8' } });
                    }
                }
                const ac = new AbortController();
                const tm = setTimeout(() => ac.abort(), 3500);
                const resp = await fetch('https://geo.datav.aliyun.com/areas_v3/bound/100000_full.json', { signal: ac.signal });
                clearTimeout(tm);
                if (!resp.ok) return Response.json({ success: false, error: '地图数据源 HTTP ' + resp.status }, { status: 502 });
                const data = await resp.json();
                await env.DB.prepare('INSERT INTO app_config(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=?').bind('geo_china_map', JSON.stringify({ data: data, ts: nowTs }), JSON.stringify({ data: data, ts: nowTs })).run();
                return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json;charset=UTF-8' } });
            } catch(e) {
                return Response.json({ success: false, error: String(e && e.message || e) }, { status: 502 });
            }
        }

        // ==========================================
        //  世界地图简化 GeoJSON 代理接口 (v3.4.58):后端拉取 echarts4 world.json 并抽稀,内存缓存,前端 canvas 自绘大陆轮廓
        // ==========================================
        if (url.pathname === '/api/geo-world' && request.method === 'GET') {
            try {
                if (!WORLD_SIMPLE) {
                    const ac = new AbortController();
                    const tm = setTimeout(() => ac.abort(), 9000);
                    const resp = await fetch('https://cdn.jsdelivr.net/npm/echarts@4.9.0/map/json/world.json', { signal: ac.signal });
                    clearTimeout(tm);
                    if (!resp.ok) return Response.json({ success: false, error: '世界地图数据源 HTTP ' + resp.status }, { status: 502 });
                    const gj = await resp.json();
                    const simplifyRing = (ring) => {
                        if (!Array.isArray(ring) || ring.length <= 60) return ring;
                        const step = Math.ceil(ring.length / 60);
                        const out = [];
                        for (let i = 0; i < ring.length; i += step) out.push(ring[i]);
                        if (out.length > 1 && (out[0][0] !== out[out.length - 1][0] || out[0][1] !== out[out.length - 1][1])) out.push(out[0]);
                        return out;
                    };
                    const features = (gj.features || []).filter(f => f && f.properties && String(f.properties.name || '') !== 'Antarctica').map(f => {
                        const g = f.geometry;
                        if (!g) return f;
                        if (g.type === 'Polygon') g.coordinates = g.coordinates.map(simplifyRing);
                        else if (g.type === 'MultiPolygon') g.coordinates = g.coordinates.map(p => p.map(simplifyRing));
                        return f;
                    });
                    WORLD_SIMPLE = { type: 'FeatureCollection', features };
                }
                return new Response(JSON.stringify(WORLD_SIMPLE), { headers: { 'Content-Type': 'application/json;charset=UTF-8' } });
            } catch(e) {
                return Response.json({ success: false, error: String(e && e.message || e) }, { status: 502 });
            }
        }

        // ==========================================
        //  CF Worker 每日请求数统计接口 (GraphQL httpRequests，额度按 UTC 00:00 重置)
        if (url.pathname === '/api/cfusage' && request.method === 'GET') {
            if (!env.CF_API_TOKEN || !env.CF_ZONE_ID) return Response.json({ success: false, error: '缺少 CF_API_TOKEN 或 CF_ZONE_ID 变量，无法统计 CF 请求数' });
            try {
                const [todayStats, week, month] = await Promise.all([
                    getCFTodayStats(env),
                    getCFRequests(env, 7),
                    getCFRequests(env, 30)
                ]);
                const quota = 100000;
                const todayCount = todayStats.ok ? todayStats.requests : 0;
                const weekCount = week.ok ? week.count : 0;
                const monthCount = month.ok ? month.count : 0;
                return Response.json({ 
                    success: true, 
                    today: todayCount, 
                    week: weekCount, 
                    month: monthCount, 
                    quota: quota,
                    usedPercent: todayStats.ok ? Math.round(todayCount / quota * 1000) / 10 : 0,
                    remain: Math.max(0, quota - todayCount),
                    todayError: todayStats.ok ? null : todayStats.error,
                    weekError: week.ok ? null : week.error,
                    monthError: month.ok ? null : month.error,
                    bandwidth: todayStats.ok ? todayStats.bytes : 0,
                    cacheHitRatio: todayStats.ok && todayStats.bytes > 0 ? Math.round(todayStats.cachedBytes / todayStats.bytes * 1000) / 10 : 0,
                    statusCodes: todayStats.ok ? todayStats.statusCodes : { '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0 },
                    countries: todayStats.ok ? todayStats.countries : [],
                    hours: todayStats.ok ? todayStats.hours : [],
                    blocked: todayStats.ok ? todayStats.blocked : 0
                });
            } catch(e) {
                return Response.json({ success: false, error: e.message });
            }
        }

        // ==========================================
        //  后端接口：执行代码覆盖更新 (纯JSON接口无损继承：变量、数据库、兼容性、放置地区)
        // ==========================================
        if (url.pathname === '/api/deploy' && request.method === 'POST') {
if (ROLE !== 'admin') return new Response('Forbidden', { status: 403 });
                        const cfToken = env.CF_API_TOKEN;
            const accountId = env.CF_ACCOUNT_ID;
            const workerName = env.CF_WORKER_NAME;
            if (!cfToken || !accountId || !workerName) {
                return Response.json({ success: false, error: '缺少 CF_API_TOKEN, CF_ACCOUNT_ID 或 CF_WORKER_NAME 环境变量' });
            }
            try {
                const body = await request.json();
                if (!body.newCode) return Response.json({ success: false, error: '代码内容为空。' });

                // 1.  终极修复：调用纯 JSON 的 services 接口获取真实配置，绝对不再崩溃！
                const serviceRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/services/${workerName}`, {
                    headers: { 'Authorization': `Bearer ${cfToken}` }
                });
                const serviceData = await serviceRes.json();
                
                let compDate = "2024-01-01"; // 依然保留兜底，但这次绝不会用到
                let compFlags = undefined;
                let placement = undefined;

                if (serviceData.success && serviceData.result) {
                    // 精准从 JSON 中提取你原本的配置
                    let scriptInfo = null;
                    if (serviceData.result.default_environment && serviceData.result.default_environment.script) {
                        scriptInfo = serviceData.result.default_environment.script;
                    } else if (serviceData.result.script) {
                        scriptInfo = serviceData.result.script;
                    }
                    
                    if (scriptInfo) {
                        if (scriptInfo.compatibility_date) compDate = scriptInfo.compatibility_date;
                        if (scriptInfo.compatibility_flags) compFlags = scriptInfo.compatibility_flags;
                        if (scriptInfo.placement) placement = scriptInfo.placement;
                    }
                }

                // 2. 先拉取已有绑定:保留 D1/KV/DO 等高级绑定,并识别哪些变量是 secret
                const bindingsRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${workerName}/bindings`, {
                    headers: { 'Authorization': `Bearer ${cfToken}` }
                });
                const bindingsData = await bindingsRes.json();
                const secretNames = new Set();
                const preservedBindings = [];
                if (bindingsData.success && Array.isArray(bindingsData.result)) {
                    for (const b of bindingsData.result) {
                        if (b.type === 'secret_text') secretNames.add(b.name);
                        else if (b.type !== 'plain_text' && b.type !== 'inherited') preservedBindings.push(b);
                    }
                }
                // 3. 回写字符串变量:secret 仍以 secret_text 写回,不降级成明文变量
                const SECRET_NAME_RE = /(TOKEN|SECRET|PASS|KEY)/i;
                for (const key in env) {
                    if (typeof env[key] !== 'string') continue;
                    const isSecret = secretNames.has(key) || SECRET_NAME_RE.test(key);
                    preservedBindings.push({ name: key, type: isSecret ? 'secret_text' : 'plain_text', text: env[key] });
                }

                // 4. 组装最终的部署请求
                const formData = new FormData();
                const metadata = { 
                    main_module: 'worker.js',
                    bindings: preservedBindings,
                    compatibility_date: compDate 
                };
                if (compFlags) metadata.compatibility_flags = compFlags;
                if (placement) metadata.placement = placement; // ${I.target} 完美带上你原始的放置地区！

                formData.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }), 'metadata.json');
                formData.append('worker.js', new Blob([body.newCode], { type: 'application/javascript+module' }), 'worker.js');

                const cfUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${workerName}`;
                const res = await fetch(cfUrl, {
                    method: 'PUT',
                    headers: { 'Authorization': `Bearer ${cfToken}` },
                    body: formData
                });
                const data = await res.json();
                if (data.success) {
                    return Response.json({ success: true, msg: '代码更新成功，并已完美保留原有放置地区和兼容配置！' });
                } else {
                    throw new Error(JSON.stringify(data.errors));
                }
            } catch (e) {
                return Response.json({ success: false, error: e.message });
            }
        }
        // ==========================================
        // 2.4 系统级与提取工具 API 
        // ==========================================
        if (url.pathname === '/api/purge-cache' && request.method === 'POST') {
if (ROLE !== 'admin') return new Response('Forbidden', { status: 403 });
                        const cfToken = env.CF_API_TOKEN; const zoneId = env.CF_ZONE_ID;
            if (!cfToken || !zoneId) return Response.json({ success: false, error: '缺少 CF_API_TOKEN 或 CF_ZONE_ID 变量' });
            try {
                const res = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/purge_cache`, { method: 'POST', headers: { 'Authorization': `Bearer ${cfToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ purge_everything: true }) });
                const data = await res.json();
                if (!data.success) throw new Error(JSON.stringify(data.errors));
                return Response.json({ success: true });
            } catch (e) { return Response.json({ success: false, error: e.message }); }
        }

        // v4.0.0:播放热力图(最近 7 天×24 小时)
        if (url.pathname === '/api/heatmap') {
            return Response.json(await getHeatmap(env, 7));
        }

        if (url.pathname === '/api/ping-node') {
            if (ROLE !== 'admin') return new Response('Forbidden', { status: 403 });
            const target = url.searchParams.get('url');
            if (!target) return Response.json({ ms: -1 });
            const start = Date.now();
            try {
                const controller = new AbortController(); const timeoutId = setTimeout(() => controller.abort(), 2000); 
                await fetch(target + '/', { method: 'HEAD', signal: controller.signal });
                clearTimeout(timeoutId); return Response.json({ ms: Date.now() - start });
            } catch (e) { return Response.json({ ms: -1 }); }
        }

        if (url.pathname === '/api/get-dns') {
            if (ROLE !== 'admin') return new Response('Forbidden', { status: 403 });
            const cfToken = env.CF_API_TOKEN; const zoneId = env.CF_ZONE_ID; const domain = env.CF_DOMAIN;
            if (!cfToken || !zoneId || !domain) return Response.json({ success: false, error: '缺少 DNS 环境变量' });
            try {
                const getRes = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records?name=${domain}`, { headers: { 'Authorization': `Bearer ${cfToken}` } });
                const getData = await getRes.json();
                return Response.json({ success: true, result: getData.result });
            } catch (error) { return Response.json({ success: false, error: error.message }); }
        }

        if (url.pathname === '/api/update-dns' && request.method === 'POST') {
            if (ROLE !== 'admin') return new Response('Forbidden', { status: 403 });
            const cfToken = env.CF_API_TOKEN; const zoneId = env.CF_ZONE_ID; const domain = env.CF_DOMAIN;
            if (!cfToken || !zoneId || !domain) return Response.json({ success: false, error: '缺少 DNS 环境变量' });
            let ips;
            try { const body = await request.json(); ips = body && body.ips; } catch (e) { return Response.json({ success: false, error: '请求体不是合法 JSON' }); }
            // 先校验全部输入,通过后才会动现有记录(避免先删后发现参数有问题导致解析被清空)
            if (!Array.isArray(ips) || ips.length === 0 || ips.length > 50) return Response.json({ success: false, error: 'ips 必须是非空数组(最多 50 条)' });
            const newRecords = [];
            for (const raw of ips) {
                const cleanItem = String(raw == null ? '' : raw).replace(/[\[\]]/g, '').trim();
                const isV4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(cleanItem);
                const isV6 = cleanItem.includes(':') && /^[0-9a-fA-F:.]+$/.test(cleanItem);
                const isHost = /^(?=.{1,253}$)([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}$/.test(cleanItem);
                if (!isV4 && !isV6 && !isHost) return Response.json({ success: false, error: '无效的 IP/域名: ' + cleanItem });
                newRecords.push({ type: isV6 ? 'AAAA' : (isV4 ? 'A' : 'CNAME'), name: domain, content: cleanItem, ttl: 60, proxied: false });
            }
            const dnsBase = `https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records`;
            const authH = { 'Authorization': `Bearer ${cfToken}` };
            const jsonH = { 'Authorization': `Bearer ${cfToken}`, 'Content-Type': 'application/json' };
            try {
                const getRes = await fetch(`${dnsBase}?name=${encodeURIComponent(domain)}`, { headers: authH });
                const getData = await getRes.json();
                if (!getData.success) throw new Error('获取现有 DNS 记录失败');

                const oldRecords = getData.result.filter(r => r.type === 'A' || r.type === 'AAAA' || r.type === 'CNAME');
                const deleted = []; const created = [];
                try {
                    for (const record of oldRecords) {
                        const dr = await fetch(`${dnsBase}/${record.id}`, { method: 'DELETE', headers: authH });
                        const dd = await dr.json();
                        if (!dd.success) throw new Error('删除旧记录失败: ' + JSON.stringify(dd.errors));
                        deleted.push(record);
                    }
                    for (const rec of newRecords) {
                        const postRes = await fetch(dnsBase, { method: 'POST', headers: jsonH, body: JSON.stringify(rec) });
                        const postData = await postRes.json();
                        if (!postData.success) throw new Error('记录提交失败: ' + JSON.stringify(postData.errors));
                        created.push(postData.result && postData.result.id);
                    }
                } catch (err) {
                    // 回滚:删除已创建的新记录,恢复已删除的旧记录
                    for (const id of created) { if (id) { try { await fetch(`${dnsBase}/${id}`, { method: 'DELETE', headers: authH }); } catch (e) {} } }
                    for (const old of deleted) {
                        try { await fetch(dnsBase, { method: 'POST', headers: jsonH, body: JSON.stringify({ type: old.type, name: old.name, content: old.content, ttl: old.ttl, proxied: !!old.proxied }) }); } catch (e) {}
                    }
                    throw new Error(err.message + '(已尝试回滚,恢复原有解析记录)');
                }
                return Response.json({ success: true, message: '✅ 更新成功！' });
            } catch (error) { return Response.json({ success: false, error: error.message }); }
        }

        if (url.pathname === '/api/get-custom-api-ips') {
            if (ROLE !== 'admin') return new Response('Forbidden', { status: 403 });
            try {
                const apiUrl = url.searchParams.get('url');
                if (!apiUrl) throw new Error("缺少 URL");
                let apiParsed; try { apiParsed = new URL(apiUrl); } catch (e) { throw new Error('URL 无效'); }
                if (apiParsed.protocol !== 'http:' && apiParsed.protocol !== 'https:') throw new Error('仅支持 http(s) 地址');
                const apiHost = apiParsed.hostname.toLowerCase();
                if (apiHost === 'localhost' || apiHost === '[::1]' || apiHost.endsWith('.local') || apiHost.endsWith('.internal') || /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.)/.test(apiHost)) throw new Error('不允许访问内网地址');
                const apiCtl = new AbortController(); const apiTimer = setTimeout(() => apiCtl.abort(), 8000);
                let response;
                try { response = await fetch(apiParsed.href, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: apiCtl.signal }); } finally { clearTimeout(apiTimer); }
                const text = await response.text(); let validIPs = new Set();
                try {
                    const jsonObj = JSON.parse(text);
                    if (jsonObj && jsonObj.data && Array.isArray(jsonObj.data)) {
                        jsonObj.data.forEach(item => { if (item.ip) { let ip = item.ip; if (ip.includes(':') && !ip.startsWith('[')) ip = `[${ip}]`; validIPs.add(ip); } });
                    }
                } catch (e) {}

                if (validIPs.size === 0) {
                    const ipv4Regex = /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g;
                    const matchedIPv4 = text.match(ipv4Regex) || [];
                    matchedIPv4.forEach(ip => { if (!ip.startsWith('10.') && !ip.startsWith('192.168.') && !ip.startsWith('127.')) validIPs.add(ip); });

                    const ipv6Regex = /(?:[A-F0-9]{1,4}:){7}[A-F0-9]{1,4}|(?:[A-F0-9]{1,4}:)*:[A-F0-9]{1,4}(?::[A-F0-9]{1,4})*/gi;
                    const matchedIPv6 = text.match(ipv6Regex) || [];
                    matchedIPv6.forEach(ip => { if (ip.length > 7 && ip.includes(':') && !ip.startsWith('::1')) validIPs.add(ip.startsWith('[') ? ip : `[${ip}]`); });
                }
                const uniqueIPArray = Array.from(validIPs);
                for (let i = uniqueIPArray.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [uniqueIPArray[i], uniqueIPArray[j]] = [uniqueIPArray[j], uniqueIPArray[i]]; }
                return Response.json({ success: true, ips: uniqueIPArray.slice(0, 15), totalCount: uniqueIPArray.length });
            } catch (error) { return Response.json({ success: false, error: error.message }, { status: 500 }); }
        }

        const PRESET_SOURCES = {
            'ehb-all': { name: '云枢全域融合(双栈)', url: 'https://ip.ehb.cc.cd/all?ips=100' },
            'ehb-cm': { name: '云枢移动起飞(IPv4)', url: 'https://ip.ehb.cc.cd/cm?ips=100' },
            'ehb-ct': { name: '云枢电信美西(IPv4)', url: 'https://ip.ehb.cc.cd/ct?ips=100' },
            'ehb-cu': { name: '云枢联通极速(IPv4)', url: 'https://ip.ehb.cc.cd/cu?ips=100' },
            'ehb-104': { name: '104 大段全域池', url: 'https://ip.ehb.cc.cd/104?ips=100' },
            'ehb-10417': { name: '104.17 移动起飞段', url: 'https://ip.ehb.cc.cd/104.17?ips=100' },
            'ehb-10419': { name: '104.19 移动抗QoS段', url: 'https://ip.ehb.cc.cd/104.19?ips=100' },
            'ehb-10416': { name: '104.16 经典老牌段', url: 'https://ip.ehb.cc.cd/104.16?ips=100' },
            'ehb-162': { name: '162 大段全域池', url: 'https://ip.ehb.cc.cd/162?ips=100' },
            'ehb-162159s': { name: '162.159 SaaS/DoH段', url: 'https://ip.ehb.cc.cd/162.159-saas?ips=100' },
            'ehb-162159ct': { name: '162.159 电信美西最稳段', url: 'https://ip.ehb.cc.cd/162.159-ct?ips=100' },
            'ehb-172': { name: '172 大段全域池', url: 'https://ip.ehb.cc.cd/172?ips=100' },
            'ehb-17264': { name: '172.64 联通/电信主力段', url: 'https://ip.ehb.cc.cd/172.64?ips=100' },
            'ehb-17267': { name: '172.67 动态反代段', url: 'https://ip.ehb.cc.cd/172.67?ips=100' },
            'ehb-198': { name: '198.41 联通天花板大段', url: 'https://ip.ehb.cc.cd/198?ips=100' },
            'ehb-108': { name: '108.162 三网兜底大段', url: 'https://ip.ehb.cc.cd/108?ips=100' },
            'ehb-v6': { name: '云枢 IPv6 全域星轨', url: 'https://ip.ehb.cc.cd/v6?ips=100' },
            'ehb-v6cm': { name: '云枢移动 5G 直连', url: 'https://ip.ehb.cc.cd/v6-cm?ips=100' },
            'ehb-v6ct': { name: '云枢电信 纯净美西', url: 'https://ip.ehb.cc.cd/v6-ct?ips=100' },
            'ehb-v6cu': { name: '云枢联通 欧洲/东京', url: 'https://ip.ehb.cc.cd/v6-cu?ips=100' },
            'ehb-2400': { name: '2400:cb00 亚太全域', url: 'https://ip.ehb.cc.cd/2400?ips=100' },
            'ehb-24002048': { name: '2400.2048 香港近场段', url: 'https://ip.ehb.cc.cd/2400.2048?ips=100' },
            'ehb-2400400': { name: '2400.400 亚太低跳数段', url: 'https://ip.ehb.cc.cd/2400.400?ips=100' },
            'ehb-24002049': { name: '2400.2049 亚太抗抖动段', url: 'https://ip.ehb.cc.cd/2400.2049?ips=100' },
            'ehb-2606': { name: '2606:4700 全球主干', url: 'https://ip.ehb.cc.cd/2606?ips=100' },
            'ehb-26063030': { name: '2606.3030 核心骨干段', url: 'https://ip.ehb.cc.cd/2606.3030?ips=100' },
            'ehb-26064700': { name: '2606.4700 伴生特权段', url: 'https://ip.ehb.cc.cd/2606.4700?ips=100' },
            'ehb-2a06': { name: '2a06:98c0 欧洲特快大段', url: 'https://ip.ehb.cc.cd/2a06?ips=100' },
            'robberer': { name: '@robberer 专属', url: 'https://gh.xxooo.cf/https://raw.githubusercontent.com/hc990275/yx/refs/heads/main/cfyxip.txt' },
            'cm-ct': { name: 'CM佬电信优选', url: 'https://cf.090227.xyz/ct?ips=100' },
            'cm-cmcc': { name: 'CM佬移动优选', url: 'https://cf.090227.xyz/cmcc?ips=100' },
            'cm-cu': { name: 'CM佬联通优选', url: 'https://cf.090227.xyz/cu?ips=100' },
            'v2too': { name: 'v2too 源', url: 'https://ip.v2too.top/api/nodes' }
        };
        function normalizePresetIp(ip) {
            ip = String(ip).trim().replace(/^\[|\]$/g, '');
            if (ip.includes(':') && !ip.startsWith('[')) ip = `[${ip}]`;
            return ip;
        }
        async function extractIPsFromSource(url) {
            const set = new Set();
            try {
                const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
                if (!resp.ok) return set;
                const text = await resp.text();
                try {
                    const j = JSON.parse(text);
                    if (j && Array.isArray(j.data)) {
                        j.data.forEach(item => { if (item && item.ip) set.add(normalizePresetIp(item.ip)); });
                        if (set.size > 0) return set;
                    }
                } catch (e) {}
                const ipv4Regex = /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g;
                (text.match(ipv4Regex) || []).forEach(ip => { if (!ip.startsWith('10.') && !ip.startsWith('192.168.') && !ip.startsWith('127.')) set.add(ip); });
                const ipv6Regex = /(?:[A-F0-9]{1,4}:){7}[A-F0-9]{1,4}|(?:[A-F0-9]{1,4}:)*:[A-F0-9]{1,4}(?::[A-F0-9]{1,4})*/gi;
                (text.match(ipv6Regex) || []).forEach(ip => { if (ip.length > 7 && ip.includes(':') && !ip.startsWith('::1')) set.add(ip.startsWith('[') ? ip : `[${ip}]`); });
            } catch (e) {}
            return set;
        }

        if (url.pathname === '/api/get-remote-ips') {
            if (ROLE !== 'admin') return new Response('Forbidden', { status: 403 });
            try {
                const reqType = (url.searchParams.get('type') || 'all').toLowerCase();
                const validIPs = new Set();
                let sourceName = '综合混合源(四源并发)';

                if (reqType === 'all') {
                    const [s1, s2, s3, s4] = await Promise.all([
                        extractIPsFromSource('https://api.uouin.com/cloudflare.html'),
                        extractIPsFromSource('https://raw.githubusercontent.com/ZhiXuanWang/cf-speed-dns/refs/heads/main/ipTop10.html'),
                        extractIPsFromSource('https://ip.164746.xyz/'),
                        extractIPsFromSource('https://www.wetest.vip/page/cloudflare/address_v4.html')
                    ]);
                    s1.forEach(i => validIPs.add(i)); s2.forEach(i => validIPs.add(i)); s3.forEach(i => validIPs.add(i)); s4.forEach(i => validIPs.add(i));
                } else if (['电信', '联通', '移动', '多线', 'ipv6'].includes(reqType)) {
                    sourceName = reqType + '专属(uouin)';
                    try {
                        const res1 = await fetch('https://api.uouin.com/cloudflare.html', { headers: { 'User-Agent': 'Mozilla/5.0' } });
                        if (res1.ok) {
                            const text1 = await res1.text(); const cleanText = text1.replace(/<[^>]+>/g, ' ');
                            const regex = /(电信|联通|移动|多线|ipv6)\s+((?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)|(?:[a-fA-F0-9]{1,4}:)+[a-fA-F0-9]{1,4})/gi;
                            let match; while ((match = regex.exec(cleanText)) !== null) {
                                if (match[1].toLowerCase() === reqType) { let ip = match[2]; if (ip.includes(':') && !ip.startsWith('[')) ip = `[${ip}]`; validIPs.add(ip); }
                            }
                        }
                    } catch (e) {}
                } else if (reqType === '优选') {
                    sourceName = '顶尖优选库(cf-speed-dns)';
                    const s = await extractIPsFromSource('https://raw.githubusercontent.com/ZhiXuanWang/cf-speed-dns/refs/heads/main/ipTop10.html');
                    s.forEach(i => validIPs.add(i));
                } else if (PRESET_SOURCES[reqType]) {
                    sourceName = PRESET_SOURCES[reqType].name;
                    const s = await extractIPsFromSource(PRESET_SOURCES[reqType].url);
                    s.forEach(i => validIPs.add(i));
                }
                const uniqueIPArray = Array.from(validIPs);
                for (let i = uniqueIPArray.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [uniqueIPArray[i], uniqueIPArray[j]] = [uniqueIPArray[j], uniqueIPArray[i]]; }
                return Response.json({ success: true, name: sourceName, ips: uniqueIPArray.slice(0, 10), totalCount: uniqueIPArray.length });
            } catch (error) { return Response.json({ success: false, error: error.message }, { status: 500 }); }
        }

        // ==========================================
        // 2.5 数据库路由管理 API 
        // ==========================================
        if (url.pathname === '/api/routes/reorder' && request.method === 'POST') {
if (ROLE !== 'admin') return new Response('Forbidden', { status: 403 });
                        if (!env.DB) return Response.json({ success: false, error: "未绑定 DB" });
            try {
                const items = await request.json(); 
                const stmts = items.map(item => env.DB.prepare('UPDATE routes SET sort_order = ? WHERE prefix = ?').bind(item.sort_order, item.prefix));
                await env.DB.batch(stmts);
                return Response.json({ success: true });
            } catch (e) { return Response.json({ success: false, error: e.message }); }
        }

        if (url.pathname === '/api/routes/import' && request.method === 'POST') {
if (ROLE !== 'admin') return new Response('Forbidden', { status: 403 });
                        if (!env.DB) return Response.json({ success: false, error: "未绑定 DB" });
            try {
                const routes = await request.json();
                for (const r of routes) {
                    if (r.prefix && r.target) {
                        await env.DB.prepare('INSERT OR REPLACE INTO routes (prefix, target, mode, remark, last_play, icon, custom_params, cache_img, sort_order, watch_limit, ka_enabled, ka_days, ka_token, node_user, node_pass, emos_id, emos_name, emos_aggregate) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
                            .bind(r.prefix, r.target, r.mode || 'off', r.remark || '', r.last_play || '', r.icon || '', r.custom_params || '', r.cache_img || 'on', r.sort_order || 0, r.watch_limit || '0', r.ka_enabled || '0', r.ka_days || '3', r.ka_token || '', r.node_user || '', r.node_pass || '', r.emos_id || '', r.emos_name || '', r.emos_aggregate === 'on' ? 'on' : 'off').run();
                    }
                }
                return Response.json({ success: true });
            } catch (e) { return Response.json({ success: false, error: e.message }); }
        }

        // ==========================================
        //  自动保活：手动执行（节点级，管理员）
        // ==========================================
        if (url.pathname === '/api/keepalive/status' && request.method === 'GET') {
            if (!env.DB) return Response.json({ running: false, queue: [], history: [], dlActive: 0 });
            try {
                const row = await env.DB.prepare('SELECT value FROM app_config WHERE key = ?').bind('ka_live').first();
                let live = { running: false, queue: [], history: [], dlActive: 0 };
                if (row && row.value) { try { live = JSON.parse(row.value); } catch (e) {} }
                const queue = await kaGetQueue(env);
                const history = await kaGetHistory(env);
                const dlActive = await kaDlActive(env);
                // ka_live 只是展示用的"最后状态",队列里没有 running 项时一律显示为未运行(避免卡片停留在"执行中")
                if (live.running && !(queue.items || []).some(i => i.status === 'running')) live.running = false;
                return Response.json(Object.assign({}, live, { queue: queue.items || [], history: history || [], dlActive: dlActive }));
            } catch (e) { return Response.json({ running: false, queue: [], history: [], dlActive: 0 }); }
        }

        if (url.pathname === '/api/keepalive/notices' && request.method === 'GET') {
            if (ROLE !== 'admin') return new Response('Forbidden', { status: 403 });
            let list = [];
            try {
                const row = await env.DB.prepare("SELECT value FROM app_config WHERE key = 'ka_notices'").first();
                if (row && row.value) list = JSON.parse(row.value);
            } catch (e) {}
            return Response.json({ notices: (list || []).slice(0, 20) });
        }

        // 手动取消单个保活任务(管理员):waiting 直接移除;running 移除并重置执行状态,DO 心跳感知后自行停流
        if (url.pathname === '/api/ka-cancel' && request.method === 'POST') {
            if (ROLE !== 'admin') return new Response('Forbidden', { status: 403 });
            try {
                if (!env.DB) return Response.json({ success: false, error: 'D1 未绑定' });
                const body = await request.json();
                const id = parseInt(body.id, 10);
                if (!id) return Response.json({ success: false, error: '参数错误' });
                let item = null;
                const cancelLock = await kaLockAcquire(env);
                try {
                    const q = await kaGetQueue(env);
                    const idx = q.items.findIndex(i => i.id === id);
                    if (idx < 0) return Response.json({ success: false, error: '任务不存在或已完成' });
                    item = q.items[idx];
                    q.items.splice(idx, 1);
                    await kaSaveQueue(env, q);
                } finally { await kaLockRelease(env, cancelLock); }
                if (item.status === 'running') {
                    try {
                        await env.DB.prepare('INSERT OR REPLACE INTO app_config (key, value) VALUES (?, ?)')
                          .bind('ka_live', JSON.stringify({ running: false, cancelled: true, prefix: item.prefix || '', current: '已被管理员取消', steps: [{ name: '手动取消', ok: false, detail: '管理员取消了该保活任务' }], progress: 100, mediaTitle: '', updatedAt: Date.now() })).run();
                    } catch (e) {}
                    await withKaLock(env, async () => {
                        const hist = await kaGetHistory(env);
                        hist.unshift({ prefix: item.prefix, kind: item.kind, ok: false, msg: '已被管理员取消', finishedAt: Date.now(), detail: '' });
                        if (hist.length > 60) hist.length = 60;
                        await kaSaveHistory(env, hist);
                    });
                }
                return Response.json({ success: true });
            } catch (e) { return Response.json({ success: false, error: e.message }); }
        }
        // 清空全部保活/下载任务(管理员):队列+当前执行+下载计数 全部清除
        if (url.pathname === '/api/ka-clear' && request.method === 'POST') {
            if (ROLE !== 'admin') return new Response('Forbidden', { status: 403 });
            try {
                if (!env.DB) return Response.json({ success: false, error: 'D1 未绑定' });
                let runningPrefix = '';
                await withKaLock(env, async () => {
                    const q = await kaGetQueue(env);
                    runningPrefix = (q.items.find(i => i.status === 'running') || {}).prefix || '';
                    q.items = [];
                    await kaSaveQueue(env, q);
                });
                try {
                    await env.DB.prepare('INSERT OR REPLACE INTO app_config (key, value) VALUES (?, ?)')
                      .bind('ka_live', JSON.stringify({ running: false, cancelled: true, prefix: runningPrefix, current: '队列已清空', steps: [{ name: '清空', ok: false, detail: '管理员清空了全部保活/下载任务' }], progress: 100, mediaTitle: '', updatedAt: Date.now() })).run();
                } catch (e) {}
                try { await kaDlCount(env, -999); } catch (e) {}
                return Response.json({ success: true });
            } catch (e) { return Response.json({ success: false, error: e.message }); }
        }

        if (url.pathname === '/api/keepalive/run' && request.method === 'POST') {
            if (ROLE !== 'admin') return new Response('Forbidden', { status: 403 });
            if (!env.DB) return Response.json({ success: false, error: '未绑定 D1 数据库' });
            try {
                const body = await request.json();
                const prefix = String((body && body.prefix) || '').trim();
                if (!prefix) return Response.json({ success: false, error: '缺少节点前缀' });
                const route = await env.DB.prepare('SELECT * FROM routes WHERE prefix = ?').bind(prefix).first();
                if (!route) return Response.json({ success: false, error: '节点不存在' });
                // v3.6.0:僵尸任务兜底——running 但 6 分钟无心跳(DO 最长 300s+清记录),视为卡死自动重置
                try {
                    const curRow = await env.DB.prepare("SELECT value FROM app_config WHERE key = ?").bind('ka_live').first();
                    if (curRow && curRow.value) {
                        const curSt = JSON.parse(curRow.value);
                        if (curSt && curSt.running && curSt.updatedAt && Date.now() - curSt.updatedAt > 360000) {
                            await env.DB.prepare('INSERT OR REPLACE INTO app_config (key, value) VALUES (?, ?)')
                                .bind('ka_live', JSON.stringify({ running: false, prefix: curSt.prefix || '', current: '', steps: curSt.steps || [], msg: '检测到卡死的保活状态,已自动重置(上一次任务未正常收尾)', progress: 100, mediaTitle: '', updatedAt: Date.now() })).run();
                        }
                    }
                } catch (e) {}
                // v3.6.0:入队(同节点已在队列/执行中则自动去重),由 maybeAdvanceQueue 按卡片顺序串行执行
                const wasQueued = await kaEnqueue(env, prefix, 'manual');
                await maybeAdvanceQueue(env);
                const q = await kaGetQueue(env);
                const head = q.items[0] || null;
                const inQueue = q.items.findIndex(i => i.prefix === prefix);
                return Response.json({
                    success: true,
                    queued: inQueue >= 0,
                    queuePos: inQueue,
                    queueLen: q.items.length,
                    headPrefix: head ? head.prefix : '',
                    msg: (inQueue === 0 ? '已开始执行' : '已加入保活队列,前方还有 ' + inQueue + ' 个任务') + (wasQueued ? '' : '(该节点已在队列/执行中)')
                });
            } catch (e) {
                return Response.json({ success: false, error: '保活执行异常: ' + e.message });
            }
        }

        if (url.pathname.startsWith('/api/routes')) {
            if (!env.DB) return Response.json({ error: "由于未绑定 D1 数据库，反代功能不可用。" }, { status: 500 });

            // —— v3.6.54:提取源站域名(去协议/端口/路径,兼容 IP 与 IPv6 [x] 写法),供后缀占用/域名重复检测与搜索使用(同步普通版 3.4.46/48)——
            function extractDomain(target) {
                if (!target) return '';
                let t = String(target).trim();
                t = t.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, '');
                t = t.split('/')[0];
                if (t.startsWith('[') && t.includes(']')) t = t.slice(0, t.indexOf(']') + 1);
                t = t.replace(/:\d+$/, '');
                return t.toLowerCase();
            }

            // —— 提速:路由表 schema 初始化(建表/加列)仅首次执行,后续请求直接查表 ——
            if (!routesSchemaReady) {
                await env.DB.exec(`CREATE TABLE IF NOT EXISTS routes (prefix TEXT PRIMARY KEY, target TEXT NOT NULL)`);
                await env.DB.exec(`CREATE TABLE IF NOT EXISTS node_requests (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, url TEXT, domain TEXT, user TEXT, status TEXT DEFAULT 'pending', created_at TEXT DEFAULT CURRENT_TIMESTAMP)`);
                await env.DB.exec(`CREATE TABLE IF NOT EXISTS request_stats (prefix TEXT, date TEXT, count INTEGER DEFAULT 0, PRIMARY KEY(prefix, date))`);
                // 大数据记录核心表：访客日志
                await env.DB.exec(`CREATE TABLE IF NOT EXISTS visitor_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, prefix TEXT, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP, ip TEXT, country TEXT, ua TEXT)`);
                // v4.0.0:播放热力图表(节点×日期×小时)
                await env.DB.exec(`CREATE TABLE IF NOT EXISTS play_hits (prefix TEXT, day TEXT, hour INTEGER, cnt INTEGER DEFAULT 1, PRIMARY KEY(prefix, day, hour))`);
                // v3.6.5:下载记录表(30 天滚动)
                try { await env.DB.exec(`ALTER TABLE routes ADD COLUMN mode TEXT DEFAULT 'off'`); } catch(e) {}
                try { await env.DB.exec(`ALTER TABLE routes ADD COLUMN remark TEXT DEFAULT ''`); } catch(e) {}
                try { await env.DB.exec(`ALTER TABLE routes ADD COLUMN last_play TEXT DEFAULT ''`); } catch(e) {}
                try { await env.DB.exec(`ALTER TABLE routes ADD COLUMN icon TEXT DEFAULT ''`); } catch(e) {}
                try { await env.DB.exec(`ALTER TABLE routes ADD COLUMN cache_img TEXT DEFAULT 'on'`); } catch(e) {} 
                try { await env.DB.exec(`ALTER TABLE routes ADD COLUMN custom_params TEXT DEFAULT ''`); } catch(e) {} 
                try { await env.DB.exec(`ALTER TABLE routes ADD COLUMN sort_order INTEGER DEFAULT 0`); } catch(e) {} 
                try { await env.DB.exec(`ALTER TABLE routes ADD COLUMN ka_enabled TEXT DEFAULT '0'`); } catch(e) {}
                try { await env.DB.exec(`ALTER TABLE routes ADD COLUMN ka_days TEXT DEFAULT '3'`); } catch(e) {}
                try { await env.DB.exec(`ALTER TABLE routes ADD COLUMN ka_token TEXT DEFAULT ''`); } catch(e) {}
                try { await env.DB.exec(`ALTER TABLE routes ADD COLUMN node_user TEXT DEFAULT ''`); } catch(e) {}
                try { await env.DB.exec(`ALTER TABLE routes ADD COLUMN node_pass TEXT DEFAULT ''`); } catch(e) {}
                try { await env.DB.exec(`ALTER TABLE routes ADD COLUMN last_ka_run TEXT DEFAULT ''`); } catch(e) {}
                try { await env.DB.exec(`ALTER TABLE routes ADD COLUMN last_ka_result TEXT DEFAULT ''`); } catch(e) {}
                try { await env.DB.exec(`ALTER TABLE routes ADD COLUMN last_ka_detail TEXT DEFAULT ''`); } catch(e) {}
                try { await env.DB.exec(`ALTER TABLE routes ADD COLUMN watch_limit TEXT DEFAULT '0'`); } catch(e) {}
                try { await env.DB.exec(`ALTER TABLE routes ADD COLUMN emos_id TEXT DEFAULT ''`); } catch(e) {}
                try { await env.DB.exec(`ALTER TABLE routes ADD COLUMN emos_name TEXT DEFAULT ''`); } catch(e) {}
                try { await env.DB.exec(`ALTER TABLE routes ADD COLUMN emos_aggregate TEXT DEFAULT 'off'`); } catch(e) {}
                routesSchemaReady = true;
            }
if (request.method !== 'GET' && ROLE !== 'admin') return new Response('Forbidden', { status: 403 });
            
            // 数据防爆清理策略：自动清理过去 7 天的精细日志(限频 10 分钟一次)
            if (Date.now() - lastLogsCleanAt > 600000) {
                try { await env.DB.exec(`DELETE FROM visitor_logs WHERE timestamp < datetime('now', '-7 days')`); } catch(e) {}
                // v3.6.70:播放热力图保留 30 天(day 为 UTC+8 日期串,字符串比较小于 30 天前即删)
                try {
                    const cutDay = new Date(Date.now() + 8 * 3600000 - 30 * 86400000).toISOString().split('T')[0];
                    await env.DB.prepare(`DELETE FROM play_hits WHERE day < ?`).bind(cutDay).run();
                } catch(e) {}
                lastLogsCleanAt = Date.now();
            }

            //  【方案A修复版】：独立并发查流，完美绕过 CF 免费版复杂度限制！
            if (request.method === 'GET') {
                const todayStr = new Date(Date.now() + 8 * 3600000).toISOString().split('T')[0];
                let { results: routes } = await env.DB.prepare(`
                    SELECT r.*, 
                    IFNULL(s.count, 0) as todayReqs,
                    (SELECT SUM(count) FROM request_stats WHERE prefix = r.prefix) as totalReqs
                    FROM routes r 
                    LEFT JOIN request_stats s ON r.prefix = s.prefix AND s.date = ? 
                    ORDER BY r.sort_order ASC, r.prefix ASC
                `).bind(todayStr).all();

                // —— v3.6.54:搜索参数 q(服务端按源站链接/域名/备注/后缀匹配;订阅用户看不到 target 也能用链接搜出节点,返回仍剥离 target 不泄露,同步普通版 3.4.48)——
                const searchQ = (url.searchParams.get('q') || '').trim().toLowerCase();
                if (searchQ) {
                    const qDomain = extractDomain(searchQ);
                    routes = routes.filter(r => {
                        const t = String(r.target || '').toLowerCase();
                        const tDomain = extractDomain(r.target);
                        if (t && t.includes(searchQ)) return true;
                        if (qDomain && tDomain && tDomain.includes(qDomain)) return true;
                        if (String(r.remark || '').toLowerCase().includes(searchQ)) return true;
                        if (String(r.prefix || '').toLowerCase().includes(searchQ)) return true;
                        return false;
                    });
                }

                if (ROLE === 'admin' && env.CF_API_TOKEN && env.CF_ZONE_ID && routes && routes.length > 0) {
                    const end = new Date();
                    const beijingTime = new Date(end.getTime() + 8 * 3600000);
                    beijingTime.setUTCHours(0, 0, 0, 0);
                    const start = new Date(beijingTime.getTime() - 8 * 3600000);
                    const nowTs = Date.now();

                    // —— 提速:带宽统计结果内存缓存 2 分钟,避免每次打开面板都并发打 CF GraphQL ——
                    // 并发限制同时 8 个 + 20 秒超时 + 失败自动重试 1 次(300ms 退避),修复节点多时大面积「获取异常」(v3.6.54 同步普通版 3.4.47,勿再收紧参数)
                    const pending = routes.filter(r => {
                        const hit = bandwidthCache.get(r.prefix);
                        if (hit && hit.expires > nowTs) { r.todayBandwidth = hit.value; return false; }
                        return true;
                    });
                    let cursor = 0;
                    async function fetchNodeBytes(prefix, geq, leq) {
                        const q = { query: `query {
                              viewer {
                                zones(filter: {zoneTag: "${env.CF_ZONE_ID}"}) {
                                  httpRequestsAdaptiveGroups(
                                    limit: 1,
                                    filter: {
                                      clientRequestPath_like: "/${prefix}%",
                                      datetime_geq: "${geq}",
                                      datetime_leq: "${leq}"
                                    }
                                  ) {
                                    sum { edgeResponseBytes }
                                  }
                                }
                              }
                            }` };
                        for (let attempt = 0; attempt < 2; attempt++) {
                            try {
                                const cfRes = await fetch('https://api.cloudflare.com/client/v4/graphql', {
                                    method: 'POST',
                                    headers: { 'Authorization': `Bearer ${env.CF_API_TOKEN}`, 'Content-Type': 'application/json' },
                                    body: JSON.stringify(q),
                                    signal: AbortSignal.timeout(20000)
                                });
                                const cfData = await cfRes.json();
                                if (cfData && cfData.data) return cfData.data?.viewer?.zones?.[0]?.httpRequestsAdaptiveGroups?.[0]?.sum?.edgeResponseBytes || 0;
                                if (attempt === 0) await new Promise(res => setTimeout(res, 300));
                            } catch (e) {
                                if (attempt === 0) await new Promise(res => setTimeout(res, 300));
                            }
                        }
                        return null;
                    }
                    async function bwWorker() {
                        while (cursor < pending.length) {
                            const r = pending[cursor++];
                            const bytes = await fetchNodeBytes(r.prefix, start.toISOString(), end.toISOString());
                            if (bytes === null) { r.todayBandwidth = "获取异常"; continue; }
                            let formatted = "0 B";
                            if (bytes >= 1099511627776) formatted = (bytes / 1099511627776).toFixed(2) + " TB";
                            else if (bytes >= 1073741824) formatted = (bytes / 1073741824).toFixed(2) + " GB";
                            else if (bytes >= 1048576) formatted = (bytes / 1048576).toFixed(2) + " MB";
                            else if (bytes >= 1024) formatted = (bytes / 1024).toFixed(2) + " KB";
                            else if (bytes > 0) formatted = bytes + " B";
                            r.todayBandwidth = formatted;
                            bandwidthCache.set(r.prefix, { expires: nowTs + BANDWIDTH_CACHE_TTL, value: formatted });
                        }
                    }
                    await Promise.all(Array.from({ length: Math.min(8, pending.length) }, bwWorker));
                }
                
                // 订阅者不可见源站链接（target 字段剥离，防止直接调 API 查看源站）
                if (ROLE === 'sub' && Array.isArray(routes)) {
                    routes = routes.map(r => { const c = { ...r }; delete c.target; return c; });
                }
                return Response.json(routes || []);
            }
            
            if (request.method === 'POST') {
                const data = await request.json();
                if (isReservedSuffix(data.prefix)) return Response.json({ success: false, error: '该后缀已被系统保留占用（如 entry），请更换' });
                // —— v3.6.54:后缀占用检查(新增/改名时若目标后缀已被其他节点占用,直接拒绝,防止 INSERT OR REPLACE 静默覆盖旧节点;同步普通版 3.4.46)——
                const prefixConflict = await env.DB.prepare('SELECT prefix FROM routes WHERE prefix = ?').bind(data.prefix).first();
                if (prefixConflict && prefixConflict.prefix !== data.oldPrefix) {
                    return Response.json({ success: false, error: '该后缀已被占用（/' + prefixConflict.prefix + '），请更换后缀' });
                }
                // —— v3.6.54:源站域名重复检查(仅新增执行,编辑/批量改模式跳过以免历史重复节点误拦;去协议/端口/路径后比较域名,订阅用户换后缀/换名字重复添加同源站会被拦;提示带节点名字,同步普通版 3.4.46/48)——
                if (!data.oldPrefix && String(data.target || '').trim()) {
                    const tDomains = String(data.target || '').split(',').map(t => extractDomain(t)).filter(Boolean);
                    if (tDomains.length > 0) {
                        const allRouteRows = (await env.DB.prepare('SELECT prefix, target, remark FROM routes').all()).results || [];
                        for (const td of tDomains) {
                            const hit = allRouteRows.find(r => extractDomain(r.target) === td);
                            if (hit) return Response.json({ success: false, error: '已存在相同源站链接的节点「' + (hit.remark || hit.prefix) + '」(/' + hit.prefix + ')，请勿重复添加' });
                        }
                    }
                }
                let currentSortOrder = 0;
                if (data.oldPrefix && data.oldPrefix !== data.prefix) {
                    const oldRow = await env.DB.prepare('SELECT sort_order FROM routes WHERE prefix = ?').bind(data.oldPrefix).first();
                    if(oldRow) currentSortOrder = oldRow.sort_order;
                    await env.DB.prepare('DELETE FROM routes WHERE prefix = ?').bind(data.oldPrefix).run();
                } else {
                    const oldRow = await env.DB.prepare('SELECT sort_order, ka_enabled FROM routes WHERE prefix = ?').bind(data.prefix).first();
                    if(oldRow) currentSortOrder = oldRow.sort_order;
                }
                // v3.6.4:记住保存前自动保活是否已开启(用于"刚开启即入队")
                let wasKaOn = false;
                try {
                    const prevRow = await env.DB.prepare('SELECT ka_enabled FROM routes WHERE prefix = ?').bind(data.prefix).first();
                    wasKaOn = !!(prevRow && String(prevRow.ka_enabled) === '1');
                } catch (e) {}
                
                const custom_params = JSON.stringify({
                    client: data.customClient || '',
                    version: data.customVersion || '',
                    device: data.customDevice || '',
                    deviceId: data.customDeviceId || genUuid(),
                    ua: data.customUa || '',
                    dlTrick: data.dlTrick === '1'
                });

                // v3.6.57:伪装版已移除 EMOS/EMOS+伪装 模式——保存时自动归一(emos→保守 off,emos_fake→保守+伪装 off_fake),前端已无可选入口
                let saveMode = data.mode || 'off';
                if (saveMode === 'emos') saveMode = 'off';
                else if (saveMode === 'emos_fake') saveMode = 'off_fake';

                await env.DB.prepare('INSERT OR REPLACE INTO routes (prefix, target, mode, remark, icon, custom_params, cache_img, sort_order, ka_enabled, ka_days, ka_token, node_user, node_pass, watch_limit, emos_id, emos_name, emos_aggregate) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
                    .bind(data.prefix, data.target, saveMode, data.remark || '', data.icon || '', custom_params, data.cache_img || 'on', currentSortOrder, data.kaEnabled || '0', data.kaDays || '3', data.kaToken || '', data.nodeUser || '', data.nodePass || '', data.watchLimit || '0', data.emosId || '', data.emosName || '', data.emosAggregate === 'on' ? 'on' : 'off').run();
                // v3.6.4:勾选「开启自动保活」保存后立即入队执行第一次,不用再手动触发一次
                try {
                    const savedKaOn = String(data.kaEnabled || '0') === '1';
                    if (savedKaOn && !wasKaOn) {
                        await kaEnqueue(env, String(data.prefix), 'auto');
                        await maybeAdvanceQueue(env);
                    }
                } catch (e) {}
                return Response.json({ success: true });
            }
            
            if (request.method === 'DELETE') {
                const prefix = url.searchParams.get('prefix'); await env.DB.prepare('DELETE FROM routes WHERE prefix = ?').bind(prefix).run(); return Response.json({ success: true });
            }
            return new Response("Method not allowed", { status: 405 });
        }

        // ==========================================
        // 2.6 核心反代与调度引擎（修播放）
        // ==========================================
        let targetUrls = []; let currentMode = 'off'; let enableCache = true; let remainingPath = '';
        let decodedPath = url.pathname; try { decodedPath = decodeURIComponent(url.pathname); } catch (e) { decodedPath = url.pathname; } let matchedPrefix = null; 
        let proxyOrigin = new URL(request.url).origin;
        let customParamsObj = {};
        let dlTrick = false; let dlTrickItemId = '';

        // 反代 Token 门禁：开启后代理路径必须带 /密钥/ 前缀
        if (!url.pathname.startsWith('/api/') && url.pathname !== '/') {
            const pt = await getProxyToken(env);
            if (pt && pt.enabled && pt.key) {
                const prefixPath = '/' + pt.key + '/';
                let stripped = null;
                if (decodedPath === '/' + pt.key) stripped = '/';
                else if (decodedPath.indexOf(prefixPath) === 0) stripped = decodedPath.slice(prefixPath.length - 1);
                if (stripped === null) {
                    await recordProxyHit(env, request, decodedPath);
                    return Response.redirect(new URL('/catch', proxyOrigin), 302);
                }
                decodedPath = stripped;
            }
        }

        // 判断哪些请求可以按静态资源处理。
        // 这里把 Emby/Jellyfin 常见图片目录也纳入判断，是因为 UHD 海报/Backdrop
        // 不一定总带标准图片后缀；如果只按 .jpg/.webp 等后缀识别，部分图片请求会被当成普通接口，
        // 后续重定向、缓存和源站防盗链处理策略就可能不匹配，导致高清图加载失败。
        function isStaticPath(pathname) {
            return /\.(jpg|jpeg|gif|png|svg|ico|webp|js|css|woff2?|ttf|otf|map|webmanifest|srt|ass|vtt|sub)$/i.test(pathname)
                || /(\/Images\/|\/Icons\/|\/Branding\/|\/emby\/covers\/|\/img\/)/i.test(pathname);
        }

        // 判断当前请求是否携带登录态或访问令牌。
        // 带鉴权信息的图片/API 不能盲目交给 Cloudflare 长缓存，否则不同用户、不同 token
        // 可能命中同一份缓存，轻则拿到过期图片，重则造成串号风险。UHD 图片经常带 api_key
        // 或 X-Emby-Token，这里专门识别出来，让这类请求继续按源站实时响应处理。
        function hasAuthLikeState(headers, targetUrl) {
            const authQueryKeys = ['api_key', 'x-emby-token', 'x-mediabrowser-token', 'access_token', 'token'];
            const hasAuthQuery = Array.from(targetUrl.searchParams.keys()).some(key => authQueryKeys.includes(key.toLowerCase()));
            return headers.has("Authorization")
                || headers.has("X-Emby-Token")
                || headers.has("X-MediaBrowser-Token")
                || headers.has("X-Emby-Authorization")
                || headers.has("Cookie")
                || hasAuthQuery;
        }

        function stripPanelCookie(headers) {
            const cookie = headers.get("Cookie");
            if (!cookie) return;
            const keptCookies = cookie.split(";").map(item => item.trim()).filter(item => item && !item.toLowerCase().startsWith("admin_token="));
            if (keptCookies.length > 0) headers.set("Cookie", keptCookies.join("; "));
            else headers.delete("Cookie");
        }

        function rewriteSetCookieForProxy(headers) {
            const getSetCookie = headers.getSetCookie ? headers.getSetCookie.bind(headers) : null;
            const rawSetCookie = headers.get("Set-Cookie");
            const cookies = getSetCookie ? getSetCookie() : (rawSetCookie ? rawSetCookie.split(/,(?=\s*[^;,]+=)/g) : []);
            if (cookies.length === 0) return;
            headers.delete("Set-Cookie");
            for (const cookie of cookies) headers.append("Set-Cookie", cookie.replace(/;\s*Domain=[^;]*/ig, ""));
        }

        // 收集所有源站 origin，并同时加入 http/https 的互换版本。
        // 实际返回的 JSON 里可能混用 http 与 https，例如线路配置是 https，
        // 但 Emby 返回的图片地址仍是 http。两个 origin 都纳入重写范围，
        // 才能避免 UHD 图片直连源站而绕过当前 Worker 代理。
        function getTargetOrigins(targets) {
            const origins = [];
            for (const target of targets) {
                try {
                    const parsed = new URL(target);
                    const origin = parsed.origin;
                    const alternateOrigin = (parsed.protocol === 'https:' ? 'http:' : 'https:') + '//' + parsed.host;
                    if (!origins.includes(origin)) origins.push(origin);
                    if (!origins.includes(alternateOrigin)) origins.push(alternateOrigin);
                } catch (e) {}
            }
            return origins;
        }

        // 把源站返回的图片/媒体 URL 改写成当前 Worker 代理 URL。
        // 修复 UHD 图片加载失败的核心原因在这里：部分接口返回的是绝对源站地址，
        // 浏览器会直接去访问源站，导致跨域、鉴权、源站不可达或被防盗链拦截。
        // 改写后所有图片请求都会重新经过 Worker，由 Worker 带着正确 header 转发到源站。
        function rewriteSourceUrlString(value, targetOrigins, proxyOrigin, safePrefix) {
            let rewritten = value;
            const proxyPrefix = proxyOrigin + safePrefix + '/';
            for (const origin of targetOrigins) {
                let result = '';
                let cursor = 0;
                let index = rewritten.indexOf(origin);
                while (index !== -1) {
                    // 避免重复代理：如果地址已经是 Worker 前缀 + 源站 URL，
                    // 再追加一次会变成 /proxy/https://worker/proxy/http://origin 这类坏地址。
                    const alreadyProxied = rewritten.substring(Math.max(0, index - proxyPrefix.length), index) === proxyPrefix;
                    result += rewritten.substring(cursor, index);
                    result += alreadyProxied ? origin : proxyPrefix + origin;
                    cursor = index + origin.length;
                    index = rewritten.indexOf(origin, cursor);
                }
                if (cursor > 0) {
                    result += rewritten.substring(cursor);
                    rewritten = result;
                }
            }
            // 部分 UHD 图片接口返回相对路径，例如 /Items/{id}/Images/Primary。
            // 这类地址没有 origin，前面的绝对 URL 替换匹配不到，所以需要单独补上
            // Worker origin 和当前线路前缀，保证浏览器不会请求到面板根路径或错误节点。
            const relativeImagePattern = /(^|["'\s(])((?:\/img\/|\/emby\/Items\/[^"'\s)]+\/Images\/|\/Items\/[^"'\s)]+\/Images\/)[^"'\s)]*)/ig;
            rewritten = rewritten.replace(relativeImagePattern, (match, prefix, path) => {
                if (safePrefix && path.startsWith(safePrefix + '/')) return match;
                return prefix + proxyOrigin + safePrefix + path;
            });
            return rewritten;
        }

        // 递归处理 JSON 里的所有字符串字段。
        // UHD 图片地址不固定出现在某一个字段，可能藏在 ImageTags、BackdropImageTags、
        // Artwork、ProviderIds 或插件返回的嵌套对象里；只改顶层字段会漏掉一部分高清图。
        function rewriteSourceUrlsInJson(value, targetOrigins, proxyOrigin, safePrefix) {
            if (typeof value === 'string') return rewriteSourceUrlString(value, targetOrigins, proxyOrigin, safePrefix);
            if (Array.isArray(value)) {
                let changed = false;
                const next = value.map(item => {
                    const rewritten = rewriteSourceUrlsInJson(item, targetOrigins, proxyOrigin, safePrefix);
                    if (rewritten !== item) changed = true;
                    return rewritten;
                });
                return changed ? next : value;
            }
            if (value && typeof value === 'object') {
                let changed = false;
                const next = {};
                for (const key of Object.keys(value)) {
                    const rewritten = rewriteSourceUrlsInJson(value[key], targetOrigins, proxyOrigin, safePrefix);
                    if (rewritten !== value[key]) changed = true;
                    next[key] = rewritten;
                }
                return changed ? next : value;
            }
            return value;
        }

        // 响应体被重写后必须移除这些和原始 body 强绑定的头。
        // 如果继续保留旧的 Content-Length/Content-Encoding/ETag，浏览器或中间缓存可能按旧长度、
        // 旧压缩格式校验新内容，表现为 JSON 截断、解压失败或缓存了未改写的图片 URL。
        function dropBodyIntegrityHeaders(headers) {
            headers.delete("Content-Length");
            headers.delete("Content-Encoding");
            headers.delete("ETag");
        }

        // 只有发现源站 URL 或典型图片相对路径时才解析并重写 JSON。
        // 这样可以避免每个普通 JSON 响应都做深度遍历，降低 Worker 开销；
        // 同时也确保包含 UHD 图片地址的响应不会被漏过。
        function hasJsonRewriteCandidate(text, targetOrigins) {
            return targetOrigins.some(origin => text.includes(origin))
                || /(^|["'\s(])(?:\/img\/|\/emby\/Items\/[^"'\s)]+\/Images\/|\/Items\/[^"'\s)]+\/Images\/)/i.test(text);
        }

        function rewriteRedirectLocation(location, targetUrl, targetOrigins, proxyOrigin, safePrefix) {
            if (!location) return location;
            if (location.startsWith('//')) {
                try {
                    const protocol = targetUrl ? targetUrl.protocol : new URL(targetOrigins[0]).protocol;
                    location = protocol + location;
                } catch (e) {}
            }
            if (location.startsWith('/')) {
                if (safePrefix && location.startsWith(safePrefix + '/')) return proxyOrigin + location;
                if (!safePrefix && targetUrl) return `${proxyOrigin}/${encodeURIComponent(new URL(location, targetUrl.origin).href)}`;
                return proxyOrigin + safePrefix + location;
            }
            try {
                const parsed = new URL(location);
                if (targetOrigins.includes(parsed.origin)) {
                    if (!safePrefix) return `${proxyOrigin}/${encodeURIComponent(location)}`;
                    return proxyOrigin + safePrefix + parsed.pathname + parsed.search + parsed.hash;
                }
            } catch (e) {}
            if (/^https?:\/\//i.test(location)) {
                // 跨源 Location:面板/前缀/encodeURIComponent(完整URL),与 Lite 参考实现一致。
                // 编码可避免 URL 内裸 ? & # 在响应头/二次请求时被解析错乱。
                return `${proxyOrigin}${safePrefix}/${encodeURIComponent(location)}`;
            }
            // 非 http(s) 或无法解析的 Location:降级为保留原值,不下发代理改写
            // (曾直接删除,部分服务器裸 Location 被丢弃导致播放断流,回退为历史行为)
            return location;
        }

        // 判断当前请求路径是否像 Emby / Jellyfin 体系的 API 或静态资源路径。
        // 这一步是给 UHD / HUD 这类“服务真实挂在 /emby 子路径下，但线路里只填了裸域名”的场景兜底用的。
        // 例如客户端请求 /uhd/Items/{id}/PlaybackInfo，当前脚本会先转发到源站的 /Items/{id}/PlaybackInfo。
        // 如果 HUD 实际服务入口是 /emby/Items/{id}/PlaybackInfo，那么源站通常会直接回 404。
        //
        // 普通 Emby 有两种常见部署方式：
        // 1. 根路径部署，API 就在 /Items /Videos /Sessions 下
        // 2. 子路径部署，API 在 /emby/Items /emby/Videos /emby/Sessions 下
        //
        // 之前脚本完全依赖面板里手动把 target 写成带 /emby 的完整地址；
        // 只要这一步没填对，普通首页可能还能打开，但播放相关接口会在拿 PlaybackInfo 时 404。
        // 这里加的是“只在像 Emby API 的路径上才启用”的保守识别，避免把其他完全无关的网站路径误补成 /emby。
        function isLikelyMediaServerPath(pathname) {
            return /^\/(?:Items|Videos|Audio|Sessions|Users|System|Library|LiveTv|Shows|Movies|Artists|Albums|Playlists|Channels|Packages|Devices|Socket|socket|web|emby|Images|Branding|Environment|DisplayPreferences|Trailers|Collections|Genres|Persons|Studios|Years)(?:\/|$)/i.test(pathname);
        }

        // 为单个 target 生成候选上游 URL。
        // 第一候选始终保持原行为，完全按“target + remainingPath”拼接。
        // 第二/第三候选只在以下条件满足时追加：
        // - 线路 target 本身没有子路径（说明面板里大概率填的是裸域名）
        // - 当前请求像 Emby API/资源路径
        //
        // 这里同时兼容两类常见偏差：
        // 1. 实际服务挂在 /emby 下，但客户端请求的是 /Items /Videos ...
        //    -> 自动补成 /emby/Items /emby/Videos
        // 2. 实际服务挂在根路径，但客户端自己固定补了 /emby/Items /emby/Videos
        //    -> 自动再试一次去掉 /emby 前缀后的 /Items /Videos
        //
        // 这样普通 Emby 和 HUD/UHD Emby 都可以在同一节点内完成“加 /emby”或“去 /emby”的双向回退，
        // 避免某些客户端因为固定拼接 /emby 而只在部分服务器上失效。
        function buildUpstreamCandidates(targetBase, remainingPath, search) {
            const candidates = [];
            const pushUnique = (value) => {
                if (value && !candidates.includes(value)) candidates.push(value);
            };

            const primary = targetBase + remainingPath + search;
            pushUnique(primary);

            try {
                const parsed = new URL(targetBase);
                const basePath = (parsed.pathname || '/').replace(/\/+$/, '') || '/';
                const requestPath = remainingPath || '/';

                // 只有当 target 本身没有配置任何子路径时，才尝试 /emby 回退。
                // 如果用户已经明确把线路写成了 https://host/emby，再补一次会变成 /emby/emby/...，
                // 这反而会把原本正确的请求打坏，所以这里必须先判断 basePath 是根路径。
                const hasNoBasePath = (basePath === '/');
                const requestAlreadyHasEmbyPrefix = /^\/emby(?:\/|$)/i.test(requestPath);

                if (hasNoBasePath && !requestAlreadyHasEmbyPrefix && isLikelyMediaServerPath(requestPath)) {
                    pushUnique(`${parsed.origin}/emby${requestPath}${search}`);
                }

                // 反向回退：
                // 某些客户端会固定把媒体/接口地址补成 /emby/...，但普通 Emby 真实入口其实在根路径。
                // 例如 PlaybackInfo 被客户端请求成 /emby/videos/...，源站根路径部署时会 404，
                // 这时自动再试一次去掉 /emby 前缀后的 /videos/...。
                if (hasNoBasePath && requestAlreadyHasEmbyPrefix && isLikelyMediaServerPath(requestPath)) {
                    const strippedRequestPath = requestPath.replace(/^\/emby(?=\/|$)/i, '') || '/';
                    pushUnique(`${parsed.origin}${strippedRequestPath}${search}`);
                }

                // 兼容“绝对 URL 透传”场景。
                // 你这次抓到的请求已经不是 /uhd/Items/...，而是：
                // /uhd/https://v1.uhdnow.com/Items/{id}/PlaybackInfo?... 
                //
                // 这说明客户端拿到的 PlaybackInfo 返回里已经是一个绝对地址，
                // Worker 也确实按“绝对 URL 反代”逻辑在工作；但问题是这个绝对地址本身少了 /emby，
                // 所以当前逻辑会老老实实去请求：
                // https://v1.uhdnow.com/Items/{id}/PlaybackInfo
                // 然后被源站 nginx 回 404。
                //
                // 这里额外补一个候选：
                // 如果 targetBase 自己已经是完整绝对 URL，且它的 pathname 看起来像 Emby API，
                // 但 pathname 又不是以 /emby 开头，那么自动再试一次：
                // https://host/emby + pathname
                //
                // 这样不管请求来自“线路前缀模式”还是“绝对 URL 透传模式”，
                // 只要真实上游挂在 /emby 子路径下，都能在同一节点内完成回退。
                const targetAlreadyHasEmbyPrefix = /^\/emby(?:\/|$)/i.test(parsed.pathname || '/');
                if (!targetAlreadyHasEmbyPrefix && isLikelyMediaServerPath(parsed.pathname || '/')) {
                    const passthroughSearch = parsed.search || search;
                    pushUnique(`${parsed.origin}/emby${parsed.pathname}${passthroughSearch}${parsed.hash || ''}`);
                }

                // 对“绝对 URL 透传”同样做一次反向 /emby 去除回退。
                // 这样如果客户端缓存/拼接出来的是 https://host/emby/videos/...，
                // 而真实普通 Emby 在根路径 /videos/...，当前节点内也能自动修复。
                //
                // 注意这里仍然是“补一个低优先级候选”，不会抢在原始 /emby 路径前面。
                // 所以 UHD/HUD 如果真实就是 /emby 子路径部署，主候选仍然会先命中；
                // 只有主候选失败后，才会尝试去掉 /emby，避免把原本正常的 UHD 路径扰乱。
                if (targetAlreadyHasEmbyPrefix && isLikelyMediaServerPath(parsed.pathname || '/')) {
                    const passthroughSearch = parsed.search || search;
                    const strippedPathname = (parsed.pathname || '/').replace(/^\/emby(?=\/|$)/i, '') || '/';
                    pushUnique(`${parsed.origin}${strippedPathname}${passthroughSearch}${parsed.hash || ''}`);
                }
            } catch (e) {}

            return candidates;
        }

        // 把 PlaybackInfo 里的媒体地址统一规范成“Worker 前缀下的根路径相对地址”。
        //
        // 这里不再按某个客户端做特判，而是尽量保留 Emby 原生字段的共同语义：
        // - 很多客户端期望拿到的是 path，而不是完整绝对 URL
        // - 但如果 path 里不带当前线路前缀，客户端一旦直接请求 /videos 或 /emby/videos，
        //   就会绕过 /{prefix}/... 这条代理路由，导致播放失败
        //
        // 因此统一输出为：
        // /{prefix} + 源站原始 path
        //
        // 例如：
        // - 源站是 /videos/...       -> /{prefix}/videos/...
        // - 源站是 /emby/videos/... -> /{prefix}/emby/videos/...
        //
        // 这里特意保留“源站原始 path”而不是强行统一成某一种固定格式，
        // 是因为你这次抓到的普通 Emby 和 UHD/HUD PlaybackInfo 都表明：
        // - API 请求常常走 /emby/Items/... /emby/Sessions/...
        // - 真正媒体直链 DirectStreamUrl 常常却是 /videos/...
        //
        // 也就是说，/emby 更像是 API 基路径，而 /videos 才是媒体流路径；
        // 如果在这里想当然地把媒体地址补成 /emby/videos/...，反而会把原本正确的普通 Emby 直链改坏。
        //
        // 这样可以同时兼容三类常见用法：
        // 1. 直接把字段当请求地址使用：会命中当前线路
        // 2. 浏览器按 root-relative 解析：仍然会命中当前线路
        // 3. 客户端拿到 path 后再自行拼 serverUrl：如果拼出了重复 prefix，
        //    后面的 normalizeRemainingPathForPlayback 会在入口做一次轻量修正
        function toWorkerPlaybackPath(pathname, search = '', hash = '', safePrefix = '') {
            const normalizedPath = pathname.startsWith('/') ? pathname : `/${pathname}`;
            return `${safePrefix}${normalizedPath}${search || ''}${hash || ''}`;
        }

        function rewritePlaybackMediaUrl(rawValue, targetUrl, proxyOrigin, safePrefix, targetOrigins) {
            if (typeof rawValue !== 'string') return rawValue;
            const trimmedValue = rawValue.trim();
            if (!trimmedValue) return rawValue;

            // 如果字段已经被改成当前 Worker 前缀下的路径，直接复用，避免重复叠加 prefix。
            if (safePrefix && trimmedValue.startsWith(safePrefix + '/')) return rawValue;

            // 某些客户端会缓存上一次的 PlaybackInfo，拿到的是完整 Worker 绝对地址。
            // 这里把它还原成 root-relative，继续保持“字段值是 path”的通用语义。
            if (safePrefix && trimmedValue.startsWith(proxyOrigin + safePrefix + '/')) {
                return trimmedValue.substring(proxyOrigin.length);
            }

            // 对绝对地址分两类处理：
            // 1. 同源绝对地址：保留源站原始 path，只在前面补 /{prefix}
            // 2. 跨源绝对地址：保留成 Worker 的“绝对 URL 透传代理”形式
            //
            // HUD / FWD 一类自研服务有时会在 PlaybackInfo 中返回完整绝对媒体地址，
            // 甚至媒体 host 与 API host 不同。这里如果只保留 pathname，会把真正的媒体源 host 丢掉，
            // 最终表现为 PlaybackInfo 成功、实际拉流失败。
            //
            // 因此跨源绝对地址必须继续走：
            // /{prefix}/https://real-media-host/...
            //
            // 这样 Worker 仍然能带着现有 header/回退逻辑去请求真实媒体地址，
            // 同时也不会把 HUD 明确依赖的 /emby 子路径语义抹掉。
            if (/^https?:\/\//i.test(trimmedValue)) {
                try {
                    const parsed = new URL(trimmedValue);
                    if (Array.isArray(targetOrigins) && !targetOrigins.includes(parsed.origin)) {
                        // 跨源媒体地址:面板/前缀/http://推流域名 拼接形式,由 CF Worker 反代取流
                        // (用户连接面板域名,流量经 CF)。3.6.50 曾裸直连推流域名,绕过
                        // 「外部跳转直连」开关语义——恢复代理形式。
                        return `${proxyOrigin}${safePrefix}/${trimmedValue}`;
                    }
                    return toWorkerPlaybackPath(parsed.pathname, parsed.search, parsed.hash, safePrefix);
                } catch (e) {
                    return rawValue;
                }
            }

            if (trimmedValue.startsWith('//')) {
                try {
                    const parsed = new URL(targetUrl.protocol + trimmedValue);
                    if (Array.isArray(targetOrigins) && !targetOrigins.includes(parsed.origin)) {
                        return `${proxyOrigin}${safePrefix}/${parsed.href}`; // 跨源:代理拼接形式
                    }
                    return toWorkerPlaybackPath(parsed.pathname, parsed.search, parsed.hash, safePrefix);
                } catch (e) {
                    return rawValue;
                }
            }

            if (trimmedValue.startsWith('/')) return toWorkerPlaybackPath(trimmedValue, '', '', safePrefix);

            try {
                const resolved = new URL(trimmedValue, targetUrl.origin + '/');
                return toWorkerPlaybackPath(resolved.pathname, resolved.search, resolved.hash, safePrefix);
            } catch (e) {
                return rawValue;
            }
        }

        // 一些客户端会在拿到 PlaybackInfo 后自己再拼一次 serverUrl。
        // 如果我们返回的是 /{prefix}/videos/... 或 /{prefix}/emby/videos/...，
        // 某些客户端再自己拼一次 serverUrl 后，有时会拼出：
        // - /{prefix}/{prefix}/videos/...
        // - /{prefix}/emby/{prefix}/videos/...
        //
        // 这些其实都还是同一条线路，只是多叠了一层 prefix。
        // 这里在真正选路前做一次 O(1) 字符串归一化，把常见重复前缀修回标准路径，
        // 这样既不依赖某个特定客户端，也避免为此引入额外存储或更重的会话跟踪。
        function normalizeRemainingPathForPlayback(remainingPath, matchedPrefix, tokenPrefix) {
            if (!remainingPath || !matchedPrefix) return remainingPath;

            const prefixPath = `/${matchedPrefix}`;
            const embyDuplicatedPrefix = `/emby${prefixPath}`;

            // 开 token 时客户端二次拼接会拼出重复前缀，常见两类：
            //   /{token}/{节点}/emby/{token}/{节点}/videos/...   （客户端固定补 /emby）
            //   /{token}/{节点}/videos/{token}/{节点}/videos/... （视频路径本身以 /videos 开头）
            // 门禁剥掉首个 token 后 remainingPath = /emby/{token}/{节点}/... 或 /videos/{token}/{节点}/...，
            // 这里做通用剥离：只要前 3 段是 /{段1}/{token}/{节点} 就剥掉 token+节点；
            // 若 seg1 就是节点（纯节点重复形态 /{节点}/{token}/{节点}/...），剥光后直接保留剩余视频路径；
            // 否则保留 /{段1}，若剩余部分首段与段1 相同（如 /videos/{token}/{节点}/videos/...）再去重合并，
            // 兼容 emby / videos / stream 等任意视频 API 前缀，避免带着 /{token}/{节点} 打到源站返回 404。
            if (tokenPrefix) {
                const tokenDup = remainingPath.match(/^\/([^/]+)\/([^/]+)\/([^/]+)(?=\/|$)/);
                if (tokenDup && tokenDup[2] === tokenPrefix && (tokenDup[3] === matchedPrefix || tokenDup[1] === matchedPrefix)) {
                    const seg1 = tokenDup[1];
                    const rest = remainingPath.substring(tokenDup[0].length) || '/';
                    if (seg1 === matchedPrefix) return rest;
                    if (rest === '/' + seg1 || rest.startsWith('/' + seg1 + '/')) return rest;
                    return '/' + seg1 + rest;
                }
            }

            if (remainingPath === prefixPath || remainingPath.startsWith(prefixPath + '/')) {
                const stripped = remainingPath.substring(prefixPath.length);
                return stripped || '/';
            }

            if (remainingPath === embyDuplicatedPrefix || remainingPath.startsWith(embyDuplicatedPrefix + '/')) {
                const stripped = remainingPath.substring(embyDuplicatedPrefix.length);
                // 这里兼容两种客户端二次拼接结果：
                // 1. /emby/{prefix}/videos/...      -> 还原成 /emby/videos/...
                // 2. /emby/{prefix}/emby/videos/... -> 还原成 /emby/videos/...
                //
                // 第二种常见于“API 习惯性固定补 /emby 的客户端”：
                // PlaybackInfo 已经返回 /{prefix}/emby/videos/...，
                // 客户端又按自己的固定规则补了一层 /emby，最终会多出 /emby/{prefix}/emby/...。
                // 如果这里无脑再拼一次 /emby，会变成 /emby/emby/videos/...，反而把原本可修复的请求打坏。
                if (!stripped || stripped === '/') return '/emby/';
                if (/^\/emby(?:\/|$)/i.test(stripped)) return stripped;
                return `/emby${stripped}`;
            }

            return remainingPath;
        }

        if (decodedPath.startsWith('/http://') || decodedPath.startsWith('/https://')) {
            // 裸域名直连代理开关:默认允许(与历史一致);关闭后仅允许已配置的节点前缀与 Token 前缀
            if (!(await isBareProxyEnabled(env))) return new Response('Forbidden', { status: 403 });
            targetUrls = [decodedPath.substring(1)]; remainingPath = '';
        } else {
            const pathParts = decodedPath.split('/'); const prefix = pathParts[1]; 
            if (!prefix) return new Response(`Not Found`, { status: 404 });

            try {
                if (!env.DB) return new Response(`404: Node not found (DB not bound)`, { status: 404 });
                // 节点配置 10 秒内存缓存(视频分片等高频请求不再每次查库);后台写操作会清空本 isolate 的缓存
                const route = await memoStale('route:' + prefix, 10000, async () => await env.DB.prepare('SELECT target, mode, cache_img, custom_params FROM routes WHERE prefix = ?').bind(prefix).first());
                if (!route) { memoDel('route:' + prefix); return new Response(`404: Node not found`, { status: 404 }); }

                currentMode = route.mode || 'off'; enableCache = (route.cache_img !== 'off');
                // v3.6.57:伪装版已移除 EMOS/EMOS+伪装 模式——历史 emos 节点运行时按保守(off)处理,
                // emos_fake 节点按保守+伪装(off_fake)处理,不再发 EMOS 头/聚合目录/30x 跟随
                // (伪装版发 EMOS 头曾被源站查判返回 500)
                if (currentMode === 'emos') currentMode = 'off';
                else if (currentMode === 'emos_fake') currentMode = 'off_fake';
                matchedPrefix = prefix; remainingPath = '/' + pathParts.slice(2).join('/');
                let tokenPrefixForNormalize = '';
                try { const ptN = await getProxyToken(env); if (ptN && ptN.enabled && ptN.key) tokenPrefixForNormalize = ptN.key; } catch(e) {}
                remainingPath = normalizeRemainingPathForPlayback(remainingPath, matchedPrefix, tokenPrefixForNormalize);
                targetUrls = route.target.split(',').map(s => s.trim()).filter(Boolean);

                if (route.custom_params) {
                    try { customParamsObj = JSON.parse(route.custom_params); } catch(e) {}
                }
                dlTrick = !!(customParamsObj && customParamsObj.dlTrick);
                // 下载伪装：把播放器的下载请求（/Items/{id}/Download）改写为同文件直接流请求
                // （/Videos/{id}/stream?static=true），拿到完整文件，绕过服务端"禁下载"权限限制
                // （Emby 流接口不校验 EnableContentDownloading，只要播放权限即可）
                if (dlTrick && /\/Items\/[^/]+\/Download\/?$/i.test(remainingPath)) {
                    const idm = remainingPath.match(/\/Items\/([^/]+)\/Download\/?$/i);
                    if (idm) {
                        dlTrickItemId = idm[1];
                        // 保留原有前缀（/emby/Items/…/Download → /emby/Videos/…/stream），与 VPS 版一致
                        remainingPath = remainingPath.replace(/\/Items\/[^/]+\/Download\/?$/i, () => '/Videos/' + encodeURIComponent(idm[1]) + '/stream');
                        if (!url.searchParams.has('static')) url.searchParams.set('static', 'true');
                    }
                }
                
                // v3.6.5:真实下载记录——非 dlTrick 的 Download 请求不改写路径,仅登记 itemId 供下载记录
                if (!dlTrickItemId && /\/Items\/[^\/]+\/Download\/?$/i.test(remainingPath)) {
                    const idm2 = remainingPath.match(/\/Items\/([^\/]+)\/Download\/?$/i);
                    if (idm2 && idm2[1]) dlTrickItemId = idm2[1];
                }

                // v3.6.9:Forward-Standard 等客户端下载走 /Videos/{id}/original.{ext} 原始文件直链(非 /Items/Download)
                // 判据(基于系统既有播放识别能力):真实播放必走 /Sessions/Playing 心跳链(2.7 已识别),纯文件直链无心跳链=下载;
                // 额外保险:若文件直链请求自身带 PlaySessionId(极端播放场景),不记下载
                if (!dlTrickItemId && !url.searchParams.has('PlaySessionId') && /\/Videos\/([^\/]+)\/original\.[a-z0-9]+/i.test(remainingPath)) {
                    const idm3 = remainingPath.match(/\/Videos\/([^\/]+)\/original\.[a-z0-9]+/i);
                    if (idm3 && idm3[1]) dlTrickItemId = idm3[1];
                }

                if (remainingPath.startsWith('/http://') || remainingPath.startsWith('/https://')) {
                    // 节点前缀 + 绝对地址:裸代理关闭时,只允许指向该节点自身配置过的源站(否则开关形同虚设)
                    const extraTarget = remainingPath.substring(1);
                    let extraAllowed = await isBareProxyEnabled(env);
                    if (!extraAllowed) {
                        try { extraAllowed = getTargetOrigins(targetUrls).includes(new URL(extraTarget).origin); } catch (e) {}
                    }
                    if (!extraAllowed) return new Response('Forbidden', { status: 403 });
                    targetUrls = [extraTarget]; remainingPath = '';
                }
            } catch (e) { return new Response("DB Error: " + e.message, { status: 500 }); }
        }

        if (targetUrls.length === 0) return new Response("404: Target empty", { status: 404 });

        // ==========================================
        // 2.7 真实观看判定（EmbyBOSS 思路改良：不数 PlaybackInfo，改判播放会话心跳链）
        //   PlaybackInfo（详情页/预加载/点开就会触发）不再计入观看，消除虚高；
        //   仅「播放开始」与「非暂停的播放进度心跳」才算真实在播 → 更新最近观看时间；
        //   同一播放会话只计一次有效播放次数（会话级去重，防心跳风暴刷次数）。
        // ==========================================
        const isPlayStart = url.pathname.endsWith('/Sessions/Playing');
        const isPlayProgress = url.pathname.indexOf('/Sessions/Playing/Progress') !== -1;

        if ((isPlayStart || isPlayProgress) && matchedPrefix && env.DB && ctx && ctx.waitUntil) {
            ctx.waitUntil((async () => {
                try {
                    let paused = false, sessionId = '';
                    try {
                        const txt = await request.clone().text();
                        const j = JSON.parse(txt);
                        paused = !!j.IsPaused;
                        sessionId = String(j.PlaySessionId || '');
                    } catch (e) {}
                    // 暂停心跳不算观看（用户正暂停）；继续播放心跳才算
                    if (paused) return;
                    const todayStr = new Date(Date.now() + 8 * 3600000).toISOString().split('T')[0];
                    const nowTime = new Date(Date.now() + 8 * 3600000).toISOString().replace('T', ' ').split('.')[0];

                    const stmts = [ env.DB.prepare(`UPDATE routes SET last_play = ? WHERE prefix = ?`).bind(nowTime, matchedPrefix) ];

                    if (sessionId) {
                        const key = 'watch_sessions';
                        const row = await env.DB.prepare("SELECT value FROM app_config WHERE key = ?").bind(key).first();
                        let seen = [];
                        try { if (row && row.value) seen = JSON.parse(row.value); } catch (e) {}
                        if (!seen.includes(sessionId)) {
                            seen.unshift(sessionId);
                            if (seen.length > 500) seen.length = 500;
                            stmts.push(env.DB.prepare(`INSERT INTO request_stats (prefix, date, count) VALUES (?, ?, 1) ON CONFLICT(prefix, date) DO UPDATE SET count = count + 1`).bind(matchedPrefix, todayStr));
                            const clientIp = request.headers.get("cf-connecting-ip") || request.headers.get("x-real-ip") || "Unknown";
                            const clientCountry = request.headers.get("cf-ipcountry") || "Unknown";
                            const clientUa = request.headers.get("User-Agent") || "Unknown";
                            stmts.push(env.DB.prepare(`INSERT INTO visitor_logs (prefix, ip, country, ua) VALUES (?, ?, ?, ?)`).bind(matchedPrefix, clientIp, clientCountry, clientUa));
                            stmts.push(env.DB.prepare('INSERT OR REPLACE INTO app_config (key, value) VALUES (?, ?)').bind(key, JSON.stringify(seen)));
                        }
                    }
                    await env.DB.batch(stmts);
                } catch (e) {}
            })());
        }

        // ==========================================
        // 2.8 源站反代引擎 (含强力防 403 + 深度伪装 UA 引擎)
        // ==========================================
        const isFakeMode = currentMode.includes('fake') || currentMode === 'custom';
        const isStrictMode = currentMode.includes('strict');
        const baseIpMode = currentMode.replace('_fake', '').replace('custom', 'dual').replace('strict', 'off'); 

        let bodyBuffer = null;
        const canHaveRequestBody = request.method !== 'GET' && request.method !== 'HEAD';

        // v4.0.0 热力图计数：真实播放请求(stream 拉流 / PlaybackInfo)命中即异步累加(保活走内部直连不经过此处，天然排除)
        try {
            const playPath = /\/emby\/Videos\/[^/]+\/stream(?:\?|$)/i.test(remainingPath)
                || (/\/emby\/Items\/[^/]+\/PlaybackInfo(?:\?|$)/i.test(remainingPath) && request.method === 'POST');
            if (playPath && matchedPrefix) ctx.waitUntil(recordPlayHit(env, matchedPrefix));
        } catch (e) { console.error('playhit:', e.message); }

        const needsReplayableBody = canHaveRequestBody && (
            targetUrls.length > 1
            || targetUrls.some(target => buildUpstreamCandidates(target, remainingPath, url.search).length > 1)
            || isFakeMode
        );

        if (needsReplayableBody) {
            // 这里只在“请求体会被重复使用”时才预读成 ArrayBuffer。
            //
            // 触发条件有两类：
            // 1. 多节点 failover：同一个 POST 可能发往多个 target
            // 2. 同节点候选回退：例如 /Items/... 失败后，再试 /emby/Items/...
            //
            // 这两种情况都会二次消费 request.body；不先缓存就会出现：
            // "This ReadableStream is disturbed (has already been read from)"
            //
            // 但如果本次请求只会发起一次上游 fetch，就继续保留原本的流式透传，
            // 尽量减少我这次修复对现有面板和普通反代行为的影响范围。
            bodyBuffer = await request.clone().arrayBuffer();

            // 伪装模式：针对前端返回的 JSON body 深度替换身份信息 (四层防护)
            if (isFakeMode && bodyBuffer.byteLength > 0 && bodyBuffer.byteLength < 1024 * 100) {
                const contentType = request.headers.get("content-type") || "";
                if (contentType.toLowerCase().includes("application/json")) {
                    try {
                        let bodyText = new TextDecoder().decode(bodyBuffer);
                        if (customParamsObj.client) bodyText = bodyText.replace(/("Client(Name)?"\s*:\s*")[^"]+(")/ig, `$1${customParamsObj.client}$3`);
                        if (customParamsObj.version) bodyText = bodyText.replace(/("Version"\s*:\s*")[^"]+(")/ig, `$1${customParamsObj.version}$2`);
                        if (customParamsObj.device) bodyText = bodyText.replace(/("Device(Name)?"\s*:\s*")[^"]+(")/ig, `$1${customParamsObj.device}$3`);
                        
                        const newBuffer = new TextEncoder().encode(bodyText).buffer;
                        if (newBuffer.byteLength !== bodyBuffer.byteLength || bodyText.includes(customParamsObj.client)) {
                            bodyBuffer = newBuffer;
                        }
                    } catch(e) {}
                }
            }
        }

        let finalResponse = null; let lastError = null; let targetOrigins = getTargetOrigins(targetUrls); let finalTargetUrl = null;

        for (let i = 0; i < targetUrls.length; i++) {
            const candidateUrls = buildUpstreamCandidates(targetUrls[i], remainingPath, url.search);

            for (let j = 0; j < candidateUrls.length; j++) {
                const targetUrlStr = candidateUrls[j];
                const targetUrl = new URL(targetUrlStr);
                const newHeaders = new Headers(request.headers); newHeaders.set("Host", targetUrl.host);
                stripPanelCookie(newHeaders);

                const realIp = request.headers.get("cf-connecting-ip") || request.headers.get("x-real-ip") || (request.headers.get("x-forwarded-for") || "").split(',')[0].trim();
                newHeaders.delete("cf-connecting-ip"); newHeaders.delete("cf-ipcountry"); newHeaders.delete("cf-ray");
                newHeaders.delete("cf-visitor"); newHeaders.delete("x-forwarded-for"); newHeaders.delete("x-real-ip");

                if (isStrictMode) {
                    newHeaders.delete("X-Forwarded-Proto"); newHeaders.delete("X-Forwarded-Host");
                } else {
                    newHeaders.set("X-Forwarded-Proto", url.protocol.replace(':', ''));
                    newHeaders.set("X-Forwarded-Host", url.host);
                }

                if (baseIpMode === 'realip_only' && realIp) { newHeaders.set("X-Real-IP", realIp); } 
                else if ((baseIpMode === 'dual' || isStrictMode) && realIp) { newHeaders.set("X-Real-IP", realIp); newHeaders.set("X-Forwarded-For", realIp); }

                if (isStrictMode) {
                    newHeaders.set("Origin", targetUrl.origin); newHeaders.set("Referer", targetUrl.origin + "/");
                } else {
                    const origin = newHeaders.get("Origin");
                    if (origin && origin === url.origin) newHeaders.set("Origin", targetUrl.origin);
                    const referer = newHeaders.get("Referer");
                    if (referer && referer.startsWith(url.origin)) newHeaders.set("Referer", referer.replace(url.origin, targetUrl.origin));
                }

                if (isFakeMode) {
                    // 深度伪装引擎：执行请求头与授权头部伪装（字段缺失用内置 SenPlayer 模板兜底，开启伪装就不泄露任何真实身份）
                    const fClient = customParamsObj.client || 'SenPlayer';
                    const fVersion = customParamsObj.version || '6.0.0';
                    const fDevice = customParamsObj.device || 'iPhone';
                    const fDeviceId = customParamsObj.deviceId || genUuid();
                    const fUa = customParamsObj.ua || 'SenPlayer/6.0.0';
                    newHeaders.set("User-Agent", fUa);
                    
                    ['X-Emby-Authorization', 'Authorization'].forEach(headerName => {
                        let authHeader = newHeaders.get(headerName);
                        if (authHeader) {
                            if (fClient) authHeader = authHeader.replace(/(Client\s*=\s*)(?:"[^"]*"|'[^']*'|[^,\s]+)/ig, `$1"${escQuote(fClient)}"`);
                            if (fVersion) authHeader = authHeader.replace(/(Version\s*=\s*)(?:"[^"]*"|'[^']*'|[^,\s]+)/ig, `$1"${escQuote(fVersion)}"`);
                            if (fDevice) authHeader = authHeader.replace(/(Device\s*=\s*)(?:"[^"]*"|'[^']*'|[^,\s]+)/ig, `$1"${escQuote(fDevice)}"`);
                            if (fDeviceId) authHeader = authHeader.replace(/(DeviceId\s*=\s*)(?:"[^"]*"|'[^']*'|[^,\s]+)/ig, `$1"${escQuote(fDeviceId)}"`);
                            newHeaders.set(headerName, authHeader);
                        }
                    });

                    // 无条件补全 4 个标准 Emby 身份头（客户端没发也新建，防上游识别缺头/真实身份）
                    const paramsToReplace = { 'x-emby-client': fClient, 'x-emby-client-version': fVersion, 'x-emby-device-name': fDevice, 'x-emby-device-id': fDeviceId };
                    for (const key of Object.keys(paramsToReplace)) {
                        if (paramsToReplace[key]) newHeaders.set(key, paramsToReplace[key]);
                    }
                    const currentParams = Array.from(targetUrl.searchParams.keys());
                    currentParams.forEach(key => {
                        const lowerKey = key.toLowerCase();
                        if (paramsToReplace[lowerKey]) targetUrl.searchParams.set(key, paramsToReplace[lowerKey]);
                    });
                }

                const isStaticOrImage = isStaticPath(targetUrl.pathname);
                const authLikeState = hasAuthLikeState(newHeaders, targetUrl);

                let fetchInit = { method: request.method, headers: newHeaders, redirect: isStaticOrImage ? 'follow' : 'manual' };

                // 只缓存不带鉴权态的静态资源。
                // 之前 UHD 图片加载异常时，容易把所有图片都当成可缓存资源处理；
                // 但 Emby 的高清图请求常常带 token/api_key，缓存这类响应可能拿到过期或错误权限的内容。
                // 因此这里保留静态资源加速，但显式排除带鉴权态的请求。
                if (isStaticOrImage && enableCache && !authLikeState) { fetchInit.cf = { cacheEverything: true, cacheTtl: 86400 }; }

                if (canHaveRequestBody) {
                    if (bodyBuffer !== null) {
                        // 只有在需要重试/切线时才使用可复用的二进制 body。
                        fetchInit.body = bodyBuffer;
                    } else {
                        // 单次请求仍然按旧逻辑直接透传原始流，避免扩大兼容性风险。
                        fetchInit.body = request.body;
                        fetchInit.duplex = 'half';
                    }
                }

                try {
                    const modifiedRequest = new Request(targetUrl, fetchInit); const response = await fetch(modifiedRequest);

                    // 这里特意允许“同一 target 的下一候选”继续尝试。
                    // 也就是说：如果裸路径 /Items/... 回了 404，而 /emby/Items/... 是可用的，
                    // 就不要立刻把这条线路判死，而是优先在当前线路内部完成一次 /emby 回退重试。
                    if ((response.status === 404 || response.status === 502 || response.status === 503 || response.status === 504) && j < candidateUrls.length - 1) {
                        lastError = new Error(`Node ${i+1} candidate ${j+1} returned HTTP ${response.status}`);
                        continue;
                    }

                    if (response.status === 502 || response.status === 503 || response.status === 504) {
                        lastError = new Error(`Node ${i+1} returned HTTP ${response.status}`);
                        continue;
                    }

                    finalResponse = response; finalTargetUrl = targetUrl; break;
                } catch (err) {
                    lastError = err; continue;
                }
            }

            if (finalResponse) break;
        }

        if (!finalResponse) return new Response("Worker Proxy Failover Exhausted. All nodes failed. Last Error: " + (lastError?.message || 'Unknown Error'), { status: 502 });

        const responseHeaders = new Headers(finalResponse.headers);
        rewriteSetCookieForProxy(responseHeaders);
        const ptObj = await getProxyToken(env);
        const safePrefix = matchedPrefix ? `/${proxyTokenPrefix(ptObj)}${matchedPrefix}` : '';

        // 下载伪装伴随观看（CF 版）：命中改写后的下载流时，包装响应流，
        // 读取间隙驱动心跳、流结束/断开自动上报结束并清除播放记录
        // v3.6.5 修复:客户端分段下载(带 Range)上游返回 206,条件必须同时接受 200/206,否则记录段被整体跳过
        if (dlTrickItemId && (finalResponse.status === 200 || finalResponse.status === 206) && finalResponse.body) {
            // v3.6.5:伪装下载(dlTrick)与下载记录解耦——任何下载都记录,伪装仅在节点开启 dlTrick 时进行
            let dlWatch = null;
            if (dlTrick) dlWatch = spawnDlTrickWatchCF(finalTargetUrl, request, dlTrickItemId, url.search, customParamsObj);
            if (dlWatch) {
                // v3.6.0:下载优先——下载伴随启动即计数,保活让位;结束自动复位
                try { await kaDlCount(env, 1); } catch (e) {}
            }
            finalResponse = new Response(wrapStreamWithWatch(finalResponse.body, dlWatch, ctx, () => {
                if (dlWatch) {
                    try { kaDlCount(env, -1); } catch (e) {}
                    try { maybeAdvanceQueue(env); } catch (e) {}
                }
            }, () => {
                // v3.6.41:下载进行中持续刷新计数时间戳(节流30s)——长下载不会被超时误清;
                // 取消/中断后 ts 停更,3 分钟内自动清零,保活自动恢复
                try {
                    const now = Date.now();
                    if (now - kaDlTouchLast > 30000) {
                        kaDlTouchLast = now;
                        kaDlCount(env, 0);
                    }
                } catch (e) {}
            }), {
                    status: finalResponse.status, statusText: finalResponse.statusText, headers: responseHeaders
                });
        }

        // ==========================================
        //  修复版 302 拦截：恢复 URL 编码
        // ==========================================
        if ([301, 302, 303, 307, 308].includes(finalResponse.status)) {
            const location = responseHeaders.get('Location');
            // 不再由 Worker 跟随媒体 30x 取流:3.6.47 引入后媒体流量全部压进 CF
            // Worker 中转,播放速度从直连 40M/s 掉到 3M/s;3.6.46 无跟随,302 直连/下发满速。
            // 30x 一律交给下方 Location 下发。
            const rewrittenLocation = rewriteRedirectLocation(location, finalTargetUrl, targetOrigins, proxyOrigin, safePrefix);
            if (rewrittenLocation === null) responseHeaders.delete('Location');
            else if (rewrittenLocation !== location) {
                responseHeaders.set('Location', rewrittenLocation);
            }
        }
        
        responseHeaders.set('Access-Control-Allow-Origin', '*');

        // ==========================================
        // 2.10 响应体重写 (接管 PlaybackInfo 与 M3U8)
        // ==========================================

        if (finalResponse.status === 200 && responseHeaders.get("content-type")?.includes("json") && url.pathname.toLowerCase().includes("playbackinfo")) {
            try {
                let clonedRes = finalResponse.clone(); 
                let data = await clonedRes.json(); 
                let modified = false;
                if (data && data.MediaSources) {
                    data.MediaSources.forEach(source => {
                        // Emby / Jellyfin / HUD 的 PlaybackInfo 字段并不完全一致。
                        // 原脚本只改写 DirectStreamUrl 和 TranscodingUrl 的绝对地址，
                        // 这对标准 Emby 基本够用，但 HUD 常见的是：
                        // - DirectStreamUrl 返回 /emby/videos/...
                        // - TranscodingUrl 返回 /emby/videos/... 或相对路径
                        // - 字幕 DeliveryUrl 也可能是相对路径
                        //
                        // 所以这里把播放期会实际发起请求的几个关键 URL 字段统一走同一个改写函数，
                        // 保证所有媒体相关请求都还能带着当前线路前缀回到 Worker。
                        ['DirectStreamUrl', 'TranscodingUrl', 'Url'].forEach(key => {
                            const rewritten = rewritePlaybackMediaUrl(source[key], finalTargetUrl, proxyOrigin, safePrefix, targetOrigins);
                            if (rewritten !== source[key]) {
                                source[key] = rewritten;
                                modified = true;
                            }
                        });

                        // 字幕流的 DeliveryUrl 也会在播放时被客户端直接请求。
                        // 如果 HUD 给的是 /emby/videos/... 这种相对地址，而这里不改，
                        // 主视频即使勉强能播，外挂字幕依然会因为丢失前缀而加载失败。
                        if (Array.isArray(source.MediaStreams)) {
                            source.MediaStreams.forEach(stream => {
                                const rewritten = rewritePlaybackMediaUrl(stream?.DeliveryUrl, finalTargetUrl, proxyOrigin, safePrefix, targetOrigins);
                                if (rewritten !== stream?.DeliveryUrl) {
                                    stream.DeliveryUrl = rewritten;
                                    modified = true;
                                }
                            });
                        }

                        // —— 起播优化:强制禁转码直连(仅改写播放地址字段,不影响伪装/下载/保活)——
                        // 禁转码但保留/开启直连能力:SupportsTranscoding=false 让播放器不走转码;
                        // SupportsDirectStream/SupportsDirectPlay 必须为 true,否则播放器判定
                        // “既不能转码又不能直连”会直接报无法播放(与普通版 3.4.38 同款回归修复)。
                        if (source.SupportsTranscoding !== false) { source.SupportsTranscoding = false; modified = true; }
                        if (source.SupportsDirectStream !== true) { source.SupportsDirectStream = true; modified = true; }
                        if (source.SupportsDirectPlay !== true) { source.SupportsDirectPlay = true; modified = true; }
                        ['TranscodingUrl', 'TranscodingSubProtocol', 'TranscodingContainer', 'TranscodingType'].forEach(k => {
                            if (source[k] !== undefined && source[k] !== null && source[k] !== '') { source[k] = ''; modified = true; }
                        });
                        if (source.IsRemote !== false) { source.IsRemote = false; modified = true; }
                        if (source.Protocol !== 'Http' && source.Protocol !== 'http') { source.Protocol = 'Http'; modified = true; }
                        // Path 兜底:若没有 DirectStreamUrl 但 Path 是源站地址,改写为代理路径并作为直连地址
                        if (!source.DirectStreamUrl && source.Path) {
                            const rwPath = rewritePlaybackMediaUrl(source.Path, finalTargetUrl, proxyOrigin, safePrefix, targetOrigins);
                            if (rwPath !== source.Path) { source.DirectStreamUrl = rwPath; modified = true; }
                        }
                    });
                }
                if (modified) { 
                    dropBodyIntegrityHeaders(responseHeaders);
                    const piOutText = JSON.stringify(data);
                    return new Response(piOutText, { status: finalResponse.status, statusText: finalResponse.statusText, headers: responseHeaders }); 
                }
            } catch (e) {
                console.log("PlaybackInfo JSON 重写失败:", e.message);
            }
        }

        // 通用 JSON URL 重写。
        // PlaybackInfo 只覆盖播放地址；UHD 图片失败通常发生在其他 JSON 接口里，
        // 例如详情页、图片列表或插件接口返回了源站绝对地址/相对图片路径。
        // 这里先用 hasJsonRewriteCandidate 做轻量筛选，再递归改写，避免漏掉嵌套的高清图字段。
        if (finalResponse.status === 200 && responseHeaders.get("content-type")?.includes("json")) {
            try {
                let clonedRes = finalResponse.clone();
                let text = await clonedRes.text();
                // 下载伪装：把返回给播放器的用户权限 JSON 中下载相关字段 false→true，
                // 让播放器直接显示"下载"按钮（EnableMediaPlayback 等播放强校验字段绝不动，改了反而露馅）
                let dlModified = false;
                if (dlTrick) {
                    const t2 = text.replace(/"(EnableContentDownloading|EnableSyncTranscoding|EnableMediaConversion|CanDownload)"\s*:\s*false/gi, '"$1":true');
                    dlModified = (t2 !== text);
                    text = t2;
                }
                if (hasJsonRewriteCandidate(text, targetOrigins)) {
                    let data = JSON.parse(text);
                    let rewritten = rewriteSourceUrlsInJson(data, targetOrigins, proxyOrigin, safePrefix);
                    if (rewritten !== data) {
                        dropBodyIntegrityHeaders(responseHeaders);
                        return new Response(JSON.stringify(rewritten), { status: finalResponse.status, statusText: finalResponse.statusText, headers: responseHeaders });
                    }
                }
                if (dlModified) {
                    dropBodyIntegrityHeaders(responseHeaders);
                    return new Response(text, { status: finalResponse.status, statusText: finalResponse.statusText, headers: responseHeaders });
                }
            } catch(e) {
                console.log("JSON 源站 URL 重写失败:", e.message);
            }
        }

        if (finalResponse.status === 200 && url.pathname.toLowerCase().endsWith('.m3u8')) {
            try {
                let clonedRes = finalResponse.clone(); 
                let text = await clonedRes.text();
                if (text.includes('http://') || text.includes('https://') || /^\s*\//m.test(text)) {
                    // 绝对 URL 分片：代理到 /密钥/节点/源站URL
                    let modifiedText = text.replace(/(https?:\/\/[^\s]+)/g, proxyOrigin + safePrefix + '/$1');
                    // 协议相对分片（//host/path）：补 https 协议再代理
                    modifiedText = modifiedText.replace(/^(?!\s*#)(\s*)\/\/([^\s]+)$/gm, (m, sp, p) => sp + proxyOrigin + safePrefix + '/https://' + p);
                    // 根相对分片（/path）：浏览器会解析到不带节点前缀的根路径导致 404，补上源站根 + 代理前缀
                    const firstOrigin = (targetUrls[0] || '').replace(/\/+$/, '');
                    if (firstOrigin) {
                        modifiedText = modifiedText.replace(/^(?!\s*#)(\s*)\/([^\s]+)$/gm, (m, sp, p) => sp + proxyOrigin + safePrefix + '/' + firstOrigin + '/' + p);
                    }
                    dropBodyIntegrityHeaders(responseHeaders);
                    return new Response(modifiedText, { status: finalResponse.status, statusText: finalResponse.statusText, headers: responseHeaders });
                }
            } catch(e) {
                console.log("M3U8 重写失败:", e.message);
            }
        }

        // 给最终静态资源响应补缓存头。
        // 这里仍然用当前访问路径判断是否为图片/静态文件，是为了让已经通过 Worker
        // 正确代理过来的 UHD 图片可以被浏览器/CDN 正常复用；但真正的 Cloudflare
        // cacheEverything 已在请求发起前排除了带鉴权态的资源，避免缓存污染。
        const isStaticRes = isStaticPath(url.pathname);
        const contentType = responseHeaders.get("content-type") || "";
        const canCacheStaticRes = isStaticRes
            && enableCache
            && finalResponse.status === 200
            && (
                contentType.startsWith("image/")
                || contentType.includes("javascript")
                || contentType.includes("css")
                || contentType.includes("font")
                || contentType.includes("manifest")
            );
        if (canCacheStaticRes && !responseHeaders.has("Cache-Control")) {
            responseHeaders.set('Cache-Control', 'public, max-age=86400'); 
        }

        return new Response(finalResponse.body, { status: finalResponse.status, statusText: finalResponse.statusText, headers: responseHeaders });
    } catch (e) {
        console.error('[proxy]', e);
        return Response.json({ success: false, error: String((e && e.message) || e) }, { status: 500 });
    }
}
};
