// ============================================================================
//  cloud-api-timeout-test.cjs — cloudFetch 超时/错误文案归一化回归（零网络）
//
//  背景（真机现象）：手机云端 APP 指纹解锁后登录，红字显示英文
//  "The user aborted a request." —— 根因是 cloudFetch 固定 10s 硬超时，
//  abort 的 AbortError.message 被原样透传到登录框；且指纹解锁后（退出系统弹窗、
//  WebView/网络栈恢复期、弱网）最容易越过 10s，于是看起来像"指纹坏了"。
//
//  本测试用 vm 加载 shared/cloud-api.js（浏览器脚本），stub window/fetch/setTimeout：
//    A) 登录 URL → 超时 30s（放宽）
//    B) 其他 URL → 超时 20s
//    C) options.timeoutMs 显式覆盖优先生效
//    D) abort/超时 → 中文可执行提示 + timedOut 标记（不再泄露英文平台文案）
//    E) 平台文案（AbortError 文案）即使没超时也要归一化
//    F) 我方 HTTP 错误（服务端 error 透传 + HTTP 状态）必须原样保留
//    G) 普通业务异常文案原样保留
//    H) 成功路径行为不变
//
//  用法: node e2e/.tmp/cloud-api-timeout-test.cjs   （退出码 0=全过）
// ============================================================================
const fs = require('fs');
const vm = require('vm');
const path = require('path');

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
    if (cond) { console.log('  PASS  ' + name); pass++; }
    else { console.log('  FAIL  ' + name + (extra ? '  -> ' + extra : '')); fail++; }
};

const SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'shared', 'cloud-api.js'), 'utf8');
const realSetTimeout = global.setTimeout;
const realClearTimeout = global.clearTimeout;

// 构造隔离运行时：window / fetch stub；定时器用真的（记录延时并 unref，避免拖住进程）
function makeCtxWithFetch(fetchImpl, delaySink) {
    const win = { _cloudReachable: null, updateModeStatus() {} };
    const sandbox = {
        window: win,
        console,
        AbortController,
        clearTimeout: (id) => realClearTimeout(id),
        setTimeout: (fn, ms) => {
            if (delaySink) delaySink.push(ms);
            return realSetTimeout(fn, ms);   // 真定时器（cloudFetch 各路径都会 clearTimeout）
        },
        URL, JSON, Object, Array, String, Number, Error, Promise, RegExp,
        navigator: { onLine: true }
    };
    sandbox.fetch = fetchImpl;
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(SRC, sandbox);
    return sandbox;
}

const API = 'https://tcm-prescription-system.pages.dev/api';

(async () => {
    // ---------- A/B/C 超时分档 ----------
    console.log('--- A/B/C) 超时分档与覆盖 ---');
    {
        const delays = [];
        // 用"立即成功应答"的 fetch：只关心 setTimeout 收到的延时，且让 cloudFetch 及时清掉定时器
        const quickOk = async () => ({
            ok: true, status: 200, text: async () => JSON.stringify({ success: true })
        });
        const sb = makeCtxWithFetch(quickOk, delays);
        await sb.window.cloudFetch(API + '/users?login=true', { method: 'POST', body: '{}' });
        await sb.window.cloudFetch(API + '/prescriptions?clinicId=x');
        ok('★ 登录 URL → 30000ms', delays[0] === 30000, '实际=' + delays[0]);
        ok('★ 其他 URL → 20000ms', delays[1] === 20000, '实际=' + delays[1]);

        const delays2 = [];
        const sb2 = makeCtxWithFetch(quickOk, delays2);
        await sb2.window.cloudFetch(API + '/users?login=true', { timeoutMs: 250 });
        ok('options.timeoutMs 覆盖优先', delays2[0] === 250, '实际=' + delays2[0]);
    }

    // ---------- D) 超时 → 中文提示 + timedOut ----------
    console.log('\n--- D) 超时归一化（不再泄露英文平台文案）---');
    {
        const hang = (url, init) => new Promise((_, rej) => {
            init.signal.addEventListener('abort', () => {
                const e = new Error('The user aborted a request.'); e.name = 'AbortError'; rej(e);
            });
        });
        const sb = makeCtxWithFetch(hang);
        const r = await sb.window.cloudFetch(API + '/users?login=true', { timeoutMs: 20 });
        ok('★ 返回中文可执行提示', /超时/.test(r.error) && !/abort/i.test(r.error), JSON.stringify(r.error));
        ok('★ 带 timedOut 标记（供上层重试）', r.timedOut === true, JSON.stringify(r));
        ok('success=false / fromCloud=false', r.success === false && r.fromCloud === false);
    }

    // ---------- E) 平台文案（非超时）也归一化 ----------
    console.log('\n--- E) 平台网络文案归一化 ---');
    {
        const sb = makeCtxWithFetch(async () => { throw new Error('The user aborted a request.'); });
        const r = await sb.window.cloudFetch(API + '/prescriptions');
        ok('★ AbortError 文案被归一化', /超时|网络/.test(r.error) && !/aborted/i.test(r.error), JSON.stringify(r.error));

        const sb2 = makeCtxWithFetch(async () => { throw new Error('Failed to fetch'); });
        const r2 = await sb2.window.cloudFetch(API + '/prescriptions');
        ok('★ Failed to fetch 被归一化', /超时|网络/.test(r2.error) && !/Failed to fetch/.test(r2.error), JSON.stringify(r2.error));
    }

    // ---------- F) 我方 HTTP 错误必须原样保留 ----------
    console.log('\n--- F) 服务端错误透传不被吞 ---');
    {
        const sb = makeCtxWithFetch(async () => ({
            ok: false, status: 403,
            text: async () => JSON.stringify({ success: false, error: '无权删除其他诊所的用户' })
        }));
        const r = await sb.window.cloudFetch(API + '/users?clinic=update', { method: 'POST', body: '{}' });
        ok('★ 保留服务端原因 + HTTP 状态', r.error === '无权删除其他诊所的用户（HTTP 403）', JSON.stringify(r.error));
        ok('timedOut 非 true', r.timedOut === false, JSON.stringify(r.timedOut));
    }

    // ---------- G) 普通业务异常原样保留 ----------
    console.log('\n--- G) 普通异常文案原样保留 ---');
    {
        const sb = makeCtxWithFetch(async () => { throw new Error('Invalid response format'); });
        const r = await sb.window.cloudFetch(API + '/prescriptions');
        ok('普通文案不被改写', r.error === 'Invalid response format', JSON.stringify(r.error));
    }

    // ---------- H) 成功路径不变 ----------
    console.log('\n--- H) 成功路径不变 ---');
    {
        const sb = makeCtxWithFetch(async () => ({
            ok: true, status: 200,
            text: async () => JSON.stringify({ success: true, user: { username: 'wgj' } })
        }));
        const r = await sb.window.cloudFetch(API + '/users?login=true', { method: 'POST', body: '{}' });
        ok('成功透传 + fromCloud=true', r.success === true && r.fromCloud === true && r.user && r.user.username === 'wgj', JSON.stringify(r));
        ok('不再固定 10s（已分档）', true);
    }

    console.log('\n=== 结果: ' + pass + ' 通过, ' + fail + ' 失败 ===');
    process.exit(fail === 0 ? 0 : 1);
})();
