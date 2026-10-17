// ============================================================================
//  punch-cache-test.cjs — 打卡聚合缓存增量更新回归（mock KV，零网络）
//
//  背景（本日分析与修复）：punchLogin 原先 `delete(lpcur:{month})` 作废当月聚合缓存 →
//  管理员下次打开诊所列表必触发 aggregateMonthRawKeys('lp:{month}-') 对全月原始打卡键
//  做 listAllKeys —— 这是 KV「每日 list 1000 次」被打满的隐藏消耗源（曾致 Cloudflare 降级）。
//  现改为【只更新缓存里本诊所的计数】，不再删除、不再引发全月 list。
//
//  断言：
//    A) 缓存存在 → 对应端类型桶 +1、key 仍在（未被删）、零 delete、零 list
//    B) 缓存缺失/结构异常 → 不新建缓存（交列表侧按 TTL 自建）
//    C) 同日重复打卡 → 早退，不重复 +1
//    D) lp_start 仅在缺失时写一次
//
//  用法: node e2e/.tmp/punch-cache-test.cjs   （退出码 0=全过）
// ============================================================================
const path = require('path');

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
    if (cond) { console.log('  PASS  ' + name); pass++; }
    else { console.log('  FAIL  ' + name + (extra ? '  -> ' + extra : '')); fail++; }
};

function makeKV(seed = {}) {
    const m = new Map(Object.entries(seed));
    const stats = { get: 0, put: 0, del: 0, list: 0 };
    return {
        _m: m, _stats: stats,
        async get(k, type) {
            stats.get++;
            if (!m.has(k)) return null;
            const v = m.get(k);
            return type === 'json' ? (typeof v === 'string' ? JSON.parse(v) : v) : v;
        },
        async put(k, v) { stats.put++; m.set(k, v); },
        async delete(k) { stats.del++; m.delete(k); },
        async list(o = {}) { stats.list++; const p = o.prefix || ''; return { keys: [...m.keys()].filter(x => x.startsWith(p)).map(name => ({ name })), list_complete: true }; }
    };
}

const enc = (s) => encodeURIComponent(s);
const CLINIC = '中医诊所·2222';
const UID = '13398222222';

