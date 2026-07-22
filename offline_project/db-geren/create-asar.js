const asar = require('@electron/asar');
const fs = require('fs');
const path = require('path');
const cwd = process.cwd();
const files = ['electron','index.html','config.json','vendor','package.json','package-lock.json','auth-core.js','permission.js','debug-logger.js','print-utils.js','medicine-dict.js','db-adapter.js','performance-utils.js','prescription-core.js','patient-archive.js'];
const tmpDir = path.join(require('os').tmpdir(), 'asar-src-' + Date.now());
fs.mkdirSync(tmpDir, { recursive: true });
files.forEach(f => {
  const src = path.join(cwd, f);
  const dst = path.join(tmpDir, f);
  if (!fs.existsSync(src)) { console.warn('SKIP: ' + f); return; }
  if (fs.statSync(src).isDirectory()) { fs.cpSync(src, dst, { recursive: true }); }
  else { fs.copyFileSync(src, dst); }
});
const outPath = path.join(cwd, 'dist', 'win-unpacked', 'resources', 'app.asar');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
asar.createPackage(tmpDir, outPath).then(() => {
  const stat = fs.statSync(outPath);
  console.log('app.asar created: ' + stat.size + ' bytes');
  fs.rmSync(tmpDir, { recursive: true, force: true });
}).catch(e => { console.error('Error:', e.message); process.exit(1); });