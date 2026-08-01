/**
 * hot-update.js - 桌面版热更新模块（Electron主进程）
 *
 * 功能：
 *   1. 启动时检查云端版本号（异步）
 *   2. 有新版本时下载 package.zip 并解压到 userData/hot-update/
 *   3. BrowserWindow 优先加载热更新目录的 index.html
 *
 * 用法（在 main.js 中）：
 *   const hotUpdate = require('./hot-update');
 *   const hotUpdatePath = hotUpdate.getHotUpdateIndexPath(app, versionName);
 *   hotUpdate.checkAndDownloadUpdate(app, versionName);
 *   // 加载逻辑
 *   if (hotUpdatePath) {
 *       mainWindow.loadFile(hotUpdatePath);
 *   } else {
 *       mainWindow.loadFile(path.join(__dirname, 'index.html'));
 *   }
 */

const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const https = require('https');
const os = require('os');
const { execSync } = require('child_process');

const CLOUD_HOST = 'tcm-prescription-system.pages.dev';

/**
 * 获取热更新目录
 */
function getHotUpdateDir(appObj) {
    return path.join(appObj.getPath('userData'), 'hot-update');
}

/**
 * 获取热更新 index.html 路径
 * @return {string|null} 如果存在返回路径，否则 null
 */
function getHotUpdateIndexPath(appObj) {
    const indexPath = path.join(getHotUpdateDir(appObj), 'index.html');
    if (fs.existsSync(indexPath)) {
        return indexPath;
    }
    return null;
}

/**
 * 获取本地版本号
 */
function getLocalVersion(appObj) {
    try {
        const versionFile = path.join(getHotUpdateDir(appObj), '.version');
        if (fs.existsSync(versionFile)) {
            return fs.readFileSync(versionFile, 'utf8').trim();
        }
    } catch (e) { /* ignore */ }
    return '';
}

/**
 * 保存本地版本号
 */
function saveLocalVersion(appObj, version) {
    try {
        const versionFile = path.join(getHotUpdateDir(appObj), '.version');
        fs.mkdirSync(path.dirname(versionFile), { recursive: true });
        fs.writeFileSync(versionFile, version, 'utf8');
    } catch (e) {
        console.error('[HotUpdate] 保存版本号失败:', e);
    }
}

/**
 * 获取云端最新版本号
 */
function fetchLatestVersion(versionName) {
    return new Promise((resolve) => {
        const url = `https://${CLOUD_HOST}/hot-update/${versionName}/latest.json`;
        const req = https.get(url, { timeout: 5000 }, (res) => {
            if (res.statusCode !== 200) {
                console.log('[HotUpdate] 获取版本号 HTTP', res.statusCode);
                resolve(null);
                return;
            }
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    resolve(json.version || null);
                } catch (e) {
                    console.error('[HotUpdate] 解析版本号失败:', e);
                    resolve(null);
                }
            });
        });
        req.on('error', (e) => {
            console.log('[HotUpdate] 获取版本号失败:', e.message);
            resolve(null);
        });
        req.on('timeout', () => {
            req.destroy();
            resolve(null);
        });
    });
}

/**
 * 下载文件
 */
function downloadFile(url, destPath) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(destPath);
        const req = https.get(url, { timeout: 30000 }, (res) => {
            if (res.statusCode !== 200) {
                fs.unlinkSync(destPath);
                reject(new Error(`HTTP ${res.statusCode}`));
                return;
            }
            res.pipe(file);
            file.on('finish', () => {
                file.close();
                resolve();
            });
        });
        req.on('error', (e) => {
            try { fs.unlinkSync(destPath); } catch (_) {}
            reject(e);
        });
        req.on('timeout', () => {
            req.destroy();
            try { fs.unlinkSync(destPath); } catch (_) {}
            reject(new Error('下载超时'));
        });
    });
}

/**
 * 解压 ZIP 文件（使用 PowerShell Expand-Archive）
 */
function extractZip(zipPath, targetDir) {
    try {
        fs.mkdirSync(targetDir, { recursive: true });
        // 使用 PowerShell 解压（Windows 内置）
        const cmd = `powershell -NoProfile -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${targetDir}' -Force"`;
        execSync(cmd, { stdio: 'ignore' });
        return true;
    } catch (e) {
        console.error('[HotUpdate] 解压失败:', e);
        return false;
    }
}

/**
 * 递归删除目录
 */
function deleteRecursive(dirPath) {
    if (fs.existsSync(dirPath)) {
        fs.rmSync(dirPath, { recursive: true, force: true });
    }
}

/**
 * 异步检查并下载更新
 */
async function checkAndDownloadUpdate(appObj, versionName) {
    try {
        console.log('[HotUpdate] 开始检查热更新...');

        // 1. 获取云端版本号
        const latestVersion = await fetchLatestVersion(versionName);
        if (!latestVersion) {
            console.log('[HotUpdate] 无法获取云端版本号，跳过');
            return;
        }

        // 2. 获取本地版本号
        const localVersion = getLocalVersion(appObj);

        // 3. 比较版本号
        if (latestVersion === localVersion) {
            console.log('[HotUpdate] 已是最新版本:', localVersion);
            return;
        }

        // 4. 下载更新包
        console.log(`[HotUpdate] 发现新版本: ${latestVersion} (当前: ${localVersion})`);
        const downloadUrl = `https://${CLOUD_HOST}/hot-update/${versionName}/package.zip`;
        const tempZip = path.join(os.tmpdir(), `hot-update-${versionName}.zip`);

        await downloadFile(downloadUrl, tempZip);
        console.log('[HotUpdate] 下载完成');

        // 5. 解压到临时目录
        const tempDir = path.join(os.tmpdir(), `hot-update-extract-${Date.now()}`);
        if (!extractZip(tempZip, tempDir)) {
            console.error('[HotUpdate] 解压失败');
            try { fs.unlinkSync(tempZip); } catch (_) {}
            return;
        }
        try { fs.unlinkSync(tempZip); } catch (_) {}

        // 6. 替换热更新目录
        const hotUpdateDir = getHotUpdateDir(appObj);
        deleteRecursive(hotUpdateDir);
        fs.mkdirSync(hotUpdateDir, { recursive: true });

        // 复制文件
        const files = fs.readdirSync(tempDir);
        for (const file of files) {
            const src = path.join(tempDir, file);
            const dst = path.join(hotUpdateDir, file);
            if (fs.statSync(src).isDirectory()) {
                fs.cpSync(src, dst, { recursive: true });
            } else {
                fs.copyFileSync(src, dst);
            }
        }
        deleteRecursive(tempDir);

        // 7. 保存版本号
        saveLocalVersion(appObj, latestVersion);

        console.log(`[HotUpdate] 热更新完成: ${latestVersion}，下次启动生效`);

    } catch (e) {
        console.error('[HotUpdate] 热更新检查失败:', e);
    }
}

module.exports = {
    getHotUpdateDir,
    getHotUpdateIndexPath,
    checkAndDownloadUpdate
};