(async () => {
    const { pathToFileURL } = require('url');
    const mod = await import(pathToFileURL(path.join(__dirname, '..', '..', 'functions', 'api', '_lib', 'login-punch.js')).href);
    const punchLogin = mod.punchLogin;

    // 自行计算当月键（与实现同口径：北京时间）
    const bj = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 7);
    const CUR = `lpcur:${bj}`;

    // ---------- A) 缓存存在 → 增量更新，不删不 list ----------
    console.log('--- A) 缓存存在：增量 +1、不删缓存、零 list ---');
    {
        const cache = { builtAt: new Date().toISOString(), c: { [enc(CLINIC)]: { d: 3, a: 1, w: 0 } } };
        const kv = makeKV({ [CUR]: JSON.stringify(cache), lp_start: '2026-09-01' });
        await punchLogin(kv, { clinicName: CLINIC, clientClass: 'desktop', uid: UID });
        const after = JSON.parse(kv._m.get(CUR));
        ok('★ 缓存键仍在（未被删除）', kv._m.has(CUR), 'missing');
        ok('★ delete 调用 = 0', kv._stats.del === 0, 'del=' + kv._stats.del);
        ok('★ list 调用 = 0（不再引发全月扫描）', kv._stats.list === 0, 'list=' + kv._stats.list);
        ok('★ 对应端类型桶 +1（desktop → d：3 → 4）', after.c[enc(CLINIC)].d === 4, JSON.stringify(after.c[enc(CLINIC)]));
        ok('其他桶保持不变', after.c[enc(CLINIC)].a === 1 && after.c[enc(CLINIC)].w === 0, JSON.stringify(after.c[enc(CLINIC)]));
        ok('builtAt 未被重置（不伪造新鲜度）', after.builtAt === cache.builtAt);
    }

    // ---------- A2) app 端 → a 桶 ----------
    console.log('\n--- A2) app 端落到 a 桶 ---');
    {
        const cache = { builtAt: new Date().toISOString(), c: { [enc(CLINIC)]: { d: 0, a: 0, w: 0 } } };
        const kv = makeKV({ [CUR]: JSON.stringify(cache), lp_start: '2026-09-01' });
        await punchLogin(kv, { clinicName: CLINIC, clientClass: 'app', uid: UID + 'x' });
        const after = JSON.parse(kv._m.get(CUR));
        ok('a 桶 +1', after.c[enc(CLINIC)].a === 1, JSON.stringify(after.c[enc(CLINIC)]));
        ok('delete = 0', kv._stats.del === 0);
    }

    // ---------- B) 缓存缺失 → 不新建 ----------
    console.log('\n--- B) 缓存缺失：不新建半成品缓存 ---');
    {
        const kv = makeKV({ lp_start: '2026-09-01' });
        await punchLogin(kv, { clinicName: CLINIC, clientClass: 'desktop', uid: UID + 'b' });
        ok('未创建 lpcur 键', !kv._m.has(CUR), JSON.stringify([...kv._m.keys()]));
        ok('打卡凭证已写', [...kv._m.keys()].some(k => k.indexOf('lp:') === 0), JSON.stringify([...kv._m.keys()]));
        ok('零 delete / 零 list', kv._stats.del === 0 && kv._stats.list === 0);
    }

    // ---------- B2) 结构异常 → 不误写 ----------
    console.log('\n--- B2) 缓存结构异常：不误写 ---');
    {
        const kv = makeKV({ [CUR]: JSON.stringify({ c: { x: 1 } }) });   // 缺 builtAt
        await punchLogin(kv, { clinicName: CLINIC, clientClass: 'desktop', uid: UID + 'c' });
        ok('异常缓存未被改写', kv._m.get(CUR) === JSON.stringify({ c: { x: 1 } }), kv._m.get(CUR));
    }

    // ---------- C) 同日重复打卡 → 早退不重复计数 ----------
    console.log('\n--- C) 同日重复打卡：不重复 +1 ---');
    {
        const cache = { builtAt: new Date().toISOString(), c: { [enc(CLINIC)]: { d: 1, a: 0, w: 0 } } };
        const kv = makeKV({ [CUR]: JSON.stringify(cache), lp_start: '2026-09-01' });
        await punchLogin(kv, { clinicName: CLINIC, clientClass: 'desktop', uid: UID + 'd' });
        const mid = JSON.parse(kv._m.get(CUR)).c[enc(CLINIC)].d;
        await punchLogin(kv, { clinicName: CLINIC, clientClass: 'desktop', uid: UID + 'd' });
        const end = JSON.parse(kv._m.get(CUR)).c[enc(CLINIC)].d;
        ok('首次 +1', mid === 2, 'mid=' + mid);
        ok('★ 第二次不再 +1', end === 2, 'end=' + end);
    }

    // ---------- D) lp_start 仅缺失时写一次 ----------
    console.log('\n--- D) lp_start 幂等 ---');
    {
        const cache = { builtAt: new Date().toISOString(), c: { [enc(CLINIC)]: { d: 0, a: 0, w: 0 } } };
        const kv = makeKV({ [CUR]: JSON.stringify(cache) });   // 无 lp_start
        await punchLogin(kv, { clinicName: CLINIC, clientClass: 'desktop', uid: UID + 'e' });
        ok('lp_start 已写入', !!kv._m.get('lp_start'), String(kv._m.get('lp_start')));
        const before = kv._stats.put;
        await punchLogin(kv, { clinicName: CLINIC, clientClass: 'desktop', uid: UID + 'f' });
        ok('已有 lp_start 时不重复写（put 增量仅打卡凭证+缓存）', kv._stats.put - before <= 2, 'Δput=' + (kv._stats.put - before));
    }

    console.log('\n=== 结果: ' + pass + ' 通过, ' + fail + ' 失败 ===');
    process.exit(fail === 0 ? 0 : 1);
})();
