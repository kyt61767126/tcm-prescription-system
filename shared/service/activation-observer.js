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
            let data = null;
            try {
                const res = await fetch(this._statusUrl(q), { method: 'GET' });
                data = await res.json().catch(() => null);
            } catch (e) { console.warn('[activation-observer] poll fetch error', e); }
            // 若读回来 status=cancelled 且有 phone → admin_phone 索引残留指向错记录
            // → fallback：只按 machineId 不带 requestId 重查一次（自救）
            if (data && data.success && data.status === 'cancelled' && machineId) {
                try {
                    const fb = await fetch(this._statusUrl({ machineId: machineId, phone: phone || '' }), { method: 'GET' });
                    const fbData = await fb.json().catch(() => null);
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
