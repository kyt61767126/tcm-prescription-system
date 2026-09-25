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
//      local L1392-1547  033bee500a2e6712d06a5a104cbb8ab8f50eacbe3f09a0586190785d09bf9f923f
//    （handler-only 口径，不含分节注释：cloud L994-1099 = 1f21ae21…、local L1393-1547 = 8a922a05…）
//    子块哈希：change-password be8a1864b9407858854c3aa43fd82e41803c9c2d2f65fc6c55ac979092834e95
//              rename-username 6cde588b7914a168c5069ba5442f8b29ff11be1e9b4815d98d06a4abf923aa60
//              user:add        d525f5927fd5448ea9e1a884c5fa59aa238183fad38a968490785d09bf9f923f
//
//  依赖注入：ipcMain / fse,path / licenseManager /
//    getWritableConfigPath,getDataDirectory,hashPassword / productClass。
//
//  ★ 2026-09-25 安全加固（P2 backlog user 域）：
//    ① 三个 handler 全部仅允许主框架（isMainFrame）调用，拒绝注入 iframe 子框架；
//    ② change-password 必须携带并校验旧密码（旧实现只解构不校验）；
//    ③ rename 服务端查重（username+phone，排除自身），真正改名必须验证
//       目标账户旧密码或管理员密码；登录窗框架仅允许密码同步、禁止改名；
//    ④ user:add 不再读取 payload.role，服务端锁定 role:'admin'；
//    ⑤ 删除 systemUsers.json 裸数组无签名回退分支（生产无写入路径，属历史死代码）；
//    ⑥ 新密码由注入的 hashPassword 落 PBKDF2 慢哈希；验密本文件内置
//       PBKDF2 / 旧全局盐 SHA256 / 旧用户名盐 SHA256 / 历史明文 全兼容。
//
//  分发：shared/ → sync-all Group 23 → 2 个 electron 目录；
//    copy-consistency desktop-user-ipc 组（2 副本硬哈希门）。
//  铁律：改用户 IPC 只改本文件，禁止再改两份 main.js 内嵌副本。
//  注意：主进程域热更不可达，改动需双桌面重打 exe（可攒批）。
// ============================================================================
'use strict';

const crypto = require('crypto');

const LEGACY_GLOBAL_SALT = 'bnzc_prescription_salt_v1';
// pbkdf2_sha256$<iterations>$<saltHex 32>$<derivedKeyHex 64>
const STRONG_HASH_RE = /^pbkdf2_sha256\$(\d+)\$([0-9a-f]{32})\$([0-9a-f]{64})$/;

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

    // ---- 调用帧守卫 -----------------------------------------------------
    function isMainFrameCall(event) {
        return !!(event && event.senderFrame && event.senderFrame.isMainFrame);
    }
    function isLoginFrameCall(event) {
        // 独立登录窗口 loadFile('login.html')；主窗为 index.html
        // ★ 2026-09-25 审查修复：只校验 pathname——旧正则对整串 URL 匹配，
        //   `index.html#login.html`（主窗改 hash，同文档导航不重载）会被误判为
        //   登录窗从而绕过改密证明。pathname 不受 query/hash 影响。
        try {
            const u = (event.senderFrame && event.senderFrame.url) || '';
            if (!u) return false;
            const parsed = new URL(u);
            return /(?:^|\/)login\.html$/.test(parsed.pathname);
        } catch (_) { return false; }
    }

    // ---- 密码校验（同步；仅在主进程内部使用） ---------------------------
    function isStrongHash(stored) {
        return typeof stored === 'string' && STRONG_HASH_RE.test(stored);
    }

    // hints: 旧的每用户盐盐基（username / phone），按顺序回退
    function verifyStoredPassword(input, stored, hints) {
        if (typeof input !== 'string' || typeof stored !== 'string' || !stored) return false;
        const m = stored.match(STRONG_HASH_RE);
        if (m) {
            try {
                const dk = crypto.pbkdf2Sync(input, Buffer.from(m[2], 'hex'), parseInt(m[1], 10), 32, 'sha256');
                return crypto.timingSafeEqual(dk, Buffer.from(m[3], 'hex'));
            } catch (_) { return false; }
        }
        if (/^[a-f0-9]{64}$/.test(stored)) {
            const candidates = [
                crypto.createHash('sha256').update(LEGACY_GLOBAL_SALT + input).digest('hex')
            ];
            const hintList = Array.isArray(hints) ? hints : (hints ? [hints] : []);
            for (const h of hintList) {
                if (h) candidates.push(crypto.createHash('sha256').update(LEGACY_GLOBAL_SALT + ':' + h + input).digest('hex'));
            }
            return candidates.some(c => c === stored);
        }
        // 历史明文
        return stored === input;
    }

    function validateNewPassword(pwd) {
        if (typeof pwd !== 'string' || pwd.length < 8) return '密码至少8位';
        if (!/[a-zA-Z]/.test(pwd) || !/[0-9]/.test(pwd)) return '密码必须同时包含字母和数字';
        return null;
    }

    function userHints(u) {
        const list = [];
        if (u.username) list.push(u.username);
        if (u.phone && String(u.phone) !== String(u.username || '')) list.push(String(u.phone));
        return list;
    }

    // 管理员覆盖证明：config 内任一 admin 账户密码验证通过即可
    function verifyAdminProof(users, adminPassword) {
        if (!adminPassword) return false;
        return users.some((adm) => adm && (adm.role === 'admin') &&
            verifyStoredPassword(adminPassword, adm.password || '', userHints(adm)));
    }

