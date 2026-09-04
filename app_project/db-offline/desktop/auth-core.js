/* PREPENDED activation-observer.js (see shared/service/activation-observer.js @ project root) */
/* ============================================================================
 *  activation-observer.js — 客户端激活状态统一观察者（2026-09-03 架构统一 P1）
 *
 *  为什么必须有这个文件：
 *    之前 cloud.js / offline.js / 桌面 main.js IPC / APP Java / login.js
 *    共 6 条独立"观察激活状态"的入口：
 *      ① cloud startPolling   ② offline startPolling  setInterval 各自写
 *      ③ submit 成功短路 activated 分支（各自立即领码）
 *      ④ resumeAdminPendingRequest 仅 cloud 有，offline 没有
 *      ⑤ 桌面 main.js IPC 断点续传 签名不一致：离线有 (rid, machineId) 云端无 machineId
 *
 *   → 导致 Mate 70 复现场景: startPolling setInterval(5000) ≥5s 首延迟 + 用户 5s
 *     内切后台 = onAdminActivated 永不执行 = 本地永远无手机号账号 = 登不上。
 *   → 取消后 admin_phone 索引残留 → admin-status 永远短路 → 观察永远看不到新记录
 *     (这个服务端 P0 修完，客户端 observer 通过多通道 fallback 再兜底)
 *
 *  ★ 架构铁律：
 *     1. 激活状态观察唯一入口 observeActivationStatus(opts)
 *     2. submit 成功: 传 shortCircuitResult=res，observer 立即判 status=activated
 *        立即 emit('activated') → 不走 setInterval 首 5 秒
 *     3. 启动时: resumeFromPersistence() 三通道兜底读
 *        (localStorage.license:adminReqPending → IPC load-admin-request-id → Capacitor Preferences)
 *     4. 轮询失败时 machineId fallback scan + phone fallback scan（双 fallback，
 *        防止 admin_phone 索引指错记录，比如 cancelled 残留漏维护时自救）
 *     5. 所有底层通道探测都做 feature 检测 + try/catch，抛错不阻断
 *
 *  导出：window.ObserveActivationStatus（浏览器端）
 *        module.exports 形式在 Electron/Node 环境可用
 *  使用：
 *    const o = ObserveActivationStatus({ requestId:..., machineId:..., phone:...,
 *                                         apiBase: '/api/license',
 *                                         shortCircuitResult: submitResponse (可选),
 *                                         persistPending: true });
 *    o.on('activated', licenseData => installLicense(licenseData));
 *    o.on('status-change', (s,p) => updateUI(s,p));
 *    o.on('error', err => log(err));
 *    o.start();   // 三通道 resume + 立即 poll(0s) + 之后每 5s
 *    o.stop();    // 停轮询 + 清持久化（正常 activated 后调用）
 * ========================================================================== */
