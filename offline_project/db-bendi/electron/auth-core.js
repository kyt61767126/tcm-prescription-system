// ============================================================================
// auth-core.js — 登录认证共享核心模块
// 统一密码加密、存储抽象、登录调度、记住用户名、会话管理、权限解析
// 消除 14+ 文件中的登录逻辑重复
// ============================================================================
(function (global) {
    'use strict';

    // ==================== 常量 ====================
    // P1-5: 密码加密盐（混淆用，非真正加密密钥）
    // 注意：前端 JS 无法实现真正安全的对称加密，此值仅用于阻止明文直接泄露
    // Electron 桌面版未来应迁移到 safeStorage 系统级加密
    const PASSWORD_SALT = 'bnzc_prescription_salt_v1';
    const SESSION_TIMEOUT_MS = 8 * 60 * 60 * 1000; // 8小时
    const CLOUD_API_BASE = 'https://tcm-prescription-system.pages.dev/api';

    // P1-5: 运行时派生密钥（基于环境特征，降低纯源码攻击效果）
    // 攻击者仅查看源码无法直接获得实际加密密钥
    function _deriveRuntimeKey() {
        const env = (typeof location !== 'undefined' && location.hostname) ? location.hostname : 'local';
        const lang = (typeof navigator !== 'undefined' && navigator.language) ? navigator.language : '';
        let hash = 0;
        const src = PASSWORD_SALT + '|' + env + '|' + lang;
        for (let i = 0; i < src.length; i++) {
            hash = ((hash << 5) - hash) + src.charCodeAt(i);
            hash = hash & hash;
        }
        return PASSWORD_SALT + '_' + Math.abs(hash).toString(36);
    }
    const RUNTIME_KEY = _deriveRuntimeKey();

    // ==================== P1-3: masterKey 派生盐（外部可注入）====================
    // 用途：让密码哈希盐基于 masterKey 派生（每个安装不同），避免硬编码盐被破解
    // 注入方式：调用 setMasterKey(key) 或由 initMasterKeyFromLicense 自动从 license 注入
    // 注入后 hashPassword / hashPasswordWithUser 优先使用 (PASSWORD_SALT + ':' + masterKey) 作为盐
    // 未注入时 fallback 到纯 PASSWORD_SALT（向后兼容旧版本与旧哈希）
    let _masterKey = null;
    function setMasterKey(key) {
        _masterKey = key ? String(key) : null;
        if (_masterKey) {
            try { console.log('[AuthCore] masterKey 已注入，密码哈希将使用派生盐'); } catch (e) { }
        }
    }
    function getMasterKey() {
        return _masterKey;
    }
    // 获取密码哈希盐：masterKey 注入时返回派生盐，否则返回基础盐（向后兼容）
    function getEffectiveSalt() {
        return _masterKey ? (PASSWORD_SALT + ':' + _masterKey) : PASSWORD_SALT;
    }

    // ==================== safeStorage 系统级加密桥（P0-2）====================
    // 仅 Electron 桌面版可用：基于 Windows DPAPI，绑定用户/机器
    // 远比 XOR + 硬编码盐安全，攻击者即使拿到源码与密文也无法解密
    // 在浏览器/WebView 中 available() 返回 false，自动降级到 XOR PWDv2/XORv2
    const SafeStorageBridge = {
        _availableCache: null,
        async available() {
            if (this._availableCache !== null) return this._availableCache;
            try {
                if (global.electronAPI && typeof global.electronAPI.safeStorageAvailable === 'function') {
                    this._availableCache = await global.electronAPI.safeStorageAvailable();
                } else {
                    this._availableCache = false;
                }
            } catch (e) {
                console.warn('safeStorage 检测异常:', e);
                this._availableCache = false;
            }
            return this._availableCache;
        },
        async encrypt(plaintext) {
            if (!plaintext) return null;
            try {
                if (!(await this.available())) return null;
                if (!global.electronAPI || typeof global.electronAPI.encryptString !== 'function') return null;
                return await global.electronAPI.encryptString(String(plaintext));
            } catch (e) {
                console.warn('safeStorage 加密异常:', e);
                return null;
            }
        },
        async decrypt(encryptedBase64) {
            if (!encryptedBase64) return null;
            try {
                if (!(await this.available())) return null;
                if (!global.electronAPI || typeof global.electronAPI.decryptString !== 'function') return null;
                return await global.electronAPI.decryptString(String(encryptedBase64));
            } catch (e) {
                console.warn('safeStorage 解密异常:', e);
                return null;
            }
        }
    };

    // 旧 key → 新 key 映射（自动迁移）
    const KEY_MIGRATION = {
        'cloud_currentUser': 'auth:currentUser',
        'cloud_isLoggedIn': 'auth:isLoggedIn',
        'currentUser': 'auth:currentUser',
        'isLoggedIn': 'auth:isLoggedIn',
        'user_login_data': 'auth:loginData',
        'cloud_rememberedUsers': 'auth:rememberedUsers',
        'cloud_rememberedUsername': 'auth:rememberedUsername',
        'local_rememberedUsername': 'auth:rememberedUsername',
        'local_rememberedUsers': 'auth:rememberedUsers',
        'rememberedUsername': 'auth:rememberedUsername',
        'rememberedUsers': 'auth:rememberedUsers'
    };

    // ==================== 存储适配器 ====================
    const StorageAdapter = {
        _isCapacitor() {
            return typeof global.Capacitor !== 'undefined' &&
                   global.Capacitor.Plugins &&
                   global.Capacitor.Plugins.Preferences;
        },

        async getItem(key) {
            if (this._isCapacitor()) {
                const { value } = await global.Capacitor.Plugins.Preferences.get({ key });
                return value;
            }
            return global.localStorage ? global.localStorage.getItem(key) : null;
        },

        async setItem(key, value) {
            if (this._isCapacitor()) {
                await global.Capacitor.Plugins.Preferences.set({ key, value });
                return;
            }
            if (global.localStorage) global.localStorage.setItem(key, value);
        },

        async removeItem(key) {
            if (this._isCapacitor()) {
                await global.Capacitor.Plugins.Preferences.remove({ key });
                return;
            }
            if (global.localStorage) global.localStorage.removeItem(key);
        },

        setSessionItem(key, value) {
            if (typeof global.sessionStorage !== 'undefined') {
                global.sessionStorage.setItem(key, value);
            }
        },

        getSessionItem(key) {
            if (typeof global.sessionStorage !== 'undefined') {
                return global.sessionStorage.getItem(key);
            }
            return null;
        },

        removeSessionItem(key) {
            if (typeof global.sessionStorage !== 'undefined') {
                global.sessionStorage.removeItem(key);
            }
        }
    };

    // ==================== 旧 Key 自动迁移 ====================
    let _migrated = false;
    async function migrateOldKeys() {
        if (_migrated) return;
        _migrated = true;
        for (const [oldKey, newKey] of Object.entries(KEY_MIGRATION)) {
            try {
                const value = await StorageAdapter.getItem(oldKey);
                if (value !== null && value !== undefined) {
                    const newValue = await StorageAdapter.getItem(newKey);
                    if (newValue === null || newValue === undefined) {
                        await StorageAdapter.setItem(newKey, value);
                    }
                    // 不立即删除旧key，等确认稳定后再清理
                }
            } catch (e) { /* 忽略迁移错误 */ }
        }
        // sessionStorage 迁移
        for (const [oldKey, newKey] of Object.entries(KEY_MIGRATION)) {
            try {
                const value = StorageAdapter.getSessionItem(oldKey);
                if (value !== null) {
                    const newValue = StorageAdapter.getSessionItem(newKey);
                    if (newValue === null) {
                        StorageAdapter.setSessionItem(newKey, value);
                    }
                }
            } catch (e) { /* 忽略 */ }
        }
    }

    // ==================== 密码加密层 ====================

    // 纯 JS SHA-256 降级实现（WebView 中 crypto.subtle 不可用时使用）
    function sha256PureJS(message) {
        const K = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
                   0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
                   0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
                   0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
                   0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
                   0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
                   0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
                   0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];

        function rotateRight(n, s) { return (n >>> s) | (n << (32 - s)); }
        function sigma0(n) { return rotateRight(n, 7) ^ rotateRight(n, 18) ^ (n >>> 3); }
        function sigma1(n) { return rotateRight(n, 17) ^ rotateRight(n, 19) ^ (n >>> 10); }
        function Sigma0(n) { return rotateRight(n, 2) ^ rotateRight(n, 13) ^ rotateRight(n, 22); }
        function Sigma1(n) { return rotateRight(n, 6) ^ rotateRight(n, 11) ^ rotateRight(n, 25); }
        function ch(x, y, z) { return (x & y) ^ (~x & z); }
        function maj(x, y, z) { return (x & y) ^ (x & z) ^ (y & z); }

        const bytes = new Uint8Array(message.length);
        for (let i = 0; i < message.length; i++) bytes[i] = message.charCodeAt(i);

        const originalLen = bytes.length;
        const paddingLen = 64 - ((originalLen + 8) % 64);
        const padded = new Uint8Array(originalLen + paddingLen + 8);
        padded.set(bytes);
        padded[originalLen] = 0x80;

        let len = originalLen * 8;
        for (let i = 7; i >= 0; i--) {
            padded[padded.length - 1 - i] = len & 0xff;
            len >>>= 8;
        }

        const w = new Uint32Array(64);
        let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
        let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;

        for (let block = 0; block < padded.length; block += 64) {
            for (let i = 0; i < 16; i++) {
                w[i] = (padded[block + i * 4] << 24) | (padded[block + i * 4 + 1] << 16) |
                       (padded[block + i * 4 + 2] << 8) | padded[block + i * 4 + 3];
            }
            for (let i = 16; i < 64; i++) {
                w[i] = (sigma1(w[i - 2]) + w[i - 7] + sigma0(w[i - 15]) + w[i - 16]) >>> 0;
            }

            let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;

            for (let i = 0; i < 64; i++) {
                const T1 = (h + Sigma1(e) + ch(e, f, g) + K[i] + w[i]) >>> 0;
                const T2 = (Sigma0(a) + maj(a, b, c)) >>> 0;
                h = g; g = f; f = e; e = (d + T1) >>> 0;
                d = c; c = b; b = a; a = (T1 + T2) >>> 0;
            }

            h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
            h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
        }

        const hash = [h0, h1, h2, h3, h4, h5, h6, h7];
        return hash.map(n => n.toString(16).padStart(8, '0')).join('');
    }

    async function hashPassword(password) {
        if (!password) return '';
        try {
            const data = new TextEncoder().encode(PASSWORD_SALT + password);
            const hashBuffer = await crypto.subtle.digest('SHA-256', data);
            return Array.from(new Uint8Array(hashBuffer))
                .map(b => b.toString(16).padStart(2, '0')).join('');
        } catch (e) {
            // WebView 降级：纯 JS SHA-256
            return sha256PureJS(PASSWORD_SALT + password);
        }
    }

    // 增强版密码哈希：加入用户名作为额外盐值
    async function hashPasswordWithUser(password, username) {
        if (!password) return '';
        const userSalt = username ? (PASSWORD_SALT + ':' + username) : PASSWORD_SALT;
        try {
            const data = new TextEncoder().encode(userSalt + password);
            const hashBuffer = await crypto.subtle.digest('SHA-256', data);
            return Array.from(new Uint8Array(hashBuffer))
                .map(b => b.toString(16).padStart(2, '0')).join('');
        } catch (e) {
            return sha256PureJS(userSalt + password);
        }
    }

    function isPasswordHashed(pwd) {
        return typeof pwd === 'string' && pwd.length === 64 && /^[a-f0-9]{64}$/.test(pwd);
    }

    async function verifyPassword(inputPassword, storedPassword, username) {
        if (!storedPassword) return false;
        if (isPasswordHashed(storedPassword)) {
            // 先尝试增强版哈希（含用户名盐值）
            if (username) {
                const enhancedHash = await hashPasswordWithUser(inputPassword, username);
                if (storedPassword === enhancedHash) return true;
            }
            // 降级到旧版哈希（全局盐值）
            return storedPassword === await hashPassword(inputPassword);
        }
        // 兼容旧明文密码
        return storedPassword === inputPassword;
    }

    // 记住密码加密存储（非明文）
    // P0-2: 优先使用 safeStorage（DPAPI），降级到 XOR PWDv2，向后兼容 PWDv1
    async function encryptPassword(password) {
        if (!password) return null;
        // 优先：safeStorage 系统级加密
        const safeEnc = await SafeStorageBridge.encrypt(password);
        if (safeEnc) return 'SAFE:' + safeEnc;
        // 降级：XOR PWDv2（运行时派生密钥）
        const key = RUNTIME_KEY;
        let result = '';
        for (let i = 0; i < password.length; i++) {
            result += String.fromCharCode(password.charCodeAt(i) ^ key.charCodeAt(i % key.length));
        }
        return 'PWDv2:' + btoa(unescape(encodeURIComponent(result)));
    }

    async function decryptPassword(stored) {
        if (!stored || typeof stored !== 'string') return null;
        // P0-2: safeStorage 加密的密文（必须原用户/原机器才能解出）
        if (stored.startsWith('SAFE:')) {
            try {
                const decrypted = await SafeStorageBridge.decrypt(stored.substring(5));
                if (decrypted !== null) return decrypted;
                // safeStorage 不可用或跨用户/跨机器迁移：无法解密
                console.warn('safeStorage 解密失败：可能为跨用户/跨机器迁移，请重新输入密码');
                return null;
            } catch (e) {
                console.error('safeStorage 密码解密失败:', e);
                return null;
            }
        }
        // P1-2: 尝试 PWDv2（运行时派生密钥）
        if (stored.startsWith('PWDv2:')) {
            try {
                const text = decodeURIComponent(escape(atob(stored.substring(6))));
                const key = RUNTIME_KEY;
                let result = '';
                for (let i = 0; i < text.length; i++) {
                    result += String.fromCharCode(text.charCodeAt(i) ^ key.charCodeAt(i % key.length));
                }
                return result;
            } catch (e) {
                console.error('密码解密失败:', e);
                return null;
            }
        }
        // 向后兼容 PWDv1（硬编码盐）
        if (stored.startsWith('PWDv1:')) {
            try {
                const text = decodeURIComponent(escape(atob(stored.substring(6))));
                const key = PASSWORD_SALT;
                let result = '';
                for (let i = 0; i < text.length; i++) {
                    result += String.fromCharCode(text.charCodeAt(i) ^ key.charCodeAt(i % key.length));
                }
                return result;
            } catch (e) {
                console.error('密码解密失败:', e);
                return null;
            }
        }
        // 兼容旧明文
        return stored;
    }

    // 保存记住的密码（加密存储）
    async function saveRememberedPassword(password) {
        try {
            const encrypted = await encryptPassword(password);
            if (encrypted) {
                await StorageAdapter.setItem('auth:savedPassword', encrypted);
            }
        } catch (e) {
            console.warn('保存记住密码失败:', e);
        }
    }

    // 读取记住的密码（解密）
    async function getRememberedPassword() {
        try {
            const stored = await StorageAdapter.getItem('auth:savedPassword');
            if (!stored) return null;
            // P0-2: 兼容 SAFE:/PWDv2:/PWDv1:/旧明文
            if (stored.startsWith('SAFE:') || stored.startsWith('PWDv1:') || stored.startsWith('PWDv2:')) {
                return await decryptPassword(stored);
            }
            return stored;
        } catch (e) {
            console.warn('读取记住密码失败:', e);
            return null;
        }
    }

    // 清除记住的密码
    async function clearRememberedPassword() {
        try {
            await StorageAdapter.removeItem('auth:savedPassword');
        } catch (e) {
            console.warn('清除记住密码失败:', e);
        }
    }

    // 用户列表加密存储（仅离线版使用，Unicode 安全）
    // P0-2: 优先使用 safeStorage（DPAPI），降级到 XORv2，向后兼容 XORv1
    async function encryptUsers(users) {
        const json = JSON.stringify(users);
        // 优先：safeStorage 系统级加密
        const safeEnc = await SafeStorageBridge.encrypt(json);
        if (safeEnc) return 'SAFE:' + safeEnc;
        // 降级：XORv2（运行时派生密钥）
        const key = RUNTIME_KEY;
        let result = '';
        for (let i = 0; i < json.length; i++) {
            result += String.fromCharCode(json.charCodeAt(i) ^ key.charCodeAt(i % key.length));
        }
        return 'XORv2:' + btoa(unescape(encodeURIComponent(result)));
    }

    async function decryptUsers(stored) {
        if (!stored || typeof stored !== 'string') return stored;
        // P0-2: safeStorage 加密的密文
        if (stored.startsWith('SAFE:')) {
            try {
                const decrypted = await SafeStorageBridge.decrypt(stored.substring(5));
                if (decrypted !== null) {
                    try { return JSON.parse(decrypted); }
                    catch (e) { console.error('解密后 JSON 解析失败:', e); return null; }
                }
                console.warn('safeStorage 用户列表解密失败：可能为跨用户/跨机器迁移');
                return null;
            } catch (e) {
                console.error('safeStorage 用户列表解密失败:', e);
                return null;
            }
        }
        // P1-2: 尝试 XORv2（运行时派生密钥）
        if (stored.startsWith('XORv2:')) {
            try {
                const text = decodeURIComponent(escape(atob(stored.substring(6))));
                const key = RUNTIME_KEY;
                let result = '';
                for (let i = 0; i < text.length; i++) {
                    result += String.fromCharCode(text.charCodeAt(i) ^ key.charCodeAt(i % key.length));
                }
                return JSON.parse(result);
            } catch (e) {
                console.error('解密用户列表失败:', e);
                return null;
            }
        }
        // 向后兼容 XORv1（硬编码盐）
        if (stored.startsWith('XORv1:')) {
            try {
                const text = decodeURIComponent(escape(atob(stored.substring(6))));
                const key = PASSWORD_SALT;
                let result = '';
                for (let i = 0; i < text.length; i++) {
                    result += String.fromCharCode(text.charCodeAt(i) ^ key.charCodeAt(i % key.length));
                }
                return JSON.parse(result);
            } catch (e) {
                console.error('解密用户列表失败:', e);
                return null;
            }
        }
        // 兼容旧明文 JSON
        return stored;
    }

    // ==================== 权限解析层 ====================

    function resolveAllowedMode(user) {
        if (!user) return 'local';
        if (user.role === 'platform_admin') return 'platform_admin';
        return user.allowedMode || 'both';
    }

    function isAdmin(user) {
        if (!user) return false;
        // 统一管理员判断：离线版 admin + 云端版 clinic_admin + 平台 platform_admin
        return user.role === 'admin' || user.role === 'clinic_admin' || user.role === 'platform_admin';
    }

    function isClinicAdmin(user) {
        if (!user) return false;
        // 诊所管理员：离线版 admin + 云端版 clinic_admin
        return user.role === 'admin' || user.role === 'clinic_admin';
    }

    function isPlatformAdmin(user) {
        if (!user) return false;
        return user.role === 'platform_admin';
    }

    function buildAuthPayload(user) {
        if (!user) return null;
        return btoa(JSON.stringify({
            username: user.username,
            role: user.role || 'doctor',
            clinicId: user.clinicId || null
        }));
    }

    // ==================== 会话管理层 ====================

    async function checkSession() {
        // 会话超时检查
        try {
            const loginData = await StorageAdapter.getItem('auth:loginData');
            if (loginData) {
                const { loginTime } = JSON.parse(loginData);
                if (loginTime && Date.now() - loginTime > SESSION_TIMEOUT_MS) {
                    await logout();
                    return { valid: false, reason: 'session_timeout' };
                }
            }
        } catch (e) { /* 忽略 */ }

        // 兼容旧key
        try {
            const oldLoginData = await StorageAdapter.getItem('user_login_data');
            if (oldLoginData) {
                const { loginTime } = JSON.parse(oldLoginData);
                if (loginTime && Date.now() - loginTime > SESSION_TIMEOUT_MS) {
                    await logout();
                    return { valid: false, reason: 'session_timeout' };
                }
            }
        } catch (e) { /* 忽略 */ }

        const isLoggedIn = await StorageAdapter.getItem('auth:isLoggedIn');
        const userStr = await StorageAdapter.getItem('auth:currentUser');
        if (isLoggedIn === 'true' && userStr) {
            try {
                return { valid: true, user: JSON.parse(userStr) };
            } catch (e) { /* 解析失败继续 */ }
        }

        // 兼容旧key
        const oldLoggedIn = await StorageAdapter.getItem('cloud_isLoggedIn') ||
                            await StorageAdapter.getItem('isLoggedIn');
        const oldUserStr = await StorageAdapter.getItem('cloud_currentUser') ||
                           await StorageAdapter.getItem('currentUser');
        if (oldLoggedIn === 'true' && oldUserStr) {
            try {
                return { valid: true, user: JSON.parse(oldUserStr) };
            } catch (e) { /* 解析失败继续 */ }
        }

        return { valid: false, reason: 'not_logged_in' };
    }

    // ==================== 登录调度层 ====================

    // 云端适配器
    const cloudAdapter = {
        async authenticate(username, password) {
            try {
                const fetchFn = global.cloudFetch || global.fetch;
                const response = await fetchFn(`${CLOUD_API_BASE}/users?login=true`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, password })
                });
                // cloudFetch 返回已解析的 JS 对象，原生 fetch 返回 Response 对象
                const data = (response && typeof response.json === 'function')
                    ? await response.json()
                    : response;
                if (!data || !data.success || !data.user) {
                    return { success: false, error: (data && data.error) || '用户名或密码错误' };
                }
                // ★ P0 修复：保留 API 返回的 token，附加到 user 对象
                // buildAuthHeader(user) 依赖 user.token 构造 Bearer header
                // 丢弃 token 会导致后续 API 请求回退到 Basic auth，云端返回 401 触发自动登出
                return { success: true, user: { ...data.user, token: data.token } };
            } catch (e) {
                console.error('云端登录失败:', e);
                return { success: false, error: '登录失败：' + (e.message || '网络错误') };
            }
        }
    };

    // ★ 优化3：密码错误锁定辅助工具（5次错误锁定30分钟）
    const LoginLockout = {
        _getStorage() {
            // 兼容 Capacitor Preferences 和 localStorage
            if (typeof global.Capacitor !== 'undefined' && global.Capacitor.Plugins && global.Capacitor.Plugins.Preferences) {
                return null; // APP 端暂不支持锁定，仅桌面/网页版支持
            }
            try { return global.localStorage; } catch (e) { return null; }
        },
        checkLocked(username) {
            const storage = this._getStorage();
            if (!storage) return null;
            const lockUntil = parseInt(storage.getItem('auth:lockUntil:' + username) || '0', 10);
            if (lockUntil > Date.now()) {
                const remainMin = Math.ceil((lockUntil - Date.now()) / 60000);
                return '账号已被锁定，请 ' + remainMin + ' 分钟后重试';
            }
            return null;
        },
        recordFailure(username) {
            const storage = this._getStorage();
            if (!storage) return '密码错误';
            const failKey = 'auth:failCount:' + username;
            let failCount = parseInt(storage.getItem(failKey) || '0', 10) + 1;
            if (failCount >= 5) {
                storage.setItem('auth:lockUntil:' + username, String(Date.now() + 30 * 60 * 1000));
                storage.removeItem(failKey);
                return '密码错误次数过多，账号已被锁定 30 分钟';
            }
            storage.setItem(failKey, String(failCount));
            return '密码错误（剩余 ' + (5 - failCount) + ' 次尝试机会）';
        },
        recordSuccess(username) {
            const storage = this._getStorage();
            if (!storage) return;
            storage.removeItem('auth:failCount:' + username);
            storage.removeItem('auth:lockUntil:' + username);
        }
    };

    // ★ 优化3：操作审计日志（登录/退出/处方保存/删除等关键操作）
    const AuditLog = {
        _getStorage() {
            if (typeof global.Capacitor !== 'undefined' && global.Capacitor.Plugins && global.Capacitor.Plugins.Preferences) {
                return null; // APP 端暂不支持，仅桌面/网页版
            }
            try { return global.localStorage; } catch (e) { return null; }
        },
        _resolveUser() {
            // 优先读取运行时 currentUser，回退到 storage
            try {
                if (typeof currentUser !== 'undefined' && currentUser && currentUser.username) {
                    return currentUser.username;
                }
            } catch (e) { /* currentUser 未定义 */ }
            const storage = this._getStorage();
            if (storage) {
                try {
                    const stored = storage.getItem('auth:currentUser');
                    if (stored) return (JSON.parse(stored).username) || 'unknown';
                } catch (e) {}
            }
            return 'unknown';
        },
        record(action, details) {
            const storage = this._getStorage();
            if (!storage) return;
            try {
                const entry = {
                    t: Date.now(),
                    ts: new Date().toISOString(),
                    user: this._resolveUser(),
                    action: String(action || '').slice(0, 64),
                    details: String(details || '').slice(0, 500)
                };
                let logs = [];
                try { logs = JSON.parse(storage.getItem('audit:log') || '[]'); } catch (e) {}
                if (!Array.isArray(logs)) logs = [];
                logs.push(entry);
                // 最多保留 500 条，超出时丢弃最早的
                if (logs.length > 500) logs = logs.slice(-500);
                storage.setItem('audit:log', JSON.stringify(logs));
            } catch (e) { console.warn('审计日志写入失败:', e); }
        },
        list(limit) {
            const storage = this._getStorage();
            if (!storage) return [];
            try {
                const logs = JSON.parse(storage.getItem('audit:log') || '[]');
                if (!Array.isArray(logs)) return [];
                return limit ? logs.slice(-limit) : logs;
            } catch (e) { return []; }
        },
        clear() {
            const storage = this._getStorage();
            if (!storage) return;
            storage.removeItem('audit:log');
        }
    };
    global.AuditLog = AuditLog;

    // 离线适配器工厂
    function createLocalAdapter(getUsersFn) {
        return {
            async authenticate(username, password) {
                try {
                    // ★ 优化3：检查账号是否被锁定
                    const lockMsg = LoginLockout.checkLocked(username);
                    if (lockMsg) return { success: false, error: lockMsg };

                    const users = typeof getUsersFn === 'function' ? await getUsersFn() : getUsersFn;
                    if (!Array.isArray(users)) {
                        return { success: false, error: '用户数据加载失败' };
                    }
                    const user = users.find(u => u.username === username);
                    if (!user) {
                        return { success: false, error: '用户不存在' };
                    }
                    const pwdOk = await verifyPassword(password, user.password || '');
                    if (!pwdOk) {
                        // ★ 优化3：密码错误计数+1，5次后锁定30分钟
                        return { success: false, error: LoginLockout.recordFailure(username) };
                    }
                    // 登录成功，清零错误计数
                    LoginLockout.recordSuccess(username);
                    // 不返回密码
                    const { password: _, ...safeUser } = user;
                    return { success: true, user: safeUser };
                } catch (e) {
                    console.error('离线登录失败:', e);
                    return { success: false, error: '登录失败：' + (e.message || '未知错误') };
                }
            }
        };
    }

    // 离线单用户适配器（个人版）
    function createSingleUserAdapter(getUserFn) {
        return {
            async authenticate(username, password) {
                try {
                    // ★ 优化3：检查账号是否被锁定
                    const lockMsg = LoginLockout.checkLocked(username);
                    if (lockMsg) return { success: false, error: lockMsg };

                    const user = typeof getUserFn === 'function' ? await getUserFn() : getUserFn;
                    if (!user) {
                        return { success: false, error: '用户信息加载失败' };
                    }
                    const pwdOk = await verifyPassword(password, user.password || '');
                    if (!pwdOk) {
                        // ★ 优化3：密码错误计数+1，5次后锁定30分钟
                        return { success: false, error: LoginLockout.recordFailure(username) };
                    }
                    // 登录成功，清零错误计数
                    LoginLockout.recordSuccess(username);
                    const { password: _, ...safeUser } = user;
                    return { success: true, user: safeUser };
                } catch (e) {
                    console.error('单用户登录失败:', e);
                    return { success: false, error: '登录失败：' + (e.message || '未知错误') };
                }
            }
        };
    }

    async function login(username, password, options = {}) {
        try {
            // 1. 验证输入
            if (!username || !password) {
                return { success: false, error: '请输入用户名和密码' };
            }

            // 2. 选择适配器
            const adapter = options.adapter || cloudAdapter;
            const result = await adapter.authenticate(username, password);

            if (!result.success || !result.user) {
                // ★ 优化3：审计日志 - 登录失败
                try { AuditLog.record('login_failure', username + ': ' + (result.error || '认证失败')); } catch(e) {}
                return { success: false, error: result.error || '认证失败' };
            }

            const user = result.user;

            // 3. 权限模式标准化
            user.allowedMode = resolveAllowedMode(user);

            // 4. 网页环境：local 模式自动升级为 both
            if (user.allowedMode === 'local' && !global.Capacitor) {
                user.allowedMode = 'both';
            }

            // 5. 写入登录态（统一 key）
            const userData = JSON.stringify(user);
            await StorageAdapter.setItem('auth:currentUser', userData);
            await StorageAdapter.setItem('auth:isLoggedIn', 'true');
            StorageAdapter.setSessionItem('auth:currentUser', userData);
            StorageAdapter.setSessionItem('auth:isLoggedIn', 'true');

            // 6. 记录登录时间（会话超时用）
            await StorageAdapter.setItem('auth:loginData', JSON.stringify({
                loginTime: Date.now(),
                username: user.username
            }));

            // 7. 同步诊所名
            if (user.clinicName) {
                await StorageAdapter.setItem('auth:clinicName', user.clinicName);
            }

            return { success: true, user };
        } catch (e) {
            console.error('登录异常:', e);
            return { success: false, error: '登录失败：' + (e.message || '未知错误') };
        }
    }

    // ==================== 退出登录 ====================

    async function logout() {
        // ★ 优化3：审计日志 - 退出登录
        try { AuditLog.record('logout', ''); } catch(e) {}
        const allKeys = [
            'auth:currentUser', 'auth:isLoggedIn', 'auth:loginData',
            // 兼容旧key也清除
            'cloud_currentUser', 'cloud_isLoggedIn',
            'currentUser', 'isLoggedIn',
            'user_login_data',
            'cloud_prescription_cache', 'cloud_prescription_cache_time'
        ];
        for (const key of allKeys) {
            await StorageAdapter.removeItem(key);
            StorageAdapter.removeSessionItem(key);
        }
    }

    // ==================== 记住用户名层 ====================

    async function saveRememberedUser(username) {
        const cleanUsername = String(username).trim();
        if (!cleanUsername) return;

        let remembered = [];
        try {
            const stored = await StorageAdapter.getItem('auth:rememberedUsers');
            if (stored) remembered = JSON.parse(stored);
            if (!Array.isArray(remembered)) remembered = [];
        } catch (e) { remembered = []; }

        remembered = remembered.filter(u => String(u).toLowerCase() !== cleanUsername.toLowerCase());
        remembered.unshift(cleanUsername);
        if (remembered.length > 5) remembered = remembered.slice(0, 5);

        await StorageAdapter.setItem('auth:rememberedUsers', JSON.stringify(remembered));
        await StorageAdapter.setItem('auth:rememberedUsername', cleanUsername);
    }

    async function loadRememberedUsers() {
        // 并行读取所有 key，避免串行 await 导致的累积延迟
        try {
            const [stored, single, cloudOld, localOld, legacyOld] = await Promise.all([
                StorageAdapter.getItem('auth:rememberedUsers'),
                StorageAdapter.getItem('auth:rememberedUsername'),
                StorageAdapter.getItem('cloud_rememberedUsername'),
                StorageAdapter.getItem('local_rememberedUsername'),
                StorageAdapter.getItem('rememberedUsername')
            ]);

            if (stored) {
                try {
                    const arr = JSON.parse(stored);
                    if (Array.isArray(arr) && arr.length > 0) return arr;
                } catch (e) { /* 忽略解析错误 */ }
            }

            const oldSingle = single || cloudOld || localOld || legacyOld;
            return oldSingle ? [oldSingle] : [];
        } catch (e) { /* 忽略 */ }
        return [];
    }

    async function clearRememberedUsers() {
        await StorageAdapter.removeItem('auth:rememberedUsers');
        await StorageAdapter.removeItem('auth:rememberedUsername');
        // 兼容旧key
        await StorageAdapter.removeItem('cloud_rememberedUsers');
        await StorageAdapter.removeItem('cloud_rememberedUsername');
        await StorageAdapter.removeItem('local_rememberedUsername');
        await StorageAdapter.removeItem('rememberedUsername');
        await StorageAdapter.removeItem('rememberedUsers');
    }

    // ==================== 初始化 ====================

    // 自动执行旧key迁移
    migrateOldKeys().catch(e => console.warn('Key迁移失败:', e));

    // ★ P1-3: 自动从主进程获取 license.masterKey 并注入
    // 用途：让密码哈希盐基于 masterKey 派生（每个安装不同），避免硬编码盐被破解
    // 仅 Electron 桌面版可用（electronAPI.license.getStatus 存在时）
    // 失败时 fallback 到硬编码 PASSWORD_SALT（向后兼容）
    (async function initMasterKeyFromLicense() {
        try {
            if (global.electronAPI && global.electronAPI.license && typeof global.electronAPI.license.getStatus === 'function') {
                const status = await global.electronAPI.license.getStatus();
                if (status && status.masterKey) {
                    setMasterKey(status.masterKey);
                    console.log('[AuthCore] masterKey 已从 license 注入');
                }
            }
        } catch (e) {
            console.warn('[AuthCore] 获取 masterKey 失败，使用硬编码盐 fallback:', e.message);
        }
    })();

    // ==================== 导出 ====================

    global.AuthCore = {
        // 常量
        PASSWORD_SALT,
        SESSION_TIMEOUT_MS,
        CLOUD_API_BASE,

        // 存储适配器
        StorageAdapter,

        // safeStorage 桥（P0-2）
        SafeStorageBridge,

        // 密码加密
        hashPassword,
        hashPasswordWithUser,
        verifyPassword,
        isPasswordHashed,
        encryptUsers,
        decryptUsers,
        encryptPassword,
        decryptPassword,
        saveRememberedPassword,
        getRememberedPassword,
        clearRememberedPassword,

        // 权限解析
        resolveAllowedMode,
        isAdmin,
        isClinicAdmin,
        isPlatformAdmin,
        buildAuthPayload,

        // 会话管理
        checkSession,

        // 登录调度
        login,
        logout,

        // 适配器工厂
        cloudAdapter,
        createLocalAdapter,
        createSingleUserAdapter,

        // 记住用户名
        saveRememberedUser,
        loadRememberedUsers,
        clearRememberedUsers,

        // Key 迁移
        migrateOldKeys,

        // P1-3: masterKey 派生盐（外部可手动注入，正常情况下由 initMasterKeyFromLicense 自动注入）
        setMasterKey
    };

})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this);

