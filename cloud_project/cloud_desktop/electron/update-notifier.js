// ============================================================================
//  update-notifier.js — 自动更新通知模块（Electron 主进程）
//
//  功能：
//    - 启动时静默检查云端版本（不弹窗）
//    - 有新版本时通过 Notification 提示用户
//    - 用户点击通知后用 Electron 内置下载器下载（断点续传）
//    - 下载完成后打开文件夹让用户安装
//    - 强制更新版本会显示 dialog 阻止用户继续使用
//
//  ★ 任务6 改造点（断点续传）：
//    - 下载从 shell.openExternal(浏览器下载) 改为 Electron 内置 fetch + Range header
//    - 部分下载保存到 {userData}/update-cache/{channel}-{version}.exe.part
//    - 中断后下次自动从已下载位置继续（HTTP Range: bytes=N-）
//    - 服务端必须支持 Accept-Ranges（Cloudflare Pages 静态资源默认支持）
//    - 下载完成后重命名为 .exe 并 shell.showItemInFolder
//    - 任何异常时回退到 shell.openExternal 让浏览器下载
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
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

// ★ 云端更新检查 URL（与 public/updates/{channel}/latest.json 对应）
const UPDATE_BASE_URL = 'https://tcm-prescription-system.pages.dev/updates';

// 全局状态
let updateCheckInProgress = false;
let lastCheckTime = 0;
const CHECK_INTERVAL_MS = 30 * 60 * 1000;  // 30 分钟内不重复检查

// 下载任务状态（单实例，同时间只允许一个下载）
let downloadTask = null;  // { url, filePath, partPath, totalSize, downloadedSize, channel, version }

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
//  ★ 任务6：断点续传下载器
// ============================================================================
function getDownloadDir() {
    const dir = path.join(app.getPath('userData'), 'update-cache');
    if (!fs.existsSync(dir)) {
        try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {}
    }
    return dir;
}

function getDownloadPaths(channel, version, url) {
    // 文件名取自 URL，如 惠康中医-本地-Setup-1.0.1.exe
    const urlFileName = url.split('/').pop() || `${channel}-${version}.exe`;
    const fileName = decodeURIComponent(urlFileName);
    const dir = getDownloadDir();
    return {
        dir,
        finalPath: path.join(dir, fileName),
        partPath: path.join(dir, fileName + '.part'),
        metaPath: path.join(dir, fileName + '.meta.json')
    };
}

// 读取已下载的字节数（用于断点续传）
function getDownloadedSize(partPath) {
    try {
        if (!fs.existsSync(partPath)) return 0;
        const stat = fs.statSync(partPath);
        return stat.size;
    } catch (e) {
        return 0;
    }
}

// ★ 核心下载函数：支持断点续传
// 用 https.get + Range header，流式写入 .part 文件
function downloadWithResume(url, partPath, expectedTotalSize, onProgress) {
    return new Promise((resolve, reject) => {
        const startByte = getDownloadedSize(partPath);
        console.log(`[Update] 开始下载（断点续传）: 从 ${startByte} 字节开始, URL: ${url}`);

        const options = {
            headers: {}
        };
        if (startByte > 0) {
            options.headers['Range'] = `bytes=${startByte}-`;
        }

        const protocol = url.startsWith('https://') ? https : http;
        const req = protocol.get(url, options, (res) => {
            // 处理重定向
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                return resolve(downloadWithResume(res.headers.location, partPath, expectedTotalSize, onProgress));
            }

            // 检查状态码
            // 200 = 完整下载（从头开始）；206 = 部分下载（断点续传）
            if (res.statusCode !== 200 && res.statusCode !== 206) {
                return reject(new Error(`HTTP ${res.statusCode}`));
            }

            // 服务端是否支持断点续传
            const supportsResume = res.headers['accept-ranges'] === 'bytes' ||
                                   res.statusCode === 206;
            if (!supportsResume && startByte > 0) {
                // 服务端不支持断点续传，必须从头开始
                console.log('[Update] 服务端不支持断点续传，从头下载');
            }

            // 计算总大小
            let totalSize = expectedTotalSize;
            if (res.headers['content-range']) {
                // 格式：bytes 0-1023/2048
                const match = res.headers['content-range'].match(/\/(\d+)/);
                if (match) totalSize = parseInt(match[1], 10);
            } else if (res.headers['content-length']) {
                const cl = parseInt(res.headers['content-length'], 10);
                totalSize = supportsResume ? startByte + cl : cl;
            }

            // 打开文件流（追加模式如果是断点续传）
            const flags = (supportsResume && startByte > 0) ? 'a' : 'w';
            const fileStream = fs.createWriteStream(partPath, { flags });
            let downloadedSize = (flags === 'a') ? startByte : 0;

            res.pipe(fileStream);

            res.on('data', (chunk) => {
                downloadedSize += chunk.length;
                if (onProgress && totalSize > 0) {
                    onProgress({
                        downloaded: downloadedSize,
                        total: totalSize,
                        percent: Math.floor(downloadedSize * 100 / totalSize)
                    });
                }
            });

            fileStream.on('finish', () => {
                fileStream.close();
                // 校验大小
                if (totalSize > 0 && downloadedSize < totalSize) {
                    return reject(new Error(`下载不完整: ${downloadedSize}/${totalSize}`));
                }
                console.log(`[Update] 下载完成: ${downloadedSize} 字节`);
                resolve({ downloadedSize, totalSize });
            });

            fileStream.on('error', (err) => {
                reject(new Error('文件写入失败: ' + err.message));
            });
        });

        req.on('error', (err) => {
            reject(new Error('网络请求失败: ' + err.message));
        });

        // 30 分钟超时（大文件下载）
        req.setTimeout(30 * 60 * 1000, () => {
            req.destroy(new Error('下载超时'));
        });
    });
}

