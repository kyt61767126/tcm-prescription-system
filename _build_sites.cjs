const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname);
const PUBLIC = path.join(ROOT, 'public');
const OFFICIAL = path.join(ROOT, 'site-official');
const ADMIN = path.join(ROOT, 'site-admin');

function rmrf(p) {
  if (!fs.existsSync(p)) return;
  for (const e of fs.readdirSync(p, { withFileTypes: true })) {
    const fp = path.join(p, e.name);
    if (e.isDirectory()) rmrf(fp);
    else fs.unlinkSync(fp);
  }
  fs.rmdirSync(p);
}
function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }
function cp(src, dst) {
  if (!fs.existsSync(src)) return false;
  ensureDir(path.dirname(dst));
  const st = fs.statSync(src);
  if (st.isDirectory()) {
    ensureDir(dst);
    for (const n of fs.readdirSync(src)) cp(path.join(src, n), path.join(dst, n));
    return true;
  }
  fs.copyFileSync(src, dst);
  return true;
}

const OFFICIAL_BLOCK_SUBSTR = [
  'auth-core', 'permission', 'security-guard', 'admin/',
  'prescription-core', 'patient-archive', 'db-adapter',
  'debug-logger', 'login.html', 'package.json', 'package-lock',
  'wrangler.toml', '.gitignore', 'auto-push', 'upload-release',
  'afterPack', 'restore-from-backup', 'video-recorder',
  'medicine-dict', 'print-utils', 'performance-utils',
  'preload.js', 'main.js',
];
function isOfficialSafe(rel) {
  const r = rel.toLowerCase().replace(/\\/g, '/');
  for (const sub of OFFICIAL_BLOCK_SUBSTR) {
    if (r.includes(sub.toLowerCase())) return false;
  }
  return true;
}

// ============ 1. Clean ============
console.log('[1/8] Clean old site-official / site-admin ...');
rmrf(OFFICIAL); rmrf(ADMIN);
ensureDir(OFFICIAL); ensureDir(ADMIN);
ensureDir(path.join(OFFICIAL, 'releases'));

// ============ 2. site-official 复制白名单根文件 ============
console.log('[2/8] Build site-official (download page + pure assets) ...');
const OFFICIAL_ALLOW = new Set([
  'download.html','favicon.svg','icon-192.png','icon-512.png',
  'qr-wechat.svg','qrcode.min.js','wechat.html','xlsx.full.min.js',
  'hash-manifest.json','_headers',
]);
for (const f of fs.readdirSync(PUBLIC, { withFileTypes: true })) {
  if (!f.isFile()) continue;
  if (OFFICIAL_ALLOW.has(f.name)) {
    cp(path.join(PUBLIC, f.name), path.join(OFFICIAL, f.name));
  }
}
cp(path.join(PUBLIC, 'updates'), path.join(OFFICIAL, 'updates'));

// 黑名单清理
(function scan(dir, base) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const fp = path.join(dir, e.name);
    const rel = path.relative(base, fp).split(path.sep).join('/');
    if (e.isDirectory()) scan(fp, base);
    else if (!isOfficialSafe(rel)) {
      console.warn('  [SAFE BLOCK] removing sensitive: ' + rel);
      fs.unlinkSync(fp);
    }
  }
})(OFFICIAL, OFFICIAL);

// ============ 3. download.html rewrite for Rule1 ============
console.log('[3/8] Rewrite download.html for Rule1 (6 cards -> 4 editions YB/YJ/LB/LJ) ...');
let dlHtml = fs.readFileSync(path.join(OFFICIAL, 'download.html'), 'utf8');
dlHtml = dlHtml.replace(/惠康中医 · 云端机构版 APP/g, '惠康中医 · 云端机构版 <span style="color:#7b1fa2;">YJ</span>');
dlHtml = dlHtml.replace(/惠康中医 · 云端标准版 APP/g, '惠康中医 · 云端标准版 <span style="color:#1565c0;">YB</span>');
dlHtml = dlHtml.replace(/惠康中医 · 定制桌面版/g, '惠康中医 · 离线机构版 <span style="color:#e65100;">LJ</span> 桌面版');
dlHtml = dlHtml.replace(/惠康中医 · 个人定制桌面版/g, '惠康中医 · 离线标准版 <span style="color:#2e7d32;">LB</span> 桌面版');
dlHtml = dlHtml.replace(/惠康中医 · 定制版 APP/g, '惠康中医 · 离线机构版 <span style="color:#e65100;">LJ</span> APP');
dlHtml = dlHtml.replace(/惠康中医 · 个人定制 APP/g, '惠康中医 · 离线标准版 <span style="color:#2e7d32;">LB</span> APP');

