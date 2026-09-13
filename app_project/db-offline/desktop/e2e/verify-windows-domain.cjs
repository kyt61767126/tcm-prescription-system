// ============================================================================
// verify-windows-domain.cjs — B2-2 窗口域抽取（desktop-windows.cjs）专项 E2E 验证
//
// 与 verify-fs-domain.cjs 同款启动模式（dev electron.exe + 源码 electron/main.js
// 直启，改完 shared/desktop-windows.cjs 同步后即可立即回归，无需重打包）。
// 断言域：窗口创建/参数/注入链/导航防护/window.open 拦截/状态回写。
//
// 三重隔离（与 verify-fs-domain.cjs 完全一致）：
//   ① BNZC_E2E=1 + exe 同级 marker → 放行远程调试（main.js e2e 旁路）
//   ② BNZC_E2E_DATA → app.setPath('userData') 隔离
//   ③ PORTABLE_EXECUTABLE_DIR → getExeDirectory 走便携分支
//
// 用例（W1-W9，主进程 app.evaluate 读真实 BrowserWindow 状态）：
//   W1 启动链路 + 登录窗口参数：240 宽 / 高度 340-460 自适应 / resizable=false
//   W2 登录窗口 dom-ready 注入：密码框 type=text + webkitTextSecurity=disc
//   W3 登录成功 → 主窗口出现（createMainWindow 工厂路径）
//   W4 主窗口参数：1400x900（getBounds）+ 最小尺寸 1024x700（getMinimumSize）
//   W5 主窗口 dom-ready 注入链：__videoRecorderInjected / __nativeDialogsInjected /
//      __dataErrorToastFiltered 三标记（injectVideoRecorder 等接线证明）
//   W6 原生 dialog 替换：window.alert 已被 electronAPI.alertSync 包装
//   W7 will-navigate 导航防护：location.href 赋远程地址 → 主框架仍留 file://
//   W8 window.open 拦截：外部 URL 不新开 Electron 窗口（窗口数不变）
//   W9 登录窗口 closed 状态回写：登录成功后 login.html 窗口关闭 →
//      setLoginWindow(null) 事件接线正常（getAllWindows 无 login 窗口）
//
// 用法：node e2e\verify-windows-domain.cjs [--keep]
// 退出码：0 全过；1 任一失败
// ============================================================================
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TMP_ROOT = path.join(__dirname, '.tmp');
// ★ 每轮运行唯一 tmp 目录：强杀残留/Defender 句柄锁住旧目录时（EPERM），绝不阻断本轮
const TMP_BASE = path.join(TMP_ROOT, `winverify-${process.pid}-${Date.now()}`);
const MARKER_NAME = 'e2e-enabled.marker';
const E2E_PASSWORD = 'E2ePass123!';
const USERNAME = 'e2eadmin';

const keepTmp = process.argv.includes('--keep');

function rmrfSafe(p) {
    try { fs.rmSync(p, { recursive: true, force: true }); } catch (_) { /* 句柄锁定等，容忍 */ }
}

const t0 = Date.now();
const log = (m) => console.log(`[WV +${String(Date.now() - t0).padStart(5)}ms] ${m}`);
let failures = 0;
let total = 0;
function assert(cond, label) {
    total++;
    if (cond) { log(`  ✓ ${label}`); return true; }
    failures++;
    log(`  ✗ FAIL: ${label}`);
    return false;
}

// —— findWindow / login / killApp：与 verify-fs-domain.cjs 同款 ——
function findWindow(app, urlPart, timeoutMs = 30000) {
    const deadline = Date.now() + timeoutMs;
    return new Promise((resolve, reject) => {
        const tick = async () => {
            try {
                const wins = app.windows();
                const hit = wins.find(w => w.url().includes(urlPart));
                if (hit) return resolve(hit);
            } catch (_) { /* 窗口枚举瞬断，重试 */ }
            if (Date.now() > deadline) return reject(new Error(`等待窗口超时（含 "${urlPart}" 的页面 ${Math.round(timeoutMs / 1000)}s 未出现）`));
            setTimeout(tick, 400);
        };
        tick();
    });
}

