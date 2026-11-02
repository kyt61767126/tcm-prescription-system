#!/usr/bin/env node
// ============================================================================
//  build-quiz-from-text.cjs — 文本 → 题库生成器（与 build-quiz-data.cjs 并列）
//
//  用途：
//    把一份「篇 / 节」结构的纯文本（GBK 或 UTF-8）与一份人工策展的蓝图 JSON，
//    生成与现有题库完全同构的数据文件：
//      window.QUIZ_BANK_<ID> = { schema, bankId, name, category, version,
//                                updatedAt, partSize, questions[] }
//      · id = <bankId>:<4位序号>     · no 从 1 连续       · opts 不带字母前缀
//      · ansIndex 0-3               · 每题 4 选项        · explain 非空
//
//  与 build-quiz-data.cjs 的差别：
//    · build-quiz-data.cjs 吃「已切好的题目 JSON」；本工具吃「整本原文 + 蓝图」，
//      逐题回原文校验 quote/anchor 是否存在，确保忠实原文、可追溯章节与行号。
//    · 不改动 build-quiz-data.cjs 的任何逻辑，两者可并存。
//
//  蓝图 JSON 约定（见 tools/quiz-source/*.json）：
//    {
//      bankId, global, name, category, version, updatedAt, partSize, sourceName,
//      outFile, seed,
//      blueprints: [{ chapter, section?, q, answer, distractors[3], note, quote, anchor }],
//      skipped:    [{ chapter, topic, reason }]
//    }
//    · chapter 形如「第一篇」，按前缀匹配原文的篇标题；
//    · section 省略/空串 = 整篇；否则必须与原文中「一、xxx」小节标题完全一致；
//    · quote/anchor 必须能在该章节区间的原文（去空白后）命中，否则整批失败、不写文件；
//    · note 写解析，quote 写原文关键句，生成时拼成 explain = note + 原文：…（章节）。
//
//  用法（蓝图策展模式 / 全量挖掘模式）：
//    node tools/build-quiz-from-text.cjs \
//      --source "D:\桌面\本能论二稿.txt" \
//      --blueprint tools/quiz-source/<bank>.json \
//      --out public/quiz/data/<bank-id>.js \
//      [--audit path.json] [--json]
//    node tools/build-quiz-from-text.cjs --mine --config tools/quiz-source/<bank>.json \
//      --source "D:\桌面\本能论二稿.txt"
// ============================================================================
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const LETTERS = ['A', 'B', 'C', 'D'];
// 与 check-quiz-data.cjs 保持同一口径：解析严禁「选X/答案X/X项/选项X」
const STRICT_LETTER_RE = /选\s*[A-D]|答案\s*[A-D]|[A-D]\s*项|选项\s*[A-D]|[（(]\s*[A-D]\s*[)）]/;
const LOOSE_LETTER_RE = /(?<![A-Za-z])[A-D](?![A-Za-z])/;
const OPT_PREFIX_RE = /^\s*[A-DＡ-Ｄ][\s.．、:：]/;
const CHAPTER_RE = /^(第[一二三四五六七八九十百千]+篇)\s*(\S.*)?$/;
const SECTION_RE = /^([一二三四五六七八九十]+、)\s*(.*)$/;

function arg(name, fallback) {
    const i = process.argv.indexOf('--' + name);
    return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}
function flag(name) { return process.argv.indexOf('--' + name) >= 0; }

// ----------------------------------------------------------------------------
// 编码识别：UTF-8(BOM) → UTF-8 严格 → GBK 严格 → UTF-8 宽松回退
// ----------------------------------------------------------------------------
function decodeText(file) {
    const buf = fs.readFileSync(file);
    if (buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) {
        return { text: new TextDecoder('utf-8').decode(buf).replace(/^\uFEFF/, ''), encoding: 'UTF-8 (BOM)', bytes: buf.length };
    }
    try {
        return { text: new TextDecoder('utf-8', { fatal: true }).decode(buf), encoding: 'UTF-8', bytes: buf.length };
    } catch (e) { /* 非 UTF-8 */ }
    try {
        return { text: new TextDecoder('gbk', { fatal: true }).decode(buf), encoding: 'GBK', bytes: buf.length };
    } catch (e) { /* 非 GBK */ }
    return { text: new TextDecoder('utf-8').decode(buf), encoding: 'UTF-8 (宽松回退)', bytes: buf.length };
}

// ----------------------------------------------------------------------------
// 篇 / 节 解析
//   · 篇标题：以「第X篇」开头；
//   · 节标题：以「一、」开头、标题长度 ≤30、不以句读收尾（避免把正文「一、我们…。」误判）
// ----------------------------------------------------------------------------
function looksLikeSectionTitle(line) {
    const m = SECTION_RE.exec(line);
    if (!m) return false;
    const title = m[2].trim();
    if (!title || title.length > 30) return false;
    if (/[。，；：,;]$/.test(title)) return false;
    return true;
}

function parseDoc(lines) {
    const chapters = [];
    lines.forEach((raw, i) => {
        const line = raw.trim();
        if (!line) return;
        const cm = CHAPTER_RE.exec(line);
        if (cm) {
            chapters.push({ title: line, start: i, end: lines.length - 1, sections: [] });
            return;
        }
        if (chapters.length && looksLikeSectionTitle(line)) {
            chapters[chapters.length - 1].sections.push({ title: line, start: i, end: 0 });
        }
    });
    chapters.forEach((c, i) => {
        c.end = i + 1 < chapters.length ? chapters[i + 1].start - 1 : lines.length - 1;
        c.sections.forEach((s, j) => {
            s.end = j + 1 < c.sections.length ? c.sections[j + 1].start - 1 : c.end;
        });
    });
    return chapters;
}

function norm(s) { return String(s == null ? '' : s).replace(/[\s\u3000]+/g, ''); }

// 在 [start,end] 行区间内定位 needle（去空白后匹配），返回起止行号（1 基）
function locate(lines, start, end, needle) {
    const target = norm(needle);
    if (!target) return null;
    let concat = '';
    const map = [];
    for (let i = start; i <= end; i++) {
        const n = norm(lines[i]);
        for (let k = 0; k < n.length; k++) map.push(i + 1);
        concat += n;
    }
    const idx = concat.indexOf(target);
    if (idx < 0) return null;
    return { line: map[idx], endLine: map[idx + target.length - 1] };
}

// ----------------------------------------------------------------------------
// 构建期答案重排：位置数组按 A/B/C/D 尽量等量分配后种子洗牌
//   50 题 → A13 / B13 / C12 / D12，任何一档都在 5%-40% 区间内
// ----------------------------------------------------------------------------
function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
function shuffle(arr, rnd) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
}
function buildPositions(n, seed) {
    const counts = [0, 0, 0, 0];
    for (let i = 0; i < n; i++) counts[i % 4]++;
    const base = [];
    counts.forEach((c, k) => { for (let i = 0; i < c; i++) base.push(k); });
    return shuffle(base, mulberry32(seed));
}

