// VERSION: 3.4.2（beta）
//  更新内容：① 修复 CF 统计获取失败——GraphQL 的 httpRequestsAdaptiveGroups.sum 无 bytes 字段（正确为 clientRequestBytes），修正后带宽/缓存/状态码/分时/拦截统计全部恢复
const CURRENT_VERSION = "3.4.2（beta）"; 
const GITHUB_RAW_URL = "https://raw.githubusercontent.com/MakkaPakka518/EmbyProxy-CF-FAKE/refs/heads/main/worker.js";
const CHANGELOG_URL = "https://raw.githubusercontent.com/MakkaPakka518/EmbyProxy-CF-FAKE/refs/heads/main/changelog.json";

// ==========================================
// 1. 网页界面
// ==========================================

const SVG_EYE = `<svg viewBox="0 0 24 24"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>`;
const SVG_COPY = `<svg viewBox="0 0 24 24"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>`;
const SVG_TG = `<svg viewBox="0 0 24 24" style="width:20px;height:20px;margin-right:8px;fill:#0088cc;"><path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.221l-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.446 1.394c-.14.18-.357.295-.6.295-.002 0-.003 0-.005 0l.213-3.054 5.56-5.022c.24-.213-.054-.334-.373-.121l-6.869 4.326-2.96-.924c-.64-.203-.658-.64.135-.954l11.566-4.458c.538-.196 1.006.128.832.94z"/></svg>`;

const EMBY_LOGO = 'https://raw.githubusercontent.com/MakkaPakka518/Icon/refs/heads/main/MAKKA_EMBY.JPG';

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

