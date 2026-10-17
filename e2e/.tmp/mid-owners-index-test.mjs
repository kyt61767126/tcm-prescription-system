// ============================================================================
//  mid-owners-index-test.mjs — 属主集合索引回归（mock KV，零网络）
//
//  背景（真机实测）：claim 响应 24~27s，旧客户端必然超时。根因是
//  detachDeviceFromOtherLicenses 为"穷尽属主码"强制全扫：1 条 list + 166 条 get。
//  本测试证明：换成 mid_owners:{mid} 集合索引后
//    · 读路径 list=0、get 降到个位数（原先 167）
//    · 穷尽性不回退（两个属主码全部返回；陈旧项被权威校验过滤）
//    · 键缺失自动全扫回填一次，此后 O(1)
//    · saveLicense 增量维护（加设备入集、删设备出集）
//    · 端到端 claim 的跨码解绑语义保持
//
//  用法: node e2e/.tmp/mid-owners-index-test.mjs   （退出码 0=全过）
// ============================================================================
import {
    findLicensesByMachine, saveLicense, detachDeviceFromOtherLicenses, getLicense
} from '../../functions/api/license/_lib/license-core.js';
import { onRequest as claimOnRequest } from '../../functions/api/license/validate.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
    if (cond) { console.log('  PASS  ' + name); pass++; }
    else { console.log('  FAIL  ' + name + (extra ? '  -> ' + extra : '')); fail++; }
};

function makeKV(seed = {}) {
    const m = new Map(Object.entries(seed));
    const stats = { list: 0, get: 0, put: 0, del: 0 };
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
        async list(o = {}) {
            stats.list++;
            const p = o.prefix || '';
            return { keys: [...m.keys()].filter(k => k.startsWith(p)).map(name => ({ name })), list_complete: true };
        }
    };
}

// 造 166 条 license（模拟真机规模：全扫=166 次 get）
const MID = 'a'.repeat(32);
const OWNER = 'BNZC-AAAA-AAAA-AAAA-AAAA';
const OTHER = 'BNZC-BBBB-BBBB-BBBB-BBBB';
const THIRD = 'BNZC-CCCC-CCCC-CCCC-CCCC';
function seedMany(kv, owners = [OWNER], extra = 165) {
    const mk = (code, withMid) => JSON.stringify({
        code, user: 'X', type: 'personal', status: 'used', maxDevices: 5,
        devices: withMid ? [{ machineId: MID, clientClass: 'desktop', activatedAt: '2026-10-01T00:00:00Z' }] : []
    });
    for (const c of owners) kv._m.set('license:' + c, mk(c, true));
    for (let i = 0; i < extra; i++) {
        const c = 'BNZC-P' + String(i).padStart(3, '0') + '-AAAA-AAAA-AAAA';
        kv._m.set('license:' + c, mk(c, false));
    }
    const codes = [...kv._m.keys()].filter(k => k.startsWith('license:')).map(k => k.slice(8));
    kv._m.set('system:license_index', JSON.stringify(codes));
}
const ownersOf = (kv) => JSON.parse(kv._m.get('mid_owners:' + MID) ?? 'null');

// ============ A) 索引存在 → O(1) ============
console.log('--- A) 属主集合存在：list=0、get 个位数 ---');
{
    const kv = makeKV({ ['mid_owners:' + MID]: JSON.stringify([OWNER]), ['mid_idx:' + MID]: JSON.stringify(OWNER) });
    seedMany(kv);
    const r = await findLicensesByMachine(kv, MID, { forceScan: true, readOnly: true });
    ok('命中唯一属主码', r.length === 1 && r[0].code === OWNER, JSON.stringify(r.map(x => x.code)));
    ok('★ list 调用 = 0（原先 1 条）', kv._stats.list === 0, 'list=' + kv._stats.list);
    ok('★ get 调用 ≤ 4（原先 166+ 次）', kv._stats.get <= 4, 'get=' + kv._stats.get);
    ok('未改动数据（readOnly）', kv._stats.put === 0, 'put=' + kv._stats.put);
}

// ============ B) 键缺失 → 全扫回填一次，此后 O(1) ============
console.log('\n--- B) 键缺失：全扫回填一次，第二次 O(1) ---');
{
    const kv = makeKV({ ['mid_idx:' + MID]: JSON.stringify(OWNER) });
    seedMany(kv);
    const r1 = await findLicensesByMachine(kv, MID, { forceScan: true });
    const g1 = kv._stats.get, l1 = kv._stats.list;
    ok('首次命中属主', r1.length === 1 && r1[0].code === OWNER);
    ok('首次确为全扫（get ≥ 160）', g1 >= 160, 'get=' + g1);
    ok('★ 回填属主集合', JSON.stringify(ownersOf(kv)) === JSON.stringify([OWNER]), JSON.stringify(ownersOf(kv)));
    kv._stats.get = 0; kv._stats.list = 0;
    const r2 = await findLicensesByMachine(kv, MID, { forceScan: true });
    ok('★ 第二次 list = 0', kv._stats.list === 0, 'list=' + kv._stats.list);
    ok('★ 第二次 get ≤ 4（O(1) 生效）', kv._stats.get <= 4, 'get=' + kv._stats.get);
    ok('结果一致', r2.length === 1 && r2[0].code === OWNER);
}

