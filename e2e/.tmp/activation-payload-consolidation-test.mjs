// 2026-10-14 激活架构 P3：buildActivationPayload 请求体单点收口 单测
// 直接从权威源 offline.js / cloud.js 抽取真身函数（括号配平），验证 5 种 kind 的
// body 与旧内联实现逐字节同构：claim-cloud(v2+可选密码) / claim-offline(无密码) /
// order-local(密码 8~32 门控) / order-cloud(仅排除 admin)，以及双权威源行为一致。
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dir, '..', '..');

function extractFn(src, marker) {
    const start = src.indexOf(marker);
    assert.ok(start >= 0, '未找到函数: ' + marker);
    const brace = src.indexOf('{', start);
    let depth = 0, i = brace;
    for (; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') { depth--; if (depth === 0) { i++; break; } }
    }
    return src.slice(start, i);
}

function loadBuilder(file) {
    const src = fs.readFileSync(path.join(ROOT, 'shared/auth-core', file), 'utf8');
    const fnSrc = extractFn(src, 'function buildActivationPayload(kind, id)');
    return new Function(fnSrc + '\nreturn buildActivationPayload;')();
}

let passed = 0;
function ok(name, cond) { assert.ok(cond, name); console.log('  ✓ ' + name); passed++; }
function eq(name, a, b) { assert.deepEqual(a, b, name); console.log('  ✓ ' + name); passed++; }

const baseId = {
    code: 'BNZC-TB-202601010001-AAA1', machineId: 'MID-123', user: '王医生',
    clinicName: '惠康中医诊所', phone: '13800138000'
};

