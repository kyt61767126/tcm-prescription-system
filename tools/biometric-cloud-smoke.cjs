#!/usr/bin/env node
// biometric-cloud-smoke.cjs — 云端指纹快速登录白盒冒烟（2026-09-28）
//
// 加载【实际分发】的云端 APP assets auth-core.js（sync-auth-core 产物，
// 由 cloud.js 同步给 8 个目标），在 Edge 中伪造 Android WebView 环境
// （UA + AndroidNative 桥），验证（移植自 biometric-smoke.cjs，云端无
// verifyLoginGate 门裁决，故删除门吊销用例，新增 8 副本 no-op 安全面用例）：
//   1 老 APK（probe 返回 unknown）→ 整体 no-op：handleLogin 不包裹、无注入
//   2 capable + enrolled → 指纹入口可见
//   3 解锁成功 → 解密密码填入原框 + 调用原始 handleLogin（完整云端链路，不绕过）
//     ＋ 遮罩在登录层隐藏后立即收口（不等 handleLogin resolve）
//   4 errorCode=invalidated（指纹库变更/密文损坏）→ JS 兜底删除+入口消失
//   5 密码登录成功 → 引导开通；确认后 enroll，入口出现
//   6 无指纹能力（capable=false）→ no-op
//   7 M3：解出旧密码、精确失败文案「手机号/用户名或密码错误」→ 自动删凭据
//   8 lockout → 红字反馈且【不】删凭据（M1）
//   9 cancel → 静默无红字、不删凭据、入口保留
//  10 M3 反例：「密码错误次数过多，账号已暂时锁定」不得误删凭据
//  11 C2 时序：无 electronAPI（真机同步执行期真实状态）功能照常
//  12 M-3：首次 probe 暂不可用 → 回前台重探 capable 后自动安装
//  13 ★8副本安全面：Android UA 但【无桥】（手机浏览器）→ no-op
//  14 ★8副本安全面：Windows 桌面 UA【无桥】（网页/云桌面/鸿蒙同理）→ no-op
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { chromium } = require(path.join(
    ROOT, 'app_project', 'db-yunduan', 'cloud_desktop', 'node_modules', 'playwright-core'));

const DIR = path.join(ROOT, 'app_project', 'db-yunduan', 'cloud_app', 'app',
    'src', 'main', 'assets', 'public');
const HARNESS = path.join(DIR, '__bio_cloud_smoke_harness.html');
const fileUrl = 'file:///' + HARNESS.replace(/\\/g, '/');

const UA_ANDROID = 'Mozilla/5.0 (Linux; Android 14; P40) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Version/1.0 Chrome/120.0.0.0 Mobile Safari/537.36 wv';
const UA_WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

let pass = 0, failN = 0;
const check = (name, cond, detail) => {
    if (cond) { pass++; console.log('  PASS  ' + name); }
    else { failN++; console.log('  FAIL  ' + name + (detail ? ' → ' + detail : '')); }
};

// 临时 harness：真实 DOM 最小集 + 同目录真实 auth-core.js；跑完即删
const harnessHtml =
    '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>' +
    '<div id="loginOverlay" style="display:flex;"><div class="login-box">' +
    '<input type="text" id="loginUsername" value="">' +
    '<input type="password" id="loginPassword" value="">' +
    '<div id="loginError" style="display:none;"></div>' +
    '</div></div>' +
    '<div class="main-container" style="display:none;"></div>' +
    '<script src="auth-core.js"></scr' + 'ipt>' +
    '</body></html>';

