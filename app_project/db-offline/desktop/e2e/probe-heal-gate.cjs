// ★ 2026-09-06 P0 探针：存量自愈闸门放宽验证（渲染层页面级实证）
// 场景（用户机器实况复刻）：license.dat 缺失 + trial_limit_reached（服务端锁定试用）
//   + 本地已注册 + 服务端已 activated → heal 必须放行并调用装码桥。
// 对照组：already licensed → heal 必须跳过（不调用装码桥）。
// 方法：Playwright file:// 加载离线桌面 index.html + mock electronAPI
//   （getStatus/installLicenseFromServer/getActivationUsers/getMachineId），
//   断言 window.__healCalled。
// 用法：node e2e\probe-heal-gate.cjs   （退出码 0=全过）
const path = require('path');
const { chromium } = require(path.resolve(__dirname, '..', 'node_modules', 'playwright-core'));

const INDEX = path.resolve(__dirname, '..', 'index.html');

function mockInit(statusType, valid) {
    return `
        (function () {
            window.__healCalled = 0;
            window.__healMid = '';
            window.__healLog = 0;
            // 捕获 heal 专属日志（成功/失败分支均带「存量自愈」前缀，授权失效自动恢复等其他装码调用方不带）
            const _ol = console.log.bind(console), _ow = console.warn.bind(console);
            const cnt = (a) => { if (a && String(a).indexOf('存量自愈') >= 0) window.__healLog++; };
            console.log = function () { cnt(arguments[0]); return _ol.apply(null, arguments); };
            console.warn = function () { cnt(arguments[0]); return _ow.apply(null, arguments); };
            const notImpl = () => Promise.resolve({ success: true });
            const mk = (fn) => { const p = async () => fn(); return new Proxy(p, { get: (t, k) => (k in t ? t[k] : notImpl) }); };
            window.electronAPI = new Proxy({
                isElectron: true,
                license: mk(() => ({ valid: ${valid}, type: '${statusType}', licenseType: '${statusType === 'licensed' ? 'pro' : 'trial'}' })),
                activate: mk(() => ({ success: true, status: 'pending', message: 'mock-generic' })),
                getAppConfig: () => Promise.resolve({ success: true, config: { edition: 'personal', productName: '惠康中医-本地', users: [{ username: '13900000001', phone: '13900000001', role: 'user' }] } })
            }, { get: (t, k) => (k in t ? t[k] : notImpl) });
            // getMachineId / getActivationUsers / getStatus 专门可控行为
            window.electronAPI.activate.getMachineId = () => Promise.resolve('probemid1234567890');
            window.electronAPI.license.getMachineId = () => Promise.resolve('probemid1234567890');
            window.electronAPI.license.getStatus = () => Promise.resolve({ valid: ${valid}, type: '${statusType}', licenseType: '${statusType === 'licensed' ? 'pro' : 'trial'}' });
            window.electronAPI.activate.getActivationUsers = () => Promise.resolve({ success: true, users: [{ username: '13900000001', phone: '13900000001', role: 'user' }] });
            window.electronAPI.activate.installLicenseFromServer = (mid) => {
                window.__healCalled++;
                window.__healMid = String(mid);
                return Promise.resolve({ success: true, status: 'installed', message: 'mock-installed' });
            };
        })();
    `;
}

async function runCase(browser, label, statusType, valid, expectCalled, verbose) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.addInitScript(mockInit(statusType, valid));
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e && e.message || e)));
    if (verbose) page.on('console', (m) => { const t = m.text(); if (/LicenseCheck|heal|自愈|activation/i.test(t)) console.log('  [console] ' + t.slice(0, 200)); });
    await page.goto('file:///' + INDEX.replace(/\\/g, '/'));
    // startLicenseCheck：页面加载即跑，heal 内部多级 await，给 15s
    await page.waitForFunction(() => window.__healCalled !== undefined, null, { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(15000);
    const called = await page.evaluate(() => window.__healCalled);
    const mid = await page.evaluate(() => window.__healMid);
    const healLog = await page.evaluate(() => window.__healLog);
    // heal 判定：A/B/C 场景 heal 必须真实走到装码（__healLog≥1 证明是 heal 链路而非其他装码调用方）；
    // D 场景 heal 必须被闸门拦截（__healLog===0；__healCalled 可能被授权失效自动恢复等其他合法路径计入）
    const ok = expectCalled ? (called >= 1 && mid === 'probemid1234567890' && healLog >= 1) : (healLog === 0);
    console.log(`[${label}] healCalled=${called} healLog=${healLog} mid=${mid || '(none)'} → ${ok ? 'PASS' : 'FAIL'}`);
    if (!ok) console.log(`[${label}] pageErrors: ` + errors.slice(0, 5).join(' | '));
    await ctx.close();
    return ok;
}

(async () => {
    const browser = await chromium.launch({ channel: 'msedge', headless: true });
    const r1 = await runCase(browser, '场景A·trial_limit_reached放行', 'trial_limit_reached', false, true, true);
    const r2 = await runCase(browser, '场景B·trial_expired放行', 'trial_expired', false, true, false);
    const r3 = await runCase(browser, '场景C·trial放行(回归)', 'trial', true, true, false);
    const r4 = await runCase(browser, '场景D·licensed跳过(回归)', 'licensed', true, false, false);
    await browser.close();
    const all = r1 && r2 && r3 && r4;
    console.log(all ? 'PROBE-PASS: 自愈闸门 4 场景全过 ✓' : 'PROBE-FAIL: 见上方');
    process.exit(all ? 0 : 1);
})().catch(e => { console.log('PROBE-ERROR: ' + e.message); process.exit(1); });
