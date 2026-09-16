'use strict';
// ============================================================================
// hot-update-core.cjs — 桌面端静默热更新核心【唯一权威源 · 纯逻辑零 Electron 依赖】
//
// ★ 2026-09-14 重建热更新（旧版 22343bc5 于 2026-08-17 因「无验签的裸远程代码
//   加载」被整体移除）。本模块与旧版的本质区别——三道门禁 + 全程回退：
//   ① Ed25519 验签（version.json 清单签名，私钥仅存发布方本机/Cloudflare Secrets，
//     公钥常量内置下方，与 license v7 同一信任根——复用同一对密钥）
//   ② 逐文件 SHA256 哈希门禁：下载后校验 + 每次启动 resolveEntry 全量复验
//   ③ 任何一关失败 → 静默回退 asar 打包版（asar 永不改动 → fuse 完整性/
//     .bnzc 双哈希/Pre-build 探针链全部保持有效），坏目录隔离留现场
//
// 设计要点：
//   - 逐文件清单下载（放弃 zip）：零解压依赖、天然增量（本地已有同哈希文件
//     直接复制，只下载真正变更的文件）、每文件独立校验
//   - config.json 绝不进热包（含密码哈希 + configSignature 配置签名）：
//     由 desktop-windows.cjs 在热入口生效时从 asar 复制模板（行为与
//     打包版同步 XHR 完全等价，运行时权威仍是 userData 覆盖层）
//   - 纯函数模块（仅注入 fetchImpl/dataDir/baseUrl）→ 可脱离 Electron 单测
//   - 组装方：shared/update-manager.cjs（注入 net.fetch + userData）；
//     接线方：shared/desktop-windows.cjs（resolveHotEntry + checkHotUpdate）
//
// 目录布局（userData 下）：
//   hot-update/current/          当前生效热目录（含 manifest.json + 全部文件）
//   hot-update/previous/         上一份稳定热版本（swap 保留，本地回退目标）
//   hot-update/pending-<ver>/    下载中目录（swap 成功才晋升 current）
//   hot-update/.hot-version      本地已生效版本 {hotVersion, signedAt}
//   hot-update/.hot-blacklist    坏版本黑名单（回退时记录，checkUpdate 拒绝重灌）
//   hot-update/quarantine-<ts>/  启动复验失败/被回退的坏 current（隔离留现场，不动 asar）
//
// ★ 2026-09-16 Layer 1 本地回退（与服务端 Layer 0 重签回滚闭环互补）：
//   门禁验的是「完整性」≠「正确性」——签名哈希全过但内容有 bug 的热包，
//   客户端仅剩 asar 兜底会丢掉全部热更收益；离线客户更收不到服务端回滚包。
//   本地回退三件套：①swap 保留 previous（~3MB，磁盘换秒级恢复）；②坏版本
//   黑名单（rollbackLocal 记录 + checkUpdate 拒绝重灌同一 hotVersion；Layer 0
//   重签发布=新版本号天然不命中黑名单，两通道零冲突）；③rollbackLocal 手动/
//   自动回退（previous 复验通过→晋升 current；否则回 asar 打包版）+ 登录窗
//   「回退上一版」入口（login.html 属 asar 域，不依赖热版本页面存活）。
//
// 分发链：shared/ 权威源 → sync-all.ps1 Group 12（与 update-manager.cjs 同组）
// → 两个 electron/ 目录；copy-consistency.cjs 同组硬哈希门；build.files
// electron/**/* 已覆盖。改动本文件必须跑 sync-all.ps1 同步双端副本。
// ============================================================================

const crypto = require('crypto');
const fsSync = require('fs');
const path = require('path');

