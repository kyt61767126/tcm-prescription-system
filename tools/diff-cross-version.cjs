// tools/diff-cross-version.cjs
// P1-C 跨版本漂移守卫：public/index.html（云端权威源）↔ app_project/db-offline/
// desktop/index.html（离线权威源）——两个产品形态深度分叉（~3132 行 diff），
// 跨版本功能移植靠人工，本守卫兜底「单边改动静默漂移」。
//
// 背景（KNOWLEDGE §19 第三步）：云端修了离线漏改（或反向）历史上多次发生，
// 两权威源无生成关系、只能语义级比对。三层基线（tools/.cross-version-baseline.json）：
//   Tier A 函数名单差集冻结 —— 仅单侧存在的函数名（~30 项）：
//        新增单侧函数名 → 红灯（云端新增功能离线没有，或反向）
//   Tier B 同体函数哈希清单 —— 双侧同名同体（span 哈希序列相等，~184 项）：
//        任一单边改动 → 红灯（「云端修了离线漏改」的主捕获器；
//        双侧同步改（移植完成）不报警）
//   Tier C 已分叉函数白名单 —— 双侧同名不同体（~45 项仅记名）：
//        新增分叉名 → 红灯（Tier B→C 迁移须经人工确认后 --update-baseline）
//   另有 INFO（不阻断）：Tier A 收敛（移植/删除完成）、新增同体函数
//   （建议重冻结纳入 Tier B）、Tier C 收敛（分叉已对齐）。
//
// 用法：
//   node tools/diff-cross-version.cjs                 检查（基线漂移则非0）
//   node tools/diff-cross-version.cjs --quiet          CI 用：仅打印摘要与违规项
//   node tools/diff-cross-version.cjs --update-baseline 冻结当前状态为新基线
//
// 函数提取：名字沿用 diff-index-app.cjs 的声明正则；span 用 sync-shared-blocks.cjs
// 同款字符串感知括号扫描（模板串/单双引号/行注释/块注释跳过；正则字面量局限
// 与既有工具一致——两侧同源误扫对称，不影响同体判定）。
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const CLOUD = path.join(ROOT, 'public/index.html');
const DESK = path.join(ROOT, 'app_project/db-offline/desktop/index.html');
const BASELINE = path.join(__dirname, '.cross-version-baseline.json');

const quiet = process.argv.includes('--quiet');
const updateBaseline = process.argv.includes('--update-baseline');

