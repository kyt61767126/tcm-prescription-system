// ============================================================================
//  desktop-license-smoke.cjs — license IPC 胶合层 stub 功能冒烟（2026-09-25 P2）
//
//  零依赖：stub ipcMain/electron + 域对象，分别以 productClass cloud/offline
//  各启动一次工厂，验证：
//   1) 注册面（云26/离37，通道集合精确）；
//   2) 端分叉 get-status/can-prescribe/submit-order-direct；
//   3) 关键委托与 fail-closed 异常返回；
//   4) 安全：E2E 旁路双拦截 + set-trial-days 不注册；
//   5) gate-failed catch 路径不 show 主窗、重试再败 app.quit；
//   6) register-local-user 校验/UPSERT/签名门/注册信息直通。
//
//  用法：node tools/desktop-license-smoke.cjs    退出码 0=全过
// ============================================================================
'use strict';
const Module = require('module');
const path = require('path');

let total = 0, failed = 0;
function assert(cond, msg) {
    total++;
    if (cond) return;
    failed++;
    console.error('  ✗ ' + msg);
}

// —— stub 基础设施 ——
function makeIpcMain() {
    const handlers = new Map();
    return {
        handlers,
        handle(ch, fn) {
            if (handlers.has(ch)) throw new Error('重复注册: ' + ch);
            handlers.set(ch, fn);
        }
    };
}

function makeDomainStubs() {
    const calls = [];
    const licenseManager = {
        readLicense: () => null,
        validateLicense: () => ({ valid: true }),
        installLicense: () => ({ success: true }),
        getTrialDays: () => 7,
        verifyLoginGate: async (u) => ({ ok: true, u }),
        submitActivationTicket: async (p) => ({ success: true, p }),
        signConfig(c) { c.configSignature = 'sig-' + (c.users || []).length; },
        configUsersProvenAuthentic: () => true,
        // ★ 2026-09-26 I-4：register 写盘成功后立即刷新 users 备份（防备份滞后）
        backupCalls: [],
        backupUserAccounts(cfg) { this.backupCalls.push(cfg); }
    };
    const activateManager = {
        getMachineId: () => 'mid-1',
        readLicense: () => null,
        queryInvite: async (d) => ({ success: true, d }),
        submitAdminRequest: async (d) => ({ success: true, d }),
        submitOrderDirect: async (p) => ({ success: true, p }),
        loadPendingOrderNo: async () => 'ORD1',
        showExpireAlertAndActivate: async (w, m) => ({ success: true, m }),
        showActivateWindow: () => {},
        closeActivateWindow: () => {},
        restartApp: () => {},
        activateOnline: async (...a) => ({ success: true, args: a }),
        checkAdminStatus: async (r, m) => ({ success: true, r, m }),
        saveLicense: async (b) => ({ success: true, b }),
        cancelAdminRequest: async (r) => ({ success: true, r }),
        clearAdminRequestId: () => { calls.push('clearReq'); },
        loadAdminRequestId: async () => 'REQ1',
        startTrial: () => ({ success: true }),
        claimFreeOnline: async (m, p) => ({ success: true, m, p }),
        installAdminLicenseDesktop: async (a) => ({ success: true, a }),
        queryOrderStatus: async (o, p) => ({ success: true, o, p }),
        installLicenseFromServer: async (m) => ({ success: true, m }),
        setActivationFlowState: async (s) => ({ success: true, s }),
        getActivationFlowState: async () => ({ success: true, state: { x: 1 } })
    };
    const prescriptionCounter = {
        canPrescribe: () => ({ allowed: true, current: 1, max: 30, remaining: 29 }),
        increment: () => 2,
        decrement: () => 1,
        getStatus: () => ({ current: 1, max: 30, remaining: 29 })
    };
    const featureGuard = {
        checkFeature: (f) => ({ allowed: true, f }),
        getFeatureStatus: () => [{ feature: 'x', allowed: true }]
    };
    return { calls, licenseManager, activateManager, prescriptionCounter, featureGuard };
}

