import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const workerPath = path.join(root, '明文', 'worker.js');
const source = await fs.readFile(workerPath, 'utf8');

// 实际求值 Worker 中的 HTML_UI，而不是对源码模板做近似正则替换。
const evalPath = path.join(os.tmpdir(), 'embyproxy-pwa-eval-' + process.pid + '.mjs');
const evaluable = source
  .replace("import { connect as __cfSocketConnect } from 'cloudflare:sockets';", "const __cfSocketConnect = function(){ throw new Error('not used in tests'); };")
  + '\nexport { HTML_UI, LANDING_UI, PWA_OFFLINE_HTML, PWA_SW_SOURCE, PWA_MANIFEST };\n';
await fs.writeFile(evalPath, evaluable);
const mod = await import(pathToFileURL(evalPath).href + '?t=' + Date.now());
const { HTML_UI, LANDING_UI, PWA_OFFLINE_HTML, PWA_SW_SOURCE } = mod;
const manifest = JSON.parse(mod.PWA_MANIFEST);

assert.equal(manifest.display, 'standalone');
assert.equal(manifest.start_url, '/?pwa=home');
assert.ok(manifest.icons.some((x) => x.src === '/pwa-icon-192.png'));
assert.ok(manifest.icons.some((x) => x.src === '/pwa-icon.svg' && x.sizes === 'any'));
assert.deepEqual(manifest.shortcuts.map((x) => x.url), ['/?pwa=nodes', '/?pwa=keepalive', '/?pwa=tg', '/?pwa=settings']);
assert.match(HTML_UI, /rel="manifest" href="\/manifest\.webmanifest"/);
assert.match(HTML_UI, /id="pwaQuickHome"/);
assert.match(HTML_UI, /emby_pwa_summary_v1/);
assert.match(HTML_UI, /p\.get\('pwa'\)\|\|p\.get\('bark'\)\|\|p\.get\('action'\)\|\|p\.get\('open'\)/);
assert.doesNotMatch(HTML_UI, /localStorage\.setItem\([^)]*(?:target|prefix|route|token|password)/i);

function inlineScripts(html, label) {
  const out = [];
  const re = /<script(?:\s[^>]*)?>([\s\S]*?)<\/script\s*>/gi;
  let m;
  while ((m = re.exec(html))) out.push(m[1]);
  assert.ok(out.length > 0, label + ' 应包含内联脚本');
  out.forEach((code, i) => new vm.Script(code, { filename: label + '-inline-' + (i + 1) + '.js' }));
  return out;
}

const mainScripts = inlineScripts(HTML_UI, 'HTML_UI');
inlineScripts(LANDING_UI, 'LANDING_UI');
assert.match(LANDING_UI, /apple-mobile-web-app-title[^>]+EmbyProxy/);
inlineScripts(PWA_OFFLINE_HTML, 'PWA_OFFLINE_HTML');
new vm.Script(PWA_SW_SOURCE, { filename: 'pwa-sw.js' });

