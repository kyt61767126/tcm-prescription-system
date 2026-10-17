// P1-① 能力协商验证：同一账号 —— 带 prefetchPartialOk 与不带，比较响应字段
// 期望：两者均 success；带声明时多出 prescriptionsPartial / prescriptionTotal 字段；
//       不带声明时字段恒 false/null（= 老客户端行为不变）
const BASE = 'https://tcm-prescription-system.pages.dev/api';
const USER = '13398222222', PASS = 'Abcd1234', MID = 'e2e-latency-probe-0001';

async function login(label, extra) {
    const body = Object.assign({ username: USER, password: PASS, machineId: MID, clientClass: 'desktop' }, extra || {});
    const t0 = Date.now();
    const r = await fetch(BASE + '/users?login=true', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    const t = await r.text();
    let j = null; try { j = JSON.parse(t); } catch (_) {}
    console.log('  ' + label.padEnd(28) + ' HTTP ' + r.status + '  ' + String(Date.now() - t0).padStart(6) + 'ms  ' +
        Math.round(t.length / 1024) + 'KB');
    console.log('      success=' + (j && j.success) +
        '  prescriptions=' + (j && Array.isArray(j.prescriptions) ? j.prescriptions.length + '条' : String(j && j.prescriptions)) +
        '  partial=' + JSON.stringify(j && j.prescriptionsPartial) +
        '  total=' + JSON.stringify(j && j.prescriptionTotal));
    return j;
}

(async () => {
    console.log('=== 带能力声明（新客户端路径）===');
    const a = await login('prefetchPartialOk=true', { prefetchPartialOk: true });
    console.log('\n=== 不带声明（老客户端路径，必须行为不变）===');
    const b = await login('无该字段', {});
    console.log('\n=== 判定 ===');
    const hasFields = a && ('prescriptionsPartial' in a) && ('prescriptionTotal' in a);
    const oldUnchanged = b && b.prescriptionsPartial === false && b.prescriptionTotal === null;
    console.log('  新客户端：响应含 partial/total 字段 = ' + (hasFields ? '✅' : '★ 缺失'));
    console.log('  老客户端：字段恒 false/null、无 partial 语义 = ' + (oldUnchanged ? '✅ 行为不变' : '★ 异常'));
    console.log('  （本测试诊所无处方数据，故 prescriptions 为空；partial 判定逻辑在有数据时生效）');
})();
