// 残留场景探针：预置记住用户名 localStorage → 刷新 → 验证输入框不预填
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
        console.log('PROBE-PASS: 有记住用户名残留也不再预填（输入框空）✓');
        await b.close(); process.exit(0);
    } else {
        console.log('PROBE-FAIL: 仍预填了 "' + v + '"');
        await b.close(); process.exit(1);
    }
})().catch(e => { console.log('PROBE-ERROR: ' + e.message); process.exit(1); });
