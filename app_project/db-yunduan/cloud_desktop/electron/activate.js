// ============================================================================
//  activate.js — 客户端激活流程模块（Electron 主进程）
//
//  功能：
//    - 生成机器 ID（基于 hostname + username + exePath 的 SHA256）
//    - 显示激活窗口（加载 activate-window.html）
//    - 在线激活（调用云端 /api/license/validate）
//    - 写入 license.dat（复用 license-manager.getLicensePath）
//
//  激活流程：
//    1. 用户在激活窗口输入激活码
//    2. 渲染进程通过 preload.js 调用 activate.submit(code, user)
//    3. 主进程调用 activateOnline() → 云端 validate API
//    4. 云端返回 license base64 → 写入 license.dat
//    5. 提示激活成功 → 重启应用
// ============================================================================

const { BrowserWindow, app, dialog, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const licenseManager = require('./license-manager');

// ★ 云端激活 API URL（与 public/index.html 的 CLOUD_API_BASE 一致）
const ACTIVATE_API_URL = 'https://tcm-prescription-system.pages.dev/api/license/validate';
const ADMIN_ACTIVATE_API_URL = 'https://tcm-prescription-system.pages.dev/api/license/admin-submit';

// ============================================================================
//  机器 ID 生成
// ============================================================================
// P5-5 安全升级（2026-08-08，规则3）：
//   不再本地重复实现，直接复用 license-manager.getMachineId()
//   （license-manager 已升级为"多硬件哈希主体 + 软件补充"，
//    只返回最终哈希串，不上传原始硬件信息）
function getMachineId() {
    try {
        if (licenseManager && typeof licenseManager.getMachineId === 'function') {
            const mid = licenseManager.getMachineId();
            if (mid) return mid;
        }
        // 回退：用 crypto 生成一个随机但稳定的占位（尽量不触发）
        console.warn('[Activate] licenseManager.getMachineId 不可用，回退随机 ID');
        return crypto.randomBytes(16).toString('hex');
    } catch (e) {
        console.error('[Activate] 生成机器 ID 失败:', e);
        return crypto.randomBytes(16).toString('hex');
    }
}

// ============================================================================
//  加载客户端配置（config.json），用于上报版本信息
// ============================================================================
function loadClientConfig() {
    try {
        const configPath = path.join(licenseManager.getWritableDir(), 'config.json');
        if (fs.existsSync(configPath)) {
            const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            return {
                productName: cfg.productName || '',
                edition: cfg.edition || '',
                appMode: cfg.appMode || '',
                versionLabel: cfg.versionLabel || '',
                env: cfg.env || 'production'
            };
        }
    } catch (e) {
        console.warn('[Activate] 加载 config.json 失败:', e.message);
    }
    return { productName: '', edition: '', appMode: '', versionLabel: '', env: 'production' };
}

// ============================================================================
//  在线激活
// ============================================================================
// 调用云端 validate API，返回 { success, license, licenseInfo } 或 { success: false, error }
// ★ v3 新增：clinicName 参数，传给云端做诊所名绑定校验
// ★ 修复：license.dat 写入失败时友好提示 + 自动 fallback 到 userData 目录
// ★ 优化：Promise.race 双保险超时，解决 Electron 28 中 AbortController 可能不生效导致 fetch 卡死几十分钟的问题
async function activateOnline(code, machineId, user, clinicName, phone, password, edition) {
    try {
        const body = { code, machineId };
        if (user) body.user = user;
        // ★ v3 新增：提交 clinicName（如填写）
        if (clinicName) body.clinicName = clinicName;
        if (phone) body.phone = phone;

        // ★ 优化：Promise.race 实现可靠超时
        // 原问题：Electron 28 中 AbortController.abort() 可能不中断 fetch，导致卡死几十分钟
        // 修复：Promise.race 确保 15 秒后必定返回超时错误，不依赖 AbortController
        const fetchPromise = async () => {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 12000);  // 12 秒 AbortController 超时
            try {
                const response = await fetch(ACTIVATE_API_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body),
                    signal: controller.signal
                });
                return await response.json();
            } finally {
                clearTimeout(timeout);
            }
        };

        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('FETCH_TIMEOUT')), 15000);  // 15 秒总超时兜底
        });

        const data = await Promise.race([fetchPromise(), timeoutPromise]);

        if (!data.success) {
            return { success: false, error: data.error || '激活失败' };
        }

        // ★ 统一安装 License（写license+清trial+同步config+创建管理员账户 = 一行搞定）
        const installResult = licenseManager.installLicense(data.license, {
            machineId,
            doctorName: user || '',
            clinicName: clinicName || '',
            phone: phone || '',
            password: password || '',
            edition: edition || loadClientConfig().edition || 'standard'
        });
        if (!installResult.success) {
            return { success: false, error: installResult.error };
        }

        return {
            success: true,
            licenseInfo: data.licenseInfo,
            message: '激活成功',
            licensePath: installResult.path
        };
    } catch (e) {
        console.error('[Activate] 在线激活失败:', e);
        let errorMsg = e.message;
        if (e.message === 'FETCH_TIMEOUT' || e.name === 'AbortError') {
            errorMsg = '连接服务器超时（15秒），请检查网络后重试';
        } else if (e.message && e.message.includes('fetch failed')) {
            errorMsg = '无法连接服务器，请检查网络连接';
        }
        return { success: false, error: errorMsg };
    }
}

