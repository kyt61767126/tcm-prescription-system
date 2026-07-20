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

const { BrowserWindow, app } = require('electron');
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

    activateWindow.on('closed', () => {
        activateWindow = null;
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
    closeActivateWindow,
    restartApp,
    ACTIVATE_API_URL
};
