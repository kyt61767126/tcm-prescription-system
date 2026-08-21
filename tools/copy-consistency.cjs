// ============================================================================
// copy-consistency.cjs — 代码副本哈希一致性硬校验（铁闸1）
//
// 架构目的：彻底杜绝「只改了 shared/permission.js，但某个端的副本没同步」
//   → 该端打包后又出现旧 bug 的反复复发问题。
//
// 规则：
//   权威源（Authority） = shared/ 目录
//   副本集（Copies）   = 其他位置（各端）中同名文件
//   检查对象：permission.js / button-manager.js / edition-lock.js
//             auth-core.js / login.js（登录页版本三元组逻辑）
//   任何副本 sha256 ≠ 权威源 sha256 → 阻断构建（exit=1）
//   同时打印不一致副本的绝对路径，指引同步。
//
// 用法：
//   node tools/copy-consistency.cjs           # 检查所有 5 个文件
//   node tools/copy-consistency.cjs --json    # 输出 JSON（供 CI 解析）
//   node tools/copy-consistency.cjs --fix     # 自动用权威源覆盖不一致副本（慎用！）
// ============================================================================
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');

// 检查文件组：每个 group 一个权威源 + 副本匹配 glob 规则（相对 ROOT）
const GROUPS = [
    {
        authority: 'shared/permission.js',
        copies: [
            'public/permission.js',
            'public/electron/permission.js',
            'site-admin/permission.js',
            'site-admin/electron/permission.js',
            'app_project/db-yunduan/cloud_desktop/permission.js',
            'app_project/db-yunduan/cloud_desktop/electron/permission.js',
            'app_project/db-yunduan/cloud_app/app/src/main/assets/public/permission.js',
            'app_project/db-offline/desktop/permission.js',
            'app_project/db-offline/desktop/electron/permission.js',
            'app_project/db-offline/app/app/src/main/assets/public/permission.js'
        ]
    },
    {
        authority: 'shared/button-manager.js',
        copies: [
            'public/button-manager.js',
            'app_project/db-yunduan/cloud_desktop/button-manager.js',
            'app_project/db-yunduan/cloud_app/app/src/main/assets/public/button-manager.js',
            'app_project/db-offline/desktop/button-manager.js',
            'app_project/db-offline/app/app/src/main/assets/public/button-manager.js'
        ]
    },
    {
        // ★ T2（2026-08-21）CONFIG 入口归一化关卡 —— 与 permission.js 同位分发的权威源
        authority: 'shared/normalize-config.js',
        copies: [
            // ★ 复查补漏（2026-08-21）：根目录 index.html 有 script 标签但缺文件（smoke W 段抓到），
            //   补分发并纳入铁闸，防止再次漏同步
            // ★ P2 补漏（2026-08-21）：db-offline/index-app.html 同款问题（smoke --all 首跑抓到）
            'normalize-config.js',
            'app_project/db-offline/normalize-config.js',
            'public/normalize-config.js',
            'public/electron/normalize-config.js',
            'site-admin/normalize-config.js',
            'site-admin/electron/normalize-config.js',
            'app_project/db-yunduan/cloud_desktop/normalize-config.js',
            'app_project/db-yunduan/cloud_desktop/electron/normalize-config.js',
            'app_project/db-yunduan/cloud_app/app/src/main/assets/public/normalize-config.js',
            'app_project/db-offline/desktop/normalize-config.js',
            'app_project/db-offline/desktop/electron/normalize-config.js',
            'app_project/db-offline/app/app/src/main/assets/public/normalize-config.js'
        ]
    },
    {
        authority: 'shared/edition-lock.js',
        copies: [
            'public/edition-lock.js',
            'site-admin/edition-lock.js',
            'app_project/db-yunduan/cloud_desktop/edition-lock.js',
            'app_project/db-yunduan/cloud_app/app/src/main/assets/public/edition-lock.js',
            'app_project/db-offline/desktop/edition-lock.js',
            'app_project/db-offline/app/app/src/main/assets/public/edition-lock.js'
        ]
    },
    {
        // ★ P1（2026-08-21）：user-store.js 独立文件分发（登录窗口 login.html <script> 加载）。
        //   index.html 走标记块内联（见 checkUserStoreBlocks），登录窗口走独立文件，
        //   两条分发路径都锚定同一权威源，漂移即阻断构建。
        authority: 'shared/user-store.js',
        copies: [
            'app_project/db-yunduan/cloud_desktop/electron/user-store.js',
            'app_project/db-offline/desktop/electron/user-store.js'
        ]
    }
];

const args = process.argv.slice(2);
const AS_JSON = args.includes('--json');
const DO_FIX = args.includes('--fix');

