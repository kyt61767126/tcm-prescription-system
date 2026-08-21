// ============================================================================
// final-verify.cjs — 构建最后一道铁闸：独立验证真 asar（与 prepare-win-unpacked 一致的标准）
//   失败时删除 OUTPUT_DIR + dist 下所有 exe，杜绝假包。
// 与 prepare-win-unpacked.js 铁闸2使用完全相同的 ARCH_MARKERS。
//
// 环境变量（由 build.bat 传入）：
//   VERIFY_ASAR_PATH   = 真 asar 的绝对路径（即通过 prepare-win-unpacked GATE-KEEPER 的那个）
//   VERIFY_PKG_DIR     = package.json 所在目录（用于读取期望版本号）
//   VERIFY_OUTPUT_DIR  = 当前 electron-builder 的 output 目录（用于失败时删除 exe）
// ============================================================================
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ARCH_MARKERS = [
  ['Single-Writer 按钮写入源 __applyUserButtons', /__applyUserButtons/],
  ['补丁入口 __patchOldCallers',               /__patchOldCallers/],
  ['Edition 归一化锁 __editionLocked',          /__editionLocked/],
  ['Edition 拦截 get/set __authoritativeEdition', /__authoritativeEdition/],
  ['Arch 2.25 _normalizeEdition 别名归一化',    /_normalizeEdition/],
  ['Arch 2.25 水印',                            /Arch 2\.2[5-9]/],
  ['Arch 2.25 instAdminAssert 机构管理员断言',   /instAdminAssert/],
  ['Arch 2.25 editionNormalize 标识',            /editionNormalize/],
];

const asarPath = process.env.VERIFY_ASAR_PATH;
const pkgDir = process.env.VERIFY_PKG_DIR || process.cwd();
const outputDir = process.env.VERIFY_OUTPUT_DIR || '';
const pkgPath = path.join(pkgDir, 'package.json');

if (!asarPath || !fs.existsSync(asarPath)) {
  console.error('[FINAL GATE FAIL] 真 asar 不存在:', asarPath);
  process.exit(1);
}
if (!fs.existsSync(pkgPath)) {
  console.error('[FINAL GATE FAIL] package.json 不存在:', pkgPath);
  process.exit(1);
}

const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const raw = fs.readFileSync(asarPath, 'latin1');
const stat = fs.statSync(asarPath);

console.log('');
console.log('┌──────────────────────────────────────────────────────────────┐');
console.log('│   FINAL IRON GATE — 真 asar 独立硬校验（与 prepare-win-unpacked 同标准）│');
console.log('│   版本: ' + (pkg.version || '?') + '                                            │');
console.log('│   asar: ' + Math.round(stat.size/1024/1024*10)/10 + ' MB                               │');
console.log('└──────────────────────────────────────────────────────────────┘');
console.log('');

let fail = 0;
function check(label, ok) {
  if (ok) console.log('[PASS] ' + label);
  else { console.log('[FAIL] ' + label + ' —— !! 修复代码未落位，阻断构建 !!'); fail++; }
}

// ① version 精确匹配
const versionRe = new RegExp(('"version": "' + pkg.version + '"').replace(/\./g, '\\.'));
check('asar 内 package.json version = ' + pkg.version, versionRe.test(raw));

// ② 8 个 ARCH_MARKERS（与 prepare-win-unpacked.js 完全一致）
for (const [name, re] of ARCH_MARKERS) {
  check(name, re.test(raw));
}

// ③ 铁闸4三元组（build-meta.json 必须存在：版本号 + Build 中文时间戳 + ArchMarker）
// build-meta.json 是标准 JSON 格式："version": "1.2.95"、"buildTimeLocal": "2026/8/21 08:59:41"、"archMarker": "Arch 2.25"
const hasMetaVersion = raw.includes('"version": "' + pkg.version + '"') || raw.includes('"version":"' + pkg.version + '"');
check('铁闸4三元组：build-meta.json 中 version = ' + pkg.version, hasMetaVersion);
const hasArchMarker = raw.includes('Arch 2.2') && /"archMarker"\s*:\s*"Arch\s+2\.\d+/.test(raw);
check('铁闸4三元组：build-meta.json 中 archMarker（Arch 2.xx）存在', hasArchMarker);
const hasBuildDate = raw.includes('buildTimeLocal') && /\d{4}\/\d{1,2}\/\d{1,2}/.test(raw);
check('铁闸4三元组：Build 中文时间戳存在', hasBuildDate);

// ④ 铁闸8：运行时冒烟 —— 从 asar 提取用户管理链路函数，vm 沙箱注入坏数据，断言不抛错
//    防 1.2.101 "【用户管理】按钮点击无响应"类静默崩溃复发（CONFIG.users 非数组 / localStorage 毒数据）
let smokeFail = 1, smokePass = 0, smokeTotal = 0;
try {
  const smoke = require('./smoke-runtime.cjs');
  const r = smoke.run({ asarPath });
  smokeFail = r.fail; smokePass = r.pass; smokeTotal = r.total;
  for (const l of r.lines) console.log(l);
} catch (e) {
  console.log('[SMOKE][FAIL] 冒烟执行器异常: ' + (e && e.message ? e.message : String(e)));
}
check('铁闸8 运行时冒烟：坏数据注入 ' + smokePass + '/' + smokeTotal + ' 用例通过', smokeFail === 0);

// ④b 铁闸8b（P1 2026-08-21）：登录窗口旁路检测 —— login.js 加解密必须委托 UserStore
//     防"登录窗口独立实现 XORv1 直读 local_systemUsers"旁路复发（主界面/登录窗数据分裂根源）
//     注意：必须独立 require（上面的 smoke 是 try 块内 const，块外不可见——首个 1.2.111 构建因此误报）
try {
  const lb2 = require('./smoke-runtime.cjs').checkLoginBypass();
  for (const l of lb2.lines) console.log(l);
  check('铁闸8b 登录窗口旁路：login.js 委托 UserStore ' + lb2.pass + '/' + lb2.total, lb2.fail === 0);
} catch (e) {
  check('铁闸8b 登录窗口旁路检测异常: ' + (e && e.message ? e.message : String(e)), false);
}

console.log('');

if (fail > 0) {
  console.error('[FINAL GATE] FAIL ' + fail + ' 项。启动红线删除所有 exe。');
  // 红线：OUTPUT_DIR + dist 下所有 exe
  const roots = [];
  if (outputDir && fs.existsSync(outputDir)) roots.push(outputDir);
  const distDir = path.join(pkgDir, 'dist');
  if (fs.existsSync(distDir)) roots.push(distDir);
  const quarantined = [];
  for (const r of roots) {
    try {
      for (const f of fs.readdirSync(r)) {
        if (/\.exe$/i.test(f)) {
          try {
            const fp = path.join(r, f);
            fs.unlinkSync(fp);
            quarantined.push(f);
          } catch (e) { /* exe 被锁，提示即可 */ }
        }
      }
    } catch (e) {}
  }
  if (quarantined.length) console.error('  ★ 红线：已删除不可交付的 exe → ' + quarantined.join(' | '));
  else console.error('  ★ 红线：无 exe 可删（请手动检查 output/dist 是否有残留安装包）');
  process.exit(1);
}

console.log('[FINAL GATE] ALL PASS。7 道铁闸全部生效 ✓ — 允许交付');
console.log('');
process.exit(0);
