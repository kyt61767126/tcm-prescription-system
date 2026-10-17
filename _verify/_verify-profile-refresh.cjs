// ============================================================================
//  _verify-profile-refresh.cjs — 独立复核（2026-10-10 P0「续费后仍显示未激活/已缓存」）
//
//  方法：用 node:vm 加载**真实上线包** shared/auth-core.js（不做副本、不手抄），
//        打桩 window/document/localStorage/fetch 后调用 window.updateLicenseStatusText()，
//        断言 document.getElementById('licenseStatusText').innerHTML 的渲染结果
//        以及各 localStorage 键的写回结果。
//
//  用例（对应复核任务 B1–B5 + 追加并发/节流/清空/无token 观察）：
//    B1  本地 2027-10-08（过时） vs 服务端 2028-10-07 → 缓存被覆盖为新值
//    B2  本地 clinicStatus=''（旧缓存形态） vs 服务端 'active'+新到期日 → 渲染「✅ 已激活」
//    B3  本地 'test' + 服务端 'test' → 必须仍「⏳ 试用期/待审核」（2026-09-09 安全修复不得回退）
//    B3b 本地 'active' + 服务端 'test' → 必须被服务端覆盖为「⏳ 试用期/待审核」
//    B4  服务端 401 / 网络异常 → 不写任何缓存；旧缓存形态文案仍是未激活形态
//    B5  服务端 username ≠ 本地（换账号竞态）→ 不写任何缓存
//    B6a 同一 tick 并发两次 updateLicenseStatusText → 去重与最终渲染
//    B6b 首屏请求在途时用户重开设置（同会话第二次渲染）→ 残留路径
//    B7  网络失败是否吃掉 6h 节流窗口（函数头注释声称"不吃"）
//    B8  服务端 clinicExpiresAt=null 时本地旧值是否被清（观察）
//    B9  登录缓存无 token 时自愈是否被跳过（观察）
//
//  注意：bundle 内还有 /api/license/invite 等其它 fetch，计数一律按 URL 过滤。
//
//  用法: node tools/_verify-profile-refresh.cjs    退出码 0=全过
// ============================================================================
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// 默认测当前工作区上线包；可用 VERIFY_BUNDLE 指向历史版本（如 git show HEAD 导出的旧包）做对照
const BUNDLE = process.env.VERIFY_BUNDLE || path.join(__dirname, '..', 'shared', 'auth-core.js');
const NEW_EXP = '2028-10-07T00:00:00.000Z';
const OLD_EXP = '2027-10-08T00:00:00.000Z';
const USER = '15200069705';
const CLINIC = '中医诊所·9705';

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
    if (cond) { console.log('  PASS  ' + name); pass++; }
    else { console.log('  FAIL  ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')); fail++; }
};