(async () => {
    fs.writeFileSync(HARNESS, harnessHtml);

    const browser = await chromium.launch({ channel: 'msedge', headless: true });
    const androidContext = await browser.newContext({ userAgent: UA_ANDROID });
    const desktopContext = await browser.newContext({ userAgent: UA_WINDOWS });
    const pageErrors = [];

    const newPage = async (cfg) => {
        const context = cfg.desktopUA ? desktopContext : androidContext;
        const page = await context.newPage();
        page.on('pageerror', e => pageErrors.push(String(e)));
        await page.addInitScript((c) => {
            window.__calls = [];
            window.__loginCalls = 0;
            window.__flipped = false;
            window.__probeN = 0;
            window.__enrolled = !!c.enrolled;
            // 云端指纹模块不得依赖 electronAPI（C2：shim 晚于 auth-core 注入）。
            // 全部用例均不注入 electronAPI，模拟真机同步执行期真实状态。
            window.handleLogin = async function () {
                window.__loginCalls++;
                // M3：指纹解出旧密码 → 云端登录链失败（登录层仍在+红字）
                if (c.loginFail === 'pwd') {
                    const e = document.getElementById('loginError');
                    e.textContent = '手机号/用户名或密码错误';
                    e.style.display = 'block';
                    return;
                }
                // M3 反例（用例10）：锁定文案含「密码错误」四字，不得误删
                if (c.loginFail === 'locked') {
                    const e = document.getElementById('loginError');
                    e.textContent = '密码错误次数过多，账号已暂时锁定';
                    e.style.display = 'block';
                    return;
                }
                document.getElementById('loginOverlay').style.display = 'none';
            };
            window.__origHL = window.handleLogin;

            // 用例13/14：手机浏览器/桌面/鸿蒙等无 AndroidNative 桥 → 确定性 no-op
            if (c.noBridge) return;

            window.AndroidNative = {
                invoke: function (name, json) {
                    window.__calls.push(name);
                    if (name === 'biometricProbe') {
                        if (c.probeFlip) {
                            const waitN = c.probeWaitN || 3;
                            if (window.__probeN++ < waitN)
                                return JSON.stringify({ success: true, capable: false });
                        }
                        return JSON.stringify(c.probe || { success: false });
                    }
                    if (name === 'biometricStatus') {
                        if (c.statusFlip && window.__flipped)
                            return JSON.stringify({ success: true, enrolled: false });
                        return JSON.stringify({ success: true, enrolled: !!window.__enrolled });
                    }
                    if (name === 'biometricUnlock') {
                        if (c.unlock === 'ok')
                            return JSON.stringify({ success: true, password: c.password });
                        if (c.unlock === 'invalidate') {
                            window.__flipped = true;
                            window.__enrolled = false;
                            return JSON.stringify({
                                success: false, code: 'invalidated',
                                error: '指纹凭据已失效，请用密码登录后重新开通'
                            });
                        }
                        if (c.unlock === 'lockout')
                            return JSON.stringify({
                                success: false, code: 'lockout',
                                error: '指纹尝试次数过多，请稍后再试或使用密码登录'
                            });
                        return JSON.stringify({
                            success: false, code: 'cancel', error: '已取消'
                        });
                    }
                    if (name === 'biometricEnroll') {
                        const er = c.enrollResult || { success: true };
                        if (er.success) window.__enrolled = true;
                        return JSON.stringify(er);
                    }
                    if (name === 'biometricDelete') {
                        window.__enrolled = false;
                        return JSON.stringify({ success: true });
                    }
                    return JSON.stringify({
                        success: false, error: 'unknown method: ' + name
                    });
                }
            };
        }, cfg);
        await page.goto(fileUrl, { waitUntil: 'load' });
        await page.waitForFunction(
            () => !!(window.AuthCore && AuthCore.loginWithUsernamePassword),
            { timeout: 8000 });
        return page;
    };

    const getState = (page) => page.evaluate(() => {
        const row = document.getElementById('bioUnlockRow');
        const err = document.getElementById('loginError');
        const mask = document.getElementById('bioLoggingMask');
        return {
            row: !!row,
            shown: row ? row.style.display : 'absent',
            wrapped: window.handleLogin !== window.__origHL,
            calls: window.__calls,
            loginCalls: window.__loginCalls,
            pwd: document.getElementById('loginPassword').value,
            errShown: err ? err.style.display : 'absent',
            errText: err ? String(err.textContent || '') : '',
            maskShown: mask ? mask.style.display : 'absent',
            bridgePresent: typeof window.AndroidNative !== 'undefined'
        };
    });

    const setUser = (page, u) => page.evaluate((un) => {
        const el = document.getElementById('loginUsername');
        el.value = un;
        el.dispatchEvent(new Event('input', { bubbles: true }));
    }, u);

    // 1 老 APK：probe unknown → no-op
    {
        const page = await newPage({ probe: { success: false, error: 'unknown method' } });
        await setUser(page, 'hkk');
        await page.waitForTimeout(300);
        const s = await getState(page);
        check('1 老APK no-op（不包裹/无注入）', !s.wrapped && !s.row, JSON.stringify(s));
    }

    // 2 capable + enrolled → 入口可见
    {
        const page = await newPage({ probe: { success: true, capable: true }, enrolled: true });
        await setUser(page, 'hkk');
        await page.waitForTimeout(300);
        const s = await getState(page);
        check('2 指纹入口可见', s.row && s.shown === 'block', JSON.stringify(s));
    }

    // 3 解锁成功 → 填密 + 原始 handleLogin 被调 + 遮罩随登录层隐藏收口
    {
        const page = await newPage({
            probe: { success: true, capable: true }, enrolled: true,
            unlock: 'ok', password: 'secret123'
        });
        await setUser(page, 'hkk');
        await page.waitForTimeout(300);
        await page.click('#bioUnlockBtn');
        await page.waitForFunction(() => window.__loginCalls > 0, { timeout: 5000 });
        await page.waitForTimeout(300);
        const s = await getState(page);
        check('3 解锁后填密并走原始云端登录链+遮罩收口',
            s.pwd === 'secret123' && s.loginCalls === 1 &&
            s.calls.includes('biometricUnlock') && s.maskShown !== 'flex',
            JSON.stringify(s));
    }

    // 4 errorCode=invalidated → JS 兜底删除 + 入口消失
    {
        const page = await newPage({
            probe: { success: true, capable: true }, enrolled: true,
            unlock: 'invalidate', statusFlip: true
        });
        await setUser(page, 'hkk');
        await page.waitForTimeout(300);
        await page.click('#bioUnlockBtn');
        await page.waitForTimeout(300);
        const s = await getState(page);
        check('4 失效后入口消失', s.row && s.shown === 'none', JSON.stringify(s));
    }

    // 5 密码登录成功 → 引导开通；接受 confirm → enroll，入口出现
    {
        const page = await newPage({
            probe: { success: true, capable: true }, enrolled: false,
            enrollResult: { success: true }
        });
        page.on('dialog', d => d.accept());
        await setUser(page, 'bio5');
        await page.evaluate(() => {
            document.getElementById('loginPassword').value = 'admin123';
        });
        await page.evaluate(async () => { await window.handleLogin(); });
        await page.waitForTimeout(300);
        const s = await getState(page);
        check('5 登录后引导开通并注入入口',
            s.calls.includes('biometricEnroll') && s.row && s.shown === 'block',
            JSON.stringify(s));
    }

    // 6 无指纹能力 → no-op
    {
        const page = await newPage({ probe: { success: true, capable: false } });
        await setUser(page, 'hkk');
        await page.waitForTimeout(300);
        const s = await getState(page);
        check('6 无能力 no-op（不包裹/无注入）', !s.wrapped && !s.row, JSON.stringify(s));
    }

    // 7 M3：解出旧密码、云端登录链精确失败文案 → 自动删凭据，入口消失
    {
        const page = await newPage({
            probe: { success: true, capable: true }, enrolled: true,
            unlock: 'ok', password: 'old-pwd', loginFail: 'pwd'
        });
        await setUser(page, 'hkk');
        await page.waitForTimeout(300);
        await page.click('#bioUnlockBtn');
        await page.waitForFunction(() => window.__loginCalls > 0, { timeout: 5000 });
        await page.waitForTimeout(300);
        const s = await getState(page);
        check('7 旧密码精确失败文案自动删凭据',
            s.loginCalls === 1 && s.calls.includes('biometricDelete') &&
            s.row && s.shown === 'none',
            JSON.stringify(s));
    }

    // 8 lockout：红字显示、不删凭据、入口保留
    {
        const page = await newPage({
            probe: { success: true, capable: true }, enrolled: true,
            unlock: 'lockout'
        });
        await setUser(page, 'hkk');
        await page.waitForTimeout(300);
        await page.click('#bioUnlockBtn');
        await page.waitForTimeout(300);
        const s = await getState(page);
        check('8 lockout 红字反馈且不删凭据',
            s.errShown === 'block' && s.errText.indexOf('尝试次数过多') >= 0 &&
            !s.calls.includes('biometricDelete') && s.shown === 'block',
            JSON.stringify(s));
    }

    // 9 cancel：静默（无红字）、不删凭据、入口保留
    {
        const page = await newPage({
            probe: { success: true, capable: true }, enrolled: true
        });
        await setUser(page, 'hkk');
        await page.waitForTimeout(300);
        await page.click('#bioUnlockBtn');
        await page.waitForTimeout(300);
        const s = await getState(page);
        check('9 cancel 静默保留入口',
            s.errShown !== 'block' && !s.calls.includes('biometricDelete') &&
            s.shown === 'block',
            JSON.stringify(s));
    }

    // 10 M3 反例：锁定文案含「密码错误」，不得误删凭据
    {
        const page = await newPage({
            probe: { success: true, capable: true }, enrolled: true,
            unlock: 'ok', password: 'some-pwd', loginFail: 'locked'
        });
        await setUser(page, 'hkk');
        await page.waitForTimeout(300);
        await page.click('#bioUnlockBtn');
        await page.waitForFunction(() => window.__loginCalls > 0, { timeout: 5000 });
        await page.waitForTimeout(300);
        const s = await getState(page);
        check('10 锁定文案不误删凭据',
            s.loginCalls === 1 && !s.calls.includes('biometricDelete'),
            JSON.stringify(s));
    }

    // 11 C2：无 electronAPI（本 smoke 全程不注入），仅凭 UA+桥安装/解锁照常
    {
        const page = await newPage({
            probe: { success: true, capable: true }, enrolled: true,
            unlock: 'ok', password: 'timing-secret'
        });
        await setUser(page, 'hkk');
        await page.waitForTimeout(300);
        await page.click('#bioUnlockBtn');
        await page.waitForFunction(() => window.__loginCalls > 0, { timeout: 5000 });
        const s = await getState(page);
        check('11 无electronAPI时序功能照常',
            s.row && s.shown === 'block' && s.pwd === 'timing-secret' &&
            s.loginCalls === 1,
            JSON.stringify(s));
    }

    // 12 M-3：首次 probe wait → visibilitychange 重探 → 自动安装
    {
        const page = await newPage({
            probe: { success: true, capable: true }, probeFlip: true,
            probeWaitN: 2, enrolled: true
        });
        await setUser(page, 'hkk');
        await page.waitForTimeout(400);
        let s = await getState(page);
        check('12a 首次未就绪时无入口', !s.row && !s.wrapped, JSON.stringify(s));
        await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
        await page.waitForTimeout(500);
        s = await getState(page);
        check('12b 回前台重探后自动安装', s.row && s.shown === 'block' && s.wrapped,
            JSON.stringify(s));
    }

    // 13 ★8副本安全面：Android UA 无桥（手机浏览器打开网页）→ no-op
    {
        const page = await newPage({ noBridge: true });
        await setUser(page, 'hkk');
        await page.waitForTimeout(300);
        const s = await getState(page);
        check('13 Android UA无桥（手机浏览器）no-op',
            !s.wrapped && !s.row && !s.bridgePresent,
            JSON.stringify(s));
    }

    // 14 ★8副本安全面：Windows UA 无桥（网页/云桌面/鸿蒙同构）→ no-op
    {
        const page = await newPage({ noBridge: true, desktopUA: true });
        await setUser(page, 'hkk');
        await page.waitForTimeout(300);
        const s = await getState(page);
        check('14 桌面UA无桥（网页/云桌面/鸿蒙）no-op', !s.wrapped && !s.row,
            JSON.stringify(s));
    }

    // Z 全程无 pageerror
    check('Z 全程无 pageerror', pageErrors.length === 0, pageErrors.join('\n'));

    await browser.close();
    try { fs.unlinkSync(HARNESS); } catch (e) {}

    console.log(`\n${pass}/${pass + failN} passed`);
    process.exit(failN ? 1 : 0);
})().catch(e => {
    try { fs.unlinkSync(HARNESS); } catch (err) {}
    console.error(e);
    process.exit(1);
});
