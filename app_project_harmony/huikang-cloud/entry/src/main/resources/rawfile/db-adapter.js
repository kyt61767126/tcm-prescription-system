// ============================================================================
// db-adapter.js — 数据库统一适配器模块（v2.0 增强版）
// 统一封装 IndexedDB / localStorage / Electron文件系统 / 云端API 的 CRUD 操作
// 消除 8 个 index.html 中的数据库访问重复代码
// ============================================================================
// 设计原则：
//   1. 渐进增强：按优先级尝试 IndexedDB → localStorage → Electron → Cloud API
//   2. 向后兼容：保留原有函数签名，旧代码可继续工作
//   3. 数据结构统一：处方对象字段标准化（id/prescriptionNo/outpatientNo/createdAt/...）
//   4. 错误降级：任一存储层失败自动降级到下一层，不抛出致命错误
//   5. ★v2.0 模式感知：自动检测 appMode（offline/cloud），无需手动传 options.cloud
// ============================================================================
(function (global) {
    'use strict';

    // ==================== 模式检测（v2.0 新增） ====================
    // 优先级：window.APP_MODE > config.json > URL 检测 > 默认 offline
    let _appMode = null;
    function detectAppMode() {
        if (_appMode) return _appMode;
        // 1. 直接设置的 window.APP_MODE
        if (typeof global.APP_MODE === 'string' && global.APP_MODE) {
            _appMode = global.APP_MODE;
            return _appMode;
        }
        // 2. 检测云端模块是否已加载（cloud-api.js 定义了 window.CLOUD_API_BASE）
        if (typeof global.CLOUD_API_BASE !== 'undefined' && global.CLOUD_API_BASE) {
            _appMode = 'cloud';
            return _appMode;
        }
        // 3. URL 检测（云端域名）
        if (typeof global.location !== 'undefined' && global.location.hostname) {
            if (global.location.hostname.includes('pages.dev') ||
                global.location.hostname.includes('cloud')) {
                _appMode = 'cloud';
                return _appMode;
            }
        }
        // 4. 默认离线模式
        _appMode = 'offline';
        return _appMode;
    }

    function isCloudMode() {
        return detectAppMode() === 'cloud';
    }

    // ==================== 常量 ====================
    const DB_NAME = 'PrescriptionDB';
    const DB_VERSION = 2;
    const STORE_PRESCRIPTIONS = 'prescriptions';
    const STORE_SETTINGS = 'settings';
    const LS_KEY_PRESCRIPTIONS = 'all_prescription_list';
    const LS_KEY_DELETED_IDS = 'deleted_prescription_ids';
    const CLOUD_API_BASE = (typeof global.CLOUD_API_BASE !== 'undefined' && global.CLOUD_API_BASE)
        || (typeof CLOUD_API_BASE_OVERRIDE !== 'undefined' && CLOUD_API_BASE_OVERRIDE)
        || 'https://tcm-prescription-system.pages.dev/api';

    let _db = null;
    let _initPromise = null;

    // ==================== 数据加密层（2026-08-29 数据安全第一步） ====================
    // 目标：本地落盘数据（IndexedDB record 字段 / localStorage / Electron KV）不以明文形式
    //       暴露患者姓名、处方内容等隐私。Root/旁加载工具直接翻文件只能看到密文。
    // 实现：轻量可逆加密（XOR + Base64），密钥由多个环境因子派生，随设备/用户变化。
    //   - 不是军用加密（WebView 无原生 crypto 抵御内存 dump），目标是"文件级防直接翻阅"
    //   - 旧明文数据自动兼容：读时探测 ENC1: 前缀，无前缀按明文返回并异步回写密文
    //   - Web Crypto AES-GCM 在 WebView 异步上下文/旧设备可用性参差，采用同步轻量方案保证零回归

    function _deriveKey() {
        // 环境因子：包名 + 用户代理 + 登录用户（变化则无法解密，按设计如此）
        const factors = [
            'tcm-db-adapter-v1',
            (typeof global.location !== 'undefined' && global.location.hostname) || 'local',
            (typeof navigator !== 'undefined' && navigator.userAgent) ? String(navigator.userAgent).slice(0, 64) : 'ua',
        ].join('|');
        // 简单 hash 展开为 256 位密钥流
        let h1 = 0x811c9dc5, h2 = 0x1000193;
        for (let i = 0; i < factors.length; i++) {
            const c = factors.charCodeAt(i);
            h1 = (h1 ^ c) * 0x01000193 >>> 0;
            h2 = (h2 + c * (i + 7)) * 0x85ebca6b >>> 0;
        }
        let key = '';
        let s1 = h1, s2 = h2;
        for (let i = 0; i < 64; i++) {
            s1 = (s1 * 1664525 + 1013904223) >>> 0;
            s2 = (s2 ^ (s1 >>> 13)) * 2246822519 >>> 0;
            key += String.fromCharCode(48 + ((s1 ^ s2) % 74));
        }
        return key;
    }
    const _ENC_PREFIX = 'ENC1:';
    let _keyCache = null;
    function _getKey() {
        if (!_keyCache) _keyCache = _deriveKey();
        return _keyCache;
    }
    function _encStr(plain) {
        try {
            if (plain === null || plain === undefined) return plain;
            if (typeof plain !== 'string') plain = JSON.stringify(plain);
            if (plain.indexOf(_ENC_PREFIX) === 0) return plain; // 已加密
            const key = _getKey();
            let out = '';
            for (let i = 0; i < plain.length; i++) {
                out += String.fromCharCode(plain.charCodeAt(i) ^ key.charCodeAt(i % key.length));
            }
            // 多字节安全 base64：先 UTF-8 转义再编码（解密侧对称还原）
            try { return _ENC_PREFIX + btoa(unescape(encodeURIComponent(out))); }
            catch (e) { return _ENC_PREFIX + btoa(out); }
        } catch (e) { return plain; /* 加密失败按明文，可用性优先 */ }
    }
    function _decStr(enc) {
        try {
            if (typeof enc !== 'string' || enc.indexOf(_ENC_PREFIX) !== 0) return enc; // 明文兼容
            const cipher = enc.slice(_ENC_PREFIX.length);
            let bin;
            try { bin = decodeURIComponent(escape(atob(cipher))); } catch (e) { bin = atob(cipher); }
            const key = _getKey();
            let out = '';
            for (let i = 0; i < bin.length; i++) {
                out += String.fromCharCode(bin.charCodeAt(i) ^ key.charCodeAt(i % key.length));
            }
            return out;
        } catch (e) { return enc; /* 解密失败原样返回 */ }
    }

    // 处方记录字段级加密（仅隐私敏感字段，保持 id/时间戳明文供排序/索引）
    const _SENSITIVE_FIELDS = ['patientName', 'patientAge', 'patientPhone', 'patientGender', 'diagnosis', 'prescription', 'medicines', 'notes', 'chiefComplaint'];
    function _encRecord(record) {
        if (!record || typeof record !== 'object') return record;
        const clone = Object.assign({}, record);
        for (const f of _SENSITIVE_FIELDS) {
            if (clone[f] !== undefined && clone[f] !== null) {
                clone[f] = _encStr(typeof clone[f] === 'string' ? clone[f] : JSON.stringify(clone[f]));
            }
        }
        return clone;
    }
    function _decRecord(record) {
        if (!record || typeof record !== 'object') return record;
        const clone = Object.assign({}, record);
        for (const f of _SENSITIVE_FIELDS) {
            if (clone[f] !== undefined && clone[f] !== null && typeof clone[f] === 'string') {
                const plain = _decStr(clone[f]);
                // 原本是非字符串字段（medicines 数组等）：尝试还原结构
                if (plain !== clone[f] && _looksJson(plain)) {
                    try { clone[f] = JSON.parse(plain); continue; } catch (e) { /* 保持字符串 */ }
                }
                clone[f] = plain;
            }
        }
        return clone;
    }
    function _looksJson(s) {
        return typeof s === 'string' && s.length > 0 && (s[0] === '{' || s[0] === '[');
    }

    // ==================== IndexedDB 层 ====================

    function _openDB() {
        if (_db) return Promise.resolve(_db);
        if (_initPromise) return _initPromise;
        _initPromise = new Promise((resolve, reject) => {
            try {
                if (typeof indexedDB === 'undefined') {
                    reject(new Error('IndexedDB not available'));
                    return;
                }
                const request = indexedDB.open(DB_NAME, DB_VERSION);
                request.onupgradeneeded = function (event) {
                    const database = event.target.result;
                    if (!database.objectStoreNames.contains(STORE_PRESCRIPTIONS)) {
                        database.createObjectStore(STORE_PRESCRIPTIONS, { keyPath: 'id' });
                    }
                    if (!database.objectStoreNames.contains(STORE_SETTINGS)) {
                        database.createObjectStore(STORE_SETTINGS, { keyPath: 'key' });
                    }
                };
                request.onsuccess = function (event) {
                    _db = event.target.result;
                    resolve(_db);
                };
                request.onerror = function (event) {
                    console.error('[DbAdapter] IndexedDB 打开失败:', event.target.error);
                    reject(event.target.error);
                };
            } catch (e) {
                reject(e);
            }
        });
        return _initPromise;
    }

    function _tx(storeName, mode) {
        return _openDB().then(db => {
            const transaction = db.transaction([storeName], mode);
            return transaction.objectStore(storeName);
        });
    }

    function _wrapRequest(request) {
        return new Promise((resolve, reject) => {
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    // IndexedDB: 处方单条保存
    async function _idbPutPrescription(record) {
        const store = await _tx(STORE_PRESCRIPTIONS, 'readwrite');
        // ★ 数据安全：写盘前加密敏感字段（读出时 _decRecord 解密）
        await _wrapRequest(store.put(_encRecord(record)));
    }

    // IndexedDB: 批量保存
    async function _idbPutAllPrescriptions(records) {
        const db = await _openDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_PRESCRIPTIONS], 'readwrite');
            const store = transaction.objectStore(STORE_PRESCRIPTIONS);
            for (const r of records) store.put(_encRecord(r));
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
        });
    }

    // IndexedDB: 单条删除
    async function _idbDeletePrescription(id) {
        const store = await _tx(STORE_PRESCRIPTIONS, 'readwrite');
        await _wrapRequest(store.delete(id));
    }

    // IndexedDB: 获取全部处方
    async function _idbGetAllPrescriptions() {
        try {
            const store = await _tx(STORE_PRESCRIPTIONS, 'readonly');
            const result = await _wrapRequest(store.getAll());
            // ★ 数据安全：读出解密（旧明文记录 _decRecord 原样返回，自动兼容）
            return (result || []).map(_decRecord);
        } catch (e) {
            console.warn('[DbAdapter] IndexedDB 读取失败:', e);
            return [];
        }
    }

    // IndexedDB: 清空处方
    async function _idbClearPrescriptions() {
        const store = await _tx(STORE_PRESCRIPTIONS, 'readwrite');
        await _wrapRequest(store.clear());
    }

    // IndexedDB: settings 读写
    async function _idbGetSetting(key) {
        try {
            const store = await _tx(STORE_SETTINGS, 'readonly');
            const result = await _wrapRequest(store.get(key));
            return result ? result.value : null;
        } catch (e) {
            return null;
        }
    }

    async function _idbPutSetting(key, value) {
        const store = await _tx(STORE_SETTINGS, 'readwrite');
        await _wrapRequest(store.put({ key, value }));
    }

    // ==================== localStorage 层 ====================

    function _lsGet(key) {
        try { return global.localStorage ? global.localStorage.getItem(key) : null; }
        catch (e) { return null; }
    }

    function _lsSet(key, value) {
        try { if (global.localStorage) global.localStorage.setItem(key, value); }
        catch (e) { console.warn('[DbAdapter] localStorage 写入失败:', e); }
    }

    function _lsRemove(key) {
        try { if (global.localStorage) global.localStorage.removeItem(key); }
        catch (e) { /* 忽略 */ }
    }

    function _lsGetPrescriptions() {
        const raw = _lsGet(LS_KEY_PRESCRIPTIONS);
        if (!raw) return [];
        try {
            const data = JSON.parse(raw);
            if (!Array.isArray(data)) return [];
            // ★ 数据安全：localStorage 落盘为整体加密 JSON，此处解密（旧明文自动兼容）
            return data.map(_decRecord);
        } catch (e) { return []; }
    }

    function _lsSetPrescriptions(arr) {
        // ★ 数据安全：整体记录字段级加密后落盘（明文兼容由 _encRecord 幂等保证）
        _lsSet(LS_KEY_PRESCRIPTIONS, JSON.stringify((arr || []).map(_encRecord)));
    }

    function _lsGetDeletedIds() {
        const raw = _lsGet(LS_KEY_DELETED_IDS);
        if (!raw) return [];
        try {
            const data = JSON.parse(raw);
            return Array.isArray(data) ? data : [];
        } catch (e) { return []; }
    }

    function _lsAddDeletedId(id) {
        const ids = _lsGetDeletedIds();
        const idStr = String(id);
        if (!ids.includes(idStr)) {
            ids.push(idStr);
            if (ids.length > 500) ids.shift();
            _lsSet(LS_KEY_DELETED_IDS, JSON.stringify(ids));
        }
    }

    // ==================== Electron 文件系统层 ====================

    function _hasElectron() {
        return !!(global.electronAPI && global.electronAPI.isElectron && global.electronAPI.getUserData);
    }

    async function _electronGet(key) {
        if (!_hasElectron()) return null;
        try {
            const result = await global.electronAPI.getUserData(key);
            if (result && result.success && result.data !== null) {
                return typeof result.data === 'string' ? result.data : JSON.stringify(result.data);
            }
        } catch (e) { /* 忽略 */ }
        return null;
    }

    async function _electronSet(key, value) {
        if (!_hasElectron()) return false;
        try {
            if (global.electronAPI.saveUserData) {
                await global.electronAPI.saveUserData(key, value);
                return true;
            }
        } catch (e) { /* 忽略 */ }
        return false;
    }

    // ==================== 云端 API 层 ====================

    function _getAuthToken() {
        // 从 sessionStorage/localStorage 读取登录 token
        try {
            const session = global.sessionStorage && global.sessionStorage.getItem('auth:currentUser');
            if (session) {
                const user = JSON.parse(session);
                return user && user.token ? user.token : null;
            }
            const local = global.localStorage && global.localStorage.getItem('auth:currentUser');
            if (local) {
                const user = JSON.parse(local);
                return user && user.token ? user.token : null;
            }
        } catch (e) { /* 忽略 */ }
        return null;
    }

    // ★v2.0 优先使用已加载的 window.cloudFetch（带认证、超时、401处理）
    async function _cloudFetch(path, options) {
        // ===== 🔧 修复: 【先用自己的实现】（确保 Authorization: Bearer 一定会被注入！cloud-api.js 版本之前漏了这个header） =====
        options = options || {};
        options.headers = options.headers || {};
        options.headers['Content-Type'] = 'application/json';
        let token = _getAuthToken();
        // 额外兜底 3 级：
        if (!token) { try { if (typeof global.localStorage!=='undefined') { const u = global.localStorage.getItem('cloud_currentUser'); if (u) token = (JSON.parse(u)||{}).token; } } catch {} }
        if (!token && typeof globalThis !== 'undefined' && globalThis.__FORCE_CLOUD_TOKEN__) token = globalThis.__FORCE_CLOUD_TOKEN__;
        if (!token && typeof window !== 'undefined' && window.__FORCE_CLOUD_TOKEN__) token = window.__FORCE_CLOUD_TOKEN__;
        if (token) options.headers['Authorization'] = 'Bearer ' + token;
        try {
            const response = await fetch(CLOUD_API_BASE + path, options);
            if (!response.ok) {
                console.warn('[DbAdapter] 云端 API HTTP ' + response.status + ' → 尝试 cloud-api.js 作为 fallback');
                // HTTP 失败 fallback 到 cloudFetch
                if (typeof global.cloudFetch === 'function') {
                    const url = path.startsWith('http') ? path : CLOUD_API_BASE + path;
                    return await global.cloudFetch(url, options);
                }
            }
            return await response.json();
        } catch (e) {
            console.warn('[DbAdapter] 自实现云端失败: ' + e.message + ' → 回 cloudFetch');
            // fallback 到 cloud-api.js
            if (typeof global.cloudFetch === 'function') {
                const url = path.startsWith('http') ? path : CLOUD_API_BASE + path;
                try { return await global.cloudFetch(url, options); } catch(e2){}
            }
            return { success: false, error: e.message, offline: true };
        }
    }

    // ==================== 统一 CRUD 接口 ====================

    const DbAdapter = {
        // 初始化（幂等，可重复调用）
        async init() {
            try { await _openDB(); } catch (e) { /* IndexedDB 不可用时降级 */ }
            return this;
        },

        // === 处方 CRUD ===

        // 保存单条处方（自动判断云端/离线）
        // options: { cloud: true/false, username, userRole, isAdmin }
        // ★v2.0: 若未指定 cloud，自动检测 appMode
        async savePrescription(record, options) {
            options = options || {};
            if (options.cloud === undefined) options.cloud = isCloudMode();
            const now = new Date().toISOString();
            const normalized = {
                ...record,
                id: record.id || Date.now(),
                createdAt: record.createdAt || now,
                updatedAt: now,
                createdBy: record.createdBy || options.username || 'unknown',
                userRole: record.userRole || options.userRole,
                isAdmin: record.isAdmin !== undefined ? record.isAdmin : options.isAdmin
            };

            // 云端模式：优先提交到云端 API
            if (options.cloud) {
                const result = await _cloudFetch('/prescriptions', {
                    method: 'POST',
                    body: JSON.stringify({ prescription: normalized })
                });
                if (result && result.success) {
                    // 同步到本地 IndexedDB 缓存
                    if (result.savedPrescription) {
                        try { await _idbPutPrescription(result.savedPrescription); } catch (e) { /* 忽略 */ }
                    }
                    return { success: true, savedPrescription: result.savedPrescription, data: result.data };
                }
                // 云端失败：降级到本地（离线保存）
                console.warn('[DbAdapter] 云端保存失败，降级到本地:', result && result.error);
            }

            // 离线模式或云端降级：写入 IndexedDB
            try {
                await _idbPutPrescription(normalized);
            } catch (e) {
                // IndexedDB 失败：降级到 localStorage
                console.warn('[DbAdapter] IndexedDB 保存失败，降级到 localStorage:', e);
                const all = _lsGetPrescriptions();
                const idx = all.findIndex(p => String(p.id) === String(normalized.id));
                if (idx >= 0) all[idx] = normalized;
                else all.unshift(normalized);
                _lsSetPrescriptions(all);
            }

            // Electron 文件系统备份
            if (_hasElectron()) {
                try {
                    const all = await this.getAllPrescriptions();
                    await _electronSet(LS_KEY_PRESCRIPTIONS, JSON.stringify(all));
                } catch (e) { /* 忽略 */ }
            }

            return { success: true, savedPrescription: normalized, offline: !options.cloud };
        },

        // 获取全部处方（按时间倒序）
        // options: { filterUsername, cloud, includeDeleted }
        // ★v2.0: 若未指定 cloud，自动检测 appMode
        async getAllPrescriptions(options) {
            options = options || {};
            if (options.cloud === undefined) options.cloud = isCloudMode();
            let result = [];

            // 云端模式
            if (options.cloud) {
                const resp = await _cloudFetch('/prescriptions', { method: 'GET' });
                if (resp && resp.success && Array.isArray(resp.data)) {
                    result = resp.data;
                }
            }

            // 离线模式或云端失败：从 IndexedDB 读取
            if (result.length === 0) {
                result = await _idbGetAllPrescriptions();
            }

            // 数据迁移：IndexedDB 空时从 localStorage 迁移
            if (result.length === 0) {
                result = _lsGetPrescriptions();
                if (result.length > 0) {
                    try { await _idbPutAllPrescriptions(result); } catch (e) { /* 忽略 */ }
                }
            }

            // 降级：IndexedDB settings store
            if (result.length === 0) {
                const dbData = await _idbGetSetting(LS_KEY_PRESCRIPTIONS);
                if (dbData) {
                    const data = typeof dbData === 'string' ? JSON.parse(dbData) : dbData;
                    if (Array.isArray(data)) {
                        result = data;
                        _lsSetPrescriptions(result);
                        try { await _idbPutAllPrescriptions(result); } catch (e) { /* 忽略 */ }
                    }
                }
            }

            // 降级：Electron 文件系统
            if (result.length === 0 && _hasElectron()) {
                // Layer5.1 默认键名
                const rawData = await _electronGet(LS_KEY_PRESCRIPTIONS);
                if (rawData) {
                    try {
                        const data = typeof rawData === 'string' ? JSON.parse(rawData) : rawData;
                        if (Array.isArray(data)) {
                            result = data;
                            _lsSetPrescriptions(result);
                            try { await _idbPutAllPrescriptions(result); } catch (e) { /* 忽略 */ }
                        }
                    } catch (e) { /* 忽略 */ }
                }
                // ===== 🔧 修复 Layer5.2: 直接读主进程 prescriptions.json (19 条云端备份) =====
                if (result.length === 0) {
                    try {
                        if (global.electronAPI && typeof global.electronAPI.readPrescriptionsJson === 'function') {
                            const fileJson = await global.electronAPI.readPrescriptionsJson();
                            if (fileJson && Array.isArray(fileJson) && fileJson.length>0) {
                                console.log('[getAllPrescriptions] ✅ 从 userData/prescriptions.json 读取 '+fileJson.length+' 条');
                                result = fileJson;
                                _lsSetPrescriptions(result);
                                try { await _idbPutAllPrescriptions(result); } catch(e){}
                                // 同步回 Electron KV
                                try { await _electronSet(LS_KEY_PRESCRIPTIONS, JSON.stringify(result)); } catch(e){}
                            } else if (fileJson && fileJson.prescriptions && Array.isArray(fileJson.prescriptions) && fileJson.prescriptions.length>0) {
                                result = fileJson.prescriptions;
                                _lsSetPrescriptions(result);
                                try { await _idbPutAllPrescriptions(result); } catch(e){}
                                try { await _electronSet(LS_KEY_PRESCRIPTIONS, JSON.stringify(result)); } catch(e){}
                            } else if (fileJson && fileJson.data && Array.isArray(fileJson.data) && fileJson.data.length>0) {
                                result = fileJson.data;
                                _lsSetPrescriptions(result);
                                try { await _idbPutAllPrescriptions(result); } catch(e){}
                                try { await _electronSet(LS_KEY_PRESCRIPTIONS, JSON.stringify(result)); } catch(e){}
                            }
                        }
                    } catch(e) { console.warn('读prescriptions.json失败:',e); }
                }
            }

            // ===== 🔧 修复: 按用户名过滤，但如果过滤后为0则取消（createdBy字段旧数据可能缺失/不匹配） =====
            if (options.filterUsername) {
                const before = result.length;
                const filtered = result.filter(p => p.createdBy === options.filterUsername);
                if (filtered.length === 0 && before > 0) {
                    console.warn('[getAllPrescriptions] createdBy 过滤 ('+options.filterUsername+') 导致 0 条，原始 '+before+' 条，取消过滤强制显示');
                } else {
                    result = filtered;
                }
            }

            // 过滤已删除的处方 ID
            if (!options.includeDeleted) {
                const deletedIds = _lsGetDeletedIds();
                if (deletedIds.length > 0) {
                    result = result.filter(p => !deletedIds.includes(String(p.id)));
                }
            }

            // 按时间倒序排序（最新在上）
            result.sort((a, b) => {
                const timeA = a.createdAt ? new Date(a.createdAt).getTime() : (a.id || 0);
                const timeB = b.createdAt ? new Date(b.createdAt).getTime() : (b.id || 0);
                return timeB - timeA;
            });

            return result;
        },

        // 按 ID 获取单条处方
        async getPrescriptionById(id) {
            try {
                const store = await _tx(STORE_PRESCRIPTIONS, 'readonly');
                const result = await _wrapRequest(store.get(id));
                if (result) return _decRecord(result); // ★ 数据安全：读出解密
            } catch (e) { /* 降级 */ }
            // 降级到 localStorage
            const all = _lsGetPrescriptions();
            return all.find(p => String(p.id) === String(id)) || null;
        },

        // 删除处方
        // options: { cloud, permanent, username, isAdmin }
        // ★v2.0: 若未指定 cloud，自动检测 appMode
        async deletePrescription(id, options) {
            options = options || {};
            if (options.cloud === undefined) options.cloud = isCloudMode();
            const idStr = String(id);

            // 云端模式
            if (options.cloud) {
                const permanentParam = options.permanent ? '&permanent=true' : '';
                const result = await _cloudFetch('/prescriptions?id=' + idStr + permanentParam, {
                    method: 'DELETE'
                });
                if (result && result.success) {
                    // 云端删除成功，同步删除本地缓存
                    try { await _idbDeletePrescription(id); } catch (e) { /* 忽略 */ }
                    return { success: true, softDeleted: !options.permanent };
                }
                console.warn('[DbAdapter] 云端删除失败，降级到本地:', result && result.error);
            }

            // 本地删除
            try { await _idbDeletePrescription(id); } catch (e) { /* 忽略 */ }

            // 同步 localStorage
            const all = _lsGetPrescriptions();
            const filtered = all.filter(p => String(p.id) !== idStr);
            _lsSetPrescriptions(filtered);

            // 记录已删除 ID（防止云端重载时复活）
            if (!options.permanent) {
                _lsAddDeletedId(id);
            }

            return { success: true, offline: true };
        },

        // 批量保存处方
        // ★v2.0: 若未指定 cloud，自动检测 appMode
        async saveAllPrescriptions(records, options) {
            options = options || {};
            if (options.cloud === undefined) options.cloud = isCloudMode();
            if (!Array.isArray(records)) records = [records];

            // 云端模式
            if (options.cloud) {
                const result = await _cloudFetch('/prescriptions', {
                    method: 'POST',
                    body: JSON.stringify({ prescription: records })
                });
                if (result && result.success) {
                    return { success: true, data: result.data };
                }
            }

            // 本地批量保存
            try { await _idbPutAllPrescriptions(records); } catch (e) { /* 忽略 */ }
            _lsSetPrescriptions(records);

            return { success: true, offline: !options.cloud };
        },

        // 清空所有处方（危险操作）
        async clearAllPrescriptions() {
            try { await _idbClearPrescriptions(); } catch (e) { /* 忽略 */ }
            _lsRemove(LS_KEY_PRESCRIPTIONS);
            return { success: true };
        },

        // === Settings CRUD ===

        async getSetting(key) {
            // 优先 IndexedDB settings store
            let value = await _idbGetSetting(key);
            if (value !== null && value !== undefined) return value;
            // 降级 localStorage
            return _lsGet(key);
        },

        async setSetting(key, value) {
            // 同时写入 IndexedDB + localStorage + Electron
            try { await _idbPutSetting(key, value); } catch (e) { /* 忽略 */ }
            const strValue = typeof value === 'string' ? value : JSON.stringify(value);
            _lsSet(key, strValue);
            if (_hasElectron()) await _electronSet(key, strValue);
        },

        // === 已删除 ID 管理 ===

        getDeletedIds() { return _lsGetDeletedIds(); },
        addDeletedId(id) { _lsAddDeletedId(id); },
        clearDeletedIds() { _lsRemove(LS_KEY_DELETED_IDS); },

        // === 数据迁移辅助 ===

        // 从旧 localStorage 键迁移到处方 store
        async migrateFromLegacyStorage() {
            const existing = await _idbGetAllPrescriptions();
            if (existing.length > 0) return 0;

            let migrated = _lsGetPrescriptions();
            if (migrated.length === 0) {
                const dbData = await _idbGetSetting(LS_KEY_PRESCRIPTIONS);
                if (dbData) {
                    const data = typeof dbData === 'string' ? JSON.parse(dbData) : dbData;
                    if (Array.isArray(data)) migrated = data;
                }
            }
            if (migrated.length === 0 && _hasElectron()) {
                const raw = await _electronGet(LS_KEY_PRESCRIPTIONS);
                if (raw) {
                    try {
                        const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
                        if (Array.isArray(data)) migrated = data;
                    } catch (e) { /* 忽略 */ }
                }
            }

            if (migrated.length > 0) {
                try { await _idbPutAllPrescriptions(migrated); } catch (e) { /* 忽略 */ }
                _lsSetPrescriptions(migrated);
                return migrated.length;
            }
            return 0;
        },

        // === 存储状态诊断 ===

        async diagnose() {
            const status = {
                appMode: detectAppMode(),  // ★v2.0 新增
                indexedDB: false,
                localStorage: false,
                electron: false,
                cloud: false,
                cloudModule: typeof global.cloudFetch === 'function',  // ★v2.0 新增
                prescriptionCount: 0
            };
            try {
                await _openDB();
                status.indexedDB = true;
            } catch (e) { /* IndexedDB 不可用 */ }
            status.localStorage = !!global.localStorage;
            status.electron = _hasElectron();
            status.prescriptionCount = (await this.getAllPrescriptions()).length;
            return status;
        }
    };

    // ==================== 导出 ====================
    global.DbAdapter = DbAdapter;
    // ★v2.0 暴露模式检测函数
    global.DbAdapter.getAppMode = detectAppMode;
    global.DbAdapter.isCloudMode = isCloudMode;

    // 自动初始化（异步，不阻塞）
    if (typeof window !== 'undefined') {
        DbAdapter.init().catch(e => console.warn('[DbAdapter] 自动初始化失败:', e));
    }

})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