// ----------------------------------------------------------------------------
// 全量挖掘模式常量（必须在使用前初始化：--mine 分支在下方立即调用）
// ----------------------------------------------------------------------------
const TYPE_LABEL = {
    formula: '方剂名/代表方',
    number: '关键数字',
    definition: '定义',
    contrast: '对比',
    quote: '经典原句',
    term: '经典原句（关键表述）'
};
const MINE_STOP_FORMULA = new Set([
    '汤液', '汤剂', '丸剂', '散剂', '饮片', '饮水', '饮食物', '饮食', '发散', '散漫',
    '散气', '丸药', '汤水', '饮酒', '饮茶', '饮汤', '汤者', '散者', '丸者', '饮者'
]);
const MINE_STOP_TERMS = new Set([
    '我们', '他们', '你们', '可以', '这个', '那个', '就是', '不是', '因此', '所以',
    '如果', '因为', '但是', '然而', '一个', '没有', '什么', '这样', '那样', '这些',
    '那些', '这种', '那种', '以及', '或者', '而是', '不能', '能够', '进行', '这是',
    '那是', '如何', '其中', '同时', '由于', '关于', '对于', '通过', '认为', '应该',
    '需要', '必须', '已经', '还是', '只是', '不仅', '而且', '并且', '虽然', '可是',
    '于是', '然后', '现在', '今天', '一种', '一切', '生命', '人体', '以上', '以下'
]);
const MINE_STOP_CHARS = /[的了是在有和与就也都而并或不为以之其这那我你他它们个些种样么呢吧啊着过又很更里中上下大小多少]/;

// ----------------------------------------------------------------------------
// 全量挖掘模式（--mine）：不读蓝图，按原文段落单元自动出题
// ----------------------------------------------------------------------------
if (flag('mine')) {
    runMineMode();
    process.exit(0);
}

// ----------------------------------------------------------------------------
// 主流程（蓝图策展模式）
// ----------------------------------------------------------------------------
const blueprintPath = path.resolve(ROOT, arg('blueprint', 'tools/quiz-source/benneng-pilot.json'));
if (!fs.existsSync(blueprintPath)) {
    console.error('[FAIL] 蓝图不存在: ' + blueprintPath);
    process.exit(1);
}
const bp = JSON.parse(fs.readFileSync(blueprintPath, 'utf8'));
const items = Array.isArray(bp.blueprints) ? bp.blueprints : [];
if (!items.length) {
    console.error('[FAIL] 蓝图 blueprints 为空');
    process.exit(1);
}

const sourcePath = arg('source', '');
if (!sourcePath) {
    console.error('[FAIL] 缺少 --source <原文路径>');
    process.exit(1);
}
const srcFile = path.resolve(sourcePath);
if (!fs.existsSync(srcFile)) {
    console.error('[FAIL] 原文不存在: ' + srcFile);
    process.exit(1);
}

const outPath = path.resolve(ROOT, arg('out', bp.outFile || ('public/quiz/data/' + bp.bankId + '.js')));
const seed = parseInt(arg('seed', String(bp.seed || 20261102)), 10);

const decoded = decodeText(srcFile);
const lines = decoded.text.split(/\r?\n/);
const chapters = parseDoc(lines);
if (!chapters.length) {
    console.error('[FAIL] 未识别到任何「第X篇」章节，文本结构不达标，拒绝生成');
    process.exit(1);
}

const errors = [];
const records = [];
const seenStems = new Map();

function findChapter(name) {
    const target = norm(name);
    return chapters.find((c) => norm(c.title).indexOf(target) === 0) || null;
}

items.forEach((item, i) => {
    const no = i + 1;
    const tag = '#' + no;
    if (!item || !item.q || !item.answer) { errors.push(tag + ' 缺少 q/answer'); return; }
    if (!Array.isArray(item.distractors) || item.distractors.length !== 3) {
        errors.push(tag + ' distractors 必须为 3 项'); return;
    }
    if (!item.note || !item.quote || !item.anchor) {
        errors.push(tag + ' 缺少 note/quote/anchor（忠实原文校验必需）'); return;
    }
    const chapter = findChapter(item.chapter);
    if (!chapter) {
        errors.push(tag + ' 未找到章「' + item.chapter + '」；可选: ' + chapters.map((c) => c.title.split(/\s/)[0]).join(', '));
        return;
    }
    let region = chapter;
    let sectionTitle = '';
    if (item.section) {
        const sec = chapter.sections.find((s) => norm(s.title) === norm(item.section));
        if (!sec) {
            errors.push(tag + ' 章「' + chapter.title + '」内未找到小节「' + item.section + '」；可选: ' +
                chapter.sections.map((s) => s.title).join(' | '));
            return;
        }
        region = sec;
        sectionTitle = sec.title;
    }
    const quoteLoc = locate(lines, region.start, region.end, item.quote);
    if (!quoteLoc) { errors.push(tag + ' quote 在指定区间原文中未命中：' + item.quote); return; }
    const anchorLoc = locate(lines, region.start, region.end, item.anchor);
    if (!anchorLoc) { errors.push(tag + ' anchor 在指定区间原文中未命中：' + item.anchor); return; }

    const stemNorm = norm(item.q);
    if (seenStems.has(stemNorm)) errors.push(tag + ' 题干与 #' + seenStems.get(stemNorm) + ' 重复');
    seenStems.set(stemNorm, no);

    const answer = String(item.answer).trim();
    const distractors = item.distractors.map((x) => String(x).trim());
    const optSet = new Set([answer, ...distractors].map(norm));
    if (optSet.size !== 4) errors.push(tag + ' 正确项与干扰项存在重复/空项');

    const rawQuote = String(item.quote).trim();
    // 引文自身已含中文引号时不再外套引号，避免出现 “……“X”……” 的嵌套
    const hasInnerQuote = /[“”]/.test(rawQuote);
    const cited = hasInnerQuote ? rawQuote : '“' + rawQuote + '”';
    const locLabel = item.chapter + (sectionTitle ? '·' + sectionTitle : '');
    const explain = String(item.note).trim() + '原文：' + cited + '（' + locLabel + '）';
    if (STRICT_LETTER_RE.test(explain)) errors.push(tag + ' 解析出现选项字母引用：' + explain.slice(0, 40));
    [answer, ...distractors].forEach((o, k) => {
        if (!o) errors.push(tag + ' 选项 ' + (k + 1) + ' 为空');
        if (OPT_PREFIX_RE.test(o)) errors.push(tag + ' 选项 ' + (k + 1) + ' 残留字母前缀: ' + o.slice(0, 8));
    });

    records.push({
        no,
        chapter: item.chapter,
        section: sectionTitle,
        q: String(item.q).trim(),
        answer,
        distractors,
        note: String(item.note).trim(),
        quote: rawQuote,
        explain,
        sourceLine: quoteLoc.line,
        sourceEndLine: quoteLoc.endLine
    });
});

