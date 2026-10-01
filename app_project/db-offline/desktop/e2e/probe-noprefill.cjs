// 残留场景探针：预置"记住用户名"localStorage（伪造/翻新机残留）→ 刷新 →
// 验证输入框不预填。
// ★ 2026-10-01 语义更新：登录框已恢复"最后登录用户名预填"，但预填三重前置：
//   ① 非通用名（手机号/连续中文/邮箱不预填）② 非历史遗留默认名 ③ 必须存在于
//   本机 config 用户列表。本探针使用的 ceshiyonghu 不在任何真实诊所本机账户
//   表中，故正确行为仍是空白（翻新机/localStorage 残留不冒名预填）。
//   真实最后登录用户的预填由 e2e 登录用例（login → 重启 → 输入框有值）覆盖。
// 用法：先以 --remote-debugging-port=9333 启动桌面端并打开登录窗，再跑本探针。
const { chromium } = require('playwright');
(async () => {
    const b = await chromium.connectOverCDP('http://127.0.0.1:9333');
    const pg = b.contexts()[0].pages().find(p => p.url().includes('login.html'));
    if (!pg) { console.log('PROBE-FAIL: 未找到登录窗'); process.exit(1); }
    await pg.evaluate(() => {
        localStorage.setItem('local_rememberedUsername', 'ceshiyonghu');
        localStorage.setItem('local_rememberedUsers', JSON.stringify(['ceshiyonghu', 'laozhang']));
    });
    await pg.reload();
    await pg.waitForSelector('#loginUsername', { timeout: 15000 });
    await pg.waitForTimeout(2500);
    const v = await pg.evaluate(() => document.getElementById('loginUsername').value);
    if (v === '') {
        console.log('PROBE-PASS: 非本机账户的残留用户名不预填（输入框空）✓');
        await b.close(); process.exit(0);
    } else {
        console.log('PROBE-FAIL: 不应预填非本机账户，却预填了 "' + v + '"');
        await b.close(); process.exit(1);
    }
})().catch(e => { console.log('PROBE-ERROR: ' + e.message); process.exit(1); });
