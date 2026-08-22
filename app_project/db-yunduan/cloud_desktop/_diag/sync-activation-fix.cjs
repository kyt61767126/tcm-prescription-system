// 临时同步脚本：将 onAdminActivated 激活标记修复同步到 12 个 auth-core 副本
// 用完可删；改动模式与 shared/auth-core/cloud.js 权威源手工修改逐字节一致
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
    'shared/auth-core/offline.js',
    'app_project/db-offline/desktop/auth-core.js',
    'app_project/db-offline/desktop/electron/auth-core.js',
    'app_project/db-offline/app/app/src/main/assets/public/auth-core.js'
];

const PATCH_A_OLD = `        async function onAdminActivated(r, requestId) {
            const license = r.license || '';`;

const PATCH_A_NEW = `        async function onAdminActivated(r, requestId) {
            // ★ 2026-08-22 修复：激活成功即统一设置标记并隐藏登录框注册入口。
            //   原实现仅"无本地安装桥"分支（云端APP）设置，桌面安装分支（installAdminLicense）
            //   漏设 → 激活成功的桌面设备重启后，登录框"📝 注册开通"按钮重现，误导已开通用户
            //   （新客户A实测：注册→审核→激活→登录全通过，退出登录后注册按钮重现，实锤此漏）。
            //   此调用在 localStorage 写入，配合 restartApp 改 app.quit() 优雅退出确保落盘。
            setCloudActivationDone();
            hideActivateLoginEntry();
            const license = r.license || '';`;

const PATCH_B_OLD = `                document.getElementById('adminSuccessBtn').onclick = function() { cleanup(); };
                // ★ 2026-08-20 激活成功：登录框"软件激活"入口自动隐藏
                setCloudActivationDone();
                hideActivateLoginEntry();`;

const PATCH_B_NEW = `                document.getElementById('adminSuccessBtn').onclick = function() { cleanup(); };
                // ★ 2026-08-22 setCloudActivationDone/hideActivateLoginEntry 已移至本函数开头统一执行`;

let fail = 0;
for (const f of FILES) {
    let s;
    try { s = fs.readFileSync(f, 'utf8'); }
    catch (e) { console.log('[MISS] ' + f); fail++; continue; }

    const ca = s.split(PATCH_A_OLD).length - 1;
    const cb = s.split(PATCH_B_OLD).length - 1;
    if (ca !== 1 || cb !== 1) {
        console.log('[SKIP] ' + f + ' (A命中=' + ca + ', B命中=' + cb + ') — 需人工检查');
        fail++;
        continue;
    }
    s = s.replace(PATCH_A_OLD, PATCH_A_NEW).replace(PATCH_B_OLD, PATCH_B_NEW);
    fs.writeFileSync(f, s, 'utf8');
    console.log('[OK]   ' + f);
}

if (fail) { console.log('FAILED: ' + fail + ' 个文件未同步'); process.exit(1); }
console.log('ALL 12 SYNCED');
