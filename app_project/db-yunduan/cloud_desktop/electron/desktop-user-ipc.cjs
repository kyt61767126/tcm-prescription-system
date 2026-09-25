// ============================================================================
//  desktop-user-ipc.cjs — 用户管理 IPC 工厂（2026-09-25 P2 user 域抽取）
//
//  两端 main.js 的用户管理 IPC 收口于此工厂，消除密码写点人肉双改。
//  通道（去重 3+1）：
//    通用 2：user:change-password / user:add（两端字节同构）；
//    仅离线 1：user:rename-username（productClass 门控）。
//
//  ★ 字节取证：handler 由生成器从改前两份 main.js 切片（非手抄），保持原缩进。
//    改前整块哈希（含分节注释行，1-based inclusive）：
//      cloud L993-1099   f323c30cb9e3fd60bf0c23ce960f1316e73071c3fa8ab6768818f161aa446bda
//      local L1392-1547  033bee500a2e6712d06a5a104cbb8ab8f50eacbe3f09a058619499be885817b0
//    （handler-only 口径，不含分节注释：cloud L994-1099 = 1f21ae21…、local L1393-1547 = 8a922a05…）
//    子块哈希：change-password be8a1864b9407858854c3aa43fd82e41803c9c2d2f65fc6c55ac979092834e95
//              rename-username 6cde588b7914a168c5069ba5442f8b29ff11be1e9b4815d98d06a4abf923aa60
//              user:add        d525f5927fd5448ea9e1a884c5fa59aa238183fad38a968490785d09bf9f923f
//
//  依赖注入：ipcMain / fse,path / licenseManager /
//    getWritableConfigPath,getDataDirectory,hashPassword / productClass。
//  安全：此域为密码/config.json 签名写点（KNOWLEDGE §7.6），
//    密码校验（≥8位+字母数字）与 signConfig 防篡改签名原样保留。
//
//  分发：shared/ → sync-all Group 23 → 2 个 electron 目录；
//    copy-consistency desktop-user-ipc 组（2 副本硬哈希门）。
//  铁律：改用户 IPC 只改本文件，禁止再改两份 main.js 内嵌副本。
//  注意：主进程域热更不可达，改动需双桌面重打 exe（可攒批）。
// ============================================================================
'use strict';

