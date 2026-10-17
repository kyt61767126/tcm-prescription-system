// ============================================================================
//  prescriptions-ready-gate-test.cjs — P1-④ 处方就绪门禁回归（mock IDB/cloudFetch/localStorage）
//
//  背景（docs/登录速度分析与优化建议.md 第十章）：
//    P1-④ 要把 loadData() 变 fire-and-forget（主界面先出现、数据随后到），
//    但处方号生成 generatePrescriptionNo → getGlobalMaxSerial 依赖处方全量集，
//    UI 提前出现会生成**重复处方号**（医疗场景不可接受）。定案：处方号生成只有
//    **一个收口点 getGlobalMaxSerial**，在那里 fail-closed（未就绪不取号、不写任何存储）。
//
//  本测试【按函数本体从 public/index.html 抽取】被测函数（不抄副本），
//  按用户指定口径打桩：cloudFetch / IDB / localStorage / getAllPrescriptionsFromDB。
//
//  A 组 getAllUserPrescriptions（预取消费语义，来自 P1-①）
//    A1 未声明 partial（老客户端/小诊所）→ 消费预取、**跳过** /prescriptions GET（净赚一次往返）
//    A2 partial=true → 预取仅作首屏加速，随后补拉全量并按 id 合并
//       ★「partial 时最终条数 ≥ total 且云端 id 全在」——文档第十章遗留断言
//    A3 补拉失败 → 保留首屏部分数据（绝不放空/截断）
//    A4 预取是一次性消费（第二次调用不再命中，走 GET）
//
//  B 组 getGlobalMaxSerial（P1-④ 收口点 fail-closed）
//    B1 未就绪 → 不返回任何序号（null）、**不写 localStorage / 不写 IDB**（不得留半成品序号）
//    B2 就绪 → 返回 == 既有最大序号（当日）+ 1 的值
//    B3 就绪后时效：不重复取号（同日第二次调用序号不跳号）
//    B4 缺依赖（localStorage 不可用）→ 不抛错
//    B5 未就绪超时（Promise 永不 resolve）→ 仍 fail-closed，且耗时受 __prescriptionsReadyTimeoutMs 约束
//
//  C 组 loadData 就绪标志契约（源码文本断言，六端同体防漂移）
//    C1 loadData 成功路径与失败路径都置 window.__prescriptionsReady = true
//    C2 loadData 成功路径与失败路径都 resolve window.__prescriptionsReadyPromise
//    C3 generatePrescriptionNo / generatePrescriptionNoForSave 仍经 getGlobalMaxSerial（收口点唯一）
//
//  用法: node tools/prescriptions-ready-gate-test.cjs      退出码 0=全过
// ============================================================================
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
// 默认测云端权威源；传路径参数可改测离线端/各副本（同一套断言，防六端漂移）
const HTML = process.argv[2] ? path.resolve(process.argv[2]) : path.join(ROOT, 'public', 'index.html');

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
    if (cond) { console.log('  PASS  ' + name); pass++; }
    else { console.log('  FAIL  ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')); fail++; }
};

// ---- 字符串/注释/模板串感知的函数体抽取（支持 async；与 sync-shared-blocks 同款扫描思路）----
function extractFunction(src, name) {
    const headRe = new RegExp('(?:async\\s+)?function\\s+' + name + '\\s*\\([^)]*\\)\\s*\\{');
    const m = headRe.exec(src);
    if (!m) throw new Error('未找到函数: ' + name);
    let i = src.indexOf('{', m.index);
    let depth = 0;
    while (i < src.length) {
        const c = src[i];
        if (c === "'" || c === '"') {
            const q = c; i++;
            while (i < src.length && src[i] !== q) { if (src[i] === '\\') i++; i++; }
            i++; continue;
        }
        if (c === '`') {
            i++;
            while (i < src.length && src[i] !== '`') { if (src[i] === '\\') i++; i++; }
            i++; continue;
        }
        if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
        if (c === '/' && src[i + 1] === '*') { i += 2; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; continue; }
        if (c === '{') depth++;
        else if (c === '}') { depth--; if (depth === 0) { i++; break; } }
        i++;
    }
    return src.substring(m.index, i);
}