// ============================================================================
//  激活窗口
// ============================================================================
let activateWindow = null;

// ★ 是否正在执行 expire-alert 流程（防止 closed 事件与 expire-alert 互相递归）
let inExpireAlertFlow = false;

// ★ 一体化到期提示 + 拉起激活窗口（双按钮：前往激活 / 退出软件）
// 用异步 dialog.showMessageBox（不阻塞 main process 事件循环）
// 用户点击【前往激活】→ 关闭到期弹窗，唤起激活码输入页面，软件保持运行
// 用户点击【退出软件】→ 直接 app.exit(0) 终止 Electron 进程
async function showExpireAlertAndActivate(parentWindow, message) {
    // 防止递归调用（closed 事件触发的 expire-alert 期间再次被触发）
    if (inExpireAlertFlow) return { success: true, action: 'skipped' };
    inExpireAlertFlow = true;
    try {
        // 1. 异步显示双按钮到期提示框（不阻塞 main process）
        let choice = 0; // 默认前往激活
        const safeWindow = (parentWindow && !parentWindow.isDestroyed()) ? parentWindow : null;
        const msgBoxOptions = {
            type: 'warning',
            title: '授权提示',
            message: message || '试用期已到期，无法进入系统，请完成激活或退出程序',
            buttons: ['前往激活', '退出软件'],
            defaultId: 0,
            cancelId: 0,
            noLink: true
        };
        if (safeWindow) {
            const result = await dialog.showMessageBox(safeWindow, msgBoxOptions);
            choice = result.response;
        } else {
            // 无父窗口时，用同步 dialog
            choice = dialog.showMessageBoxSync(msgBoxOptions);
        }

        // 2. 用户点击【退出软件】，直接终止 Electron 全部进程
        if (choice === 1) {
            console.log('[Activate] 用户选择退出软件');
            app.exit(0);
            return { success: true, action: 'exit' };
        }

        // 3. 用户点击【前往激活】，拉起激活码输入窗口
        console.log('[Activate] 用户选择前往激活');
        showActivateWindow(safeWindow);
        return { success: true, action: 'activate' };
    } catch (e) {
        console.error('[Activate] showExpireAlertAndActivate 异常:', e);
        // 异常时尝试单独弹激活窗口（兜底放行，避免阻塞用户）
        try { showActivateWindow(parentWindow); } catch (e2) {
            console.error('[Activate] showActivateWindow 也失败:', e2);
        }
        return { success: false, error: String(e) };
    } finally {
        inExpireAlertFlow = false;
    }
}

