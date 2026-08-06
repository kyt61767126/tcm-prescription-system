// ============================================================================
//  login.js - 登录窗口逻辑（标准版：单用户登录，用户名固定显示医师姓名）
//  不依赖 nodeIntegration，通过 electronAPI 调用主进程
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
    // ★ 历史遗留账号（doctor1/doctor2/张医生/李医生）需从 localStorage 中过滤
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

    function getFirstUserFromConfig(config) {
        if (Array.isArray(config.users) && config.users.length > 0) {
            // ★ 过滤历史遗留账号（doctor1/doctor2/张医生/李医生）
            const valid = config.users.map(normalizeUser).filter(u => u.username && u.password && !LEGACY_USERNAMES.includes(u.username));
            if (valid.length > 0) return valid[0];
        }
        return null;
    }

    function getFirstUserFromStorage() {
        const saved = localStorage.getItem(KEY_USERS);
        if (saved) {
            // 先用 simpleDecrypt 解密 XORv1 格式（与 index.html getUsers 一致）
            const decrypted = simpleDecrypt(saved);
            const users = safeParse(decrypted, []);
            if (Array.isArray(users) && users.length > 0) {
                // ★ 过滤历史遗留账号（doctor1/doctor2/张医生/李医生）
                const valid = users.map(normalizeUser).filter(u => u.username && u.password && !LEGACY_USERNAMES.includes(u.username));
                if (valid.length > 0) return valid[0];
            }
        }
        return null;
    }

    function loadClinicName(config) {
        const name = localStorage.getItem(KEY_CLINIC_NAME) || config.clinicName;
        $('clinicName').textContent = name || '中医诊所';
    }

    // 缓存登录用户信息
    let loginUserInfo = null;

    function initLoginField(config) {
        const input = $('loginUsername');
        loginUserInfo = getFirstUserFromStorage() || getFirstUserFromConfig(config) || DEFAULT_USERS[0];

        // ★用户名输入框显示中文医师姓名（config.doctorName），不显示 admin/管理员
        // config.json 是权威源（saveSettings 已通过 update-clinic-info IPC 回写）
        // 不读 localStorage：file:// 同 origin 下 login.html 会读到 index.html 存的旧值，覆盖 config.json
        const doctorName = config.doctorName || (loginUserInfo && loginUserInfo.name && loginUserInfo.name !== '管理员' ? loginUserInfo.name : '本能堂');
        input.value = doctorName;

        localStorage.removeItem(KEY_REMEMBER_USER);
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

    // ★ 优化：登录防重复提交标志，避免按钮重复点击触发多次异步登录
    let _loginInFlight = false;

    function setLoginLoading(loading) {
        const btn = $('btnOk');
        const pwd = $('loginPassword');
        if (!btn) return;
        if (loading) {
            btn.disabled = true;
            btn.dataset.originalText = btn.textContent;
            btn.textContent = '登录中...';
            if (pwd) pwd.disabled = true;
        } else {
            btn.disabled = false;
            if (btn.dataset.originalText) btn.textContent = btn.dataset.originalText;
            if (pwd) pwd.disabled = false;
        }
    }

    async function handleLogin() {
        clearError();
        // ★ 优化：防重复提交
        if (_loginInFlight) return;
        if (!loginUserInfo) { showError('用户信息加载失败'); return; }
        const password = $('loginPassword').value;
        if (!password) { showError('请输入密码'); return; }

        _loginInFlight = true;
        setLoginLoading(true);
        try {
            const storedPwd = loginUserInfo.password || '';
            const isHash = /^[a-f0-9]{64}$/.test(storedPwd);
            const pwdOk = isHash ? (storedPwd === await hashPassword(password)) : (storedPwd === password);
            if (!pwdOk) {
                showError('密码错误');
                return;
            }

            // 仅写入必要字段，不写入密码
            // ★标准版：name 固定使用 config.doctorName（医师姓名），不使用 users[0].name（"管理员"）
            const cfg = await getAppConfig();
            const displayName = cfg.doctorName || loginUserInfo.name || loginUserInfo.username;
            const userData = { username: loginUserInfo.username, name: displayName, role: loginUserInfo.role || 'user' };
            const userDataStr = JSON.stringify(userData);
            const loginDataStr = JSON.stringify({ loginTime: Date.now(), username: loginUserInfo.username });

            // ★ 优化：批量并行写入 AuthCore 存储，避免串行 await 累积延迟
            if (window.AuthCore) {
                try {
                    await Promise.all([
                        AuthCore.StorageAdapter.setItem('auth:currentUser', userDataStr),
                        AuthCore.StorageAdapter.setItem('auth:isLoggedIn', 'true'),
                        AuthCore.StorageAdapter.setItem('auth:loginData', loginDataStr)
                    ]);
                } catch(e) {}
            }
            // localStorage 同步写入
            localStorage.setItem('currentUser', userDataStr);
            localStorage.setItem('isLoggedIn', 'true');

            localStorage.removeItem(KEY_REMEMBER_USER);

            // 记住密码（P0-2: 优先 safeStorage 系统级加密；移除明文回退分支）
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
        initLoginField(config);
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
