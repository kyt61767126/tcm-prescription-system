// ============================================================================
//  kv-list-quota-round2-test.mjs — list 配额治理第二批回归（mock KV，零网络）
//
//  本次改动（全部为「消除全站 list」）：
//    ① auth.js：session 键清单索引 user_session_index
//       —— 撤销/清除/读取改为枚举派生 key；全站列表改 1 get + N get，键缺失全扫回填一次
//    ② users.js clinics=true 全量模式：license 全扫 → 读既有 system:license_index（1 get）
//    ③ login-punch.js：lpmon 全站 list → 派生 key（已归档月 × 诊所），零 list
//    ④ platform-prescriptions.js：与 prescriptions.js 共用日期分片显式索引
//
//  用法: node e2e/.tmp/kv-list-quota-round2-test.mjs   （退出码 0=全过）
// ============================================================================
import {
    writeUserSession, clearUserSession, revokeAllUserTokens, getUserSession, listUserSessionKeys
} from '../../functions/api/_lib/auth.js';
import { getClinicLoginHistory } from '../../functions/api/_lib/login-punch.js';
import { getPrescriptionDayKeys, ensurePrescriptionDayIndexed } from '../../functions/api/_lib/prescriptions-store.js';

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
const U = '13800001111';

// ============ ① session 索引 ============
console.log('--- ① auth.js session 键清单索引 ---');
{
    const kv = makeKV();
    // 键缺失 → 读取落全扫一次并回填
    kv._m.set(`user_session:${U}:desktop`, JSON.stringify({ tokenHash: 'h1', loginAt: '2026-10-10T01:00:00.000Z' }));
    kv._m.set(`user_session:${U}:web`, JSON.stringify({ tokenHash: 'h2', loginAt: '2026-10-10T02:00:00.000Z' }));
    const k1 = await listUserSessionKeys(kv);
    ok('键缺失时全扫取回全部 session 键', k1.length === 2, JSON.stringify(k1));
    ok('★ 首次触发 1 条 list（回填）', kv._stats.list === 1, 'list=' + kv._stats.list);
    ok('索引已回填', Array.isArray(JSON.parse(kv._m.get('user_session_index'))));
    kv._stats.list = 0; kv._stats.get = 0;
    const k2 = await listUserSessionKeys(kv);
    ok('★ 第二次零 list', kv._stats.list === 0, 'list=' + kv._stats.list);
    ok('结果一致', k2.length === 2 && k1.sort().join() === k2.sort().join());

    // writeUserSession 维护索引
    await writeUserSession(kv, U, 'tok-app-xxxx', { clientClass: 'app' });
    const idx = JSON.parse(kv._m.get('user_session_index'));
    ok('★ 登录写入 → 键加入索引', idx.includes(`user_session:${U}:app`), JSON.stringify(idx));

    // getUserSession 不再 list
    kv._stats.list = 0;
    const latest = await getUserSession(kv, U);
    ok('getUserSession 取到最新 session（app）', latest && latest.tokenHash, JSON.stringify(latest && latest.tokenHash));
    ok('★ getUserSession 零 list', kv._stats.list === 0, 'list=' + kv._stats.list);

    // clearUserSession / revokeAllUserTokens 移除索引项且零 list
    kv._stats.list = 0;
    await clearUserSession(kv, U);
    ok('★ 登出清理零 list', kv._stats.list === 0, 'list=' + kv._stats.list);
    ok('★ session 键已删除', !kv._m.has(`user_session:${U}:desktop`) && !kv._m.has(`user_session:${U}:app`));
    ok('★ 索引项已移除', !JSON.parse(kv._m.get('user_session_index')).includes(`user_session:${U}:app`));
    await writeUserSession(kv, U, 'tok-x', { clientClass: 'web' });
    kv._stats.list = 0;
    await revokeAllUserTokens(kv, U);
    ok('★ 改密撤销零 list', kv._stats.list === 0, 'list=' + kv._stats.list);
    ok('token_version 已递增', kv._m.get('user_token_version:' + U) === '1', String(kv._m.get('user_token_version:' + U)));
}

