// 出厂态验证探针：connectOverCDP 检查登录窗注册入口注入
// 用法：node e2e\probe-register-entry.cjs（需先手动带 --remote-debugging-port=9333 启动 exe）
const { chromium } = require('playwright');
(async () => {
    const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
    const ctx = browser.contexts()[0];
    const pages = ctx.pages();
    const login = pages.find(p => p.url().includes('login.html'));
    if (!login) { console.log('PROBE-FAIL: 未找到登录窗页面, pages=' + pages.map(p => p.url()).join(' | ')); process.exit(1); }
    console.log('PROBE: 登录窗 = ' + login.url());
    // 等待注入（startLicenseCheck 后约 2s，给足 25s）
    try {
        await login.waitForFunction(() => {
            const el = document.getElementById('activateLoginEntry');
            return !!el && el.style.display !== 'none' &&
                (el.textContent || '').indexOf('注册开通') >= 0;
        }, null, { timeout: 25000 });
        console.log('PROBE-PASS: 出厂态登录框已注入「📝 注册开通」入口 ✓');
    } catch (e) {
        console.log('PROBE-FAIL: 25s 内未见注册开通入口');
        const state = await login.evaluate(() => ({
            entry: !!document.getElementById('activateLoginEntry'),
            regOverlay: !!document.getElementById('localRegisterOverlay'),
            hasElectronAPI: !!(window.electronAPI && window.electronAPI.activate && window.electronAPI.activate.registerLocalUser),
        }));
        console.log('PROBE-STATE: ' + JSON.stringify(state));
        process.exit(1);
    }
    // 附带验证：用户名输入框应为空（今天的取消预填改动）
    const uname = await login.evaluate(() => {
        const el = document.getElementById('loginUsername');
        return el ? el.value : null;
    });
    console.log('PROBE: 用户名输入框值 = "' + uname + '"（出厂态应为空）');
    await browser.close();
    process.exit(0);
})().catch(e => { console.log('PROBE-ERROR: ' + e.message); process.exit(1); });