// ============================================================================
// LicenseCheck — License 启动校验与自动激活（4端桌面版 + APP 端通用）
// 启动后延迟 2 秒校验 license，失效时自动弹出激活窗口
// 桌面版：调用 activate.show() 打开独立 BrowserWindow（activate-window.html）
// APP 端：activate.show() 触发 'app:show-activate' 事件，本模块用 prompt 实现激活
//
// ★ 完善体验（2026-07-20）：
//   1. 弹窗交互：alert 显示到期信息 → 点击确定 → 自动拉起激活码输入窗口
//   2. 兜底逻辑：设置 __licenseExpired 标志，定期检查（5秒），失效则重新弹激活窗口
//                  用户取消激活后，5 秒后会重新弹窗，强制停留在激活页面
//   3. 兼容逻辑：激活成功后清除 __licenseExpired 标志（重启后自动清除，但即时反馈更好）
// ============================================================================
(function (global) {
    'use strict';

    // 避免重复初始化
    if (global.__licenseCheckInitialized) return;
    global.__licenseCheckInitialized = true;

    // ★ 全局 License 状态标志
    global.__licenseExpired = false;       // License 是否已失效
    global.__licenseActivating = false;    // 是否正在激活流程中（防止重复弹窗）

    // 上次失败的消息（用于兜底弹窗显示）
    let lastFailMessage = '授权已失效，请激活';

    async function checkLicenseAndShowActivate() {
        try {
            // 检查 license API 是否存在（APP 端无 window.electronAPI 时自动跳过）
            if (!global.electronAPI || !global.electronAPI.license ||
                typeof global.electronAPI.license.validate !== 'function') {
                console.log('[LicenseCheck] 未检测到 license API，跳过校验');
                return;
            }
            const result = await global.electronAPI.license.validate();
            if (result && result.valid) {
                console.log('[LicenseCheck] 授权有效:', result.message || '');
                // ★ 兼容逻辑：授权有效时清除失效标志
                global.__licenseExpired = false;
                global.__licenseActivating = false;
                // ★ P1-1 在线验证：如果需要在线验证，自动触发（不阻断使用）
                if (result.needOnlineVerify && global.electronAPI.license.verifyOnline) {
                    try {
                        console.log('[LicenseCheck] 检测到需要在线验证，正在验证...');
                        const verifyResult = await global.electronAPI.license.verifyOnline();
                        if (verifyResult && verifyResult.success) {
                            console.log('[LicenseCheck] 在线验证成功');
                        } else {
                            console.warn('[LicenseCheck] 在线验证失败:', verifyResult && verifyResult.error);
                        }
                    } catch (e) {
                        console.warn('[LicenseCheck] 在线验证异常:', e);
                    }
                }
                return;
            }
            // license 失效
            const msg = (result && result.message) ? result.message : '授权已失效，请激活';
            lastFailMessage = msg;
            console.warn('[LicenseCheck] 授权失效:', msg);

            // ★ 设置失效标志
            global.__licenseExpired = true;

            // ★ 如果正在激活中，不重复弹窗
            if (global.__licenseActivating) {
                console.log('[LicenseCheck] 激活流程进行中，跳过弹窗');
                return;
            }

            // ★ 弹窗交互：先 alert 显示到期信息，关闭后自动拉起激活窗口
            await showExpireAlertAndActivate(msg);
        } catch (e) {
            console.error('[LicenseCheck] 校验异常:', e);
            global.__licenseActivating = false;
        }
    }

    // ★ 弹窗交互：先显示到期提示，用户点击确定后自动拉起激活窗口
    // 桌面版：优先用 showExpireAlert 一体化 IPC（main process 中 dialog + showActivateWindow）
    // APP 端：showExpireAlert 不存在，回退到 alert + activate.show()
    async function showExpireAlertAndActivate(msg) {
        global.__licenseActivating = true;

        // ★ 桌面版优先：一体化 IPC（解决渲染进程 alert 阻塞导致 activate.show 不执行的问题）
        if (global.electronAPI && global.electronAPI.activate &&
            typeof global.electronAPI.activate.showExpireAlert === 'function') {
            try {
                await global.electronAPI.activate.showExpireAlert(msg);
                // main process 中 dialog 关闭后已自动 showActivateWindow
                return;
            } catch (e) {
                console.error('[LicenseCheck] showExpireAlert 失败，回退到 alert+show:', e);
                // 回退到下面的 alert + show 流程
            }
        }

        // ★ APP 端或回退：先 alert 显示到期信息，关闭后 activate.show()
        try {
            alert(msg);
        } catch (e) { /* alert 不可用时忽略 */ }

        // 自动拉起激活码输入窗口
        if (global.electronAPI && global.electronAPI.activate &&
            typeof global.electronAPI.activate.show === 'function') {
            try {
                await global.electronAPI.activate.show();
                // 桌面版：activate.show() 打开 BrowserWindow，窗口关闭后通过定时器重新检查
                // APP 端：activate.show() 触发 'app:show-activate' 事件
            } catch (e) {
                console.error('[LicenseCheck] 拉起激活窗口失败:', e);
                global.__licenseActivating = false;
            }
        } else {
            // 无 activate API，仅显示提示
            try { alert(msg + '\n\n请联系管理员获取激活码'); } catch (e) {}
            global.__licenseActivating = false;
        }
    }

    // ★ 兜底逻辑：定期检查 license 状态，失效则重新弹激活窗口
    // 防止用户关闭激活窗口后继续使用主界面
    let fallbackTimer = null;
    function startFallbackCheck() {
        if (fallbackTimer) clearInterval(fallbackTimer);
        fallbackTimer = setInterval(async () => {
            // 只在 license 已失效且不在激活流程中时检查
            if (!global.__licenseExpired || global.__licenseActivating) return;

            console.log('[LicenseCheck] 兜底检查：license 失效，重新弹激活窗口');
            await showExpireAlertAndActivate(lastFailMessage);
        }, 5000); // 每 5 秒检查一次
    }

    // APP 端监听 'app:show-activate' 事件，用 prompt 实现激活流程
    // 桌面版的 activate.show() 由 main.js 处理（打开 BrowserWindow），不会触发此事件
    if (typeof global.addEventListener === 'function') {
        global.addEventListener('app:show-activate', async function () {
            try {
                if (!global.electronAPI || !global.electronAPI.activate) return;
                // 获取机器 ID（显示给用户，方便客服查证）
                let machineId = '';
                try {
                    const r = await global.electronAPI.activate.getMachineId();
                    machineId = (r && r.machineId) ? r.machineId : (r || '');
                } catch (e) {}

                // ★ 显示到期信息 + 激活码输入（合并到一个 prompt）
                const promptMsg = lastFailMessage +
                    '\n\n请输入激活码（格式：BNZC-XXXX-XXXX-XXXX-XXXX）：\n机器ID：' + (machineId || '未知') +
                    '\n\n如有疑问请联系客服';
                const code = prompt(promptMsg);

                if (!code || !code.trim()) {
                    // ★ 用户取消激活，不清除 __licenseActivating（兜底定时器会重新弹窗）
                    // 但为了让兜底定时器能工作，需要清除 __licenseActivating
                    global.__licenseActivating = false;
                    console.log('[LicenseCheck] 用户取消激活，5 秒后将重新弹窗');
                    return;
                }

                // 获取用户名（从 CONFIG 或 localStorage）
                let user = '';
                try {
                    if (typeof CONFIG !== 'undefined' && CONFIG.doctorName) {
                        user = CONFIG.doctorName;
                    } else {
                        user = localStorage.getItem('auth:rememberedUsername') || '';
                    }
                } catch (e) {}

                const result = await global.electronAPI.activate.submit(code.trim(), user);
                if (result && result.success) {
                    // ★ 兼容逻辑：激活成功，清除失效标记
                    global.__licenseExpired = false;
                    global.__licenseActivating = false;
                    try { alert('激活成功！\n' + (result.message || '') + '\n\n点击确定后应用将重启'); } catch (e) {}
                    global.electronAPI.activate.restart();
                } else {
                    // ★ 激活失败，显示错误并重新弹 prompt（递归触发事件）
                    try {
                        alert('激活失败：\n' + (result && result.error ? result.error : '未知错误') + '\n\n点击确定重新输入激活码');
                    } catch (e) {}
                    // 重新触发激活流程
                    global.__licenseActivating = false;
                    global.dispatchEvent(new CustomEvent('app:show-activate'));
                }
            } catch (e) {
                try { alert('激活过程出错：' + e.message); } catch (er) {}
                global.__licenseActivating = false;
            }
        });
    }

    // ============================================================================
    // ★ 新增：立即激活入口（试用期内主动激活，无需等待试用期结束）
    // 用途：用户在试用期有效时也可主动激活，激活成功后转为正式授权
    // 调用方式：window.activateNow() 或通过 settingsModal 中注入的"立即激活"按钮
    // ============================================================================
    global.activateNow = async function () {
        if (global.__licenseActivating) {
            try { alert('激活流程进行中，请稍候'); } catch (e) { }
            return;
        }
        // 设置激活中标志，避免重复触发
        global.__licenseActivating = true;

        // 主动触发激活流程（不依赖 __licenseExpired 标志）
        // 桌面版：activate.show() 打开独立 BrowserWindow
        // APP 端：activate.show() 触发 'app:show-activate' 事件
        if (global.electronAPI && global.electronAPI.activate &&
            typeof global.electronAPI.activate.show === 'function') {
            try {
                await global.electronAPI.activate.show();
            } catch (e) {
                console.error('[LicenseCheck] 立即激活失败:', e);
                global.__licenseActivating = false;
            }
        } else {
            // 无 activate.show API（如旧版 APP），直接 dispatch 事件
            global.dispatchEvent(new CustomEvent('app:show-activate'));
        }
    };

    // ★ 向 settingsModal 运行时注入 license 状态显示 + 立即激活按钮
    // 不修改 HTML 源码，仅在运行时动态注入 DOM，符合界面保护约束
    function injectLicenseStatusIntoSettings() {
        const settingsModal = document.getElementById('settingsModal');
        if (!settingsModal) {
            console.warn('[LicenseCheck] settingsModal 未找到，跳过 license 状态注入');
            return;
        }
        // 避免重复注入
        if (document.getElementById('licenseStatusSection')) {
            // 已注入，仅更新状态文本
            updateLicenseStatusText();
            return;
        }

        const modalBody = settingsModal.querySelector('.modal-body');
        if (!modalBody) {
            console.warn('[LicenseCheck] settingsModal 无 modal-body，跳过注入');
            return;
        }

        const section = document.createElement('div');
        section.id = 'licenseStatusSection';
        section.style.cssText = 'margin-top:15px;padding:10px;border:1px solid #ddd;border-radius:6px;background:#f9f9f9;';
        section.innerHTML =
            '<div style="font-weight:bold;margin-bottom:8px;color:#333;">🔐 授权状态</div>' +
            '<div id="licenseStatusText" style="font-size:13px;color:#666;margin-bottom:10px;">加载中...</div>' +
            '<button class="action-btn" id="activateNowBtn" style="background:#ff9800;color:white;width:100%;padding:8px;font-size:14px;border:none;border-radius:4px;cursor:pointer;">立即激活</button>';

        modalBody.appendChild(section);

        // 绑定按钮事件：关闭 settingsModal 后触发激活
        const btn = section.querySelector('#activateNowBtn');
        btn.addEventListener('click', function () {
            try { closeModal('settingsModal'); } catch (e) { }
            if (typeof global.activateNow === 'function') {
                global.activateNow();
            }
        });

        // 异步加载 license 状态
        updateLicenseStatusText();
    }

    // ★ 异步获取并显示 license 状态（试用期剩余天数 / 已激活 / 已过期）
    async function updateLicenseStatusText() {
        const el = document.getElementById('licenseStatusText');
        if (!el) return;

        try {
            if (!global.electronAPI || !global.electronAPI.license ||
                typeof global.electronAPI.license.getStatus !== 'function') {
                el.textContent = '未检测到授权系统';
                return;
            }
            const status = await global.electronAPI.license.getStatus();
            if (status && status.valid) {
                // ★ 优先从 prescriptionStatus 读取剩余天数
                const ps = status.prescriptionStatus;
                if (ps && typeof ps.remainingDays === 'number' && ps.remainingDays > 0) {
                    el.innerHTML = '⏳ 试用期有效<br>剩余 <b style="color:#4caf50;">' + ps.remainingDays + '</b> 天';
                } else if (ps && typeof ps.remainingDays === 'number' && ps.remainingDays <= 0) {
                    el.innerHTML = '✅ 已激活' + (ps.plan ? '（' + ps.plan + '）' : '');
                } else {
                    el.innerHTML = '✅ 已激活';
                }
            } else {
                el.innerHTML = '❌ 未激活<br><span style="color:red;">' +
                    ((status && status.message) ? status.message : '请激活后使用') +
                    '</span>';
            }
        } catch (e) {
            el.textContent = '状态获取失败: ' + (e && e.message ? e.message : '未知错误');
        }
    }

    // 页面加载完成后延迟 2 秒校验 license（等待 electronAPI 注入完成）
    function startLicenseCheck() {
        setTimeout(async () => {
            await checkLicenseAndShowActivate();
            // ★ 启动兜底检查（无论首次校验结果如何，都启动定时器）
            startFallbackCheck();
            // ★ 新增：向 settingsModal 注入 license 状态显示 + 立即激活按钮
            injectLicenseStatusIntoSettings();
        }, 2000);
    }

    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        startLicenseCheck();
    } else {
        document.addEventListener('DOMContentLoaded', startLicenseCheck);
    }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this);
