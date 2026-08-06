// ============================================================================
//  login.js - 登录窗口逻辑（不依赖 nodeIntegration，通过 electronAPI 调用主进程）
//  统一 localStorage key 前缀为 local_
//  用户列表与诊所名通过 IPC get-app-config 读取 config.json，不再正则解析 index.html
// ============================================================================
(function () {
    'use strict';

    // auth-core.js 兼容：若 window.AuthCore 可用则委托共享认证模块，否则使用本地实现作为 fallback
    const KEY_USERS = 'local_systemUsers';
    const KEY_REMEMBER_USER = 'local_rememberedUsername';
    const KEY_CLINIC_NAME = 'local_clinicName';

    const DEFAULT_USERS = [
        { username: 'admin', password: '2f1e152dfbccedc7d947d7f9d40e0790be6289309cf6904af728b3cf822c361b', name: '管理员', role: 'admin' }
    ];
    // ★ 历史遗留账号（doctor1/doctor2/张医生/李医生）需从 localStorage 和 config.users 中过滤
    const LEGACY_USERNAMES = ['doctor1', 'doctor2'];

    const PASSWORD_SALT = 'bnzc_prescription_salt_v1';
    async function hashPassword(password) {
        if (window.AuthCore) return AuthCore.hashPassword(password);
        if (!password) return '';
        try {
            const encoder = new TextEncoder();
            const data = encoder.encode(PASSWORD_SALT + password);
            const hashBuffer = await crypto.subtle.digest('SHA-256', data);
            return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
        } catch (e) {
            return password;
        }
    }

    // 与 index.html 的 simpleDecrypt 保持一致，用于解密 local_systemUsers（XORv1 格式）
    // 避免登录读不到修改后的密码（修改密码保存到 local_systemUsers 是加密的）
    function simpleDecrypt(stored) {
        if (!stored || typeof stored !== 'string') return stored;
        if (!stored.startsWith('XORv1:')) return stored;
        try {
            const text = decodeURIComponent(escape(atob(stored.substring(6))));
            const key = PASSWORD_SALT;
            let result = '';
            for (let i = 0; i < text.length; i++) {
                result += String.fromCharCode(text.charCodeAt(i) ^ key.charCodeAt(i % key.length));
            }
            return result;
        } catch(e) { return stored; }
    }

    function $(id) { return document.getElementById(id); }

    function showError(msg) {
        const el = $('loginError');
        el.textContent = msg;
        el.style.display = 'block';
    }
    function clearError() {
        $('loginError').style.display = 'none';
    }

    function safeParse(str, fallback) {
        try { return JSON.parse(str); } catch (e) { return fallback; }
    }

    function normalizeUser(u) {
        return {
            username: u.username || '',
            password: u.password || '',
            name: u.name || u.username || '',
            role: u.role || 'user'
        };
    }

    // 一次性获取 app config（IPC 缓存，避免重复跨进程调用）
    let appConfigCache = null;
    async function getAppConfig() {
        if (appConfigCache !== null) return appConfigCache;
        if (window.electronAPI && window.electronAPI.getAppConfig) {
            try {
                const r = await window.electronAPI.getAppConfig();
                if (r && r.success && r.config) {
                    appConfigCache = r.config;
                    return appConfigCache;
                }
            } catch (e) { /* ignore */ }
        }
        appConfigCache = {};
        return appConfigCache;
    }

    function getUsersFromConfig(config) {
        if (Array.isArray(config.users) && config.users.length > 0) {
            // ★ 过滤历史遗留账号（doctor1/doctor2/张医生/李医生）
            return config.users.map(normalizeUser).filter(u => u.username && u.password && !LEGACY_USERNAMES.includes(u.username));
        }
        return [];
    }

    function getUsersFromStorage() {
        const saved = localStorage.getItem(KEY_USERS);
        if (saved) {
            // 先用 simpleDecrypt 解密 XORv1 格式（与 index.html getUsers 一致）
            const decrypted = simpleDecrypt(saved);
            const users = safeParse(decrypted, []);
            if (Array.isArray(users) && users.length > 0) {
                // ★ 过滤历史遗留账号（doctor1/doctor2/张医生/李医生）
                const filtered = users.map(normalizeUser).filter(u => u.username && u.password && !LEGACY_USERNAMES.includes(u.username));
                return filtered;
            }
        }
        return [];
    }

    // 获取用户列表：优先使用 localStorage（用户管理中维护的），为空时回退到 config.json
    function getUsers(config) {
        const stored = getUsersFromStorage();
        if (stored.length > 0) {
            return stored.map(u => ({ ...u, displayName: u.name || u.username }));
        }
        const cfg = getUsersFromConfig(config);
        if (cfg.length > 0) {
            return cfg.map(u => ({ ...u, displayName: u.name || u.username }));
        }
        return DEFAULT_USERS.map(normalizeUser).map(u => ({ ...u, displayName: u.name || u.username }));
    }

    function loadClinicName(config) {
        const name = localStorage.getItem(KEY_CLINIC_NAME) || config.clinicName;
        $('clinicName').textContent = name || '本能堂中医诊所';
    }

    let _users = [];

    function initLoginDropdown(config) {
        const select = $('loginUsername');
        const users = getUsers(config);
        _users = users;
        select.innerHTML = '';
        _users.forEach(u => {
            const opt = document.createElement('option');
            opt.value = u.username;
            opt.textContent = u.displayName;
            select.appendChild(opt);
        });
        const rememberedUser = localStorage.getItem(KEY_REMEMBER_USER);
        if (rememberedUser) {
            select.value = rememberedUser;
            $('rememberUser').checked = true;
        }
    }

    // 版本权限控制
    async function initLoginPermissions() {
        try {
            if (window.Permission) {
                await Permission.init();
                Permission.applyLoginPermissions();
            }
        } catch(e) { console.warn('Login permission init failed:', e); }
    }

    // ★ 优化：登录防重复提交标志
    let _loginInFlight = false;

    function setLoginLoading(loading) {
        const btn = $('btnOk');
        const pwd = $('loginPassword');
        const select = $('loginUsername');
        if (!btn) return;
        if (loading) {
            btn.disabled = true;
            btn.dataset.originalText = btn.textContent;
            btn.textContent = '登录中...';
            if (pwd) pwd.disabled = true;
            if (select) select.disabled = true;
        } else {
            btn.disabled = false;
            if (btn.dataset.originalText) btn.textContent = btn.dataset.originalText;
            if (pwd) pwd.disabled = false;
            if (select) select.disabled = false;
        }
    }

    async function handleLogin() {
        clearError();
        // ★ 优化：防重复提交
        if (_loginInFlight) return;
        const username = $('loginUsername').value;
        const password = $('loginPassword').value;
        if (!username) { showError('请选择用户'); return; }
        if (!password) { showError('请输入密码'); return; }

        _loginInFlight = true;
        setLoginLoading(true);
        try {
            const user = _users.find(u => u.username === username);
            if (!user) {
                showError('用户名或密码错误');
                return;
            }
            const storedPwd = user.password || '';
            const isHash = /^[a-f0-9]{64}$/.test(storedPwd);
            const pwdOk = isHash ? (storedPwd === await hashPassword(password)) : (storedPwd === password);
            if (!pwdOk) {
                showError('用户名或密码错误');
                return;
            }

            // ★ 优化：批量并行写入 AuthCore 存储
            const userData = { username: user.username, name: user.name, role: user.role || 'user' };
            const userDataStr = JSON.stringify(userData);
            const loginDataStr = JSON.stringify({ loginTime: Date.now(), username: user.username });

            if (window.AuthCore) {
                try {
                    await Promise.all([
                        AuthCore.StorageAdapter.setItem('auth:currentUser', userDataStr),
                        AuthCore.StorageAdapter.setItem('auth:isLoggedIn', 'true'),
                        AuthCore.StorageAdapter.setItem('auth:loginData', loginDataStr)
                    ]);
                } catch(e) {}
            }
            localStorage.setItem('currentUser', userDataStr);
            localStorage.setItem('isLoggedIn', 'true');

            const remember = $('rememberUser').checked;
            if (remember) {
                localStorage.setItem(KEY_REMEMBER_USER, user.username);
            } else {
                localStorage.removeItem(KEY_REMEMBER_USER);
            }

            // 记住密码（P0-2: 优先 safeStorage 系统级加密）
            const rememberPassword = document.getElementById('rememberPassword');
            if (rememberPassword && rememberPassword.checked) {
                if (window.AuthCore && AuthCore.encryptPassword) {
                    const encryptedPwd = await AuthCore.encryptPassword(password);
                    if (encryptedPwd) {
                        localStorage.setItem('auth:savedPassword', encryptedPwd);
                    } else {
                        console.warn('[auth] 密码加密失败，已拒绝保存密码');
                        localStorage.removeItem('auth:savedPassword');
                        rememberPassword.checked = false;
                    }
                } else {
                    console.warn('[auth] AuthCore.encryptPassword 不可用，已拒绝保存密码');
                    localStorage.removeItem('auth:savedPassword');
                    rememberPassword.checked = false;
                }
            } else {
                localStorage.removeItem('auth:savedPassword');
            }

            if (window.electronAPI && window.electronAPI.loginSuccess) {
                await window.electronAPI.loginSuccess(userData);
            }
        } catch (e) {
            console.error('[login] handleLogin 异常:', e);
            showError('登录异常：' + (e && e.message ? e.message : '未知错误'));
        } finally {
            _loginInFlight = false;
            setLoginLoading(false);
        }
    }

    function handleCancel() {
        if (window.electronAPI && window.electronAPI.quitApp) {
            window.electronAPI.quitApp();
        }
    }

    document.addEventListener('DOMContentLoaded', async () => {
        const config = await getAppConfig();
        loadClinicName(config);
        initLoginDropdown(config);
        initLoginPermissions();
        let savedPassword = localStorage.getItem('auth:savedPassword');
        if (savedPassword) {
            if (window.AuthCore && AuthCore.decryptPassword &&
                (savedPassword.startsWith('SAFE:') || savedPassword.startsWith('PWDv1:') || savedPassword.startsWith('PWDv2:'))) {
                try {
                    const decrypted = await AuthCore.decryptPassword(savedPassword);
                    if (decrypted) {
                        savedPassword = decrypted;
                    } else {
                        console.warn('[auth] 保存的密码解密失败，请重新输入');
                        localStorage.removeItem('auth:savedPassword');
                        savedPassword = '';
                    }
                } catch (e) {
                    console.warn('[auth] 解密保存密码异常:', e);
                    localStorage.removeItem('auth:savedPassword');
                    savedPassword = '';
                }
            }
            if (savedPassword) {
                $('loginPassword').value = savedPassword;
                const rememberPassword = document.getElementById('rememberPassword');
                if (rememberPassword) rememberPassword.checked = true;
            }
        }
        $('btnOk').addEventListener('click', handleLogin);
        $('btnCancel').addEventListener('click', handleCancel);
        $('loginPassword').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') handleLogin();
        });
    });
})();
