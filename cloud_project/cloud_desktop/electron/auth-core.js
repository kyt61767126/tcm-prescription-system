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
    // P1-2: PWDv2 使用运行时派生密钥（增强），PWDv1 为旧版硬编码盐（向后兼容）
    function encryptPassword(password) {
        if (!password) return null;
        const key = RUNTIME_KEY;
        let result = '';
        for (let i = 0; i < password.length; i++) {
            result += String.fromCharCode(password.charCodeAt(i) ^ key.charCodeAt(i % key.length));
        }
        return 'PWDv2:' + btoa(unescape(encodeURIComponent(result)));
    }

    function decryptPassword(stored) {
        if (!stored || typeof stored !== 'string') return null;
        // P1-2: 优先尝试 PWDv2（运行时派生密钥）
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
            const encrypted = encryptPassword(password);
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
            // 兼容旧明文存储
            if (stored.startsWith('PWDv1:')) {
                return decryptPassword(stored);
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
    // P1-2: XORv2 使用运行时派生密钥（增强），XORv1 为旧版硬编码盐（向后兼容）
    function encryptUsers(users) {
        const json = JSON.stringify(users);
        const key = RUNTIME_KEY;
        let result = '';
        for (let i = 0; i < json.length; i++) {
            result += String.fromCharCode(json.charCodeAt(i) ^ key.charCodeAt(i % key.length));
        }
        return 'XORv2:' + btoa(unescape(encodeURIComponent(result)));
    }

    function decryptUsers(stored) {
        if (!stored || typeof stored !== 'string') return stored;
        // P1-2: 优先尝试 XORv2（运行时派生密钥）
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

    // P0 修复：构造完整 Authorization header 值
    // 云端登录后 user.token 存在 → 返回 Bearer token
    // 离线模式无 token → 回退到 Basic base64 payload
    function buildAuthHeader(user) {
        const u = user || null;
        if (u && u.token) {
            return `Bearer ${u.token}`;
        }
        const payload = buildAuthPayload(u);
        return payload ? `Basic ${payload}` : null;
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
                // P0 修复：保存后端返回的 Bearer token，供后续 API 调用使用
                if (data.token) {
                    data.user.token = data.token;
                }
                return { success: true, user: data.user };
            } catch (e) {
                console.error('云端登录失败:', e);
                return { success: false, error: '登录失败：' + (e.message || '网络错误') };
            }
        }
    };

    // 离线适配器工厂
    function createLocalAdapter(getUsersFn) {
        return {
            async authenticate(username, password) {
                try {
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
                        return { success: false, error: '密码错误' };
                    }
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
                    const user = typeof getUserFn === 'function' ? await getUserFn() : getUserFn;
                    if (!user) {
                        return { success: false, error: '用户信息加载失败' };
                    }
                    const pwdOk = await verifyPassword(password, user.password || '');
                    if (!pwdOk) {
                        return { success: false, error: '密码错误' };
                    }
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
        try {
            const stored = await StorageAdapter.getItem('auth:rememberedUsers');
            if (stored) {
                const arr = JSON.parse(stored);
                if (Array.isArray(arr)) return arr;
            }
        } catch (e) { /* 忽略 */ }

        // 回退到单个用户名
        const single = await StorageAdapter.getItem('auth:rememberedUsername');
        // 兼容旧key
        const oldSingle = single ||
            await StorageAdapter.getItem('cloud_rememberedUsername') ||
            await StorageAdapter.getItem('local_rememberedUsername') ||
            await StorageAdapter.getItem('rememberedUsername');
        return oldSingle ? [oldSingle] : [];
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

    // ==================== 导出 ====================

    global.AuthCore = {
        // 常量
        PASSWORD_SALT,
        SESSION_TIMEOUT_MS,
        CLOUD_API_BASE,

        // 存储适配器
        StorageAdapter,

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
        buildAuthHeader,

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
        migrateOldKeys
    };

})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this);
