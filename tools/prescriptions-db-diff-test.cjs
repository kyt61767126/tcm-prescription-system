// ============================================================================
//  prescriptions-db-diff-test.cjs — P1-③ 处方落库增量 upsert 回归（mock IndexedDB，零网络/零浏览器）
//
//  背景：public/index.html 的 getAllUserPrescriptions 原先是
//        clearPrescriptionsDB() + saveAllPrescriptionsToDB()（清空 + 全量重写，n=2000 时
//        1 次 clear + 2000 次 put）。P1-③ 改为此函数按 id 增量 upsert。
//
//  本测试【按函数本体从 public/index.html 抽取】被测函数（不做副本、不手抄），
//  以保证断言始终对着真实上线代码；用 mock IndexedDB 驱动。
//
//  断言：
//    A) 未变更（updatedAt 相同）→ 不写（kept）；变更 → put；本地无 → put；本地多余 → delete
//    B) updatedAt 任一方缺失 → 视为变更（保守重写），不许"跳过"
//    C) 无 id 的入参记录被忽略
//    D) 最终 store 内容 == 权威集（无多余 id、无缺失 id）—— 医疗数据可见性
//    E) 事务失败 → 必须 reject（上层据此回退 clear + 全量写，最坏=原行为）
//
//  用法: node tools/prescriptions-db-diff-test.cjs     退出码 0=全过
// ============================================================================
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
    if (cond) { console.log('  PASS  ' + name); pass++; }
    else { console.log('  FAIL  ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')); fail++; }
};

// ---- 从 public/index.html 抽取 syncPrescriptionsDBDiff 本体（按大括号配平，忽略字符串内括号）----
function extractFunction(file, name) {
    const src = fs.readFileSync(file, 'utf8');
    const sig = 'function ' + name + '(';
    const start = src.indexOf(sig);
    if (start < 0) throw new Error('未找到函数: ' + name);
    // 回退到 async 前缀（若有）
    let head = start;
    const asyncPrefix = 'async ';
    if (src.slice(start - asyncPrefix.length, start) === asyncPrefix) head = start - asyncPrefix.length;
    const braceStart = src.indexOf('{', start);
    let depth = 0, i = braceStart, inS = false, inD = false, esc = false;
    for (; i < src.length; i++) {
        const c = src[i];
        if (esc) { esc = false; continue; }
        if (c === '\\') { esc = true; continue; }
        if (inS) { if (c === "'") inS = false; continue; }
        if (inD) { if (c === '"') inD = false; continue; }
        if (c === "'") { inS = true; continue; }
        if (c === '"') { inD = true; continue; }
        if (c === '{') depth++;
        else if (c === '}') { depth--; if (depth === 0) { i++; break; } }
    }
    return src.slice(head, i);
}

// ---- mock IndexedDB（只实现被测函数用到的最小面）----
function makeMockDB(initial, opts) {
    opts = opts || {};
    const store = new Map();
    (initial || []).forEach(r => store.set(String(r.id), r));
    let threwOnTx = false;
    const db = {
        transaction() {
            if (opts.throwOnTx && !threwOnTx) { threwOnTx = true; throw new Error('mock tx 创建失败'); }
            const tx = { oncomplete: null, onerror: null, onabort: null };
            const os = {
                getAll() {
                    const req = {};
                    setTimeout(() => {
                        try { req.result = Array.from(store.values()); } catch (e) { req.error = e; req.onerror && req.onerror(); return; }
                        req.onsuccess && req.onsuccess();
                        setTimeout(() => { tx.oncomplete && tx.oncomplete(); }, 0);
                    }, 0);
                    return req;
                },
                put(r) { if (opts.failOnPut) throw new Error('mock put 失败'); store.set(String(r.id), r); },
                delete(k) { store.delete(String(k)); }
            };
            tx.objectStore = () => os;
            return tx;
        }
    };
    return { db, store };
}

function loadFn(mockDbFactory) {
    const file = path.join(__dirname, '..', 'public', 'index.html');
    const fnSrc = extractFunction(file, 'syncPrescriptionsDBDiff');
    const win = {};
    const openDB = async () => mockDbFactory().db;
    const fn = new Function('openDB', 'window', 'return (' + fnSrc + ');')(openDB, win);
    return { fn, win, fnSrc };
}

