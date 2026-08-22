// 临时同步脚本：将"基础设置→管理员激活"入口分流修复同步到 11 个 auth-core 副本
// 用完可删；改动模式与两个权威源（cloud.js/offline.js）手工修改逐字节一致
const fs = require('fs');

const FILES = [
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

const PATCH_OLD = `                adminBtn.addEventListener('click', function () {
                    try { closeModal('settingsModal'); } catch (e) { }
                    if (typeof global.openAdminActivate === 'function') {
                        global.openAdminActivate();
                    } else if (typeof global.activateNow === 'function') {
                        global.activateNow();
                    }
                });`;

const PATCH_NEW = `                adminBtn.addEventListener('click', function () {
                    try { closeModal('settingsModal'); } catch (e) { }
                    // ★ 2026-08-22 修复入口分流缺陷：桌面版优先打开主进程完整激活窗口
                    //   （版本选择 + 管理员激活/激活码激活/工单申请 三Tab），否则已登录
                    //   用户从基础设置永远到不了工单/激活码Tab；无主进程桥（云端网页/APP）
                    //   走本模块 DOM 弹窗兜底。
                    if (global.electronAPI && global.electronAPI.license &&
                        typeof global.electronAPI.license.show === 'function') {
                        try { global.electronAPI.license.show(); return; } catch (eBridge) { /* 桥接异常，落回DOM弹窗 */ }
                    }
                    if (typeof global.openAdminActivate === 'function') {
                        global.openAdminActivate();
                    } else if (typeof global.activateNow === 'function') {
                        global.activateNow();
                    }
                });`;

let fail = 0;
for (const f of FILES) {
    let s;
    try { s = fs.readFileSync(f, 'utf8'); }
    catch (e) { console.log('[MISS] ' + f); fail++; continue; }

    // 幂等：已同步过则跳过
    if (s.includes(PATCH_NEW)) { console.log('[SKIP-ALREADY] ' + f); continue; }

    const c = s.split(PATCH_OLD).length - 1;
    if (c !== 1) {
        console.log('[SKIP] ' + f + ' (old命中=' + c + ') — 需人工检查');
        fail++;
        continue;
    }
    s = s.replace(PATCH_OLD, PATCH_NEW);
    fs.writeFileSync(f, s, 'utf8');
    console.log('[OK]   ' + f);
}

if (fail) { console.log('FAILED: ' + fail + ' 个文件未同步'); process.exit(1); }
console.log('ALL 11 SYNCED');
