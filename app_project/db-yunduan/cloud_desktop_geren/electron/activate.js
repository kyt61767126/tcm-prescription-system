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

const { BrowserWindow, app, dialog } = require('electron');
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
//  在线激活
// ============================================================================
// 调用云端 validate API，返回 { success, license, licenseInfo } 或 { success: false, error }
// ★ v3 新增：clinicName 参数，传给云端做诊所名绑定校验
// ★ 修复：license.dat 写入失败时友好提示 + 自动 fallback 到 userData 目录
// ★ 优化：Promise.race 双保险超时，解决 Electron 28 中 AbortController 可能不生效导致 fetch 卡死几十分钟的问题
async function activateOnline(code, machineId, user, clinicName) {
    try {
        const body = { code, machineId };
        if (user) body.user = user;
        // ★ v3 新增：提交 clinicName（如填写）
        if (clinicName) body.clinicName = clinicName;

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

        // 写入 license.dat（带权限错误处理 + userData 兜底）
        const licensePath = licenseManager.getLicensePath();
        let actualWritePath = licensePath;
        try {
            fs.writeFileSync(licensePath, data.license, 'utf8');
            console.log('[Activate] license.dat 已写入:', licensePath);
        } catch (writeErr) {
            // ★ 修复 NSIS 安装到 Program Files 无写权限问题
            // 主路径写入失败时自动 fallback 到 userData 目录
            console.warn('[Activate] 主路径写入失败，尝试 userData 兜底:', writeErr.message);
            const { app } = require('electron');
            const path = require('path');
            const fallbackPath = path.join(app.getPath('userData'), 'license.dat');
            try {
                fs.writeFileSync(fallbackPath, data.license, 'utf8');
                actualWritePath = fallbackPath;
                console.log('[Activate] license.dat 已写入兜底路径:', fallbackPath);
            } catch (fallbackErr) {
                // 兜底也失败，给出明确的权限错误提示
                console.error('[Activate] 兜底路径也写入失败:', fallbackErr.message);
                const isPermErr = fallbackErr.code === 'EACCES' || fallbackErr.code === 'EPERM' ||
                                  writeErr.code === 'EACCES' || writeErr.code === 'EPERM';
                return {
                    success: false,
                    error: isPermErr
                        ? '授权文件写入失败：系统权限不足。\n请以管理员身份运行程序，或联系客服协助。'
                        : '授权文件写入失败：' + fallbackErr.message
                };
            }
        }

        // ★ 清除 trial 文件（已正式激活，避免残留过期试用标记导致重复弹窗）
        try {
            const trialPath = licenseManager.getTrialPath();
            if (fs.existsSync(trialPath)) {
                fs.unlinkSync(trialPath);
                console.log('[Activate] trial.dat 已清除');
            }
        } catch (e) {
            console.warn('[Activate] 清除 trial.dat 失败:', e);
        }

        // ★ 激活成功后同步 clinicName 到 config.json（防止重启后诊所名不匹配）
        try {
            const parsedLicense = licenseManager.readLicense(machineId);
            if (parsedLicense && parsedLicense.clinicName) {
                if (licenseManager.setLicenseDataContext) {
                    licenseManager.setLicenseDataContext(parsedLicense);
                }
                const configPath = path.join(licenseManager.getWritableDir(), 'config.json');
                let config = {};
                if (fs.existsSync(configPath)) {
                    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
                }
                if (config.clinicName !== parsedLicense.clinicName) {
                    config.clinicName = parsedLicense.clinicName;
                    if (licenseManager.signConfig) {
                        config = licenseManager.signConfig(config);
                    }
                    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
                    console.log('[Activate] config.json clinicName 已同步为:', parsedLicense.clinicName);
                }
            }
        } catch (syncErr) {
            console.warn('[Activate] 同步 clinicName 到 config.json 失败:', syncErr.message);
        }

        return {
            success: true,
            licenseInfo: data.licenseInfo,
            message: '激活成功',
            licensePath: actualWritePath
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
    // 如果已存在，聚焦
    if (activateWindow && !activateWindow.isDestroyed()) {
        activateWindow.focus();
        return;
    }

    const machineId = getMachineId();

    activateWindow = new BrowserWindow({
        width: 500,
        height: 760,
        parent: parentWindow,
        modal: true,
        resizable: true,
        minimizable: false,
        maximizable: false,
        autoHideMenuBar: true,
        title: '软件激活',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        }
    });

    // 加载激活窗口 HTML，通过 URL 参数传递机器 ID
    const htmlPath = path.join(__dirname, 'activate-window.html');
    activateWindow.loadFile(htmlPath, { query: { machineId: machineId } });

    // ★ 兜底限制：激活窗口关闭后重新校验 license
    // 如果 license 仍失效，重新弹 expire-alert（前往激活/退出软件）
    // 防止用户关闭激活窗口后绕过激活使用主界面，杜绝免授权使用漏洞
    activateWindow.on('closed', () => {
        activateWindow = null;
        if (inExpireAlertFlow) return; // 正在 expire-alert 流程中，避免递归
        try {
            // ★ v3 新增：激活窗口关闭后重新校验 license，传入 localMachineId 进行绑定校验
            const localMachineId = getMachineId();
            const licenseResult = licenseManager.validateLicense({ localMachineId });
            if (!licenseResult.valid) {
                console.log('[Activate] 激活窗口关闭后 license 仍失效，重新弹到期提示');
                // 延迟 200ms 避免与当前 closed 事件循环冲突
                setTimeout(() => {
                    showExpireAlertAndActivate(parentWindow, licenseResult.message);
                }, 200);
            }
        } catch (e) {
            console.warn('[Activate] 关闭后重新校验 license 失败:', e);
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

function saveAdminRequestId(requestId, clinicName, adminName) {
    try {
        const data = {
            requestId: requestId,
            clinicName: clinicName || '',
            adminName: adminName || '',
            savedAt: new Date().toISOString()
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
        const body = {
            clinicName: data.clinicName,
            adminName: data.adminName,
            phone: data.phone,
            remark: data.remark || '',
            machineId: data.machineId
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
            // ★ 持久化 requestId，防止轮询超时/关闭窗口后丢失
            saveAdminRequestId(result.requestId, data.clinicName, data.adminName);
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

// ★ 保存管理员激活返回的license
async function saveLicense(licenseBase64) {
    try {
        const licensePath = licenseManager.getLicensePath();
        let actualWritePath = licensePath;
        
        try {
            fs.writeFileSync(licensePath, licenseBase64, 'utf8');
            console.log('[Admin] license.dat 已写入:', licensePath);
        } catch (writeErr) {
            // 写入失败时尝试 userData 兜底
            console.warn('[Admin] 主路径写入失败，尝试 userData 兜底:', writeErr.message);
            const fallbackPath = path.join(app.getPath('userData'), 'license.dat');
            fs.writeFileSync(fallbackPath, licenseBase64, 'utf8');
            actualWritePath = fallbackPath;
            console.log('[Admin] license.dat 已写入兜底路径:', fallbackPath);
        }

        // 清除 trial 文件
        try {
            const trialPath = licenseManager.getTrialPath();
            if (fs.existsSync(trialPath)) {
                fs.unlinkSync(trialPath);
            }
        } catch (e) { /* 忽略 */ }

        // 同步 clinicName 到 config.json
        try {
            const parsedLicense = licenseManager.readLicense(getMachineId());
            if (parsedLicense && parsedLicense.clinicName) {
                const configPath = path.join(licenseManager.getWritableDir(), 'config.json');
                let config = {};
                if (fs.existsSync(configPath)) {
                    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
                }
                config.clinicName = parsedLicense.clinicName;
                // 重新签名 config.json
                try {
                    config.configSignature = licenseManager.signConfig(config);
                } catch (e2) { /* 忽略签名失败 */ }
                fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
            }
        } catch (e) { /* 忽略 */ }

        // ★ 激活成功后清除本地 requestId（不再需要恢复）
        clearAdminRequestId();

        return { success: true, licensePath: actualWritePath };
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