// ---- 函数名提取（diff-index-app.cjs 同款正则）----
const NAME_RE = /(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g;

// ---- 字符串感知 span 扫描（sync-shared-blocks.cjs 同款算法，容错化）----
// 返回 name -> span 哈希数组；扫描不平衡的 span 记为 '!UNSTABLE'（不抛异常——
// 守卫工具不能被单处语法形态卡死；双侧同 unstable 视为同体，单侧 unstable 视为分歧）
function extractFnSpanHashes(src) {
    const spans = new Map(); // name -> [hash,...]
    let m;
    NAME_RE.lastIndex = 0;
    while ((m = NAME_RE.exec(src)) !== null) {
        const name = m[1];
        // 从声明头之后找第一个 { 起做括号配平
        let i = src.indexOf('{', m.index);
        // 参数表内的 {（解构参数）也应是第一个 {—— indexOf 语义正确
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
        let h;
        if (!closed || i === -1) {
            h = '!UNSTABLE';
        } else {
            // span 文本：含行首缩进（声明前的空格）与行尾换行——与
            // findFunctionSpan 语义一致；缩进差异视为真差异（严格守卫）
            let start = m.index;
            while (start > 0 && src[start - 1] === ' ') start--;
            let end = i + 1;
            if (src[end] === '\r') end++;
            if (src[end] === '\n') end++;
            h = crypto.createHash('sha256').update(src.slice(start, end), 'utf8').digest('hex').slice(0, 16);
        }
        if (!spans.has(name)) spans.set(name, []);
        spans.get(name).push(h);
    }
    return spans;
}

// ---- 当前状态分类 ----
const cloudSrc = fs.readFileSync(CLOUD, 'utf8');
const deskSrc = fs.readFileSync(DESK, 'utf8');
const cSpans = extractFnSpanHashes(cloudSrc);
const dSpans = extractFnSpanHashes(deskSrc);

const onlyCloud = [...cSpans.keys()].filter((n) => !dSpans.has(n)).sort();
const onlyDesk = [...dSpans.keys()].filter((n) => !cSpans.has(n)).sort();
const bothSame = [], bothDiff = [];
for (const n of cSpans.keys()) {
    if (!dSpans.has(n)) continue;
    const a = cSpans.get(n), b = dSpans.get(n);
    const eq = a.length === b.length && a.every((h, k) => h === b[k]);
    (eq ? bothSame : bothDiff).push(n);
}
bothSame.sort(); bothDiff.sort();

// ---- 基线读写 ----
let baseline = null;
try { baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf8')); } catch (e) {}

if (updateBaseline) {
    const data = {
        frozenAt: new Date().toISOString(),
        pair: 'public/index.html <-> app_project/db-offline/desktop/index.html',
        note: 'Tier B→C 迁移（同体→分叉）与 Tier A/C 新增必须人工确认后重冻结；Tier C 收敛（分叉对齐）属改进，重冻结即可',
        tierA_onlyCloud: onlyCloud,
        tierA_onlyDesk: onlyDesk,
        tierB_sameBody: bothSame,
        tierC_forked: bothDiff,
    };
    fs.writeFileSync(BASELINE, JSON.stringify(data, null, 2), 'utf8');
    console.log('[cross-version] 基线已冻结: tools/.cross-version-baseline.json');
    console.log('  Tier A 单侧: cloud=' + onlyCloud.length + ' desk=' + onlyDesk.length +
        ' | Tier B 同体: ' + bothSame.length + ' | Tier C 分叉: ' + bothDiff.length);
    process.exit(0);
}

if (!baseline) {
    console.error('[cross-version] FAIL: 基线不存在——先运行 node tools/diff-cross-version.cjs --update-baseline 冷启动冻结');
    process.exit(1);
}

const bA_cloud = new Set(baseline.tierA_onlyCloud || []);
const bA_desk = new Set(baseline.tierA_onlyDesk || []);
const bB = new Set(baseline.tierB_sameBody || []);
const bC = new Set(baseline.tierC_forked || []);

// ---- 红灯判定 ----
const red = [];
// R1：新增单侧函数名
onlyCloud.forEach((n) => { if (!bA_cloud.has(n)) red.push({ tier: 'A', name: n, why: '新增仅云端存在的函数（离线缺）' }); });
onlyDesk.forEach((n) => { if (!bA_desk.has(n)) red.push({ tier: 'A', name: n, why: '新增仅离线存在的函数（云端缺）' }); });
// R2：基线 Tier B 同体函数现分歧（单边改动 / 双边改岔）
bothDiff.forEach((n) => {
    if (bB.has(n)) red.push({ tier: 'B', name: n, why: '同体函数发生单边改动（云端修了离线漏改，或反向）——移植到另一侧后重冻结，或人工确认分叉后 --update-baseline 迁入 Tier C' });
    else if (!bC.has(n)) red.push({ tier: 'C', name: n, why: '新增分叉函数（双侧同名不同体）——人工确认后 --update-baseline 归档' });
});

// ---- INFO（不阻断）----
const info = [];
onlyCloud.length && baseline.tierA_onlyCloud.forEach((n) => { if (!cSpans.has(n) && dSpans.has(n)) info.push('Tier A 收敛: ' + n + ' 云端侧消失（删除或改私有）'); });
[...bA_cloud].forEach((n) => { if (dSpans.has(n)) info.push('Tier A 收敛: ' + n + ' 已双侧同在（移植完成）'); });
[...bA_desk].forEach((n) => { if (cSpans.has(n)) info.push('Tier A 收敛: ' + n + ' 已双侧同在（移植完成）'); });
bothSame.forEach((n) => { if (!bB.has(n) && !bC.has(n)) info.push('新增同体: ' + n + '（建议 --update-baseline 纳入 Tier B 监控）'); });
[...bC].forEach((n) => { if (bothSame.includes(n)) info.push('Tier C 收敛: ' + n + ' 分叉已对齐（改进，建议重冻结）'); });

// ---- 输出 ----
if (!quiet) {
    console.log('=== 跨版本漂移守卫（public ↔ 离线桌面权威源）===');
    console.log('  Tier A 单侧: cloud=' + onlyCloud.length + ' desk=' + onlyDesk.length +
        ' | Tier B 同体: ' + bothSame.length + ' | Tier C 分叉: ' + bothDiff.length +
        '（基线: cloud=' + (baseline.tierA_onlyCloud || []).length + '/' + (baseline.tierA_onlyDesk || []).length +
        ' B=' + (baseline.tierB_sameBody || []).length + ' C=' + (baseline.tierC_forked || []).length + '）');
}
if (red.length) {
    console.error('[cross-version][RED] 检测到未确认的跨版本漂移 ' + red.length + ' 项：');
    red.forEach((r) => console.error('  [Tier ' + r.tier + '] ' + r.name + ' — ' + r.why));
    console.error('  处置：跨版本移植功能到另一权威源；或人工确认分叉合理后运行 node tools/diff-cross-version.cjs --update-baseline');
    process.exit(1);
}
if (info.length && !quiet) {
    console.log('[cross-version][INFO] 基线状态变化（不阻断）：');
    info.forEach((s) => console.log('  ' + s));
    console.log('  （建议功能收口后 --update-baseline 重冻结）');
}
if (!quiet) console.log('[cross-version][OK] 三层基线全绿（单侧新增/同体单边改动/新增分叉均无）');
process.exit(0);
