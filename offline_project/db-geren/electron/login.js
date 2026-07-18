// ============================================================================
//  login.js - 登录窗口逻辑（个人版：单用户登录，用户名固定显示医师姓名）
//  不依赖 nodeIntegration，通过 electronAPI 调用主进程
// ============================================================================
(function () {
    'use strict';

    // auth-core.js 兼容：若 window.AuthCore 可用则委托共享认证模块，否则使用本地实现作为 fallback
    const KEY_USERS = 'local_systemUsers';
    const KEY_REMEMBER_USER = 'local_rememberedUsername';
    const KEY_CLINIC_NAME = 'local_clinicName';

    const DEFAULT_USERS = [
        { username: 'admin', password: '2f1e152dfbccedc7d947d7f9d40e0790be6289309cf6904af728b3cf822c361b', name: '管理员', role: 'admin' },
        { username: 'doctor1', password: '6861055dc561644683c0e517c4e2eb68cfb5ba234ccc4c6da7fc78071771b1b1', name: '张医生', role: 'user' },
        { username: 'doctor2', password: '6861055dc561644683c0e517c4e2eb68cfb5ba234ccc4c6da7fc78071771b1b1', name: '李医生', role: 'user' }
    ];

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
            const valid = config.users.map(normalizeUser).filter(u => u.username && u.password);
            if (valid.length > 0) return valid[0];
        }
        return null;
    }

    function getFirstUserFromStorage() {
        const saved = localStorage.getItem(KEY_USERS);
        if (saved) {
            const users = safeParse(saved, []);
            if (Array.isArray(users) && users.length > 0) {
                const valid = users.map(normalizeUser).filter(u => u.username && u.password);
                if (valid.length > 0) return valid[0];
            }
        }
        return null;
    }

    function loadClinicName(config) {
        const name = localStorage.getItem(KEY_CLINIC_NAME) || config.clinicName;
        $('clinicName').textContent = name || '本能堂中医诊所';
    }

    // 缓存登录用户信息
    let loginUserInfo = null;

    function initLoginField(config) {
        const input = $('loginUsername');
        loginUserInfo = getFirstUserFromStorage() || getFirstUserFromConfig(config) || DEFAULT_USERS[0];

        const doctorName = config.doctorName || (loginUserInfo ? loginUserInfo.name : '用户');
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

    async function handleLogin() {
        clearError();
        if (!loginUserInfo) { showError('用户信息加载失败'); return; }
        const password = $('loginPassword').value;
        if (!password) { showError('请输入密码'); return; }

        const storedPwd = loginUserInfo.password || '';
        const isHash = /^[a-f0-9]{64}$/.test(storedPwd);
        const pwdOk = isHash ? (storedPwd === await hashPassword(password)) : (storedPwd === password);
        if (!pwdOk) {
            showError('密码错误');
            return;
        }

        // 仅写入必要字段，不写入密码
        localStorage.setItem('currentUser', JSON.stringify({
            username: loginUserInfo.username,
            name: loginUserInfo.name,
            role: loginUserInfo.role || 'user'
        }));
        if (window.AuthCore) {
            try {
                await AuthCore.StorageAdapter.setItem('auth:currentUser', JSON.stringify({username:loginUserInfo.username, name:loginUserInfo.name, role:loginUserInfo.role||'user'}));
                await AuthCore.StorageAdapter.setItem('auth:isLoggedIn', 'true');
                await AuthCore.StorageAdapter.setItem('auth:loginData', JSON.stringify({loginTime: Date.now(), username:loginUserInfo.username}));
            } catch(e) {}
        }
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
            await window.electronAPI.loginSuccess({
                username: loginUserInfo.username,
                name: loginUserInfo.name,
                role: loginUserInfo.role || 'user'
            });
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
