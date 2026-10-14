// ============================================================================
//  auth-core-status-sandbox.cjs — 在 vm 沙箱里跑真实 auth-core.js（共享测试脚手架）
//
//  用途：把「登录/授权状态自愈」这类**只有真跑起来才能证明**的行为，用真实上线包
//  （shared/auth-core.js，由 sync-auth-core.ps1 从 cloud.js/offline.js 生成）驱动：
//    打桩 window/document/localStorage/fetch/AbortController → 调
//    window.updateLicenseStatusText() → 断言 #licenseStatusText.innerHTML 与各缓存键。
//
//  为什么必须用真实包而不是抽函数体：getCloudAccountLicenseHtml / refreshCloudProfile
//  都在第二个 IIFE 内部，且相互调用、依赖模块级状态（节流窗口、in-flight Promise、
//  reqId）。抽函数体会把被测语义抽走（正是"测试看起来通过、线上仍错"的经典成因）。
//
//  用法：const { makeStatusSandbox, jsonResp, render } = require('./auth-core-status-sandbox.cjs');
//        const sb = makeStatusSandbox({ 'auth:currentUser': JSON.stringify(user) }, () => jsonResp({...}));
//        const html = await render(sb);
// ============================================================================
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_BUNDLE = path.join(ROOT, 'shared', 'auth-core.js');

// ★ 固定时钟（2026-10-14 修）：天数断言（728/363）曾经直接吃真实系统时间，用例写于
//   2026-10-10，几天后 Math.ceil 剩余天数变成 724 → 用例随自然时间假红。
//   沙箱内冻结在基准日 2026-10-10T00:00:00Z（NEW_EXP 2028-10-07 整差 728 天、
//   OLD_EXP 2027-10-08 整差 363 天），需要模拟时间流逝的用例可调 sb._tickClock(ms)。
const REAL_DATE = Date;
const FIXED_NOW = REAL_DATE.UTC(2026, 9, 10, 0, 0, 0);   // 月份 0 基：10 月
let __clockNow = FIXED_NOW;
class FakeDate extends REAL_DATE {
    constructor(...a) { if (a.length) super(...a); else super(__clockNow); }
    static now() { return __clockNow; }
}

function makeEl(id) {
    return {
        id: id, innerHTML: '', textContent: '', style: {}, disabled: false, className: '',
        children: [], parentNode: null,
        appendChild(c) { c.parentNode = this; this.children.push(c); return c; },
        removeChild() { }, insertAdjacentHTML() { }, remove() { },
        setAttribute() { }, getAttribute() { return null; },
        querySelector() { return null; }, querySelectorAll() { return []; },
        addEventListener() { },
        classList: { add() { }, remove() { }, toggle() { }, contains() { return false; } }
    };
}

function jsonResp(obj, status) {
    const st = status || 200;
    return { ok: st >= 200 && st < 300, status: st, text: async () => JSON.stringify(obj) };
}

// fetchImpl(url, opts) 只对 action=get-profile 生效；其它端点（/api/license/invite 等）
// 一律返回中性响应，避免 mock 串味（invite 若带 clinicExpiresAt 会触发额外回写与重渲）
function makeStatusSandbox(seedLs, fetchImpl, opts) {
    opts = opts || {};
    __clockNow = FIXED_NOW;   // 每个沙箱从冻结基准日开始，用例间互不串时
    const bundlePath = opts.bundle || process.env.VERIFY_BUNDLE || DEFAULT_BUNDLE;
    const lsMap = new Map(Object.entries(seedLs || {}));
    const localStorage = {
        _m: lsMap,
        getItem(k) { return lsMap.has(k) ? lsMap.get(k) : null; },
        setItem(k, v) { lsMap.set(k, String(v)); },
        removeItem(k) { lsMap.delete(k); },
        key(i) { return [...lsMap.keys()][i] || null; },
        get length() { return lsMap.size; }
    };
    const els = {
        licenseStatusText: makeEl('licenseStatusText'),
        adminActivateSettingsBtn: makeEl('adminActivateSettingsBtn')
    };
    const document = {
        getElementById(id) { return els[id] || null; },
        createElement() { return makeEl('created'); },
        createTextNode(t) { return { textContent: t, parentNode: null }; },
        querySelector() { return null; }, querySelectorAll() { return []; },
        addEventListener() { }, removeEventListener() { },
        body: makeEl('body'), head: makeEl('head'), documentElement: makeEl('html'),
        readyState: 'complete', location: { href: 'https://local/' }
    };
    const silentLogs = [];
    const sandbox = {
        console: { log() { }, warn() { }, error() { }, _logs: silentLogs },
        localStorage, sessionStorage: localStorage, document,
        AbortController: function () { this.signal = {}; this.abort = function () { }; },
        // ★ 2026-10-14 修：setTimeout/clearTimeout 必须透传宿主真实定时器。旧实现是
        //   no-op（永不执行回调且不注册句柄），当假 fetch 返回 pending Promise（如 P7
        //   在途 gate）时，事件循环零句柄 → Node 直接以 exit 0 退出，后续用例与汇总
        //   全部静默不跑，pre-push 即使有 FAIL 也拦不住。setInterval 保持 no-op，防止
        //   bundle 内常驻轮询（如登录遮罩 maskPoll）把测试进程挂住。
        setTimeout: opts.setTimeout || function (fn, ms, ...a) { return setTimeout(fn, ms, ...a); },
        clearTimeout: opts.clearTimeout || function (id) { return clearTimeout(id); },
        setInterval: function () { return 0; }, clearInterval: function () { },
        // ★ 冻结时钟：bundle 内 new Date() / Date.now() 走 FakeDate，天数断言永不过期
        Date: FakeDate,
        navigator: { userAgent: 'node' }, location: { href: 'https://local/' },
        _els: els, _ls: localStorage, _hits: [],
        // 推进冻结时钟（毫秒），供节流/重试类用例模拟时间流逝
        _tickClock(ms) { __clockNow += ms; }
    };
    sandbox.fetch = function (url, o) {
        sandbox._hits.push(String(url));
        if (!/action=get-profile/.test(String(url))) return Promise.resolve(jsonResp({ success: false }));
        return fetchImpl(url, o);
    };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(bundlePath, 'utf8'), sandbox, { filename: 'auth-core.js' });
    return sandbox;
}

const render = async (sb) => { await sb.updateLicenseStatusText(); return sb._els.licenseStatusText.innerHTML; };
const readKey = (sb, k) => { const raw = sb._ls.getItem(k); return raw ? JSON.parse(raw) : null; };
const gfHits = (sb) => sb._hits.filter(u => /action=get-profile/.test(String(u))).length;
const KEYS5 = ['auth:currentUser', 'currentUser', 'cloud_currentUser', 'user_login_data', 'local_currentUser'];
// 造数时间戳默认取冻结基准日（与沙箱内 Date.now() 同一时刻），避免种子数据落在
// "沙箱未来"触发 bundle 任何基于时间差的分支；确需自定义可传第二参。
const seedAll = (user, now) => {
    const ts = now === undefined ? FIXED_NOW : now;
    const o = {};
    o['auth:currentUser'] = JSON.stringify(user);
    o['currentUser'] = JSON.stringify(user);
    o['cloud_currentUser'] = JSON.stringify(user);
    o['user_login_data'] = JSON.stringify({ user: user, loginTime: ts });
    o['local_currentUser'] = JSON.stringify(user);
    return o;
};

module.exports = { makeStatusSandbox, jsonResp, makeEl, render, readKey, gfHits, seedAll, KEYS5, DEFAULT_BUNDLE, FIXED_NOW };