// ============ C) 穷尽性（P2-5）：两码同属 → 必须都返回 ============
console.log('\n--- C) 穷尽属主：两码同含该设备 → 全部返回 ---');
{
    const kv = makeKV({
        ['mid_owners:' + MID]: JSON.stringify([OWNER, OTHER]),
        ['mid_idx:' + MID]: JSON.stringify(OTHER)
    });
    seedMany(kv, [OWNER, OTHER]);
    const r = await findLicensesByMachine(kv, MID, { forceScan: true, readOnly: true });
    const got = r.map(x => x.code).sort();
    ok('★ 两个属主码都返回（不在首个命中处短路）',
        got.length === 2 && got.includes(OWNER) && got.includes(OTHER), JSON.stringify(got));
    ok('list = 0', kv._stats.list === 0, 'list=' + kv._stats.list);
}

// ============ D) 陈旧项被权威校验过滤 ============
console.log('\n--- D) 集合含陈旧码 → 权威校验过滤 ---');
{
    const kv = makeKV({
        ['mid_owners:' + MID]: JSON.stringify([OWNER, THIRD]),
        ['mid_idx:' + MID]: JSON.stringify(OWNER)
    });
    seedMany(kv, [OWNER]);   // THIRD 不在库/不含该设备
    const r = await findLicensesByMachine(kv, MID, { forceScan: true, readOnly: true });
    ok('只返回真实属主', r.length === 1 && r[0].code === OWNER, JSON.stringify(r.map(x => x.code)));
}

// ============ E) 空集合可信（未绑定设备不再反复全扫） ============
console.log('\n--- E) 集合为 [] → 确定为无属主，不再全扫 ---');
{
    const kv = makeKV({ ['mid_owners:' + MID]: JSON.stringify([]) });
    seedMany(kv, []);        // 无人含该设备
    const r = await findLicensesByMachine(kv, MID, { forceScan: true, readOnly: true });
    ok('返回空', r.length === 0);
    ok('★ list = 0（空集合=确定结论）', kv._stats.list === 0, 'list=' + kv._stats.list);
}

// ============ F) 空集合 + mid_idx 兜底（防漏项） ============
console.log('\n--- F) 集合为 [] 但 mid_idx 指向真实属主 → 兜底命中 ---');
{
    const kv = makeKV({
        ['mid_owners:' + MID]: JSON.stringify([]),
        ['mid_idx:' + MID]: JSON.stringify(OWNER)
    });
    seedMany(kv, [OWNER]);
    const r = await findLicensesByMachine(kv, MID, { forceScan: true, readOnly: true });
    ok('★ 兜底取回真实属主（防集合漏项）', r.length === 1 && r[0].code === OWNER, JSON.stringify(r.map(x => x.code)));
}

// ============ G) 集合非空却零命中 → 落全扫重建（安全优先） ============
console.log('\n--- G) 集合陈旧且零命中 → 全扫重建 ---');
{
    const kv = makeKV({
        ['mid_owners:' + MID]: JSON.stringify([THIRD]),
        ['mid_idx:' + MID]: JSON.stringify(THIRD)
    });
    seedMany(kv, [OWNER]);
    const r = await findLicensesByMachine(kv, MID, { forceScan: true });
    ok('★ 全扫兜底找回真实属主', r.length === 1 && r[0].code === OWNER, JSON.stringify(r.map(x => x.code)));
    ok('全扫确实发生（listLicenses = 索引键 + 逐条 get，无 list）', kv._stats.get >= 160, 'get=' + kv._stats.get);
    ok('★ 集合被重建为真实属主', JSON.stringify(ownersOf(kv)) === JSON.stringify([OWNER]), JSON.stringify(ownersOf(kv)));
}

