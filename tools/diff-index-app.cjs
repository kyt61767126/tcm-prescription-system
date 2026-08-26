// tools/diff-index-app.cjs
// 举一反三防呆工具：全量对比 desktop/index.html 与 index-app.html 的函数/功能块差异
// 背景（2026-08-26）：desktop 新增功能漏移植 index-app.html（APP真实源文件），打包后静默丢失。
// 用法：
//   node tools/diff-index-app.cjs            完整输出
//   node tools/diff-index-app.cjs --quiet    打包内嵌用：仅打印差异摘要
// 打包脚本 build-app.bat 在 copy index-app.html 前自动调用本工具（非阻断，WARN 提示）。
// 基线文件 tools/.drift-baseline.json 记录"已知合理差异"，新增缺失才会醒目告警。
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DESKTOP = path.join(ROOT, 'app_project/db-offline/desktop/index.html');
const APP = path.join(ROOT, 'app_project/db-offline/index-app.html');
const BASELINE = path.join(__dirname, '.drift-baseline.json');
const quiet = process.argv.includes('--quiet');

const d = fs.readFileSync(DESKTOP, 'utf8');
const a = fs.readFileSync(APP, 'utf8');

const extractFns = (s) => {
    const set = new Set();
    const re = /(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g;
    let m; while ((m = re.exec(s))) set.add(m[1]);
    return set;
};
const fd = extractFns(d), fa = extractFns(a);

// desktop 有而 APP 没有的函数 = 疑似漏移植（可能含 Electron 特有的合理差异）
const missing = [...fd].filter((n) => !fa.has(n)).sort();
const appOnly = [...fa].filter((n) => !fd.has(n)).sort();

// 关键功能标记（新增业务功能时往这里补标记，防止函数名检查漏掉块级功能）
const MARKERS = [
    '新用户名（选填，留空不修改）', 'injectUsernameField', '_pwdChange',
    'renameUser', 'accountMatchedButPwdWrong',
    '查看处方', '症状快捷录入', '月度统计', '药材使用统计',
];
const markerDiff = [];
for (const mk of MARKERS) {
    const dd = d.includes(mk), aa = a.includes(mk);
    if (dd !== aa) markerDiff.push({ marker: mk, desktop: dd, app: aa });
}

// 基线比对：只对"新增缺失"告警
let baseline = { missing: [], markers: [] };
try { baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf8')); } catch (e) {}
const newMissing = missing.filter((n) => !baseline.missing.includes(n));
const newMarkerDiff = markerDiff.filter((m) => !baseline.markers.some((b) => b.marker === m.marker));

if (!quiet) {
    console.log('=== desktop/index.html 有 但 index-app.html 没有的函数（疑似漏移植/Electron特有）===');
    missing.forEach((n) => console.log('  ' + (baseline.missing.includes(n) ? '[基线已知]' : '[新缺失!]'), n));
    console.log('=== index-app.html 特有函数（APP特有，正常）===');
    appOnly.forEach((n) => console.log('  [APP特有]', n));
    console.log('=== 关键功能标记差异 ===');
    markerDiff.forEach((m) => console.log(`  "${m.marker}" desktop=${m.desktop} APP=${m.app}`));
    if (!markerDiff.length) console.log('  （无差异）');
}

if (newMissing.length || newMarkerDiff.length) {
    console.log('');
    console.log('============================================');
    console.log('[drift-guard][WARN] 检测到新的功能漂移！');
    newMissing.forEach((n) => console.log('  [新缺失函数]', n));
    newMarkerDiff.forEach((m) => console.log(`  [标记差异] "${m.marker}" desktop=${m.desktop} APP=${m.app}`));
    console.log('  若为漏移植 → 把功能移植到 app_project/db-offline/index-app.html 后重打包；');
    console.log('  若为桌面特有（Electron API等）→ 运行: node tools/diff-index-app.cjs --update-baseline 更新基线');
    console.log('============================================');
} else if (!quiet) {
    console.log('\n[drift-guard][OK] 无新增漂移（差异均在基线内，详见 tools/.drift-baseline.json）');
}

// --update-baseline：将当前差异固化为已知基线
if (process.argv.includes('--update-baseline')) {
    fs.writeFileSync(BASELINE, JSON.stringify({ missing, markers: markerDiff }, null, 2), 'utf8');
    console.log('[drift-guard] 基线已更新: tools/.drift-baseline.json');
}
