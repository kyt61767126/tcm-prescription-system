// ============================================================================
//  sync-engine.js - 双向同步引擎（从云端 index.html 提取）
//
//  依赖全局变量：
//    - currentUser: 当前登录用户对象
//    - buildAuthHeader(): 构建认证头函数
//    - isClinicAdmin(), isPlatformAdmin(): 角色判断函数
//    - updateOfflineSyncInfo(): 更新离线同步信息 UI 函数
//    - LocalDB: 本地数据库对象（local-db.js）
//    - CLOUD_API_BASE: 云端 API 基础 URL（cloud-api.js）
//
//  暴露全局：
//    - window.SyncEngine: 同步引擎对象
//
//  仅在 appMode === 'cloud' 时加载
// ============================================================================

window.SyncEngine = {
    _running: false,
    _inited: false,
    _timer: null,
    _consecutiveFailures: 0,
    _authHeader() {
        if (!currentUser) return null;
        try { return buildAuthHeader(currentUser); } catch (e) { return null; }
    },
    async _fetchWithTimeout(url, options = {}, timeout = 30000) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeout);
        try {
            return await fetch(url, { ...options, signal: controller.signal });
        } finally {
            clearTimeout(timer);
        }
    },
    async _cloudGetPrescriptions() {
        const auth = this._authHeader();
        const url = CLOUD_API_BASE + '/prescriptions';
        const resp = await this._fetchWithTimeout(url, { headers: { 'Authorization': auth, 'Content-Type': 'application/json' } });
        if (!resp.ok) throw new Error('GET prescriptions ' + resp.status);
        const json = await resp.json();
        return (json && json.data) || [];
    },
    async _cloudPostPrescription(p) {
        const auth = this._authHeader();
        const resp = await this._fetchWithTimeout(CLOUD_API_BASE + '/prescriptions', {
            method: 'POST',
            headers: { 'Authorization': auth, 'Content-Type': 'application/json' },
            body: JSON.stringify({ prescription: [p] })
        });
        if (!resp.ok) throw new Error('POST prescriptions ' + resp.status);
        return await resp.json();
    },
    async _cloudDeletePrescription(id) {
        const auth = this._authHeader();
        const url = CLOUD_API_BASE + '/prescriptions?id=' + id;
        const resp = await this._fetchWithTimeout(url, { method: 'DELETE', headers: { 'Authorization': auth } });
        if (!resp.ok) throw new Error('DELETE prescriptions ' + resp.status);
        return true;
    },
    async _pullCache(key, url) {
        try {
            const resp = await this._fetchWithTimeout(url, { headers: { 'Authorization': this._authHeader() } });
            if (!resp.ok) return;
            const json = await resp.json();
            if (json && json.success && json.data) await LocalDB.setCache(key, json.data);
        } catch (e) { console.warn('pull cache ' + key + ' 失败', e); }
    },
    async run() {
        if (this._running) return;
        if (!currentUser) return;
        const mode = getAllowedMode();
        if (mode !== 'both' && mode !== 'local') return;
        if (!navigator.onLine) return;
        if (this._consecutiveFailures >= 6) {
            console.warn('SyncEngine: 连续失败 ' + this._consecutiveFailures + ' 次，跳过本次同步（等待 online 事件重置）');
            return;
        }
        const ok = await LocalDB.ready();
        if (!ok) return;
        this._running = true;
        try {
            await this.push();
            if (mode === 'both') {
                await this.pull();
            }
            const pending = await LocalDB.countUnsynced();
            if (mode === 'both') {
                await LocalDB.setSyncStatus('pull', pending);
            } else {
                await LocalDB.setSyncStatus('push', pending);
            }
            if (window.updateOfflineSyncInfo) updateOfflineSyncInfo();
            console.log('SyncEngine.run 完成 (mode=' + mode + ')，待同步:', pending);
            this._consecutiveFailures = 0;
        } catch (e) {
            this._consecutiveFailures++;
            console.warn('SyncEngine.run 出错（失败 ' + this._consecutiveFailures + ' 次）:', e);
        } finally {
            this._running = false;
        }
    },
    async push() {
        const rows = await LocalDB.getUnsyncedRows();
        if (rows.length === 0) return 0;
        let cloudMap = new Map();
        try {
            const cloudList = await this._cloudGetPrescriptions();
            cloudList.forEach(p => cloudMap.set(p.id, p));
        } catch (e) { console.warn('push: 拉取云端列表失败，按无冲突推送', e); }
        let pushed = 0;
        for (const r of rows) {
            const p = r.prescription;
            try {
                if (r.deleted) {
                    if (cloudMap.has(p.id)) await this._cloudDeletePrescription(p.id);
                    await LocalDB.markSynced(p.id);
                } else {
                    const cloudP = cloudMap.get(p.id);
                    const localMs = new Date(p.updatedAt || 0).getTime() || 0;
                    const cloudMs = cloudP ? (new Date(cloudP.updatedAt || 0).getTime() || 0) : 0;
                    if (cloudP && cloudMs > localMs) {
                        await LocalDB.upsertPrescription(cloudP, { synced: 1, deleted: 0 });
                    } else {
                        const resp = await this._cloudPostPrescription(p);
                        if (resp && resp.success) {
                            const saved = resp.savedPrescription || p;
                            if (saved.id && saved.id !== p.id) {
                                await LocalDB.upsertPrescription(saved, { synced: 1, deleted: 0 });
                                try { await LocalDB.markDeleted(p.id); } catch (e) {}
                            } else {
                                await LocalDB.upsertPrescription(saved, { synced: 1, deleted: 0 });
                            }
                            pushed++;
                        }
                    }
                }
            } catch (e) {
                console.warn('push: 处方 ' + p.id + ' 失败，保留待同步:', e);
            }
        }
        await LocalDB.setSyncStatus('push', await LocalDB.countUnsynced());
        return pushed;
    },
    async pull() {
        let cloudList = [];
        try { cloudList = await this._cloudGetPrescriptions(); } catch (e) { console.warn('pull: 拉取失败', e); return; }
        let localMap = new Map();
        try {
            const localList = await LocalDB.getPrescriptions(currentUser.username);
            if (Array.isArray(localList)) {
                localList.forEach(p => localMap.set(p.id, p));
            }
        } catch (e) { console.warn('pull: 获取本地列表失败', e); }
        for (const cp of cloudList) {
            try {
                const localP = localMap.get(cp.id);
                const cloudMs = new Date(cp.updatedAt || 0).getTime() || 0;
                if (!localP) {
                    await LocalDB.upsertPrescription(cp, { synced: 1, deleted: 0 });
                } else {
                    const localMs = new Date(localP.updatedAt || 0).getTime() || 0;
                    if (localMs < cloudMs) {
                        const localNo = localP.prescriptionNo || localP.outpatientNo || '';
                        const cloudNo = cp.prescriptionNo || cp.outpatientNo || '';
                        if (localNo && cloudNo && localNo !== cloudNo && localNo.startsWith('LOCAL-')) {
                            if (window.electronAPI && window.electronAPI.renameMediaFiles) {
                                window.electronAPI.renameMediaFiles(localP.patientName || '', localP.patientName || '', localNo, cloudNo)
                                    .then(r => {
                                        if (r.success && r.renamed > 0) {
                                            console.log('pull: 重命名媒体文件 ' + localNo + ' -> ' + cloudNo + ': ' + r.renamed + ' 个');
                                        }
                                    })
                                    .catch(e => console.warn('pull: 重命名媒体文件失败:', e));
                            }
                        }
                        await LocalDB.upsertPrescription(cp, { synced: 1, deleted: 0 });
                    }
                }
            } catch (e) { console.warn('pull: 处方 ' + cp.id + ' 失败', e); }
        }
        await Promise.all([
            this._pullCache('medicines_all', CLOUD_API_BASE + '/medicines'),
            this._pullCache('formulas_all', CLOUD_API_BASE + '/formulas')
        ]);
    },
    init() {
        if (this._inited) return;
        this._inited = true;
        this._consecutiveFailures = 0;
        window.addEventListener('online', () => {
            this._consecutiveFailures = 0;
            setTimeout(() => SyncEngine.run(), 800);
        });
        const isNormalUser = currentUser && !isClinicAdmin(currentUser) && !isPlatformAdmin(currentUser);
        const syncInterval = isNormalUser ? 3600000 : 60000;
        if (!isNormalUser) {
            document.addEventListener('visibilitychange', () => {
                if (!document.hidden && navigator.onLine) SyncEngine.run();
            });
        }
        this._timer = setInterval(() => { if (navigator.onLine) SyncEngine.run(); }, syncInterval);
        if (navigator.onLine) {
            setTimeout(() => SyncEngine.run(), 1000);
        }
    }
};