// ---------------- 桩 ----------------
function makeEl(id) {
    return {
        id: id, innerHTML: '', textContent: '', style: {}, disabled: false, className: '',
        children: [], parentNode: null,
        appendChild(c) { c.parentNode = this; this.children.push(c); return c; },
        removeChild(c) { return c; },
        insertAdjacentHTML() { }, remove() { },
        setAttribute() { }, getAttribute() { return null; },
        querySelector() { return null; }, querySelectorAll() { return []; },
        addEventListener() { }, classList: { add() { }, remove() { }, toggle() { }, contains() { return false; } }
    };
}
function jsonResp(obj, status) {
    const st = status || 200;
    return { ok: st >= 200 && st < 300, status: st, text: async () => JSON.stringify(obj) };
}
function makeSandbox(seedLs, fetchImpl) {
    const lsMap = new Map(Object.entries(seedLs || {}));
    const localStorage = {
        _m: lsMap,
        getItem(k) { return lsMap.has(k) ? lsMap.get(k) : null; },
        setItem(k, v) { lsMap.set(k, String(v)); },
        removeItem(k) { lsMap.delete(k); },
        key(i) { return [...lsMap.keys()][i] || null; },
        get length() { return lsMap.size; }
    };
    const els = { licenseStatusText: makeEl('licenseStatusText'), adminActivateSettingsBtn: makeEl('adminActivateSettingsBtn') };
    const document = {
        getElementById(id) { return els[id] || null; },
        createElement() { return makeEl('created'); },
        createTextNode(t) { return { textContent: t, parentNode: null }; },
        querySelector() { return null; }, querySelectorAll() { return []; },
        addEventListener() { }, removeEventListener() { },
        body: makeEl('body'), head: makeEl('head'), documentElement: makeEl('html'),
        readyState: 'complete', location: { href: 'https://local/' }
    };
    const sandbox = {
        console: { log() { }, warn() { }, error: console.error },   // 静默 bundle 日志
        localStorage, sessionStorage: localStorage, document,
        AbortController: function () { this.signal = {}; this.abort = function () { }; },
        setTimeout: function () { return 0; }, clearTimeout: function () { },
        setInterval: function () { return 0; }, clearInterval: function () { },
        navigator: { userAgent: 'node' }, location: { href: 'https://local/' },
        _els: els, _ls: localStorage, _hits: []
    };
    // 只把 get-profile 交给被测处理器；其它端点（/api/license/invite 等）返回中性响应，
    // 避免 mock 串味（invite 响应若带 clinicExpiresAt 会触发 syncClinicExpiryFromInvite 额外渲染）
    sandbox.fetch = function (url, opts) {
        sandbox._hits.push(String(url));
        if (!/action=get-profile/.test(String(url))) return Promise.resolve(jsonResp({ success: false }));
        return fetchImpl(url, opts);
    };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(BUNDLE, 'utf8'), sandbox, { filename: 'shared/auth-core.js' });
    return sandbox;
}
const render = async (sb) => { await sb.updateLicenseStatusText(); return sb._els.licenseStatusText.innerHTML; };
const readKey = (sb, k) => { const raw = sb._ls.getItem(k); return raw ? JSON.parse(raw) : null; };
const gfHits = (sb) => sb._hits.filter(u => /action=get-profile/.test(String(u))).length;
const urlPaths = (sb) => [...new Set(sb._hits.map(u => String(u).replace(/^https?:\/\/[^/]+/, '')))].join(' | ');
const KEYS5 = ['auth:currentUser', 'currentUser', 'cloud_currentUser', 'user_login_data', 'local_currentUser'];
const snapshot = (sb) => { const o = {}; KEYS5.forEach(k => { o[k] = sb._ls.getItem(k); }); return o; };

// 从源码抽取函数本体（感知 // 注释、/* */ 注释、' " ` 字符串；按大括号配平）
function extractFunction(src, name) {
    const sig = 'function ' + name + '(';
    const start = src.indexOf(sig);
    if (start < 0) return null;
    let head = start;
    if (src.slice(start - 6, start) === 'async ') head = start - 6;
    const braceStart = src.indexOf('{', start);
    let depth = 0, i = braceStart, inS = null, inLine = false, inBlock = false, esc = false;
    for (; i < src.length; i++) {
        const c = src[i], n = src[i + 1];
        if (inLine) { if (c === '\n') inLine = false; continue; }
        if (inBlock) { if (c === '*' && n === '/') { inBlock = false; i++; } continue; }
        if (inS) {
            if (esc) { esc = false; continue; }
            if (c === '\\') { esc = true; continue; }
            if (c === inS) inS = null;
            continue;
        }
        if (c === '/' && n === '/') { inLine = true; i++; continue; }
        if (c === '/' && n === '*') { inBlock = true; i++; continue; }
        if (c === "'" || c === '"' || c === '`') { inS = c; continue; }
        if (c === '{') depth++;
        else if (c === '}') { depth--; if (depth === 0) { i++; break; } }
    }
    return src.slice(head, i);
}

// 服务端 get-profile 权威响应（形态与 functions/api/users.js L2577-2581 一致）
const serverOk = (over = {}) => jsonResp({
    success: true,
    user: Object.assign({
        username: USER, name: USER, role: 'clinic_admin', clinicId: 'clinic_o67d5eqv1r',
        clinicName: CLINIC, clinicStatus: 'active', clinicEdition: 'cloud_clinic',
        userType: 'production'
    }, over.user || {}),
    clinicExpiresAt: (over.clinicExpiresAt !== undefined ? over.clinicExpiresAt : NEW_EXP)
});