const idRenames = [
  ['card-cloud-app','card-YJ-app'],['card-geren-cloud','card-YB-app'],
  ['card-dingzhi','card-LJ-app'],['card-geren','card-LB-app'],
  ['card-cloud-desktop','card-YJ-desktop'],['card-dingzhi-desktop','card-LJ-desktop'],
  ['card-geren-desktop','card-LB-desktop'],
  ['tag-cloud-app','tag-YJ-app'],['tag-geren-cloud','tag-YB-app'],
  ['tag-dingzhi','tag-LJ-app'],['tag-geren','tag-LB-app'],
  ['ver-cloud-app','ver-YJ-app'],['ver-geren-cloud','ver-YB-app'],
  ['ver-dingzhi','ver-LJ-app'],['ver-geren','ver-LB-app'],
  ['ver-cloud-desktop','ver-YJ-desktop'],['ver-dingzhi-desktop','ver-LJ-desktop'],
  ['ver-geren-desktop','ver-LB-desktop'],
  ['date-cloud-app','date-YJ-app'],['date-geren-cloud','date-YB-app'],
  ['date-dingzhi','date-LJ-app'],['date-geren','date-LB-app'],
  ['date-cloud-desktop','date-YJ-desktop'],['date-dingzhi-desktop','date-LJ-desktop'],
  ['date-geren-desktop','date-LB-desktop'],
  ['mtime-cloud-app','mtime-YJ-app'],['mtime-geren-cloud','mtime-YB-app'],
  ['mtime-dingzhi','mtime-LJ-app'],['mtime-geren','mtime-LB-app'],
  ['mtime-cloud-desktop','mtime-YJ-desktop'],['mtime-dingzhi-desktop','mtime-LJ-desktop'],
  ['mtime-geren-desktop','mtime-LB-desktop'],
  ['notes-cloud-app','notes-YJ-app'],['notes-geren-cloud','notes-YB-app'],
  ['notes-dingzhi','notes-LJ-app'],['notes-geren','notes-LB-app'],
  ['notes-cloud-desktop','notes-YJ-desktop'],['notes-dingzhi-desktop','notes-LJ-desktop'],
  ['notes-geren-desktop','notes-LB-desktop'],
  ['hash-cloud-app','hash-YJ-app'],['hash-geren-cloud','hash-YB-app'],
  ['hash-dingzhi','hash-LJ-app'],['hash-geren','hash-LB-app'],
  ['hash-cloud-desktop','hash-YJ-desktop'],['hash-dingzhi-desktop','hash-LJ-desktop'],
  ['hash-geren-desktop','hash-LB-desktop'],
  ['dl-cloud-app','dl-YJ-app'],['dl-geren-cloud','dl-YB-app'],
  ['dl-dingzhi','dl-LJ-app'],['dl-geren','dl-LB-app'],
  ['dl-cloud','dl-YJ-desktop'],['dl-cloud-portable','dl-YJ-desktop-portable'],
  ['dl-dingzhi-desktop','dl-LJ-desktop'],['dl-dingzhi-desktop-portable','dl-LJ-desktop-portable'],
  ['dl-geren-desktop','dl-LB-desktop'],['dl-geren-desktop-portable','dl-LB-desktop-portable'],
];
for (const [a, b] of idRenames) dlHtml = dlHtml.split(a).join(b);

// copyHash calls
const hashNames = ['YJ-app','YB-app','LJ-app','LB-app','YJ-desktop','LJ-desktop','LB-desktop'];
for (const h of hashNames) {
  const old = "copyHash('hash-" + h.toLowerCase().replace('-app','').replace('-desktop','') + "')";
  // skip — id renames 阶段已经覆盖了 hash-cloud-app→hash-YJ-app 等键；copyHash 字面量用单独替换
}
dlHtml = dlHtml
  .replace(/copyHash\('hash-YJ-app'\)/g, "copyHash('hash-YJ-app')")
  .replace(/copyHash\('hash-YB-app'\)/g, "copyHash('hash-YB-app')")
  .replace(/copyHash\('hash-LJ-app'\)/g, "copyHash('hash-LJ-app')")
  .replace(/copyHash\('hash-LB-app'\)/g, "copyHash('hash-LB-app')")
  .replace(/copyHash\('hash-YJ-desktop'\)/g, "copyHash('hash-YJ-desktop')")
  .replace(/copyHash\('hash-LJ-desktop'\)/g, "copyHash('hash-LJ-desktop')")
  .replace(/copyHash\('hash-LB-desktop'\)/g, "copyHash('hash-LB-desktop')");