// Module._load 拦截（handler 内联 require）
const origLoad = Module._load;
function intercept(map) {
    Module._load = function (request, ...rest) {
        if (Object.prototype.hasOwnProperty.call(map, request)) return map[request];
        return origLoad.call(this, request, ...rest);
    };
}
function restoreLoad() { Module._load = origLoad; }

async function invoke(handlers, ch, ...args) {
    // 帧形状对齐 Electron 35 WebFrameMain：主框架 parent===null
    const event = { sender: { id: 'wc1' }, senderFrame: { parent: null, url: ACTIVATE_FRAME_URL } };
    return handlers.get(ch)(event, ...args);
}

// ★ 第四轮（B-重1）：帧门白名单已收紧为"模块自身目录绝对路径全等"——
//   mock 帧 URL 必须用被加载模块目录（shared/）下的 activate-window.html 真实
//   file URL，否则绝对路径比对不通过。运行时该文件由 sync-all 复制进 electron
//   目录，__dirname 同口径。
const ACTIVATE_FRAME_URL = require('url').pathToFileURL(
    require('path').join(__dirname, '..', 'shared', 'activate-window.html')).href;

// —— 启动两产品工厂 ——
const { createDesktopLicenseIpc } = require('../shared/desktop-license-ipc.cjs');
const d = makeDomainStubs();

const winStub = { isDestroyed: () => false, hide() { this.hideCount = (this.hideCount || 0) + 1; }, hideCount: 0 };
const appStub = { getPath: () => '/tmp/userdata', quit() { this.quitCount = (this.quitCount || 0) + 1; }, quitCount: 0 };
const dialogStub = { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) };
const BWStub = { fromWebContents: () => winStub };

const fseStub = {
    _store: {},
    async pathExists(p) { return Object.prototype.hasOwnProperty.call(this._store, p); },
    async readJson(p) { return this._store[p]; },
    async writeJson(p, v) { this._store[p] = JSON.parse(JSON.stringify(v)); }
};
const safeStorageStub = {
    isEncryptionAvailable: () => true,
    encryptString: (s) => Buffer.from('enc:' + s)
};

const cloudIpc = makeIpcMain();
createDesktopLicenseIpc({
    ipcMain: cloudIpc,
    app: appStub, dialog: dialogStub, BrowserWindow: BWStub,
    licenseManager: d.licenseManager, activateManager: d.activateManager,
    prescriptionCounter: d.prescriptionCounter, featureGuard: d.featureGuard,
    getMainWindow: () => winStub,
    productClass: 'cloud'
});

const offlineIpc = makeIpcMain();
createDesktopLicenseIpc({
    ipcMain: offlineIpc,
    app: appStub, dialog: dialogStub, BrowserWindow: BWStub,
    licenseManager: d.licenseManager, activateManager: d.activateManager,
    prescriptionCounter: d.prescriptionCounter, featureGuard: d.featureGuard,
    getMainWindow: () => winStub,
    productClass: 'offline',
    isTrialDenied: () => false,
    fse: fseStub, safeStorage: safeStorageStub, path,
    getWritableConfigPath: () => '/tmp/userdata/config.json',
    hashPassword: async (pw) => ({ passwordHash: 'hash:' + pw, salt: 's' })
});

// —— 1. 注册面 ——
const COMMON = ['license:activate', 'license:cancel-admin-request', 'license:check-admin-status',
    'license:check-feature', 'license:clear-admin-request-id', 'license:close-activate',
    'license:decrement-prescription', 'license:get-feature-status', 'license:get-machine-id',
    'license:get-prescription-status', 'license:get-trial-days', 'license:increment-prescription',
    'license:load-admin-request-id', 'license:query-invite', 'license:restart', 'license:save-license',
    'license:select-offline-file', 'license:show-activate', 'license:show-expire-alert',
    'license:submit-activate', 'license:submit-admin-request', 'license:submit-ticket'];