(function (global) {
    'use strict';

    // -------------------------------------------------------------------
    // 工具：safeStorage 加密 / 解密（与 offline.js encryptSensitive 对齐，避免重复造轮子）
    //   - 优先 electron.safeStorage / electronAPI.safeStorage
    //   - 否则 XORv2+btoa 兜底 + ENC:/XORv2: 前缀
    //   - fail-safe 加密失败返回空字符串, 不写明文
    // -------------------------------------------------------------------
    function _safeEncrypt(plainText) {
        try {
            if (!plainText) return '';
            const ea = global.electronAPI || (global.window && global.window.electronAPI);
            if (ea && typeof ea.safeStorage === 'function') {
                // Desktop electron expose via ipc: safeStorage.encryptString(string)
                return 'ENC:' + String(ea.safeStorage(plainText));
            }
            if (global.require) {
                try {
                    const { safeStorage } = global.require('electron');
                    if (safeStorage && safeStorage.isEncryptionAvailable && safeStorage.isEncryptionAvailable()) {
                        const buf = safeStorage.encryptString(String(plainText));
                        if (buf) return 'ENC:' + buf.toString('base64');
                    }
                } catch (_) { /* ignore */ }
            }
            // XORv2 fallback
            const key = 'act_observer_v1_xor_fallback_key';
            let out = '';
            const s = String(plainText);
            for (let i = 0; i < s.length; i++) {
                out += String.fromCharCode(s.charCodeAt(i) ^ key.charCodeAt(i % key.length));
            }
            // btoa 在浏览器+Electron 可用; 纯 Node 用 Buffer
            let encoded;
            try { encoded = global.btoa(out); }
            catch (_) { encoded = Buffer.from(out, 'binary').toString('base64'); }
            return 'XORv2:' + encoded;
        } catch (_) { return ''; }
    }

    function _safeDecrypt(encText) {
        try {
            if (!encText) return '';
            if (typeof encText !== 'string') return '';
            if (encText.startsWith('ENC:')) {
                const body = encText.slice(4);
                const ea = global.electronAPI || (global.window && global.window.electronAPI);
                if (ea && typeof ea.safeStorageDecrypt === 'function') {
                    return String(ea.safeStorageDecrypt(body));
                }
                if (global.require) {
                    try {
                        const { safeStorage } = global.require('electron');
                        if (safeStorage && safeStorage.isEncryptionAvailable && safeStorage.isEncryptionAvailable()) {
                            return safeStorage.decryptString(Buffer.from(body, 'base64'));
                        }
                    } catch (_) { /* ignore */ }
                }
                return '';  // 解密失败 fail-safe 不做明文回退
            }
            if (encText.startsWith('XORv2:')) {
                const body = encText.slice(6);
                let out;
                try { out = global.atob(body); }
                catch (_) { out = Buffer.from(body, 'base64').toString('binary'); }
                const key = 'act_observer_v1_xor_fallback_key';
                let s = '';
                for (let i = 0; i < out.length; i++) {
                    s += String.fromCharCode(out.charCodeAt(i) ^ key.charCodeAt(i % key.length));
                }
                return s;
            }
            // 兼容旧明文 password 字段（只读兼容）
            return encText;
        } catch (_) { return ''; }
    }

    function _lsGet(key) { try { return (global.localStorage && global.localStorage.getItem(key)) || null; } catch (_) { return null; } }
    function _lsSet(key, val) { try { if (global.localStorage) global.localStorage.setItem(key, val); } catch (_) { /* ignore */ } }
    function _lsDel(key) { try { if (global.localStorage) global.localStorage.removeItem(key); } catch (_) { /* ignore */ } }

    function _objFromLs(text) { try { return text ? JSON.parse(text) : null; } catch (_) { return null; } }

    // -------------------------------------------------------------------
    // 核心类 ActivationObserver
    // -------------------------------------------------------------------
    class ActivationObserver {
        constructor(opts) {
            this.opts = Object.assign({
                requestId: null,
                machineId: null,
                phone: null,
                apiBase: '/api/license',
                shortCircuitResult: null,
                persistPending: true,
                pollIntervalMs: 5000,
                maxPolls: 360  // 30 min 最长
            }, opts || {});
            this._listeners = {};
            this._timer = null;
            this._pollCount = 0;
            this._started = false;
            this._stopped = false;
            this._lastStatus = null;
            // 立即领码回调是否已执行（幂等）
            this._activatedDone = false;
            this._pendingLSKey = 'license:adminReqPending';
        }

        on(evt, fn) {
            (this._listeners[evt] = this._listeners[evt] || []).push(fn);
            return this;
        }
        _emit(evt, a, b) {
            const list = this._listeners[evt] || [];
            for (const fn of list) { try { fn(a, b); } catch (e) { console.error('[activation-observer] listener err', evt, e); } }
        }

        // ---------------------------------------------------------------
        // 持久化：submit 成功即存（重启时三通道 resume），activated 成功清
        // ---------------------------------------------------------------
        _persistPending(extra) {
            if (!this.opts.persistPending) return;
            const phone = this.opts.phone || (extra && extra.phone) || '';
            const pwRaw = (extra && extra.password != null) ? extra.password : (this.opts && this.opts.password);
            const passwordEnc = pwRaw ? _safeEncrypt(String(pwRaw)) : '';
            const payload = {
                requestId: this.opts.requestId || (extra && extra.requestId) || null,
                machineId: this.opts.machineId || (extra && extra.machineId) || null,
                phone: phone,
                adminName: extra && extra.adminName ? extra.adminName : (this.opts.adminName || ''),
                clinicName: extra && extra.clinicName ? extra.clinicName : (this.opts.clinicName || ''),
                edition: extra && extra.edition ? extra.edition : (this.opts.edition || ''),
                passwordEnc: passwordEnc,
                savedAt: new Date().toISOString(),
                // 历史明文 password 兼容: 不存
                _v: 2
            };
            // 三通道：1. localStorage
            _lsSet(this._pendingLSKey, JSON.stringify(payload));
            // 2. IPC save-admin-request-id（桌面端）
            try {
                const ea = global.electronAPI || (global.window && global.window.electronAPI);
                if (ea && typeof ea.saveAdminRequestId === 'function') {
                    ea.saveAdminRequestId(payload.requestId, {
                        phone: payload.phone,
                        password: passwordEnc || '',  // 桌面 IPC 传的是加密后字符串，主进程 safeStorage 解
                        machineId: payload.machineId,
                        clinicName: payload.clinicName,
                        adminName: payload.adminName,
                        edition: payload.edition
                    }).catch(() => { /* ignore ipc err */ });
                }
            } catch (_) { /* ignore */ }
            // 3. Capacitor Preferences（APP WebView）
            try {
                const Plugins = global.Plugins || (global.Capacitor && global.Capacitor.Plugins);
                if (Plugins && Plugins.Preferences && typeof Plugins.Preferences.set === 'function') {
                    Plugins.Preferences.set({ key: this._pendingLSKey, value: JSON.stringify(payload) }).catch(() => {});
                }
            } catch (_) { /* ignore */ }
        }

        _clearPending() {
            _lsDel(this._pendingLSKey);
            try {
                const ea = global.electronAPI || (global.window && global.window.electronAPI);
                if (ea && typeof ea.clearAdminRequestId === 'function') {
                    ea.clearAdminRequestId().catch(() => {});
                }
            } catch (_) { /* ignore */ }
            try {
                const Plugins = global.Plugins || (global.Capacitor && global.Capacitor.Plugins);
                if (Plugins && Plugins.Preferences && typeof Plugins.Preferences.remove === 'function') {
                    Plugins.Preferences.remove({ key: this._pendingLSKey }).catch(() => {});
                }
            } catch (_) { /* ignore */ }
        }

        async _resumeFromPersistence() {
            // 三通道兜底读：1. localStorage
            let data = null;
            const ls = _lsGet(this._pendingLSKey);
            if (ls) data = _objFromLs(ls);
            // 2. IPC load-admin-request-id（桌面端 main.js 启动已自己跑了；渲染层做冗余兜底）
            if (!data) {
                try {
                    const ea = global.electronAPI || (global.window && global.window.electronAPI);
                    if (ea && typeof ea.loadAdminRequestId === 'function') {
                        const ipc = await ea.loadAdminRequestId();
                        if (ipc && ipc.requestId) data = Object.assign({}, ipc, { _from: 'ipc' });
                    }
                } catch (_) { /* ignore */ }
            }
            // 3. Capacitor Preferences
            if (!data) {
                try {
                    const Plugins = global.Plugins || (global.Capacitor && global.Capacitor.Plugins);
                    if (Plugins && Plugins.Preferences && typeof Plugins.Preferences.get === 'function') {
                        const prefs = await Plugins.Preferences.get({ key: this._pendingLSKey });
                        if (prefs && prefs.value) data = _objFromLs(prefs.value);
                    }
                } catch (_) { /* ignore */ }
            }
            if (!data) return null;
            // 解密 passwordEnc
            if (data.passwordEnc && !data.password) data.password = _safeDecrypt(data.passwordEnc);
            // 兼容老明文 password 只读
            // 合入 opts（resume 的值比构造时更权威，因为它是 submit 当时保存的）
            if (data.requestId && !this.opts.requestId) this.opts.requestId = data.requestId;
            if (data.phone && !this.opts.phone) this.opts.phone = data.phone;
            if (data.machineId && !this.opts.machineId) this.opts.machineId = data.machineId;
            if (data.adminName && !this.opts.adminName) this.opts.adminName = data.adminName;
            if (data.clinicName && !this.opts.clinicName) this.opts.clinicName = data.clinicName;
            if (data.edition && !this.opts.edition) this.opts.edition = data.edition;
            if (data.password) this.opts.password = data.password;
            return data;
        }

        // ---------------------------------------------------------------
        // 轮询：admin-status GET
        // ---------------------------------------------------------------
        _statusUrl(params) {
            const base = this.opts.apiBase + '/admin-status';
            const qs = Object.keys(params).map(k => encodeURIComponent(k) + '=' + encodeURIComponent(params[k])).join('&');
            return base + (qs ? '?' + qs : '');
        }

        async _pollOnce() {
            const { requestId, machineId, phone } = this.opts;
            // 优先带 requestId（O(1)）+ machineId 兜底（scan）
            const q = {};
            if (requestId) q.requestId = requestId;
            if (machineId) q.machineId = machineId;
            const doFetch = async (params) => {
                if (typeof this.opts.fetchAdminStatus === 'function') {
                    return this.opts.fetchAdminStatus(this._statusUrl(params), params);
                }
                try {
                    const res = await fetch(this._statusUrl(params), { method: 'GET' });
                    return await res.json().catch(() => null);
                } catch (e) { console.warn('[activation-observer] poll fetch error', e); return null; }
            };
            let data = await doFetch(q);
            // 若读回来 status=cancelled 且有 phone → admin_phone 索引残留指向错记录
            // → fallback：只按 machineId 不带 requestId 重查一次（自救）
            if (data && data.success && data.status === 'cancelled' && machineId) {
                try {
                    const fbData = await doFetch({ machineId: machineId, phone: phone || '' });
                    if (fbData && fbData.success && (fbData.status === 'activated' || fbData.status === 'pending')) {
                        data = fbData;
                    }
                } catch (_) { /* ignore */ }
            }
            return data;
        }

        _setResultAndEmit(payload) {
            const s = payload && payload.status;
            if (s && s !== this._lastStatus) {
                this._lastStatus = s;
                this._emit('status-change', s, payload);
            }
            if (s === 'activated' && payload && payload.license && !this._activatedDone) {
                this._activatedDone = true;
                this._emit('activated', payload);
                // 不立即 stop：保留轮询 3 次(15s)，让 admin-approve 补写的
                // clinicUsers/expiresAt/role 等数据也被用户拉到（登录时再补拉但保险）
                this._pendingStopAfter = 3;
            }
            if (s === 'rejected' || s === 'cancelled') {
                // rejected 或 cancelled → 用户主动触发结束；清理 pending 不做（用户可能要重提交）
                this._emit('terminal', s, payload);
                this.stop();
            }
        }

        async _tick() {
            if (this._stopped) return;
            this._pollCount++;
            const data = await this._pollOnce();
            if (data && data.success) {
                // 把激活 requestId/machineId/phone 持久态再覆盖一次
                if (data.requestId && !this.opts.requestId) this.opts.requestId = data.requestId;
                if (data.licenseInfo && data.licenseInfo.phone && !this.opts.phone) this.opts.phone = data.licenseInfo.phone;
                this._setResultAndEmit(data);
            }
            if (this._pendingStopAfter != null) {
                this._pendingStopAfter--;
                if (this._pendingStopAfter <= 0) this.stop();
            }
            if (this._pollCount >= this.opts.maxPolls) {
                this._emit('error', new Error('activation polling timeout (30min)'));
                this.stop();
            }
        }

        // ---------------------------------------------------------------
        // 启动/停止对外 API
        // ---------------------------------------------------------------
        async start() {
            if (this._started) return;
            this._started = true;
            this._stopped = false;

            // 1. resume from persistence（三通道兜底）
            const resumed = await this._resumeFromPersistence().catch(() => null);
            if (resumed) this._emit('resumed', resumed);

            // 2. shortCircuitResult 短路：如果 submit 直接返 activated + license
            //    → 立即 emit activated，0 秒，不等 startPolling 首 5 秒
            if (this.opts.shortCircuitResult && typeof this.opts.shortCircuitResult === 'object') {
                const sc = this.opts.shortCircuitResult;
                if (sc.success === true && sc.status === 'activated') {
                    if (sc.requestId && !this.opts.requestId) this.opts.requestId = sc.requestId;
                    if (!this._activatedDone) {
                        // 先保存（用户万一领码过程中切后台，重启仍能 resume 再装）
                        this._persistPending({
                            requestId: sc.requestId,
                            phone: sc.licenseInfo && sc.licenseInfo.phone ? sc.licenseInfo.phone : null,
                            adminName: sc.licenseInfo && sc.licenseInfo.user ? sc.licenseInfo.user : null,
                            clinicName: sc.licenseInfo && sc.licenseInfo.clinicName ? sc.licenseInfo.clinicName : null
                        });
                        this._setResultAndEmit(sc);
                    }
                } else if (sc.success === true && sc.requestId) {
                    // 非 activated，保存 pending 状态
                    if (!this.opts.requestId) this.opts.requestId = sc.requestId;
                    this._persistPending(sc);
                    this._setResultAndEmit(sc);
                }
            } else {
                // 没有短路：保存当前 pending 状态（三通道）
                this._persistPending({});
            }

            // 3. 立即 poll(0s) — 修复 setInterval 首 5s 延迟的另一条通道
            //    即使 shortCircuitResult 路径没命中（老客户端没下发 license），
            //    也能在 0s 就查 admin-status，activated 的 0 秒就领到号。
            try { await this._tick(); } catch (_) { /* ignore */ }

            // 4. 之后按 pollIntervalMs 继续轮询（5 秒默认）
            if (!this._stopped) {
                this._timer = setInterval(() => { this._tick().catch(() => {}); }, this.opts.pollIntervalMs);
            }
        }

        stop() {
            this._stopped = true;
            if (this._timer) { clearInterval(this._timer); this._timer = null; }
            this._emit('stopped');
        }

        // 显式清理（activated 安装成功后调，把三通道持久化全部清掉，避免下次启动重复装）
        completeAndClear() {
            this.stop();
            this._clearPending();
        }

        // 辅助：给 onActivated 读最终 password 用（三兜底：opts → persisted → 'admin'）
        resolveInstallPassword(defaultPwd = 'admin') {
            if (this.opts.password) return this.opts.password;
            return defaultPwd;
        }
        resolveInstallPhone(defaultPhone = '') {
            if (this.opts.phone) return this.opts.phone;
            return defaultPhone;
        }
    }

    function ObserveActivationStatus(opts) { return new ActivationObserver(opts); }
    ObserveActivationStatus.Observer = ActivationObserver;
    ObserveActivationStatus.safeEncrypt = _safeEncrypt;
    ObserveActivationStatus.safeDecrypt = _safeDecrypt;

    // UMD-like export
    if (typeof module !== 'undefined' && module.exports) module.exports = ObserveActivationStatus;
    global.ObserveActivationStatus = ObserveActivationStatus;

})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));


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

    // ==================== 敏感信息加密（license:adminReqPending 密码明文风险修复）
    //   桌面优先 electronAPI.safeStorage（DPAPI/Keychain），APP 退 XOR +
    //   btoa + 前缀标记；无桥时同样退 XOR（localStorage 不存明文密码——桌面 userData
    //   / APP 沙箱被拿到即可直接读）。加密失败仍不持久化明文（fail-safe）。
    //   ★ 2026-09-03 安全审查补漏：之前修复把激活弹窗自设 password 明文直接写
    //   localStorage.license:adminReqPending = 可离线读客户密码。
    // ==================== 2026-09-04 Phase 2.2 · license:state v2 统一状态机 FSM
    //   ★ 目标架构铁律 5（补充到 KNOWLEDGE §7）：激活流程的"客户端状态"= 单一权威入口 license:state:v2，
    //     不再有 5 处分散读 adminReqPending / activated / approvalStatus / adminObserveStarted 等
    //     老 key 造成状态漂移导致的"明明激活了但弹窗还在/断点续传不跑"偶发问题。
    //   6 状态枚举：
    //     unactivated       = 未激活（默认初始态）
    //     pending_payment   = 客户端已提交激活申请→等待客户完成官网付款
    //     pending_approval  = 客户已付款→等待惠康中医后台管理员审核通过
    //     activated_installing = 审核通过(activated)→正在本地执行 installAdminLicense → 同步账号 → 提示重启
    //     activated_ready   = 已完全激活成功（license 有效 + 本地账号同步完）
    //     expired_disabled  = 授权过期/平台停用/客户违规停用
    //   实现策略（缺口层最小，零回归，100% 新旧兼容）：
    //     (1) 只新增 FSM v2 读写 key，不删除不修改旧 5 处分散代码；
    //     (2) 启动时 migrateV1ToV2：把旧 key（license:adminReqPending / license:activatedDoneFlag
    //         / checkLicense 结果）无损映射到 v2 单状态；
    //     (3) setStateV2 在写 v2 同时兼容旧行为：pending 写老 adminReqPending、activated_ready
    //         自动清老 adminReqPending → 旧代码读旧 key 仍然得到正确结果；
    //     (4) 暴露统一只读入口 getLicenseStateV2() → 以后新诊断/新弹窗/新按钮只调这一个。
    const _STATE_KEY_V2 = 'license:state:v2';
    const _STATES = {
        UNACTIVATED: 'unactivated',
        PENDING_PAYMENT: 'pending_payment',
        PENDING_APPROVAL: 'pending_approval',
        ACTIVATED_INSTALLING: 'activated_installing',
        ACTIVATED_READY: 'activated_ready',
        EXPIRED_DISABLED: 'expired_disabled'
    };
    // 只读入口（对外统一）：任何新代码都读这，不用看分散的旧 key
    async function getLicenseStateV2() {
        try { await migrateLicenseStateV1ToV2(); } catch(_) {}
        try {
            const raw = await StorageAdapter.getItem(_STATE_KEY_V2);
            if (!raw) return { state: _STATES.UNACTIVATED, meta: {} };
            const obj = JSON.parse(raw);
            if (!obj || !obj.state) return { state: _STATES.UNACTIVATED, meta: {} };
            return { state: obj.state, meta: obj.meta || {}, _v2: true };
        } catch(e) {
            return { state: _STATES.UNACTIVATED, meta: {}, err: String(e.message || e) };
        }
    }
    // 只写入口：旧代码改旧 key 时应同步调 setStateV2 保持单源一致；当前缺口层只在关键节点调用（submit成功/轮询pending/activated/installed/清数据），未来再逐步替换旧写。
    async function setStateV2(nextState, metaOverride) {
        if (!nextState || !Object.values(_STATES).includes(nextState)) {
            console.warn('[FSM v2] 非法 state:', nextState);
            return;
        }
        let meta = {};
        try {
            const prevRaw = await StorageAdapter.getItem(_STATE_KEY_V2);
            if (prevRaw) {
                try { meta = (JSON.parse(prevRaw) || {}).meta || {}; } catch(_) {}
            }
        } catch(_) {}
        if (metaOverride && typeof metaOverride === 'object') {
            meta = Object.assign({}, meta, metaOverride);
        }
        meta.transitionAt = Date.now();
        const payload = { state: nextState, meta: meta, schema: 2 };
        try { await StorageAdapter.setItem(_STATE_KEY_V2, JSON.stringify(payload)); }
        catch (e) { console.warn('[FSM v2] 写入失败(不影响旧流程):', e); }
        console.log('[FSM v2] transition:', (meta && meta.prevState ? meta.prevState + ' -> ' : '') + nextState, meta || '');
    }
    // 迁移：启动时执行一次（幂等可重复执行）→ 旧 key 无损映射到 v2
    async function migrateLicenseStateV1ToV2() {
        try {
            const cur = await StorageAdapter.getItem(_STATE_KEY_V2);
            if (cur && /"schema"\s*:\s*2/.test(cur)) return; // 已经是 v2 schema 2 幂等跳过
        } catch(_) {}
        let nextState = _STATES.UNACTIVATED;
        let meta = { migrated: true, migratedAt: Date.now() };
        try {
            const req = await StorageAdapter.getItem('license:adminReqPending');
            if (req) {
                try {
                    const r = JSON.parse(req);
                    if (r && r.requestId) {
                        // 旧 adminReqPending：如果 status=pending 就 pending_payment/pending_approval
                        // 没有 status 字段则默认 pending_approval（因为旧版只有付款后才存）
                        const status = String((r.status || r.adminStatus || r.paymentStatus || '')).toLowerCase();
                        nextState = (status === 'pending_payment' || status === 'payment_pending' || /unpaid|paying|待付款/.test(status))
                            ? _STATES.PENDING_PAYMENT
                            : _STATES.PENDING_APPROVAL;
                        meta.requestId = r.requestId;
                        meta.phone = r.phone || '';
                        meta.adminName = r.adminName || '';
                        meta.clinicName = r.clinicName || '';
                        meta.at = r.at || 0;
                    }
                } catch (parseErr) {}
            }
            // 如果有 activatedDoneFlag 或 license=valid（checkLicense 结果）→ activated_ready
            try {
                const actDone = await StorageAdapter.getItem('license:activatedDoneFlag');
                if (actDone === '1' || actDone === 'true') nextState = _STATES.ACTIVATED_READY;
            } catch(_) {}
            try {
                if (window.electronAPI && window.electronAPI.license && typeof window.electronAPI.license.getStatus === 'function') {
                    const r = await window.electronAPI.license.getStatus();
                    if (r && r.valid === false && /expired|disabled|停用/.test(String(r.reason || ''))) {
                        nextState = _STATES.EXPIRED_DISABLED;
                        meta.reason = r.reason || '';
                    } else if (r && r.valid) {
                        if (nextState !== _STATES.PENDING_APPROVAL && nextState !== _STATES.PENDING_PAYMENT) {
                            nextState = _STATES.ACTIVATED_READY;
                        }
                    }
                }
            } catch(_) {}
        } catch (e) { console.warn('[FSM v2] migrate 异常(回退 unactivated):', e); nextState = _STATES.UNACTIVATED; }
        await setStateV2(nextState, meta);
    }
    // 暴露给诊断/新 UI
    if (typeof window !== 'undefined') {
        window.__getLicenseStateV2 = getLicenseStateV2;
        window.__setLicenseStateV2 = setStateV2;
        window.__LICENSE_STATES_V2 = _STATES;
    }
    // 第一次启动（DOMContentLoaded 触发 startLicenseCheck 之前，如果 DOMContentLoaded 已经触发就立即跑迁移）
    try {
        const _runMigrate = function () { setTimeout(function () { migrateLicenseStateV1ToV2().catch(function () {}); }, 0); };
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _runMigrate, { once: true });
        else _runMigrate();
    } catch(_) {}

    const _SENS_SALT = 'bnzc_admin_req_sens_salt_v1';
    function _sensXor(text, decode) {
        if (!text) return '';
        let result = '';
        for (let i = 0; i < text.length; i++) {
            result += String.fromCharCode(text.charCodeAt(i) ^ _SENS_SALT.charCodeAt(i % _SENS_SALT.length));
        }
        return result;
    }
    async function encryptSensitive(value) {
        if (value == null || value === '') return '';
        try {
            const api = (global.electronAPI || {});
            if (api && typeof api.safeStorageAvailable === 'function' &&
                typeof api.encryptString === 'function') {
                const ok = await api.safeStorageAvailable();
                if (ok) {
                    const r = await api.encryptString(String(value));
                    if (r) return 'ENC:' + r; // electron preload 已 prefix ENC:，这里再加=安全双保险
                }
            }
        } catch (e) { /* bridge 不可用，退本地 XOR */ }
        try {
            return 'XORv2:' + btoa(unescape(encodeURIComponent(_sensXor(String(value), false))));
        } catch (e) { return ''; }
    }
    async function decryptSensitive(enc) {
        if (!enc || typeof enc !== 'string') return '';
        try {
            if (enc.startsWith('ENC:')) {
                const rest = enc.substring(4);
                const inner = rest.startsWith('ENC:') ? rest.substring(4) : rest;
                const api = (global.electronAPI || {});
                if (api && typeof api.decryptString === 'function') {
                    const r = await api.decryptString(inner);
                    if (r) return r;
                }
                return ''; // safeStorage 失败，绝不尝试本地解密（加密绑定系统账号）
            }
            if (enc.startsWith('XORv2:')) {
                const cipher = decodeURIComponent(escape(atob(enc.substring(6))));
                return _sensXor(cipher, true);
            }
        } catch (e) { return ''; }
        return '';
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

    // ★★★ 2026-08-21 设备身份采集（账号级设备授权 + 单设备在线互斥）
    //   桌面版：electronAPI.activate.getMachineId()（真实机器指纹，计入 2 台授权名额）
    //   APP 端：持久化随机指纹（Capacitor Preferences / localStorage，计入 2 台授权名额）
    //   网页版：浏览器持久化指纹（browser-xxx，不计入名额，仅参与在线互斥）
    async function collectDeviceIdentity() {
        let clientClass = 'web';
        let machineId = '';
        try {
            if (global.electronAPI && global.electronAPI.activate &&
                typeof global.electronAPI.activate.getMachineId === 'function') {
                machineId = await global.electronAPI.activate.getMachineId();
                clientClass = 'desktop';
            } else if (global.Capacitor) {
                clientClass = 'app';
            }
        } catch (e) { /* 采集失败继续走指纹兜底 */ }

        const mid = String(machineId || '').trim();
        if (mid && mid.length >= 8 && mid !== 'unknown') {
            return { machineId: mid, clientClass: clientClass };
        }

        // 指纹兜底：持久化随机指纹（同一浏览器/设备重复登录指纹不变，不重复占用名额）
        const FINGERPRINT_KEY = 'auth:deviceMachineId';
        try {
            let fp = '';
            try { fp = await StorageAdapter.getItem(FINGERPRINT_KEY); } catch (e) {}
            if (!fp || String(fp).length < 8) {
                const rnd = Array.from(crypto.getRandomValues(new Uint8Array(9)))
                    .map(b => b.toString(16).padStart(2, '0')).join('');
                fp = 'browser-' + rnd;
                await StorageAdapter.setItem(FINGERPRINT_KEY, fp);
            }
            return { machineId: fp, clientClass: clientClass };
        } catch (e) {
            return {
                machineId: 'browser-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
                clientClass: clientClass
            };
        }
    }

    // 云端适配器
    const cloudAdapter = {
        async authenticate(username, password) {
            try {
                const fetchFn = global.cloudFetch || global.fetch;
                // ★ 2026-08-21 上报设备身份：后端据此做设备绑定（2台上限）+ 单点在线互斥
                const identity = await collectDeviceIdentity();
                const response = await fetchFn(`${CLOUD_API_BASE}/users?login=true`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        username,
                        password,
                        machineId: identity.machineId,
                        clientClass: identity.clientClass
                    })
                });
                // cloudFetch 返回已解析的 JS 对象，原生 fetch 返回 Response 对象
                const data = (response && typeof response.json === 'function')
                    ? await response.json()
                    : response;
                if (!data || !data.success || !data.user) {
                    // ★ 设备数超限：明确提示（403 DEVICE_LIMIT）
                    if (data && data.code === 'DEVICE_LIMIT') {
                        return { success: false, error: data.error || '设备数已达上限（最多授权 2 台设备），请先解绑旧设备', code: 'DEVICE_LIMIT' };
                    }
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

    // ★ 优化3：密码错误锁定辅助工具（前4次不锁定，第5次起锁定，登录成功自动清零）
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
                return '尝试次数过多，请 ' + Math.max(1, remainMin) + ' 分钟后重试';
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
                return '密码错误次数过多，账号已暂时锁定，请稍后再试';
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

    // ★ 2026-08-28 安全加固：激活后禁用试用默认账户 admin/admin（离线标准版/机构版激活后门）
    //   规则：username==='admin' 精确值（仅试用默认账户，自定义 admin_xxx 简码放行） 且 系统已激活 → 拒绝
    //   激活判定双通道：① Electron 主进程 license.getStatus() valid===true && type!=='trial'；② Storage/localStorage 中 license:code 长度>=4（已写入激活码）
    //   注：调用方务必放在密码校验通过之后再调用，避免通过错误信息差枚举账户是否存在
    async function _blockTrialAdminAfterLicensed(user) {
        try {
            if (!user) return false;
            if (String(user.username || '').trim() !== 'admin') return false;
            let licensed = false;
            try {
                const api = global.electronAPI || (typeof window !== 'undefined' ? window.electronAPI : null);
                if (api && api.license && typeof api.license.getStatus === 'function') {
                    const st = await api.license.getStatus();
                    if (st && st.valid === true) {
                        const t = String(st.licenseType || st.type || '');
                        if (t && t !== 'trial') licensed = true;
                    }
                }
            } catch (_) {}
            if (!licensed) {
                try {
                    if (typeof StorageAdapter !== 'undefined' && StorageAdapter &&
                        typeof StorageAdapter.getItem === 'function') {
                        const c = await StorageAdapter.getItem('license:code');
                        if (c && String(c).trim().length >= 4) licensed = true;
                    }
                } catch (_) {}
            }
            if (!licensed) {
                try {
                    const ls = (typeof global !== 'undefined' && global.localStorage) ||
                               (typeof window !== 'undefined' ? window.localStorage : null);
                    if (ls) {
                        const c = ls.getItem('license:code');
                        if (c && String(c).trim().length >= 4) licensed = true;
                    }
                } catch (_) {}
            }
            return licensed;
        } catch (_) { return false; }
    }

    // 离线适配器工厂
    function createLocalAdapter(getUsersFn) {
        return {
            async authenticate(username, password) {
                try {
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
                    // ★ 2026-08-26 锁定归一化：锁定 key 统一用解析出的权威 username——
                    //   手机号/用户名交替输错累计到同一账号，杜绝换输入串绕过锁定
                    const lockKey = user.username || username;
                    // ★ 优化3：检查账号是否被锁定（按权威账号检查）
                    const lockMsg = LoginLockout.checkLocked(lockKey);
                    if (lockMsg) return { success: false, error: lockMsg };
                    const pwdOk = await verifyPassword(password, user.password || '');
                    if (!pwdOk) {
                        // ★ 优化3：密码错误计数+1，5次后锁定30分钟（记在权威账号上）
                        return { success: false, error: LoginLockout.recordFailure(lockKey) };
                    }
                    // ★ 2026-08-28 安全加固：激活后禁用试用默认账户 admin/admin（离线激活后门）
                    //   放在密码通过之后：避免通过错误信息差判断 admin 账户是否真实存在
                    const blocked = await _blockTrialAdminAfterLicensed(user);
                    if (blocked) {
                        return { success: false, error: '🔒 系统已激活，试用默认账户 admin/admin 已禁用。请使用激活时注册的管理员手机号或自定义账户登录。' };
                    }
                    // ★ 2026-09-04 方案B 注册前置：内置默认账户 admin/admin（出厂默认口令）全状态封锁。
                    //   未注册 → 引导先注册；已注册 → 引导手机号登录；已激活 → 上方既有规则拦截。
                    //   （改过密码的 admin 是真实账户不受影响——密码非 'admin' 不命中本条）
                    if (String(username).trim() === 'admin' && String(password) === 'admin') {
                        let __reg = false;
                        try {
                            if (typeof global.__isLocalRegisteredAsync === 'function') __reg = await global.__isLocalRegisteredAsync();
                        } catch (_) {}
                        return {
                            success: false,
                            error: __reg
                                ? '🔒 内置默认账户已停用，请使用注册的手机号登录。'
                                : '🔒 请先完成注册后再登录（手机号即登录账号）。首次使用请点击登录框中的"注册"入口完成注册。'
                        };
                    }
                    // 登录成功，清零错误计数（权威账号 + 原始输入串都清，兼容历史分裂计数残留）
                    LoginLockout.recordSuccess(lockKey);
                    if (lockKey !== username) LoginLockout.recordSuccess(username);
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
                    const user = typeof getUserFn === 'function' ? await getUserFn() : getUserFn;
                    if (!user) {
                        return { success: false, error: '用户信息加载失败' };
                    }
                    // ★ 支持手机号/用户名双模式登录：检查 username 或 phone 是否匹配
                    const usernameMatch = (user.username === username) || (user.phone === username);
                    if (!usernameMatch) {
                        return { success: false, error: '用户不存在' };
                    }
                    // ★ 2026-08-26 锁定归一化：锁定 key 统一用权威 username——
                    //   手机号/用户名交替输错累计到同一账号，杜绝换输入串绕过锁定
                    const lockKey = user.username || username;
                    // ★ 优化3：检查账号是否被锁定（按权威账号检查）
                    const lockMsg = LoginLockout.checkLocked(lockKey);
                    if (lockMsg) return { success: false, error: lockMsg };
                    const pwdOk = await verifyPassword(password, user.password || '');
                    if (!pwdOk) {
                        // ★ 优化3：密码错误计数+1，5次后锁定30分钟（记在权威账号上）
                        return { success: false, error: LoginLockout.recordFailure(lockKey) };
                    }
                    // ★ 2026-08-28 安全加固：激活后禁用试用默认账户 admin/admin（离线激活后门）
                    //   放在密码通过之后：避免通过错误信息差判断 admin 账户是否真实存在
                    const blocked = await _blockTrialAdminAfterLicensed(user);
                    if (blocked) {
                        return { success: false, error: '🔒 系统已激活，试用默认账户 admin/admin 已禁用。请使用激活时注册的管理员手机号或自定义账户登录。' };
                    }
                    // ★ 2026-09-04 方案B 注册前置：内置默认账户 admin/admin 全状态封锁（同 createLocalAdapter）
                    if (String(username).trim() === 'admin' && String(password) === 'admin') {
                        let __reg = false;
                        try {
                            if (typeof global.__isLocalRegisteredAsync === 'function') __reg = await global.__isLocalRegisteredAsync();
                        } catch (_) {}
                        return {
                            success: false,
                            error: __reg
                                ? '🔒 内置默认账户已停用，请使用注册的手机号登录。'
                                : '🔒 请先完成注册后再登录（手机号即登录账号）。首次使用请点击登录框中的"注册"入口完成注册。'
                        };
                    }
                    // 登录成功，清零错误计数（权威账号 + 原始输入串都清，兼容历史分裂计数残留）
                    LoginLockout.recordSuccess(lockKey);
                    if (lockKey !== username) LoginLockout.recordSuccess(username);
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

            // ★★★ 2026-08-21 根治【机构版登入仍显示修改密码】：
            //   登录成功后必须即时把后端返回的 clinicEdition 同步到 CONFIG.edition + window.EDITION，
            //   否则 Permission._currentEdition() 继续读取 config.json 默认值 personal →
            //   isInstitutional()=false → 只显示【修改密码】不显示【用户管理】。
            //   同时缓存到 localStorage，刷新页面时自动恢复，避免状态丢失。
            try {
                const rawCE = user.clinicEdition || user.edition || '';
                const rawName = user.clinicName || '';
                let targetEd = '';
                const CE = String(rawCE);
                if (['cloud_clinic', 'institution', 'institutional', 'clinic', 'offline', 'clinic_custom', 'offline_clinic', 'cloud'].includes(CE)) {
                    targetEd = 'cloud_clinic';
                } else if (['cloud_personal', 'personal', 'standard', 'single'].includes(CE)) {
                    targetEd = 'cloud_personal';
                }
                if (targetEd) {
                    try {
                        if (typeof CONFIG !== 'undefined' && CONFIG) {
                            CONFIG.edition = targetEd;
                            if (rawName) CONFIG.clinicName = rawName;
                        }
                    } catch (_) {}
                    try { global.EDITION = targetEd; } catch (_) {}
                    try {
                        if (rawName && typeof CONFIG !== 'undefined' && CONFIG && !CONFIG.__editionFromLogin) {
                            CONFIG.__editionFromLogin = true;
                        }
                    } catch (_) {}
                    const productName = '惠康中医-云端';
                    if (productName) {
                        try { global.PRODUCT_NAME = productName; } catch (_) {}
                        try {
                            if (typeof CONFIG !== 'undefined' && CONFIG) {
                                CONFIG.productName = productName;
                                if (typeof document !== 'undefined' && document.title) {
                                    document.title = productName;
                                }
                            }
                        } catch (_) {}
                    }
                    await StorageAdapter.setItem('auth:runtimeEdition', targetEd);
                    if (rawName) await StorageAdapter.setItem('auth:runtimeClinicName', rawName);
                    if (productName) await StorageAdapter.setItem('auth:runtimeProductName', productName);
                    try {
                        console.log('[AuthCore] login edition-sync step-1 backend:', JSON.stringify({ clinicEdition: rawCE, edition: user.edition, role: user.role, clinicName: rawName }));
                        console.log('[AuthCore] login edition-sync step-2 UPDATED ->', JSON.stringify({
                            targetEd,
                            CONFIG: (typeof CONFIG !== 'undefined') ? { edition: CONFIG.edition, clinicName: CONFIG.clinicName } : null,
                            windowEDITION: global.EDITION,
                            title: typeof document !== 'undefined' ? document.title : null
                        }));
                    } catch (e) {}
                } else {
                    try {
                        console.warn('[AuthCore] login edition-sync SKIPPED (unrecognized clinicEdition):', JSON.stringify({ clinicEdition: rawCE, userEdition: user.edition, role: user.role }));
                    } catch (e) {}
                }
            } catch (hookErr) {
                try { console.error('[AuthCore] login edition-sync hook FAILED:', hookErr && hookErr.message || hookErr); } catch (_) {}
            }

            // ★ 2026-08-20 登录成功即视为"软件已激活"，登录框的"软件激活"入口自动隐藏
            //   （登录框通常将随登录成功关闭；此处设置标记确保下次回到登录框时不再显示）
            // ★ 2026-08-19 BUG修复：setCloudActivationDone/hideActivateLoginEntry 定义在 IIFE-B，
            //   本处位于 IIFE-A，裸调用会报 "is not defined"；改经 global 取（IIFE-B 已挂载到 global）
            global.setCloudActivationDone && global.setCloudActivationDone();
            global.hideActivateLoginEntry && global.hideActivateLoginEntry();

            // P4-4: 登录成功后启动会话监控（8小时自动登出）
            // options.onSessionTimeout 可选外部回调（用于登出后跳转/刷新页面）
            startSessionMonitor(options.onSessionTimeout || null);

            return { success: true, user };
        } catch (e) {
            console.error('登录异常:', e);
            return { success: false, error: '登录失败：' + (e.message || '未知错误') };
        }
    }

    // ==================== 登录统一路由（P2 收敛 2026-09-03）====================

    // loginWithUsernamePassword(username, password, options) —— 四处登录入口
    // （双桌面 login.js + 离线 desktop/index.html + 云端 public/index.html handleLogin）
    // 统一委托的唯一路由，替代各处自写的"找用户+验密码+云端兜底"三段式：
    //   1. 本地表校验：username/phone 双模式匹配 + verifyPassword（用户名盐增强哈希/
    //      全局盐旧哈希/明文全兼容）+ 改名兼容（手机号账号改名后用旧手机号盐回退再校验）；
    //   2. options.cloud=true 且本地未通过时 → 云端 /users?login=true 权威认证（AuthCore.login）。
    // options: { users: 本地用户数组 } 或 { getUsers: 返回数组的函数 }，{ cloud: bool 默认 false }
    // 返回统一结果 { success, user, matchedIdentifier, source: 'local'|'cloud', error }：
    //   - source='local'  → user 为本地表原对象（调用方继续走密码升级/token 补拉等本地副作用）
    //   - source='cloud'  → user 为云端返回（含 token；落地本地表/缓存等副作用由调用方负责）
    //   - 云端异常不阻断：按本地未命中返回（保持离线可用，与各端旧行为一致）
    async function loginWithUsernamePassword(username, password, options = {}) {
        // ★ 2026-09-04 Phase 1 · 铁律 4 · ReadyPromise 统一登录闸门
        //   入口在【认证函数的最开头】全局生效：不管 HTML 表单 submit / 历史调用 / 桌面端自定义封装，
        //   只要是 offline.js 暴露的 AuthCore.loginWithUsernamePassword 都会被同一闸门挡住。
        //   离线 APP/桌面：等 getActivationUsers UPSERT 完成再比对用户名/密码，100% 消灭手速竞态；
        //   无桥环境（云端 APP / 纯网页 / 未授权）：window.__activationUsersReadyPromise = Promise.resolve()
        //   → 0 额外开销，不影响任何云端流程。
        try {
            if (typeof window !== 'undefined' &&
                typeof window.__activationUsersReadyPromise !== 'undefined' &&
                window.__activationUsersReadyPromise &&
                typeof window.__activationUsersReadyPromise.then === 'function') {
                await window.__activationUsersReadyPromise;
            }
        } catch (_) { /* 任何异常：fail-open，不阻塞登录 */ }
        // ★ 2026-09-04 方案B：内置默认账户 admin/admin（出厂默认口令）全状态封锁。
        //   统一路由是桌面 login.js / 离线 index.html / 云端 index.html 四个登录入口的
        //   主链路——若只在 createLocalAdapter/createSingleUserAdapter 两处 authenticate 封锁，
        //   走本路由的本地表匹配会绕过封锁（出厂哈希密码可被 verifyPassword 放行），
        //   必须与适配器层同闸门拦截。改过密码的 admin（密码非 'admin'）不命中本条，不受影响。
        if (String(username).trim() === 'admin' && String(password) === 'admin') {
            let __reg = false;
            try {
                if (typeof global.__isLocalRegisteredAsync === 'function') __reg = await global.__isLocalRegisteredAsync();
            } catch (_) {}
            return {
                success: false,
                user: null,
                matchedIdentifier: username,
                source: 'local',
                error: __reg
                    ? '🔒 内置默认账户已停用，请使用注册的手机号登录。'
                    : '🔒 请先完成注册后再登录（手机号即登录账号）。首次使用请点击登录框中的"注册"入口完成注册。'
            };
        }
        const users = (typeof options.getUsers === 'function') ? (options.getUsers() || []) : (options.users || []);
        let user = null;
        let matchedIdentifier = username;
        for (const u of users) {
            if (!u) continue;
            if (u.username !== username && String(u.phone || '') !== username) continue;
            matchedIdentifier = (u.username === username) ? u.username : (u.phone || username);
            let _ok = await verifyPassword(password, u.password || '', matchedIdentifier);
            // ★ 改名兼容：手机号账号改名为英文/拼音后，原密码可能是旧手机号加盐的增强哈希，
            //   用新用户名加盐失败时回退用该用户 phone（=旧手机号）再次加盐校验，避免改名后锁号。
            if (!_ok && String(u.phone || '') && String(u.phone || '') !== matchedIdentifier) {
                _ok = await verifyPassword(password, u.password || '', u.phone);
            }
            if (_ok) { user = u; break; }
        }
        if (user) {
            return { success: true, user: user, matchedIdentifier: matchedIdentifier, source: 'local' };
        }
        if (options.cloud && typeof CLOUD_API_BASE !== 'undefined' && CLOUD_API_BASE) {
            try {
                const cloudResult = await login(username, password, { adapter: cloudAdapter });
                if (cloudResult && cloudResult.success && cloudResult.user) {
                    return { success: true, user: cloudResult.user, matchedIdentifier: username, source: 'cloud' };
                }
                if (cloudResult && cloudResult.success === false) {
                    return { success: false, user: null, matchedIdentifier: username, source: 'cloud', error: cloudResult.error || '手机号/用户名或密码错误' };
                }
            } catch (cloudErr) {
                console.warn('[loginWithUsernamePassword] 云端认证异常(按本地结果返回):', cloudErr);
            }
        }
        return { success: false, user: null, matchedIdentifier: username, source: 'local', error: '手机号/用户名或密码错误' };
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
            'auth:savedPassword',
            // ★ 2026-08-21 登出时清除 edition/clinic 运行时缓存，避免跨账号残留（机构版/标准版切换错漏）
            'auth:runtimeEdition',
            'auth:runtimeClinicName',
            'auth:runtimeProductName'
        ];
        for (const key of allKeys) {
            await StorageAdapter.removeItem(key);
            StorageAdapter.removeSessionItem(key);
        }
        // 同步复位 CONFIG.edition 和 window.EDITION（避免登出后UI仍显示上一账号的机构版/标准版）
        try {
            if (typeof CONFIG !== 'undefined' && CONFIG) {
                CONFIG.edition = 'personal';
                CONFIG.__editionFromLogin = false;
            }
        } catch (_) {}
        try { global.EDITION = 'personal'; } catch (_) {}
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

    // ★ 2026-08-28 实名信息防护：判定"通用用户名"（非手机号/汉字姓名/邮箱）
    //   白名单模式：宁可不记不误记，实名一律不写入下拉/预填
    function _isGenericUsername(candidate) {
        try {
            const s = String(candidate || '').trim();
            if (!s) return false;
            if (/^\d{10,15}$/.test(s)) return false;
            if (/[\u4e00-\u9fa5]{2,}/.test(s)) return false;
            if (s.indexOf('@') >= 0) return false;
            return true;
        } catch (_) { return false; }
    }

    async function saveRememberedUser(username) {
        const cleanUsername = String(username).trim();
        if (!cleanUsername) return;
        // ★ 2026-08-28 实名防护：真实手机号/医师名/邮箱 → 立即删除记忆键，不写入数组
        //   （登录功能不受影响，用户任何时候可手动输入手机号/姓名登录）
        if (!_isGenericUsername(cleanUsername)) {
            try {
                const stored = await StorageAdapter.getItem('auth:rememberedUsers');
                let remembered = [];
                if (stored) { try { remembered = JSON.parse(stored); } catch (_) {} }
                if (!Array.isArray(remembered)) remembered = [];
                const filtered = remembered.filter(u => _isGenericUsername(u));
                await StorageAdapter.setItem('auth:rememberedUsers', JSON.stringify(filtered));
                await StorageAdapter.removeItem('auth:rememberedUsername');
                // 兼容老键同步清理
                await StorageAdapter.removeItem('cloud_rememberedUsername');
                await StorageAdapter.removeItem('local_rememberedUsername');
                await StorageAdapter.removeItem('rememberedUsername');
            } catch (_) { /* 清理失败不阻断登录 */ }
            return;
        }

        let remembered = [];
        try {
            const stored = await StorageAdapter.getItem('auth:rememberedUsers');
            if (stored) remembered = JSON.parse(stored);
            if (!Array.isArray(remembered)) remembered = [];
        } catch (e) { remembered = []; }
        // ★ 读时同步清理历史实名项（老版本可能写入的实名不再保留）
        remembered = remembered.filter(u => _isGenericUsername(u));

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
                    if (Array.isArray(arr) && arr.length > 0) {
                        // ★ 2026-08-28 实名防护：读时过滤历史实名项（只返回通用用户名）
                        const g = arr.filter(u => _isGenericUsername(u));
                        if (g.length !== arr.length) await StorageAdapter.setItem('auth:rememberedUsers', JSON.stringify(g));
                        if (g.length > 0) return g;
                    }
                } catch (e) { /* 忽略解析错误 */ }
            }

            const oldSingle = single || cloudOld || localOld || legacyOld;
            // ★ 实名防护：单键若为实名→立即删除并返回空
            if (oldSingle) {
                if (_isGenericUsername(oldSingle)) return [oldSingle];
                // 清理历史遗留实名单键
                try {
                    await StorageAdapter.removeItem('auth:rememberedUsername');
                    await StorageAdapter.removeItem('cloud_rememberedUsername');
                    await StorageAdapter.removeItem('local_rememberedUsername');
                    await StorageAdapter.removeItem('rememberedUsername');
                } catch (_) {}
            }
            return [];
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

    // ★★★ 2026-08-21 根治【刷新页面机构版回退标准版】：
    //   页面启动时从 localStorage 的登录缓存恢复 CONFIG.edition / window.EDITION / CONFIG.clinicName /
    //   PRODUCT_NAME，确保刷新页面后机构版状态不被 config.json 的默认值 personal 打回。
    //   恢复优先级：1) 缓存的 currentUser.clinicEdition；2) 上次登录写入的 auth:runtimeEdition
    (async function restoreEditionFromCache() {
        try {
            let editionFromCache = '';
            let clinicFromCache = '';
            let productFromCache = '';
            try {
                const userStr = await StorageAdapter.getItem('auth:currentUser');
                if (userStr) {
                    const u = JSON.parse(userStr);
                    if (u && u.clinicEdition) {
                        const CE = String(u.clinicEdition);
                        if (['cloud_clinic', 'institution', 'institutional', 'clinic', 'offline', 'clinic_custom', 'offline_clinic', 'cloud'].includes(CE)) {
                            editionFromCache = 'cloud_clinic';
                        } else if (['cloud_personal', 'personal', 'standard', 'single'].includes(CE)) {
                            editionFromCache = 'cloud_personal';
                        }
                    }
                    if (u && u.clinicName) clinicFromCache = u.clinicName;
                }
            } catch (_) {}
            if (!editionFromCache) editionFromCache = await StorageAdapter.getItem('auth:runtimeEdition') || '';
            if (!clinicFromCache) clinicFromCache = await StorageAdapter.getItem('auth:runtimeClinicName') || '';
            productFromCache = await StorageAdapter.getItem('auth:runtimeProductName') || '';

            const normEd = String(editionFromCache).trim();
            if (normEd === 'cloud_clinic' || normEd === 'cloud_personal') {
                try {
                    if (typeof CONFIG !== 'undefined' && CONFIG) {
                        CONFIG.edition = normEd;
                        if (clinicFromCache) CONFIG.clinicName = clinicFromCache;
                        if (productFromCache) CONFIG.productName = productFromCache;
                    }
                } catch (_) {}
                try { global.EDITION = normEd; } catch (_) {}
                if (productFromCache) {
                    try { global.PRODUCT_NAME = productFromCache; } catch (_) {}
                    try {
                        if (typeof document !== 'undefined' && document.title) document.title = productFromCache;
                    } catch (_) {}
                }
                try {
                    console.log('[AuthCore] startup edition-restore:', JSON.stringify({
                        edition: normEd,
                        clinic: clinicFromCache || '(default)',
                        product: productFromCache || '(default)',
                        CONFIG: (typeof CONFIG !== 'undefined') ? { edition: CONFIG.edition, clinicName: CONFIG.clinicName } : null
                    }));
                } catch (_) {}
            } else {
                try { console.log('[AuthCore] startup edition-restore SKIPPED (no edition cache).'); } catch (_) {}
            }
        } catch (e) {
            try { console.warn('[AuthCore] startup edition-restore failed:', e && e.message || e); } catch (_) {}
        }
    })();

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
        // 登录统一路由（P2 收敛 2026-09-03：四处登录入口唯一委托点）
        loginWithUsernamePassword,
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
        // ★ 2026-08-20 注册审核制：手机号即登录账号 + 自设密码；注册即时建号，管理员审核通过后才能登录
        // ★ 2026-08-21 新增 edition 参数：注册时选择的版本意向（personal/institution），
        //   后端存 clinic.requestedEdition，管理员审核转正时优先采用
        async registerClinic(params) {
            const { clinicName, phone, password, adminName, edition, username } = params || {};
            if (!clinicName || !phone || !password) {
                return { success: false, error: '请填写完整的注册信息' };
            }
            if (!/^1[3-9]\d{9}$/.test(String(phone).trim())) {
                return { success: false, error: '请输入正确的11位手机号（用于管理员审核联系）' };
            }
            // 用户名（选填）：填写后作为登录账号；格式与服务端规则一致
            const uname = String(username || '').trim();
            if (uname) {
                if (uname.length < 2 || uname.length > 30) {
                    return { success: false, error: '用户名长度需 2-30 个字符' };
                }
                if (!/^[\u4e00-\u9fa5a-zA-Z0-9_-]+$/.test(uname)) {
                    return { success: false, error: '用户名仅允许中文、字母、数字、下划线或连字符' };
                }
            }
            const strength = this.validatePasswordStrength(password);
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
                        phone: String(phone).trim(),
                        password: password,
                        adminName: (adminName || '').trim(),
                        edition: (edition === 'institution') ? 'institution' : 'personal',
                        username: uname
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
    let __showExpireAlertRunning = false;  // showExpireAlertAndActivate 执行中防抖

    // ★ 2026-08-29 License API 基址：本 IIFE 作用域内无外层 CLOUD_API_BASE，
    //   从 AuthCore 导出取（心跳硬编码 URL 的统一收口，修复 loadInviteInfo 引用未定义变量）
    const API_BASE = (global.AuthCore && global.AuthCore.CLOUD_API_BASE) ||
        'https://tcm-prescription-system.pages.dev/api';

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

            // ★ P2-3 计数上链：附带当月处方计数（云端高水位跟踪 + 本地清零对账）
            //   Electron 桌面版经 IPC 获取；APP/网页端无 electronAPI.license 时跳过（不影响心跳本身）
            let rxCount = null, rxMonth = null;
            try {
                if (global.electronAPI && global.electronAPI.license &&
                    typeof global.electronAPI.license.getPrescriptionStatus === 'function') {
                    const st = await global.electronAPI.license.getPrescriptionStatus();
                    if (st && typeof st.current === 'number' && typeof st.month === 'string') {
                        rxCount = st.current;
                        rxMonth = st.month;
                    }
                }
            } catch (e) { /* 计数获取失败不影响心跳 */ }

            // 调用心跳接口
            const response = await fetch('https://tcm-prescription-system.pages.dev/api/license/heartbeat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code: licenseCode, machineId: machineId, rxCount: rxCount, rxMonth: rxMonth })
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
                // ★ Phase 2.2 FSM v2 节点同步：validate 返回有效 → 非 pending_* 状态升级为 ACTIVATED_READY
                try {
                    const prev = await getLicenseStateV2();
                    if (prev.state !== _STATES.PENDING_PAYMENT && prev.state !== _STATES.PENDING_APPROVAL && prev.state !== _STATES.ACTIVATED_INSTALLING) {
                        await setStateV2(_STATES.ACTIVATED_READY, { prevState: prev.state || '', validatedAt: Date.now(), validateMessage: String(result.message || '') });
                    }
                } catch (_fsm) { console.warn('[FSM v2] checkLicense valid setState err:', _fsm); }
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
            // ★ Phase 2.2 FSM v2 节点同步：validate 返回失效 → expired/disabled 标记为 EXPIRED_DISABLED
            try {
                const prev = await getLicenseStateV2();
                const __isExpired = /expired|过期|到期|invalid|disabled|停用|注销|违规/.test(String(msg || ''));
                if (__isExpired && prev.state !== _STATES.PENDING_PAYMENT && prev.state !== _STATES.PENDING_APPROVAL) {
                    await setStateV2(_STATES.EXPIRED_DISABLED, { prevState: prev.state || '', expireReason: msg, expireAt: Date.now() });
                }
            } catch (_fsm) { console.warn('[FSM v2] checkLicense expired setState err:', _fsm); }

            // ★ 设置失效标志
            global.__licenseExpired = true;

            // ★ 2026-09-05 试用到期只读模式：trial_expired / trial_limit_reached 不再硬阻断。
            //   旧版 5s 循环强弹激活窗（桌面甚至启动即弹+关窗即退出），客户被锁死看不到
            //   自己的历史数据。现改为：放行进入登录/主界面，只读横幅常驻引导激活，
            //   开方保存由 savePrescription 守卫 + 原生 canPrescribe 双保险拦截。
            //   正式授权过期/设备不符/校验异常仍走原硬阻断弹窗（不扩大放行面）。
            if (result && (result.type === 'trial_expired' || result.type === 'trial_limit_reached')) {
                enterReadOnlyMode(msg);
                return;
            }

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

    // ★ 2026-09-05 试用到期只读模式：顶部常驻横幅（JS 幂等注入，不改 HTML 结构/CSS）。
    //   行为：①主界面（存在 patientName 开方入口）注入深红横幅+「前往激活」按钮
    //         （按钮走 global.openAdminActivate 统一入口：版本选择+三Tab+付款导引全套）；
    //        ②首次进入只读时自动唤起一次激活弹窗（保持 APP 原生对话框「前往激活」的
    //          意图连续），桌面 login 小窗（240x360）除外——其已有静态激活链接；
    //        ③登录页无 patientName 不注横幅（登录框本就有管理员激活入口）。
    function enterReadOnlyMode(msg) {
        global.__licenseExpired = true;
        global.__licenseReadOnly = true;
        console.warn('[LicenseCheck] 试用到期，进入只读模式（可查看，不可开方保存）:', msg || '');
        try {
            if (document.body && document.getElementById('patientName') && !document.getElementById('licenseReadOnlyBanner')) {
                const banner = document.createElement('div');
                banner.id = 'licenseReadOnlyBanner';
                banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9000;background:#7f1d1d;color:#fff;font-size:13px;padding:7px 10px;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,.4);font-family:system-ui,-apple-system,sans-serif;line-height:1.6;';
                banner.innerHTML = '⏰ 试用期已结束 · 只读模式（可查看，暂不能开方保存）' +
                    '<button id="licenseReadOnlyActivateBtn" style="margin-left:8px;padding:3px 14px;border:none;border-radius:5px;background:#f59e0b;color:#fff;font-weight:600;cursor:pointer;font-size:12px;vertical-align:middle;">前往激活</button>';
                document.body.appendChild(banner);
                const __btn = document.getElementById('licenseReadOnlyActivateBtn');
                if (__btn) __btn.addEventListener('click', function () {
                    try { if (typeof global.openAdminActivate === 'function') global.openAdminActivate(); } catch (e) {}
                });
            }
        } catch (e) { console.warn('[LicenseCheck] 只读横幅注入失败:', e); }
        // 一次性自动唤起激活弹窗（桌面 login 小窗除外，避免 240x360 内塞 400px 弹窗）
        if (!global.__readOnlyActivateShown) {
            global.__readOnlyActivateShown = true;
            const __isDesktopLogin = !document.getElementById('patientName') &&
                global.electronAPI && global.electronAPI.activate &&
                typeof global.electronAPI.activate.showExpireAlert === 'function';
            if (!__isDesktopLogin) {
                try { if (typeof global.openAdminActivate === 'function') global.openAdminActivate(); } catch (e) {}
            }
        }
    }

    // ★ 弹窗交互：先显示到期提示，用户点击确定后自动拉起激活窗口
    // 桌面版：优先用 showExpireAlert 一体化 IPC（main process 中 dialog + showActivateWindow）
    // APP 端：showExpireAlert 不存在，回退到 alert + activate.show()
    async function showExpireAlertAndActivate(msg) {
        // 防抖：并发调用（如 fallbackTimer + checkLicense 同时触发）只执行一次
        if (__showExpireAlertRunning) return;
        __showExpireAlertRunning = true;
        // 3秒后自动重置（仅防止竞态窗口内的重复触发，不影响用户关闭窗口后的重新弹窗）
        setTimeout(() => { __showExpireAlertRunning = false; }, 3000);
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

        // ★ APP 端或回退：直接拉起激活窗口（移除alert，避免嵌套弹窗阻断激活流程）
        // 注意：激活窗口自身（HTML模态）内部已包含到期提示与激活指引，无需额外alert

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
            // 同时检查激活窗口DOM是否已存在，防止激活窗口打开期间重复弹窗
            if (!global.__licenseExpired || global.__licenseActivating || document.getElementById('adminActivateOverlay')) return;

            // ★ 2026-09-05 只读模式：横幅常驻引导激活，不再 5s 循环强弹激活窗
            //   （旧版反复打断客户查看历史数据，体验差；横幅按钮随时可自主唤起）
            if (global.__licenseReadOnly) return;

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
            // ★ 2026-08-26 重装激活登录修复：激活弹窗填写的手机号即登录账号。
            //   APP端：Java activateLicense 解析"姓名/手机号"（正则提取 1[3-9] 开头 11 位数字），第3参=password；
            //   桌面端：preload submit 签名为 (code, user, clinicName, phone, password)，手机号走独立 phone 参数。
            //   故按端区分组装与传参，避免密码被桌面端误当 clinicName。
            const actPhone = (modalResult.phone || '').trim();
            const actPwd = modalResult.password || '';
            // ★ 2026-08-28 推广奖励：邀请码（选填，格式校验 4~10 位字母数字）
            const actInvite = (modalResult.inviteCode || '').trim().toUpperCase();
            if (actInvite && !/^[A-Z0-9]{4,10}$/.test(actInvite)) {
                await showHtmlAlert('邀请码格式不正确\n\n应为 4~10 位字母或数字（如 7K3F9Q）。\n若没有邀请码，请留空后重新提交。');
                global.__licenseActivating = false;
                showActivateDialog();
                return;
            }
            const isDesktopAct = global.electronAPI && global.electronAPI.activate &&
                typeof global.electronAPI.activate.showExpireAlert === 'function';
            if (actPhone && !isDesktopAct) {
                user = user ? (user.replace(/[/\-\s]+$/, '').trim() + '/' + actPhone) : actPhone;
            }

            // ★ 激活码前端格式校验（减少无效网络请求）
            const codeTrim = modalResult.code.trim();
            const codePattern = /^BNZC-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;
            if (!codePattern.test(codeTrim)) {
                await showHtmlAlert('激活码格式不正确\n\n正确格式：BNZC-XXXX-XXXX-XXXX-XXXX\n（X 为大写字母或数字，去除 I/O/0/1）\n\n点击确定重新输入');
                global.__licenseActivating = false;
                showActivateDialog();
                return;
            }

            // ★ 按端区分传参：APP端 submit(code, user, password, inviteCode)；桌面端 submit(code, user, clinicName, phone, password, edition, inviteCode)
            const result = isDesktopAct
                ? await global.electronAPI.activate.submit(codeTrim, user, '', actPhone, actPwd, undefined, actInvite)
                : await global.electronAPI.activate.submit(codeTrim, user, actPwd, actInvite);
            if (result && result.success) {
                global.__licenseExpired = false;
                global.__licenseActivating = false;
                // ★ 2026-09-05 只读模式退出：激活成功立即撤横幅清标志（同页即时反馈，无需等重启）
                global.__licenseReadOnly = false;
                try { const __rb = document.getElementById('licenseReadOnlyBanner'); if (__rb) __rb.remove(); } catch (_) {}
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
                // ★ 2026-08-28 推广奖励：激活成功页展示专属邀请码 + 阶梯进度 + 本次奖励
                let inviteMsg = '';
                const iv = result.inviteInfo;
                if (iv && iv.inviteCode) {
                    inviteMsg = '\n\n🎁 您的专属邀请码：' + iv.inviteCode +
                        (iv.inviteeBonusDays > 0 ? ('\n好友邀请奖励已到账：+' + iv.inviteeBonusDays + '天') : '') +
                        '\n已成功邀请 ' + (iv.inviteCount || 0) + '/' + (iv.maxInvitees || 4) +
                        ' 人，累计奖励 ' + (iv.rewardDays || 0) + '天' +
                        '\n（每邀1人+90天，封顶4人+360天）';
                }
                // ★ 2026-08-26 重装激活登录修复：成功提示明确展示登录账号+密码，用户不再猜
                showHtmlAlert('✅ 激活成功！\n' + (result.message || '') +
                    (actPhone ? ('\n\n📱 登录账号：' + actPhone +
                                 '\n🔑 登录密码：' + (actPwd ? actPwd : 'admin（默认）') +
                                 '\n\n请牢记以上账号密码，登录后可在设置中修改密码。') : '') +
                    inviteMsg +
                    '\n\n点击确定后应用将重启');
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
    // ★ 2026-08-29 已激活用户重装自愈：凭「原激活码 + 本机 machineId」查询原激活信息
    //   仅当本机已在激活码绑定设备列表时服务端才返回信息（安全边界在服务端）。
    //   返回 { bound, phone, name, clinicName } 或 null（网络失败/未绑定/接口异常）
    function lookupBoundActivationInfo(code, machineId) {
        return new Promise(function (resolve) {
            try {
                fetch(API_BASE + '/license/lookup', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ code: String(code || '').trim(), machineId: String(machineId || '') })
                }).then(function (r) { return r.json(); }).then(function (d) {
                    resolve((d && d.success && d.bound) ? d : null);
                }).catch(function () { resolve(null); });
            } catch (e) { resolve(null); }
        });
    }

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

                // ★ 2026-08-29 重装自愈提示条（默认隐藏）：识别到本机原激活信息后显示
                '<div id="autoFillHint" style="display:none;background:#e8f5e9;border:1px solid #a5d6a7;border-radius:8px;padding:8px 10px;font-size:12px;color:#2e7d32;line-height:1.6;margin-bottom:12px;"></div>' +

                // ★ 2026-08-26 重装激活登录修复：手机号即登录账号；密码选填（默认 admin）
                '<div style="font-size:12px;color:#666;margin-bottom:6px;">📱 手机号（激活后作为登录账号）<span style="color:#e53935;">*</span></div>' +
                '<input type="tel" id="activatePhoneInput" ' +
                'style="width:100%;padding:12px 14px;font-size:16px;border:2px solid #ddd;border-radius:8px;outline:none;margin-bottom:12px;box-sizing:border-box;" ' +
                'placeholder="请输入手机号" maxlength="11" autocomplete="off" data-lpignore="true" />' +
                '<div style="font-size:12px;color:#666;margin-bottom:6px;">🔑 登录密码（选填，默认 admin）</div>' +
                '<input type="password" id="activatePwdInput" ' +
                'style="width:100%;padding:12px 14px;font-size:16px;border:2px solid #ddd;border-radius:8px;outline:none;margin-bottom:12px;box-sizing:border-box;" ' +
                'placeholder="请输入登录密码（留空则为 admin）" maxlength="32" autocomplete="new-password" data-lpignore="true" />' +

                // ★ 2026-08-28 推广奖励：邀请码（选填，填好友邀请码双方得奖励天数）
                '<div style="font-size:12px;color:#666;margin-bottom:6px;">🎁 邀请码（选填，好友推荐）</div>' +
                '<input type="text" id="activateInviteInput" ' +
                'style="width:100%;padding:12px 14px;font-size:16px;border:2px solid #ddd;border-radius:8px;outline:none;margin-bottom:6px;box-sizing:border-box;font-family:monospace;letter-spacing:1px;text-transform:uppercase;" ' +
                'placeholder="如：7K3F9Q（没有可留空）" maxlength="10" autocomplete="off" data-lpignore="true" />' +
                '<div style="font-size:11px;color:#999;margin-bottom:14px;">填好友邀请码激活，双方都得奖励（好友+90天，您+30天）</div>' +

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
                    // ★ 规则3：激活工单在线申请入口（管理员在后台工单审批页一键审批发码）
                    '<button id="ticketApplyBtn" style="display:block;width:100%;padding:10px;margin-bottom:4px;background:linear-gradient(135deg,#07c160 0%,#06ad56 100%);color:white;border:none;border-radius:8px;font-size:13px;font-weight:bold;cursor:pointer;">📩 提交激活工单（在线申请）</button>' +
                    '<div style="font-size:11px;color:#999;text-align:center;margin-bottom:8px;">提交后管理员审批，激活码将通过电话/微信发送给您</div>' +
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
            const phoneInput = card.querySelector('#activatePhoneInput');
            const pwdInput = card.querySelector('#activatePwdInput');
            const autoFillHint = card.querySelector('#autoFillHint');

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

            // ★ 2026-08-29 已激活用户重装自愈：激活码输入完成（失焦）后自动识别本机原激活信息
            //   服务端仅对已绑定设备返回信息 → 自动填写原手机号，用户只需点击"立即激活"
            input.addEventListener('change', async function() {
                const c = (input.value || '').trim();
                if (!/^BNZC-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/.test(c)) {
                    if (autoFillHint) autoFillHint.style.display = 'none';
                    return;
                }
                const d = await lookupBoundActivationInfo(c, machineId);
                if (!d) return; // 未绑定/网络异常：静默，按新激活流程手动填写
                if (autoFillHint) {
                    autoFillHint.innerHTML = '✅ 已自动识别本机原激活信息' +
                        (d.clinicName ? '（' + d.clinicName + '）' : '') +
                        '<br>原手机号已自动填写，点击「立即激活」即可一键恢复';
                    autoFillHint.style.display = 'block';
                }
                if (phoneInput && !phoneInput.value.trim() && d.phone) {
                    phoneInput.value = d.phone;
                }
            });

            // 机器ID复制按钮
            copyMachineIdBtn.addEventListener('click', async function() {
                const ok = await copyTextToClipboard(machineId);
                copyMachineIdBtn.textContent = ok ? '✅ 已复制' : '❌ 失败';
                setTimeout(function() { copyMachineIdBtn.textContent = '复制ID'; }, 1500);
            });

            // ★ 规则3：激活工单入口（叠加层弹窗，不关闭当前激活码输入框，提交成功后回来输码）
            const ticketApplyBtn = card.querySelector('#ticketApplyBtn');
            if (ticketApplyBtn) {
                ticketApplyBtn.addEventListener('click', function() {
                    showTicketFormModal(machineId, clinicName);
                });
            }

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

            async function submitCode() {
                const val = input.value;
                // ★ 2026-08-26 重装激活登录修复：激活时即设定手机号（登录账号）+密码，
                //   避免重装后账号密码被静默重置为默认 admin、用户不知情无法登录
                let phoneVal = phoneInput ? phoneInput.value.trim() : '';
                const pwdVal = pwdInput ? pwdInput.value : '';
                // ★ 2026-08-28 推广奖励：读取邀请码（选填）
                const inviteInputEl = card.querySelector('#activateInviteInput');
                const inviteVal = inviteInputEl ? inviteInputEl.value.trim().toUpperCase() : '';
                // ★ 显示 loading 状态（不立即关闭弹窗，让用户看到正在处理）
                // 仅当有输入时才显示 loading
                if (val && val.trim()) {
                    // 手机号必填校验（登录账号=手机号）
                    // ★ 2026-08-29 重装自愈：未填手机号时先联网识别本机原激活信息，
                    //   识别成功自动补填并继续激活（用户只输激活码即可，"直接输入一键恢复"）
                    if (!/^1[3-9]\d{9}$/.test(phoneVal)) {
                        const d = await lookupBoundActivationInfo(val.trim(), machineId);
                        if (d && d.phone) {
                            phoneVal = d.phone;
                            if (phoneInput) phoneInput.value = d.phone;
                            if (autoFillHint) {
                                autoFillHint.innerHTML = '✅ 已自动识别本机原激活信息，正在恢复...';
                                autoFillHint.style.display = 'block';
                            }
                        } else {
                            try { alert('请填写正确的手机号（11位）。\n激活后使用「手机号 + 密码」登录。'); } catch (e) {}
                            if (phoneInput) phoneInput.focus();
                            return;
                        }
                    }
                    // ★ 2026-08-30 修复：密码留空被静默重置为 admin，重装一键恢复后用户用原密码登录失败
                    //   （自愈只自动填手机号不填密码）。提交前明确告知，杜绝"激活成功却登录不上"的困惑。
                    if (!pwdVal) {
                        const goOn = confirm('未填写登录密码。\n\n激活后登录密码将为默认 admin。\n（登录后可在「修改密码」中改回原密码）\n\n【确定】继续激活\n【取消】返回填写密码');
                        if (!goOn) {
                            if (pwdInput) pwdInput.focus();
                            return;
                        }
                    }
                    submitBtn.disabled = true;
                    cancelBtn.disabled = true;
                    input.disabled = true;
                    loadingBox.style.display = 'block';
                    submitBtn.textContent = '激活中...';
                    // 延迟一帧让 loading 显示后再 resolve（主流程异步处理）
                    setTimeout(function() {
                        cleanup();
                        resolve({ code: val, phone: phoneVal, password: pwdVal, inviteCode: inviteVal, cancelled: false });
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
    // ★ 2026-08-23 license 失效自动弹窗升级：优先三Tab激活弹窗（版本选择→管理员激活/激活码/工单申请），
    //   无激活码用户可直接提交申请/工单（配合离线APP Java层"前往激活"放行入口，形成完整激活闭环）；
    //   openAdminActivate 不可用时回退旧版单码弹窗（机器ID+联系客服+输码）
    if (typeof global.addEventListener === 'function') {
        global.addEventListener('app:show-activate', function () {
            if (typeof global.openAdminActivate === 'function') {
                // 注意：openAdminActivate 内部已设置 __licenseActivating = true
                // 不在此处先重置为 false，避免 fallbackTimer 窗口期误触发弹窗
                global.openAdminActivate();
            } else {
                showActivateDialog();
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
                ? '<button class="action-btn" id="adminActivateSettingsBtn" style="background:#26a69a;color:white;width:100%;padding:8px;font-size:14px;border:none;border-radius:4px;cursor:pointer;">📋 管理员激活</button>'
                : '');

        modalBody.appendChild(section);

        // 仅在有 license API 时绑定按钮事件
        if (hasLicenseApi) {
            // ★ 2026-08-19 管理员激活：原登录框入口已收敛到基础设置授权区；取消「立即激活」按钮，仅保留「管理员激活」（用户要求 2026-08-20）
            const adminBtn = section.querySelector('#adminActivateSettingsBtn');
            if (adminBtn) {
                adminBtn.addEventListener('click', function () {
                    try { closeModal('settingsModal'); } catch (e) { }
                    // ★ 2026-08-22 修复入口分流缺陷：桌面版优先打开主进程完整激活窗口
                    //   （版本选择 + 管理员激活/激活码激活/工单申请 三Tab），否则已登录
                    //   用户从基础设置永远到不了工单/激活码Tab；无主进程桥（云端网页/APP）
                    //   走本模块 DOM 弹窗兜底。
                    if (global.electronAPI && global.electronAPI.activate &&
                        typeof global.electronAPI.activate.show === 'function') {
                        try { global.electronAPI.activate.show(); return; } catch (eBridge) { /* 桥接异常，落回DOM弹窗 */ }
                    }
                    if (typeof global.openAdminActivate === 'function') {
                        global.openAdminActivate();
                    } else if (typeof global.activateNow === 'function') {
                        global.activateNow();
                    }
                });
            }
            // ★ 2026-08-20 双入口合并：底部静态「激活软件/管理员激活」按钮与授权区「管理员激活」功能重复 → 隐藏静态按钮，授权区为唯一入口
            // （不动 index.html DOM；无 license 桥的纯网页环境不注入本按钮，静态按钮保留兜底）
            try {
                const legacyBtn = modalBody.querySelector('button[onclick*="openActivationFromSettings"]');
                if (legacyBtn) legacyBtn.style.display = 'none';
            } catch (e) { console.warn('[LicenseCheck] 隐藏重复激活入口失败:', e); }
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
                setAdminActivateBtnState(null);
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
                    // ★ 2026-08-25 全局统一：试用期（最长7天）与过期 → 按钮正常色（需要激活）
                    setAdminActivateBtnState(null);
                } else if (licenseType === 'licensed' || licenseType === 'personal' || licenseType === 'pro') {
                    // 已激活（正式 license）
                    const planLabel = licenseType === 'personal' ? '标准版' :
                                      licenseType === 'pro' ? '机构版' : licenseType;
                    let html = '✅ 已激活' + (planLabel ? '（' + planLabel + '）' : '');
                    if (hasDays && remainingDays > 0) {
                        html += '<br>剩余 <b style="color:#4caf50;">' + remainingDays + '</b> 天';
                    }
                    el.innerHTML = html;
                    // ★ 2026-08-28 推广奖励：老用户邀请码展示——已激活用户在授权状态区显示专属邀请码+进度
                    loadInviteInfo(el);
                    // ★ 2026-08-25 全局统一：正式授权 >7天或永久(-1) → 灰色只读；≤7天恢复正常色提醒续费
                    setAdminActivateBtnState(hasDays ? remainingDays : null);
                } else {
                    // 未知类型，显示通用已激活
                    el.innerHTML = '✅ 已激活' +
                        (hasDays && remainingDays > 0 ? '<br>剩余 ' + remainingDays + ' 天' : '');
                    setAdminActivateBtnState(hasDays ? remainingDays : null);
                }
            } else {
                el.innerHTML = '❌ 未激活<br><span style="color:red;">' +
                    ((status && status.message) ? status.message : '请激活后使用') +
                    '</span>';
                // ★ 2026-08-25 全局统一：未激活 → 按钮正常色（需要激活）
                setAdminActivateBtnState(null);
            }
        } catch (e) {
            el.textContent = '状态获取失败: ' + (e && e.message ? e.message : '未知错误');
        }
    }

    // ★ 2026-08-28 推广奖励：老用户邀请码展示
    //   已激活用户在「基础设置 → 授权状态」区显示专属邀请码 + 邀请进度 + 累计奖励，
    //   点击邀请码复制。数据来源 POST /api/license/invite（凭本地 license:code 查询）。
    //   断网/接口异常静默跳过，不影响授权状态正常显示。
    // ★ 2026-08-29 桌面版 CORS 修复：渲染进程从 file:// 直连云端 API 会被 CORS 拦截
    //   （Origin: null 不在服务端白名单），桌面版优先走主进程 IPC 代理 fetch；
    //   APP（http://localhost 在白名单）/ 网页版直连。
    async function postInviteQuery(bodyData) {
        if (global.electronAPI && global.electronAPI.license &&
            typeof global.electronAPI.license.queryInvite === 'function') {
            try {
                const r = await global.electronAPI.license.queryInvite(bodyData);
                if (r && typeof r === 'object') return r;
            } catch (_) {}
        }
        try {
            const r = await fetch(API_BASE + '/license/invite', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(bodyData)
            });
            return await r.json().catch(() => null);
        } catch (_) { return null; }
    }

    async function loadInviteInfo(el) {
        try {
            const old = document.getElementById('inviteInfoBox');
            if (old && old.parentNode) old.parentNode.removeChild(old);
            // ★ 三来源取码（APP端激活码可能只存于 Java 层/StorageAdapter 未初始化）：
            //   1) StorageAdapter（标准来源，弹窗激活成功后写入）
            //   2) localStorage 直读（StorageAdapter 异常/未初始化兜底）
            //   3) electronAPI.license.getActivationRecord()（APP端 Java 激活记录，
            //      LicenseManager 激活成功时写入明文 code——旧记录无此字段则空）
            let code = '';
            try { code = await StorageAdapter.getItem('license:code'); } catch (_) {}
            if (!code) {
                try {
                    const ls = (typeof global !== 'undefined' && global.localStorage) ||
                               (typeof window !== 'undefined' ? window.localStorage : null);
                    if (ls) code = ls.getItem('license:code');
                } catch (_) {}
            }
            if (!code && global.electronAPI && global.electronAPI.license &&
                typeof global.electronAPI.license.getActivationRecord === 'function') {
                try {
                    const rec = await global.electronAPI.license.getActivationRecord();
                    if (rec && rec.code) {
                        code = String(rec.code).trim();
                        // 自愈回写标准存储，下次直接命中来源1
                        try { await StorageAdapter.setItem('license:code', code); } catch (_) {}
                    }
                } catch (_) {}
            }
            if (!code || String(code).trim().length < 4) {
                // ★ 4) machineId 联网找回（存量管理员激活/旧版本激活设备本地无码）：
                //    服务端凭 device_version:{machineId} 绑定记录查回邀请信息（不返回码本身），
                //    每次打开授权状态时自动执行，无需用户干预。
                try {
                    let mid = '';
                    try {
                        if (global.electronAPI && global.electronAPI.license &&
                            typeof global.electronAPI.license.getMachineId === 'function') {
                            const m = await global.electronAPI.license.getMachineId();
                            mid = (m && m.machineId) ? String(m.machineId) : String(m || '');
                        }
                    } catch (_) {}
                    if (!mid && global.electronAPI && global.electronAPI.activate &&
                        typeof global.electronAPI.activate.getMachineId === 'function') {
                        try {
                            const m = await global.electronAPI.activate.getMachineId();
                            mid = (m && m.machineId) ? String(m.machineId) : String(m || '');
                        } catch (_) {}
                    }
                    if (mid && String(mid).trim().length >= 8) {
                        const md = await postInviteQuery({ machineId: String(mid).trim() });
                        if (md && md.success && md.inviteCode) {
                            renderInviteCard(el, md);
                            return;
                        }
                    }
                } catch (_) {}
                // ★ 可视提示（不再静默）：无本地激活码且联网找回失败（断网/无绑定记录）
                const nb = document.createElement('div');
                nb.id = 'inviteInfoBox';
                nb.style.cssText = 'margin-top:8px;padding-top:8px;border-top:1px dashed #ddd;font-size:11px;color:#aaa;line-height:1.6;';
                nb.textContent = '🎁 邀请码需联网验证授权，当前未找到激活记录' +
                    '（可能断网或旧版本激活）。请联网后重新打开本页自动恢复；输码激活的用户也可在激活窗口重新输入一次原激活码恢复。';
                el.appendChild(nb);
                return;
            }
            const d = await postInviteQuery({ code: String(code).trim() });
            if (!d || !d.success || !d.inviteCode) {
                // ★ 可诊断性：激活码存在但查询失败（网络异常/服务暂不可用/激活码记录缺失）
                //   显示灰色小提示而非完全静默，便于用户和排查区分失败原因
                const hb = document.createElement('div');
                hb.id = 'inviteInfoBox';
                hb.style.cssText = 'margin-top:8px;padding-top:8px;border-top:1px dashed #ddd;font-size:11px;color:#aaa;line-height:1.6;';
                hb.textContent = '🎁 邀请码加载失败（' +
                    ((d && d.error) ? d.error : '网络异常') +
                    '），联网后重新打开本页重试';
                el.appendChild(hb);
                return;
            }
            renderInviteCard(el, d);
        } catch (e) {
            // 静默失败：断网或服务暂不可用不影响授权状态显示
            console.warn('[Invite] 邀请信息加载失败:', e && e.message);
        }
    }

    // ★ 2026-08-29 邀请码卡片渲染（码查询/machineId 找回两路径共用）
    function renderInviteCard(el, d) {
        const cnt = d.inviteCount || 0, max = d.maxInvitees || 4, days = d.rewardDays || 0;
        const box = document.createElement('div');
        box.id = 'inviteInfoBox';
        box.style.cssText = 'margin-top:8px;padding-top:8px;border-top:1px dashed #ddd;font-size:12px;color:#555;line-height:1.7;';
        box.innerHTML =
            '🎁 我的邀请码：<b id="myInviteCodeEl" title="点击复制" ' +
            'style="color:#26a69a;font-family:monospace;letter-spacing:1px;font-size:14px;cursor:pointer;user-select:all;">' +
            String(d.inviteCode) + '</b>' +
            '<br>已邀请 <b>' + cnt + '</b>/' + max + ' 人 · 累计奖励 <b style="color:#4caf50;">+' + days + '</b> 天' +
            (cnt < max
                ? '<br><span style="color:#999;font-size:11px;">好友激活时填您的邀请码，双方得奖励天数</span>'
                : '<br><span style="color:#4caf50;font-size:11px;">🎉 邀请奖励已封顶，感谢推荐！</span>');
        el.appendChild(box);
        const codeEl = document.getElementById('myInviteCodeEl');
        if (codeEl) {
            codeEl.addEventListener('click', function (ev) {
                const txt = (ev.target.textContent || '').trim();
                try {
                    if (navigator.clipboard && navigator.clipboard.writeText) {
                        navigator.clipboard.writeText(txt);
                    } else {
                        const ta = document.createElement('textarea');
                        ta.value = txt; document.body.appendChild(ta);
                        ta.select(); document.execCommand('copy');
                        document.body.removeChild(ta);
                    }
                    alert('邀请码已复制：' + txt);
                } catch (_) {
                    alert('复制失败，请手动记录：' + txt);
                }
            });
        }
    }

    // ★ 2026-08-25 全局统一授权状态：暴露到 window（与 cloud.js 一致）——
    //   index.html 打开基础设置时调用 window.updateLicenseStatusText() 即时刷新授权区
    global.updateLicenseStatusText = updateLicenseStatusText;

    // ★★★ 2026-08-25 管理员激活按钮状态（全局统一规范，与 cloud.js 一致）：
    //   激活有效期内（剩余 > 7 天，或 -1 永久授权）→ 按钮灰色只读（无需激活）
    //   剩余 ≤ 7 天（临期提醒续费）/ 未激活 / 已过期 / 试用 / 无到期信息 → 按钮正常颜色可点击
    function setAdminActivateBtnState(daysLeft) {
        const btn = document.getElementById('adminActivateSettingsBtn');
        if (!btn) return;
        const inValidPeriod = (typeof daysLeft === 'number' && !isNaN(daysLeft)) &&
            (daysLeft === -1 || daysLeft > 7);
        if (inValidPeriod) {
            btn.disabled = true;
            btn.style.background = '#b0bec5';
            btn.style.cursor = 'not-allowed';
            btn.title = '激活有效期内无需激活';
        } else {
            btn.disabled = false;
            btn.style.background = '#26a69a';
            btn.style.cursor = 'pointer';
            btn.title = '';
        }
    }

    // ★ 向登录界面（loginOverlay）运行时注入"注册 / 激活"入口（registerEntry 元素）
    // 目的：首次注册用户无需登录即可在登录页找到"设置诊所信息 / 立即激活"入口
    // 背景：index.html 已内置 .register-entry CSS 与 handleRegisterEntry()/updateRegisterEntry() 函数，
    //       但登录框 DOM 中缺少 id=registerEntry 元素，导致入口从未显示。此处运行时动态补建，不改 HTML 源码
    // 约束：仅 APP 端（Capacitor 环境、含 loginOverlay）注入；云端桌面/网页版无需激活（登录即可使用），不注入
    // 登录框诊所名：显示打包 config.json 的 clinicName，而非静态硬编码"本能堂中医诊所"
    // ★ 2026-08-19 修复：该同步不依赖 isApp，任何环境下都执行（配置品牌展示与是否 App 无关）
    function syncLoginClinicName() {
        try {
            // ★ 2026-08-23 统一规范：基础设置保存的 local_clinicName 优先（与 index.html 内嵌同步逻辑一致）。
            //   原实现仅用 CONFIG.clinicName：本函数在 DOMContentLoaded 触发，若晚于 index.html 内嵌同步执行，
            //   会把用户基础设置保存的诊所名覆盖回打包 CONFIG 值（登录框显示条全局统一规范要求
            //   "默认显示操作界面-基础设置-诊所名称"，localStorage 永远最高优先）
            let saved = null;
            try { saved = localStorage.getItem('local_clinicName'); } catch (_) {}
            const cc = saved || ((typeof CONFIG !== 'undefined' && CONFIG.clinicName) ? CONFIG.clinicName : '');
            if (!cc) return;
            const lc = document.getElementById('loginClinicName');
            if (lc) lc.textContent = cc;
            // APP 端（assets/public/index.html）登录框诊所名条为 .clinic-info-name 类选择器，一并同步兜底
            // （与 index.html 内嵌 IIFE 相同优先级，值一致无覆盖风险）
            const appEl = document.querySelector('.clinic-info-name');
            if (appEl) appEl.textContent = cc;
        } catch (e) {}
    }

    // ★ 2026-08-22 冗余入口收敛（对齐云端桌面版登录框）：隐藏登录框静态"注册诊所 / 激活申请"按钮
    //   与"管理台登录"按钮，仅保留动态注入的"注册开通"入口（云端注册审核制只保留一个注册入口）。
    //   "管理台登录"可经 admin/index.html 直接访问（平台管理后台独立入口），登录框无需再保留该按钮。
    function hideStaticActivateEntry() {
        try {
            const box = document.querySelector('.login-box');
            if (!box) return;
            const btns = box.querySelectorAll('button');
            for (let i = 0; i < btns.length; i++) {
                const t = btns[i].textContent || '';
                if (t.indexOf('注册诊所') !== -1 || t.indexOf('管理台登录') !== -1) {
                    btns[i].style.display = 'none';
                }
            }
        } catch (e) {}
    }

    function injectActivateLinkIntoLogin() {
        try {
            // 登录框诊所名无条件同步（与 App/网页/桌面环境无关）
            syncLoginClinicName();
            let overlay = document.getElementById('loginOverlay');
            // ★ 2026-09-04 方案B P3：桌面登录窗（electron/login.html）无 loginOverlay，
            //   旧逻辑直接 return → 桌面登录框永远没有持久"注册开通"入口，用户关掉自动
            //   注册弹窗后只能重启应用才能重开。用 btnOk+loginPassword 特征识别桌面登录页，
            //   容器取同名 .login-buttons（与 APP 壳登录框同类名，插入位置一致）。
            let isDesktopLoginPage = false;
            if (!overlay) {
                isDesktopLoginPage = !!(document.getElementById('btnOk') && document.getElementById('loginPassword'));
                if (!isDesktopLoginPage) return;
            }
            // ★ 2026-08-22 冗余入口收敛：隐藏静态"注册诊所 / 激活申请"与"管理台登录"按钮（仅保留动态"注册开通"）
            hideStaticActivateEntry();
            // ★ 2026-08-20 注册完成后自动隐藏：已登录/已注册过则不再显示"注册开通"入口
            if (isCloudActivationDone()) return;
            // ★ 2026-08-22 兜底（对齐桌面版 injectAdminActivateEntry 双条件）：
            //   config 已有管理员账户 = 注册/激活已完成的持久事实，即使 localStorage 标记丢失也不显示注册入口
            try {
                if (typeof CONFIG !== 'undefined' && CONFIG && Array.isArray(CONFIG.users)) {
                    for (let i = 0; i < CONFIG.users.length; i++) {
                        const u = CONFIG.users[i];
                        if (u && (u.role === 'admin' || u.role === 'clinic_admin' || u.role === 'platform_admin')) return;
                    }
                }
            } catch (e) {}
            // 已注入过则跳过，避免重复
            if (document.getElementById('activateLoginEntry')) return;

            // ★ 2026-08-23 对齐云端桌面管理员激活模式：登录框入口改为"📋 管理员激活"，
            //   调用 openAdminActivate 多步骤弹窗（版本选择→填写信息→设置密码→提交申请→等待管理员审批），
            //   与桌面 activate-window.html"管理员激活"流程完全一致（替换原 openCloudRegister 一页式注册开通）
            // ★ 2026-09-04 方案B 注册前置：本地桥 + 未激活 + 未注册 设备入口改为"📝 注册开通"
            //   （openLocalRegister 注册弹窗；注册完成由成功流程切回"管理员激活"语义）
            // ★ 2026-09-04 方案B P3：容器双端解析——APP 壳在 loginOverlay 内，
            //   桌面登录窗直接 document 查找（两页 .login-buttons 同类名）
            const container = isDesktopLoginPage
                ? document.querySelector('.login-buttons')
                : overlay.querySelector('.login-buttons');
            if (!container) return;

            (async function injectLoginEntry() {
                let isRegisterEntry = false;
                try {
                    const api = global.electronAPI || (typeof window !== 'undefined' ? window.electronAPI : null);
                    const hasLocalBridge = !!(api && api.activate &&
                        (typeof api.activate.getActivationUsers === 'function' ||
                         typeof api.activate.registerLocalUser === 'function'));
                    if (hasLocalBridge && !(await __isDeviceLicensed()) && !(await isLocalRegisteredAsync())) {
                        isRegisterEntry = true;
                    }
                } catch (de) {}

                // ★ 桌面登录窗已有原生激活入口（#activateLink → openActivationWindow，由 login.js
                //   按未激活/试用到期状态显隐），仅在"未注册"时补注册按钮；已注册/已激活不注入，避免双入口
                if (isDesktopLoginPage && !isRegisterEntry) return;

                const entry = document.createElement('div');
                entry.id = 'activateLoginEntry';
                if (isDesktopLoginPage) entry.dataset.context = 'desktop-login';
                entry.style.cssText =
                    'margin-top:12px;padding:0 4px;';
                if (isRegisterEntry) {
                    entry.innerHTML =
                        '<div style="display:flex;align-items:center;justify-content:center;gap:6px;padding:12px 0;border-radius:8px;background:linear-gradient(135deg,#26a69a 0%,#00897b 100%);color:#fff;cursor:pointer;font-size:14px;font-weight:bold;text-align:center;-webkit-tap-highlight-color:transparent;" onclick="if(window.openLocalRegister){window.openLocalRegister();}">📝 注册开通</div>';
                    console.log('[LicenseCheck] 登录界面已注入 注册开通 入口（方案B 注册前置）');
                } else {
                    entry.innerHTML =
                        '<div style="display:flex;align-items:center;justify-content:center;gap:6px;padding:12px 0;border-radius:8px;background:linear-gradient(135deg,#26a69a 0%,#00897b 100%);color:#fff;cursor:pointer;font-size:14px;font-weight:bold;text-align:center;-webkit-tap-highlight-color:transparent;" onclick="if(window.openAdminActivate){window.openAdminActivate();}">📋 管理员激活</div>';
                    console.log('[LicenseCheck] 登录界面已注入 管理员激活 入口');
                }
                container.parentNode.insertBefore(entry, container.nextSibling);
            })();
        } catch (e) {
            console.warn('[LicenseCheck] 注入登录 管理员激活 入口失败:', e);
        }
    }

    // ============ 登录框"软件激活"入口的激活态标记（登录/激活成功后自动隐藏入口） ============

    function isCloudActivationDone() {
        try {
            return global.localStorage && global.localStorage.getItem('auth:activationDone') === '1';
        } catch (e) { return false; }
    }

    function setCloudActivationDone() {
        try { if (global.localStorage) global.localStorage.setItem('auth:activationDone', '1'); } catch (e) {}
    }

    function hideActivateLoginEntry() {
        try {
            const el = document.getElementById('activateLoginEntry');
            if (el) { el.style.display = 'none'; }
        } catch (e) {}
    }

    // ★ 2026-08-19 BUG修复：以上激活态标记函数位于 IIFE-B，但登录成功路径（IIFE-A）也会调用，
    //   需挂载到 global 供跨作用域访问（配合 IIFE-A 的 global.setCloudActivationDone 调用）
    global.isCloudActivationDone = isCloudActivationDone;
    global.setCloudActivationDone = setCloudActivationDone;
    global.hideActivateLoginEntry = hideActivateLoginEntry;

    // ============================================================================
    // ★ 2026-08-20 一页式"注册开通"弹窗（云端注册审核制）
    //   手机号即登录账号 + 自设密码 → 注册即时建号（诊所待审核）→ 管理员审核通过后即可登录
    //   不修改 HTML 源码，仅运行时动态注入 DOM，符合界面保护约束
    // ============================================================================

    global.openCloudRegister = function () {
        try {
            let clinicName = '';
            try {
                if (typeof CONFIG !== 'undefined' && CONFIG.clinicName) clinicName = CONFIG.clinicName;
            } catch (e) {}
            showCloudRegisterModal(clinicName);
        } catch (e) {
            console.warn('[LicenseCheck] 打开注册开通弹窗失败:', e);
        }
    };

    function showCloudRegisterModal(defaultClinicName) {
        // 若已打开则忽略
        if (document.getElementById('cloudRegisterOverlay')) return;

        const overlay = document.createElement('div');
        overlay.id = 'cloudRegisterOverlay';
        overlay.style.cssText =
            'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.6);z-index:99999;display:flex;align-items:center;justify-content:center;padding:16px;';

        const card = document.createElement('div');
        card.style.cssText =
            'background:white;border-radius:14px;width:100%;max-width:400px;box-shadow:0 10px 30px rgba(0,0,0,0.3);max-height:92vh;overflow-y:auto;';

        const INPUT_STYLE = 'width:100%;box-sizing:border-box;padding:12px;font-size:15px;border:2px solid #ddd;border-radius:8px;outline:none;';

        card.innerHTML =
            // 标题（注册开通 · 绿色主题）
            '<div style="background:linear-gradient(135deg,#26a69a 0%,#00897b 100%);padding:18px;border-radius:14px 14px 0 0;text-align:center;">' +
                '<div style="font-size:19px;font-weight:bold;color:white;">📝 注册开通</div>' +
                '<div style="font-size:12px;color:rgba(255,255,255,0.9);margin-top:4px;">惠康中医诊所管理系统 · 云端版</div>' +
            '</div>' +

            // 表单（一页式）
            '<div id="registerForm" style="padding:16px;">' +
                '<div style="margin-bottom:12px;">' +
                    '<label style="display:block;font-size:13px;color:#333;margin-bottom:5px;">版本类型 <span style="color:#e53935;">*</span></label>' +
                    '<div style="display:flex;gap:10px;">' +
                        '<div id="regEdPersonal" data-edition="personal" style="flex:1;padding:12px;border:2px solid #26a69a;border-radius:10px;text-align:center;cursor:pointer;background:#26a69a;color:#fff;">' +
                            '<div style="font-size:15px;font-weight:bold;">👤 标准版</div>' +
                            '<div style="font-size:11px;margin-top:3px;opacity:0.9;">单用户 · 处方开单</div>' +
                        '</div>' +
                        '<div id="regEdInstitution" data-edition="institution" style="flex:1;padding:12px;border:2px solid #ddd;border-radius:10px;text-align:center;cursor:pointer;background:#fff;color:#333;">' +
                            '<div style="font-size:15px;font-weight:bold;">🏥 机构版</div>' +
                            '<div style="font-size:11px;margin-top:3px;color:#909399;">多用户 · 子账号管理</div>' +
                        '</div>' +
                    '</div>' +
                    '<div style="font-size:11px;color:#909399;margin-top:4px;">💡 注册时选版本意向，管理员审核时最终确认</div>' +
                '</div>' +
                '<div style="margin-bottom:12px;">' +
                    '<label style="display:block;font-size:13px;color:#333;margin-bottom:5px;">诊所名称 <span style="color:#e53935;">*</span></label>' +
                    '<input type="text" id="regClinicName" placeholder="如：惠康中医诊所" value="' + String(defaultClinicName || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;') + '" autocomplete="off" spellcheck="false" maxlength="50" style="' + INPUT_STYLE + '">' +
                    '<div style="font-size:11px;color:#909399;margin-top:4px;">💡 必填，请填写您的诊所名称</div>' +
                '</div>' +
                '<div style="margin-bottom:12px;">' +
                    '<label style="display:block;font-size:13px;color:#333;margin-bottom:5px;">管理员/医师姓名 <span style="color:#e53935;">*</span></label>' +
                    '<input type="text" id="regAdminName" placeholder="如：王医生" autocomplete="off" spellcheck="false" maxlength="30" style="' + INPUT_STYLE + '">' +
                    '<div style="font-size:11px;color:#909399;margin-top:4px;">💡 必填，请填写管理员/医师姓名</div>' +
                '</div>' +
                '<div style="margin-bottom:12px;">' +
                    '<label style="display:block;font-size:13px;color:#333;margin-bottom:5px;">用户名（选填，登录账号）</label>' +
                    '<input type="text" id="regUsername" placeholder="如：zhangyisheng" autocomplete="off" spellcheck="false" maxlength="30" style="' + INPUT_STYLE + '">' +
                    '<div style="font-size:11px;color:#909399;margin-top:4px;">💡 选填；填写后可用用户名登录，不填则默认用手机号登录</div>' +
                '</div>' +
                '<div style="margin-bottom:12px;">' +
                    '<label style="display:block;font-size:13px;color:#333;margin-bottom:5px;">手机号 <span style="color:#e53935;">*</span>（登录账号/联系）</label>' +
                    '<input type="text" id="regPhone" placeholder="如：13800138000" autocomplete="off" inputmode="numeric" maxlength="11" style="' + INPUT_STYLE + '">' +
                    '<div style="font-size:11px;color:#909399;margin-top:4px;">💡 11位手机号，用于管理员审核联系；未填用户名时即登录账号</div>' +
                '</div>' +
                '<div style="margin-bottom:12px;">' +
                    '<label style="display:block;font-size:13px;color:#333;margin-bottom:5px;">登录密码 <span style="color:#e53935;">*</span></label>' +
                    '<input type="password" id="regPassword" placeholder="至少8位，须包含字母和数字" autocomplete="new-password" data-lpignore="true" maxlength="32" style="' + INPUT_STYLE + '">' +
                    '<div style="font-size:11px;color:#909399;margin-top:4px;">💡 至少8位，须同时包含字母和数字</div>' +
                '</div>' +
                '<div style="margin-bottom:12px;">' +
                    '<label style="display:block;font-size:13px;color:#333;margin-bottom:5px;">确认密码 <span style="color:#e53935;">*</span></label>' +
                    '<input type="password" id="regPassword2" placeholder="请再次输入登录密码" autocomplete="new-password" data-lpignore="true" maxlength="32" style="' + INPUT_STYLE + '">' +
                '</div>' +
                '<div id="regError" style="display:none;margin-bottom:12px;padding:10px 12px;border-radius:8px;background:#fdecea;color:#c0392b;font-size:13px;"></div>' +
                '<button id="regSubmitBtn" style="width:100%;padding:12px;font-size:15px;border:none;border-radius:8px;color:#fff;background:linear-gradient(135deg,#26a69a 0%,#00897b 100%);cursor:pointer;font-weight:bold;">📤 提交注册</button>' +
                '<div style="text-align:center;margin-top:10px;">' +
                    '<span id="regCloseLink" style="font-size:13px;color:#909399;cursor:pointer;text-decoration:underline;">暂不注册，返回登录</span>' +
                '</div>' +
                '<div style="margin-top:12px;padding:10px 12px;border-radius:8px;background:#f4f6f8;font-size:12px;color:#606266;line-height:1.6;">注册说明：提交后账号即时创建，管理员审核通过后即可用手机号登录使用。如有疑问请联系客服微信 hktzy1688。</div>' +
            '</div>' +

            // 提交中（默认隐藏）
            '<div id="regSubmitting" style="display:none;padding:40px 16px;text-align:center;">' +
                '<div style="font-size:34px;">📡</div>' +
                '<div style="font-size:15px;font-weight:bold;color:#333;margin-top:8px;">正在提交注册...</div>' +
                '<div style="font-size:12px;color:#909399;margin-top:4px;">正在连接服务器，请稍候</div>' +
            '</div>' +

            // 注册成功（默认隐藏）
            '<div id="regSuccess" style="display:none;padding:32px 16px;text-align:center;">' +
                '<div style="font-size:44px;">✅</div>' +
                '<div style="font-size:17px;font-weight:bold;color:#2c3e50;margin-top:10px;">注册成功！</div>' +
                '<div style="font-size:13px;color:#606266;margin-top:8px;line-height:1.7;">账号已创建，管理员审核通过后即可登录。<br>登录账号：<b id="regSuccessPhone" style="color:#26a69a;"></b>（请牢记）</div>' +
                '<div style="margin-top:14px;padding:10px 12px;border-radius:8px;background:#f4f6f8;font-size:12px;color:#909399;line-height:1.6;">审核通常在工作时间 1 小时内完成，请稍后使用登录账号（用户名或手机号）和您设置的密码登录。如有疑问请联系客服微信 hktzy1688。</div>' +
                '<button id="regSuccessCloseBtn" style="width:100%;margin-top:16px;padding:12px;font-size:15px;border:none;border-radius:8px;color:#fff;background:linear-gradient(135deg,#26a69a 0%,#00897b 100%);cursor:pointer;font-weight:bold;">好的，返回登录</button>' +
            '</div>';

        overlay.appendChild(card);
        document.body.appendChild(overlay);

        const showError = function (msg) {
            const el = document.getElementById('regError');
            if (el) {
                el.textContent = msg;
                el.style.display = 'block';
            }
        };
        const close = function () { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); };

        // 关闭入口
        const closeLink = document.getElementById('regCloseLink');
        if (closeLink) closeLink.addEventListener('click', close);
        const successCloseBtn = document.getElementById('regSuccessCloseBtn');
        if (successCloseBtn) successCloseBtn.addEventListener('click', close);

        // ★ 2026-08-21 版本选择（标准版/机构版意向，提交后端存 requestedEdition）
        let regEdition = 'personal';
        ['regEdPersonal', 'regEdInstitution'].forEach(function (id) {
            const el = document.getElementById(id);
            if (!el) return;
            el.addEventListener('click', function () {
                regEdition = this.getAttribute('data-edition') || 'personal';
                const isPersonal = regEdition === 'personal';
                const p = document.getElementById('regEdPersonal');
                const i = document.getElementById('regEdInstitution');
                if (p) {
                    p.style.borderColor = isPersonal ? '#26a69a' : '#ddd';
                    p.style.background = isPersonal ? '#26a69a' : '#fff';
                    p.style.color = isPersonal ? '#fff' : '#333';
                }
                if (i) {
                    i.style.borderColor = isPersonal ? '#ddd' : '#26a69a';
                    i.style.background = isPersonal ? '#fff' : '#26a69a';
                    i.style.color = isPersonal ? '#333' : '#fff';
                }
            });
        });

        // 提交注册
        const submitBtn = document.getElementById('regSubmitBtn');
        if (submitBtn) {
            submitBtn.addEventListener('click', async function () {
                try {
                    const errEl = document.getElementById('regError');
                    if (errEl) errEl.style.display = 'none';

                    const clinicName = (document.getElementById('regClinicName') || {}).value || '';
                    const adminName = (document.getElementById('regAdminName') || {}).value || '';
                    const username = (document.getElementById('regUsername') || {}).value || '';
                    const phone = (document.getElementById('regPhone') || {}).value || '';
                    const password = (document.getElementById('regPassword') || {}).value || '';
                    const password2 = (document.getElementById('regPassword2') || {}).value || '';

                    // 用户名（选填）：填写后作为登录账号；格式与服务端规则一致
                    const uname = String(username).trim();
                    if (uname) {
                        if (uname.length < 2 || uname.length > 30) { showError('用户名长度需 2-30 个字符'); return; }
                        if (!/^[\u4e00-\u9fa5a-zA-Z0-9_-]+$/.test(uname)) { showError('用户名仅允许中文、字母、数字、下划线或连字符'); return; }
                    }

                    // 客户端校验（与服务端规则一致）
                    if (!clinicName.trim() || clinicName.trim().length < 2) { showError('请填写诊所名称（至少2个字符）'); return; }
                    if (!adminName.trim()) { showError('请填写管理员/医师姓名'); return; }
                    if (!/^1[3-9]\d{9}$/.test(phone.trim())) { showError('请输入正确的11位手机号（用于管理员审核联系）'); return; }
                    if (password.length < 8) { showError('密码至少8位'); return; }
                    if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) { showError('密码必须同时包含字母和数字'); return; }
                    if (password !== password2) { showError('两次输入的密码不一致'); return; }

                    submitBtn.disabled = true;
                    submitBtn.textContent = '正在提交...';
                    const formEl = document.getElementById('registerForm');
                    const submittingEl = document.getElementById('regSubmitting');
                    if (formEl) formEl.style.display = 'none';
                    if (submittingEl) submittingEl.style.display = 'block';

                    const adapter = (typeof AuthCore !== 'undefined') ? AuthCore : (global.AuthCore || null);
                    let result;
                    if (adapter && typeof adapter.registerClinic === 'function') {
                        result = await adapter.registerClinic({ clinicName, phone, password, adminName, edition: regEdition, username: uname });
                    } else {
                        const fetchFn = global.cloudFetch || global.fetch;
                        const response = await fetchFn('https://tcm-prescription-system.pages.dev/api/users?action=register-clinic', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ clinicName: clinicName.trim(), phone: phone.trim(), password: password, adminName: adminName.trim(), edition: regEdition, username: uname })
                        });
                        result = await response.json();
                    }

                    if (result && result.success) {
                        // 注册成功：标记完成 + 隐藏登录框入口，显示成功页
                        setCloudActivationDone();
                        hideActivateLoginEntry();
                        const loginAccount = uname || phone.trim();
                        const phoneEl = document.getElementById('regSuccessPhone');
                        if (phoneEl) phoneEl.textContent = loginAccount;
                        if (submittingEl) submittingEl.style.display = 'none';
                        const successEl = document.getElementById('regSuccess');
                        if (successEl) successEl.style.display = 'block';
                        console.log('[LicenseCheck] 注册成功，等待管理员审核，登录账号:', loginAccount);
                    } else {
                        // 失败：返回表单并显示错误
                        if (submittingEl) submittingEl.style.display = 'none';
                        if (formEl) formEl.style.display = 'block';
                        submitBtn.disabled = false;
                        submitBtn.textContent = '📤 提交注册';
                        showError((result && result.error) ? result.error : '注册失败，请稍后重试');
                    }
                } catch (e) {
                    const formEl = document.getElementById('registerForm');
                    const submittingEl = document.getElementById('regSubmitting');
                    if (submittingEl) submittingEl.style.display = 'none';
                    if (formEl) formEl.style.display = 'block';
                    submitBtn.disabled = false;
                    submitBtn.textContent = '📤 提交注册';
                    showError('注册请求失败：' + (e.message || '网络错误'));
                }
            });
        }
    }

    // ============================================================================
    // ★ 2026-09-04 方案B 注册前置（独立注册 · 先注册后激活 · 彻底消灭 admin 默认账号）
    //   铁律：注册 = 本地建号（唯一密码写点）→ 登录/试用 → 激活（纯 license 操作）。
    //   激活收尾（installAdminLicense/断点续传）永不覆盖已注册密码（密码写点唯一化）。
    //   不修改 HTML 源码，仅运行时动态注入 DOM，符合界面保护约束。
    // ============================================================================

    function getLocalRegistrationInfo() {
        try {
            const raw = global.localStorage && global.localStorage.getItem('license:registrationInfo');
            if (!raw) return null;
            const info = JSON.parse(raw);
            return (info && info.phone) ? info : null;
        } catch (e) { return null; }
    }

    async function saveLocalRegistrationInfo(info) {
        try {
            if (global.localStorage && info) {
                global.localStorage.setItem('license:registrationInfo', JSON.stringify(info));
            }
        } catch (e) {}
    }

    function isLocalRegisteredSync() { return !!getLocalRegistrationInfo(); }

    async function isLocalRegisteredAsync() {
        if (isLocalRegisteredSync()) return true;
        // 桥账号（config.json）已有手机号账号 = 注册/激活建号的持久事实（升级设备）
        try {
            const api = global.electronAPI || (typeof window !== 'undefined' ? window.electronAPI : null);
            if (api && api.activate && typeof api.activate.getActivationUsers === 'function') {
                const res = await api.activate.getActivationUsers();
                if (res && res.success && Array.isArray(res.users)) {
                    for (let i = 0; i < res.users.length; i++) {
                        const u = res.users[i];
                        if (u && ((u.phone && /^1[3-9]\d{9}$/.test(String(u.phone))) ||
                                  /^1[3-9]\d{9}$/.test(String(u.username || '')))) return true;
                    }
                }
            }
        } catch (e) {}
        return false;
    }
    // 挂 global 供 IIFE-1 登录适配器（admin/admin 封锁）跨作用域调用
    global.__isLocalRegisteredAsync = isLocalRegisteredAsync;

    async function __isDeviceLicensed() {
        try {
            const api = global.electronAPI || (typeof window !== 'undefined' ? window.electronAPI : null);
            if (api && api.license && typeof api.license.getStatus === 'function') {
                const st = await api.license.getStatus();
                if (st && st.valid === true) {
                    const t = String(st.licenseType || st.type || '');
                    if (t && t !== 'trial') return true;
                }
            }
        } catch (_) {}
        try {
            if (typeof StorageAdapter !== 'undefined' && StorageAdapter &&
                typeof StorageAdapter.getItem === 'function') {
                const c = await StorageAdapter.getItem('license:code');
                if (c && String(c).trim().length >= 4) return true;
            }
        } catch (_) {}
        try {
            const ls = (typeof global !== 'undefined' && global.localStorage) ||
                       (typeof window !== 'undefined' ? window.localStorage : null);
            if (ls) {
                const c = ls.getItem('license:code');
                if (c && String(c).trim().length >= 4) return true;
            }
        } catch (_) {}
        return false;
    }

    function showLocalRegisterModal() {
        // 若已打开则忽略
        if (document.getElementById('localRegisterOverlay')) return;
        const PHONE_RE = /^1[3-9]\d{9}$/;
        const INPUT_STYLE = 'width:100%;box-sizing:border-box;padding:12px;font-size:15px;border:2px solid #ddd;border-radius:8px;outline:none;';

        const overlay = document.createElement('div');
        overlay.id = 'localRegisterOverlay';
        overlay.style.cssText =
            'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.75);z-index:100000;display:flex;align-items:center;justify-content:center;padding:16px;';

        const card = document.createElement('div');
        card.style.cssText =
            'background:white;border-radius:14px;width:100%;max-width:400px;box-shadow:0 10px 30px rgba(0,0,0,0.3);max-height:92vh;overflow-y:auto;';

        card.innerHTML =
            // 标题（注册开通 · 绿色主题，对齐既有弹窗视觉）
            '<div style="background:linear-gradient(135deg,#26a69a 0%,#00897b 100%);padding:18px;border-radius:14px 14px 0 0;text-align:center;">' +
                '<div style="font-size:19px;font-weight:bold;color:white;">📝 注册开通</div>' +
                '<div style="font-size:12px;color:rgba(255,255,255,0.9);margin-top:4px;">惠康中医诊所管理系统 · 本地版</div>' +
            '</div>' +

            // 表单（一页式）
            '<div id="localRegForm" style="padding:16px;">' +
                '<div style="background:#f0f7ff;border:1px solid #d6e8ff;border-radius:8px;padding:10px;margin-bottom:14px;font-size:12px;color:#1565c0;line-height:1.7;">' +
                    '💡 请先完成注册（<b>手机号即登录账号</b>）。<br>注册后即可登录试用 7 天，试用期内随时可激活正式版。' +
                '</div>' +
                '<div style="margin-bottom:12px;">' +
                    '<label style="display:block;font-size:13px;color:#333;margin-bottom:5px;">诊所名称 <span style="color:#e53935;">*</span></label>' +
                    '<input type="text" id="localRegClinicName" placeholder="如：惠康中医诊所" autocomplete="off" spellcheck="false" maxlength="50" style="' + INPUT_STYLE + '">' +
                '</div>' +
                '<div style="margin-bottom:12px;">' +
                    '<label style="display:block;font-size:13px;color:#333;margin-bottom:5px;">管理员/医师姓名 <span style="color:#e53935;">*</span></label>' +
                    '<input type="text" id="localRegAdminName" placeholder="如：王医生" autocomplete="off" spellcheck="false" maxlength="30" style="' + INPUT_STYLE + '">' +
                '</div>' +
                '<div style="margin-bottom:12px;">' +
                    '<label style="display:block;font-size:13px;color:#333;margin-bottom:5px;">手机号 <span style="color:#e53935;">*</span>（登录账号）</label>' +
                    '<input type="text" id="localRegPhone" placeholder="如：13800138000" autocomplete="off" inputmode="numeric" maxlength="11" style="' + INPUT_STYLE + '">' +
                    '<div id="localRegPhoneHint" style="font-size:11px;color:#909399;margin-top:4px;">💡 11位手机号，注册后用「手机号+密码」登录</div>' +
                '</div>' +
                '<div style="margin-bottom:12px;">' +
                    '<label style="display:block;font-size:13px;color:#333;margin-bottom:5px;">设置登录密码 <span style="color:#e53935;">*</span></label>' +
                    '<input type="password" id="localRegPassword" placeholder="至少8位，须包含字母和数字" autocomplete="new-password" data-lpignore="true" maxlength="32" style="' + INPUT_STYLE + '">' +
                '</div>' +
                '<div style="margin-bottom:12px;">' +
                    '<label style="display:block;font-size:13px;color:#333;margin-bottom:5px;">确认密码 <span style="color:#e53935;">*</span></label>' +
                    '<input type="password" id="localRegPassword2" placeholder="请再次输入登录密码" autocomplete="new-password" data-lpignore="true" maxlength="32" style="' + INPUT_STYLE + '">' +
                '</div>' +
                '<div id="localRegError" style="display:none;margin-bottom:12px;padding:10px 12px;border-radius:8px;background:#fdecea;color:#c0392b;font-size:13px;"></div>' +
                '<button id="localRegSubmitBtn" style="width:100%;padding:12px;font-size:15px;border:none;border-radius:8px;color:#fff;background:linear-gradient(135deg,#26a69a 0%,#00897b 100%);cursor:pointer;font-weight:bold;">✅ 完成注册</button>' +
            '</div>' +

            // 提交中（默认隐藏）
            '<div id="localRegSubmitting" style="display:none;padding:40px 16px;text-align:center;">' +
                '<div style="font-size:34px;">📡</div>' +
                '<div style="font-size:15px;font-weight:bold;color:#333;margin-top:8px;">正在注册...</div>' +
                '<div style="font-size:12px;color:#909399;margin-top:4px;">正在创建本地账号，请稍候</div>' +
            '</div>' +

            // 注册成功（默认隐藏）
            '<div id="localRegSuccess" style="display:none;padding:32px 16px;text-align:center;">' +
                '<div style="font-size:44px;">🎉</div>' +
                '<div style="font-size:17px;font-weight:bold;color:#2c3e50;margin-top:10px;">注册成功！</div>' +
                '<div style="font-size:13px;color:#606266;margin-top:8px;line-height:1.7;">登录账号：<b id="localRegSuccessPhone" style="color:#26a69a;"></b><br>现在可以用「手机号 + 密码」登录试用（7天）</div>' +
                '<button id="localRegActivateBtn" style="width:100%;margin-top:16px;padding:12px;font-size:15px;border:none;border-radius:8px;color:#fff;background:linear-gradient(135deg,#26a69a 0%,#00897b 100%);cursor:pointer;font-weight:bold;">💳 立即激活正式版</button>' +
                '<button id="localRegLaterBtn" style="width:100%;margin-top:10px;padding:12px;font-size:15px;border:none;border-radius:8px;color:#26a69a;background:#fff;border:2px solid #26a69a;cursor:pointer;font-weight:bold;">⏳ 稍后激活，先试用</button>' +
            '</div>';

        overlay.appendChild(card);
        document.body.appendChild(overlay);

        const showError = function (msg) {
            const el = document.getElementById('localRegError');
            if (el) { el.textContent = msg; el.style.display = 'block'; }
        };
        const close = function () { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); };

        // 手机号实时提示
        const phoneInput = document.getElementById('localRegPhone');
        if (phoneInput) {
            phoneInput.addEventListener('input', function () {
                const hint = document.getElementById('localRegPhoneHint');
                if (!hint) return;
                const v = String(this.value || '').trim();
                if (!v) { hint.textContent = '💡 11位手机号，注册后用「手机号+密码」登录'; hint.style.color = '#909399'; }
                else if (!PHONE_RE.test(v)) { hint.textContent = '⚠ 请输入正确的11位手机号'; hint.style.color = '#e53935'; }
                else { hint.textContent = '✓ 手机号格式正确'; hint.style.color = '#26a69a'; }
            });
        }

        // 成功页按钮（★ 桌面登录窗上下文适配：桌面激活窗口 + 刷新登录页重读用户列表）
        const isDesktopLoginPage = !document.getElementById('loginOverlay') &&
            !!(document.getElementById('btnOk') && document.getElementById('loginPassword'));
        const reloadLoginPage = function () {
            // 桌面登录窗 login.js 的 _users 在 DOMContentLoaded 一次性缓存，
            // 注册写入 config.json 后必须 reload 才能让手机号账号立即可登录
            if (!isDesktopLoginPage) return;
            setTimeout(function () { try { window.location.reload(); } catch (e) {} }, 300);
        };
        const activateBtn = document.getElementById('localRegActivateBtn');
        if (activateBtn) {
            activateBtn.addEventListener('click', function () {
                close();
                try {
                    if (isDesktopLoginPage) {
                        // 桌面：打开桌面激活窗口（activateManager；installLicense 不覆盖注册密码）
                        if (window.electronAPI && window.electronAPI.activate &&
                            typeof window.electronAPI.activate.show === 'function') {
                            window.electronAPI.activate.show();
                        }
                        reloadLoginPage();
                    } else if (typeof window.openAdminActivate === 'function') {
                        window.openAdminActivate();
                    }
                } catch (e) {}
            });
        }
        const laterBtn = document.getElementById('localRegLaterBtn');
        if (laterBtn) laterBtn.addEventListener('click', function () { close(); reloadLoginPage(); });

        // 提交注册
        const submitBtn = document.getElementById('localRegSubmitBtn');
        if (submitBtn) {
            submitBtn.addEventListener('click', async function () {
                try {
                    const errEl = document.getElementById('localRegError');
                    if (errEl) errEl.style.display = 'none';

                    const clinicName = String((document.getElementById('localRegClinicName') || {}).value || '').trim();
                    const adminName = String((document.getElementById('localRegAdminName') || {}).value || '').trim();
                    const phone = String((document.getElementById('localRegPhone') || {}).value || '').trim();
                    const password = String((document.getElementById('localRegPassword') || {}).value || '');
                    const password2 = String((document.getElementById('localRegPassword2') || {}).value || '');

                    // 客户端校验（与 Java LicenseManager.registerLocalUser 规则一致）
                    if (!clinicName || clinicName.length < 2) { showError('请填写诊所名称（至少2个字符）'); return; }
                    if (!adminName) { showError('请填写管理员/医师姓名'); return; }
                    if (!PHONE_RE.test(phone)) { showError('请输入正确的11位手机号'); return; }
                    if (password.length < 8) { showError('密码至少8位'); return; }
                    if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) { showError('密码必须同时包含字母和数字'); return; }
                    if (password === 'admin') { showError('密码不能使用默认口令 admin'); return; }
                    if (password !== password2) { showError('两次输入的密码不一致'); return; }

                    const api = global.electronAPI || (typeof window !== 'undefined' ? window.electronAPI : null);
                    if (!api || !api.activate || typeof api.activate.registerLocalUser !== 'function') {
                        showError('当前环境不支持本地注册，请升级到最新版本');
                        return;
                    }

                    submitBtn.disabled = true;
                    submitBtn.textContent = '正在注册...';
                    const formEl = document.getElementById('localRegForm');
                    const submittingEl = document.getElementById('localRegSubmitting');
                    if (formEl) formEl.style.display = 'none';
                    if (submittingEl) submittingEl.style.display = 'block';

                    const res = await api.activate.registerLocalUser({
                        clinicName: clinicName, adminName: adminName,
                        phone: phone, password: password
                    });

                    if (res && res.success) {
                        // ① localStorage 镜像（username=手机号；addLocalActivationUser 幂等 UPSERT）
                        try {
                            if (typeof window.addLocalActivationUser === 'function') {
                                const __now = Date.now();
                                window.addLocalActivationUser({
                                    username: phone, phone: phone, password: password,
                                    name: adminName, role: 'admin',
                                    registeredAt: __now, lastPwdUpdatedAt: __now, updatedAt: __now
                                });
                            }
                        } catch (me) { console.warn('[LicenseCheck] 注册镜像失败(桥自愈兜底):', me); }
                        // ② 持久化注册信息（激活弹窗 Tab1/Tab2 预填 + 断点续传密码源）
                        let passwordEnc = '';
                        try { passwordEnc = await encryptSensitive(password) || ''; } catch (ee) {}
                        await saveLocalRegistrationInfo({
                            clinicName: clinicName, adminName: adminName,
                            phone: phone, passwordEnc: passwordEnc, at: Date.now()
                        });
                        // ③ FSM v2 标记 registered（不改变 license 状态节点）
                        try { await setStateV2(_STATES.UNACTIVATED, { registered: true }); } catch (fe) {}
                        // ④ 成功页
                        const phoneEl = document.getElementById('localRegSuccessPhone');
                        if (phoneEl) phoneEl.textContent = phone;
                        if (submittingEl) submittingEl.style.display = 'none';
                        const successEl = document.getElementById('localRegSuccess');
                        if (successEl) successEl.style.display = 'block';
                        console.log('[LicenseCheck] 本地注册成功:', phone);
                        // ⑤ 注册完成 → APP 登录框入口语义从「注册开通」切换为「管理员激活」（已有账号）；
                        //   桌面登录窗（dataset.context=desktop-login）则隐藏注册入口——激活走桌面原生
                        //   #activateLink（openActivationWindow，login.js 按未激活状态自动显示），不双入口
                        try {
                            const _entry = document.getElementById('activateLoginEntry');
                            if (_entry) {
                                if (_entry.dataset && _entry.dataset.context === 'desktop-login') {
                                    _entry.style.display = 'none';
                                } else {
                                    _entry.innerHTML =
                                        '<div style="display:flex;align-items:center;justify-content:center;gap:6px;padding:12px 0;border-radius:8px;background:linear-gradient(135deg,#26a69a 0%,#00897b 100%);color:#fff;cursor:pointer;font-size:14px;font-weight:bold;text-align:center;-webkit-tap-highlight-color:transparent;" onclick="if(window.openAdminActivate){window.openAdminActivate();}">📋 管理员激活</div>';
                                }
                            }
                        } catch (se2) {}
                    } else {
                        if (submittingEl) submittingEl.style.display = 'none';
                        if (formEl) formEl.style.display = 'block';
                        submitBtn.disabled = false;
                        submitBtn.textContent = '✅ 完成注册';
                        showError((res && res.error) ? res.error : '注册失败，请稍后重试');
                    }
                } catch (e) {
                    const formEl = document.getElementById('localRegForm');
                    const submittingEl = document.getElementById('localRegSubmitting');
                    if (submittingEl) submittingEl.style.display = 'none';
                    if (formEl) formEl.style.display = 'block';
                    submitBtn.disabled = false;
                    submitBtn.textContent = '✅ 完成注册';
                    showError('注册失败：' + (e.message || '未知错误'));
                }
            });
        }
    }
    global.openLocalRegister = function () {
        try { showLocalRegisterModal(); } catch (e) { console.warn('[LicenseCheck] 打开本地注册弹窗失败:', e); }
    };

    // ★ 注册前置检测：登录上下文 + 未激活 + 未注册 → 强制先注册（弹窗置于激活弹窗之上）
    async function maybePromptRegistration() {
        try {
            // 登录上下文检测（双端）：
            //   ① 离线APP 壳 index.html：loginOverlay（登录时可见）
            //   ② 离线桌面登录窗 login.html：无 loginOverlay，特征 = btnOk + loginPassword
            //   其余（纯网页/云端）→ 跳过
            const overlay = document.getElementById('loginOverlay');
            const isDesktopLoginPage = !overlay &&
                !!(document.getElementById('btnOk') && document.getElementById('loginPassword'));
            if (!overlay && !isDesktopLoginPage) return;
            // 桌面主窗口（index.html 有 loginOverlay 但已登录隐藏）不打扰
            if (overlay && !isDesktopLoginPage) {
                try {
                    const d = window.getComputedStyle ? getComputedStyle(overlay).display : '';
                    if (d === 'none') return;
                } catch (_) {}
            }
            // 云端注册制已完成（云端APP同壳共用 auth-core）→ 不打扰
            if (isCloudActivationDone()) return;
            // 已激活的存量设备不打扰（可能无手机号账号，维持现状，铁律 1-5 不破坏）
            if (await __isDeviceLicensed()) return;
            // 本地桥判定：云端APP/纯网页无 getActivationUsers/registerLocalUser 桥 → 跳过
            const api = global.electronAPI || (typeof window !== 'undefined' ? window.electronAPI : null);
            const hasLocalBridge = !!(api && api.activate &&
                (typeof api.activate.getActivationUsers === 'function' ||
                 typeof api.activate.registerLocalUser === 'function'));
            if (!hasLocalBridge) return;
            // 已注册（标记或桥账号有手机号）→ 跳过
            if (await isLocalRegisteredAsync()) return;
            showLocalRegisterModal();
            console.log('[LicenseCheck] 检测到未注册设备，已弹出注册界面（方案B 注册前置）',
                isDesktopLoginPage ? '(桌面登录窗)' : '(APP登录界面)');
        } catch (e) { console.warn('[LicenseCheck] 注册前置检测失败(不影响使用):', e); }
    }

    // ============================================================================
    // ★ APP 端"管理员激活"多步骤弹窗（仿桌面 activate-window.html）
    // 版本选择 → 填写信息 → 确认密码 → 提交 admin-submit → 轮询 admin-status →
    //   激活成功(离线: installAdminLicense 安装本地license+重启 / 云端: 提示用手机号登录)
    // 不修改 HTML 源码，仅运行时动态注入 DOM，符合界面保护约束
    // ============================================================================
    const ADMIN_SUBMIT_URL = 'https://tcm-prescription-system.pages.dev/api/license/admin-submit';
    const ADMIN_STATUS_URL = 'https://tcm-prescription-system.pages.dev/api/license/admin-status';
    // ★ 规则3：激活工单提交 API（客户在线申请激活码，管理员在后台工单审批页一键审批）
    const ACTIVATION_TICKET_SUBMIT_URL = 'https://tcm-prescription-system.pages.dev/api/license/ticket/submit';

    // ============================================================================
    // ★ 2026-09-02 付款按钮"点击无反应"根治（openPayUrlRobust 三层递进+用户可见兜底）
    //   故障树（实测审计）：桥失败(旧包/任何异常) → window.open 在 WebView 未开多窗
    //   口时**静默返回 null 且不抛异常**（2026-08-30 修复的错误假设：以为 open 失败
    //   会抛异常走 location.href）→ location.href 又被 WebView 拦截器
    //   shouldOverrideUrlLoading return true 静默吞掉 → 全链路零用户可见反馈。
    //   修复：①检查 open **返回值**而非依赖异常；②Electron deny 场景（无桥+null）
    //   视为成功（setWindowOpenHandler 已 shell.openExternal 打开系统浏览器）；
    //   ③仅 APP（有桥但桥失败）走 location.href+看门狗——1.2s 后页面未离开即判定
    //   被拦截器吞掉，自动复制购买链接+按钮文字提示，**保证按钮任何情况下"有反应"，
    //   客户永远拿得到购买链接**（宁降级不静默）。
    // ============================================================================
    function openPayUrlRobust(url, btnEl) {
        // ① 原生桥（APP 端唯一可靠通路，Java 白名单仅放行官网购买页）
        var __hasBridge = false;
        try {
            __hasBridge = !!(window.AndroidNative && typeof window.AndroidNative.invoke === 'function');
            if (__hasBridge) {
                var __r = window.AndroidNative.invoke('openExternalUrl', JSON.stringify({ url: url }));
                if (__r) { try { var __j = JSON.parse(__r); if (__j && __j.success) return true; } catch (e) {} }
            }
        } catch (e) {}
        // ② window.open：必须检查返回值——WebView 未开多窗口时静默返回 null（不抛异常）
        try {
            var __w = window.open(url, '_blank');
            if (__w) return true; // 浏览器/正常多窗口环境
        } catch (e) {}
        // open 返回 null 的三种环境区分：
        //  · Electron 桌面（无安卓桥）：setWindowOpenHandler 已 shell.openExternal 打开
        //    系统浏览器，deny 时返回 null 是正常路径 → 视为成功（且 will-navigate 会
        //    拦截 location.href 外链，绝不能再走导航兜底）
        //  · APP WebView（有桥但桥失败）：走 ③ location.href + 看门狗
        //  · 纯浏览器弹窗被拦截（无桥非 Electron）：用户手势内 location.href 直接跳转，
        //    购买页本就是预期目的地，当前页跳转可接受（2026-09-02 补边界）
        var __isElectron = false;
        try { __isElectron = navigator.userAgent.indexOf('Electron') >= 0; } catch (e3) {}
        if (!__hasBridge && __isElectron) return true;
        // ③ 仅 APP（桥存在但桥失败）：location.href + 看门狗兜底
        try {
            var __btn = btnEl || null;
            var __orig = __btn ? __btn.innerHTML : '';
            window.location.href = url;
            setTimeout(function() {
                try {
                    // 页面仍在（导航被拦截器静默吞掉）且按钮还在 DOM → 给用户可见出口
                    if (__btn && __btn.parentNode && document.getElementById(__btn.id)) {
                        copyTextToClipboard(url).then(function(ok) {
                            __btn.innerHTML = ok
                                ? '✅ 购买链接已复制，请在浏览器粘贴打开'
                                : '⚠️ 打开失败，请联系客服微信 hktzy1688';
                            setTimeout(function() { try { __btn.innerHTML = __orig; } catch (e2) {} }, 4000);
                        });
                    }
                } catch (e) {}
            }, 1200);
            return true;
        } catch (e2) {}
        return false;
    }

    // ============================================================================
    // ★ 规则3：激活工单申请弹窗（叠加在激活码弹窗之上，z-index 100000）
    // 客户填写联系方式 → fetch ticket/submit → 管理员在后台工单审批页一键审批发码
    // 提交成功后关闭本弹窗，回到底下的激活码输入弹窗继续输码
    // 不修改 HTML 源码，仅运行时动态注入 DOM，符合界面保护约束
    // ============================================================================
    function showTicketFormModal(machineId, clinicName) {
        // 若已打开则忽略
        if (document.getElementById('ticketFormOverlay')) return;

        const PHONE_RE = /^1[3-9]\d{9}$/;

        // 版本意向归一化（institution/personal，仅供管理员参考，审批时最终确认）
        var editionIntent = '';
        try {
            var ed = String(CONFIG.edition || '').toLowerCase();
            if (['institution', 'local_institution', 'cloud_institution', 'cloud_clinic', 'clinic', 'org'].indexOf(ed) >= 0) {
                editionIntent = 'institution';
            } else if (['personal', 'local_personal', 'cloud_personal', 'standard', 'local', 'cloud'].indexOf(ed) >= 0) {
                editionIntent = 'personal';
            }
        } catch (e) {}

        const overlay = document.createElement('div');
        overlay.id = 'ticketFormOverlay';
        overlay.style.cssText =
            'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.65);z-index:100000;display:flex;align-items:center;justify-content:center;padding:16px;';

        const card = document.createElement('div');
        card.style.cssText =
            'background:white;border-radius:14px;width:100%;max-width:400px;padding:20px;box-shadow:0 10px 30px rgba(0,0,0,0.3);max-height:92vh;overflow-y:auto;';

        card.innerHTML =
            // 标题（绿色主题，呼应工单按钮）
            '<div style="background:linear-gradient(135deg,#07c160 0%,#06ad56 100%);margin:-20px -20px 16px -20px;padding:18px;border-radius:14px 14px 0 0;text-align:center;">' +
                '<div style="font-size:19px;font-weight:bold;color:white;">📩 激活工单申请</div>' +
                '<div style="font-size:12px;color:rgba(255,255,255,0.9);margin-top:4px;">提交后管理员审批，激活码通过电话/微信发送</div>' +
            '</div>' +

            // 提示条
            '<div style="background:#f0faf4;border:1px solid #d4f0e0;border-radius:8px;padding:10px;margin-bottom:14px;font-size:12px;color:#0a7a43;line-height:1.7;">' +
                '💡 填写以下信息提交工单，管理员审批后激活码将发送给您；<b>收到激活码后回到上一窗口输入即可激活</b>' +
            '</div>' +

            // 表单区（容器，成功后整体隐藏）
            '<div id="ticketFormArea">' +
                '<div style="margin-bottom:12px;">' +
                    '<label style="display:block;font-size:13px;color:#333;margin-bottom:5px;">诊所名称 <span style="color:#e53935;">*</span></label>' +
                    '<input type="text" id="ticketClinicName" placeholder="如：惠康中医诊所" autocomplete="off" spellcheck="false" style="width:100%;box-sizing:border-box;padding:12px;font-size:15px;border:2px solid #ddd;border-radius:8px;outline:none;">' +
                '</div>' +
                '<div style="margin-bottom:12px;">' +
                    '<label style="display:block;font-size:13px;color:#333;margin-bottom:5px;">联系人姓名 <span style="color:#e53935;">*</span></label>' +
                    '<input type="text" id="ticketContactName" placeholder="如：王医生" autocomplete="off" spellcheck="false" style="width:100%;box-sizing:border-box;padding:12px;font-size:15px;border:2px solid #ddd;border-radius:8px;outline:none;">' +
                '</div>' +
                '<div style="margin-bottom:12px;">' +
                    '<label style="display:block;font-size:13px;color:#333;margin-bottom:5px;">联系电话 <span style="color:#e53935;">*</span></label>' +
                    '<input type="text" id="ticketContactPhone" placeholder="如：13800138000" autocomplete="off" inputmode="numeric" maxlength="11" style="width:100%;box-sizing:border-box;padding:12px;font-size:15px;border:2px solid #ddd;border-radius:8px;outline:none;">' +
                    '<div id="ticketPhoneHint" style="font-size:11px;color:#909399;margin-top:4px;">💡 管理员审批后激活码将发送到此手机号</div>' +
                '</div>' +
                '<div style="margin-bottom:12px;">' +
                    '<label style="display:block;font-size:13px;color:#333;margin-bottom:5px;">微信号（选填）</label>' +
                    '<input type="text" id="ticketContactWechat" placeholder="方便客服联系您" autocomplete="off" maxlength="50" style="width:100%;box-sizing:border-box;padding:12px;font-size:15px;border:2px solid #ddd;border-radius:8px;outline:none;">' +
                '</div>' +
                '<div style="margin-bottom:14px;">' +
                    '<label style="display:block;font-size:13px;color:#333;margin-bottom:5px;">备注（选填）</label>' +
                    '<input type="text" id="ticketRemark" placeholder="如：需要几个账号、发票抬头等" autocomplete="off" maxlength="200" style="width:100%;box-sizing:border-box;padding:12px;font-size:15px;border:2px solid #ddd;border-radius:8px;outline:none;">' +
                '</div>' +
                // 设备标识提示（自动附带，脱敏展示前12位）
                '<div style="font-size:11px;color:#909399;margin-bottom:14px;background:#f9f9f9;border-radius:6px;padding:8px 10px;">' +
                    '🔒 设备标识将自动附带提交：<span style="font-family:monospace;color:#555;">' + (machineId ? String(machineId).substring(0, 12) + '...' : '未获取') + '</span>' +
                '</div>' +
            '</div>' +

            // 错误提示（默认隐藏）
            '<div id="ticketErrorBox" style="display:none;background:#fdecea;border:1px solid #f5c6cb;border-radius:8px;padding:10px;margin-bottom:12px;font-size:12px;color:#c0392b;line-height:1.6;"></div>' +

            // loading（默认隐藏）
            '<div id="ticketLoadingBox" style="display:none;text-align:center;padding:14px;margin-bottom:12px;">' +
                '<div style="display:inline-block;width:20px;height:20px;border:2px solid #ddd;border-top-color:#07c160;border-radius:50%;animation:ticketSpin 0.8s linear infinite;vertical-align:middle;margin-right:8px;"></div>' +
                '<span style="font-size:13px;color:#07c160;vertical-align:middle;">正在提交工单，请稍候...</span>' +
            '</div>' +

            // 成功面板（默认隐藏）
            '<div id="ticketSuccessBox" style="display:none;text-align:center;padding:10px 0;">' +
                '<div style="font-size:40px;">📨</div>' +
                '<div style="font-size:16px;font-weight:bold;color:#0a7a43;margin:8px 0;">工单提交成功！</div>' +
                '<div style="font-size:12px;color:#666;line-height:1.8;">管理员审批后激活码将通过电话/微信发送给您<br>收到后请回到上一窗口输入激活</div>' +
                '<div style="background:#f0faf4;border-radius:8px;padding:10px;margin:12px 0;font-size:12px;color:#333;text-align:left;">' +
                    '<div>📋 工单编号：<b id="ticketNoText" style="font-family:monospace;color:#07c160;">--</b></div>' +
                    '<div style="margin-top:4px;">🕐 提交时间：<b id="ticketTimeText">--</b></div>' +
                '</div>' +
                '<div style="font-size:11px;color:#909399;">⏳ 工作时间内通常 1 小时内处理，请耐心等待</div>' +
                // ★ 官网快速付费导引（工单提交后同样适用）
                '<div style="margin-top:10px;background:#fff7ed;border:1px solid #fdba74;border-radius:8px;padding:10px;text-align:center;">' +
                    '<div style="font-size:12px;font-weight:bold;color:#9a3412;">💳 不想等？官网在线付款立即激活</div>' +
                    '<button id="ticketPayGuideBtn" type="button" style="width:100%;margin-top:8px;padding:10px;font-size:14px;border:none;border-radius:8px;color:#fff;background:linear-gradient(135deg,#ea580c 0%,#c2410c 100%);font-weight:bold;cursor:pointer;">💳 去官网付款（支付宝/微信）</button>' +
                '</div>' +
            '</div>' +

            // 按钮区
            '<div style="display:flex;gap:10px;">' +
                '<button id="ticketCancelBtn" style="flex:1;padding:12px;font-size:15px;border:1px solid #ddd;border-radius:8px;color:#666;background:white;cursor:pointer;">取消</button>' +
                '<button id="ticketSubmitBtn" style="flex:1;padding:12px;font-size:15px;border:none;border-radius:8px;color:white;background:linear-gradient(135deg,#07c160 0%,#06ad56 100%);cursor:pointer;font-weight:bold;">📤 提交工单</button>' +
            '</div>';

        // 注入 spinner 动画（仅一次）
        if (!document.getElementById('ticketSpinKeyframes')) {
            const styleEl = document.createElement('style');
            styleEl.id = 'ticketSpinKeyframes';
            styleEl.textContent = '@keyframes ticketSpin{to{transform:rotate(360deg);}}';
            document.head.appendChild(styleEl);
        }

        overlay.appendChild(card);
        document.body.appendChild(overlay);

        // 预填诊所名
        if (clinicName) {
            try { document.getElementById('ticketClinicName').value = clinicName; } catch (e) {}
        }

        function cleanup() {
            // ★ 2026-08-23 同步：关闭工单弹窗前，把工单中已填的诊所名/姓名/电话灌回 Tab1 管理员激活
            try {
                var tC = (document.getElementById('ticketClinicName').value || '').trim();
                var tN = (document.getElementById('ticketContactName').value || '').trim();
                var tP = (document.getElementById('ticketContactPhone').value || '').trim();
                if (tC) { var aC = document.getElementById('adminClinicName'); if (aC && !aC.value.trim()) aC.value = tC; }
                if (tN) { var aN = document.getElementById('adminAdminName'); if (aN && !aN.value.trim()) aN.value = tN; }
                if (tP) { var aP = document.getElementById('adminPhone'); if (aP && !aP.value.trim()) aP.value = tP; }
            } catch (e) {}
            if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        }

        function showErr(msg) {
            const box = document.getElementById('ticketErrorBox');
            if (box) { box.textContent = '⚠ ' + msg; box.style.display = 'block'; }
        }
        function hideErr() {
            const box = document.getElementById('ticketErrorBox');
            if (box) { box.style.display = 'none'; }
        }
        function markInvalid(id) {
            const el = document.getElementById(id);
            if (el) el.style.borderColor = '#e53935';
        }
        function resetBorders() {
            ['ticketClinicName', 'ticketContactName', 'ticketContactPhone'].forEach(function(id) {
                const el = document.getElementById(id);
                if (el) el.style.borderColor = '#ddd';
            });
        }

        // 手机号实时校验
        document.getElementById('ticketContactPhone').addEventListener('input', function() {
            this.value = this.value.replace(/[^\d]/g, '').slice(0, 11);
            const hint = document.getElementById('ticketPhoneHint');
            const v = this.value;
            if (!v) {
                hint.textContent = '💡 管理员审批后激活码将发送到此手机号';
                hint.style.color = '#909399';
            } else if (!PHONE_RE.test(v)) {
                hint.textContent = '⚠ 请输入正确的11位手机号';
                hint.style.color = '#e53935';
            } else {
                hint.textContent = '✓ 手机号格式正确';
                hint.style.color = '#07c160';
            }
        });

        // 取消
        document.getElementById('ticketCancelBtn').addEventListener('click', cleanup);

        // ★ 官网快速付费导引（工单提交后同样适用）
        (function bindTicketPayGuide() {
            const btn = document.getElementById('ticketPayGuideBtn');
            if (!btn) return;
            btn.addEventListener('click', function() {
                // ★ 2026-09-02 改用 openPayUrlRobust（原 window.open/catch fallback 在
                //   WebView 静默 null 场景全链路无反馈，详见函数头注释）
                var __edParam = (editionIntent === 'institution') ? 'local-pro' : (editionIntent === 'personal' ? 'local-personal' : '');
                // ★ 2026-09-03 dp=载体（desktop/app）：官网下单沿 URL 传入 order-submit，
                //   服务端存入激活申请，后台用户管理离线版显示"🖥️桌面·/📱APP·"
                // ★ 2026-09-03 载体判定修正：APP 的 Java 桥同样暴露 electronAPI.activate，
                //   旧判据把 APP 误判成 desktop（KV 记录 appModeCarrier 错标、后台显示🖥️桌面）。
                //   正确判据=桌面 preload 独有的 showExpireAlert。
                // ★ 2026-09-04 流程优化：携带工单已填信息(cn=诊所名/n=联系人/p=手机号/wx=微信)
                //   → 官网购买页自动回填表单，避免付款页面重复填写；官网 purchase flow 的
                //   custName=诊所/联系人合并，custWechat/custNote 回填。
                var __dp = (global.electronAPI && global.electronAPI.activate &&
                    typeof global.electronAPI.activate.showExpireAlert === 'function') ? 'desktop' : 'app';
                var __cn = (document.getElementById('ticketClinicName') || {}).value || '';
                var __n  = (document.getElementById('ticketContactName') || {}).value || '';
                var __p  = (document.getElementById('ticketContactPhone') || {}).value || '';
                var __wx = (document.getElementById('ticketContactWechat') || {}).value || '';
                var __r  = (document.getElementById('ticketRemark') || {}).value || '';
                const url = 'https://tcm-prescription-system.pages.dev/download.html?mid=' + encodeURIComponent(machineId || '')
                    + (__edParam ? ('&ed=' + __edParam) : '') + '&dp=' + __dp
                    + (__cn ? ('&cn=' + encodeURIComponent(__cn)) : '')
                    + (__n  ? ('&n='  + encodeURIComponent(__n))  : '')
                    + (__p  ? ('&p='  + encodeURIComponent(__p))  : '')
                    + (__wx ? ('&wx=' + encodeURIComponent(__wx)) : '')
                    + (__r  ? ('&r='  + encodeURIComponent(__r))  : '');
                openPayUrlRobust(url, btn);
            });
        })();

        // 提交
        let ticketSubmitted = false; // 成功后按钮变为"完成"，点击关闭弹窗
        document.getElementById('ticketSubmitBtn').addEventListener('click', async function() {
            if (ticketSubmitted) { cleanup(); return; }
            hideErr();
            resetBorders();

            const clinicNameV = document.getElementById('ticketClinicName').value.trim();
            const contactNameV = document.getElementById('ticketContactName').value.trim();
            const contactPhoneV = document.getElementById('ticketContactPhone').value.trim();
            const contactWechatV = document.getElementById('ticketContactWechat').value.trim();
            const remarkV = document.getElementById('ticketRemark').value.trim();

            // 前端校验（与后端 API 口径一致）
            if (!clinicNameV) { markInvalid('ticketClinicName'); showErr('请填写诊所名称'); return; }
            if (!contactNameV) { markInvalid('ticketContactName'); showErr('请填写联系人姓名'); return; }
            if (!contactPhoneV && !contactWechatV) { markInvalid('ticketContactPhone'); showErr('请至少填写一种联系方式（手机号/微信号）'); return; }
            if (contactPhoneV && !PHONE_RE.test(contactPhoneV)) { markInvalid('ticketContactPhone'); showErr('请输入正确的11位手机号'); return; }
            if (!machineId || String(machineId).length < 8 || machineId === 'unknown') {
                showErr('设备标识无效，请重启应用后重试');
                return;
            }

            const btn = document.getElementById('ticketSubmitBtn');
            const cancelBtn = document.getElementById('ticketCancelBtn');
            btn.disabled = true;
            cancelBtn.disabled = true;
            document.getElementById('ticketLoadingBox').style.display = 'block';

            const payload = {
                machineId: String(machineId), // 只传哈希串，不传原始硬件
                edition: editionIntent,
                clinicName: clinicNameV,
                contactName: contactNameV,
                contactPhone: contactPhoneV,
                contactWechat: contactWechatV,
                remark: remarkV,
                submittedAt: new Date().toISOString()
            };

            try {
                const controller = new AbortController();
                const t = setTimeout(function() { try { controller.abort(); } catch (e) {} }, 20000);
                let res;
                try {
                    const r = await fetch(ACTIVATION_TICKET_SUBMIT_URL, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload),
                        signal: controller.signal
                    });
                    res = await r.json();
                } finally { clearTimeout(t); }

                if (res && res.success) {
                    ticketSubmitted = true;
                    document.getElementById('ticketFormArea').style.display = 'none';
                    document.getElementById('ticketLoadingBox').style.display = 'none';
                    document.getElementById('ticketSuccessBox').style.display = 'block';
                    document.getElementById('ticketNoText').textContent = res.ticketNo || '--';
                    document.getElementById('ticketTimeText').textContent = new Date().toLocaleString('zh-CN');
                    // 成功后：取消按钮隐藏，提交按钮变为"完成"
                    cancelBtn.style.display = 'none';
                    btn.disabled = false;
                    btn.textContent = '✅ 完成，回到激活窗口';
                } else {
                    btn.disabled = false;
                    cancelBtn.disabled = false;
                    document.getElementById('ticketLoadingBox').style.display = 'none';
                    showErr((res && res.error) ? res.error : '提交失败，请稍后重试');
                }
            } catch (e) {
                btn.disabled = false;
                cancelBtn.disabled = false;
                document.getElementById('ticketLoadingBox').style.display = 'none';
                showErr('网络错误，提交失败：' + ((e && e.message) ? e.message : '请检查网络连接'));
            }
        });
    }

    global.openAdminActivate = async function () {
        // 设置激活中标志，抑制fallbackTimer和其他弹窗源
        global.__licenseActivating = true;
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
        // ★ 2026-09-03 (架构统一 P2 客户端收敛): pollTimer/pollCount 仅保留作兼容别名，
        //   真实调度统一委托给 ActivationObserver（showAdminActivateModal 窗口内 单例）
        let pollTimer = null;
        let pollCount = 0;
        let currentActivationObserver = null;
        // ★ 2026-09-04 AR-02 修复：激活成功页 setTimeout 自动重启的 cancelId
        //   风险等级=中；影响范围=showAdminActivateModal 关闭/销毁生命周期
        //   用户在 1.5s 窗口内点击关闭弹窗/重试另一条流程时，如果不 cancel，
        //   setTimeout 仍会触发 electronAPI.activate.restart()——"我没点重启怎么就重启了"。
        let __autoRestartTid = null;

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
                // ★ 2026-08-23 简化：版本选择页直达链接——手里已有激活码/想留言申请的用户跳过版本选择
                //   （版本仅 Tab1 管理员激活申请需要，Tab2 输码/Tab3 工单不消费该字段，原流程强制选择属冗余步骤）
                '<div style="display:flex;justify-content:space-between;gap:8px;margin-top:14px;font-size:12px;">' +
                    '<span id="adminSkipToCode" style="color:#26a69a;cursor:pointer;-webkit-tap-highlight-color:transparent;">已有激活码？直接输入 →</span>' +
                    '<span id="adminSkipToTicket" style="color:#07c160;cursor:pointer;-webkit-tap-highlight-color:transparent;">留言申请激活码 →</span>' +
                '</div>' +
            '</div>' +

            // ★ 2026-08-23 三Tab（对齐桌面 activate-window）：版本选择后显示 Tab 栏
            '<div id="adminTabBar" style="display:none;border-bottom:1px solid #eee;background:#fafcfb;">' +
                '<div id="adminTabBtnAdmin" data-tab="admin" style="flex:1;text-align:center;padding:12px 2px;font-size:13px;font-weight:bold;color:#26a69a;border-bottom:2.5px solid #26a69a;cursor:pointer;-webkit-tap-highlight-color:transparent;">📋 管理员激活</div>' +
                '<div id="adminTabBtnCode" data-tab="code" style="flex:1;text-align:center;padding:12px 2px;font-size:13px;font-weight:bold;color:#909399;border-bottom:2.5px solid transparent;cursor:pointer;-webkit-tap-highlight-color:transparent;">🔑 激活码激活</div>' +
                '<div id="adminTabBtnTicket" data-tab="ticket" style="flex:1;text-align:center;padding:12px 2px;font-size:13px;font-weight:bold;color:#909399;border-bottom:2.5px solid transparent;cursor:pointer;-webkit-tap-highlight-color:transparent;">📨 工单申请</div>' +
            '</div>' +

            // ★ Tab2：激活码激活面板（默认隐藏；对齐桌面 activate-window 的 tab-code）
            '<div id="adminTabCode" style="display:none;padding:16px;">' +
                '<div style="background:#f0f7ff;border:1px solid #d6e8ff;border-radius:8px;padding:10px;margin-bottom:14px;font-size:12px;color:#1565c0;line-height:1.7;">' +
                    '💡 输入客服提供给您的激活码完成激活<br>还没有激活码？切换到「📨 工单申请」提交申请' +
                '</div>' +
                '<div style="margin-bottom:12px;">' +
                    '<label style="display:block;font-size:13px;color:#333;margin-bottom:5px;">激活码 <span style="color:#e53935;">*</span></label>' +
                    '<input type="text" id="adminCodeInput" placeholder="BNZC-XXXX-XXXX-XXXX-XXXX" autocomplete="new-password" data-lpignore="true" spellcheck="false" maxlength="24" style="width:100%;box-sizing:border-box;padding:12px;font-size:15px;border:2px solid #ddd;border-radius:8px;outline:none;font-family:monospace;letter-spacing:1px;text-transform:uppercase;">' +
                    '<div id="adminCodeHint" style="font-size:11px;color:#909399;margin-top:4px;">💡 激活码格式：BNZC-XXXX-XXXX-XXXX-XXXX（X 为大写字母或数字，不含 I/O/0/1）</div>' +
                '</div>' +
                '<div style="font-size:11px;color:#909399;margin-bottom:14px;background:#f9f9f9;border-radius:6px;padding:8px 10px;display:flex;align-items:center;justify-content:space-between;gap:6px;">' +
                    '<span style="word-break:break-all;">🔑 机器 ID：<b style="color:#555;">' + (machineId || '未获取') + '</b></span>' +
                    '<button id="adminCodeCopyMidBtn" style="flex-shrink:0;font-size:11px;padding:4px 10px;border:1px solid #ddd;border-radius:4px;background:#fff;color:#555;cursor:pointer;">复制</button>' +
                '</div>' +
                '<div id="adminCodeLoading" style="display:none;text-align:center;padding:10px;margin-bottom:12px;">' +
                    '<span style="display:inline-block;width:18px;height:18px;border:2px solid #ddd;border-top-color:#26a69a;border-radius:50%;animation:adminActivateSpin 0.8s linear infinite;vertical-align:middle;margin-right:8px;"></span>' +
                    '<span style="font-size:13px;color:#26a69a;vertical-align:middle;">正在验证激活码，请稍候...</span>' +
                '</div>' +
                '<div id="adminCodeSuccess" style="display:none;text-align:center;padding:16px 0;">' +
                    '<div style="font-size:40px;">🎉</div>' +
                    '<div style="font-size:16px;font-weight:bold;color:#2e7d32;margin-top:8px;">激活码验证成功！</div>' +
                    '<div id="adminCodeSuccessDesc" style="font-size:12px;color:#555;margin-top:8px;line-height:1.8;"></div>' +
                '</div>' +
                '<button id="adminCodeSubmitBtn" style="width:100%;padding:12px;font-size:15px;border:none;border-radius:8px;color:#fff;background:linear-gradient(135deg,#26a69a 0%,#00897b 100%);cursor:pointer;font-weight:bold;">🚀 立即激活</button>' +
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
                    '<input type="password" id="adminPassword" placeholder="云端登录密码固定为 admin（自定义密码不生效）" autocomplete="new-password" data-lpignore="true" maxlength="32" style="width:100%;box-sizing:border-box;padding:12px;font-size:15px;border:2px solid #ddd;border-radius:8px;outline:none;">' +
                    '<div class="admin-field-hint" id="adminPwdHint" style="font-size:11px;color:#e53935;margin-top:4px;">💡 云端登录密码固定为 admin，自定义密码不生效，登入后请自行修改密码</div>' +
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
                // ★ 官网快速付费导引：直达官网购买页（设备识别码自动携带），付款后自动激活
                '<div style="margin-top:12px;background:#fff7ed;border:1px solid #fdba74;border-radius:8px;padding:10px;text-align:center;">' +
                    '<div style="font-size:13px;font-weight:bold;color:#9a3412;">💳 加速激活：官网在线付款</div>' +
                    '<div style="font-size:11px;color:#78350f;margin-top:4px;line-height:1.7;">点击直达官网购买页，设备识别码<b>已自动携带</b><br>付款后管理员核对即自动激活本软件</div>' +
                    '<button id="adminPayGuideBtn" type="button" style="width:100%;margin-top:8px;padding:10px;font-size:14px;border:none;border-radius:8px;color:#fff;background:linear-gradient(135deg,#ea580c 0%,#c2410c 100%);font-weight:bold;cursor:pointer;">💳 去官网付款（支付宝/微信）</button>' +
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

            // ★ 2026-09-02 支付前置校验配套：未完成支付（默认隐藏）
            //   服务端 admin-submit 返回 code=PAYMENT_REQUIRED 时展示，引导官网付款
            '<div id="adminPayRequired" style="display:none;padding:28px 16px;text-align:center;">' +
                '<div style="font-size:34px;">💳</div>' +
                '<div style="font-size:16px;font-weight:bold;color:#9a3412;margin-top:8px;">请完成支付</div>' +
                '<div style="font-size:12px;color:#555;margin-top:6px;line-height:1.8;">激活前请先在官网完成付款（支付宝/微信）<br>付款后管理员核对即可自动激活本软件</div>' +
                '<div style="margin-top:12px;background:#fff7ed;border:1px solid #fdba74;border-radius:8px;padding:10px;text-align:center;">' +
                    '<div style="font-size:11px;color:#78350f;margin-top:2px;line-height:1.7;">点击直达官网购买页，设备识别码<b>已自动携带</b></div>' +
                    '<button id="adminPayRequiredBtn" type="button" style="width:100%;margin-top:8px;padding:10px;font-size:14px;border:none;border-radius:8px;color:#fff;background:linear-gradient(135deg,#ea580c 0%,#c2410c 100%);font-weight:bold;cursor:pointer;">💳 去官网付款（支付宝/微信）</button>' +
                '</div>' +
                '<button id="adminPayRequiredBackBtn" type="button" style="width:100%;margin-top:10px;padding:10px;font-size:14px;border:1px solid #ddd;border-radius:8px;color:#666;background:#fff;cursor:pointer;">← 返回上一步</button>' +
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
            ['adminStepEdition','adminTabCode','adminStepForm','adminStepPwd','adminSubmitting','adminWaiting','adminSuccess','adminRejected','adminPayRequired'].forEach(function(pid){
                const el = document.getElementById(pid);
                if (el) el.style.display = 'none';
            });
            const t = document.getElementById(id);
            if (t) t.style.display = 'block';
            // ★ 2026-08-23 三Tab：Tab 栏在"表单类面板"时显示（管理员激活表单/密码步骤/激活码面板），
            //   版本选择与状态面板（提交中/等待/成功/拒绝）时隐藏（对齐桌面 activate-window 覆盖式状态页）
            const bar = document.getElementById('adminTabBar');
            if (bar) {
                bar.style.display = (id === 'adminStepForm' || id === 'adminStepPwd' || id === 'adminTabCode') ? 'flex' : 'none';
            }
        }

        // ★ 2026-08-23 三Tab：Tab 高亮切换
        function setActiveTab(tab) {
            var conf = {
                admin: ['adminTabBtnAdmin', 'adminStepForm'],
                code:  ['adminTabBtnCode', 'adminTabCode']
            };
            ['adminTabBtnAdmin','adminTabBtnCode','adminTabBtnTicket'].forEach(function(bid) {
                var b = document.getElementById(bid);
                if (!b) return;
                var on = (bid === conf[tab][0]);
                b.style.color = on ? '#26a69a' : '#909399';
                b.style.borderBottom = on ? '2.5px solid #26a69a' : '2.5px solid transparent';
                b.style.background = on ? '#fafcfb' : 'transparent';
            });
        }

        function cleanup() {
            if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
            if (currentActivationObserver) { try { currentActivationObserver.stop(); } catch (_) {} currentActivationObserver = null; }
            // ★ 2026-09-04 AR-02 修复：关闭弹窗时取消自动重启定时器（见 onAdminActivated
            //   setTimeout(__restartApp, 1500)）。风险等级=中；影响范围=激活成功页 1.5s 窗口。
            if (__autoRestartTid) { clearTimeout(__autoRestartTid); __autoRestartTid = null; }
            if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
            // 激活窗口关闭后，重置激活中标志，允许fallbackTimer下次重新触发
            global.__licenseActivating = false;
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
                state.editionChosen = true;
                document.getElementById('editionPersonal').style.borderColor = (ed === 'personal' ? '#26a69a' : '#ddd');
                document.getElementById('editionPersonal').style.background = (ed === 'personal' ? '#26a69a' : '#fff');
                document.getElementById('editionInstitution').style.borderColor = (ed === 'institution' ? '#26a69a' : '#ddd');
                document.getElementById('editionInstitution').style.background = (ed === 'institution' ? '#26a69a' : '#fff');
                show('adminStepForm');
                setActiveTab('admin');
            });
        });

        // ★ 2026-08-23 三Tab：切Tab时双向同步已填信息（诊所名/姓名/电话），避免重复填写
        function syncSharedFieldsFrom(sourceTab) {
            // 字段映射：Tab1 管理员激活(admin) / Tab3 工单(ticket) 共享 诊所名+姓名+电话
            try {
                var srcName = '', srcContact = '', srcPhone = '', srcClinic = '';
                if (sourceTab === 'admin') {
                    srcClinic = (document.getElementById('adminClinicName').value || '').trim();
                    srcName = (document.getElementById('adminAdminName').value || '').trim();
                    srcPhone = (document.getElementById('adminPhone').value || '').trim();
                } else if (sourceTab === 'ticket') {
                    srcClinic = (document.getElementById('ticketClinicName').value || '').trim();
                    srcName = (document.getElementById('ticketContactName').value || '').trim();
                    srcPhone = (document.getElementById('ticketContactPhone').value || '').trim();
                }
                var targets = [];
                if (sourceTab !== 'admin') {
                    try {
                        var aC = document.getElementById('adminClinicName'); if (aC && srcClinic && !aC.value.trim()) aC.value = srcClinic; targets.push(aC);
                        var aN = document.getElementById('adminAdminName'); if (aN && srcName && !aN.value.trim()) aN.value = srcName; targets.push(aN);
                        var aP = document.getElementById('adminPhone'); if (aP && srcPhone && !aP.value.trim()) aP.value = srcPhone; targets.push(aP);
                    } catch (e) {}
                }
                if (sourceTab !== 'ticket') {
                    try {
                        var tC = document.getElementById('ticketClinicName'); if (tC && srcClinic && !tC.value.trim()) tC.value = srcClinic; targets.push(tC);
                        var tN = document.getElementById('ticketContactName'); if (tN && srcName && !tN.value.trim()) tN.value = srcName; targets.push(tN);
                        var tP = document.getElementById('ticketContactPhone'); if (tP && srcPhone && !tP.value.trim()) tP.value = srcPhone; targets.push(tP);
                    } catch (e) {}
                }
            } catch (e) {}
        }
        // ★ 2026-08-23 三Tab切换（对齐桌面 activate-window：管理员激活/激活码激活/工单申请）
        document.getElementById('adminTabBtnAdmin').addEventListener('click', function() {
            // ★ 2026-08-23 简化：从直达链接进入（跳过版本选择）时，Tab1 管理激活申请需版本信息，
            //   未选择版本则回到第一步让用户选择（避免以默认机构版提交非本意的申请）
            if (!state.editionChosen) { show('adminStepEdition'); return; }
            syncSharedFieldsFrom('ticket'); // 工单Tab填过的信息同步到管理员激活
            show('adminStepForm'); setActiveTab('admin');
        });
        // ★ 2026-08-23 简化：版本选择页直达链接（跳过版本选择，复用 Tab 切换逻辑）
        var skipCodeLink = document.getElementById('adminSkipToCode');
        if (skipCodeLink) skipCodeLink.addEventListener('click', function() {
            show('adminTabCode'); setActiveTab('code');
            setTimeout(function() { var i = document.getElementById('adminCodeInput'); if (i) i.focus(); }, 200);
        });
        var skipTicketLink = document.getElementById('adminSkipToTicket');
        if (skipTicketLink) skipTicketLink.addEventListener('click', function() {
            showTicketFormModal(machineId, (typeof CONFIG !== 'undefined' && CONFIG && CONFIG.clinicName) || '');
        });
        document.getElementById('adminTabBtnCode').addEventListener('click', function() {
            syncSharedFieldsFrom('admin'); // Tab1 填过的信息同步到工单（切Tab2也刷新一遍，防止工单已打开值陈旧）
            show('adminTabCode'); setActiveTab('code');
            setTimeout(function() { var i = document.getElementById('adminCodeInput'); if (i) i.focus(); }, 200);
        });
        // 工单申请：复用工单叠加层弹窗（showTicketFormModal，完整表单+提交+成功面板，z-index 更高天然覆盖）
        document.getElementById('adminTabBtnTicket').addEventListener('click', function() {
            syncSharedFieldsFrom('admin'); // Tab1 填过的信息同步到工单
            showTicketFormModal(machineId, state.clinicName || (typeof CONFIG !== 'undefined' && CONFIG && CONFIG.clinicName) || '');
        });

        // ★ Tab2 激活码激活：机器ID复制
        document.getElementById('adminCodeCopyMidBtn').addEventListener('click', async function() {
            const ok = await copyTextToClipboard(machineId || '');
            this.textContent = ok ? '✅ 已复制' : '❌ 失败';
            const btn = this;
            setTimeout(function() { btn.textContent = '复制'; }, 1500);
        });

        // ★ Tab2 激活码激活：立即激活
        document.getElementById('adminCodeSubmitBtn').addEventListener('click', async function() {
            const btn = this;
            const codeEl = document.getElementById('adminCodeInput');
            const hint = document.getElementById('adminCodeHint');
            const loading = document.getElementById('adminCodeLoading');
            const successBox = document.getElementById('adminCodeSuccess');
            const code = String(codeEl.value || '').trim().toUpperCase();
            // 前端格式校验（与 activateNow 流程同一正则）
            const codePattern = /^BNZC-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;
            if (!codePattern.test(code)) {
                hint.textContent = '⚠ 激活码格式不正确：BNZC-XXXX-XXXX-XXXX-XXXX（X 为大写字母或数字，不含 I/O/0/1）';
                hint.style.color = '#e53935';
                codeEl.style.borderColor = '#e53935';
                return;
            }
            hint.style.color = '#909399';
            hint.textContent = '💡 激活码格式：BNZC-XXXX-XXXX-XXXX-XXXX（X 为大写字母或数字，不含 I/O/0/1）';
            codeEl.style.borderColor = '#ddd';
            btn.disabled = true;
            btn.textContent = '⏳ 正在验证...';
            loading.style.display = 'block';
            successBox.style.display = 'none';
            try {
                let res = null;
                // 离线 APP（有本地激活桥）：走主进程 submit（validate+安装 license+重启）
                if (global.electronAPI && global.electronAPI.activate &&
                    typeof global.electronAPI.activate.submit === 'function') {
                    let user = '';
                    try {
                        user = (typeof CONFIG !== 'undefined' && CONFIG && CONFIG.doctorName) ? CONFIG.doctorName : '';
                    } catch (e) {}
                    // ★ 2026-09-03 根治修复（Mate70 案例）：Tab2 输码激活必须携带手机号+密码——
                    //   此前只传 (code, user)，Java 建的账号 username=医师名、无 phone、密码=admin
                    //   → 客户用手机号登录必然"用户名或密码错误"（Tab1 管理员激活带 phone 正常，
                    //   Tab2 是盲区）。手机号来源优先级：Tab1 已填（state/DOM）→ 凭码联网自愈识别。
                    let phoneVal = (state && state.phone) ? String(state.phone).trim() : '';
                    try {
                        const phEl = document.getElementById('adminPhone');
                        if (!phoneVal && phEl && phEl.value) phoneVal = String(phEl.value).trim();
                    } catch (e) {}
                    if (!/^1[3-9]\d{9}$/.test(phoneVal)) {
                        // 自愈：凭码+machineId 联网识别原激活绑定手机号（自动回填）
                        const d = await lookupBoundActivationInfo(code, machineId);
                        if (d && d.phone) phoneVal = String(d.phone).trim();
                    }
                    if (!/^1[3-9]\d{9}$/.test(phoneVal)) {
                        btn.disabled = false;
                        btn.textContent = '🚀 立即激活';
                        loading.style.display = 'none';
                        hint.textContent = '⚠ 请先在「管理员激活」页填写手机号（激活后用手机号登录），再回来输码激活';
                        hint.style.color = '#e53935';
                        try { alert('请先在「管理员激活」页填写手机号（11位）。\n\n激活后将使用「手机号 + 密码」登录。\n填写后返回本页输入激活码即可。'); } catch (e) {}
                        return;
                    }
                    const pwdVal = (state && state.password) ? String(state.password).trim() : '';
                    // ★ 按端区分传参（对齐 activateNow）：桌面 submit(code, user, clinicName, phone, password, edition, inviteCode)
                    //   APP submit(code, user, password, inviteCode)——手机号拼入 user 串由 Java 解析
                    const isDesktopTab2 = !!(global.electronAPI.activate.showExpireAlert &&
                        typeof global.electronAPI.activate.showExpireAlert === 'function');
                    if (isDesktopTab2) {
                        res = await global.electronAPI.activate.submit(code, user, (state && state.clinicName) || '', phoneVal, pwdVal || 'admin', undefined, '');
                    } else {
                        const userWithPhone = user ? (user.replace(/[/\-\s]+$/, '').trim() + '/' + phoneVal) : phoneVal;
                        res = await global.electronAPI.activate.submit(code, userWithPhone, pwdVal || 'admin', '');
                    }
                    if (res && res.success) {
                        // ★ 账号同步到前端 localStorage 用户表（不依赖重启后桥自愈时序，
                        //   与 onAdminActivated 同构：username=手机号）
                        try {
                            if (typeof window.addLocalActivationUser === 'function') {
                                window.addLocalActivationUser({
                                    username: phoneVal,
                                    phone: phoneVal,
                                    password: pwdVal || 'admin',
                                    name: user || phoneVal,
                                    role: 'admin',
                                    clinicName: (state && state.clinicName) || ''
                                });
                            }
                        } catch (e) {}
                        loading.style.display = 'none';
                        successBox.style.display = 'block';
                        document.getElementById('adminCodeSuccessDesc').innerHTML =
                            '授权已安装到本机<br>📱 登录账号：' + phoneVal +
                            '<br>🔑 登录密码：' + (pwdVal || 'admin（默认）') +
                            '<br>点击确定后应用将重启，请使用手机号登录';
                        btn.disabled = false;
                        btn.textContent = '🔄 重启应用';
                        btn.onclick = async function() {
                            if (global.electronAPI && global.electronAPI.activate &&
                                typeof global.electronAPI.activate.restart === 'function') {
                                try { setCloudActivationDone(); } catch (e2) {}
                                global.electronAPI.activate.restart();
                            }
                        };
                        return;
                    }
                } else {
                    // 云端 APP（无本地授权桥）：直接调云端 validate 验证激活码
                    const controller = new AbortController();
                    const t = setTimeout(function(){ try { controller.abort(); } catch(e){} }, 12000);
                    try {
                        const r = await fetch('https://tcm-prescription-system.pages.dev/api/license/validate', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                code: code,
                                machineId: machineId || 'unknown',
                                clinicName: state.clinicName || '',
                                productClass: 'app'
                            }),
                            signal: controller.signal
                        });
                        res = await r.json();
                    } finally { clearTimeout(t); }
                    if (res && res.success) {
                        loading.style.display = 'none';
                        successBox.style.display = 'block';
                        const li = res.licenseInfo || {};
                        document.getElementById('adminCodeSuccessDesc').innerHTML =
                            '激活码有效，已绑定本设备' + (li.clinicName ? '（' + li.clinicName + '）' : '') + '<br>' +
                            '云端账号开通请联系平台管理员确认<br>或使用已开通的手机号直接登录';
                        btn.disabled = false;
                        btn.textContent = '✅ 完成';
                        return;
                    }
                }
                // 失败：错误分类提示（复用 activateNow 的 formatActivateError）
                loading.style.display = 'none';
                btn.disabled = false;
                btn.textContent = '🚀 立即激活';
                const errMsg = (res && res.error) ? res.error : '激活失败，请稍后重试';
                hint.textContent = '⚠ ' + formatActivateError(errMsg).replace(/\n+/g, ' ');
                hint.style.color = '#e53935';
            } catch (e) {
                loading.style.display = 'none';
                btn.disabled = false;
                btn.textContent = '🚀 立即激活';
                hint.textContent = '⚠ 网络错误：' + ((e && e.message) ? e.message : '请检查网络连接');
                hint.style.color = '#e53935';
            }
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
                hint.textContent = '💡 云端登录密码固定为 admin，自定义密码不生效，登入后请自行修改密码';
                hint.style.color = '#e53935';
            } else if (pwd.length < 8 || !/[a-zA-Z]/.test(pwd) || !/\d/.test(pwd)) {
                hint.textContent = '⚠ 若自定义密码，需至少8位且包含字母和数字';
                hint.style.color = '#e53935';
            } else {
                hint.textContent = '✓ 密码强度：' + (pwd.length >= 12 ? '强' : '中等') + '（注意：云端登录密码固定为 admin，登入后请修改）';
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

        // ★ 2026-09-04 方案B 注册前置：已注册用户 Tab1 预填（诊所名/姓名/手机号/密码）
        //   注册时账号+密码已建好，激活只是纯 license 操作，不再重复收集。
        // ★ 2026-09-04 追加优化（用户反馈"激活页面未同步注册信息"）：
        //   ① 密码解密存 Promise（__regPwdPromise），下一步点击时 await——消除
        //      异步解密竞态（旧版解密未完成时 state.password 为空 → 误入密码步骤，
        //      观感即"注册信息没同步全"）；
        //   ② 预填后按钮语义改为「✅ 确认信息并提交」，顶部加同步提示条；
        //   ③ phoneHint 更新为注册密码提示（不再是"默认密码 admin"误导）。
        let __regPrefill = null;
        let __regPwdPromise = null;
        try {
            __regPrefill = getLocalRegistrationInfo();
            if (__regPrefill) {
                state.clinicName = String(__regPrefill.clinicName || '');
                state.adminName = String(__regPrefill.adminName || '');
                state.phone = String(__regPrefill.phone || '');
                // 密码源：注册密码（加密存 registrationInfo，弹窗打开即异步解密预置）——供
                // installAdminLicense 断点续传兜底建号/Tab2 输码使用；config 已有账号时
                // Java 端按"密码写点唯一化"保留注册密码不覆盖。
                try {
                    if (__regPrefill.passwordEnc) {
                        __regPwdPromise = decryptSensitive(__regPrefill.passwordEnc);
                        __regPwdPromise.then(function (p) {
                            if (p) state.password = String(p);
                        }).catch(function () {});
                    }
                } catch (de) {}
                const __cn = document.getElementById('adminClinicName');
                const __an = document.getElementById('adminAdminName');
                const __ph = document.getElementById('adminPhone');
                if (__cn && state.clinicName) __cn.value = state.clinicName;
                if (__an && state.adminName) __an.value = state.adminName;
                if (__ph && state.phone) __ph.value = state.phone;
                // ① 顶部同步提示条（插入 Tab1 表单首部，用户明确看到"已同步"）
                try {
                    const __formBox = document.getElementById('adminStepForm');
                    if (__formBox) {
                        const __tip = document.createElement('div');
                        __tip.style.cssText = 'background:#e8f5e9;border:1px solid #a5d6a7;border-radius:8px;padding:10px;margin-bottom:12px;font-size:12px;color:#2e7d32;line-height:1.7;';
                        __tip.innerHTML = '✅ 已自动同步注册开通时填写的信息（诊所名称/管理员姓名/联系电话）。<br>请核对无误后，点击下方「确认信息并提交」即可。';
                        __formBox.insertBefore(__tip, __formBox.firstChild);
                    }
                } catch (te) {}
                // ② 按钮语义：预填场景下"下一步"→"确认信息并提交"（方案B：点此直接提交，
                //    跳过密码步骤——注册时密码已建，激活不收密码）
                try {
                    const __btn = document.getElementById('adminToStep2Btn');
                    if (__btn) __btn.textContent = '✅ 确认信息并提交 →';
                } catch (be) {}
                // ③ 手机号提示更新（注册密码已设，不再提示"默认密码 admin"）
                try {
                    const __hint = document.getElementById('adminPhoneHint');
                    if (__hint) __hint.innerHTML = '💡 11位手机号为登录账号，登录密码为注册时设置的密码';
                } catch (he) {}
                console.log('[LicenseCheck] 检测到已注册，Tab1 表单已预填（手机号登录账号）');
            }
        } catch (re) { console.warn('[LicenseCheck] 注册预填失败(不影响激活):', re); }

        // 表单 → 密码
        // ★ 2026-09-04 async 化：等待注册密码解密 Promise（最长 1.5s race 兜底），
        //   消除"解密未完成 → state.password 空 → 误入密码步骤"竞态。
        document.getElementById('adminToStep2Btn').addEventListener('click', async function() {
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
            // ★ 2026-09-04 方案B：已注册用户跳过密码步骤（账号+密码注册时已建，
            //   激活不收密码）——直接进入提交。密码一致性由注册时校验保证。
            if (__regPrefill && __regPrefill.phone === phone) {
                // 等待注册密码解密（弹窗打开时异步启动）；解密失败/超时也不阻塞——
                // 已注册用户 config.json 已有注册账号+密码（Single-Writer 保留不覆盖），
                // state.password 仅兜底建号用，提交本身不依赖它。
                if (!state.password && __regPwdPromise) {
                    try {
                        const __p = await Promise.race([
                            __regPwdPromise,
                            new Promise(function (r) { setTimeout(function () { r(null); }, 1500); })
                        ]);
                        if (__p) state.password = String(__p);
                    } catch (e) {}
                }
                if (state.password) {
                    // 预填两个密码框：①提交处 pwd!==admin 时校验 pwd2 一致；
                    //   ②提交失败 showFormAndAlert 回到密码步骤时字段已就绪可直接重试
                    try {
                        const pEl = document.getElementById('adminPassword');
                        const p2El = document.getElementById('adminPassword2');
                        if (pEl) pEl.value = state.password;
                        if (p2El) p2El.value = state.password;
                    } catch (e) {}
                }
                show('adminSubmitting');
                document.getElementById('adminSubmitBtn').click();
                return;
            }
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
                // ★ 2026-09-03 产品模式：离线端必须标 'local'，服务端据此映射诊所 edition
                //   为 offline_personal/offline_clinic（旧值 'app' 是载体信息非产品模式，
                //   导致离线标准版审核后被错标 cloud_personal → 用户管理显示"网页云端标准版"）
                appMode: 'local',
                // ★ 2026-09-03 载体标识：桌面 Electron 有 electronAPI，离线APP WebView 无。
                //   服务端写入诊所记录，后台用户管理离线版显示"🖥️桌面·/📱APP·"载体
                // ★ 2026-09-03 载体判定修正：同 __dp（APP Java 桥也有 electronAPI.activate，
                //   须用桌面独有的 showExpireAlert 判定，否则 APP 被错标 desktop）
                appModeCarrier: (global.electronAPI && global.electronAPI.activate &&
                    typeof global.electronAPI.activate.showExpireAlert === 'function') ? 'desktop' : 'app',
                versionLabel: '本地' + (state.edition === 'institution' ? '机构版' : '标准版'),
                env: 'production'
            };
            // ★ password 不上传云端，仅本地安装时创建登录账号使用
            try {
                // ★ 2026-08-30 桌面版 CORS 铁律分流（KNOWLEDGE 第 8 章）：
                //   桌面 Electron 渲染进程为 file://（Origin: null），直连 fetch 云端 API 被
                //   CORS 拦截（静默 TypeError → 报"网络错误"）。离线桌面 preload 已有
                //   activate.submitAdminRequest IPC（主进程 fetch，无 CORS，且持久化 requestId）。
                //   离线APP（file:///android_asset，无 electronAPI）走 fetch——服务端 CORS 回退
                //   已对齐 users.js 放行 Origin: null。
                let res;
                if (global.electronAPI && global.electronAPI.activate &&
                    typeof global.electronAPI.activate.submitAdminRequest === 'function') {
                    res = await global.electronAPI.activate.submitAdminRequest(payload);
                } else {
                    const controller = new AbortController();
                    const t = setTimeout(function(){ try { controller.abort(); } catch(e){} }, 12000);
                    try {
                        const r = await fetch(ADMIN_SUBMIT_URL, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(payload),
                            signal: controller.signal
                        });
                        res = await r.json();
                    } finally { clearTimeout(t); }
                }

                if (res && res.success) {
                    document.getElementById('adminRequestNo').textContent = res.requestId;
                    document.getElementById('adminSavedPhone').textContent = state.phone;
                    show('adminWaiting');

                    // ★ 2026-09-03 (架构统一 P2 客户端收敛): 提交成功统一走 ActivationObserver
                    //   三通道持久化 + 0s 立即领码(shortCircuitResult) + 之后 5s 轮询兜底。
                    //   不再各写"StorageAdapter.setItem + 立即领码 + startPolling"三段代码，
                    //   这三段代码（offline/cloud 双份，今天算第 5 次改了）全下沉到 Observer。
                    if (currentActivationObserver) { try { currentActivationObserver.stop(); } catch(_) {} currentActivationObserver = null; }
                    const OBS = global.ObserveActivationStatus || (global.window && global.window.ObserveActivationStatus);
                    const useObserverNow = !!(OBS && typeof OBS === 'function');
                    if (!useObserverNow) {
                        // Observer 未加载 → 走旧 3 段代码（向后兼容，下一轮可删）
                        try {
                            const encPwd = await encryptSensitive(state.password || '');
                            if (!encPwd && (state.password || '').trim()) {
                                console.warn('[LicenseCheck] adminReqPending 密码加密失败，仍存 requestId/phone 但不存密码（恢复时密码退默认 admin）');
                            }
                            StorageAdapter.setItem('license:adminReqPending', JSON.stringify({
                                requestId: res.requestId,
                                phone: (state.phone || '').trim(),
                                adminName: (state.adminName || '').trim(),
                                clinicName: (state.clinicName || '').trim(),
                                passwordEnc: encPwd,
                                machineId: (typeof machineId !== 'undefined' && machineId) ? String(machineId) : '',
                                at: Date.now()
                            }));
                            // ★ Phase 2.2 FSM v2：客户端提交申请并付款成功 → PENDING_APPROVAL
                            try {
                                const _st = (res.status === 'pending_payment' || /unpaid|paying|待付款/.test(String(res.status || '')))
                                    ? _STATES.PENDING_PAYMENT
                                    : _STATES.PENDING_APPROVAL;
                                setStateV2(_st, { requestId: res.requestId, phone: String(state.phone || '').trim(), adminName: String(state.adminName || '').trim(), clinicName: String(state.clinicName || '').trim(), prevState: (await getLicenseStateV2()).state });
                            } catch (_fsmerr) { console.warn('[FSM v2] setState pending err:', _fsmerr); }
                        } catch (pe) { console.warn('[LicenseCheck] adminReqPending 持久化失败(不影响提交):', pe); }
                        if (res.status === 'activated' && res.license) {
                            clearInterval(pollTimer); pollTimer = null;
                            console.log('[LicenseCheck] admin-submit 已返回 activated+license，立即领码（不等 startPolling 5s 延迟）');
                            try { await onAdminActivated(res, res.requestId); } catch (ae) {
                                console.warn('[LicenseCheck] 立即领码异常，退回 startPolling 兜底:', ae.message);
                                startPolling(res.requestId);
                            }
                        } else {
                            startPolling(res.requestId);
                        }
                    } else {
                        currentActivationObserver = OBS({
                            requestId: res.requestId,
                            machineId: typeof machineId !== 'undefined' ? machineId : '',
                            phone: (state.phone || '').trim(),
                            apiBase: ADMIN_STATUS_URL.replace('/admin-status', ''),
                            shortCircuitResult: res,   // 若 res.status=activated → 0s 立即 emit activated
                            persistPending: true,
                            pollIntervalMs: 5000,
                            maxPolls: 120,
                            // adminReqPending password → observer 内部加密存三通道
                            password: state.password || '',
                            adminName: (state.adminName || '').trim(),
                            clinicName: (state.clinicName || '').trim(),
                            edition: state.edition || '',
                            fetchAdminStatus: async function (url, params) {
                                if (global.electronAPI && global.electronAPI.activate &&
                                    typeof global.electronAPI.activate.checkAdminStatus === 'function') {
                                    return global.electronAPI.activate.checkAdminStatus(params.requestId || '', params.machineId || '');
                                }
                                try {
                                    const resp = await fetch(url, { method:'GET', headers:{'Content-Type':'application/json'} });
                                    return await resp.json().catch(() => null);
                                } catch (e) { console.warn('[activation-observer offline submit] fetch err', e); return null; }
                            }
                        });
                        const statusEl = document.getElementById('adminWaitStatus');
                        const msgs = ['正在等待管理员审核...','管理员正在处理您的请求...','正在验证您的信息...','即将完成激活...'];
                        pollCount = 0;
                        currentActivationObserver.on('status-change', function (s) {
                            pollCount++;
                            if (statusEl) statusEl.textContent = msgs[Math.min(Math.floor(pollCount/3), msgs.length-1)] +
                                (pollCount > 3 ? '（已等待 ' + Math.floor(pollCount*5/60) + ' 分钟）' : '') +
                                (s === 'pending_payment' ? ' [等待付款确认]' : '');
                        });
                        currentActivationObserver.on('activated', async function (payload) {
                            try { await onAdminActivated(payload, payload.requestId || res.requestId); } catch (ae) {
                                console.warn('[activation-observer offline submit] onActivated异常（仍继续轮询15s兜底）:', ae);
                            }
                        });
                        currentActivationObserver.on('terminal', function (s, payload) {
                            if (s === 'rejected') {
                                document.getElementById('adminRejectReason').textContent = (payload && payload.reason) || '未知原因';
                                show('adminRejected');
                            }
                        });
                        currentActivationObserver.start();
                        pollTimer = 0;  // 兼容旧代码 clearInterval(pollTimer) 安全
                    }
                } else {
                    btn.disabled = false;
                    const msg = (res && res.error) ? res.error : '提交失败，请重试';
                    // ★ 2026-09-02 支付前置校验：未完成支付 → 展示"请完成支付"面板引导官网付款
                    if (res && res.code === 'PAYMENT_REQUIRED') {
                        // ★ 2026-09-04 P0 断点闭环：支付拦截也要持久化断点信息（无 requestId，
                        //   仅 phone/machineId/密码）——官网订单的 requestId 客户端不持有，
                        //   付款+管理员审核通过后切回 APP，resumeAdminPendingRequest 凭
                        //   machineId 自救查询（admin-status machineId-only 模式）才能检测
                        //   到已激活。否则前台化三重触发全部空转，客户重复付款也永远等不到
                        //   激活（现场实锤 13398628215 连付 3 次仍登录失败）。
                        try {
                            const encPwdPr = await encryptSensitive(state.password || '');
                            await StorageAdapter.setItem('license:adminReqPending', JSON.stringify({
                                requestId: '',
                                phone: (state.phone || '').trim(),
                                adminName: (state.adminName || '').trim(),
                                clinicName: (state.clinicName || '').trim(),
                                passwordEnc: encPwdPr,
                                machineId: (typeof machineId !== 'undefined' && machineId) ? String(machineId) : '',
                                awaitingPayment: true,
                                at: Date.now()
                            }));
                        } catch (pe) { console.warn('[LicenseCheck] PAYMENT_REQUIRED 断点持久化失败(不影响付款指引):', pe); }
                        show('adminPayRequired');
                    } else {
                        showFormAndAlert(msg);
                    }
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

        // 轮询（machineId 兜底：官网订单付款激活后本机自动检测到）
        // ★ 2026-09-03 (架构统一 P2 客户端收敛): startPolling 兼容外壳；内部创建
        //   ActivationObserver 统一委托：0s 立即 poll → 之后 5s 间隔 →
        //   cancelled+有 machineId fallback 自救 → 三通道 resume/persist。
        //   旧实现 setInterval(pollTimer) 不再直接用，observer 内部统一调度 pollCount。
        function startPolling(requestId) {
            if (currentActivationObserver) { try { currentActivationObserver.stop(); } catch (_) {} currentActivationObserver = null; }
            const statusEl = document.getElementById('adminWaitStatus');
            const msgs = ['正在等待管理员审核...','管理员正在处理您的请求...','正在验证您的信息...','即将完成激活...'];
            pollCount = 0;
            const OBS = global.ObserveActivationStatus || (global.window && global.window.ObserveActivationStatus);
            if (!OBS) {
                console.warn('[LicenseCheck] ActivationObserver 未加载，退回旧 startPolling setInterval 兜底');
                pollTimer = setInterval(async function() {
                    pollCount++;
                    if (statusEl) statusEl.textContent = msgs[Math.min(Math.floor(pollCount/3), msgs.length-1)] + (pollCount>3 ? '（已等待 ' + Math.floor(pollCount*5/60) + ' 分钟）' : '');
                    let r = null;
                    try {
                        if (global.electronAPI && global.electronAPI.activate && typeof global.electronAPI.activate.checkAdminStatus === 'function') {
                            r = await global.electronAPI.activate.checkAdminStatus(requestId, machineId || '');
                        } else {
                            let statusUrl = ADMIN_STATUS_URL + '?requestId=' + encodeURIComponent(requestId);
                            if (machineId) statusUrl += '&machineId=' + encodeURIComponent(machineId);
                            r = await fetch(statusUrl, {method:'GET',headers:{'Content-Type':'application/json'}}).then(resp => resp.json());
                        }
                    } catch (err) { console.warn('[LicenseCheck] admin-status 网络错误:', err); }
                    if (r && r.success && r.status === 'activated') { clearInterval(pollTimer); pollTimer=null; await onAdminActivated(r, requestId); }
                    else if (r && r.success && r.status === 'rejected') { clearInterval(pollTimer); pollTimer=null; document.getElementById('adminRejectReason').textContent = r.reason || '未知原因'; show('adminRejected'); }
                    if (pollCount >= 120) { clearInterval(pollTimer); pollTimer=null; if (statusEl) statusEl.textContent = '⏰ 等待时间较长，管理员可能还在处理\n关闭窗口不影响审核'; }
                }, 5000);
                return;
            }
            // 新 ActivationObserver 统一委托
            currentActivationObserver = OBS({
                requestId: requestId,
                machineId: typeof machineId !== 'undefined' ? machineId : '',
                phone: (state.phone || '').trim(),
                apiBase: ADMIN_STATUS_URL.replace('/admin-status', ''),
                persistPending: true,
                pollIntervalMs: 5000,
                maxPolls: 120,
                password: state.password || '',
                adminName: (state.adminName || '').trim(),
                clinicName: (state.clinicName || '').trim(),
                // ★ KNOWLEDGE 第 8 章 desktop CORS 铁律：electron 渲染进程 file:// 走 IPC
                fetchAdminStatus: async function (url, params) {
                    if (global.electronAPI && global.electronAPI.activate &&
                        typeof global.electronAPI.activate.checkAdminStatus === 'function') {
                        return global.electronAPI.activate.checkAdminStatus(params.requestId || '', params.machineId || '');
                    }
                    try {
                        const resp = await fetch(url, { method:'GET', headers:{'Content-Type':'application/json'} });
                        return await resp.json().catch(() => null);
                    } catch (e) { console.warn('[activation-observer offline] fetch err', e); return null; }
                }
            });
            currentActivationObserver.on('status-change', function (s /*, p */) {
                pollCount++;
                if (statusEl) {
                    statusEl.textContent = msgs[Math.min(Math.floor(pollCount/3), msgs.length-1)] +
                        (pollCount > 3 ? '（已等待 ' + Math.floor(pollCount*5/60) + ' 分钟）' : '') +
                        (s === 'pending_payment' ? ' [等待付款确认]' : '');
                }
            });
            currentActivationObserver.on('activated', async function (payload) {
                try { await onAdminActivated(payload, payload.requestId || requestId); } catch (ae) {
                    console.warn('[activation-observer offline] onActivated err', ae);
                }
            });
            currentActivationObserver.on('terminal', function (s, payload) {
                if (s === 'rejected') {
                    document.getElementById('adminRejectReason').textContent = (payload && payload.reason) || '未知原因';
                    show('adminRejected');
                }
            });
            // Observer 启动时自动 0s 立即 poll（不再等待 setInterval 首 5s）→ 对 startPolling 传进来的
            // requestId 也能 0s 就拉 admin-status → activated 也立即领到号
            currentActivationObserver.start();
            // 兼容旧代码 clearInterval(pollTimer) 的调用：使 pollTimer 指向一个伪句柄
            // clearInterval 对非数字值不抛错（旧代码 L3727 L4129 等调用处安全）
            pollTimer = 0;
        }

        async function onAdminActivated(r, requestId) {
            // ★ Phase 2.2 FSM v2 节点同步：admin-status 轮询回调 activated → 进入本地 license 安装阶段
            try {
                const prev = await getLicenseStateV2();
                await setStateV2(_STATES.ACTIVATED_INSTALLING, { prevState: prev.state || '', requestId: requestId || '', licenseMessage: r ? String(r.message || '') : '' });
            } catch (_fsm) { console.warn('[FSM v2] onAdminActivated setState err:', _fsm); }
            // ★ 2026-08-22 修复：激活成功即统一设置标记并隐藏登录框注册入口。
            //   原实现仅"无本地安装桥"分支（云端APP）设置，桌面安装分支（installAdminLicense）
            //   漏设 → 激活成功的桌面设备重启后，登录框"📝 注册开通"按钮重现，误导已开通用户
            //   （新客户A实测：注册→审核→激活→登录全通过，退出登录后注册按钮重现，实锤此漏）。
            //   此调用在 localStorage 写入，配合 restartApp 改 app.quit() 优雅退出确保落盘。
            setCloudActivationDone();
            hideActivateLoginEntry();

            // ★ 2026-09-03 恢复场景参数兜底（已付款客户"激活付款成功却登录不上"根因修复）：
            //   轮询断点续传/启动恢复时 state 为空会话 → 手机号/密码全空 → 建号被跳过。
            //   取值优先级：state（同会话激活窗口填的）→ 持久化 adminReqPending（提交时存的）
            //   → 服务端 r.licenseInfo.phone（admin-status 2026-09-03 起返回权威手机号）。
            // ★ 2026-09-03 安全：持久化 password 用 passwordEnc（加密），必须 decryptSensitive；
            //   兼容旧明文 password 字段（客户升级中间态），读取空或解密失败退 admin。
            let _resPhone = (state.phone || '').trim();
            let _resName = (state.adminName || '').trim();
            let _resPwd = state.password || '';
            let _resClinic = (state.clinicName || '').trim();
            if (!_resPhone || !_resPwd) {
                try {
                    const _saved = JSON.parse((await StorageAdapter.getItem('license:adminReqPending')) || 'null');
                    if (_saved && typeof _saved === 'object') {
                        if (!_resPhone && _saved.phone) _resPhone = String(_saved.phone).trim();
                        if (!_resPwd && typeof _saved.passwordEnc === 'string' && _saved.passwordEnc) {
                            _resPwd = await decryptSensitive(_saved.passwordEnc);
                        }
                        if (!_resPwd && typeof _saved.password === 'string') {
                            _resPwd = String(_saved.password); // 兼容老明文（过渡）
                        }
                        if (!_resName && _saved.adminName) _resName = String(_saved.adminName).trim();
                        if (!_resClinic && _saved.clinicName) _resClinic = String(_saved.clinicName).trim();
                    }
                } catch (se) { console.warn('[LicenseCheck] onAdminActivated 读取持久化申请失败(兜底跳过):', se); }
            }
            if (!_resPhone && r && r.licenseInfo && r.licenseInfo.phone) {
                _resPhone = String(r.licenseInfo.phone).trim();
            }

            // ★ 2026-08-24 关键修复：无条件把"管理员激活提交的手机号/密码/姓名"同步到前端本地用户表
            //   根因：离线系(APP/桌面)登录校验 getUsers() 只读 localStorage.local_systemUsers；
            //   Java/Electron installAdminLicense 只是把手机号账号写入本地 config，WebView 登录页面读不到 → 登录必然失败。
            //   无论是否有本地安装桥、无论是否成功写入本地 license，本同步都必须执行（形成完整闭环）。
            //   对应 KNOWLEDGE §2.1 已有教训：onAdminActivated 必须无条件同步手机号账号。
            // ★ 2026-08-24 二次修正（客户实测仍登录失败）：
            //   密码必须用用户在激活弹窗自设的 state.password（空则 admin）！
            //   离线APP登录是【纯本地校验】（localStorage 明文/PBKDF2 兼容比对），不查后端；
            //   Java 层 installAdminLicense 也是把 state.password 写进 config.json users。
            //   上一版固定写 'admin' 导致用户用自设密码（如 admin123）登录必然失败。
            //   仅"无本地安装桥"（云端APP，登录走云端API，后端归一化密码=admin）才固定 'admin'。
            try {
                if (typeof window.addLocalActivationUser === 'function') {
                    const uPhone = _resPhone;
                    const uName = _resName;
                    const hasInstallBridge = !!(global.electronAPI && global.electronAPI.activate &&
                        typeof global.electronAPI.activate.installAdminLicense === 'function');
                    const effPwd = hasInstallBridge ? (_resPwd || 'admin') : 'admin';
                    if (uPhone || uName) {
                        window.addLocalActivationUser({
                            username: uPhone || uName,
                            phone: uPhone,
                            password: effPwd,
                            name: uName || uPhone || '管理员',
                            role: 'admin',
                            clinicName: _resClinic
                        });
                        console.log('[LicenseCheck] onAdminActivated: 账号同步到localStorage用户表',
                                    'username=', uPhone || uName, 'phone=', uPhone, '来源=state/持久化/服务端兜底',
                                    'password=', hasInstallBridge ? (_resPwd || 'admin') : 'admin(云端固定)');
                    } else {
                        console.warn('[LicenseCheck] onAdminActivated: 手机号/姓名均缺失，无法同步账号（恢复兜底也未取到 phone）');
                    }
                } else {
                    console.warn('[LicenseCheck] onAdminActivated: window.addLocalActivationUser 未定义，手机号账号未同步到前端用户表！可能导致登录失败。');
                }
            } catch (e) {
                console.error('[LicenseCheck] onAdminActivated: addLocalActivationUser 异常:', e);
            }

            const license = r.license || '';
            const phone = _resPhone || (state.phone || '');
            // ★ 2026-08-29 邀请码自愈：管理员激活时服务端已返回真实激活码（admin-status
            //   licenseInfo.licenseCode，admin-approve 生成并绑定本机），此处必须存入本地，
            //   否则 loadInviteInfo 三来源取码全空 → 邀请码卡片永远显示"未找到激活码记录"。
            const adminLicenseCode = (r.licenseInfo && r.licenseInfo.licenseCode) ?
                String(r.licenseInfo.licenseCode).trim() : '';
            if (adminLicenseCode && adminLicenseCode.length >= 4) {
                try {
                    await StorageAdapter.setItem('license:code', adminLicenseCode);
                    if (global.electronAPI && global.electronAPI.license &&
                        typeof global.electronAPI.license.getMachineId === 'function') {
                        const mid = await global.electronAPI.license.getMachineId();
                        if (mid) await StorageAdapter.setItem('license:machineId', String(mid));
                    }
                    await StorageAdapter.removeItem('license:lastHeartbeat');
                    await StorageAdapter.removeItem('license:offlineStart');
                } catch (ce) {
                    console.warn('[LicenseCheck] 管理员激活存储激活码失败(不影响激活):', ce);
                }
            }
            const descEl = document.getElementById('adminSuccessDesc');
            document.getElementById('adminSuccessPhone').textContent = phone;
            // 离线 APP：本地安装 license + 重启；云端 APP（无 installAdminLicense）：账号已在云端创建，提示登录
            if (global.electronAPI && global.electronAPI.activate &&
                typeof global.electronAPI.activate.installAdminLicense === 'function' && license) {
                try {
                    // ★ 2026-09-03 恢复场景兜底：adminName/clinicName/password 优先 state，
                    //   空则用持久化/服务端兜底值（_res*），确保断点续传激活也建「手机号+自设密码」账号
                    const inst = await global.electronAPI.activate.installAdminLicense({
                        license: license,
                        adminName: _resName || state.adminName,
                        clinicName: _resClinic || state.clinicName,
                        password: _resPwd || state.password || 'admin',
                        phone: phone,
                        licenseCode: adminLicenseCode
                    });
                    // ★ 2026-09-04 P0 加固：installAdminLicense 成功后立即 JS 侧自验 license，
                    //   防止某些机型（如华为 P40）Java 层已覆盖 success=false 但 JS 层仍走到
                    //   这里继续显示"激活成功"的分支；自验同时覆盖 Java 桥偶发返回 success=true
                    //   但实际 license.dat 验签失败的情况。
                    let selfVerified = false;
                    try {
                        if (global.electronAPI && global.electronAPI.license &&
                            typeof global.electronAPI.license.validate === 'function') {
                            const v = await global.electronAPI.license.validate();
                            selfVerified = !!(v && v.valid);
                            if (!selfVerified) console.warn('[LicenseCheck] JS 侧自验失败:', v);
                        }
                    } catch (ve) { console.warn('[LicenseCheck] JS 侧自验异常:', ve); }
                    const ok = !!(inst && inst.success && selfVerified);
                    if (ok) {
                        descEl.innerHTML = '管理员已通过您的激活申请<br>软件即将重启，请使用手机号登录';
                        show('adminSuccess');
                        const __restartApp = function () {
                            if (global.electronAPI && global.electronAPI.activate && global.electronAPI.activate.restart) {
                                try { global.electronAPI.activate.restart(); } catch(e){}
                            }
                        };
                        document.getElementById('adminSuccessBtn').textContent = '🔄 立即重启';
                        document.getElementById('adminSuccessBtn').onclick = __restartApp;
                        // ★ 2026-09-04 P0 加固：1.5s 后自动重启（小白用户激活成功后常会等界面自动跳转，
                        //   手动点"重启应用"是认知负担——自动触发消除"激活成功但忘记重启→Java层仍invalid"死循环）
                        // ★ AR-02 修复：tid 保存到闭包变量 __autoRestartTid，cleanup() 关闭弹窗时会 cancel
                        //   （否则用户 1.5s 窗口内点击关闭/重试另一流程，仍会触发重启→"我没点重启怎么就重启了"）
                        __autoRestartTid = setTimeout(__restartApp, 1500);
                        // ★ 2026-09-03 激活领码成功：清除 adminReqPending 持久化（断点续传完成）
                        try { StorageAdapter.removeItem('license:adminReqPending'); } catch (ce2) {}
                        // ★ Phase 2.2 FSM v2 节点同步：激活成功+本地账号同步完成 → ACTIVATED_READY
                        try {
                            const prev = await getLicenseStateV2();
                            await setStateV2(_STATES.ACTIVATED_READY, { prevState: prev.state || '', activatedAt: Date.now(), requestId: requestId || '' });
                        } catch (_fsm) { console.warn('[FSM v2] onAdminActivated ready setState err:', _fsm); }
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
                // ★ 2026-08-22 setCloudActivationDone/hideActivateLoginEntry 已移至本函数开头统一执行
            }
        }

        document.getElementById('adminRetryBtn').addEventListener('click', function() { show('adminStepEdition'); });
        // ★ 官网快速付费导引：直达官网购买页（携带本机 machineId 自动预填设备识别码）
        (function bindAdminPayGuide() {
            const btn = document.getElementById('adminPayGuideBtn');
            if (!btn) return;
            btn.addEventListener('click', function() {
                // ★ 2026-09-02 改用 openPayUrlRobust（原 window.open/catch fallback 在
                //   WebView 静默 null 场景全链路无反馈，详见函数头注释）
                // ★ 2026-09-03 修复「点击无反应」：editionIntent 是 showTicketFormModal 的
                //   局部变量（复制代码时误带入），本函数作用域不存在 → 点击时 ReferenceError
                //   静默中断，openPayUrlRobust 永远不执行。改用本函数的 state.edition。
                var __edParam = (state.edition === 'institution') ? 'local-pro' : (state.edition === 'personal' ? 'local-personal' : '');
                // ★ 2026-09-03 dp=载体（desktop/app）：官网下单沿 URL 传入 order-submit
                // ★ 2026-09-03 载体判定修正：APP Java 桥也有 electronAPI.activate，
                //   须用桌面独有的 showExpireAlert 判定，否则 APP 被错标 desktop
                // ★ 2026-09-04 流程优化：携带管理员激活表单已填信息(cn=诊所名/n=管理员/p=手机号/r=备注)
                //   → 官网购买页自动回填，避免重复填；管理员激活无微信号字段，custWechat 留空。
                var __dp1 = (global.electronAPI && global.electronAPI.activate &&
                    typeof global.electronAPI.activate.showExpireAlert === 'function') ? 'desktop' : 'app';
                var __cn1 = (document.getElementById('adminClinicName') || {}).value || (state.clinicName || '');
                var __n1  = (document.getElementById('adminAdminName') || {}).value || (state.adminName || '');
                var __p1  = (document.getElementById('adminPhone') || {}).value || (state.phone || '');
                var __r1  = (document.getElementById('adminRemark') || {}).value || (state.remark || '');
                const url = 'https://tcm-prescription-system.pages.dev/download.html?mid=' + encodeURIComponent(machineId || '')
                    + (__edParam ? ('&ed=' + __edParam) : '') + '&dp=' + __dp1
                    + (__cn1 ? ('&cn=' + encodeURIComponent(__cn1)) : '')
                    + (__n1  ? ('&n='  + encodeURIComponent(__n1))  : '')
                    + (__p1  ? ('&p='  + encodeURIComponent(__p1))  : '')
                    + (__r1  ? ('&r='  + encodeURIComponent(__r1))  : '');
                openPayUrlRobust(url, btn);
            });
        })();
        // ★ 2026-09-02 支付前置校验配套：adminPayRequired 面板按钮绑定
        (function bindAdminPayRequired() {
            const btn = document.getElementById('adminPayRequiredBtn');
            if (!btn) return;
            btn.addEventListener('click', function() {
                // ★ 2026-09-03 修复「点击无反应」：同上，editionIntent 越界引用改 state.edition
                var __edParam = (state.edition === 'institution') ? 'local-pro' : (state.edition === 'personal' ? 'local-personal' : '');
                // ★ 2026-09-03 dp=载体（desktop/app）：官网下单沿 URL 传入 order-submit
                // ★ 2026-09-03 载体判定修正：APP Java 桥也有 electronAPI.activate，
                //   须用桌面独有的 showExpireAlert 判定，否则 APP 被错标 desktop
                // ★ 2026-09-04 流程优化：同 bindAdminPayGuide 传 cn/n/p/r → 官网回填
                var __dp2 = (global.electronAPI && global.electronAPI.activate &&
                    typeof global.electronAPI.activate.showExpireAlert === 'function') ? 'desktop' : 'app';
                var __cn2 = (document.getElementById('adminClinicName') || {}).value || (state.clinicName || '');
                var __n2  = (document.getElementById('adminAdminName') || {}).value || (state.adminName || '');
                var __p2  = (document.getElementById('adminPhone') || {}).value || (state.phone || '');
                var __r2  = (document.getElementById('adminRemark') || {}).value || (state.remark || '');
                const url = 'https://tcm-prescription-system.pages.dev/download.html?mid=' + encodeURIComponent(machineId || '')
                    + (__edParam ? ('&ed=' + __edParam) : '') + '&dp=' + __dp2
                    + (__cn2 ? ('&cn=' + encodeURIComponent(__cn2)) : '')
                    + (__n2  ? ('&n='  + encodeURIComponent(__n2))  : '')
                    + (__p2  ? ('&p='  + encodeURIComponent(__p2))  : '')
                    + (__r2  ? ('&r='  + encodeURIComponent(__r2))  : '');
                openPayUrlRobust(url, btn);
            });
            const back = document.getElementById('adminPayRequiredBackBtn');
            if (back) back.addEventListener('click', function() { show('adminStepForm'); });
        })();
        document.getElementById('adminCopyMidBtn').addEventListener('click', async function() {
            const ok = await copyTextToClipboard(machineId || '');
            const b = document.getElementById('adminCopyMidBtn');
            b.textContent = ok ? '✅' : '❌';
            setTimeout(function(){ b.textContent = '复制'; }, 1200);
        });
        document.getElementById('adminCloseBtn').addEventListener('click', cleanup);
        overlay.addEventListener('click', function(e) { if (e.target === overlay) cleanup(); });

        // 预填诊所名（config 提供时）——★ 2026-09-05 修复：改为"仅空时兜底"。
        //   旧版无条件覆盖，把 registrationInfo 已预填的注册诊所名冲成内存 CONFIG
        //   出厂值（如"XXX中医诊所"），造成"诊所名称未同步而姓名/电话正常"的非对称症状。
        try {
            const __cc = document.getElementById('adminClinicName');
            if (clinicName && __cc && !__cc.value.trim()) {
                __cc.value = clinicName;
                if (!state.clinicName) state.clinicName = clinicName;
            }
        } catch (ce) {}
    }

    // ★ 2026-09-03 管理员激活断点续传：启动时检测持久化申请是否已审核通过并自动完成领码。
    //   场景：客户提交激活申请 → 去官网付款时 APP 切后台被杀/窗口关闭 → 轮询中断 →
    //   管理员审核通过但客户端从未领码（license 未装、账号未建）→ 客户付款成功却登录失败。
    //   恢复：读 license:adminReqPending（提交时持久化的 requestId+phone+password）→ 查询
    //   admin-status（带 machineId 官网订单兜底）→ 已 activated 则自动装 license+建账号。
    //   独立实现（不复用 showAdminActivateModal 内的 onAdminActivated——其弹窗 DOM 是打开
    //   激活窗口时才注入的，重启后不存在）。
    async function _resumeCompleteActivation(r, saved) {
        var phone = (saved && saved.phone) ? String(saved.phone).trim() : '';
        var rPhone = (r && r.licenseInfo && r.licenseInfo.phone) ? String(r.licenseInfo.phone).trim() : '';
        if (!phone && rPhone) phone = rPhone;
        // ★ 2026-09-03 安全：saved.passwordEnc 加密读；兼容旧明文 saved.password；空退默认 admin
        var pwd = '';
        try {
            if (saved && typeof saved.passwordEnc === 'string' && saved.passwordEnc) {
                pwd = await decryptSensitive(saved.passwordEnc);
            }
            if (!pwd && saved && typeof saved.password === 'string') pwd = String(saved.password || '');
        } catch (e) { pwd = ''; }
        var adminName = (saved && saved.adminName) ? String(saved.adminName || '').trim() : '';
        var clinicName = (saved && saved.clinicName) ? String(saved.clinicName || '').trim() : '';
        var adminLicenseCode = (r && r.licenseInfo && r.licenseInfo.licenseCode) ?
            String(r.licenseInfo.licenseCode).trim() : '';

        // ① localStorage 建号（username=手机号，password=激活弹窗自设密码）
        try {
            if ((phone || adminName) && typeof global.addLocalActivationUser === 'function') {
                global.addLocalActivationUser({
                    username: phone || adminName,
                    phone: phone,
                    password: pwd || 'admin',
                    name: adminName || phone || '管理员',
                    role: 'admin',
                    clinicName: clinicName
                });
                console.log('[LicenseCheck] 断点续传: 账号已同步到localStorage用户表 username=', phone || adminName);
            }
        } catch (e) { console.warn('[LicenseCheck] 断点续传建号异常:', e); }

        // ② 存激活码（邀请码自愈同款）
        if (adminLicenseCode && adminLicenseCode.length >= 4) {
            try {
                await StorageAdapter.setItem('license:code', adminLicenseCode);
                await StorageAdapter.removeItem('license:lastHeartbeat');
                await StorageAdapter.removeItem('license:offlineStart');
            } catch (ce) { console.warn('[LicenseCheck] 断点续传存储激活码失败:', ce); }
        }

        // ③ 装 license + 建 config 账号（Java/Electron 桥）
        var license = (r && r.license) ? r.license : '';
        var installed = false;
        if (global.electronAPI && global.electronAPI.activate &&
            typeof global.electronAPI.activate.installAdminLicense === 'function' && license) {
            try {
                var inst = await global.electronAPI.activate.installAdminLicense({
                    license: license,
                    adminName: adminName,
                    clinicName: clinicName,
                    password: pwd || 'admin',
                    phone: phone,
                    licenseCode: adminLicenseCode
                });
                // ★ 2026-09-04 P0 加固：同 onAdminActivated 双层判定
                //   Java 层自验已覆盖 success=false（见 MainActivity.java installAdminLicense），
                //   JS 侧再 validate() 一次兜底（某些机型桥返回 success=true 但 license 已坏）
                var selfVerified = false;
                try {
                    if (global.electronAPI && global.electronAPI.license &&
                        typeof global.electronAPI.license.validate === 'function') {
                        var v = await global.electronAPI.license.validate();
                        selfVerified = !!(v && v.valid);
                        if (!selfVerified) console.warn('[LicenseCheck] 断点续传 JS 侧自验失败:', v);
                    }
                } catch (ve) {}
                installed = !!(inst && inst.success && selfVerified);
            } catch (e) {
                console.warn('[LicenseCheck] 断点续传安装license异常:', e);
            }
        } else {
            installed = true; // 云端APP：账号在云端创建，无本地安装桥
        }

        // ④ 成功收尾：清持久化 + 标记激活完成 + 提示重启/登录
        try { setCloudActivationDone(); } catch (e2) {}
        try { hideActivateLoginEntry(); } catch (e2) {}
        try { await StorageAdapter.removeItem('license:adminReqPending'); } catch (ce2) {}
        // ★ Phase 2.2 FSM v2 节点同步：断点续传成功收尾 → activated_installing → ready / failed → unactivated
        try {
            const prev = await getLicenseStateV2();
            if (installed) {
                await setStateV2(_STATES.ACTIVATED_READY, { prevState: prev.state || '', activatedAt: Date.now(), source: 'resumeActivation' });
            } else if (prev.state === _STATES.ACTIVATED_INSTALLING || prev.state === _STATES.PENDING_APPROVAL) {
                await setStateV2(_STATES.UNACTIVATED, { prevState: prev.state || '', lastError: '断点续传本地写入失败，需重新提交激活' });
            }
        } catch (_fsm) { console.warn('[FSM v2] resume complete setState err:', _fsm); }
        if (installed) {
            var msg = '您的激活申请已审核通过，授权已自动安装到本机。\n\n' +
                (phone ? ('📱 登录账号：' + phone + '\n') : '') +
                '🔑 登录密码：' + (pwd || 'admin（默认）') + '\n\n' +
                '请' + (global.electronAPI && global.electronAPI.activate &&
                    typeof global.electronAPI.activate.installAdminLicense === 'function'
                    ? '重启应用后使用手机号登录' : '返回登录框使用手机号登录') + '。';
            try { alert(msg); } catch (e) { console.log(msg); }
        } else {
            try { alert('激活已通过，但本地写入失败。请打开「管理员激活」重新提交手机号即可自动完成激活。'); } catch (e) {}
        }
    }

    function resumeAdminPendingRequest() {
        try {
            StorageAdapter.getItem('license:adminReqPending').then(function (savedRaw) {
                if (!savedRaw) return;
                var saved = null;
                try { saved = JSON.parse(savedRaw); } catch (e) { return; }
                if (!saved) return;
                // ★ 2026-09-04 machineId 自救：PAYMENT_REQUIRED 断点无 requestId（官网订单
                //   持有），凭本机 machineId 调 admin-status 自救模式检测本设备是否已激活。
                if (!saved.requestId) {
                    if (!saved.machineId || String(saved.machineId).length < 8) return;
                    // 30 天过期：从未完成付款的陈旧断点静默清理，不再无限查询
                    if (saved.at && (Date.now() - saved.at > 30 * 24 * 3600 * 1000)) {
                        try { StorageAdapter.removeItem('license:adminReqPending'); } catch (e2) {}
                        return;
                    }
                    var murl = ADMIN_STATUS_URL + '?machineId=' + encodeURIComponent(saved.machineId);
                    fetch(murl, { method: 'GET', headers: { 'Content-Type': 'application/json' } })
                        .then(function (resp) { return resp.json(); })
                        .then(function (r) {
                            if (r && r.success && r.status === 'activated') {
                                console.log('[LicenseCheck] machineId 自救：本设备已激活，自动完成领码');
                                _resumeCompleteActivation(r, saved).catch(function (ae) {
                                    console.warn('[LicenseCheck] machineId 自救领码异常:', ae);
                                });
                            }
                        })
                        .catch(function (e) {
                            console.warn('[LicenseCheck] machineId 自救查询失败(下次前台化触发再试):', e);
                        });
                    return;
                }
                var url = ADMIN_STATUS_URL + '?requestId=' + encodeURIComponent(saved.requestId);
                if (saved.machineId) url += '&machineId=' + encodeURIComponent(saved.machineId);
                fetch(url, { method: 'GET', headers: { 'Content-Type': 'application/json' } })
                    .then(function (resp) { return resp.json(); })
                    .then(function (r) {
                        if (r && r.success && r.status === 'activated') {
                            console.log('[LicenseCheck] 断点续传：激活申请已审核通过，自动完成领码（requestId=' + saved.requestId + '）');
                            _resumeCompleteActivation(r, saved).catch(function (ae) {
                                console.warn('[LicenseCheck] 断点续传领码异常:', ae);
                            });
                        }
                    })
                    .catch(function (e) {
                        console.warn('[LicenseCheck] 断点续传状态查询失败(下次启动再试):', e);
                    });
            }).catch(function (e) { /* StorageAdapter 读取失败忽略 */ });
        } catch (e) {
            console.warn('[LicenseCheck] 断点续传异常(不影响使用):', e);
        }
    }

    // 页面加载完成后延迟 2 秒校验 license（等待 electronAPI 注入完成）
    function startLicenseCheck() {
        // ★ 2026-09-04 Phase 1 · 铁律 4 · ReadyPromise 同步闸门
        //   默认 Promise.resolve()——无桥环境（云端 APP/纯网页/未授权设备）立即放行，不阻塞登录。
        //   有桥环境（离线 APP / 离线桌面 Electron）在下面的 getActivationUsers 真实 UPSERT 完之后 resolve，
        //   登录 submit 入口处 await __activationUsersReadyPromise 保证用户手速多快都不会早于桥账号同步。
        if (typeof window !== 'undefined' && typeof window.__activationUsersReadyPromise === 'undefined') {
            window.__activationUsersReadyPromise = Promise.resolve();
        }
        // ★ 2026-09-03 断点续传恢复（优先于其他自愈：先完成领码，后续桥自愈才有账号可同步）
        resumeAdminPendingRequest();
        // ★ 2026-08-24 登录自愈：启动时从本地 config（Java installAdminLicense/activateOnline 写入的 users）
        //   UPSERT 同步到 localStorage.local_systemUsers。解决两类历史问题：
        //   ① 旧版本 onAdminActivated 未同步账号 → 激活成功却登录"用户名或密码错误"
        //   ② 历史写入过错误密码的账号 → 现按 config 最新密码纠正（UPSERT 覆盖）
        //   该桥仅离线APP存在（MainActivity getActivationUsers）；无此桥自动跳过，不影响其他端。
        try {
            if (global.electronAPI && global.electronAPI.activate &&
                typeof global.electronAPI.activate.getActivationUsers === 'function') {
                const syncPromise = global.electronAPI.activate.getActivationUsers().then(function (res) {
                    if (!res || !res.success || !Array.isArray(res.users)) return;
                    if (typeof window.addLocalActivationUser !== 'function') return;
                    res.users.forEach(function (u) {
                        if (!u || !u.username) return;
                        try {
                            window.addLocalActivationUser({
                                username: String(u.username),
                                phone: u.phone ? String(u.phone) : '',
                                password: u.password || 'admin',
                                name: u.name || u.username,
                                role: u.role || 'admin',
                                // ★ Phase 1.3 双保险：Java lastPwdUpdatedAt 时间戳（Phase 1.3 同步写入）
                                //   前端 keepLocalPwd 全面 verify 再叠加时间戳新→强制覆盖。
                                lastPwdUpdatedAt: typeof u.lastPwdUpdatedAt === 'number' ? u.lastPwdUpdatedAt : 0,
                                updatedAt: typeof u.updatedAt === 'number' ? u.updatedAt : 0
                            });
                        } catch (e) {}
                    });
                    console.log('[LicenseCheck] 启动自愈: config.json 激活账号已同步到 localStorage，共', res.users.length, '个 (ReadyPromise 已满足)');
                }).catch(function (e) {
                    console.warn('[LicenseCheck] 启动自愈 getActivationUsers 失败(不影响使用):', e);
                });
                // ★ Phase 1.1 关键：Promise 真实挂到全局让登录入口 await
                if (typeof window !== 'undefined') {
                    window.__activationUsersReadyPromise = syncPromise.catch(function () {}); // catch 兜底防止抛错阻塞登录
                }
            }
        } catch (e) { console.warn('[LicenseCheck] 启动自愈异常(不影响使用):', e); }

        // ★ 登录框诊所名：不依赖授权检查异步链路，随授权检查启动时立即同步。
        //   避免 await checkLicenseAndShowActivate 在非 APP/弱网下阻塞或中断，导致登录框一直显示硬编码"本能堂中医诊所"
        syncLoginClinicName();
        setTimeout(async () => {
            await checkLicenseAndShowActivate();
            // ★ 启动兜底检查（无论首次校验结果如何，都启动定时器）
            startFallbackCheck();
            // ★ 2026-08-19 激活入口收敛：向 settingsModal（基础设置底部）注入授权状态 + 管理员激活
            // ★ 2026-08-20 云端APP（无试用）：登入框骨架管理员激活入口（申请云端账号）；网页/桌面无 loginOverlay，函数内部自动跳过
            injectLicenseStatusIntoSettings();
            injectActivateLinkIntoLogin();
            // ★ 2026-09-04 方案B 注册前置：未注册设备强制先注册（弹窗 z-index 100000 置于激活弹窗之上）
            maybePromptRegistration();
        }, 2000);
    }

    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        startLicenseCheck();
    } else {
        document.addEventListener('DOMContentLoaded', startLicenseCheck);
    }
    // ★ 2026-09-04 需求2流程优化：前台化重查激活状态，消灭「审核通过后客户要二次提交才看到
    //   设备已激活重启提示」。场景：① 客户在APP激活弹窗点付款→跳浏览器/微信扫码→回到APP；
    //   ② 客户在付款页浏览器里填完关闭→登录框已打开但 resumeAdminPendingRequest 只在
    //   页面加载时单次查（页面实际在后台未卸载→不重跑）。两处场景都让前台化触发重查。
    //   防抖 1.5s（同一轮切前台防抖动连查），冷却 15s（避免频繁切换狂打后端）。
    (function bindVisibilityResume() {
        try {
            var _lastRun = 0;
            var _t = null;
            function _tryResume() {
                var now = Date.now();
                if (now - _lastRun < 15000) return;
                _lastRun = now;
                resumeAdminPendingRequest();
                // 对仍开着的激活窗口：如果它内部 Observer 还在轮询，自会在下一个 10s 周期发现；
                // 这里不直接触发实例方法（实例在 showAdminActivateModal 局部作用域），由现有
                // 10s 调度足够，前台化最多等 10s 就能看到"已审核通过"变化。
            }
            function _onVisible() {
                try {
                    if (document.hidden) return;
                    if (_t) clearTimeout(_t);
                    _t = setTimeout(_tryResume, 1500);
                } catch (e) {}
            }
            document.addEventListener('visibilitychange', _onVisible);
            // APP 特殊：WakeLock/focusin（用户点登录框任一输入）也兜底触发一次——
            //   部分 Android WebView 前后台切换 visibilitychange 不会精准触发，登录框是唯一
            //   客户会操作的交互入口，聚焦即意味着他"回来了等着登录"，此时查一次最靠谱。
            try {
                document.addEventListener('focusin', function () {
                    if (_t) clearTimeout(_t);
                    _t = setTimeout(_tryResume, 2500);
                });
            } catch (e2) {}
            // 5 分钟兜底定时：用户一直不切换、也不点输入框（少见），每 5 分钟补查一次避免
            //   审核通过后冷等一小时才发现。
            setInterval(_tryResume, 5 * 60 * 1000);
        } catch (e) { console.warn('[LicenseCheck] visibilityResume异常(不影响使用):', e); }
    })();
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
