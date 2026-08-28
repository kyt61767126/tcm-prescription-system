/* 批量同步 auth-core.js 副本的「记住用户名层」实名过滤逻辑
   以 shared/auth-core.js 为权威源，替换所有目标副本的对应区段
*/
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const MARKER_START = '// ==================== 记住用户名层 ====================';
const MARKER_END = '// ==================== 初始化 ====================';

// 1. 提取权威段
const stdPath = path.join(ROOT, 'shared/auth-core.js');
const stdSrc = fs.readFileSync(stdPath, 'utf8');
const sIdx = stdSrc.indexOf(MARKER_START);
const eIdx = stdSrc.indexOf(MARKER_END);
if (sIdx < 0 || eIdx < 0 || eIdx <= sIdx) {
  console.error('权威源 shared/auth-core.js 区段标记缺失');
  process.exit(1);
}
const CANONICAL_BLOCK = stdSrc.substring(sIdx, eIdx);
console.log('[OK] 提取标准记住用户名层 长度=%d bytes, 含_isGenericUsername=%s, 含实名防护=%s',
  CANONICAL_BLOCK.length,
  CANONICAL_BLOCK.indexOf('_isGenericUsername') >= 0,
  CANONICAL_BLOCK.indexOf('实名防护') >= 0);

// 2. 目标列表（排除 build 产物）
const targets = [
  'shared/auth-core/offline.js',
  'app_project/db-offline/desktop/auth-core.js',
  'app_project/db-offline/desktop/electron/auth-core.js',
  'app_project/db-offline/app/app/src/main/assets/public/auth-core.js',
  'public/auth-core.js',
  'public/electron/auth-core.js',
  'site-admin/auth-core.js',
  'app_project/db-yunduan/cloud_desktop/auth-core.js',
  'site-admin/electron/auth-core.js',
  'app_project/db-yunduan/cloud_desktop/electron/auth-core.js',
  'app_project/db-yunduan/cloud_app/app/src/main/assets/public/auth-core.js',
];

let changedCount = 0, already = 0, skip = 0, fail = 0;
const skipRegex = /[\\/]build[\\/]|mergeReleaseAssets/;

for (const rel of targets) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) {
    console.log('  [SKIP no-exist] ' + rel); skip++; continue;
  }
  if (skipRegex.test(rel)) {
    console.log('  [SKIP build   ] ' + rel); skip++; continue;
  }
  const src = fs.readFileSync(abs, 'utf8');
  const s = src.indexOf(MARKER_START);
  const e = src.indexOf(MARKER_END);
  if (s < 0 || e < 0) {
    console.log('  [FAIL 标记缺失] ' + rel); fail++; continue;
  }
  const newSrc = src.substring(0, s) + CANONICAL_BLOCK + src.substring(e);
  if (newSrc === src) {
    console.log('  [OK 已一致    ] ' + rel); already++;
  } else {
    fs.writeFileSync(abs, newSrc, 'utf8');
    const v = fs.readFileSync(abs, 'utf8');
    const ok = v.indexOf('function _isGenericUsername(candidate)') >= 0
            && v.indexOf('if (!_isGenericUsername(cleanUsername))') >= 0
            && v.indexOf('实名防护') >= 0;
    console.log('  [' + (ok ? 'UPDATED ✓' : 'UPDATED ✗ 验证失败') + '] ' + rel);
    changedCount++;
    if (!ok) fail++;
  }
}

console.log('\n汇总: 更新=%d, 已一致=%d, 跳过=%d, 失败=%d', changedCount, already, skip, fail);
process.exit(fail === 0 ? 0 : 2);
