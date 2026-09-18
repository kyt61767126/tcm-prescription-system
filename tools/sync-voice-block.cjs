#!/usr/bin/env node
// ============================================================================
//  sync-voice-block.cjs —— 语音块云端 → 离线桌面下沉器（阶段二 2026-09-18）
//
//  【背景】语音免费层（整方快速录入：输入法语音/打字/粘贴 + voiceSmartRoute
//  解析链）一期已上云端三端。解析链是纯字符串处理（与识别引擎无关），离线端
//  天然可复用——付费层（Web Speech 四框 mic）在离线端因无 SpeechRecognition
//  构造器被 isAvailable() 三重 gate 自动隐藏，零感知零适配。
//
//  【职责】把 public/index.html 的语音块整体同步到离线桌面权威源
//  app_project/db-offline/desktop/index.html（APP 端由 sync-index-app.cjs
//  生成链接力，本工具不直接写 APP 端）：
//    块范围 = '<!-- ★ 2026-09-17 语音版一期：voice-input.js' 注释起，
//             至其后第一个 '\n})();\n</script>\n'（主 IIFE 收尾）止，
//             含注释 2 行 + voice-input.js 引用行 + 内联 IIFE script 块。
//    离线适配 = 仅一条：voice-input.js 引用剥离 ?cv=xxx 缓存参数
//             （离线本地文件系统无 HTTP 缓存，全端无 cv 惯例）。
//    插入锚点 = '<script src="electron/video-recorder.js"></script>' 行后
//             （与云端 script 顺序一致：video-recorder → voice-input → IIFE）。
//
//  【铁律】
//    1. 幂等：重复运行输出不变（先删旧块再插入，块内起标记唯一性校验）。
//    2. 单向：云端是语音功能迭代权威源，禁止反向（离线改动会被下次同步覆盖；
//       离线专属语音需求应先在云端实现或在本工具加变换）。
//    3. 块内内容逐字节同体（除 cv 剥离）——漂移守卫交给 diff-cross-version
//       的 desk 对比（离线块应与云端块 diff 仅 cv 参数）。
//    4. 抽取失败/锚点丢失/块重复 → exit 1 并给修复指引，绝不写半截文件。
//
//  【用法】
//    node tools/sync-voice-block.cjs                # 下沉（写离线桌面 index.html）
//    node tools/sync-voice-block.cjs --verify-only  # 只校验漂移不落盘（CI/pre-push）
//
//  【配套链】本工具 → node tools/sync-index-app.cjs（生成 APP 端）→
//    热包 generate-desktop-hotupdate.cjs -c local + generate-app-hotupdate.cjs。
// ============================================================================
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CLOUD = path.join(ROOT, 'public', 'index.html');
const DESK = path.join(ROOT, 'app_project', 'db-offline', 'desktop', 'index.html');

// 块起标记（云端 L740 注释首行；同时是幂等删除的定位标记）
const START_MARK = '<!-- ★ 2026-09-17 语音版一期：voice-input.js';
// 块止标记：主 IIFE 收尾（行首 })(); 独立成行 + 紧跟 </script> + 换行）。
// 块内无其他行首 })();（已静态核验：public/index.html 语音块区间内唯一），
// 且内联 script 内容不含 '</script>' 字面量（HTML 解析器会提前截断，天然不可能）。
const END_RE = /\n\}\)\(\);\n<\/script>\n/;
// 插入锚点：离线桌面 script 区 video-recorder 引用行（行尾换行一并入锚，插其后）
const ANCHOR = '<script src="electron/video-recorder.js"></script>\n';
// cv 剥离：云端 ?cv=8位hex 破缓存参数，离线本地文件系统无缓存概念
const CV_RE = /(<script src="voice-input\.js)\?cv=[a-f0-9]+("><\/script>)/;

const verifyOnly = process.argv.includes('--verify-only');

function fail(msg) {
    console.error('[sync-voice-block] FAIL: ' + msg);
    process.exit(1);
}