// 旧缓存形态：clinicStatus 为空、无到期日（客户反馈的「未激活/旧缓存」）
const OLD_CACHE_USER = { username: USER, token: 'tok-1', role: 'clinic_admin', clinicId: 'clinic_o67d5eqv1r' };
// 过时缓存：已 active 但到期日停在续费前
const STALE_CACHE_USER = Object.assign({}, OLD_CACHE_USER, { clinicStatus: 'active', clinicEdition: 'cloud_clinic', clinicExpiresAt: OLD_EXP, clinicName: CLINIC });

function seedAll(user) {
    return {
        'auth:currentUser': JSON.stringify(user),
        'currentUser': JSON.stringify(user),
        'cloud_currentUser': JSON.stringify(user),
        'user_login_data': JSON.stringify({ user: user, loginTime: Date.now() }),
        'local_currentUser': JSON.stringify(user)
    };
}

(async () => {
    console.log('=== 被测包: shared/auth-core.js（真实上线包，vm 加载）===');
    {
        const sb = makeSandbox(seedAll(STALE_CACHE_USER), () => serverOk());
        ok('加载后 window.updateLicenseStatusText 为函数', typeof sb.updateLicenseStatusText === 'function');
        const src = fs.readFileSync(BUNDLE, 'utf8');
        ok('包内含本次改动标记 PROFILE_FETCH_INTERVAL_MS / __refreshCloudProfileInner',
            /PROFILE_FETCH_INTERVAL_MS/.test(src) && /__refreshCloudProfileInner/.test(src));
    }

    // ---------------- B1 ----------------
    console.log('\n--- B1) 本地过时 ' + OLD_EXP + ' vs 服务端 ' + NEW_EXP + ' → 缓存必须被覆盖 ---');
    {
        const sb = makeSandbox(seedAll(STALE_CACHE_USER), () => serverOk());
        const html = await render(sb);
        const expDays = Math.ceil((Date.parse(NEW_EXP) - Date.now()) / 86400000);
        const oldDays = Math.ceil((Date.parse(OLD_EXP) - Date.now()) / 86400000);
        console.log('    innerHTML = ' + html);
        ok('★ 渲染天数 = 新到期日算出的 ' + expDays + ' 天',
            html.indexOf('剩余 <b style="color:#4caf50;">' + expDays + '</b> 天') >= 0, html);
        ok('★ 渲染天数 ≠ 旧到期日算出的 ' + oldDays + ' 天',
            html.indexOf('剩余 <b style="color:#4caf50;">' + oldDays + '</b> 天') < 0, html);
        ok('★ auth:currentUser 缓存被覆盖为 ' + NEW_EXP, readKey(sb, 'auth:currentUser').clinicExpiresAt === NEW_EXP,
            readKey(sb, 'auth:currentUser').clinicExpiresAt);
        ok('★ currentUser 被覆盖', readKey(sb, 'currentUser').clinicExpiresAt === NEW_EXP, readKey(sb, 'currentUser').clinicExpiresAt);
        ok('★ cloud_currentUser 被覆盖', readKey(sb, 'cloud_currentUser').clinicExpiresAt === NEW_EXP, readKey(sb, 'cloud_currentUser').clinicExpiresAt);
        ok('★ user_login_data.user 被覆盖（{user,loginTime} 结构）', readKey(sb, 'user_login_data').user.clinicExpiresAt === NEW_EXP,
            readKey(sb, 'user_login_data').user.clinicExpiresAt);
        ok('★ local_currentUser 被覆盖（新增第 4 键）', readKey(sb, 'local_currentUser').clinicExpiresAt === NEW_EXP, readKey(sb, 'local_currentUser').clinicExpiresAt);
        ok('user_login_data.loginTime 结构未被破坏', typeof readKey(sb, 'user_login_data').loginTime === 'number');
        ok('渲染不含「未激活/旧缓存」', html.indexOf('未激活/旧缓存') < 0);
    }

    // ---------------- B2 ----------------
    console.log('\n--- B2) 旧缓存 clinicStatus="" 无到期日 + 服务端 active/新到期日 → 必须「✅ 已激活」 ---');
    {
        const sb = makeSandbox(seedAll(OLD_CACHE_USER), () => serverOk());
        const html = await render(sb);
        console.log('    innerHTML = ' + html);
        ok('★ 渲染「✅ 已激活」', html.indexOf('✅ 已激活') >= 0);
        ok('★ 不再渲染「⏳ 未激活/旧缓存」', html.indexOf('未激活/旧缓存') < 0);
        ok('缓存 clinicStatus 被补为 active', readKey(sb, 'auth:currentUser').clinicStatus === 'active');
        ok('缓存 clinicExpiresAt 被写为新值', readKey(sb, 'auth:currentUser').clinicExpiresAt === NEW_EXP);
        ok('缓存 clinicName 被写回', readKey(sb, 'auth:currentUser').clinicName === CLINIC);
    }

    // ---------------- B3 ----------------
    console.log('\n--- B3) 本地 test + 服务端 test → 必须仍「⏳ 试用期/待审核」（不得误显示已激活）---');
    {
        const u = Object.assign({}, OLD_CACHE_USER, { clinicStatus: 'test', clinicExpiresAt: NEW_EXP });
        const sb = makeSandbox(seedAll(u), () => serverOk({ user: { clinicStatus: 'test', userType: 'test' } }));
        const html = await render(sb);
        console.log('    innerHTML = ' + html);
        ok('★ 渲染「⏳ 试用期/待审核」', html.indexOf('试用期/待审核') >= 0);
        ok('★ 绝不渲染「✅ 已激活」', html.indexOf('✅ 已激活') < 0);
        ok('缓存 clinicStatus 仍为 test', readKey(sb, 'auth:currentUser').clinicStatus === 'test');
    }
    console.log('\n--- B3b) 本地 active（有到期日）+ 服务端 test → 必须被服务端覆盖为试用期 ---');
    {
        const sb = makeSandbox(seedAll(STALE_CACHE_USER), () => serverOk({ user: { clinicStatus: 'test', userType: 'test' } }));
        const html = await render(sb);
        console.log('    innerHTML = ' + html);
        ok('★ 渲染「⏳ 试用期/待审核」', html.indexOf('试用期/待审核') >= 0);
        ok('★ 绝不渲染「✅ 已激活」', html.indexOf('✅ 已激活') < 0);
        ok('缓存 clinicStatus 被覆盖为 test', readKey(sb, 'auth:currentUser').clinicStatus === 'test');
    }

    // ---------------- B4 ----------------
    console.log('\n--- B4a) 网络异常（fetch reject）→ 不写缓存 + 仍是未激活形态 ---');
    {
        const before = seedAll(OLD_CACHE_USER);
        const snap = JSON.stringify(before);
        const sb = makeSandbox(before, () => { throw new Error('mock network down'); });
        const html = await render(sb);
        console.log('    innerHTML = ' + html);
        ok('★ 渲染仍是「⏳ 未激活/旧缓存」', html.indexOf('未激活/旧缓存') >= 0, html);
        ok('★ 绝不渲染「✅ 已激活」', html.indexOf('✅ 已激活') < 0);
        ok('无任何缓存写入（5 键与种子逐字节相同）', JSON.stringify(snapshot(sb)) === snap,
            [JSON.stringify(snapshot(sb)), snap]);
        ok('失败后带「联网校验未完成」提示', html.indexOf('联网校验未完成') >= 0);
    }
    console.log('\n--- B4b) 服务端 401 → 不写缓存 + 仍是未激活形态 ---');
    {
        const sb = makeSandbox(seedAll(OLD_CACHE_USER), () => jsonResp({ success: false, error: '未登录或登录已失效' }, 401));
        const html = await render(sb);
        console.log('    innerHTML = ' + html);
        ok('★ 渲染仍是「⏳ 未激活/旧缓存」', html.indexOf('未激活/旧缓存') >= 0, html);
        ok('★ 绝不渲染「✅ 已激活」', html.indexOf('✅ 已激活') < 0);
        ok('★ 401 不写任何缓存', readKey(sb, 'auth:currentUser').clinicStatus === undefined && readKey(sb, 'auth:currentUser').clinicExpiresAt === undefined,
            readKey(sb, 'auth:currentUser'));
        console.log('    [观察] 401 时是否带「联网校验未完成」提示 = ' + (html.indexOf('联网校验未完成') >= 0));
    }

    // ---------------- B5 ----------------
    console.log('\n--- B5) 服务端 username ≠ 本地（换账号竞态）→ 不写缓存 ---');
    {
        const sb = makeSandbox(seedAll(STALE_CACHE_USER), () => serverOk({ user: { username: '13900000000' } }));
        const html = await render(sb);
        console.log('    innerHTML = ' + html);
        const cu = readKey(sb, 'auth:currentUser');
        ok('★ 缓存未被写入（clinicExpiresAt 仍为旧值）', cu.clinicExpiresAt === OLD_EXP, cu.clinicExpiresAt);
        ok('★ 缓存未被写入（保留原 username）', cu.username === USER, cu.username);
        ok('user_login_data 未被写入', readKey(sb, 'user_login_data').user.clinicExpiresAt === OLD_EXP);
    }

    // ---------------- B6a ----------------
    console.log('\n--- B6a) 追加：同一 tick 并发两次 updateLicenseStatusText（旧缓存形态）---');
    {
        const sb = makeSandbox(seedAll(OLD_CACHE_USER), () => serverOk());
        await Promise.all([sb.updateLicenseStatusText(), sb.updateLicenseStatusText()]);
        const html = sb._els.licenseStatusText.innerHTML;
        console.log('    get-profile 请求次数 = ' + gfHits(sb) + '  全部 URL: ' + urlPaths(sb));
        console.log('    innerHTML = ' + html);
        ok('in-flight 去重生效：只打 1 次 get-profile', gfHits(sb) === 1, gfHits(sb));
        ok('★ 最终渲染不是「⏳ 未激活/旧缓存」(若 FAIL = 后到的一次拿到 stale cu)', html.indexOf('未激活/旧缓存') < 0, html);
    }
    // ---------------- B6b ----------------
    console.log('\n--- B6b) 追加【贴近现场】首屏请求在途时用户重开基础设置（同会话第二次渲染）---');
    {
        let release;
        const gate = new Promise(r => { release = r; });
        const sb = makeSandbox(seedAll(OLD_CACHE_USER), () => gate.then(() => serverOk()));
        const p1 = sb.updateLicenseStatusText();            // 打开设置 #1：发起 get-profile（在途）
        await sb.updateLicenseStatusText();                 // 用户在响应回来前重开设置 #2
        const htmlDuringFlight = sb._els.licenseStatusText.innerHTML;
        release();                                          // 服务端此刻才返回成功
        await p1;                                           // #1 完成：缓存已回写，但渲染因 reqId 被丢弃
        const htmlAfterFlight = sb._els.licenseStatusText.innerHTML;
        const cacheNow = readKey(sb, 'auth:currentUser');
        await sb.updateLicenseStatusText();                 // 用户再开一次设置 #3
        const html3 = sb._els.licenseStatusText.innerHTML;
        console.log('    get-profile 请求次数 = ' + gfHits(sb) + '  全部 URL: ' + urlPaths(sb));
        console.log('    #2 在途期间渲染 = ' + htmlDuringFlight);
        console.log('    #1 完成后仍显示 = ' + htmlAfterFlight);
        console.log('    #3 再开设置渲染 = ' + html3);
        console.log('    此时缓存 clinicExpiresAt = ' + cacheNow.clinicExpiresAt);
        ok('在途期间 #2 渲染为「未激活/旧缓存」+ 误导性网络提示（=残留路径）',
            htmlDuringFlight.indexOf('未激活/旧缓存') >= 0 && htmlDuringFlight.indexOf('联网校验未完成') >= 0, htmlDuringFlight);
        ok('★ 服务端已成功返回并回写缓存（clinicExpiresAt = 新值）', cacheNow.clinicExpiresAt === NEW_EXP, cacheNow.clinicExpiresAt);
        ok('★ 残留：成功响应到达后界面仍停在「未激活/旧缓存」(若 PASS 则无此残留)',
            htmlAfterFlight.indexOf('未激活/旧缓存') < 0, htmlAfterFlight);
        ok('再次打开设置可自愈为「✅ 已激活」', html3.indexOf('✅ 已激活') >= 0, html3);
    }

    // ---------------- B7 ----------------
    console.log('\n--- B7) 追加：节流 6h 窗口在「网络失败」后是否回滚（函数头注释声明：失败不吃窗口）---');
    {
        let mode = 'fail';
        const sb = makeSandbox(seedAll(OLD_CACHE_USER), () => { if (mode === 'fail') throw new Error('down'); return serverOk(); });
        const h1 = await render(sb);
        const gf1 = gfHits(sb);
        mode = 'ok';
        const h2 = await render(sb);
        const gf2 = gfHits(sb);
        console.log('    第一次(失败) = ' + h1);
        console.log('    第二次(成功) = ' + h2);
        console.log('    get-profile 尝试次数: 第1次渲染后 = ' + gf1 + '，第2次渲染后 = ' + gf2 + '  全部 URL: ' + urlPaths(sb));
        ok('★ 网络失败后下一次渲染是否重试（get-profile 次数应增加）', gf2 > gf1, { gf1, gf2 });
        ok('★ 失败后重试拿到权威值 → 第二次应「✅ 已激活」', h2.indexOf('✅ 已激活') >= 0, h2);
        ok('重试成功后缓存已更新', readKey(sb, 'auth:currentUser').clinicExpiresAt === NEW_EXP);
    }

    // ---------------- B8 ----------------
    console.log('\n--- B8) 追加【观察】：本地有过时到期日 + 服务端 clinicExpiresAt=null → 本地旧值是否被清掉 ---');
    {
        const sb = makeSandbox(seedAll(STALE_CACHE_USER), () => serverOk({ clinicExpiresAt: null }));
        const html = await render(sb);
        console.log('    innerHTML = ' + html);
        console.log('    [观察] 缓存 clinicExpiresAt = ' + readKey(sb, 'auth:currentUser').clinicExpiresAt);
        ok('（观察项）服务端 null 时不覆盖本地旧值', readKey(sb, 'auth:currentUser').clinicExpiresAt === OLD_EXP,
            readKey(sb, 'auth:currentUser').clinicExpiresAt);
    }

    // ---------------- B9 ----------------
    console.log('\n--- B9) 追加【观察】：登录缓存无 token → 自愈是否被跳过（残留路径）---');
    {
        const noToken = { username: USER, name: USER, role: 'clinic_admin', clinicId: 'clinic_o67d5eqv1r' };
        const sb = makeSandbox(seedAll(noToken), () => serverOk());
        const html = await render(sb);
        console.log('    innerHTML = ' + html);
        console.log('    [观察] get-profile 次数 = ' + gfHits(sb) + '  全部 URL: ' + urlPaths(sb));
        ok('无 token 时不打 get-profile 且仍显示未激活形态', gfHits(sb) === 0 && html.indexOf('未激活/旧缓存') >= 0, html);
    }

    // ---------------- B10 ----------------
    console.log('\n--- B10) 追加：能被新旧两版都走到的自愈路径（clinicStatus=active 且无 clinicExpiresAt）---');
    {
        // 老代码只在 !cu.clinicExpiresAt 时自愈 → 本形态两版都会进入 refreshCloudProfile，
        // 用于判定"网络失败吃掉节流窗口"是本次引入还是既有行为
        const u = { username: USER, token: 'tok-1', clinicStatus: 'active', clinicEdition: 'cloud_clinic', clinicId: 'clinic_o67d5eqv1r' };
        let mode = 'fail';
        const sb = makeSandbox(seedAll(u), () => { if (mode === 'fail') throw new Error('down'); return serverOk(); });
        const h1 = await render(sb);
        const gf1 = gfHits(sb);
        mode = 'ok';
        const h2 = await render(sb);
        const gf2 = gfHits(sb);
        const expDays = Math.ceil((Date.parse(NEW_EXP) - Date.now()) / 86400000);
        console.log('    第一次(失败) = ' + h1);
        console.log('    第二次(成功) = ' + h2);
        console.log('    get-profile 尝试次数: = ' + gf1 + ' → ' + gf2);
        ok('★ 失败后第二次渲染是否重试（次数应增加）', gf2 > gf1, { gf1, gf2 });
        ok('★ 失败后第二次渲染拿到新到期日（' + expDays + ' 天）', h2.indexOf('剩余 <b style="color:#4caf50;">' + expDays + '</b> 天') >= 0, h2);
    }

    // ---------------- E) syncClinicExpiryFromInvite 单调回写 ----------------
    console.log('\n--- E) syncClinicExpiryFromInvite 单调回写（邀请码返回值更旧时不得回写）---');
    {
        const fn = extractFunction(fs.readFileSync(BUNDLE, 'utf8'), 'syncClinicExpiryFromInvite');
        ok('函数本体抽取成功（字符串/注释感知的括号配平）', !!fn && fn.indexOf('clinicExpiresAt') >= 0);
        const build = (cuStored, opts) => {
            const ls = new Map([['auth:currentUser', JSON.stringify(cuStored)]]);
            const globalObj = {
                localStorage: {
                    getItem(k) { return ls.has(k) ? ls.get(k) : null; },
                    setItem(k, v) { ls.set(k, String(v)); }
                }
            };
            const StorageAdapter = {
                getItem: async (k) => (ls.has(k) ? ls.get(k) : null),
                setItem: async (k, v) => { ls.set(k, String(v)); }
            };
            let rerenders = 0;
            const f = new Function('readCloudLoginUser', 'StorageAdapter', 'global', 'updateLicenseStatusText', 'console',
                fn + '\nreturn syncClinicExpiryFromInvite;')(
                async () => cuStored, StorageAdapter, globalObj, () => { rerenders++; },
                { warn() { } });
            return { f, ls, rerenders: () => rerenders };
        };
        // E1 邀请码返回值更旧 → 不回写
        {
            const cu = { username: USER, clinicExpiresAt: NEW_EXP };
            const h = build(cu);
            await h.f({ clinicExpiresAt: OLD_EXP });
            const after = JSON.parse(h.ls.get('auth:currentUser')).clinicExpiresAt;
            console.log('    E1 响应 ' + OLD_EXP + ' → 缓存 ' + after + '，重渲次数=' + h.rerenders());
            ok('★ 更旧的值不回写（缓存保持 ' + NEW_EXP + '）', after === NEW_EXP, after);
            ok('★ 更旧的值不触发重渲', h.rerenders() === 0, h.rerenders());
        }
        // E2 邀请码返回值更新 → 回写 + 重渲
        {
            const cu = { username: USER, clinicExpiresAt: OLD_EXP };
            const h = build(cu);
            await h.f({ clinicExpiresAt: NEW_EXP });
            const after = JSON.parse(h.ls.get('auth:currentUser')).clinicExpiresAt;
            console.log('    E2 响应 ' + NEW_EXP + ' → 缓存 ' + after + '，重渲次数=' + h.rerenders());
            ok('更新的值被回写', after === NEW_EXP, after);
            ok('更新的值触发重渲', h.rerenders() === 1, h.rerenders());
        }
        // E3 相等 → 早退
        {
            const cu = { username: USER, clinicExpiresAt: NEW_EXP };
            const h = build(cu);
            await h.f({ clinicExpiresAt: NEW_EXP });
            ok('E3 值相等 → 零写零重渲', h.rerenders() === 0);
        }
    }

    console.log('\n=== 结果: ' + pass + ' 通过, ' + fail + ' 失败 ===');
    process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('测试框架异常:', e); process.exit(2); });