const BRANCH = ['license:get-status', 'license:can-prescribe', 'license:submit-order-direct'];
const CLOUD_ONLY = ['license:load-pending-order-no'];
const LOCAL_ONLY = ['license:claim-free', 'license:gate-failed', 'license:get-activation-users',
    'license:get-flow-state', 'license:install-admin-license', 'license:install-from-server',
    'license:query-order-status', 'license:load-registration-info', 'license:register-local-user',
    'license:set-flow-state', 'license:start-trial', 'license:verify-gate'];

assert(cloudIpc.handlers.size === 26, '云端注册数应26，实际' + cloudIpc.handlers.size);
assert(offlineIpc.handlers.size === 37, '离线注册数应37，实际' + offlineIpc.handlers.size);
for (const ch of [...COMMON, ...BRANCH, ...CLOUD_ONLY]) {
    assert(cloudIpc.handlers.has(ch), '云端应有 ' + ch);
}
for (const ch of LOCAL_ONLY) assert(!cloudIpc.handlers.has(ch), '云端不应有 ' + ch);
for (const ch of [...COMMON, ...BRANCH, ...LOCAL_ONLY]) {
    assert(offlineIpc.handlers.has(ch), '离线应有 ' + ch);
}
assert(!cloudIpc.handlers.has('license:set-trial-days'), 'set-trial-days 两端均不注册');
assert(!offlineIpc.handlers.has('license:set-trial-days'), 'set-trial-days 两端均不注册');

