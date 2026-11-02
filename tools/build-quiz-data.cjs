#!/usr/bin/env node
// ============================================================================
//  build-quiz-data.cjs — 题库源 HTML → 规范题库数据文件生成器
//
//  用途：
//    从单文件题库 HTML（形如 `const list = [{q,opts,ans,explain}, ...]`）抽取题目，
//    生成符合项目多题库规范的 `window.QUIZ_BANK_<ID> = {...}` 数据文件。
//
//  规范（与 public/quiz/manifest.js 配合）：
//    · 题目 id = `<bankId>:<4位序号>`，全局唯一，永不复用
//    · ansIndex 用 0-3 数字（不存字母）
//    · opts 不带「A.」前缀，字母由渲染层生成
//    · 答案分布按选项重排均衡（正确项位置由种子随机 + 每档等量分配）
//    · 解析中提及选项字母的表述按安全规则改写，无法判断的打印挂起清单
//
//  用法：
//    node tools/build-quiz-data.cjs --source="D:/桌面/伤寒求真_全册1‑1200.html" \
//         --bank-id=sb-1200 --name=伤寒求真 --category=伤寒 \
//         --out=public/quiz/data/sb-1200.js
//
//  只读源文件；输出仅写 --out 指定路径。
// ============================================================================
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function parseArgs(argv) {
    const out = {};
    for (let i = 2; i < argv.length; i++) {
        const a = argv[i];
        if (!a.startsWith('--')) continue;
        const kv = a.slice(2);
        const eq = kv.indexOf('=');
        if (eq < 0) out[kv] = true;
        else out[kv.slice(0, eq)] = kv.slice(eq + 1);
    }
    return out;
}

const args = parseArgs(process.argv);
const source = args.source;
const bankId = args['bank-id'];
const bankName = args.name || bankId;
const category = args.category || '未分类';
const outFile = args.out;
const seed = parseInt(args.seed || '20261102', 10);
const partSize = parseInt(args['part-size'] || '400', 10);

if (!source || !bankId || !outFile) {
    console.error('用法: node tools/build-quiz-data.cjs --source=<html> --bank-id=<id> --out=<file> [--name=] [--category=] [--seed=] [--part-size=]');
    process.exit(2);
}
if (!/^[a-z0-9][a-z0-9-]*$/.test(bankId)) {
    console.error(`[ERROR] bank-id 必须是纯小写 ASCII（letters/digits/hyphen），实际: ${bankId}`);
    process.exit(2);
}

// ----------------------------------------------------------------------------
// 1. 抽取源数据（只认 `const list = [` ... `\n];` 结构）
// ----------------------------------------------------------------------------
const html = fs.readFileSync(source, 'utf8');
const startMark = 'const list = [';
const start = html.indexOf(startMark);
if (start < 0) {
    console.error('[ERROR] 源文件中未找到 `const list = [`');
    process.exit(2);
}
const end = html.indexOf('\n];', start);
if (end < 0) {
    console.error('[ERROR] 源文件中未找到数组结尾 `\\n];`');
    process.exit(2);
}
// slice 保留了开头的 `[`，需补末尾 `]`
let body = html.slice(start + 'const list = '.length, end) + ']';
let raw;
try {
    raw = JSON.parse(body);
} catch (e) {
    console.error('[ERROR] 源数据不是合法 JSON 数组: ' + e.message);
    process.exit(2);
}
console.log(`[抽题] ${path.basename(source)} → ${raw.length} 条`);

// ----------------------------------------------------------------------------
// 2. 归一化单题（剥离前缀、题号、校验结构）
// ----------------------------------------------------------------------------
const LETTERS = ['A', 'B', 'C', 'D'];
const PREFIX_RE = /^\s*[A-DＡ-Ｄ][\s.．、:：]\s*/;
const NUM_PREFIX_RE = /^\s*\d+\s*[.．、]\s*/;

function normalizeQuestion(item, index) {
    const no = index + 1;
    if (!item || typeof item.q !== 'string' || !Array.isArray(item.opts)) {
        throw new Error(`第 ${no} 题结构非法`);
    }
    if (item.opts.length !== 4) throw new Error(`第 ${no} 题选项数=${item.opts.length}，应为 4`);
    const ansLetter = String(item.ans || '').trim().toUpperCase();
    const ansIndex = LETTERS.indexOf(ansLetter);
    if (ansIndex < 0) throw new Error(`第 ${no} 题 ans 非法: ${item.ans}`);

    const opts = item.opts.map((o) => String(o).replace(PREFIX_RE, '').trim());
    if (opts.some((o) => !o)) throw new Error(`第 ${no} 题存在空选项`);

    const answerText = opts[ansIndex];
    let explain = String(item.explain || '').trim();
    if (!explain) throw new Error(`第 ${no} 题解析为空`);

    const q = String(item.q).replace(NUM_PREFIX_RE, '').trim();
    if (!q) throw new Error(`第 ${no} 题题干为空`);

    return { no, q, opts, ansIndex, answerText, explain };
}

