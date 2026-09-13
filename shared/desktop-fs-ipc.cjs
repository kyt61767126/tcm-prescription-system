// ============================================================================
//  desktop-fs-ipc.cjs — 桌面端文件域 IPC + 目录工具（双桌面共用）
//  ★ 2026-09-13 B2-1 文件域收口：从云桌面/离线桌面两份 main.js 等体抽取
//    （19 个 IPC handler + 20 个工具函数共 39 项，双端字节级同体，经 tools 逐项哈希终验），
//    媒体保存/查找/重命名、备份读写/一键恢复、用户数据落盘、路径白名单
//    全部集中本模块唯一权威源（shared/ → sync-all 分发 → copy-consistency 哈希门）。
//  main.js 保留：端配置、license/登录/窗口域、以及本模块返回值的少量外部
//    使用点（whenReady 迁移触发 / will-download 落盘 / change-password 回退）。
//  依赖注入：createDesktopFileIpc({ ipcMain, app, dialog, shell, BrowserWindow })
//    —— 与 update-manager.cjs 同款工厂模式（P0 验证过的架构）。
//  铁律：改文件域逻辑只改本文件，禁止再改两份 main.js 内嵌副本；
//    新增 electron 域 handler 在本模块注册后，两端自动同获。
// ============================================================================
'use strict';