// 下载并安装
async function downloadAndUpdate(updateInfo, dialogTitle) {
    const isPortable = process.execPath.toLowerCase().includes('-') &&
                       !process.execPath.toLowerCase().includes('setup') &&
                       !require('path').dirname(process.execPath).toLowerCase().includes('localappdata');

    const downloadUrl = isPortable && updateInfo.portableUrl ?
                        updateInfo.portableUrl :
                        (updateInfo.url || updateInfo.portableUrl);

    if (!downloadUrl) {
        throw new Error('无下载地址');
    }

    const paths = getDownloadPaths(updateInfo.channel, updateInfo.version, downloadUrl);

    // 如果已存在完整文件，直接打开
    if (fs.existsSync(paths.finalPath)) {
        const stat = fs.statSync(paths.finalPath);
        if (stat.size > 1024 * 1024) {  // 至少 1MB
            console.log('[Update] 已下载完成，直接打开文件夹');
            shell.showItemInFolder(paths.finalPath);
            return { completed: true, fromCache: true };
        }
    }

    // 创建进度对话框
    const progressWin = new BrowserWindow({
        width: 480,
        height: 200,
        resizable: false,
        minimizable: false,
        maximizable: false,
        modal: !!dialogTitle,
        parent: dialogTitle ? BrowserWindow.getFocusedWindow() : undefined,
        title: '下载新版本',
        webPreferences: { nodeIntegration: false, contextIsolation: true }
    });

    progressWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`
        <html><head><meta charset="utf-8"><style>
            body { font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; padding: 30px; text-align: center; color: #333; }
            h3 { margin-bottom: 16px; }
            .progress { width: 100%; height: 20px; background: #f0f0f0; border-radius: 10px; overflow: hidden; margin: 16px 0; }
            .progress-bar { height: 100%; background: linear-gradient(90deg, #3498db, #2ecc71); transition: width 0.3s; width: 0%; }
            .status { color: #606266; font-size: 13px; }
            .cancel-btn { margin-top: 16px; padding: 6px 18px; background: #95a5a6; color: white; border: none; border-radius: 4px; cursor: pointer; }
        </style></head><body>
            <h3>正在下载 惠康中医 v${updateInfo.version}</h3>
            <div class="progress"><div class="progress-bar" id="bar"></div></div>
            <div class="status" id="status">准备下载...</div>
            <button class="cancel-btn" onclick="window.__cancel = true;">取消</button>
        </body></html>
    `));

    progressWin.on('closed', () => {
        // 用户关闭窗口不取消下载，只是隐藏窗口
        console.log('[Update] 进度窗口已关闭（下载继续进行）');
    });

    try {
        downloadTask = {
            url: downloadUrl,
            ...paths,
            channel: updateInfo.channel,
            version: updateInfo.version
        };

        const result = await downloadWithResume(downloadUrl, paths.partPath, 0, (progress) => {
            try {
                progressWin.webContents.executeJavaScript(`
                    document.getElementById('bar').style.width = '${progress.percent}%';
                    document.getElementById('status').textContent = '${progress.percent}% (${(progress.downloaded/1024/1024).toFixed(1)}MB / ${(progress.total/1024/1024).toFixed(1)}MB)';
                `).catch(() => {});
            } catch (e) {}
        });

        // 下载完成，重命名 .part → 最终文件名
        if (fs.existsSync(paths.finalPath)) {
            fs.unlinkSync(paths.finalPath);
        }
        fs.renameSync(paths.partPath, paths.finalPath);

        // 更新 UI
        try {
            await progressWin.webContents.executeJavaScript(`
                document.getElementById('bar').style.width = '100%';
                document.getElementById('status').textContent = '下载完成！';
            `);
        } catch (e) {}

        // 关闭进度窗口并提示用户
        setTimeout(() => {
            if (!progressWin.isDestroyed()) progressWin.close();
            dialog.showMessageBox({
                type: 'info',
                title: '下载完成',
                message: '新版本下载完成，已为您打开下载文件夹',
                detail: '请双击安装程序完成升级。',
                buttons: ['打开文件夹', '稍后'],
                defaultId: 0
            }).then(r => {
                if (r.response === 0) {
                    shell.showItemInFolder(paths.finalPath);
                }
            });
        }, 500);

        downloadTask = null;
        return { completed: true, fromCache: false };

    } catch (err) {
        console.error('[Update] 下载失败:', err.message);
        if (!progressWin.isDestroyed()) progressWin.close();
        downloadTask = null;

        // 失败时回退到浏览器下载
        const choice = await dialog.showMessageBox({
            type: 'warning',
            title: '下载失败',
            message: '内置下载失败：' + err.message,
            detail: '可以改用浏览器下载，已下载部分会保留用于下次续传。',
            buttons: ['用浏览器下载', '取消'],
            defaultId: 0
        });
        if (choice.response === 0) {
            shell.openExternal(downloadUrl);
        }
        throw err;
    }
}