// 捕获常见的换行转义手误；全量内联脚本已由 vm.Script 逐段编译。
for (const [label, text] of [['HTML_UI', HTML_UI], ['PWA_OFFLINE_HTML', PWA_OFFLINE_HTML], ['PWA_SW_SOURCE', PWA_SW_SOURCE]]) {
  assert.doesNotMatch(text, /['"]\/n['"]/i, label + ' 出现可疑 /n 字符串');
  assert.doesNotMatch(text, /['"]\/\/n['"]/i, label + ' 出现可疑 //n 字符串');
}
const pwaFragment = HTML_UI.slice(HTML_UI.indexOf('/* PWA 快捷首页默认完全不参与布局'));
assert.ok(pwaFragment.length > 1000, '没有取得最终 PWA HTML 片段');
assert.doesNotMatch(pwaFragment, /\\\r?\n/, 'PWA 片段出现反斜杠后真实换行，疑似字符串被截断');
assert.doesNotMatch(PWA_OFFLINE_HTML, /\\\r?\n/, '离线页出现反斜杠后真实换行');
assert.doesNotMatch(PWA_SW_SOURCE, /\\\r?\n/, 'Service Worker 出现反斜杠后真实换行');

// 精确验证显示条件：普通浏览器不变，standalone 显示快捷首页；classic=1 只启用应用内返回入口。
const detector = mainScripts.find((s) => s.includes("'pwa-classic-mode':'pwa-standalone'"));
assert.ok(detector, '缺少 standalone 检测脚本');
function detect({ display = false, ios = false, search = '' } = {}) {
  const added = [];
  const context = {
    URLSearchParams,
    location: { search },
    document: { documentElement: { classList: { add: (x) => added.push(x) } } },
    window: { matchMedia: () => ({ matches: display }), navigator: { standalone: ios } }
  };
  vm.runInNewContext(detector, context);
  return added;
}
assert.deepEqual(detect(), []);
assert.deepEqual(detect({ display: true }), ['pwa-standalone']);
assert.deepEqual(detect({ ios: true }), ['pwa-standalone']);
assert.deepEqual(detect({ display: true, search: '?classic=1' }), ['pwa-classic-mode']);
assert.deepEqual(detect({ ios: true, search: '?classic=1&pwa=home' }), ['pwa-classic-mode']);
assert.match(HTML_UI, /class="pwa-classic-back" href="\/\?pwa=home"/);

// 直接调用 Worker 路由，验证内容类型和图标二进制，不依赖部署环境。
const oldError = console.error;
console.error = () => {};
try {
  const ctx = { waitUntil() {} };
  const cases = [
    ['/manifest.webmanifest', 'application/manifest+json'],
    ['/pwa-sw.js', 'text/javascript'],
    ['/pwa-icon.svg', 'image/svg+xml'],
    ['/pwa-icon-192.png', 'image/png'],
    ['/pwa-offline', 'text/html']
  ];
  for (const [pathname, type] of cases) {
    const res = await mod.default.fetch(new Request('https://panel.test' + pathname), {}, ctx);
    assert.equal(res.status, 200, pathname);
    assert.ok((res.headers.get('content-type') || '').startsWith(type), pathname);
    assert.ok((await res.arrayBuffer()).byteLength > 100, pathname);
  }
} finally {
  console.error = oldError;
}

// 离线请求测试：API 完全不接管、不缓存；只有带 pwa 参数的首页导航才回退只读页。
const listeners = {};
const offlineResponse = new Response(PWA_OFFLINE_HTML, { headers: { 'content-type': 'text/html' } });
const swContext = {
  URL, Promise, Response,
  fetch: () => Promise.reject(new Error('offline')),
  caches: {
    open: async () => ({ addAll: async () => {} }),
    keys: async () => [],
    delete: async () => true,
    match: async (key) => key === '/pwa-offline' ? offlineResponse.clone() : undefined
  },
  self: {
    location: { origin: 'https://panel.test' },
    addEventListener: (name, fn) => { listeners[name] = fn; },
    skipWaiting: async () => {},
    clients: { claim: async () => {}, matchAll: async () => [] }
  }
};
vm.runInNewContext(PWA_SW_SOURCE, swContext, { filename: 'pwa-sw-runtime.js' });
let intercepted = false;
listeners.fetch({ request: { method: 'GET', url: 'https://panel.test/api/routes', mode: 'cors' }, respondWith: function() { intercepted = true; } });
assert.equal(intercepted, false, 'Service Worker 不得接管 API');
listeners.fetch({ request: { method: 'GET', url: 'https://panel.test/', mode: 'navigate' }, respondWith: function() { intercepted = true; } });
assert.equal(intercepted, false, '普通浏览器根导航不得接管');
let fallback;
listeners.fetch({ request: { method: 'GET', url: 'https://panel.test/?pwa=home', mode: 'navigate' }, respondWith: function(p) { fallback = p; } });
assert.ok(fallback, 'PWA 导航应被 network-first 接管');
const offline = await fallback;
assert.match(await offline.text(), /READ-ONLY SNAPSHOT/);
let barkFallback;
listeners.fetch({ request: { method: 'GET', url: 'https://panel.test/?bark=keepalive', mode: 'navigate' }, respondWith: function(p) { barkFallback = p; } });
assert.match(await (await barkFallback).text(), /READ-ONLY SNAPSHOT/, 'Bark 深链离线时也应回退快照');
assert.doesNotMatch(PWA_SW_SOURCE, /cache\.put|caches\.match\([^)]*api/i);

await fs.unlink(evalPath).catch(() => {});
console.log('PWA tests passed: Worker routes, evaluated inline scripts, mode gate, offline fallback');
