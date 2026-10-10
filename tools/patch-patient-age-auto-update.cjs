#!/usr/bin/env node
/**
 * 患者年龄按历史记录自动更新 —— 多版本同步补丁
 * ============================================================
 * 背景：数据模型没有「出生日期」，历史处方只存开方当时的年龄
 *       (record.patientAge)。原来的 selectPatientName() 把最新一条
 *       记录的年龄原样回填，导致 2023 年记录 45 岁的患者到 2026 年
 *       仍然带出 45 岁。
 *
 * 本补丁：
 *   1) 注入 historyRecordYear() / deriveCurrentAgeFromHistory() 两个纯函数：
 *        出生年 = 记录年份 − 当时年龄
 *      记录年份优先取 date（补录历史处方以所录日期为准），退回 visitDate，
 *      再退回 createdAt。取出现次数最多的出生年（并列时取距今最近的记录），
 *      当前年龄 = 当前年份 − 出生年。
 *      例：2023-05-01 记录 45 岁 → 2026 年自动带出 48 岁。
 *      异常值（年龄 ≤0 或 >150、年份越界）剔除；无有效记录时返回 ''。
 *   2) 改写 selectPatientName()：用推算年龄回填，推算不出时回退旧行为
 *      （原样沿用最新记录年龄），保证向后兼容。
 *   3) 同步改写 injectVoiceUI() 内已停用但仍在维护的语音历史联动分支，
 *      保持与 selectPatientName 口径一致（代码注释要求两者一致）。
 *
 * 用法：
 *   node tools/patch-patient-age-auto-update.cjs --dry-run   # 只校验锚点
 *   node tools/patch-patient-age-auto-update.cjs             # 实际写入权威源
 *
 * ★ 本脚本只改权威源；副本由 tools/sync-html.ps1、tools/sync-index-app.cjs、
 *   tools/sync-siteadmin.cjs 生成。严禁写入 public/hot-update/**（已发布热包快照）。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DRY_RUN = process.argv.includes('--dry-run');
const DATE_TAG = '2026-09-30';

// 只改「权威源」。生成副本一律由仓库既有生成器传播，禁止手工改副本：
//   public/index.html（云端权威源）
//     └─ tools/sync-html.ps1      → cloud_desktop/index.html、cloud_app assets
//     └─ tools/sync-siteadmin.cjs → site-admin/index.html（selectPatientName 是 SYNCED-FN）
//   app_project/db-offline/desktop/index.html（离线权威源）
//     └─ tools/sync-index-app.cjs → db-offline/index-app.html、db-offline app assets
//   鸿蒙 rawfile 当前是「过期快照」（与云APP assets 24 个文件里 23 个不同），
//   跑 copy-assets.cjs 会带入 ~113KB 无关漂移，故本次定点补丁，单独维护。
//
// ★ 严禁改 public/hot-update/**：那是「已发布热包快照，永不改写」
//   （tools/check-cv-hashes.cjs 头注铁律），改了会让快照 sha256 与
//   version.json 不符、客户端验签失败。热包由 generate-*-hotupdate.cjs 发布时再生。
const TARGETS = [
    'public/index.html',
    'app_project/db-offline/desktop/index.html',
    'app_project_harmony/huikang-cloud/entry/src/main/resources/rawfile/index.html',
];

// 防呆：任何落入已发布热包快照的路径一律拒绝
const FORBIDDEN = /public[\\/]hot-update[\\/]/;

const HELPER_MARK = 'function deriveCurrentAgeFromHistory(';

// ---------- 注入的辅助函数（纯函数，无外部依赖） ----------
const HELPER_LINES = [
    '        // ★ 患者年龄按历史记录自动更新（' + DATE_TAG + '）',
    '        //   数据模型无「出生日期」，历史处方只存开方当时的年龄。此处反推出生年：',
    '        //       出生年 = 记录年份 − 当时年龄',
    '        //   记录年份优先取处方日期 date（补录历史处方以所录日期为准），退回',
    '        //   visitDate，再退回 createdAt；异常值（年龄 ≤0 或 >150、年份越界）剔除。',
    '        //   取出现次数最多的出生年（并列时取距今最近的记录），',
    '        //   当前年龄 = 当前年份 − 出生年。例：2023-05-01 记 45 岁 → 2026 年得 48 岁。',
    '        //   说明：仅年份粒度，当年未过生日的患者会提前 1 岁；推算不出时由调用方回退旧值。',
    '        function historyRecordYear(rec) {',
    '            if (!rec) return 0;',
    "            var m = String(rec.date || rec.visitDate || '').match(/(\\d{4})/);",
    '            if (m) {',
    '                var y = parseInt(m[1], 10);',
    '                if (y >= 1900 && y <= 2200) return y;',
    '            }',
    '            if (rec.createdAt) {',
    '                var y2 = new Date(rec.createdAt).getFullYear();',
    '                if (isFinite(y2) && y2 >= 1900 && y2 <= 2200) return y2;',
    '            }',
    '            return 0;',
    '        }',
    '',
    '        function deriveCurrentAgeFromHistory(records, refYear) {',
    "            if (!records || !records.length) return '';",
    '            var nowYear = parseInt(refYear, 10) || new Date().getFullYear();',
    '            var tally = {}, best = null, k;',
    '            for (var i = 0; i < records.length; i++) {',
    '                var rec = records[i];',
    '                if (!rec) continue;',
    '                var age = parseInt(rec.patientAge, 10);',
    '                if (!isFinite(age) || age <= 0 || age > 150) continue;',
    '                var ry = historyRecordYear(rec);',
    '                if (!ry || ry > nowYear) continue;',
    '                var birthYear = ry - age;',
    '                if (birthYear < 1900 || birthYear > nowYear) continue;',
    '                if (!tally[birthYear]) tally[birthYear] = { n: 0, gap: Infinity };',
    '                tally[birthYear].n++;',
    '                var gap = Math.abs(nowYear - ry);',
    '                if (gap < tally[birthYear].gap) tally[birthYear].gap = gap;',
    '            }',
    '            for (k in tally) {',
    '                if (!Object.prototype.hasOwnProperty.call(tally, k)) continue;',
    '                var cur = tally[k];',
    '                if (!best || cur.n > best.n || (cur.n === best.n && cur.gap < best.gap)) {',
    '                    best = { birthYear: parseInt(k, 10), n: cur.n, gap: cur.gap };',
    '                }',
    '            }',
    "            if (!best) return '';",
    '            var nowAge = nowYear - best.birthYear;',
    "            if (!isFinite(nowAge) || nowAge <= 0 || nowAge > 150) return '';",
    '            return String(nowAge);',
    '        }',
    '',
];

// ---------- selectPatientName 内年龄回填块 ----------
const AGE_BLOCK_RE = new RegExp(
    [
        '([ \\t]*)const latestRecord = patientRecords\\[0\\];\\r?\\n',
        '[ \\t]*if \\(latestRecord\\.patientAge\\) \\{\\r?\\n',
        "[ \\t]*document\\.getElementById\\('patientAge'\\)\\.value = latestRecord\\.patientAge;\\r?\\n",
        '[ \\t]*\\}',
    ].join('')
);

const HARMONY_FILTER_RE = /const patientRecords = prescriptionHistory\.filter\(p =>p\.patientName === name\);/;

function ageBlockReplacement(indent, eol, isHarmony) {
    const I = indent;
    const lines = [
        I + 'const latestRecord = patientRecords[0];',
        I + '// ★ 患者年龄按历史记录自动更新（' + DATE_TAG + '）：不再原样沿用历史记录里的',
        I + '//   旧年龄，改用全部同名历史记录反推出生年，再按当前年份算出当前年龄。',
    ];
    if (!isHarmony) {
        lines.push(
            I + '//   精确同名优先，避免「王明」被「王明华」的记录污染年龄（电话/地址维持原逻辑）。',
            I + 'const exactRecs = filterPrescriptionsByPermission(prescriptionHistory).filter(p =>',
            I + '    p && p.patientName && String(p.patientName).trim() === String(name).trim()',
            I + ');',
            I + 'const derivedAge = deriveCurrentAgeFromHistory(exactRecs.length ? exactRecs : patientRecords);'
        );
    } else {
        lines.push(
            I + 'const derivedAge = deriveCurrentAgeFromHistory(patientRecords);'
        );
    }
    lines.push(
        I + "if (derivedAge !== '') {",
        I + '    document.getElementById(\'patientAge\').value = derivedAge;',
        I + '    // 仅在推算值与历史记录原值不一致时提示，避免无变化时打扰',
        I + "    if (String(latestRecord.patientAge || '') !== String(derivedAge)) {",
        I + "        showToast('年龄已按历史记录自动更新为 ' + derivedAge + ' 岁');",
        I + '    }',
        I + '} else if (latestRecord.patientAge) {',
        I + '    document.getElementById(\'patientAge\').value = latestRecord.patientAge;',
        I + '}'
    );
    return lines.join(eol);
}

// ---------- 语音历史联动分支（injectVoiceUI 内，8 个副本有） ----------
const VOICE_BLOCK_RE = /[ \t]*if \(lr\.patientAge\) \{ var ae = q\('patientAge'\); if \(ae\) \{ ae\.value = lr\.patientAge; VoiceInput\.highlight\(ae\); \} \}/;

function voiceBlockReplacement(indent, eol) {
    const I = indent;
    return [
        I + '// ★ 年龄按历史记录自动更新（与 selectPatientName 口径一致）',
        I + 'var vAge = deriveCurrentAgeFromHistory(recs);',
        I + "if (vAge === '') vAge = lr.patientAge || '';",
        I + "if (vAge) { var ae = q('patientAge'); if (ae) { ae.value = vAge; VoiceInput.highlight(ae); } }",
    ].join(eol);
}

// ---------- 主流程 ----------
let failed = 0;
const results = [];

for (const rel of TARGETS) {
    const abs = path.join(ROOT, rel);
    const report = { rel, ok: false, notes: [] };

    if (FORBIDDEN.test(rel)) {
        report.notes.push('拒绝：已发布热包快照永不改写（见文件头铁律）');
        results.push(report);
        failed++;
        continue;
    }

    if (!fs.existsSync(abs)) {
        report.notes.push('文件不存在');
        results.push(report);
        failed++;
        continue;
    }

    let src = fs.readFileSync(abs, 'utf8');
    const eol = src.includes('\r\n') ? '\r\n' : '\n';
    const isHarmony = HARMONY_FILTER_RE.test(src);

    // 0) 规范化：辅助函数与 selectPatientName 之间补空行（幂等）
    const TIGHT_RE = /([ \t]*\}\r?\n)([ \t]*function selectPatientName\(name\) \{)/;
    if (TIGHT_RE.test(src) && !/(\r?\n)[ \t]*\r?\n[ \t]*function selectPatientName\(name\) \{/.test(src)) {
        src = src.replace(TIGHT_RE, (m, closeBrace) => closeBrace + eol + '        function selectPatientName(name) {');
        report.notes.push('已补函数间空行');
        if (!DRY_RUN) fs.writeFileSync(abs, src, 'utf8');
    }

    // 0b) 规范化：补上「未来日期记录」防御（幂等）
    const STALE_GUARD_RE = /([ \t]*)var ry = historyRecordYear\(rec\);\r?\n[ \t]*if \(!ry\) continue;/;
    if (STALE_GUARD_RE.test(src)) {
        src = src.replace(STALE_GUARD_RE, (m, ind) =>
            ind + 'var ry = historyRecordYear(rec);' + eol + ind + 'if (!ry || ry > nowYear) continue;');
        report.notes.push('已补未来日期防御');
        if (!DRY_RUN) fs.writeFileSync(abs, src, 'utf8');
    }

    if (src.includes(HELPER_MARK)) {
        report.notes.push('已打过补丁（跳过，保持幂等）');
        report.ok = true;
        report.skipped = true;
        results.push(report);
        continue;
    }

    // 1) selectPatientName 年龄块
    const ageMatches = src.match(new RegExp(AGE_BLOCK_RE.source, 'g')) || [];
    if (ageMatches.length !== 1) {
        report.notes.push('年龄回填块匹配数 = ' + ageMatches.length + '（期望 1）');
        results.push(report);
        failed++;
        continue;
    }
    const indentMatch = src.match(AGE_BLOCK_RE);
    const ageIndent = indentMatch[1];
    src = src.replace(AGE_BLOCK_RE, () => ageBlockReplacement(ageIndent, eol, isHarmony));
    report.notes.push('selectPatientName 年龄块已改写');

    // 2) 语音历史联动块（harmony 无）
    const voiceMatches = src.match(new RegExp(VOICE_BLOCK_RE.source, 'g')) || [];
    if (voiceMatches.length === 1) {
        const vm = src.match(VOICE_BLOCK_RE);
        const vIndent = (vm[0].match(/^[ \t]*/) || [''])[0];
        src = src.replace(VOICE_BLOCK_RE, () => voiceBlockReplacement(vIndent, eol));
        report.notes.push('语音历史联动块已改写');
    } else if (voiceMatches.length === 0 && isHarmony) {
        report.notes.push('语音历史联动块不存在（harmony 预期无，OK）');
    } else {
        report.notes.push('语音历史联动块匹配数 = ' + voiceMatches.length + '（期望 1）');
        results.push(report);
        failed++;
        continue;
    }

    // 3) 注入辅助函数（放在 selectPatientName 之前，同一作用域）
    const FN_ANCHOR = '        function selectPatientName(name) {';
    const fnCount = src.split(FN_ANCHOR).length - 1;
    if (fnCount !== 1) {
        report.notes.push('selectPatientName 定义锚点匹配数 = ' + fnCount + '（期望 1）');
        results.push(report);
        failed++;
        continue;
    }
    // 同时保留原有紧邻的注释行
    const helper = HELPER_LINES.join(eol);
    src = src.replace(FN_ANCHOR, () => helper + eol + FN_ANCHOR);
    report.notes.push('辅助函数已注入');

    // 4) 一致性校验
    const checks = [
        [HELPER_MARK, 1, 'deriveCurrentAgeFromHistory 定义'],
        ['function historyRecordYear(', 1, 'historyRecordYear 定义'],
        ['deriveCurrentAgeFromHistory(', 3, 'deriveCurrentAgeFromHistory 调用'],
        ["showToast('年龄已按历史记录自动更新为 ", 1, '年龄更新提示'],
    ];
    let checkOk = true;
    for (const [needle, want, label] of checks) {
        const got = src.split(needle).length - 1;
        const expect = needle === 'deriveCurrentAgeFromHistory(' ? (isHarmony ? 2 : 3) : want;
        if (got !== expect) {
            report.notes.push(label + ' 出现 ' + got + ' 次（期望 ' + expect + '）');
            checkOk = false;
        }
    }
    if (!checkOk) {
        results.push(report);
        failed++;
        continue;
    }

    if (!DRY_RUN) fs.writeFileSync(abs, src, 'utf8');
    report.ok = true;
    report.bytes = Buffer.byteLength(src, 'utf8');
    results.push(report);
}

