// ============================================================================
// biz-smoke.cjs — P2-2 核心业务冒烟（医疗/资金数据事故防线）
//
// 目的：把四条"错了就是医疗事故/真金白银损失"的业务数学锁进无 DOM 沙箱，
//       push 前秒级回归（pre-push 十三道门）：
//         A 组 库存扣减/冲正 —— shared/stock-core.js 真实文件 vm 执行
//              （剂量×剂数、同名合并、差值冲正、删味全退、幂等标记、
//                幻影退回防护、药品已删跳过、浮点 round2）
//         B 组 续费数学 —— license-core.buildLicenseData 锚定+保底
//              （重装不续命/rewardDays 叠加/续费取晚者/坏日期）
//              + users.computeRenewedExpiresAt（诊所续费锚点取晚者）
//         C 组 处方读取毒数据 —— prescriptions-store.d1RowToPrescription
//              （坏 JSON 列 fallback、id 数字串还原事故回归）
//         D 组 loadData 毒数据 —— 从六端 HTML 真实产物提取
//              safeParseJSON/removeDuplicateMedicines 函数体 vm 执行
//              （既测行为又守副本一致性：哪份副本漂移或缺函数即 FAIL）
//
// 零依赖：node:vm + 动态 import ESM，不引 jsdom。
// 用法：node tools/biz-smoke.cjs   （fail>0 → exit 1）
// ============================================================================
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
const fails = [];

function check(name, cond, extra) {
    if (cond) { pass++; }
    else { fail++; fails.push(name + (extra ? ' → ' + extra : '')); }
}
function eq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function approx(a, b, eps = 1e-6) { return Math.abs(a - b) <= eps; }

// 字符串感知的函数体提取（与 smoke-runtime.cjs 同款扫描器，提取某函数全部副本）
function extractAllFunctions(src, name) {
    const bodies = [];
    const headRe = new RegExp('function\\s+' + name + '\\s*\\([^)]*\\)\\s*\\{', 'g');
    let m;
    while ((m = headRe.exec(src)) !== null) {
        let i = src.indexOf('{', m.index);
        if (i < 0) break;
        const start = i;
        let depth = 0, closed = false;
        while (i < src.length) {
            const c = src[i];
            if (c === "'" || c === '"') {
                const q = c; i++;
                while (i < src.length && src[i] !== q) { if (src[i] === '\\') i++; i++; }
                i++; continue;
            }
            if (c === '`') {
                i++;
                while (i < src.length && src[i] !== '`') { if (src[i] === '\\') i++; i++; }
                i++; continue;
            }
            if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
            if (c === '/' && src[i + 1] === '*') {
                i += 2;
                while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++;
                i += 2; continue;
            }
            if (c === '{') depth++;
            else if (c === '}') { depth--; if (depth === 0) { bodies.push(src.substring(m.index, i + 1)); closed = true; break; } }
            i++;
        }
        if (!closed) throw new Error('函数 ' + name + ' 括号不平衡');
    }
    return bodies;
}

// ============================================================================
// A 组：库存扣减/冲正（加载 shared/stock-core.js 真实 IIFE）
// ============================================================================
function loadStockCore(seedStorage) {
    const src = fs.readFileSync(path.join(ROOT, 'shared/stock-core.js'), 'utf8');
    const storage = Object.assign({}, seedStorage || {});
    const elStub = () => ({ style: {}, classList: { add() {}, remove() {}, toggle() {} },
        addEventListener() {}, appendChild() {}, removeChild() {}, setAttribute() {},
        removeAttribute() {}, innerHTML: '', textContent: '', value: '', checked: false,
        querySelector() { return null; }, querySelectorAll() { return []; }, append() {}, remove() {} });
    const sb = {
        console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
        localStorage: {
            getItem: (k) => (k in storage ? storage[k] : null),
            setItem: (k, v) => { storage[k] = String(v); },
            removeItem: (k) => { delete storage[k]; },
            clear() { for (const k of Object.keys(storage)) delete storage[k]; },
        },
        document: {
            readyState: 'complete',
            addEventListener() {},
            getElementById() { return elStub(); },
            querySelector() { return null; },
            querySelectorAll() { return []; },
            createElement() { return elStub(); },
            head: { appendChild() {} },
            body: { appendChild() {} },
        },
        setInterval() { return 0; }, clearInterval() {}, setTimeout(fn) { return 0; }, clearTimeout() {},
        confirm() { return true; }, alert() {}, Blob: function () {}, URL: { createObjectURL() { return ''; }, revokeObjectURL() {} },
    };
    sb.window = sb; sb.globalThis = sb;
    vm.createContext(sb);
    vm.runInContext(src, sb, { filename: 'stock-core.js' });
    if (!sb.StockCore) throw new Error('stock-core.js 未挂全局 StockCore');
    sb.StockCore.setEnabled(true);
    return { SC: sb.StockCore, storage };
}

