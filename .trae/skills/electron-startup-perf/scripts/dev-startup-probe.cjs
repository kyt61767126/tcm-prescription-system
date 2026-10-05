// ============================================================================
// dev-startup-probe.cjs — 桌面端启动/登录性能打点探针（dev Electron 专用）
//
// 配套 skill: .trae/skills/electron-startup-perf/SKILL.md（先读铁律再用）
//
// 用途：对【未打包】的 dev Electron 做冷启动计时，归集渲染端与主进程双通道
//       [PERF] 标记，输出分段墙钟耗时。fused 安装包测不了（调试管道关闭，
//       会挂到 180s 超时），不要尝试。
//
// 用法（PowerShell，仓库根执行；多轮真实 gate 测量务必带 --gap 20 防 429）：
//   node .trae/skills/electron-startup-perf/scripts/dev-startup-probe.cjs
//   node .trae/skills/electron-startup-perf/scripts/dev-startup-probe.cjs --desktop offline --gap 20 --wait-ms 12000
//   node .trae/skills/electron-startup-perf/scripts/dev-startup-probe.cjs --keep            # 保留隔离 userData 排查
//
// 点击→进系统全程（需先用 run-e2e.cjs 同构方式备好签名夹具目录）：
//   $env:PROBE_USERDATA='D:\fixtures\licensed'; $env:PROBE_USER='138...'; $env:PROBE_PWD='...'
//   node .trae/skills/electron-startup-perf/scripts/dev-startup-probe.cjs --gap 20
//
// 退出码：0 探针跑完（含未发现窗口等结果异常会非 0，便于脚本化判断）
// ============================================================================
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

// —— 参数 ——
const argv = process.argv.slice(2);
const argOf = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const desktopKind = argOf('--desktop', 'offline') === 'cloud' ? 'cloud' : 'offline';
const gapSec = Math.max(0, parseInt(argOf('--gap', '0'), 10) || 0);
const observeMs = Math.max(0, parseInt(argOf('--wait-ms', '12000'), 10) || 12000);
const keep = argv.includes('--keep');

const REPO = path.resolve(__dirname, '..', '..', '..', '..'); // skills/<name>/scripts → repo root
const DESKTOP = path.join(REPO, 'app_project', desktopKind === 'cloud' ? 'db-yunduan/cloud_desktop' : 'db-offline/desktop');
const ELECTRON_EXE = path.join(DESKTOP, 'node_modules', 'electron', 'dist', 'electron.exe');
const MARKER = path.join(path.dirname(ELECTRON_EXE), 'e2e-enabled.marker');
const userData = process.env.PROBE_USERDATA
    || path.join(os.tmpdir(), `bnzc-perf-${process.pid}-${Date.now()}`);

const launchAt = Date.now();
const rel = () => String(Date.now() - launchAt).padStart(6);
const log = (m) => console.log(`[PROBE +${rel()}ms] ${m}`);
const perfLines = []; // {ch:'r'|'m', at:ms, text}
// 只收【原文】含 [PERF] 的行；不要在入参处伪造前缀，否则过滤器失效、噪声全入
const record = (ch, text) => { const line = String(text || '').trim(); if (!line.includes('[PERF]')) return; const at = Date.now() - launchAt; perfLines.push({ ch, at, text: line }); log(`[PERF/${ch === 'r' ? 'renderer' : 'main'} +${at}ms] ${line.replace(/^\[PERF\]\s*/, '')}`); };

// 限时杀进程：close 可能被 before-quit/托盘拦截永不 resolve（见 run-e2e.cjs killApp）
async function killApp(app) {
    try { await Promise.race([app.close(), new Promise(r => setTimeout(r, 5000))]); } catch (_) {}
    try { const p = app.process(); if (p && p.exitCode === null) p.kill(); } catch (_) {}
    for (let i = 0; i < 30; i++) {
        try { const p = app.process(); if (!p || p.exitCode !== null) return; } catch (_) { return; }
        await new Promise(r => setTimeout(r, 100));
    }
    log('WARN: 进程 3s 内未确认退出（下一轮可能撞单实例锁）');
}

async function findWindow(app, urlPart, timeoutMs = 30000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        try {
            const hit = app.windows().find(w => { try { return w.url().includes(urlPart); } catch (_) { return false; } });
            if (hit) return hit;
        } catch (_) { /* 窗口枚举瞬断 */ }
        if (Date.now() > deadline) throw new Error(`等待 ${urlPart} 窗口超时 ${timeoutMs}ms`);
        await new Promise(r => setTimeout(r, 400));
    }
}

