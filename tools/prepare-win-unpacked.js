// prepare-win-unpacked.js
// Prepares dist/win-unpacked directory for electron-builder --prepackaged
// Usage: node prepare-win-unpacked.js <versionDir>
// Reads package.json for productName and files list, copies electron dist,
// renames exe, creates app.asar from source files.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ★ 与 afterPack.js 保持一致的关键标识集（铁闸2用）
//   任何一项缺失 → process.exit(1) 阻断 electron-builder，绝不产出假包
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
function sha256Buf(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }

// Use @electron/asar from the version directory's node_modules.
// Use Module.createRequire() with a sentinel context file so Node honors the package.json
// "exports" field (not just legacy "main" / index.js).  @electron/asar v4 ships with NO main
// field (only exports) so require('/abs/path/to/node_modules/@electron/asar') silently fails
// and surfaces as the misleading "not found" error when the module is actually installed.
const Module = require('module');
const candidateRoots = [
  process.cwd(),
];
let asarModule;
let lastErr;
for (const root of candidateRoots) {
  try {
    const ctxRequire = Module.createRequire(path.join(root, '_.cjs'));
    asarModule = ctxRequire(ctxRequire.resolve('@electron/asar'));
    break;
  } catch (e) {
    lastErr = e;
  }
}
if (!asarModule) {
  console.error('ERROR: @electron/asar not found. Please run: npm install @electron/asar --save-dev');
  if (lastErr) console.error('  underlying error:', lastErr.code, lastErr.message);
  process.exit(1);
}
const { createPackage } = asarModule;

const versionDir = process.argv[2];
if (!versionDir) {
  console.error('Usage: node prepare-win-unpacked.js <versionDir>');
  process.exit(1);
}

