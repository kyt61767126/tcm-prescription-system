// 登录速度线上实测：服务端登录端点 + 登录后主界面首屏各接口逐项计时
// 安全：使用我自己的测试账号（13398222222 / Abcd1234）+ 已绑定的合成机器码，不触碰真实设备绑定
const BASE = 'https://tcm-prescription-system.pages.dev/api';
const USER = '13398222222';
const PASS = 'Abcd1234';
const MID = 'e2e-latency-probe-0001';   // 该账号已绑定的机器码（避免新增设备/顶号）

async function timed(label, url, init) {
    const t0 = Date.now();
    let status = 0, text = '', ok = false;
    try {
        const r = await fetch(url, init);
        status = r.status;
        text = await r.text();
        ok = r.ok;
    } catch (e) { text = 'ERR ' + e.message; }
    const dt = Date.now() - t0;
    console.log('  ' + label.padEnd(34) + ' HTTP ' + status + '  ' + String(dt).padStart(6) + 'ms   ' +
        Math.round(text.length / 1024) + 'KB');
    return { dt, status, text };
}

(async () => {
    console.log('=== ① 服务端登录端点（POST /users?login=true）===');
    const body = () => JSON.stringify({ username: USER, password: PASS, machineId: MID, clientClass: 'desktop' });
    const logs = [];
    for (let i = 1; i <= 3; i++) {
        const r = await timed('第' + i + '次登录', BASE + '/users?login=true', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body()
        });
        logs.push(r);
        if (i === 1) {
            try {
                const j = JSON.parse(r.text);
                console.log('      → success=' + j.success + '  token=' + (j.token ? '有' : '无') +
                    '  clinicId=' + (j.user && j.user.clinicId) + '  clinicName=' + (j.user && j.user.clinicName) +
                    '  预取处方=' + (Array.isArray(j.prescriptions) ? j.prescriptions.length + ' 条' : '无'));
                if (j.token) {
                    global.__TOKEN = j.token;
                    global.__CLINIC = (j.user && j.user.clinicId) || '';
                }
            } catch (e) { console.log('      解析失败: ' + r.text.slice(0, 120)); }
        }
        await new Promise(r => setTimeout(r, 400));
    }

    console.log('\n=== ② 登录后首屏各接口（模拟 loadData）===');
    const H = { 'Authorization': 'Bearer ' + (global.__TOKEN || ''), 'Content-Type': 'application/json' };
    const CID = global.__CLINIC || 'clinic_2m47pcmzpf';
    await timed('GET /prescriptions（处方·主数据）', BASE + '/prescriptions?clinicId=' + CID, { headers: H });
    await timed('GET /medicines（药品）', BASE + '/medicines?clinicId=' + CID, { headers: H });
    await timed('GET /formulas（方剂）', BASE + '/formulas?clinicId=' + CID, { headers: H });
    await timed('GET /license/entitlement（授权裁决）', BASE + '/license/entitlement?machineId=' + MID, { headers: H });
    await timed('GET /users?clinics=true&lite=1（诊所简表）', BASE + '/users?clinics=true&lite=1', { headers: H });

    console.log('\n=== ③ 并发对照：首屏三接口并行 ==="');
    const t0 = Date.now();
    await Promise.all([
        fetch(BASE + '/prescriptions?clinicId=' + CID, { headers: H }),
        fetch(BASE + '/medicines?clinicId=' + CID, { headers: H }),
        fetch(BASE + '/formulas?clinicId=' + CID, { headers: H })
    ]);
    console.log('  并行 3 接口合计 ' + (Date.now() - t0) + 'ms');

    console.log('\n=== 结论数据 ===');
    console.log('  登录耗时: ' + logs.map((l, i) => '第' + (i + 1) + '次 ' + l.dt + 'ms').join('   '));
})();
