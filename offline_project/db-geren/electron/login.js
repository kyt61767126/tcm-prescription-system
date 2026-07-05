// ============================================================================
//  login.js - 登录窗口逻辑（个人版：单用户登录，用户名固定显示医师姓名）
//  不依赖 nodeIntegration，通过 electronAPI 调用主进程
// ============================================================================
(function () {
    'use strict';

    const KEY_USERS = 'local_systemUsers';
    const KEY_REMEMBER_PWD = 'local_rememberedPassword';
    const KEY_CLINIC_NAME = 'local_clinicName';

    const DEFAULT_USERS = [
        { username: 'admin', password: 'admin', name: '管理员', role: 'admin' },
        { username: 'doctor1', password: '123456', name: '张医生', role: 'user' },
        { username: 'doctor2', password: '123456', name: '李医生', role: 'user' }
    ];

    const PASSWORD_SALT = 'bnzc_prescription_salt_v1';
    async function hashPassword(password) {
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

        // 显示医师姓名（CONFIG 优先）
        const doctorName = config.doctorName || (loginUserInfo ? loginUserInfo.name : '用户');
        input.value = doctorName;

        // 记住密码
        const rememberedPwd = localStorage.getItem(KEY_REMEMBER_PWD);
        if (rememberedPwd) {
            $('loginPassword').value = rememberedPwd;
            $('rememberPassword').checked = true;
        }
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
        localStorage.setItem('isLoggedIn', 'true');

        const remember = $('rememberPassword').checked;
        if (remember) {
            localStorage.setItem(KEY_REMEMBER_PWD, password);
        } else {
            localStorage.removeItem(KEY_REMEMBER_PWD);
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
        $('btnOk').addEventListener('click', handleLogin);
        $('btnCancel').addEventListener('click', handleCancel);
        $('loginPassword').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') handleLogin();
        });
    });
})();
