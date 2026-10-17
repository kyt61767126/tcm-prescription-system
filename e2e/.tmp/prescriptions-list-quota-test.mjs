// ============================================================================
//  prescriptions-list-quota-test.mjs — KV list 配额治理回归（mock KV，零网络）
//
//  背景：Cloudflare 告警「Workers KV 免费套餐每日 list 1000 次已超，返回 429」
//  （2026-10-09 20:38）。根因是处方日期分片读取每次打一条 list。本测试验证改为
//  显式索引后：读路径 list 归零、索引缺失只懒回填一次、索引写失败可自愈。
//
//  用法: node e2e/.tmp/prescriptions-list-quota-test.mjs   （退出码 0=全过）
// ============================================================================
import {
    prescriptionsDayPrefix, prescriptionsDayKey, prescriptionsDayIndexKey,
    getPrescriptionDayKeys, ensurePrescriptionDayIndexed
} from '../../functions/api/_lib/prescriptions-store.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
    if (cond) { console.log('  PASS  ' + name); pass++; }
    else { console.log('  FAIL  ' + name + (extra ? '  -> ' + extra : '')); fail++; }
};

function makeKV(seed = {}, opts = {}) {
    const m = new Map(Object.entries(seed));
    const stats = { list: 0, get: 0, put: 0, del: 0 };
    const failPutIf = opts.failPutIf || (() => false);
    return {
        _m: m, _stats: stats,
        async get(k, type) {
            stats.get++;
            if (!m.has(k)) return null;
            const v = m.get(k);
            return type === 'json' ? (typeof v === 'string' ? JSON.parse(v) : v) : v;
        },
        async put(k, v) {
            stats.put++;
            if (failPutIf(k)) throw new Error('KV put failed (injected)');
            m.set(k, v);
        },
        async delete(k) { stats.del++; m.delete(k); },
        async list(o = {}) {
            stats.list++;
            const p = o.prefix || '';
            return { keys: [...m.keys()].filter(k => k.startsWith(p)).map(name => ({ name })), list_complete: true };
        }
    };
}

const CID = 'clinic_testquota';
const IDX = prescriptionsDayIndexKey(CID);

// ---------------- A) 索引在 → 读路径 list 归零 ----------------
console.log('--- A) 索引存在时：读路径零 list（核心） ---');
{
    const kv = makeKV({
        [IDX]: JSON.stringify(['260101', '260102']),
        [prescriptionsDayKey(CID, '260101')]: '[]',
        [prescriptionsDayKey(CID, '260102')]: '[]'
    });
    const keys = await getPrescriptionDayKeys(kv, CID);
    ok('返回索引中的全部日期 key', keys.length === 2
        && keys.includes(prescriptionsDayKey(CID, '260101'))
        && keys.includes(prescriptionsDayKey(CID, '260102')), JSON.stringify(keys));
    ok('★ list 调用数 = 0（原先每次读 = 1 条 list）', kv._stats.list === 0, '实际=' + kv._stats.list);
    const keys2 = await getPrescriptionDayKeys(kv, CID);
    ok('重复读取仍为 0 条 list', kv._stats.list === 0 && keys2.length === 2, '实际=' + kv._stats.list);
}

// ---------------- B) 索引缺失 → 懒回填一次 ----------------
console.log('\n--- B) 索引缺失：懒回填一次，此后不再 list ---');
{
    const kv = makeKV({
        [prescriptionsDayKey(CID, '260101')]: '[]',
        [prescriptionsDayKey(CID, '260102')]: '[]'
    });
    const k1 = await getPrescriptionDayKeys(kv, CID);
    ok('首次读取 list 一次', kv._stats.list === 1, '实际=' + kv._stats.list);
    ok('返回完整历史日期', k1.length === 2, JSON.stringify(k1));
    const idx = JSON.parse(kv._m.get(IDX) || '[]');
    ok('索引已回填（含全部历史日期）', idx.includes('260101') && idx.includes('260102'), JSON.stringify(idx));
    await getPrescriptionDayKeys(kv, CID);
    ok('★ 第二次读取 list 归零', kv._stats.list === 1, '实际=' + kv._stats.list);
}

