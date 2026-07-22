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
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
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

// Add dependencies from package.json
const deps = pkg.dependencies || {};
for (const depName of Object.keys(deps)) {
  fileList.push(path.join('node_modules', depName));
}

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
  // Clean win-unpacked to remove stale non-ASCII exe from previous runs
  // (7z in electron-builder cannot handle Chinese filenames like 惠康中医-云端.exe)
  fs.rmSync(winUnpacked, { recursive: true, force: true });
  fs.mkdirSync(winUnpacked, { recursive: true });
  fs.mkdirSync(resourcesDir, { recursive: true });
  fs.cpSync(electronDist, winUnpacked, { recursive: true, force: true });

  const electronExe = path.join(winUnpacked, 'electron.exe');
  const productExe = path.join(winUnpacked, `${exeName}.exe`);
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

  const asarPath = path.join(resourcesDir, 'app.asar');
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

  const ok = fs.existsSync(productExe) && fs.existsSync(asarPath) &&
             fs.existsSync(path.join(resourcesDir, 'default_app.asar')) &&
             fs.existsSync(path.join(winUnpacked, 'locales'));
  if (ok) {
    console.log(`win-unpacked prepared successfully for ${productName}`);
    process.exit(0);
  } else {
    console.error('Verification failed!');
    process.exit(1);
  }
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
