#!/usr/bin/env node
/**
 * check-injection-idempotency.cjs —— 注入脚本幂等性防呆门（2026-08-31 新增）
 *
 * 背景（用户实报"V1.0.0 Build 203 Build 203 Build 203..."）：
 *   APP 壳（MainActivity evaluateJavascript）注入的 js2 中，.login-footer 分支
 *   用正则 replace 追加 Build 号且无幂等守卫——onPageFinished 每次触发注入 3 次
 *   （0/600/1500ms 重试），每跑一次就多拼一个 Build。同类 bug 的共性：
 *   【往 DOM 文本"追加"后缀而非整段重写的注入语句，缺"已含目标后缀则跳过"守卫】。
 *
 * 本工具把这个 bug 形态固化为 CI 门禁：
 *   扫描 APP 壳 Java 注入串 + 注入型 JS 资产中的三类高危模式——
 *     A. textContent +=   （字符串追加进文本节点）
 *     B. innerHTML +=     （字符串追加进 HTML）
 *     C. '$1" + xxx       （正则 replace 捕获组 + Java 动态拼接后缀 = 事后追加）
 *   命中行与基线（tools/.injection-baseline.json）比对：
 *     - 新增命中（基线没有）→ exit 1：必须改为幂等写法（整段重写 / indexOf 守卫），
 *       确属已带守卫的合法兜底才允许 --update-baseline 收录并注明理由；
 *     - 基线条目消失（源码已删/改写）→ exit 1：强制清理基线，防止基线腐烂。
 *
 * 用法：
 *   node tools/check-injection-idempotency.cjs                    # 校验模式（CI 用）
 *   node tools/check-injection-idempotency.cjs --update-baseline  # 审查通过后重建基线
 *
 * 扫描范围（注入脚本 = 页面加载后由壳/主进程事后注入的代码，页面自身脚本不在此列）：
 *   - app_project 下所有 .java（递归，排除 build/intermediates 构建产物）
 *   - app_project 下 src/main/assets/video-recorder-inject.js（注入型 JS 资产）
 */

'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BASELINE_PATH = path.join(__dirname, '.injection-baseline.json');

// 三类高危模式（与文件头注释 A/B/C 对应）
const RISKY_PATTERNS = [
  { id: 'A', re: /textContent\s*\+=/ },
  { id: 'B', re: /innerHTML\s*\+=/ },
  { id: 'C', re: /'\$1"\s*\+/ },
];

const SCAN_ROOTS = ['app_project'];
const EXCLUDE_DIR_RE = /[\\/](build|intermediates|node_modules)[\\/]/;
const JS_ASSET_NAME = 'video-recorder-inject.js';

function walk(dir, out) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch (e) { return; }
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    const rel = path.relative(ROOT, full).replace(/\\/g, '/');
    if (ent.isDirectory()) {
      if (EXCLUDE_DIR_RE.test('/' + rel + '/')) continue;
      walk(full, out);
    } else if (ent.isFile()) {
      if (rel.endsWith('.java')) {
        out.push({ rel, reason: 'java-injection' });
      } else if (path.basename(rel) === JS_ASSET_NAME) {
        out.push({ rel, reason: 'injected-js-asset' });
      }
    }
  }
}

function collectHits() {
  const files = [];
  for (const r of SCAN_ROOTS) walk(path.join(ROOT, r), files);
  const hits = [];
  for (const f of files) {
    const lines = fs.readFileSync(path.join(ROOT, f.rel), 'utf8').split(/\r?\n/);
    lines.forEach((line, idx) => {
      for (const p of RISKY_PATTERNS) {
        if (p.re.test(line)) {
          hits.push({
            key: f.rel + '::' + line.trim(),
            file: f.rel,
            lineNo: idx + 1,
            pattern: p.id,
            text: line.trim(),
          });
          break; // 一行只记一次（避免 A+C 双命中重复报）
        }
      }
    });
  }
  hits.sort((a, b) => (a.file + a.lineNo).localeCompare(b.file + String(b.lineNo), 'en', { numeric: true }));
  return hits;
}

function loadBaseline() {
  try {
    const raw = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
    return new Set(Array.isArray(raw.entries) ? raw.entries : []);
  } catch (e) {
    return new Set();
  }
}

const updateMode = process.argv.includes('--update-baseline');
const hits = collectHits();

if (updateMode) {
  const entries = hits.map(h => h.key);
  entries.sort();
  fs.writeFileSync(
    BASELINE_PATH,
    JSON.stringify({
      _comment: [
        '注入脚本幂等性基线：每个条目 = 文件::命中行（trim 后全文）。',
        '新增命中必须先改为幂等写法（整段重写 / indexOf 守卫），确属带守卫的合法兜底才收录。',
        '收录时请在同目录提交说明里注明守卫位置。源码变更导致条目消失时必须同步重建本基线。',
      ],
      entries,
    }, null, 2) + '\n',
    'utf8'
  );
  console.log('[OK] 基线已重建：' + entries.length + ' 条命中收录到 ' + path.basename(BASELINE_PATH));
  process.exit(0);
}

const baseline = loadBaseline();
const newHits = hits.filter(h => !baseline.has(h.key));
const staleEntries = [...baseline].filter(k => !hits.some(h => h.key === k));

let fail = false;

if (newHits.length) {
  fail = true;
  console.error('============================================================');
  console.error('[FAIL] 发现未收录的"非幂等 DOM 追加"注入语句（' + newHits.length + ' 处）：');
  for (const h of newHits) {
    console.error('  [' + h.pattern + '] ' + h.file + ':' + h.lineNo);
    console.error('        ' + (h.text.length > 120 ? h.text.slice(0, 120) + '...' : h.text));
  }
  console.error('------------------------------------------------------------');
  console.error('此类写法曾导致登录页 Build 号重复拼接 bug（Build 203 Build 203 ...）。');
  console.error('修复方式（按优先级）：');
  console.error('  1. 首选：改为整段重写（textContent = 常量 + 变量拼接），天然幂等；');
  console.error('  2. 或：注入前 indexOf 守卫——"已含目标后缀则跳过"（见双 MainActivity js2）；');
  console.error('  3. 更优：注入数据 window.__APP_BUILD__ 后调页面自己的渲染函数重渲染。');
  console.error('若确属已带守卫的合法兜底，审查通过后运行：');
  console.error('  node tools/check-injection-idempotency.cjs --update-baseline');
  console.error('============================================================');
}

if (staleEntries.length) {
  fail = true;
  console.error('[FAIL] 基线存在过期条目（源码已无此命中，基线未同步清理）：');
  for (const k of staleEntries) console.error('  ' + k);
  console.error('请运行 node tools/check-injection-idempotency.cjs --update-baseline 重建基线。');
}

if (!fail) {
  console.log('[OK] 注入脚本幂等性检查通过：' + hits.length + ' 处命中全部在基线内（均为带守卫的合法兜底），无新增非幂等追加。');
}
process.exit(fail ? 1 : 0);
