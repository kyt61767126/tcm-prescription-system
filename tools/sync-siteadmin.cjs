// ============================================================================
// sync-siteadmin.cjs — site-admin/index.html 共享函数层「生成模式」同步工具
// ★ 2026-09-13 P2-B site-admin 生成模式收口（SA 分层架构·共享层执行器）
//
// 架构定位（三分层，详见 KNOWLEDGE.md）：
//   [共享层] 42 同体函数（diff-cross-version tierB）——本工具管辖：
//             site-admin 侧加 SYNCED-FN 标记块，内容从 public/index.html
//             权威源按函数名机械提取、原样传播（raw 字节级）。
//   [分叉层] 101 分叉函数——diff-cross-version siteadmin 对基线红灯守护，
//             人工移植收敛后（两侧规范化同体）再加入本工具 SYNCED_FNS 清单。
//   [独有层] public 独有 116 / site-admin 独有 103——各自独立维护。
//
// 与既有工具的互锁：
//   diff-cross-version.cjs（siteadmin 对）= 漂移探测器：public 改了共享函数
//     而未跑本工具 → 同体哈希单边变化 → 红灯，强制运行 sync-siteadmin；
//   本工具 = 同步执行器：bootstrap 有防误刷守卫（两侧规范化不同体的函数
//     拒绝标记，防静默覆盖分叉版本）；
//   sync-all.ps1 Group 16 调用本工具（CI ②/pre-push ② 经 -VerifyOnly 全覆盖）。
//
// 标记块结构（site-admin/index.html 内联，public 权威源零标记零改动）：
//   // >>> SYNCED-FN <name> (由 public/index.html 自动同步 via tools/sync-siteadmin.cjs — 勿手改) ===
//   <public/index.html 中该函数的整段原文（字符串感知括号配平提取）>
//   // <<< SYNCED-FN-END <name> ===
//
// 用法：
//   node tools/sync-siteadmin.cjs            # 同步：bootstrap 标记 + 从权威源刷新
//   node tools/sync-siteadmin.cjs --check    # 仅校验（sync-all -VerifyOnly 调用，漂移即非0）
//
// 约束：
//   - bootstrap 安全守卫：仅标记「两侧规范化同体」的函数（防止把 site-admin
//     的分叉版本静默覆盖成 public 版本）；分叉函数先人工移植收敛再入清单。
//   - 函数必须在两侧各恰好出现 1 次（重名/缺失即红灯，防错位替换）。
//   - 权威源已删除的清单函数 → 红灯（从 SYNCED_FNS 移除，并决定 site-admin 侧去留）。
//   - 孤儿标记（标记存在但函数不在清单）→ 红灯。
// ============================================================================
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const AUTHORITY_REL = 'public/index.html';
const TARGET_REL = 'site-admin/index.html';

// ★ 收敛台账（= 2026-09-13 diff-cross-version tierB_sameBody 快照）：
//   新增条目流程：把函数移植到两侧规范化同体 → 在此登记函数名 → 跑同步。
const SYNCED_FNS = [
    '_isGenericLoginName', 'analyzeDiseases', 'analyzePatients', 'analyzeVisitTrend',
    'applyFormula', 'buildMedicineMap', 'clearRecycleBin', 'closeMediaViewer',
    'closeModal', 'deleteRow', 'formatDate', 'formatPrice',
    'getMedicineByName', 'getPinyinCode', 'getRecycleBin', 'handleInput',
    'handleKeyboard', 'handleSearchKeyDown', 'handleSearchKeyPress', 'hidePatientNameDropdown',
    'loadLastHistory', 'loadPatientHistory', 'markGenderManual', 'mediaLabelOf',
    'mediaViewerNav', 'removeDuplicateMedicines', 'renderMediaViewerSingle', 'resetCaseSearch',
    'saveRecycleBin', 'searchCases', 'selectSearchResult', 'smartMatchGender',
    'sortPrescriptionsByTimeDesc', 'startSearch', 'toggleGender', 'toggleUsernameDropdown',
    'tryHideSearch', 'updateDosage', 'updateMedicineFrequency', 'updateSearchSelection',
    'updateUnit', 'wrapText',
];

// —— 与 diff-cross-version.cjs 完全同款 normalizeSpan（字符串感知剔空白+注释）——
//   两处算法必须保持一致（同体判定口径统一），改动须双侧同步。
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