function runGroupA() {
    // —— 纯计算 planDeduction：不需要药品库 ——
    const { SC } = loadStockCore({});

    let p = SC._planDeduction({ items: [{ name: '黄芪', dosage: 10 }, { name: '当归', dosage: 5 }], doseCount: 7 });
    check('A1 首存计划=剂量×剂数', eq(p.deltas, [{ name: '黄芪', delta: 70 }, { name: '当归', delta: 35 }]), JSON.stringify(p.deltas));

    p = SC._planDeduction({ items: [{ name: '黄芪', dosage: 10 }, { name: '黄芪', dosage: 20 }], doseCount: 3 });
    check('A2 同名药味合并计 90', p.deltas.length === 1 && p.deltas[0].name === '黄芪' && approx(p.deltas[0].delta, 90));

    p = SC._planDeduction({ items: [{ name: '黄芪', dosage: 'abc' }, { dosage: 9 }, { name: '甘草' }], doseCount: 'x' });
    check('A3 毒数据(脏剂量/脏剂数/无名药味)不抛错且零扣减', !p.hasChanges && Array.isArray(p.deltas) && p.deltas.length === 0);

    p = SC._planDeduction({ items: 'garbage', doseCount: 7 });
    check('A3b items 非数组→空计划不抛错', !p.hasChanges && p.deltas.length === 0);

    const baseRec = { items: [{ name: '黄芪', dosage: 10 }], doseCount: 7 };
    const first = SC._planDeduction(baseRec);
    const again = SC._planDeduction(Object.assign({}, baseRec, { __stockApplied: first.marker }));
    check('A4 幂等：同内容重存零差值', !again.hasChanges && again.deltas.length === 0);

    const recLess = { items: [{ name: '黄芪', dosage: 7 }], doseCount: 7,
        __stockApplied: { v: 1, at: 't', items: { '黄芪': 70 } } };
    p = SC._planDeduction(recLess);
    check('A5 减量冲正：70→49 退回 21', eq(p.deltas, [{ name: '黄芪', delta: -21 }]), JSON.stringify(p.deltas));

    const recDel = { items: [{ name: '黄芪', dosage: 10 }], doseCount: 7,
        __stockApplied: { v: 1, at: 't', items: { '黄芪': 70, '当归': 35 } } };
    p = SC._planDeduction(recDel);
    check('A6 删味全额退回 35', eq(p.deltas, [{ name: '当归', delta: -35 }]), JSON.stringify(p.deltas));

    p = SC._planDeduction({ items: [{ name: '黄芪', dosage: 10 }], doseCount: 7,
        __stockApplied: { v: 1, items: 'GARBAGE-STRING' } });
    check('A7 脏 marker（非对象）按首次扣减不抛错', p.hasChanges && eq(p.deltas, [{ name: '黄芪', delta: 70 }]));

    p = SC._planDeduction({ items: [{ name: 'X', dosage: 0.1 }], doseCount: 3 });
    check('A8 浮点 round2：0.1×3=0.3 无尾差', approx(p.deltas[0].delta, 0.3));

    // —— commit/revert 端到端：需要 mock 药品库（localStorage 副本路径）——
    const seed = () => ({ local_stockMgmtEnabled: 'true',
        local_medicines: JSON.stringify([{ name: '黄芪', stock: 100, stockThreshold: 50 }, { name: '当归', stock: 60 }]) });

    let env = loadStockCore(seed());
    const r1 = { items: [{ name: '黄芪', dosage: 10 }, { name: '当归', dosage: 5 }], doseCount: 7, prescriptionNo: 'RX-1' };
    const plan1 = SC_PlanWith(env, r1);
    const warns1 = env.SC._commitDeduction(plan1, 'RX-1', true);
    let meds = JSON.parse(env.storage.local_medicines);
    check('A9 首方 commit：黄芪 100→30、当归 60→25',
        approx(meds[0].stock, 30) && approx(meds[1].stock, 25), env.storage.local_medicines);
    let led = JSON.parse(env.storage.stock_ledger_v1);
    const rxHuangqi = led.find(e => e.type === 'rx' && e.name === '黄芪');
    check('A10 流水记 rx 处方消耗（带扣减量 70、结存 30）',
        !!rxHuangqi && approx(rxHuangqi.qty, 70) && approx(rxHuangqi.stock, 30),
        JSON.stringify(led.map(e => e.name + ':' + e.type + '=' + e.qty)));
    check('A10b 低于阈值预警（当归 25<无阈值？→ 黄芪30<50 预警）',
        Array.isArray(warns1) && warns1.some(w => w.name === '黄芪' && approx(w.stock, 30)));

    // 同方减量重存（rx-adj）：黄芪 10→7 剂每剂 → 退回 21
    const r1adj = { items: [{ name: '黄芪', dosage: 7 }, { name: '当归', dosage: 5 }], doseCount: 7,
        prescriptionNo: 'RX-1', __stockApplied: plan1.marker };
    const planAdj = SC_PlanWith(env, r1adj);
    env.SC._commitDeduction(planAdj, 'RX-1', false);
    meds = JSON.parse(env.storage.local_medicines);
    check('A11 减量重存退回：黄芪 30→51', approx(meds[0].stock, 51), String(meds[0].stock));
    led = JSON.parse(env.storage.stock_ledger_v1);
    const adjHuangqi = led.find(e => e.type === 'rx-adj' && e.name === '黄芪');
    // 现状契约：rx-adj 记带符号 delta（-21 = 退回 21）；结存回升到 51
    check('A11b 流水记 rx-adj（qty=-21 表退回、结存 51）',
        !!adjHuangqi && approx(adjHuangqi.qty, -21) && approx(adjHuangqi.stock, 51));

    // 删除冲回（有 marker 才冲，防幻影退回）
    const nRev = env.SC._revertRecord({ prescriptionNo: 'RX-1', __stockApplied: planAdj.marker });
    meds = JSON.parse(env.storage.local_medicines);
    check('A12 revert 按最终 marker 全额冲回（黄芪49/当归35）',
        nRev === 2 && approx(meds[0].stock, 100) && approx(meds[1].stock, 60),
        'n=' + nRev + ' ' + env.storage.local_medicines);
    led = JSON.parse(env.storage.stock_ledger_v1);
    check('A12b 流水记 rx-revert 删除冲回', led[0].type === 'rx-revert' && approx(led[0].qty, 35));
    const nGhost = env.SC._revertRecord({ prescriptionNo: 'RX-NO', items: [] });
    check('A13 无 marker 不幻影退回', nGhost === 0);

    // 药品已从药品库删除/改名：commit/revert 跳过不抛错
    env = loadStockCore({ local_stockMgmtEnabled: 'true', local_medicines: JSON.stringify([{ name: '枸杞', stock: 5 }]) });
    let threw = false;
    try {
        const pn = SC_PlanWith(env, { items: [{ name: '黄芪', dosage: 10 }], doseCount: 7 });
        env.SC._commitDeduction(pn, 'RX-2', true);
        env.SC._revertRecord({ __stockApplied: { '黄芪': 70 } });
    } catch (e) { threw = true; }
    check('A14 药已删/改名：扣减与冲回均跳过不抛错', !threw);
    check('A14b 无干药品库存不变', approx(JSON.parse(env.storage.local_medicines)[0].stock, 5));

    // 库存允许扣成负数（开方不被库存阻断，只预警）
    env = loadStockCore({ local_stockMgmtEnabled: 'true', local_medicines: JSON.stringify([{ name: '附子', stock: 10 }]) });
    const pn = SC_PlanWith(env, { items: [{ name: '附子', dosage: 10 }], doseCount: 3 });
    const wNeg = env.SC._commitDeduction(pn, 'RX-3', true);
    check('A15 库存不足扣成负数且预警',
        approx(JSON.parse(env.storage.local_medicines)[0].stock, -20) &&
        Array.isArray(wNeg) && wNeg.some(w => w.name === '附子'));
}
// 每个沙箱的 plan 必须用该沙箱内的 StockCore（闭包小助手）
function SC_PlanWith(env, record) { return env.SC._planDeduction(record); }