const normalized = raw.map(normalizeQuestion);

// ----------------------------------------------------------------------------
// 3. 解析文本中的选项字母引用：安全改写 or 挂起
// ----------------------------------------------------------------------------
// 严格命中 = 明确指向选项字母（选X / 答案X / X项 / 选项X / (X)）
const STRICT_LETTER_RE = /选\s*[A-D]|答案\s*[A-D]|[A-D]\s*项|选项\s*[A-D]|[（(]\s*[A-D]\s*[)）]/g;
// 宽松命中 = 正文里出现独立拉丁字母（可能指代选项，也可能不是，仅告警）
const LOOSE_LETTER_RE = /(?<![A-Za-z])[A-D](?![A-Za-z])/g;

const pendingExplain = [];
let explainRewritten = 0;

for (const item of normalized) {
    const hasStrict = STRICT_LETTER_RE.test(item.explain);
    STRICT_LETTER_RE.lastIndex = 0;
    const looseMatches = item.explain.match(LOOSE_LETTER_RE) || [];
    LOOSE_LETTER_RE.lastIndex = 0;
    if (!hasStrict && looseMatches.length === 0) continue;

    // 安全改写规则（唯一允许的猜法）：整段中所有独立字母都等于原正确答案字母，
    // 且数量为 1，且位于开头/紧邻「是/为」——此时可无歧义替换为「正确项（原文）」。
    const allPointToAnswer = looseMatches.every((m) => m === LETTERS[item.ansIndex]);
    if (allPointToAnswer && looseMatches.length === 1 && !hasStrict) {
        item.explain = item.explain.replace(
            /^([A-D])/,
            `正确项（${item.answerText}）`
        );
        if (item.explain.indexOf(`正确项（${item.answerText}）`) === 0) {
            explainRewritten++;
            continue;
        }
    }

    // 其余一律挂起，不猜
    pendingExplain.push({
        no: item.no,
        ans: LETTERS[item.ansIndex],
        matched: hasStrict ? (item.explain.match(STRICT_LETTER_RE) || []) : looseMatches,
        explain: item.explain
    });
    STRICT_LETTER_RE.lastIndex = 0;
}