function showActivateWindow(parentWindow) {
    // 如果已存在，聚焦+置顶
    if (activateWindow && !activateWindow.isDestroyed()) {
        activateWindow.show();
        activateWindow.focus();
        activateWindow.setAlwaysOnTop(true, 'screen-saver');
        return;
    }

    const machineId = getMachineId();

    // ★ 修复激活窗口不显示：不要用modal+parent（父窗口未加载好会导致子窗口隐形）
    // 改为独立窗口 + alwaysOnTop 强制置顶，确保小白用户一定能看到
    activateWindow = new BrowserWindow({
        width: 500,
        height: 760,
        resizable: true,
        minimizable: false,
        maximizable: false,
        autoHideMenuBar: true,
        title: '软件激活',
        alwaysOnTop: true,              // ★ 强制置顶（含锁屏之上）
        show: false,                    // ★ 先隐藏，ready-to-show后再show（防白屏闪烁）
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        }
    });
    // 最高优先级置顶（screen-saver级 = 仅低于屏保）
    activateWindow.setAlwaysOnTop(true, 'screen-saver');
    activateWindow.center();

    // 加载激活窗口 HTML，通过 URL 参数传递机器 ID
    const htmlPath = path.join(__dirname, 'activate-window.html');
    activateWindow.loadFile(htmlPath, { query: { machineId: machineId } });

    // ★ DOM和资源就绪后再show，避免白屏
    activateWindow.once('ready-to-show', () => {
        activateWindow.show();
        activateWindow.focus();
        // 再次强制置顶，防止show后被其他系统窗口抢焦点
        setTimeout(() => {
            if (activateWindow && !activateWindow.isDestroyed()) {
                activateWindow.setAlwaysOnTop(true, 'screen-saver');
                activateWindow.focus();
            }
        }, 300);
    });

    // ★ 关闭后的兜底：不再死循环调用showExpireAlertAndActivate
    // 未激活状态下，用户关闭激活窗口 = 不想现在激活，直接显示登录窗口让用户知道（但无法操作）
    let closedOnce = false;
    activateWindow.on('closed', () => {
        activateWindow = null;
        if (closedOnce) return;  // 防递归
        closedOnce = true;
        if (inExpireAlertFlow) return;
        try {
            const localMachineId = getMachineId();
            const licenseResult = licenseManager.validateLicense({ localMachineId });
            if (!licenseResult.valid) {
                // ★ 优化：未激活时关闭激活窗口，给parent窗口一个提示但不再强弹窗口
                console.log('[Activate] 用户关闭激活窗口（未激活），不再强弹出期提示（避免死循环）');
                // 如果有父窗口，把父窗口前置，提示用户稍后可从登录页重新打开激活窗口
                if (parentWindow && !parentWindow.isDestroyed()) {
                    parentWindow.show();
                    parentWindow.focus();
                }
            }
        } catch (e) {
            console.warn('[Activate] 关闭后校验 license 异常:', e.message);
        }
    });

    return activateWindow;
}

function closeActivateWindow() {
    if (activateWindow && !activateWindow.isDestroyed()) {
        activateWindow.close();
        activateWindow = null;
    }
}

// 重启应用
function restartApp() {
    app.relaunch();
    app.exit(0);
}

// ============================================================================
//  管理员激活流程
// ============================================================================

// ★ requestId 本地持久化（解决轮询超时/关闭窗口后丢失状态的问题）
// 场景：客户提交激活请求后关闭窗口或轮询超时，管理员稍后审核通过，
//       客户重新打开程序时自动读取本地 requestId 检查状态，获取已通过的 license
function getAdminRequestIdPath() {
    try {
        return path.join(licenseManager.getWritableDir(), 'admin-request-id.dat');
    } catch (e) {
        return path.join(app.getPath('userData'), 'admin-request-id.dat');
    }
}

