const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const files = [
  'shared/auth-core.js',
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
  'app_project/db-offline/desktop/electron/login.js',
  'app_project/db-yunduan/cloud_desktop/electron/login.js',
];

let pass = 0, fail = 0;
for (const rel of files) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) { console.log('[SKIP no-exist] ' + rel); continue; }
  const r = spawnSync('node', ['--check', abs], { encoding: 'utf8' });
  if (r.status === 0) {
    console.log('[OK]  ' + rel); pass++;
  } else {
    console.log('[FAIL] ' + rel);
    console.log('       ' + (r.stderr || r.stdout || '').trim().split('\n').join('\n       '));
    fail++;
  }
}
console.log('\nSyntax check: PASS=' + pass + ' FAIL=' + fail);
process.exit(fail === 0 ? 0 : 1);
