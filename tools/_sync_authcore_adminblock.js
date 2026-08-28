/* 智能同步：离线型 auth-core 副本的 admin激活后门拦截区段
   权威源：shared/auth-core/offline.js
   区段范围：global.AuditLog = AuditLog; → async function login(...) {
   （包含 helper _blockTrialAdminAfterLicensed + createLocalAdapter/createSingleUserAdapter）
   同步条件：只有目标文件含 createLocalAdapter(getUsersFn) 且 含 '离线登录失败' 才视为离线副本
   云端型副本（结构完全不同，无本地适配器）直接跳过，避免误覆盖。
*/
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const AUTHORITY = path.join(ROOT, 'shared/auth-core/offline.js');
const MARKER_START = 'global.AuditLog = AuditLog;';
const MARKER_END = 'async function login(username, password, options = {}) {';
const OFFLINE_SIG_A = 'function createLocalAdapter(getUsersFn)';
const OFFLINE_SIG_B = "console.error('离线登录失败:'";
const BLOCK_VERIFY_A = '_blockTrialAdminAfterLicensed';
const BLOCK_VERIFY_B = '试用默认账户 admin/admin 已禁用';

const authSrc = fs.readFileSync(AUTHORITY, 'utf8');
const sIdx = authSrc.indexOf(MARKER_START);
const eIdx = authSrc.indexOf(MARKER_END);
if (sIdx < 0 || eIdx < 0 || eIdx <= sIdx) {
  console.error('权威源区段标记缺失 shared/auth-core/offline.js');
  process.exit(1);
}
const CANONICAL = authSrc.substring(sIdx, eIdx);
console.log('[OK] 权威段提取: 长度=%d bytes, 含helper=%s, 含拦截=%s',
  CANONICAL.length,
  CANONICAL.indexOf(BLOCK_VERIFY_A) >= 0,
  CANONICAL.indexOf(BLOCK_VERIFY_B) >= 0);

const targets = [
  // 所有已知 auth-core 副本（含离线型 + 云端型，脚本自动判定）
  'shared/auth-core/offline.js',
  'shared/auth-core.js',
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

const skipRegex = /[\\/]build[\\/]|mergeReleaseAssets/;
let offlineEligible = 0, cloudSkip = 0, updated = 0, already = 0, notExist = 0, fail = 0;

for (const rel of targets) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) { console.log('  [SKIP no-exist] ' + rel); notExist++; continue; }
  if (skipRegex.test(rel)) { console.log('  [SKIP build   ] ' + rel); continue; }
  const src = fs.readFileSync(abs, 'utf8');
  const isOfflineCopy = src.indexOf(OFFLINE_SIG_A) >= 0 && src.indexOf(OFFLINE_SIG_B) >= 0;
  if (!isOfflineCopy) {
    console.log('  [SKIP 云端型  ] ' + rel + ' (无本地离线适配器，跳过同步)');
    cloudSkip++;
    continue;
  }
  offlineEligible++;
  const s = src.indexOf(MARKER_START);
  const e = src.indexOf(MARKER_END);
  if (s < 0 || e < 0) {
    console.log('  [FAIL 标记缺失] ' + rel); fail++; continue;
  }
  const newSrc = src.substring(0, s) + CANONICAL + src.substring(e);
  if (newSrc === src) {
    console.log('  [OK 已一致    ] ' + rel); already++;
  } else {
    fs.writeFileSync(abs, newSrc, 'utf8');
    const v = fs.readFileSync(abs, 'utf8');
    const ok = v.indexOf(BLOCK_VERIFY_A) >= 0 && v.indexOf(BLOCK_VERIFY_B) >= 0;
    console.log('  [' + (ok ? 'UPDATED ✓' : 'UPDATED ✗ 验证失败') + ']  ' + rel);
    updated++;
    if (!ok) fail++;
  }
}
console.log('\n汇总: 离线副本数=%d, 云端跳过=%d, 更新=%d, 已一致=%d, 不存在=%d, 失败=%d',
  offlineEligible, cloudSkip, updated, already, notExist, fail);
process.exit(fail === 0 ? 0 : 2);
