// ============================================================================
//  first-activation-perf-test.mjs — 新设备首激"单次全扫"回归（mock KV，零网络）
//
//  事故（2026-10-13 Mate40 保时捷真机）：新机器 claim 服务端 33s（detach
//  串行全扫 166 码 + saveLicense 内 addMidOwner 键缺失再全扫一遍），离线 App
//  客户端 12s 超时 → 码一直 unused、客户无法激活。
//
//  本测试证明：
//    P1 listLicenses 分批并行后顺序与串行一致、缺失记录被过滤
//    P2 新机器 detach(backfillOwners) 全扫后 mid_owners 落 []，单值索引不被回填
//    P3 detach 之后 saveLicense 不再触发第二次 license 全扫（关键：33s→秒级）
//    P4 端到端新机器 claim：license 记录全表 get 恰好一遍
//    P5 已绑定机器（owners 存在）claim：零全扫
// ============================================================================
import {
    findLicensesByMachine, saveLicense, detachDeviceFromOtherLicenses,
    listLicenses, getLicense
} from '../../functions/api/license/_lib/license-core.js';
import { onRequest as claimOnRequest } from '../../functions/api/license/validate.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
    if (cond) { console.log('  PASS  ' + name); pass++; }
    else { console.log('  FAIL  ' + name + (extra ? '  -> ' + extra : '')); fail++; }
};

function makeKV(seed = {}) {
    const m = new Map(Object.entries(seed));
    const stats = { list: 0, get: 0, put: 0, del: 0, licenseGets: new Set() };
    return {
        _m: m, _stats: stats,
        async get(k, type) {
            stats.get++;
            if (String(k).startsWith('license:')) stats.licenseGets.add(k);
            if (!m.has(k)) return null;
            const v = m.get(k);
            return type === 'json' ? (typeof v === 'string' ? JSON.parse(v) : v) : v;
        },
        async put(k, v) { stats.put++; m.set(k, v); },
        async delete(k) { stats.del++; m.delete(k); },
        async list(o = {}) {
            stats.list++;
            const p = o.prefix || '';
            return { keys: [...m.keys()].filter(k => k.startsWith(p)).map(name => ({ name })), list_complete: true };
        }
    };
}

const MID = 'b'.repeat(32);
const OWNER = 'BNZC-AAAA-AAAA-AAAA-AAAA';
function seedMany(kv, n = 166, holes = [3, 77, 165]) {
    const codes = [];
    for (let i = 0; i < n; i++) {
        const c = 'BNZC-P' + String(i).padStart(3, '0') + '-AAAA-AAAA-AAAA';
        if (!holes.includes(i)) {
            kv._m.set('license:' + c, JSON.stringify({ code: c, user: 'X', type: 'personal', status: 'used', maxDevices: 5, devices: [] }));
            codes.push(c);
        }
    }
    // 索引保持含洞的原始顺序（模拟已删除记录）
    const idx = [];
    for (let i = 0; i < n; i++) idx.push('BNZC-P' + String(i).padStart(3, '0') + '-AAAA-AAAA-AAAA');
    kv._m.set('system:license_index', JSON.stringify(idx));
    return { codes, holes: holes.map(i => 'BNZC-P' + String(i).padStart(3, '0') + '-AAAA-AAAA-AAAA') };
}

// ---- P1 listLicenses 保序 + 过滤缺失 ----
console.log('--- P1 listLicenses 并行版保序/过滤 ---');
{
    const kv = makeKV();
    const { codes, holes } = seedMany(kv);
    const recs = await listLicenses(kv);
    ok('记录数=索引数-缺失数', recs.length === codes.length, 'got ' + recs.length);
    ok('顺序与索引（跳过缺失）逐位一致', recs.every((r, i) => r.code === codes[i]), '顺序漂移');
    ok('缺失码不出现在结果', holes.every(h => !recs.some(r => r.code === h)));
}

// ---- P2 新机器 detach：全扫 + owners 回填 []，单值索引不写 ----
console.log('--- P2 新机器 detach backfillOwners ---');
{
    const kv = makeKV();
    seedMany(kv);
    const r = await findLicensesByMachine(kv, MID, { forceScan: true, readOnly: true, backfillOwners: true });
    ok('无属主', r.length === 0);
    const owners = JSON.parse(kv._m.get('mid_owners:' + MID) ?? 'null');
    ok('★ mid_owners 回填为空数组 []', Array.isArray(owners) && owners.length === 0);
    ok('★ readOnly 下单值 mid_idx 不回填', !kv._m.has('mid_idx:' + MID));
}