function sha256(p) {
    return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

var results = [];
var failGroups = 0;

for (var gi = 0; gi < GROUPS.length; gi++) {
    var g = GROUPS[gi];
    var authPath = path.join(ROOT, g.authority);
    if (!fs.existsSync(authPath)) {
        results.push({ group: g.authority, status: 'NO_AUTHORITY', copies: [] });
        failGroups++;
        continue;
    }
    var authHash = sha256(authPath);
    var copyResults = [];
    var anyCopyBad = false;

    for (var ci = 0; ci < g.copies.length; ci++) {
        var rel = g.copies[ci];
        var cp = path.join(ROOT, rel);
        if (!fs.existsSync(cp)) {
            var ms = 'MISSING';
            if (DO_FIX) {
                try {
                    var dir = path.dirname(cp);
                    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
                    fs.copyFileSync(authPath, cp);
                    var msHash = sha256(cp);
                    ms = (msHash === authHash) ? 'FIXED' : 'FIX_FAILED';
                    if (ms !== 'FIX_FAILED') anyCopyBad = false; else anyCopyBad = true;
                } catch (e) {
                    ms = 'FIX_ERR:' + (e.code || e.message);
                    anyCopyBad = true;
                }
            } else {
                anyCopyBad = true;
            }
            copyResults.push({ rel: rel, status: ms });
            continue;
        }
        var chash = sha256(cp);
        if (chash !== authHash) {
            anyCopyBad = true;
            var status = 'MISMATCH';
            if (DO_FIX) {
                try {
                    fs.copyFileSync(authPath, cp);
                    var newHash = sha256(cp);
                    status = (newHash === authHash) ? 'FIXED' : 'FIX_FAILED';
                    if (status === 'FIX_FAILED') anyCopyBad = true;
                } catch (e) {
                    status = 'FIX_ERR:' + (e.code || e.message);
                    anyCopyBad = true;
                }
            }
            copyResults.push({ rel: rel, status: status, expectHash: authHash, actualHash: chash });
        } else {
            copyResults.push({ rel: rel, status: 'OK' });
        }
    }

    if (anyCopyBad) failGroups++;
    results.push({
        group: g.authority,
        authority: { rel: g.authority, hash: authHash },
        copies: copyResults,
        _anyBad: anyCopyBad
    });
}
// ★ T3（2026-08-21）：USER-STORE 标记块一致性 —— shared/user-store.js 权威源
//   内联到 7 份 index.html 的标记块，哈希必须与权威源生成物一致，漂移即失败
//   （调用点在 totalCopies 声明之后，见下方 checkUserStoreBlocks()）

// DO_FIX 模式下：修正 failGroups 统计（上面对 anyCopyBad==false 且刚 FIXED 的组错误计数了）
if (DO_FIX) {
    failGroups = 0;
    for (var gi2 = 0; gi2 < results.length; gi2++) {
        var rr = results[gi2];
        var anyBadNow = false;
        if (rr.status === 'NO_AUTHORITY') { anyBadNow = true; }
        else {
            for (var cj2 = 0; cj2 < rr.copies.length; cj2++) {
                var st = rr.copies[cj2].status;
                if (st !== 'OK' && st !== 'FIXED') { anyBadNow = true; break; }
            }
        }
        if (anyBadNow) failGroups++;
    }
}

// ★ T3（2026-08-21）：USER-STORE 标记块一致性 —— shared/user-store.js 权威源
//   内联到 7 份 index.html 的标记块，哈希必须与权威源生成物一致，漂移即失败
function checkUserStoreBlocks() {
    var sbm = require('./sync-shared-blocks.cjs');
    var ok = sbm.run(!DO_FIX); // check 模式；DO_FIX 模式下直接重新同步
    if (!ok) failGroups++;
    totalCopies += sbm.HTML_FILES.length;
}

// ── 输出 ──
if (AS_JSON) {
    console.log(JSON.stringify({ pass: failGroups === 0, results: results }, null, 2));
    process.exit(failGroups === 0 ? 0 : 1);
}

console.log('');
console.log('┌──────────────────────────────────────────────────────────────────┐');
console.log('│  COPY-CONSISTENCY: 代码副本哈希一致性硬校验（铁闸1）              │');
console.log('│  权威源 = shared/ ；任何副本不一致直接阻断构建                    │');
console.log('└──────────────────────────────────────────────────────────────────┘');
console.log('');

var totalCopies = 0;
var failCopies = 0;
for (var i = 0; i < results.length; i++) {
    var r = results[i];
    console.log('── 权威源: ' + r.group + ' ──');
    if (r.status === 'NO_AUTHORITY') {
        console.log('  [FAIL] 权威源缺失，无法校验');
        continue;
    }
    for (var j = 0; j < r.copies.length; j++) {
        var c = r.copies[j];
        totalCopies++;
        var tag = c.status === 'OK' ? '[OK]' : c.status === 'FIXED' ? '[FIXED]' : '[FAIL]';
        if (c.status !== 'OK' && c.status !== 'FIXED') failCopies++;
        var extra = '';
        if (c.status === 'MISSING') extra = ' —— 文件缺失';
        else if (c.status === 'MISMATCH') extra = ' —— 哈希与权威源不一致（未同步！）';
        else if (c.status && c.status.indexOf('FIX_') === 0) extra = ' —— ' + c.status;
        console.log('  ' + tag + ' ' + c.rel + extra);
    }
    console.log('');
}

console.log('────────────────────────────────────────────');

// ★ T3：USER-STORE 标记块校验（在 totalCopies 汇总之后执行，单独打印）
checkUserStoreBlocks();

console.log('总副本数: ' + totalCopies + ' | 失败: ' + failCopies + ' | 文件组: ' + results.length + ' / 失败组: ' + failGroups);

if (failGroups > 0) {
    console.log('');
    console.log('[FAIL] 有副本不一致或缺失，阻断构建！');
    console.log('       修复方式：node tools/copy-consistency.cjs --fix');
    console.log('       （--fix 会用 shared/ 权威源覆盖所有不一致副本；');
    console.log('        USER-STORE 标记块漂移则运行 node tools/sync-shared-blocks.cjs）');
    process.exit(1);
}

console.log('');
console.log('[PASS] 副本一致性校验 ALL PASS ✓');
process.exit(0);