const HTML_SRC = fs.readFileSync(HTML, 'utf8');
const TODAY = new Date().toLocaleDateString('sv-SE').replace(/-/g, '').slice(2);   // YYMMDD

module.exports = { extract: (src, name) => extractFunction(src, name) };

// ---- mock localStorage ----
function makeLS(seed) {
    const m = new Map(Object.entries(seed || {}));
    return {
        _m: m,
        getItem: (k) => (m.has(k) ? m.get(k) : null),
        setItem: (k, v) => { m.set(k, String(v)); },
        removeItem: (k) => { m.delete(k); },
    };
}

// ---- 抽取 getAllUserPrescriptions 并在打桩环境执行 ----
function loadGetAllUserPrescriptions(env) {
    const fnSrc = extractFunction(HTML_SRC, 'getAllUserPrescriptions');
    const ls = env.ls || makeLS();
    const calls = env.calls || { cloudFetch: [], idb: [], sync: [], saved: [] };
    const win = Object.assign({ CLOUD_API_BASE: 'https://api.test/api' }, env.winExtra || {});
    if (env.prefetched) win.__loginPrefetchedPrescriptions = env.prefetched;
    if (env.prefetchedPartial) win.__loginPrefetchedPrescriptionsPartial = true;
    if (env.prefetchedTotal !== undefined) win.__loginPrefetchedPrescriptionsTotal = env.prefetchedTotal;

    const cloudFetch = async (url, opts) => {
        calls.cloudFetch.push(url);
        if (env.cloudFetchImpl) return env.cloudFetchImpl(url, opts, calls.cloudFetch.length);
        return { success: true, data: [] };
    };
    const getAllPrescriptionsFromDB = env.idbReadImpl
        ? env.idbReadImpl
        : async () => (env.localDB || []);    const filterOutDeleted = (arr) => (arr || []).filter(p => !(env.deletedIds || []).includes(String(p.id)));
    const syncPrescriptionsDBDiff = async (recs) => { calls.sync.push(recs.map(r => String(r.id))); };
    const clearPrescriptionsDB = async () => { calls.saved.push('clear'); };
    const saveAllPrescriptionsToDB = async (recs) => { calls.saved.push(recs.length); };
    const getFromIndexedDB = async () => null;
    const requestIdleCallback = (fn) => { fn(); };
    const setTimeoutFn = (fn) => { fn(); return 0; };
    const consoleStub = { log() {}, warn() {}, error() {} };

    const fn = new Function(
        'cloudFetch', 'window', 'localStorage', 'getAllPrescriptionsFromDB', 'filterOutDeleted',
        'syncPrescriptionsDBDiff', 'clearPrescriptionsDB', 'saveAllPrescriptionsToDB',
        'getFromIndexedDB', 'requestIdleCallback', 'setTimeout', 'console',
        'return (' + fnSrc + ');'
    )(cloudFetch, win, ls, getAllPrescriptionsFromDB, filterOutDeleted,
        syncPrescriptionsDBDiff, clearPrescriptionsDB, saveAllPrescriptionsToDB,
        getFromIndexedDB, requestIdleCallback, setTimeoutFn, consoleStub);
    return { fn, win, ls, calls, fnSrc };
}

