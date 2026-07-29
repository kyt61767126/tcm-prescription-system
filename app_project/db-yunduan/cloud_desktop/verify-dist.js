const asar = require('@electron/asar');
const path = require('path');
const ASAR_PATH = path.join(__dirname, 'dist-v2', 'win-unpacked', 'resources', 'app.asar');
const main = asar.extractFile(ASAR_PATH, 'electron/main.js').toString('utf8');
console.log('=== dist-v2/win-unpacked app.asar 检查 ===');
console.log('get-logged-in-user:', main.includes('get-logged-in-user'));
console.log('get-image-directory:', main.includes('get-image-directory'));
console.log('login-cancel:', main.includes('login-cancel'));
console.log('get-index-html-content:', main.includes('get-index-html-content'));
console.log('login-state.json 写入代码已删除:', !main.includes("await fse.writeJson(tmpPath, payload"));
console.log('get-current-user handler 已删除:', !main.includes("ipcMain.handle('get-current-user'"));
const preload = asar.extractFile(ASAR_PATH, 'electron/preload.js').toString('utf8');
console.log('localDB 已从 preload 移除:', !preload.includes('localdb:ready'));
const idx = asar.extractFile(ASAR_PATH, 'index.html').toString('utf8');
console.log('index.html 回退分支loadData修复:', idx.includes('回退分支也需加载数据'));
// ★ 新增：isCapacitor 重复声明已修复（关键修复！）
const isCapMatches = idx.match(/const isCapacitor\s*=/g) || [];
console.log('isCapacitor 重复声明已修复 (匹配数应为1):', isCapMatches.length === 1, '(实际:', isCapMatches.length, ')');
// ★ 新增：DataCache.has 错误已修复
console.log('DataCache.has 错误已修复:', !idx.includes('DataCache.has('));
