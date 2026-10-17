// ============================================================================
//  license-renew-backfill-test.cjs — 续费顺延「码记录 clinicName 回填 + 诊所→码索引」
//  回归门禁（2026-10-10 P0 第 2 项）
//
//  背景（docs/登录速度分析与优化建议.md 第十一章）：
//    淘宝重复购买顺延路径（admin-account.renewClinicForRepeatPurchase）**只写 clinic:{id}**，
//    从不碰 license:{code} ⇒ 该码 clinicName 恒空 ⇒ 两处实证故障：
//      · login 机构版设备额度预检按 `license_clinic_index`（clinicName→codes 投影索引）取码 → 取不到；
//      · 后台「诊所授权」视图按 rec.clinicName 联表 → 该码不进视图。
//    唯一客户实证：15200069705 / clinic_o67d5eqv1r（已续费到 2028-10-07 却仍查不到授权）。
//    修法：顺延末尾读回码记录，仅当 clinicName 为空（或已一致）时写回，
//    借 updateLicense→saveLicense 的 clinicName diff **顺带把索引项补上**。
//
//  本门禁按函数本体【import 真实模块】执行（不抄副本），用 mock KV 驱动：
//    A 组 回填与索引：空 clinicName → 回填 + 索引新增本码；索引其他条目不被破坏
//    B 组 安全边界：已绑定「别的诊所」→ 绝不覆盖（防越权改归属），顺延仍生效
//    C 组 容错：KV 读异常 / 码记录不存在 / 索引键缺失 → 均不得影响已生效的顺延
//    D 组 幂等：二次调用 already:true、到期时间不叠加、零额外 KV 写
//
//  用法: node tools/license-renew-backfill-test.cjs     退出码 0=全过
// ============================================================================
'use strict';
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
    if (cond) { console.log('  PASS  ' + name); pass++; }
    else { console.log('  FAIL  ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')); fail++; }
};

// ---- mock KV（只实现被测路径用到的最小面：get/put/delete + 可注入故障）----
function makeKV(seed, opts) {
    opts = opts || {};
    const map = new Map(Object.entries(seed || {}));
    const ops = { get: [], put: [], delete: [] };
    return {
        _m: map, _ops: ops,
        async get(k, type) {
            ops.get.push(k);
            if (opts.failGet && opts.failGet(k)) throw new Error('mock KV get 失败: ' + k);
            if (!map.has(k)) return null;
            const raw = map.get(k);
            if (type === 'json') { try { return JSON.parse(raw); } catch (e) { return null; } }
            return raw;
        },
        async put(k, v) {
            ops.put.push(k);
            if (opts.failPut && opts.failPut(k)) throw new Error('mock KV put 失败: ' + k);
            map.set(k, typeof v === 'string' ? v : JSON.stringify(v));
        },
        async delete(k) { ops.delete.push(k); map.delete(k); },
    };
}

const CLINIC_ID = 'clinic_o67d5eqv1r';
const CLINIC_NAME = '中医诊所·9705';
const PHONE = '15200069705';
const CODE = 'BNZC-RNW1-AAAA-BBBB-CCCC';
const OTHER_CLINIC = '别的诊所·9999';

const baseClinics = () => ([{ id: CLINIC_ID, name: CLINIC_NAME, status: 'active', edition: 'cloud_personal', expiresAt: '2027-10-08T00:00:00.000Z' }]);
const baseClinicUsers = () => ({ [`clinic:${CLINIC_ID}:users`]: JSON.stringify([{ username: PHONE, phone: PHONE, role: 'clinic_admin' }]) });