// ---------- 输出 ----------
console.log(DRY_RUN ? '=== DRY RUN（未写入） ===' : '=== 已写入 ===');
for (const r of results) {
    console.log((r.ok ? '  [OK]  ' : '  [FAIL]') + ' ' + r.rel + (r.skipped ? '  (已存在)' : ''));
    for (const n of r.notes) console.log('           - ' + n);
}
console.log('');
console.log(failed === 0 ? '全部 ' + TARGETS.length + ' 个权威源处理成功。' : '失败 ' + failed + ' 个文件。');
if (failed === 0 && !DRY_RUN) {
    console.log('');
    console.log('下一步：用仓库既有生成器传播副本（禁止手工改副本），然后验证：');
    console.log('  powershell -NoProfile -ExecutionPolicy Bypass -File tools\\sync-html.ps1        # 云端副本');
    console.log('  node tools\\sync-index-app.cjs                                                    # 离线APP产物');
    console.log('  node tools\\sync-siteadmin.cjs                                                    # 管理台 SYNCED-FN');
    console.log('  node tools\\test-patient-age-auto-update.cjs                                      # 三阶段验证');
    console.log('  热包（public/hot-update/**）不要动——发布时由 generate-*-hotupdate.cjs 再生。');
}
process.exit(failed === 0 ? 0 : 1);
