// 紧急恢复：isDebuggerAttached 的 E2E 旁路（ca5ae735 修复被 22ee942c 自动同步覆盖）
// 同步到全部 5 副本（含 shared 权威源，防止再次被自动同步冲掉）
const fs = require('fs');

const FILES = [
    'shared/license/license-manager.js',
    'app_project/db-offline/desktop/electron/license-manager.js',
    'app_project/db-offline/desktop/license/license-manager.js',
    'app_project/db-yunduan/cloud_desktop/electron/license-manager.js',
    'app_project/db-offline/app/app/src/main/assets/public/license/license-manager.js'
];

const OLD = `function isDebuggerAttached() {
    try {
        // 仅在打包后启用检测（开发模式下跳过，避免误报）
        if (!app.isPackaged) return false;`;

const NEW = `function isDebuggerAttached() {
    try {
        // ★ E2E 旁路（2026-08-22 恢复：原 ca5ae735 修复被 22ee942c 自动同步覆盖丢失）：
        //   构建管线 e2e 双条件（BNZC_E2E=1 环境变量 + exe 同级 marker，main.js 已校验置位）
        //   放行调试参数；生产环境无 marker，检测保持 100% 生效。
        if (global.__BNZC_E2E_BYPASS === true) return false;
        // 仅在打包后启用检测（开发模式下跳过，避免误报）
        if (!app.isPackaged) return false;`;

let fail = 0;
for (const f of FILES) {
    let s;
    try { s = fs.readFileSync(f, 'utf8'); }
    catch (e) { console.log('[MISS] ' + f); fail++; continue; }

    if (s.includes('__BNZC_E2E_BYPASS === true')) { console.log('[SKIP-ALREADY] ' + f); continue; }

    const c = s.split(OLD).length - 1;
    if (c !== 1) { console.log('[SKIP] ' + f + ' (命中=' + c + ')'); fail++; continue; }

    fs.writeFileSync(f, s.replace(OLD, NEW), 'utf8');
    console.log('[OK]   ' + f);
}

if (fail) { console.log('FAILED: ' + fail); process.exit(1); }
console.log('ALL 5 PATCHED');