// 安装说明
dlHtml = dlHtml
  .replace(/云端机构版 APK/g, '云端机构版 <b>YJ</b> APK')
  .replace(/云端桌面版/g, '云端机构版 <b>YJ</b> 桌面版')
  .replace(/离线机构版 APK/g, '离线机构版 <b>LJ</b> APK')
  .replace(/离线机构版桌面版/g, '离线机构版 <b>LJ</b> 桌面版')
  .replace(/离线标准版 APK/g, '离线标准版 <b>LB</b> APK')
  .replace(/离线标准版桌面版/g, '离线标准版 <b>LB</b> 桌面版');

// versionMap
dlHtml = dlHtml.replace(
  /const versionMap = \{[\s\S]*?\};/,
  `const versionMap = {
  'LB-app': 'LB', 'LJ-app': 'LJ', 'YB-app': 'YB', 'YJ-app': 'YJ',
  'LB-desktop': 'LB', 'LJ-desktop': 'LJ', 'YJ-desktop': 'YJ',
  geren: 'LB', dingzhi: 'LJ', cloud: 'YJ'
};`
);

// downloadList key rewrite
dlHtml = dlHtml.replace(
  /'dingzhi-desktop': \{ jsonUrl:[^}]+\},\s*'dingzhi': \{ jsonUrl:[^}]+\}/,
  `'LJ-desktop': { jsonUrl: BASE + '/updates/clinic/latest.json', type: 'desktop' },
  'LB-desktop': { jsonUrl: BASE + '/updates/personal/latest.json', type: 'desktop' },
  'YJ-desktop': { jsonUrl: BASE + '/updates/cloud_clinic/latest.json', type: 'desktop' },
  'dingzhi-desktop': { jsonUrl: BASE + '/updates/clinic/latest.json', type: 'desktop' },
  'LJ-app': { jsonUrl: BASE + '/updates/clinic/latest.json', type: 'app' },
  'LB-app': { jsonUrl: BASE + '/updates/personal/latest.json', type: 'app' },
  'YJ-app': { jsonUrl: BASE + '/updates/cloud_clinic/latest.json', type: 'app' },
  'YB-app': { jsonUrl: BASE + '/updates/cloud_personal/latest.json', type: 'app' },
  'dingzhi': { jsonUrl: BASE + '/updates/clinic/latest.json', type: 'app' }`
);
dlHtml = dlHtml.replace(/\['cloud-app', 'geren-cloud', 'dingzhi', 'geren'\]\.forEach/,
  "['YJ-app', 'YB-app', 'LJ-app', 'LB-app'].forEach");
dlHtml = dlHtml.replace(/\['cloud', 'dingzhi-desktop', 'geren-desktop'\]\.forEach/,
  "['YJ-desktop', 'LJ-desktop', 'LB-desktop'].forEach");
dlHtml = dlHtml.replace(
  /const manifestKey = key === 'dingzhi-desktop' \? 'dingzhi'/g,
  "const manifestKey = ({'LJ-desktop':'clinic','LB-desktop':'personal','YJ-desktop':'cloud_clinic','dingzhi-desktop':'clinic'}[key]) || key === 'dingzhi' ? 'clinic' : key"
);

// 规则1试用期
dlHtml = dlHtml.replace(
  /<strong>云端机构版<\/strong>不提供公开试用。[\s\S]*?开通云端账户。/,
  '<strong>云端标准版 <b>YB</b> / 云端机构版 <b>YJ</b></strong> 均不提供公开试用。规则1：云端全程无 7 天试用，仅离线版（<b>LB</b> 标准版 / <b>LJ</b> 机构版）有 7 天试用，到期后只读不删数据。'
);
dlHtml = dlHtml.replace(
  /<strong>离线版（离线机构版\/离线标准版）<\/strong>提供 7 天免费试用[^<]*<br>/g,
  '<strong>离线标准版 <b>LB</b> / 离线机构版 <b>LJ</b></strong>：提供 7 天免费试用（处方 30 张上限），到期后自动切换为「只读模式」（已开处方不删除，可随时查看/导出/打印，规则1硬性保障）。<br>'
);
dlHtml = dlHtml.replace(
  /<a href="https:\/\/tcm-prescription-system\.pages\.dev\/" class="download-btn success">/g,
  '<a href="https://admin.huikangzy.com/" target="_blank" rel="noopener noreferrer" class="download-btn success">'
);

fs.writeFileSync(path.join(OFFICIAL, 'download.html'), dlHtml, 'utf8');
console.log('  download.html rewritten (4 editions, rule1 compliant)');