// ---- P3 detach 后紧接 saveLicense：不再第二次全扫 ----
console.log('--- P3 detach + saveLicense 全表只扫一遍 ---');
{
    const kv = makeKV();
    const { codes } = seedMany(kv);
    // 目标码（含新设备）直接构造，模拟 validate L774-779 的 detach→saveLicense
    await detachDeviceFromOtherLicenses(kv, OWNER, MID);
    const afterDetach = kv._stats.licenseGets.size;
    ok('detach 全表扫一遍（=索引166条，含3个缺失洞）', afterDetach === 166,
        'detach licenseGets=' + afterDetach);
    await saveLicense(kv, {
        code: OWNER, user: 'X', type: 'personal', status: 'used', maxDevices: 1,
        devices: [{ machineId: MID, clientClass: 'app', activatedAt: '2026-10-13T00:00:00Z' }]
    });
    const afterSave = kv._stats.licenseGets.size;
    ok('★ saveLicense 不再全表扫（新增 license get ≤ 3）', afterSave - afterDetach <= 3,
        'Δ=' + (afterSave - afterDetach));
    const owners2 = JSON.parse(kv._m.get('mid_owners:' + MID) ?? 'null');
    ok('★ 集合最终含目标码', Array.isArray(owners2) && owners2.includes(OWNER), JSON.stringify(owners2));
}

// ---- P4 端到端新机器 claim：全表 get 恰好一遍 ----
console.log('--- P4 端到端：全新机器 claim 单次全扫 ---');
{
    const kv = makeKV();
    const { codes } = seedMany(kv);
    const CODE = 'BNZC-NEWM-AAAA-AAAA-AAAA';
    kv._m.set('license:' + CODE, JSON.stringify({
        code: CODE, user: '备货', type: 'personal', status: 'unused', maxDevices: 1,
        devices: [], days: 365, productClass: 'offline'
    }));
    const before = kv._stats.licenseGets.size;
    const ctx = {
        env: { KV: kv }, waitUntil: () => {},
        request: new Request('https://x/api/license/claim', {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '10.9.9.9' },
            body: JSON.stringify({ code: CODE, machineId: MID, user: 'X', phone: '13300000021', productClass: 'offline', clientClass: 'app' })
        }),
        waitUntil: () => {}
    };
    const resp = await claimOnRequest(ctx);
    const j = await resp.json();
    const scanned = kv._stats.licenseGets.size - before;
    ok('claim 成功', resp.status === 200 && j.success === true, JSON.stringify(j).slice(0, 160));
    ok('★ 全表 license get 只发生一遍（≤码数+5）', scanned <= codes.length + 5,
        'scanned=' + scanned + ' codes=' + codes.length);
    const rec = JSON.parse(kv._m.get('license:' + CODE));
    ok('码已 used 且设备已绑', rec.status === 'used' && rec.devices.some(d => d.machineId === MID));
    const owners3 = JSON.parse(kv._m.get('mid_owners:' + MID) ?? 'null');
    ok('mid_owners 含本码', Array.isArray(owners3) && owners3.includes(CODE));
}

// ---- P5 已绑机器重激：零全扫 ----
console.log('--- P5 已绑定机器 claim：无全表扫描 ---');
{
    const kv = makeKV();
    seedMany(kv);
    const CODE = 'BNZC-USED-AAAA-AAAA-AAAA';
    kv._m.set('license:' + CODE, JSON.stringify({
        code: CODE, user: '备货', type: 'personal', status: 'used', maxDevices: 1,
        devices: [{ machineId: MID, clientClass: 'app', activatedAt: '2026-10-13T00:00:00Z' }],
        days: 365, productClass: 'offline', activatedAt: '2026-10-13T00:00:00Z', expiresAt: '2027-10-13T00:00:00Z'
    }));
    kv._m.set('mid_owners:' + MID, JSON.stringify([CODE]));
    kv._m.set('mid_idx:' + MID, JSON.stringify(CODE));
    const before = kv._stats.licenseGets.size;
    const ctx = {
        env: { KV: kv }, waitUntil: () => {},
        request: new Request('https://x/api/license/claim', {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '10.9.9.9' },
            body: JSON.stringify({ code: CODE, machineId: MID, user: 'X', phone: '13300000022', productClass: 'offline', clientClass: 'app' })
        }),
        waitUntil: () => {}
    };
    const resp = await claimOnRequest(ctx);
    const j = await resp.json();
    const touched = kv._stats.licenseGets.size - before;
    ok('重激成功', resp.status === 200 && j.success === true, JSON.stringify(j).slice(0, 160));
    ok('★ 重激零全表扫描（license get ≤ 6）', touched <= 6, 'touched=' + touched);
}

console.log('\n=== 结果: ' + pass + ' 通过, ' + fail + ' 失败 ===');
process.exit(fail ? 1 : 0);