// ============================================================================
// B 组：续费数学
// ============================================================================
async function runGroupB() {
    const DAY = 24 * 60 * 60 * 1000;
    const licenseCore = await import(pathToFileURL(path.join(ROOT, 'functions/api/license/_lib/license-core.js')).href);
    const users = await import(pathToFileURL(path.join(ROOT, 'functions/api/users.js')).href);
    const { buildLicenseData } = licenseCore;
    const { computeRenewedExpiresAt } = users;

    const anchor = '2026-01-01T00:00:00.000Z';
    // buildLicenseData：只断言 expiresAt 数学；传测试 secret 走 HMAC，不带 context 跳过 ECDSA
    const expOf = async (rec) => (await buildLicenseData(rec, { secret: 'biz-smoke-secret' })).expiresAt;

    check('B1 锚定首次激活日：重装/换机不续命',
        (await expOf({ code: 'BNZC-AAAA-0000-0000-0000', type: 'personal', days: 365, firstActivatedAt: anchor }))
        === new Date(new Date(anchor).getTime() + 365 * DAY).toISOString());

    check('B2 无 firstActivatedAt 回退 activatedAt',
        (await expOf({ code: 'BNZC-BBBB-0000-0000-0000', type: 'personal', days: 100, activatedAt: anchor }))
        === new Date(new Date(anchor).getTime() + 100 * DAY).toISOString());

    check('B3 rewardDays 合法叠加（365+30）',
        (await expOf({ code: 'BNZC-CCCC-0000-0000-0000', type: 'personal', days: 365, rewardDays: 30, firstActivatedAt: anchor }))
        === new Date(new Date(anchor).getTime() + 395 * DAY).toISOString());

    const later = new Date(new Date(anchor).getTime() + 700 * DAY).toISOString();
    check('B4 续费保底取晚者：record.expiresAt 晚于锚定到期→取续费值',
        (await expOf({ code: 'BNZC-DDDD-0000-0000-0000', type: 'personal', days: 365, firstActivatedAt: anchor, expiresAt: later }))
        === later);

    const earlier = new Date(new Date(anchor).getTime() + 10 * DAY).toISOString();
    check('B5 record.expiresAt 早于锚定到期→锚定值生效',
        (await expOf({ code: 'BNZC-EEEE-0000-0000-0000', type: 'personal', days: 365, firstActivatedAt: anchor, expiresAt: earlier }))
        === new Date(new Date(anchor).getTime() + 365 * DAY).toISOString());

    check('B6 坏 record.expiresAt 不被采用',
        (await expOf({ code: 'BNZC-FFFF-0000-0000-0000', type: 'personal', days: 365, firstActivatedAt: anchor, expiresAt: 'not-a-date' }))
        === new Date(new Date(anchor).getTime() + 365 * DAY).toISOString());

    check('B7 days 非法(0/负)→默认 365',
        (await expOf({ code: 'BNZC-G000-0000-0000-0000', type: 'personal', days: 0, firstActivatedAt: anchor }))
        === new Date(new Date(anchor).getTime() + 365 * DAY).toISOString());

    // —— 诊所续费 computeRenewedExpiresAt：锚点取晚者 ——
    const NOW = new Date('2026-09-25T00:00:00.000Z').getTime();
    check('B8 未过期续费：从到期日续（剩余天数不损失）',
        computeRenewedExpiresAt(new Date(NOW + 100 * DAY).toISOString(), 365, NOW)
        === new Date(NOW + 465 * DAY).toISOString());
    check('B9 已过期续费：从今天续（不叠加死期）',
        computeRenewedExpiresAt(new Date(NOW - 10 * DAY).toISOString(), 365, NOW)
        === new Date(NOW + 365 * DAY).toISOString());
    check('B10 无有效期：从今天续',
        computeRenewedExpiresAt(null, 90, NOW) === new Date(NOW + 90 * DAY).toISOString());
    check('B11 坏日期字符串：从今天续不 NaN',
        computeRenewedExpiresAt('garbage', 90, NOW) === new Date(NOW + 90 * DAY).toISOString());
}