for (const [label, file] of [['offline.js', 'offline.js'], ['cloud.js', 'cloud.js']]) {
    const build = loadBuilder(file);
    console.log(label === 'offline.js' ? 'A 组：offline.js buildActivationPayload' : 'B 组：cloud.js buildActivationPayload（与 offline 同构）');

    // ---- claim-cloud ----
    const cc = build('claim-cloud', Object.assign({}, baseId, { password: 'Pa$$w0rd' }));
    eq(label + ' claim-cloud 全字段', cc, {
        code: 'BNZC-TB-202601010001-AAA1', machineId: 'MID-123', user: '王医生',
        clinicName: '惠康中医诊所', phone: '13800138000',
        productClass: 'cloud', clientClass: 'app', pwdCap: 'v2', password: 'Pa$$w0rd'
    });

    const ccNoPwd = build('claim-cloud', Object.assign({}, baseId, { password: '' }));
    ok(label + ' claim-cloud 空密码不带 password 键', !('password' in ccNoPwd));
    ok(label + ' claim-cloud 空密码 stringify 无 password', !JSON.stringify(ccNoPwd).includes('password'));
    ok(label + ' claim-cloud 保留 pwdCap', ccNoPwd.pwdCap === 'v2' && ccNoPwd.productClass === 'cloud');

    // ---- claim-offline ----
    const co = build('claim-offline', Object.assign({}, baseId, { password: 'Pa$$w0rd' }));
    eq(label + ' claim-offline body（即使给密码也不带）', co, {
        code: 'BNZC-TB-202601010001-AAA1', machineId: 'MID-123', user: '王医生',
        clinicName: '惠康中医诊所', phone: '13800138000',
        productClass: 'offline', clientClass: 'app'
    });
    ok(label + ' claim-offline 无 pwdCap/password', !('pwdCap' in co) && !('password' in co));

    // ---- 兜底 ----
    const minClaim = build('claim-cloud', { code: 'C1', user: 'u', phone: '13900000000' });
    ok(label + ' machineId 缺省 → unknown', minClaim.machineId === 'unknown');
    ok(label + ' clinicName 缺省 → 空串', minClaim.clinicName === '');
    ok(label + ' clientClass 缺省 → app', minClaim.clientClass === 'app');
    assert.doesNotThrow(() => build('claim-cloud', null), label + ' id=null 不抛');

    // ---- order ----
    const mkState = (pwd) => ({
        clinicName: '诊所A', adminName: '管理员', phone: '13700000000',
        remark: '', inviteCode: '', password: pwd
    });
    const ordId = {
        orderNo: 'BNZC-TB-202601010002-BBB2', edition: 'pro', price: '￥299/年',
        dp: 'app', machineId: 'MID-9', state: mkState('abcdefgh')
    };
    const kind = file === 'offline.js' ? 'order-local' : 'order-cloud';
    const o = build(kind, ordId);
    eq(label + ' ' + kind + ' 全字段', o, {
        orderNo: 'BNZC-TB-202601010002-BBB2', productKey: file === 'offline.js' ? 'local' : 'cloud',
        edition: 'pro', price: '￥299/年', clinicName: '诊所A', adminName: '管理员',
        phone: '13700000000', machineId: 'MID-9', note: '', inviteCode: '',
        dp: 'app', password: 'abcdefgh'
    });
    ok(label + ' ' + kind + ' machineId 缺省兜底', build(kind, { state: mkState(''), orderNo: 'x' }).machineId === 'unknown');

    // admin 默认密码两版都拒绝
    ok(label + ' ' + kind + ' 默认 admin → 空密码', build(kind, Object.assign({}, ordId, { state: mkState('admin') })).password === '');

    if (file === 'offline.js') {
        // order-local 额外 8~32 长度门控
        ok('A order-local 7 位拒绝', build('order-local', Object.assign({}, ordId, { state: mkState('1234567') })).password === '');
        ok('A order-local 8 位接受', build('order-local', Object.assign({}, ordId, { state: mkState('12345678') })).password === '12345678');
        ok('A order-local 32 位接受', build('order-local', Object.assign({}, ordId, { state: mkState('x'.repeat(32)) })).password === 'x'.repeat(32));
        ok('A order-local 33 位拒绝', build('order-local', Object.assign({}, ordId, { state: mkState('x'.repeat(33)) })).password === '');
        // 邀请码/备注透传 + 空兜底
        const st2 = mkState('12345678'); st2.remark = '备注'; st2.inviteCode = 'AB12';
        const o2 = build('order-local', Object.assign({}, ordId, { state: st2 }));
        ok('A order-local remark/inviteCode 透传', o2.note === '备注' && o2.inviteCode === 'AB12');
    } else {
        // order-cloud 无长度校验（旧口径：仅排除 admin）
        ok('B order-cloud 7 位接受（云端旧口径无长度校验）', build('order-cloud', Object.assign({}, ordId, { state: mkState('1234567') })).password === '1234567');
        ok('B order-cloud 33 位也接受', build('order-cloud', Object.assign({}, ordId, { state: mkState('x'.repeat(33)) })).password === 'x'.repeat(33));
    }
}

// C 组：双权威源同构——同输入 claim-cloud 输出必须完全一致
{
    const bo = loadBuilder('offline.js');
    const bc = loadBuilder('cloud.js');
    const id = Object.assign({}, baseId, { password: 'secret123' });
    eq('C 双源 claim-cloud 输出一致', bo('claim-cloud', id), bc('claim-cloud', id));
    eq('C 双源 claim-offline 输出一致', bo('claim-offline', id), bc('claim-offline', id));
    // order 仅 productKey/密码门控按 kind 区分：同 kind 跨源一致
    const ordId = { orderNo: 'O1', edition: 'personal', price: 'p', dp: 'desktop', machineId: 'm',
        state: { clinicName: 'c', adminName: 'a', phone: 'p', remark: '', inviteCode: '', password: '12345678' } };
    eq('C 双源 order-cloud 输出一致', bo('order-cloud', ordId), bc('order-cloud', ordId));
}

console.log('\nP3 buildActivationPayload 全部通过：' + passed + ' 断言');