// latest.json 占位 + 继承
function inheritIfMissing(src, dst) {
  const sp = path.join(OFFICIAL, 'updates', src, 'latest.json');
  const dp = path.join(OFFICIAL, 'updates', dst, 'latest.json');
  ensureDir(path.dirname(dp));
  if (fs.existsSync(sp) && !fs.existsSync(dp)) {
    cp(sp, dp);
  } else if (!fs.existsSync(dp)) {
    fs.writeFileSync(dp, JSON.stringify({
      version:'0.0.0', apk:null, exe:null, portable:null,
      sha256:{apk:'',exe:'',portable:''},
      releaseNotes:'首次部署：请在 build 流水线生成后覆盖此文件',
      releaseDate:new Date().toISOString().slice(0,10)
    }, null, 2), 'utf8');
  }
}
inheritIfMissing('dingzhi','clinic');
inheritIfMissing('geren','personal');
inheritIfMissing('cloud','cloud_clinic');
inheritIfMissing('cloud','cloud_personal');

// ============ 4. site-official/index.html 产品介绍 ============
console.log('[4/8] Create site-official/index.html (pure showcase) ...');
fs.writeFileSync(path.join(OFFICIAL, 'index.html'), `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>惠康中医诊所管理系统 — 官方网站</title>
<meta name="description" content="惠康中医诊所管理系统：舌脉照相、智能开方、离线可用、云端同步、4 版本专业分发（YB 云端标准版 / YJ 云端机构版 / LB 离线标准版 / LJ 离线机构版）。">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:"PingFang SC","Microsoft YaHei",sans-serif;color:#2c3e50;background:#f7fafc;line-height:1.7}
a{color:inherit;text-decoration:none}
.hero{padding:80px 24px;text-align:center;background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);color:white}
.hero h1{font-size:40px;letter-spacing:2px;margin-bottom:12px}
.hero p{font-size:17px;opacity:.92;max-width:640px;margin:0 auto 28px}
.cta{display:inline-flex;gap:14px;flex-wrap:wrap;justify-content:center}
.btn{padding:14px 28px;border-radius:10px;font-weight:600;transition:transform .15s,box-shadow .15s}
.btn:hover{transform:translateY(-2px);box-shadow:0 10px 24px rgba(0,0,0,.18)}
.btn-primary{background:white;color:#5b4fb7}
.btn-secondary{border:2px solid rgba(255,255,255,.65);color:white}
.wrap{max-width:1120px;margin:0 auto;padding:60px 24px}
.section-title{font-size:26px;text-align:center;margin-bottom:8px}
.section-sub{text-align:center;color:#718096;margin-bottom:40px}
.features{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:20px}
.f-card{background:white;border-radius:14px;padding:24px;box-shadow:0 6px 18px rgba(0,0,0,.05)}
.f-card .icon{font-size:32px;margin-bottom:10px}
.f-card h3{font-size:17px;margin-bottom:6px;color:#2d3748}
.f-card p{color:#4a5568;font-size:14px}
.editions{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:20px;margin-top:24px}
.ed{border-radius:14px;padding:24px;background:white;box-shadow:0 6px 18px rgba(0,0,0,.05);border-top:6px solid #ccc}
.ed-yb{border-top-color:#1976d2}.ed-yj{border-top-color:#7b1fa2}
.ed-lb{border-top-color:#2e7d32}.ed-lj{border-top-color:#e65100}
.ed .badge{display:inline-block;padding:3px 10px;border-radius:12px;font-size:12px;font-weight:700;color:white;margin-bottom:12px}
.badge-yb{background:#1976d2}.badge-yj{background:#7b1fa2}
.badge-lb{background:#2e7d32}.badge-lj{background:#e65100}
.ed h3{font-size:18px;margin-bottom:6px}
.ed .tagline{color:#4a5568;font-size:14px;margin-bottom:14px;min-height:44px}
.ed ul{color:#4a5568;font-size:13px;padding-left:18px;min-height:108px}
.ed .trial{margin-top:14px;padding-top:12px;border-top:1px dashed #e2e8f0;font-size:13px;color:#718096}
.footer{padding:32px 24px;text-align:center;color:#a0aec0;font-size:13px;border-top:1px solid #e2e8f0;margin-top:24px}
.warn{max-width:1120px;margin:0 auto 40px;padding:14px 20px;border-radius:10px;background:#fff3cd;color:#856404;font-size:14px;text-align:center;border:1px solid #ffeeba}
</style>
</head>
<body>
<section class="hero">
  <h1>惠康中医 · 诊所管理系统</h1>
  <p>舌脉照相留档 · 智能开方 · 处方打印导出<br>
     本地隐私优先（舌脉照绝不入云）· 云端处方同步 · 4 版本专业分发</p>
  <div class="cta">
    <a class="btn btn-primary" href="download.html">📦 立即下载</a>
    <a class="btn btn-secondary" href="#editions">查看 4 版本对比</a>
  </div>
</section>

<div class="wrap">
  <div class="warn" id="policy-notice">
    <strong>🔒 隐私承诺（规则2）：</strong>
    所有舌脉照片、视频只存储在客户本地电脑/手机，<u>绝对不上传云端</u>，云端仅存储文字处方（便于多端查看和管理）。
  </div>

  <h2 class="section-title">核心功能</h2>
  <p class="section-sub">专为中医诊所 / 独立医师打造，稳定 · 安全 · 中文友好</p>
  <div class="features">
    <div class="f-card"><div class="icon">📋</div><h3>智能开方</h3><p>经方模板、常用药库、剂量换算，支持手写病历导入。</p></div>
    <div class="f-card"><div class="icon">📷</div><h3>舌脉影像</h3><p>统一按月（YYYY-MM）分文件夹本地存储，绝不发送到云端。</p></div>
    <div class="f-card"><div class="icon">🖨️</div><h3>打印/导出</h3><p>A5 处方笺打印、PDF/Excel 导出、批量病历归档。</p></div>
    <div class="f-card"><div class="icon">🔐</div><h3>激活 + 授权</h3><p>多硬件哈希指纹加密串授权；支持在线工单、离线 .dat 文件。</p></div>
    <div class="f-card"><div class="icon">👥</div><h3>多用户权限</h3><p>机构版管理员可增删子账号；子账号仅开方，管理员方可查全部处方。</p></div>
    <div class="f-card"><div class="icon">☁️</div><h3>云端同步</h3><p>云端版本跨设备查看处方；离线版本单机完全可用，断网不影响。</p></div>
  </div>

  <h2 class="section-title" id="editions">4 版本选择（规则1 精简版）</h2>
  <p class="section-sub">云端无 7 天试用；离线版提供 7 天免费试用，到期后<u>只读不删</u>数据</p>
  <div class="editions">
    <div class="ed ed-yb">
      <span class="badge badge-yb">YB 云端标准版</span>
      <h3>单人医师 / 小型诊所</h3>
      <p class="tagline">云端处方同步，只有管理员账户，不建子账号。</p>
      <ul>
        <li>云同步文字处方（多端查看）</li>
        <li>单管理员（规则4，无子账号）</li>
        <li>舌脉照只存本地设备</li>
      </ul>
      <p class="trial">规则1：<b>云端 YB 无 7 天试用</b>。开通账户请联系开发者。</p>
    </div>
    <div class="ed ed-yj">
      <span class="badge badge-yj">YJ 云端机构版</span>
      <h3>连锁 / 多医师机构</h3>
      <p class="tagline">管理员增删子账号，子账号仅能开方。</p>
      <ul>
        <li>子账号管理 + 权限分配</li>
        <li>全部处方集中管理审计</li>
        <li>云端工单 + 后台审批激活</li>
      </ul>
      <p class="trial">规则1：<b>云端 YJ 无 7 天试用</b>。开通机构请联系开发者。</p>
    </div>
    <div class="ed ed-lb">
      <span class="badge badge-lb">LB 离线标准版</span>
      <h3>独立医师单机版</h3>
      <p class="tagline">完全离线、单账号、本地 100% 数据主权。</p>
      <ul>
        <li>单账号（规则4）</li>
        <li>舌脉照/处方全部本地保存</li>
        <li>支持 .dat 离线激活文件</li>
      </ul>
      <p class="trial">规则1：7 天免费试用（处方 30 张）→ 到期 <b>只读不删</b>。</p>
    </div>
    <div class="ed ed-lj">
      <span class="badge badge-lj">LJ 离线机构版</span>
      <h3>诊所多用户局域网</h3>
      <p class="tagline">本地多用户账户管理，完全断网可用。</p>
      <ul>
        <li>本地管理员 + 子账号</li>
        <li>权限：子账号仅开方</li>
        <li>本地 SQLite 数据库，不联网</li>
      </ul>
      <p class="trial">规则1：7 天免费试用（处方 30 张）→ 到期 <b>只读不删</b>。</p>
    </div>
  </div>
</div>

<div class="footer">
  © 2026 惠康中医诊所管理系统 · 本站仅提供下载安装包（规则9，本站不承载登录/后台功能）
</div>

<script>
(function(){
  var p = window.location.pathname;
  var sensitive = /^\/(admin|api|auth-core|permission|security-guard|prescription-core|patient-archive|db-adapter|login)([\/?#]|$)/i;
  if (sensitive.test(p)) {
    window.location.replace('https://admin.huikangzy.com' + p + window.location.search + window.location.hash);
  }
  try { localStorage.clear(); } catch(e){}
})();
</script>
</body>
</html>
`, 'utf8');
console.log('  index.html created');

