#!/usr/bin/env node
// ============================================================================
// check-cv-hashes.cjs — index.html 业务 JS 内容哈希 cv 校验/重刷（铁闸/门禁⑪）
//
// 架构目的（2026-09-14 云端APP打开提速建门）：
//   根级业务 JS 改走「内容哈希 cv + immutable 长缓存」（_headers 精确规则），
//   缓存键 = 完整 URL 含 query —— 内容变 → cv 变 → URL 变 → 必拉新，长缓存自失效。
//   历史教训（2026-08-20 auth-core 强缓存 24h 不生效）的复发条件是「JS 内容
//   变了但引用 URL 没变」——本门禁强制 public/index.html 中每个 script src
//   的 cv 参数 === 该文件当前内容的 SHA-256 前 8 位，忘 bump 即 push 拦截。
//
// 覆盖目标（14 个）：public/index.html 引用的 13 个根级 JS + electron/video-recorder.js
//   （video-recorder 历史用 ?v= 参数，统一归一为 ?cv=）。
//   不覆盖：public/hot-update/**（已发布热包快照，永不改写）、
//   public/electron/login.html（相对引用解析到 /electron/*.js 独立副本，非本门范围）。
//
// 用法：
//   node tools/check-cv-hashes.cjs            # 校验（cv 不符 → exit 1 阻断）
//   node tools/check-cv-hashes.cjs --update   # 重刷 public/index.html 的 cv 参数
// 已接入 .githooks/pre-push 第⑪道门。
// 标准工作流：改 shared/ 权威源 → sync-all.ps1 → 本工具 --update → sync-html.ps1 → push
// ============================================================================
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const HTML = path.join(ROOT, 'public', 'index.html');
const updateMode = process.argv.includes('--update');

// 14 个目标：public/ 下的相对路径（= 页面 src 引用串）
// ★ 2026-09-17 语音连报修复：补 voice-input.js——它曾用手写日期式 cv=20260917
//   不在门禁清单，内容变更后 cv 不刷 = 已访问用户 immutable 缓存永不生效。
const TARGETS = [
    'auth-core.js',
    'permission.js',
    'normalize-config.js',
    'debug-logger.js',
    'print-utils.js',
    'medicine-dict.js',
    'symptom-dict.js',
    'cloud-api.js',
    'performance-utils.js',
    'prescription-core.js',
    'stock-core.js',
    'security-guard.js',
    'voice-input.js',
    'electron/video-recorder.js'
];

function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sha8(filePath) {
    const buf = fs.readFileSync(filePath);
    // ★ 2026-09-17 根治「本地⑪绿 / CI 8-8 连红」：哈希统一按「git 入库规范化后
    //   内容」（CRLF→LF）计算——Windows 磁盘 CRLF 文件（auth-core/medicine-dict/
    //   performance-utils）与 git eol 入库转 LF 曾致本地按 CRLF 校验全绿、CI 按
    //   LF checkout 校验必红（KNOWLEDGE 2026-09-14 热包 CRLF 入库哈希漂移教训的
    //   门禁版同款）。CI checkout / Cloudflare Pages 线上部署均为 LF，与本地同基线。
    const normalized = buf.toString('utf8').replace(/\r\n/g, '\n');
    return crypto.createHash('sha256').update(normalized, 'utf8').digest('hex').slice(0, 8);
}

if (!fs.existsSync(HTML)) {
    console.error('[cv-hash] public/index.html 不存在');
    process.exit(1);
}

let html = fs.readFileSync(HTML, 'utf8');
const original = html;
const mismatches = [];

for (const t of TARGETS) {
    const jsPath = path.join(ROOT, 'public', t);
    if (!fs.existsSync(jsPath)) {
        console.error('[cv-hash] 目标文件不存在: public/' + t);
        process.exit(1);
    }
    const hash = sha8(jsPath);
    // 恰好命中 1 处 script src（缺引用/重复引用均大声失败，禁脆弱锚点）
    const re = new RegExp('src="' + escapeRegExp(t) + '(\\?(?:cv|v)=[A-Za-z0-9]+)?"', 'g');
    const matches = html.match(re);
    if (!matches || matches.length !== 1) {
        console.error('[cv-hash] public/index.html 中 src="' + t + '" 命中 ' +
            (matches ? matches.length : 0) + ' 处（预期恰好 1 处）——引用缺失或重复，禁止盲改');
        process.exit(1);
    }
    const expected = 'src="' + t + '?cv=' + hash + '"';
    if (matches[0] !== expected) {
        mismatches.push({ target: t, current: matches[0], expected: expected });
        if (updateMode) {
            html = html.replace(re, expected);
        }
    }
}

if (updateMode) {
    if (html !== original) {
        fs.writeFileSync(HTML, html, 'utf8');
        console.log('[cv-hash] 已重刷 ' + mismatches.length + ' 个 cv 参数：');
        for (const m of mismatches) {
            console.log('  ' + m.current + '  →  ' + m.expected);
        }
        console.log('[cv-hash] 提醒：记得跑 tools/sync-html.ps1 传播 index.html 副本后推送');
    } else {
        console.log('[cv-hash] 全部 13 个 cv 参数已是最新（幂等，零改动）');
    }
    process.exit(0);
}

if (mismatches.length > 0) {
    console.error('[cv-hash] FAIL：' + mismatches.length + ' 个业务 JS 的 cv 参数与文件内容哈希不一致：');
    for (const m of mismatches) {
        console.error('  ' + m.current + '  ≠  ' + m.expected);
    }
    console.error('[cv-hash] 修复：node tools/check-cv-hashes.cjs --update 重刷 cv，');
    console.error('       再跑 tools/sync-html.ps1 传播副本（云桌面/云APP assets），然后重推。');
    console.error('       背景：业务 JS 内容变更后必须 bump cv，否则 immutable 长缓存下线上不生效。');
    process.exit(1);
}

console.log('[cv-hash] OK：' + TARGETS.length + ' 个业务 JS 的 cv 参数全部与内容哈希一致');
process.exit(0);
