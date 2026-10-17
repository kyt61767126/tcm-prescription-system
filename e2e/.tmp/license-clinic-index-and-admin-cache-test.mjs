// ============================================================================
//  license-clinic-index-and-admin-cache-test.mjs — 两项收尾改动回归（mock KV，零网络）
//
//  ① clinicName → codes 索引（license_clinic_index）
//     · 读：不可信返回 null（调用方全扫回填）；可信返回 Map
//     · 写：只写非空条目（绝不写"假空索引"）
//     · saveLicense 维护：改诊所名 → 旧名移除、新名加入；clinicName 不变 → 零额外写
//     · 收益结构性验证：15 诊所 / 166 码 场景下，派生的取码清单从 166 降到诊所相关条数
//  ② 后台聚合端点短时结果缓存 + 运维开关（admin-cache）
//     · 命中：producer 只执行一次，返回缓存体，带 X-Dsh-Cache: hit，CORS 头保留
//     · 身份隔离：不同 Authorization → 不同缓存键（绝不跨权限串体）
//     · 运维开关：config:admin-heavy-cache {"mode":"off"} → 全部绕过缓存
//     · 非 2xx（403）不缓存
//
//  用法: node e2e/.tmp/license-clinic-index-and-admin-cache-test.mjs   （退出码 0=全过）
// ============================================================================
import {
    saveLicense, getLicenseCodesByClinic, putLicenseClinicIndex
} from '../../functions/api/license/_lib/license-core.js';
import { withAdminResponseCache, getAdminCacheConfig } from '../../functions/api/_lib/admin-cache.js';

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
const IDX_KEY = 'license_clinic_index';
const CLINICS = Array.from({ length: 15 }, (_, i) => '中医诊所·' + String(i + 1).padStart(4, '0'));

// 造 166 条 license：每条给一个诊所名（模拟真机规模）
function seed166(kv) {
    const codes = [];
    for (let i = 0; i < 166; i++) {
        const code = 'BNZC-' + String(i).padStart(4, '0') + '-AAAA-BBBB-CCCC';
        const rec = {
            code, user: 'U' + i, type: 'personal', status: i % 7 === 0 ? 'unused' : 'used',
            maxDevices: 5, devices: [], clinicName: i < 15 ? CLINICS[i] : ''
        };
        kv._m.set('license:' + code, JSON.stringify(rec));
        codes.push(code);
    }
    kv._m.set('system:license_index', JSON.stringify(codes));
    return codes;
}

// ============ ① 索引读写 ============
console.log('--- ① license_clinic_index 读写语义 ---');
{
    const kv = makeKV();
    ok('键缺失 → 返回 null（调用方全扫回填）', (await getLicenseCodesByClinic(kv)) === null);
    kv._m.set(IDX_KEY, JSON.stringify({ '中医诊所·0001': ['BNZC-AAAA-AAAA-AAAA-AAAA'] }));
    const m = await getLicenseCodesByClinic(kv);
    ok('可信索引 → 返回 Map', m instanceof Map && m.size === 1 && m.get('中医诊所·0001').length === 1);
    kv._m.set(IDX_KEY, JSON.stringify({ '中医诊所·0001': ['not-a-code'] }));
    ok('脏值 → 视为不可信（返回 null 落全扫）', (await getLicenseCodesByClinic(kv)) === null);
    kv._m.set(IDX_KEY, '[]');
    ok('数组形态 → 不可信', (await getLicenseCodesByClinic(kv)) === null);

    const kv2 = makeKV();
    ok('回填空映射不写键（绝不写假空索引）', (await putLicenseClinicIndex(kv2, new Map())) === false && !kv2._m.has(IDX_KEY));
    const wrote = await putLicenseClinicIndex(kv2, new Map([['中医诊所·0002', ['BNZC-AAAA-AAAA-AAAA-AAAA']]]));
    ok('回填非空映射成功', wrote === true && JSON.parse(kv2._m.get(IDX_KEY))['中医诊所·0002'].length === 1);
}

// ============ ① saveLicense 维护 ============
console.log('\n--- ① saveLicense 维护 clinicName diff ---');
{
    const kv = makeKV();
    await putLicenseClinicIndex(kv, new Map([['中医诊所·0001', ['BNZC-AAAA-AAAA-AAAA-AAAA']]]));
    const CODE = 'BNZC-AAAA-AAAA-AAAA-AAAA';
    const base = { code: CODE, user: 'U', type: 'personal', status: 'used', maxDevices: 5, devices: [] };

    // 名称不变 → 诊所索引不应产生额外写。
    // 注意口径：saveLicense 本身必然写【主记录】1 次（首次还会补写 license 索引），
    // 故用"连续两次相同保存"的差值来隔离出诊所索引的增量（差值为 1 = 仅主记录）。
    await saveLicense(kv, Object.assign({}, base, { clinicName: '中医诊所·0001' }));
    const p1 = kv._stats.put;
    await saveLicense(kv, Object.assign({}, base, { clinicName: '中医诊所·0001' }));
    ok('★ clinicName 不变 → 诊所索引零额外写（仅主记录 1 次）', kv._stats.put - p1 === 1,
        `put 增量=${kv._stats.put - p1}`);

    // 改名 → 旧名移除、新名加入
    await saveLicense(kv, Object.assign({}, base, { clinicName: '中医诊所·0009' }));
    const idx = JSON.parse(kv._m.get(IDX_KEY));
    ok('★ 改名：旧名已移除', !idx['中医诊所·0001'], JSON.stringify(idx));
    ok('★ 改名：新名已加入', Array.isArray(idx['中医诊所·0009']) && idx['中医诊所·0009'].includes(CODE), JSON.stringify(idx));

    // 清空名称 → 从索引移除
    await saveLicense(kv, Object.assign({}, base, { clinicName: '' }));
    ok('★ 清空名称 → 从索引移除', Object.keys(JSON.parse(kv._m.get(IDX_KEY))).length === 0,
        kv._m.get(IDX_KEY));
}