const E2I = { '${I.rocket}':'rocket','${I.xmark}':'xmark','${I.check}':'check','${I.warn}':'warn','${I.film}':'film','${I.star}':'star','${I.sparkles}':'sparkles','${I.sparkles}':'sparkles','${I.globe}':'globe','${I.globe}':'globe','${I.bolt}':'bolt','${I.refresh}':'refresh','${I.chart}':'chart','${I.cloud}':'cloud','${I.trash}':'trash','${I.search}':'search','${I.location}':'location','${I.trophy}':'trophy','${I.moon}':'moon','${I.sun}':'sun','${I.dotblue}':'dotblue','${I.dotorange}':'dotorange','${I.dotgreen}':'dotgreen','${I.dotpurple}':'dotpurple','${I.robot}':'robot','${I.spy}':'spy','${I.flame}':'flame','${I.link}':'link','${I.tv}':'tv','${I.box}':'box','${I.download}':'download','${I.antenna}':'antenna','${I.bulb}':'bulb','${I.crown}':'crown','${I.target}':'target','${I.arrowdown}':'arrowdown','${I.xmark}':'xmark','${I.pencil}':'pencil','${I.gear}':'gear','${I.lines}':'lines','${I.flask}':'flask','${I.broom}':'broom','${I.checksquare}':'checksquare','${I.upload}':'upload' };
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
    html,body{margin:0;padding:0}
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
    .container{max-width:1200px;margin:0 auto;width:100%;min-height:100vh;display:flex;flex-direction:column;padding:calc(var(--topbar-h) + 30px) 24px 132px}

    /* ============ 分区标题（HUD 标签） ============ */
    .section-head{display:flex;align-items:center;gap:10px;margin:36px 2px 16px;font-size:11.5px;font-weight:800;letter-spacing:2px;text-transform:uppercase;color:var(--text-sec)}
    .section-head:first-child{margin-top:6px}
    .section-head::before{content:'';width:8px;height:8px;background:var(--primary-grad);transform:rotate(45deg);box-shadow:0 0 10px var(--primary);flex-shrink:0}
    .section-head::after{content:'';flex:1;height:1px;background:linear-gradient(90deg,var(--border),transparent)}

    /* ============ 卡片（深空舱板） ============ */
    .card{background:var(--card);padding:22px;border-radius:var(--radius);box-shadow:var(--shadow);margin-bottom:18px;border:1px solid var(--border);transition:box-shadow .25s,border-color .25s,transform .25s;position:relative}
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
    .pill-close:hover{background:rgba(255,77,106,.2)}
    .btn-submit svg,.btn-danger svg,.btn-ghost svg,.btn-edit svg,.btn-del svg,.btn-dns svg,.pill-btn svg,.pill-close svg{width:15px;height:15px}

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
    .modal-mask{display:none;position:fixed;inset:0;z-index:1000;background:rgba(4,8,16,.6);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);overflow-y:auto;-webkit-overflow-scrolling:touch;padding:16px}
    body.dark .modal-mask{background:rgba(3,6,12,.72)}
    .modal-box{max-width:680px;margin:30px auto;background:var(--card);border:1px solid var(--border);border-radius:22px;padding:24px;box-shadow:var(--shadow-lg);animation:dsModalIn .3s var(--ease)}
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
    @keyframes dsFadeIn{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}

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
        .container{padding:calc(var(--topbar-h) + 16px) 12px 122px}
        .card{padding:16px;border-radius:14px;margin-bottom:14px}
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
        body { display:flex; justify-content:center; align-items:center; min-height:100vh; padding:16px; margin:0; background:#060a13; color:#e8eefc; }
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
        function login() {
            const token = document.getElementById('tokenInput').value.trim();
            if(!token) return showToast('请输入正确的密钥');
            document.cookie = 'admin_token=' + encodeURIComponent(token) + '; path=/; max-age=2592000;';
            window.location.reload();
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
<script>try{if(!localStorage.getItem('emby_proxy_dark'))document.body.classList.add('dark')}catch(e){}</script>
    <div id="toast"></div>
    
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
                    <div style="font-size:13px; font-weight:600; margin-bottom:8px;">今日请求分时趋势 (UTC 24h)</div>
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
                    <img class="topbar-logo" src="${EMBY_LOGO}" alt="logo" onclick="openAccountModal()" title="账户设置" style="cursor:pointer;">
                    <div class="rtt-pill" title="你的设备到云端边缘节点的真实往返延迟">
                        <span class="rtt-dot" id="rttDot"></span>
                        <span class="rtt-label">RTT</span>
                        <span id="rttValue">测算中</span>
                        <button id="themeToggle" onclick="toggleDarkMode()" title="切换深色模式">${I.moon}</button>
                    </div>
                </div>
                <div class="topbar-right">
                    <button class="pill-btn" onclick="openDashboard()" title="数据统计">${I.chart} 统计</button>
                    <button class="pill-btn" onclick="location.href='/speedtest'" title="下载测速" style="color:#4fd08a;border-color:rgba(79,208,138,.32);background:rgba(79,208,138,.12);">${I.bolt} 下载测速</button>
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
                
                <div style="background: rgba(120,120,120,0.05); padding: 12px 16px; border-radius: 10px; border: 1px solid var(--border); margin-bottom: 16px;">
                    <div style="font-size: 13px; font-weight: 600; color: var(--text-sec); margin-bottom: 8px;">${I.antenna} 当前域名生效的 DNS 解析：</div>
                    <div id="dnsStatus" style="display: flex; gap: 8px; flex-wrap: wrap;">
                        <span style="color:#888; font-size: 14px;">加载中...</span>
                    </div>
                </div>

                <div class="toolbar">
                    <select id="ipType" style="font-weight: 600; color: var(--primary); padding: 12px 16px; border: 1px solid var(--border); border-radius: 10px; background:var(--card);">
                        <option value="all"> 综合混合源</option>
                        <option value="电信"> 电信专属</option>
                        <option value="联通"> 联通专属</option>
                        <option value="移动"> 移动专属</option>
                        <option value="多线"> 多线BGP</option>
                        <option value="ipv6"> IPv6节点</option>
                        <option value="优选"> 顶尖优选库</option>
                    </select>

                    <button class="btn-submit" id="btnFetchRemote" onclick="fetchRemoteAndTest()">${I.globe} 提取预设源并测速</button>
                    <button class="btn-submit" onclick="batchTcpPing()" style=" box-shadow: 0 4px 12px rgba(255, 149, 0, 0.2);">${I.globe} 复制去 ITDog</button>
                    <button class="btn-submit" onclick="clearTest()" style=" box-shadow: 0 4px 12px rgba(142, 142, 147, 0.2);">${I.trash} 清空列表</button>
                </div>

                <div style="background: rgba(120,120,120,0.05); padding: 16px; border-radius: 12px; border: 1px solid var(--border); margin-bottom: 16px;">
                    <div style="display: flex; gap: 8px; margin-bottom: 12px; align-items: center; flex-wrap: wrap;">
                        <input type="text" id="customApiUrl" value="https://ip.v2too.top/api/nodes" placeholder="填入自定义 JSON 或 文本 API 链接" style="flex: 1; min-width: 200px; padding: 12px 14px; border-radius: 10px; border: 1px solid var(--border); background:var(--card);">
                        <button class="btn-submit" id="btnFetchCustomApi" onclick="fetchCustomApiAndTest()" style=" box-shadow: 0 4px 12px rgba(50, 173, 230, 0.2);">${I.globe} 拉取 API 并测速</button>
                    </div>

                    <textarea id="customIps" rows="2" placeholder="在此粘贴自定义 IPv4、IPv6 或 优选域名 (支持混杂文本，自动提取)" style="width: 100%; padding: 14px; border-radius: 10px; border: 1px solid var(--border); margin-bottom: 12px; font-family: monospace; resize: vertical; background:var(--card);"></textarea>
                    
                    <div style="display: flex; gap: 10px; flex-wrap: wrap;">
                        <button class="btn-submit" id="btnTestCustom" onclick="testCustomIPs()" style=" box-shadow: 0 4px 12px rgba(88, 86, 214, 0.2);">${I.flask} 测试粘贴的节点</button>
                        <button class="btn-submit" id="btnDirectCname" onclick="directSubmitCname()" style=" box-shadow: 0 4px 12px rgba(175, 82, 222, 0.2);">${I.link} 直推 CNAME (免测速)</button>
                        <div style="width: 100%; height: 1px; background: var(--border); margin: 4px 0;"></div>
                        <button class="btn-submit" id="btnTop3Dns" onclick="updateTop3ToDns()" style=" box-shadow: 0 4px 12px rgba(255, 45, 85, 0.2);">${I.star} 更新 TOP3 至 DNS</button>
                        <button class="btn-submit" id="btnSelectedDns" onclick="updateSelectedToDns()" style=" box-shadow: 0 4px 12px rgba(52, 199, 89, 0.2);">${I.checksquare} 提交选中节点至 DNS</button>
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

            <div id="nodeModal" style="display:none; position:fixed; inset:0; z-index:11000; background:rgba(0,0,0,.5); backdrop-filter:blur(5px); overflow-y:auto; padding:16px;">
                <div style="max-width:680px; margin:24px auto; background:var(--card); border-radius:18px; padding:22px; box-shadow:0 10px 40px rgba(0,0,0,.2);">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px;">
                        <h2 id="nodeModalTitle" style="margin:0; font-size:19px; display:flex; align-items:center; gap:8px;">${I.pencil} 添加节点</h2>
                        <button onclick="closeNodeModal()" style="background:transparent;border:none;cursor:pointer;color:var(--text-sec);display:inline-flex;padding:4px;">${I.xmark}</button>
                    </div>
                    <form id="addForm" style="display: flex; flex-direction: column; gap: 16px;">
                    <div style="display: flex; gap: 12px; flex-wrap: wrap;">
                        <input type="hidden" id="oldPrefix" value="">
                        <input type="text" id="remark" placeholder="节点备注 (如: Misaka服)" style="padding: 12px 16px; border: 1px solid var(--border); border-radius: 10px; background:var(--card); flex: 1;" required>
                        <input type="text" id="prefix" placeholder="短路径后缀 (如: misaka)" style="padding: 12px 16px; border: 1px solid var(--border); border-radius: 10px; background:var(--card); flex: 1;" required>
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
                        <div style="font-size:12px; color:var(--text-sec);">在 CF 面板给 Worker 配 Cron 触发器（如每天 */5 * * * *），自动保活才会按间隔执行；不配 Cron 也可点节点卡片「保活」手动触发。</div>
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

            <div id="kaModal" style="display:none; position:fixed; inset:0; z-index:11020; background:rgba(0,0,0,.5); backdrop-filter:blur(5px); overflow-y:auto; padding:16px;">
                <div style="max-width:480px; margin:24px auto; background:var(--card); border-radius:18px; padding:22px; box-shadow:0 10px 40px rgba(0,0,0,.2);">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px;">
                        <h2 style="margin:0; font-size:19px; display:flex; align-items:center; gap:8px;">${I.bolt} 节点保活</h2>
                        <button onclick="closeKaModal()" style="background:transparent;border:none;cursor:pointer;color:var(--text-sec);display:inline-flex;padding:4px;">${I.xmark}</button>
                    </div>
                    <div id="kaResultBox" style="font-size:13px; line-height:1.8;"></div>
                </div>
            </div>

            <div id="rexModal" style="display:none; position:fixed; inset:0; z-index:11020; background:rgba(0,0,0,.5); backdrop-filter:blur(5px); overflow-y:auto; padding:16px;">
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

            <div id="codeModal" style="display:none; position:fixed; inset:0; z-index:11010; background:rgba(0,0,0,.5); backdrop-filter:blur(5px); overflow-y:auto; padding:16px;">
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

            <div id="placementModal" style="display:none; position:fixed; inset:0; z-index:11010; background:rgba(0,0,0,.5); backdrop-filter:blur(5px); overflow-y:auto; padding:16px;">
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

            <div id="accountModal" style="display:none; position:fixed; inset:0; z-index:11010; background:rgba(0,0,0,.5); backdrop-filter:blur(5px); overflow-y:auto; -webkit-overflow-scrolling:touch; padding:16px 16px 150px;">
                <div style="max-width:560px; margin:24px auto; background:var(--card); border-radius:18px; padding:22px; box-shadow:0 10px 40px rgba(0,0,0,.2);">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px;">
                        <h2 style="margin:0; font-size:19px; display:flex; align-items:center; gap:8px;">${I.gear} 账户设置</h2>
                        <div style="display:flex; align-items:center; gap:8px;">
                            <span id="topVersionBadge" style="background:var(--primary); color:#fff; padding:3px 10px; border-radius:20px; font-size:12px; font-weight:600;">v${CURRENT_VERSION}</span>
                            <button onclick="closeAccountModal()" style="background:transparent;border:none;cursor:pointer;color:var(--text-sec);display:inline-flex;padding:4px;">${I.xmark}</button>
                        </div>
                    </div>
                    <div id="accountAdminPanel" style="display:flex; flex-direction:column; gap:16px;">
                        <div style="background:rgba(120,120,120,0.05); border:1px solid var(--border); border-radius:10px; padding:14px;">
                            <div style="font-size:14px; font-weight:600; margin-bottom:10px;">${I.pencil} 修改登录密码</div>
                            <div style="font-size:12px; color:var(--text-sec); margin-bottom:10px;">${I.warn} Worker 变量 ADMIN_TOKEN 为最高权限，永久有效；此处修改的密码仅对网页生效。</div>
                            <input type="password" id="newAdminPass" placeholder="输入新密码 (至少 4 位)" style="width:100%; padding:10px 14px; border:1px solid var(--border); border-radius:8px; background:var(--bg); margin-bottom:10px;">
                            <button class="btn-submit" onclick="saveAdminPass()" style="width:100%;">${I.check} 保存新密码</button>
                        </div>
                        <div style="background:rgba(120,120,120,0.05); border:1px solid var(--border); border-radius:10px; padding:14px;">
                            <div style="font-size:14px; font-weight:600; margin-bottom:10px;">${I.spy} 反代 Token</div>
                            <div style="font-size:12px; color:var(--text-sec); margin-bottom:10px;">${I.warn} 开启后所有节点链接需带 <b style="color:var(--primary);">/密钥/</b> 前缀才可反代；不带前缀的访问会跳转 /catch 并记录来访 IP（记录存 D1，不占 KV 额度）。</div>
                            <div style="display:flex; align-items:center; gap:10px; margin-bottom:10px;">
                                <label style="display:flex; align-items:center; gap:6px; cursor:pointer; font-size:13px; color:var(--text);">
                                    <input type="checkbox" id="ptOn" style="accent-color:var(--primary); width:16px; height:16px; cursor:pointer;"> 开启
                                </label>
                            </div>
                            <div style="display:flex; gap:8px; margin-bottom:12px;">
                                <input type="text" id="ptKey" placeholder="自定义密钥（3-32 位字母数字，如 lhazkj）" style="flex:1; padding:10px 14px; border:1px solid var(--border); border-radius:8px; background:var(--bg);">
                                <button class="btn-submit" onclick="saveProxyToken()" style="white-space:nowrap;">${I.check} 保存</button>
                            </div>
                            <div style="font-size:13px; font-weight:600; margin-bottom:8px;">来访记录 IP <span style="font-weight:400; color:var(--text-sec);">（仅管理员）</span></div>
                            <div id="ptHits" style="font-size:12px; color:var(--text-sec);">加载中…</div>
                        </div>
                        <div style="background:rgba(120,120,120,0.05); border:1px solid var(--border); border-radius:10px; padding:14px;">
                            <div style="font-size:14px; font-weight:600; margin-bottom:8px;">${I.bulb} 保号通知（Bark / Telegram）</div>
                            <div style="font-size:12px; color:var(--text-sec); margin-bottom:10px;">${I.warn} 节点超观看下限未观看时每日推送一次；测试按钮可立即验证。</div>
                            <div style="display:flex; gap:14px; margin-bottom:10px;">
                                <label style="display:flex;align-items:center;gap:6px;font-size:13px;"><input type="checkbox" id="barkNotify" style="accent-color:var(--primary);"> Bark</label>
                                <label style="display:flex;align-items:center;gap:6px;font-size:13px;"><input type="checkbox" id="tgNotify" style="accent-color:var(--primary);"> Telegram</label>
                            </div>
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
                        <div style="background:rgba(120,120,120,0.05); border:1px solid var(--border); border-radius:10px; padding:14px;">
                            <div style="font-size:14px; font-weight:600; margin-bottom:10px;">${I.robot} 订阅用户管理</div>
                            <div style="font-size:12px; color:var(--text-sec); margin-bottom:10px;">订阅者密码可进入网页，但只能查看节点，不能进行任何修改操作。</div>
                            <div id="subList" style="display:flex; flex-direction:column; gap:8px; margin-bottom:12px;"></div>
                            <div style="display:flex; gap:8px;">
                                <input type="text" id="newSubPass" placeholder="输入新订阅者密码" style="flex:1; padding:10px 14px; border:1px solid var(--border); border-radius:8px; background:var(--bg);">
                                <button class="btn-submit" onclick="addSubscriber()" style="white-space:nowrap;">${I.plus} 添加</button>
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

            <div id="updateModal" style="display:none; position:fixed; inset:0; z-index:12000; background:rgba(0,0,0,.55); backdrop-filter:blur(5px); overflow-y:auto; -webkit-overflow-scrolling:touch; padding:16px 16px 150px;">
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

            <div id="updateResultModal" style="display:none; position:fixed; inset:0; z-index:12010; background:rgba(0,0,0,.55); backdrop-filter:blur(5px); overflow-y:auto; -webkit-overflow-scrolling:touch; padding:16px 16px 150px;">
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
                <div style="display:flex; justify-content: space-between; align-items:center; margin-bottom:16px; flex-wrap:wrap; gap:10px;">
                    <h2 style="margin:0; font-size:18px;">已反代的媒体库</h2>
                    <div style="display: flex; gap: 10px; align-items:center; flex-wrap: wrap;">
                        <button class="btn-submit admin-only" onclick="pingAllNodes()" style=" padding: 10px 14px; font-size: 13px;">${I.bolt} 全局测速</button>
                        <button id="btnPurge" class="btn-submit admin-only" onclick="purgeCache()" style=" padding: 10px 14px; font-size: 13px;">${I.broom} 刷新全站海报</button>
                        <input type="text" id="searchNode" class="search-input" placeholder="搜索备注或后缀查找..." onkeyup="filterNodesList()">
                    </div>
                </div>
                <div class="admin-only" style="background: rgba(0, 122, 255, 0.05); padding: 12px 20px; border-radius: 12px; border: 1px dashed var(--primary); margin-bottom: 20px; margin-top: 20px; display: flex; align-items: center; gap: 15px; flex-wrap: wrap;">
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
                <div id="list-grid" class="node-grid">
                    <div style="text-align:center; color:var(--text-sec); grid-column: 1 / -1; padding: 40px;">读取数据中...</div>
                </div>
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
        const modeNames = { 'off': '保守', 'realip_only': '严格', 'dual': '兼容', 'strict': '强力', 'custom': '伪装(旧)', 'off_fake': '保守+伪装', 'realip_only_fake': '严格+伪装', 'dual_fake': '兼容+伪装', 'strict_fake': '强力+伪装' };
        
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

        // =====================================
        // 数据大屏与统计逻辑 (适配手机端表格排版)
        // =====================================
        async function openDashboard() {
            document.getElementById('dashboardModal').style.display = 'block';
            
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
                        tr.innerHTML = \`
                            <td data-label="访问时间" style="font-size:12px; white-space:nowrap;">\${log.timestamp}</td>
                            <td data-label="目标节点"><span class="badge" style="background:rgba(0,113,227,0.1);color:var(--primary);">\${log.prefix}</span></td>
                            <td data-label="真实 IP" style="font-family:monospace; font-size:13px; color:var(--text-sec); word-break:break-all;">\${log.ip}</td>
                            <td data-label="归属地"><span class="badge" style="background:\${isChina ? 'rgba(52,199,89,0.1)' : 'rgba(255,149,0,0.1)'}; color:\${isChina ? '#34c759' : '#ff9500'};">\${isChina ? '中国大陆' : (log.country || 'Unknown')}</span></td>
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
                // 分时折线（UTC 24h）
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
            document.getElementById('themeToggle').innerHTML = isDark ? I.sun : I.moon;
            localStorage.setItem('emby_proxy_dark', isDark ? '1' : '0');
            if(trendChartInstance) { updateChartColors(); trendChartInstance.update(); locationChartInstance.update(); }
        }
        if (localStorage.getItem('emby_proxy_dark') === '1') { document.body.classList.add('dark'); document.getElementById('themeToggle').innerHTML = I.sun; }

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

        function filterNodesList() {
            const filterText = document.getElementById('searchNode').value.toLowerCase();
            const cards = document.querySelectorAll('.emby-card');
            cards.forEach(card => {
                const searchStr = card.getAttribute('data-search').toLowerCase();
                card.style.display = searchStr.includes(filterText) ? 'flex' : 'none';
            });
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
                await loadPtState();
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
                    const kaNext = r.last_ka_run ? new Date(r.last_ka_run).getTime() + Math.max(0.1, parseFloat(r.ka_days) || 3) * 86400000 : 0;

                    //  接收后端传来的：单节点独立宽带与请求统计数据
                    const todayBw = r.todayBandwidth || '0 B';
                    const totalReqs = r.totalReqs || r.todayReqs || 0;

                    proxyNodesForPing.push({ idx: idx, url: mainTarget });

                    container.innerHTML += \`
                    <div class="emby-card route-item" data-prefix="\${r.prefix}" data-search="\${remarkName} \${r.prefix}">
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
                                <button class="btn-edit" onclick="editNode('\${esc(r.prefix)}', '\${esc(r.target)}', '\${esc(r.mode)}', '\${esc(r.remark || '')}', '\${esc(r.icon || '')}', '\${esc(r.cache_img)}', '\${esc(r.custom_params ? encodeURIComponent(r.custom_params) : '')}', '\${esc(r.ka_enabled || '0')}', '\${esc(r.ka_days || '3')}', '\${esc(r.ka_token || '')}', '\${esc(r.node_user || '')}', '\${esc(r.node_pass || '')}', '\${esc(r.watch_limit || '0')}')">编辑配置</button>
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
        function editNode(prefix, targetStr, mode, remark, icon, cacheImg, customParamsStr, kaEnabled, kaDays, kaToken, nodeUser, nodePass, watchLimit) {
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
                if (data.error) { box.innerHTML = '<div style="color:#ff3b30;">' + data.error + '</div>'; return; }
                const steps = (data.steps || []).map(st => '<div style="color:' + (st.ok ? '#34c759' : '#ff3b30') + ';">' + (st.ok ? '✅' : '❌') + ' ' + st.name + ' — ' + st.detail + '</div>').join('');
                box.innerHTML = kaRingHtml(100, data.ok ? '#34c759' : '#ff3b30')
                    + '<div style="margin-top:-4px;margin-bottom:8px;text-align:center;font-weight:600; color:' + (data.ok ? '#34c759' : '#ff3b30') + ';">' + (data.ok ? '✅ 保活成功' : '❌ 保活失败') + '：' + (data.msg || '') + '</div>'
                    + steps;
            } catch (e) {
                clearInterval(poll);
                box.innerHTML = '<div style="color:#ff3b30;">请求失败: ' + e.message + '</div>';
            }
            load();
        }
        function closeKaModal() { document.getElementById('kaModal').style.display = 'none'; }

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
        function openNodeModal() {
            const f = document.getElementById('addForm');
            f.reset();
            document.getElementById('oldPrefix').value='';
            selectIcon('','默认');
            document.getElementById('nodeCache').checked=true;
            document.getElementById('nodeDlTrick').checked=false;
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
            }
        }
        function closeAccountModal() {
            document.getElementById('accountModal').style.display = 'none';
        }
        let PT = { enabled: false, key: '' };
        function entryUrl(prefix) {
            return 'https://' + window.location.host + '/' + (PT.enabled ? PT.key + '/' : '') + prefix;
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
            await loadNotifyState();
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
                }
            } catch (e) {}
        }
        async function saveNotifySettings() {
            const barkKey = document.getElementById('barkKey').value.trim();
            const barkLevel = document.getElementById('barkLevel').value;
            const barkServer = document.getElementById('barkServer').value.trim();
            const barkNotify = document.getElementById('barkNotify').checked;
            const tgToken = document.getElementById('tgToken').value.trim();
            const tgChatId = document.getElementById('tgChatId').value.trim();
            const tgNotify = document.getElementById('tgNotify').checked;
            const res = await fetch('/api/account', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ notify: { barkKey, barkLevel, barkServer, barkNotify, tgToken, tgChatId, tgNotify } }) });
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
                    body: JSON.stringify({oldPrefix, prefix, target, mode, remark, icon, cache_img, dlTrick, customClient, customVersion, customDevice, customDeviceId, customUa, kaEnabled, kaDays, kaToken, nodeUser, nodePass, watchLimit})
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
            btn.disabled = false; btn.textContent = ' 测试粘贴的节点';
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
            finally { btn.disabled = false; btn.textContent = ' 拉取 API 并测速'; }
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
                showToast(\`✅ 成功提取 \${data.totalCount} 个可用 IP，抽取 \${data.ips.length} 个测速\`);
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
            finally { btn.disabled = false; btn.textContent = ' 提取预设源并测速'; }
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
            document.cookie = "admin_token=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
            window.location.reload();
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
                if (lc) lc.innerHTML = '<div style="font-weight:600; color:var(--text);">v' + latest.version + ' · ' + (latest.date || '') + (latest.title ? ' · ' + latest.title : '') + '</div>' + (latest.items || []).map(i => '· ' + i).join('<br>');
                const hc = document.getElementById('historyChangelog');
                if (hc) hc.innerHTML = cl.versions.slice(1).map(v => '<div style="margin-bottom:10px;"><span style="font-weight:600;">v' + v.version + '</span> <span style="color:var(--text-sec);">(' + (v.date || '') + ')</span>' + (v.title ? ' ' + v.title : '') + '<br>' + (v.items || []).map(i => '&nbsp;&nbsp;· ' + i).join('<br>') + '</div>').join('') || '暂无更多历史记录';
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

        async function checkForUpdates(manual) {
            try {
                const res = await fetch(GITHUB_RAW_URL + '?t=' + new Date().getTime());
                if (!res.ok) { if (manual) alert('检查更新失败：无法访问更新源'); return; }
                latestCode = await res.text();
                
                //  核心修复：加入双重反斜杠，防止正则在 Worker 中变成注释 (//) 导致崩溃
                const versionMatch = latestCode.match(/\\/\\/\\s*VERSION:\\s*v?([\\d\\.]+)/i);
                if (!versionMatch || !versionMatch[1]) { if (manual) alert('未获取到版本信息'); return; }
                latestVersion = versionMatch[1];
                if (latestVersion === CURRENT_VERSION) {
                    if (manual) alert('当前已是最新版本 v' + CURRENT_VERSION);
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
            document.getElementById('updateModalBody').innerHTML = '<div style="font-size:13px; font-weight:600; margin-bottom:8px;">' + (title ? title : '本次更新内容') + '</div>' + (items && items.length ? items.map(i => '· ' + i).join('<br>') : '<span style="color:var(--text-sec);">暂无详细更新内容</span>');
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
                    document.getElementById('updateResultBody').innerHTML = '<div style="font-size:13px; margin-bottom:8px;">已成功更新到 <b style="color:var(--primary);">v' + latestVersion + '</b>，本次更新内容：</div>' + (items.length ? items.map(i => '· ' + i).join('<br>') : '暂无详细更新内容');
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
    @keyframes dsFadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }

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
</style>

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
    ['nodeModal', 'codeModal', 'placementModal', 'accountModal'].forEach(id => {
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
        if (!el || el === header || el.tagName === 'NAV' || el.id === 'toast' || el.id === 'nodeModal' || el.id === 'codeModal' || el.id === 'placementModal' || el.id === 'accountModal' || el.classList.contains('page-view') || el.classList.contains('content-wrap') || el.classList.contains('topbar')) return;
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
        if (text.includes('手动覆盖') || text.includes('Worker 调度模式') || el.id === 'updateAlert' || el.id === 'cf-trace-card' || el.id === 'config-backup-card') {
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
            // 【7天、30天】查询：传入数字代表天数，使用 1dGroups
            const start = new Date(end.getTime() - type * 24 * 3600000);
            const dateGeq = start.toISOString().split('T')[0];
            const dateLeq = end.toISOString().split('T')[0];
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
            // 7天 / 30天：按天聚合 sum.requests 累加
            const start = new Date(end.getTime() - type * 24 * 3600000);
            const dateGeq = start.toISOString().split('T')[0];
            const dateLeq = end.toISOString().split('T')[0];
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

// 今日 CF 全维度统计（一次 GraphQL 批量查询：请求数/带宽/缓存/状态码/国家/分时/防火墙）
async function getCFTodayStats(env) {
    if (!env.CF_API_TOKEN || !env.CF_ZONE_ID) return { ok: false, error: '缺少变量' };
    try {
        const end = new Date();
        const startUtc = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));
        const geq = startUtc.toISOString();
        const leq = end.toISOString();
        const gql = `query {
          viewer {
            zones(filter: {zoneTag: "${env.CF_ZONE_ID}"}) {
              overview: httpRequestsAdaptiveGroups(limit: 1, filter: {datetime_geq: "${geq}", datetime_leq: "${leq}"}) {
                count
                sum { clientRequestBytes cachedBytes }
              }
              byStatus: httpRequestsAdaptiveGroups(limit: 20, filter: {datetime_geq: "${geq}", datetime_leq: "${leq}"}, groupBy: [responseStatus]) {
                count
                dimensions { responseStatus }
              }
              byCountry: httpRequestsAdaptiveGroups(limit: 6, filter: {datetime_geq: "${geq}", datetime_leq: "${leq}"}, groupBy: [clientCountryName]) {
                count
                dimensions { clientCountryName }
              }
              byHour: httpRequestsAdaptiveGroups(limit: 1440, filter: {datetime_geq: "${geq}", datetime_leq: "${leq}"}, groupBy: [datetimeMinute]) {
                count
                dimensions { datetimeMinute }
              }
              blocked: firewallEventsAdaptiveGroups(limit: 1, filter: {datetime_geq: "${geq}", datetime_leq: "${leq}"}) {
                count
              }
            }
          }
        }`;
        const cfRes = await fetch('https://api.cloudflare.com/client/v4/graphql', {
            method: 'POST',
            headers: { 
                'Authorization': `Bearer ${env.CF_API_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ query: gql })
        });
        const data = await cfRes.json();
        if (data.errors && data.errors.length > 0) return { ok: false, error: data.errors[0].message };
        const zones = data?.data?.viewer?.zones?.[0];
        if (!zones) {
            return { ok: true, requests: 0, bytes: 0, cachedBytes: 0, statusCodes: { '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0 }, countries: [], hours: [], blocked: 0 };
        }
        const overview = zones.overview?.[0] || {};
        const codes = { '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0 };
        (zones.byStatus || []).forEach(g => {
            const s = Number(g.dimensions?.responseStatus) || 0;
            if (s >= 500) codes['5xx'] += g.count;
            else if (s >= 400) codes['4xx'] += g.count;
            else if (s >= 300) codes['3xx'] += g.count;
            else if (s >= 200) codes['2xx'] += g.count;
        });
        const hours = new Array(24).fill(0);
        (zones.byHour || []).forEach(g => {
            const dt = new Date(g.dimensions?.datetimeMinute);
            if (!isNaN(dt.getTime())) hours[dt.getUTCHours()] += g.count;
        });
        const countries = (zones.byCountry || []).slice(0, 5).map(g => ({ country: g.dimensions?.clientCountryName || '未知', count: g.count }));
        return {
            ok: true,
            requests: overview.count || 0,
            bytes: overview.sum?.clientRequestBytes || 0,
            cachedBytes: overview.sum?.cachedBytes || 0,
            statusCodes: codes,
            countries,
            hours,
            blocked: zones.blocked?.[0]?.count || 0
        };
    } catch(e) {
        return { ok: false, error: e.message };
    }
}

function kaClientProfile(route) {
  let cp = {};
  try { cp = route && route.custom_params ? JSON.parse(route.custom_params) : {}; } catch (e) {}
  const hasFake = !!(cp.client || cp.version || cp.device || cp.ua);
  return {
    client: hasFake && cp.client ? String(cp.client) : 'SenPlayer',
    version: hasFake && cp.version ? String(cp.version) : '6.0.0',
    device: hasFake && cp.device ? String(cp.device) : 'iPhone',
    ua: hasFake && cp.ua ? String(cp.ua) : 'SenPlayer/6.0.0',
  };
}
/** 原生客户端风格的 Emby 认证头（禁止 Web 格式，很多 Emby 会拒绝 Web 客户端） */
function kaAuthHeader(prof) {
  return {
    'X-Emby-Authorization': 'MediaBrowser Client="' + prof.client + '", Device="' + prof.device + '", DeviceId="emby-keepalive", Version="' + prof.version + '"',
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
async function runKeepAlive(env, route) {
  const steps = [];
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
  const prof = kaClientProfile(route);
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
    try {
      const r = await kaJson(target + '/emby/System/Info', { headers: kaHeaders(prof) });
      addStep('服务探测（未配置凭据）', r.status === 200 || r.status === 401, 'GET /emby/System/Info → ' + r.status);
    } catch (e) { addStep('服务探测', false, e.message); }
    return { ok: true, msg: '该节点未配置 API Key / 账号密码，已执行探测保活（配置凭据后可模拟真实播放）', steps };
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

  let msId = '', playSessionId = '';
  try {
    const r = await kaJson(addApiKey(target + '/emby/Items/' + itemId + '/PlaybackInfo', token), {
      method: 'POST',
      headers: Object.assign(kaHeaders(prof), { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ UserId: userId, DeviceId: 'emby-keepalive', MediaSources: [], AutoOpenLiveStream: false, StartTimeTicks: 0 })
    });
    const ms = (r.data && r.data.MediaSources && r.data.MediaSources[0]) || null;
    if (ms) { msId = ms.Id || ''; }
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
        const bytes = await readStreamUpTo(res, STREAM_BYTES, 25000);
        addStep('模拟拉流', res.status === 200 || res.status === 206, 'Videos/' + String(itemId).slice(0, 8) + '/stream → ' + res.status + '（拉流 ' + (bytes / 1048576).toFixed(1) + 'MB）' + (res.status === 400 ? ' ' + String(txt).slice(0, 120) : ''));
      } else {
        const bytes = await readStreamUpTo(res, STREAM_BYTES, 25000);
        addStep('模拟拉流', true, 'Videos/' + String(itemId).slice(0, 8) + '/stream → ' + res.status + '（拉流 ' + (bytes / 1048576).toFixed(1) + 'MB）');
      }
    } catch (e) { addStep('模拟拉流', false, e.message); }
  } else {
    addStep('模拟拉流', false, '无播放链接，跳过');
  }

  // 播放会话：字段 Emby 标准 PositionTicks（兼容旧字段）；CF 墙钟 30s 限制下用快进心跳模拟 90 秒累计播放进度
  // 模拟真实观看：起始位置随机 1~89 秒（1 分 30 秒前的任意时间点），观看时长随机 60~90 秒，避免每次都从 0 开始固定 90 秒
  const startSec = 1 + Math.floor(Math.random() * 89);
  const playSec = 60 + Math.floor(Math.random() * 31);
  const endSec = startSec + playSec;
  const startTicks = startSec * 10000000;
  const endTicks = endSec * 10000000;
  const CF_HEARTBEATS = Math.max(1, Math.floor(playSec / 10));   // 心跳条数 6~9（每 1.5s 一条，进度每次 +10s）
  const base = { ItemId: itemId, MediaSourceId: msId || itemId, UserId: userId, DeviceId: 'emby-keepalive', PlayMethod: 'DirectStream', CanSeek: true, IsPaused: false, QueueableMediaTypes: ['Video'] };
  if (playSessionId) base.PlaySessionId = playSessionId;
  const kaBody = (posTicks) => JSON.stringify(Object.assign({}, base, { PositionTicks: posTicks, PlaybackPositionTicks: posTicks }));
  const KA_HEADERS = Object.assign(kaHeaders(prof), { 'Content-Type': 'application/json' });

  if (!playSessionId) {
    addStep('播放会话开始', false, '无 PlaySessionId，跳过会话上报（仅拉流保活）');
    addStep('模拟播放时长', false, '无 PlaySessionId，跳过');
  } else {
    try {
      const r = await kaJson(addApiKey(target + '/emby/Sessions/Playing', token), { method: 'POST', headers: KA_HEADERS, body: kaBody(startTicks) });
      addStep('播放会话开始', r.status === 200 || r.status === 204, 'Sessions/Playing → ' + r.status + (r.status === 400 ? ' ' + String(r.text).slice(0, 120) : ''));
    } catch (e) { addStep('播放会话开始', false, e.message); }

    // 快进心跳：CF 单次墙钟 30s，无法真实等待 90 秒；用每 1.5s 一条、进度 +10s 的心跳在预算内凑足 90 秒进度
    let hbOk = 0, hbFail = 0;
    const tStart = Date.now();
    for (let i = 1; i <= CF_HEARTBEATS; i++) {
      if (Date.now() - tStart > 24000) break;   // 心跳段预算 24s，保拉流慢时整体不超墙钟
      await new Promise(res => setTimeout(res, 1500));
      const pos = Math.min(startTicks + i * 10 * 10000000, endTicks);
      saveLive('模拟播放：进度心跳 ' + i + '/' + CF_HEARTBEATS + '（' + fmtPos(pos) + '）', steps.slice(), 66 + (i / CF_HEARTBEATS) * 26);
      try {
        const r = await kaJson(addApiKey(target + '/emby/Sessions/Playing/Progress', token), { method: 'POST', headers: KA_HEADERS, body: kaBody(pos) });
        if (r.status === 200 || r.status === 204) hbOk++; else hbFail++;
      } catch (e) { hbFail++; }
    }
    addStep('模拟播放时长', hbOk > 0, '从 ' + fmtPos(startTicks) + ' 快进 ' + playSec + ' 秒：心跳 ' + hbOk + '/' + CF_HEARTBEATS + ' 条 → ' + fmtPos(endTicks));
  }

  try {
    const r = await kaJson(addApiKey(target + '/emby/Sessions/Playing/Stopped', token), { method: 'POST', headers: KA_HEADERS, body: kaBody(endTicks) });
    addStep('播放会话停止', r.status === 200 || r.status === 204, 'Stopped → ' + r.status + ' (' + fmtPos(endTicks) + ')');
  } catch (e) { addStep('播放会话停止', false, e.message); }

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

  const failed = steps.filter(x => !x.ok).length;
  return { ok: failed < steps.length / 2, msg: '保活完成（' + steps.length + ' 步，' + failed + ' 步异常）', steps };
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
  // 保活结果通知：Bark（iOS）+ Telegram（配置了环境变量时推送，节点显示备注）
  const nodeName = remark || ('/' + prefix);
  const kaText = (ok ? '✅' : '❌') + ' 节点 ' + nodeName + ' 保活' + (ok ? '成功' : '失败') + (detail ? '：' + detail : '');
  try {
    if (env.BARK_KEY) {
      await fetch('https://api.day.app/' + String(env.BARK_KEY).trim(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Emby 反代面板', body: kaText, level: env.BARK_LEVEL || 'active' })
      });
    }
  } catch (e) {}
  try {
    if (env.TG_BOT_TOKEN && env.TG_CHAT_ID) {
      await fetch('https://api.telegram.org/bot' + env.TG_BOT_TOKEN + '/sendMessage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: String(env.TG_CHAT_ID), text: kaText })
      });
    }
  } catch (e) {}
}

