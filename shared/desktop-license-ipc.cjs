// ============================================================================
//  desktop-license-ipc.cjs — License IPC 胶合层（2026-09-25 P2 抽取）
//
//  两端 main.js 的 license:* IPC 注册全部收口于此工厂，消除授权链主进程人肉双改。
//  共 38 个通道（去重）：
//    通用 22（21 个字节同构；submit-activate 有一行注释差异取云端版）；
//    端分叉 3：get-status / can-prescribe / submit-order-direct（两版行为都保留，
//      按 productClass 选择）；
//    仅云端 1：load-pending-order-no；
//    仅离线 12：verify-gate / gate-failed / install-admin-license /
//      query-order-status / install-from-server / set-flow-state / get-flow-state /
//      start-trial / claim-free / register-local-user / load-registration-info /
//      get-activation-users。
//
//  ★ 字节取证：handler 体由生成器从改前两份 main.js 切片（非手抄）；唯一机械变换
//    是 mainWindow → getMainWindow()（惰性访问器，与原外层 let mainWindow 同语义，
//    对齐 desktop-windows/desktop-dialog 的 B2-2 访问器范式）。改前大块哈希：
//      cloud L828-1187   d22ffd0537de1937eae6eddd3426aa2d562179f80a39cd061e730b80d4311699
//      local L1043-1502  27e7ae79d882c567f7cfd47a3c214078460880a276f9d329e8cb877f811a0de8
//      local L2011-2168  6f18ca7957a58d04e41388fc7b4c876b7ba05c02dcd3ee0036a209dce2feb9a7
//
//  依赖注入：
//    通用：ipcMain / app,dialog,BrowserWindow / licenseManager,activateManager,
//          prescriptionCounter,featureGuard / getMainWindow / productClass；
//    仅离线：isTrialDenied / fse,safeStorage,path,getWritableConfigPath,hashPassword
//    （后 5 个仅注册块使用；hashPassword 等为 main.js 函数声明，提升后可在块1位点注入）。
//  模块本体零 require（handler 内原有内联 require('electron')/require('fs') 保持原样；
//  F3 帧门函数内惰性 require('path')/require('url') 为第四轮 B-重1 新增，仅白名单比对用）。
//
//  分发：shared/ → sync-all Group 22 → 2 个 electron 目录；
//    copy-consistency desktop-license-ipc 组（2 副本硬哈希门）。
//  铁律：改 license IPC 只改本文件，禁止再改两份 main.js 内嵌副本。
//  注意：主进程域热更不可达，改动需双桌面重打 exe（可攒一批一起发）。
//  安全：set-trial-days IPC 故意不注册（P2-7：渲染进程不得修改试用期天数）。
// ============================================================================
'use strict';

// ★ 2026-09-26 F3+M1：register-local-user 唯一合法来源 = activate-window.html
//   的顶层帧（无 iframe）。Electron 35 WebFrameMain 无 isMainFrame 成员，
//   主框架判定 = parent===null（真实 Electron 探针实证）。
// ★ 第四轮（B-重1）：URL 白名单从"文件名正则"收紧为【应用自身目录绝对路径全等】
//   ——正则可被任意目录下同名文件绕过（下载目录/UNC/映射盘投放同名 html）；
//   绝对路径全等后，只有本安装内（asar 或解包目录）的激活窗页面能过门。
//   仅比对 host+pathname：query/hash 不参与（loadFile 会附 machineId 等 query，
//   冒烟 qEvent 用例锁定该语义）。
// ★ 第五轮（采纳）：host 同校验——file: URL 的 host 承载 UNC 主机名
//   （file://evil/share/activate-window.html 的 pathname 与本地同构），仅比
//   pathname 会放过异地主机投放的同构目录；host 必须与本机 expected 一致（本地
//   file URL host 为空串）。
//   目录/文件路径必须与激活窗页面完全一致。
//   parent/url 均为主进程原生只读属性，渲染侧不可伪造。本文件由 sync-all 复制进
//   两端 electron 目录运行，__dirname 即激活窗页面所在目录。
function isActivateWindowFrame(frame) {
    try {
        if (!frame || frame.parent !== null) return false;
        const u = new URL(frame.url || '');
        if (u.protocol !== 'file:') return false;
        const path = require('path');
        const pathToFileURL = require('url').pathToFileURL;
        const expectedUrl = pathToFileURL(path.join(__dirname, 'activate-window.html'));
        if (u.host !== expectedUrl.host) return false;
        // Windows 文件系统大小写不敏感：两侧解码后归一小写比较，仅放宽大小写不放宽路径
        return decodeURIComponent(u.pathname).toLowerCase()
            === decodeURIComponent(expectedUrl.pathname).toLowerCase();
    } catch (e) { return false; }
}