function createDesktopFileIpc({ ipcMain, app, dialog, shell, BrowserWindow }) {
    const fs = require('fs').promises;
    const fse = require('fs-extra');
    const path = require('path');

    // ============================================================================
    //  目录与键名工具
    // ============================================================================
    function getExeDirectory() {
        return process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(app.getPath('exe'));
    }

    // 通用目录创建：优先 exe 同级，失败回退到 userData
    // name 参数支持绝对路径或相对路径
    function ensureDirWithFallback(name, { rethrow = false } = {}) {
        const targetPath = path.isAbsolute(name) ? name : path.join(getExeDirectory(), name);
        try {
            fse.ensureDirSync(targetPath);
            return targetPath;
        } catch (error) {
            console.error(`无法创建文件夹:`, error);
            if (rethrow) throw error;
            const fallbackPath = path.join(app.getPath('userData'), path.basename(name));
            fse.ensureDirSync(fallbackPath);
            return fallbackPath;
        }
    }

    function getDataDirectory() {
        // ★ 2026-08-29 v3 数据集中：与媒体同根（安装盘\惠康中医媒体\data），备份/换机只拷一个文件夹
        return getCentralDataDir();
    }

    function getDownloadsDirectory() {
        // ★ 2026-08-29 修复重装丢媒体（v2 按用户要求改安装盘）：媒体保存到「安装盘根目录\惠康中医媒体\downloads」。
        //   演进史：v0 存安装目录（重装软件被 NSIS 清空 → 照片丢失）；v1 存 %APPDATA%（防住重装软件，
        //   但重装系统格 C 盘会丢）；v2 存安装盘根目录专属文件夹（重装软件✅不丢 + 重装C系统✅不丢 + 打开盘符即见易备份）。
        //   创建失败（如无权限）自动回退 %APPDATA%（保证可用性优先）。
        //   便携版（PORTABLE_EXECUTABLE_DIR）保持 exe 同级——便携特性：拷目录即迁移。
        if (process.env.PORTABLE_EXECUTABLE_DIR) {
            return ensureDirWithFallback('downloads');
        }
        try {
            const exeDir = getExeDirectory();
            const driveRoot = path.parse(exeDir).root; // 如 D:\
            return ensureDirWithFallback(path.join(driveRoot, '惠康中医媒体', 'downloads'), { rethrow: true });
        } catch (e) {
            console.warn('[Media] 安装盘根目录不可写，回退 userData/downloads:', e.message);
            return ensureDirWithFallback(path.join(app.getPath('userData'), 'downloads'));
        }
    }

    // ★ 全部媒体根目录（读取/扫描兼容历代位置）：
    //   v2 安装盘\惠康中医媒体\downloads + v1 userData/downloads + v0 exe 同级 downloads（存量旧文件仍可查可读）
    function getAllMediaRoots() {
        const roots = [];
        try { roots.push(path.resolve(getDownloadsDirectory())); } catch(e) {}
        try {
            const driveRoot = path.parse(getExeDirectory()).root;
            roots.push(path.resolve(driveRoot, '惠康中医媒体', 'downloads'));
        } catch(e) {}
        try { roots.push(path.resolve(getExeDirectory(), 'downloads')); } catch(e) {}
        try { roots.push(path.resolve(app.getPath('userData'), 'downloads')); } catch(e) {}
        return Array.from(new Set(roots));
    }

    // ★ 2026-08-29 数据集中 v3（用户要求"所有信息都在 D 盘一处"）：
    //   处方文字数据（save-user-data 的 data/*.json）同样保存到「安装盘根目录\惠康中医媒体\data」。
    //   与媒体同根 → 备份/换机只需拷贝一个「惠康中医媒体」文件夹。
    //   - NSIS 安装版：安装盘\惠康中医媒体\data；创建失败回退 userData/data（可用性优先）
    //   - 便携版：保持 exe 同级 data（便携特性：拷目录即迁移）
    //   ★ 兼容读取：getAppDataDirs（下）返回候选目录数组，读数据时旧位置仍可读（自动迁移在 whenReady）
    let _centralDataDir = null; // 缓存实际选定的数据目录（保存/迁移目标）
    function getCentralDataDir() {
        if (_centralDataDir) return _centralDataDir;
        if (process.env.PORTABLE_EXECUTABLE_DIR) {
            _centralDataDir = ensureDirWithFallback('data');
        } else {
            try {
                const driveRoot = path.parse(getExeDirectory()).root;
                _centralDataDir = ensureDirWithFallback(path.join(driveRoot, '惠康中医媒体', 'data'), { rethrow: true });
            } catch (e) {
                console.warn('[Data] 安装盘根目录不可写，回退 userData/data:', e.message);
                _centralDataDir = ensureDirWithFallback(path.join(app.getPath('userData'), 'data'));
            }
        }
        return _centralDataDir;
    }

    // 数据目录候选（读取兼容：新集中目录 + 旧 exe 同级 data + 旧 userData/data）
    function getAppDataDirs() {
        const dirs = [];
        try { dirs.push(path.resolve(getCentralDataDir())); } catch(e) {}
        try { dirs.push(path.resolve(getExeDirectory(), 'data')); } catch(e) {}
        try { dirs.push(path.resolve(app.getPath('userData'), 'data')); } catch(e) {}
        return Array.from(new Set(dirs));
    }

    function getCurrentMonthFolder() {
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    }

    function getCurrentMonthDirectory() {
        const monthDir = path.join(getDownloadsDirectory(), getCurrentMonthFolder());
        return ensureDirWithFallback(monthDir, { rethrow: true });
    }

    // 校验 key/文件名防止路径穿越（统一清洗非法字符）
    function sanitizeKey(key) {
        return String(key || '').replace(/[\\/:*?"<>|]/g, '_').replace(/\.\./g, '_');
    }

    // ★ 安全 key 校验：仅允许字母数字下划线短横，防止 save-user-data 路径越权
    function isSafeKey(key) {
        if (!key || typeof key !== 'string') return false;
        return /^[a-zA-Z0-9_-]{1,64}$/.test(key);
    }

    function sanitizeFileName(fileName) {
        if (typeof fileName !== 'string') return `file_${Date.now()}.webm`;
        const base = sanitizeKey(path.basename(fileName));
        return base || `file_${Date.now()}.webm`;
    }

    // ★ 路径白名单校验：仅允许访问媒体根目录（userData/downloads 新位置 + exe 同级旧位置）下的文件
    function getAllowedRoots() {
        const roots = new Set();
        getAllMediaRoots().forEach(r => roots.add(r));
        return Array.from(roots);
    }

    function isPathAllowed(filePath) {
        if (!filePath || typeof filePath !== 'string') return false;
        try {
            const resolved = path.resolve(filePath);
            for (const root of getAllowedRoots()) {
                const rel = path.relative(root, resolved);
                if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) {
                    return true;
                }
            }
            console.warn('[路径校验] 拒绝访问:', filePath);
            return false;
        } catch (e) {
            return false;
        }
    }

    async function savePrescriptionImage(imageData, fileName) {
        try {
            const monthDir = getCurrentMonthDirectory();
            const base64Data = imageData.replace(/^data:image\/[a-z]+;base64,/, '');
            const buffer = Buffer.from(base64Data, 'base64');
            const safeName = sanitizeFileName(fileName);
            const filePath = path.join(monthDir, safeName);
            if (!isPathAllowed(filePath)) return { success: false, error: '路径不在允许的下载目录内，已拒绝' };
            await fs.writeFile(filePath, buffer);
            return { success: true, filePath, directory: monthDir };
        } catch (error) {
            console.error('保存图片失败:', error);
            return { success: false, error: '保存图片失败' };
        }
    }

    // ============================================================================
    //  视频文件保存
    // ============================================================================
    async function saveVideoFile(arrayBuffer, fileName) {
        try {
            const monthDir = getCurrentMonthDirectory();
            const buffer = Buffer.from(arrayBuffer);
            const safeName = sanitizeFileName(fileName);
            let finalName = safeName;
            if (!finalName.endsWith('.webm')) {
                const base = finalName.replace(/\.[^.]+$/, '');
                finalName = base + '.webm';
            }
            const filePath = path.join(monthDir, finalName);
            if (!isPathAllowed(filePath)) return { success: false, error: '路径不在允许的下载目录内，已拒绝' };
            await fs.writeFile(filePath, buffer);
            return { success: true, filePath, directory: monthDir, fileName: finalName };
        } catch (error) {
            console.error('保存视频失败:', error);
            return { success: false, error: '保存视频失败' };
        }
    }

    // ★ 重命名处方文件（支持改姓名和编号，用于"先拍照后录入姓名"场景的媒体文件绑定）
    async function renameMediaFiles(oldPatientName, newPatientName, oldNo, newNo) {
        try {
            const sanitizeStr = s => (s || '').trim().replace(/[\/\\:*?"<>|]/g, '_').replace(/ /g, '');
            const cleanOldName = sanitizeStr(oldPatientName);
            const cleanNewName = sanitizeStr(newPatientName);
            const cleanOldNo = sanitizeStr(oldNo);
            const cleanNewNo = sanitizeStr(newNo);
            if (!cleanOldName || !cleanNewName || !cleanOldNo || !cleanNewNo) {
                return { success: true, renamed: 0 };
            }
            // 支持两种命名格式：姓名_编号 和 编号_姓名
            const oldPrefixes = [`${cleanOldName}_${cleanOldNo}`, `${cleanOldNo}_${cleanOldName}`];
            const newPrefixes = [`${cleanNewName}_${cleanNewNo}`, `${cleanNewNo}_${cleanNewName}`];
            // ★ 2026-08-29 扫描全部媒体根目录（新 userData/downloads + 旧 exe 同级 downloads）
            let renamed = 0;
            let monthDirs = [];
            for (const mediaRoot of getAllMediaRoots()) {
                try {
                    const entries = await fs.readdir(mediaRoot, { withFileTypes: true });
                    monthDirs.push(...entries.filter(e => e.isDirectory()).map(e => path.join(mediaRoot, e.name)));
                } catch (e) { /* 该媒体根目录可能不存在 */ }
            }
            for (const monthDir of monthDirs) {
                let fileEntries = [];
                try {
                    fileEntries = await fs.readdir(monthDir, { withFileTypes: true });
                } catch (e) { continue; }
                for (const fe of fileEntries) {
                    if (!fe.isFile()) continue;
                    const fileName = fe.name;
                    for (let i = 0; i < oldPrefixes.length; i++) {
                        if (!fileName.includes(oldPrefixes[i])) continue;
                        const newFileName = fileName.replace(oldPrefixes[i], newPrefixes[i]);
                        if (newFileName === fileName) continue;
                        try {
                            await fs.rename(path.join(monthDir, fileName), path.join(monthDir, newFileName));
                            renamed++;
                        } catch (e) { /* 跳过无法重命名的文件 */ }
                        break; // 匹配到一个前缀即可，避免重复替换
                    }
                }
            }
            return { success: true, renamed };
        } catch (error) {
            console.error('重命名处方文件失败:', error);
            return { success: false, error: error.message, renamed: 0 };
        }
    }

    async function saveUserData(key, data) {
        try {
            if (!isSafeKey(key)) return { success: false, error: 'key 无效' };
            const filePath = path.join(getDataDirectory(), key + '.json');
            const tmpPath = filePath + '.tmp';
            await fse.writeJson(tmpPath, data, { spaces: 2 });
            await fs.rename(tmpPath, filePath);
            return { success: true };
        } catch (error) {
            console.error('保存用户数据失败:', error);
            return { success: false, error: '保存用户数据失败' };
        }
    }

    async function getUserData(key) {
        try {
            if (!isSafeKey(key)) return { success: false, data: null };
            // ★ 2026-08-29 v3 兼容读取：优先新集中目录，旧目录（exe同级/旧userData）兜底
            const fileName = key + '.json';
            const candidateDirs = getAppDataDirs();
            for (const dir of candidateDirs) {
                const filePath = path.join(dir, fileName);
                if (await fse.pathExists(filePath)) {
                    const data = await fse.readJson(filePath);
                    return { success: true, data };
                }
            }
            return { success: false, data: null };
        } catch (error) {
            console.error('读取用户数据失败:', error);
            return { success: false, data: null };
        }
    }

    // ★ 2026-08-29 v3 存量数据自动迁移：启动时把旧位置 data/*.json 拷到新集中目录
    //   （不删除旧文件，保守起见保留双份；新写入只进新目录，旧目录自然废弃）
    async function migrateLegacyDataToCentral() {
        try {
            const centralDir = getCentralDataDir();
            const legacyDirs = getAppDataDirs().filter(d => path.resolve(d) !== path.resolve(centralDir));
            let migrated = 0;
            for (const legacyDir of legacyDirs) {
                if (!(await fse.pathExists(legacyDir))) continue;
                const entries = await fse.readdir(legacyDir, { withFileTypes: true });
                for (const entry of entries) {
                    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
                    const src = path.join(legacyDir, entry.name);
                    const dst = path.join(centralDir, entry.name);
                    // 只在目标不存在时拷贝（新目录数据优先，不回退覆盖）
                    if (await fse.pathExists(dst)) continue;
                    try {
                        await fse.copy(src, dst);
                        migrated++;
                    } catch (e) { /* 单文件失败不影响整体 */ }
                }
            }
            if (migrated > 0) {
                console.log(`[Data] 已迁移 ${migrated} 个旧数据文件到集中目录: ${centralDir}`);
            }
            return migrated;
        } catch (e) {
            console.warn('[Data] 存量数据迁移失败（不影响运行）:', e.message);
            return 0;
        }
    }

    // ============================================================================
    //  媒体/文件 IPC
    // ============================================================================
    ipcMain.handle('save-prescription-image', (event, imageData, fileName) => savePrescriptionImage(imageData, fileName));

    // ★ 视频文件保存 IPC
    ipcMain.handle('save-video-file', async (event, arrayBuffer, fileName) => {
        return await saveVideoFile(arrayBuffer, fileName);
    });

    // ★ 获取视频保存目录
    ipcMain.handle('get-video-directory', async () => {
        return getCurrentMonthDirectory();
    });

    // ★ 在文件管理器中打开视频目录
    ipcMain.handle('open-video-directory', async () => {
        const dir = getCurrentMonthDirectory();
        shell.openPath(dir);
        return { success: true, directory: dir };
    });

    // ★ 查找处方文件
    ipcMain.handle('find-media-files', async (event, patientName, prescriptionNo, createdAt) => {
        try {
            if (!patientName) return { success: true, files: [] };
            const sanitizeStr = s => (s || '').trim().replace(/[\/\\:*?"<>|]/g, '_').replace(/ /g, '');
            const cleanName = sanitizeStr(patientName);
            const identifier = sanitizeStr(prescriptionNo || '');
            const files = [];
            const foundPaths = new Set();
            const prefix1 = `${cleanName}_${identifier}`;
            const prefix2 = `${identifier}_${cleanName}`;

            // 解析 createdAt 时间范围（±1天）
            let startTime = 0, endTime = 0;
            if (createdAt) {
                try {
                    const time = new Date(createdAt).getTime();
                    if (!isNaN(time)) {
                        startTime = time - 24 * 60 * 60 * 1000;
                        endTime = time + 48 * 60 * 60 * 1000;
                    }
                } catch (e) { /* 忽略解析失败 */ }
            }

            // ★ 2026-08-29 扫描全部媒体根目录（新 userData/downloads + 旧 exe 同级 downloads）
            let monthDirs = [];
            for (const mediaRoot of getAllMediaRoots()) {
                try {
                    const entries = await fs.readdir(mediaRoot, { withFileTypes: true });
                    monthDirs.push(...entries.filter(e => e.isDirectory()).map(e => path.join(mediaRoot, e.name)));
                } catch (e) { /* 该媒体根目录可能不存在 */ }
            }
            for (const monthDir of monthDirs) {
                let fileEntries = [];
                try {
                    fileEntries = await fs.readdir(monthDir, { withFileTypes: true });
                } catch (e) { continue; }
                for (const fe of fileEntries) {
                    if (!fe.isFile()) continue;
                    const fileName = fe.name;
                    if (!fileName.includes(prefix1) && !fileName.includes(prefix2)) continue;
                    const filePath = path.join(monthDir, fileName);
                    if (foundPaths.has(filePath)) continue;
                    foundPaths.add(filePath);
                    try {
                        const stat = await fs.stat(filePath);
                        const ext = path.extname(fileName).toLowerCase();
                        const isVideo = ext === '.webm' || ext === '.mp4' || ext === '.avi' || ext === '.mov';
                        files.push({
                            name: fileName,
                            path: filePath,
                            type: isVideo ? 'video' : 'image',
                            size: stat.size,
                            lastModified: stat.mtimeMs
                        });
                    } catch (e) { /* 跳过无法读取的文件 */ }
                }
            }

            // 回退策略：如果按编号未找到文件，用患者姓名+创建时间范围查找
            if (files.length === 0 && cleanName) {
                const mediaKeywords = ['photo', 'video', 'prescription', 'tongue'];
                const validExtensions = ['.jpg', '.jpeg', '.png', '.webm', '.mp4', '.avi', '.mov'];
                for (const monthDir of monthDirs) {
                    let fileEntries = [];
                    try {
                        fileEntries = await fs.readdir(monthDir, { withFileTypes: true });
                    } catch (e) { continue; }
                    for (const fe of fileEntries) {
                        if (!fe.isFile()) continue;
                        const fileName = fe.name;
                        const ext = path.extname(fileName).toLowerCase();
                        if (!fileName.includes(cleanName)) continue;
                        if (!validExtensions.includes(ext)) continue;
                        if (!mediaKeywords.some(k => fileName.includes(k))) continue;
                        const filePath = path.join(monthDir, fileName);
                        if (foundPaths.has(filePath)) continue;
                        try {
                            const stat = await fs.stat(filePath);
                            if (startTime > 0 && (stat.mtimeMs < startTime || stat.mtimeMs > endTime)) continue;
                            const isVideo = ext === '.webm' || ext === '.mp4' || ext === '.avi' || ext === '.mov';
                            files.push({
                                name: fileName,
                                path: filePath,
                                type: isVideo ? 'video' : 'image',
                                size: stat.size,
                                lastModified: stat.mtimeMs
                            });
                        } catch (e) { /* 跳过无法读取的文件 */ }
                    }
                }
            }

            return { success: true, files };
        } catch (error) {
            console.error('查找处方文件失败:', error);
            return { success: false, error: error.message, files: [] };
        }
    });

    // ★ 重命名处方文件
    ipcMain.handle('rename-media-files', async (event, oldPatientName, newPatientName, oldNo, newNo) => {
        return await renameMediaFiles(oldPatientName, newPatientName, oldNo, newNo);
    });

    // ★ 删除文件 - 路径白名单校验，仅允许 downloads 目录下文件
    ipcMain.handle('delete-file', async (event, filePath) => {
        try {
            if (!filePath) return { success: false, error: '文件路径为空' };
            if (!isPathAllowed(filePath)) return { success: false, error: '路径不在允许的目录内，已拒绝' };
            await fs.unlink(filePath);
            return { success: true };
        } catch (error) {
            console.error('删除文件失败:', error);
            return { success: false, error: error.message };
        }
    });

    // ★ 打开文件（系统默认程序）- 路径白名单校验
    ipcMain.handle('open-file', async (event, filePath, mimeType) => {
        try {
            if (!filePath) return { success: false, error: '文件路径为空' };
            if (!isPathAllowed(filePath)) return { success: false, error: '路径不在允许的目录内，已拒绝' };
            await shell.openPath(filePath);
            return { success: true };
        } catch (error) {
            console.error('打开文件失败:', error);
            return { success: false, error: error.message };
        }
    });

    // ★ 读取文件为Base64 - 路径白名单校验
    ipcMain.handle('read-file-as-base64', async (event, filePath) => {
        try {
            if (!filePath) return { success: false, error: '文件路径为空' };
            if (!isPathAllowed(filePath)) return { success: false, error: '路径不在允许的目录内，已拒绝' };
            const buffer = await fs.readFile(filePath);
            const ext = path.extname(filePath).toLowerCase();
            let mimeType = 'image/png';
            if (ext === '.jpg' || ext === '.jpeg') mimeType = 'image/jpeg';
            else if (ext === '.png') mimeType = 'image/png';
            else if (ext === '.webm') mimeType = 'video/webm';
            else if (ext === '.mp4') mimeType = 'video/mp4';
            const base64 = buffer.toString('base64');
            return { success: true, base64: `data:${mimeType};base64,${base64}` };
        } catch (error) {
            console.error('读取文件失败:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('save-user-data', (event, key, data) => saveUserData(key, data));
    ipcMain.handle('get-user-data', (event, key) => getUserData(key));

    // ===== 🔧 历史处方修复 IPC ②：直接读取 userData/prescriptions.json (云端 19 条硬备份) =====
    ipcMain.handle('fs:read-prescriptions-json', async () => {
        try {
            const ud = app.getPath('userData');
            const f1 = path.join(ud, 'prescriptions.json');
            if (await fse.pathExists(f1)) {
                const c = await fse.readFile(f1, 'utf8');
                try { return { success: true, data: JSON.parse(c), _path: f1 }; } catch(e) { return { success:false, raw: c }; }
            }
            const pD = path.join(ud, 'Partitions');
            if (await fse.pathExists(pD)) {
                const subs = await fse.readdir(pD);
                for (const sub of subs) {
                    const pf = path.join(pD, sub, 'prescriptions.json');
                    if (await fse.pathExists(pf)) {
                        const c = await fse.readFile(pf, 'utf8');
                        try { return { success:true, data: JSON.parse(c), _path: pf }; } catch(e){}
                    }
                }
            }
        } catch(e) { console.error('fs:read-prescriptions-json fail:',e); }
        return { success: false };
    });

    // ============================================================================
    //  备份 IPC
    // ============================================================================
    // 备份文件保存：写入「惠康中医媒体\downloads\中医处方系统\」子目录（与APP端命名一致，2026-08-29）
    ipcMain.handle('save-backup-file', async (event, jsonStr, fileName) => {
        try {
            const safeName = sanitizeFileName(fileName);
            if (!safeName.endsWith('.json')) return { success: false, error: '文件名无效（仅允许 .json）' };
            const backupDir = path.join(getDownloadsDirectory(), '中医处方系统');
            fse.ensureDirSync(backupDir);
            const filePath = path.join(backupDir, safeName);
            if (!isPathAllowed(filePath)) return { success: false, error: '路径不在允许的下载目录内，已拒绝' };
            await fs.writeFile(filePath, jsonStr, 'utf8');
            return { success: true, fileName: safeName, filePath };
        } catch (error) {
            console.error('保存备份文件失败:', error);
            return { success: false, error: '保存备份文件失败' };
        }
    });

    // 一键恢复：列出备份文件（中医处方系统/ 子目录 + downloads 根存量，按时间倒序）
    ipcMain.handle('list-backup-files', async () => {
        try {
            const base = getDownloadsDirectory();
            const dirs = [path.join(base, '中医处方系统'), base];
            const seen = new Set();
            const files = [];
            for (const dir of dirs) {
                // ★ 2026-08-31 修复：顶部 fs=require('fs').promises 没有 existsSync，
                //   原 fs.existsSync 抛 TypeError → handler catch 返回 success:false
                //   → 前端误报"未找到备份文件"（备份明明写入成功）。必须用同步版 require('fs')。
                if (!require('fs').existsSync(dir)) continue;
                const entries = await fs.readdir(dir);
                for (const name of entries) {
                    if (!name.endsWith('.json') || seen.has(name)) continue;
                    seen.add(name);
                    try {
                        const st = await fs.stat(path.join(dir, name));
                        if (st.isFile()) files.push({ fileName: name, size: st.size, lastModified: st.mtimeMs });
                    } catch (e) {}
                }
            }
            files.sort((a, b) => b.lastModified - a.lastModified);
            return { success: true, files: files.slice(0, 20) };
        } catch (e) {
            return { success: false, error: e.message };
        }
    });

    // 一键恢复：按文件名读取备份内容（兼容子目录与 downloads 根存量）
    ipcMain.handle('read-backup-file', async (event, fileName) => {
        try {
            const safeName = sanitizeFileName(fileName);
            if (!safeName.endsWith('.json')) return { success: false, error: '文件名无效' };
            const base = getDownloadsDirectory();
            const candidates = [path.join(base, '中医处方系统', safeName), path.join(base, safeName)];
            for (const fp of candidates) {
                if (!isPathAllowed(fp)) continue;
                // ★ 2026-08-31 修复：fs(promises) 无 existsSync（同 list-backup-files）
                if (require('fs').existsSync(fp)) {
                    const json = await fs.readFile(fp, 'utf8');
                    return { success: true, json };
                }
            }
            return { success: false, error: '未找到备份文件: ' + safeName };
        } catch (e) {
            return { success: false, error: e.message };
        }
    });

    // ★ 2026-08-31 一键恢复兜底：原生文件选择对话框 + 直接读取备份内容
    //   根因：alert 已被替换为原生同步 dialog（阻塞 renderer 主线程）→ 用户激活丢失 →
    //   渲染层 input.click() 的 FileChooser 被 Chromium 静默拒绝（用户"看不到文件选择器"）。
    //   主进程 dialog.showOpenDialog 无用户激活限制，是最可靠的兜底通道。
    ipcMain.handle('open-backup-picker', async () => {
        try {
            let win = null;
            try { win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0] || null; } catch (e) {}
            const base = getDownloadsDirectory();
            const result = await dialog.showOpenDialog(win, {
                title: '选择备份文件（.json）',
                defaultPath: path.join(base, '中医处方系统'),
                filters: [{ name: '备份 JSON', extensions: ['json'] }],
                properties: ['openFile']
            });
            if (!result || result.canceled || !result.filePaths || result.filePaths.length === 0) {
                return { success: false, canceled: true };
            }
            const fp = result.filePaths[0];
            const json = await fs.readFile(fp, 'utf8');
            return { success: true, json, fileName: path.basename(fp) };
        } catch (e) {
            return { success: false, error: e.message };
        }
    });

    // P1-1 自动备份策略：保存到 userData/backups/（独立目录，便于清理）
    // 文件名格式：backup_YYYYMMDD_HHmmss.json
    ipcMain.handle('save-auto-backup', async (event, jsonStr, fileName) => {
        try {
            const safeName = sanitizeFileName(fileName);
            if (!safeName.endsWith('.json')) return { success: false, error: '文件名无效（仅允许 .json）' };
            if (!/^backup_\d{8}_\d{6}\.json$/.test(safeName)) {
                return { success: false, error: '文件名格式不符（backup_YYYYMMDD_HHmmss.json）' };
            }
            const backupsDir = path.join(app.getPath('userData'), 'backups');
            fse.ensureDirSync(backupsDir);
            const filePath = path.join(backupsDir, safeName);
            await fs.writeFile(filePath, jsonStr, 'utf8');
            return { success: true, fileName: safeName, filePath };
        } catch (error) {
            console.error('保存自动备份失败:', error);
            return { success: false, error: '保存自动备份失败' };
        }
    });

    // P1-1 列出所有自动备份文件（按时间倒序）
    ipcMain.handle('list-auto-backups', async () => {
        try {
            const backupsDir = path.join(app.getPath('userData'), 'backups');
            if (!fse.existsSync(backupsDir)) return { success: true, files: [] };
            const entries = await fs.readdir(backupsDir, { withFileTypes: true });
            const files = [];
            for (const e of entries) {
                if (!e.isFile() || !e.name.startsWith('backup_') || !e.name.endsWith('.json')) continue;
                const filePath = path.join(backupsDir, e.name);
                const stat = await fs.stat(filePath);
                files.push({
                    fileName: e.name,
                    timestamp: stat.mtimeMs || stat.ctimeMs || Date.now(),
                    size: stat.size
                });
            }
            files.sort((a, b) => b.timestamp - a.timestamp);
            return { success: true, files };
        } catch (error) {
            console.error('列出自动备份失败:', error);
            return { success: false, files: [], error: error.message };
        }
    });

    // P1-1 删除指定自动备份文件
    ipcMain.handle('delete-auto-backup', async (event, fileName) => {
        try {
            const safeName = sanitizeFileName(fileName);
            if (!/^backup_\d{8}_\d{6}\.json$/.test(safeName)) {
                return { success: false, error: '文件名格式不符' };
            }
            const backupsDir = path.join(app.getPath('userData'), 'backups');
            const filePath = path.join(backupsDir, safeName);
            // 路径白名单校验：仅允许访问 backups 目录
            const resolved = path.resolve(filePath);
            const backupsRoot = path.resolve(backupsDir);
            const rel = path.relative(backupsRoot, resolved);
            if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
                return { success: false, error: '路径越权已拒绝' };
            }
            if (fse.existsSync(filePath)) {
                await fs.unlink(filePath);
                return { success: true };
            }
            return { success: true, message: '文件不存在' };
        } catch (error) {
            console.error('删除自动备份失败:', error);
            return { success: false, error: error.message };
        }
    });

    // ==================== 导出（main.js 外部使用点）====================
    return {
        getExeDirectory,
        ensureDirWithFallback,
        getDataDirectory,
        getDownloadsDirectory,
        getAllMediaRoots,
        getCentralDataDir,
        getAppDataDirs,
        getCurrentMonthFolder,
        getCurrentMonthDirectory,
        sanitizeKey,
        isSafeKey,
        sanitizeFileName,
        getAllowedRoots,
        isPathAllowed,
        savePrescriptionImage,
        saveVideoFile,
        renameMediaFiles,
        saveUserData,
        getUserData,
        migrateLegacyDataToCentral
    };
}

module.exports = { createDesktopFileIpc };
