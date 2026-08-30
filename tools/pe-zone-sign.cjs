// ============================================================================
//  pe-zone-sign.cjs — PE .bnzc 区段工具（P1-[3.1]，打包时调用）
//
//  用法：
//    node tools/pe-zone-sign.cjs embed <exePath> [asarPath]
//                                                   # 写入/更新 .bnzc 区段；
//                                                   # ★P2-1: 传 asarPath 时把 asar
//                                                   # 全文件哈希一并嵌入（ver=2），
//                                                   # 终版 embed 必传（asar 须已定稿）
//    node tools/pe-zone-sign.cjs verify <exePath> [asarPath]
//                                                   # 校验，0=通过 1=不匹配 2=未嵌入 3=错误
//                                                   # ★P2-1: 传 asarPath 时同时校验
//                                                   # asar 全文件哈希，失配 exit 1
//    node tools/pe-zone-sign.cjs info <exePath>      # 查看区段状态（调试）
//
//  集成点：
//    - 云端桌面：prepare-win-unpacked.js 生成主 exe 后调用（--prepackaged 模式
//      afterPack 不执行，故在此处 embed，随后 electron-builder 用该 win-unpacked
//      生成安装包，区段随文件保留）；build.bat [8.03] 终版 embed 传 asar。
//    - 离线桌面：afterPack.js 在 appOutDir 生成后对主 exe 调用（无 asar，
//      Phase 1 阶段）；build.bat Phase 2 终版 embed 传 asar（幂等 update 覆盖）。
//
//  退出码：embed 失败退出 1；verify 按状态 0/1/2/3。失败以非阻塞告警处理
//  （不影响打包流程，仅记录），符合"宁漏检不可误报"红线。
// ============================================================================

'use strict';

const path = require('path');
const fs = require('fs');
const peGuard = require('../shared/pe-guard.cjs');

function fail(msg) {
    console.error('[PE-Zone] ' + msg);
    process.exit(1);
}

function main() {
    const [cmd, exePath, asarPath] = process.argv.slice(2);
    if (!cmd || !exePath) {
        console.error('Usage: node tools/pe-zone-sign.cjs embed|verify|info <exePath> [asarPath]');
        process.exit(3);
    }
    const abs = path.resolve(exePath);
    if (!fs.existsSync(abs)) fail('文件不存在: ' + abs);
    const asarAbs = asarPath ? path.resolve(asarPath) : null;

    if (cmd === 'embed') {
        try {
            const r = peGuard.embedZone(abs, asarAbs);
            console.log('[PE-Zone] embed OK mode=' + r.mode + ' exe=' + abs);
            console.log('[PE-Zone] sha256(excluding .bnzc)=' + r.sha256hex);
            if (r.asarSha256hex) {
                console.log('[PE-Zone] asar sha256=' + r.asarSha256hex + ' (P2-1 ver=2, 运行时全文件校验)');
            } else {
                console.log('[PE-Zone] asar hash not embedded (ver=2 empty field, 后续终版 embed 将覆盖)');
            }
            process.exit(0);
        } catch (e) {
            fail('embed 失败: ' + e.message);
        }
    } else if (cmd === 'verify') {
        const r = peGuard.verifyZone(abs);
        console.log('[PE-Zone] verify ' + JSON.stringify(r));
        // ★ 2026-08-19：verify 同时校验 PE 布局合法性（区段指针对齐），
        //   防止"哈希对但布局坏（exe 无法加载）"的产物通过门禁。
        let layoutProblems = [];
        try {
            const buf = fs.readFileSync(abs);
            layoutProblems = peGuard.validateLayout(buf, peGuard.parsePe(buf));
        } catch (e) {
            layoutProblems = [e.message];
        }
        if (layoutProblems.length > 0) {
            console.error('[PE-Zone] PE layout invalid: ' + layoutProblems.join('; '));
            process.exit(1);
        }
        if (r.status === 'no-zone') process.exit(2);
        if (r.status === 'mismatch') {
            console.error('[PE-Zone] 完整性失配：存储=' + r.stored + ' 实际=' + r.actual);
            process.exit(1);
        }
        if (r.status !== 'ok') process.exit(3);
        // ★ P2-1（2026-08-30）：传 asarPath 时校验 asar 全文件哈希（门禁级，
        //   失配必须 exit 1 阻断——嵌入哈希与实际 asar 不一致=管线时序 bug 或篡改）
        if (asarAbs) {
            if (!r.asarSha256hex) {
                console.error('[PE-Zone] asar hash not embedded in .bnzc (ver=1 legacy zone?), cannot verify asar');
                process.exit(1);
            }
            if (!fs.existsSync(asarAbs)) fail('asar 文件不存在: ' + asarAbs);
            const actualAsar = peGuard.sha256FileSync(asarAbs);
            if (actualAsar !== r.asarSha256hex) {
                console.error('[PE-Zone] ASAR 完整性失配：存储=' + r.asarSha256hex + ' 实际=' + actualAsar);
                process.exit(1);
            }
            console.log('[PE-Zone] asar full-file sha256 match ✓');
        }
        process.exit(0);
    } else if (cmd === 'info') {
        try {
            console.log('[PE-Zone] info ' + JSON.stringify(peGuard.inspectZone(abs)));
            process.exit(0);
        } catch (e) {
            fail('info 失败: ' + e.message);
        }
    } else {
        fail('未知命令: ' + cmd);
    }
}

main();
