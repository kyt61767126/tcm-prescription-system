#!/usr/bin/env node
// ============================================================================
//  check-quiz-data.cjs — 多题库数据/注册表校验（发版前必跑）
//
//  检查项：
//    1. manifest 结构完整、id 合法且唯一、file 为纯 ASCII 相对路径
//    2. 数据文件存在、SHA-256 与 manifest 一致
//    3. bankId / global / count 与数据文件一致
//    4. 题目结构：4 选项、ansIndex 0-3、explain 非空、opts 无字母前缀
//    5. 题目 id 全局唯一且前缀 = bankId；no 从 1 连续、part 与 no 匹配
//    6. 题干去重：跨库重复 = FAIL；库内重复标记同 group = INFO（知识组），未标记 = WARN
//    7. 答案分布告警：任一选项占比 <5% 或 >40%
//    8. 解析残留选项字母引用：严格命中 = FAIL；宽松命中 = WARN
//    9. version 单调递增（基线 = tools/quiz-version-baseline.json；缺失时回退 git HEAD；
//       首次入库跳过，已入库后回退或数据变更未 bump 一律 FAIL）
//
//  用法：
//    node tools/check-quiz-data.cjs
//    node tools/check-quiz-data.cjs --json
//    node tools/check-quiz-data.cjs --update-baseline   # 校验通过后刷新版本基线（发版 bump 后执行）
// ============================================================================
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const vm = require('vm');
const childProcess = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const QUIZ_DIR = path.join(ROOT, 'public', 'quiz');
const MANIFEST_PATH = path.join(QUIZ_DIR, 'manifest.js');
// 版本基线快照：与 git HEAD 解耦（manifest 首次入库/工作区未提交时也能校验回退）
const BASELINE_PATH = path.join(ROOT, 'tools', 'quiz-version-baseline.json');
const LETTERS = ['A', 'B', 'C', 'D'];
const STRICT_LETTER_RE = /选\s*[A-D]|答案\s*[A-D]|[A-D]\s*项|选项\s*[A-D]|[（(]\s*[A-D]\s*[)）]/g;
const LOOSE_LETTER_RE = /(?<![A-Za-z])[A-D](?![A-Za-z])/g;

const useJson = process.argv.indexOf('--json') >= 0;
const updateBaseline = process.argv.indexOf('--update-baseline') >= 0;
const fails = [];
const warns = [];
const infos = [];

function fail(msg) { fails.push(msg); }
function warn(msg) { warns.push(msg); }
function info(msg) { infos.push(msg); }

function loadWindowJs(file) {
    const code = fs.readFileSync(file, 'utf8');
    const sandbox = { window: {} };
    vm.createContext(sandbox);
    vm.runInContext(code, sandbox, { filename: file, timeout: 5000 });
    return sandbox.window;
}