// —— async 感知 + 字符串/注释感知括号配平的函数整段提取 ——
// （sync-shared-blocks.cjs findFunctionSpan 的增强版：async 前缀、参数列表
//   含嵌套括号安全、`//`与`/* */`注释跳过）
function findSpans(src, name) {
    const re = new RegExp('(?:async\\s+)?function\\s+' + name + '\\s*\\(', 'g');
    const out = [];
    let m;
    while ((m = re.exec(src)) !== null) {
        // 参数列表括号配平（找函数体起始 `{`）
        let i = src.indexOf('(', m.index);
        let pd = 0;
        while (i < src.length) {
            const c = src[i];
            if (c === "'" || c === '"') { const q = c; i++; while (i < src.length && src[i] !== q) { if (src[i] === '\\') i++; i++; } }
            else if (c === '(') pd++;
            else if (c === ')') { pd--; if (pd === 0) break; }
            i++;
        }
        if (pd !== 0) throw new Error('函数 ' + name + ' 参数括号不平衡');
        // 函数体花括号配平
        i = src.indexOf('{', i);
        let d = 0;
        while (i < src.length) {
            const c = src[i];
            if (c === "'" || c === '"') { const q = c; i++; while (i < src.length && src[i] !== q) { if (src[i] === '\\') i++; i++; } }
            else if (c === '`') { i++; while (i < src.length && src[i] !== '`') { if (src[i] === '\\') i++; i++; } }
            else if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; }
            else if (c === '/' && src[i + 1] === '*') { i += 2; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++; i++; }
            else if (c === '{') d++;
            else if (c === '}') { d--; if (d === 0) break; }
            i++;
        }
        if (d !== 0) throw new Error('函数 ' + name + ' 花括号不平衡');
        // 起点行首缩进（async 前缀已被正则含入 m.index）；终点含行尾换行
        let s = m.index;
        while (s > 0 && (src[s - 1] === ' ' || src[s - 1] === '\t')) s--;
        let e = i + 1;
        if (src[e] === '\r') e++;
        if (src[e] === '\n') e++;
        out.push({ start: s, end: e, span: src.slice(s, e) });
    }
    return out;
}

// —— 标记块定位/构建 ——
function markerBegin(name, indent) {
    return indent + '// >>> SYNCED-FN ' + name + ' (由 public/index.html 权威源自动同步 via tools/sync-siteadmin.cjs — 勿手改，改 public 后跑同步) ===';
}
function markerEnd(name, indent) {
    return indent + '// <<< SYNCED-FN-END ' + name + ' ===';
}
// 已标记区域：返回 {beginStart, regionEnd, innerStart, innerEnd}
function findMarkedRegion(html, name) {
    const beginRe = new RegExp('^([ \\t]*)// >>> SYNCED-FN ' + name + ' [^\\n]*\\n', 'm');
    const bm = beginRe.exec(html);
    if (!bm) return null;
    const beginStart = bm.index;
    const innerStart = beginStart + bm[0].length;
    const endRe = new RegExp('^([ \\t]*)// <<< SYNCED-FN-END ' + name + ' ===\\r?\\n?', 'm');
    const em = endRe.exec(html.slice(innerStart));
    if (!em) throw new Error('SYNCED-FN ' + name + ' 有起始标记无结束标记');
    const innerEnd = innerStart + em.index;
    const regionEnd = innerStart + em.index + em[0].length;
    return { beginStart, innerStart, innerEnd, regionEnd, indent: bm[1] };
}

// EOL 防御性归一（两文件当前均 LF；万一被编辑器改 CRLF 也不误报）
const eol = (s) => s.replace(/\r\n/g, '\n');

