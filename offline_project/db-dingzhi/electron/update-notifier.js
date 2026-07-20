// ============================================================================
//  update-notifier.js — 自动更新通知模块（Electron 主进程）
//
//  功能：
//    - 启动时静默检查云端版本（不弹窗）
//    - 有新版本时通过 Notification 提示用户
//    - 用户点击通知后打开浏览器下载新版本
//    - 强制更新版本会显示 dialog 阻止用户继续使用
//
//  设计原则：
//    - 使用 HTTP 检查（不依赖 electron-updater，兼容 portable 和 NSIS）
//    - 不修改 index.html，使用 Electron 原生 Notification 和 dialog
//    - 失败时静默跳过（不影响正常使用）
//
//  版本比较规则：
//    - semver 比较（major.minor.patch）
//    - 当前版本 < 最新版本 → 有更新
//    - 当前版本 < minVersion → 强制更新
// ============================================================================

const { app, Notification, dialog, shell, BrowserWindow } = require('electron');

// ★ 云端更新检查 URL（与 public/updates/{channel}/latest.json 对应）
const UPDATE_BASE_URL = 'https://tcm-prescription-system.pages.dev/updates';

// 全局状态
let updateCheckInProgress = false;
let lastCheckTime = 0;
const CHECK_INTERVAL_MS = 30 * 60 * 1000;  // 30 分钟内不重复检查

// ============================================================================
//  版本比较工具
// ============================================================================
function compareVersions(v1, v2) {
    const parts1 = v1.split('.').map(n => parseInt(n, 10) || 0);
    const parts2 = v2.split('.').map(n => parseInt(n, 10) || 0);
    const maxLen = Math.max(parts1.length, parts2.length);

    for (let i = 0; i < maxLen; i++) {
        const p1 = parts1[i] || 0;
        const p2 = parts2[i] || 0;
        if (p1 > p2) return 1;
        if (p1 < p2) return -1;
    }
    return 0;
}

// ============================================================================
//  检查更新
// ============================================================================
async function checkForUpdates(channel) {
    // 限制检查频率
    const now = Date.now();
    if (updateCheckInProgress || (now - lastCheckTime < CHECK_INTERVAL_MS)) {
        return null;
    }

    updateCheckInProgress = true;
    lastCheckTime = now;

    try {
        const url = `${UPDATE_BASE_URL}/${channel}/latest.json`;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);  // 10 秒超时

        const response = await fetch(url, {
            signal: controller.signal,
            headers: { 'Cache-Control': 'no-cache' }
        });
        clearTimeout(timeout);

        if (!response.ok) {
            console.log(`[Update] 检查失败: HTTP ${response.status}`);
            return null;
        }

        const data = await response.json();
        const currentVersion = app.getVersion();
        const latestVersion = data.version;

        console.log(`[Update] 当前版本: ${currentVersion}, 最新版本: ${latestVersion}`);

        // 比较版本
        if (compareVersions(currentVersion, latestVersion) >= 0) {
            console.log('[Update] 已是最新版本');
            return null;
        }

        // 检查是否强制更新
        const minVersion = data.minVersion || '0.0.0';
        const forceUpdate = data.forceUpdate === true ||
                           compareVersions(currentVersion, minVersion) < 0;

        return {
            ...data,
            forceUpdate,
            currentVersion,
            channel
        };
    } catch (e) {
        console.log('[Update] 检查更新失败:', e.message);
        return null;
    } finally {
        updateCheckInProgress = false;
    }
}

// ============================================================================
//  显示更新通知
// ============================================================================
function showUpdateNotification(updateInfo) {
    // 检测是否为 portable 版本（无安装器）
    // process.execPath 在 portable 模式下指向 exe 本身
    // 在 NSIS 安装模式下指向安装目录的 exe
    const isPortable = process.execPath.toLowerCase().includes('-') &&
                       !process.execPath.toLowerCase().includes('setup') &&
                       !require('path').dirname(process.execPath).toLowerCase().includes('localappdata');

    // 优先使用 portableUrl（如果是 portable 版本），否则使用 url（安装版）
    const downloadUrl = isPortable && updateInfo.portableUrl ?
                        updateInfo.portableUrl :
                        (updateInfo.url || updateInfo.portableUrl);

    if (updateInfo.forceUpdate) {
        // 强制更新：显示 dialog 阻止用户继续使用
        dialog.showMessageBox({
            type: 'warning',
            title: '必须更新',
            message: `当前版本过旧，必须更新到 ${updateInfo.version} 才能继续使用`,
            detail: updateInfo.releaseNotes || '',
            buttons: ['立即下载', '退出'],
            defaultId: 0,
            cancelId: 1
        }).then(result => {
            if (result.response === 0) {
                shell.openExternal(downloadUrl);
            }
            app.quit();
        });
        return;
    }

    // 普通更新：使用 Notification 通知
    if (!Notification.isSupported()) {
        console.log('[Update] 系统不支持通知，跳过');
        return;
    }

    const notification = new Notification({
        title: `发现新版本 ${updateInfo.version}`,
        body: updateInfo.releaseNotes || '点击下载新版本',
        silent: false,
        urgency: 'normal'
    });

    notification.on('click', () => {
        shell.openExternal(downloadUrl);
        notification.close();
    });

    notification.show();
    console.log('[Update] 已显示更新通知');
}

// ============================================================================
//  初始化（在 app.whenReady() 之后调用）
// ============================================================================
function init(channel, options = {}) {
    const delay = options.delay || 5000;  // 默认延迟 5 秒检查，避免影响启动

    console.log(`[Update] 初始化更新检查，通道: ${channel}`);

    // 延迟检查
    setTimeout(async () => {
        const updateInfo = await checkForUpdates(channel);
        if (updateInfo) {
            showUpdateNotification(updateInfo);
        }
    }, delay);

    // 每小时检查一次
    setInterval(async () => {
        const updateInfo = await checkForUpdates(channel);
        if (updateInfo) {
            showUpdateNotification(updateInfo);
        }
    }, 60 * 60 * 1000);
}

// 手动触发检查（可暴露给渲染进程）
async function checkNow(channel) {
    const updateInfo = await checkForUpdates(channel);
    if (updateInfo) {
        showUpdateNotification(updateInfo);
        return updateInfo;
    }
    return null;
}

module.exports = {
    init,
    checkForUpdates,
    checkNow,
    compareVersions,
    UPDATE_BASE_URL
};
