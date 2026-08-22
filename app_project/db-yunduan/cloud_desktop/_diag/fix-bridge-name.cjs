// 临时修正脚本：桥名 license.show → activate.show（preload 实际结构是 electronAPI.activate.show）
const fs = require('fs');

const FILES = [
    'shared/auth-core/cloud.js',
    'shared/auth-core/offline.js',
    'shared/auth-core.js',
    'public/auth-core.js',
    'public/electron/auth-core.js',
    'site-admin/auth-core.js',
    'site-admin/electron/auth-core.js',
    'app_project/db-yunduan/cloud_desktop/auth-core.js',
    'app_project/db-yunduan/cloud_desktop/electron/auth-core.js',
    'app_project/db-yunduan/cloud_app/app/src/main/assets/public/auth-core.js',
    'app_project/db-offline/desktop/auth-core.js',
    'app_project/db-offline/desktop/electron/auth-core.js',
    'app_project/db-offline/app/app/src/main/assets/public/auth-core.js'
];

const OLD = `                    if (global.electronAPI && global.electronAPI.license &&
                        typeof global.electronAPI.license.show === 'function') {
                        try { global.electronAPI.license.show(); return; } catch (eBridge) { /* 桥接异常，落回DOM弹窗 */ }
                    }`;

const NEW = `                    if (global.electronAPI && global.electronAPI.activate &&
                        typeof global.electronAPI.activate.show === 'function') {
                        try { global.electronAPI.activate.show(); return; } catch (eBridge) { /* 桥接异常，落回DOM弹窗 */ }
                    }`;

let fail = 0;
for (const f of FILES) {
    let s;
    try { s = fs.readFileSync(f, 'utf8'); }
    catch (e) { console.log('[MISS] ' + f); fail++; continue; }

    if (s.includes(NEW)) { console.log('[SKIP-ALREADY] ' + f); continue; }

    const c = s.split(OLD).length - 1;
    if (c !== 1) {
        console.log('[SKIP] ' + f + ' (old命中=' + c + ') — 需人工检查');
        fail++;
        continue;
    }
    s = s.replace(OLD, NEW);
    fs.writeFileSync(f, s, 'utf8');
    console.log('[OK]   ' + f);
}

if (fail) { console.log('FAILED: ' + fail); process.exit(1); }
console.log('ALL 13 FIXED');
