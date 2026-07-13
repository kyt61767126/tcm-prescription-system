#!/usr/bin/env node
// Netlify 跨平台构建脚本：复制 public/ 到 dist/
const fs = require('fs');
const path = require('path');

function copyDir(src, dest) {
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(s, d);
    } else {
      fs.copyFileSync(s, d);
    }
  }
}

const root = __dirname;
const distDir = path.join(root, 'dist');
const publicDir = path.join(root, 'public');

console.log('============================================');
console.log('  Netlify 部署构建脚本');
console.log('============================================');
console.log('');

console.log('[1/3] 清理旧构建产物...');
fs.rmSync(distDir, { recursive: true, force: true });
console.log('[OK] 清理完成');
console.log('');

console.log('[2/3] 复制 public/ 到 dist/...');
if (!fs.existsSync(publicDir)) {
  console.error('[错误] public/ 目录不存在');
  process.exit(1);
}
copyDir(publicDir, distDir);
console.log('[OK] 复制完成');
console.log('');

console.log('[3/3] 验证 dist/index.html...');
const indexPath = path.join(distDir, 'index.html');
if (!fs.existsSync(indexPath)) {
  console.error('[错误] dist/index.html 不存在');
  process.exit(1);
}
console.log('[OK] dist/index.html 已就绪');
console.log('');

console.log('============================================');
console.log('  构建完成！dist/ 目录已就绪');
console.log('============================================');