// ---- 1. 从云端权威源抽取语音块 ----
let cloud;
try { cloud = fs.readFileSync(CLOUD, 'utf8'); }
catch (e) { fail('读云端权威源失败: ' + CLOUD + ' — ' + e.message); }

const cs = cloud.indexOf(START_MARK);
if (cs < 0) fail('云端起标记丢失: ' + JSON.stringify(START_MARK.slice(0, 60)) +
    '\n  语音块注释已被改动。请同步更新本工具 START_MARK。');
if (cloud.indexOf(START_MARK, cs + 1) !== -1) fail('云端起标记出现多次——语音块结构异常，人工排查。');
const em = cloud.slice(cs).match(END_RE);
if (!em) fail('云端止标记丢失（主 IIFE 收尾 \\n})();\\n</script>\\n）——语音块结构异常，人工排查。');
const blockCloud = cloud.substring(cs, cs + em.index + em[0].length);

// ---- 2. 离线适配（唯一变换：cv 剥离）----
let blockDesk = blockCloud.replace(CV_RE, '$1$2');
if (CV_RE.test(blockDesk)) fail('cv 剥离未生效（voice-input.js 引用行异常）——人工排查。');

// ---- 3. 幂等写入离线桌面权威源 ----
let desk;
try { desk = fs.readFileSync(DESK, 'utf8'); }
catch (e) { fail('读离线桌面权威源失败: ' + DESK + ' — ' + e.message); }

// 3a. 删除既有块（幂等：无论新旧，按下沉标记整体重建）
let base = desk;
const ds = base.indexOf(START_MARK);
if (ds >= 0) {
    if (base.indexOf(START_MARK, ds + 1) !== -1) fail('离线桌面语音块起标记出现多次——结构异常，人工排查。');
    const dm = base.slice(ds).match(END_RE);
    if (!dm) fail('离线桌面既有语音块止标记丢失——结构异常，人工排查。');
    base = base.substring(0, ds) + base.substring(ds + dm.index + dm[0].length);
}

// 3b. 锚点定位 + 插入
const ap = base.indexOf(ANCHOR);
if (ap < 0) fail('插入锚点丢失: ' + JSON.stringify(ANCHOR) +
    '\n  离线桌面 script 引用区结构已变化。请对照更新本工具 ANCHOR。');
if (base.indexOf(ANCHOR, ap + 1) !== -1) fail('插入锚点出现多次——请延长锚点上下文。');
const next = base.substring(0, ap + ANCHOR.length) + blockDesk + base.substring(ap + ANCHOR.length);

// ---- 4. 落盘前完整性自检 ----
if (next.indexOf(START_MARK) !== next.lastIndexOf(START_MARK)) fail('写入结果起标记非唯一——中止。');
if (next.indexOf('<script src="voice-input.js"></script>') < 0) fail('写入结果缺 voice-input.js 引用——中止。');
if (next.indexOf(ANCHOR) >= next.indexOf(START_MARK)) fail('写入顺序异常（语音块应在 video-recorder 之后）——中止。');

// ---- 5. 落盘 / 只校验 ----
if (verifyOnly) {
    if (desk === next) {
        console.log('[sync-voice-block] verify-only PASS: 离线桌面语音块与云端一致（cv 剥离后）');
        process.exit(0);
    }
    console.error('[sync-voice-block] 漂移: 离线桌面语音块与云端不一致（云端已更新或尚未下沉）。');
    console.error('  运行 node tools/sync-voice-block.cjs 重新下沉。');
    process.exit(1);
}
fs.writeFileSync(DESK, next, 'utf8');
console.log('[sync-voice-block] OK: 语音块已下沉（云端 ' + blockCloud.length + 'B，剥离 cv 后 ' + blockDesk.length + 'B）');
console.log('  权威源 : ' + path.relative(ROOT, CLOUD));
console.log('  → 目标 : ' + path.relative(ROOT, DESK));
console.log('  后续   : node tools/sync-index-app.cjs（生成 APP 端）');
