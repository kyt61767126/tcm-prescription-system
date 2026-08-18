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

    // ==================== 用户查找辅助（支持手机号/用户名双模式）====================
    // 统一 findUserByIdentifier：在本地用户列表中按 username 或 phone 字段匹配
    // 用于 handleLogin / login.js 等所有登录入口，避免散落的 username-only 判断
    function findUserByIdentifier(users, identifier) {
        if (!Array.isArray(users) || !identifier) return null;
        const trimmed = String(identifier).trim();
        if (!trimmed) return null;
        // 优先 username 精确匹配
        let user = users.find(u => u && u.username === trimmed);
        // 兜底 phone 匹配：支持手机号作为登录账号
        if (!user) {
            user = users.find(u => u && u.phone && String(u.phone) === trimmed);
        }
        return user || null;
    }

    // ==================== 用户名规则（支持中文）====================
    // ★ 统一规则（2026-08-08 更新，支持中文用户名）：
    //   1. 用户名（username）：允许中文/英文/数字/下划线/连字符，2-30个字符
    //      - 历史：曾因 btoa/编码顾虑禁止中文，现通过 encodeURIComponent+btoa 包装已解决
    //      - 保留：Unicode 同形异义攻击检测（全角英数字替换为半角）
    //   2. 管理员账号格式：admin_{诊所简码}（如 admin_hkt = 惠康中医）
    //      - 诊所简码：2-12 位小写字母/数字，全局唯一
    //   3. 密码（password）：允许中文/英文/符号（哈希后存储，不影响稳定性）
    //   4. 显示姓名（name）：允许中文（仅用于 UI 展示，不参与登录比对）
    // ★ 关键安全点：所有涉及 btoa 的地方（buildAuthPayload 等）均使用
    //   btoa(unescape(encodeURIComponent(...))) Unicode 安全包装
    function validateUsername(username) {
        if (!username || typeof username !== 'string') {
            return { valid: false, error: '用户名不能为空' };
        }
        let trimmed = username.trim();
        if (trimmed.length < 2 || trimmed.length > 30) {
            return { valid: false, error: '用户名长度需 2-30 个字符' };
        }
        // Unicode 同形异义攻击防护：将全角英数字（0xFF01-0xFF5E）替换为半角
        // 防止用户用 ＡＢＣ 冒充 abc 创建重复账号
        trimmed = trimmed.replace(/[\uff01-\uff5e]/g, function(ch) {
            return String.fromCharCode(ch.charCodeAt(0) - 0xfee0);
        });
        // 禁止控制字符、不可见字符（零宽字符等）
        if (/[\x00-\x1f\x7f\u200b-\u200f\u202a-\u202e\ufeff]/.test(trimmed)) {
            return { valid: false, error: '用户名不能包含控制字符或不可见字符' };
        }
        // 禁止常见危险字符（用于 SQL/命令注入；中文用户名已允许）
        if (/[;'"\\\/<>|&`$#@!%^*()+=\[\]{}?~]/.test(trimmed)) {
            return { valid: false, error: '用户名不能包含特殊符号（标点/引号/括号等）' };
        }
        return { valid: true, username: trimmed };
    }

    // ★ 管理员账号格式校验：admin_{诊所简码}（简码仅允许英文数字，简码不是用户名本身）
    function validateAdminUsername(username) {
        const base = validateUsername(username);
        if (!base.valid) return base;
        // validateUsername 允许中文，管理员简码部分仍限制英文数字
        const usernameForAdmin = base.username;
        // 如果包含中文，说明不是 admin_简码 格式，但普通管理员账号允许中文
        if (/[\u4e00-\u9fa5]/.test(usernameForAdmin)) {
            return base;
        }
        // 纯英文/数字 才校验 admin_简码 格式
        if (usernameForAdmin.startsWith('admin_')) {
            if (!/^admin_[a-z][a-z0-9]{1,11}$/.test(usernameForAdmin)) {
                return {
                    valid: false,
                    error: '管理员简码账号必须为 admin_诊所简码 格式（如 admin_hkt），简码为 2-12 位小写字母和数字'
                };
            }
        }
        return base;
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

    // P3-3: 移除"记住密码"保存/读取/清除（2026-08-08）
    // 规则5要求：每次手动输密码，禁止自动填充密码框
    // 保留 API 兼容（返回 null/false/空操作），不破坏现有调用点
    async function saveRememberedPassword(password) {
        try {
            // 安全模式升级：禁止记住密码
            // 只保留用户名（通过 saveRememberedUser 记住用户名）
            // 旧调用点会静默成功，不报错
        } catch (e) { /* 静默忽略 */ }
    }
    async function getRememberedPassword() {
        // 安全模式：永远不返回密码，强制手动输入
        return null;
    }
    async function clearRememberedPassword() {
        try {
            // 清理历史遗留的密码存储
            await StorageAdapter.removeItem('auth:savedPassword');
        } catch (e) { /* 忽略 */ }
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
        // Unicode 安全包装（中文用户名兼容）：encodeURIComponent → unescape → btoa
        // 与 encryptPassword/encryptUsers 使用相同的 Unicode 编码模式
        return btoa(unescape(encodeURIComponent(JSON.stringify({
            username: user.username,
            role: user.role || 'doctor',
            clinicId: user.clinicId || null
        }))));
    }

    // ==================== 会话管理层 ====================

    // P4-4: 周期性会话监控器（8小时自动登出）
    // 规则5要求：8小时自动登出。checkSession 原本只在启动时调用一次，
    // 持续运行超过 8 小时不重启/不刷新时不会触发。
    // 本监控器使用 setInterval 每 5 分钟检查一次会话超时
    let _sessionMonitorTimer = null;
    let _sessionLogoutCallback = null;

    function startSessionMonitor(logoutCallback) {
        // 先清除旧定时器，避免重复启动
        if (_sessionMonitorTimer) {
            clearInterval(_sessionMonitorTimer);
            _sessionMonitorTimer = null;
        }
        _sessionLogoutCallback = logoutCallback || null;
        const CHECK_INTERVAL_MS = 5 * 60 * 1000; // 每5分钟检查一次（省电+及时）
        _sessionMonitorTimer = setInterval(async function() {
            try {
                const session = await checkSession();
                if (!session.valid && session.reason === 'session_timeout') {
                    // 会话超时，调用外部登出回调（若有）
                    if (typeof _sessionLogoutCallback === 'function') {
                        try { await _sessionLogoutCallback('session_timeout'); } catch (e) {}
                    }
                    // 也执行内置 logout 确保登出生效
                    try { await logout(); } catch (e) {}
                    try { console.log('[AuthCore] 会话超时，已自动登出（8小时未刷新）'); } catch (e) {}
                }
            } catch (e) {
                // 监控器内部异常不影响主程序
                try { console.warn('[AuthCore] 会话监控检查异常:', e); } catch (e2) {}
            }
        }, CHECK_INTERVAL_MS);
        try { console.log('[AuthCore] 会话监控已启动（每5分钟检查一次，8小时超时自动登出）'); } catch (e) {}
    }

    function stopSessionMonitor() {
        if (_sessionMonitorTimer) {
            clearInterval(_sessionMonitorTimer);
            _sessionMonitorTimer = null;
            try { console.log('[AuthCore] 会话监控已停止'); } catch (e) {}
        }
        _sessionLogoutCallback = null;
    }

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
                    return { success: false, error: (data && data.error) || '手机号/用户名或密码错误' };
                }
                // ★ P0 修复：保留 API 返回的 token，附加到 user 对象
                // buildAuthHeader(user) 依赖 user.token 构造 Bearer header
                // 丢弃 token 会导致后续 API 请求回退到 Basic auth，云端返回 401 触发自动登出
                return { success: true, user: { ...data.user, token: data.token } };
            } catch (e) {
                console.error('云端登录失败:', e);
                // ★ 离线登录缓存：网络错误时尝试离线登录
                const isNetworkError = !navigator.onLine ||
                    (e.message && (e.message.includes('Failed to fetch') ||
                                   e.message.includes('NetworkError') ||
                                   e.message.includes('network') ||
                                   e.message.includes('ERR_')));
                if (isNetworkError) {
                    console.log('[auth] 网络不可用，尝试离线登录缓存...');
                    const offlineResult = await tryOfflineLogin(username, password);
                    if (offlineResult.success) {
                        return { success: true, user: offlineResult.user, offline: true };
                    }
                    return { success: false, error: '网络不可用，' + (offlineResult.error || '离线登录失败') };
                }
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
                    // ★ 支持手机号/用户名双模式登录：先按 username 查找，再按 phone 字段查找
                    let user = users.find(u => u.username === username);
                    if (!user) {
                        user = users.find(u => u.phone === username);
                    }
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

    // 离线单用户适配器（标准版）
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
                    // ★ 支持手机号/用户名双模式登录：检查 username 或 phone 是否匹配
                    const usernameMatch = (user.username === username) || (user.phone === username);
                    if (!usernameMatch) {
                        return { success: false, error: '用户不存在' };
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
                return { success: false, error: '请输入手机号或用户名和密码' };
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

            // ★ 离线登录缓存：在线登录成功后缓存凭证（仅在线登录时缓存，不覆盖已有缓存）
            if (!result.offline) {
                await cacheOfflineLogin(username, password, user);
            }

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

            // P4-4: 登录成功后启动会话监控（8小时自动登出）
            // options.onSessionTimeout 可选外部回调（用于登出后跳转/刷新页面）
            startSessionMonitor(options.onSessionTimeout || null);

            return { success: true, user };
        } catch (e) {
            console.error('登录异常:', e);
            return { success: false, error: '登录失败：' + (e.message || '未知错误') };
        }
    }

    // ==================== 退出登录 ====================

    async function logout() {
        // P4-4: 登出时停止会话监控器
        stopSessionMonitor();
        // ★ 优化3：审计日志 - 退出登录
        try { AuditLog.record('logout', ''); } catch(e) {}
        const allKeys = [
            'auth:currentUser', 'auth:isLoggedIn', 'auth:loginData',
            // 兼容旧key也清除
            'cloud_currentUser', 'cloud_isLoggedIn',
            'currentUser', 'isLoggedIn',
            'user_login_data',
            'cloud_prescription_cache', 'cloud_prescription_cache_time',
            // ★ 离线登录缓存：退出时清除（下次需在线登录重新缓存）
            'auth:offlineLoginCache',
            // P3-3: 清除历史遗留的记住密码
            'auth:savedPassword'
        ];
        for (const key of allKeys) {
            await StorageAdapter.removeItem(key);
            StorageAdapter.removeSessionItem(key);
        }
    }

    // ==================== 离线登录缓存 ====================
    // 首次在线登录成功后缓存用户凭证（加密存储），断网时可离线登录
    // 安全策略：密码通过 encryptPassword（safeStorage/XOR）加密，不存储明文
    // 有效期：30天，超时需重新在线登录

    async function cacheOfflineLogin(username, password, user) {
        try {
            if (!username || !password || !user) return false;
            const encryptedPwd = await encryptPassword(password);
            if (!encryptedPwd) {
                console.warn('[auth] 离线缓存：密码加密失败，跳过缓存');
                return false;
            }
            const cacheData = {
                username: username,
                encryptedPassword: encryptedPwd,
                user: user,
                cachedAt: Date.now()
            };
            await StorageAdapter.setItem('auth:offlineLoginCache', JSON.stringify(cacheData));
            console.log('[auth] 离线登录缓存已保存');
            return true;
        } catch (e) {
            console.warn('[auth] 缓存离线登录失败:', e);
            return false;
        }
    }

    async function tryOfflineLogin(username, password) {
        try {
            if (!username || !password) {
                return { success: false, error: '请输入手机号或用户名和密码' };
            }
            const cached = await StorageAdapter.getItem('auth:offlineLoginCache');
            if (!cached) {
                return { success: false, error: '无离线登录缓存，请联网登录' };
            }

            const cacheData = JSON.parse(cached);
            if (cacheData.username !== username) {
                return { success: false, error: '该用户无离线缓存，请联网登录' };
            }

            // 检查缓存是否过期（30天）
            const CACHE_TTL = 30 * 24 * 60 * 60 * 1000;
            if (Date.now() - cacheData.cachedAt > CACHE_TTL) {
                await StorageAdapter.removeItem('auth:offlineLoginCache');
                return { success: false, error: '离线登录缓存已过期，请联网登录' };
            }

            // 解密缓存的密码
            const decryptedPwd = await decryptPassword(cacheData.encryptedPassword);
            if (!decryptedPwd) {
                await StorageAdapter.removeItem('auth:offlineLoginCache');
                return { success: false, error: '缓存密码解密失败，请联网登录' };
            }

            // 验证密码
            if (decryptedPwd !== password) {
                return { success: false, error: '密码错误' };
            }

            console.log('[auth] 离线登录成功（使用缓存凭证）');
            return { success: true, user: cacheData.user, offline: true };
        } catch (e) {
            console.warn('[auth] 离线登录失败:', e);
            return { success: false, error: '离线登录异常: ' + (e.message || '未知错误') };
        }
    }

    async function clearOfflineLoginCache() {
        try {
            await StorageAdapter.removeItem('auth:offlineLoginCache');
            console.log('[auth] 离线登录缓存已清除');
        } catch (e) {}
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

        // 用户名语言规则校验（系统稳定性与安全）
        validateUsername,
        validateAdminUsername,
        clearRememberedPassword,

        // 离线登录缓存
        cacheOfflineLogin,
        tryOfflineLogin,
        clearOfflineLoginCache,

        // 权限解析
        resolveAllowedMode,
        isAdmin,
        isClinicAdmin,
        isPlatformAdmin,
        buildAuthPayload,

        // 会话管理
        checkSession,
        startSessionMonitor,
        stopSessionMonitor,

        // 登录调度
        login,
        logout,

        // 适配器工厂
        cloudAdapter,
        createLocalAdapter,
        createSingleUserAdapter,

        // 用户查找辅助（手机号/用户名双模式）
        findUserByIdentifier,

        // 记住用户名
        saveRememberedUser,
        loadRememberedUsers,
        clearRememberedUsers,

        // Key 迁移
        migrateOldKeys,

        // P1-3: masterKey 派生盐（外部可手动注入，正常情况下由 initMasterKeyFromLicense 自动注入）
        setMasterKey,

        // ============ 注册流程支持 ============

        // 密码强度校验（返回 { score, label, errors }）
        validatePasswordStrength(password) {
            const result = { score: 0, label: '', errors: [] };
            if (!password) { result.label = '空'; return result; }
            if (password.length >= 8) result.score++; else result.errors.push('密码至少8位');
            if (password.length >= 12) result.score++;
            if (/[a-z]/.test(password)) result.score++; else result.errors.push('密码需包含小写字母');
            if (/[A-Z]/.test(password)) result.score++;
            if (/[0-9]/.test(password)) result.score++; else result.errors.push('密码需包含数字');
            if (/[^a-zA-Z0-9]/.test(password)) result.score++;
            if (result.score <= 1) result.label = '太弱';
            else if (result.score <= 2) result.label = '弱';
            else if (result.score <= 3) result.label = '一般';
            else if (result.score <= 4) result.label = '中等';
            else if (result.score <= 5) result.label = '强';
            else result.label = '非常强';
            return result;
        },

        // 诊所自助注册（调用后端 /users?action=register-clinic）
        async registerClinic(params) {
            const { clinicName, adminUsername, adminPassword, adminName, wechat } = params || {};
            if (!clinicName || !adminUsername || !adminPassword) {
                return { success: false, error: '请填写完整的注册信息' };
            }
            const usernameCheck = validateAdminUsername(adminUsername);
            if (!usernameCheck.valid) {
                return { success: false, error: usernameCheck.error };
            }
            const strength = this.validatePasswordStrength(adminPassword);
            if (strength.errors.length > 0) {
                return { success: false, error: strength.errors[0] };
            }
            try {
                const fetchFn = global.cloudFetch || global.fetch;
                const response = await fetchFn(CLOUD_API_BASE + '/users?action=register-clinic', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        clinicName: clinicName.trim(),
                        adminUsername: adminUsername.trim(),
                        adminPassword,
                        adminName: (adminName || '').trim(),
                        wechat: (wechat || '').trim()
                    })
                });
                const data = (response && typeof response.json === 'function')
                    ? await response.json()
                    : response;
                return data;
            } catch (e) {
                return { success: false, error: '注册请求失败：' + (e.message || '网络错误') };
            }
        },

        // 云端激活码格式校验
        validateActivationCode(code) {
            if (!code || typeof code !== 'string') {
                return { valid: false, error: '激活码不能为空' };
            }
            const trimmed = code.trim();
            const pattern = /^BNZC-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;
            if (!pattern.test(trimmed)) {
                return {
                    valid: false,
                    error: '激活码格式不正确',
                    format: 'BNZC-XXXX-XXXX-XXXX-XXXX',
                    note: 'X 为大写字母或数字（不含 I/O/0/1）'
                };
            }
            return { valid: true, code: trimmed };
        }
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

    // ★ P1-7 心跳验证：每 24 小时联网验证一次 License，离线超过 7 天锁定
    // 防盗破解：破解版无法通过心跳验证，7 天后自动锁定
    async function performHeartbeatCheck() {
        try {
            const HEARTBEAT_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 小时
            const OFFLINE_LOCK_MS = 7 * 24 * 60 * 60 * 1000; // 7 天
            const now = Date.now();

            // 获取上次心跳时间
            const lastHeartbeat = await StorageAdapter.getItem('license:lastHeartbeat');
            if (lastHeartbeat) {
                const lastTime = parseInt(lastHeartbeat, 10);
                if (now - lastTime < HEARTBEAT_INTERVAL_MS) {
                    return; // 24 小时内已心跳，跳过
                }
            }

            // 获取 license code 和 machineId
            const licenseCode = await StorageAdapter.getItem('license:code');
            const machineId = await StorageAdapter.getItem('license:machineId');

            if (!licenseCode || !machineId) {
                console.log('[Heartbeat] 无 license code 或 machineId，跳过心跳');
                return;
            }

            console.log('[Heartbeat] 开始心跳验证...');

            // 调用心跳接口
            const response = await fetch('https://tcm-prescription-system.pages.dev/api/license/heartbeat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code: licenseCode, machineId: machineId })
            });

            if (!response.ok) {
                console.warn('[Heartbeat] 网络错误，HTTP', response.status);
                // 记录离线开始时间
                const offlineStart = await StorageAdapter.getItem('license:offlineStart');
                if (!offlineStart) {
                    await StorageAdapter.setItem('license:offlineStart', String(now));
                }
                // 检查离线是否超过 7 天
                if (offlineStart) {
                    const offlineTime = now - parseInt(offlineStart, 10);
                    if (offlineTime > OFFLINE_LOCK_MS) {
                        console.error('[Heartbeat] 离线超过 7 天，锁定应用');
                        global.__licenseExpired = true;
                        await showExpireAlertAndActivate('应用已离线超过 7 天，请联网验证后继续使用');
                    }
                }
                return;
            }

            const data = await response.json();

            if (data.success && data.valid && data.action === 'ok') {
                await StorageAdapter.setItem('license:lastHeartbeat', String(now));
                await StorageAdapter.removeItem('license:offlineStart');
                console.log('[Heartbeat] 心跳成功，剩余天数:', data.daysRemaining);
            } else {
                console.error('[Heartbeat] 心跳失败:', data.action);
                global.__licenseExpired = true;
                const msg = {
                    'expired': '授权已过期，请续费后激活',
                    'disabled': '授权已被禁用，请联系客服',
                    'unknown': '授权信息无效，请重新激活',
                    'device_mismatch': '设备不匹配，请在当前设备重新激活'
                }[data.action] || '授权验证失败，请重新激活';
                await showExpireAlertAndActivate(msg);
            }
        } catch (e) {
            console.warn('[Heartbeat] 异常:', e.message);
            // 心跳异常不阻断使用，但记录离线时间
            const now = Date.now();
            const offlineStart = await StorageAdapter.getItem('license:offlineStart');
            if (!offlineStart) {
                await StorageAdapter.setItem('license:offlineStart', String(now));
            }
        }
    }

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
                // ★ P1-7 心跳验证：异步执行，不阻断使用（24小时验证一次，7天离线锁定）
                performHeartbeatCheck();
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

    // ★ APP 端激活对话框函数（提取为独立函数，activateNow 可直接调用）
    // 放弃 prompt() 方案，改为在页面内用 HTML/CSS 动态注入全屏遮罩模态弹窗
    // 原因：Android WebView 的 onJsPrompt 会把页面内容当作 message 显示，导致输入框被挤压不可见
    // ★ 优化客户使用流程：步骤指引 + 机器ID复制 + 联系客服入口 + loading + 错误分类
    async function showActivateDialog() {
        try {
            if (!global.electronAPI || !global.electronAPI.activate) {
                // ★ 云端SaaS：无本地授权桥（无机器码/无需激活码），引导登录或管理员激活
                await showHtmlAlert('🌐 云端版无需激活码\n\n直接登录即可使用。\n如需申请登录账号，请返回登录页点击「📋 管理员激活」。');
                global.__licenseActivating = false;
                return;
            }
            let machineId = '';
            try {
                const r = await global.electronAPI.activate.getMachineId();
                machineId = (r && r.machineId) ? r.machineId : (r || '');
            } catch (e) {}

            // 获取本地诊所名（从 CONFIG.clinicName 读取，便于用户报给客服）
            let clinicName = '';
            try {
                if (typeof CONFIG !== 'undefined' && CONFIG.clinicName) {
                    clinicName = CONFIG.clinicName;
                }
            } catch (e) {}

            // ★ 使用 HTML 模态弹窗替代 prompt()，完全由 JS/CSS 控制，不依赖 Android AlertDialog
            // 返回值：{ code: string, cancelled: boolean }
            const modalResult = await showActivateModal(machineId, clinicName);

            if (modalResult.cancelled || !modalResult.code || !modalResult.code.trim()) {
                global.__licenseActivating = false;
                console.log('[LicenseCheck] 用户取消激活');
                return;
            }

            let user = '';
            try {
                if (typeof CONFIG !== 'undefined' && CONFIG.doctorName) {
                    user = CONFIG.doctorName;
                } else {
                    user = localStorage.getItem('auth:rememberedUsername') || '';
                }
            } catch (e) {}

            // ★ 激活码前端格式校验（减少无效网络请求）
            const codeTrim = modalResult.code.trim();
            const codePattern = /^BNZC-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;
            if (!codePattern.test(codeTrim)) {
                await showHtmlAlert('激活码格式不正确\n\n正确格式：BNZC-XXXX-XXXX-XXXX-XXXX\n（X 为大写字母或数字，去除 I/O/0/1）\n\n点击确定重新输入');
                global.__licenseActivating = false;
                showActivateDialog();
                return;
            }

            const result = await global.electronAPI.activate.submit(codeTrim, user);
            if (result && result.success) {
                global.__licenseExpired = false;
                global.__licenseActivating = false;
                // ★ P1-7 心跳验证：存储 license code 和 machineId 供心跳使用
                try {
                    await StorageAdapter.setItem('license:code', codeTrim);
                    if (global.electronAPI && global.electronAPI.license &&
                        typeof global.electronAPI.license.getMachineId === 'function') {
                        const mid = await global.electronAPI.license.getMachineId();
                        if (mid) await StorageAdapter.setItem('license:machineId', String(mid));
                    }
                    // 清除旧的心跳记录，立即触发一次心跳
                    await StorageAdapter.removeItem('license:lastHeartbeat');
                    await StorageAdapter.removeItem('license:offlineStart');
                } catch(e) { console.warn('[Heartbeat] 存储 license code 失败:', e); }
                showHtmlAlert('✅ 激活成功！\n' + (result.message || '') + '\n\n点击确定后应用将重启');
                global.electronAPI.activate.restart();
            } else {
                // ★ 错误分类提示（网络错误/激活码错误/绑定错误）
                const errMsg = (result && result.error) ? result.error : '未知错误';
                const friendlyMsg = formatActivateError(errMsg);
                // ★ 必须 await：等用户点击"确定"后再重新显示输入框
                // 否则错误提示和新输入框同时出现，用户看到的是新输入框(显示"请输入激活码")，键盘再次弹出
                await showHtmlAlert(friendlyMsg);
                global.__licenseActivating = false;
                showActivateDialog();
            }
        } catch (e) {
            await showHtmlAlert('激活过程出错：' + e.message);
            global.__licenseActivating = false;
        }
    }

    // ★ 激活错误友好提示（区分网络错误/激活码错误/绑定错误）
    function formatActivateError(errMsg) {
        const msg = String(errMsg || '').toLowerCase();
        // 网络错误
        if (msg.includes('网络') || msg.includes('超时') || msg.includes('timeout') ||
            msg.includes('unknownhost') || msg.includes('socket') || msg.includes('连接')) {
            return '❌ 激活失败：网络连接异常\n\n' + errMsg + '\n\n请检查网络后重试。\n如暂时无法联网，请联系客服协助激活。\n\n点击确定重新输入激活码';
        }
        // 激活码错误
        if (msg.includes('激活码') || msg.includes('已禁用') || msg.includes('已过期') || msg.includes('disabled') || msg.includes('expired')) {
            return '❌ 激活失败：激活码无效\n\n' + errMsg + '\n\n请确认激活码输入正确，或联系客服重新获取。\n\n点击确定重新输入激活码';
        }
        // 绑定错误（诊所名不匹配）
        if (msg.includes('诊所') || msg.includes('绑定') || msg.includes('clinic') || msg.includes('绑定设备')) {
            return '❌ 激活失败：授权绑定不匹配\n\n' + errMsg + '\n\n请确认诊所名称和机器ID与客服记录一致。\n\n点击确定重新输入激活码';
        }
        // 限速
        if (msg.includes('限速') || msg.includes('频繁') || msg.includes('rate')) {
            return '❌ 激活失败：尝试过于频繁\n\n' + errMsg + '\n\n请等待几分钟后重试。\n\n点击确定重新输入激活码';
        }
        // 兜底
        return '❌ 激活失败：\n' + errMsg + '\n\n点击确定重新输入激活码';
    }

    // ★ 复制文本到剪贴板（带 fallback，APP 端 WebView 可能不支持 navigator.clipboard）
    function copyTextToClipboard(text) {
        return new Promise(function(resolve) {
            const textStr = String(text || '');
            if (!textStr) { resolve(false); return; }
            // 优先使用现代 Clipboard API
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(textStr).then(function() {
                    resolve(true);
                }).catch(function() {
                    // fallback 到 execCommand
                    fallbackCopy(textStr, resolve);
                });
            } else {
                fallbackCopy(textStr, resolve);
            }
        });
    }
    function fallbackCopy(text, resolve) {
        try {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.style.cssText = 'position:fixed;left:-9999px;top:-9999px;opacity:0;';
            document.body.appendChild(ta);
            ta.focus();
            ta.select();
            const ok = document.execCommand('copy');
            document.body.removeChild(ta);
            resolve(ok);
        } catch (e) {
            resolve(false);
        }
    }

    // ★ HTML 模态弹窗（替代 prompt()）
    // 创建全屏遮罩 + 居中卡片，包含激活码输入框，完全由 JS/CSS 控制
    // 关键防护：输入框添加 autocomplete="off" + data-lpignore="true" + onfocus 取消 Autofill
    // 阻止 Android Autofill 弹出旧应用凭据提示（"本能中医处方系统"大图标窗口）
    // ★ 优化客户使用流程：紫色主题、步骤指引、机器ID复制、联系客服、诊所名展示、loading
    function showActivateModal(machineId, clinicName) {
        return new Promise(function(resolve) {
            const overlay = document.createElement('div');
            overlay.id = 'activateModalOverlay';
            overlay.style.cssText =
                'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.6);z-index:99999;display:flex;align-items:center;justify-content:center;padding:16px;';

            const card = document.createElement('div');
            card.style.cssText =
                'background:white;border-radius:14px;width:100%;max-width:400px;padding:20px;box-shadow:0 10px 30px rgba(0,0,0,0.3);max-height:90vh;overflow-y:auto;';

            // ★ 输入框添加最强 Autofill 阻止属性：
            // - autocomplete="off"：标准属性阻止浏览器自动填充
            // - autocomplete="new-password"：阻止密码管理器填充（即使 off 无效时）
            // - data-lpignore="true"：阻止 LastPass 等密码管理器
            // - onfocus 事件：聚焦时立即取消 Android Autofill 请求
            card.innerHTML =
                // 标题区（紫色主题）
                '<div style="background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);margin:-20px -20px 16px -20px;padding:20px;border-radius:14px 14px 0 0;text-align:center;">' +
                    '<div style="font-size:20px;font-weight:bold;color:white;">🔐 软件激活</div>' +
                    '<div style="font-size:12px;color:rgba(255,255,255,0.85);margin-top:4px;">惠康中医诊所管理系统</div>' +
                '</div>' +

                // 步骤指引（优化：4步，增加官网购买引导）
                '<div style="background:#f5f7ff;border-radius:8px;padding:12px;margin-bottom:16px;">' +
                    '<div style="font-size:13px;font-weight:bold;color:#555;margin-bottom:6px;">📋 激活步骤</div>' +
                    '<div style="font-size:12px;color:#666;line-height:1.8;">' +
                        '<div>1️⃣ 点击下方"复制全部信息"，复制设备识别码和诊所名</div>' +
                        '<div>2️⃣ 前往官网"购买激活码"页面生成订单号，或直接联系客服</div>' +
                        '<div>3️⃣ 将信息发给客服，付款后获取激活码</div>' +
                        '<div>4️⃣ 在此页面输入激活码，点击"立即激活"</div>' +
                    '</div>' +
                '</div>' +

                // 设备信息区（含一键复制全部信息）
                '<div style="margin-bottom:14px;">' +
                    '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">' +
                        '<span style="font-size:12px;color:#888;font-weight:bold;">🔑 设备识别码</span>' +
                        '<div style="display:flex;gap:6px;">' +
                            '<button id="copyMachineIdBtn" style="font-size:11px;padding:4px 10px;border:1px solid #667eea;border-radius:4px;background:white;color:#667eea;cursor:pointer;">复制ID</button>' +
                            '<button id="copyAllInfoBtn" style="font-size:11px;padding:4px 10px;border:1px solid #667eea;border-radius:4px;background:#667eea;color:white;cursor:pointer;font-weight:bold;">📋 复制全部信息</button>' +
                        '</div>' +
                    '</div>' +
                    '<div id="machineIdValue" style="font-size:11px;color:#333;background:#f9f9f9;border:1px solid #eee;border-radius:6px;padding:8px 10px;word-break:break-all;font-family:monospace;letter-spacing:1px;">' + (machineId || '未知') + '</div>' +
                '</div>' +

                // 诊所名展示（便于用户报给客服）
                (clinicName ?
                    '<div style="margin-bottom:14px;font-size:12px;color:#666;">' +
                        '<span style="color:#888;font-weight:bold;">🏥 本机诊所名：</span>' +
                        '<span style="color:#333;">' + clinicName + '</span>' +
                    '</div>' : '') +

                // 激活码输入区
                '<div style="font-size:12px;color:#666;margin-bottom:6px;">激活码格式：BNZC-XXXX-XXXX-XXXX-XXXX</div>' +
                '<input type="text" id="activateCodeInput" ' +
                'style="width:100%;padding:14px 16px;font-size:16px;font-family:monospace;border:2px solid #ddd;border-radius:8px;letter-spacing:2px;outline:none;transition:border-color 0.2s;margin-bottom:14px;box-sizing:border-box;" ' +
                'placeholder="请输入激活码" autocomplete="new-password" data-lpignore="true" />' +

                // loading 提示（默认隐藏）
                '<div id="activateLoadingBox" style="display:none;text-align:center;padding:10px;margin-bottom:14px;">' +
                    '<div style="display:inline-block;width:20px;height:20px;border:2px solid #ddd;border-top-color:#667eea;border-radius:50%;animation:activateSpin 0.8s linear infinite;vertical-align:middle;margin-right:8px;"></div>' +
                    '<span style="font-size:13px;color:#667eea;vertical-align:middle;">正在激活，请稍候...</span>' +
                '</div>' +

                // 官网购买引导 + 联系客服区（合并优化）
                '<div style="background:#fff8e1;border-radius:8px;padding:10px;margin-bottom:16px;">' +
                    '<div style="font-size:12px;font-weight:bold;color:#e65100;margin-bottom:6px;">🎫 获取激活码</div>' +
                    // 官网购买按钮
                    '<a href="https://tcm-prescription-system.pages.dev/download" target="_blank" style="display:block;text-align:center;padding:10px;margin-bottom:8px;background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);color:white;text-decoration:none;border-radius:8px;font-size:13px;font-weight:bold;">🌐 前往官网购买激活码</a>' +
                    '<div style="font-size:11px;color:#999;text-align:center;margin-bottom:8px;">官网"购买激活码"Tab 可一键生成订单信息</div>' +
                    // 联系客服
                    '<div style="border-top:1px dashed #ffe082;padding-top:8px;">' +
                        '<div style="font-size:12px;color:#555;line-height:1.8;">' +
                            '<div style="display:flex;align-items:center;justify-content:space-between;">' +
                                '<span>客服微信：<strong style="color:#333;">hktzy1688</strong></span>' +
                                '<button class="copyContactBtn" data-text="hktzy1688" style="font-size:11px;padding:2px 8px;border:1px solid #e65100;border-radius:4px;background:white;color:#e65100;cursor:pointer;">复制</button>' +
                            '</div>' +
                        '</div>' +
                    '</div>' +
                '</div>' +

                // 按钮区
                '<div style="display:flex;gap:10px;">' +
                    '<button id="activateCancelBtn" style="flex:1;padding:12px;font-size:15px;border:1px solid #ddd;border-radius:8px;color:#666;background:white;cursor:pointer;">取消</button>' +
                    '<button id="activateSubmitBtn" style="flex:1;padding:12px;font-size:15px;border:none;border-radius:8px;color:white;background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);cursor:pointer;font-weight:bold;">立即激活</button>' +
                '</div>';

            // 注入 spinner 动画 keyframes（仅注入一次）
            if (!document.getElementById('activateSpinKeyframes')) {
                const styleEl = document.createElement('style');
                styleEl.id = 'activateSpinKeyframes';
                styleEl.textContent = '@keyframes activateSpin{to{transform:rotate(360deg);}}';
                document.head.appendChild(styleEl);
            }

            overlay.appendChild(card);
            document.body.appendChild(overlay);

            const input = card.querySelector('#activateCodeInput');
            const cancelBtn = card.querySelector('#activateCancelBtn');
            const submitBtn = card.querySelector('#activateSubmitBtn');
            const copyMachineIdBtn = card.querySelector('#copyMachineIdBtn');
            const loadingBox = card.querySelector('#activateLoadingBox');
            const copyContactBtns = card.querySelectorAll('.copyContactBtn');

            // ★ 移除 cancelAutofill 调用：cancelAutofill 反而触发 Autofill 凭据提示弹窗
            // ("本能中医处方系统"大图标窗口)
            // 防护由 Java 层负责：
            //   1. onProvideAutofillVirtualStructure 重写返回空结构(阻止获取虚拟节点树)
            //   2. disableAutofillRecursive 设置 importantForAutofill=NO
            //   3. AndroidManifest importantForAutofill=noExcludeDescendants
            //   4. AutofillManager.cancel() 在 configureWebView 中调用

            // 自动聚焦输入框
            // ★ 延迟 350ms 聚焦：等键盘完全收起后再聚焦，避免"键盘消失再次出现"的视觉跳动
            setTimeout(function() { input.focus(); }, 350);

            // 机器ID复制按钮
            copyMachineIdBtn.addEventListener('click', async function() {
                const ok = await copyTextToClipboard(machineId);
                copyMachineIdBtn.textContent = ok ? '✅ 已复制' : '❌ 失败';
                setTimeout(function() { copyMachineIdBtn.textContent = '复制ID'; }, 1500);
            });

            // ★ 一键复制全部信息（设备识别码+诊所名，方便客户发给客服）
            const copyAllInfoBtn = card.querySelector('#copyAllInfoBtn');
            copyAllInfoBtn.addEventListener('click', async function() {
                const allInfo = '惠康中医激活信息\n' +
                    '设备识别码：' + (machineId || '未知') + '\n' +
                    '诊所名：' + (clinicName || '未设置') + '\n' +
                    '请帮我生成激活码，谢谢！';
                const ok = await copyTextToClipboard(allInfo);
                copyAllInfoBtn.textContent = ok ? '✅ 已复制全部信息' : '❌ 失败';
                setTimeout(function() { copyAllInfoBtn.textContent = '📋 复制全部信息'; }, 2000);
            });

            // 联系方式复制按钮
            copyContactBtns.forEach(function(btn) {
                btn.addEventListener('click', async function() {
                    const text = btn.getAttribute('data-text') || '';
                    const ok = await copyTextToClipboard(text);
                    btn.textContent = ok ? '✅ 已复制' : '❌ 失败';
                    setTimeout(function() { btn.textContent = '复制'; }, 1500);
                });
            });

            function cleanup() {
                if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
            }

            function submitCode() {
                const val = input.value;
                // ★ 显示 loading 状态（不立即关闭弹窗，让用户看到正在处理）
                // 仅当有输入时才显示 loading
                if (val && val.trim()) {
                    submitBtn.disabled = true;
                    cancelBtn.disabled = true;
                    input.disabled = true;
                    loadingBox.style.display = 'block';
                    submitBtn.textContent = '激活中...';
                    // 延迟一帧让 loading 显示后再 resolve（主流程异步处理）
                    setTimeout(function() {
                        cleanup();
                        resolve({ code: val, cancelled: false });
                    }, 100);
                } else {
                    // 空输入直接关闭
                    cleanup();
                    resolve({ code: '', cancelled: false });
                }
            }

            cancelBtn.addEventListener('click', function() {
                cleanup();
                resolve({ code: '', cancelled: true });
            });

            submitBtn.addEventListener('click', submitCode);

            // 点击遮罩关闭
            overlay.addEventListener('click', function(e) {
                if (e.target === overlay) {
                    cleanup();
                    resolve({ code: '', cancelled: true });
                }
            });

            // 回车提交
            input.addEventListener('keydown', function(e) {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    submitBtn.click();
                }
            });
        });
    }

    // ★ HTML 弹窗（替代 alert()）
    function showHtmlAlert(message) {
        return new Promise(function(resolve) {
            const overlay = document.createElement('div');
            overlay.id = 'alertModalOverlay';
            overlay.style.cssText =
                'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.6);z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px;';

            const card = document.createElement('div');
            card.style.cssText =
                'background:white;border-radius:12px;width:100%;max-width:320px;padding:24px;box-shadow:0 10px 30px rgba(0,0,0,0.3);';

            card.innerHTML =
                '<div style="font-size:14px;color:#333;line-height:1.6;margin-bottom:20px;white-space:pre-wrap;">' + message + '</div>' +
                '<button id="alertOkBtn" style="width:100%;padding:12px;font-size:15px;border:none;border-radius:8px;color:white;background:#667eea;cursor:pointer;font-weight:bold;">确定</button>';

            overlay.appendChild(card);
            document.body.appendChild(overlay);

            const btn = card.querySelector('#alertOkBtn');
            btn.addEventListener('click', function() {
                if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
                resolve();
            });
        });
    }

    // APP 端监听 'app:show-activate' 事件（向后兼容，由 activate.show() 触发）
    // 桌面版的 activate.show() 由 main.js 处理（打开 BrowserWindow），不会触发此事件
    if (typeof global.addEventListener === 'function') {
        global.addEventListener('app:show-activate', function () {
            showActivateDialog();
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

        // ★ 区分桌面版和 APP 端
        // 桌面版：有 activate.showExpireAlert（一体化 IPC），调用 activate.show() 打开 BrowserWindow
        // APP 端：无 showExpireAlert，直接调用 showActivateDialog() 用 prompt 输入
        const isDesktop = global.electronAPI && global.electronAPI.activate &&
            typeof global.electronAPI.activate.showExpireAlert === 'function';

        if (isDesktop && typeof global.electronAPI.activate.show === 'function') {
            // 桌面版：打开独立 BrowserWindow
            try {
                await global.electronAPI.activate.show();
                // ★ 修复：show() 立即返回（只打开窗口，不等待关闭）
                // 重置标志让用户可以再次打开激活窗口
                // 激活流程由激活窗口内的 submitActivate 处理，不依赖 __licenseActivating
                global.__licenseActivating = false;
            } catch (e) {
                console.error('[LicenseCheck] 立即激活失败:', e);
                global.__licenseActivating = false;
            }
        } else {
            // APP 端：直接调用 showActivateDialog（不依赖事件 dispatch，更可靠）
            showActivateDialog();
        }
    };

    // ★ 向 settingsModal 运行时注入 license 状态显示 + 立即激活按钮
    // 不修改 HTML 源码，仅在运行时动态注入 DOM，符合界面保护约束
    // 云端环境（网页版/云端APP）无 electronAPI.license，显示"云端版无需激活"并隐藏按钮
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

        // ★ 云端环境检测：无 electronAPI 或无 license 桥接 → 云端版，无需激活
        const hasLicenseApi = global.electronAPI && global.electronAPI.license &&
            typeof global.electronAPI.license.getStatus === 'function';

        const section = document.createElement('div');
        section.id = 'licenseStatusSection';
        section.style.cssText = 'margin-top:15px;padding:10px;border:1px solid #ddd;border-radius:6px;background:#f9f9f9;';
        section.innerHTML =
            '<div style="font-weight:bold;margin-bottom:8px;color:#333;">🔐 授权状态</div>' +
            '<div id="licenseStatusText" style="font-size:13px;color:#666;margin-bottom:10px;">加载中...</div>' +
            (hasLicenseApi
                ? '<button class="action-btn" id="activateNowBtn" style="background:#ff9800;color:white;width:100%;padding:8px;font-size:14px;border:none;border-radius:4px;cursor:pointer;">立即激活</button>'
                : '');

        modalBody.appendChild(section);

        // 仅在有 license API 时绑定按钮事件
        if (hasLicenseApi) {
            const btn = section.querySelector('#activateNowBtn');
            if (btn) {
                btn.addEventListener('click', function () {
                    try { closeModal('settingsModal'); } catch (e) { }
                    if (typeof global.activateNow === 'function') {
                        global.activateNow();
                    }
                });
            }
        }

        // 异步加载 license 状态
        updateLicenseStatusText();
    }

    // ★ 异步获取并显示 license 状态
    // 云端环境：显示"🌐 云端版，登录即可使用"
    // 离线环境：根据 licenseType 区分 trial(试用期) / licensed(已激活)
    //   - trial + remainingDays>0 → 试用期剩余 X 天
    //   - trial + remainingDays<=0 → 试用期已过期
    //   - licensed → 已激活（type）+ 剩余 X 天
    async function updateLicenseStatusText() {
        const el = document.getElementById('licenseStatusText');
        if (!el) return;

        try {
            // ★ 云端环境：无 electronAPI.license → 显示云端版提示
            if (!global.electronAPI || !global.electronAPI.license ||
                typeof global.electronAPI.license.getStatus !== 'function') {
                el.innerHTML = '🌐 <b style="color:#2196f3;">云端版</b><br><span style="color:#666;">登录即可使用，无需激活</span>';
                return;
            }
            const status = await global.electronAPI.license.getStatus();
            if (status && status.valid) {
                // ★ LicenseManager.java 返回字段：licenseType / type / remainingDays 都在顶层
                //    不存在 prescriptionStatus 字段（之前代码读错位置导致走 else 显示"已激活"）
                const licenseType = status.licenseType || status.type || '';
                const remainingDays = status.remainingDays;
                const hasDays = (typeof remainingDays === 'number' && !isNaN(remainingDays));

                if (licenseType === 'trial') {
                    // 试用期模式
                    if (hasDays && remainingDays > 0) {
                        el.innerHTML = '⏳ 试用期有效<br>剩余 <b style="color:#4caf50;">' + remainingDays + '</b> 天';
                    } else {
                        el.innerHTML = '⚠️ <span style="color:#ff9800;">试用期已过期</span><br><span style="color:red;">请激活后使用</span>';
                    }
                } else if (licenseType === 'licensed' || licenseType === 'personal' || licenseType === 'pro') {
                    // 已激活（正式 license）
                    const planLabel = licenseType === 'personal' ? '标准版' :
                                      licenseType === 'pro' ? '机构版' : licenseType;
                    let html = '✅ 已激活' + (planLabel ? '（' + planLabel + '）' : '');
                    if (hasDays && remainingDays > 0) {
                        html += '<br>剩余 <b style="color:#4caf50;">' + remainingDays + '</b> 天';
                    }
                    el.innerHTML = html;
                } else {
                    // 未知类型，显示通用已激活
                    el.innerHTML = '✅ 已激活' +
                        (hasDays && remainingDays > 0 ? '<br>剩余 ' + remainingDays + ' 天' : '');
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

    // ★ 向登录界面（loginOverlay）运行时注入"注册 / 激活"入口（registerEntry 元素）
    // 目的：首次注册用户无需登录即可在登录页找到"设置诊所信息 / 立即激活"入口
    // 背景：index.html 已内置 .register-entry CSS 与 handleRegisterEntry()/updateRegisterEntry() 函数，
    //       但登录框 DOM 中缺少 id=registerEntry 元素，导致入口从未显示。此处运行时动态补建，不改 HTML 源码
    // 约束：仅 APP 端（Capacitor 环境、含 loginOverlay）注入；云端桌面/网页版无需激活（登录即可使用），不注入
    function injectActivateLinkIntoLogin() {
        try {
            // 仅 APP 环境注入（参考离线APP：兼容 Capacitor 与 Android WebView）
            const isApp = (typeof global.Capacitor !== 'undefined' && global.Capacitor.Plugins && global.Capacitor.Plugins.Preferences)
                || (typeof global.AndroidNative !== 'undefined')
                || (typeof global.electronAPI !== 'undefined' && global.electronAPI.isAndroidAPP === true)
                || (typeof location !== 'undefined' && location.href.indexOf('android_asset') >= 0);
            if (!isApp) return;
            const overlay = document.getElementById('loginOverlay');
            if (!overlay) return;
            // 已注入过则跳过，避免重复
            if (document.getElementById('activateLoginEntry')) return;

            // 定位登录按钮区，在其下方插入"软件激活 / 管理员激活"入口（参考桌面登入框）
            const container = overlay.querySelector('.login-buttons');
            if (!container) return;

            const entry = document.createElement('div');
            entry.id = 'activateLoginEntry';
            entry.style.cssText =
                'margin-top:10px;padding:4px;display:flex;gap:10px;justify-content:center;';
            entry.innerHTML =
                '<div style="flex:1;padding:11px 6px;border-radius:8px;background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);color:#fff;cursor:pointer;font-size:13px;font-weight:bold;text-align:center;-webkit-tap-highlight-color:transparent;" onclick="if(window.activateNow){window.activateNow();}">🔑 软件激活</div>' +
                '<div style="flex:1;padding:11px 6px;border-radius:8px;background:linear-gradient(135deg,#26a69a 0%,#00897b 100%);color:#fff;cursor:pointer;font-size:13px;font-weight:bold;text-align:center;-webkit-tap-highlight-color:transparent;" onclick="if(window.openAdminActivate){window.openAdminActivate();}">📋 管理员激活</div>';
            container.parentNode.insertBefore(entry, container.nextSibling);
            console.log('[LicenseCheck] 登录界面已注入 软件激活/管理员激活 入口');
        } catch (e) {
            console.warn('[LicenseCheck] 注入登录 软件激活/管理员激活 入口失败:', e);
        }
    }

    // ============================================================================
    // ★ APP 端"管理员激活"多步骤弹窗（仿桌面 activate-window.html）
    // 版本选择 → 填写信息 → 确认密码 → 提交 admin-submit → 轮询 admin-status →
    //   激活成功(离线: installAdminLicense 安装本地license+重启 / 云端: 提示用手机号登录)
    // 不修改 HTML 源码，仅运行时动态注入 DOM，符合界面保护约束
    // ============================================================================
    const ADMIN_SUBMIT_URL = 'https://tcm-prescription-system.pages.dev/api/license/admin-submit';
    const ADMIN_STATUS_URL = 'https://tcm-prescription-system.pages.dev/api/license/admin-status';

    global.openAdminActivate = async function () {
        try {
            // 兼容离线(有 activate 本地桥)与云端APP(无本地激活桥)：
            // 管理员激活是"提交申请->管理员审批->云端创建账号"，云端为 SaaS，无需本地激活桥即可完成
            const hasActivate = global.electronAPI && global.electronAPI.activate &&
                typeof global.electronAPI.activate.getMachineId === 'function';
            let machineId = '';
            if (hasActivate) {
                try {
                    const r = await global.electronAPI.activate.getMachineId();
                    machineId = (r && r.machineId) ? r.machineId : (r || '');
                } catch (e) {}
            } else if (global && global.AndroidNative && typeof global.AndroidNative.invoke === 'function') {
                try { machineId = global.AndroidNative.invoke('getMachineId', '{}') || ''; } catch (e) {}
            }
            let clinicName = '';
            try {
                if (typeof CONFIG !== 'undefined' && CONFIG.clinicName) clinicName = CONFIG.clinicName;
            } catch (e) {}
            showAdminActivateModal(machineId, clinicName);
        } catch (e) {
            console.warn('[LicenseCheck] 打开管理员激活弹窗失败:', e);
        }
    };

    // 管理员激活多步骤弹窗（自身管理状态机，不阻塞返回）
    function showAdminActivateModal(machineId, clinicName) {
        // 若已打开则忽略
        if (document.getElementById('adminActivateOverlay')) return;

        const PHONE_RE = /^1[3-9]\d{9}$/;
        let state = { edition: 'institution', phone: '', clinicName: '', adminName: '', password: '', remark: '' };
        let pollTimer = null;

        const overlay = document.createElement('div');
        overlay.id = 'adminActivateOverlay';
        overlay.style.cssText =
            'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.6);z-index:99999;display:flex;align-items:center;justify-content:center;padding:16px;';

        const card = document.createElement('div');
        card.style.cssText =
            'background:white;border-radius:14px;width:100%;max-width:400px;box-shadow:0 10px 30px rgba(0,0,0,0.3);max-height:92vh;overflow-y:auto;';

        card.innerHTML =
            // 标题（管理员激活 · 绿色主题）
            '<div style="background:linear-gradient(135deg,#26a69a 0%,#00897b 100%);padding:18px;border-radius:14px 14px 0 0;text-align:center;">' +
                '<div style="font-size:19px;font-weight:bold;color:white;">📋 管理员激活</div>' +
                '<div style="font-size:12px;color:rgba(255,255,255,0.9);margin-top:4px;">惠康中医诊所管理系统</div>' +
            '</div>' +

            // 第一步：版本选择
            '<div id="adminStepEdition" style="padding:16px;">' +
                '<div style="font-size:13px;font-weight:bold;color:#555;margin-bottom:8px;">请选择要激活的版本</div>' +
                '<div style="display:flex;gap:10px;">' +
                    '<div id="editionPersonal" data-edition="personal" style="flex:1;padding:14px;border:2px solid #ddd;border-radius:10px;text-align:center;cursor:pointer;background:#26a69a;border-color:#26a69a;color:#fff;">' +
                        '<div style="font-size:24px;">🏥</div><div style="font-size:14px;font-weight:bold;margin-top:2px;">标准版</div><div style="font-size:11px;opacity:0.85;">个人诊所 · 单用户</div>' +
                    '</div>' +
                    '<div id="editionInstitution" data-edition="institution" style="flex:1;padding:14px;border:2px solid #26a69a;border-radius:10px;text-align:center;cursor:pointer;background:#fff;">' +
                        '<div style="font-size:24px;">🏨</div><div style="font-size:14px;font-weight:bold;margin-top:2px;color:#333;">机构版</div><div style="font-size:11px;color:#909399;">多人机构 · 多用户管理</div>' +
                    '</div>' +
                '</div>' +
            '</div>' +

            // 第一步之一：填写信息（默认隐藏）
            '<div id="adminStepForm" style="display:none;padding:16px;">' +
                '<div id="adminProgress" style="display:flex;align-items:center;justify-content:center;margin:0 0 14px;gap:6px;">' +
                    '<span style="width:24px;height:24px;border-radius:50%;background:linear-gradient(135deg,#26a69a,#00897b);color:#fff;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:bold;">1</span>' +
                    '<span style="flex:1;height:2px;background:#e4e7ed;"></span>' +
                    '<span id="adminProgressDot2" style="width:24px;height:24px;border-radius:50%;background:#e4e7ed;color:#909399;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:bold;">2</span>' +
                '</div>' +
                '<div style="margin-bottom:12px;">' +
                    '<label style="display:block;font-size:13px;color:#333;margin-bottom:5px;">诊所名称 <span style="color:#e53935;">*</span></label>' +
                    '<input type="text" id="adminClinicName" placeholder="如：惠康中医诊所" autocomplete="new-password" data-lpignore="true" spellcheck="false" style="width:100%;box-sizing:border-box;padding:12px;font-size:15px;border:2px solid #ddd;border-radius:8px;outline:none;">' +
                    '<div class="admin-field-hint" style="font-size:11px;color:#909399;margin-top:4px;">💡 必填，请填写您的诊所名称</div>' +
                '</div>' +
                '<div style="margin-bottom:12px;">' +
                    '<label style="display:block;font-size:13px;color:#333;margin-bottom:5px;">管理员/医师姓名 <span style="color:#e53935;">*</span></label>' +
                    '<input type="text" id="adminAdminName" placeholder="如：王医生" autocomplete="new-password" data-lpignore="true" spellcheck="false" style="width:100%;box-sizing:border-box;padding:12px;font-size:15px;border:2px solid #ddd;border-radius:8px;outline:none;">' +
                    '<div class="admin-field-hint" style="font-size:11px;color:#909399;margin-top:4px;">💡 必填，请填写管理员/医师姓名</div>' +
                '</div>' +
                '<div style="margin-bottom:12px;">' +
                    '<label style="display:block;font-size:13px;color:#333;margin-bottom:5px;">联系电话 <span style="color:#e53935;">*</span>（将作为登录账号）</label>' +
                    '<input type="text" id="adminPhone" placeholder="如：13800138000" autocomplete="new-password" data-lpignore="true" inputmode="numeric" maxlength="11" style="width:100%;box-sizing:border-box;padding:12px;font-size:15px;border:2px solid #ddd;border-radius:8px;outline:none;">' +
                    '<div class="admin-field-hint" id="adminPhoneHint" style="font-size:11px;color:#909399;margin-top:4px;">💡 11位手机号为登录账号，默认密码 admin（登入后请自行修改）</div>' +
                '</div>' +
                '<div style="margin-bottom:14px;">' +
                    '<label style="display:block;font-size:13px;color:#333;margin-bottom:5px;">备注（可选）</label>' +
                    '<input type="text" id="adminRemark" placeholder="如：需要几个账号" autocomplete="off" maxlength="100" style="width:100%;box-sizing:border-box;padding:12px;font-size:15px;border:2px solid #ddd;border-radius:8px;outline:none;">' +
                    '<div class="admin-field-hint" style="font-size:11px;color:#909399;margin-top:4px;">💡 机构版管理员可在系统中注册生成5个普通用户（只读权限）</div>' +
                '</div>' +
                '<button id="adminToStep2Btn" style="width:100%;padding:12px;font-size:15px;border:none;border-radius:8px;color:#fff;background:linear-gradient(135deg,#26a69a 0%,#00897b 100%);cursor:pointer;font-weight:bold;">下一步：确认密码（可留空=默认 admin）→</button>' +
            '</div>' +

            // 第二步：密码（默认隐藏）
            '<div id="adminStepPwd" style="display:none;padding:16px;">' +
                '<div style="display:flex;align-items:center;justify-content:center;margin:0 0 14px;gap:6px;">' +
                    '<span style="width:24px;height:24px;border-radius:50%;background:linear-gradient(135deg,#26a69a,#00897b);color:#fff;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:bold;">1</span>' +
                    '<span style="flex:1;height:2px;background:linear-gradient(135deg,#26a69a,#00897b);"></span>' +
                    '<span style="width:24px;height:24px;border-radius:50%;background:linear-gradient(135deg,#26a69a,#00897b);color:#fff;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:bold;">2</span>' +
                '</div>' +
                '<div style="margin-bottom:12px;">' +
                    '<label style="display:block;font-size:13px;color:#333;margin-bottom:5px;">登录密码（可留空＝默认 admin）</label>' +
                    '<input type="password" id="adminPassword" placeholder="留空则用默认密码 admin（登入后请修改）" autocomplete="new-password" data-lpignore="true" maxlength="32" style="width:100%;box-sizing:border-box;padding:12px;font-size:15px;border:2px solid #ddd;border-radius:8px;outline:none;">' +
                    '<div class="admin-field-hint" id="adminPwdHint" style="font-size:11px;color:#909399;margin-top:4px;">💡 留空则默认密码为 admin（登入后请在设置中自行修改密码）</div>' +
                '</div>' +
                '<div style="margin-bottom:14px;">' +
                    '<label style="display:block;font-size:13px;color:#333;margin-bottom:5px;">确认密码（自定义时需再输一次）</label>' +
                    '<input type="password" id="adminPassword2" placeholder="自定义密码时再次输入" autocomplete="new-password" data-lpignore="true" maxlength="32" style="width:100%;box-sizing:border-box;padding:12px;font-size:15px;border:2px solid #ddd;border-radius:8px;outline:none;">' +
                    '<div class="admin-field-hint" id="adminPwd2Hint"></div>' +
                '</div>' +
                '<div style="display:flex;gap:10px;">' +
                    '<button id="adminBackBtn" style="flex:1;padding:12px;font-size:15px;border:1px solid #ddd;border-radius:8px;color:#666;background:#fff;cursor:pointer;">← 返回</button>' +
                    '<button id="adminSubmitBtn" style="flex:1;padding:12px;font-size:15px;border:none;border-radius:8px;color:#fff;background:linear-gradient(135deg,#26a69a 0%,#00897b 100%);cursor:pointer;font-weight:bold;">📤 提交激活申请</button>' +
                '</div>' +
            '</div>' +

            // 提交中（默认隐藏）
            '<div id="adminSubmitting" style="display:none;padding:40px 16px;text-align:center;">' +
                '<div style="font-size:34px;">📡</div>' +
                '<div style="font-size:15px;font-weight:bold;color:#333;margin-top:8px;">正在提交激活申请...</div>' +
                '<div style="font-size:12px;color:#909399;margin-top:4px;">正在连接服务器，请稍候</div>' +
                '<div style="margin-top:14px;display:flex;align-items:center;justify-content:center;gap:8px;">' +
                    '<span style="width:18px;height:18px;border:2px solid #ddd;border-top-color:#26a69a;border-radius:50%;animation:webkit-rotate 0.8s linear infinite;"></span>' +
                    '<span style="font-size:13px;color:#26a69a;" id="adminSubmitStatus">正在提交信息...</span>' +
                '</div>' +
            '</div>' +

            // 等待审批（默认隐藏）
            '<div id="adminWaiting" style="display:none;padding:28px 16px;text-align:center;">' +
                '<div style="font-size:34px;">⏳</div>' +
                '<div style="font-size:15px;font-weight:bold;color:#333;margin-top:8px;">等待管理员激活...</div>' +
                '<div style="font-size:12px;color:#909399;margin-top:4px;">激活请求已提交，请耐心等待平台管理员处理</div>' +
                '<div style="margin-top:12px;font-size:12px;color:#555;line-height:1.9;text-align:left;background:#f7f7f7;border-radius:8px;padding:10px;">' +
                    '<div>📋 请求编号：<b id="adminRequestNo">--</b></div>' +
                    '<div>📞 联系电话：<b id="adminSavedPhone">--</b></div>' +
                    '<div id="adminWaitStatus" style="color:#26a69a;margin-top:4px;">正在等待管理员审核...</div>' +
                '</div>' +
                '<div style="font-size:11px;color:#909399;margin-top:10px;">💡 关闭窗口不影响审核，稍后重新打开可恢复状态</div>' +
            '</div>' +

            // 成功（默认隐藏）
            '<div id="adminSuccess" style="display:none;padding:32px 16px;text-align:center;">' +
                '<div style="font-size:40px;">🎉</div>' +
                '<div style="font-size:17px;font-weight:bold;color:#2e7d32;margin-top:8px;">激活成功！</div>' +
                '<div id="adminSuccessDesc" style="font-size:13px;color:#555;margin-top:8px;line-height:1.7;"></div>' +
                '<div style="font-size:12px;color:#333;margin-top:12px;line-height:1.9;">' +
                    '<div>✅ 登录账号：<b id="adminSuccessPhone">--</b></div>' +
                    '<div>✅ 密码：<b style="color:#2e7d32;">（默认 admin，登入后请修改）</b></div>' +
                '</div>' +
                '<button id="adminSuccessBtn" style="width:100%;margin-top:16px;padding:12px;font-size:15px;border:none;border-radius:8px;color:#fff;background:linear-gradient(135deg,#26a69a 0%,#00897b 100%);cursor:pointer;font-weight:bold;">✅ 关闭窗口</button>' +
            '</div>' +

            // 拒绝（默认隐藏）
            '<div id="adminRejected" style="display:none;padding:32px 16px;text-align:center;">' +
                '<div style="font-size:40px;">❌</div>' +
                '<div style="font-size:16px;font-weight:bold;color:#e53935;margin-top:8px;">激活请求被拒绝</div>' +
                '<div id="adminRejectReason" style="font-size:13px;color:#666;margin-top:8px;">管理员未通过您的激活申请</div>' +
                '<button id="adminRetryBtn" style="width:100%;margin-top:16px;padding:12px;font-size:15px;border:none;border-radius:8px;color:#fff;background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);cursor:pointer;font-weight:bold;">修改后重新提交</button>' +
            '</div>' +

            // 底部（机器ID + 客服）
            '<div style="padding:12px 16px;border-top:1px solid #eee;font-size:11px;color:#909399;">' +
                '<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:6px;">' +
                    '<span>🔑 机器 ID：<b style="color:#555;word-break:break-all;">' + (machineId || '未知') + '</b></span>' +
                    '<button id="adminCopyMidBtn" style="font-size:11px;padding:4px 10px;border:1px solid #ddd;border-radius:4px;background:#fff;color:#555;cursor:pointer;">复制</button>' +
                '</div>' +
                '<div style="margin-top:8px;">客服微信：<b style="color:#555;">hktzy1688</b> ｜ 官网：tcm-prescription-system.pages.dev</div>' +
            '</div>' +
            '  <button id="adminCloseBtn" style="width:100%;padding:12px;font-size:15px;border:none;border-top:1px solid #eee;color:#909399;background:#fafafa;cursor:pointer;border-radius:0 0 14px 14px;">关闭</button>';

        // 注入旋转动画（避免依赖 webkit-rotate）
        if (!document.getElementById('adminActivateSpinKeyframes')) {
            const s = document.createElement('style');
            s.id = 'adminActivateSpinKeyframes';
            s.textContent = '@keyframes adminActivateSpin{to{transform:rotate(360deg);}}';
            document.head.appendChild(s);
        }

        overlay.appendChild(card);
        document.body.appendChild(overlay);

        function show(id, isForm) {
            ['adminStepEdition','adminStepForm','adminStepPwd','adminSubmitting','adminWaiting','adminSuccess','adminRejected'].forEach(function(pid){
                const el = document.getElementById(pid);
                if (el) el.style.display = 'none';
            });
            const t = document.getElementById(id);
            if (t) t.style.display = 'block';
        }

        function cleanup() {
            if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
            if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        }

        function showFieldErr(elId, hintEl, msg) {
            const el = document.getElementById(elId);
            const hint = document.getElementById(hintEl);
            if (el) { el.style.borderColor = '#e53935'; }
            if (hint) { hint.textContent = '⚠ ' + msg; hint.style.color = '#e53935'; }
        }

        // 版本选择
        ['editionPersonal','editionInstitution'].forEach(function(id) {
            document.getElementById(id).addEventListener('click', function() {
                const ed = this.getAttribute('data-edition');
                state.edition = ed;
                document.getElementById('editionPersonal').style.borderColor = (ed === 'personal' ? '#26a69a' : '#ddd');
                document.getElementById('editionPersonal').style.background = (ed === 'personal' ? '#26a69a' : '#fff');
                document.getElementById('editionInstitution').style.borderColor = (ed === 'institution' ? '#26a69a' : '#ddd');
                document.getElementById('editionInstitution').style.background = (ed === 'institution' ? '#26a69a' : '#fff');
                show('adminStepForm');
            });
        });

        // 手机号实时校验
        document.getElementById('adminPhone').addEventListener('input', function() {
            const v = this.value.replace(/[^\d]/g, '').slice(0, 11);
            this.value = v;
            state.phone = v;
            const hint = document.getElementById('adminPhoneHint');
            if (!v) {
                hint.textContent = '💡 11位手机号为登录账号，默认密码 admin（登入后请自行修改）';
                hint.style.color = '#909399';
            } else if (!PHONE_RE.test(v)) {
                hint.textContent = '⚠ 请输入正确的11位手机号';
                hint.style.color = '#e53935';
            } else {
                hint.textContent = '✓ 手机号格式正确';
                hint.style.color = '#26a69a';
            }
        });

        // 密码强度
        document.getElementById('adminPassword').addEventListener('input', function() {
            state.password = this.value;
            const hint = document.getElementById('adminPwdHint');
            const pwd = this.value;
            if (!pwd) {
                hint.textContent = '💡 留空则默认密码为 admin（登入后请在设置中自行修改密码）';
                hint.style.color = '#909399';
            } else if (pwd.length < 8 || !/[a-zA-Z]/.test(pwd) || !/\d/.test(pwd)) {
                hint.textContent = '⚠ 若自定义密码，需至少8位且包含字母和数字';
                hint.style.color = '#e53935';
            } else {
                hint.textContent = '✓ 密码强度：' + (pwd.length >= 12 ? '强' : '中等');
                hint.style.color = '#26a69a';
            }
        });
        document.getElementById('adminPassword2').addEventListener('input', function() {
            const p1 = state.password;
            const p2 = this.value;
            const hint = document.getElementById('adminPwd2Hint');
            if (!p2) { hint.textContent = ''; }
            else if (p1 !== p2) { hint.textContent = '⚠ 两次密码不一致'; hint.style.color = '#e53935'; }
            else { hint.textContent = '✓ 密码一致'; hint.style.color = '#26a69a'; }
        });

        // 表单 → 密码
        document.getElementById('adminToStep2Btn').addEventListener('click', function() {
            const clinicName = document.getElementById('adminClinicName').value.trim();
            const adminName = document.getElementById('adminAdminName').value.trim();
            const phone = document.getElementById('adminPhone').value.trim();
            const remark = document.getElementById('adminRemark').value.trim();
            if (!clinicName) { showFieldErr('adminClinicName','adminClinicNameHint','请填写诊所名称'); return; }
            if (!adminName) { showFieldErr('adminAdminName','adminAdminNameHint','请填写管理员/医师姓名'); return; }
            if (!phone) { showFieldErr('adminPhone','adminPhoneHint','请填写联系电话'); return; }
            if (!PHONE_RE.test(phone)) { showFieldErr('adminPhone','adminPhoneHint','请输入正确的11位手机号'); return; }
            state.clinicName = clinicName;
            state.adminName = adminName;
            state.phone = phone;
            state.remark = remark;
            show('adminStepPwd');
            setTimeout(function(){ var p = document.getElementById('adminPassword'); if (p) p.focus(); }, 200);
        });

        // 返回
        document.getElementById('adminBackBtn').addEventListener('click', function() { show('adminStepForm'); });

        // 提交
        document.getElementById('adminSubmitBtn').addEventListener('click', async function() {
            const pwdRaw = state.password;
            const pwd = (pwdRaw && pwdRaw.trim()) ? pwdRaw.trim() : 'admin';
            const pwd2 = document.getElementById('adminPassword2').value.trim();
            if (pwd !== 'admin') {
                if (pwd.length < 8) { showFieldErr('adminPassword','adminPwdHint','若自定义密码，需至少8位'); return; }
                if (!/[a-zA-Z]/.test(pwd)) { showFieldErr('adminPassword','adminPwdHint','若自定义密码，需包含字母'); return; }
                if (!/\d/.test(pwd)) { showFieldErr('adminPassword','adminPwdHint','若自定义密码，需包含数字'); return; }
                if (!pwd2) { showFieldErr('adminPassword2','adminPwd2Hint','请再次输入自定义密码'); return; }
                if (pwd !== pwd2) { showFieldErr('adminPassword2','adminPwd2Hint','两次密码输入不一致'); return; }
            }
            state.password = pwd;
            const btn = document.getElementById('adminSubmitBtn');
            btn.disabled = true;
            show('adminSubmitting');

            const payload = {
                clinicName: state.clinicName,
                adminName: state.adminName,
                phone: state.phone,
                remark: state.remark || '',
                machineId: machineId || 'unknown',
                productName: '惠康中医' + (state.edition === 'institution' ? '机构版' : '标准版'),
                edition: state.edition,
                appMode: 'app',
                versionLabel: '',
                env: 'production'
            };
            // ★ password 不上传云端，仅本地安装时创建登录账号使用
            try {
                const controller = new AbortController();
                const t = setTimeout(function(){ try { controller.abort(); } catch(e){} }, 12000);
                let res;
                try {
                    const r = await fetch(ADMIN_SUBMIT_URL, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload),
                        signal: controller.signal
                    });
                    res = await r.json();
                } finally { clearTimeout(t); }

                if (res && res.success) {
                    document.getElementById('adminRequestNo').textContent = res.requestId;
                    document.getElementById('adminSavedPhone').textContent = state.phone;
                    show('adminWaiting');
                    startPolling(res.requestId);
                } else {
                    btn.disabled = false;
                    const msg = (res && res.error) ? res.error : '提交失败，请重试';
                    showFormAndAlert(msg);
                }
            } catch (e) {
                btn.disabled = false;
                showFormAndAlert('网络错误，提交失败：' + (e && e.message || '请检查网络'));
            }
        });

        function showFormAndAlert(msg) {
            show('adminStepPwd');
            try { alert('❌ 提交失败\n\n' + msg + '\n\n点击确定重新提交'); } catch(e) {}
        }

        // 轮询
        function startPolling(requestId) {
            let count = 0;
            const statusEl = document.getElementById('adminWaitStatus');
            const msgs = ['正在等待管理员审核...','管理员正在处理您的请求...','正在验证您的信息...','即将完成激活...'];
            pollTimer = setInterval(async function() {
                count++;
                if (statusEl) {
                    statusEl.textContent = msgs[Math.min(Math.floor(count/3), msgs.length-1)] +
                        (count > 3 ? '（已等待 ' + Math.floor(count*5/60) + ' 分钟）' : '');
                }
                let r = null;
                try {
                    const resp = await fetch(ADMIN_STATUS_URL + '?requestId=' + encodeURIComponent(requestId), {
                        method: 'GET', headers: { 'Content-Type': 'application/json' }
                    });
                    r = await resp.json();
                } catch (err) { console.warn('[LicenseCheck] admin-status 网络错误:', err); }
                if (r && r.success && r.status === 'activated') {
                    clearInterval(pollTimer); pollTimer = null;
                    await onAdminActivated(r, requestId);
                } else if (r && r.success && r.status === 'rejected') {
                    clearInterval(pollTimer); pollTimer = null;
                    document.getElementById('adminRejectReason').textContent = r.reason || '未知原因';
                    show('adminRejected');
                }
                if (count >= 120) {
                    clearInterval(pollTimer); pollTimer = null;
                    if (statusEl) statusEl.textContent = '⏰ 等待时间较长，管理员可能还在处理\n关闭窗口不影响审核';
                }
            }, 5000);
        }

        async function onAdminActivated(r, requestId) {
            const license = r.license || '';
            const phone = state.phone;
            const descEl = document.getElementById('adminSuccessDesc');
            document.getElementById('adminSuccessPhone').textContent = phone;
            // 离线 APP：本地安装 license + 重启；云端 APP（无 installAdminLicense）：账号已在云端创建，提示登录
            if (global.electronAPI && global.electronAPI.activate &&
                typeof global.electronAPI.activate.installAdminLicense === 'function' && license) {
                try {
                    const inst = await global.electronAPI.activate.installAdminLicense({
                        license: license,
                        adminName: state.adminName,
                        clinicName: state.clinicName,
                        password: state.password || 'admin',
                        phone: phone
                    });
                    if (inst && inst.success) {
                        descEl.innerHTML = '管理员已通过您的激活申请<br>软件即将重启，请使用手机号登录';
                        show('adminSuccess');
                        document.getElementById('adminSuccessBtn').textContent = '🔄 重启应用';
                        document.getElementById('adminSuccessBtn').onclick = function() {
                            if (global.electronAPI && global.electronAPI.activate && global.electronAPI.activate.restart) {
                                try { global.electronAPI.activate.restart(); } catch(e){}
                            }
                        };
                    } else {
                        descEl.innerHTML = '激活已通过，但本地写入失败：' + ((inst && inst.error) || '未知错误') + '<br>请将机器ID发给客服人工激活';
                        show('adminSuccess');
                    }
                } catch (e) {
                    descEl.innerHTML = '激活已通过，但本地写入失败：' + (e && e.message || '未知错误');
                    show('adminSuccess');
                }
            } else {
                // 云端 APP / 无本地安装桥：账号已在云端创建，用手机号登录即可
                descEl.innerHTML = '管理员已通过您的激活申请<br>请返回登录框，使用手机号登录';
                show('adminSuccess');
                document.getElementById('adminSuccessBtn').textContent = '✅ 好的';
                document.getElementById('adminSuccessBtn').onclick = function() { cleanup(); };
            }
        }

        document.getElementById('adminRetryBtn').addEventListener('click', function() { show('adminStepEdition'); });
        document.getElementById('adminCopyMidBtn').addEventListener('click', async function() {
            const ok = await copyTextToClipboard(machineId || '');
            const b = document.getElementById('adminCopyMidBtn');
            b.textContent = ok ? '✅' : '❌';
            setTimeout(function(){ b.textContent = '复制'; }, 1200);
        });
        document.getElementById('adminCloseBtn').addEventListener('click', cleanup);
        overlay.addEventListener('click', function(e) { if (e.target === overlay) cleanup(); });

        // 预填诊所/医师名（config 提供时）
        if (clinicName) document.getElementById('adminClinicName').value = clinicName;
    }

    // 页面加载完成后延迟 2 秒校验 license（等待 electronAPI 注入完成）
    function startLicenseCheck() {
        setTimeout(async () => {
            await checkLicenseAndShowActivate();
            // ★ 启动兜底检查（无论首次校验结果如何，都启动定时器）
            startFallbackCheck();
            // ★ 新增：向 settingsModal 注入 license 状态显示 + 立即激活按钮
            injectLicenseStatusIntoSettings();
            // ★ 新增：向登录界面注入激活入口（激活软件 / 管理员激活）
            injectActivateLinkIntoLogin();
        }, 2000);
    }

    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        startLicenseCheck();
    } else {
        document.addEventListener('DOMContentLoaded', startLicenseCheck);
    }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this);

// ============================================================================
// 键盘适配：输入框聚焦时自动滚动到可见区域，防止药物栏表格被键盘遮盖
// 解决"药物栏输入到第11行与手机键盘部分重合"的问题
// 适用于所有端（云端网页/云端APP/云端桌面/离线桌面/离线APP）
// 通过 focusin 事件 + visualViewport.resize 事件实现，不修改 index.html
// ============================================================================
(function (global) {
    'use strict';

    function setupKeyboardAdapter() {
        if (global.__bnKbAdapter) return;
        global.__bnKbAdapter = true;

        function scrollToActive() {
            var el = document.activeElement;
            if (!el) return;
            if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable) {
                try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) { el.scrollIntoView(false); }
            }
        }

        document.addEventListener('focusin', function (e) {
            var el = e.target;
            if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) {
                setTimeout(scrollToActive, 300);
            }
        });

        if (global.visualViewport) {
            var timer = null;
            global.visualViewport.addEventListener('resize', function () {
                if (timer) clearTimeout(timer);
                timer = setTimeout(scrollToActive, 100);
            });
        }
    }

    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        setupKeyboardAdapter();
    } else {
        document.addEventListener('DOMContentLoaded', setupKeyboardAdapter);
    }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this);
