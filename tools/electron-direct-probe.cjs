#!/usr/bin/env node
// ============================================================================
//  electron-direct-probe.cjs — Electron 裸 dist 直启探针（P2 user 域批次沉淀，2026-09-25）
//
//  用途：主进程域改动后的低直成本运行时回归——spawn 真实 electron.exe 加载
//  云/离桌面工程，观测 存活/stdout/stderr/窗口标题，与 git HEAD 基线对照。
//
//  ★ 2026-09-25 实测踩坑（本项目 Windows 环境，勿再踩）：
//    1) Start-Process -ArgumentList @('.', ...) 会丢应用路径参数 → electron 落入
//       内置 default_app.asar（其 ESM main 崩溃弹 "Error" 对话框），应用根本没跑；
//    2) PowerShell `&` 直调 GUI 子系统 exe：不等待、无 stdio、无退出码，完全不可观测；
//    3) 唯一可靠姿势 = Node child_process.spawn(exe, [appDir], {stdio:pipe})（本工具）；
//    4) 单实例锁：与已运行的同 userData 实例互斥会静默 exit 0 → 必须传
//       BNZC_E2E=1 + exe 同级 e2e-enabled.marker + BNZC_E2E_DATA=<隔离目录>
//       （main.js E2E 旁路在锁之前 setPath('userData')），跑完删 marker；
//    5) npmmirror 35.0.0 zip dist 的 default_app.asar 本身 ESM 崩溃且应用不出窗——
//       判据失真；**必须用项目自带 dev dist（node_modules/electron/dist）**，
//       云/离两端均能到「登录/激活窗已显示」（stdout 有 showing window 链）；
//       若需更强回归证据，可 git stash 后对 HEAD 跑同探针做四象限对照；
//    6) stderr 出现 "To load an ES module…" 警告为 Node22+ require(esm) 兼容提示，
//       HEAD 上同样存在，非异常；"wmic 不是内部或外部命令" 为本机缺 wmic 的既有噪音
//       （GBK 乱码），可忽略。
//
//  用法: node tools/electron-direct-probe.cjs <appDir> <e2eDataDir> [waitSec] [exePath]
//    appDir     云桌面/离线桌面工程根（含 package.json，main=electron/main.js）
//    e2eDataDir 隔离 userData 目录（自动创建/清理由调用方负责）
//    exePath    electron.exe 路径（★优先用项目自带 dev dist：
//               app_project/db-yunduan/cloud_desktop/node_modules/electron/dist/electron.exe
//               ——2026-09-25 实测 npmmirror 35.0.0 zip 的 default_app.asar ESM 崩溃，
//               项目内 dev dist 才能正常直启；marker 需放在该 exe 同级）
//  前置: exe 同级目录临时放置 e2e-enabled.marker（跑完删除）。
// ============================================================================
'use strict';
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const EXE = process.argv[5] || path.join(__dirname, '_tmp', 'electron35', 'electron.exe');
const appDir = process.argv[2];
const dataDir = process.argv[3];
const waitMs = (parseInt(process.argv[4], 10) || 15) * 1000;
if (!appDir || !dataDir || !fs.existsSync(EXE)) {
    console.error('用法: node tools/electron-direct-probe.cjs <appDir> <e2eDataDir> [waitSec] [exePath]');
    console.error('优先用项目自带 dev dist: <appDir>/node_modules/electron/dist/electron.exe');
    process.exit(2);
}

const env = Object.assign({}, process.env, { BNZC_E2E: '1', BNZC_E2E_DATA: dataDir });
const child = spawn(EXE, [appDir], { env, stdio: ['ignore', 'pipe', 'pipe'] });

let out = '', err = '';
child.stdout.on('data', d => { out += d; });
child.stderr.on('data', d => { err += d; });
child.on('exit', (code, sig) => { console.log('[EXIT] code=' + code + ' sig=' + sig); });

function titles() {
    try {
        const raw = execSync('tasklist /v /fi "imagename eq electron.exe" /fo csv /nh', { encoding: 'utf8' });
        return raw.split(/\r?\n/).filter(Boolean).map(l => {
            const cols = l.match(/("([^"]|"")*")/g) || [];
            return cols.length >= 9 ? cols[8].replace(/"/g, '') : '';
        }).filter(t => t && t !== 'N/A');
    } catch (e) { return ['(tasklist failed: ' + e.message + ')']; }
}

setTimeout(() => {
    const alive = child.exitCode === null && !child.killed;
    const ts = titles().join(' | ');
    child.kill();
    setTimeout(() => {
        try { child.kill('SIGKILL'); } catch (e) {}
        console.log('[PROBE ' + (waitMs / 1000) + 's] alive=' + alive);
        console.log('[TITLES] ' + (ts || '(none)'));
        console.log('[STDOUT]\n' + (out || '(empty)'));
        console.log('[STDERR]\n' + (err || '(empty)'));
        process.exit(0);
    }, 1500);
}, waitMs);