if (errors.length) {
    console.error('[FAIL] 蓝图校验未通过，未写任何文件：');
    errors.forEach((e) => console.error('  - ' + e));
    process.exit(1);
}

// 答案位置重排 + 干扰项局部洗牌
const positions = buildPositions(records.length, seed);
const rnd = mulberry32(seed >>> 0);
const questions = records.map((r, i) => {
    const opts = new Array(4);
    opts[positions[i]] = r.answer;
    const ds = shuffle(r.distractors, rnd);
    let k = 0;
    for (let p = 0; p < 4; p++) if (p !== positions[i]) opts[p] = ds[k++];
    const q = {
        id: bp.bankId + ':' + String(r.no).padStart(4, '0'),
        no: r.no,
        part: Math.floor(i / (bp.partSize || 400)) + 1,
        q: r.q,
        opts,
        ansIndex: positions[i],
        explain: r.explain,
        tags: []
    };
    return q;
});

// 输出前自检（与 check-quiz-data.cjs 同口径）
const fails = [];
questions.forEach((q, i) => {
    if (!new RegExp('^' + bp.bankId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ':[0-9]{4}$').test(q.id)) fails.push(q.id + ' id 格式错误');
    if (q.no !== i + 1) fails.push(q.id + ' no 不连续');
    if (q.part !== Math.floor(i / (bp.partSize || 400)) + 1) fails.push(q.id + ' part 错误');
    if (q.opts.length !== 4 || new Set(q.opts.map(norm)).size !== 4) fails.push(q.id + ' 选项不唯一/不足 4 项');
    if (q.ansIndex < 0 || q.ansIndex > 3) fails.push(q.id + ' ansIndex 非法');
    if (STRICT_LETTER_RE.test(q.explain)) fails.push(q.id + ' 解析字母引用');
});
if (fails.length) {
    console.error('[FAIL] 生成结果自检失败：');
    fails.forEach((f) => console.error('  - ' + f));
    process.exit(1);
}

const meta = {
    schema: 1,
    bankId: bp.bankId,
    name: bp.name,
    category: bp.category,
    version: bp.version,
    updatedAt: bp.updatedAt,
    partSize: bp.partSize || 400
};
const metaStr = JSON.stringify(meta).slice(0, -1);
const body = ',"questions":[\n' + questions.map((q) => JSON.stringify(q)).join(',\n') + '\n]}';
const objText = metaStr + body;

try { JSON.parse(objText); } catch (e) {
    console.error('[FAIL] 生成对象不是合法 JSON: ' + e.message);
    process.exit(1);
}

const header = [
    '// ============================================================================',
    '//  ' + path.basename(outPath) + ' — ' + bp.name + '（自动生成，请勿手工编辑）',
    '//  来源: ' + bp.sourceName + '（' + decoded.encoding + '，' + lines.length + ' 行）',
    '//  生成: node tools/build-quiz-from-text.cjs（blueprint=' + path.relative(ROOT, blueprintPath).replace(/\\/g, '/') + ', seed=' + seed + '）',
    '//  格式: window.' + bp.global + ' = { schema, bankId, name, category, version, questions[] }',
    '//  约定: opts 不带字母前缀；ansIndex 为 0-3；id = <bankId>:<4位序号>',
    '// ============================================================================'
].join('\n');

const content = header + '\nwindow.' + bp.global + ' = ' + objText + ';\n';
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, content, 'utf8');

// 回读校验：确保文件真的挂载 global 且结构正确
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(outPath, 'utf8'), sandbox, { filename: outPath, timeout: 5000 });
const bank = sandbox.window[bp.global];
if (!bank || bank.bankId !== bp.bankId || bank.questions.length !== questions.length) {
    console.error('[FAIL] 回读校验失败：global/bankId/count 不一致');
    process.exit(1);
}

const sha256 = crypto.createHash('sha256').update(fs.readFileSync(outPath)).digest('hex');
const bytes = fs.statSync(outPath).size;

const chapterDist = {};
questions.forEach((q, i) => { const c = records[i].chapter; chapterDist[c] = (chapterDist[c] || 0) + 1; });
const ansDist = [0, 0, 0, 0];
questions.forEach((q) => ansDist[q.ansIndex]++);
const avgQ = Math.round(questions.reduce((s, q) => s + q.q.length, 0) / questions.length * 10) / 10;
const avgExplain = Math.round(questions.reduce((s, q) => s + q.explain.length, 0) / questions.length * 10) / 10;
const looseHits = questions.filter((q) => LOOSE_LETTER_RE.test(q.explain)).length;

const summary = {
    source: srcFile,
    encoding: decoded.encoding,
    sourceBytes: decoded.bytes,
    sourceLines: lines.length,
    chapters: chapters.length,
    out: outPath,
    bytes,
    sha256,
    count: questions.length,
    chapterDist,
    answerDist: { A: ansDist[0], B: ansDist[1], C: ansDist[2], D: ansDist[3] },
    avgStemLength: avgQ,
    avgExplainLength: avgExplain,
    explainLooseLatinHits: looseHits,
    skipped: (bp.skipped || []).length
};

const auditPath = arg('audit', '');
if (auditPath) {
    fs.writeFileSync(path.resolve(ROOT, auditPath), JSON.stringify(records.map((r, i) => ({
        no: r.no, chapter: r.chapter, section: r.section, sourceLine: r.sourceLine,
        sourceEndLine: r.sourceEndLine, q: r.q, ansIndex: questions[i].ansIndex
    })), null, 1), 'utf8');
}

if (flag('json')) {
    console.log(JSON.stringify(summary, null, 2));
} else {
    console.log('SOURCE   = ' + srcFile);
    console.log('ENCODING = ' + decoded.encoding + '  BYTES=' + decoded.bytes + '  LINES=' + lines.length + '  CHAPTERS=' + chapters.length);
    console.log('OUT      = ' + outPath + '  BYTES=' + bytes);
    console.log('SHA256   = ' + sha256);
    console.log('COUNT    = ' + questions.length);
    console.log('CHAPTERS = ' + Object.keys(chapterDist).map((k) => k + ':' + chapterDist[k]).join('  '));
    console.log('ANSWERS  = A' + ansDist[0] + ' B' + ansDist[1] + ' C' + ansDist[2] + ' D' + ansDist[3]);
    console.log('LENGTHS  = avgQ=' + avgQ + '  avgExplain=' + avgExplain + '  looseLatinExplain=' + looseHits);
    console.log('SKIPPED  = ' + (bp.skipped || []).length);
    if (auditPath) console.log('AUDIT    = ' + path.resolve(ROOT, auditPath));
}