// ============ 5. site-admin ============
console.log('[5/8] Build site-admin (cloud app + admin backend) ...');
const ADMIN_ALLOW_ROOT = new Set([
  'index.html','auth-core.js','permission.js','db-adapter.js','debug-logger.js',
  'favicon.svg','hash-manifest.json','icon-192.png','icon-512.png',
  'medicine-dict.js','patient-archive.js','performance-utils.js',
  'prescription-core.js','print-utils.js','qr-wechat.svg','qrcode.min.js',
  'security-guard.js','video-recorder.js','wechat.html','xlsx.full.min.js',
  '_headers','_routes.json','README_DESKTOP.md','wrangler.toml',
]);
for (const f of fs.readdirSync(PUBLIC, { withFileTypes: true })) {
  if (!f.isFile()) continue;
  if (ADMIN_ALLOW_ROOT.has(f.name)) {
    cp(path.join(PUBLIC, f.name), path.join(ADMIN, f.name));
  }
}
for (const d of ['admin','electron','lib','updates']) {
  cp(path.join(PUBLIC, d), path.join(ADMIN, d));
}

// ============ 6. admin 子页面 ============
console.log('[6/8] Create admin/ticket-approval + activation-codes + build-queue ...');
ensureDir(path.join(ADMIN, 'admin'));
fs.writeFileSync(path.join(ADMIN, 'admin', 'ticket-approval.html'), `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>工单审批 · 惠康中医平台管理后台</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:"PingFang SC","Microsoft YaHei",sans-serif;background:#f5f7fa;color:#333;padding:24px;font-size:14px;line-height:1.7}
.wrap{max-width:1200px;margin:0 auto}
.top-bar{display:flex;justify-content:space-between;align-items:center;margin-bottom:20px}
.top-bar h1{font-size:22px;color:#2c3e50}
.top-bar .nav a{margin-left:14px;color:#606266;text-decoration:none}
.top-bar .nav a.active{color:#3498db;font-weight:600}
.alert{padding:10px 16px;border-radius:6px;margin-bottom:16px;background:#d1ecf1;color:#0c5460;border:1px solid #bee5eb}
.table-box{background:white;border-radius:8px;box-shadow:0 1px 4px rgba(0,0,0,.06);overflow:hidden;overflow-x:auto}
table{width:100%;border-collapse:collapse;min-width:960px}
th,td{padding:10px 12px;text-align:left;border-bottom:1px solid #ebeef5;font-size:13px}
th{background:#f5f7fa;color:#606266;font-weight:600;white-space:nowrap}
tr:hover{background:#f9fafc}
.mono{font-family:"Courier New",monospace;color:#2c3e50}
.tag{display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:500}
.tag-pending{background:#fff3cd;color:#856404}
.tag-approved{background:#d4edda;color:#155724}
.tag-rejected{background:#f8d7da;color:#721c24}
.btn{padding:6px 14px;border:none;border-radius:4px;cursor:pointer;font-size:13px;margin:0 2px}
.btn-approve{background:#27ae60;color:white}.btn-approve:hover{background:#229954}
.btn-reject{background:#e74c3c;color:white}.btn-reject:hover{background:#c0392b}
.btn-code{background:#3498db;color:white}.btn-code:hover{background:#2980b9}
</style>
</head>
<body>
<div class="wrap">
  <div class="top-bar">
    <h1>🗂️ 激活工单审批</h1>
    <div class="nav">
      <a href="index.html">激活码管理</a>
      <a href="ticket-approval.html" class="active">工单审批</a>
      <a href="build-queue.html">打包队列</a>
    </div>
  </div>
  <div class="alert">
    <strong>对接规则3：</strong>
    客户提交的工单由 license-manager.submitActivationTicket 上传到此。
    <br>⚠️ 列表中 machineId 显示前后各 6 位 + 中间打码（避免泄露完整哈希给操作员，规则3只上传加密串、不上原始硬件）。
    <br>审批通过后自动调用 /api/license/activate-from-ticket 写入激活码并通过邮件/短信通知客户。
  </div>
  <div class="table-box">
    <table>
      <thead>
        <tr><th>工单编号</th><th>提交时间</th><th>诊所名</th><th>版本</th>
          <th>联系人</th><th>联系电话</th>
          <th>设备标识（哈希，前后 6 位）</th>
          <th>状态</th><th>操作</th></tr>
      </thead>
      <tbody id="ticket-tbody">
        <tr><td colspan="9" style="text-align:center;color:#909399;padding:40px">加载中，请稍候...</td></tr>
      </tbody>
    </table>
  </div>
</div>
<script>
(function(){
  var LIST='/api/license/ticket/list', APPR='/api/license/activate-from-ticket', REJ='/api/license/ticket/reject';
  var tbody = document.getElementById('ticket-tbody');
  function mask(id){ if(!id) return '-'; if(id.length<=12) return id; return id.slice(0,6)+'••••'+id.slice(-6); }
  function tagHTML(s){
    if(s==='submitted'||s==='pending') return '<span class="tag tag-pending">待审批</span>';
    if(s==='approved') return '<span class="tag tag-approved">已通过</span>';
    if(s==='rejected') return '<span class="tag tag-rejected">已拒绝</span>';
    return '<span class="tag">'+s+'</span>';
  }
  function render(list){
    if(!list||!list.length){
      tbody.innerHTML='<tr><td colspan="9" style="text-align:center;color:#909399;padding:40px">暂无工单</td></tr>';
      return;
    }
    tbody.innerHTML=list.map(function(t){
      return '<tr>'+
        '<td class="mono">'+(t.ticketNo||'-')+'</td>'+
        '<td>'+(t.submittedAt||'-')+'</td>'+
        '<td>'+(t.clinicName||'-')+'</td>'+
        '<td>'+(t.edition||'-')+'</td>'+
        '<td>'+(t.contactName||'-')+'</td>'+
        '<td>'+(t.contactPhone||t.contactWechat||'-')+'</td>'+
        '<td class="mono" title="完整哈希仅写入激活校验，不回显">'+mask(t.machineId)+'</td>'+
        '<td>'+tagHTML(t.status)+'</td>'+
        '<td>'+
          ((t.status==='submitted'||t.status==='pending')
            ? '<button class="btn btn-approve" data-no="'+t.ticketNo+'" data-action="approve">✅ 一键通过并生成激活码</button>'+
              '<button class="btn btn-reject" data-no="'+t.ticketNo+'" data-action="reject">❌ 拒绝</button>'
            : '<button class="btn btn-code" data-no="'+t.ticketNo+'" data-action="detail">📋 详情</button>')+
        '</td></tr>';
    }).join('');
  }
  async function load(){
    try{
      var r=await fetch(LIST,{credentials:'same-origin'});
      var d=await r.json();
      render(d&&d.list?d.list:[]);
    }catch(e){
      tbody.innerHTML='<tr><td colspan="9" style="text-align:center;color:#e74c3c;padding:40px">工单列表加载失败：'+e.message+'</td></tr>';
    }
  }
  tbody.addEventListener('click', async function(e){
    var btn=e.target.closest('button[data-action]'); if(!btn) return;
    var no=btn.getAttribute('data-no'), act=btn.getAttribute('data-action');
    try{
      if(act==='approve'){
        var r=await fetch(APPR,{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify({ticketNo:no})});
        var d=await r.json();
        alert(d.success?('通过成功，激活码：'+(d.code||'（已发送给客户）')):('失败：'+(d.error||'未知')));
        if(d.success) load();
      }else if(act==='reject'){
        var reason=prompt('请输入拒绝原因（客户可见）：'); if(reason===null) return;
        var r=await fetch(REJ,{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify({ticketNo:no,reason:reason})});
        var d=await r.json();
        alert(d.success?'已拒绝':('失败：'+(d.error||'未知')));
        if(d.success) load();
      }else{
        alert('工单 '+no+' 详情接口待后端实现');
      }
    }catch(err){ alert('请求失败：'+err.message); }
  });
  load();
})();
</script></body></html>`, 'utf8');
fs.writeFileSync(path.join(ADMIN, 'admin', 'activation-codes.html'), `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><title>激活码管理 · 跳转</title></head>
<body><script>window.location.replace('./index.html#activation-codes');</script></body></html>`, 'utf8');
fs.writeFileSync(path.join(ADMIN, 'admin', 'build-queue.html'), `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><title>打包队列 · 惠康中医平台管理后台</title>
<style>body{font-family:sans-serif;padding:40px;max-width:720px;margin:0 auto;line-height:1.8;color:#2c3e50}
code{background:#f6f8fa;padding:2px 6px;border-radius:4px}a{color:#3498db}</style></head>
<body>
<h1>📦 打包队列</h1>
<p>本页接入 4 版本（YB/YJ/LB/LJ）打包流水线，展示当前打包任务、版本号、SHA-256 校验值。</p>
<p>后续接入：<code>pack-app-*.bat</code> / <code>pack-desktop-*.bat</code> 任务完成回调 → <code>/api/build/update</code>。</p>
<p><a href="./index.html">← 返回激活码管理</a> · <a href="ticket-approval.html">工单审批 →</a></p>
</body></html>`, 'utf8');
console.log('  + admin/{ticket-approval,activation-codes,build-queue}.html');