// ============ ③ 登录历史：派生 key 零 list ============
console.log('\n--- ③ getClinicLoginHistory 派生 key（零 list）---');
{
    const bj = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 7);   // 北京当月
    const cur = bj, prev = '2026-09';
    const C1 = '中医诊所·1111', C2 = '中医诊所·2222';
    const seed = {
        lp_start: '2026-09-01',
        [`lparch:${prev}`]: '1',
        [`lpmon:${prev}:${encodeURIComponent(C1)}`]: JSON.stringify({ d: 10, a: 2, w: 3 }),
        [`lpmon:${prev}:${encodeURIComponent(C2)}`]: JSON.stringify({ d: 5, a: 0, w: 0 }),
        [`lpcur:${cur}`]: JSON.stringify({ builtAt: new Date().toISOString(), c: { [encodeURIComponent(C1)]: { d: 1, a: 0, w: 0 } } })
    };
    const kv = makeKV(seed);
    const h = await getClinicLoginHistory(kv, [C1, C2]);
    ok('★ 全程零 list', kv._stats.list === 0, 'list=' + kv._stats.list);
    ok('历史月桶求和正确（C1 d=10+1=11）', h.totals.get(encodeURIComponent(C1)).d === 11,
        JSON.stringify([...h.totals.entries()]));
    ok('历史月桶求和正确（C2 d=5）', h.totals.get(encodeURIComponent(C2)).d === 5);
    ok('startDate 如实返回', h.startDate === '2026-09-01', String(h.startDate));

    // 未传诊所集合 → 回退旧行为（有 list）
    const kv2 = makeKV(seed);
    await getClinicLoginHistory(kv2);
    ok('未传诊所集合时回退 list（兼容旧调用方）', kv2._stats.list >= 1, 'list=' + kv2._stats.list);
}

// ============ ④ 处方日期分片：与 platform-prescriptions 共用索引 ============
console.log('\n--- ④ 处方日分片索引（prescriptions / platform-prescriptions 共用）---');
{
    const CID = 'clinic_shared1';
    const kv = makeKV({ [`clinic:${CID}:prescriptions:260101`]: '[]' });
    // 写入路径先登记索引
    await ensurePrescriptionDayIndexed(kv, CID, '260101');
    kv._stats.list = 0;
    const keys = await getPrescriptionDayKeys(kv, CID);
    ok('★ 读路径零 list（两处端点共用同一索引）', kv._stats.list === 0, 'list=' + kv._stats.list);
    ok('取回正确日 key', keys.length === 1 && keys[0] === `clinic:${CID}:prescriptions:260101`, JSON.stringify(keys));
}

// ============ ⑤ list 失败时绝不写出"假空索引" ============
console.log('\n--- ⑤ list 失败（模拟配额 429）→ 不写假空索引 ---');
{
    const kv = makeKV();
    kv.list = async () => { throw new Error('KV list failed 429 (injected)'); };
    const keys = await listUserSessionKeys(kv);
    ok('★ session 索引：失败不写索引（留空键下次重试）',
        keys.length === 0 && !kv._m.has('user_session_index'), JSON.stringify([...kv._m.keys()]));

    const kv2 = makeKV({});
    kv2.list = async () => { throw new Error('KV list failed 429 (injected)'); };
    await ensurePrescriptionDayIndexed(kv2, 'clinic_x', '260101');
    ok('★ 处方索引：失败不写 [本日期]（否则历史日期永久不可见）',
        !kv2._m.has('clinic:clinic_x:prescriptions_index'), JSON.stringify([...kv2._m.keys()]));
}

console.log('\n=== 结果: ' + pass + ' 通过, ' + fail + ' 失败 ===');
process.exit(fail === 0 ? 0 : 1);
