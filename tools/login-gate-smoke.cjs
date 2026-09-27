#!/usr/bin/env node
// login-gate-smoke.cjs — 登录门客户端白盒冒烟（2026-09-27）
//
// 加载【实际分发】的 APP assets auth-core.js（sync-auth-core 产物），在 Edge 中
// 构造最小环境（无 verifyGate IPC → 走渲染兜底），验证：
//   ① 200 响应体畸形 → fail-closed「授权服务响应异常」，不走离线门
//   ② requestEntitlement 白盒钩子：malformed 标记 + httpStatus 200
//   ③ 正常 LICENSED → 放行（回归）
//   ④ HTTP 429 → fail-closed
//   ⑤ 真断网（无 gate token）→ 离线门拒绝，且与畸形口径不同
//   ⑥ 403（设备封锁）→ 离线门路径，不按畸形处理
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { chromium } = require(path.join(
    ROOT, 'app_project', 'db-yunduan', 'cloud_desktop', 'node_modules', 'playwright-core'));

// 临时 harness（file:// 源才有 localStorage；跑完即删，勿提交）
const HARNESS = path.join(ROOT, 'app_project', 'db-offline', 'app', 'app',
    'src', 'main', 'assets', 'public', '__gate_smoke_harness.html');
const fileUrl = 'file:///' + HARNESS.replace(/\\/g, '/');

let pass = 0, failN = 0;
const check = (name, cond, detail) => {
    if (cond) { pass++; console.log('  PASS  ' + name); }
    else { failN++; console.log('  FAIL  ' + name + (detail ? ' → ' + detail : '')); }
};

(async () => {
    const pageErrors = [];
    const browser = await chromium.launch({ channel: 'msedge', headless: true });
    const page = await browser.newPage();
    page.on('pageerror', e => pageErrors.push(String(e)));

    // file:// harness（同目录加载真实 auth-core.js）
    await page.goto(fileUrl, { waitUntil: 'load' });
    await page.waitForFunction(() => !!(window.AuthCore && AuthCore.verifyLoginGate),
        { timeout: 8000 });

    // 场景环境安装
    const install = (mode) => page.evaluate((m) => {
        localStorage.clear();
        window.__scn = { mode: m, fetches: 0 };
        window.electronAPI = {
            license: {
                getStatus: async () => ({
                    valid: true, type: 'licensed', licenseType: 'clinic'
                }),
                getMachineId: async () => 'MID-TEST-123'
                // 故意不提供 verifyGate → 渲染兜底
            }
        };
        const origFetch = window.fetch;
        window.fetch = function (url) {
            window.__scn.fetches++;
            if (String(url).indexOf('/api/license/entitlement') < 0)
                return origFetch.apply(this, arguments);
            if (m === 'malformed')
                return Promise.resolve({
                    ok: true, status: 200,
                    json: async () => { throw new SyntaxError('Unexpected token <'); }
                });
            if (m === 'licensed')
                return Promise.resolve({
                    ok: true, status: 200,
                    json: async () => ({ success: true, state: 'LICENSED' })
                });
            if (m === 'h429')
                return Promise.resolve({ ok: false, status: 429 });
            if (m === 'h403')
                return Promise.resolve({ ok: false, status: 403 });
            if (m === 'nethrow')
                return Promise.reject(new TypeError('Failed to fetch'));
            return Promise.resolve({ ok: false, status: 500 });
        };
    }, mode);

    const gate = async (username) => page.evaluate(async (u) => {
        const r = await AuthCore.verifyLoginGate(u);
        return { ok: !!r.ok, message: r.message || '', fetches: window.__scn.fetches };
    }, username);

    // ① 畸形 200 → 硬拒响应异常，一次请求
    {
        await install('malformed');
        const r = await gate('doctor1');
        check('1 畸形200: fail-closed「响应异常」',
            !r.ok && /响应异常/.test(r.message) && r.fetches === 1, r.message);
    }
    // ② 白盒钩子：requestEntitlement 直出 malformed
    {
        const r = await page.evaluate(async () => {
            return AuthCore.__gateTest.requestEntitlement({ mid: 'MID-TEST-123' });
        });
        check('2 requestEntitlement: malformed=true/httpStatus=200/ent=null',
            r.malformed === true && r.httpStatus === 200 && r.ent === null,
            JSON.stringify(r).slice(0, 120));
    }
    // ③ 正常 LICENSED → 放行
    {
        await install('licensed');
        const r = await gate('doctor3');
        check('3 LICENSED 放行（回归）', r.ok, r.message);
    }
    // ④ 429 → 硬拒 HTTP 429
    {
        await install('h429');
        const r = await gate('doctor4');
        check('4 HTTP429 fail-closed', !r.ok && /HTTP 429/.test(r.message), r.message);
    }
    // ⑤ 真断网无 token → 离线门拒绝，文案不同于畸形
    {
        await install('nethrow');
        const r = await gate('doctor5');
        check('5 真断网: 离线门拒绝且≠畸形口径',
            !r.ok && !/响应异常/.test(r.message) && r.fetches === 1, r.message);
    }
    // ⑥ 403 → 离线门路径，不按畸形处理
    {
        await install('h403');
        const r = await gate('doctor6');
        check('6 HTTP403: 离线门路径（无token拒绝）',
            !r.ok && !/响应异常/.test(r.message), r.message);
    }
    // Z 全程无 pageerror
    check('Z 全程无 pageerror', pageErrors.length === 0, pageErrors.join('\n'));

    await browser.close();
    console.log(`\n${pass}/${pass + failN} passed`);
    process.exit(failN ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