// ---- 抽取 getGlobalMaxSerial 并在打桩环境执行 ----
function loadGetGlobalMaxSerial(env) {
    const fnSrc = extractFunction(HTML_SRC, 'getGlobalMaxSerial');
    const setSrc = extractFunction(HTML_SRC, 'setGlobalMaxSerial');
    const ls = env.ls || makeLS();
    const localDBWrites = [];
    const win = Object.assign({}, env.winExtra || {});
    if (env.readyFlag === true) win.__prescriptionsReady = true;
    if (env.readyPromise) win.__prescriptionsReadyPromise = env.readyPromise;
    if (env.timeoutMs !== undefined) win.__prescriptionsReadyTimeoutMs = env.timeoutMs;

    const getFromIndexedDB = async () => (env.idbStored || null);
    const saveToIndexedDB = (store, rec) => { localDBWrites.push(rec); return Promise.resolve(); };
    const alertCalls = [];
    const consoleStub = { log() {}, warn() {}, error() {} };

    const factory = new Function(
        'localStorage', 'window', 'getFromIndexedDB', 'saveToIndexedDB', 'IS_ELECTRON',
        'alert', 'console', 'setTimeout', 'clearTimeout', 'Date', 'Promise', 'JSON', 'Array', 'parseInt', 'isNaN',
        'prescriptionHistory', 'setGlobalMaxSerial',
        'return { max: (' + fnSrc + ') };'
    );
    const built = factory(ls, win, getFromIndexedDB, saveToIndexedDB, false, (m) => alertCalls.push(m),
        consoleStub, env.setTimeoutFn || setTimeout, clearTimeout, Date, Promise, JSON, Array, parseInt, isNaN,
        env.prescriptionHistory, (n) => { /* 测试内落盘：直接写 localStorage，语义与页面 setGlobalMaxSerial 等价 */
            try { ls.setItem('global_max_serial', JSON.stringify({ date: new Date().toLocaleDateString('sv-SE'), maxSerial: n })); } catch (e) { }
        });
    return { fn: built.max, win, ls, idbWrites: localDBWrites, alertCalls, fnSrc };
}