// ============================================================================
//  全量挖掘模式实现
// ============================================================================
function mineChapterShort(c) {
    const m = /^(第[一二三四五六七八九十百千]+篇)/.exec(c.title);
    return m ? m[1] : c.title;
}
function mineChapterAt(i, chapters) {
    for (let k = 0; k < chapters.length; k++) if (i >= chapters[k].start && i <= chapters[k].end) return chapters[k];
    return null;
}
function mineSplitSentences(t) {
    return t.split(/(?<=[。！？])/).map((s) => s.trim()).filter((s) => s.length >= 8);
}
function mineCount(text, sub) {
    let n = 0, i = 0;
    while ((i = text.indexOf(sub, i)) >= 0) { n++; i += sub.length; }
    return n;
}
function mineClauseAround(sentence, start, len) {
    let a = 0, b = sentence.length;
    for (let i = start - 1; i >= 0 && start - i <= 45; i--) {
        if (/[，。；：？！]/.test(sentence[i])) { a = i + 1; break; }
    }
    for (let i = start + len; i < sentence.length && i - (start + len) <= 45; i++) {
        if (/[，。；：？！]/.test(sentence[i])) { b = i + 1; break; }
    }
    const q = sentence.slice(a, b).trim();
    return q.indexOf(sentence.slice(start, start + len)) >= 0 ? q : sentence.trim();
}
function mineStripLead(s) {
    return s.replace(/^(?:而|但|但是|然而|所以|因此|因为|由于|如果|虽然|可是|于是|然后|现在|此外|同时|可见|总之|我们|我|你|他|她|它|这|那|其|此)+/, '').trim();
}

// 引文质量门槛：太短 / 以冒号收尾（如「（1）麻黄汤：」）/ 上下文不足 → 不构成可解题干
function mineQuoteOk(quote, answer, minLen) {
    const q = norm(quote);
    if (!q) return false;
    if (q.length < (minLen || 12)) return false;
    if (/[：:]$/.test(q)) return false;
    if (q.length - norm(answer).length < 5) return false;
    if (/^（?\d+）/.test(q)) return false;
    return true;
}

// 引号内已有中文引号时改用「」，避免出现 “……“X”……” 的嵌套
function mineCite(s) {
    return /[“”]/.test(String(s || '')) ? '「' + s + '」' : '“' + s + '”';
}

// 引号规范化：删除空引号对（“”），仅保留成对出现的弯引号，落单（缺左/缺右）一律剔除。
// 只处理标点，不改动任何文字内容。
function mineBalanceQuotes(raw) {
    const s = String(raw == null ? '' : raw).replace(/“”/g, '');
    const keep = new Array(s.length).fill(false);
    const stack = [];
    for (let i = 0; i < s.length; i++) {
        const ch = s.charAt(i);
        if (ch === '“') stack.push(i);
        else if (ch === '”') {
            const j = stack.pop();
            if (j != null) { keep[j] = true; keep[i] = true; }
        }
    }
    let out = '';
    for (let i = 0; i < s.length; i++) {
        const ch = s.charAt(i);
        if ((ch === '“' || ch === '”') && !keep[i]) continue;
        out += ch;
    }
    return out.trim();
}

// 判断引文是否存在排版瑕疵（缺左/缺右、空引号对、内外层嵌套）。
function mineQuoteBroken(raw) {
    const s = String(raw == null ? '' : raw);
    if (!s) return false;
    if (/^”|“$/.test(s)) return true;
    if (/“”/.test(s)) return true;
    if ((s.match(/“/g) || []).length !== (s.match(/”/g) || []).length) return true;
    let depth = 0;
    for (let i = 0; i < s.length; i++) {
        const ch = s.charAt(i);
        if (ch === '“') { depth++; if (depth > 1) return true; }
        else if (ch === '”') { depth = Math.max(0, depth - 1); }
    }
    return false;
}

// 解析引文：无瑕疵时保持原样式；有瑕疵时按“外层“”、内层「」”规范化，只动标点。
function mineCiteOuter(raw) {
    const s = String(raw == null ? '' : raw).trim();
    if (!mineQuoteBroken(s)) {
        return /[“”]/.test(s) ? s : '“' + s + '”';
    }
    let t = mineBalanceQuotes(s);
    if (/^“[\s\S]*”$/.test(t)) t = t.slice(1, -1);
    t = t.replace(/“/g, '「').replace(/”/g, '」');
    return '“' + t + '”';
}

// note 中的「被定义词」：无瑕疵时沿用原样式；有瑕疵（缺左/缺右/空对/嵌套）才规范化。
function mineCiteLabel(raw) {
    return mineQuoteBroken(raw) ? mineCiteField(raw) : mineCite(raw);
}

// 解析中的「被表述词」：纯文本沿用 “X”；本身含引号时用「」包裹并转内层引号。
function mineCiteField(raw) {
    const t = mineBalanceQuotes(raw);
    if (!/[“”]/.test(t)) return '“' + t + '”';
    let inner = /^“[\s\S]*”$/.test(t) ? t.slice(1, -1) : t;
    inner = inner.replace(/“/g, '「').replace(/”/g, '」');
    return '「' + inner + '」';
}

// 近似题干比较只取引号内的原文片段，剔除「原文说：…。空缺处的…是？」样板句
function mineStemCore(stem) {
    const m = /[“「]([\s\S]*)[”」]/.exec(String(stem || ''));
    return norm(m ? m[1] : stem);
}

function mineParagraphs(lines, chapters) {
    const out = [];
    lines.forEach((raw, i) => {
        const t = raw.trim();
        if (!t || t.length < 8) return;
        if (CHAPTER_RE.test(t) || looksLikeSectionTitle(t)) return;
        if (/^（[一二三四五六七八九十]+）/.test(t) && t.length <= 14) return;
        if (/^[①-⑳]/.test(t) && t.length <= 12) return;
        const ch = mineChapterAt(i, chapters);
        if (!ch) return;
        const sec = ch.sections.filter((s) => i >= s.start && i <= s.end).pop() || null;
        out.push({
            line: i + 1,
            text: t,
            chapter: mineChapterShort(ch),
            section: sec ? sec.title : '',
            regionStart: sec ? sec.start : ch.start,
            regionEnd: sec ? sec.end : ch.end,
            chIndex: chapters.indexOf(ch)
        });
    });
    return out;
}

