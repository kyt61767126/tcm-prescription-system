// ============================================================================
// write-build-meta.cjs — 生成 build-meta.json（供登录页自证真伪三元组使用）
//   在 build.bat 第7步(obfuscate)之后、第8步(打包)之前调用，
//   写 <pkgDir>/build-meta.json = { version, buildTime, archMarker }
//   并把 archMarker 从 shared/button-manager.js 的 _archWatermark 中提取，
//   这样登录页显示的三要素：V1.2.91 | Build 时间戳 | Arch 2.xx 水印
//   用户一眼就能判断"我装的是不是真包"。
// ============================================================================
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
if (!args[0]) { console.error('[write-build-meta] 缺少参数: <package.json_dir>'); process.exit(2); }

const pkgDir = path.resolve(args[0]);
const pkgPath = path.join(pkgDir, 'package.json');
if (!fs.existsSync(pkgPath)) { console.error('[write-build-meta] package.json 不存在:', pkgPath); process.exit(2); }
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

// 找 button-manager 中的 Arch 水印（优先用 pkgDir 下的副本，否则用 shared）
var arch = 'UNKNOWN';
var candidates = [
    path.join(pkgDir, 'button-manager.js'),
    path.join(pkgDir, '..', '..', '..', 'shared', 'button-manager.js'),
    path.join(__dirname, '..', 'shared', 'button-manager.js')
];
for (var i = 0; i < candidates.length; i++) {
    if (!fs.existsSync(candidates[i])) continue;
    var s = fs.readFileSync(candidates[i], 'utf8');
    var m = s.match(/Arch\s+2\.\d+/);
    if (m) { arch = m[0]; break; }
}

var meta = {
    version: pkg.version,
    productName: pkg.build && pkg.build.productName || pkg.description || '',
    buildTime: new Date().toISOString(),
    buildTimeLocal: new Date().toLocaleString('zh-CN', { hour12: false }),
    archMarker: arch
};

const outPath = path.join(pkgDir, 'build-meta.json');
fs.writeFileSync(outPath, JSON.stringify(meta, null, 2), 'utf8');
console.log('[write-build-meta] ' + outPath + ' :');
console.log('  V' + meta.version + ' | Build ' + meta.buildTimeLocal + ' | ' + arch);
process.exit(0);