function createDesktopUserIpc(options) {
    const {
        ipcMain,
        fse, path,
        licenseManager,
        getWritableConfigPath,
        getDataDirectory,
        hashPassword,
        productClass                                        // 'cloud' | 'offline'
    } = options;

// ===== 修改用户密码 =====
ipcMain.handle('user:change-password', async (event, { username, oldPassword, newPassword }) => {
    try {
        if (!username || !newPassword) {
            return { success: false, error: '缺少用户名或新密码' };
        }
        const pwd = newPassword;
        if (pwd.length < 8) return { success: false, error: '密码至少8位' };
        if (!/[a-zA-Z]/.test(pwd) || !/[0-9]/.test(pwd)) {
            return { success: false, error: '密码必须同时包含字母和数字' };
        }

        // 更新 config.json 中的用户
        const configPath = getWritableConfigPath();
        if (await fse.pathExists(configPath)) {
            const config = await fse.readJson(configPath);
            if (config && Array.isArray(config.users)) {
                const userIdx = config.users.findIndex(u => u.username === username);
                if (userIdx !== -1) {
                    const { passwordHash, salt } = await hashPassword(pwd);
                    config.users[userIdx].password = passwordHash;
                    config.users[userIdx].passwordHash = passwordHash;
                    config.users[userIdx].salt = salt;
                    config.users[userIdx].updatedAt = new Date().toISOString();
                    // 签名保护：signConfig(config) 直接修改原对象，切勿将返回值赋值给属性（会造成循环引用）
                    licenseManager.signConfig(config);
                    await fse.writeJson(configPath, config, { spaces: 2 });
                    console.log('[User] password changed for:', username);
                    return { success: true };
                }
            }
        }

        // 回退：写入 localStorage 路径
        const userDataPath = path.join(getDataDirectory(), 'systemUsers.json');
        if (await fse.pathExists(userDataPath)) {
            const users = await fse.readJson(userDataPath);
            const userIdx = users.findIndex(u => u.username === username);
            if (userIdx !== -1) {
                const { passwordHash, salt } = await hashPassword(pwd);
                users[userIdx].password = passwordHash;
                users[userIdx].passwordHash = passwordHash;
                users[userIdx].salt = salt;
                await fse.writeJson(userDataPath, users, { spaces: 2 });
                return { success: true };
            }
        }

        return { success: false, error: '用户不存在' };
    } catch (e) {
        console.error('[User] change-password failed:', e);
        return { success: false, error: String(e) };
    }
});

    if (productClass === 'offline') {
// ===== 🔧 2026-08-26 设置登录用户名：同步 config.json（登录端权威源） =====
// 背景：登录窗合并 config.json（优先）+ localStorage。改名若只写 localStorage，
// config 里旧账号仍有效（改名后旧号还能登=漏洞），且新账号密码取自可能过期的
// 本地副本（双源漂移 → "密码错误"误报）。此 IPC 保证 config.json 与本地一致：
//   - 按 oldUsername 或 phone 定位 config 账户（兼容改名后旧号回登的自愈场景）
//   - phone 保底：旧 username 是手机号且 phone 为空 → 先落 phone（保手机号登录）
//   - newPassword 可选：一并同步新密码（改密+改名同填时），保持双源密码一致
//   - 若 config 无该账户（纯本地账号）→ no-op 返回 synced:false（本地已保存，非错误）
ipcMain.handle('user:rename-username', async (event, { oldUsername, newUsername, newPassword }) => {
    try {
        if (!oldUsername || !newUsername) return { success: false, error: '缺少原账号或新用户名' };
        const configPath = getWritableConfigPath();
        if (await fse.pathExists(configPath)) {
            const config = await fse.readJson(configPath);
            if (config && Array.isArray(config.users)) {
                let userIdx = config.users.findIndex(u => u && u.username === oldUsername);
                if (userIdx === -1) {
                    userIdx = config.users.findIndex(u => u && u.phone && String(u.phone) === String(oldUsername));
                }
                if (userIdx !== -1) {
                    const u = config.users[userIdx];
                    // phone 保底：原 username 是手机号且 phone 为空 → 先落 phone
                    if (/^1[3-9]\d{9}$/.test(String(u.username)) && !u.phone) {
                        u.phone = String(u.username);
                    }
                    u.username = newUsername;
                    if (newPassword) {
                        const { passwordHash, salt } = await hashPassword(newPassword);
                        u.password = passwordHash;
                        u.passwordHash = passwordHash;
                        u.salt = salt;
                    }
                    u.updatedAt = new Date().toISOString();
                    // 签名保护：signConfig(config) 直接修改原对象（勿赋值返回值，循环引用）
                    licenseManager.signConfig(config);
                    await fse.writeJson(configPath, config, { spaces: 2 });
                    console.log('[User] rename synced to config.json:', oldUsername, '->', newUsername);
                    return { success: true, synced: true };
                }
                return { success: true, synced: false };
            }
        }
        return { success: true, synced: false };
    } catch (e) {
        console.error('[User] rename-username failed:', e);
        return { success: false, error: String(e) };
    }
});
    }

// ===== 添加用户（注册管理员账户） =====
ipcMain.handle('user:add', async (event, { username, password, name, role }) => {
    try {
        if (!username || !password) {
            return { success: false, error: '缺少用户名或密码' };
        }
        if (password.length < 8) return { success: false, error: '密码至少8位' };
        if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
            return { success: false, error: '密码必须同时包含字母和数字' };
        }
        
        // 校验用户名格式（4-20位，以字母开头，只含字母、数字或下划线）
        const usernameRegex = /^[a-zA-Z][a-zA-Z0-9_]{3,19}$/;
        if (!usernameRegex.test(username)) {
            return { success: false, error: '用户名需为4-20位，以字母开头，只含字母、数字或下划线' };
        }

        const configPath = getWritableConfigPath();
        let config = {};
        if (await fse.pathExists(configPath)) {
            config = await fse.readJson(configPath);
        }
        if (!config.users) config.users = [];
        
        // 检查用户名是否已存在
        if (config.users.find(u => u.username === username)) {
            return { success: false, error: '用户名已存在' };
        }
        
        // 添加新用户
        const { passwordHash, salt } = await hashPassword(password);
        config.users.push({
            username: username,
            password: passwordHash,
            passwordHash: passwordHash,
            salt: salt,
            name: name || username,
            role: role || 'admin',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        });
        
        // 签名保护：signConfig(config) 直接修改原对象，切勿将返回值赋值给属性（会造成循环引用）
        licenseManager.signConfig(config);
        await fse.writeJson(configPath, config, { spaces: 2 });
        console.log('[User] add user:', username);
        return { success: true };
    } catch (e) {
        console.error('[User] add failed:', e);
        return { success: false, error: String(e) };
    }
});

}

module.exports = { createDesktopUserIpc };
