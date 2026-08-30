#!/usr/bin/env node
// ============================================================================
// smoke-launch.cjs — 上架加固 P1-3 配套：最终 fused exe 冒烟启动测试
//
// 背景：Electron Fuses（RunAsNode/--inspect/NODE_OPTIONS 关闭 + OnlyLoadAppFromAsar）
//   写入后，Playwright E2E 无法再连接被测 exe（依赖 --inspect=0 的 Node inspector）。
//   因此管线顺序调整为 E2E(未fuse) → fuse → .bnzc → 签名 → NSIS。
//   本脚本在管线【末尾】对最终 fused exe 做无调试参数的真实启动验证：
//     ① 正常启动（无任何调试参数，模拟真实用户双击）
//     ② 进程存活 ≥ 等待时间（启动即崩/JS 主进程异常可被捕获）
//     ③ 主窗口创建成功（MainWindowHandle ≠ 0，标题不是错误对话框）
//   同时满足 KNOWLEDGE 铁律「PE 区段嵌入类修改必须实际启动被嵌入的 exe」。
//
// 隔离设计（与 run-e2e.cjs 同款）：
//   - exe 同级临时写 e2e-enabled.marker + env BNZC_E2E=1 → userData 隔离到临时目录
//     （不传任何调试参数，main.js 的远程调试拦截本来就不会触发）
//   - 跑完删除 marker（NSIS 在本步骤之前已打包，产物永不携带 marker）
//
// 用法：
//   node tools/smoke-launch.cjs <exe路径> [--wait-ms 15000]
//   退出码：0 通过；1 失败（供 build.bat 红线）
// ============================================================================
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, execSync } = require('child_process');

const args = process.argv.slice(2);
const exePath = args[0];
const waitIdx = args.indexOf('--wait-ms');
const waitMs = waitIdx >= 0 ? parseInt(args[waitIdx + 1], 10) : 15000;

if (!exePath) {
    console.error('用法: node smoke-launch.cjs <exe路径> [--wait-ms 15000]');
    process.exit(1);
}
if (!fs.existsSync(exePath)) {
    console.error(`[smoke][ERROR] exe 不存在: ${exePath}`);
    process.exit(1);
}

// ★ 必须转绝对路径：spawn 的相对路径在 Windows 下按子进程 cwd（=exe 目录）解析，
//   build.bat 传入 "dist\win-unpacked\xxx.exe" 会拼出 ...win-unpacked\dist\win-unpacked\...
//   → ENOENT（2026-08-30 实锤：pid=undefined + unhandled error event 崩溃）
const exeAbs = path.resolve(exePath);
const exeDir = path.dirname(exeAbs);
const markerPath = path.join(exeDir, 'e2e-enabled.marker');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), `smoke-${process.pid}-`));

function cleanup(killPid) {
    try { if (killPid) execSync(`taskkill /PID ${killPid} /T /F`, { stdio: 'ignore' }); } catch (_) { }
    try { fs.rmSync(markerPath, { force: true }); } catch (_) { }
    try { fs.rmSync(userData, { recursive: true, force: true }); } catch (_) { }
}

function getWinInfo(pid) {
    // 返回 { handle, title }：主进程窗口句柄与标题（PowerShell 查询）
    try {
        const out = execSync(
            `[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; $p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue; if ($p) { "$($p.MainWindowHandle)|$($p.MainWindowTitle)" } else { "GONE" }`,
            { encoding: 'utf8', timeout: 10000, shell: 'powershell.exe' }
        ).trim();
        if (out === 'GONE') return null;
        const [handle, ...rest] = out.split('|');
        return { handle: parseInt(handle, 10) || 0, title: rest.join('|') };
    } catch (_) {
        return { handle: 0, title: '' }; // 查询失败不等于进程死亡
    }
}

async function main() {
    console.log(`[smoke] 冒烟启动测试 -> ${exeAbs}`);
    console.log(`[smoke] userData 隔离目录: ${userData}`);

    fs.writeFileSync(markerPath, String(Date.now()), 'utf8');

    const child = spawn(exeAbs, [], {
        cwd: exeDir,
        env: { ...process.env, BNZC_E2E: '1', BNZC_E2E_DATA: userData },
        stdio: 'ignore',
        detached: false,
    });
    const pid = child.pid;
    console.log(`[smoke] 已启动 pid=${pid}，等待主窗口出现（最长 ${waitMs + 20000}ms）...`);

    let exited = false;
    let exitCode = null;
    child.on('exit', (code) => { exited = true; exitCode = code; });
    // ★ spawn 同步失败（路径/权限）走 error 事件而非 exit：必须兜住，
    //   否则 unhandled 'error' event 直接崩溃且不清理 marker
    child.on('error', (e) => {
        console.error(`[smoke][FAIL] 进程启动失败: ${e.message}`);
        cleanup(null);
        process.exit(1);
    });
    if (!pid) {
        console.error('[smoke][FAIL] spawn 未返回 pid（启动失败）');
        cleanup(null);
        process.exit(1);
    }

    // 轮询：最多 waitMs + 20s，等待窗口出现
    const deadline = Date.now() + waitMs + 20000;
    let win = null;
    while (Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 1500));
        if (exited) break;
        const info = getWinInfo(pid);
        if (info === null) { exited = true; break; } // 进程消失
        if (info && info.handle !== 0) { win = info; break; }
    }

    // 再确认进程仍存活（窗口出现后不应立即退出）
    const aliveAfterWait = !exited && getWinInfo(pid) !== null;

    try {
        if (!aliveAfterWait) {
            console.error(`[smoke][FAIL] 进程未存活到检查点（exited=${exited}${exitCode !== null ? ', code=' + exitCode : ''}）— fused exe 启动异常`);
            process.exit(1);
        }
        if (!win || win.handle === 0) {
            console.error('[smoke][FAIL] 等待超时未见主窗口（MainWindowHandle=0）— fused exe 启动异常');
            process.exit(1);
        }
        if (/javascript error|script error|uncaught|错误/i.test(win.title)) {
            console.error(`[smoke][FAIL] 主窗口标题疑似错误对话框: "${win.title}"`);
            process.exit(1);
        }
        console.log(`[smoke] 进程存活 ✓  主窗口已创建 ✓  窗口标题: "${win.title || '(空)'}"`);
        console.log('[smoke] PASS ✓ — 最终 fused exe（含 .bnzc/签名）真实启动正常');
    } finally {
        cleanup(pid);
    }
    process.exit(0);
}

main().catch(e => {
    console.error('[smoke][ERROR] ' + (e && e.stack || e));
    cleanup(null);
    process.exit(1);
});
