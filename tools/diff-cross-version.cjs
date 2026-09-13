// tools/diff-cross-version.cjs
// P1-C 跨版本漂移守卫（P2-B1 扩展为多对基线）：
//   Pair desk      —— public/index.html（云端权威源）↔ app_project/db-offline/
//                    desktop/index.html（离线权威源）：严格 span 哈希（含缩进，
//                    ~3132 行 diff 深度分叉，跨版本功能移植靠人工，守卫兜底
//                    「单边改动静默漂移」）。
//   Pair siteadmin —— public/index.html ↔ site-admin/index.html（P2-B1 新增，
//                    2026-09-13）：后者是最后一个脱管的万行级手工双轨副本
//                    （10513 行、9 个 script、263 函数面，无任何门禁覆盖），
//                    历史靠人工「8副本统一」刷同步（登录框/操作界面/中药库/
//                    实名防护 4+ 次大手工提交）。两端格式根本不同（public 含
//                    压缩区块 / site-admin 全展开），故启用「规范化哈希」：
//                    字符串感知剔除空白与注释后比对——注释差异也会判分叉
//                    （入 Tier C 白名单），同体=纯逻辑一致。
//   Pair download  —— public/download.html ↔ site-official/download.html
//                    （SA-2 新增，2026-09-13）：官网下载页双副本手工镜像
//                    （4359 ↔ 4167 行，~332 行合法差异：promo Tab 缺失/渠道
//                    文案分叉），历史已实锤过漂移（09-13 修复「site-official
//                    落后于 public」）。差异主体是 HTML 文案而非 JS 函数，
//                    函数级三层基线盖不住 → 本对用 mode 'lines'：全内容
//                    「规范化行多重集」差集基线，HTML+JS 全部内容漂移可捕获。
//
// 三层基线（每对一份 JSON，tools/.cross-version-baseline[-<id>].json）：
//   Tier A 函数名单差集冻结 —— 仅单侧存在的函数名：
//        新增单侧函数名 → 红灯（一侧新增功能另一侧没有）
//   Tier B 同体函数哈希清单 —— 双侧同名同体（span 哈希序列相等）：
//        任一单边改动 → 红灯（「A 侧修了 B 侧漏改」的主捕获器；
//        双侧同步改（移植完成）不报警）
//   Tier C 已分叉函数白名单 —— 双侧同名不同体（仅记名）：
//        新增分叉名 → 红灯（Tier B→C 迁移须经人工确认后 --update-baseline）
//   另有 INFO（不阻断）：Tier A 收敛（移植/删除完成）、新增同体函数
//        （建议重冻结纳入 Tier B）、Tier C 收敛（分叉已对齐）。
//
// lines 模式（download 对专用）：逐行 normalize（字符串感知剔空白+行/块注释；
//   整行 HTML 注释剔除）后构建多重集，差集 = 仅单侧存在的内容行（计重复次数）：
//   基线冻结 onlyA/onlyB 行清单 → 新差异行红灯（单边新增/改文案后旧行消失新行
//   出现，两侧同步改则两行各自消失互不新增不报警）、基线行消失 INFO（同步收敛）。
//
// 用法：
//   node tools/diff-cross-version.cjs                    检查全部对（漂移则非0）
//   node tools/diff-cross-version.cjs --quiet            CI 用：仅打印摘要与违规项
//   node tools/diff-cross-version.cjs --update-baseline  冻结全部对当前状态为新基线
//   node tools/diff-cross-version.cjs --update-baseline --pair siteadmin
//                                                        仅冻结指定对（推荐——
//                                                        避免误冻其他对的观察基线）
//   node tools/diff-cross-version.cjs --pair desk        仅检查指定对
//
// 函数提取：名字沿用 diff-index-app.cjs 的声明正则；span 用 sync-shared-blocks.cjs
// 同款字符串感知括号扫描（模板串/单双引号/行注释/块注释跳过；正则字面量局限
// 与既有工具一致——两侧同源误扫对称，不影响同体判定）。
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');

