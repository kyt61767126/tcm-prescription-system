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
// 基于 hostname + username + exePath 生成唯一机器标识
// 同一台电脑、同一用户、同一安装路径会生成相同的 ID
function getMachineId() {
    try {
        const exePath = process.execPath || app.getPath('exe');
        const hostname = os.hostname();
        const userInfo = os.userInfo();
        const username = userInfo.username;
        const platform = os.platform();
        const content = [exePath, hostname, username, platform].join('|');
        return crypto.createHash('sha256').update(content).digest('hex').substring(0, 32);
    } catch (e) {
        console.error('[Activate] 生成机器 ID 失败:', e);
        // 回退：用时间戳 + 随机数（不理想，但避免崩溃）
        return crypto.randomBytes(16).toString('hex');
    }
}

// ============================================================================
//  在线激活
// ============================================================================
// 调用云端 validate API，返回 { success, license, licenseInfo } 或 { success: false, error }
async function activateOnline(code, machineId, user) {
    try {
        const body = { code, machineId };
        if (user) body.user = user;

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);  // 15 秒超时

        const response = await fetch(ACTIVATE_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: controller.signal
        });
        clearTimeout(timeout);

        const data = await response.json();

        if (!data.success) {
            return { success: false, error: data.error || '激活失败' };
        }

        // 写入 license.dat
        const licensePath = licenseManager.getLicensePath();
        fs.writeFileSync(licensePath, data.license, 'utf8');
        console.log('[Activate] license.dat 已写入:', licensePath);

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

        return {
            success: true,
            licenseInfo: data.licenseInfo,
            message: '激活成功'
        };
    } catch (e) {
        console.error('[Activate] 在线激活失败:', e);
        let errorMsg = e.message;
        if (e.name === 'AbortError') {
            errorMsg = '连接服务器超时，请检查网络后重试';
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
        width: 480,
        height: 600,
        parent: parentWindow,
        modal: true,
        resizable: false,
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
            const licenseResult = licenseManager.validateLicense();
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
