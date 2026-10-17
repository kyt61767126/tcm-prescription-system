// ============================================================================
//  html-fn-extract.cjs — 从 index.html 类文件里按函数名抽取函数本体（共享小工具）
//
//  为什么要单独一个文件：仓内已有 5+ 个门禁脚本各自内联了一份"括号配平抽取器"，
//  且**都不支持 async function**（P1-④ 的被测函数 getGlobalMaxSerial 恰是 async）。
//  本文件把字符串/注释/模板串感知的抽取器收口成一份，供：
//    · tools/prescriptions-ready-gate-test.cjs（P1-④ 门禁）
//    · tools/_tmp-* 之类的临时对比脚本
//  使用。抽取失败即抛错（宁可失败也不静默返回空串——空串会让断言"看起来通过"）。
// ============================================================================
'use strict';

// 抽取第一个名为 name 的 (async) function 本体（含 async 前缀；到匹配大括号为止）
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

// 抽取全部同名副本（用于"六端同体"这类断言）
function extractAllFunctions(src, name) {
    const re = new RegExp('(?:async\\s+)?function\\s+' + name + '\\s*\\([^)]*\\)\\s*\\{', 'g');
    const out = [];
    let m;
    while ((m = re.exec(src)) !== null) {
        // 复用单函数抽取：从该匹配位置起算
        const body = extractFunction(src.substring(m.index), name);
        out.push(body);
    }
    return out;
}

module.exports = { extractFunction, extractAllFunctions };
