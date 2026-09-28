#!/usr/bin/env node
// biometric-smoke.cjs — 指纹快速登录白盒冒烟（2026-09-27）
//
// 加载【实际分发】的 APP assets auth-core.js（sync-auth-core 产物），在 Edge 中
// 伪造 Android WebView 环境（UA + electronAPI + AndroidNative 桥），验证：
//   1 老 APK（probe 返回 unknown）→ 整体 no-op：handleLogin 不包裹、无注入
//   2 capable + enrolled → 指纹入口可见
//   3 解锁成功 → 解密密码填入原框 + 调用原始 handleLogin（完整链路，不绕过）
//   4 errorCode=invalidated（指纹库变更/密文损坏）→ JS 兜底删除+入口消失
//   5 授权门返回账号吊销/删除 → 自动删除该账号指纹凭据
//   6 密码登录成功 → 引导开通；确认后 enroll，入口出现
//   7 无指纹能力（capable=false）→ no-op
//   8 M3：解出旧密码、本地精确失败文案 → 自动删凭据
//   9 lockout → 红字反馈且【不】删凭据（M1：旧文案正则会静默吞掉）
//  10 cancel → 静默无红字、不删凭据、入口保留
//  11 M3 反例：「密码错误次数过多，账号已暂时锁定」不得误删凭据
//  12 C2 时序回归：完全无 electronAPI（仅 UA+AndroidNative）功能照常
//  13 M-3：首次 probe 暂不可用 → 回前台重探 capable 后自动安装
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { chromium } = require(path.join(
    ROOT, 'app_project', 'db-yunduan', 'cloud_desktop', 'node_modules', 'playwright-core'));

const DIR = path.join(ROOT, 'app_project', 'db-offline', 'app', 'app',
    'src', 'main', 'assets', 'public');