function sha256File(file) {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function stripQuery(p) { return String(p || '').split('?')[0]; }

function versionCompare(a, b) {
    const pa = String(a || '0').split('.').map((x) => parseInt(x, 10) || 0);
    const pb = String(b || '0').split('.').map((x) => parseInt(x, 10) || 0);
    const n = Math.max(pa.length, pb.length);
    for (let i = 0; i < n; i++) {
        const x = pa[i] || 0;
        const y = pb[i] || 0;
        if (x !== y) return x > y ? 1 : -1;
    }
    return 0;
}

function readBaseline() {
    try {
        const j = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
        if (j && j.banks && typeof j.banks === 'object') return { banks: j.banks, updatedAt: j.updatedAt || '' };
    } catch (e) { /* 基线缺失/损坏 → 回退 git HEAD */ }
    return null;
}

function readPrevManifest() {
    try {
        const rel = path.relative(ROOT, MANIFEST_PATH).replace(/\\/g, '/');
        const code = childProcess.execSync(`git show HEAD:${rel}`, {
            cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']
        });
        const sandbox = { window: {} };
        vm.createContext(sandbox);
        vm.runInContext(code, sandbox, { filename: 'HEAD:' + rel, timeout: 5000 });
        return sandbox.window.QUIZ_MANIFEST || null;
    } catch (e) {
        return null;
    }
}

// ----------------------------------------------------------------------------
// 主流程
// ----------------------------------------------------------------------------
if (!fs.existsSync(MANIFEST_PATH)) {
    console.error(`[FAIL] manifest 不存在: ${MANIFEST_PATH}`);
    process.exit(1);
}

const win = loadWindowJs(MANIFEST_PATH);
const manifest = win.QUIZ_MANIFEST;
if (!Array.isArray(manifest) || !manifest.length) {
    console.error('[FAIL] window.QUIZ_MANIFEST 为空或不是数组');
    process.exit(1);
}

const idSet = new Set();
const stemOwners = new Map(); // 归一化题干 -> [bankId:no]
const globalBankIdSet = new Set();
const report = [];

manifest.forEach((meta, idx) => {
    const label = meta && meta.id ? meta.id : `#${idx}`;
    if (!meta || typeof meta !== 'object') { fail(`${label}: 登记项不是对象`); return; }

    if (!/^[a-z0-9][a-z0-9-]*$/.test(String(meta.id || ''))) fail(`${label}: id 必须为小写 ASCII（letters/digits/hyphen）`);
    if (idSet.has(meta.id)) fail(`${label}: id 重复`);
    idSet.add(meta.id);

    if (!meta.name) fail(`${label}: 缺少 name`);
    if (!meta.global || !/^[A-Z_][A-Z0-9_]*$/.test(meta.global)) fail(`${label}: global 非法`);
    if (typeof meta.count !== 'number' || meta.count <= 0) fail(`${label}: count 非法`);
    if (!meta.version) fail(`${label}: 缺少 version`);
    if (!meta.file) { fail(`${label}: 缺少 file`); return; }

    const cleanFile = stripQuery(meta.file);
    if (!/^data\/[A-Za-z0-9_.-]+\.js$/.test(cleanFile)) fail(`${label}: file 必须是 data/<ASCII>.js（实际 ${meta.file}）`);
    if (cleanFile.indexOf('..') >= 0) fail(`${label}: file 不得包含 ..`);
    // _headers 对 /quiz/data/* 采用 immutable 长缓存，URL 是唯一失效手段：
    // 必须带 ?v=<version>，且与 manifest version 对齐，否则改数据不发新版本会被旧缓存挡住。
    const qv = /\?v=([^&]+)/.exec(String(meta.file));
    if (!qv) fail(`${label}: file 必须带 ?v=<version>（immutable 缓存失效依赖 URL 变化）`);
    else if (qv[1] !== String(meta.version)) fail(`${label}: file 的 ?v=${qv[1]} 与 version=${meta.version} 不一致`);

    const absFile = path.join(QUIZ_DIR, cleanFile);
    if (!fs.existsSync(absFile)) { fail(`${label}: 数据文件不存在 ${cleanFile}`); return; }

    const hash = sha256File(absFile);
    if (meta.sha256 && hash !== meta.sha256) {
        fail(`${label}: SHA-256 不匹配（manifest=${String(meta.sha256).slice(0, 12)}… 实际=${hash.slice(0, 12)}…）`);
    } else if (!meta.sha256) {
        warn(`${label}: manifest 未登记 sha256`);
    }

    let bankWin;
    try {
        bankWin = loadWindowJs(absFile);
    } catch (e) {
        fail(`${label}: 数据文件执行失败 ${e.message}`);
        return;
    }
    const bank = bankWin[meta.global];
    if (!bank) { fail(`${label}: 数据文件未挂载 window.${meta.global}`); return; }
    if (bank.bankId !== meta.id) fail(`${label}: bankId 不匹配（数据=${bank.bankId}）`);
    if (globalBankIdSet.has(bank.bankId)) fail(`${label}: bankId 重复`);
    globalBankIdSet.add(bank.bankId);
    if (!Array.isArray(bank.questions)) { fail(`${label}: questions 不是数组`); return; }
    if (bank.questions.length !== meta.count) fail(`${label}: 题数不一致（数据=${bank.questions.length}, manifest=${meta.count}）`);

    const dist = [0, 0, 0, 0];
    const localStems = new Map(); // 归一化题干 -> [question]
    let strictExplain = 0;
    let looseExplain = 0;
    const partSize = typeof bank.partSize === 'number' && bank.partSize > 0 ? bank.partSize : 400;

    bank.questions.forEach((q, i) => {
        const tag = `${meta.id}:${i + 1}`;
        if (!q || typeof q !== 'object') { fail(`${tag}: 题目不是对象`); return; }
        if (typeof q.id !== 'string' || q.id.indexOf(meta.id + ':') !== 0) fail(`${tag}: id 前缀错误（${q.id}）`);
        if (!q.id || q.id.length < meta.id.length + 2) fail(`${tag}: id 非法`);
        if (typeof q.no !== 'number' || q.no !== i + 1) fail(`${tag}: no 应为 ${i + 1}（实际 ${q.no}）`);
        if (typeof q.part !== 'number' || q.part !== Math.floor(i / partSize) + 1) fail(`${tag}: part 应为 ${Math.floor(i / partSize) + 1}（实际 ${q.part}）`);
        if (!Array.isArray(q.opts) || q.opts.length !== 4) fail(`${tag}: 选项数不是 4`);
        if (typeof q.ansIndex !== 'number' || q.ansIndex < 0 || q.ansIndex > 3 || q.ansIndex % 1 !== 0) fail(`${tag}: ansIndex 非法（${q.ansIndex}）`);
        if (!q.q || typeof q.q !== 'string') fail(`${tag}: 题干为空`);
        if (!q.explain || typeof q.explain !== 'string') fail(`${tag}: explain 为空`);
        if (Array.isArray(q.opts)) {
            q.opts.forEach((o, k) => {
                if (!o || typeof o !== 'string') fail(`${tag}: 选项 ${k + 1} 为空`);
                else if (/^\s*[A-DＡ-Ｄ][\s.．、:：]/.test(o)) fail(`${tag}: 选项 ${k + 1} 残留字母前缀（${o.slice(0, 8)}…）`);
            });
        }

        if (typeof q.ansIndex === 'number' && q.ansIndex >= 0 && q.ansIndex < 4) dist[q.ansIndex]++;

        const normStem = String(q.q || '').replace(/\s+/g, '');
        if (normStem) {
            if (!localStems.has(normStem)) localStems.set(normStem, []);
            localStems.get(normStem).push(q);
            if (!stemOwners.has(normStem)) stemOwners.set(normStem, []);
            stemOwners.get(normStem).push(q.id);
        }

        if (typeof q.explain === 'string') {
            STRICT_LETTER_RE.lastIndex = 0;
            if (STRICT_LETTER_RE.test(q.explain)) strictExplain++;
            STRICT_LETTER_RE.lastIndex = 0;
            LOOSE_LETTER_RE.lastIndex = 0;
            if (LOOSE_LETTER_RE.test(q.explain)) looseExplain++;
            LOOSE_LETTER_RE.lastIndex = 0;
        }
    });

    if (bank.schema !== 1) warn(`${label}: schema 不是 1（实际 ${bank.schema}）`);

    // 库内重复题干：已标记同一 group 的视为「知识组」（浏览全部可见、试卷同组只抽一条）；
    // 未标记的仍需人工处理，保留告警。
    let duplicateInside = 0;
    let groupedInside = 0;
    let ungroupedInside = 0;
    localStems.forEach((list) => {
        if (list.length < 2) return;
        duplicateInside += list.length - 1;
        const g = list[0].group;
        const sameGroup = !!g && list.every((q) => q.group === g);
        if (sameGroup) groupedInside += list.length - 1;
        else ungroupedInside += list.length - 1;
    });
    if (ungroupedInside > 0) warn(`${label}: 库内重复题干 ${ungroupedInside} 条未标记知识组（建议加 group 字段）`);
    if (groupedInside > 0) info(`${label}: 库内重复题干 ${groupedInside} 条已归入知识组（浏览全部可见，试卷同组只抽一条）`);

    const total = bank.questions.length || 1;
    const ratios = dist.map((n) => n / total);
    const distNames = LETTERS.map((l, i) => `${l}=${dist[i]}(${(ratios[i] * 100).toFixed(2)}%)`).join(' ');
    if (ratios.some((r) => r < 0.05 || r > 0.4)) {
        warn(`${label}: 答案分布超出阈值（<5% 或 >40%）→ ${distNames}`);
    }
    if (strictExplain > 0) fail(`${label}: ${strictExplain} 条解析残留选项字母引用（选X/答案X/X项/选项X）`);
    if (looseExplain > 0) warn(`${label}: ${looseExplain} 条解析出现独立拉丁字母（需人工确认是否指代选项）`);

    report.push({
        id: meta.id,
        name: meta.name,
        version: meta.version,
        count: bank.questions.length,
        distribution: { A: dist[0], B: dist[1], C: dist[2], D: dist[3] },
        ratio: { A: +(ratios[0] * 100).toFixed(2), B: +(ratios[1] * 100).toFixed(2), C: +(ratios[2] * 100).toFixed(2), D: +(ratios[3] * 100).toFixed(2) },
        duplicateInside,
        groupedInside,
        ungroupedInside,
        strictExplain,
        looseExplain,
        sha256: hash
    });
});

// 跨库题干去重
stemOwners.forEach((owners, stem) => {
    if (owners.length > 1) {
        const banks = [...new Set(owners.map((x) => String(x).split(':')[0]))];
        if (banks.length > 1) {
            fail(`跨库重复题干：${owners.join(', ')}（${stem.slice(0, 20)}…）`);
        }
    }
});

// 版本单调递增：基线快照优先（tools/quiz-version-baseline.json），缺失时回退 git HEAD。
// 「首次入库」= 基线里没有该题库 → 只提示不阻断；已有基线后：
//   · 当前 version < 基线 version → FAIL（回退）
//   · version 相同但 sha256 变化 → FAIL（数据已改却未 bump）
//   · version > 基线 → PASS，bump 后执行 --update-baseline 刷新快照
const baseline = readBaseline();
let baselineSource = '';
if (baseline) {
    baselineSource = 'tools/quiz-version-baseline.json';
    manifest.forEach((m) => {
        const p = baseline.banks[m.id];
        if (!p) { info(`${m.id}: 新增题库（首次入库，无版本基线）`); return; }
        const cmp = versionCompare(m.version, p.version);
        if (cmp < 0) fail(`${m.id}: version 回退（基线 ${p.version} → 当前 ${m.version}）`);
        if (cmp === 0 && m.sha256 && p.sha256 && m.sha256 !== p.sha256) fail(`${m.id}: version 未递增但数据内容已变化（${m.version}）`);
        if (cmp > 0) info(`${m.id}: version 已递增（${p.version} → ${m.version}）`);
    });
} else {
    const prev = readPrevManifest();
    if (prev) {
        baselineSource = 'git HEAD manifest';
        const prevById = new Map(prev.map((m) => [m.id, m]));
        manifest.forEach((m) => {
            const p = prevById.get(m.id);
            if (!p) { info(`${m.id}: 新增题库（首次入库，无版本基线）`); return; }
            const cmp = versionCompare(m.version, p.version);
            if (cmp < 0) fail(`${m.id}: version 回退（${p.version} → ${m.version}）`);
            if (cmp === 0 && m.sha256 && p.sha256 && m.sha256 !== p.sha256) fail(`${m.id}: version 未递增但数据内容已变化（${m.version}）`);
        });
    } else {
        info('无版本基线（首次入库）：未找到 tools/quiz-version-baseline.json 或 git HEAD manifest，跳过版本单调检查');
    }
}

// ----------------------------------------------------------------------------
// 输出
// ----------------------------------------------------------------------------
if (useJson) {
    console.log(JSON.stringify({ pass: fails.length === 0, baselineSource, banks: report, fails, warns, infos }, null, 2));
} else {
    console.log('===== 题库校验 =====');
    console.log('题库 | 版本 | 题数 | A | B | C | D | 库内重复(已分组) | 严格字母 | 宽松字母');
    report.forEach((r) => {
        console.log(`${r.id} | ${r.version} | ${r.count} | ${r.distribution.A} | ${r.distribution.B} | ${r.distribution.C} | ${r.distribution.D} | ${r.duplicateInside}(${r.groupedInside}) | ${r.strictExplain} | ${r.looseExplain}`);
    });
    console.log('');
    report.forEach((r) => {
        console.log(`${r.id} 分布占比: A=${r.ratio.A}% B=${r.ratio.B}% C=${r.ratio.C}% D=${r.ratio.D}%`);
    });
    infos.forEach((m) => console.log('[INFO] ' + m));
    warns.forEach((m) => console.log('[WARN] ' + m));
    fails.forEach((m) => console.log('[FAIL] ' + m));
    console.log('');
    console.log(fails.length === 0 ? `RESULT: PASS（${warns.length} 条告警，${infos.length} 条提示）` : `RESULT: FAIL（${fails.length} 条错误）`);
}

// --update-baseline：仅在全部校验通过后刷新快照（发版 bump 后执行）
if (updateBaseline) {
    if (fails.length) {
        console.log('[FAIL] 存在校验错误，拒绝更新版本基线');
    } else {
        const banks = {};
        report.forEach((r) => { banks[r.id] = { version: r.version, sha256: r.sha256 }; });
        fs.writeFileSync(BASELINE_PATH, JSON.stringify({ updatedAt: new Date().toISOString(), banks }, null, 2) + '\n', 'utf8');
        console.log('[INFO] 已更新版本基线: tools/quiz-version-baseline.json');
    }
}

process.exit(fails.length === 0 ? 0 : 1);
