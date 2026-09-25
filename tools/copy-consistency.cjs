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
    },
    {
        // ★ 2026-09-11 药品库存核心（stock-core.js）：与 prescription-core.js 同位分发的
        //   权威源。sync-all.ps1 BusinessJs 组只覆盖其中 6 副本（不含云端APP assets 与
        //   鸿蒙 rawfile——symptom-dict 同款盲区），本组全量 8 副本硬校验堵漏。
        authority: 'shared/stock-core.js',
        copies: [
            'public/stock-core.js',
            'public/electron/stock-core.js',
            'app_project/db-yunduan/cloud_desktop/stock-core.js',
            'app_project/db-yunduan/cloud_desktop/electron/stock-core.js',
            'app_project/db-yunduan/cloud_app/app/src/main/assets/public/stock-core.js',
            'app_project/db-offline/desktop/stock-core.js',
            'app_project/db-offline/app/app/src/main/assets/public/stock-core.js',
            'app_project_harmony/huikang-cloud/entry/src/main/resources/rawfile/stock-core.js'
        ]
    },
    {
        // ★ 2026-09-13 P2-A3 处方签核心（prescription-core.js）：同步盲区同 stock-core
        //   （Group 1 只盖 6 副本，site-admin/云端APP assets/鸿蒙 rawfile 靠手工），
        //   本组全量副本硬校验堵漏；收缩到真实 API 面（getAutoJianfa）后新增。
        //   ★ 2026-09-13 SA-1：site-admin/electron 副本移除（第一代壳死重已删）。
        authority: 'shared/prescription-core.js',
        copies: [
            'public/prescription-core.js',
            'public/electron/prescription-core.js',
            'site-admin/prescription-core.js',
            'app_project/db-yunduan/cloud_desktop/prescription-core.js',
            'app_project/db-yunduan/cloud_desktop/electron/prescription-core.js',
            'app_project/db-yunduan/cloud_app/app/src/main/assets/public/prescription-core.js',
            'app_project/db-offline/desktop/prescription-core.js',
            'app_project/db-offline/app/app/src/main/assets/public/prescription-core.js',
            'app_project_harmony/huikang-cloud/entry/src/main/resources/rawfile/prescription-core.js'
        ]
    },
    {
        // ★ 2026-09-25 P2-1 数据统计核心（analytics-core.js）：与 stock-core 同位
        //   分发，sync-all BusinessJs 组只盖 6 副本，本组全量 8 副本硬哈希堵漏
        //   （含云端APP assets 与鸿蒙 rawfile 手工维护盲区）。
        authority: 'shared/analytics-core.js',
        copies: [
            'public/analytics-core.js',
            'public/electron/analytics-core.js',
            'app_project/db-yunduan/cloud_desktop/analytics-core.js',
            'app_project/db-yunduan/cloud_desktop/electron/analytics-core.js',
            'app_project/db-yunduan/cloud_app/app/src/main/assets/public/analytics-core.js',
            'app_project/db-offline/desktop/analytics-core.js',
            'app_project/db-offline/app/app/src/main/assets/public/analytics-core.js',
            'app_project_harmony/huikang-cloud/entry/src/main/resources/rawfile/analytics-core.js'
        ]
    },
    {
        // ★ P0-1（2026-09-13）：桌面更新器收口。云桌面/离线桌面 main.js 原各内嵌
        //   ~200 行同构更新器（仅渠道 URL 不同），历史靠人肉双改。现抽为唯一权威源
        //   shared/update-manager.cjs，main.js require + 工厂入参注入渠道差异。
        //   本组 2 副本硬哈希校验，与 electron-logger.cjs / pe-guard.cjs 同位同构。
        authority: 'shared/update-manager.cjs',
        copies: [
            'app_project/db-yunduan/cloud_desktop/electron/update-manager.cjs',
            'app_project/db-offline/desktop/electron/update-manager.cjs'
        ]
    },
    {
        // ★ 2026-09-14 静默热更新核心（与 update-manager 同组同位分发）：
        //   纯逻辑模块（零 Electron 依赖），Ed25519 验签三道门禁 + 原子 swap +
        //   失败自动回退 asar。update-manager.cjs 相对 require 依赖同目录布局。
        //   sync-all Group 12 分发，本组 2 副本硬哈希门。
        authority: 'shared/hot-update-core.cjs',
        copies: [
            'app_project/db-yunduan/cloud_desktop/electron/hot-update-core.cjs',
            'app_project/db-offline/desktop/electron/hot-update-core.cjs'
        ]
    },
    {
        // ★ 2026-09-13 B2-1 桌面文件域收口（与 update-manager 同位同构）：
        //   媒体/备份/用户数据 40 项函数/IPC 从双 main.js 等体抽出，
        //   sync-all Group 14 分发，本组 2 副本硬哈希门。
        authority: 'shared/desktop-fs-ipc.cjs',
        copies: [
            'app_project/db-yunduan/cloud_desktop/electron/desktop-fs-ipc.cjs',
            'app_project/db-offline/desktop/electron/desktop-fs-ipc.cjs'
        ]
    },
    {
        // ★ 2026-09-13 B2-2 桌面窗口域收口（与 desktop-fs-ipc 同位同构）：
        //   窗口创建/DevTools 防护/视频录制注入 6 函数从双 main.js 等体抽出，
        //   sync-all Group 15 分发，本组 2 副本硬哈希门。
        authority: 'shared/desktop-windows.cjs',
        copies: [
            'app_project/db-yunduan/cloud_desktop/electron/desktop-windows.cjs',
            'app_project/db-offline/desktop/electron/desktop-windows.cjs'
        ]
    },
    {
        // ★ 2026-09-14 P3-A 桌面对话框域收口（与 desktop-windows 同位同构）：
        //   dialog:alert-sync / confirm-sync / prompt 三 handler 从双 main.js
        //   等体抽出（title 经工厂入参注入端差异）。sync-all Group 17 分发，
        //   本组 2 副本硬哈希门（配套 prompt-modal.html / prompt-preload.js
        //   各自成组，三文件同组同位分发，__dirname 同目录解析）。
        authority: 'shared/desktop-dialog.cjs',
        copies: [
            'app_project/db-yunduan/cloud_desktop/electron/desktop-dialog.cjs',
            'app_project/db-offline/desktop/electron/desktop-dialog.cjs'
        ]
    },
    {
        // ★ 2026-09-14 P3-A 对话框域配套资源：prompt-modal.html（sync-all Group 17
        //   同组分发，双端 <title> 统一为"请输入"）。
        authority: 'shared/prompt-modal.html',
        copies: [
            'app_project/db-yunduan/cloud_desktop/electron/prompt-modal.html',
            'app_project/db-offline/desktop/electron/prompt-modal.html'
        ]
    },
    {
        // ★ 2026-09-14 P3-A 对话框域配套资源：prompt-preload.js（sync-all Group 17
        //   同组分发；tools/ 下零引用第三份已删，三份归一）。
        authority: 'shared/prompt-preload.js',
        copies: [
            'app_project/db-yunduan/cloud_desktop/electron/prompt-preload.js',
            'app_project/db-offline/desktop/electron/prompt-preload.js'
        ]
    },
    {
        // ★ 2026-09-14 P3-A 桌面崩溃韧性补强（与 desktop-windows 同位同构）：
        //   render-process-gone / child-process-gone 兜底（主壳崩溃自动重建 +
        //   60s>=3 次熔断 + clean-exit 过滤）。sync-all Group 18 分发，
        //   本组 2 副本硬哈希门。
        authority: 'shared/desktop-crash-guard.cjs',
        copies: [
            'app_project/db-yunduan/cloud_desktop/electron/desktop-crash-guard.cjs',
            'app_project/db-offline/desktop/electron/desktop-crash-guard.cjs'
        ]
    },
    {
        // ★ 2026-09-25 P2-3 桌面打印域收口（与 desktop-fs-ipc 同位同构）：
        //   print-prescription handler（隐藏打印窗+系统打印对话框/A5）。
        //   sync-all Group 21 分发，本组 2 副本硬哈希门。
        authority: 'shared/desktop-print.cjs',
        copies: [
            'app_project/db-yunduan/cloud_desktop/electron/desktop-print.cjs',
            'app_project/db-offline/desktop/electron/desktop-print.cjs'
        ]
    },
    {
        // ★ 2026-09-25 license IPC 胶合层收口：双 main.js 全部 license:* IPC
        //   （38 通道：通用22（21字节同构+submit-activate注释差）/端分叉3/仅云端1/仅离线12；
        //    set-trial-days 故意不注册）
        //   工厂字节切片自改前 main.js，唯一变换 mainWindow → getMainWindow()。
        //   sync-all Group 22 分发，本组 2 副本硬哈希门。
        authority: 'shared/desktop-license-ipc.cjs',
        copies: [
            'app_project/db-yunduan/cloud_desktop/electron/desktop-license-ipc.cjs',
            'app_project/db-offline/desktop/electron/desktop-license-ipc.cjs'
        ]
    },
    {
        // ★ 2026-09-17 语音版一期：voice-input.js（Web Speech API 语音输入模块）。
        //   ★ 2026-09-18 阶段二语音免费层下沉：扩离线两端（db-offline 桌面/APP
        //   assets）——免费层解析链 VoiceInput.highlight/toPinyin/ensurePinyin
        //   直接消费，缺位=整方解析中断。sync-all Group 19 分发，本组 5 副本
        //   硬哈希门。
        authority: 'shared/voice/voice-input.js',
        copies: [
            'public/voice-input.js',
            'app_project/db-yunduan/cloud_desktop/voice-input.js',
            'app_project/db-yunduan/cloud_app/app/src/main/assets/public/voice-input.js',
            'app_project/db-offline/desktop/voice-input.js',
            'app_project/db-offline/app/app/src/main/assets/public/voice-input.js'
        ]
    },
    {
        // ★ 2026-09-24 P1：cloud-api.js（云端 API 客户端）。历史仅 sync-all Group 8
        //   自动分发 cloud_desktop 一处，其余 6 处副本（public×2 / site-admin /
        //   云APP assets / 离线APP assets / 鸿蒙 rawfile）全靠手工传播，无硬门。
        //   本组 7 副本全量硬哈希；sync-all Group 8b 负责自动分发。
        //   APP 侧必需的 typeof window._cloudReachable === 'undefined' 防御初始化
        //   已含在权威源内（全端同体，无需副本定制）。
        authority: 'shared/cloud-api.js',
        copies: [
            'public/cloud-api.js',
            'public/electron/cloud-api.js',
            'site-admin/cloud-api.js',
            'app_project/db-yunduan/cloud_desktop/cloud-api.js',
            'app_project/db-yunduan/cloud_app/app/src/main/assets/public/cloud-api.js',
            'app_project/db-offline/app/app/src/main/assets/public/cloud-api.js',
            'app_project_harmony/huikang-cloud/entry/src/main/resources/rawfile/cloud-api.js'
        ]
    },
    {
        // ★ 2026-09-24 P1：云系 electron 适配版 video-recorder.js（云端网页 / 云桌面
        //   / 云APP 同源；云端热包 cloud 通道也取此源）。权威 public/electron；
        //   2026-09-24 前云桌面 asar 副本纯落后 29 行（缺 AndroidNative 让位早退、
        //   网页兜底、addMediaFileWeb 导出），已收敛并加硬门。sync-all Group 20a
        //   自动分发。离线桌面 electron 副本是真分叉（media-capture 付费墙等），
        //   刻意不入本组、禁止拉平。
        authority: 'public/electron/video-recorder.js',
        copies: [
            'app_project/db-yunduan/cloud_desktop/electron/video-recorder.js'
        ]
    },
    {
        // ★ 2026-09-24 P1：纯浏览器版 video-recorder.js（MediaRecorder + IndexedDB，
        //   与 electron 适配版不同源，消费方 site-admin/index.html 同目录加载）。
        //   锁定双站根副本一致，防止手工传播漂移。
        authority: 'public/video-recorder.js',
        copies: [
            'site-admin/video-recorder.js'
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
//   内联到 6 份 index.html 的标记块，哈希必须与权威源生成物一致，漂移即失败
//   （★ 2026-09-13：根目录孤儿 index.html 删除后由 7 份收口为 6 份）
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
//   内联到 6 份 index.html 的标记块，哈希必须与权威源生成物一致，漂移即失败
//   （★ 2026-09-13：根目录孤儿 index.html 删除后由 7 份收口为 6 份）
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