async function login(page, username, password) {
    await page.waitForSelector('#loginUsername', { timeout: 15000 });
    await page.fill('#loginUsername', username);
    // ★ 反自动填充双保险（desktop-windows.cjs dom-ready 注入）：密码框初始 readonly，
    //   focus 时才移除。先 focus 触发移除，确认可编辑后再填。
    try {
        await page.focus('#loginPassword');
        await page.waitForFunction(() => {
            const el = document.getElementById('loginPassword');
            return !!el && !el.hasAttribute('readonly');
        }, null, { timeout: 5000 });
    } catch (_) { /* 注入未跑或已移除：直接走 fill 兜底 */ }
    await page.fill('#loginPassword', password);
    await page.click('#btnOk');
}

async function killApp(app) {
    try { await Promise.race([app.close(), new Promise(r => setTimeout(r, 5000))]); } catch (_) {}
    try {
        const p = app.process();
        if (p && p.exitCode === null) {
            // ★ Windows 进程树强杀：app.close/kill 只终结主进程，GPU/renderer 孤儿
            //   会锁住 userData 的 leveldb/LOCK → .tmp 删除静默失败（实测残留）。
            try { require('child_process').execSync(`taskkill /PID ${p.pid} /T /F`, { stdio: 'ignore' }); } catch (_) { p.kill(); }
        }
    } catch (_) {}
    for (let i = 0; i < 30; i++) {
        try {
            const p = app.process();
            if (!p || p.exitCode !== null) return;
        } catch (e) { return; }
        await new Promise(r => setTimeout(r, 100));
    }
}

// 主进程侧：枚举所有 BrowserWindow 的关键参数（url / bounds / minimumSize / resizable）
// Playwright electronApp.evaluate 自动把主进程 electron 模块作为首参注入。
async function winInfos(app) {
    return await app.evaluate(({ BrowserWindow }) => {
        const list = BrowserWindow.getAllWindows();
        return list.map(w => {
            try {
                return {
                    id: w.id,
                    url: w.webContents ? w.webContents.getURL() : '',
                    bounds: w.getBounds(),
                    minimumSize: w.getMinimumSize(),
                    resizable: w.isResizable(),
                    destroyed: w.isDestroyed(),
                };
            } catch (e) { return { id: w.id, error: String(e) }; }
        });
    });
}

// 离线桌面试用态 config（app 启动会自动补签名 + 试用期降级，与 verify-fs-domain 同构）
function baseConfig() {
    return {
        clinicName: 'E2E窗口域验证诊所',
        doctorName: 'E2E医师',
        edition: 'personal',
        appMode: 'offline',
        maxUsers: 1,
        productName: '惠康中医-本地',
        versionLabel: '离线标准版',
        users: [{ username: USERNAME, password: E2E_PASSWORD, name: 'E2E管理员', role: 'admin' }],
    };
}

