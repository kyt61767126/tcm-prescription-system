// ============================================================================
//  login-speed-bench.cjs — 登录速度"体温计"（真机线上基准，可随时/可定期运行）
//
//  为什么要它：2026-10-10 的排查发现，线上登录一度慢到 25.7s（机构版预检全表扫
//  166 条 license），而当时**没有任何机制能提前发现**，只能靠客户投诉反查。
//  本脚本把"登录该多快"变成一条可执行的红线。
//
//  用法：
//    node tools/login-speed-bench.cjs                    # 用内置测试账号
//    LOGIN_BENCH_USER=13xxxx LOGIN_BENCH_PASS=xxx node tools/login-speed-bench.cjs
//    node tools/login-speed-bench.cjs --json             # 机器可读输出（供 CI 解析）
//
//  退出码：0 = 达标；1 = 超红线（可用于定期任务/流水线报警）
//
//  红线（暖态，同一账号连续登录的稳定值）：
//    暖登 ≤ 2500ms（当前实测约 1.7s，留出正常抖动余量）
//    认证后附加工作 ≤ 1600ms（"提前失败"基线之上的部分；当前约 0.9s）
//  冷启动（长时间无请求后首次）单独报告、不参与红线——它天然包含索引回填/冷态 KV 抖动。
//
//  ★ 只用自有测试账号：不触碰任何客户账号，也不做写操作（登录本身会产生会话，属正常行为）。
// ============================================================================
const BASE = process.env.LOGIN_BENCH_BASE || 'https://tcm-prescription-system.pages.dev/api';
const USER = process.env.LOGIN_BENCH_USER || '13398222222';
const PASS = process.env.LOGIN_BENCH_PASS || 'Abcd1234';
const MID = process.env.LOGIN_BENCH_MID || 'e2e-latency-probe-0001';   // 已绑定的机器码，避免新增设备
const WARM_LOGIN_MAX = Number(process.env.LOGIN_BENCH_WARM_MAX || 2500);
const POST_AUTH_MAX = Number(process.env.LOGIN_BENCH_POSTAUTH_MAX || 1600);

async function call(password) {
    const t0 = Date.now();
    let status = 0, body = '';
    try {
        const r = await fetch(BASE + '/users?login=true', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: USER, password, machineId: MID, clientClass: 'desktop', prefetchPartialOk: true })
        });
        status = r.status; body = await r.text();
    } catch (e) { body = 'ERR ' + e.message; }
    return { ms: Date.now() - t0, status, body };
}

(async () => {
    const json = process.argv.includes('--json');
    const log = (...a) => { if (!json) console.log(...a); };

    // 第一次可能含冷启动 → 单独报告
    const cold = await call(PASS);
    const warm = [];
    for (let i = 0; i < 3; i++) { await new Promise(r => setTimeout(r, 400)); warm.push(await call(PASS)); }
    // 认证后附加工作 = 正确密码 - 密码错误（提前失败只做"读用户+校验密码"）
    await new Promise(r => setTimeout(r, 400));
    const fail = await call('WrongPass_' + Date.now());

    const warmMs = warm.map(w => w.ms);
    const warmAvg = Math.round(warmMs.reduce((a, b) => a + b, 0) / warmMs.length);
    const postAuth = Math.max(0, warmAvg - fail.ms);
    const warmOk = warmAvg <= WARM_LOGIN_MAX;
    const postOk = postAuth <= POST_AUTH_MAX;
    const allOk = warmOk && postOk && warm.every(w => w.status === 200) && fail.status === 401;

    const out = {
        at: new Date().toISOString(), base: BASE,
        cold: cold.ms, warm: warmMs, warmAvg,
        failBaseline: fail.ms, postAuth,
        thresholds: { warm: WARM_LOGIN_MAX, postAuth: POST_AUTH_MAX },
        pass: allOk
    };
    if (json) { console.log(JSON.stringify(out)); }
    else {
        console.log('=== 登录速度体温计 ===');
        console.log('  冷启动首次        ' + String(cold.ms).padStart(6) + ' ms   （仅报告，不计红线）');
        console.log('  暖态三次          ' + warmMs.map(m => m + 'ms').join(' / ') + '   平均 ' + warmAvg + ' ms');
        console.log('  提前失败基线      ' + String(fail.ms).padStart(6) + ' ms   （读用户+PBKDF2+限流）');
        console.log('  认证后附加工作    ' + String(postAuth).padStart(6) + ' ms');
        console.log('');
        console.log('  红线：暖登 ≤ ' + WARM_LOGIN_MAX + 'ms  ' + (warmOk ? '✅ 达标' : '✗ 超标') +
            '    |  认证后 ≤ ' + POST_AUTH_MAX + 'ms  ' + (postOk ? '✅ 达标' : '✗ 超标'));
        console.log('  结论：' + (allOk ? '✅ 达标（登录正常）' : '✗ 超红线——按下方指引排查'));
        if (!allOk) {
            console.log('');
            console.log('  排查指引（按可能性排序）：');
            console.log('    1) 认证后附加工作超标 → 查是否又出现"每次登录全表扫 license"（users.js 机构版预检应读 license_clinic_index）');
            console.log('    2) 暖登整体升高但附加工作正常 → 查 PBKDF2/D1 用户查询/限流 KV 读（auth.js、users.js 登录入口）');
            console.log('    3) 只有冷启动高 → 查索引是否被清/未回填（license_clinic_index、mid_owners、prescriptions_index、user_session_index）');
            console.log('    4) 全都高 → 看 KV 每日 list 是否被某条新读路径打满（曾致 Cloudflare 降级）');
        }
    }
    process.exit(allOk ? 0 : 1);
})();