// ★ 敏感信息安全存储（P0修复：管理员密码不再明文落盘）
// 使用 Electron safeStorage（Windows: DPAPI / macOS: Keychain / Linux: kwallet/gnome-libsecret）
// 加密绑定当前用户，重启后仍可解密；加密不可用时丢弃密码（不写明文），由用户后续通过注册向导创建管理员账户
function encryptSensitive(value) {
    if (!value) return '';
    try {
        if (safeStorage && safeStorage.isEncryptionAvailable()) {
            return 'ENC:' + safeStorage.encryptString(value).toString('base64');
        }
        console.warn('[Admin] safeStorage 不可用，敏感信息不落盘');
    } catch (e) {
        console.warn('[Admin] 加密失败:', e.message);
    }
    return '';
}

function decryptSensitive(enc) {
    if (!enc || typeof enc !== 'string') return '';
    try {
        if (enc.startsWith('ENC:') && safeStorage && safeStorage.isEncryptionAvailable()) {
            return safeStorage.decryptString(Buffer.from(enc.slice(4), 'base64'));
        }
    } catch (e) {
        console.warn('[Admin] 解密失败:', e.message);
    }
    return '';
}

function saveAdminRequestId(requestId, clinicName, adminName, phone, password, edition) {
    try {
        const data = {
            requestId: requestId,
            clinicName: clinicName || '',
            adminName: adminName || '',
            phone: phone || '',
            password: encryptSensitive(password || ''),  // ★ 加密存储，避免明文落盘
            savedAt: new Date().toISOString(),
            edition: edition || '',  // ★ 保存版本选择
        };
        fs.writeFileSync(getAdminRequestIdPath(), JSON.stringify(data), 'utf8');
        console.log('[Admin] requestId 已保存:', requestId);
    } catch (e) {
        console.warn('[Admin] 保存 requestId 失败:', e.message);
    }
}

function loadAdminRequestId() {
    try {
        const p = getAdminRequestIdPath();
        if (fs.existsSync(p)) {
            const data = JSON.parse(fs.readFileSync(p, 'utf8'));
            return data;  // { requestId, clinicName, adminName, savedAt }
        }
    } catch (e) {
        console.warn('[Admin] 读取 requestId 失败:', e.message);
    }
    return null;
}

function clearAdminRequestId() {
    try {
        const p = getAdminRequestIdPath();
        if (fs.existsSync(p)) {
            fs.unlinkSync(p);
            console.log('[Admin] requestId 已清除');
        }
    } catch (e) { /* 忽略 */ }
}

// ★ 提交管理员激活请求到平台
async function submitAdminRequest(data) {
    try {
        // ★ 加载客户端配置（版本信息）
        const clientCfg = loadClientConfig();
        
        const body = {
            clinicName: data.clinicName,
            adminName: data.adminName,
            phone: data.phone,
            remark: data.remark || '',
            machineId: data.machineId,
            // ★ 版本信息：用于平台区分离线/云端、机构版/标准版
            productName: clientCfg.productName,
            edition: data.edition || clientCfg.edition,
            appMode: clientCfg.appMode,
            versionLabel: clientCfg.versionLabel,
            env: clientCfg.env
            // 注意：password 不发送到云端，仅本地保存用于创建管理员账户
        };

        const fetchPromise = async () => {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 12000);
            try {
                const response = await fetch(ADMIN_ACTIVATE_API_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body),
                    signal: controller.signal
                });
                return await response.json();
            } finally {
                clearTimeout(timeout);
            }
        };

        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('FETCH_TIMEOUT')), 15000);
        });

        const result = await Promise.race([fetchPromise(), timeoutPromise]);

        if (result.success) {
            // ★ 持久化 requestId + phone + password，防止轮询超时/关闭窗口后丢失
            saveAdminRequestId(result.requestId, data.clinicName, data.adminName, data.phone, data.password, data.edition);
            return {
                success: true,
                requestId: result.requestId,
                message: '激活请求提交成功'
            };
        } else {
            return { success: false, error: result.error || '提交失败' };
        }
    } catch (e) {
        console.error('[Admin] 提交激活请求失败:', e);
        let errorMsg = e.message;
        if (e.message === 'FETCH_TIMEOUT') {
            errorMsg = '连接服务器超时，请检查网络后重试';
        } else if (e.message && e.message.includes('fetch failed')) {
            errorMsg = '无法连接服务器，请检查网络连接';
        }
        return { success: false, error: errorMsg };
    }
}