// ===== 修改用户密码 =====
ipcMain.handle('user:change-password', async (event, { username, oldPassword, newPassword }) => {
    try {
        // ★ 加固①：仅主框架
        if (!isMainFrameCall(event)) return { success: false, error: '拒绝非主框架调用' };
        if (!username || !newPassword) {
            return { success: false, error: '缺少用户名或新密码' };
        }
        if (!oldPassword) {
            // ★ 加固②：旧密码必填（旧实现从不校验）
            return { success: false, error: '请输入原密码' };
        }
        const pwdError = validateNewPassword(newPassword);
        if (pwdError) return { success: false, error: pwdError };

        // 更新 config.json 中的用户
        const configPath = getWritableConfigPath();
        if (await fse.pathExists(configPath)) {
            const config = await fse.readJson(configPath);
            if (config && Array.isArray(config.users)) {
                const userIdx = config.users.findIndex(u => u.username === username);
                if (userIdx !== -1) {
                    const target = config.users[userIdx];
                    // ★ 加固②：主进程校验旧密码（目标自身）；管理员也可凭管理员密码改他人密码
                    const selfOk = verifyStoredPassword(oldPassword, target.password || '', userHints(target));
                    const adminOk = (!selfOk && target.role !== 'admin')
                        ? verifyAdminProof(config.users, oldPassword)
                        : false;
                    if (!selfOk && !adminOk) {
                        return { success: false, error: '原密码错误' };
                    }
                    const { passwordHash, salt } = await hashPassword(newPassword);
                    target.password = passwordHash;
                    target.passwordHash = passwordHash;
                    target.salt = salt;
                    target.updatedAt = new Date().toISOString();
                    // 签名保护：signConfig(config) 直接修改原对象，切勿将返回值赋值给属性（会造成循环引用）
                    licenseManager.signConfig(config);
                    await fse.writeJson(configPath, config, { spaces: 2 });
                    console.log('[User] password changed for:', username);
                    return { success: true };
                }
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
// 本地副本（双源漂移 → "密码错误"误报）。此 IPC 保证 config.json 与本地一致。
//
// ★ 2026-09-25 加固后契约：
//   - 必传 oldUsername；newUsername / newPassword 至少其一；
//   - 登录窗框架（login.html）：仅允许密码同步（忘记密码恢复/登录后慢哈希升级），
//     禁止改名；无需密码证明（本地单机恢复模型）；
//   - 主窗框架（index.html）：改名或改密均须证明 = 目标账户 oldPassword 验证通过
//     或任一管理员 adminPassword 验证通过；
//   - 改名服务端查重（username+phone，排除自身）；若 config 无该账户
//     （纯本地账号）→ no-op 返回 synced:false（本地已保存，非错误）。
ipcMain.handle('user:rename-username', async (event, payload) => {
    try {
        const {
            oldUsername,
            newUsername,
            newPassword,
            oldPassword,
            adminPassword
        } = payload || {};
        if (!isMainFrameCall(event)) return { success: false, error: '拒绝非主框架调用' };
        if (!oldUsername) return { success: false, error: '缺少原账号' };

        const trimmedNew = (newUsername == null ? '' : String(newUsername).trim());
        const wantsRename = !!trimmedNew;
        const wantsPwd = !!newPassword;
        if (!wantsRename && !wantsPwd) {
            return { success: false, error: '缺少新用户名或新密码' };
        }
        if (wantsPwd) {
            const pwdError = validateNewPassword(newPassword);
            if (pwdError) return { success: false, error: pwdError };
        }

        const fromLoginFrame = isLoginFrameCall(event);
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
                    const actuallyRenaming = wantsRename && trimmedNew !== String(u.username);

                    // ---- 改名分支：登录窗禁止 + 格式 + 查重 + 证明 ----
                    if (actuallyRenaming) {
                        if (fromLoginFrame) {
                            return { success: false, error: '登录窗口不允许修改用户名' };
                        }
                        // 服务端格式兜底（渲染层已校验，防绕过）
                        if (/[\u4e00-\u9fa5]/.test(trimmedNew) ||
                            !/^[A-Za-z0-9_-]{2,30}$/.test(trimmedNew) ||
                            /^1[3-9]\d{9}$/.test(trimmedNew)) {
                            return { success: false, error: '用户名格式不合法' };
                        }
                        // 查重：username 或 phone 占用即拒绝（排除目标自身）
                        const occupied = config.users.some((other, i) => {
                            if (i === userIdx || !other) return false;
                            if (other.username === trimmedNew) return true;
                            if (other.phone && String(other.phone) === trimmedNew) return true;
                            return false;
                        });
                        if (occupied) return { success: false, error: '该用户名已被占用' };
                    }

                    // ---- 授权证明（主窗任何写操作均需证明） ----
                    if (!fromLoginFrame && (actuallyRenaming || wantsPwd)) {
                        const selfOk = !!oldPassword &&
                            verifyStoredPassword(oldPassword, u.password || '', userHints(u));
                        const adminOk = !selfOk && verifyAdminProof(config.users, adminPassword);
                        if (!selfOk && !adminOk) {
                            return { success: false, error: '需要验证原密码或管理员密码' };
                        }
                    }

                    // ---- 落盘 ----
                    if (actuallyRenaming) {
                        // phone 保底：原 username 是手机号且 phone 为空 → 先落 phone（保手机号登录）
                        if (/^1[3-9]\d{9}$/.test(String(u.username)) && !u.phone) {
                            u.phone = String(u.username);
                        }
                        u.username = trimmedNew;
                    }
                    if (wantsPwd) {
                        const { passwordHash, salt } = await hashPassword(newPassword);
                        u.password = passwordHash;
                        u.passwordHash = passwordHash;
                        u.salt = salt;
                    }
                    u.updatedAt = new Date().toISOString();
                    // 签名保护：signConfig(config) 直接修改原对象（勿赋值返回值，循环引用）
                    licenseManager.signConfig(config);
                    await fse.writeJson(configPath, config, { spaces: 2 });
                    console.log('[User] rename synced to config.json:', oldUsername, '->',
                        actuallyRenaming ? trimmedNew : '(username unchanged)',
                        wantsPwd ? '(password synced)' : '');
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
ipcMain.handle('user:add', async (event, { username, password, name }) => {
    try {
        // ★ 加固①：仅主框架
        if (!isMainFrameCall(event)) return { success: false, error: '拒绝非主框架调用' };
        if (!username || !password) {
            return { success: false, error: '缺少用户名或密码' };
        }
        const pwdError = validateNewPassword(password);
        if (pwdError) return { success: false, error: pwdError };

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
            role: 'admin',  // ★ 加固④：服务端锁定，不再读取 payload.role
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
