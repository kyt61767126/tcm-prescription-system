// ★ 2026-09-06 机构版桌面端到端探针·第2步：真实 exe 登录 → 主窗口断言【用户管理】
// 前置：① probe-prepare-inst.cjs 已构造 userData（机构版已激活态）
//        ② exe 已带 BNZC_E2E=1 + marker + BNZC_E2E_DATA=<同一目录> + --remote-debugging-port=9333 启动
// 用法：node e2e\probe-inst-main.cjs
const { chromium } = require('playwright');

async function login(page, username, password) {
    await page.waitForSelector('#loginUsername', { timeout: 15000 });
    await page.fill('#loginUsername', username);
    try {
        await page.focus('#loginPassword');
        await page.waitForFunction(() => {
            const el = document.getElementById('loginPassword');
            return !!el && !el.hasAttribute('readonly');
        }, null, { timeout: 5000 });
    } catch (_) {}
    await page.fill('#loginPassword', password);
    await page.click('#btnOk');
}

(async () => {
    const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
    const ctx = browser.contexts()[0];

    // 等 index.html 主窗口（登录窗 → 登录 → 主窗口出现；登录窗在部分流程即主窗，二选一探测）
    const loginPage = ctx.pages().find(p => p.url().includes('login.html'));
    if (!loginPage) { console.log('PROBE-FAIL: 未找到登录窗'); process.exit(1); }
    console.log('PROBE 登录窗就绪，开始登录 13900000001');
    await login(loginPage, '13900000001', 'test123456');

    // 主窗口（可能是新 page 或同 page 跳转）
    let main = null;
    const deadline = Date.now() + 45000;
    while (Date.now() < deadline) {
        const cand = ctx.pages().find(p => p.url().includes('index.html'));
        if (cand) { main = cand; break; }
        await new Promise(r => setTimeout(r, 500));
    }
    if (!main) { console.log('PROBE-FAIL: 45s 内主窗口未出现'); process.exit(1); }
    console.log('PROBE 主窗口就绪: ' + main.url());

    // 等权限流程跑完（changePwdBtn 或 userManageBtn 任一可见）
    await main.waitForFunction(() => {
        const c = document.getElementById('changePwdBtn');
        const u = document.getElementById('userManageBtn');
        return (c && c.style.display !== 'none') || (u && u.style.display !== 'none');
    }, null, { timeout: 30000 });

    const state = await main.evaluate(async () => {
        const r = {};
        r.CONFIG_edition = (typeof CONFIG !== 'undefined' && CONFIG) ? String(CONFIG.edition) : 'undefined';
        r.EDITION = String(window.EDITION || '');
        r.Permission_edition = (window.Permission && Permission._edition) ? String(Permission._edition) : '';
        try { r.tag = (typeof getEditionTag === 'function') ? String(getEditionTag()) : ''; } catch (e) { r.tag = 'err'; }
        const u = document.getElementById('userManageBtn');
        const c = document.getElementById('changePwdBtn');
        r.userManageBtn = u ? u.style.display : 'missing';
        r.changePwdBtn = c ? c.style.display : 'missing';
        r.topVersionTag = (document.getElementById('topVersionTag') || {}).textContent || '';
        // 主进程权威值
        try {
            const res = await window.electronAPI.getAppConfig();
            r.appConfig_edition = res && res.config ? String(res.config.edition) : JSON.stringify(res).slice(0, 120);
            r.appConfig_users = res && res.config && res.config.users
                ? res.config.users.map(x => x.username + ':' + x.role).join(',') : '';
        } catch (e) { r.appConfig_edition = 'err:' + e.message; }
        try {
            const lic = await window.electronAPI.license ? '' : '';
        } catch (e) {}
        return r;
    });
    console.log('PROBE-STATE ' + JSON.stringify(state, null, 2));

    const ok = state.CONFIG_edition === 'clinic' && state.userManageBtn === 'block';
    console.log(ok ? 'PROBE-PASS: 机构版主窗口【用户管理】显示 ✓' : 'PROBE-FAIL: 见上方 STATE');
    await browser.close();
    process.exit(ok ? 0 : 1);
})().catch(e => { console.log('PROBE-ERROR: ' + e.message); process.exit(1); });