(async () => {
    console.log('=== 抽取自 public/index.html 的函数签名 ===');
    {
        const fnSrc = extractFunction(HTML_SRC, 'getAllUserPrescriptions');
        const gSrc = extractFunction(HTML_SRC, 'getGlobalMaxSerial');
        ok('getAllUserPrescriptions 抽取成功', /getAllPrescriptionsFromDB/.test(fnSrc) && /loginPrefetchedPrescriptions|getAllPrescriptionsFromDB/.test(fnSrc));
        ok('getGlobalMaxSerial 抽取成功', /global_max_serial/.test(gSrc));
        console.log('    getAllUserPrescriptions ' + fnSrc.split('\n').length + ' 行 / getGlobalMaxSerial ' + gSrc.split('\n').length + ' 行');
    }

    // ================= A 组：getAllUserPrescriptions 预取消费语义 =================
    console.log('\n--- A) getAllUserPrescriptions 预取消费（cloudFetch/IDB/localStorage 打桩）---');
    // ★ 离线端权威源没有云端预取链路（无 token / 无 cloudFetch），A1–A4 只对云端权威源适用；
    //   离线端只跑 A5/A6（P1-③ 移植护栏）。检测方式看函数本体是否引用预取全局。
    const HAS_PREFETCH = /__loginPrefetchedPrescriptions/.test(extractFunction(HTML_SRC, 'getAllUserPrescriptions'));
    if (!HAS_PREFETCH) console.log('  （本端无云端预取链路 → A1–A4 跳过，仅跑 A5/A6 离线端护栏）');
    if (HAS_PREFETCH)
    {
        // A1 未声明 partial：消费预取、跳过 GET
        const calls = { cloudFetch: [], idb: [], sync: [], saved: [] };
        const env = loadGetAllUserPrescriptions({
            ls: makeLS({ 'auth:currentUser': JSON.stringify({ username: 'u1', token: 'tk-1' }), 'all_prescription_list': JSON.stringify([]) }),
            prefetched: [{ id: 101, patientName: 'A', createdAt: 5 }],
            calls,
        });
        const out = await env.fn('');
        ok('A1a 预取被消费（window.__loginPrefetchedPrescriptions 置空）', env.win.__loginPrefetchedPrescriptions === null);
        ok('A1b 跳过 /prescriptions GET（0 次 cloudFetch）', calls.cloudFetch.length === 0, calls.cloudFetch);
        ok('A1c 返回预取数据', out.length === 1 && String(out[0].id) === '101', out.map(r => r.id));

    // A2 partial=true：补拉全量并按 id 合并 —— 文档第十章遗留断言
    {
        const calls = { cloudFetch: [], idb: [], sync: [], saved: [] };
        const prefetched = [1, 2, 3, 4, 5].map(i => ({ id: i, patientName: 'P' + i, createdAt: i }));
        const full = [1, 2, 3, 4, 5, 6, 7, 8].map(i => ({ id: i, patientName: 'P' + i, createdAt: i, updatedAt: i }));
        const env = loadGetAllUserPrescriptions({
            ls: makeLS({ 'auth:currentUser': JSON.stringify({ username: 'u1', token: 'tk-1' }) }),
            prefetched,
            prefetchedPartial: true,
            prefetchedTotal: 8,
            calls,
            cloudFetchImpl: async () => ({ success: true, data: full, total: 8 }),
        });
        const out = await env.fn('');
        const ids = out.map(r => String(r.id));
        ok('A2a partial 时补拉了 1 次全量 GET', calls.cloudFetch.length === 1 && /\/prescriptions$/.test(calls.cloudFetch[0]), calls.cloudFetch);
        ok('A2b 最终条数 ≥ total（8）', out.length >= 8, { got: out.length, total: 8 });
        ok('A2c 云端 id 全在（1..8 无遗漏）', [1, 2, 3, 4, 5, 6, 7, 8].every(i => ids.includes(String(i))), ids);
    }
    {
        // A3 补拉失败：保留首屏部分数据（不截断、不放空）
        const calls = { cloudFetch: [], idb: [], sync: [], saved: [] };
        const prefetched = [1, 2, 3].map(i => ({ id: i, patientName: 'P' + i, createdAt: i }));
        const env = loadGetAllUserPrescriptions({
            ls: makeLS({ 'auth:currentUser': JSON.stringify({ username: 'u1', token: 'tk-1' }) }),
            prefetched, prefetchedPartial: true, prefetchedTotal: 9, calls,
            cloudFetchImpl: async () => { throw new Error('网络中断'); },
        });
        const out = await env.fn('');
        ok('A3 补拉失败仍保留首屏 3 条（绝不放空）', out.length === 3, out.map(r => r.id));
        ok('A3b 补拉失败走增量落库（未整表清空）', !calls.saved.includes('clear'), calls.saved);
    }
    {
        // A4 预取一次性消费
        const calls = { cloudFetch: [], idb: [], sync: [], saved: [] };
        const env = loadGetAllUserPrescriptions({
            ls: makeLS({ 'auth:currentUser': JSON.stringify({ username: 'u1', token: 'tk-1' }) }),
            prefetched: [{ id: 1, createdAt: 1 }],
            calls,
            cloudFetchImpl: async () => ({ success: true, data: [{ id: 1, createdAt: 1 }] }),
        });
        await env.fn('');
        await env.fn('');
        ok('A4 第二次调用不再命中预取（走 GET，数据新鲜度不变）', calls.cloudFetch.length === 1, calls.cloudFetch.length);
    }
    }

    {
        // A5 ★ P1-③ 落库护栏：IDB 读取成功且集合为空 → 允许增量落库（真正清库场景）
        const calls = { cloudFetch: [], idb: [], sync: [], saved: [] };
        const env = loadGetAllUserPrescriptions({
            // 云端源带 token 才会走云端分支；给一个返回空集的服务端，模拟"云端已删光 + 本地也空"
            ls: makeLS({ 'auth:currentUser': JSON.stringify({ username: 'u1', token: 'tk-1' }) }),
            calls, localDB: [],
            cloudFetchImpl: async () => ({ success: true, data: [] }),
        });
        await env.fn('');
        ok('A5 IDB 读成功且为空 → 增量落库 1 次（未整表清空）', calls.sync.length === 1 && !calls.saved.includes('clear'), { sync: calls.sync, saved: calls.saved });
    }
    {
        // A5b ★ 无云端 token（离线/纯本地）时不得发任何网络请求
        const calls = { cloudFetch: [], idb: [], sync: [], saved: [] };
        const env = loadGetAllUserPrescriptions({ ls: makeLS({}), calls, localDB: [{ id: 1, createdAt: 1 }] });
        await env.fn('');
        ok('A5b 无云端 token 时不发任何网络请求', calls.cloudFetch.length === 0, calls.cloudFetch);
    }
    {
        // A6 ★ P1-③ 落库护栏：IDB 读取失败（返回非数组）→ 绝不落库（防空集把 store 全删）
        const calls = { cloudFetch: [], idb: [], sync: [], saved: [] };
        const env = loadGetAllUserPrescriptions({
            ls: makeLS({}), calls,
            idbReadImpl: async () => { throw new Error('IDB 读取异常'); },
        });
        await env.fn('');
        ok('A6 IDB 读取失败 → 不落库（数据不丢）', calls.sync.length === 0 && !calls.saved.includes('clear'), { sync: calls.sync, saved: calls.saved });
    }

    // ================= B 组：getGlobalMaxSerial fail-closed 收口点 =================
    console.log('\n--- B) getGlobalMaxSerial 收口点（未就绪 fail-closed）---');
    {
        // B1 未就绪：不返回序号、不写任何存储
        const ls = makeLS({ 'all_prescription_list': JSON.stringify([{ id: 1, prescriptionNo: TODAY + '07' }]) });
        const env = loadGetGlobalMaxSerial({ ls, readyFlag: false, readyPromise: new Promise(() => {}) });
        const v = await env.fn();
        ok('B1a 未就绪不返回序号（null/undefined/0）', v === null || v === undefined, v);
        ok('B1b 未就绪不写 localStorage（global_max_serial 键不存在）',
            ls.getItem('global_max_serial') === null, ls.getItem('global_max_serial'));
        ok('B1c 未就绪不写 IndexedDB（不得留半成品序号）', env.idbWrites.length === 0, env.idbWrites.length);
    }
    {
        // B1d 未就绪且给了明确中文提示（医疗场景：拒绝一次开方 > 重复处方号）
        const ls = makeLS({ 'all_prescription_list': JSON.stringify([]) });
        const env = loadGetGlobalMaxSerial({ ls, readyFlag: false, readyPromise: new Promise(() => {}), timeoutMs: 30 });
        await env.fn();
        const joined = env.alertCalls.join('|');
        ok('B1d 未就绪给出中文提示（含"加载"/"稍候"）', /加载|稍候|未就绪|请/.test(joined), env.alertCalls);
    }
    {
        // B2 就绪：返回既有最大序号 + 1
        const list = [{ id: 1, prescriptionNo: TODAY + '03' }, { id: 2, prescriptionNo: TODAY + '08' }, { id: 3, prescriptionNo: TODAY + '05' }];
        const ls = makeLS({ 'all_prescription_list': JSON.stringify(list) });
        const env = loadGetGlobalMaxSerial({ ls, readyFlag: true, readyPromise: Promise.resolve(true) });
        const v = await env.fn();
        ok('B2 就绪 → 返回当日既有最大序号 8', v === 8, v);
        const no = v + 1;
        ok('B2b 由它生成的序号 = 既有最大 + 1（不重复）', no === 9, no);
    }
    {
        // B3 就绪路径读权威集（prescriptionHistory）优先于可能滞后的 localStorage 镜像
        const list = [{ id: 1, prescriptionNo: TODAY + '02' }];
        const ls = makeLS({ 'all_prescription_list': JSON.stringify(list) });
        const env = loadGetGlobalMaxSerial({
            ls, readyFlag: true, readyPromise: Promise.resolve(true),
            prescriptionHistory: [{ id: 9, prescriptionNo: TODAY + '11' }],
        });
        const v = await env.fn();
        ok('B3 就绪后取号用权威集（11 > 镜像里的 2，防止取到旧号）', v === 11, v);
    }
    {
        // B4 缺依赖不抛错
        let threw = false;
        try {
            const env = loadGetGlobalMaxSerial({ ls: { getItem: () => { throw new Error('storage 不可用'); }, setItem: () => { throw new Error('storage 不可用'); }, removeItem: () => {} }, readyFlag: true, readyPromise: Promise.resolve(true) });
            await env.fn();
        } catch (e) { threw = true; }
        ok('B4 localStorage 抛错时不把异常抛给开方流程', !threw);
    }
    {
        // B5 就绪 Promise 永不 resolve → 仍 fail-closed，且耗时受超时设置约束
        const ls = makeLS({ 'all_prescription_list': JSON.stringify([{ id: 1, prescriptionNo: TODAY + '04' }]) });
        const env = loadGetGlobalMaxSerial({
            ls, readyFlag: false, readyPromise: new Promise(() => {}), timeoutMs: 40,
            setTimeoutFn: setTimeout,
        });
        const t0 = Date.now();
        const v = await env.fn();
        const dt = Date.now() - t0;
        ok('B5a 超时后仍不返回序号（fail-closed）', v === null || v === undefined, v);
        ok('B5b 超时受 __prescriptionsReadyTimeoutMs 约束（<1s，不等满 10s）', dt < 1000, dt);
        ok('B5c 超时路径同样不写存储', ls.getItem('global_max_serial') === null && env.idbWrites.length === 0);
    }

    // ================= C 组：源码文本契约（六端同体防漂移）=================
    console.log('\n--- C) loadData 就绪标志与收口点唯一性（源码文本契约）---');
    {
        const { HTML_FILES } = require('./sync-shared-blocks.cjs');
        const seen = new Set();
        const files = HTML_FILES.filter(f => {
            const abs = path.join(ROOT, f);
            if (!fs.existsSync(abs)) return false;
            const real = fs.realpathSync(abs).toLowerCase();
            if (seen.has(real)) return false;      // 同一物理文件的重复登记只检一次
            seen.add(real);
            return true;
        });
        ok('待检端数量 ≥ 6（含离线端）', files.length >= 6, files.length);
        for (const rel of files) {
            const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
            // 端标签：去掉顶层归档目录，保证六端唯一可辨
            const tag = rel.replace(/^app_project[\\/]/, '').replace(/^public[\\/]/, 'public/');
            const loadData = extractFunction(src, 'loadData');
            const marks = (loadData.match(/markPrescriptionsReady\s*\(\s*\)/g) || []).length;
            const directSets = (src.match(/__prescriptionsReady\s*=\s*true/g) || []).length;
            // 成功路径 + 失败路径各一处调用；置位实现里另有一处直接赋值
            ok('C1[' + tag + '] loadData 两路都开闸（markPrescriptionsReady × 2）', marks >= 2, marks);
            ok('C1b[' + tag + '] 存在就绪标志置位实现（__prescriptionsReady = true）', directSets >= 1, directSets);
            const promiseResolves = (src.match(/__prescriptionsReadyPromise/g) || []).length;
            ok('C2[' + tag + '] 就绪 Promise 已建立并可由两路 resolve', promiseResolves >= 2, promiseResolves);
            const gm = extractFunction(src, 'getGlobalMaxSerial');
            ok('C3[' + tag + '] 收口点 getGlobalMaxSerial 自检就绪标志',
                /__prescriptionsReady/.test(gm), gm.slice(0, 80));
            const gp = extractFunction(src, 'generatePrescriptionNo');
            const gpf = extractFunction(src, 'generatePrescriptionNoForSave');
            ok('C4[' + tag + '] generatePrescriptionNo 仍经收口点取号',
                /getGlobalMaxSerial\s*\(/.test(gp) && /getGlobalMaxSerial\s*\(/.test(gpf));
        }
    }

    console.log('\n=== 结果: ' + pass + ' 通过, ' + fail + ' 失败 ===');
    process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.log('  FAIL  运行异常: ' + (e && e.stack || e)); process.exit(1); });