function mineBuildTermPool(paragraphs) {
    const counts = new Map();
    paragraphs.forEach((p) => {
        const s = p.text.replace(/[^\u4e00-\u9fa5]/g, '');
        for (let n = 2; n <= 6; n++) {
            for (let i = 0; i + n <= s.length; i++) {
                const g = s.slice(i, i + n);
                if (MINE_STOP_TERMS.has(g) || MINE_STOP_CHARS.test(g)) continue;
                counts.set(g, (counts.get(g) || 0) + 1);
            }
        }
    });
    const list = Array.from(counts.entries())
        .filter(([g, c]) => c >= 3 && g.length >= 3 && g.length <= 6)
        .sort((a, b) => b[0].length - a[0].length || b[1] - a[1]);
    const kept = [];
    list.forEach(([g, c]) => {
        if (kept.some(([h, hc]) => h.indexOf(g) >= 0 && hc >= c * 0.8)) return;
        kept.push([g, c]);
    });
    return kept.map(([term, count]) => ({ term, count }));
}

function mineFormulaPool(text, whitelist) {
    return (whitelist || []).filter((f) => f && text.indexOf(f) >= 0)
        .sort((a, b) => b.length - a.length);
}

function mineSentenceCandidates(sen, p, formulaNames, termPool) {
    const out = [];
    if (sen.length > 170) return out;

    // 方剂名
    for (let i = 0; i < formulaNames.length; i++) {
        const name = formulaNames[i];
        const idx = sen.indexOf(name);
        if (idx < 0) continue;
        const quote = mineClauseAround(sen, idx, name.length);
        if (!quote || quote.length > 140 || mineCount(quote, name) !== 1 || !mineQuoteOk(quote, name)) continue;
        out.push({
            type: 'formula', answer: name, quote,
            stem: '原文说：' + mineCite(quote.replace(name, '____')) + '空缺处的方剂是？',
            note: '原文此处列出的方剂是' + name + '。',
            score: 62 - Math.max(0, (quote.length - 70) / 12)
        });
        break;
    }

    // 关键数字（★ 方剂边界：克数/毫升/斤/升等剂量单位一律不出题）
    const DOSAGE_UNITS = new Set(['克', 'g', '毫升', '斤', '升', '枚']);
    const numRe = /(\d+(?:\.\d+)?|[零一二三四五六七八九十百千万两]{2,})(年|次|天|月|岁|克|g|%|倍|种|项|例|度|厘米|毫米|小时|分钟|斤|升|毫升|枚)/g;
    let nm;
    while ((nm = numRe.exec(sen))) {
        const token = nm[1], unit = nm[2];
        if (DOSAGE_UNITS.has(unit)) continue;
        if (unit === '年' && /^\d{3,4}$/.test(token) && Number(token) > 1800) continue;
        const idx = nm.index;
        const quote = mineClauseAround(sen, idx, nm[0].length);
        if (!quote || quote.length > 140 || mineCount(quote, token) !== 1 || !mineQuoteOk(quote, token, 10)) continue;
        out.push({
            type: 'number', answer: token, unit, quote,
            stem: '原文说：' + mineCite(quote.replace(token, '____')) + '空缺处的数值是？',
            note: '原文给出的数值是' + token + unit + '。',
            score: 60 - Math.max(0, (quote.length - 70) / 12)
        });
        break;
    }

    // 定义 / 判断
    const dm = /(所谓|就是|便是|是指|即是|也就是|称为|叫做|是)/.exec(sen);
    if (dm) {
        let marker = dm[0], subject = '', pred = '', qStart = dm.index, qEnd = sen.length;
        if (marker === '所谓') {
            const rest = dm.index + marker.length;
            const m2 = /(就是|便是|是指|即是|也就是|称为|叫做|是)/.exec(sen.slice(rest));
            if (m2) {
                subject = sen.slice(rest, rest + m2.index).replace(/[，。；：]/g, '').trim();
                marker = m2[0];
                pred = sen.slice(rest + m2.index + marker.length).replace(/[。！？；].*$/, '').trim();
                qStart = dm.index;
                qEnd = rest + m2.index + marker.length + pred.length;
            } else {
                marker = '';
            }
        } else {
            const before = sen.slice(0, dm.index);
            subject = mineStripLead(before.split(/[，。；：]/).pop().trim());
            pred = sen.slice(dm.index + marker.length).replace(/[。！？；].*$/, '').trim();
            qStart = dm.index - subject.length;
            qEnd = dm.index + marker.length + pred.length;
        }
        if (marker && pred) {
            subject = mineStripLead(subject).replace(/^所谓/, '').trim();
            const badSubject = !subject || subject.length < 2 || subject.length > 24 ||
                /[，。；：？！]/.test(subject) ||
                /^(?:这|那|它|他|她|此|其|我们|我|你|谁|什么|怎么|为什么)/.test(subject) ||
                /(?:如果|因为|所以|虽然|但是|可是|然而|应该|必须|可以|能够|不能)/.test(subject);
            const badPred = !pred || pred.length < 4 || pred.length > 30 || pred.indexOf('？') >= 0 ||
                /^(?:什么|怎么|为什么|是否)/.test(pred);
            if (!badSubject && !badPred && qStart >= 0 && qEnd <= sen.length) {
                const quote = sen.slice(qStart, qEnd).trim();
                if (quote.length <= 140 && quote.indexOf(pred) >= 0 && mineQuoteOk(quote, pred)) {
                    out.push({
                        type: 'definition', answer: pred, quote,
                        stem: '原文说：' + mineCite(subject + marker + '____') + '空缺处的表述是？',
                        note: '原文以' + mineCiteLabel(pred) + '表述' + mineCiteField(subject) + '。',
                        score: 52 - Math.max(0, (quote.length - 70) / 12)
                    });
                }
            }
        }
    }

    // 对比（不是……而是……）
    const cm = /不是([^，。；]{2,25})[，]?而是([^。；]{4,35})/.exec(sen);
    if (cm && mineQuoteOk(cm[0], cm[2])) {
        const quote = cm[0];
        out.push({
            type: 'contrast', answer: cm[2], quote,
            stem: '原文说：' + mineCite(quote.replace(cm[2], '____')) + '空缺处的表述是？',
            note: '原文以“不是' + cm[1] + '，而是' + cm[2] + '”对举。',
            score: 50 - Math.max(0, (quote.length - 70) / 12)
        });
    }

    // 经典引文：挖出引号内的关键表述
    const qm = /“([^”]{6,40})”/.exec(sen);
    if (qm) {
        const inner = qm[1];
        let pick = null;
        for (let i = 0; i < termPool.length; i++) {
            const t = termPool[i];
            if (t.count > 60 || t.term.length < 3 || t.term.length > 6) continue;
            if (inner.indexOf(t.term) < 0) continue;
            if (mineCount(sen, t.term) !== 1) continue;
            pick = t; break;
        }
        if (pick) {
            if (mineQuoteOk(inner, pick.term)) {
                out.push({
                    type: 'quote', answer: pick.term, quote: inner,
                    stem: '原文有言：' + mineCite(inner.replace(pick.term, '____')) + '空缺处的表述是？',
                    note: '原文原句为' + mineCite(inner) + '。',
                    score: 44 - Math.max(0, (inner.length - 40) / 6)
                });
            }
        }
    }

    return out;
}