(function main() {
    (async () => {
        const acc = await import(pathToFileURL(path.join(ROOT, 'functions/api/license/_lib/admin-account.js')).href);
        const { renewClinicForRepeatPurchase } = acc;
        ok('被测函数 renewClinicForRepeatPurchase 可导入', typeof renewClinicForRepeatPurchase === 'function');

        // ================= A 组：clinicName 回填 + 索引随续费更新 =================
        console.log('\n--- A) 空 clinicName → 回填 + license_clinic_index 新增本码 ---');
        {
            const seed = Object.assign({
                'system:clinics': JSON.stringify(baseClinics()),
                [`license:${CODE}`]: JSON.stringify({ code: CODE, status: 'used', type: 'personal', days: 365, devices: [{ machineId: 'MID-1' }] }),
                'license_clinic_index': JSON.stringify({ [OTHER_CLINIC]: ['BNZC-OTHR-0000-0000-0000'] }),
                'system:license_index': JSON.stringify(['BNZC-OTHR-0000-0000-0000', CODE]),
            }, baseClinicUsers());
            const kv = makeKV(seed);
            const r = await renewClinicForRepeatPurchase(kv, { code: CODE, phone: PHONE, days: 365, type: 'personal' });
            ok('A1 顺延成功', r && r.ok === true && r.renewed === true, r);
            ok('A2 诊所到期日顺延到 2028-10-07', r.newExpiresAt === '2028-10-07T00:00:00.000Z', r.newExpiresAt);
            const lic = JSON.parse(kv._m.get(`license:${CODE}`));
            ok('A3 ★ 码记录 clinicName 被回填为本诊所名', lic.clinicName === CLINIC_NAME, lic.clinicName);
            ok('A4 码记录其余字段未被破坏（status/devices/days 原样）',
                lic.status === 'used' && Array.isArray(lic.devices) && lic.devices.length === 1 && lic.days === 365,
                { status: lic.status, devices: lic.devices, days: lic.days });
            const idx = JSON.parse(kv._m.get('license_clinic_index'));
            ok('A5 ★ 诊所→码索引新增本码', Array.isArray(idx[CLINIC_NAME]) && idx[CLINIC_NAME].includes(CODE), idx);
            ok('A6 索引其他诊所条目未被破坏',
                Array.isArray(idx[OTHER_CLINIC]) && idx[OTHER_CLINIC].length === 1 && idx[OTHER_CLINIC][0] === 'BNZC-OTHR-0000-0000-0000', idx);
            ok('A7 返回值标记 licenseBackfilled=true', r.licenseBackfilled === true, r.licenseBackfilled);
        }
        {
            // clinicName 字段整体缺失（undefined）也要回填
            const seed = Object.assign({
                'system:clinics': JSON.stringify(baseClinics()),
                [`license:${CODE}`]: JSON.stringify({ code: CODE, status: 'used' }),
                'license_clinic_index': JSON.stringify({ [OTHER_CLINIC]: ['BNZC-OTHR-0000-0000-0000'] }),
            }, baseClinicUsers());
            const kv = makeKV(seed);
            await renewClinicForRepeatPurchase(kv, { code: CODE, phone: PHONE, days: 90 });
            const lic = JSON.parse(kv._m.get(`license:${CODE}`));
            ok('A8 字段缺失（undefined）同样回填', lic.clinicName === CLINIC_NAME, lic.clinicName);
        }

        // ================= B 组：安全边界（绝不越权改归属）=================
        console.log('\n--- B) 码已绑定「别的诊所」→ 绝不覆盖 clinicName ---');
        {
            const seed = Object.assign({
                'system:clinics': JSON.stringify(baseClinics()),
                [`license:${CODE}`]: JSON.stringify({ code: CODE, status: 'used', clinicName: OTHER_CLINIC }),
                'license_clinic_index': JSON.stringify({ [OTHER_CLINIC]: [CODE] }),
            }, baseClinicUsers());
            const kv = makeKV(seed);
            const r = await renewClinicForRepeatPurchase(kv, { code: CODE, phone: PHONE, days: 365 });
            const lic = JSON.parse(kv._m.get(`license:${CODE}`));
            ok('B1 顺延仍生效（不因归属冲突而放弃续费）', r.ok === true && r.renewed === true, r);
            ok('B2 ★ clinicName 保持原归属（未被改成本诊所）', lic.clinicName === OTHER_CLINIC, lic.clinicName);
            const idx = JSON.parse(kv._m.get('license_clinic_index'));
            ok('B3 索引未把本码挂到本诊所', !idx[CLINIC_NAME] || idx[CLINIC_NAME].indexOf(CODE) < 0, idx);
            ok('B4 licenseBackfilled=false（未回填）', r.licenseBackfilled === false, r.licenseBackfilled);
        }

        // ================= C 组：容错（任何异常都不影响已生效的顺延）=================
        console.log('\n--- C) 容错：读异常 / 码不存在 / 索引键缺失 ---');
        {
            const seed = Object.assign({
                'system:clinics': JSON.stringify(baseClinics()),
                [`license:${CODE}`]: JSON.stringify({ code: CODE, status: 'used' }),
            }, baseClinicUsers());
            const kv = makeKV(seed, { failGet: (k) => k === `license:${CODE}` });
            let threw = false;
            let r = null;
            try { r = await renewClinicForRepeatPurchase(kv, { code: CODE, phone: PHONE, days: 365 }); } catch (e) { threw = true; }
            ok('C1 KV 读异常不抛出', !threw);
            ok('C2 读异常时顺延仍返回 ok:true/renewed:true', r && r.ok === true && r.renewed === true, r);
            const clinics = JSON.parse(kv._m.get('system:clinics'));
            ok('C3 读异常时诊所到期日已落库（顺延主结果不受影响）',
                clinics[0].expiresAt === '2028-10-07T00:00:00.000Z', clinics[0].expiresAt);
        }
        {
            const seed = Object.assign({
                'system:clinics': JSON.stringify(baseClinics()),
                'license_clinic_index': JSON.stringify({ [OTHER_CLINIC]: ['BNZC-OTHR-0000-0000-0000'] }),
            }, baseClinicUsers());   // 没有 license:{CODE}
            const kv = makeKV(seed);
            const r = await renewClinicForRepeatPurchase(kv, { code: CODE, phone: PHONE, days: 365 });
            ok('C4 码记录不存在 → 跳过回填、顺延仍成功', r.ok === true && r.renewed === true && r.licenseBackfilled === false, r);
            ok('C5 码记录不存在 → 未凭空创建 license 键', !kv._m.has(`license:${CODE}`));
        }
        {
            // 索引装配抛错（脏 JSON）不得影响顺延
            const seed = Object.assign({
                'system:clinics': JSON.stringify(baseClinics()),
                [`license:${CODE}`]: JSON.stringify({ code: CODE, status: 'used' }),
                'license_clinic_index': 'CORRUPT{',
            }, baseClinicUsers());
            const kv = makeKV(seed);
            let threw = false, r = null;
            try { r = await renewClinicForRepeatPurchase(kv, { code: CODE, phone: PHONE, days: 365 }); } catch (e) { threw = true; }
            ok('C6 索引脏值不抛出且顺延成功', !threw && r && r.ok === true && r.renewed === true, r);
            const lic = JSON.parse(kv._m.get(`license:${CODE}`));
            ok('C7 索引脏值时码记录 clinicName 仍回填（读侧可全扫兜底）', lic.clinicName === CLINIC_NAME, lic.clinicName);
        }
        {
            // put 抛错（写码记录失败）→ 顺延已生效，函数不抛
            const seed = Object.assign({
                'system:clinics': JSON.stringify(baseClinics()),
                [`license:${CODE}`]: JSON.stringify({ code: CODE, status: 'used' }),
            }, baseClinicUsers());
            const kv = makeKV(seed, { failPut: (k) => k === `license:${CODE}` });
            let threw = false, r = null;
            try { r = await renewClinicForRepeatPurchase(kv, { code: CODE, phone: PHONE, days: 365 }); } catch (e) { threw = true; }
            ok('C8 写码记录失败不抛出且顺延成功', !threw && r && r.ok === true && r.renewed === true, r);
        }

        // ================= D 组：幂等（二次调用不叠加、不重复写）=================
        console.log('\n--- D) 幂等：二次调用不叠加天数 ---');
        {
            const seed = Object.assign({
                'system:clinics': JSON.stringify(baseClinics()),
                [`license:${CODE}`]: JSON.stringify({ code: CODE, status: 'used' }),
                'license_clinic_index': JSON.stringify({ [OTHER_CLINIC]: ['BNZC-OTHR-0000-0000-0000'] }),
            }, baseClinicUsers());
            const kv = makeKV(seed);
            const r1 = await renewClinicForRepeatPurchase(kv, { code: CODE, phone: PHONE, days: 365 });
            const writesAfter1 = kv._ops.put.length;
            const r2 = await renewClinicForRepeatPurchase(kv, { code: CODE, phone: PHONE, days: 365 });
            ok('D1 二次调用返回 already:true', r2.ok === true && r2.already === true && r2.renewed === false, r2);
            ok('D2 二次调用到期时间与首次一致（不叠加）', r2.newExpiresAt === r1.newExpiresAt, { r1: r1.newExpiresAt, r2: r2.newExpiresAt });
            ok('D3 二次调用零额外 KV 写', kv._ops.put.length === writesAfter1, { after1: writesAfter1, now: kv._ops.put.length });
            const clinics = JSON.parse(kv._m.get('system:clinics'));
            ok('D4 诊所到期日仍是 2028-10-07（未被二次叠加）', clinics[0].expiresAt === '2028-10-07T00:00:00.000Z', clinics[0].expiresAt);
        }

        console.log('\n=== 结果: ' + pass + ' 通过, ' + fail + ' 失败 ===');
        process.exit(fail === 0 ? 0 : 1);
    })().catch(e => {
        console.log('  FAIL  运行异常: ' + (e && e.stack || e));
        process.exit(1);
    });
})();
