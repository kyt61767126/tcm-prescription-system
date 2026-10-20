// ============================================================================
//  cloud-sync-fake-success-test.cjs — 云端处方"假成功"客户端回归（mock，零网络）
//
//  背景（.trae/specs/cloud-rx-latest-not-visible/spec.md 事实 1 / AC-1）：
//    CloudSync.push() 现行实现只要服务端返回 success:true 就 SyncOutbox.remove(op)，
//    即便服务端已明示"该条只落到了 KV、D1 写入失败"（d1WriteFailed:true）。
//    → 桌面角标显示「☁️ 已同步」，但其它端读不到该处方（读路径为 D1 优先）。
//
//  本测试【按函数本体从 public/index.html 抽取】CloudSync.push 本体（不抄副本），
//  打桩 getCloudToken / currentUser / window / SyncOutbox / cloudFetch，断言目标语义：
//    T1 服务端 success:true + d1WriteFailed:true  → **不得删除 op**、op 重入、记录错误
//    T2 服务端 success:true（正常）               → 删除 op、无错误（零回归）
//    T3 服务端 code:PERMANENTLY_DELETED           → 删除 op（永久删除不可复活，行为不变）
//    T4 服务端 success:false                      → 不删 op、op 重入（既有行为）
//
//  注：T1 在修复前为 **RED**（当前实现会删 op）——红灯即缺陷证据；T3 修复后应转绿。
//  用法: node tools/cloud-sync-fake-success-test.cjs     退出码 0=全过
// ============================================================================
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const HTML = process.argv[2] ? path.resolve(process.argv[2]) : path.join(ROOT, 'public', 'index.html');

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
    if (cond) { console.log('  PASS  ' + name); pass++; }
    else { console.log('  FAIL  ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')); fail++; }
};

// ---- 抽取 CloudSync.push 本体（大括号配平，忽略字符串/注释）----
function extractPush(src) {
    const sig = 'async push(';
    let from = 0, found = -1;
    while (true) {
        const i = src.indexOf(sig, from);
        if (i < 0) break;
        // 用 SyncOutbox.all( 作为该 push 的指纹，避免抽到同名方法
        if (src.slice(i, i + 900).indexOf('SyncOutbox.all(') >= 0) { found = i; break; }
        from = i + sig.length;
    }
    if (found < 0) throw new Error('未找到 CloudSync.push 本体');
    let i = src.indexOf('{', found);
    let depth = 0;
    while (i < src.length) {
        const c = src[i];
        if (c === "'" || c === '"' || c === '`') {
            const q = c; i++;
            while (i < src.length && src[i] !== q) { if (src[i] === '\\') i++; i++; }
            i++; continue;
        }
        if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
        if (c === '/' && src[i + 1] === '*') { i += 2; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; continue; }
        if (c === '{') depth++;
        else if (c === '}') { depth--; if (depth === 0) { i++; break; } }
        i++;
    }
    return src.slice(found, i);
}

const SRC = fs.readFileSync(HTML, 'utf8');
const PUSH_BODY = extractPush(SRC);

// ---- 场景驱动：按 resp 跑一轮 push，回收副作用 ----
async function runCase(resp) {
    const removed = [];
    const added = [];
    const ops = [{ opId: 'op1', type: 'upsert', id: 1700000000000, attempts: 0, payload: { id: 1700000000000, patientName: '测试患者' } }];
    const SyncOutbox = {
        all: async () => ops.slice(),
        remove: async (opId) => { removed.push(opId); },
        add: async (op) => { added.push(Object.assign({}, op)); },
    };
    const ctx = {
        _mergePushedRecord: async () => {},
        state: {},
    };
    const fn = new Function(
        'getCloudToken', 'currentUser', 'window', 'SyncOutbox', 'cloudFetch', 'console',
        '"use strict"; const __m = { ' + PUSH_BODY + ' }; return __m.push.call(this);'
    );
    const quiet = { log: () => {}, warn: () => {}, error: () => {} };
    let threw = null;
    try {
        await fn.call(ctx, () => 'tok', { username: 'u1' }, { CLOUD_API_BASE: 'https://x/api' }, SyncOutbox, async () => resp, quiet);
    } catch (e) { threw = e; }
    return { removed, added, ops, ctx, threw };
}

(async () => {
    console.log('== cloud-sync-fake-success-test（' + path.relative(ROOT, HTML).replace(/\\/g, '/') + '）==');
    if (/d1WriteFailed/.test(PUSH_BODY) === false) {
        console.log('  INFO  push 本体尚未识别 d1WriteFailed（修复前基线）');
    }

    // T1 服务端明示 D1 写入失败 → 不得删除 op
    {
        const r = await runCase({ success: true, d1WriteFailed: true, storedIn: 'kv', savedPrescription: { id: 1700000000000, updatedAt: '2026-10-20T10:00:00.000Z' } });
        ok('T1 D1 写失败(op 不删)', r.removed.length === 0, r.removed);
        ok('T1 D1 写失败(op 重入并计次)', r.added.length === 1 && (r.added[0].attempts || 0) >= 1, r.added);
        ok('T1 D1 写失败(记录错误可提示)', !!(r.ops[0].lastError || (r.ctx.state && r.ctx.state.lastError)), { op: r.ops[0].lastError, state: r.ctx.state });
    }
    // T2 正常成功 → 删除 op（零回归）
    {
        const r = await runCase({ success: true, savedPrescription: { id: 1700000000000, updatedAt: '2026-10-20T10:00:00.000Z' } });
        ok('T2 正常成功(op 删除)', r.removed.length === 1 && r.added.length === 0, { removed: r.removed, added: r.added.length });
    }
    // T3 永久删除墓碑 → 丢弃 op（行为不变）
    {
        const r = await runCase({ success: false, code: 'PERMANENTLY_DELETED' });
        ok('T3 永久删除(op 丢弃)', r.removed.length === 1 && r.added.length === 0, { removed: r.removed, added: r.added.length });
    }
    // T4 显式失败 → 不删 op
    {
        const r = await runCase({ success: false, error: '云端保存失败' });
        ok('T4 显式失败(op 保留)', r.removed.length === 0 && r.added.length === 1, { removed: r.removed, added: r.added.length });
    }

    console.log('\n结果: ' + pass + ' PASS / ' + fail + ' FAIL');
    process.exit(fail === 0 ? 0 : 1);
})();