function mineTermFallback(p, termPool) {
    let best = null;
    mineSplitSentences(p.text).forEach((sen) => {
        if (sen.length < 12 || sen.length > 120) return;
        for (let i = 0; i < termPool.length; i++) {
            const t = termPool[i];
            if (t.count < 3 || t.count > 50 || t.term.length < 3 || t.term.length > 6) continue;
            if (mineCount(sen, t.term) !== 1) continue;
            const quote = mineClauseAround(sen, sen.indexOf(t.term), t.term.length);
            if (!quote || quote.length < 10 || quote.length > 120 || mineCount(quote, t.term) !== 1 || !mineQuoteOk(quote, t.term)) continue;
            const score = 32 + t.term.length - Math.max(0, (quote.length - 70) / 12);
            if (!best || score > best.score) {
                best = {
                    type: 'term', answer: t.term, quote,
                    stem: '原文说：' + mineCite(quote.replace(t.term, '____')) + '空缺处的表述是？',
                    note: '原文的关键表述为“' + t.term + '”。',
                    score
                };
            }
            break;
        }
    });
    return best;
}

function mineBigrams(s) {
    const t = norm(s);
    const set = new Set();
    for (let i = 0; i + 2 <= t.length; i++) set.add(t.slice(i, i + 2));
    return set;
}
function mineJaccard(a, b) {
    let inter = 0;
    a.forEach((x) => { if (b.has(x)) inter++; });
    return inter / (a.size + b.size - inter || 1);
}