// ============ H) saveLicense 增量维护 ============
console.log('\n--- H) saveLicense 维护：加设备入集、删设备出集 ---');
{
    const kv = makeKV({});
    seedMany(kv, []);
    const rec = { code: OWNER, user: 'X', type: 'personal', status: 'used', maxDevices: 5, devices: [] };
    await saveLicense(kv, rec);
    ok('无设备时不创建空集合', ownersOf(kv) === null, JSON.stringify(ownersOf(kv)));
    rec.devices = [{ machineId: MID, clientClass: 'desktop' }];
    await saveLicense(kv, rec);
    ok('★ 加设备 → 入集', JSON.stringify(ownersOf(kv)) === JSON.stringify([OWNER]), JSON.stringify(ownersOf(kv)));
    // 重激活（设备集合不变）→ 仍确保在集
    await saveLicense(kv, rec);
    ok('重存仍在集（幂等）', JSON.stringify(ownersOf(kv)) === JSON.stringify([OWNER]));
    // 第二个码也绑同设备
    const rec2 = { code: OTHER, user: 'Y', type: 'personal', status: 'used', maxDevices: 5, devices: [{ machineId: MID }] };
    kv._m.set('license:' + OTHER, JSON.stringify(rec2));
    await saveLicense(kv, rec2);
    ok('★ 第二个码加入集合（穷尽）', ownersOf(kv).sort().join(',') === [OWNER, OTHER].sort().join(','), JSON.stringify(ownersOf(kv)));
    // 移除设备
    rec.devices = [];
    await saveLicense(kv, rec);
    ok('★ 删设备 → 出集', JSON.stringify(ownersOf(kv)) === JSON.stringify([OTHER]), JSON.stringify(ownersOf(kv)));
}

// ============ I) 端到端：claim 跨码解绑语义保持 ============
console.log('\n--- I) 端到端 claim：跨码解绑仍生效 ---');
{
    const K1 = 'BNZC-DDDD-EEEE-FFFF-GGGG';   // 旧码，已绑该设备
    const K2 = 'BNZC-EEEE-FFFF-GGGG-HHHH';   // 新码，未使用
    const k1rec = () => ({
        code: K1, user: '老客户', type: 'personal', status: 'used', maxDevices: 5,
        devices: [{ machineId: MID, clientClass: 'desktop', activatedAt: '2026-09-01T00:00:00Z' }]
    });
    const k2rec = () => ({
        code: K2, user: '淘宝买家', type: 'personal', status: 'unused', days: 365,
        issuedAt: '2026-10-01T00:00:00.000Z', maxDevices: 5, productClass: 'offline',
        clinicName: null, devices: [], note: '测试'
    });

    // ① 独立调用 detach：穷尽性 + 真解绑
    const kv = makeKV({});
    seedMany(kv, []);
    await saveLicense(kv, k1rec());   // 注册进 license 索引 + 建属主集合
    await saveLicense(kv, k2rec());
    const detached = await detachDeviceFromOtherLicenses(kv, K2, MID);
    ok('★ detach 返回旧码（穷尽性保持）', detached.includes(K1), JSON.stringify(detached));
    ok('★ 旧码 devices 已清空该设备',
        !(JSON.parse(kv._m.get('license:' + K1)).devices || []).some(d => d.machineId === MID),
        JSON.stringify(JSON.parse(kv._m.get('license:' + K1)).devices));

    // ② 端到端 claim（旧码仍含该设备，验证 claim 链路里的解绑）
    const kv2 = makeKV({});
    seedMany(kv2, []);
    await saveLicense(kv2, k1rec());
    await saveLicense(kv2, k2rec());
    const res = await claimOnRequest({
        env: { KV: kv2 }, waitUntil: () => {},
        request: new Request('https://x/api/license/claim', {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '10.9.9.9' },
            body: JSON.stringify({ code: K2, machineId: MID, phone: '13700009999', productClass: 'offline', clientClass: 'desktop' })
        })
    });
    let body = null; try { body = await res.json(); } catch (_) {}
    ok('端到端 claim 成功', res.status === 200 && body && body.success === true,
        'status=' + res.status + ' ' + JSON.stringify(body || {}).slice(0, 100));
    const logK2 = JSON.parse(kv2._m.get('license_log:' + K2) || '[]');
    ok('★ 端到端链路完成跨码解绑（K2 日志）',
        logK2.some(e => e.action === 'cross-code-detach' && String(e.detail || '').includes(K1)),
        JSON.stringify(logK2.map(e => e.action + ':' + String(e.detail || '').slice(0, 40))));
    const logK1 = JSON.parse(kv2._m.get('license_log:' + K1) || '[]');
    ok('旧码留下 cross-code-detach-out 留痕', logK1.some(e => e.action === 'cross-code-detach-out'),
        JSON.stringify(logK1.map(e => e.action)));
    ok('★ 旧码 devices 在 claim 链路中也被清空',
        !(JSON.parse(kv2._m.get('license:' + K1)).devices || []).some(d => d.machineId === MID));
}

console.log('\n=== 结果: ' + pass + ' 通过, ' + fail + ' 失败 ===');
process.exit(fail === 0 ? 0 : 1);
