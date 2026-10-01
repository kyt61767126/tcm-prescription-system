#!/usr/bin/env node
/**
 * 患者年龄按历史记录自动更新 —— 全落点验证
 *
 * 分三阶段：
 *   ① 算法：从每个「已打补丁」落点抽取注入的 historyRecordYear /
 *      deriveCurrentAgeFromHistory，在 vm 沙箱编译并跑 15 个用例，
 *      确认所有落点行为完全一致。
 *   ② 语法：定位真正包含 selectPatientName 的 <script> 块单独编译
 *      （离线版 index.html 存在历史遗留的分块问题 script #13，全局校验器会在
 *      该处提前退出，故不能依赖它证明本次改动无语法错误）。
 *   ③ 已发布热包快照守恒：public/hot-update/** 是「已发布热包快照，永不改写」
 *      （tools/check-cv-hashes.cjs 头注铁律），必须仍为原始内容，且 sha256/size
 *      与其 version.json 完全一致——防止有人把功能改动直接刷进已发布快照。
 *
 * 用法: node tools/test-patient-age-auto-update.cjs
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');

// 已打补丁的落点（8 个：权威源 2 + 生成副本 5 + 鸿蒙 1）
const TARGETS = [
    'public/index.html',                                                    // 云端权威源
    'app_project/db-yunduan/cloud_desktop/index.html',                      // ← sync-html.ps1
    'app_project/db-yunduan/cloud_app/app/src/main/assets/public/index.html', // ← sync-html.ps1
    'app_project/db-offline/desktop/index.html',                            // 离线权威源
    'app_project/db-offline/app/app/src/main/assets/public/index.html',     // ← sync-index-app.cjs
    'app_project/db-offline/index-app.html',                                // ← sync-index-app.cjs
    'site-admin/index.html',                                               // ← sync-siteadmin.cjs（SYNCED-FN）
    'app_project_harmony/huikang-cloud/entry/src/main/resources/rawfile/index.html',
];

// 已发布热包快照：必须保持原始内容，sha256/size 与 version.json 一致
const SNAPSHOTS = [
    { html: 'public/hot-update/desktop/cloud/index.html', manifest: 'public/hot-update/desktop/cloud/version.json' },
    { html: 'public/hot-update/desktop/local/index.html', manifest: 'public/hot-update/desktop/local/version.json' },
    { html: 'public/hot-update/app-local/index.html',     manifest: 'public/hot-update/app-local/version.json' },
];

const NOW_YEAR = 2026; // 当前系统年（2026-09-30）

const rec = (date, age, extra) => Object.assign({ date: date, patientAge: age }, extra || {});
const created = (iso, age) => ({ createdAt: iso, patientAge: age });

// [用例说明, 记录数组, 期望结果, 可选 refYear]
const CASES = [
    ['2023 年记 45 岁 → 2026 年应为 48', [rec('2023/05/01', '45')], '48'],
    ['2026 年记 45 岁 → 当年仍为 45', [rec('2026/09/22', '45')], '45'],
    ['多年一致递进：2023=45,2024=46,2025=47 → 出生年 1978 → 48',
        [rec('2025/03/01', 47), rec('2024/03/01', 46), rec('2023/03/01', 45)], '48'],
    ['单条录入异常（2025=50 与其余矛盾）→ 取众数 1978 → 48',
        [rec('2023/01/01', 45), rec('2024/01/01', 46), rec('2025/01/01', 50)], '48'],
    ['出生年各 1 票并列 → 取距今最近的记录（1982）→ 44',
        [rec('2020/01/01', 40), rec('2025/01/01', 43)], '44'],
    ['日期用 - 分隔同样可解析', [rec('2016-06-01', 40)], '50'],
    ['无 date 时回退 createdAt', [created('2019-08-21T10:00:00.000Z', 30)], '37'],
    ['年龄缺省 → 无有效记录 → 返回空串', [{ date: '2020/01/01' }], ''],
    ['年龄超范围(200) → 剔除 → 返回空串', [rec('2020/01/01', 200)], ''],
    ['年龄为 0 → 剔除 → 返回空串', [rec('2020/01/01', 0)], ''],
    ['非数字年龄 → 剔除 → 返回空串', [rec('2020/01/01', '未知')], ''],
    ['空数组 → 返回空串', [], ''],
    ['未来日期记录 → 剔除 → 返回空串', [rec('2030/01/01', 10)], ''],
    ['混合有效/无效：仅有效记录参与，2024=50 → 1974 → 52',
        [rec('2020/01/01', 'abc'), rec('2024/01/01', 50)], '52'],
    ['refYear 显式传入（可复现测试）', [rec('2020/01/01', 40)], '40', 2020],
];

let fail = 0;
const summary = [];

// ---------------- 阶段 ① 算法 ----------------
console.log('=== ① 算法一致性（' + CASES.length + ' 用例 × ' + TARGETS.length + ' 落点）===');
for (const rel of TARGETS) {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) { console.log('  [FAIL] ' + rel + ' —— 文件不存在'); fail++; continue; }
    const src = fs.readFileSync(abs, 'utf8');

    const start = src.indexOf('function historyRecordYear(rec) {');
    const end = src.indexOf('function selectPatientName(name) {');
    if (start < 0 || end < 0 || end <= start) {
        console.log('  [FAIL] ' + rel + ' —— 未能定位注入的辅助函数'); fail++; continue;
    }
    const code = src.slice(start, end);
    const ctx = { Date, Math, isFinite, Object, parseInt, String };
    vm.createContext(ctx);
    try {
        vm.runInContext(code, ctx, { filename: rel + '#agehelpers' });
    } catch (e) {
        console.log('  [FAIL] ' + rel + ' —— 辅助函数语法错误: ' + e.message); fail++; continue;
    }
    if (typeof ctx.deriveCurrentAgeFromHistory !== 'function' || typeof ctx.historyRecordYear !== 'function') {
        console.log('  [FAIL] ' + rel + ' —— 函数未正确定义'); fail++; continue;
    }

    let bad = 0;
    for (const [label, records, expected, refYear] of CASES) {
        let got;
        try { got = ctx.deriveCurrentAgeFromHistory(records, refYear === undefined ? NOW_YEAR : refYear); }
        catch (e) { got = 'THROW: ' + e.message; }
        if (got !== expected) {
            bad++;
            console.log('  [FAIL] ' + rel + '\n         用例：' + label +
                '\n         期望 ' + JSON.stringify(expected) + '，实际 ' + JSON.stringify(got));
        }
    }
    if (bad === 0) summary.push(rel);
    else fail++;
}
for (const s of summary) console.log('  [OK]  ' + s);

// ---------------- 阶段 ② 语法 ----------------
console.log('');
console.log('=== ② 含 selectPatientName 的 <script> 块语法 ===');
for (const rel of TARGETS) {
    const html = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    const re = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
    let m, idx = 0, hit = -1, code = null;
    while ((m = re.exec(html)) !== null) {
        idx++;
        if (m[1].includes('function selectPatientName(name)') && m[1].includes('deriveCurrentAgeFromHistory')) {
            hit = idx; code = m[1]; break;
        }
    }
    if (hit < 0) {
        console.log('  [FAIL] ' + rel + ' —— 未找到同时含 selectPatientName 与 deriveCurrentAgeFromHistory 的脚本块');
        fail++; continue;
    }
    try {
        new vm.Script(code, { filename: rel + '#script' + hit });
        console.log('  [OK]  ' + rel + '  (script #' + hit + ', ' + code.length + ' 字符)');
    } catch (e) {
        console.log('  [FAIL] ' + rel + '  (script #' + hit + ') 语法错误: ' + e.message); fail++;
    }
}

// ---------------- 阶段 ③ 已发布热包快照守恒 ----------------
console.log('');
console.log('=== ③ 已发布热包快照守恒（永不改写铁律）===');
for (const s of SNAPSHOTS) {
    const htmlAbs = path.join(ROOT, s.html);
    const manAbs = path.join(ROOT, s.manifest);
    const buf = fs.readFileSync(htmlAbs);
    const text = buf.toString('utf8');
    const man = JSON.parse(fs.readFileSync(manAbs, 'utf8'));
    const entry = (man.files || []).find((f) => f.name === 'index.html');
    if (!entry) { console.log('  [FAIL] ' + s.manifest + ' 无 index.html 条目'); fail++; continue; }

    const sha = crypto.createHash('sha256').update(buf).digest('hex');
    const problems = [];
    if (text.includes('deriveCurrentAgeFromHistory')) problems.push('快照被写入本次功能改动（应保持原始内容）');
    if (sha !== entry.sha256) problems.push('sha256 与 version.json 不符（快照=' + sha.slice(0, 16) + ' manifest=' + String(entry.sha256).slice(0, 16) + '）');
    if (buf.length !== entry.size) problems.push('size 与 version.json 不符（快照=' + buf.length + ' manifest=' + entry.size + '）');

    if (problems.length) {
        console.log('  [FAIL] ' + s.html);
        for (const p of problems) console.log('         - ' + p);
        fail++;
    } else {
        console.log('  [OK]  ' + s.html + '  (' + sha.slice(0, 16) + ', ' + buf.length + 'B, hotVersion ' + man.hotVersion + ')');
    }
}

console.log('');
if (fail === 0) {
    console.log('全部通过：算法 ' + CASES.length + ' 用例 × ' + TARGETS.length + ' 落点；语法 ' + TARGETS.length +
        ' 处；热包快照 ' + SNAPSHOTS.length + ' 份守恒');
} else {
    console.log('存在 ' + fail + ' 项失败');
}
process.exit(fail === 0 ? 0 : 1);