function runMineMode() {
    const configPath = path.resolve(ROOT, arg('config', 'tools/quiz-source/benneng-full.json'));
    if (!fs.existsSync(configPath)) { console.error('[FAIL] 配置不存在: ' + configPath); process.exit(1); }
    const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const sourcePath = arg('source', '');
    if (!sourcePath) { console.error('[FAIL] 缺少 --source <原文路径>'); process.exit(1); }
    const srcFile = path.resolve(sourcePath);
    if (!fs.existsSync(srcFile)) { console.error('[FAIL] 原文不存在: ' + srcFile); process.exit(1); }

    const decoded = decodeText(srcFile);
    const lines = decoded.text.split(/\r?\n/);
    const chapters = parseDoc(lines);
    if (!chapters.length) { console.error('[FAIL] 未识别到任何「第X篇」章节'); process.exit(1); }

    const outPath = path.resolve(ROOT, arg('out', cfg.outFile || ('public/quiz/data/' + cfg.bankId + '.js')));
    const seed = parseInt(arg('seed', String(cfg.seed || 20261102)), 10);
    const target = cfg.targetCount || 600;
    const quota = cfg.quota || {};
    const paragraphs = mineParagraphs(lines, chapters);
    const termPool = mineBuildTermPool(paragraphs);
    const formulaNames = mineFormulaPool(decoded.text, cfg.formulaWhitelist);

    // 每段保留最多 3 个候选，便于首选选项池不足时回退
    const allCandidates = [];
    const skipped = [];
    const seenStem = new Set();
    paragraphs.forEach((p) => {
        const cands = [];
        // 方名清单项（如「（2）葛根汤：桂枝、芍药…」）：整行首句作为引文，只考方剂名
        const em = /^（[0-9一二三四五六七八九十]+）([^：]{2,16})：/.exec(p.text);
        if (em) {
            const candName = em[1].replace(/方$/, '');
            if (formulaNames.indexOf(candName) >= 0) {
                const quote = p.text.split('。')[0].trim() + '。';
                const stripped = quote.replace(/^（[0-9一二三四五六七八九十]+）/, '');
                if (mineCount(quote, candName) === 1 && mineQuoteOk(stripped, candName)) {
                    cands.push({
                        type: 'formula', answer: candName, quote,
                        stem: '原文说：' + mineCite(quote.replace(candName, '____')) + '空缺处的方剂是？',
                        note: '原文在方剂清单中列出的方剂是' + candName + '。',
                        score: 70
                    });
                }
            }
        }
        mineSplitSentences(p.text).forEach((sen) => {
            mineSentenceCandidates(sen, p, formulaNames, termPool).forEach((c) => cands.push(c));
        });
        const fallback = mineTermFallback(p, termPool);
        if (fallback) cands.push(fallback);
        cands.sort((a, b) => b.score - a.score);
        if (!cands.length) {
            skipped.push({ line: p.line, chapter: p.chapter, section: p.section, reason: '未命中五类题型（无可考据单元）' });
            return;
        }
        const kept = [];
        cands.forEach((c) => {
            c.chapter = p.chapter;
            c.section = p.section;
            c.line = p.line;
            c.regionStart = p.regionStart;
            c.regionEnd = p.regionEnd;
            c.chIndex = p.chIndex;
            const key = norm(c.stem);
            if (seenStem.has(key)) return;
            seenStem.add(key);
            if (kept.length < 3) kept.push(c);
        });
        if (!kept.length) {
            skipped.push({ line: p.line, chapter: p.chapter, section: p.section, reason: '题干/引文与其他单元重复' });
            return;
        }
        kept.forEach((c) => allCandidates.push(c));
    });

    // 干扰项池（用全部候选，扩大可选范围）
    const pools = { formula: [], number: [], definition: [], contrast: [], term: [] };
    const poolSeen = {};
    Object.keys(pools).forEach((k) => { poolSeen[k] = new Set(); });
    allCandidates.forEach((c) => {
        if (c.type === 'number') {
            const key = c.answer + '|' + c.unit;
            if (!poolSeen.number.has(key)) { poolSeen.number.add(key); pools.number.push({ token: c.answer, unit: c.unit }); }
            return;
        }
        const k = c.type === 'quote' || c.type === 'term' ? 'term' : c.type;
        const key = norm(c.answer);
        if (pools[k] && !poolSeen[k].has(key)) { poolSeen[k].add(key); pools[k].push(c.answer); }
    });

    const rnd = mulberry32(seed >>> 0);
    function pickDistractors(c) {
        const quoteNorm = norm(c.quote);
        const answerNorm = norm(c.answer);
        let list;
        if (c.type === 'number') {
            const sameUnit = pools.number.filter((x) => x.unit === c.unit && norm(x.token) !== answerNorm && quoteNorm.indexOf(norm(x.token)) < 0);
            list = sameUnit.map((x) => x.token);
            if (list.length < 3) return null; // 无足够同单位干扰项 → 放弃该题，不拿杂项凑数
        } else {
            const k = c.type === 'quote' || c.type === 'term' ? 'term' : c.type;
            const maxDiff = c.type === 'term' || c.type === 'quote' ? 2 : Math.max(8, Math.round(c.answer.length * 0.8));
            list = (pools[k] || []).filter((x) => norm(x) !== answerNorm && quoteNorm.indexOf(norm(x)) < 0);
            const close = list.filter((x) => Math.abs(x.length - c.answer.length) <= maxDiff);
            if (close.length >= 3) list = close;
        }
        list = shuffle(list, rnd);
        const out = [];
        list.forEach((x) => {
            const n = norm(x);
            if (!n || n === answerNorm) return;
            if (out.some((y) => norm(y) === n)) return;
            if (c.type !== 'number' && (n.indexOf(answerNorm) >= 0 || answerNorm.indexOf(n) >= 0)) return;
            if (out.length < 3) out.push(x);
        });
        return out.length === 3 ? out : null;
    }

    // 按篇配额选取；先保证每个小节至少 1 题
    const chapterOrder = chapters.map((c) => mineChapterShort(c));
    const selected = [];
    const usedLines = new Set();
    const quotaCapped = [];
    chapterOrder.forEach((ch) => {
        const q = typeof quota[ch] === 'number' ? quota[ch] : 999;
        const cands = allCandidates.filter((c) => c.chapter === ch)
            .sort((a, b) => b.score - a.score || a.line - b.line);
        const sectionFirst = new Map();
        cands.forEach((c) => {
            const k = c.section || '__';
            if (!sectionFirst.has(k)) sectionFirst.set(k, c);
        });
        const picked = [];
        const pick = (c) => {
            if (usedLines.has(c.line) || picked.length >= q) return;
            if (!pickDistractors(c)) return;
            picked.push(c); usedLines.add(c.line);
        };
        sectionFirst.forEach((c) => pick(c));
        cands.forEach((c) => pick(c));
        picked.forEach((c) => selected.push(c));
        cands.forEach((c) => {
            if (!usedLines.has(c.line)) quotaCapped.push({ line: c.line, chapter: ch, section: c.section });
        });
    });

    // 按篇章顺序 + 原文行号排序
    selected.sort((a, b) => a.chIndex - b.chIndex || a.line - b.line);

    if (!selected.length) { console.error('[FAIL] 无可用候选，拒绝生成'); process.exit(1); }

    // 整批原文定位校验，失败即整批中止
    const locateErrors = [];
    selected.forEach((c) => {
        const anchor = c.quote.indexOf(c.answer) >= 0 ? c.answer : c.quote.slice(0, Math.min(8, c.quote.length));
        const ql = locate(lines, c.regionStart, c.regionEnd, c.quote);
        const al = locate(lines, c.regionStart, c.regionEnd, anchor);
        if (!ql || !al) locateErrors.push('#' + (selected.indexOf(c) + 1) + ' 行' + c.line + ' quote/anchor 未命中');
        c.sourceLine = ql ? ql.line : null;
        c.sourceEndLine = ql ? ql.endLine : null;
        c.anchor = anchor;
    });
    if (locateErrors.length) {
        console.error('[FAIL] 原文定位失败，未写文件：');
        locateErrors.slice(0, 20).forEach((e) => console.error('  - ' + e));
        process.exit(1);
    }

    // 生成题目
    const positions = buildPositions(selected.length, seed);
    const questions = [];
    selected.forEach((c, i) => {
        const opts = new Array(4);
        opts[positions[i]] = c.answer;
        const ds = shuffle(pickDistractors(c), mulberry32(seed + c.line));
        let k = 0;
        for (let p = 0; p < 4; p++) if (p !== positions[i]) opts[p] = ds[k++];
        const locLabel = c.chapter + (c.section ? '·' + c.section : '（篇首导论）');
        const cited = mineCiteOuter(c.quote);
        const explain = c.note + '原文：' + cited + '（' + locLabel + '）';
        questions.push({
            id: cfg.bankId + ':' + String(i + 1).padStart(4, '0'),
            no: i + 1,
            part: Math.floor(i / (cfg.partSize || 400)) + 1,
            q: c.stem,
            opts,
            ansIndex: positions[i],
            explain,
            tags: [],
            _type: c.type,
            _chapter: c.chapter,
            _section: c.section,
            _line: c.sourceLine,
            _endLine: c.sourceEndLine,
            _quote: c.quote,
            _anchor: c.anchor,
            _answer: c.answer
        });
    });

    // 输出前自检
    const fails = [];
    const invalidOpt = /^(?:以上都|以上均|都不对|都不正确|全部正确|全部错误)/;
    questions.forEach((q, i) => {
        if (q.no !== i + 1) fails.push(q.id + ' no 不连续');
        if (q.opts.length !== 4 || new Set(q.opts.map(norm)).size !== 4) fails.push(q.id + ' 选项不唯一/不足 4 项');
        if (q.ansIndex < 0 || q.ansIndex > 3) fails.push(q.id + ' ansIndex 非法');
        if (!q.explain || STRICT_LETTER_RE.test(q.explain)) fails.push(q.id + ' 解析为空或含字母引用');
        q.opts.forEach((o) => { if (invalidOpt.test(o)) fails.push(q.id + ' 含无效选项: ' + o); });
    });
    if (fails.length) {
        console.error('[FAIL] 生成结果自检失败：');
        fails.slice(0, 20).forEach((f) => console.error('  - ' + f));
        process.exit(1);
    }

    // 自查清单
    const suspicious = [];
    const stemMap = new Map();
    const bigrams = questions.map((q) => mineBigrams(mineStemCore(q.q)));
    questions.forEach((q, i) => {
        const types = [];
        const nStem = norm(q.q);
        if (stemMap.has(nStem)) { types.push('题干完全重复'); }
        stemMap.set(nStem, q.no);
        if (!norm(q.q).includes('____')) types.push('题干缺少填空位');
        if (!norm(q.explain).includes(norm(q._answer))) types.push('解析未包含正确项');
        if (!norm(q._quote).includes(norm(q._answer))) types.push('答案未出现在原文依据');
        q.opts.forEach((o) => { if (invalidOpt.test(o)) types.push('无效选项'); });
        if (q._type !== 'number') {
            const lens = q.opts.map((o) => o.length);
            const mn = Math.min.apply(null, lens), mx = Math.max.apply(null, lens);
            if (mx - mn > 25 && mx / Math.max(1, mn) > 2.5) types.push('选项长度差异过大');
            if (q.opts.some((o) => norm(o).indexOf(norm(q._answer)) >= 0 && norm(o) !== norm(q._answer)) ||
                q.opts.some((o) => norm(q._answer).indexOf(norm(o)) >= 0 && norm(o) !== norm(q._answer))) {
                types.push('选项包含关系');
            }
        }
        if (types.length) suspicious.push({ no: q.no, id: q.id, types, detail: q.q.slice(0, 50) });
    });
    for (let i = 0; i < questions.length; i++) {
        for (let j = i + 1; j < questions.length; j++) {
            if (questions[i]._chapter !== questions[j]._chapter) continue;
            if (mineJaccard(bigrams[i], bigrams[j]) >= 0.85) {
                suspicious.push({ no: questions[i].no, id: questions[i].id, types: ['近似题干'], detail: '与 ' + questions[j].id + ' 高度相似' });
            }
        }
    }

    // 写数据文件
    const meta = {
        schema: 1,
        bankId: cfg.bankId,
        name: cfg.name,
        category: cfg.category,
        version: cfg.version,
        updatedAt: cfg.updatedAt,
        partSize: cfg.partSize || 400
    };
    const metaStr = JSON.stringify(meta).slice(0, -1);
    const publicQ = questions.map((q) => ({
        id: q.id, no: q.no, part: q.part, q: q.q, opts: q.opts,
        ansIndex: q.ansIndex, explain: q.explain, tags: []
    }));
    const body = ',"questions":[\n' + publicQ.map((q) => JSON.stringify(q)).join(',\n') + '\n]}';
    const header = [
        '// ============================================================================',
        '//  ' + path.basename(outPath) + ' — ' + cfg.name + '（全量挖掘，自动生成，请勿手工编辑）',
        '//  来源: ' + cfg.sourceName + '（' + decoded.encoding + '，' + lines.length + ' 行）',
        '//  生成: node tools/build-quiz-from-text.cjs --mine（config=' + path.relative(ROOT, configPath).replace(/\\/g, '/') + ', seed=' + seed + '）',
        '//  格式: window.' + cfg.global + ' = { schema, bankId, name, category, version, questions[] }',
        '//  约定: opts 不带字母前缀；ansIndex 为 0-3；id = <bankId>:<4位序号>',
        '// ============================================================================'
    ].join('\n');
    const content = header + '\nwindow.' + cfg.global + ' = ' + metaStr + body + ';\n';
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, content, 'utf8');

    const sandbox = { window: {} };
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(outPath, 'utf8'), sandbox, { filename: outPath, timeout: 5000 });
    const bank = sandbox.window[cfg.global];
    if (!bank || bank.bankId !== cfg.bankId || bank.questions.length !== publicQ.length) {
        console.error('[FAIL] 回读校验失败：global/bankId/count 不一致');
        process.exit(1);
    }

    const sha256 = crypto.createHash('sha256').update(fs.readFileSync(outPath)).digest('hex');
    const bytes = fs.statSync(outPath).size;
    const chapterDist = {}, typeDist = {}, ansDist = [0, 0, 0, 0];
    questions.forEach((q) => {
        chapterDist[q._chapter] = (chapterDist[q._chapter] || 0) + 1;
        typeDist[q._type] = (typeDist[q._type] || 0) + 1;
        ansDist[q.ansIndex]++;
    });
    const avgQ = Math.round(questions.reduce((s, q) => s + q.q.length, 0) / questions.length * 10) / 10;
    const avgExplain = Math.round(questions.reduce((s, q) => s + q.explain.length, 0) / questions.length * 10) / 10;
    const suspiciousCount = {};
    suspicious.forEach((s) => s.types.forEach((t) => { suspiciousCount[t] = (suspiciousCount[t] || 0) + 1; }));
    const skippedCount = {};
    skipped.forEach((s) => { skippedCount[s.reason] = (skippedCount[s.reason] || 0) + 1; });

    const auditPath = path.resolve(ROOT, arg('audit', 'tools/_tmp/benneng-full-audit.json'));
    const audit = {
        meta: {
            bankId: cfg.bankId, global: cfg.global, name: cfg.name, category: cfg.category,
            version: cfg.version, updatedAt: cfg.updatedAt, sourceName: cfg.sourceName,
            encoding: decoded.encoding, sourceBytes: decoded.bytes, sourceLines: lines.length,
            chapters: chapters.length, paragraphs: paragraphs.length, selectedParagraphs: questions.length,
            targetCount: target, seed, sha256, bytes, quota
        },
        stats: {
            count: questions.length,
            chapterDist, typeDist,
            answerDist: { A: ansDist[0], B: ansDist[1], C: ansDist[2], D: ansDist[3] },
            avgStemLength: avgQ, avgExplainLength: avgExplain,
            suspiciousCount, skippedCount, quotaCappedCount: quotaCapped.length
        },
        questions: questions.map((q) => ({
            no: q.no, id: q.id, type: q._type,
            chapter: q._chapter, section: q._section,
            line: q._line, endLine: q._endLine,
            quote: q._quote, anchor: q._anchor, answer: q._answer,
            stem: q.q, opts: q.opts, ansIndex: q.ansIndex, explain: q.explain
        })),
        suspicious,
        skipped,
        quotaCapped
    };
    fs.mkdirSync(path.dirname(auditPath), { recursive: true });
    fs.writeFileSync(auditPath, JSON.stringify(audit, null, 1), 'utf8');

    console.log('SOURCE   = ' + srcFile);
    console.log('ENCODING = ' + decoded.encoding + '  BYTES=' + decoded.bytes + '  LINES=' + lines.length + '  CHAPTERS=' + chapters.length);
    console.log('OUT      = ' + outPath + '  BYTES=' + bytes);
    console.log('SHA256   = ' + sha256);
    console.log('COUNT    = ' + questions.length + ' / target ' + target);
    console.log('CHAPTERS = ' + Object.keys(chapterDist).map((k) => k + ':' + chapterDist[k]).join('  '));
    console.log('TYPES    = ' + Object.keys(typeDist).map((k) => k + ':' + typeDist[k]).join('  '));
    console.log('ANSWERS  = A' + ansDist[0] + ' B' + ansDist[1] + ' C' + ansDist[2] + ' D' + ansDist[3]);
    console.log('LENGTHS  = avgQ=' + avgQ + '  avgExplain=' + avgExplain);
    console.log('SUSPICIOUS=' + suspicious.length + '  ' + Object.keys(suspiciousCount).map((k) => k + ':' + suspiciousCount[k]).join('  '));
    console.log('SKIPPED  = ' + skipped.length + '  ' + Object.keys(skippedCount).map((k) => k + ':' + skippedCount[k]).join('  ') + '  quotaCapped=' + quotaCapped.length);
    console.log('AUDIT    = ' + auditPath);
}
