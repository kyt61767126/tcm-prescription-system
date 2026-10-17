// ============================================================================
//  verify-renew-license-backfill.mjs — 独立复核（2026-10-10 续费顺延第 ⑤ 步：
//  码记录 clinicName 回填 + license_clinic_index 索引随续费更新）
//
//  被测：functions/api/license/_lib/admin-account.js 的 renewClinicForRepeatPurchase
//  方法：mock KV（零网络），断言 KV 中的真实落库结果
//
//  用例：
//    C1 码 clinicName 为空      → ①被回填为本诊所名 ②索引该诊所 codes 新增本码 ③顺延生效
//    C2 码 clinicName 缺失字段  → 同上（空串/undefined 等价）
//    C3 码已绑定【别的】诊所    → clinicName 不被覆盖 + 索引不变 + 顺延仍生效 + 有 warn
//    C4 KV 读 license:{code} 异常 → ok/renewed 仍为 true，顺延不被影响
//    C5 KV 写 license:{code} 异常 → ok/renewed 仍为 true，顺延不被影响
//    C6 观察：license_clinic_index 键整个缺失时，索引是否会被重建
//    C7 幂等：同码二次调用 already=true 且不再写
//
//  用法: node e2e/.tmp/verify-renew-license-backfill.mjs     退出码 0=全过（观察项不影响退出码）
// ============================================================================
import { renewClinicForRepeatPurchase } from '../../functions/api/license/_lib/admin-account.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
    if (cond) { console.log('  PASS  ' + name); pass++; }
    else { console.log('  FAIL  ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')); fail++; }
};

const DAY = 86400000;
const PHONE = '15200069705';
const CLINIC_NAME = '中医诊所·9705';
const CLINIC_ID = 'clinic_o67d5eqv1r';
const OLD_EXP = '2027-10-08T00:00:00.000Z';

function makeKV(seed = {}, hooks = {}) {
    const m = new Map(Object.entries(seed));
    const puts = [];
    return {
        _m: m, _puts: puts,
        async get(k, type) {
            if (hooks.getThrows && hooks.getThrows(k)) throw new Error('mock KV get 异常');
            if (!m.has(k)) return null;
            const v = m.get(k);
            return type === 'json' ? (typeof v === 'string' ? JSON.parse(v) : v) : v;
        },
        async put(k, v) {
            puts.push(k);
            if (hooks.putThrows && hooks.putThrows(k)) throw new Error('mock KV put 异常');
            m.set(k, v);
        },
        async delete(k) { m.delete(k); },
        async list(o = {}) {
            const p = o.prefix || '';
            return { keys: [...m.keys()].filter(k => k.startsWith(p)).map(name => ({ name })), list_complete: true };
        }
    };
}
const getJson = (kv, k) => { const v = kv._m.get(k); return v ? JSON.parse(v) : null; };
const clinicsOf = (kv) => getJson(kv, 'system:clinics') || [];

function seed(over = {}) {
    const clinic = Object.assign({
        id: CLINIC_ID, name: CLINIC_NAME, edition: 'cloud_clinic',
        status: 'active', createdAt: '2026-01-01T00:00:00.000Z', source: 'activation',
        expiresAt: over.clinicExpiresAt || OLD_EXP
    }, over.clinic || {});
    const lic = Object.assign({
        code: over.code, user: '淘宝买家', phone: PHONE, type: 'personal', status: 'used',
        days: 365, expiresAt: null, issuedAt: '2026-10-01T00:00:00.000Z',
        maxDevices: 1, productClass: 'cloud', devices: [], note: '淘宝-云端标准版-199'
    }, over.lic || {});
    const s = {
        'system:clinics': JSON.stringify([clinic]),
        [`clinic:${clinic.id}:users`]: JSON.stringify([{ username: PHONE, phone: PHONE, role: 'clinic_admin' }])
    };
    if (over.withLicense !== false) s[`license:${over.code}`] = JSON.stringify(lic);
    if (over.index !== undefined) s['license_clinic_index'] = JSON.stringify(over.index);
    return s;
}
// 索引里必须已存在"非脏"的其他诊所条目，因为 maintainClinicIndexOnSave 对缺失/脏索引整体跳过
const OTHER_CODE = 'BNZC-OTHR-0000-0000-0001';
const BASE_INDEX = { '其他诊所·0000': [OTHER_CODE] };

let warnMsgs = [];
const realWarn = console.warn;
const captureWarn = () => { warnMsgs = []; console.warn = (...a) => { warnMsgs.push(a.map(String).join(' ')); }; };
const restoreWarn = () => { console.warn = realWarn; };