// ----------------------------------------------------------------------------
// 4. 选项重排：正确项位置均衡（每档等量）+ 种子随机，其余选项保持相对顺序
// ----------------------------------------------------------------------------
function mulberry32(a) {
    return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
const rand = mulberry32(seed);
const total = normalized.length;
const slots = [];
for (let i = 0; i < 4; i++) {
    const quota = Math.floor(total / 4) + (i < total % 4 ? 1 : 0);
    for (let k = 0; k < quota; k++) slots.push(i);
}
// Fisher-Yates 打乱
for (let i = slots.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [slots[i], slots[j]] = [slots[j], slots[i]];
}

const globalName = 'QUIZ_BANK_' + bankId.toUpperCase().replace(/[^A-Z0-9]/g, '_');

const questions = normalized.map((item, idx) => {
    const target = slots[idx];
    const others = item.opts.filter((_, k) => k !== item.ansIndex);
    const opts = [];
    let p = 0;
    for (let pos = 0; pos < 4; pos++) {
        opts.push(pos === target ? item.answerText : others[p++]);
    }
    // 严格自证：重排后答案文本必须与重排前完全一致
    if (opts[target] !== item.answerText) throw new Error(`第 ${item.no} 题重排后答案丢失`);

    return {
        id: `${bankId}:${String(item.no).padStart(4, '0')}`,
        no: item.no,
        part: Math.floor((item.no - 1) / partSize) + 1,
        q: item.q,
        opts,
        ansIndex: target,
        explain: item.explain,
        tags: []
    };
});

// ----------------------------------------------------------------------------
// 5. 知识组：重复题干标记同一 group（题号保留、不去重；试卷抽题同组只抽一条）
// ----------------------------------------------------------------------------
const stemMap = new Map();
for (const q of questions) {
    const norm = q.q.replace(/\s+/g, '');
    if (!stemMap.has(norm)) stemMap.set(norm, []);
    stemMap.get(norm).push(q);
}
let groupSeq = 0;
const dupGroups = [];
stemMap.forEach((list) => {
    if (list.length < 2) return;
    const gid = 'g' + String(++groupSeq).padStart(2, '0');
    list.forEach((q) => { q.group = gid; });
    dupGroups.push({ group: gid, ids: list.map((q) => q.id), q: list[0].q });
});

// 自检（题目唯一性）
const idSet = new Set();
for (const q of questions) {
    if (idSet.has(q.id)) throw new Error(`重复 id: ${q.id}`);
    idSet.add(q.id);
}
const dupOccurrences = dupGroups.reduce((n, g) => n + g.ids.length - 1, 0);
if (dupOccurrences) {
    console.warn(`[WARN] 库内重复题干 ${dupOccurrences} 条（${dupGroups.length} 个知识组，题号保留不去重）`);
}

const dist = [0, 0, 0, 0];
questions.forEach((q) => { dist[q.ansIndex]++; });

// ----------------------------------------------------------------------------
// 6. 写盘（一行一题，便于 diff/审阅）
// ----------------------------------------------------------------------------
const header = [
    '// ============================================================================',
    `//  ${bankId}.js — ${bankName}（自动生成，请勿手工编辑）`,
    `//  来源: ${path.basename(source)}`,
    `//  生成: node tools/build-quiz-data.cjs（seed=${seed}）`,
    '//  格式: window.QUIZ_BANK_<ID> = { schema, bankId, name, category, version, questions[] }',
    '//  约定: opts 不带字母前缀；ansIndex 为 0-3；id = <bankId>:<4位序号>',
    '// ============================================================================',
    ''
].join('\n');

const dataObj = {
    schema: 1,
    bankId,
    name: bankName,
    category,
    version: args.version || '1.0.0',
    updatedAt: new Date().toISOString().slice(0, 10),
    partSize,
    questions
};

const json = JSON.stringify(dataObj, null, 0);
// 把 questions 拆成一行一题，便于 diff/审阅
const pretty = json.replace(/\{"id":/g, '\n{"id":');
const text = header + `window.${globalName} = ` + pretty + ';\n';

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, text, 'utf8');

const sha256 = crypto.createHash('sha256').update(fs.readFileSync(outFile)).digest('hex');
const bytes = fs.statSync(outFile).size;

// ----------------------------------------------------------------------------
// 7. 输出报告
// ----------------------------------------------------------------------------
console.log('');
console.log('===== 生成结果 =====');
console.log(`bankId      : ${bankId}`);
console.log(`题目数      : ${questions.length}`);
console.log(`分册        : ${questions[questions.length - 1].part} 册（每册 ${partSize} 题）`);
console.log(`答案分布    : A=${dist[0]} B=${dist[1]} C=${dist[2]} D=${dist[3]}`);
console.log(`答案占比    : A=${(dist[0] / total * 100).toFixed(2)}% B=${(dist[1] / total * 100).toFixed(2)}% C=${(dist[2] / total * 100).toFixed(2)}% D=${(dist[3] / total * 100).toFixed(2)}%`);
console.log(`解析改写    : ${explainRewritten} 条`);
console.log(`解析挂起    : ${pendingExplain.length} 条`);
console.log(`知识组      : ${dupGroups.length} 组 / ${dupOccurrences} 条重复（题号保留，试卷同组只抽一条）`);
console.log(`输出文件    : ${path.relative(process.cwd(), outFile)} (${(bytes / 1024).toFixed(1)} KB)`);
console.log(`SHA256      : ${sha256}`);
console.log('');
console.log('manifest 登记项（复制到 public/quiz/manifest.js）：');
console.log(JSON.stringify({
    id: bankId,
    name: bankName,
    category,
    count: questions.length,
    file: `data/${bankId}.js?v=${dataObj.version}`,
    global: globalName,
    version: dataObj.version,
    sha256,
    enabled: true,
    order: 1
}, null, 4));

if (pendingExplain.length) {
    console.log('');
    console.log('===== 解析挂起清单（需人工确认，勿猜） =====');
    pendingExplain.forEach((p) => {
        console.log(`- 第 ${p.no} 题（原答案 ${p.ans}，命中 ${p.matched.join('/')}）：${p.explain}`);
    });
}