const HARNESS = path.join(DIR, '__bio_smoke_harness.html');
const fileUrl = 'file:///' + HARNESS.replace(/\\/g, '/');

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
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Linux; Android 14; P40) AppleWebKit/537.36 ' +
            '(KHTML, like Gecko) Version/1.0 Chrome/120.0.0.0 Mobile Safari/537.36 wv'
    });
    const pageErrors = [];

    const newPage = async (cfg) => {
        const page = await context.newPage();
        page.on('pageerror', e => pageErrors.push(String(e)));
        await page.addInitScript((c) => {
            window.__calls = [];
            window.__loginCalls = 0;
            window.__flipped = false;
            window.__probeN = 0;
            window.__enrolled = !!c.enrolled;
            // 用例⑫：真实冷启动时序中 electronAPI 由 onPageFinished【之后】注入，
            // 晚于 auth-core 同步执行期。指纹模块不得依赖它（C2 回归）。
            if (!c.noElectron) {
                window.electronAPI = {
                    license: {
                        attestation: { probe: async () => ({ ok: false, unsupported: true }) },
                        // 用例⑤需要：已激活身份才能走到在线裁决 ACCOUNT_REVOKED 分支
                        getStatus: async () => ({
                            valid: true, type: 'licensed', licenseType: 'standard'
                        }),
                        getMachineId: async () => 'mock-mid-bio-smoke'
                    }
                };
            }
            window.handleLogin = async function () {
                window.__loginCalls++;
                // M3 场景：指纹解出的是旧密码 → 本地校验失败（登录层仍在+红字）
                if (c.loginFail === 'pwd') {
                    const e = document.getElementById('loginError');
                    e.textContent = '手机号/用户名或密码错误';
                    e.style.display = 'block';
                    return;
                }
                // M3 反例（用例⑪）：授权门账号锁定文案含「密码错误」四字，
                // 旧正则 /密码错误/ 会误删指纹凭据
                if (c.loginFail === 'locked') {
                    const e = document.getElementById('loginError');
                    e.textContent = '密码错误次数过多，账号已暂时锁定';
                    e.style.display = 'block';
                    return;
                }
                document.getElementById('loginOverlay').style.display = 'none';
            };
            window.__origHL = window.handleLogin;

            if (c.fetchMode === 'revoked') {
                window.fetch = function (url) {
                    if (String(url).indexOf('/api/license/entitlement') >= 0) {
                        return Promise.resolve({
                            ok: true, status: 200,
                            json: async () => ({
                                success: true, accountState: 'ACCOUNT_REVOKED'
                            })
                        });
                    }
                    return Promise.reject(new TypeError('net'));
                };
            }

            window.AndroidNative = {
                invoke: function (name, json) {
                    window.__calls.push(name);
                    if (name === 'biometricProbe') {
                        // 用例⑬：前 probeWaitN 次探不可用（未录指纹/HAL 未就绪；
                        // 首次加载 pageshow 也会自动重探一次），之后变 capable
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
                            // 真实 Java：code=invalidated 时密钥+密文已自清
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
                        // enroll 成功 → 后续 status 真实翻为已开通
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
        await page.waitForFunction(() => !!(window.AuthCore && AuthCore.verifyLoginGate),
            { timeout: 8000 });
        return page;
    };

    const getState = (page) => page.evaluate(() => {
        const row = document.getElementById('bioUnlockRow');
        const err = document.getElementById('loginError');
        return {
            row: !!row,
            shown: row ? row.style.display : 'absent',
            wrapped: window.handleLogin !== window.__origHL,
            calls: window.__calls,
            loginCalls: window.__loginCalls,
            pwd: document.getElementById('loginPassword').value,
            errShown: err ? err.style.display : 'absent',
            errText: err ? String(err.textContent || '') : ''
        };
    });

    const setUser = (page, u) => page.evaluate((un) => {
        const el = document.getElementById('loginUsername');
        el.value = un;
        el.dispatchEvent(new Event('input', { bubbles: true }));
    }, u);

    // ① 老 APK：probe unknown → no-op
    {
        const page = await newPage({ probe: { success: false, error: 'unknown method' } });
        await setUser(page, 'hkk');
        await page.waitForTimeout(300);
        const s = await getState(page);
        check('1 老APK no-op（不包裹/无注入）', !s.wrapped && !s.row, JSON.stringify(s));
    }

    // ② capable + enrolled → 入口可见
    {
        const page = await newPage({ probe: { success: true, capable: true }, enrolled: true });
        await setUser(page, 'hkk');
        await page.waitForTimeout(300);
        const s = await getState(page);
        check('2 指纹入口可见', s.row && s.shown === 'block', JSON.stringify(s));
    }

    // ③ 解锁成功 → 填密 + 原始 handleLogin 被调
    {
        const page = await newPage({
            probe: { success: true, capable: true }, enrolled: true,
            unlock: 'ok', password: 'secret123'
        });
        await setUser(page, 'hkk');
        await page.waitForTimeout(300);
        await page.click('#bioUnlockBtn');
        await page.waitForFunction(() => window.__loginCalls > 0, { timeout: 5000 });
        const s = await getState(page);
        check('3 解锁后填密并走原始登录链',
            s.pwd === 'secret123' && s.loginCalls === 1 && s.calls.includes('biometricUnlock'),
            JSON.stringify(s));
    }

    // ④ errorCode=invalidated → JS 兜底删除 + 入口消失
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

    // ⑤ 授权门吊销/删除 → 自动删指纹凭据
    {
        const page = await newPage({
            probe: { success: true, capable: true }, enrolled: true,
            fetchMode: 'revoked'
        });
        const r = await page.evaluate(async () => {
            return AuthCore.verifyLoginGate('revuser');
        });
        const s = await getState(page);
        check('5 吊销门自动删凭据',
            !r.ok && s.calls.includes('biometricDelete'),
            JSON.stringify(r) + ' | ' + JSON.stringify(s.calls));
    }

    // ⑥ 密码登录成功 → 引导开通；接受 confirm → enroll，入口出现
    {
        const page = await newPage({
            probe: { success: true, capable: true }, enrolled: false,
            enrollResult: { success: true }
        });
        page.on('dialog', d => d.accept());
        await setUser(page, 'bio6');
        await page.evaluate(() => {
            document.getElementById('loginPassword').value = 'admin123';
        });
        await page.evaluate(async () => { await window.handleLogin(); });
        await page.waitForTimeout(300);
        const s = await getState(page);
        check('6 登录后引导开通并注入入口',
            s.calls.includes('biometricEnroll') && s.row && s.shown === 'block',
            JSON.stringify(s));
    }

    // ⑦ 无指纹能力 → no-op
    {
        const page = await newPage({ probe: { success: true, capable: false } });
        await setUser(page, 'hkk');
        await page.waitForTimeout(300);
        const s = await getState(page);
        check('7 无能力 no-op（不包裹/无注入）', !s.wrapped && !s.row, JSON.stringify(s));
    }

    // ⑧ M3：解出旧密码、本地校验失败 → 自动删凭据，入口消失
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
        check('8 旧密码本地失败自动删凭据',
            s.loginCalls === 1 && s.calls.includes('biometricDelete') &&
            s.row && s.shown === 'none',
            JSON.stringify(s));
    }

    // ⑨ lockout：红字必须显示（旧中文正则把所有含「使用密码」的失败静默吞掉）
    //    且不得删除凭据、入口保留
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
        check('9 lockout 红字反馈且不删凭据',
            s.errShown === 'block' && s.errText.indexOf('尝试次数过多') >= 0 &&
            !s.calls.includes('biometricDelete') && s.shown === 'block',
            JSON.stringify(s));
    }

    // ⑩ cancel：静默（无红字）、不删凭据、入口保留
    {
        const page = await newPage({
            probe: { success: true, capable: true }, enrolled: true
        });
        await setUser(page, 'hkk');
        await page.waitForTimeout(300);
        await page.click('#bioUnlockBtn');
        await page.waitForTimeout(300);
        const s = await getState(page);
        check('10 cancel 静默保留入口',
            s.errShown !== 'block' && !s.calls.includes('biometricDelete') &&
            s.shown === 'block',
            JSON.stringify(s));
    }

    // ⑪ M3 反例：账号锁定文案含「密码错误」四字，不得误删凭据
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
        check('11 锁定文案不误删凭据',
            s.loginCalls === 1 && !s.calls.includes('biometricDelete'),
            JSON.stringify(s));
    }

    // ⑫ C2 时序回归：无 electronAPI（真机同步执行期的真实状态），
    //    仅凭 UA Android + AndroidNative 桥，安装/解锁链路照常
    {
        const page = await newPage({
            probe: { success: true, capable: true }, enrolled: true,
            unlock: 'ok', password: 'timing-secret', noElectron: true
        });
        await setUser(page, 'hkk');
        await page.waitForTimeout(300);
        await page.click('#bioUnlockBtn');
        await page.waitForFunction(() => window.__loginCalls > 0, { timeout: 5000 });
        const s = await getState(page);
        check('12 无electronAPI时序功能照常',
            s.row && s.shown === 'block' && s.pwd === 'timing-secret' &&
            s.loginCalls === 1,
            JSON.stringify(s));
    }

    // ⑬ M-3：首次 probe wait（无入口）→ 模拟回前台 visibilitychange 重探 → 自动安装
    {
        const page = await newPage({
            probe: { success: true, capable: true }, probeFlip: true,
            probeWaitN: 2, enrolled: true
        });
        await setUser(page, 'hkk');
        await page.waitForTimeout(400);
        let s = await getState(page);
        check('13a 首次未就绪时无入口', !s.row && !s.wrapped, JSON.stringify(s));
        await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
        await page.waitForTimeout(500);
        s = await getState(page);
        check('13b 回前台重探后自动安装', s.row && s.shown === 'block' && s.wrapped,
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
