// prepare-win-unpacked.js
// Prepares dist/win-unpacked directory for electron-builder --prepackaged
// Usage: node prepare-win-unpacked.js <versionDir>
// Reads package.json for productName and files list, copies electron dist,
// renames exe, creates app.asar from source files.
const fs = require('fs');
const path = require('path');

// Use @electron/asar from the version directory's node_modules, fallback to db-geren
let asarModule;
const tryPaths = [
  path.join(process.cwd(), 'node_modules', '@electron', 'asar'),
  path.join(__dirname, '..', 'offline_project', 'db-geren', 'node_modules', '@electron', 'asar'),
];
for (const p of tryPaths) {
  try { asarModule = require(p); break; } catch(e) {}
}
if (!asarModule) {
  console.error('ERROR: @electron/asar not found. Please run: npm install @electron/asar --save-dev');
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
// after installation ("Windows cannot find 惠康中医-个人.exe").
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
    console.log(`Renamed electron.exe -> ${exeName}.exe (productName: ${productName})`);
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
  // 历史bug：path.join(versionDir, ...) 产生 'cloud_project/cloud_desktop/node_modules/asarmor'
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
    console.error('  ASAR 防解包保护未生效！app.asar 可被提取查看源码。');
    // Non-fatal: app still works, just without anti-extraction protection
  }

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
