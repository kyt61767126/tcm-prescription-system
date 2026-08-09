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

    // ★★★ 读取 config.json 获取诊所名和管理员名，传递给激活窗口
    let configClinicName = '';
    let configUserName = '';
    try {
        const configPath = path.join(licenseManager.getWritableDir(), 'config.json');
        if (fs.existsSync(configPath)) {
            const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            configClinicName = encodeURIComponent(config.clinicName || '');
            configUserName = encodeURIComponent(config.doctorName || config.adminName || '');
            console.log('[Activate] 读取配置: clinicName=' + (config.clinicName || '') + ', userName=' + (config.doctorName || config.adminName || ''));
        }
    } catch (e) {
        console.warn('[Activate] 读取 config.json 失败:', e.message);
    }

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

    // 加载激活窗口 HTML，通过 URL 参数传递机器 ID 和配置数据
    const htmlPath = path.join(__dirname, 'activate-window.html');
    activateWindow.loadFile(htmlPath, {
        query: {
            machineId: machineId,
            clinicName: configClinicName,
            userName: configUserName
        }
    });

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

module.exports = {
    getMachineId,
    activateOnline,
    showActivateWindow,
    showExpireAlertAndActivate,  // ★ 新增：双按钮到期提示（前往激活/退出软件）
    closeActivateWindow,
    restartApp,
    ACTIVATE_API_URL
};