// ★ 管理员激活状态轮询
async function checkAdminStatus(requestId) {
    try {
        const url = `https://tcm-prescription-system.pages.dev/api/license/admin-status?requestId=${encodeURIComponent(requestId)}`;
        
        const fetchPromise = async () => {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 8000);
            try {
                const response = await fetch(url, {
                    method: 'GET',
                    headers: { 'Content-Type': 'application/json' },
                    signal: controller.signal
                });
                return await response.json();
            } finally {
                clearTimeout(timeout);
            }
        };

        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('FETCH_TIMEOUT')), 10000);
        });

        const result = await Promise.race([fetchPromise(), timeoutPromise]);

        return result;
    } catch (e) {
        console.warn('[Admin] 检查激活状态失败:', e.message);
        return { success: false, error: e.message };
    }
}

// ★ 保存管理员激活返回的license + 自动创建管理员账户（统一走installLicense）
async function saveLicense(licenseBase64) {
    try {
        // 读取本地保存的激活信息（clinicName, adminName, phone, password）
        let savedClinicName = '';
        let savedAdminName = '';
        let savedPhone = '';
        let savedPassword = '';
        let savedEdition = '';
        try {
            const adminReqPath = getAdminRequestIdPath();
            if (fs.existsSync(adminReqPath)) {
                const adminReq = JSON.parse(fs.readFileSync(adminReqPath, 'utf8'));
                if (adminReq) {
                    savedClinicName = adminReq.clinicName || '';
                    savedAdminName = adminReq.adminName || '';
                    savedPhone = adminReq.phone || '';
                    savedPassword = decryptSensitive(adminReq.password || '');
                    savedEdition = adminReq.edition || '';  // ★ 读取用户选择的版本
                }
            }
        } catch (e) { /* 忽略 */ }

        // ★ 统一安装（一行搞定：写license+清trial+同步config+创建账户）
        const installResult = licenseManager.installLicense(licenseBase64, {
            clinicName: savedClinicName,
            doctorName: savedAdminName,
            phone: savedPhone,
            password: savedPassword,
            edition: savedEdition || loadClientConfig().edition || 'standard'
        });

        if (!installResult.success) {
            return { success: false, error: installResult.error };
        }

        // ★ 激活成功后清除本地 requestId
        clearAdminRequestId();

        return { success: true, licensePath: installResult.path };
    } catch (e) {
        console.error('[Admin] 保存license失败:', e);
        return { success: false, error: e.message };
    }
}

// ★ 取消管理员激活请求
async function cancelAdminRequest(requestId) {
    try {
        const url = `https://tcm-prescription-system.pages.dev/api/license/admin-cancel`;
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ requestId })
        });
        const result = await response.json();
        return result;
    } catch (e) {
        console.warn('[Admin] 取消激活请求失败:', e.message);
        return { success: true, message: '已本地取消' };
    }
}

module.exports = {
    getMachineId,
    activateOnline,
    showActivateWindow,
    showExpireAlertAndActivate,
    closeActivateWindow,
    restartApp,
    submitAdminRequest,
    checkAdminStatus,
    saveLicense,
    cancelAdminRequest,
    saveAdminRequestId,
    loadAdminRequestId,
    clearAdminRequestId,
    ACTIVATE_API_URL
};