// ---- 对定义（id 用于 --pair 选择与基线文件名）----
const PAIRS = [
    {
        id: 'desk',
        label: 'public/index.html ↔ 离线桌面权威源',
        fileA: 'public/index.html',
        fileB: 'app_project/db-offline/desktop/index.html',
        baseline: '.cross-version-baseline.json',
        mode: 'strict', // span 哈希含缩进与换行（严格守卫）
    },
    {
        // ★ 2026-09-13 P2-B1 新增：site-admin 手工双轨副本收编守护
        id: 'siteadmin',
        label: 'public/index.html ↔ site-admin 手工双轨副本',
        fileA: 'public/index.html',
        fileB: 'site-admin/index.html',
        baseline: '.cross-version-baseline-siteadmin.json',
        mode: 'normalized', // 字符串感知剔空白+注释后哈希（格式根本不同）
    },
    {
        // ★ 2026-09-13 SA-2 新增：官网下载页双副本镜像守护（lines 模式：
        //   差异主体是 HTML 文案，函数级基线盖不住，改为全内容行多重集差集）
        id: 'download',
        label: 'public/download.html ↔ site-official 双副本镜像',
        fileA: 'public/download.html',
        fileB: 'site-official/download.html',
        baseline: '.cross-version-baseline-download.json',
        mode: 'lines',
    },
    {
        // ★ 2026-09-13 重整分离部署新增：管理台控制台子页双副本（主域 /admin/ 与
        //   后台站 site-admin/admin/ 同一份内容，字节级镜像，基线=空差集；
        //   实锤事故：09-10 漏斗只进 public、09-11/12 license 警示只进
        //   site-admin——双向漂移各缺一块，此后任何单边改即红灯）
        id: 'adminconsole',
        label: 'public/admin/index.html ↔ site-admin/admin 控制台双副本',
        fileA: 'public/admin/index.html',
        fileB: 'site-admin/admin/index.html',
        baseline: '.cross-version-baseline-adminconsole.json',
        mode: 'lines',
    },
];

const quiet = process.argv.includes('--quiet');
const updateBaseline = process.argv.includes('--update-baseline');
const pairIdx = process.argv.indexOf('--pair');
const pairFilter = pairIdx !== -1 && process.argv[pairIdx + 1] ? process.argv[pairIdx + 1] : null;
const activePairs = pairFilter ? PAIRS.filter((p) => p.id === pairFilter) : PAIRS;
if (pairFilter && activePairs.length === 0) {
    console.error('[cross-version] FAIL: 未知 --pair ' + pairFilter + '（可用: ' + PAIRS.map((p) => p.id).join(' / ') + '）');
    process.exit(1);
}

