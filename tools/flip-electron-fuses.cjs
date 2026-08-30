#!/usr/bin/env node
// ============================================================================
// flip-electron-fuses.cjs — 上架加固 P1-3：Electron Fuses 统一写入/校验工具
//
// 目标（二进制级关闭调试注入后门）：
//   RunAsNode                          = false  （禁 ELECTRON_RUN_AS_NODE 提权运行 JS）
//   EnableNodeCliInspectArguments      = false  （禁 --inspect / --inspect-brk）
//   EnableNodeOptionsEnvironmentVariable = false（禁 NODE_OPTIONS 注入）
//   OnlyLoadAppFromAsar                = true   （只允许从 asar 加载应用）
//
// 用法：
//   node tools/flip-electron-fuses.cjs flip <exe路径> [--fuses-dir <含node_modules的目录>]
//   node tools/flip-electron-fuses.cjs check <exe路径> [--fuses-dir <含node_modules的目录>]
//
//   flip  ：写入 4 个目标 fuse 后立即回读复核，不符即 exit 1（阻断打包）
//   check ：只读校验当前 fuse 状态，任一目标 fuse 不符合预期 → exit 1（供 pack-gate 红线）
//
// @electron/fuses 解析顺序：--fuses-dir 指定目录 > 两个桌面版 node_modules > 仓库根
// ★ 该包是纯 ESM（"type":"module"）且无 main 字段：require 包目录不认 exports
//   （历史坑同 @electron/asar），必须直接 require dist/index.js（Node>=22.12 支持 require ESM）
// ★ getCurrentFuseWire 返回数字键（FuseV1Options 枚举值），非名称键
// ============================================================================
'use strict';
const path = require('path');
const fs = require('fs');

const REPO_ROOT = path.resolve(__dirname, '..');
const CANDIDATE_FUSES_DIRS = [
    path.join(REPO_ROOT, 'app_project', 'db-offline', 'desktop'),
    path.join(REPO_ROOT, 'app_project', 'db-yunduan', 'cloud_desktop'),
    REPO_ROOT,
];

// 目标 fuse 状态表（key = FuseV1Options 名称）
const TARGET_FUSES = {
    RunAsNode: false,
    EnableNodeCliInspectArguments: false,
    EnableNodeOptionsEnvironmentVariable: false,
    OnlyLoadAppFromAsar: true,
    // P1-2（2026-08-30）：启动时校验 app.asar 头哈希（期望值 = exe PE 资源 ElectronAsar）
    // ★ 前置条件：flip 之前必须已跑 tools/embed-asar-integrity.cjs 嵌入资源，
    //   否则 fuse 开而资源缺 → Electron 启动即 FATAL（archive_win.cc FindResource）。
    EnableEmbeddedAsarIntegrityValidation: true,
};

function loadFusesApi(explicitDir) {
    const dirs = explicitDir ? [explicitDir, ...CANDIDATE_FUSES_DIRS] : CANDIDATE_FUSES_DIRS;
    const errors = [];
    for (const dir of dirs) {
        const p = path.resolve(dir, 'node_modules', '@electron', 'fuses', 'dist', 'index.js');
        if (fs.existsSync(p)) {
            try {
                return { api: require(p), resolvedFrom: p };
            } catch (e) {
                errors.push(`${p}: ${e.message}`);
            }
        }
    }
    console.error('[fuses][ERROR] 未找到可用的 @electron/fuses，尝试过:');
    errors.forEach(e => console.error('  ' + e));
    process.exit(1);
}

function stateName(state) {
    // FuseState: 48=DISABLE('0') 49=ENABLE('1') 114=REMOVED('r') 144=INHERIT
    switch (state) {
        case 48: return 'DISABLE';
        case 49: return 'ENABLE';
        case 114: return 'REMOVED';
        case 144: return 'INHERIT';
        default: return `UNKNOWN(${state})`;
    }
}

function assertTargetStates(wire, FuseV1Options) {
    let allOk = true;
    for (const [name, wantEnable] of Object.entries(TARGET_FUSES)) {
        const got = wire[FuseV1Options[name]];
        // 期望 ENABLE(49) / DISABLE(48)；REMOVED/INHERIT/其他一律视为不达标
        const expected = wantEnable ? 49 : 48;
        const ok = got === expected;
        if (!ok) allOk = false;
        console.log(`  [${ok ? 'OK' : 'FAIL'}] ${name} = ${stateName(got)} (期望 ${wantEnable ? 'ENABLE' : 'DISABLE'})`);
    }
    return allOk;
}

async function main() {
    const args = process.argv.slice(2);
    const cmd = args[0];
    const exe = args[1];
    const fusesDirIdx = args.indexOf('--fuses-dir');
    const explicitDir = fusesDirIdx >= 0 ? args[fusesDirIdx + 1] : undefined;

    if ((cmd !== 'flip' && cmd !== 'check') || !exe) {
        console.error('用法: node flip-electron-fuses.cjs flip|check <exe路径> [--fuses-dir <目录>]');
        process.exit(1);
    }
    if (!fs.existsSync(exe)) {
        console.error(`[fuses][ERROR] exe 不存在: ${exe}`);
        process.exit(1);
    }

    const { api, resolvedFrom } = loadFusesApi(explicitDir);
    const { FuseVersion, FuseV1Options } = api;

    if (cmd === 'flip') {
        console.log(`[fuses] 写入目标 fuse -> ${exe}`);
        console.log(`[fuses] 使用 @electron/fuses: ${resolvedFrom}`);
        const cfg = {
            version: FuseVersion.V1,
            [FuseV1Options.RunAsNode]: false,
            [FuseV1Options.EnableNodeCliInspectArguments]: false,
            [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
            [FuseV1Options.OnlyLoadAppFromAsar]: true,
            [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
        };
        await api.flipFuses(exe, cfg);
        console.log('[fuses] 写入完成，回读复核:');
    } else {
        console.log(`[fuses] 校验 fuse 状态 -> ${exe}`);
    }

    const wire = await api.getCurrentFuseWire(exe);
    const allOk = assertTargetStates(wire, FuseV1Options);
    if (allOk) {
        console.log(`[fuses] ${cmd === 'flip' ? '写入并复核通过' : '校验通过'} ✓ (RunAsNode=off Inspect=off NODE_OPTIONS=off OnlyLoadAppFromAsar=on AsarIntegrity=on)`);
    } else {
        console.error(`[fuses][ERROR] ${cmd === 'flip' ? '写入后复核不通过' : '校验不通过'}（阻断打包，宁可不发不可带后门发）`);
        process.exit(1);
    }
}

main().catch(e => {
    console.error('[fuses][ERROR] ' + (e && e.stack || e));
    process.exit(1);
});