(async () => {
    // ---------------- C1 ----------------
    console.log('=== C1) 码 clinicName 为空 → 回填 + 索引补条目 ===');
    {
        const CODE = 'BNZC-RNW1-AAAA-BBBB-CCCC';
        const kv = makeKV(seed({ code: CODE, lic: { clinicName: '' }, index: BASE_INDEX }));
        captureWarn();
        const r = await renewClinicForRepeatPurchase(kv, { code: CODE, phone: PHONE, days: 365, type: 'personal' });
        restoreWarn();
        const lic = getJson(kv, 'license:' + CODE);
        const idx = getJson(kv, 'license_clinic_index');
        const clinic = clinicsOf(kv)[0];
        console.log('    返回 = ' + JSON.stringify(r));
        console.log('    license:' + CODE + '.clinicName = ' + JSON.stringify(lic.clinicName));
        console.log('    license_clinic_index = ' + JSON.stringify(idx));
        console.log('    诊所 expiresAt = ' + clinic.expiresAt);
        ok('① license:{code}.clinicName 被回填为本诊所名', lic.clinicName === CLINIC_NAME, lic.clinicName);
        ok('② license_clinic_index[诊所] 含本码', Array.isArray(idx[CLINIC_NAME]) && idx[CLINIC_NAME].includes(CODE), idx);
        ok('② 索引中其他诊所条目未被破坏', JSON.stringify(idx['其他诊所·0000']) === JSON.stringify([OTHER_CODE]), idx['其他诊所·0000']);
        ok('③ 顺延仍生效（= 原到期 + 365 天）',
            clinic.expiresAt === new Date(Date.parse(OLD_EXP) + 365 * DAY).toISOString(), clinic.expiresAt);
        ok('返回值 licenseBackfilled=true', r.licenseBackfilled === true, r.licenseBackfilled);
        ok('码记录其他字段未被破坏（devices/status/note）',
            Array.isArray(lic.devices) && lic.status === 'used' && lic.note === '淘宝-云端标准版-199', lic);
        ok('未输出任何 warn（正常回填路径）', warnMsgs.length === 0, warnMsgs);
    }

    // ---------------- C2 ----------------
    console.log('\n=== C2) 码 clinicName 字段缺失（undefined）→ 等价处理 ===');
    {
        const CODE = 'BNZC-RNW2-AAAA-BBBB-CCCC';
        const kv = makeKV(seed({ code: CODE, index: BASE_INDEX }));   // lic 无 clinicName 字段
        const r = await renewClinicForRepeatPurchase(kv, { code: CODE, phone: PHONE, days: 30 });
        const lic = getJson(kv, 'license:' + CODE);
        const idx = getJson(kv, 'license_clinic_index');
        ok('clinicName 被回填', lic.clinicName === CLINIC_NAME, lic.clinicName);
        ok('索引含本码', Array.isArray(idx[CLINIC_NAME]) && idx[CLINIC_NAME].includes(CODE), idx);
        ok('licenseBackfilled=true', r.licenseBackfilled === true, r.licenseBackfilled);
    }

    // ---------------- C3 ----------------
    console.log('\n=== C3) 码已绑定【别的】诊所 → 绝不覆盖 + 索引不变 + 顺延仍生效 ===');
    {
        const CODE = 'BNZC-RNW3-AAAA-BBBB-CCCC';
        const OTHER = '别的诊所·9999';
        const kv = makeKV(seed({ code: CODE, lic: { clinicName: OTHER }, index: { [OTHER]: [CODE], '其他诊所·0000': [OTHER_CODE] } }));
        captureWarn();
        const r = await renewClinicForRepeatPurchase(kv, { code: CODE, phone: PHONE, days: 365 });
        restoreWarn();
        const lic = getJson(kv, 'license:' + CODE);
        const idx = getJson(kv, 'license_clinic_index');
        const clinic = clinicsOf(kv)[0];
        console.log('    warn = ' + JSON.stringify(warnMsgs));
        console.log('    license:"' + lic.clinicName + '"  index = ' + JSON.stringify(idx));
        ok('★ clinicName 未被覆盖（仍是别的诊所）', lic.clinicName === OTHER, lic.clinicName);
        ok('★ 索引未把本码挂到本诊所', !idx[CLINIC_NAME], idx[CLINIC_NAME]);
        ok('索引中原归属条目保持不动', JSON.stringify(idx[OTHER]) === JSON.stringify([CODE]), idx[OTHER]);
        ok('licenseBackfilled=false', r.licenseBackfilled === false, r.licenseBackfilled);
        ok('顺延仍生效', clinic.expiresAt === new Date(Date.parse(OLD_EXP) + 365 * DAY).toISOString(), clinic.expiresAt);
        ok('输出「已绑定其他诊所」警告', warnMsgs.some(m => m.includes('已绑定其他诊所')), warnMsgs);
    }

    // ---------------- C4 ----------------
    console.log('\n=== C4) KV 读 license:{code} 抛异常 → 不影响已生效的顺延 ===');
    {
        const CODE = 'BNZC-RNW4-AAAA-BBBB-CCCC';
        const kv = makeKV(seed({ code: CODE, lic: { clinicName: '' }, index: BASE_INDEX }),
            { getThrows: (k) => k === 'license:' + CODE });
        captureWarn();
        const r = await renewClinicForRepeatPurchase(kv, { code: CODE, phone: PHONE, days: 365 });
        restoreWarn();
        const clinic = clinicsOf(kv)[0];
        console.log('    返回 = ' + JSON.stringify(r));
        console.log('    warn = ' + JSON.stringify(warnMsgs));
        ok('★ ok=true / renewed=true', r.ok === true && r.renewed === true, r);
        ok('★ 顺延已生效', clinic.expiresAt === new Date(Date.parse(OLD_EXP) + 365 * DAY).toISOString(), clinic.expiresAt);
        ok('licenseBackfilled=false', r.licenseBackfilled === false, r.licenseBackfilled);
    }

    // ---------------- C5 ----------------
    console.log('\n=== C5) KV 写 license:{code} 抛异常（updateLicense 失败）→ 不影响已生效的顺延 ===');
    {
        const CODE = 'BNZC-RNW5-AAAA-BBBB-CCCC';
        const kv = makeKV(seed({ code: CODE, lic: { clinicName: '' }, index: BASE_INDEX }),
            { putThrows: (k) => k === 'license:' + CODE });
        captureWarn();
        const r = await renewClinicForRepeatPurchase(kv, { code: CODE, phone: PHONE, days: 365 });
        restoreWarn();
        const clinic = clinicsOf(kv)[0];
        const lic = getJson(kv, 'license:' + CODE);
        console.log('    返回 = ' + JSON.stringify(r));
        console.log('    warn = ' + JSON.stringify(warnMsgs));
        ok('★ ok=true / renewed=true', r.ok === true && r.renewed === true, r);
        ok('★ 顺延已生效', clinic.expiresAt === new Date(Date.parse(OLD_EXP) + 365 * DAY).toISOString(), clinic.expiresAt);
        ok('licenseBackfilled=false（回填失败）', r.licenseBackfilled === false, r.licenseBackfilled);
        ok('码记录未被写坏（clinicName 仍为空）', lic.clinicName === '', lic.clinicName);
    }

    // ---------------- C6 ----------------
    console.log('\n=== C6) 【观察】license_clinic_index 键整个缺失时的行为 ===');
    {
        const CODE = 'BNZC-RNW6-AAAA-BBBB-CCCC';
        const kv = makeKV(seed({ code: CODE, lic: { clinicName: '' }, index: undefined }));
        const r = await renewClinicForRepeatPurchase(kv, { code: CODE, phone: PHONE, days: 365 });
        const lic = getJson(kv, 'license:' + CODE);
        const idx = getJson(kv, 'license_clinic_index');
        console.log('    license.clinicName = ' + JSON.stringify(lic.clinicName));
        console.log('    license_clinic_index = ' + JSON.stringify(idx) + '（键存在=' + kv._m.has('license_clinic_index') + '）');
        console.log('    返回 licenseBackfilled = ' + r.licenseBackfilled);
        ok('（观察项）码记录 clinicName 仍被回填', lic.clinicName === CLINIC_NAME, lic.clinicName);
        ok('（观察项）索引键缺失时不会新建索引（留给读侧全扫兜底）', idx === null, idx);
    }

    // ---------------- C7 ----------------
    console.log('\n=== C7) 幂等：同码二次调用不重复叠加、不重复写 ===');
    {
        const CODE = 'BNZC-RNW7-AAAA-BBBB-CCCC';
        const kv = makeKV(seed({ code: CODE, lic: { clinicName: '' }, index: BASE_INDEX }));
        const r1 = await renewClinicForRepeatPurchase(kv, { code: CODE, phone: PHONE, days: 365 });
        const exp1 = clinicsOf(kv)[0].expiresAt;
        const putsBefore = kv._puts.length;
        const r2 = await renewClinicForRepeatPurchase(kv, { code: CODE, phone: PHONE, days: 365 });
        const exp2 = clinicsOf(kv)[0].expiresAt;
        console.log('    r2 = ' + JSON.stringify(r2));
        ok('首次 renewed=true + licenseBackfilled=true', r1.renewed === true && r1.licenseBackfilled === true, r1);
        ok('二次 already=true / renewed=false', r2.ok === true && r2.already === true && r2.renewed === false, r2);
        ok('到期时间未被二次叠加', exp1 === exp2, { exp1, exp2 });
        ok('二次调用零 KV 写', kv._puts.length === putsBefore, { putsBefore, after: kv._puts.length });
    }

    console.log('\n=== 结果: ' + pass + ' 通过, ' + fail + ' 失败 ===');
    process.exit(fail === 0 ? 0 : 1);
})().catch(e => { restoreWarn(); console.error('测试框架异常:', e); process.exit(2); });
