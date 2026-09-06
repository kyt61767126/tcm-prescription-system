// ★ 2026-09-06 机构版桌面探针·场景2 断言：exe 启动自动校正残留 edition → 登录 → 【用户管理】
// 用法：node e2e\probe-inst-legacy.cjs <userData目录>（exe 已按该目录启动）
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const UD = path.resolve(process.argv[2] || path.join(__dirname, 'probe-ud-legacy'));

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
    // ① 启动后（登录窗阶段）先断言磁盘 config.json 被启动校正为 clinic
    await new Promise(r => setTimeout(r, 3000)); // 给 enforceEditionBinding 时序
    const cfg = JSON.parse(fs.readFileSync(path.join(UD, 'config.json'), 'utf8'));
    console.log('LEGACY 启动后磁盘 config.edition=' + cfg.edition + '（期望 clinic=启动自动校正）');
    if (cfg.edition !== 'clinic') {
        console.log('LEGACY-FAIL: 启动校正未生效（enforceEditionBinding 未把 personal → clinic）');
    }

    const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
    const ctx = browser.contexts()[0];
    const loginPage = ctx.pages().find(p => p.url().includes('login.html'));
    if (!loginPage) { console.log('LEGACY-FAIL: 未找到登录窗'); process.exit(1); }
    await login(loginPage, '13900000001', 'test123456');

    let main = null;
    const deadline = Date.now() + 45000;
    while (Date.now() < deadline) {
        const cand = ctx.pages().find(p => p.url().includes('index.html'));
        if (cand) { main = cand; break; }
        await new Promise(r => setTimeout(r, 500));
    }
    if (!main) { console.log('LEGACY-FAIL: 主窗口未出现'); process.exit(1); }

    await main.waitForFunction(() => {
        const c = document.getElementById('changePwdBtn');
        const u = document.getElementById('userManageBtn');
        return (c && c.style.display !== 'none') || (u && u.style.display !== 'none');
    }, null, { timeout: 30000 });

    const state = await main.evaluate(async () => {
        const r = {};
        r.CONFIG_edition = (typeof CONFIG !== 'undefined' && CONFIG) ? String(CONFIG.edition) : 'undefined';
        try { r.tag = (typeof getEditionTag === 'function') ? String(getEditionTag()) : ''; } catch (e) { r.tag = 'err'; }
        const u = document.getElementById('userManageBtn');
        r.userManageBtn = u ? u.style.display : 'missing';
        try {
            const res = await window.electronAPI.getAppConfig();
            r.appConfig_edition = res && res.config ? String(res.config.edition) : '?';
        } catch (e) { r.appConfig_edition = 'err'; }
        return r;
    });
    console.log('LEGACY-STATE ' + JSON.stringify(state));
    const ok = state.CONFIG_edition === 'clinic' && state.userManageBtn === 'block' && cfg.edition === 'clinic';
    console.log(ok ? 'LEGACY-PASS: 旧版残留被启动自动校正，登录后【用户管理】显示 ✓' : 'LEGACY-FAIL');
    await browser.close();
    process.exit(ok ? 0 : 1);
})().catch(e => { console.log('LEGACY-ERROR: ' + e.message); process.exit(1); });