// Resolve relative to versionDir
const pkgPath = path.join(versionDir, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8').replace(/^\uFEFF/, ''));
const productName = pkg.build.productName || pkg.name;
// exe name MUST match productName: electron-builder NSIS shortcut Target is hardcoded
// to ${productName}.exe. If exe name differs (e.g. pkg.name), shortcut will be broken
// after installation ("Windows cannot find 惠康中医-标准.exe").
const exeName = productName;
const buildFiles = pkg.build.files || [];

// Extract file list from build.files (handles both string and {filter:[]} formats)
let fileList = [];
for (const item of buildFiles) {
  if (typeof item === 'string') {
    const cleanPath = item.replace(/\/\*+.*$/, '');
    fileList.push(cleanPath);
  } else if (item && item.filter) {
    for (const f of item.filter) {
      const cleanPath = f.replace(/\/\*+.*$/, '');
      fileList.push(cleanPath);
    }
  }
}

// Recursively resolve all dependencies (direct + transitive) from node_modules
// fs-extra depends on universalify, graceful-fs, jsonfile etc. — these must be included
function resolveAllDeps(rootDir, depNames, visited = new Set()) {
  const result = [];
  for (const name of depNames) {
    if (visited.has(name)) continue;
    visited.add(name);
    const depPath = path.join(rootDir, 'node_modules', name);
    const depPkgPath = path.join(depPath, 'package.json');
    if (!fs.existsSync(depPkgPath)) continue;
    result.push(path.join('node_modules', name));
    try {
      const depPkg = JSON.parse(fs.readFileSync(depPkgPath, 'utf8'));
      const subDeps = Object.keys(depPkg.dependencies || {});
      for (const sub of subDeps) {
        // Check node_modules/<dep>/node_modules/<sub> first (nested), then top-level
        const nestedSubPath = path.join(depPath, 'node_modules', sub, 'package.json');
        if (fs.existsSync(nestedSubPath)) {
          // Nested dependency — include the whole nested node_modules path
          if (!visited.has(`${name}/${sub}`)) {
            visited.add(`${name}/${sub}`);
            result.push(path.join('node_modules', name, 'node_modules', sub));
          }
        } else {
          // Top-level dependency — recurse
          result.push(...resolveAllDeps(rootDir, [sub], visited));
        }
      }
    } catch (e) { /* ignore parse errors */ }
  }
  return result;
}

// Add direct + transitive dependencies from package.json
const deps = pkg.dependencies || {};
const depNames = Object.keys(deps);
fileList.push(...resolveAllDeps(versionDir, depNames));

// Deduplicate
fileList = [...new Set(fileList)];

const electronDist = path.join(versionDir, 'node_modules', 'electron', 'dist');
const winUnpacked = path.join(versionDir, 'dist', 'win-unpacked');
const resourcesDir = path.join(winUnpacked, 'resources');

async function main() {
  console.log(`Preparing win-unpacked for ${productName}...`);

  if (!fs.existsSync(electronDist)) {
    console.error(`ERROR: electron dist not found at ${electronDist}`);
    console.error('Please run: npm install electron --save-dev');
    process.exit(1);
  }

  fs.mkdirSync(winUnpacked, { recursive: true });
  fs.mkdirSync(resourcesDir, { recursive: true });

  console.log('Copying electron dist to win-unpacked...');
  // Clean win-unpacked to remove stale files from previous runs
  // Handle EBUSY/EPERM (file locked by IDE indexer): use new dir name if locked
  let actualWinUnpacked = winUnpacked;
  if (fs.existsSync(winUnpacked)) {
    let removed = false;
    try {
      fs.rmSync(winUnpacked, { recursive: true, force: true });
      removed = !fs.existsSync(winUnpacked);
    } catch (e) {
      // rmSync failed (EBUSY/EPERM or partial delete)
    }
    if (!removed) {
      // Directory still exists (locked or partially deleted): use a fresh directory name
      actualWinUnpacked = `${winUnpacked}.${Date.now()}`;
      console.log(`  [WARN] win-unpacked was locked, using ${path.basename(actualWinUnpacked)} instead`);
      // Best-effort async cleanup of old dir (don't wait)
      require('child_process').exec(`rd /s /q "${winUnpacked}"`, () => {});
    }
  }
  // Always create fresh dir (actualWinUnpacked may differ from winUnpacked if locked)
  const actualResourcesDir = path.join(actualWinUnpacked, 'resources');
  fs.mkdirSync(actualWinUnpacked, { recursive: true });
  fs.mkdirSync(actualResourcesDir, { recursive: true });
  fs.cpSync(electronDist, actualWinUnpacked, { recursive: true, force: true });
  // Write the actual path to a temp file for pack.ps1 to read
  fs.writeFileSync(path.join(versionDir, 'dist', 'win-unpacked-path.txt'), actualWinUnpacked, 'utf8');

  const electronExe = path.join(actualWinUnpacked, 'electron.exe');
  const productExe = path.join(actualWinUnpacked, `${exeName}.exe`);
  if (fs.existsSync(electronExe)) {
    if (fs.existsSync(productExe)) fs.unlinkSync(productExe);
    fs.renameSync(electronExe, productExe);
    // ★ 修复：更新 exe 时间戳为当前打包时间（cpSync+renameSync 保留 electron 原始编译时间，易造成误解）
    const now = new Date();
    try { fs.utimesSync(productExe, now, now); } catch(e) {}
    // ★ 嵌入 APP 统一图标（本能印章）到 exe
    // 背景：本脚本直接重命名 electron.exe，其图标为 Electron 默认图标；--prepackaged 模式
    //       不会给 win-unpacked 里的 exe 应用 build/win/icon。因此用 electron-builder 自带
    //       的 rcedit 工具将 build/icon.ico 嵌入 exe，实现桌面与 APP 图标统一。
    try {
      const iconPath = path.join(versionDir, 'build', 'icon.ico');
      if (fs.existsSync(iconPath)) {
        const winCodeSignRoot = path.join(process.env.LOCALAPPDATA || '', 'electron-builder', 'Cache', 'winCodeSign');
        let rcedit;
        if (fs.existsSync(winCodeSignRoot)) {
          const walk = (dir) => {
            let ents;
            try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
            for (const e of ents) {
              if (e.isDirectory()) walk(path.join(dir, e.name));
              else if (/^rcedit-x64\.exe$/.test(e.name)) { rcedit = path.join(dir, e.name); return; }
            }
          };
          walk(winCodeSignRoot);
        }
        if (rcedit) {
          require('child_process').execSync(`"${rcedit}" "${productExe}" --set-icon "${iconPath}"`, { stdio: 'inherit' });
          console.log(`  [OK] 已嵌入 APP 统一图标到 ${exeName}.exe`);
        } else {
          console.log('  [WARN] 未找到 rcedit，跳过 exe 图标嵌入（exe 将显示 Electron 默认图标）');
        }
      } else {
        console.log('  [SKIP] build/icon.ico 不存在，跳过 exe 图标嵌入');
      }
    } catch (e) {
      console.error(`  [WARN] exe 图标嵌入失败（不影响打包）: ${e.message}`);
    }

    // ★ P1-[3.1] 嵌入 PE 自定义完整性区段 .bnzc（EXE 签名自校验第二路）
    // 必须在 rcedit 图标嵌入之后执行（rcedit 会改动 exe 字节，先 embed 会被破坏）
    try {
      const peGuard = require('../shared/pe-guard.cjs');
      const r = peGuard.embedZone(productExe);
      console.log(`  [OK] 已嵌入 .bnzc 完整性区段（mode=${r.mode}）到 ${exeName}.exe`);
    } catch (e) {
      // 非阻塞告警：不影响打包，仅记录（符合"宁漏检不可误报"红线）
      console.warn(`  [WARN] PE 完整性区段嵌入失败（不影响打包）: ${e.message}`);
    }
  }

  console.log('Creating app.asar...');
  const tmpDir = path.join(require('os').tmpdir(), `asar-src-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  let includedFiles = [];
  for (const f of fileList) {
    const src = path.join(versionDir, f);
    const dst = path.join(tmpDir, f);
    if (!fs.existsSync(src)) continue;
    if (fs.statSync(src).isDirectory()) {
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.cpSync(src, dst, { recursive: true });
    } else {
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(src, dst);
    }
    includedFiles.push(f);
  }

  const asarPath = path.join(actualResourcesDir, 'app.asar');
  try {
    await createPackage(tmpDir, asarPath);
    const stat = fs.statSync(asarPath);
    console.log(`app.asar created: ${stat.size} bytes (${includedFiles.length} entries)`);
  } catch (e) {
    console.error(`ERROR creating asar: ${e.message}`);
    fs.rmSync(tmpDir, { recursive: true, force: true });
    process.exit(1);
  }

  fs.rmSync(tmpDir, { recursive: true, force: true });

  // Apply asarmor ASAR protection (防解包: 100GB bloat patch)
  // afterPack.js doesn't execute in --prepackaged mode, so we apply it here
  // ★关键修复：必须用 path.resolve() 生成绝对路径，require() 无法解析 path.join 的相对路径
  // 历史bug：path.join(versionDir, ...) 产生 'app_project/db-yunduan/cloud_desktop/node_modules/asarmor'
  //          require() 把它当作模块名查找，报 Cannot find module，被 catch 静默跳过
  try {
    const asarmorPath = path.resolve(versionDir, 'node_modules', 'asarmor');
    const asarmor = require(asarmorPath);
    const bloatGb = parseInt(process.env.ASARMOR_BLOAT_GB || '100', 10);
    console.log(`Applying asarmor protection (${bloatGb}GB bloat patch)...`);
    console.log(`  asarmor module: ${asarmorPath}`);
    const archive = await asarmor.open(asarPath);
    const bloatPatch = asarmor.createBloatPatch(bloatGb);
    archive.patch(bloatPatch);
    await archive.write(asarPath);
    const newSize = fs.statSync(asarPath).size;
    console.log(`asarmor protection applied successfully (asar size: ${newSize} bytes)`);
  } catch (e) {
    console.error(`[ERROR] asarmor protection FAILED: ${e.message}`);
    console.error('  ASAR anti-extraction protection not active! app.asar can be extracted to view source code.');
    // Non-fatal: app still works, just without anti-extraction protection
  }

  // =====================================================================
  // ★ 铁闸2（prepare-win-unpacked 硬校验）★
  // 背景：electron-builder 以 --prepackaged 模式运行时，package.json 的
  //       afterPack 钩子**不会被调用**（prepare-win-unpacked.js 第 237 行
  //       已经注释说明这一点）。所以必须在这里，asar 刚刚被创建+asarmor
  //       之后、electron-builder 还未开始之前，做二进制全文关键标识检查。
  //
  // 失败策略：process.exit(1) 中断 prepare-win-unpacked → build.bat 会立刻
  //           检测到非零退出码 → 还原混淆源码并退出 → 绝对不会进入
  //           electron-builder 阶段 → 不会有任何假 Setup exe 流出。
  // =====================================================================
  console.log('');
  console.log('═══════════════════════════════════════════════════════');
  console.log('  prepare-win-unpacked GATE-KEEPER（铁闸2）硬校验');
  console.log('  package.json 期望版本: ' + pkg.version);
  console.log('  asar路径: ' + asarPath);
  console.log('═══════════════════════════════════════════════════════');

  if (!fs.existsSync(asarPath)) {
    console.error('[GATE-KEEPER FAIL] app.asar 文件不存在');
    process.exit(1);
  }
  const asarStat = fs.statSync(asarPath);
  // 正常包约 3.39MB~15.5MB，低于 2MB 必然是空包/缓存复用
  if (asarStat.size < 2_000_000) {
    console.error(`[GATE-KEEPER FAIL] app.asar 过小 (${asarStat.size} bytes)，极可能是空包/缓存复用旧asar`);
    process.exit(1);
  }
  const asarISO = fs.readFileSync(asarPath, 'latin1');

  // ① package.json version 必须出现在 asar 二进制中（杜绝旧 asar 缓存复用）
  const versionRe = new RegExp(('"version": "' + pkg.version + '"').replace(/\./g, '\\.'));
  if (!versionRe.test(asarISO)) {
    console.error(`[GATE-KEEPER FAIL] asar 内无 package.json version = ${pkg.version} 字符串`);
    console.error('  → 这说明 build.files 引用了旧文件，或 asar 步骤复制的是 dist 缓存');
    console.error('  → 请杀尽旧进程、清空 dist* 目录、重打包');
    process.exit(1);
  }
  console.log('  [PASS] asar 内 version = ' + pkg.version);

  // ② 逐一检查架构修复标识（一个都不能少）
  const auditMarkers = {};
  let allMarkersOk = true;
  for (const [name, re] of ARCH_MARKERS) {
    const ok = re.test(asarISO);
    auditMarkers[name] = ok ? 'PASS' : 'FAIL';
    if (!ok) {
      console.error(`[GATE-KEEPER FAIL] 关键标识缺失: ${name}`);
      console.error('  → 请先运行: node tools/copy-consistency.cjs --fix  同步副本');
      allMarkersOk = false;
    } else {
      console.log('  [PASS] ' + name);
    }
  }
  if (!allMarkersOk) process.exit(1);

  // =====================================================================
  // ★ 铁闸5（构建审计报告 build-audit.json）★
  // 在 versionDir/dist/ 下写报告，build.bat 完成后会随 consolidation
  // 一并搬入最终 output，用户可对照验证。
  // =====================================================================
  const buildTime = new Date().toISOString();
  const archMatch = (asarISO.match(/Arch 2\.\d+/g) || []);
  const postAsarmorSize = fs.statSync(asarPath).size;
  const postAsarmorSha256 = sha256Buf(fs.readFileSync(asarPath));
  const audit = {
    version: pkg.version,
    buildTime: buildTime,
    winUnpackedPath: actualWinUnpacked,
    asarSize: asarStat.size,
    asarSha256: sha256Buf(fs.readFileSync(asarPath)),
    postAsarmorSize: postAsarmorSize,
    postAsarmorSha256: postAsarmorSha256,
    markers: auditMarkers,
    pass: true,
    versionTriple: 'V' + pkg.version + ' | Build ' + new Date(buildTime).toLocaleString('zh-CN', { hour12: false }) +
                   ' | ' + (archMatch.length ? archMatch[archMatch.length - 1] : 'UNKNOWN'),
  };
  const distDir = path.join(versionDir, 'dist');
  fs.mkdirSync(distDir, { recursive: true });
  const auditPath = path.join(distDir, 'build-audit.json');
  try {
    fs.writeFileSync(auditPath, JSON.stringify(audit, null, 2), 'utf8');
    console.log('');
    console.log('[GATE-KEEPER] 铁闸5 构建审计报告写入: ' + auditPath);
    console.log('[GATE-KEEPER] 版本三元组: ' + audit.versionTriple);
  } catch (e) {
    console.warn('[GATE-KEEPER WARN] 审计报告写入失败 (non-fatal):', e.message);
  }
  console.log('');
  console.log('[GATE-KEEPER] ALL CHECKS PASS ✓ — 允许进入 electron-builder --prepackaged 阶段');
  console.log('═══════════════════════════════════════════════════════');
  console.log('');

  const ok = fs.existsSync(productExe) && fs.existsSync(asarPath) &&
             fs.existsSync(path.join(actualResourcesDir, 'default_app.asar')) &&
             fs.existsSync(path.join(actualWinUnpacked, 'locales'));
  if (ok) {
    console.log(`win-unpacked prepared successfully for ${productName}`);
    process.exit(0);
  } else {
    console.error('Verification failed!');
    process.exit(1);
  }
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