// ---------------- C) 写入：登记索引不 list ----------------
console.log('\n--- C) 写入路径：索引已存在时不 list ---');
{
    const kv = makeKV({ [IDX]: JSON.stringify(['260101']) });
    const r = await ensurePrescriptionDayIndexed(kv, CID, '260104');
    ok('返回 true', r === true);
    ok('新日期已登记', JSON.parse(kv._m.get(IDX)).includes('260104'));
    ok('写入路径零 list', kv._stats.list === 0, '实际=' + kv._stats.list);
    const again = await ensurePrescriptionDayIndexed(kv, CID, '260104');
    ok('重复登记幂等', again === true && kv._stats.put === 1, 'put=' + kv._stats.put);
}

// ---------------- D) 索引写失败 → 自愈（不产生不可见窗口） ----------------
console.log('\n--- D) 索引写失败：返回 false + 删索引 → 下次完整回填 ---');
{
    // ★ 预置一条历史日期：实现已加固为"列表为空 → 不写索引"（否则历史日期会永久不可见），
    //   本用例要测的"索引写失败"路径需非空列表才能走到 put。
    const kv = makeKV({ [prescriptionsDayKey(CID, '260101')]: '[]' }, { failPutIf: (k) => k === IDX });
    const r = await ensurePrescriptionDayIndexed(kv, CID, '260103');
    ok('返回 false（如实报告索引未登记）', r === false, '实际=' + r);
    ok('索引键未被留下（下次读取会走完整回填）', !kv._m.has(IDX));
    // 数据照写（upsertToDayKey 不因索引失败而丢数据）
    await kv.put(prescriptionsDayKey(CID, '260103'), '[]');
    const keys = await getPrescriptionDayKeys(kv, CID);
    ok('★ 索引不可写时仍能读到该日数据（回退 list，正确性优先）',
        keys.includes(prescriptionsDayKey(CID, '260103')), JSON.stringify(keys));
    // ensure 的回填路径 list 1 次 + 读取的回填 list 1 次 = 2（索引不可写时按"正确性优先"退化为每次 list）
    ok('确已回退到 list（ensure 回填 1 次 + 读取回填 1 次 = 2）', kv._stats.list === 2, '实际=' + kv._stats.list);
}

// ---------------- D2) 历史为空 / list 失败 → 绝不写"假空索引" ----------------
console.log('\n--- D2) 历史为空（或 list 失败）→ 不写索引，数据照写 ---');
{
    const kv = makeKV({});   // 无任何历史日期
    const r = await ensurePrescriptionDayIndexed(kv, CID, '260201');
    ok('返回 true（调用方照写数据，不阻断）', r === true, '实际=' + r);
    ok('★ 未写出 [本日期] 假索引（否则历史日期永久不可见）', !kv._m.has(IDX));
    await kv.put(prescriptionsDayKey(CID, '260201'), '[]');
    const keys = await getPrescriptionDayKeys(kv, CID);
    ok('该日数据仍可读（读取走 list 兜底）', keys.includes(prescriptionsDayKey(CID, '260201')), JSON.stringify(keys));

    // list 直接失败（模拟配额 429）同样不得写索引
    const kv2 = makeKV({});
    kv2.list = async () => { throw new Error('KV list failed 429 (injected)'); };
    await ensurePrescriptionDayIndexed(kv2, CID, '260301');
    ok('★ list 失败时不写索引', !kv2._m.has(IDX), JSON.stringify([...kv2._m.keys()]));
}

// ---------------- E) 空诊所 ----------------
console.log('\n--- E) 空诊所（无索引无数据） ---');
{
    const kv = makeKV({});
    const keys = await getPrescriptionDayKeys(kv, CID);
    ok('返回空数组', Array.isArray(keys) && keys.length === 0, JSON.stringify(keys));
    ok('list 一次', kv._stats.list === 1, '实际=' + kv._stats.list);
    ok('未写入空索引（避免无意义写）', !kv._m.has(IDX));
}

// ---------------- F) key 格式与 lib 一致 ----------------
console.log('\n--- F) key 格式 ---');
{
    ok('日期 key 格式 = clinic:{id}:prescriptions:{YYMMDD}',
        prescriptionsDayKey(CID, '260101') === `clinic:${CID}:prescriptions:260101`,
        prescriptionsDayKey(CID, '260101'));
    ok('前缀与 key 自洽', prescriptionsDayKey(CID, '260101') === prescriptionsDayPrefix(CID) + '260101');
    ok('索引键格式 = clinic:{id}:prescriptions_index',
        IDX === `clinic:${CID}:prescriptions_index`, IDX);
}

console.log('\n=== 结果: ' + pass + ' 通过, ' + fail + ' 失败 ===');
process.exit(fail === 0 ? 0 : 1);
