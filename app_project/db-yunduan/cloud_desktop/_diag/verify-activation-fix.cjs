// 临时验证：①语法校验全部改动文件 ②12副本修改片段与权威源逐字节一致
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..', '..', '..');

const CHANGED = [
    'shared/auth-core/cloud.js',
    'shared/auth-core.js',
    'shared/auth-core/offline.js',
    'public/auth-core.js',
    'public/electron/auth-core.js',
    'site-admin/auth-core.js',
    'site-admin/electron/auth-core.js',
    'app_project/db-yunduan/cloud_desktop/auth-core.js',
    'app_project/db-yunduan/cloud_desktop/electron/auth-core.js',
    'app_project/db-yunduan/cloud_app/app/src/main/assets/public/auth-core.js',
    'app_project/db-offline/desktop/auth-core.js',
    'app_project/db-offline/desktop/electron/auth-core.js',
    'app_project/db-offline/app/app/src/main/assets/public/auth-core.js',
    'app_project/db-yunduan/cloud_desktop/electron/login.js',
    'app_project/db-yunduan/cloud_desktop/electron/activate.js',
    'app_project/db-offline/desktop/electron/activate.js'
];

let fail = 0;

// ① 语法校验（new Function 粗校验：auth-core/login 为渲染进程脚本，含 window 引用但语法层面可解析）
for (const f of CHANGED) {
    const code = fs.readFileSync(path.join(ROOT, f), 'utf8');
    try {
        new Function(code);
        console.log('[SYNTAX OK] ' + f);
    } catch (e) {
        console.log('[SYNTAX FAIL] ' + f + ' → ' + e.message);
        fail++;
    }
}

// ② 修改片段一致性：云端 8 副本 vs shared/auth-core/cloud.js；离线 4 副本 vs shared/auth-core/offline.js
function extractOnAdminActivated(src) {
    const start = src.indexOf('async function onAdminActivated(r, requestId) {');
    if (start < 0) return null;
    let i = src.indexOf('{', start), depth = 0;
    while (i < src.length) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') { depth--; if (depth === 0) break; }
        i++;
    }
    return src.slice(start, i + 1);
}

const cloudRef = extractOnAdminActivated(fs.readFileSync(path.join(ROOT, 'shared/auth-core/cloud.js'), 'utf8'));
const offlineRef = extractOnAdminActivated(fs.readFileSync(path.join(ROOT, 'shared/auth-core/offline.js'), 'utf8'));

const CLOUD_COPIES = [
    'shared/auth-core.js', 'public/auth-core.js', 'public/electron/auth-core.js',
    'site-admin/auth-core.js', 'site-admin/electron/auth-core.js',
    'app_project/db-yunduan/cloud_desktop/auth-core.js',
    'app_project/db-yunduan/cloud_desktop/electron/auth-core.js',
    'app_project/db-yunduan/cloud_app/app/src/main/assets/public/auth-core.js'
];
const OFFLINE_COPIES = [
    'app_project/db-offline/desktop/auth-core.js',
    'app_project/db-offline/desktop/electron/auth-core.js',
    'app_project/db-offline/app/app/src/main/assets/public/auth-core.js'
];

for (const f of CLOUD_COPIES) {
    const seg = extractOnAdminActivated(fs.readFileSync(path.join(ROOT, f), 'utf8'));
    console.log(seg === cloudRef ? '[SEG  OK] ' + f : '[SEG  DIFF] ' + f);
    if (seg !== cloudRef) fail++;
}
for (const f of OFFLINE_COPIES) {
    const seg = extractOnAdminActivated(fs.readFileSync(path.join(ROOT, f), 'utf8'));
    console.log(seg === offlineRef ? '[SEG  OK] ' + f : '[SEG  DIFF] ' + f);
    if (seg !== offlineRef) fail++;
}

if (fail) { console.log('VERIFY FAILED: ' + fail); process.exit(1); }
console.log('ALL VERIFY PASS');