function run(checkOnly) {
    const authPath = path.join(ROOT, AUTHORITY_REL);
    const tgtPath = path.join(ROOT, TARGET_REL);
    const A = fs.readFileSync(authPath, 'utf8');
    let B = fs.readFileSync(tgtPath, 'utf8');

    let ok = true;
    const edits = []; // {start, end, text} —— 倒序应用
    let synced = 0, already = 0, bootstrapped = 0;

    // 孤儿标记扫描
    const orphanRe = /\/\/ >>> SYNCED-FN ([A-Za-z_$][\w$]*) /g;
    let om;
    const markedNames = new Set();
    while ((om = orphanRe.exec(B)) !== null) markedNames.add(om[1]);
    for (const n of markedNames) {
        if (!SYNCED_FNS.includes(n)) {
            console.log('[FAIL] 孤儿标记 SYNCED-FN ' + n + '：函数不在 tools/sync-siteadmin.cjs SYNCED_FNS 清单（清单删项后标记残留）');
            ok = false;
        }
    }

    for (const name of SYNCED_FNS) {
        try {
            // 权威源侧：恰好 1 处
            const authSpans = findSpans(A, name);
            if (authSpans.length !== 1) {
                console.log('[FAIL] ' + name + '：public 权威源出现 ' + authSpans.length + ' 次（期望 1）' +
                    (authSpans.length === 0 ? '——权威源已删除该函数？从 SYNCED_FNS 移除并决定 site-admin 侧去留' : '——重名函数，需人工处理'));
                ok = false;
                continue;
            }
            const authSpan = authSpans[0].span;

            // site-admin 侧：标记块优先
            let region = null;
            try { region = findMarkedRegion(B, name); } catch (e) {
                console.log('[FAIL] ' + name + '：' + e.message);
                ok = false;
                continue;
            }
            if (region) {
                const inner = B.slice(region.innerStart, region.innerEnd);
                if (eol(inner) === eol(authSpan)) { already++; continue; }
                if (checkOnly) {
                    console.log('[FAIL] ' + name + '：标记块与 public 权威源不一致（漂移——改了 public 未跑同步，或有人手改标记块）');
                    ok = false;
                    continue;
                }
                // 命中标记但内容落后：以权威源刷新（保留标记缩进）
                const indent = region.indent;
                const mB = markerBegin(name, indent), mE = markerEnd(name, indent);
                edits.push({ start: region.beginStart, end: region.regionEnd, text: mB + '\n' + authSpan + mE + '\n' });
                bootstrapped++;
                continue;
            }

            // 未标记（bootstrap 候选）：site-admin 侧必须恰好 1 处 + 规范化同体守卫
            const tgtSpans = findSpans(B, name);
            if (tgtSpans.length !== 1) {
                console.log('[FAIL] ' + name + '：site-admin 出现 ' + tgtSpans.length + ' 次（期望 1），无法定位 bootstrap 锚点');
                ok = false;
                continue;
            }
            const tgtSpan = tgtSpans[0];
            if (normalizeSpan(tgtSpan.span) !== normalizeSpan(authSpan)) {
                console.log('[FAIL] ' + name + '：两侧规范化不同体（分叉未收敛）——拒绝 bootstrap（防静默覆盖 site-admin 分叉版本）。先人工移植成同体再登记 SYNCED_FNS');
                ok = false;
                continue;
            }
            if (checkOnly) {
                console.log('[FAIL] ' + name + '：SYNCED_FNS 清单函数未标记（先运行 node tools/sync-siteadmin.cjs 完成 bootstrap）');
                ok = false;
                continue;
            }
            const indent = (tgtSpan.span.match(/^[ \t]*/) || [''])[0];
            const mB = markerBegin(name, indent), mE = markerEnd(name, indent);
            edits.push({ start: tgtSpan.start, end: tgtSpan.end, text: mB + '\n' + authSpan + mE + '\n' });
            bootstrapped++;
        } catch (e) {
            console.log('[FAIL] ' + name + '：提取异常 ' + e.message);
            ok = false;
        }
    }

    // 应用编辑（倒序，避免偏移漂移）
    if (!checkOnly && edits.length > 0) {
        edits.sort((a, b) => b.start - a.start);
        for (const ed of edits) B = B.slice(0, ed.start) + ed.text + B.slice(ed.end);
        fs.writeFileSync(tgtPath, B, 'utf8');
    }

    synced = already + bootstrapped;
    console.log('site-admin 共享函数层: 已最新 ' + already + ' | 本次' + (checkOnly ? '漂移' : '同步') + ' ' + bootstrapped +
        ' | 清单 ' + SYNCED_FNS.length + ' 函数' + (edits.length > 0 ? '（净改写 ' + edits.length + ' 处标记块）' : ''));
    if (ok) console.log(checkOnly ? '[PASS] site-admin 共享函数层 ALL PASS ✓' : '[DONE] site-admin 共享函数层同步完成');
    else console.log(checkOnly ? '[FAIL] site-admin 共享函数层存在漂移（运行 node tools/sync-siteadmin.cjs 同步后提交）' : '[FAIL] site-admin 同步有失败项');
    return ok;
}

module.exports = { run, SYNCED_FNS, findSpans, normalizeSpan };

if (require.main === module) {
    const checkOnly = process.argv.includes('--check');
    const ok = run(checkOnly);
    process.exit(ok ? 0 : 1);
}