const P = (id, up, extra) => Object.assign({ id: id, updatedAt: up, patientName: '张三' }, extra || {});

(async () => {
    console.log('=== 抽取自 public/index.html 的函数签名 ===');
    {
        const { fnSrc } = loadFn(() => makeMockDB([]));
        console.log('  ' + fnSrc.split('\n')[0].trim() + '  …共 ' + fnSrc.split('\n').length + ' 行');
        ok('函数本体抽取成功（非空且含 getAll/put/delete）',
            /getAll/.test(fnSrc) && /\.put\(/.test(fnSrc) && /\.delete\(/.test(fnSrc));
    }

    console.log('\n--- A) 增量语义：未变不写 / 变更写 / 新增写 / 多余删 ---');
    {
        let mock;
        const { fn, win } = loadFn(() => mock = makeMockDB([
            P(1, 100), P(2, 200), P(3, 300)          // 本地：1 未变、2 变更、3 云端已删
        ]));
        const stat = await fn([P(1, 100), P(2, 999), P(4, 400)]);
        ok('stat.put == 2（id2 变更 + id4 新增）', stat.put === 2, stat);
        ok('stat.del == 1（id3 本地多余）', stat.del === 1, stat);
        ok('stat.kept == 1（id1 未变，省下的写）', stat.kept === 1, stat);
        ok('最终 store 无多余 id3（删除收敛）', !mock.store.has('3'), [...mock.store.keys()]);
        ok('最终 store 含 id2 的新值(999)', mock.store.get('2').updatedAt === 999, mock.store.get('2'));
        ok('最终 store 含新增 id4', mock.store.has('4'));
        ok('统计写入 window.__lastPrescriptionSyncStat', win.__lastPrescriptionSyncStat && win.__lastPrescriptionSyncStat.put === 2, win.__lastPrescriptionSyncStat);
    }

    console.log('\n--- B) updatedAt 缺失 → 保守重写（不许跳过）---');
    {
        let mock;
        const { fn } = loadFn(() => mock = makeMockDB([{ id: 7, patientName: '李四' }]));   // 本地无 updatedAt
        const stat = await fn([P(7, 500)]);
        ok('本地缺 updatedAt → put（视为变更）', stat.put === 1 && stat.kept === 0, stat);
        const mock2ref = makeMockDB([P(8, 500)]);
        const { fn: fn2 } = loadFn(() => mock2ref);
        const stat2 = await fn2([{ id: 8, patientName: '王五' }]);                          // 入参缺 updatedAt
        ok('入参缺 updatedAt → put（保守）', stat2.put === 1 && stat2.kept === 0, stat2);
    }

    console.log('\n--- C) 无 id 的入参被忽略 ---');
    {
        let mock;
        const { fn } = loadFn(() => mock = makeMockDB([]));
        const stat = await fn([{ patientName: '无id' }, P(9, 900)]);
        ok('stat.total 只计有 id 的记录', stat.total === 1, stat);
        ok('store 只写入 1 条', mock.store.size === 1, [...mock.store.keys()]);
    }

    console.log('\n--- D) 权威集一致性（医疗数据可见性）---');
    {
        let mock;
        const incoming = [P(11, 1), P(12, 2), P(13, 3)];
        const { fn } = loadFn(() => mock = makeMockDB([P(11, 1), P(12, 2), P(13, 3), P(14, 4), P(15, 5)]));
        await fn(incoming);
        const got = [...mock.store.keys()].sort();
        const want = incoming.map(r => String(r.id)).sort();
        ok('store 条数 == 权威集条数', mock.store.size === incoming.length, { got: mock.store.size, want: incoming.length });
        ok('无多余 id（14/15 已删）', !mock.store.has('14') && !mock.store.has('15'), got);
        ok('无缺失 id', want.every(k => mock.store.has(k)), got);
    }

    console.log('\n--- E) 失败必须 reject（上层据此回退清空+全量写）---');
    {
        let mock;
        const { fn } = loadFn(() => mock = makeMockDB([], { throwOnTx: true }));
        let rejected = false;
        try { await fn([P(1, 1)]); } catch (e) { rejected = true; }
        ok('事务创建失败 → reject（触发回退路径）', rejected === true);
    }

    console.log('\n=== 结果: ' + pass + ' 通过, ' + fail + ' 失败 ===');
    process.exit(fail === 0 ? 0 : 1);
})();