// ============================================================================
//  显示更新通知
// ============================================================================
async function showUpdateNotification(updateInfo) {
    if (updateInfo.forceUpdate) {
        // 强制更新：显示 dialog 阻止用户继续使用
        const result = await dialog.showMessageBox({
            type: 'warning',
            title: '必须更新',
            message: `当前版本过旧，必须更新到 ${updateInfo.version} 才能继续使用`,
            detail: updateInfo.releaseNotes || '',
            buttons: ['立即下载', '退出'],
            defaultId: 0,
            cancelId: 1
        });
        if (result.response === 0) {
            try {
                await downloadAndUpdate(updateInfo, '强制更新');
            } catch (e) {
                // 已在 downloadAndUpdate 内部处理回退
            }
        }
        app.quit();
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

    notification.on('click', async () => {
        // 用户点击通知后启动下载
        try {
            await downloadAndUpdate(updateInfo);
        } catch (e) {
            console.error('[Update] 点击下载失败:', e.message);
        }
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

// ★ 任务6 新增：手动触发下载（暴露给渲染进程，便于"检查更新"按钮调用）
async function downloadNow(channel) {
    const updateInfo = await checkForUpdates(channel);
    if (updateInfo) {
        await downloadAndUpdate(updateInfo);
        return updateInfo;
    }
    return null;
}

// ★ 任务6 新增：清理下载缓存
function clearDownloadCache() {
    const dir = getDownloadDir();
    try {
        if (fs.existsSync(dir)) {
            const files = fs.readdirSync(dir);
            for (const f of files) {
                fs.unlinkSync(path.join(dir, f));
            }
            console.log(`[Update] 已清理 ${files.length} 个缓存文件`);
        }
    } catch (e) {
        console.error('[Update] 清理缓存失败:', e.message);
    }
}

module.exports = {
    init,
    checkForUpdates,
    checkNow,
    compareVersions,
    UPDATE_BASE_URL,
    downloadNow,           // ★ 任务6 新增
    clearDownloadCache     // ★ 任务6 新增
};