// 与 run-e2e.cjs 同款的登录时序处理（readonly 密码框 + 注册 overlay）
async function dismissRegisterOverlay(page) {
    let appeared = false;
    for (let i = 0; i < 8; i++) {
        if (await page.evaluate(() => !!document.getElementById('localRegisterOverlay'))) { appeared = true; break; }
        await new Promise(r => setTimeout(r, 100));
    }
    if (!appeared) return;
    for (let i = 0; i < 20; i++) {
        if (await page.evaluate(() => !document.getElementById('localRegisterOverlay'))) return;
        await page.evaluate(() => { const l = document.getElementById('localRegCloseLink'); if (l) l.click(); });
        await page.waitForFunction(() => !document.getElementById('localRegisterOverlay'), null, { timeout: 5000 }).catch(() => {});
        return;
    }
}
async function doLogin(page, user, pwd) {
    await page.waitForSelector('#loginUsername', { timeout: 15000 });
    await dismissRegisterOverlay(page);
    await page.fill('#loginUsername', user);
    await page.focus('#loginPassword');
    await page.waitForFunction(() => { const el = document.getElementById('loginPassword'); return !!el && !el.hasAttribute('readonly'); },
        null, { timeout: 5000 }).catch(() => {});
    await page.fill('#loginPassword', pwd);
    await page.click('#btnOk');
}

(async () => {
    if (!fs.existsSync(ELECTRON_EXE)) { console.error(`[PROBE][FAIL] dev electron 不存在: ${ELECTRON_EXE}（先在 ${DESKTOP} 执行 npm i）`); process.exit(2); }
    if (!process.env.PROBE_USERDATA) fs.mkdirSync(userData, { recursive: true });
    if (gapSec > 0) { log(`限流间隔等待 ${gapSec}s（防授权端点 429）...`); await new Promise(r => setTimeout(r, gapSec * 1000)); }

    let playwright;
    try { playwright = require(require.resolve('playwright', { paths: [DESKTOP] })); }
    catch (e) { console.error('[PROBE][FAIL] 无法从 desktop node_modules 解析 playwright: ' + e.message); process.exit(2); }

    fs.writeFileSync(MARKER, `perf probe ${new Date().toISOString()}\n`, 'utf8');
    const cleanup = () => { try { fs.rmSync(MARKER, { force: true }); } catch (_) {} };
    process.on('exit', cleanup);
    process.on('SIGINT', () => { cleanup(); process.exit(130); });

    log(`启动 dev Electron [${desktopKind}] cwd=${DESKTOP}`);
    log(`隔离 userData: ${userData}${keep ? '（--keep 保留）' : ''}`);
    const t0 = Date.now();
    const app = await playwright._electron.launch({
        executablePath: ELECTRON_EXE,
        args: ['.'],
        cwd: DESKTOP,
        env: { ...process.env, BNZC_E2E: '1', BNZC_E2E_DATA: userData },
    });

    try {
        // —— 主进程 stdout（PERF/m 通道）——
        const out = app.process().stdout;
        if (out) out.on('data', (buf) => String(buf).split(/\r?\n/).forEach(l => record('m', l)));
        else log('WARN: 无法订阅主进程 stdout');
        app.process().stderr && app.process().stderr.on('data', (buf) => String(buf).split(/\r?\n/).forEach(l => record('m', l)));

        // —— 渲染 console（PERF/r 通道）——
        try {
            app.context().on('console', (msg) => { try { record('r', msg.text()); } catch (_) {} });
        } catch (e) { log('WARN: context console 订阅失败: ' + e.message); }

        const loginWin = await findWindow(app, 'login.html', 30000);
        const loginReadyAt = Date.now() - launchAt;
        log(`登录窗出现：spawn→login.html ${loginReadyAt}ms`);

        let clickAt = 0;
        if (process.env.PROBE_USER && process.env.PROBE_PWD) {
            const mainP = findWindow(app, 'index.html', 90000);
            mainP.catch(() => {});
            clickAt = Date.now();
            log(`执行登录点击：user=${process.env.PROBE_USER}`);
            await doLogin(loginWin, process.env.PROBE_USER, process.env.PROBE_PWD);
            await mainP;
            log(`点击→主窗 index.html：${Date.now() - clickAt}ms（遮罩 reveal 以 m:reveal 标记为准）`);
        } else {
            log('未设 PROBE_USER/PROBE_PWD：仅测启动→登录窗（点击链插桩标记仍会被归集）');
        }

        log(`观察 ${observeMs}ms 收集 [PERF] 标记...`);
        await new Promise(r => setTimeout(r, observeMs));
    } catch (e) {
        console.error('[PROBE][FAIL] ' + (e && e.stack ? e.stack : e));
        process.exitCode = 1;
    } finally {
        await killApp(app);
        cleanup();
        if (!keep && !process.env.PROBE_USERDATA) { try { fs.rmSync(userData, { recursive: true, force: true }); } catch (_) {} }
    }

    // —— 汇总 ——
    console.log('');
    console.log('[PROBE] ══ PERF 标记时间线（墙钟，ms 自 spawn 起）══');
    if (!perfLines.length) {
        console.log('  （无 [PERF] 标记：需按 SKILL.md 在 login.js/main.js 临时插桩；或仅看上方内置里程碑）');
    } else {
        for (const p of perfLines) console.log(`  +${String(p.at).padStart(6)}ms [${p.ch}] ${p.text.replace(/^\[PERF\]\s*/, '')}`);
    }
    console.log('[PROBE] done');
    // 已跑完即视为探针成功；业务失败已置 exitCode
})();