// ============ 7. headers / routes ============
console.log('[7/8] Write _headers, _routes.json, and deploy markdown ...');
fs.writeFileSync(path.join(OFFICIAL, '_headers'), `/*
  X-Frame-Options: DENY
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Content-Security-Policy: default-src 'self'; img-src 'self' data:; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'self'; object-src 'none'; worker-src 'none'
  Permissions-Policy: camera=(), microphone=(), geolocation=(), clipboard-write=(self)
/*.exe
  Cache-Control: public, max-age=604800, immutable
/*.apk
  Cache-Control: public, max-age=604800, immutable
`, 'utf8');
fs.writeFileSync(path.join(OFFICIAL, '_routes.json'), JSON.stringify({
  version:1,
  description:'Rule9: site-official pure showcase. Block /admin /api /auth-core etc by redirecting to admin domain',
  include:['/*'], exclude:[],
  rules:[
    {pathname:'/admin/*', status:301, location:'https://admin.huikangzy.com/admin/:splat'},
    {pathname:'/api/*',  status:301, location:'https://admin.huikangzy.com/api/:splat'},
    {pathname:'/auth-core.js', status:301, location:'https://admin.huikangzy.com/auth-core.js'},
    {pathname:'/permission.js', status:301, location:'https://admin.huikangzy.com/permission.js'},
    {pathname:'/login.html', status:301, location:'https://admin.huikangzy.com/login.html'},
    {pathname:'/*', status:200, location:'/index.html'},
  ]
}, null, 2), 'utf8');
fs.writeFileSync(path.join(ADMIN, '_headers'), `/*
  X-Frame-Options: SAMEORIGIN
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin
  Content-Security-Policy: default-src 'self'; img-src 'self' data: blob:; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' https://tcm-prescription-system.pages.dev; form-action 'self'; frame-ancestors 'self'; base-uri 'self'
  Permissions-Policy: camera=(self), microphone=(self), geolocation=(), clipboard-write=(self)
`, 'utf8');
fs.writeFileSync(path.join(ADMIN, '_routes.json'), JSON.stringify({
  version:1, description:'site-admin SPA fallback', include:['/*'], exclude:[],
  rules:[
    {pathname:'/admin/*', status:200, location:'/admin/index.html'},
    {pathname:'/*', status:200, location:'/index.html'}
  ]
}, null, 2), 'utf8');
require('./_write_deploy_md.cjs');

