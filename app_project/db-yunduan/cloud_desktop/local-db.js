// ============================================================================
//  local-db.js - 本地数据库模块（从云端 index.html 提取）
//
//  双模式数据库适配层：
//    - Electron 桌面端：通过 electronAPI.localDB IPC 通信
//    - Capacitor APP 端：通过 Capacitor SQLite 插件
//    - 纯网页端：无本地数据库，降级为纯云端
//
//  依赖全局变量：
//    - currentUser: 当前登录用户对象
//    - window.electronAPI.localDB: Electron IPC 桥（桌面端）
//    - window.Capacitor.Plugins.CapacitorSQLite: Capacitor 插件（APP端）
//
//  暴露全局：
//    - window.LocalDB: 本地数据库对象
//    - window.getAllowedMode(): 获取允许的模式
//    - window.offlineCapable(): 判断是否可离线
//
//  仅在 appMode === 'cloud' 时加载
// ============================================================================

window.getAllowedMode = function() {
    return (currentUser && currentUser.allowedMode) || 'both';
};

window.offlineCapable = function() {
    const mode = getAllowedMode();
    return (mode === 'both' || mode === 'local') && LocalDB.available();
};

window.LocalDB = {
    DB: 'tcm_prescription',
    SECRET: 'secret',
    _ready: null,
    _useElectron: false,

    _electronBridge() {
        try {
            return (window.electronAPI && window.electronAPI.localDB) ? window.electronAPI.localDB : null;
        } catch (e) { return null; }
    },
    _plugin() {
        try {
            return (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.CapacitorSQLite) || null;
        } catch (e) { return null; }
    },
    available() {
        return !!(this._electronBridge() || this._plugin());
    },
    async ready() {
        if (this._ready) return this._ready;
        this._ready = (async () => {
            const eBridge = this._electronBridge();
            if (eBridge) {
                try {
                    const ok = await eBridge.ready();
                    if (ok) {
                        this._useElectron = true;
                        console.log('LocalDB: Electron IPC init success');
                        return true;
                    }
                } catch (e) {
                    console.warn('LocalDB: Electron bridge failed, trying Capacitor', e);
                }
            }
            const sqlite = this._plugin();
            if (!sqlite) {
                console.warn('LocalDB: No bridge available, cloud-only mode');
                return false;
            }
            try {
                try {
                    const stored = await sqlite.isSecretStored();
                    if (!stored || !stored.result) {
                        await sqlite.setEncryptionSecret({ passphrase: this.SECRET });
                    }
                } catch (e) { }
                await sqlite.createConnection({ database: this.DB, encrypted: true, mode: 'secret', version: 1 });
                await sqlite.open({ database: this.DB });
                await this._createTables();
                console.log('LocalDB: Capacitor SQLite init success');
                return true;
            } catch (e) {
                console.error('LocalDB: Capacitor init failed', e);
                this._ready = null;
                return false;
            }
        })();
        return this._ready;
    },
    async _createTables() {
        const sqlite = this._plugin();
        const stmts = [
            "CREATE TABLE IF NOT EXISTS prescriptions (id INTEGER PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT, updated_at_ms INTEGER, created_by TEXT, synced INTEGER DEFAULT 0, deleted INTEGER DEFAULT 0);",
            "CREATE INDEX IF NOT EXISTS idx_pres_synced ON prescriptions(synced);",
            "CREATE INDEX IF NOT EXISTS idx_pres_user ON prescriptions(created_by);",
            "CREATE TABLE IF NOT EXISTS cache_kv (key TEXT PRIMARY KEY, data TEXT NOT NULL, cached_at TEXT);",
            "CREATE TABLE IF NOT EXISTS sync_status (id INTEGER PRIMARY KEY DEFAULT 1, last_push TEXT, last_pull TEXT, pending_count INTEGER DEFAULT 0);"
        ];
        for (const s of stmts) await sqlite.execute({ database: this.DB, statements: s });
    },
    async _capExec(sql) { return await this._plugin().execute({ database: this.DB, statements: sql }); },
    async _capRun(sql, values) { return await this._plugin().run({ database: this.DB, statement: sql, values: values || [] }); },
    async _capQuery(sql, values) {
        const r = await this._plugin().query({ database: this.DB, statement: sql, values: values || [] });
        return r.values || [];
    },

    async getPrescriptions(username) {
        if (this._useElectron) return await this._electronBridge().getPrescriptions(username);
        const rows = await this._capQuery('SELECT data FROM prescriptions WHERE created_by=? AND deleted=0 ORDER BY updated_at_ms DESC', [username]);
        return rows.map(r => { try { return JSON.parse(r.data); } catch (e) { return null; } }).filter(Boolean);
    },
    async upsertPrescription(p, opts) {
        const id = p.id || Date.now();
        const ua = p.updatedAt || new Date().toISOString();
        const uaMs = new Date(ua).getTime() || Date.now();
        const cb = p.createdBy || (currentUser ? currentUser.username : '');
        const synced = (opts && opts.synced !== undefined) ? opts.synced : 0;
        const deleted = (opts && opts.deleted !== undefined) ? opts.deleted : 0;
        if (this._useElectron) {
            return await this._electronBridge().upsertPrescription({ ...p, id, updatedAt: ua, createdBy: cb }, { synced, deleted });
        }
        await this._capRun(
            'INSERT OR REPLACE INTO prescriptions (id, data, updated_at, updated_at_ms, created_by, synced, deleted) VALUES (?,?,?,?,?,?,?)',
            [id, JSON.stringify(p), ua, uaMs, cb, synced, deleted]
        );
        return id;
    },
    async getPrescriptionRow(id) {
        if (this._useElectron) return null;
        const rows = await this._capQuery('SELECT id, updated_at_ms, synced, deleted FROM prescriptions WHERE id=?', [id]);
        return rows[0] || null;
    },
    async getUnsyncedRows() {
        if (this._useElectron) {
            const list = await this._electronBridge().getUnsyncedPrescriptions();
            return (list || []).map(item => {
                const { deleted, ...prescription } = item;
                return { id: item.id, prescription: prescription, deleted: deleted ? 1 : 0 };
            });
        }
        const rows = await this._capQuery('SELECT id, data, deleted FROM prescriptions WHERE synced=0 ORDER BY updated_at_ms ASC');
        return rows.map(r => { try { return { id: r.id, prescription: JSON.parse(r.data), deleted: r.deleted }; } catch (e) { return null; } }).filter(Boolean);
    },
    async markSynced(id) {
        if (this._useElectron) return await this._electronBridge().markSynced(id);
        await this._capRun('UPDATE prescriptions SET synced=1 WHERE id=?', [id]);
    },
    async markDeleted(id) {
        if (this._useElectron) return await this._electronBridge().markDeleted(id);
        await this._capRun('UPDATE prescriptions SET deleted=1, synced=0 WHERE id=?', [id]);
    },
    async countUnsynced() {
        if (this._useElectron) return await this._electronBridge().countUnsynced();
        const rows = await this._capQuery('SELECT COUNT(*) AS c FROM prescriptions WHERE synced=0');
        return (rows[0] && rows[0].c) || 0;
    },
    async setCache(key, data) {
        if (this._useElectron) return await this._electronBridge().setCache(key, data);
        await this._capRun('INSERT OR REPLACE INTO cache_kv (key, data, cached_at) VALUES (?,?,?)', [key, JSON.stringify(data), new Date().toISOString()]);
    },
    async getCache(key) {
        if (this._useElectron) return await this._electronBridge().getCache(key);
        const rows = await this._capQuery('SELECT data FROM cache_kv WHERE key=?', [key]);
        if (!rows[0]) return null;
        try { return JSON.parse(rows[0].data); } catch (e) { return null; }
    },
    async setSyncStatus(field, pending) {
        if (this._useElectron) {
            const status = await this._electronBridge().getSyncStatus() || {};
            if (field === 'push') status.last_push = new Date().toISOString();
            else if (field === 'pull') status.last_pull = new Date().toISOString();
            status.pending_count = pending;
            return await this._electronBridge().setSyncStatus(status);
        }
        const now = new Date().toISOString();
        await this._capRun('INSERT OR IGNORE INTO sync_status (id, last_push, last_pull, pending_count) VALUES (1, NULL, NULL, 0)');
        if (field === 'push') await this._capRun('UPDATE sync_status SET last_push=?, pending_count=? WHERE id=1', [now, pending]);
        else if (field === 'pull') await this._capRun('UPDATE sync_status SET last_pull=?, pending_count=? WHERE id=1', [now, pending]);
    },
    async getSyncStatus() {
        if (this._useElectron) return await this._electronBridge().getSyncStatus();
        const rows = await this._capQuery('SELECT last_push, last_pull, pending_count FROM sync_status WHERE id=1');
        return rows[0] || null;
    }
};