async function checkKeepAliveSchedule(env) {
  try {
    try { await env.DB.exec(`ALTER TABLE routes ADD COLUMN ka_enabled TEXT DEFAULT '0'`); } catch(e) {}
    try { await env.DB.exec(`ALTER TABLE routes ADD COLUMN ka_days TEXT DEFAULT '3'`); } catch(e) {}
    try { await env.DB.exec(`ALTER TABLE routes ADD COLUMN ka_token TEXT DEFAULT ''`); } catch(e) {}
    try { await env.DB.exec(`ALTER TABLE routes ADD COLUMN node_user TEXT DEFAULT ''`); } catch(e) {}
    try { await env.DB.exec(`ALTER TABLE routes ADD COLUMN node_pass TEXT DEFAULT ''`); } catch(e) {}
    try { await env.DB.exec(`ALTER TABLE routes ADD COLUMN last_ka_run TEXT DEFAULT ''`); } catch(e) {}
    try { await env.DB.exec(`ALTER TABLE routes ADD COLUMN last_ka_result TEXT DEFAULT ''`); } catch(e) {}
    try { await env.DB.exec(`ALTER TABLE routes ADD COLUMN last_ka_detail TEXT DEFAULT ''`); } catch(e) {}
    const { results: routes } = await env.DB.prepare(`SELECT * FROM routes WHERE ka_enabled = '1'`).all();
    if (!routes || routes.length === 0) return;
    const liveRow = await env.DB.prepare("SELECT value FROM app_config WHERE key = ?").bind('ka_live').first();
    if (liveRow && liveRow.value) {
        try { const ls = JSON.parse(liveRow.value); if (ls && ls.running) return; } catch(e) {}
    }
    const due = routes.filter(r => {
      const days = Math.max(0.1, parseFloat(r.ka_days) || 3);
      const last = r.last_ka_run ? new Date(r.last_ka_run).getTime() : 0;
      return !last || Date.now() - last >= days * 86400000;
    });
    if (due.length === 0) return;
    due.sort((a, b) => {
      const da = a.last_ka_run ? new Date(a.last_ka_run).getTime() : 0;
      const db = b.last_ka_run ? new Date(b.last_ka_run).getTime() : 0;
      return da - db;
    });
    const route = due[0];
    const result = await runKeepAlive(env, route);
    await env.DB.prepare('UPDATE routes SET last_ka_run = ?, last_ka_result = ?, last_ka_detail = ? WHERE prefix = ?')
      .bind(new Date().toISOString(), result.ok ? 'success' : 'fail', result.msg || '', route.prefix).run();
    await pushKaNotice(env, route.prefix, result.ok, result.msg, route.remark);
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

/** 下载伪装伴随观看（CF 版）：起播 → 流驱动心跳 → 结束收尾。
 *  与 VPS 版同款协议：Sessions/Playing 起播 → Playing/Progress 心跳（首次固定 10s、第二次固定 30s、
 *  之后 15s~3 分钟随机）→ Stopped 结束 → 1.5s 后重置 UserData 清除播放记录。
 *  CF 运行时限制：不依赖后台定时器，心跳由响应流的读取节奏驱动（每次读到数据块检查是否到点）；
 *  收尾通过 ctx.waitUntil 保证在响应结束后仍执行完毕。 */
function spawnDlTrickWatchCF(target, req, itemId, search) {
    try {
        const params = new URLSearchParams((search || '').replace(/^\?/, ''));
        const apiKey = params.get('api_key') || params.get('X-Emby-Token') || '';
        const authHdr = req.headers.get('x-emby-authorization') || req.headers.get('authorization') || '';
        if (!apiKey && !authHdr) return null;   // 无凭据无法伪装，直接跳过
        const msId = params.get('mediaSourceId') || params.get('MediaSourceId') || '';
        const mClient = String(authHdr).match(/Client="([^"]+)"/i);
        const mVersion = String(authHdr).match(/Version="([^"]+)"/i);
        // 独立虚拟设备ID：下载心跳不占用播放器真实设备会话。
        // 否则下载期间上游认为"播放器设备已在播放"，用户再点播放时同设备并发会话被上游卡住 → 一直缓冲
        const deviceId = genUuid();
        const client = (mClient && mClient[1]) || 'Emby';
        const version = (mVersion && mVersion[1]) || '4.8.0.0';
        const playSessionId = 'bemby-' + Date.now();
        let targetOrigin = '';
        try { targetOrigin = new URL(target).origin; } catch(e) { return null; }
        const hdrs = { 'Content-Type': 'application/json' };
        if (authHdr) hdrs['X-Emby-Authorization'] = authHdr.replace(/DeviceId\s*=\s*"[^"]*"/i, `DeviceId="${deviceId}"`);
        const url = path => addApiKey(targetOrigin + path, apiKey);
        const base = { ItemId: itemId, MediaSourceId: msId || itemId, PlaySessionId: playSessionId, DeviceId: deviceId, Client: client, Version: version, PlayMethod: 'DirectStream', CanSeek: true, IsPaused: false, QueueableMediaTypes: ['Video'] };
        const watchBody = pos => JSON.stringify(Object.assign({}, base, { PositionTicks: pos, PlaybackPositionTicks: pos }));
        let closed = false, posTicks = 0, userId = '';
        let tickCount = 0, nextWait = 10, nextHeartAt = Date.now() + 10000;   // 首次固定 10s，第二次固定 30s，之后 15~180s 随机
        const post = (path, body) => kaFetch(url(path), { method: 'POST', headers: hdrs, body }).catch(() => null);
        // 起播 + 预取用户信息（fire-and-forget，响应流期间事件循环可执行）
        post('/emby/Sessions/Playing', watchBody(0));
        kaFetch(url('/emby/Users/Me'), { headers: hdrs }).then(async r => {
            try { userId = (JSON.parse(await r.text()) || {}).Id || ''; } catch(e){}
        }).catch(() => {});
        return {
            // 响应流驱动心跳：每次读到数据块后调用，到达心跳时间点即上报（不 await，避免拖慢流转发）
            tick() {
                if (closed) return;
                const now = Date.now();
                if (now < nextHeartAt) return;
                tickCount += 1;
                posTicks += nextWait * 10000000;
                nextHeartAt = now + nextWait * 1000;
                // 第一次固定 10s（已发出），第二次固定 30s，之后 15~180s 随机
                nextWait = tickCount === 1 ? 30 : (15 + Math.floor(Math.random() * 166));
                post('/emby/Sessions/Playing/Progress', watchBody(posTicks));
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
function wrapStreamWithWatch(stream, watch, ctx) {
    const reader = stream.getReader();
    const runFinish = () => {
        try { const p = watch.finish(); if (p && ctx && ctx.waitUntil) ctx.waitUntil(p); } catch(e){}
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
                try { watch.tick(); } catch(e){}
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
    let cfg = { barkKey: '', barkLevel: 'active', barkServer: 'https://api.day.app', barkNotify: true, tgToken: '', tgChatId: '', tgNotify: true };
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
        try { await env.DB.exec(`ALTER TABLE routes ADD COLUMN watch_limit TEXT DEFAULT '0'`); } catch (e) {}
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
async function maybeScanOverdue(env) {
    try {
        if (!env.DB) return;
        const now = Date.now();
        const row = await env.DB.prepare("SELECT value FROM app_config WHERE key = 'overdue_last_check'").first();
        let lastCheck = 0;
        if (row && row.value) lastCheck = parseInt(row.value, 10) || 0;
        if (now - lastCheck < 6 * 3600000) return;
        await env.DB.prepare('INSERT OR REPLACE INTO app_config (key, value) VALUES (?, ?)').bind('overdue_last_check', String(now)).run();
        await scanOverdueNotify(env, {});
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
        const row = await env.DB.prepare("SELECT value FROM app_config WHERE key = 'update_notify_last_check'").first();
        let lastCheck = 0;
        if (row && row.value) lastCheck = parseInt(row.value, 10) || 0;
        if (now - lastCheck < 6 * 3600000) return;
        await env.DB.prepare('INSERT OR REPLACE INTO app_config (key, value) VALUES (?, ?)').bind('update_notify_last_check', String(now)).run();
        await checkUpdateNotify(env);
    } catch (e) {}
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
                    "Expires": "0",
                    "Access-Control-Allow-Origin": "*"
                }
            });
        }

        // Telegram Webhook 拦截
        if (url.pathname === '/api/tg-webhook' && request.method === 'POST') {
            try {
                const body = await request.json();
                if (body.message && body.message.text === '/stats') {
                    if (env.DB && env.TG_BOT_TOKEN) {
                        ctx.waitUntil(sendTgStats(env, body.message.chat.id));
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
                await env.DB.prepare('CREATE TABLE IF NOT EXISTS app_config (key TEXT PRIMARY KEY, value TEXT)').run();
                const row = await env.DB.prepare("SELECT value FROM app_config WHERE key = 'proxy_token'").first();
                if (!row || !row.value) return null;
                return JSON.parse(row.value);
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

        const EXPECTED_TOKEN = env.ADMIN_TOKEN;
        if (!EXPECTED_TOKEN) return new Response("请在 Worker 变量中配置 ADMIN_TOKEN", { status: 500 });

        function getCookie(req, name) {
            const cookieString = req.headers.get("Cookie");
            if (!cookieString) return null;
            const match = cookieString.match(new RegExp('(^| )' + name + '=([^;]+)'));
            if (match) { try { return decodeURIComponent(match[2]); } catch(e) { return match[2]; } }
            return null;
        }

        // 三档认证：env.ADMIN_TOKEN(永不失效) > 网页修改的管理员密码 > 订阅者密码(只读)
        async function getAuthRole(req) {
            const token = getCookie(req, 'admin_token');
            if (!token) return null;
            if (token === EXPECTED_TOKEN) return 'admin';
            if (!env.DB) return null;
            try {
                await env.DB.prepare('CREATE TABLE IF NOT EXISTS app_config (key TEXT PRIMARY KEY, value TEXT)').run();
                const adminRow = await env.DB.prepare('SELECT value FROM app_config WHERE key = ?').bind('admin_pass').first();
                if (adminRow && adminRow.value && token === adminRow.value) return 'admin';
                const subRow = await env.DB.prepare('SELECT value FROM app_config WHERE key = ?').bind('subscribers').first();
                if (subRow && subRow.value) {
                    const list = JSON.parse(subRow.value);
                    if (Array.isArray(list) && list.includes(token)) return 'sub';
                }
            } catch (e) {}
            return null;
        }

        const isPanelOrApi = url.pathname === '/' || url.pathname.startsWith('/api/');
        let ROLE = null;
        if (isPanelOrApi && url.pathname !== '/api/tg-webhook') {
            ROLE = await getAuthRole(request);
            if (!ROLE) {
                if (url.pathname === '/') return new Response(LOGIN_UI, { headers: { "Content-Type": "text/html;charset=UTF-8" } });
                else return new Response('Unauthorized', { status: 401 });
            }
        }

        if (url.pathname === '/') {
            return new Response(HTML_UI, { headers: { "Content-Type": "text/html;charset=UTF-8" } });
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
            return Response.json({ success: true, barkKey: cfg.barkKey ? '********' : '', barkLevel: cfg.barkLevel || 'active', barkServer: cfg.barkServer || 'https://api.day.app', barkNotify: cfg.barkNotify !== false, tgToken: cfg.tgToken ? '********' : '', tgChatId: cfg.tgChatId || '', tgNotify: cfg.tgNotify !== false });
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

        if (url.pathname === '/api/account' && request.method === 'POST') {
            if (ROLE !== 'admin') return new Response('Forbidden', { status: 403 });
            try {
                const data = await request.json();
                if (data.proxyToken !== undefined) {
                    const pt = data.proxyToken;
                    const enabled = !!pt.enabled;
                    const key = String(pt.key || '').trim();
                    if (enabled && !/^[A-Za-z0-9]{3,32}$/.test(key)) return Response.json({ success: false, error: '密钥需 3-32 位字母数字' });
                    if (!env.DB) return Response.json({ success: false, error: 'D1 未绑定：请在 Worker 设置里绑定名为 DB 的 D1 数据库' });
                    await env.DB.prepare('CREATE TABLE IF NOT EXISTS app_config (key TEXT PRIMARY KEY, value TEXT)').run();
                    await env.DB.prepare('INSERT OR REPLACE INTO app_config (key, value) VALUES (?, ?)').bind('proxy_token', JSON.stringify({ enabled, key })).run();
                    return Response.json({ success: true });
                }
                if (data.notify !== undefined) {
                    const n = data.notify;
                    if (!env.DB) return Response.json({ success: false, error: 'D1 未绑定：请在 Worker 设置里绑定名为 DB 的 D1 数据库' });
                    await env.DB.prepare('CREATE TABLE IF NOT EXISTS app_config (key TEXT PRIMARY KEY, value TEXT)').run();
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
                        tgNotify: n.tgNotify !== false
                    };
                    await env.DB.prepare('INSERT OR REPLACE INTO app_config (key, value) VALUES (?, ?)').bind('notify_settings', JSON.stringify(cfg)).run();
                    return Response.json({ success: true });
                }
                if (data.updateNotify !== undefined) {
                    if (!env.DB) return Response.json({ success: false, error: 'D1 未绑定：请在 Worker 设置里绑定名为 DB 的 D1 数据库' });
                    await env.DB.prepare('CREATE TABLE IF NOT EXISTS app_config (key TEXT PRIMARY KEY, value TEXT)').run();
                    await env.DB.prepare('INSERT OR REPLACE INTO app_config (key, value) VALUES (?, ?)').bind('update_notify', data.updateNotify ? '1' : '0').run();
                    return Response.json({ success: true });
                }
                const pw = String(data.password || '').trim();
                if (pw.length < 4) return Response.json({ success: false, error: '密码至少 4 位' });
                await env.DB.prepare('CREATE TABLE IF NOT EXISTS app_config (key TEXT PRIMARY KEY, value TEXT)').run();
                await env.DB.prepare('INSERT OR REPLACE INTO app_config (key, value) VALUES (?, ?)').bind('admin_pass', pw).run();
                return Response.json({ success: true });
            } catch (e) {
                return Response.json({ success: false, error: e.message });
            }
        }

        // 反代 Token 状态（登录可见；未登录 401）
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

        if (url.pathname === '/api/subscribers' && request.method === 'GET') {
            if (ROLE !== 'admin') return new Response('Forbidden', { status: 403 });
            try {
                await env.DB.prepare('CREATE TABLE IF NOT EXISTS app_config (key TEXT PRIMARY KEY, value TEXT)').run();
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
                await env.DB.prepare('CREATE TABLE IF NOT EXISTS app_config (key TEXT PRIMARY KEY, value TEXT)').run();
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

                const trend = await env.DB.prepare(`SELECT date(timestamp, '+8 hours') as date, COUNT(*) as count FROM visitor_logs WHERE timestamp >= datetime('now', '-7 days') GROUP BY date(timestamp, '+8 hours') ORDER BY date ASC`).all();
                const locations = await env.DB.prepare(`SELECT country, COUNT(*) as count FROM visitor_logs WHERE timestamp >= datetime('now', '-7 days') GROUP BY country ORDER BY count DESC`).all();
                const recents = await env.DB.prepare(`SELECT prefix, datetime(timestamp, '+8 hours') as timestamp, ip, country, ua FROM visitor_logs ORDER BY timestamp DESC LIMIT 20`).all();
                
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

                const preservedBindings = [];
                // 2. 备份普通的字符串变量
                for (const key in env) {
                    if (typeof env[key] === 'string') {
                        preservedBindings.push({ name: key, type: 'plain_text', text: env[key] });
                    }
                }

                // 3. 拉取 D1、KV 等高级绑定并无损合并
                const bindingsRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${workerName}/bindings`, {
                    headers: { 'Authorization': `Bearer ${cfToken}` }
                });
                const bindingsData = await bindingsRes.json();
                if (bindingsData.success && Array.isArray(bindingsData.result)) {
                    for (const b of bindingsData.result) {
                        if (b.type !== 'plain_text' && b.type !== 'secret_text' && b.type !== 'inherited') {
                            preservedBindings.push(b);
                        }
                    }
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
                        const body = await request.json(); const ips = body.ips;
            const cfToken = env.CF_API_TOKEN; const zoneId = env.CF_ZONE_ID; const domain = env.CF_DOMAIN;

            if (!cfToken || !zoneId || !domain) return Response.json({ success: false, error: '缺少 DNS 环境变量' });
            try {
                const getRes = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records?name=${domain}`, { headers: { 'Authorization': `Bearer ${cfToken}` } });
                const getData = await getRes.json();
                if (!getData.success) throw new Error('获取现有 DNS 记录失败');

                const oldRecords = getData.result.filter(r => r.type === 'A' || r.type === 'AAAA' || r.type === 'CNAME');
                for (const record of oldRecords) {
                    await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records/${record.id}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${cfToken}` } });
                }

                for (const ip of ips) {
                    const cleanItem = ip.replace(/[\[\]]/g, ''); let recordType = 'A';
                    if (cleanItem.includes(':')) recordType = 'AAAA'; else if (/[a-zA-Z]/.test(cleanItem)) recordType = 'CNAME';

                    const postRes = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records`, { method: 'POST', headers: { 'Authorization': `Bearer ${cfToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ type: recordType, name: domain, content: cleanItem, ttl: 60, proxied: false }) });
                    const postData = await postRes.json();
                    if(!postData.success) throw new Error(`记录提交失败: ` + JSON.stringify(postData.errors));
                }
                return Response.json({ success: true, message: `${I.check} 成功！` });
            } catch (error) { return Response.json({ success: false, error: error.message }); }
        }

        if (url.pathname === '/api/get-custom-api-ips') {
            try {
                const apiUrl = url.searchParams.get('url');
                if (!apiUrl) throw new Error("缺少 URL");
                const response = await fetch(apiUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
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

        if (url.pathname === '/api/get-remote-ips') {
            try {
                const reqType = (url.searchParams.get('type') || 'all').toLowerCase();
                const validIPs = new Set();

                if (['all', '电信', '联通', '移动', '多线', 'ipv6'].includes(reqType)) {
                    try {
                        const res1 = await fetch('https://api.uouin.com/cloudflare.html', { headers: { 'User-Agent': 'Mozilla/5.0' } });
                        if(res1.ok) {
                            const text1 = await res1.text(); const cleanText = text1.replace(/<[^>]+>/g, ' ');
                            const regex = /(电信|联通|移动|多线|ipv6)\s+((?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)|(?:[a-fA-F0-9]{1,4}:)+[a-fA-F0-9]{1,4})/gi;
                            let match; while ((match = regex.exec(cleanText)) !== null) {
                                const lineType = match[1].toLowerCase(); let ip = match[2];
                                if (ip.includes(':') && !ip.startsWith('[')) ip = `[${ip}]`;
                                if (reqType === 'all' || reqType === lineType) validIPs.add(ip);
                            }
                        }
                    } catch(e) {}
                }

                if (['all', '优选'].includes(reqType)) {
                    try {
                        const res2 = await fetch('https://raw.githubusercontent.com/ZhiXuanWang/cf-speed-dns/refs/heads/main/ipTop10.html', { headers: { 'User-Agent': 'Mozilla/5.0' } });
                        if(res2.ok) {
                            const text2 = await res2.text(); const ipv4Regex = /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g;
                            const matched = text2.match(ipv4Regex) || []; matched.forEach(ip => { if (!ip.startsWith('10.') && !ip.startsWith('192.168.') && !ip.startsWith('127.')) validIPs.add(ip); });
                        }
                    } catch(e) {}
                }
                const uniqueIPArray = Array.from(validIPs);
                for (let i = uniqueIPArray.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [uniqueIPArray[i], uniqueIPArray[j]] = [uniqueIPArray[j], uniqueIPArray[i]]; }
                return Response.json({ success: true, ips: uniqueIPArray.slice(0, 10), totalCount: uniqueIPArray.length });
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
                        await env.DB.prepare('INSERT OR REPLACE INTO routes (prefix, target, mode, remark, last_play, icon, custom_params, cache_img, sort_order, watch_limit, ka_enabled, ka_days, ka_token, node_user, node_pass) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
                            .bind(r.prefix, r.target, r.mode || 'off', r.remark || '', r.last_play || '', r.icon || '', r.custom_params || '', r.cache_img || 'on', r.sort_order || 0, r.watch_limit || '0', r.ka_enabled || '0', r.ka_days || '3', r.ka_token || '', r.node_user || '', r.node_pass || '').run();
                    }
                }
                return Response.json({ success: true });
            } catch (e) { return Response.json({ success: false, error: e.message }); }
        }

        // ==========================================
        //  自动保活：手动执行（节点级，管理员）
        // ==========================================
        if (url.pathname === '/api/keepalive/status' && request.method === 'GET') {
            if (!env.DB) return Response.json({ running: false });
            try {
                const row = await env.DB.prepare('SELECT value FROM app_config WHERE key = ?').bind('ka_live').first();
                if (row && row.value) return Response.json(JSON.parse(row.value));
                return Response.json({ running: false });
            } catch (e) { return Response.json({ running: false }); }
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

        if (url.pathname === '/api/keepalive/run' && request.method === 'POST') {
            if (ROLE !== 'admin') return new Response('Forbidden', { status: 403 });
            if (!env.DB) return Response.json({ success: false, error: '未绑定 D1 数据库' });
            try {
                const body = await request.json();
                const prefix = String((body && body.prefix) || '').trim();
                if (!prefix) return Response.json({ success: false, error: '缺少节点前缀' });
                const curRow = await env.DB.prepare("SELECT value FROM app_config WHERE key = ?").bind('ka_live').first();
                if (curRow && curRow.value) {
                    try { const curSt = JSON.parse(curRow.value); if (curSt && curSt.running) return Response.json({ success: false, error: '已有保活任务正在运行，请稍后重试' }); } catch(e) {}
                }
                const route = await env.DB.prepare('SELECT * FROM routes WHERE prefix = ?').bind(prefix).first();
                if (!route) return Response.json({ success: false, error: '节点不存在' });
                await env.DB.prepare('INSERT OR REPLACE INTO app_config (key, value) VALUES (?, ?)')
                    .bind('ka_live', JSON.stringify({ running: true, prefix: prefix, current: '初始化保活任务…', steps: [], progress: 3, mediaTitle: '', updatedAt: Date.now() })).run();
                const result = await runKeepAlive(env, route);
                await env.DB.prepare('UPDATE routes SET last_ka_run = ?, last_ka_result = ?, last_ka_detail = ? WHERE prefix = ?')
                    .bind(new Date().toISOString(), result.ok ? 'success' : 'fail', result.msg || '', prefix).run();
                await pushKaNotice(env, prefix, result.ok, result.msg, route.remark);
                await env.DB.prepare('INSERT OR REPLACE INTO app_config (key, value) VALUES (?, ?)')
                    .bind('ka_live', JSON.stringify({ running: false, prefix: prefix, current: '', steps: result.steps || [], msg: result.msg || '', progress: 100, mediaTitle: '', updatedAt: Date.now() })).run();
                return Response.json(result);
            } catch (e) {
                return Response.json({ success: false, error: '保活执行异常: ' + e.message });
            }
        }

        if (url.pathname.startsWith('/api/routes')) {
            if (!env.DB) return Response.json({ error: "由于未绑定 D1 数据库，反代功能不可用。" }, { status: 500 });

            await env.DB.exec(`CREATE TABLE IF NOT EXISTS routes (prefix TEXT PRIMARY KEY, target TEXT NOT NULL)`);
            await env.DB.exec(`CREATE TABLE IF NOT EXISTS request_stats (prefix TEXT, date TEXT, count INTEGER DEFAULT 0, PRIMARY KEY(prefix, date))`);
            // 大数据记录核心表：访客日志
            await env.DB.exec(`CREATE TABLE IF NOT EXISTS visitor_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, prefix TEXT, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP, ip TEXT, country TEXT, ua TEXT)`);
            
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
if (request.method !== 'GET' && ROLE !== 'admin') return new Response('Forbidden', { status: 403 });
            
            // 数据防爆清理策略：自动清理过去 7 天的精细日志
            try { await env.DB.exec(`DELETE FROM visitor_logs WHERE timestamp < datetime('now', '-7 days')`); } catch(e) {}

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

                if (ROLE === 'admin' && env.CF_API_TOKEN && env.CF_ZONE_ID && routes && routes.length > 0) {
                    const end = new Date();
                    const beijingTime = new Date(end.getTime() + 8 * 3600000);
                    beijingTime.setUTCHours(0, 0, 0, 0);
                    const start = new Date(beijingTime.getTime() - 8 * 3600000);

                    // 核心修复：将“一条复杂查询”拆解为 Promise.all 并发单体查询，并且 limit 设为严格的 1
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
                            
                            // 精准提取该节点跑出的流量字节
                            const bytes = cfData?.data?.viewer?.zones?.[0]?.httpRequestsAdaptiveGroups?.[0]?.sum?.edgeResponseBytes || 0;
                            
                            // 自动格式化换算单位
                            let formatted = "0 B";
                            if (bytes >= 1099511627776) formatted = (bytes / 1099511627776).toFixed(2) + " TB";
                            else if (bytes >= 1073741824) formatted = (bytes / 1073741824).toFixed(2) + " GB";
                            else if (bytes >= 1048576) formatted = (bytes / 1048576).toFixed(2) + " MB";
                            else if (bytes >= 1024) formatted = (bytes / 1024).toFixed(2) + " KB";
                            else if (bytes > 0) formatted = bytes + " B";
                            
                            r.todayBandwidth = formatted;
                        } catch(e) { 
                            r.todayBandwidth = "获取异常"; 
                        }
                    }));
                }
                
                // 订阅者不可见源站链接（target 字段剥离，防止直接调 API 查看源站）
                if (ROLE === 'sub' && Array.isArray(routes)) {
                    routes = routes.map(r => { const c = { ...r }; delete c.target; return c; });
                }
                return Response.json(routes || []);
            }
            
            if (request.method === 'POST') {
                const data = await request.json(); let currentSortOrder = 0;
                if (data.oldPrefix && data.oldPrefix !== data.prefix) {
                    const oldRow = await env.DB.prepare('SELECT sort_order FROM routes WHERE prefix = ?').bind(data.oldPrefix).first();
                    if(oldRow) currentSortOrder = oldRow.sort_order;
                    await env.DB.prepare('DELETE FROM routes WHERE prefix = ?').bind(data.oldPrefix).run();
                } else {
                    const oldRow = await env.DB.prepare('SELECT sort_order FROM routes WHERE prefix = ?').bind(data.prefix).first();
                    if(oldRow) currentSortOrder = oldRow.sort_order;
                }
                
                const custom_params = JSON.stringify({
                    client: data.customClient || '',
                    version: data.customVersion || '',
                    device: data.customDevice || '',
                    deviceId: data.customDeviceId || genUuid(),
                    ua: data.customUa || '',
                    dlTrick: data.dlTrick === '1'
                });

                await env.DB.prepare('INSERT OR REPLACE INTO routes (prefix, target, mode, remark, icon, custom_params, cache_img, sort_order, ka_enabled, ka_days, ka_token, node_user, node_pass, watch_limit) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
                    .bind(data.prefix, data.target, data.mode || 'off', data.remark || '', data.icon || '', custom_params, data.cache_img || 'on', currentSortOrder, data.kaEnabled || '0', data.kaDays || '3', data.kaToken || '', data.nodeUser || '', data.nodePass || '', data.watchLimit || '0').run();
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
            if (/^https?:\/\//i.test(location)) return `${proxyOrigin}${safePrefix}/${encodeURIComponent(location)}`;
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
                        return `${proxyOrigin}${safePrefix}/${parsed.href}`;
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
            targetUrls = [decodedPath.substring(1)]; remainingPath = '';
        } else {
            const pathParts = decodedPath.split('/'); const prefix = pathParts[1]; 
            if (!prefix) return new Response(`Not Found`, { status: 404 });

            try {
                if (!env.DB) return new Response(`404: Node not found (DB not bound)`, { status: 404 });
                const stmt = env.DB.prepare(`SELECT target, mode, cache_img, custom_params FROM routes WHERE prefix = ?`);
                const route = await stmt.bind(prefix).first();
                if (!route) return new Response(`404: Node not found`, { status: 404 });

                currentMode = route.mode || 'off'; enableCache = (route.cache_img !== 'off');
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
                
                if (remainingPath.startsWith('/http://') || remainingPath.startsWith('/https://')) { targetUrls = [remainingPath.substring(1)]; remainingPath = ''; }
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
                    const fDeviceId = customParamsObj.deviceId || 'emby-keepalive';
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
        if (dlTrickItemId && finalResponse.status === 200 && finalResponse.body) {
            const dlWatch = spawnDlTrickWatchCF(finalTargetUrl, request, dlTrickItemId, url.search);
            if (dlWatch) {
                finalResponse = new Response(wrapStreamWithWatch(finalResponse.body, dlWatch, ctx), {
                    status: finalResponse.status, statusText: finalResponse.statusText, headers: responseHeaders
                });
            }
        }

        // ==========================================
        //  修复版 302 拦截：恢复 URL 编码
        // ==========================================
        if ([301, 302, 303, 307, 308].includes(finalResponse.status)) {
            const location = responseHeaders.get('Location');
            const rewrittenLocation = rewriteRedirectLocation(location, finalTargetUrl, targetOrigins, proxyOrigin, safePrefix);
            if (rewrittenLocation !== location) {
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
                    });
                }
                if (modified) { 
                    dropBodyIntegrityHeaders(responseHeaders);
                    return new Response(JSON.stringify(data), { status: finalResponse.status, statusText: finalResponse.statusText, headers: responseHeaders }); 
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
