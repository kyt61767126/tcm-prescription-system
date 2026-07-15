// ============================================================================
//  login.js - 登录窗口逻辑（本地版：多用户登录）
//  不依赖 nodeIntegration，通过 electronAPI 调用主进程
// ============================================================================
(function () {
    'use strict';

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
            return config.users.map(normalizeUser).filter(u => u.username && u.password);
        }
        return [];
    }

    function getUsersFromStorage() {
        const saved = localStorage.getItem(KEY_USERS);
        if (saved) {
            const users = safeParse(saved, []);
            if (Array.isArray(users) && users.length > 0) {
                return users.map(normalizeUser).filter(u => u.username && u.password);
            }
        }
        return [];
    }

    // 合并 config（权威用户列表）与 localStorage（主窗口可能修改过密码或新增用户）
    // 按 username 去重；对同名（name）用户追加 (username) 后缀以消除"重名用户"
    function mergeUsers(configUsers, storedUsers) {
        const cfgList = configUsers || [];
        const stoList = storedUsers || [];
        const cfgMap = new Map();
        for (const u of cfgList) { cfgMap.set(u.username, u); }
        const stoMap = new Map();
        for (const u of stoList) { stoMap.set(u.username, u); }

        const merged = [];
        // config 用户优先（权威列表），若 localStorage 有同名用户则取其密码（可能已修改）
        for (const u of cfgList) {
            const sto = stoMap.get(u.username);
            merged.push(sto ? { ...u, password: sto.password } : { ...u });
        }
        // localStorage 中 config 没有的自定义用户（主窗口新增）
        for (const u of stoList) {
            if (!cfgMap.has(u.username)) merged.push({ ...u });
        }

        // 统计 display name 出现次数，重名时追加 (username) 区分
        const nameCount = new Map();
        for (const u of merged) {
            const name = u.name || u.username;
            nameCount.set(name, (nameCount.get(name) || 0) + 1);
        }
        return merged.map(u => {
            const name = u.name || u.username;
            const displayName = nameCount.get(name) > 1 ? `${name}(${u.username})` : name;
            return { ...u, displayName };
        });
    }

    function loadClinicName(config) {
        const name = localStorage.getItem(KEY_CLINIC_NAME) || config.clinicName;
        $('clinicName').textContent = name || '本能堂中医诊所';
    }

    function initUserSelect(config) {
        const select = $('loginUsername');
        select.innerHTML = '';
        const cfg = getUsersFromConfig(config);
        const stored = getUsersFromStorage();
        const users = (cfg.length > 0 || stored.length > 0)
            ? mergeUsers(cfg, stored)
            : DEFAULT_USERS.map(normalizeUser).map(u => ({ ...u, displayName: u.name || u.username }));
        const rememberedUser = localStorage.getItem(KEY_REMEMBER_USER);
        users.forEach(u => {
            const opt = document.createElement('option');
            opt.value = u.username;
            opt.textContent = u.displayName;
            select.appendChild(opt);
        });
        if (rememberedUser) {
            select.value = rememberedUser;
            $('rememberUser').checked = true;
        }
        return users;
    }

    async function handleLogin() {
    clearError();
    const username = $('loginUsername').value;
    const password = $('loginPassword').value;
    if (!username) { showError('请选择用户'); return; }
    if (!password) { showError('请输入密码'); return; }

    const config = await getAppConfig();
    const cfg = getUsersFromConfig(config);
    const stored = getUsersFromStorage();
    const users = (cfg.length > 0 || stored.length > 0)
        ? mergeUsers(cfg, stored)
        : DEFAULT_USERS.map(normalizeUser).map(u => ({ ...u, displayName: u.name || u.username }));
    const user = users.find(u => u.username === username);

    if (!user) {
        showError('用户不存在');
        return;
    }

    const storedPwd = user.password || '';
    const isHash = /^[a-f0-9]{64}$/.test(storedPwd);
    const pwdOk = isHash ? (storedPwd === await hashPassword(password)) : (storedPwd === password);
    if (!pwdOk) {
        showError('密码错误');
        return;
    }

    localStorage.setItem('currentUser', JSON.stringify({
        username: user.username,
        name: user.name,
        role: user.role || 'user'
    }));
    localStorage.setItem('isLoggedIn', 'true');

    const remember = $('rememberUser').checked;
    if (remember) {
        localStorage.setItem(KEY_REMEMBER_USER, user.username);
    } else {
        localStorage.removeItem(KEY_REMEMBER_USER);
    }

    if (window.electronAPI && window.electronAPI.loginSuccess) {
        await window.electronAPI.loginSuccess({
            username: user.username,
            name: user.name,
            role: user.role || 'user'
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
        initUserSelect(config);
        $('btnOk').addEventListener('click', handleLogin);
        $('btnCancel').addEventListener('click', handleCancel);
        $('loginPassword').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') handleLogin();
        });
    });
})();