// ============================================================================
// 主流程：launch → 登录 → W1-W9 窗口域断言
// ============================================================================
(async () => {
    console.log('[WV] ══ B2-2 窗口域抽取专项验证（dev electron + 源码直启）══');
    const devElectron = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');
    const mainJs = path.join(ROOT, 'electron', 'main.js');
    const winModule = path.join(ROOT, 'electron', 'desktop-windows.cjs');
    for (const [label, p] of [['dev electron', devElectron], ['electron/main.js 源码', mainJs], ['electron/desktop-windows.cjs', winModule]]) {
        if (!fs.existsSync(p)) { console.error(`[WV][FAIL] 缺少 ${label}: ${p}`); process.exit(1); }
    }
    log(`被测目标: dev electron + ${mainJs}（测最新 B2-2 代码，非打包产物）`);

    const { _electron } = require('playwright');
    const marker = path.join(path.dirname(devElectron), MARKER_NAME);

    // —— 隔离目录（每次重跑全新，杜绝残留干扰）——
    rmrfSafe(TMP_BASE);
    const portable = path.join(TMP_BASE, 'portable');
    const userdata = path.join(TMP_BASE, 'userdata');
    fs.mkdirSync(portable, { recursive: true });
    fs.mkdirSync(userdata, { recursive: true });
    // 便携分支的 config.json（main.js 便携读取点 = PORTABLE_EXECUTABLE_DIR/config.json）
    fs.writeFileSync(path.join(portable, 'config.json'), JSON.stringify(baseConfig(), null, 2), 'utf8');

    fs.writeFileSync(marker, `win-verify ${new Date().toISOString()}\n`, 'utf8');

    let app = null;
    let passed = false;
    try {
        // ★ 启动即验证：B2-2 模块 require + 工厂注入 + 启动链路未被破坏
        app = await _electron.launch({
            executablePath: devElectron,
            args: [mainJs],
            env: {
                ...process.env,
                BNZC_E2E: '1',
                BNZC_E2E_DATA: userdata,
                PORTABLE_EXECUTABLE_DIR: portable,
            },
        });

        // ---------- W1 启动链路 + 登录窗口参数 ----------
        const loginWin = await findWindow(app, 'login.html', 30000);
        log('登录窗口就绪（desktop-windows.cjs 工厂注入未破坏启动链路）');
        let infos = await winInfos(app);
        const lw = infos.find(w => (w.url || '').includes('login.html'));
        assert(!!lw, 'W1 主进程枚举到 login.html BrowserWindow');
        assert(lw && lw.bounds && lw.bounds.width === 240, `W1 登录窗口宽 240（实际 ${lw && lw.bounds && lw.bounds.width}）`);
        assert(lw && lw.bounds && lw.bounds.height >= 340 && lw.bounds.height <= 460, `W1 登录窗口高 340-460 自适应（实际 ${lw && lw.bounds && lw.bounds.height}）`);
        assert(lw && lw.resizable === false, 'W1 登录窗口 resizable=false');

        // ---------- W2 登录窗口 dom-ready 注入（createLoginWindow 注入链） ----------
        // dom-ready 注入有几十至几百毫秒时延（端/机器时序抖动）：轮询等齐再断言。
        try {
            await loginWin.waitForFunction(() => {
                const pw = document.getElementById('loginPassword');
                return !!pw && pw.getAttribute('type') === 'text' && pw.style.webkitTextSecurity === 'disc';
            }, null, { timeout: 8000 });
        } catch (_) { /* 超时则由下方逐项断言给出精确失败项 */ }
        const w2 = await loginWin.evaluate(() => {
            const pwds = document.querySelectorAll('input[type="password"]');
            const pw = document.getElementById('loginPassword');
            return {
                pwdCount: pwds.length,
                pwIsText: !!pw && pw.getAttribute('type') === 'text',
                pwDisc: !!pw && pw.style.webkitTextSecurity === 'disc',
            };
        });
        assert(w2.pwdCount === 0, 'W2 密码框已全部转 type=text（无 password 残留）');
        assert(w2.pwIsText, 'W2 #loginPassword type="text"');
        assert(w2.pwDisc, 'W2 #loginPassword webkitTextSecurity=disc（视觉圆点）');

        // ---------- W3/W4 登录成功 → 主窗口出现 + 参数 ----------
        const mainWinPromise = findWindow(app, 'index.html', 90000);
        mainWinPromise.catch(() => {});
        await login(loginWin, USERNAME, E2E_PASSWORD);
        const mainWin = await mainWinPromise;
        log('主窗口就绪（createMainWindow 工厂路径正常）');

        // 等权限流程跑完（改密按钮亮起 = renderer 完全可用，dom-ready 注入链已跑）
        await mainWin.waitForFunction(() => {
            const b = document.getElementById('changePwdBtn');
            return !!b && b.style.display !== 'none';
        }, null, { timeout: 20000 });
        log('权限流程完成，开始窗口域断言');

        // ---------- W4 主窗口参数 ----------
        // 尺寸断言语义：请求值 1400x900，屏幕工作区不足时 Electron 自动 clamp 收缩
        //（实测 1280x672 = 测试机可用工作区），故断言 [最小尺寸, 请求值] 区间而非等值。
        infos = await winInfos(app);
        const mw = infos.find(w => (w.url || '').includes('index.html'));
        assert(!!mw, 'W4 主进程枚举到 index.html BrowserWindow');
        assert(mw && mw.bounds && mw.bounds.width >= 1024 && mw.bounds.width <= 1400,
            `W4 主窗口宽 ∈ [1024,1400]（实际 ${mw && mw.bounds && mw.bounds.width}，屏幕窄时 clamp）`);
        assert(mw && mw.bounds && mw.bounds.height >= 600 && mw.bounds.height <= 900,
            `W4 主窗口高 ∈ [600,900]（实际 ${mw && mw.bounds && mw.bounds.height}，屏幕矮时 clamp）`);
        assert(mw && Array.isArray(mw.minimumSize) && mw.minimumSize[0] === 1024 && mw.minimumSize[1] === 700,
            `W4 主窗口最小尺寸 1024x700（实际 ${mw && JSON.stringify(mw.minimumSize)}）`);

        // ---------- W5 主窗口 dom-ready 注入链 ----------
        // 注入链在 dom-ready 串行执行（loginOverlay→video→dialogs→toastFilter），
        // 端时序差异可能让 toast 标记晚几百毫秒：轮询等齐再断言。
        try {
            await mainWin.waitForFunction(() =>
                !!window.__videoRecorderInjected && !!window.__nativeDialogsInjected && !!window.__dataErrorToastFiltered,
                null, { timeout: 8000 });
        } catch (_) { /* 超时则由下方逐项断言给出精确失败项 */ }
        const w5 = await mainWin.evaluate(() => ({
            video: !!window.__videoRecorderInjected,
            dialogs: !!window.__nativeDialogsInjected,
            toastFilter: !!window.__dataErrorToastFiltered,
        }));
        assert(w5.video, 'W5 __videoRecorderInjected（injectVideoRecorder 已注入主窗口）');
        assert(w5.dialogs, 'W5 __nativeDialogsInjected（原生 dialog 注入完成）');
        assert(w5.toastFilter, 'W5 __dataErrorToastFiltered（toast 过滤注入完成）');

        // ---------- W6 原生 dialog 替换 ----------
        const w6 = await mainWin.evaluate(() => ({
            alertWrapped: window.alert.toString().includes('alertSync') || window.alert.toString().includes('electronAPI'),
            confirmWrapped: window.confirm.toString().includes('confirmSync') || window.confirm.toString().includes('electronAPI'),
        }));
        assert(w6.alertWrapped, 'W6 window.alert 已被 electronAPI.alertSync 包装');
        assert(w6.confirmWrapped, 'W6 window.confirm 已被 electronAPI.confirmSync 包装');

        // ---------- W7 will-navigate 导航防护 ----------
        const beforeUrl = mainWin.url();
        await mainWin.evaluate(() => { location.href = 'https://example.com/b2-2-nav-guard'; });
        await new Promise(r => setTimeout(r, 1200));
        const afterUrl = mainWin.url();
        assert(afterUrl === beforeUrl && afterUrl.startsWith('file://'),
            `W7 远程整页导航被阻断（仍 ${afterUrl.slice(0, 48)}…）`);

        // ---------- W8 window.open 拦截 ----------
        const beforeCount = (await winInfos(app)).length;
        await mainWin.evaluate(() => { window.open('https://example.com/b2-2-open-guard'); });
        await new Promise(r => setTimeout(r, 1200));
        const afterCount = (await winInfos(app)).length;
        assert(afterCount === beforeCount, `W8 window.open 外部 URL 未新开窗口（${beforeCount} → ${afterCount}）`);

        // ---------- W9 登录窗口 closed 状态回写 ----------
        const loginRemain = infos.filter(w => (w.url || '').includes('login.html') && !w.destroyed);
        const loginPages = app.windows().filter(w => w.url().includes('login.html'));
        assert(loginRemain.length === 0 && loginPages.length === 0,
            'W9 登录成功后 login 窗口已关闭（closed → setLoginWindow(null) 接线正常）');

        passed = failures === 0;
    } catch (e) {
        console.error(`[WV][FAIL] 异常终止: ${e && e.message || e}`);
        if (e && e.stack) console.error(e.stack.split('\n').slice(0, 4).join('\n'));
    } finally {
        if (app) await killApp(app);
        try { if (fs.existsSync(marker)) fs.rmSync(marker); } catch (_) {}
        if (!keepTmp) rmrfSafe(TMP_BASE);
    }

    console.log('');
    const ms = Date.now() - t0;
    if (passed) {
        console.log(`[WV] ══ 全部通过：${total}/${total} 断言绿（${(ms / 1000).toFixed(1)}s）══`);
        process.exit(0);
    } else {
        console.log(`[WV] ══ 存在失败：${failures}/${total} 红 ══`);
        process.exit(1);
    }
})().catch(e => { console.error('[WV][FATAL]', e); process.exit(1); });
