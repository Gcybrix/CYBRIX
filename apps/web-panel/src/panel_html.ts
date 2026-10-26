/**
 * CYBRIX Web Panel — self-contained SPA served by the worker.
 * One inline HTML document: CSS + JS + SVG all inline, zero external resources.
 * NOTE: this template literal must stay free of backticks, "${" and backslashes.
 */
export const PANEL_HTML = `<!doctype html>
<html lang="fa" dir="rtl" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<meta name="color-scheme" content="dark light">
<title>CYBRIX Panel — Code. Security. Innovation.</title>
<style>
:root{color-scheme:dark}
:root[data-theme='dark']{--bg:#050b06;--bg2:#0a140d;--card:rgba(255,255,255,.04);--border:rgba(255,255,255,.09);--text:#e8f5ec;--muted:#8fa89a;--accent:#22ff88;--accent2:#00e676;--danger:#ff5470;--warn:#ffb454;--info:#7fb5ff;--topbar:rgba(5,11,6,.74);--shadow:0 12px 34px rgba(0,0,0,.4);--glow1:rgba(34,255,136,.09);--glow2:rgba(0,230,118,.07);--onaccent:#04140a}
:root[data-theme='light']{color-scheme:light;--bg:#f2f6f3;--bg2:#ffffff;--card:rgba(255,255,255,.8);--border:rgba(5,11,6,.13);--text:#0b1f12;--muted:#54705f;--accent:#00a35a;--accent2:#00854a;--danger:#d8284e;--warn:#b26a00;--info:#2b6cb0;--topbar:rgba(242,246,243,.82);--shadow:0 10px 26px rgba(11,31,18,.1);--glow1:rgba(0,163,90,.09);--glow2:rgba(0,133,74,.07);--onaccent:#ffffff}
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{min-height:100vh;display:flex;flex-direction:column;background:var(--bg);color:var(--text);font-family:Inter,'Vazirmatn',system-ui,-apple-system,'Segoe UI',Tahoma,Arial,sans-serif;font-size:15px;line-height:1.65;-webkit-font-smoothing:antialiased;overflow-x:hidden;max-width:100vw}
body::before{content:'';position:fixed;inset:0;z-index:0;pointer-events:none;background:radial-gradient(640px 320px at 85% -10%,var(--glow1),transparent 60%),radial-gradient(520px 280px at 8% 110%,var(--glow2),transparent 60%)}
#shell,#login-screen{position:relative;z-index:1}
a{color:var(--accent)}
button,input{font:inherit;color:inherit}
[hidden]{display:none!important}
.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
.skip{position:absolute;inset-inline-start:-9999px;top:8px;z-index:200;background:var(--accent);color:var(--onaccent);padding:8px 14px;border-radius:10px;font-weight:700;text-decoration:none}
.skip:focus{inset-inline-start:8px}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:6px}
::selection{background:rgba(34,255,136,.28)}
::-webkit-scrollbar{width:10px;height:10px}
::-webkit-scrollbar-thumb{background:var(--border);border-radius:8px}
.card{background:var(--card);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border:1px solid var(--border);border-radius:16px;box-shadow:var(--shadow)}
.muted{color:var(--muted)}
.small{font-size:12.5px}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;background:linear-gradient(135deg,var(--accent),var(--accent2));color:var(--onaccent);font-weight:700;border:0;border-radius:12px;padding:10px 20px;cursor:pointer;transition:filter .15s,transform .1s}
.btn:hover{filter:brightness(1.06)}
.btn:active{transform:translateY(1px)}
.btn:disabled{opacity:.55;cursor:not-allowed;filter:none}
.btn-ghost{background:transparent;border:1px solid var(--border);color:var(--text)}
.btn-ghost:hover{border-color:var(--accent);color:var(--accent)}
.btn-sm{padding:7px 14px;font-size:13px;border-radius:10px}
.btn-block{width:100%}
.icon-btn{background:transparent;border:1px solid var(--border);border-radius:10px;min-width:38px;min-height:38px;padding:0 10px;cursor:pointer;font-weight:700;font-size:14px;display:inline-flex;align-items:center;justify-content:center}
.icon-btn:hover{border-color:var(--accent);color:var(--accent)}
/* ---------- login ---------- */
#login-screen{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:22px}
.login-card{width:min(430px,100%);padding:36px 30px 26px;text-align:center;position:relative}
.logo-text{font-size:46px;letter-spacing:12px;font-weight:800;margin:10px 0 0;text-indent:12px;background:linear-gradient(90deg,var(--accent),var(--accent2));-webkit-background-clip:text;background-clip:text;color:transparent}
.slogan{margin:2px 0 18px;color:var(--muted);letter-spacing:.12em;font-size:12px;text-transform:uppercase}
.login-heading{font-size:18px;margin:6px 0 4px}
.login-hint{font-size:13px;margin:0 0 16px}
.field-label{display:block;text-align:start;font-size:13px;font-weight:600;color:var(--muted);margin-bottom:6px}
.code-input{width:100%;background:var(--bg2);border:1px solid var(--border);border-radius:12px;padding:13px 12px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:20px;letter-spacing:10px;text-align:center;text-transform:uppercase;direction:ltr}
.code-input:focus{border-color:var(--accent);outline:none;box-shadow:0 0 0 3px rgba(34,255,136,.15)}
.login-error{color:var(--danger);font-size:13.5px;margin:12px 0 0;text-align:start}
#login-form .btn{margin-top:16px}
.login-toggles{display:flex;justify-content:center;gap:10px;margin-top:22px}
/* ---------- shell ---------- */
.topbar{position:sticky;top:0;z-index:40;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px clamp(14px,4vw,28px);background:var(--topbar);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border-bottom:1px solid var(--border)}
.brand{display:flex;align-items:center;gap:12px;min-width:0}
.b-name{font-weight:800;letter-spacing:6px;font-size:19px;background:linear-gradient(90deg,var(--accent),var(--accent2));-webkit-background-clip:text;background-clip:text;color:transparent;line-height:1.2}
.b-slogan{color:var(--muted);font-size:10.5px;letter-spacing:.1em}
.top-actions{display:flex;align-items:center;gap:9px}
.user-chip{display:flex;align-items:center;gap:9px;background:var(--card);border:1px solid var(--border);border-radius:999px;padding:4px 14px 4px 6px}
html[dir='ltr'] .user-chip{padding:4px 6px 4px 14px}
.avatar{width:30px;height:30px;border-radius:50%;background:rgba(34,255,136,.12);border:1px solid var(--border);display:inline-flex;align-items:center;justify-content:center;font-size:15px}
.u-meta{display:flex;flex-direction:column;line-height:1.25;max-width:140px}
.u-meta #u-name{font-size:13px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.u-role{font-size:10.5px;color:var(--accent);font-weight:700}
.tabs{display:flex;gap:6px;overflow-x:auto;padding:12px clamp(14px,4vw,28px) 0;scrollbar-width:none}
.tabs::-webkit-scrollbar{display:none}
.tab-btn{white-space:nowrap;padding:10px 18px;border-radius:14px 14px 0 0;border:1px solid transparent;border-bottom:0;background:transparent;color:var(--muted);font-weight:600;cursor:pointer;font-size:14px}
.tab-btn:hover{color:var(--text)}
.tab-btn.on{color:var(--accent);background:var(--card);border-color:var(--border)}
main{flex:1;width:100%;max-width:1180px;margin-inline:auto;padding:20px clamp(14px,4vw,28px) 34px}
.view-title{font-size:20px;margin:4px 0 16px}
.footer{text-align:center;padding:13px 10px;color:var(--muted);font-size:13px;border-top:1px solid var(--border);background:var(--topbar);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);position:sticky;bottom:0;z-index:30}
/* ---------- dashboard ---------- */
.cards-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(205px,1fr));gap:14px;margin-bottom:16px}
.stat-card{padding:16px 16px 10px;position:relative;overflow:hidden}
.stat-top{display:flex;align-items:center;justify-content:space-between;gap:8px}
.stat-label{color:var(--muted);font-size:13px;font-weight:600}
.stat-ico{font-size:19px}
.stat-value{font-size:31px;font-weight:800;letter-spacing:.5px;margin-top:2px;line-height:1.3}
.stat-sub{color:var(--muted);font-size:12px;margin-bottom:8px}
.spark{width:100%;height:34px;display:block}
.charts-row{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.chart-card{padding:16px}
.chart-card h3{margin:0 0 10px;font-size:15px}
.chart{width:100%;height:auto;display:block}
.chart text{fill:var(--muted);font-size:9px;font-family:inherit}
/* ---------- toolbar / chips ---------- */
.toolbar{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-bottom:14px}
.chips{display:flex;gap:8px;flex-wrap:wrap}
.chip{padding:7px 16px;border-radius:999px;border:1px solid var(--border);background:transparent;color:var(--muted);cursor:pointer;font-size:13px;font-weight:600}
.chip:hover{color:var(--text)}
.chip.on{color:var(--accent);border-color:rgba(34,255,136,.45);background:rgba(34,255,136,.08)}
.search{flex:1;min-width:170px;max-width:340px;background:var(--bg2);border:1px solid var(--border);border-radius:12px;padding:10px 14px;font-size:14px}
.search:focus{border-color:var(--accent);outline:none}
.meta-line{color:var(--muted);font-size:13px;margin:0 0 10px}
/* ---------- tables ---------- */
.table-wrap{overflow-x:auto}
table{width:100%;border-collapse:collapse;font-size:14px}
th,td{padding:11px 13px;text-align:start;border-bottom:1px solid var(--border)}
thead th{color:var(--muted);font-size:11.5px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;white-space:nowrap}
tbody tr:last-child td{border-bottom:0}
tbody tr:hover{background:rgba(34,255,136,.045)}
tr.rowlink{cursor:pointer}
.cell-title{font-weight:600;max-width:260px}
.mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12.5px;direction:ltr;unicode-bidi:embed}
.amt-pos{color:var(--accent);font-weight:700}
.amt-neg{color:var(--danger);font-weight:700}
.badge{display:inline-flex;align-items:center;gap:6px;padding:2.5px 11px;border-radius:999px;font-size:12px;font-weight:700;border:1px solid var(--border);white-space:nowrap}
.badge::before{content:'';width:7px;height:7px;border-radius:50%;background:var(--muted);flex:0 0 auto}
.badge.active{color:var(--accent);border-color:rgba(34,255,136,.4);background:rgba(34,255,136,.08)}
.badge.active::before{background:var(--accent);box-shadow:0 0 8px var(--accent)}
.badge.finished{color:var(--info);border-color:rgba(127,181,255,.4);background:rgba(127,181,255,.08)}
.badge.finished::before{background:var(--info)}
.badge.draft{color:var(--warn);border-color:rgba(255,180,84,.4);background:rgba(255,180,84,.08)}
.badge.draft::before{background:var(--warn)}
.badge.open{color:var(--warn);border-color:rgba(255,180,84,.4);background:rgba(255,180,84,.08)}
.badge.open::before{background:var(--warn)}
.badge.pending{color:var(--warn);border-color:rgba(255,180,84,.4);background:rgba(255,180,84,.08)}
.badge.pending::before{background:var(--warn)}
.badge.claimed{color:var(--info);border-color:rgba(127,181,255,.4);background:rgba(127,181,255,.08)}
.badge.claimed::before{background:var(--info)}
.badge.delivered{color:var(--accent);border-color:rgba(34,255,136,.4);background:rgba(34,255,136,.08)}
.badge.delivered::before{background:var(--accent)}
.badge.expired{color:var(--danger);border-color:rgba(255,84,112,.4);background:rgba(255,84,112,.08)}
.badge.expired::before{background:var(--danger)}
.badge.replaced{color:var(--muted)}
.pager{display:flex;align-items:center;justify-content:center;gap:14px;margin-top:16px}
.pager-info{color:var(--muted);font-size:13px}
/* ---------- empty / loading / error ---------- */
.empty{text-align:center;color:var(--muted);padding:38px 12px;font-size:14px}
.empty .ico{font-size:32px;display:block;margin-bottom:10px}
.spinner{width:30px;height:30px;border-radius:50%;border:3px solid var(--border);border-top-color:var(--accent);animation:spin .8s linear infinite;margin:34px auto}
@keyframes spin{to{transform:rotate(360deg)}}
.errbox{text-align:center;padding:30px 14px;color:var(--danger);font-size:14px}
.errbox .btn{margin-top:14px}
/* ---------- tickets ---------- */
.ticket-list{display:grid;gap:12px}
.ticket{padding:14px 16px}
.ticket-head{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}
.ticket-user{color:var(--muted);font-size:12.5px;margin:4px 0 8px}
.ticket-last{font-size:13.5px;background:var(--bg2);border:1px solid var(--border);border-radius:10px;padding:8px 12px;white-space:pre-wrap;word-break:break-word}
/* ---------- reports ---------- */
.rep-actions{display:flex;gap:8px;flex-wrap:wrap}
/* ---------- exports ---------- */
.export-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.export-card{padding:20px}
.export-card h3{margin:0 0 6px;font-size:16px}
.export-card p{font-size:13.5px;margin:0 0 14px}
.export-row{display:flex;gap:10px;flex-wrap:wrap}
.export-row .search{max-width:200px;flex:1}
/* ---------- drawer ---------- */
#drawer-overlay{position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:50;backdrop-filter:blur(2px)}
#drawer{position:fixed;top:0;inset-inline-end:0;height:100%;width:min(540px,100%);background:var(--bg2);border-inline-start:1px solid var(--border);transform:translateX(105%);transition:transform .25s ease;z-index:60;overflow-y:auto;box-shadow:var(--shadow)}
html[dir='rtl'] #drawer{transform:translateX(-105%)}
#drawer.open{transform:translateX(0)}
html[dir='rtl'] #drawer.open{transform:translateX(0)}
.drawer-head{position:sticky;top:0;background:var(--topbar);backdrop-filter:blur(14px);display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 18px;border-bottom:1px solid var(--border);z-index:2}
.drawer-head h2{margin:0;font-size:17px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#drawer-body{padding:18px}
.drawer-sec{margin-bottom:26px}
.drawer-sec h3{font-size:15px;margin:0 0 10px;display:flex;align-items:center;gap:8px}
.drawer-desc{color:var(--muted);font-size:13.5px;margin:0 0 12px;white-space:pre-wrap}
.info-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px 16px;font-size:13.5px}
.info-grid b{display:block;color:var(--muted);font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em}
.winners{list-style:none;margin:0;padding:0;display:grid;gap:8px}
.winners li{display:flex;align-items:center;gap:10px;background:var(--card);border:1px solid var(--border);border-radius:12px;padding:9px 13px;font-size:14px;flex-wrap:wrap}
.medal{font-size:20px}
.w-method{margin-inline-start:auto;color:var(--muted);font-size:12px}
.timeline{list-style:none;margin:0;padding:0}
.timeline li{position:relative;padding-inline-start:22px;padding-bottom:15px;border-inline-start:2px solid var(--border);margin-inline-start:8px}
.timeline li:last-child{padding-bottom:2px}
.timeline li::before{content:'';position:absolute;inset-inline-start:-6.5px;top:4px;width:11px;height:11px;border-radius:50%;background:var(--accent);box-shadow:0 0 7px var(--accent)}
.t-meta{color:var(--muted);font-size:12.5px;word-break:break-word}
/* ---------- toasts ---------- */
#toasts{position:fixed;bottom:18px;inset-inline:0;display:flex;flex-direction:column;align-items:center;gap:8px;z-index:100;pointer-events:none}
.toast{pointer-events:auto;background:var(--bg2);border:1px solid var(--border);color:var(--text);padding:10px 18px;border-radius:12px;box-shadow:var(--shadow);font-size:14px;max-width:min(440px,92vw);animation:toastin .25s ease}
.toast.error{border-color:rgba(255,84,112,.55);color:var(--danger)}
.toast.success{border-color:rgba(34,255,136,.45);color:var(--accent)}
@keyframes toastin{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
/* ---------- responsive ---------- */
@media (max-width:920px){.charts-row,.export-grid{grid-template-columns:1fr}}
@media (max-width:760px){
  .u-meta{display:none}
  table.resp thead{display:none}
  table.resp,table.resp tbody,table.resp tr,table.resp td{display:block;width:100%}
  table.resp tr{border:1px solid var(--border);border-radius:14px;margin-bottom:10px;padding:6px;background:var(--card)}
  table.resp td{display:flex;justify-content:space-between;align-items:center;gap:14px;border:0;padding:7px 10px}
  table.resp td::before{content:attr(data-label);color:var(--muted);font-weight:700;font-size:11.5px;white-space:nowrap}
  .cell-title{max-width:none}
  .topbar{flex-wrap:wrap}
}
</style>
</head>
<body>
<section id="login-screen">
  <div class="login-card card">
    <svg class="logo-mark" width="70" height="70" viewBox="0 0 64 64" fill="none" aria-hidden="true">
      <path d="M32 4 56 18v28L32 60 8 46V18Z" stroke="var(--accent)" stroke-width="2.5"/>
      <path d="M26 24l-8 8 8 8M38 24l8 8-8 8" stroke="var(--accent2)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
    <h1 class="logo-text">CYBRIX</h1>
    <p class="slogan">Code. Security. Innovation.</p>
    <h2 class="login-heading" data-i18n="login_heading">ورود به پنل مدیریت</h2>
    <p class="muted login-hint" id="login-hint" data-i18n="login_hint">کد ۸ نویسه‌ای که بات با دستور /panel برای شما فرستاده است را وارد کنید.</p>
    <form id="login-form" novalidate>
      <label class="field-label" for="login-code" data-i18n="code_label">کد ورود</label>
      <input id="login-code" class="code-input" type="text" maxlength="8" autocomplete="one-time-code" autocapitalize="characters" spellcheck="false" aria-describedby="login-hint" data-i18n-aria="code_label" placeholder="XXXXXXXX">
      <p id="login-error" class="login-error" role="alert" hidden></p>
      <button id="login-btn" class="btn btn-block" type="submit" data-i18n="login_btn">ورود</button>
    </form>
    <div class="login-toggles">
      <button class="icon-btn lang-toggle" type="button" data-i18n-aria="lang_toggle" aria-label="تغییر زبان">EN</button>
      <button class="icon-btn theme-toggle" type="button" data-i18n-aria="theme_toggle" aria-label="تغییر تم">☀️</button>
    </div>
  </div>
</section>

<div id="shell" hidden>
  <a class="skip" href="#main" data-i18n="skip_to_content">پرش به محتوا</a>
  <header class="topbar">
    <div class="brand">
      <svg class="logo-mark" width="34" height="34" viewBox="0 0 64 64" fill="none" aria-hidden="true">
        <path d="M32 4 56 18v28L32 60 8 46V18Z" stroke="var(--accent)" stroke-width="3"/>
        <path d="M26 24l-8 8 8 8M38 24l8 8-8 8" stroke="var(--accent2)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      <div>
        <div class="b-name">CYBRIX</div>
        <div class="b-slogan">Code. Security. Innovation.</div>
      </div>
    </div>
    <div class="top-actions">
      <button class="icon-btn lang-toggle" type="button" data-i18n-aria="lang_toggle" aria-label="تغییر زبان">EN</button>
      <button class="icon-btn theme-toggle" type="button" data-i18n-aria="theme_toggle" aria-label="تغییر تم">☀️</button>
      <div class="user-chip" id="user-chip" role="status" data-i18n-aria="user_chip_aria" aria-label="حساب کاربری">
        <span class="avatar" aria-hidden="true">🛡️</span>
        <span class="u-meta"><span id="u-name">—</span><span id="u-role" class="u-role">—</span></span>
      </div>
      <button id="logout-btn" class="btn-ghost btn btn-sm" type="button" data-i18n="logout">خروج</button>
    </div>
  </header>
  <nav id="tabs" class="tabs" aria-label="ناوبری اصلی" data-i18n-aria="nav_aria">
    <button class="tab-btn on" type="button" data-view="dashboard" data-i18n="nav_dashboard">داشبورد</button>
    <button class="tab-btn" type="button" data-view="challenges" data-i18n="nav_challenges">چالش‌ها</button>
    <button class="tab-btn" type="button" data-view="transactions" data-i18n="nav_transactions">تراکنش‌ها</button>
    <button class="tab-btn" type="button" data-view="tickets" id="tab-tickets" data-i18n="nav_tickets">تیکت‌ها</button>
    <button class="tab-btn" type="button" data-view="reports" id="tab-reports" hidden data-i18n="nav_reports">گزارش تخلف</button>
    <button class="tab-btn" type="button" data-view="exports" data-i18n="nav_exports">خروجی CSV</button>
  </nav>
  <main id="main">
    <section id="view-dashboard" class="view" hidden>
      <h2 class="view-title" data-i18n="nav_dashboard">داشبورد</h2>
      <div id="dash-content"></div>
    </section>
    <section id="view-challenges" class="view" hidden>
      <h2 class="view-title" data-i18n="nav_challenges">چالش‌ها</h2>
      <div class="toolbar">
        <div class="chips" id="chips-bar" role="group" data-i18n-aria="chips_aria" aria-label="فیلتر وضعیت">
          <button class="chip on" type="button" data-status="all" data-i18n="chips_all">همه</button>
          <button class="chip" type="button" data-status="active" data-i18n="chips_active">فعال</button>
          <button class="chip" type="button" data-status="finished" data-i18n="chips_finished">پایان‌یافته</button>
        </div>
        <input id="ch-search" class="search" type="search" data-i18n-ph="search_ph" placeholder="جستجوی عنوان چالش…" data-i18n-aria="search_aria" aria-label="جستجو">
      </div>
      <div id="ch-content"></div>
    </section>
    <section id="view-transactions" class="view" hidden>
      <h2 class="view-title" data-i18n="nav_transactions">تراکنش‌ها</h2>
      <div id="tx-content"></div>
    </section>
    <section id="view-tickets" class="view" hidden>
      <h2 class="view-title" data-i18n="nav_tickets">تیکت‌ها</h2>
      <p class="muted small" data-i18n="tickets_subtitle">تیکت‌های پشتیبانی در وضعیت باز</p>
      <div id="tk-content"></div>
    </section>
    <section id="view-reports" class="view" hidden>
      <h2 class="view-title" data-i18n="nav_reports">گزارش تخلف</h2>
      <p class="muted small" data-i18n="reports_subtitle">گزارش‌های تخلف باز روی چالش‌ها</p>
      <div id="rp-content"></div>
    </section>
    <section id="view-exports" class="view" hidden>
      <h2 class="view-title" data-i18n="nav_exports">خروجی CSV</h2>
      <p class="muted small" data-i18n="exp_intro">داده‌های قابل‌مشاهده خود را به‌صورت CSV دریافت کنید (UTF-8 سازگار با اکسل).</p>
      <div class="export-grid">
        <div class="card export-card">
          <h3>📁 <span data-i18n="exp_ch_title">چالش‌ها</span></h3>
          <p class="muted" data-i18n="exp_ch_desc">همه چالش‌های قابل‌مشاهده شما همراه تعداد شرکت‌کننده و برندگان.</p>
          <button id="export-ch-btn" class="btn" type="button" data-i18n="exp_ch_btn">دانلود challenges.csv</button>
        </div>
        <div class="card export-card">
          <h3>👥 <span data-i18n="exp_pa_title">شرکت‌کننده‌های یک چالش</span></h3>
          <p class="muted" data-i18n="exp_pa_desc">شناسه چالش را از جدول چالش‌ها بردارید و فایل شرکت‌کننده‌ها را بگیرید.</p>
          <div class="export-row">
            <input id="export-pa-id" class="search" type="number" min="1" step="1" data-i18n-ph="exp_pa_ph" placeholder="شناسه چالش" data-i18n-aria="exp_pa_ph" aria-label="شناسه چالش">
            <button id="export-pa-btn" class="btn" type="button" data-i18n="exp_pa_btn">دانلود participants.csv</button>
          </div>
        </div>
      </div>
    </section>
  </main>
  <footer class="footer">CYBRIX — Code. Security. Innovation. 💚</footer>
</div>

<div id="drawer-overlay" hidden></div>
<aside id="drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title" aria-hidden="true">
  <div class="drawer-head">
    <h2 id="drawer-title">—</h2>
    <button id="drawer-close" class="icon-btn" type="button" data-i18n-aria="close" aria-label="بستن">✕</button>
  </div>
  <div id="drawer-body"></div>
</aside>
<div id="toasts" aria-live="polite"></div>

<script>
(function(){
'use strict';
var I18N={
fa:{
  login_heading:'ورود به پنل مدیریت',
  login_hint:'کد ۸ نویسه‌ای که بات با دستور /panel برای شما فرستاده است را وارد کنید.',
  code_label:'کد ورود',
  login_btn:'ورود',
  login_invalid:'کد نامعتبر است، منقضی شده یا قبلاً استفاده شده.',
  login_rate:'تلاش‌های زیاد. لطفاً ۱۰ دقیقه صبر کنید و دوباره تلاش کنید.',
  login_generic:'ورود ناموفق بود. اتصال را بررسی و دوباره تلاش کنید.',
  nav_aria:'ناوبری اصلی',
  nav_dashboard:'داشبورد',
  nav_challenges:'چالش‌ها',
  nav_transactions:'تراکنش‌ها',
  nav_tickets:'تیکت‌ها',
  nav_exports:'خروجی CSV',
  logout:'خروج',
  lang_toggle:'تغییر زبان',
  theme_toggle:'تغییر تم',
  user_chip_aria:'حساب کاربری',
  skip_to_content:'پرش به محتوا',
  card_users:'کاربران',
  card_users_sub7:'فعال ۷ روز',
  card_challenges:'چالش‌ها',
  card_active:'فعال',
  card_finished:'پایان‌یافته',
  card_participants:'شرکت‌کننده‌ها',
  card_votes:'رأی‌ها',
  card_credits:'اعتبار صادرشده',
  card_credits_spent:'خرج‌شده',
  card_channels:'کانال‌ها',
  card_open_tickets:'تیکت باز',
  wallet_free:'رایگان',
  wallet_gift:'هدیه',
  wallet_purchased:'خریداری‌شده',
  chart_participants:'شرکت‌کننده هر چالش (۱۰ چالش برتر)',
  chart_activity:'فعالیت ۷ روز اخیر',
  chips_aria:'فیلتر وضعیت',
  chips_all:'همه',
  chips_active:'فعال',
  chips_finished:'پایان‌یافته',
  search_aria:'جستجو',
  search_ph:'جستجوی عنوان چالش…',
  open_challenge:'مشاهده چالش',
  th_id:'شناسه',
  th_title:'عنوان',
  th_type:'نوع',
  th_status:'وضعیت',
  th_participants:'شرکت‌کننده',
  th_winners:'برندگان',
  th_end:'زمان پایان',
  th_created:'تاریخ ساخت',
  th_date:'تاریخ',
  th_kind:'نوع',
  th_wallet:'کیف',
  th_amount:'مبلغ',
  th_balance:'مانده',
  th_reason:'شرح',
  th_txid:'شناسه تراکنش',
  th_user:'کاربر',
  th_rank:'رتبه',
  th_name:'نام',
  th_username:'نام کاربری',
  th_score:'امتیاز',
  th_joined:'عضویت',
  th_channel:'کانال',
  status_active:'فعال',
  status_finished:'پایان‌یافته',
  status_draft:'پیش‌نویس',
  status_open:'باز',
  type_random:'قرعه‌کشی',
  type_vote:'رأی‌گیری',
  type_referral:'دعوت',
  type_quiz:'آزمون',
  empty_challenges:'چالشی وجود ندارد',
  empty_tx:'تراکنشی ثبت نشده است',
  empty_tickets:'تیکت بازی نیست',
  empty_participants:'هنوز شرکت‌کننده‌ای ثبت نشده',
  empty_winners:'برندگان هنوز مشخص نشده‌اند',
  empty_audit:'رویدادی ثبت نشده است',
  drawer_info:'اطلاعات چالش',
  drawer_winners:'برندگان',
  drawer_participants:'شرکت‌کننده‌ها',
  drawer_audit:'رویدادهای سیستم',
  participants_note:'حداکثر ۲۰۰ شرکت‌کننده اول نمایش داده می‌شود.',
  close:'بستن',
  btn_prev:'قبلی',
  btn_next:'بعدی',
  page_of:'صفحه {p} از {n}',
  total_label:'مجموع',
  tx_kind_spend:'خرج',
  tx_kind_grant:'اعطا',
  tx_kind_refund:'بازگشت',
  exp_intro:'داده‌های قابل‌مشاهده خود را به‌صورت CSV دریافت کنید (UTF-8 سازگار با اکسل).',
  exp_ch_title:'چالش‌ها',
  exp_ch_desc:'همه چالش‌های قابل‌مشاهده شما همراه تعداد شرکت‌کننده و برندگان.',
  exp_ch_btn:'دانلود challenges.csv',
  exp_pa_title:'شرکت‌کننده‌های یک چالش',
  exp_pa_desc:'شناسه چالش را از جدول چالش‌ها بردارید و فایل شرکت‌کننده‌ها را بگیرید.',
  exp_pa_btn:'دانلود participants.csv',
  exp_pa_ph:'شناسه چالش',
  exp_bad_id:'یک شناسه چالش معتبر وارد کنید.',
  exp_started:'دانلود آغاز شد',
  tickets_subtitle:'تیکت‌های پشتیبانی در وضعیت باز',
  err_generic:'خطا در دریافت داده‌ها. دوباره تلاش کنید.',
  retry:'تلاش دوباره',
  loading:'در حال بارگذاری…',
  role_owner:'مالک',
  role_admin:'مدیر',
  role_user:'کاربر',
  win_method:'روش',
  challenge_cost:'هزینه',
  challenge_channel:'کانال',
  challenge_created_by:'تاریخ ساخت',
  no_desc:'بدون توضیحات',
  nav_reports:'گزارش تخلف',
  reports_subtitle:'گزارش‌های تخلف باز روی چالش‌ها',
  rep_challenge:'چالش',
  rep_reason:'دلیل',
  rep_reporter:'گزارش‌دهنده',
  rep_resolve:'رسیدگی شد',
  rep_dismiss:'رد گزارش',
  rep_confirm_resolve:'این گزارش به‌عنوان رسیدگی‌شده بسته شود؟',
  rep_confirm_dismiss:'این گزارش رد و بسته شود؟',
  rep_closed_ok:'گزارش بسته شد',
  empty_reports:'گزارشی نیست',
  drawer_prizes:'جوایز',
  prize_deadline:'مهلت',
  prize_pending:'در انتظار پاسخ',
  prize_claimed:'ادعا شده',
  prize_delivered:'تحویل شده',
  prize_expired:'منقضی شده',
  prize_replaced:'جایگزین شده',
  type_photo:'عکاسی',
  type_points:'امتیازی'
},
en:{
  login_heading:'Admin Panel Login',
  login_hint:'Enter the 8-character code the bot sent you with the /panel command.',
  code_label:'Login code',
  login_btn:'Sign in',
  login_invalid:'Invalid, expired or already used code.',
  login_rate:'Too many attempts. Please wait 10 minutes and try again.',
  login_generic:'Sign in failed. Check your connection and try again.',
  nav_aria:'Main navigation',
  nav_dashboard:'Dashboard',
  nav_challenges:'Challenges',
  nav_transactions:'Transactions',
  nav_tickets:'Tickets',
  nav_exports:'CSV Export',
  logout:'Log out',
  lang_toggle:'Switch language',
  theme_toggle:'Switch theme',
  user_chip_aria:'Account',
  skip_to_content:'Skip to content',
  card_users:'Users',
  card_users_sub7:'Active 7 days',
  card_challenges:'Challenges',
  card_active:'Active',
  card_finished:'Finished',
  card_participants:'Participants',
  card_votes:'Votes',
  card_credits:'Credits issued',
  card_credits_spent:'Spent',
  card_channels:'Channels',
  card_open_tickets:'Open tickets',
  wallet_free:'Free',
  wallet_gift:'Gift',
  wallet_purchased:'Purchased',
  chart_participants:'Participants per challenge (top 10)',
  chart_activity:'Last 7 days activity',
  chips_aria:'Status filter',
  chips_all:'All',
  chips_active:'Active',
  chips_finished:'Finished',
  search_aria:'Search',
  search_ph:'Search challenge title…',
  open_challenge:'Open challenge',
  th_id:'ID',
  th_title:'Title',
  th_type:'Type',
  th_status:'Status',
  th_participants:'Participants',
  th_winners:'Winners',
  th_end:'Ends at',
  th_created:'Created',
  th_date:'Date',
  th_kind:'Kind',
  th_wallet:'Wallet',
  th_amount:'Amount',
  th_balance:'Balance',
  th_reason:'Description',
  th_txid:'TxID',
  th_user:'User',
  th_rank:'Rank',
  th_name:'Name',
  th_username:'Username',
  th_score:'Score',
  th_joined:'Joined',
  th_channel:'Channel',
  status_active:'Active',
  status_finished:'Finished',
  status_draft:'Draft',
  status_open:'Open',
  type_random:'Lottery',
  type_vote:'Voting',
  type_referral:'Referral',
  type_quiz:'Quiz',
  empty_challenges:'No challenges yet',
  empty_tx:'No transactions yet',
  empty_tickets:'No open tickets',
  empty_participants:'No participants yet',
  empty_winners:'Winners not selected yet',
  empty_audit:'No audit events yet',
  drawer_info:'Challenge info',
  drawer_winners:'Winners',
  drawer_participants:'Participants',
  drawer_audit:'System events',
  participants_note:'Showing the first 200 participants only.',
  close:'Close',
  btn_prev:'Previous',
  btn_next:'Next',
  page_of:'Page {p} of {n}',
  total_label:'Total',
  tx_kind_spend:'Spend',
  tx_kind_grant:'Grant',
  tx_kind_refund:'Refund',
  exp_intro:'Download your visible data as CSV (UTF-8, Excel friendly).',
  exp_ch_title:'Challenges',
  exp_ch_desc:'All challenges you can see, with participant and winner counts.',
  exp_ch_btn:'Download challenges.csv',
  exp_pa_title:'Participants of one challenge',
  exp_pa_desc:'Grab the challenge id from the challenges table, then export.',
  exp_pa_btn:'Download participants.csv',
  exp_pa_ph:'Challenge id',
  exp_bad_id:'Please enter a valid challenge id.',
  exp_started:'Download started',
  tickets_subtitle:'Support tickets currently open',
  err_generic:'Failed to load data. Please retry.',
  retry:'Retry',
  loading:'Loading…',
  role_owner:'Owner',
  role_admin:'Admin',
  role_user:'User',
  win_method:'Method',
  challenge_cost:'Cost',
  challenge_channel:'Channel',
  challenge_created_by:'Created',
  no_desc:'No description',
  nav_reports:'Reports',
  reports_subtitle:'Open abuse reports on challenges',
  rep_challenge:'Challenge',
  rep_reason:'Reason',
  rep_reporter:'Reporter',
  rep_resolve:'Resolved',
  rep_dismiss:'Dismiss',
  rep_confirm_resolve:'Close this report as resolved?',
  rep_confirm_dismiss:'Dismiss and close this report?',
  rep_closed_ok:'Report closed',
  empty_reports:'No reports',
  drawer_prizes:'Prizes',
  prize_deadline:'Deadline',
  prize_pending:'Pending',
  prize_claimed:'Claimed',
  prize_delivered:'Delivered',
  prize_expired:'Expired',
  prize_replaced:'Replaced',
  type_photo:'Photo',
  type_points:'Points'
}};

var state={
  token:localStorage.getItem('cybrix_token')||'',
  me:null,
  lang:localStorage.getItem('cybrix_lang')||'fa',
  theme:localStorage.getItem('cybrix_theme')||'dark',
  view:'dashboard',
  ch:{status:'all',q:'',page:1},
  tx:{page:1},
  lastFocus:null
};

function $(id){return document.getElementById(id);}
function t(key){var d=I18N[state.lang]||I18N.fa;return d[key]!==undefined?d[key]:(I18N.fa[key]!==undefined?I18N.fa[key]:key);}
function esc(s){return String(s===null||s===undefined?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
function faDigits(s){var m={'0':'۰','1':'۱','2':'۲','3':'۳','4':'۴','5':'۵','6':'۶','7':'۷','8':'۸','9':'۹'};return String(s).replace(/[0-9]/g,function(c){return m[c];});}
function fmtNum(n){if(n===null||n===undefined||isNaN(Number(n)))return '—';return Number(n).toLocaleString(state.lang==='fa'?'fa-IR':'en-US');}
function fmtDate(sec){if(!sec)return '—';var d=new Date((sec+12600)*1000);function p(x){return (x<10?'0':'')+x;}var s=d.getUTCFullYear()+'-'+p(d.getUTCMonth()+1)+'-'+p(d.getUTCDate())+' '+p(d.getUTCHours())+':'+p(d.getUTCMinutes());return state.lang==='fa'?faDigits(s):s;}
function trunc(s,n){s=String(s===null||s===undefined?'':s);return s.length>n?s.slice(0,n)+'…':s;}
function pageOf(p,n){return t('page_of').replace('{p}',fmtNum(p)).replace('{n}',fmtNum(n));}
function medal(rank){if(rank===1)return '🥇';if(rank===2)return '🥈';if(rank===3)return '🥉';return '🏅';}

/* ------------------------------- data layer ------------------------------- */
function api(path,opts){
  opts=opts||{};
  var headers=opts.headers||{};
  if(state.token)headers['Authorization']='Bearer '+state.token;
  if(opts.body)headers['Content-Type']='application/json';
  return fetch(path,{method:opts.method||'GET',headers:headers,body:opts.body||undefined}).then(function(r){
    return r.text().then(function(txt){
      var data=null;
      try{data=txt?JSON.parse(txt):null;}catch(e){data=null;}
      if(r.status===401&&state.token){logoutLocal();var err=new Error('unauthorized');err.status=401;throw err;}
      if(!r.ok){var e2=new Error((data&&data.error)||('http_'+r.status));e2.status=r.status;throw e2;}
      return data;
    });
  });
}
function downloadCsv(url,fallbackName){
  var headers={'Authorization':'Bearer '+state.token};
  fetch(url,{headers:headers}).then(function(r){
    if(!r.ok)throw new Error('http_'+r.status);
    return r.blob().then(function(b){
      var cd=r.headers.get('Content-Disposition')||'';
      var m=/filename="?([^";]+)"?/.exec(cd);
      var name=m?m[1]:fallbackName;
      var objUrl=URL.createObjectURL(b);
      var a=document.createElement('a');
      a.href=objUrl;a.download=name;
      document.body.appendChild(a);a.click();
      setTimeout(function(){URL.revokeObjectURL(objUrl);a.remove();},600);
      toast(t('exp_started'),'success');
    });
  }).catch(function(){toast(t('err_generic'),'error');});
}

/* -------------------------------- theming --------------------------------- */
function applyTheme(theme){
  state.theme=theme;
  document.documentElement.setAttribute('data-theme',theme);
  localStorage.setItem('cybrix_theme',theme);
  var glyphs=document.querySelectorAll('.theme-toggle');
  for(var i=0;i<glyphs.length;i++){
    glyphs[i].textContent=theme==='dark'?'☀️':'🌙';
    glyphs[i].setAttribute('aria-label',t('theme_toggle'));
    glyphs[i].setAttribute('title',t('theme_toggle'));
  }
}
function applyI18nStatic(){
  document.documentElement.lang=state.lang;
  document.documentElement.dir=state.lang==='fa'?'rtl':'ltr';
  var els=document.querySelectorAll('[data-i18n]');
  for(var i=0;i<els.length;i++){els[i].textContent=t(els[i].getAttribute('data-i18n'));}
  var phs=document.querySelectorAll('[data-i18n-ph]');
  for(var j=0;j<phs.length;j++){phs[j].setAttribute('placeholder',t(phs[j].getAttribute('data-i18n-ph')));}
  var ars=document.querySelectorAll('[data-i18n-aria]');
  for(var k=0;k<ars.length;k++){ars[k].setAttribute('aria-label',t(ars[k].getAttribute('data-i18n-aria')));}
  var lgs=document.querySelectorAll('.lang-toggle');
  for(var m=0;m<lgs.length;m++){
    lgs[m].textContent=state.lang==='fa'?'EN':'FA';
    lgs[m].setAttribute('title',t('lang_toggle'));
  }
}
function applyLang(lang){
  state.lang=lang;
  localStorage.setItem('cybrix_lang',lang);
  applyI18nStatic();
  applyTheme(state.theme);
  if(state.token&&state.me)refreshCurrentView();
}

/* --------------------------------- screens -------------------------------- */
function showLogin(){
  $('shell').hidden=true;
  $('login-screen').hidden=false;
  closeDrawer();
  var inp=$('login-code');
  if(inp)inp.focus();
}
function enterShell(){
  $('login-screen').hidden=true;
  $('shell').hidden=false;
  return api('/api/me').then(function(me){
    state.me=me;
    $('u-name').textContent=me.first_name||('ID '+me.telegram_id);
    $('u-role').textContent=t('role_'+me.role)||me.role;
    $('tab-tickets').hidden=me.role!=='owner';
    $('tab-reports').hidden=me.role!=='owner';
    applyI18nStatic();
    showView('dashboard');
  }).catch(function(){showLogin();});
}
function logoutLocal(){
  state.token='';
  state.me=null;
  localStorage.removeItem('cybrix_token');
  $('dash-content').innerHTML='';
  $('ch-content').innerHTML='';
  $('tx-content').innerHTML='';
  $('tk-content').innerHTML='';
  $('rp-content').innerHTML='';
  showLogin();
}

/* ---------------------------------- views --------------------------------- */
function showView(name){
  state.view=name;
  var tabs=document.querySelectorAll('.tab-btn');
  for(var i=0;i<tabs.length;i++){
    var on=tabs[i].getAttribute('data-view')===name;
    tabs[i].classList.toggle('on',on);
    if(on)tabs[i].setAttribute('aria-current','page');else tabs[i].removeAttribute('aria-current');
  }
  var views=document.querySelectorAll('.view');
  for(var j=0;j<views.length;j++){views[j].hidden=views[j].id!==('view-'+name);}
  refreshCurrentView();
}
function refreshCurrentView(){
  if(state.view==='dashboard')loadDashboard();
  else if(state.view==='challenges')loadChallenges();
  else if(state.view==='transactions')loadTx();
  else if(state.view==='tickets')loadTickets();
  else if(state.view==='reports')loadReports();
}
function spinnerHtml(){return '<div class="spinner" role="status" aria-label="'+esc(t('loading'))+'"></div>';}
function renderError(container,retryFn){
  container.innerHTML='<div class="errbox">⚠️ '+esc(t('err_generic'))
    +'<div><button class="btn-ghost btn btn-sm" type="button">'+esc(t('retry'))+'</button></div></div>';
  var b=container.querySelector('button');
  if(b)b.onclick=retryFn;
}
function toast(msg,type){
  var el=document.createElement('div');
  el.className='toast '+(type||'');
  el.setAttribute('role','status');
  el.textContent=msg;
  $('toasts').appendChild(el);
  setTimeout(function(){el.remove();},4200);
}

/* -------------------------------- dashboard -------------------------------- */
function sparkSVG(series){
  if(!series||!series.length||series.join('')==='')return '';
  var w=120,h=34,max=Math.max.apply(null,series)||1,bw=w/series.length,bars='';
  for(var i=0;i<series.length;i++){
    var bh=Math.max(2,Math.round((series[i]/max)*(h-4)));
    var x=(i*bw+1).toFixed(1),y=(h-bh).toFixed(1);
    var op=(0.35+0.65*(i/Math.max(1,series.length-1))).toFixed(2);
    bars+='<rect x="'+x+'" y="'+y+'" width="'+(bw-2).toFixed(1)+'" height="'+bh+'" rx="2" fill="var(--accent)" opacity="'+op+'"/>';
  }
  return '<svg class="spark" viewBox="0 0 '+w+' '+h+'" preserveAspectRatio="none" aria-hidden="true">'+bars+'</svg>';
}
function lineChart(series){
  if(!series||!series.length)return '<div class="empty">'+esc(t('err_generic'))+'</div>';
  var w=320,h=118,pad=10,base=h-22,max=Math.max.apply(null,series.concat([1])),n=series.length,pts=[];
  for(var i=0;i<n;i++){
    var x=pad+i*((w-2*pad)/(n-1));
    var y=base-8-(series[i]/max)*(base-24);
    pts.push([x,y]);
  }
  var line='';
  for(var j=0;j<pts.length;j++){line+=(j?' ':'')+pts[j][0].toFixed(1)+','+pts[j][1].toFixed(1);}
  var area='M'+pts[0][0].toFixed(1)+','+base.toFixed(1);
  for(var k=0;k<pts.length;k++){area+=' L'+pts[k][0].toFixed(1)+','+pts[k][1].toFixed(1);}
  area+=' L'+pts[n-1][0].toFixed(1)+','+base.toFixed(1)+' Z';
  var dots='';
  for(var d=0;d<pts.length;d++){dots+='<circle cx="'+pts[d][0].toFixed(1)+'" cy="'+pts[d][1].toFixed(1)+'" r="3" fill="var(--accent)"><title>'+fmtNum(series[d])+'</title></circle>';}
  var labels='';
  var now0=new Date();
  for(var m=0;m<n;m++){
    var dt=new Date(now0.getTime()-(n-1-m)*86400000);
    var lbl=(dt.getUTCMonth()+1)+'/'+dt.getUTCDate();
    var lx=pad+m*((w-2*pad)/(n-1));
    labels+='<text x="'+lx.toFixed(1)+'" y="'+(h-6)+'" text-anchor="middle">'+lbl+'</text>';
  }
  return '<svg viewBox="0 0 '+w+' '+h+'" class="chart" role="img" aria-label="'+esc(t('chart_activity'))+'">'
    +'<path d="'+area+'" fill="var(--accent)" opacity="0.12"/>'
    +'<polyline points="'+line+'" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>'
    +dots+labels+'</svg>';
}
function barChart(items){
  var top=items.slice(0).sort(function(a,b){return b.participants-a.participants;}).slice(0,10);
  if(!top.length)return '<div class="empty"><span class="ico">🎯</span>'+esc(t('empty_challenges'))+'</div>';
  var w=320,h=150,pad=8,max=1;
  for(var q=0;q<top.length;q++){if(top[q].participants>max)max=top[q].participants;}
  var bw=(w-2*pad)/top.length,s='';
  for(var i=0;i<top.length;i++){
    var bh=Math.max(3,Math.round((top[i].participants/max)*(h-42)));
    var x=pad+i*bw,y=h-24-bh;
    s+='<rect x="'+(x+2).toFixed(1)+'" y="'+y+'" width="'+Math.max(4,bw-4).toFixed(1)+'" height="'+bh+'" rx="3" fill="var(--accent)" opacity="0.85"><title>'+esc(top[i].title)+' — '+fmtNum(top[i].participants)+'</title></rect>';
    s+='<text x="'+(x+bw/2).toFixed(1)+'" y="'+(h-9)+'" text-anchor="middle">#'+top[i].id+'</text>';
  }
  return '<svg viewBox="0 0 '+w+' '+h+'" class="chart" role="img" aria-label="'+esc(t('chart_participants'))+'">'+s+'</svg>';
}
function statCard(label,val,sub,icon,series){
  return '<div class="stat-card card">'
    +'<div class="stat-top"><span class="stat-label">'+esc(label)+'</span><span class="stat-ico" aria-hidden="true">'+icon+'</span></div>'
    +'<div class="stat-value">'+fmtNum(val)+'</div>'
    +'<div class="stat-sub">'+esc(sub)+'</div>'
    +sparkSVG(series)
    +'</div>';
}
function loadDashboard(){
  var c=$('dash-content');
  c.innerHTML=spinnerHtml();
  api('/api/summary').then(function(s){
    return api('/api/challenges?status=all&page=1').then(function(chs){return {s:s,chs:chs};});
  }).then(function(d){renderDashboard(d.s,d.chs);})
  .catch(function(){renderError(c,loadDashboard);});
}
function renderDashboard(s,chs){
  var cards=[];
  if(s.scope==='owner'){
    cards.push(statCard(t('card_users'),s.users,t('card_users_sub7')+': '+fmtNum(s.users_7d),'👤',s.series.users));
  }
  cards.push(statCard(t('card_challenges'),s.challenges_total,t('card_active')+': '+fmtNum(s.challenges_active)+' · '+t('card_finished')+': '+fmtNum(s.challenges_finished),'🎯',s.series.challenges));
  cards.push(statCard(t('card_participants'),s.participants,t('card_votes')+': '+fmtNum(s.votes),'👥',s.series.participants));
  var creditSub=s.scope==='owner'
    ?t('card_credits_spent')+': '+fmtNum(s.credits_spent)
    :t('wallet_free')+' '+fmtNum(s.wallet.free)+' · '+t('wallet_gift')+' '+fmtNum(s.wallet.gift)+' · '+t('wallet_purchased')+' '+fmtNum(s.wallet.purchased);
  cards.push(statCard(t('card_credits'),s.credits_issued,creditSub,'💳',s.series.spent));
  if(s.scope!=='owner'){
    cards.push(statCard(t('card_channels'),s.channels,t('card_open_tickets')+': '+fmtNum(s.open_tickets),'📢',null));
  }
  var activity=s.scope==='owner'?s.series.users:s.series.participants;
  $('dash-content').innerHTML=
    '<div class="cards-grid">'+cards.join('')+'</div>'
    +'<div class="charts-row">'
    +'<div class="chart-card card"><h3>📈 '+esc(t('chart_activity'))+'</h3>'+lineChart(activity)+'</div>'
    +'<div class="chart-card card"><h3>📊 '+esc(t('chart_participants'))+'</h3>'+barChart(chs&&chs.items?chs.items:[])+'</div>'
    +'</div>';
}

/* -------------------------------- challenges ------------------------------- */
function statusBadge(st){
  var known=st==='active'||st==='finished'||st==='draft'||st==='open';
  var lbl=known?t('status_'+st):st;
  return '<span class="badge '+esc(st)+'">'+esc(lbl)+'</span>';
}
function prizeBadge(st){
  var map={pending:'⏳',claimed:'📬',delivered:'✅',expired:'⛔',replaced:'🔁'};
  var ico=map[st]||'•';
  var key='prize_'+st;
  var cur=I18N[state.lang]||I18N.fa;
  var lbl=cur[key]!==undefined?cur[key]:st;
  return '<span class="badge '+esc(st)+'">'+ico+' '+esc(lbl)+'</span>';
}
function typeLabel(ty){
  var known=ty==='random'||ty==='vote'||ty==='referral'||ty==='quiz'||ty==='photo'||ty==='points';
  var lbl=known?t('type_'+ty):ty;
  var ico=ty==='random'?'🎲':(ty==='vote'?'🗳':(ty==='referral'?'👥':(ty==='quiz'?'🧠':(ty==='photo'?'📷':(ty==='points'?'⭐':'•')))));
  return '<span>'+ico+' '+esc(lbl)+'</span>';
}
function pagerHtml(prefix,page,pages){
  var prevDis=page<=1?' disabled':'';
  var nextDis=page>=pages?' disabled':'';
  return '<div class="pager">'
    +'<button class="btn-ghost btn btn-sm" type="button" id="'+prefix+'-prev"'+prevDis+' data-i18n-aria="btn_prev" aria-label="'+esc(t('btn_prev'))+'">'+esc(t('btn_prev'))+'</button>'
    +'<span class="pager-info">'+pageOf(page,pages)+'</span>'
    +'<button class="btn-ghost btn btn-sm" type="button" id="'+prefix+'-next"'+nextDis+' data-i18n-aria="btn_next" aria-label="'+esc(t('btn_next'))+'">'+esc(t('btn_next'))+'</button>'
    +'</div>';
}
function loadChallenges(){
  var c=$('ch-content');
  c.innerHTML=spinnerHtml();
  var qs='?status='+encodeURIComponent(state.ch.status)+'&page='+state.ch.page;
  if(state.ch.q)qs+='&q='+encodeURIComponent(state.ch.q);
  api('/api/challenges'+qs).then(function(d){renderChallenges(d);})
  .catch(function(){renderError(c,loadChallenges);});
}
function renderChallenges(d){
  var c=$('ch-content');
  if(!d.items||!d.items.length){
    c.innerHTML='<div class="card"><div class="empty"><span class="ico">🎯</span>'+esc(t('empty_challenges'))+'</div></div>';
    return;
  }
  var rows='';
  for(var i=0;i<d.items.length;i++){
    var it=d.items[i];
    rows+='<tr class="rowlink" tabindex="0" role="button" data-id="'+it.id+'" aria-label="'+esc(t('open_challenge'))+': '+esc(it.title)+'">'
      +'<td data-label="'+esc(t('th_id'))+'" class="mono">#'+it.id+'</td>'
      +'<td data-label="'+esc(t('th_title'))+'" class="cell-title">'+esc(it.title)+'</td>'
      +'<td data-label="'+esc(t('th_type'))+'">'+typeLabel(it.type)+'</td>'
      +'<td data-label="'+esc(t('th_status'))+'">'+statusBadge(it.status)+'</td>'
      +'<td data-label="'+esc(t('th_participants'))+'">'+fmtNum(it.participants)+'</td>'
      +'<td data-label="'+esc(t('th_winners'))+'">'+fmtNum(it.winners)+'</td>'
      +'<td data-label="'+esc(t('th_end'))+'">'+fmtDate(it.end_at)+'</td>'
      +'</tr>';
  }
  c.innerHTML='<p class="meta-line">'+esc(t('total_label'))+': '+fmtNum(d.total)+'</p>'
    +'<div class="card table-wrap"><table class="resp">'
    +'<caption class="sr-only">'+esc(t('nav_challenges'))+'</caption>'
    +'<thead><tr>'
    +'<th scope="col">'+esc(t('th_id'))+'</th>'
    +'<th scope="col">'+esc(t('th_title'))+'</th>'
    +'<th scope="col">'+esc(t('th_type'))+'</th>'
    +'<th scope="col">'+esc(t('th_status'))+'</th>'
    +'<th scope="col">'+esc(t('th_participants'))+'</th>'
    +'<th scope="col">'+esc(t('th_winners'))+'</th>'
    +'<th scope="col">'+esc(t('th_end'))+'</th>'
    +'</tr></thead><tbody>'+rows+'</tbody></table></div>'
    +pagerHtml('ch',d.page,d.pages);
  $('ch-prev').onclick=function(){if(state.ch.page>1){state.ch.page--;loadChallenges();}};
  $('ch-next').onclick=function(){if(state.ch.page<d.pages){state.ch.page++;loadChallenges();}};
}

/* --------------------------------- drawer ---------------------------------- */
function openDrawer(id){
  state.lastFocus=document.activeElement;
  $('drawer-overlay').hidden=false;
  var dr=$('drawer');
  dr.classList.add('open');
  dr.setAttribute('aria-hidden','false');
  $('drawer-title').textContent=t('loading');
  $('drawer-body').innerHTML=spinnerHtml();
  api('/api/challenges/'+id).then(function(d){
    renderDrawer(d);
    $('drawer-close').focus();
  }).catch(function(){
    $('drawer-title').textContent='—';
    $('drawer-body').innerHTML='<div class="empty"><span class="ico">⚠️</span>'+esc(t('err_generic'))+'</div>';
  });
}
function closeDrawer(){
  var dr=$('drawer');
  if(!dr.classList.contains('open'))return;
  dr.classList.remove('open');
  dr.setAttribute('aria-hidden','true');
  $('drawer-overlay').hidden=true;
  if(state.lastFocus&&state.lastFocus.focus)state.lastFocus.focus();
}
function infoCell(label,val){
  return '<div><b>'+esc(label)+'</b>'+val+'</div>';
}
function renderDrawer(d){
  var ch=d.challenge||{};
  $('drawer-title').textContent='#'+ch.id+' — '+(ch.title||'');
  var winMap={};
  var i,html='';
  for(i=0;i<(d.winners||[]).length;i++)winMap[d.winners[i].telegram_id]=d.winners[i];
  html+='<div class="drawer-sec"><h3>ℹ️ '+esc(t('drawer_info'))+'</h3>'
    +(ch.description?'<p class="drawer-desc">'+esc(ch.description)+'</p>':'')
    +(ch.prizes?'<p class="drawer-desc">🎁 '+esc(ch.prizes).replace(/\\n/g,'<br>')+'</p>':'')
    +'<div class="info-grid">'
    +infoCell(t('th_type'),typeLabel(ch.type))
    +infoCell(t('th_status'),statusBadge(ch.status))
    +infoCell(t('th_end'),fmtDate(ch.end_at))
    +infoCell(t('challenge_created_by'),fmtDate(ch.created_at))
    +infoCell(t('th_channel'),'<span class="mono">'+esc(ch.channel_chat_id)+'</span>')
    +infoCell(t('challenge_cost'),fmtNum(ch.cost))
    +'</div></div>';
  if(d.prize_rows&&d.prize_rows.length){
    var dlv={};
    for(var k2=0;k2<(d.prize_deliveries||[]).length;k2++)dlv[d.prize_deliveries[k2].rank]=d.prize_deliveries[k2];
    var prizesHtml='<ul class="winners">';
    for(var k3=0;k3<d.prize_rows.length;k3++){
      var pz=d.prize_rows[k3];
      var dv=dlv[pz.rank]||null;
      prizesHtml+='<li><span class="medal" aria-hidden="true">'+medal(pz.rank)+'</span>'
        +'<span><b>'+esc(pz.title||('#'+pz.rank))+'</b>'+(pz.value?' <span class="muted">· '+esc(pz.value)+'</span>':'')+'</span>'
        +(dv?prizeBadge(dv.status):'')
        +(dv&&dv.deadline_at?'<span class="w-method muted">'+esc(t('prize_deadline'))+': '+fmtDate(dv.deadline_at)+'</span>':'')
        +'</li>';
    }
    prizesHtml+='</ul>';
    html+='<div class="drawer-sec"><h3>🎁 '+esc(t('drawer_prizes'))+'</h3>'+prizesHtml+'</div>';
  }
  var winnersHtml='';
  if(!d.winners||!d.winners.length){
    winnersHtml='<div class="empty">'+esc(t('empty_winners'))+'</div>';
  }else{
    winnersHtml='<ul class="winners">';
    for(i=0;i<d.winners.length;i++){
      var w=d.winners[i];
      winnersHtml+='<li><span class="medal" aria-hidden="true">'+medal(w.rank)+'</span>'
        +'<span><b>'+esc(w.first_name||'—')+'</b> '+(w.username?'<span class="muted">@'+esc(w.username)+'</span>':'')+'</span>'
        +(w.method?'<span class="w-method">'+esc(t('win_method'))+': '+esc(w.method)+'</span>':'')
        +'<span class="w-method muted">'+fmtDate(w.selected_at)+'</span>'
        +'</li>';
    }
    winnersHtml+='</ul>';
  }
  html+='<div class="drawer-sec"><h3>🏆 '+esc(t('drawer_winners'))+'</h3>'+winnersHtml+'</div>';
  var partsHtml='';
  if(!d.participants||!d.participants.length){
    partsHtml='<div class="empty">'+esc(t('empty_participants'))+'</div>';
  }else{
    var rows='';
    for(i=0;i<d.participants.length;i++){
      var p=d.participants[i];
      var isWin=winMap[p.telegram_id]?' <span aria-hidden="true">'+medal(winMap[p.telegram_id].rank)+'</span>':'';
      rows+='<tr>'
        +'<td data-label="'+esc(t('th_rank'))+'">'+(i+1)+isWin+'</td>'
        +'<td data-label="'+esc(t('th_name'))+'">'+esc(p.first_name||'—')+'</td>'
        +'<td data-label="'+esc(t('th_username'))+'">'+(p.username?'<span class="mono">@'+esc(p.username)+'</span>':'<span class="muted">—</span>')+'</td>'
        +'<td data-label="'+esc(t('th_score'))+'">'+fmtNum(p.score)+'</td>'
        +'<td data-label="'+esc(t('th_status'))+'">'+esc(p.status)+'</td>'
        +'<td data-label="'+esc(t('th_joined'))+'">'+fmtDate(p.joined_at)+'</td>'
        +'</tr>';
    }
    partsHtml='<p class="muted small">'+esc(t('participants_note'))+' ('+fmtNum(d.participants_total)+')</p>'
      +'<div class="table-wrap"><table class="resp">'
      +'<caption class="sr-only">'+esc(t('drawer_participants'))+'</caption>'
      +'<thead><tr>'
      +'<th scope="col">'+esc(t('th_rank'))+'</th>'
      +'<th scope="col">'+esc(t('th_name'))+'</th>'
      +'<th scope="col">'+esc(t('th_username'))+'</th>'
      +'<th scope="col">'+esc(t('th_score'))+'</th>'
      +'<th scope="col">'+esc(t('th_status'))+'</th>'
      +'<th scope="col">'+esc(t('th_joined'))+'</th>'
      +'</tr></thead><tbody>'+rows+'</tbody></table></div>';
  }
  html+='<div class="drawer-sec"><h3>👥 '+esc(t('drawer_participants'))+'</h3>'+partsHtml+'</div>';
  var auditHtml='';
  if(!d.audit||!d.audit.length){
    auditHtml='<div class="empty">'+esc(t('empty_audit'))+'</div>';
  }else{
    auditHtml='<ul class="timeline">';
    for(i=0;i<d.audit.length;i++){
      var ev=d.audit[i];
      auditHtml+='<li><div><b class="mono">'+esc(ev.action)+'</b> <span class="muted small">'+fmtDate(ev.created_at)+'</span></div>'
        +(ev.meta?'<div class="t-meta">'+esc(trunc(ev.meta,160))+'</div>':'')
        +'</li>';
    }
    auditHtml+='</ul>';
  }
  html+='<div class="drawer-sec"><h3>🕘 '+esc(t('drawer_audit'))+'</h3>'+auditHtml+'</div>';
  $('drawer-body').innerHTML=html;
}

/* ------------------------------- transactions ------------------------------ */
function walletKindLabel(wk){
  if(wk==='free')return t('wallet_free');
  if(wk==='gift')return t('wallet_gift');
  if(wk==='purchased')return t('wallet_purchased');
  return wk;
}
function kindLabel(k){
  if(k==='spend')return t('tx_kind_spend');
  if(k==='grant')return t('tx_kind_grant');
  if(k==='refund')return t('tx_kind_refund');
  return k;
}
function loadTx(){
  var c=$('tx-content');
  c.innerHTML=spinnerHtml();
  api('/api/transactions?page='+state.tx.page).then(function(d){renderTx(d);})
  .catch(function(){renderError(c,loadTx);});
}
function renderTx(d){
  var c=$('tx-content');
  if(!d.items||!d.items.length){
    c.innerHTML='<div class="card"><div class="empty"><span class="ico">🧾</span>'+esc(t('empty_tx'))+'</div></div>';
    return;
  }
  var owner=state.me&&state.me.role==='owner';
  var rows='';
  for(var i=0;i<d.items.length;i++){
    var tx=d.items[i];
    var neg=tx.kind==='spend';
    var amt='<span class="'+(neg?'amt-neg':'amt-pos')+'">'+(neg?'−':'+')+fmtNum(tx.amount)+'</span>';
    var userCell='';
    if(owner){
      userCell='<td data-label="'+esc(t('th_user'))+'">'+esc(tx.user_name||'')+' '
        +(tx.user_username?'<span class="mono">@'+esc(tx.user_username)+'</span>':'')
        +(tx.telegram_id?' <span class="muted mono">('+tx.telegram_id+')</span>':'')+'</td>';
    }
    rows+='<tr>'
      +'<td data-label="'+esc(t('th_date'))+'">'+fmtDate(tx.created_at)+'</td>'
      +'<td data-label="'+esc(t('th_kind'))+'">'+esc(kindLabel(tx.kind))+'</td>'
      +'<td data-label="'+esc(t('th_wallet'))+'">'+esc(walletKindLabel(tx.wallet_kind))+'</td>'
      +'<td data-label="'+esc(t('th_amount'))+'">'+amt+'</td>'
      +'<td data-label="'+esc(t('th_balance'))+'">'+fmtNum(tx.balance_after)+'</td>'
      +'<td data-label="'+esc(t('th_reason'))+'" title="'+esc(tx.reason)+'">'+esc(trunc(tx.reason,60))+'</td>'
      +'<td data-label="'+esc(t('th_txid'))+'" title="'+esc(tx.txid)+'" class="mono">'+esc(tx.txid.slice(0,10))+'…</td>'
      +userCell
      +'</tr>';
  }
  c.innerHTML='<p class="meta-line">'+esc(t('total_label'))+': '+fmtNum(d.total)+'</p>'
    +'<div class="card table-wrap"><table class="resp">'
    +'<caption class="sr-only">'+esc(t('nav_transactions'))+'</caption>'
    +'<thead><tr>'
    +'<th scope="col">'+esc(t('th_date'))+'</th>'
    +'<th scope="col">'+esc(t('th_kind'))+'</th>'
    +'<th scope="col">'+esc(t('th_wallet'))+'</th>'
    +'<th scope="col">'+esc(t('th_amount'))+'</th>'
    +'<th scope="col">'+esc(t('th_balance'))+'</th>'
    +'<th scope="col">'+esc(t('th_reason'))+'</th>'
    +'<th scope="col">'+esc(t('th_txid'))+'</th>'
    +(owner?'<th scope="col">'+esc(t('th_user'))+'</th>':'')
    +'</tr></thead><tbody>'+rows+'</tbody></table></div>'
    +pagerHtml('tx',d.page,d.pages);
  $('tx-prev').onclick=function(){if(state.tx.page>1){state.tx.page--;loadTx();}};
  $('tx-next').onclick=function(){if(state.tx.page<d.pages){state.tx.page++;loadTx();}};
}

/* --------------------------------- tickets --------------------------------- */
function loadTickets(){
  var c=$('tk-content');
  c.innerHTML=spinnerHtml();
  api('/api/tickets').then(function(d){renderTickets(d);})
  .catch(function(){renderError(c,loadTickets);});
}
function renderTickets(d){
  var c=$('tk-content');
  if(!d.items||!d.items.length){
    c.innerHTML='<div class="card"><div class="empty"><span class="ico">🆘</span>'+esc(t('empty_tickets'))+'</div></div>';
    return;
  }
  var html='<div class="ticket-list">';
  for(var i=0;i<d.items.length;i++){
    var tk=d.items[i];
    html+='<div class="ticket card">'
      +'<div class="ticket-head"><strong>#'+tk.id+' — '+esc(tk.subject)+'</strong>'+statusBadge(tk.status)+'</div>'
      +'<div class="ticket-user">'+esc(tk.first_name||'')+(tk.username?' <span class="mono">@'+esc(tk.username)+'</span>':'')
      +' · <span class="mono">'+tk.telegram_id+'</span> · '+fmtDate(tk.created_at)+' · 💬 '+fmtNum(tk.messages)+'</div>'
      +'<div class="ticket-last">'+esc(trunc(tk.last_message||'—',300))+'</div>'
      +'</div>';
  }
  c.innerHTML=html+'</div>';
}

/* --------------------------------- reports --------------------------------- */
function loadReports(){
  var c=$('rp-content');
  c.innerHTML=spinnerHtml();
  api('/api/reports').then(function(d){renderReports(d);})
  .catch(function(){renderError(c,loadReports);});
}
function renderReports(d){
  var c=$('rp-content');
  if(!d.items||!d.items.length){
    c.innerHTML='<div class="card"><div class="empty"><span class="ico">🛡️</span>'+esc(t('empty_reports'))+'</div></div>';
    return;
  }
  var rows='';
  for(var i=0;i<d.items.length;i++){
    var r=d.items[i];
    var chCell=r.challenge_title
      ?esc(r.challenge_title)+' <span class="mono">#'+esc(r.target_id)+'</span>'
      :'<span class="mono">'+esc(r.target_id)+'</span>';
    rows+='<tr>'
      +'<td data-label="'+esc(t('th_id'))+'" class="mono">#'+r.id+'</td>'
      +'<td data-label="'+esc(t('rep_challenge'))+'" class="cell-title">'+chCell+'</td>'
      +'<td data-label="'+esc(t('rep_reason'))+'" title="'+esc(r.reason||'')+'">'+esc(trunc(r.reason||'',140))+'</td>'
      +'<td data-label="'+esc(t('rep_reporter'))+'">'+esc(r.reporter_name||'—')+'</td>'
      +'<td data-label="'+esc(t('th_date'))+'">'+fmtDate(r.created_at)+'</td>'
      +'<td data-label="'+esc(t('th_status'))+'"><div class="rep-actions">'
      +'<button class="btn-ghost btn btn-sm" type="button" data-rep="resolved" data-id="'+r.id+'">✅ '+esc(t('rep_resolve'))+'</button>'
      +'<button class="btn-ghost btn btn-sm" type="button" data-rep="dismissed" data-id="'+r.id+'">✖️ '+esc(t('rep_dismiss'))+'</button>'
      +'</div></td>'
      +'</tr>';
  }
  c.innerHTML='<p class="meta-line">'+esc(t('total_label'))+': '+fmtNum(d.items.length)+'</p>'
    +'<div class="card table-wrap"><table class="resp">'
    +'<caption class="sr-only">'+esc(t('nav_reports'))+'</caption>'
    +'<thead><tr>'
    +'<th scope="col">'+esc(t('th_id'))+'</th>'
    +'<th scope="col">'+esc(t('rep_challenge'))+'</th>'
    +'<th scope="col">'+esc(t('rep_reason'))+'</th>'
    +'<th scope="col">'+esc(t('rep_reporter'))+'</th>'
    +'<th scope="col">'+esc(t('th_date'))+'</th>'
    +'<th scope="col">'+esc(t('th_status'))+'</th>'
    +'</tr></thead><tbody>'+rows+'</tbody></table></div>';
}

/* ---------------------------------- wiring --------------------------------- */
function debounce(fn,ms){
  var timer=null;
  return function(){
    var args=arguments,self=this;
    if(timer)clearTimeout(timer);
    timer=setTimeout(function(){fn.apply(self,args);},ms);
  };
}
function wire(){
  var codeInp=$('login-code');
  codeInp.addEventListener('input',function(){
    var pos=this.selectionStart;
    this.value=this.value.toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,8);
    try{this.setSelectionRange(pos,pos);}catch(e){}
  });
  $('login-form').addEventListener('submit',function(e){
    e.preventDefault();
    var btn=$('login-btn'),errEl=$('login-error');
    errEl.hidden=true;errEl.textContent='';
    var code=codeInp.value.trim().toUpperCase();
    if(!/^[A-Z0-9]{8}$/.test(code)){errEl.textContent=t('login_invalid');errEl.hidden=false;return;}
    btn.disabled=true;btn.textContent=t('loading');
    fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:code})})
    .then(function(r){return r.json().then(function(data){return {status:r.status,data:data};});})
    .then(function(res){
      if(res.status===200&&res.data&&res.data.token){
        state.token=res.data.token;
        localStorage.setItem('cybrix_token',res.data.token);
        codeInp.value='';
        enterShell();
      }else if(res.status===429){
        errEl.textContent=t('login_rate');errEl.hidden=false;
      }else{
        errEl.textContent=t('login_invalid');errEl.hidden=false;
      }
    })
    .catch(function(){errEl.textContent=t('login_generic');errEl.hidden=false;})
    .then(function(){btn.disabled=false;btn.textContent=t('login_btn');});
  });
  var tabs=document.querySelectorAll('.tab-btn');
  for(var i=0;i<tabs.length;i++){
    tabs[i].addEventListener('click',function(){showView(this.getAttribute('data-view'));});
  }
  $('logout-btn').addEventListener('click',logoutLocal);
  var chips=document.querySelectorAll('#chips-bar .chip');
  for(var j=0;j<chips.length;j++){
    chips[j].addEventListener('click',function(){
      var all=document.querySelectorAll('#chips-bar .chip');
      for(var k=0;k<all.length;k++)all[k].classList.remove('on');
      this.classList.add('on');
      state.ch.status=this.getAttribute('data-status');
      state.ch.page=1;
      loadChallenges();
    });
  }
  $('ch-search').addEventListener('input',debounce(function(){
    state.ch.q=this.value.trim();
    state.ch.page=1;
    loadChallenges();
  },350));
  $('drawer-close').addEventListener('click',closeDrawer);
  $('drawer-overlay').addEventListener('click',closeDrawer);
  document.addEventListener('keydown',function(e){
    if((e.key==='Escape'||e.key==='Esc')&&$('drawer').classList.contains('open'))closeDrawer();
  });
  $('ch-content').addEventListener('click',function(e){
    var tr=e.target&&e.target.closest?e.target.closest('tr[data-id]'):null;
    if(tr)openDrawer(parseInt(tr.getAttribute('data-id'),10));
  });
  $('ch-content').addEventListener('keydown',function(e){
    if(e.key!=='Enter'&&e.key!==' ')return;
    var tr=e.target&&e.target.closest?e.target.closest('tr[data-id]'):null;
    if(tr){e.preventDefault();openDrawer(parseInt(tr.getAttribute('data-id'),10));}
  });
  $('export-ch-btn').addEventListener('click',function(){
    downloadCsv('/api/export/challenges.csv','cybrix-challenges.csv');
  });
  $('export-pa-btn').addEventListener('click',function(){
    var v=parseInt($('export-pa-id').value,10);
    if(!v||v<1){toast(t('exp_bad_id'),'error');return;}
    downloadCsv('/api/export/participants.csv?id='+v,'cybrix-participants-'+v+'.csv');
  });
  $('rp-content').addEventListener('click',function(e){
    var b=e.target&&e.target.closest?e.target.closest('button[data-rep]'):null;
    if(!b)return;
    var id=parseInt(b.getAttribute('data-id'),10);
    var st=b.getAttribute('data-rep');
    if(st!=='resolved'&&st!=='dismissed')return;
    var msg=st==='resolved'?t('rep_confirm_resolve'):t('rep_confirm_dismiss');
    if(!window.confirm(msg))return;
    b.disabled=true;
    api('/api/reports/close',{method:'POST',body:JSON.stringify({id:id,status:st})}).then(function(){
      toast(t('rep_closed_ok'),'success');
      loadReports();
    }).catch(function(){toast(t('err_generic'),'error');b.disabled=false;});
  });
  var themes=document.querySelectorAll('.theme-toggle');
  for(var m=0;m<themes.length;m++){
    themes[m].addEventListener('click',function(){applyTheme(state.theme==='dark'?'light':'dark');});
  }
  var langs=document.querySelectorAll('.lang-toggle');
  for(var n=0;n<langs.length;n++){
    langs[n].addEventListener('click',function(){applyLang(state.lang==='fa'?'en':'fa');});
  }
}

function boot(){
  applyLang(state.lang);
  applyTheme(state.theme);
  wire();
  if(state.token){enterShell();}else{showLogin();}
}
boot();
})();
</script>
</body>
</html>`;