// ============ 8. final audit ============
console.log('[8/8] Final audit ...');
var safe=[], unsafe=[];
(function scan(dir,base){
  for(const e of fs.readdirSync(dir,{withFileTypes:true})){
    const fp=path.join(dir,e.name);
    const rel=path.relative(base,fp).split(path.sep).join('/');
    if(e.isDirectory()) scan(fp,base);
    else { if(isOfficialSafe(rel)) safe.push(rel); else unsafe.push(rel); }
  }
})(OFFICIAL, OFFICIAL);
if(unsafe.length){
  console.warn('  ⚠️  仍有 ' + unsafe.length + ' 敏感文件残留：');
  for(const u of unsafe) console.warn('    - ' + u);
  process.exitCode = 2;
} else {
  console.log('  ✅ site-official audit PASSED: ' + safe.length + ' files, zero sensitive');
}
function countFiles(dir){
  let c=0; const s=[dir];
  while(s.length){ const d=s.pop(); for(const e of fs.readdirSync(d,{withFileTypes:true})){
    const fp=path.join(d,e.name); if(e.isDirectory()) s.push(fp); else c++;
  }} return c;
}
console.log('  site-official files: ' + countFiles(OFFICIAL));
console.log('  site-admin    files: ' + countFiles(ADMIN));
console.log('\n=== DONE: physical split complete ===');
console.log('site-official/ = 官网（纯展示+下载+规则2隐私声明）');
console.log('site-admin/    = 后台+云端APP（admin工单审批/激活码管理 + 云端开方入口）');
console.log('详见 DEPLOY-站点分离部署说明.md 进行域名绑定和流水线更新。');
