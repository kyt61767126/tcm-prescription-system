const fs = require('fs');
const base = fs.readFileSync('shared/auth-core.js', 'utf8');
const files = [
  'shared/auth-core/cloud.js', 'public/auth-core.js',
  'app_project/db-yunduan/cloud_desktop/auth-core.js',
  'app_project/db-yunduan/cloud_desktop/electron/auth-core.js',
  'site-admin/auth-core.js', 'public/electron/auth-core.js',
  'site-admin/electron/auth-core.js',
  'app_project/db-yunduan/cloud_app/app/src/main/assets/public/auth-core.js'
];
files.forEach(f => {
  try {
    const d = fs.readFileSync(f, 'utf8');
    const eq = d.length === base.length;
    console.log((eq ? 'SAME' : 'DIFF'), f, 'len=' + d.length);
  } catch (e) { console.log('MISS', f); }
});
console.log('---OFFLINE---');
const base2 = fs.readFileSync('shared/auth-core/offline.js', 'utf8');
const files2 = [
  'app_project/db-offline/desktop/auth-core.js',
  'app_project/db-offline/desktop/electron/auth-core.js',
  'app_project/db-offline/app/app/src/main/assets/public/auth-core.js'
];
files2.forEach(f => {
  try {
    const d = fs.readFileSync(f, 'utf8');
    const eq = d.length === base2.length;
    console.log((eq ? 'SAME' : 'DIFF'), f, 'len=' + d.length);
  } catch (e) { console.log('MISS', f); }
});