function createDesktopLicenseIpc(options) {
    const {
        ipcMain,
        app, dialog, BrowserWindow,
        licenseManager, activateManager, prescriptionCounter, featureGuard,
        getMainWindow,
        productClass,                                      // 'cloud' | 'offline'
        isTrialDenied,                                     // 仅离线
        fse, safeStorage, path, getWritableConfigPath, hashPassword  // 仅离线（注册块）
    } = options;

    // —— get-status（端分叉）——
    if (productClass === 'cloud') {
ipcMain.handle('license:get-status', () => {
    // ★ P1修复：云端桌面版无试用期，改用 readLicense 判断，不再调用 validateLicense
    // 原逻辑：validateLicense() 在无 license 时会创建 trial.dat 并返回 {valid:true,type:'trial'}，
    // 导致云端桌面版（无试用设计）在边界场景（关闭激活窗口后）被间接触发试用状态。
    try {
        const localMachineId = activateManager.getMachineId();
        const lic = licenseManager.readLicense(localMachineId);
        if (!lic) {
            return { valid: false, licenseType: 'none', message: '请激活后使用' };
        }
        // 计算剩余天数
        let remainingDays = -1;  // -1 表示永久授权
        if (lic.expiresAt) {
            const exp = new Date(lic.expiresAt);
            remainingDays = Math.ceil((exp - new Date()) / (24 * 60 * 60 * 1000));
            if (remainingDays < 0) remainingDays = 0;
        }
        return {
            valid: true,
            licenseType: lic.type || 'licensed',
            remainingDays,
            message: '已激活'
        };
    } catch (e) {
        console.error('[IPC] get-status 异常:', e);
        return { valid: false, licenseType: 'none', message: '激活信息异常' };
    }
});
    } else {
ipcMain.handle('license:get-status', () => {
    // ★ v3 新增：传入 localMachineId 用于绑定校验
    try {
        const localMachineId = activateManager.getMachineId();
        return licenseManager.validateLicense({ localMachineId });
    } catch (e) {
        return licenseManager.validateLicense();
    }
});
    }

ipcMain.handle('license:activate', (event, base64Content) => {
    try {
        const localMachineId = activateManager.getMachineId();
        // ★ 统一安装（一行搞定：写license+清trial+同步config）
        const result = licenseManager.installLicense(base64Content, {
            machineId: localMachineId
        });
        if (result.success) {
            const validate = licenseManager.validateLicense({ localMachineId });
            return { success: true, status: validate };
        }
        return { success: false, error: result.error };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('license:select-offline-file', async (event) => {
    try {
        const win = BrowserWindow.fromWebContents(event.sender) || getMainWindow();
        const result = await dialog.showOpenDialog(win, {
            title: '选择离线激活文件',
            defaultPath: app.getPath('downloads'),
            filters: [
                { name: 'License 文件', extensions: ['dat', 'lic', 'txt'] },
                { name: '所有文件', extensions: ['*'] }
            ],
            properties: ['openFile']
        });
        if (result.canceled || result.filePaths.length === 0) {
            return { success: false, cancelled: true };
        }
        const filePath = result.filePaths[0];
        const fsSync = require('fs');
        const content = fsSync.readFileSync(filePath, 'utf8');
        // 去除可能的空白字符和换行（确保 base64 解析正常）
        const trimmed = content.trim();
        return { success: true, filePath: filePath, base64Content: trimmed };
    } catch (e) {
        console.error('[IPC] select-offline-file 异常:', e);
        return { success: false, error: e.message };
    }
});

    // —— can-prescribe（端分叉：离线多试用到期只读前置）——
    if (productClass === 'cloud') {
ipcMain.handle('license:can-prescribe', () => {
    try {
        return prescriptionCounter.canPrescribe();
    } catch (e) {
        console.error('[IPC] can-prescribe 异常:', e);
        return { allowed: false, current: 0, max: 30, remaining: 0, error: '处方数校验异常，请重启软件' };
    }
});
    } else {
ipcMain.handle('license:can-prescribe', () => {
    try {
        // ★ 2026-09-05 试用到期只读模式：license 无效且属试用到期族（trial_expired/
        //   trial_limit_reached）→ 原生层直接禁开方（只读模式放行查看但不可保存，
        //   与渲染层 savePrescription 守卫双保险）。试用超限标记（isTrialDenied）一并
        //   拦截——validateLicense 本身不读该标记（trial.dat 可能仍显示有效）。
        //   校验异常不扩大拦截面，回落原计数逻辑（启动闸已拦截异常态）。
        try {
            const __mid = activateManager.getMachineId();
            const __lic = licenseManager.validateLicense({ localMachineId: __mid });
            if (__lic && !__lic.valid) {
                const __roType = __lic.type || '';
                if (__roType === 'trial_expired' || __roType === 'trial_limit_reached' ||
                    (typeof isTrialDenied === 'function' && isTrialDenied())) {
                    return { allowed: false, current: 0, max: -1, remaining: 0, readOnly: true };
                }
            }
        } catch (ve) { /* 试用状态检查异常，回落计数逻辑 */ }
        return prescriptionCounter.canPrescribe();
    } catch (e) {
        console.error('[IPC] can-prescribe 异常:', e);
        return { allowed: false, current: 0, max: 30, remaining: 0, error: '处方数校验异常，请重启软件' };
    }
});
    }

ipcMain.handle('license:increment-prescription', () => {
    try {
        const newCount = prescriptionCounter.increment();
        return { success: true, count: newCount };
    } catch (e) {
        console.error('[IPC] increment-prescription 异常:', e);
        return { success: false, error: e.message };
    }
});

ipcMain.handle('license:decrement-prescription', () => {
    try {
        const newCount = prescriptionCounter.decrement();
        return { success: true, count: newCount };
    } catch (e) {
        console.error('[IPC] decrement-prescription 异常:', e);
        return { success: false, error: e.message };
    }
});

ipcMain.handle('license:get-prescription-status', () => {
    try {
        return prescriptionCounter.getStatus();
    } catch (e) {
        console.error('[IPC] get-prescription-status 异常:', e);
        // ★ 第三轮终检 P1 修复：max:0 在 UI 表示"无限"，异常时按试用限制显示（fail-closed）
        return { current: 0, max: 30, remaining: 30, licenseType: 'trial', month: '' };
    }
});

ipcMain.handle('license:check-feature', (event, featureName) => {
    try {
        return featureGuard.checkFeature(featureName);
    } catch (e) {
        console.error('[IPC] check-feature 异常:', e);
        // ★ 第三轮终检 P1 修复：授权执行点异常时拒绝（fail-closed）
        return { allowed: false, message: '功能校验异常，请重启软件后再试', feature: featureName };
    }
});

ipcMain.handle('license:get-feature-status', () => {
    try {
        return featureGuard.getFeatureStatus();
    } catch (e) {
        console.error('[IPC] get-feature-status 异常:', e);
        return [];
    }
});

ipcMain.handle('license:show-expire-alert', async (event, message) => {
    try {
        return await activateManager.showExpireAlertAndActivate(getMainWindow(), message);
    } catch (e) {
        console.error('[IPC] show-expire-alert 异常:', e);
        // 出错时尝试单独弹激活窗口（兜底放行，避免阻塞用户）
        try { activateManager.showActivateWindow(getMainWindow()); } catch (e2) {
            console.error('[IPC] showActivateWindow 也失败:', e2);
        }
        return { success: false, error: String(e) };
    }
});

ipcMain.handle('license:show-activate', () => {
    try {
        activateManager.showActivateWindow(getMainWindow());
    } catch (e) {
        console.error('[IPC] show-activate 异常:', e);
    }
});

ipcMain.handle('license:submit-activate', async (event, code, user, clinicName, phone, password, edition, inviteCode) => {
    try {
        const machineId = activateManager.getMachineId();
        // ★ v3 新增：透传 clinicName 给云端做绑定校验
        // ★ P1优化：增加phone/password参数，激活码激活也自动创建管理员账户
        // ★ 2026-09-05 推广奖励：透传inviteCode（选填，好友邀请码）
        const result = await activateManager.activateOnline(code, machineId, user, clinicName, phone, password, edition, inviteCode);
        // ★ v4 新增：激活成功后弹窗显示"已绑定 X/N 台设备"
        if (result && result.success && result.licenseInfo) {
            const info = result.licenseInfo;
            const maxDevices = info.maxDevices || 1;
            const devicesCount = info.devicesCount || 1;
            // 多设备授权时显示配额信息（单设备时不显示，保持原行为）
            if (maxDevices > 1) {
                const { dialog } = require('electron');
                dialog.showMessageBoxSync(getMainWindow(), {
                    type: 'info',
                    title: '激活成功',
                    message: `激活成功！\n已绑定 ${devicesCount}/${maxDevices} 台设备`,
                    detail: `剩余可用设备数：${maxDevices - devicesCount} 台\n如需解绑旧设备，请联系管理员。`,
                    buttons: ['确定'],
                    defaultId: 0
                });
            }
        }
        return result;
    } catch (e) {
        console.error('[IPC] submit-activate 异常:', e);
        return { success: false, error: e.message };
    }
});

ipcMain.handle('license:close-activate', () => {
    try {
        activateManager.closeActivateWindow();
    } catch (e) {
        console.error('[IPC] close-activate 异常:', e);
    }
});

ipcMain.handle('license:restart', () => {
    try {
        activateManager.restartApp();
    } catch (e) {
        console.error('[IPC] restart 异常:', e);
    }
});

ipcMain.handle('license:get-machine-id', () => {
    try {
        return activateManager.getMachineId();
    } catch (e) {
        console.error('[IPC] get-machine-id 异常:', e);
        return null;
    }
});

ipcMain.handle('license:query-invite', async (event, data) => {
    try {
        return await activateManager.queryInvite(data);
    } catch (e) {
        console.error('[IPC] query-invite 异常:', e);
        return { success: false, error: e && e.message };
    }
});

ipcMain.handle('license:submit-admin-request', async (event, data) => {
    try {
        const result = await activateManager.submitAdminRequest(data);
        return result;
    } catch (e) {
        console.error('[IPC] submit-admin-request 异常:', e);
        return { success: false, error: e.message };
    }
});

    // —— submit-order-direct（端分叉）——
    if (productClass === 'cloud') {
ipcMain.handle('license:submit-order-direct', async (event, payload) => {
    try {
        const result = await activateManager.submitOrderDirect(payload);
        return result;
    } catch (e) {
        console.error('[IPC] submit-order-direct 异常:', e);
        return { success: false, error: e.message };
    }
});
    } else {
ipcMain.handle('license:submit-order-direct', async (event, payload) => {
    try {
        return await activateManager.submitOrderDirect(payload || {});
    } catch (e) {
        console.error('[IPC] submit-order-direct 异常:', e);
        return { success: false, error: e && e.message };
    }
});
    }

    // —— 仅云端 ——
    if (productClass === 'cloud') {
ipcMain.handle('license:load-pending-order-no', async () => {
    try {
        return activateManager.loadPendingOrderNo();
    } catch (e) {
        console.error('[IPC] load-pending-order-no 异常:', e);
        return null;
    }
});
    }

ipcMain.handle('license:submit-ticket', async (event, payload) => {
    try {
        if (!licenseManager || typeof licenseManager.submitActivationTicket !== 'function') {
            return { success: false, error: '工单模块不可用' };
        }
        const result = await licenseManager.submitActivationTicket(payload);
        return result;
    } catch (e) {
        console.error('[IPC] submit-ticket 异常:', e);
        return { success: false, error: e && e.message ? e.message : '提交工单失败' };
    }
});

ipcMain.handle('license:check-admin-status', async (event, requestId, machineId) => {
    try {
        const result = await activateManager.checkAdminStatus(requestId, machineId);
        return result;
    } catch (e) {
        console.error('[IPC] check-admin-status 异常:', e);
        return { success: false, error: e.message };
    }
});

ipcMain.handle('license:save-license', async (event, licenseBase64) => {
    try {
        const result = await activateManager.saveLicense(licenseBase64);
        return result;
    } catch (e) {
        console.error('[IPC] save-license 异常:', e);
        return { success: false, error: e.message };
    }
});

ipcMain.handle('license:cancel-admin-request', async (event, requestId) => {
    try {
        const result = await activateManager.cancelAdminRequest(requestId);
        // ★ 取消后清除本地 requestId
        activateManager.clearAdminRequestId();
        return result;
    } catch (e) {
        console.error('[IPC] cancel-admin-request 异常:', e);
        return { success: false, error: e.message };
    }
});

ipcMain.handle('license:load-admin-request-id', async () => {
    try {
        return activateManager.loadAdminRequestId();
    } catch (e) {
        console.error('[IPC] load-admin-request-id 异常:', e);
        return null;
    }
});

ipcMain.handle('license:clear-admin-request-id', async () => {
    try {
        activateManager.clearAdminRequestId();
        return { success: true };
    } catch (e) {
        console.error('[IPC] clear-admin-request-id 异常:', e);
        return { success: false, error: e.message };
    }
});

ipcMain.handle('license:get-trial-days', () => {
    try {
        return { success: true, trialDays: licenseManager.getTrialDays() };
    } catch (e) {
        return { success: false, trialDays: 7, error: String(e) };
    }
});

// ★ license:set-trial-days 故意不注册（P2-7 安全修复：渲染进程不得任意修改试用期天数；
//   调试试用期请在主进程直接调用 licenseManager.setTrialDays()）。

    // —— 仅离线 ——
    if (productClass === 'offline') {
ipcMain.handle('license:verify-gate', async (_event, username) => {
    try {
        return await licenseManager.verifyLoginGate(username);
    } catch (e) {
        console.error('[IPC] verify-gate 异常:', e);
        return { ok: false, message: '授权校验异常，请重试或联系客服' };
    }
});

ipcMain.handle('license:gate-failed', async (event, message) => {
    try {
        if (getMainWindow() && !getMainWindow().isDestroyed()) getMainWindow().hide();
        return await activateManager.showExpireAlertAndActivate(getMainWindow(), message);
    } catch (e) {
        console.error('[IPC] gate-failed 异常:', e);
        // ★ 中-4：绝不重新 show 主窗（旧码 catch 里 show = fail-open）。
        //   保持隐藏，延时 1s 重弹一次；再失败则退出（未授权内容不得可见）。
        setTimeout(() => {
            try {
                if (getMainWindow() && !getMainWindow().isDestroyed()) getMainWindow().hide();
                activateManager.showExpireAlertAndActivate(getMainWindow(), message);
            } catch (e2) {
                console.error('[IPC] gate-failed 重试仍失败，退出:', e2);
                try { app.quit(); } catch (e3) {}
            }
        }, 1000);
        return { success: false, error: String(e) };
    }
});

ipcMain.handle('license:install-admin-license', async (event, args) => {
    try {
        // ★ 2026-09-05 E2E 隔离守卫：E2E 用 BNZC_E2E_DATA 临时 userData 构造出厂态/试用态，
        //   但开发机自身在授权服务器可能有激活记录（实测本机记录"离标脑"已 activated）——
        //   登录页 auth-core 存量自愈 heal 会查 admin-status 命中后把真实 license.dat +
        //   管理员账号写进 E2E 临时目录，污染 E6 出厂态（__isDeviceLicensed=true → 注册
        //   入口不注入 → 25s 超时失败）。E2E 旁路模式下拒绝落盘，保持用例状态确定性。
        if (global.__BNZC_E2E_BYPASS === true) {
            console.warn('[E2E] install-admin-license 已拦截（出厂态与生产授权记录隔离）');
            return { success: false, error: 'E2E bypass: install-admin-license blocked' };
        }
        return await activateManager.installAdminLicenseDesktop(args || {});
    } catch (e) {
        console.error('[IPC] install-admin-license 异常:', e);
        return { success: false, error: e && e.message };
    }
});

ipcMain.handle('license:query-order-status', async (event, orderNo, phone) => {
    try {
        return await activateManager.queryOrderStatus(orderNo, phone);
    } catch (e) {
        console.error('[IPC] query-order-status 异常:', e);
        return { success: false, error: e && e.message };
    }
});

ipcMain.handle('license:install-from-server', async (event, machineId) => {
    try {
        if (global.__BNZC_E2E_BYPASS === true) {
            return { success: false, error: 'E2E bypass: install-from-server blocked' };
        }
        return await activateManager.installLicenseFromServer(machineId);
    } catch (e) {
        console.error('[IPC] install-from-server 异常:', e);
        return { success: false, error: e && e.message };
    }
});

ipcMain.handle('license:set-flow-state', async (event, state) => {
    try {
        return await activateManager.setActivationFlowState(state);
    } catch (e) {
        console.error('[IPC] set-flow-state 异常:', e);
        return { success: false, error: e && e.message };
    }
});

ipcMain.handle('license:get-flow-state', async () => {
    try {
        return await activateManager.getActivationFlowState();
    } catch (e) {
        console.error('[IPC] get-flow-state 异常:', e);
        return { success: true, state: {} };
    }
});

ipcMain.handle('license:start-trial', () => {
    try {
        return activateManager.startTrial();
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('license:claim-free', async (event, phone) => {
    try {
        const machineId = activateManager.getMachineId();
        return await activateManager.claimFreeOnline(machineId, phone);
    } catch (e) {
        console.error('[IPC] claim-free 异常:', e);
        return { success: false, error: e.message };
    }
});

ipcMain.handle('license:register-local-user', async (event, payload) => {
    try {
        // ★ 2026-09-26 F3+M1：仅 activate-window.html 顶层帧可调（见 isActivateWindowFrame）
        if (!isActivateWindowFrame(event && event.senderFrame)) {
            console.warn('[Register] reject non-main-frame/non-activate-window invoke');
            return { success: false, error: '非法调用来源' };
        }
        const p = payload || {};
        const effPhone = String(p.phone || '').trim();
        const effPwd = String(p.password || '');
        const effClinic = String(p.clinicName || '').trim();
        const effAdmin = String(p.adminName || p.doctorName || '').trim();

        // 校验（与 APP Java LicenseManager.registerLocalUser / auth-core 注册弹窗规则一致）
        if (!/^1[3-9]\d{9}$/.test(effPhone)) {
            return { success: false, error: '请输入正确的11位手机号' };
        }
        if (effPwd.length < 8 || effPwd === 'admin' ||
            !/[a-zA-Z]/.test(effPwd) || !/[0-9]/.test(effPwd)) {
            return { success: false, error: '密码至少8位且须同时包含字母和数字' };
        }

        // ★ 2026-09-26 H1/B1 + 复审 TOCTOU 收口：config 只读一次，闸门直接裁决
        //   内存件（不二次读盘）——外部进程无法在闸门后替换 config 让异件被签。
        const configPath = getWritableConfigPath();
        let config = {};
        if (await fse.pathExists(configPath)) {
            config = await fse.readJson(configPath);
        }
        if (!Array.isArray(config.users)) config.users = [];
        if (!licenseManager.configUsersProvenAuthentic(config)) {
            console.warn('[Register] 中止：磁盘现存 users 无真实签发来源');
            return { success: false, error: '检测到本地配置被篡改，注册已中止，请联系客服' };
        }

        // UPSERT 手机号账号（username=手机号；重复注册=用户明确重设密码）
        const { passwordHash, salt } = await hashPassword(effPwd);
        // 时间戳用数字毫秒（与 APP Java 端 System.currentTimeMillis() 一致，
        // auth-core 启动自愈镜像按 typeof === 'number' 读取做 keepLocalPwd 时间戳排序）
        const now = Date.now();
        let existed = false;
        for (let i = 0; i < config.users.length; i++) {
            const u = config.users[i];
            if (u && String(u.username || '') === effPhone) {
                u.phone = effPhone;
                u.password = passwordHash;
                u.passwordHash = passwordHash;
                u.salt = salt;
                u.name = effAdmin || u.name || effPhone;
                u.role = 'admin';
                u.lastPwdUpdatedAt = now;
                u.updatedAt = now;
                existed = true;
            }
        }
        if (!existed) {
            config.users.push({
                username: effPhone,
                phone: effPhone,
                password: passwordHash,
                passwordHash: passwordHash,
                salt: salt,
                name: effAdmin || effPhone,
                role: 'admin',
                registeredAt: now,
                lastPwdUpdatedAt: now,
                createdAt: now,
                updatedAt: now
            });
        }

        // ★ 幽灵默认账户移除：已有手机号账号时，出厂试用 admin（密码仍为原生默认，未被用户改过）一并删除。
        //   保守判定（宁可漏删不可误删）：username==='admin' 且 password 为明文 'admin' 或出厂哈希。
        const { passwordHash: defaultAdminHash } = await hashPassword('admin');
        config.users = config.users.filter(u => {
            if (!u || String(u.username || '') !== 'admin') return true;
            const pw = String(u.password || '');
            if (pw === 'admin' || pw === defaultAdminHash) return false; // 原生默认 → 移除
            return true; // 用户改过密码的真实 admin 账户 → 保留
        });

        // 同步诊所名/管理员名（注册即写入 config，激活时服务端信息与此对齐）
        if (effClinic && config.clinicName !== effClinic) config.clinicName = effClinic;
        if (effAdmin && config.doctorName !== effAdmin) config.doctorName = effAdmin;

        // 签名保护（与 installLicense 同 fail-safe：未生成签名则拒绝写入，保留磁盘旧签名配置）
        licenseManager.signConfig(config);
        if (!config.configSignature) {
            console.error('[Register] signConfig 未生成签名，跳过 config.json 写入');
            return { success: false, error: '配置签名失败，注册未生效，请重试' };
        }
        await fse.writeJson(configPath, config, { spaces: 2 });
        console.log('[Register] 本地注册成功:', effPhone, existed ? '(UPSERT 更新)' : '(新增)',
            'users=' + config.users.length);

        // ★ 2026-09-26 I-4 + 复审陈旧收口：写盘成功立即 proven 刷新 v2 备份
        //   （users 刚过闸门并随有效签名 config 落盘；proven 允许 UPSERT 改字段、
        //   幽灵账号移除条目变少），备份不再滞后/永久陈旧。
        try { licenseManager.backupUserAccounts(config, { proven: true }); } catch (be) {
            console.warn('[Register] 备份刷新失败（非致命）:', be.message);
        }

        // ★ 2026-09-08 注册密码直通（修复 localStorage 跨 session 隔离 bug）：
        //   主窗口 partition='persist:tcm-prescription-dingzhi'，激活窗口 defaultSession，
        //   两窗口 localStorage 物理隔离 → activate-window 读不到 registrationInfo。
        //   改走主进程：①safeStorage(DPAPI) 加密密码落盘 userData/registration-info.json
        //   供激活窗口重启后 IPC 读取；②broadcast 实时通知已开的激活窗口立即刷新直通按钮。
        try {
            let pwdEnc = '';
            if (safeStorage.isEncryptionAvailable()) {
                const buf = safeStorage.encryptString(effPwd);
                if (buf && buf.length) pwdEnc = buf.toString('base64');
            }
            const regInfoPath = path.join(app.getPath('userData'), 'registration-info.json');
            const regInfo = {
                phone: effPhone,
                clinicName: effClinic,
                adminName: effAdmin,
                passwordEnc: pwdEnc, // 空=safeStorage 不可用（激活窗口回退默认流程）
                at: now
            };
            await fse.writeJson(regInfoPath, regInfo, { spaces: 2 });
            // 广播到所有已开窗口（含注册前自动弹出的 activate-window）
            const { webContents } = require('electron');
            for (const wc of webContents.getAllWebContents()) {
                try { wc.send('registration:updated', regInfo); } catch (e2) {}
            }
        } catch (re) { console.warn('[Register] 注册信息直通落盘失败(不影响注册):', re.message); }

        return { success: true, users: config.users };
    } catch (e) {
        console.error('[Register] register-local-user 异常:', e);
        return { success: false, error: String(e && e.message ? e.message : e) };
    }
});

ipcMain.handle('license:load-registration-info', async () => {
    try {
        const regInfoPath = path.join(app.getPath('userData'), 'registration-info.json');
        if (!(await fse.pathExists(regInfoPath))) return { success: true, info: null };
        const info = await fse.readJson(regInfoPath);
        return { success: true, info: (info && info.phone) ? info : null };
    } catch (e) {
        return { success: true, info: null };
    }
});

ipcMain.handle('license:get-activation-users', async () => {
    try {
        const configPath = getWritableConfigPath();
        let config = {};
        if (await fse.pathExists(configPath)) {
            config = await fse.readJson(configPath);
        }
        // ★ 2026-09-06 第七轮修复：补 config 顶层诊所名/医师名（对齐 APP Java
        //   getActivationUsers），激活弹窗桥兜底预填诊所名不再依赖 WebView CONFIG 旧值
        return {
            success: true,
            users: Array.isArray(config.users) ? config.users : [],
            clinicName: String(config.clinicName || ''),
            doctorName: String(config.doctorName || '')
        };
    } catch (e) {
        console.error('[Register] get-activation-users 异常:', e);
        return { success: false, error: String(e && e.message ? e.message : e), users: [] };
    }
});
    }
}

module.exports = { createDesktopLicenseIpc };