// ★ Ed25519 验签公钥（PEM SPKI）——与 shared/license/license-manager.js 的
//   ED25519_VERIFY_PUBLIC_KEY_PEM 同一信任根（同一把私钥签发）。公钥只能验签
//   不能签发，即使被反编译提取也无法伪造热更新清单。轮换密钥时两处同步更新。
const HOT_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAIsLN/+7riDHGQj8GAJBeU9kuSGXgVEiUYqvTlrbP2rw=
-----END PUBLIC KEY-----`;

// 热包文件名白名单（纵深防御：即使验签实现出 bug 也不允许路径穿越/注入）
const SAFE_NAME_RE = /^[A-Za-z0-9_.\/-]+$/;

// ---------------------------------------------------------------------------
// 纯工具（生成工具 tools/generate-desktop-hotupdate.cjs 与客户端共用同一算法）
// ---------------------------------------------------------------------------

// 规范化签名消息（必须与 generate-desktop-hotupdate.cjs buildSignMessage 完全一致）
function buildSignMessage(channel, hotVersion, signedAt, files) {
    const parts = files.map(function (f) { return f.name + ':' + f.sha256 + ':' + f.size; });
    return 'desktop-hotupdate-v1|' + channel + '|' + hotVersion + '|' + signedAt + '|' + parts.join('|');
}

// Ed25519 验签（fail-closed：任何异常/格式不符一律拒绝）
function verifyHotManifest(manifest) {
    try {
        if (!manifest || typeof manifest !== 'object') return false;
        if (manifest.format !== 1) return false;
        if (typeof manifest.channel !== 'string' || !manifest.channel) return false;
        if (typeof manifest.hotVersion !== 'string' || !/^\d{4}\.\d{2}\.\d{2}-\d+$/.test(manifest.hotVersion)) return false;
        if (typeof manifest.signedAt !== 'number' || !isFinite(manifest.signedAt)) return false;
        if (typeof manifest.signature !== 'string' || manifest.signature.length > 200) return false;
        if (!Array.isArray(manifest.files) || manifest.files.length === 0 || manifest.files.length > 50) return false;
        for (let i = 0; i < manifest.files.length; i++) {
            const f = manifest.files[i];
            if (!f || typeof f.name !== 'string' || !SAFE_NAME_RE.test(f.name) || f.name.indexOf('..') >= 0) return false;
            if (!/^[0-9a-f]{64}$/.test(String(f.sha256))) return false;
            if (typeof f.size !== 'number' || f.size <= 0 || f.size > 20 * 1048576) return false;
        }
        const msg = buildSignMessage(manifest.channel, manifest.hotVersion, manifest.signedAt, manifest.files);
        return crypto.verify(null, Buffer.from(msg, 'utf8'), crypto.createPublicKey(HOT_PUBLIC_KEY_PEM), Buffer.from(manifest.signature, 'base64'));
    } catch (e) {
        return false;
    }
}

// 流式 SHA256（启动全量复验 ~3MB 毫秒级）
function sha256FileSync(fp) {
    const h = crypto.createHash('sha256');
    const buf = fsSync.readFileSync(fp);   // 文件上限 20MB（manifest 门禁），全量读安全
    h.update(buf);
    return h.digest('hex');
}

// ---------------------------------------------------------------------------
// 热更新管理器（依赖全部注入：fetchImpl / dataDir / baseUrl）
// ---------------------------------------------------------------------------

function createHotManager(deps) {
    const fetchImpl = deps.fetchImpl;          // (url, opts) => Promise<Response>
    const dataDir = deps.dataDir;              // userData 绝对路径
    const baseUrl = String(deps.baseUrl || '').replace(/\/+$/, ''); // …/hot-update/desktop/<channel>
    if (typeof fetchImpl !== 'function' || !dataDir) {
        throw new Error('[hot-update] fetchImpl / dataDir 必填');
    }

    const hotDir = path.join(dataDir, 'hot-update');
    const currentDir = path.join(hotDir, 'current');
    const previousDir = path.join(hotDir, 'previous');
    const blacklistPath = path.join(hotDir, '.hot-blacklist');
    let hotBusy = false;   // 防重入（一次启动只跑一轮静默检查）

    // ---- 磁盘小工具 ----
    function rmrf(dir) {
        try { fsSync.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* best-effort */ }
    }
    function readLocalVersion() {
        try {
            const raw = fsSync.readFileSync(path.join(hotDir, '.hot-version'), 'utf8');
            const v = JSON.parse(raw);
            if (v && typeof v.hotVersion === 'string' && typeof v.signedAt === 'number') return v;
        } catch (e) { /* 无本地版本 = 首次热更 */ }
        return null;
    }
    function writeLocalVersion(v) {
        try {
            fsSync.mkdirSync(hotDir, { recursive: true });
            fsSync.writeFileSync(path.join(hotDir, '.hot-version'), JSON.stringify(v), 'utf8');
        } catch (e) { console.warn('[hot-update] 写 .hot-version 失败:', e && e.message); }
    }

    // ---- 坏版本黑名单（回退时记录；checkUpdate 拒绝重新拉取同一 hotVersion）----
    function readBlacklist() {
        try {
            const arr = JSON.parse(fsSync.readFileSync(blacklistPath, 'utf8'));
            if (Array.isArray(arr)) {
                return arr.filter(function (x) { return x && typeof x.hotVersion === 'string'; });
            }
        } catch (e) { /* 无文件/损坏 = 空黑名单 */ }
        return [];
    }
    function isBlacklisted(hotVersion) {
        if (!hotVersion) return false;
        const list = readBlacklist();
        for (let i = 0; i < list.length; i++) {
            if (list[i].hotVersion === hotVersion) return true;
        }
        return false;
    }
    function addToBlacklist(hotVersion, signedAt, reason) {
        try {
            const list = readBlacklist().filter(function (x) { return x.hotVersion !== hotVersion; });
            list.push({ hotVersion: hotVersion, signedAt: signedAt || 0, reason: reason || 'manual', at: Date.now() });
            while (list.length > 5) list.shift();   // 上限 5 条，最旧的先淘汰
            fsSync.mkdirSync(hotDir, { recursive: true });
            fsSync.writeFileSync(blacklistPath, JSON.stringify(list), 'utf8');
        } catch (e) { console.warn('[hot-update] 写黑名单失败（不阻断回退）:', e && e.message); }
    }

    // 目录全量复验：manifest 验签 + 入口存在 + 逐文件大小/哈希（resolveEntry /
    //   rollbackLocal 恢复 previous / checkUpdate pending 复验共用同一把尺子）
    function verifyHotDir(dir, manifest) {
        if (!verifyHotManifest(manifest)) return false;
        if (!fsSync.existsSync(path.join(dir, 'index.html'))) return false;
        for (let i = 0; i < manifest.files.length; i++) {
            const f = manifest.files[i];
            const fp = path.join(dir, f.name);
            if (!fsSync.existsSync(fp) || fsSync.statSync(fp).size !== f.size
                || sha256FileSync(fp) !== f.sha256) {
                return false;
            }
        }
        return true;
    }

    // ---- 启动复验（同步，主窗口 loadFile 前调用）----
    // 返回 current/index.html 绝对路径；任何一关失败把坏 current 隔离后返回 null。
    // ★ Layer 1：current 版本命中黑名单 → 自动回退（previous 复验通过晋升 current，
    //   否则回 asar），回退后对恢复的 current 重新走完整复验。
    function resolveEntry() {
        try {
            const manifestPath = path.join(currentDir, 'manifest.json');
            if (!fsSync.existsSync(manifestPath)) return null;
            const manifest = JSON.parse(fsSync.readFileSync(manifestPath, 'utf8'));
            if (!verifyHotManifest(manifest)) {
                quarantineCurrent('bad-signature');
                return null;
            }
            if (isBlacklisted(manifest.hotVersion)) {
                console.warn('[hot-update] current ' + manifest.hotVersion + ' 已被本机拉黑，自动本地回退');
                const r = rollbackLocal('auto-blacklisted');
                if (r && r.ok && r.restored === 'previous') return resolveEntry();
                return null;
            }
            if (!verifyHotDir(currentDir, manifest)) {
                quarantineCurrent('hash-mismatch');
                return null;
            }
            return path.join(currentDir, 'index.html');
        } catch (e) {
            console.warn('[hot-update] resolveEntry 异常，回退打包版:', e && e.message);
            return null;
        }
    }

    function quarantineCurrent(reason) {
        try {
            console.warn('[hot-update] 热目录复验失败(' + reason + ')，隔离并回退 asar 打包版');
            if (fsSync.existsSync(currentDir)) {
                const q = path.join(hotDir, 'quarantine-' + Date.now());
                try { fsSync.renameSync(currentDir, q); } catch (e) { rmrf(currentDir); }
            }
        } catch (e) { /* best-effort */ }
    }

    // ---- Layer 1 本地回退（登录窗「回退上一版」入口 / 黑名单自动恢复共用）----
    // 同步磁盘操作：拉黑 current → previous 全量复验通过则晋升 current（恢复其
    // .hot-version），否则隔离 current 回 asar 打包版。返回值：
    //   {ok:true, restored:'previous', hotVersion}  已恢复上一稳定热版本
    //   {ok:true, restored:'builtin'}               无可用 previous，回 asar 版
    //   {ok:false, reason}                          无热版本在效等
    function rollbackLocal(reason) {
        try {
            const manifestPath = path.join(currentDir, 'manifest.json');
            if (!fsSync.existsSync(manifestPath)) return { ok: false, reason: 'no-current' };
            let manifest = null;
            try { manifest = JSON.parse(fsSync.readFileSync(manifestPath, 'utf8')); } catch (e) { /* 损坏按未知版本拉黑 */ }
            const hv = manifest && typeof manifest.hotVersion === 'string' ? manifest.hotVersion : 'unknown';
            const signedAt = manifest && typeof manifest.signedAt === 'number' ? manifest.signedAt : 0;
            addToBlacklist(hv, signedAt, reason || 'manual');

            // previous 复验通过 → 晋升 current（隔离坏 current 留现场）
            const prevManifestPath = path.join(previousDir, 'manifest.json');
            if (fsSync.existsSync(prevManifestPath)) {
                let prevManifest = null;
                try { prevManifest = JSON.parse(fsSync.readFileSync(prevManifestPath, 'utf8')); } catch (e) { /* 下面的复验会拒 */ }
                if (prevManifest && verifyHotDir(previousDir, prevManifest)) {
                    quarantineCurrent('rollback:' + hv);
                    fsSync.renameSync(previousDir, currentDir);
                    writeLocalVersion({ hotVersion: prevManifest.hotVersion, signedAt: prevManifest.signedAt });
                    console.log('[hot-update] ✅ 已本地回退到 ' + prevManifest.hotVersion + '（拉黑 ' + hv + '）');
                    return { ok: true, restored: 'previous', hotVersion: prevManifest.hotVersion };
                }
                console.warn('[hot-update] previous 复验失败，跳过恢复直接回 asar 打包版');
            }
            quarantineCurrent('rollback:' + hv);
            try { fsSync.rmSync(path.join(hotDir, '.hot-version'), { force: true }); } catch (e) { /* best-effort */ }
            console.log('[hot-update] ✅ 已本地回退到 asar 打包版（拉黑 ' + hv + '）');
            return { ok: true, restored: 'builtin' };
        } catch (e) {
            console.warn('[hot-update] 本地回退异常:', e && e.message);
            return { ok: false, reason: 'error:' + (e && e.message) };
        }
    }

    // 登录窗回退入口探测：current 验签通过且未拉黑 = 热版本在效（可显示回退按钮）
    function getActiveHotState() {
        try {
            const manifestPath = path.join(currentDir, 'manifest.json');
            if (!fsSync.existsSync(manifestPath)) return { active: false };
            const manifest = JSON.parse(fsSync.readFileSync(manifestPath, 'utf8'));
            if (!verifyHotManifest(manifest) || isBlacklisted(manifest.hotVersion)) return { active: false };
            return {
                active: true,
                hotVersion: manifest.hotVersion,
                hasPrevious: fsSync.existsSync(path.join(previousDir, 'manifest.json'))
            };
        } catch (e) {
            return { active: false };
        }
    }

    // ---- 静默检查 + 下载 + swap（登录窗 dom-ready 后后台跑，绝不打断使用）----
    async function checkUpdate(onApplied) {
        if (hotBusy) return;
        hotBusy = true;
        let pendingDir = null;
        try {
            const res = await fetchImpl(baseUrl + '/version.json', { signal: AbortSignal.timeout(15000) });
            if (!res.ok) { console.log('[hot-update] 检查跳过: HTTP ' + res.status); return; }
            const manifest = await res.json();
            if (!verifyHotManifest(manifest)) { console.warn('[hot-update] version.json 验签失败（fail-closed 跳过）'); return; }

            // ★ Layer 1：线上版本被本机拉黑（曾触发本地回退）→ 拒绝重灌同一坏版本。
            //   Layer 0 服务端回滚=旧内容重签新版本号，不命中黑名单，两通道零冲突。
            if (isBlacklisted(manifest.hotVersion)) {
                console.warn('[hot-update] 线上版本 ' + manifest.hotVersion + ' 已被本机拉黑，跳过下载');
                return;
            }

            const local = readLocalVersion();
            if (local && (manifest.hotVersion === local.hotVersion || manifest.signedAt <= local.signedAt)) {
                console.log('[hot-update] 热版本已是最新 ' + manifest.hotVersion);
                return;
            }
            console.log('[hot-update] 发现新热版本 ' + manifest.hotVersion + '（本地 ' + (local ? local.hotVersion : '无') + '），开始静默下载');

            // 逐文件下载/复制到 pending（增量：本地 current 同哈希文件直接复制）
            pendingDir = path.join(hotDir, 'pending-' + manifest.hotVersion);
            rmrf(pendingDir);
            fsSync.mkdirSync(pendingDir, { recursive: true });
            for (let i = 0; i < manifest.files.length; i++) {
                const f = manifest.files[i];
                const dst = path.join(pendingDir, f.name);
                fsSync.mkdirSync(path.dirname(dst), { recursive: true });
                const cur = path.join(currentDir, f.name);
                if (fsSync.existsSync(cur) && fsSync.statSync(cur).size === f.size && sha256FileSync(cur) === f.sha256) {
                    fsSync.copyFileSync(cur, dst);   // 增量复用，免下载
                    continue;
                }
                let buf = null;
                for (let attempt = 1; attempt <= 3; attempt++) {
                    try {
                        const fr = await fetchImpl(baseUrl + '/' + encodeURI(f.name), { signal: AbortSignal.timeout(30000) });
                        if (!fr.ok) throw new Error('HTTP ' + fr.status);
                        buf = Buffer.from(await fr.arrayBuffer());
                        break;
                    } catch (e) {
                        if (attempt >= 3) throw new Error('下载失败 ' + f.name + ': ' + (e && e.message));
                        await new Promise(function (r) { setTimeout(r, 800 * attempt); });
                    }
                }
                if (buf.length !== f.size || crypto.createHash('sha256').update(buf).digest('hex') !== f.sha256) {
                    throw new Error('哈希校验失败 ' + f.name);
                }
                fsSync.writeFileSync(dst, buf);
            }

            // pending 全量复验（防下载过程中磁盘异常）+ 写 manifest 副本
            if (!verifyHotDir(pendingDir, manifest)) throw new Error('pending 复验失败');
            fsSync.writeFileSync(path.join(pendingDir, 'manifest.json'), JSON.stringify(manifest));

            // 原子 swap：current → previous（★ Layer 1 保留一份供本地回退，~3MB）；
            //   pending → current。swap 失败把 previous 还原回 current（坏 pending
            //   绝不污染 current），与黑名单/回退共同构成「坏版本可及时恢复」闭环。
            rmrf(previousDir);
            if (fsSync.existsSync(currentDir)) fsSync.renameSync(currentDir, previousDir);
            try {
                fsSync.renameSync(pendingDir, currentDir);
            } catch (e) {
                if (fsSync.existsSync(previousDir)) fsSync.renameSync(previousDir, currentDir);
                throw e;
            }
            pendingDir = null;
            writeLocalVersion({ hotVersion: manifest.hotVersion, signedAt: manifest.signedAt });
            console.log('[hot-update] ✅ 新热版本 ' + manifest.hotVersion + ' 已就绪，下次启动生效');
            if (typeof onApplied === 'function') { try { onApplied(manifest.hotVersion); } catch (e) { /* 通知失败不影响主流程 */ } }
        } catch (e) {
            console.warn('[hot-update] 静默更新失败（保持 current 不变，下次启动回退旧版/asar 版）:', e && e.message);
            if (pendingDir) rmrf(pendingDir);
        } finally {
            hotBusy = false;
        }
    }

    return {
        resolveEntry: resolveEntry,
        checkUpdate: checkUpdate,
        // ★ Layer 1 本地回退：登录窗「回退上一版」按钮触发（同步，毫秒级）
        rollbackLocal: rollbackLocal,
        // 登录窗回退入口探测：{active, hotVersion, hasPrevious}
        getActiveHotState: getActiveHotState,
        verifyHotManifest: verifyHotManifest
    };
}

module.exports = {
    HOT_PUBLIC_KEY_PEM: HOT_PUBLIC_KEY_PEM,
    buildSignMessage: buildSignMessage,
    verifyHotManifest: verifyHotManifest,
    sha256FileSync: sha256FileSync,
    createHotManager: createHotManager
};