// —— 2. get-status 端分叉 ——
(async () => {
    // 云端：readLicense null → invalid none
    d.licenseManager.readLicense = () => null;
    let r = await invoke(cloudIpc.handlers, 'license:get-status');
    assert(r.valid === false && r.licenseType === 'none', '云端 get-status 无 license');

    // 云端：永久 license
    d.licenseManager.readLicense = () => ({ type: 'licensed', expiresAt: null });
    r = await invoke(cloudIpc.handlers, 'license:get-status');
    assert(r.valid === true && r.remainingDays === -1, '云端 get-status 永久授权');

    // 云端：过期 license remaining 0
    d.licenseManager.readLicense = () => ({ type: 'licensed', expiresAt: Date.now() - 86400000 });
    r = await invoke(cloudIpc.handlers, 'license:get-status');
    assert(r.remainingDays === 0, '云端 get-status 已过期 remaining=0');

    // 离线：validateLicense 被调，参数含 localMachineId
    let captured = null;
    d.licenseManager.validateLicense = (o) => { captured = o; return { valid: true, type: 'trial' }; };
    r = await invoke(offlineIpc.handlers, 'license:get-status');
    assert(r.valid === true && captured && captured.localMachineId === 'mid-1', '离线 get-status 走 validateLicense({localMachineId})');

    // —— 3. activate 委托 ——
    d.licenseManager.installLicense = () => ({ success: true });
    d.licenseManager.validateLicense = () => ({ valid: true });
    r = await invoke(cloudIpc.handlers, 'license:activate', 'b64');
    assert(r.success === true && r.status.valid === true, 'activate 成功返回 status');
    d.licenseManager.installLicense = () => ({ success: false, error: 'bad' });
    r = await invoke(cloudIpc.handlers, 'license:activate', 'b64');
    assert(r.success === false && r.error === 'bad', 'activate 失败透传 error');

    // —— 4. can-prescribe 端分叉 ——
    r = await invoke(cloudIpc.handlers, 'license:can-prescribe');
    assert(r.allowed === true, '云端 can-prescribe 直走 counter');

    // 离线：试用到期 → readOnly
    d.licenseManager.validateLicense = () => ({ valid: false, type: 'trial_expired' });
    r = await invoke(offlineIpc.handlers, 'license:can-prescribe');
    assert(r.allowed === false && r.readOnly === true && r.max === -1, '离线 can-prescribe trial_expired 只读');

    d.licenseManager.validateLicense = () => ({ valid: true });
    r = await invoke(offlineIpc.handlers, 'license:can-prescribe');
    assert(r.allowed === true, '离线 can-prescribe 有效 license 回落 counter');

    // 计数器
    r = await invoke(cloudIpc.handlers, 'license:increment-prescription');
    assert(r.success && r.count === 2, 'increment');
    r = await invoke(cloudIpc.handlers, 'license:decrement-prescription');
    assert(r.success && r.count === 1, 'decrement');
    r = await invoke(cloudIpc.handlers, 'license:get-prescription-status');
    assert(r.current === 1, 'prescription-status');
    r = await invoke(cloudIpc.handlers, 'license:check-feature', 'export');
    assert(r.allowed === true && r.f === 'export', 'check-feature');
    r = await invoke(cloudIpc.handlers, 'license:get-feature-status');
    assert(Array.isArray(r) && r.length === 1, 'feature-status');

    // —— 5. 激活窗相关 ——
    r = await invoke(cloudIpc.handlers, 'license:query-invite', { code: 'X' });
    assert(r.success && r.d.code === 'X', 'query-invite');
    r = await invoke(cloudIpc.handlers, 'license:submit-admin-request', { a: 1 });
    assert(r.success, 'submit-admin-request');
    r = await invoke(cloudIpc.handlers, 'license:check-admin-status', 'R1', 'm1');
    assert(r.r === 'R1' && r.m === 'm1', 'check-admin-status 双参');
    r = await invoke(cloudIpc.handlers, 'license:save-license', 'b');
    assert(r.success && r.b === 'b', 'save-license');
    r = await invoke(cloudIpc.handlers, 'license:cancel-admin-request', 'R1');
    assert(r.success && d.calls[d.calls.length - 1] === 'clearReq', 'cancel 后清 requestId');
    r = await invoke(cloudIpc.handlers, 'license:load-admin-request-id');
    assert(r === 'REQ1', 'load-admin-request-id');
    r = await invoke(cloudIpc.handlers, 'license:clear-admin-request-id');
    assert(r.success, 'clear-admin-request-id');
    r = await invoke(cloudIpc.handlers, 'license:get-trial-days');
    assert(r.success && r.trialDays === 7, 'get-trial-days');
    r = await invoke(cloudIpc.handlers, 'license:submit-ticket', { t: 1 });
    assert(r.success, 'submit-ticket');
    r = await invoke(cloudIpc.handlers, 'license:load-pending-order-no');
    assert(r === 'ORD1', 'load-pending-order-no（仅云端）');

    // —— 6. select-offline-file（取消 + 成功，成功路径拦截 fs/electron）——
    r = await invoke(cloudIpc.handlers, 'license:select-offline-file');
    assert(r.success === false && r.cancelled === true, 'select-offline-file 取消');

    dialogStub.showOpenDialog = async () => ({ canceled: false, filePaths: ['C:/x/license.dat'] });
    intercept({ fs: { readFileSync: () => '  B64DATA  ' } });
    try {
        r = await invoke(cloudIpc.handlers, 'license:select-offline-file');
        assert(r.success && r.base64Content === 'B64DATA', 'select-offline-file 读取并 trim');
    } finally { restoreLoad(); }
    dialogStub.showOpenDialog = async () => ({ canceled: true, filePaths: [] });

    // —— 7. submit-activate：成功多设备弹框（拦截 electron）——
    d.activateManager.activateOnline = async () => ({
        success: true,
        licenseInfo: { maxDevices: 3, devicesCount: 2 }
    });
    let boxMsg = '';
    intercept({ electron: { dialog: { showMessageBoxSync: (_w, o) => { boxMsg = o.message; } } } });
    try {
        r = await invoke(cloudIpc.handlers, 'license:submit-activate', 'CODE', 'u', 'c', 'p', 'pw', 'std', 'INV');
        assert(r.success && boxMsg.includes('2/3'), 'submit-activate 多设备弹配额框');
    } finally { restoreLoad(); }

    // —— 8. 离线专属委托 ——
    r = await invoke(offlineIpc.handlers, 'license:verify-gate', 'user1');
    assert(r.ok === true, 'verify-gate 委托');
    r = await invoke(offlineIpc.handlers, 'license:claim-free', '13800000000');
    assert(r.success && r.p === '13800000000', 'claim-free');
    r = await invoke(offlineIpc.handlers, 'license:start-trial');
    assert(r.success, 'start-trial');
    r = await invoke(offlineIpc.handlers, 'license:query-order-status', 'O1', 'p');
    assert(r.o === 'O1', 'query-order-status');
    r = await invoke(offlineIpc.handlers, 'license:set-flow-state', { s: 1 });
    assert(r.success, 'set-flow-state');
    r = await invoke(offlineIpc.handlers, 'license:get-flow-state');
    assert(r.state.x === 1, 'get-flow-state');

    // —— 9. E2E 旁路双拦截（安全）——
    global.__BNZC_E2E_BYPASS = true;
    r = await invoke(offlineIpc.handlers, 'license:install-admin-license', { a: 1 });
    assert(r.success === false && /E2E/.test(r.error), 'install-admin-license E2E 拦截');
    r = await invoke(offlineIpc.handlers, 'license:install-from-server', 'm1');
    assert(r.success === false && /E2E/.test(r.error), 'install-from-server E2E 拦截');
    global.__BNZC_E2E_BYPASS = false;

    // 正常路径
    r = await invoke(offlineIpc.handlers, 'license:install-admin-license', { a: 1 });
    assert(r.success, 'install-admin-license 正常放行');
    r = await invoke(offlineIpc.handlers, 'license:install-from-server', 'm1');
    assert(r.success, 'install-from-server 正常放行');

    // —— 10. gate-failed：隐藏主窗 + 委托；catch 路径不 show、重试再败 quit ——
    winStub.hideCount = 0;
    r = await invoke(offlineIpc.handlers, 'license:gate-failed', 'msg1');
    assert(r.success && winStub.hideCount === 1, 'gate-failed 先 hide 再弹引导');

    const origAlert = d.activateManager.showExpireAlertAndActivate;
    // 同步抛错（重试 catch 只接同步异常；async reject 在生产中走 unhandledRejection 日志）
    d.activateManager.showExpireAlertAndActivate = function () { throw new Error('boom'); };
    appStub.quitCount = 0;
    winStub.hideCount = 0;
    r = await invoke(offlineIpc.handlers, 'license:gate-failed', 'msg2');
    assert(r.success === false && winStub.hideCount === 1, 'gate-failed catch 首次 hide');
    await new Promise(res => setTimeout(res, 1200));
    // 重试里再 hide 一次，且 show 再抛 → app.quit；主窗从未 show
    assert(appStub.quitCount === 1, 'gate-failed 重试再败 → app.quit');
    assert(winStub.hideCount === 2 && !('showCount' in winStub), '主窗始终未重新 show（fail-closed）');
    d.activateManager.showExpireAlertAndActivate = origAlert;

    // —— 11. register-local-user ——
    // F3：子框架调用直接拒绝（不校验内容、不写 config）
    {
        const subEvent = { sender: { id: 'wc2' }, senderFrame: { parent: {}, url: ACTIVATE_FRAME_URL } };
        r = await offlineIpc.handlers.get('license:register-local-user')(subEvent, {
            phone: '13800000000', password: 'pass1234'
        });
        assert(r.success === false && /非法调用来源/.test(r.error), 'F3 register-local-user 子框架拒绝');
        assert(Object.keys(fseStub._store).filter(k => /config\.json$/.test(k)).length === 0,
            'F3 拒绝时不写 config.json');
    }
    // 无 senderFrame 同样拒绝
    {
        r = await offlineIpc.handlers.get('license:register-local-user')({}, {
            phone: '13800000000', password: 'pass1234'
        });
        assert(r.success === false && /非法调用来源/.test(r.error), 'F3 register-local-user 无帧对象拒绝');
    }
    // M1：主窗 index.html 顶层帧（parent===null 但 URL pathname 不在白名单）→ 拒绝。
    // 本 handler 硬编码 role:'admin'，主窗顶层帧同样满足 parent===null，必须按 URL 收窄。
    {
        const mainWinEvent = { sender: { id: 'wc3' }, senderFrame: { parent: null, url: 'file:///app/index.html' } };
        r = await offlineIpc.handlers.get('license:register-local-user')(mainWinEvent, {
            phone: '13800000000', password: 'pass1234'
        });
        assert(r.success === false && /非法调用来源/.test(r.error), 'M1 主窗 index.html 顶层帧拒绝');
        assert(Object.keys(fseStub._store).filter(k => /config\.json$/.test(k)).length === 0,
            'M1 拒绝时不写 config.json');
    }
    // M1：http(s) 页面顶层帧拒绝（即使文件名相同）
    {
        const httpEvent = { sender: { id: 'wc4' }, senderFrame: { parent: null, url: 'https://evil.com/activate-window.html' } };
        r = await offlineIpc.handlers.get('license:register-local-user')(httpEvent, {
            phone: '13800000000', password: 'pass1234'
        });
        assert(r.success === false && /非法调用来源/.test(r.error), 'M1 https 同名页面顶层帧拒绝');
    }
    // M1：缺 url / 畸形 url 的顶层帧拒绝
    {
        const noUrlEvent = { sender: { id: 'wc5' }, senderFrame: { parent: null } };
        r = await offlineIpc.handlers.get('license:register-local-user')(noUrlEvent, {
            phone: '13800000000', password: 'pass1234'
        });
        assert(r.success === false && /非法调用来源/.test(r.error), 'M1 缺 url 顶层帧拒绝');
    }
    // M1：query/hash 不改变 pathname，激活窗合法 URL 帧门放行（随后进入手机号校验）
    {
        const qEvent = { sender: { id: 'wc6' }, senderFrame: { parent: null, url: ACTIVATE_FRAME_URL + '?a=1#top' } };
        r = await offlineIpc.handlers.get('license:register-local-user')(qEvent, {
            phone: '123', password: 'abcdefgh1'
        });
        assert(r.success === false && /手机号/.test(r.error), 'M1 query/hash 不影响白名单（帧门放行）');
    }
    // ★ 第五轮（采纳）：本应用目录下多一层 evil/ 段投放同名 html（pathname 异构）→ 拒绝
    {
        const evilUrl = ACTIVATE_FRAME_URL.replace(/\/activate-window\.html$/, '/evil/activate-window.html');
        const evilEvent = { sender: { id: 'wc7' }, senderFrame: { parent: null, url: evilUrl } };
        r = await offlineIpc.handlers.get('license:register-local-user')(evilEvent, {
            phone: '13800000000', password: 'pass1234'
        });
        assert(r.success === false && /非法调用来源/.test(r.error), '第五轮 同名异目录（evil/段）顶层帧拒绝');
    }
    // ★ 第五轮（采纳）：file://evil/share/ UNC host——pathname 与本地同构但 host 异地 → 拒绝
    {
        const uncPath = new URL(ACTIVATE_FRAME_URL).pathname;
        const uncEvent = { sender: { id: 'wc8' }, senderFrame: { parent: null, url: 'file://evil' + uncPath } };
        r = await offlineIpc.handlers.get('license:register-local-user')(uncEvent, {
            phone: '13800000000', password: 'pass1234'
        });
        assert(r.success === false && /非法调用来源/.test(r.error), '第五轮 file://evil UNC host 拒绝');
    }
    // ★ 第五轮（采纳）：盘符大小写不敏感（Windows）→ 帧门放行（随后手机号校验拦截证明过门）
    {
        const lowerUrl = ACTIVATE_FRAME_URL.replace(/^(file:\/\/\/[A-Z]:)/, m => m.toLowerCase());
        const lowerEvent = { sender: { id: 'wc9' }, senderFrame: { parent: null, url: lowerUrl } };
        r = await offlineIpc.handlers.get('license:register-local-user')(lowerEvent, {
            phone: '123', password: 'abcdefgh1'
        });
        assert(r.success === false && /手机号/.test(r.error), '第五轮 盘符小写放行（帧门过→手机号校验拦截）');
    }
    // H1/B1：帧门通过但磁盘 users 无签发来源 → 拒绝（不洗白）
    {
        const origGate = d.licenseManager.configUsersProvenAuthentic;
        d.licenseManager.configUsersProvenAuthentic = () => false;
        try {
            r = await invoke(offlineIpc.handlers, 'license:register-local-user', {
                phone: '13800000000', password: 'pass1234'
            });
            assert(r.success === false && /篡改/.test(r.error), 'users 来源闸门失败时注册拒绝');
        } finally { d.licenseManager.configUsersProvenAuthentic = origGate; }
    }
    // 校验失败
    r = await invoke(offlineIpc.handlers, 'license:register-local-user', { phone: '123', password: 'abcdefgh1' });
    assert(r.success === false && /手机号/.test(r.error), '注册手机号校验');
    r = await invoke(offlineIpc.handlers, 'license:register-local-user', { phone: '13800000000', password: 'short' });
    assert(r.success === false && /密码/.test(r.error), '注册密码强度校验');

    // 成功新增（拦截 electron.webContents）
    intercept({ electron: { webContents: { getAllWebContents: () => [] } } });
    try {
        r = await invoke(offlineIpc.handlers, 'license:register-local-user', {
            phone: '13800000000', password: 'pass1234', clinicName: '惠康堂', adminName: '费医生'
        });
        assert(r.success && r.users.length === 1 && r.users[0].username === '13800000000', '注册新增成功');
        assert(fseStub._store[path.join('/tmp/userdata', 'registration-info.json')], '注册信息直通落盘');
        assert(d.licenseManager.backupCalls.length === 1, 'I-4 新增写盘后立即刷新备份×1');
    } finally { restoreLoad(); }

    // UPSERT：第二次调用同名用户（config 已存在）
    intercept({ electron: { webContents: { getAllWebContents: () => [] } } });
    try {
        r = await invoke(offlineIpc.handlers, 'license:register-local-user', {
            phone: '13800000000', password: 'newpass99', clinicName: '惠康堂', adminName: '费医生'
        });
        assert(r.success && r.users.length === 1 && r.users[0].password === 'hash:newpass99', '注册 UPSERT 更新密码');
        assert(d.licenseManager.backupCalls.length === 2, 'I-4 UPSERT 写盘后再次刷新备份×2');
    } finally { restoreLoad(); }

    // —— 12. load-registration-info / get-activation-users ——
    r = await invoke(offlineIpc.handlers, 'license:load-registration-info');
    assert(r.success, 'load-registration-info');
    r = await invoke(offlineIpc.handlers, 'license:get-activation-users');
    assert(r.success && Array.isArray(r.users), 'get-activation-users');

    // —— 结果 ——
    console.log(`\n[DESKTOP-LICENSE-SMOKE] 结果: ${total - failed}/${total} 通过` + (failed ? ' ✗' : ' ✓'));
    process.exit(failed ? 1 : 0);
})().catch(e => { console.error('SMOKE 异常:', e); process.exit(1); });