// ============================================================================
// C 组：处方 D1 读取毒数据
// ============================================================================
async function runGroupC() {
    const store = await import(pathToFileURL(path.join(ROOT, 'functions/api/_lib/prescriptions-store.js')).href);
    const { d1RowToPrescription, safeJsonParse } = store;

    const row = {
        id: '1726000000000', patient_name: '张三', doctor_name: '李医生', created_by: 'u1',
        prescription_no: 'RX-1', outpatient_no: 'MZ-1', total_amount: 12.5, fee_status: 'paid',
        paid_at: 't', paid_by: 'cashier', pay_method: 'cash',
        items: '[{"name":"黄芪","dosage":10}]', media_files: '[{"type":"img"}]', extra: '{"note":"x"}',
        deleted_at: null, deleted_by: null, clinic_id: 'c1',
    };
    const p = d1RowToPrescription(row);
    check('C1 纯数字串 id 还原 Number（09-12 按钮失效事故回归）', p.id === 1726000000000 && typeof p.id === 'number');
    check('C2 items/media_files/extra 合法 JSON 还原', eq(p.items, [{ name: '黄芪', dosage: 10 }]) &&
        eq(p.mediaFiles, [{ type: 'img' }]) && eq(p.extra, { note: 'x' }));
    check('C3 列名 camelCase 映射', p.patientName === '张三' && p.prescriptionNo === 'RX-1' && p.clinicId === 'c1');
    check('C4 D1 蛇形列名已清理', !('patient_name' in p) && !('media_files' in p) && !('clinic_id' in p));

    const p2 = d1RowToPrescription(Object.assign({}, row, {
        id: 'RX-2026-001', items: 'CORRUPT{', media_files: '[unclosed', extra: '<<<',
    }));
    check('C5 非数字 id 原样保留字符串', p2.id === 'RX-2026-001' && typeof p2.id === 'string');
    check('C6 坏 JSON 列回退默认值不抛错', eq(p2.items, []) && eq(p2.mediaFiles, []) && eq(p2.extra, {}));

    check('C7 safeJsonParse 坏值→fallback、合法值解析、空串→fallback',
        eq(safeJsonParse('x', []), []) &&
        eq(safeJsonParse('{"a":1}', null), { a: 1 }) &&
        eq(safeJsonParse('', { d: 1 }), { d: 1 }));
}