// ---- 函数名提取（diff-index-app.cjs 同款正则）----
const NAME_RE = /(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g;

// ---- 字符串感知 span 扫描（sync-shared-blocks.cjs 同款算法，容错化）----
// 扫描不平衡的 span 记为 '!UNSTABLE'（不抛异常——守卫工具不能被单处语法形态
// 卡死；双侧同 unstable 视为同体，单侧 unstable 视为分歧）
function scanSpan(src, fromIndex) {
    let i = src.indexOf('{', fromIndex);
    let depth = 0, closed = false;
    outer: while (i < src.length && i !== -1) {
        const c = src[i];
        if (c === "'" || c === '"') { const q = c; i++; while (i < src.length && src[i] !== q) { if (src[i] === '\\') i++; i++; } i++; continue; }
        if (c === '`') { i++; while (i < src.length && src[i] !== '`') { if (src[i] === '\\') i++; i++; } i++; continue; }
        if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
        if (c === '/' && src[i + 1] === '*') { i += 2; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; continue; }
        if (c === '{') depth++;
        else if (c === '}') { depth--; if (depth === 0) { closed = true; break outer; } }
        i++;
    }
    return closed ? i : -1;
}

// ---- 字符串感知规范化（仅 normalized 模式用）----
// 字符串字面量内的空白保留（'a b' ≠ 'ab'）；字符串外空白与行/块注释全剔
function normalizeSpan(text) {
    let out = '', i = 0;
    while (i < text.length) {
        const c = text[i];
        if (c === "'" || c === '"' || c === '`') {
            const q = c; out += c; i++;
            while (i < text.length && text[i] !== q) { out += text[i]; if (text[i] === '\\') { i++; if (i < text.length) out += text[i]; } i++; }
            if (i < text.length) { out += q; i++; }
            continue;
        }
        if (c === '/' && text[i + 1] === '/') { while (i < text.length && text[i] !== '\n') i++; continue; }
        if (c === '/' && text[i + 1] === '*') { i += 2; while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++; i += 2; continue; }
        if (/\s/.test(c)) { i++; continue; }
        out += c; i++;
    }
    return out;
}

// ---- span 哈希提取 ----
// strict 模式：span 含行首缩进与行尾换行（缩进差异视为真差异）——与
//   findFunctionSpan 语义一致；normalized 模式：span 取声明头到收尾大括号，
//   剔空白+注释后哈希（缩进/换行/注释差异不算差异）
function extractFnSpanHashes(src, mode) {
    const spans = new Map(); // name -> [hash,...]
    let m;
    NAME_RE.lastIndex = 0;
    while ((m = NAME_RE.exec(src)) !== null) {
        const name = m[1];
        const closeIdx = scanSpan(src, m.index);
        let h;
        if (closeIdx === -1) {
            h = '!UNSTABLE';
        } else if (mode === 'normalized') {
            const body = src.slice(m.index, closeIdx + 1);
            h = crypto.createHash('sha256').update(normalizeSpan(body), 'utf8').digest('hex').slice(0, 16);
        } else {
            let start = m.index;
            while (start > 0 && src[start - 1] === ' ') start--;
            let end = closeIdx + 1;
            if (src[end] === '\r') end++;
            if (src[end] === '\n') end++;
            h = crypto.createHash('sha256').update(src.slice(start, end), 'utf8').digest('hex').slice(0, 16);
        }
        if (!spans.has(name)) spans.set(name, []);
        spans.get(name).push(h);
    }
    return spans;
}

// ---- lines 模式：规范化行多重集差集（download 对专用）----
// 逐行处理：字符串感知剔空白+行注释；跨行块注释状态机跟踪；整行 HTML 注释剔除。
// norm 后空行（纯空白/纯注释行）不计入。返回 Map<line, count>。
function buildLineMultiset(src) {
    const counts = new Map();
    let inBlockComment = false; // JS /* */ 跨行状态
    for (let raw of src.split('\n')) {
        const line = raw.trim();
        if (!line) continue;
        // 整行 HTML 注释（<!-- ... -->）剔除
        if (line.startsWith('<!--') && line.endsWith('-->')) continue;
        let norm = '';
        let i = 0;
        while (i < line.length) {
            if (inBlockComment) {
                const end = line.indexOf('*/', i);
                if (end === -1) { i = line.length; } else { inBlockComment = false; i = end + 2; }
                continue;
            }
            const c = line[i];
            if (c === "'" || c === '"') {
                const q = c; norm += c; i++;
                while (i < line.length && line[i] !== q) { norm += line[i]; if (line[i] === '\\') { i++; if (i < line.length) norm += line[i]; } i++; }
                if (i < line.length) { norm += q; i++; }
                continue;
            }
            if (c === '/' && line[i + 1] === '/') break; // 行注释：丢弃行尾
            if (c === '/' && line[i + 1] === '*') { inBlockComment = true; i += 2; continue; }
            if (/\s/.test(c)) { i++; continue; }
            norm += c; i++;
        }
        if (norm) counts.set(norm, (counts.get(norm) || 0) + 1);
    }
    return counts;
}

// 多重集差集：A 计数 > B 计数的行（含次数）展开为数组（重复出现 count 次）
function multisetDiff(a, b) {
    const out = [];
    for (const [line, ca] of a) {
        const cb = b.get(line) || 0;
        for (let k = 0; k < ca - cb; k++) out.push(line);
    }
    return out.sort();
}

function runLinesPair(pair, updateBaseline) {
    const fileA = path.join(ROOT, pair.fileA);
    const fileB = path.join(ROOT, pair.fileB);
    const baseFile = path.join(__dirname, pair.baseline);
    const srcA = fs.readFileSync(fileA, 'utf8').replace(/\r\n/g, '\n');
    const srcB = fs.readFileSync(fileB, 'utf8').replace(/\r\n/g, '\n');
    const aLines = buildLineMultiset(srcA);
    const bLines = buildLineMultiset(srcB);
    const onlyA = multisetDiff(aLines, bLines);
    const onlyB = multisetDiff(bLines, aLines);

    if (updateBaseline) {
        const data = {
            frozenAt: new Date().toISOString(),
            pair: pair.fileA + ' <-> ' + pair.fileB,
            mode: pair.mode,
            note: '仅单侧存在的规范化内容行（含重复次数）。新差异行=红灯（单边新增/单边改文案，旧行消失+新行出现）；基线行消失=INFO（同步收敛/双侧同删）。两侧同步改（互不新增）不报警。',
            onlyA_lines: onlyA,
            onlyB_lines: onlyB,
        };
        fs.writeFileSync(baseFile, JSON.stringify(data, null, 2), 'utf8');
        console.log('[cross-version:' + pair.id + '] 基线已冻结: tools/' + pair.baseline);
        console.log('  仅 A 侧内容行: ' + onlyA.length + ' | 仅 B 侧内容行: ' + onlyB.length);
        return { red: [], info: [], summary: 'frozen', counts: { onlyA: onlyA.length, onlyB: onlyB.length } };
    }

    let baseline = null;
    try { baseline = JSON.parse(fs.readFileSync(baseFile, 'utf8')); } catch (e) {}

    if (!baseline) {
        return {
            red: [{ tier: 'X', name: '(baseline)', why: '基线不存在——先运行 node tools/diff-cross-version.cjs --update-baseline --pair ' + pair.id + ' 冷启动冻结' }],
            info: [], summary: 'no-baseline',
        };
    }

    const bA = new Set(baseline.onlyA_lines || []);
    const bB = new Set(baseline.onlyB_lines || []);

    const red = [];
    onlyA.forEach((l) => { if (!bA.has(l)) red.push({ tier: 'A', name: l.slice(0, 100), why: '新增仅 ' + pair.fileA + ' 存在的内容行（' + pair.fileB + ' 缺——单边新增/单边改文案，同步到对侧或确认合法差异后重冻结）' }); });
    onlyB.forEach((l) => { if (!bB.has(l)) red.push({ tier: 'B', name: l.slice(0, 100), why: '新增仅 ' + pair.fileB + ' 存在的内容行（' + pair.fileA + ' 缺——单边新增/单边改文案，同步到对侧或确认合法差异后重冻结）' }); });

    const info = [];
    const curA = new Set(onlyA), curB = new Set(onlyB);
    bA.forEach((l) => { if (!curA.has(l)) info.push('A 侧差异行消失（已同步到 B / 双侧删除）: ' + l.slice(0, 80)); });
    bB.forEach((l) => { if (!curB.has(l)) info.push('B 侧差异行消失（已同步到 A / 双侧删除）: ' + l.slice(0, 80)); });

    return {
        red, info,
        summary: '仅 A 侧行: ' + onlyA.length + ' | 仅 B 侧行: ' + onlyB.length +
            '（基线: A=' + (baseline.onlyA_lines || []).length + ' B=' + (baseline.onlyB_lines || []).length + '）',
        counts: { onlyA: onlyA.length, onlyB: onlyB.length },
    };
}

// ---- 单对执行：返回 { red, info, summary } ----
function runPair(pair) {
    if (pair.mode === 'lines') {
        return runLinesPair(pair, updateBaseline);
    }
    const fileA = path.join(ROOT, pair.fileA);
    const fileB = path.join(ROOT, pair.fileB);
    const baseFile = path.join(__dirname, pair.baseline);
    const srcA = fs.readFileSync(fileA, 'utf8').replace(/\r\n/g, '\n');
    const srcB = fs.readFileSync(fileB, 'utf8').replace(/\r\n/g, '\n');
    const aSpans = extractFnSpanHashes(srcA, pair.mode);
    const bSpans = extractFnSpanHashes(srcB, pair.mode);

    const onlyA = [...aSpans.keys()].filter((n) => !bSpans.has(n)).sort();
    const onlyB = [...bSpans.keys()].filter((n) => !aSpans.has(n)).sort();
    const bothSame = [], bothDiff = [];
    for (const n of aSpans.keys()) {
        if (!bSpans.has(n)) continue;
        const a = aSpans.get(n), b = bSpans.get(n);
        const eq = a.length === b.length && a.every((h, k) => h === b[k]);
        (eq ? bothSame : bothDiff).push(n);
    }
    bothSame.sort(); bothDiff.sort();

    // --update-baseline：冻结当前状态并返回
    if (updateBaseline) {
        const data = {
            frozenAt: new Date().toISOString(),
            pair: pair.fileA + ' <-> ' + pair.fileB,
            mode: pair.mode,
            note: 'Tier B→C 迁移（同体→分叉）与 Tier A/C 新增必须人工确认后重冻结；Tier C 收敛（分叉对齐）属改进，重冻结即可',
            tierA_onlyA: onlyA,
            tierA_onlyB: onlyB,
            tierB_sameBody: bothSame,
            tierC_forked: bothDiff,
        };
        fs.writeFileSync(baseFile, JSON.stringify(data, null, 2), 'utf8');
        console.log('[cross-version:' + pair.id + '] 基线已冻结: tools/' + pair.baseline);
        console.log('  Tier A 单侧: A=' + onlyA.length + ' B=' + onlyB.length +
            ' | Tier B 同体: ' + bothSame.length + ' | Tier C 分叉: ' + bothDiff.length);
        return { red: [], info: [], summary: 'frozen', counts: { onlyA: onlyA.length, onlyB: onlyB.length, same: bothSame.length, fork: bothDiff.length } };
    }

    let baseline = null;
    try { baseline = JSON.parse(fs.readFileSync(baseFile, 'utf8')); } catch (e) {}

    if (!baseline) {
        return {
            red: [{ tier: 'X', name: '(baseline)', why: '基线不存在——先运行 node tools/diff-cross-version.cjs --update-baseline --pair ' + pair.id + ' 冷启动冻结' }],
            info: [], summary: 'no-baseline',
        };
    }

    const bA_a = new Set(baseline.tierA_onlyA || []);
    const bA_b = new Set(baseline.tierA_onlyB || []);
    const bB = new Set(baseline.tierB_sameBody || []);
    const bC = new Set(baseline.tierC_forked || []);

    // ---- 红灯判定 ----
    const red = [];
    // R1：新增单侧函数名
    onlyA.forEach((n) => { if (!bA_a.has(n)) red.push({ tier: 'A', name: n, why: '新增仅 ' + pair.fileA + ' 存在的函数（' + pair.fileB + ' 缺）' }); });
    onlyB.forEach((n) => { if (!bA_b.has(n)) red.push({ tier: 'A', name: n, why: '新增仅 ' + pair.fileB + ' 存在的函数（' + pair.fileA + ' 缺）' }); });
    // R2：基线 Tier B 同体函数现分歧（单边改动 / 双边改岔）
    bothDiff.forEach((n) => {
        if (bB.has(n)) red.push({ tier: 'B', name: n, why: '同体函数发生单边改动（一侧修了另一侧漏改）——移植到另一侧后重冻结，或人工确认分叉后 --update-baseline 迁入 Tier C' });
        else if (!bC.has(n)) red.push({ tier: 'C', name: n, why: '新增分叉函数（双侧同名不同体）——人工确认后 --update-baseline 归档' });
    });

    // ---- INFO（不阻断）----
    const info = [];
    (baseline.tierA_onlyA || []).forEach((n) => { if (!aSpans.has(n) && bSpans.has(n)) info.push('Tier A 收敛: ' + n + ' A侧消失（删除或改私有）'); });
    [...bA_a].forEach((n) => { if (bSpans.has(n)) info.push('Tier A 收敛: ' + n + ' 已双侧同在（移植完成）'); });
    [...bA_b].forEach((n) => { if (aSpans.has(n)) info.push('Tier A 收敛: ' + n + ' 已双侧同在（移植完成）'); });
    bothSame.forEach((n) => { if (!bB.has(n) && !bC.has(n)) info.push('新增同体: ' + n + '（建议 --update-baseline 纳入 Tier B 监控）'); });
    [...bC].forEach((n) => { if (bothSame.includes(n)) info.push('Tier C 收敛: ' + n + ' 分叉已对齐（改进，建议重冻结）'); });

    return {
        red, info,
        summary: 'Tier A 单侧: A=' + onlyA.length + ' B=' + onlyB.length +
            ' | Tier B 同体: ' + bothSame.length + ' | Tier C 分叉: ' + bothDiff.length +
            '（基线: A=' + (baseline.tierA_onlyA || []).length + '/' + (baseline.tierA_onlyB || []).length +
            ' B=' + (baseline.tierB_sameBody || []).length + ' C=' + (baseline.tierC_forked || []).length + '）',
        counts: { onlyA: onlyA.length, onlyB: onlyB.length, same: bothSame.length, fork: bothDiff.length },
    };
}

// ---- 主流程 ----
let anyRed = false, anyBaselineWritten = false;
for (const pair of activePairs) {
    const r = runPair(pair);
    if (r.summary === 'frozen') { anyBaselineWritten = true; continue; }
    if (r.summary === 'no-baseline') { anyRed = true; }
    if (!quiet) {
        console.log('=== 跨版本漂移守卫[' + pair.id + ']（' + pair.label + '，' + pair.mode + '）===');
        console.log('  ' + r.summary);
    }
    if (r.red.length) {
        anyRed = true;
        console.error('[cross-version:' + pair.id + '][RED] 检测到未确认的跨版本漂移 ' + r.red.length + ' 项：');
        r.red.forEach((x) => console.error('  [Tier ' + x.tier + '] ' + x.name + ' — ' + x.why));
        console.error('  处置：跨版本移植功能到另一侧；或人工确认分叉合理后运行 node tools/diff-cross-version.cjs --update-baseline --pair ' + pair.id);
    }
    if (r.info.length && !quiet) {
        console.log('[cross-version:' + pair.id + '][INFO] 基线状态变化（不阻断）：');
        r.info.forEach((s) => console.log('  ' + s));
        console.log('  （建议功能收口后 --update-baseline 重冻结）');
    }
    if (!r.red.length && r.summary !== 'no-baseline' && !quiet) {
        console.log('[cross-version:' + pair.id + '][OK] 三层基线全绿（单侧新增/同体单边改动/新增分叉均无）');
    }
}

if (anyRed) process.exit(1);
if (!quiet) {
    if (anyBaselineWritten) console.log('[cross-version] 基线冻结完成：' + activePairs.map((p) => p.id).join(' / '));
    else console.log('[cross-version] 全部 ' + activePairs.length + ' 对基线检查完成');
}
process.exit(0);
