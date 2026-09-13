#!/usr/bin/env node
// ============================================================================
//  sync-index-app.cjs —— 离线APP index.html 生成器（P1-B1 收口核心）
//
//  架构（KNOWLEDGE §2「2 权威源 + 全自动传播链」）：
//    离线桌面权威源 app_project/db-offline/desktop/index.html
//      └─ 应用 33 条字面变换（tools/index-app-transforms.cjs）
//           ├─→ app_project/db-offline/index-app.html（离线APP权威产物）
//           └─→ app_project/db-offline/app/app/src/main/assets/public/index.html
//                （assets 打包兜底副本；build-app.bat 原样拷贝，不再手工维护）
//
//  铁律：
//    1. mustReplaceOnce：每条 find 在应用序中恰好命中 1 次（indexOf ===
//       lastIndexOf），失配 exit 1 并输出 id/desc/find 前 80 字符/修复指引。
//    2. 全量校验通过才落盘（先在内存完成全部变换，再写文件）。
//    3. 防呆：锚点禁止落入 >>> USER-STORE / USER-ADMIN <<< 标记块（该块由
//       sync-shared-blocks.cjs 管理，工作流顺序 = 先 sync-shared-blocks 再跑本生成器）。
//    4. 同一 buffer 双写，落盘后 SHA256 自校验两份一致。
//    5. 幂等：输入不变 → 输出不变（锚点全部定义在权威源上）。
//
//  用法：
//    node tools/sync-index-app.cjs              # 生成（写 index-app + assets）
//    node tools/sync-index-app.cjs --verify-only # 只校验不落盘（漂移守卫，
//                                                # 供 CI / pre-push 使用）
// ============================================================================
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const TRANSFORMS = require('./index-app-transforms.cjs');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'app_project/db-offline/desktop/index.html');
const OUT_MAIN = path.join(ROOT, 'app_project/db-offline/index-app.html');
const OUT_ASSETS = path.join(ROOT, 'app_project/db-offline/app/app/src/main/assets/public/index.html');
const MARKER_NAMES = ['USER-STORE', 'USER-ADMIN'];

const verifyOnly = process.argv.includes('--verify-only');

function fail(msg) {
  console.error('[sync-index-app] FAIL: ' + msg);
  process.exit(1);
}

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

// ---- 1. 读权威源 ----
let desk;
try {
  desk = fs.readFileSync(SRC, 'utf8');
} catch (e) {
  fail('读权威源失败: ' + SRC + ' — ' + e.message);
}

// ---- 2. 顺序应用变换（mustReplaceOnce + 标记块防呆）----
let cur = desk;
TRANSFORMS.forEach((t) => {
  const p = cur.indexOf(t.find);
  if (p < 0) {
    fail(
      '锚点丢失 [' + t.id + '] ' + t.desc + '\n' +
      '  find 前 80 字符: ' + JSON.stringify(t.find.slice(0, 80)) + '\n' +
      '  修复指引: 权威源该处内容已变化（或本表条目过期）。请对照 index-app.html\n' +
      '  差异更新 tools/index-app-transforms.cjs 的该条 find/replace；\n' +
      '  若为新增 APP 专属改动，在表中追加新条目（参考 tools/_tmp/extract-transforms.cjs）。'
    );
  }
  if (cur.indexOf(t.find, p + 1) !== -1) {
    fail(
      '锚点非唯一 [' + t.id + '] ' + t.desc + '\n' +
      '  find 前 80 字符: ' + JSON.stringify(t.find.slice(0, 80)) + '\n' +
      '  修复指引: find 在应用序中出现多次。请延长该条 find（纳入更多上下文行）\n' +
      '  直到唯一命中；禁止依赖出现顺序的脆弱锚点。'
    );
  }
  // 标记块保护（应用序坐标下精确判定区间重叠）
  for (const name of MARKER_NAMES) {
    const sTag = '// >>> ' + name;
    const eTag = '// <<< ' + name + '-END';
    const s = cur.indexOf(sTag);
    if (s === -1) continue;
    const e = cur.indexOf(eTag, s);
    if (e === -1) continue;
    if (p < e + eTag.length && p + t.find.length > s) {
      fail(
        '锚点落入标记块 [' + t.id + '] ' + t.desc + '\n' +
        '  ' + sTag + ' 区间与 find 重叠——标记块内容由 sync-shared-blocks.cjs\n' +
        '  单独管理，此处改动会在下次共享块同步时被静默覆盖。\n' +
        '  修复指引: 该功能差异应改在 shared/user-store.js / shared/user-admin.js\n' +
        '  权威源（或其同步机制）中处理，不得进本变换表。'
      );
    }
  }
  cur = cur.slice(0, p) + t.replace + cur.slice(p + t.find.length);
});

// ---- 3. 落盘 / 只校验 ----
if (verifyOnly) {
  let drift = 0;
  for (const out of [OUT_MAIN, OUT_ASSETS]) {
    let existing = null;
    try { existing = fs.readFileSync(out, 'utf8'); } catch (e) { fail('读目标失败: ' + out + ' — ' + e.message); }
    if (existing !== cur) {
      drift++;
      const n = Math.min(existing.length, cur.length);
      let i = 0;
      while (i < n && existing[i] === cur[i]) i++;
      console.error(
        '[sync-index-app] 漂移: ' + path.relative(ROOT, out) +
        ' 与权威源+变换表的生成结果不一致（首处分歧 offset=' + i + '，' +
        'existing=' + existing.length + 'B generated=' + cur.length + 'B）'
      );
      console.error('  existing: ' + JSON.stringify(existing.slice(Math.max(0, i - 40), i + 60)));
      console.error('  generated: ' + JSON.stringify(cur.slice(Math.max(0, i - 40), i + 60)));
    }
  }
  if (drift > 0) {
    console.error('[sync-index-app] FAIL: ' + drift + ' 个目标存在漂移。运行 node tools/sync-index-app.cjs 重新生成。');
    process.exit(1);
  }
  console.log('[sync-index-app] verify-only PASS: ' + TRANSFORMS.length + ' 条变换全部唯一命中，双目标与生成结果一致');
  process.exit(0);
}

// 全量校验通过才落盘：同一 buffer 双写
fs.writeFileSync(OUT_MAIN, cur, 'utf8');
fs.writeFileSync(OUT_ASSETS, cur, 'utf8');

// ---- 4. SHA256 自校验 ----
const hMain = sha256(fs.readFileSync(OUT_MAIN));
const hAssets = sha256(fs.readFileSync(OUT_ASSETS));
if (hMain !== hAssets) {
  fail('双写后 SHA256 不一致（IO 异常）: main=' + hMain.slice(0, 16) + ' assets=' + hAssets.slice(0, 16));
}

console.log('[sync-index-app] OK: ' + TRANSFORMS.length + ' 条变换全部唯一命中');
console.log('  权威源 : ' + path.relative(ROOT, SRC));
console.log('  → 产物 : ' + path.relative(ROOT, OUT_MAIN) + ' (' + Buffer.byteLength(cur, 'utf8') + 'B)');
console.log('  → 副本 : ' + path.relative(ROOT, OUT_ASSETS));
console.log('  SHA256 : ' + hMain.slice(0, 16) + '（双写一致）');