// ============================================================================
// D 组：loadData 毒数据（六端 HTML 真实产物提取函数体执行）
// ============================================================================
function runGroupD() {
    const { HTML_FILES } = require('./sync-shared-blocks.cjs');
    for (const rel of HTML_FILES) {
        const abs = path.join(ROOT, rel);
        const tag = rel.split(/[\\/]/).slice(-2).join('/');
        if (!fs.existsSync(abs)) { check('D[' + tag + '] HTML 表面存在', false, '缺失: ' + rel); continue; }
        const src = fs.readFileSync(abs, 'utf8');

        let parseBodies = [], dedupBodies = [];
        try { parseBodies = extractAllFunctions(src, 'safeParseJSON'); } catch (e) { check('D[' + tag + '] safeParseJSON 提取', false, e.message); }
        try { dedupBodies = extractAllFunctions(src, 'removeDuplicateMedicines'); } catch (e) { check('D[' + tag + '] removeDuplicateMedicines 提取', false, e.message); }
        check('D[' + tag + '] safeParseJSON 存在', parseBodies.length >= 1);
        check('D[' + tag + '] removeDuplicateMedicines 存在', dedupBodies.length >= 1);
        if (!parseBodies.length || !dedupBodies.length) continue;

        const sb = { console: { log() {}, warn() {}, error() {}, info() {}, debug() {} }, Set, JSON, Array, String, Object };
        sb.window = sb; sb.globalThis = sb;
        vm.createContext(sb);
        try {
            vm.runInContext(parseBodies[0] + '\n' + dedupBodies[0], sb, { filename: tag + '#loadData-fns.js' });
        } catch (e) { check('D[' + tag + '] 函数体沙箱执行', false, e.message); continue; }

        const f = sb.safeParseJSON, d = sb.removeDuplicateMedicines;
        check('D[' + tag + '] 空串→默认值', eq(f('', ['D']), ['D']));
        check('D[' + tag + '] null/undefined 串→默认值', eq(f(null, []), []) && eq(f(undefined, { x: 1 }), { x: 1 }));
        check('D[' + tag + '] 坏 JSON→默认值', eq(f('{broken', ['F']), ['F']));
        check('D[' + tag + '] 合法 JSON 正常解析', eq(f('[{"a":1}]', []), [{ a: 1 }]));
        check('D[' + tag + '] 去重保序（name+code 双键）',
            (() => { const r = d([{ name: 'a', code: '1' }, { name: 'a', code: '1' }, { name: 'a', code: '2' }, { name: 'b', code: '1' }]);
                return r.length === 3 && r[0].name === 'a' && r[2].name === 'b'; })());
        let dedupThrew = false;
        try { d([null, { name: 'a' }, undefined, {}, 'garbage', { name: 'a', code: '1' }, { name: 'a', code: '1' }]); } catch (e) { dedupThrew = true; }
        check('D[' + tag + '] 毒元素(null/无名/非对象)不抛错', !dedupThrew);
    }
}

async function main() {
    console.log('[BIZ-SMOKE] ── P2-2 核心业务冒烟（库存/续费/处方/loadData）──');
    runGroupA();
    await runGroupB();
    await runGroupC();
    runGroupD();
    const total = pass + fail;
    if (fail) {
        console.log('[BIZ-SMOKE][FAIL] 失败用例:');
        for (const f of fails) console.log('  ✗ ' + f);
    }
    console.log('[BIZ-SMOKE] 结果: ' + pass + '/' + total + ' 通过' + (fail ? '，失败 ' + fail + ' 项 !!' : ' ✓'));
    process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('[BIZ-SMOKE][FAIL] 运行异常: ' + (e && e.stack || e)); process.exit(1); });