// ============ ① 收益：166 → 诊所相关 ============
console.log('\n--- ① 取码清单规模：166 → 诊所相关 ---');
{
    const kv = makeKV();
    seed166(kv);
    const idxMap = await getLicenseCodesByClinic(kv);
    ok('未回填前返回 null（会走全扫并回填一次）', idxMap === null);
    // 模拟回填（从 166 条聚合）
    const build = new Map();
    for (const [k, v] of kv._m) {
        if (!k.startsWith('license:')) continue;
        const rec = JSON.parse(v);
        if (rec.clinicName) {
            if (!build.has(rec.clinicName)) build.set(rec.clinicName, []);
            build.get(rec.clinicName).push(rec.code);
        }
    }
    await putLicenseClinicIndex(kv, build);
    const m2 = await getLicenseCodesByClinic(kv);
    // 按诊所派生取码清单（与 users.js 全量模式同逻辑）
    let derived = 0;
    for (const name of CLINICS) derived += (m2.get(name) || []).length;
    ok('★ 派生取码清单 = 15（全部诊所各 1 条）', derived === 15, 'derived=' + derived);
    ok('★ 对比全扫 166 条：读量降 ' + Math.round(166 / Math.max(derived, 1)) + ' 倍',
        derived < 166 && derived === new Set([...m2.values()].flat()).size, 'derived=' + derived);
    const kv2 = makeKV();
    seed166(kv2);
    kv2._stats.get = 0;
    await getLicenseCodesByClinic(kv2);
    ok('★ 读索引仅 1 次 get（零 list）', kv2._stats.get === 1 && kv2._stats.list === 0,
        `get=${kv2._stats.get} list=${kv2._stats.list}`);
}

// ============ ② 后台缓存 ============
console.log('\n--- ② admin-cache 命中/隔离/开关 ---');
function makeReq(auth, url = 'https://x/api/license/admin-data-audit') {
    return new Request(url, { method: 'GET', headers: auth ? { Authorization: auth } : {} });
}
{
    const kv = makeKV();
    let calls = 0;
    const producer = async () => {
        calls++;
        return new Response(JSON.stringify({ success: true, n: calls }), {
            status: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
    };
    const r1 = await withAdminResponseCache(kv, 'ep', makeReq('Bearer tokA'), 'Bearer tokA', producer);
    const b1 = await r1.json();
    ok('首次未命中 → 执行 producer', calls === 1 && b1.n === 1, JSON.stringify(b1));
    ok('未命中标记 X-Dsh-Cache: miss', r1.headers.get('X-Dsh-Cache') === 'miss', String(r1.headers.get('X-Dsh-Cache')));

    const r2 = await withAdminResponseCache(kv, 'ep', makeReq('Bearer tokA'), 'Bearer tokA', producer);
    const b2 = await r2.json();
    ok('★ 二次命中缓存 → producer 不再执行', calls === 1, 'calls=' + calls);
    ok('命中返回原响应体', b2.n === 1, JSON.stringify(b2));
    ok('★ CORS 头在命中时保留', r2.headers.get('Access-Control-Allow-Origin') === '*', String(r2.headers.get('Access-Control-Allow-Origin')));

    const r3 = await withAdminResponseCache(kv, 'ep', makeReq('Bearer tokB'), 'Bearer tokB', producer);
    await r3.json();
    ok('★ 不同身份不共享缓存（producer 再次执行）', calls === 2, 'calls=' + calls);

    // 运维开关：{"mode":"off"} → 全部绕过
    kv._m.set('admin-heavy-cache-config', JSON.stringify({ mode: 'off' }));
    const cfg = await getAdminCacheConfig(kv);
    ok('运维开关解析 mode=off', cfg.enabled === false, JSON.stringify(cfg));
    const r4 = await withAdminResponseCache(kv, 'ep', makeReq('Bearer tokA'), 'Bearer tokA', producer);
    await r4.json();
    ok('★ 开关关闭时绕过缓存（producer 再执行）', calls === 3, 'calls=' + calls);

    // ttl 解析（clamp）
    kv._m.set('admin-heavy-cache-config', JSON.stringify({ ttl: 99999 }));
    const cfg2 = await getAdminCacheConfig(kv);
    ok('ttl 被 clamp 到 3600', cfg2.ttl === 3600 && cfg2.enabled === true, JSON.stringify(cfg2));

    // 非 2xx 不缓存
    const kv3 = makeKV();
    let denied = 0;
    const deny = async () => { denied++; return new Response('{"success":false}', { status: 403 }); };
    await withAdminResponseCache(kv3, 'ep', makeReq('Bearer t'), 'Bearer t', deny);
    await withAdminResponseCache(kv3, 'ep', makeReq('Bearer t'), 'Bearer t', deny);
    ok('★ 403 不入缓存（每次都真实鉴权）', denied === 2, 'denied=' + denied);
    ok('未写入缓存键', [...kv3._m.keys()].filter(k => k.startsWith('admin_cache:')).length === 0);
}

console.log('\n=== 结果: ' + pass + ' 通过, ' + fail + ' 失败 ===');
process.exit(fail === 0 ? 0 : 1);
