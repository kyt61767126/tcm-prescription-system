// 对照实验：同一端点，密码错误（提前失败）vs 密码正确（走完全部认证后工作）
// 目的：把"KV 往返次数"与"认证后附加工作"的耗时贡献分离出来
// 安全：只失败 1 次（服务端有尝试次数限制），随后用正确密码成功登录 1 次
const BASE = 'https://tcm-prescription-system.pages.dev/api';
const USER = '13398222222';
const PASS = 'Abcd1234';
const MID = 'e2e-latency-probe-0001';

async function login(label, password) {
    const t0 = Date.now();
    let status = 0, text = '';
    try {
        const r = await fetch(BASE + '/users?login=true', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: USER, password, machineId: MID, clientClass: 'desktop' })
        });
        status = r.status; text = await r.text();
    } catch (e) { text = 'ERR ' + e.message; }
    const dt = Date.now() - t0;
    let short = '';
    try { const j = JSON.parse(text); short = j.success ? 'success' : (j.error || '').slice(0, 40); } catch (_) { short = text.slice(0, 40); }
    console.log('  ' + label.padEnd(30) + ' HTTP ' + status + '  ' + String(dt).padStart(6) + 'ms   ' + short);
    return dt;
}

(async () => {
    console.log('=== 暖态下的对照（先做 1 次成功登录把路径唤醒）===');
    await login('预热(正确密码)', PASS);
    await new Promise(r => setTimeout(r, 500));
    const wrong = await login('密码错误(提前失败)', 'WrongPass123');
    await new Promise(r => setTimeout(r, 500));
    const ok1 = await login('正确密码(完整链路)', PASS);
    await new Promise(r => setTimeout(r, 500));
    const ok2 = await login('正确密码(再一次)', PASS);
    console.log('\n=== 差值分析 ===');
    console.log('  提前失败 ' + wrong + 'ms   vs   完整链路 ' + ok1 + 'ms / ' + ok2 + 'ms');
    console.log('  → 认证后附加工作约占 ' + Math.max(0, Math.round(((ok1 + ok2) / 2) - wrong)) + 'ms');
})();
