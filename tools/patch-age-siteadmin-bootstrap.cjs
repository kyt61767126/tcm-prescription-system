#!/usr/bin/env node
/**
 * 患者年龄按历史记录自动更新 —— site-admin 共享函数层 bootstrap
 * ============================================================
 * 背景：selectPatientName 是 site-admin 的 SYNCED-FN（tools/sync-siteadmin.cjs
 *       SYNCED_FNS 清单成员），其内容由 public/index.html 权威源机械同步。
 *       本次改动让 selectPatientName 调用两个新辅助函数
 *       historyRecordYear / deriveCurrentAgeFromHistory，而 site-admin 侧尚无
 *       这两个函数 —— 若直接跑 sync-siteadmin，site-admin 会同步到一个调用
 *       未定义函数的 selectPatientName，选中患者时抛 ReferenceError。
 *
 * 依据 sync-siteadmin.cjs 头注的「新增条目流程」：
 *   把函数移植到两侧规范化同体 → 在此登记函数名 → 跑同步。
 *   本脚本完成前两步（第 3 步由 sync-siteadmin.cjs 完成）：
 *     1) 从 public/index.html 权威源按字节原样抽取两个辅助函数（含注释块）
 *     2) 插入 site-admin/index.html 的 selectPatientName 标记块之前
 *     3) 在两个 SYNCED_FNS 清单的字母序位置登记函数名
 *
 * 用法：
 *   node tools/patch-age-siteadmin-bootstrap.cjs --dry-run
 *   node tools/patch-age-siteadmin-bootstrap.cjs
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const AUTH = path.join(ROOT, 'public', 'index.html');
const TGT = path.join(ROOT, 'site-admin', 'index.html');
const TOOL = path.join(ROOT, 'tools', 'sync-siteadmin.cjs');
const DRY = process.argv.includes('--dry-run');

const HELPER_START = '        // ★ 患者年龄按历史记录自动更新（2026-09-30）';
const HELPER_END_ANCHOR = '        function selectPatientName(name) {';
const SYNC_MARKER = '        // >>> SYNCED-FN selectPatientName ';

const FN_NAMES = ['historyRecordYear', 'deriveCurrentAgeFromHistory'];

function fail(msg) {
    console.error('[bootstrap] FAIL: ' + msg);
    process.exit(1);
}

// ---------- 1. 从权威源抽取辅助函数（字节原样） ----------
const auth = fs.readFileSync(AUTH, 'utf8');
const eol = auth.includes('\r\n') ? '\r\n' : '\n';

const hs = auth.indexOf(HELPER_START);
if (hs < 0) fail('权威源未找到辅助函数注释起点');
const he = auth.indexOf(HELPER_END_ANCHOR, hs);
if (he < 0) fail('权威源未找到 selectPatientName 锚点');
const helper = auth.slice(hs, he);
if (!helper.includes('function historyRecordYear(') || !helper.includes('function deriveCurrentAgeFromHistory(')) {
    fail('抽取区间未同时包含两个辅助函数');
}

// ---------- 2. 插入 site-admin ----------
let tgt = fs.readFileSync(TGT, 'utf8');
const tgtEol = tgt.includes('\r\n') ? '\r\n' : '\n';

if (tgt.includes('function deriveCurrentAgeFromHistory(')) {
    console.log('[bootstrap] site-admin 已含辅助函数，跳过插入（幂等）');
} else {
    const markerCount = tgt.split(SYNC_MARKER).length - 1;
    if (markerCount !== 1) fail('site-admin 中 selectPatientName 标记块命中 ' + markerCount + ' 处（期望 1）');
    // 标记块前一行是空行，辅助函数插到空行之后、标记之前
    const at = tgt.indexOf(SYNC_MARKER);
    const inserted = tgt.slice(0, at) + helper + tgt.slice(at);
    tgt = inserted;
    console.log('[bootstrap] 已将辅助函数插入 site-admin/index.html（' + helper.length + ' 字符）');
}

// ---------- 3. 登记 SYNCED_FNS ----------
let tool = fs.readFileSync(TOOL, 'utf8');
const tEol = tool.includes('\r\n') ? '\r\n' : '\n';

for (const name of FN_NAMES) {
    if (new RegExp("'" + name + "'").test(tool)) {
        console.log("[bootstrap] SYNCED_FNS 已含 '" + name + "'，跳过登记");
        continue;
    }
    // 字母序落位：deriveCurrentAgeFromHistory 在 deleteRow 之后；historyRecordYear 在 hidePatientNameDropdown 之后
    let anchor = null;
    if (name === 'deriveCurrentAgeFromHistory') anchor = "'deleteRow',";
    else if (name === 'historyRecordYear') anchor = "'hidePatientNameDropdown',";
    if (!anchor) fail('未定义 ' + name + ' 的落位锚点');

    const cnt = tool.split(anchor).length - 1;
    if (cnt !== 1) fail('SYNCED_FNS 落位锚点 ' + anchor + ' 命中 ' + cnt + ' 处（期望 1）');

    tool = tool.replace(anchor, anchor + ' ' + "'" + name + "',");
    console.log("[bootstrap] 已登记 SYNCED_FNS: '" + name + "'（落位 " + anchor + " 之后）");
}

// ---------- 4. 落盘 ----------
if (DRY) {
    console.log('[bootstrap] DRY RUN —— 未写入任何文件');
} else {
    fs.writeFileSync(TGT, tgt, 'utf8');
    fs.writeFileSync(TOOL, tool, 'utf8');
    console.log('[bootstrap] 已写入 site-admin/index.html 与 tools/sync-siteadmin.cjs');
    console.log('[bootstrap] 下一步：node tools/sync-siteadmin.cjs');
}
