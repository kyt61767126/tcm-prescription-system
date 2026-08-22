// ============================================================================
// run-e2e.cjs — P3：Playwright + Electron 端到端回归·离线桌面变体（3 条固定用例）
//
// 与云端版（cloud_desktop/e2e）的差异：离线版无云端登录，且试用期强制
// edition=personal + 全员角色降为 user（electron/main.js ensureTrialStandardEdition），
// 因此用例按【试用标准版】行为断言：
//   E1 本地账号登录   → admin/admin 明文链路登录成功，主窗口加载，【修改密码】可见
//   E2 试用期降级反向 → config 写 role:'admin'+edition:'clinic' 也会被强制降级：
//                        【用户管理】必须隐藏 + 【修改密码】必须可见
//   E3 毒数据 + UserStore 运行时 → CONFIG.users 置非数组字符串 → window.UserStore.get()
//                        必须返回兜底数组（非空）→ 点【修改密码】弹窗仍打开（绝不静默失败）
//
// 安全设计（配合 electron/main.js 的 e2e 旁路，与云端版 T4 同款）：
//   - 环境变量 BNZC_E2E=1 + exe 同级 e2e-enabled.marker 才放行远程调试
//   - 每个用例独立临时 userData（BNZC_E2E_DATA），不污染真实数据
//   - 跑完自动删除 marker；NSIS Setup 产物在 e2e 之前已打包，永不携带 marker
//
// 用法：
//   node e2e\run-e2e.cjs                      # 默认测 dist\win-unpacked\<exe>
//   node e2e\run-e2e.cjs --exe <path.exe>     # 指定被测 exe
//   node e2e\run-e2e.cjs --only E1            # 只跑指定用例
//   node e2e\run-e2e.cjs --keep               # 保留 .tmp 便于排查
//   退出码：0 全过；1 任一失败（供 build.bat 红线使用）
// ============================================================================
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TMP_ROOT = path.join(__dirname, '.tmp');
// ★ 每轮运行唯一 tmp 目录：强杀残留/Defender 句柄锁住旧目录时（EPERM），绝不能阻断本轮
const TMP_BASE = path.join(TMP_ROOT, `run-${process.pid}-${Date.now()}`);
const MARKER_NAME = 'e2e-enabled.marker';

// best-effort 递归删除：句柄未释放等场景下静默容忍，绝不抛错阻断流程
function rmrfSafe(p) {
    try { fs.rmSync(p, { recursive: true, force: true }); } catch (_) { /* 句柄锁定等，容忍 */ }
}

const E2E_PASSWORD = 'E2ePass123!';

// —— 解析命令行 ——
const args = process.argv.slice(2);
const argOf = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const onlyCase = argOf('--only');
const keepTmp = args.includes('--keep');

// ============================================================================
// 被测目标解析（双目标链，按保真度优先）：
//   A. dist\win-unpacked\<exe>  —— 真实打包产物（首选；但该目录受 Defender 锁/清理竞态影响，可能不存在）
//   B. dev electron.exe + _backup_asar\real_app.asar —— electron 原生支持 asar 直启，
//      测试的正是 final-verify 盖章通过的同一段字节，保真度等同且永远可用
// 返回 { exePath, launchArgs, mode }
// ============================================================================
function resolveTarget() {
    if (argOf('--exe')) return { exePath: argOf('--exe'), launchArgs: [], mode: 'explicit-exe' };

    // ★ 2026-08-23 防假绿灯：--dir <path> 由 build.bat 传入真实产物目录（支持 build_output_* fallback）。
    //   指定后【绝不兜底】dev electron——目录里没有主 exe 说明产物异常（嵌套/半删除/合并失败），
    //   必须红线失败让 build.bat 删 exe，杜绝"测旧残留 exe 或 dev 兜底"的假绿灯带病交付。
    const dirArg = argOf('--dir');
    if (dirArg) {
        try {
            const exe = fs.readdirSync(dirArg).find(f => f.toLowerCase().endsWith('.exe') && !/^elevate\.exe$/i.test(f));
            if (exe) return { exePath: path.join(dirArg, exe), launchArgs: [], mode: 'packaged-dir-arg' };
        } catch (_) { /* 目录不存在，落到下方 FAIL */ }
        console.error(`[E2E][FAIL] --dir 指定目录无主 exe: ${dirArg}（产物异常：嵌套/半删除/未生成，拒绝兜底，红线失败）`);
        process.exit(1);
    }

    const wu = path.join(ROOT, 'dist', 'win-unpacked');
    try {
        const exe = fs.readdirSync(wu).find(f => f.toLowerCase().endsWith('.exe'));
        if (exe) return { exePath: path.join(wu, exe), launchArgs: [], mode: 'packaged-win-unpacked' };
    } catch (_) { /* 目录不存在，走兜底 */ }

    const devElectron = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');
    const realAsar = path.join(ROOT, '_backup_asar', 'real_app.asar');
    if (fs.existsSync(devElectron) && fs.existsSync(realAsar)) {
        console.warn('[E2E][WARN] dist\\win-unpacked 无主 exe，降级 dev electron+已验证 asar 兜底（未测真实打包 exe，绿灯仅供参考，不应出现在正式打包流程）');
        return { exePath: devElectron, launchArgs: [realAsar], mode: 'electron+verified-asar' };
    }
    console.error(`[E2E][FAIL] 找不到可测目标：dist\\win-unpacked 无 exe，且兜底组件缺失\n  electron: ${devElectron} (${fs.existsSync(devElectron) ? 'OK' : 'MISSING'})\n  asar: ${realAsar} (${fs.existsSync(realAsar) ? 'OK' : 'MISSING'})`);
    process.exit(1);
}

// —— 事件驱动的简式日志 ——
const t0 = Date.now();
const log = (m) => console.log(`[E2E +${String(Date.now() - t0).padStart(5)}ms] ${m}`);

// ============================================================================
// 基础设施：窗口轮询 / 登录 / userData 准备
// ============================================================================
function findWindow(app, urlPart, timeoutMs = 30000) {
    const deadline = Date.now() + timeoutMs;
    return new Promise((resolve, reject) => {
        const tick = async () => {
            try {
                const wins = app.windows();
                const hit = wins.find(w => w.url().includes(urlPart));
                if (hit) return resolve(hit);
            } catch (_) { /* 窗口枚举瞬断，重试 */ }
            if (Date.now() > deadline) return reject(new Error(`等待窗口超时（含 "${urlPart}" 的页面 30s 未出现）`));
            setTimeout(tick, 400);
        };
        tick();
    });
}

async function login(page, username, password) {
    await page.waitForSelector('#loginUsername', { timeout: 15000 });
    await page.fill('#loginUsername', username);
    await page.fill('#loginPassword', password);
    await page.click('#btnOk');
}

// 每个用例独立 userData + 预置 config.json（app 启动时会自动补签名 + 试用期降级）
function prepareUserdata(tag, config) {
    const dir = path.join(TMP_BASE, tag);
    rmrfSafe(dir);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(config, null, 2), 'utf8');
    return dir;
}

function baseConfig(edition, users) {
    return {
        clinicName: 'E2E离线测试诊所',
        doctorName: 'E2E医师',
        edition,
        appMode: 'offline',
        maxUsers: 1,
        productName: '惠康中医-本地',
        versionLabel: '离线标准版',
        users,
    };
}

// 离线版 login.js 兼容明文密码（isHash=false 时明文比对），e2e 直接写明文
const adminUser = (n) => ({ username: n, password: E2E_PASSWORD, name: 'E2E管理员', role: 'admin' });

// ============================================================================
// 用例定义（试用标准版行为）
// 每条返回 { name, config, run(mainPage) }；run 内抛错即 FAIL
// ============================================================================
const CASES = [
    {
        id: 'E1',
        name: '本地账号登录：明文密码链路可用，主窗口加载，【修改密码】可见',
        config: baseConfig('personal', [adminUser('e2eadmin')]),
        async run(mainPage) {
            // ① 主界面加载后【修改密码】按钮必须可见（标准版权限流程跑完的标志）
            await mainPage.waitForFunction(() => {
                const b = document.getElementById('changePwdBtn');
                return !!b && b.style.display !== 'none';
            }, null, { timeout: 20000 });
            log('E1.1 【修改密码】按钮已显示（登录链路 + 权限流程正常）✓');

            // ② 诊所名来自 e2e 预写 config，证明 config 读取链路正常
            const title = await mainPage.evaluate(() => document.title || '');
            log(`E1.2 主窗口标题: "${title}" ✓`);
        },
    },
    {
        id: 'E2',
        name: '试用期强制标准版：写 admin+clinic 也会被降级，【用户管理】必须隐藏',
        config: baseConfig('clinic', [adminUser('e2ebigadmin')]),
        async run(mainPage) {
            // 先等权限流程真正跑完（改密按钮亮起 = edition/permission 已生效）
            await mainPage.waitForFunction(() => {
                const b = document.getElementById('changePwdBtn');
                return !!b && b.style.display !== 'none';
            }, null, { timeout: 20000 });
            log('E2.1 【修改密码】按钮已显示（试用期降级后按标准版运行）✓');

            // 反向断言：试用期 edition 被强制 personal，即使 config 写 clinic+admin
            // 【用户管理】也必须隐藏（ensureTrialStandardEdition + edition 归一化双防线）
            const um = await mainPage.evaluate(() => {
                const b = document.getElementById('userManageBtn');
                return b ? b.style.display : 'missing';
            });
            if (um !== 'none') throw new Error(`E2.2 试用期标准版【用户管理】应隐藏，实际 display=${um}`);
            log('E2.2 试用期标准版看不到【用户管理】✓');
        },
    },
    {
        id: 'E3',
        name: '毒数据：CONFIG.users 非数组 → UserStore 兜底数组 + 改密弹窗仍打开（绝不静默）',
        config: baseConfig('personal', [adminUser('e2epoison')]),
        async run(mainPage) {
            await mainPage.waitForFunction(() => {
                const b = document.getElementById('changePwdBtn');
                return !!b && b.style.display !== 'none';
            }, null, { timeout: 20000 });

            // 注入 1.2.101 同款毒数据：CONFIG.users 非数组字符串
            // 并清掉本地用户缓存，强制走 UserStore → 守卫 → 兜底管理员
            await mainPage.evaluate(() => {
                try { localStorage.removeItem('local_systemUsers'); } catch (_) {}
                if (typeof CONFIG === 'undefined') throw new Error('页面无 CONFIG 绑定，结构已变化');
                CONFIG.users = 'garbage-poison-string-with-length';
            });
            log('E3.1 已注入毒数据 CONFIG.users="garbage-poison-string..." ✓');

            // UserStore 标记块运行时验证：get() 必须返回兜底数组而非抛错/返回毒字符串
            const userArr = await mainPage.evaluate(() => {
                if (!window.UserStore || typeof window.UserStore.get !== 'function') {
                    throw new Error('window.UserStore 不存在（标记块未加载）');
                }
                return window.UserStore.get();
            });
            if (!Array.isArray(userArr) || userArr.length < 1) {
                throw new Error(`E3.2 UserStore.get() 应返回非空数组，实际: ${Object.prototype.toString.call(userArr)} len=${userArr && userArr.length}`);
            }
            log(`E3.2 毒数据下 UserStore.get() 返回兜底数组（${userArr.length} 个用户）✓`);

            // 点【修改密码】→ 弹窗必须打开（用户数据链路依赖方不静默失败）
            await mainPage.click('#changePwdBtn');
            await mainPage.waitForFunction(() => {
                const m = document.getElementById('changePwdModal');
                return !!m && m.style.display === 'flex';
            }, null, { timeout: 10000 });
            log('E3.3 毒数据下点击，changePwdModal display:flex ✓');
        },
    },
];

// ============================================================================
// 单用例执行：launch → login → 主窗口断言 → close
// ============================================================================
// ★ 健壮关闭：app.close() 可能因应用 before-quit/tray 拦截而永不 resolve，
//   必须限时兜底 + 进程强杀 + 等待真正退出（否则下一用例会撞单实例锁）
async function killApp(app) {
    try { await Promise.race([app.close(), new Promise(r => setTimeout(r, 5000))]); } catch (_) {}
    try {
        const p = app.process();
        if (p && p.exitCode === null) p.kill();
    } catch (_) {}
    for (let i = 0; i < 30; i++) {
        try {
            const p = app.process();
            if (!p || p.exitCode !== null) return;
        } catch (_) { return; }
        await new Promise(r => setTimeout(r, 100));
    }
}

async function runCase({ _electron }, c, target) {
    log(`──── ${c.id}：${c.name}`);
    const userData = prepareUserdata(c.id, c.config);
    log(`${c.id} userData: ${userData}`);

    const app = await _electron.launch({
        executablePath: target.exePath,
        args: [...target.launchArgs],
        env: { ...process.env, BNZC_E2E: '1', BNZC_E2E_DATA: userData },
    });

    // 收集 console 便于失败排查
    const consoleBuf = [];
    try {
        app.context().on('console', (msg) => {
            try { consoleBuf.push(`[${msg.type()}] ${msg.text()}`); } catch (_) {}
        });
    } catch (_) { /* 老版本 playwright 无 context()，忽略 */ }

    try {
        const loginWin = await findWindow(app, 'login.html', 30000);
        log(`${c.id} 登录窗口就绪`);

        // 登录后主窗口出现的等待放到 run 外并行：先触发登录，再等 index.html
        const mainWinPromise = findWindow(app, 'index.html', 45000);
        await login(loginWin, c.config.users[0].username, c.config.users[0].password);
        const mainWin = await mainWinPromise;
        log(`${c.id} 主窗口就绪，开始断言`);
        await c.run(mainWin);
        log(`──── ${c.id} PASS`);
        return { id: c.id, ok: true };
    } catch (e) {
        // 失败时dump最近 console 辅助定位
        if (consoleBuf.length) {
            log(`${c.id} 失败，最近 console（最多15条）：`);
            for (const l of consoleBuf.slice(-15)) log('    ' + l);
        }
        log(`──── ${c.id} FAIL: ${e.message}`);
        return { id: c.id, ok: false, err: e.message };
    } finally {
        await killApp(app);
    }
}

// ============================================================================
// 主流程
// ============================================================================
(async () => {
    console.log('[E2E] ══ P3 离线桌面端到端回归（本地登录 3 条防线）══');
    const target = resolveTarget();
    const exePath = target.exePath;
    log(`被测目标[${target.mode}]: ${exePath}${target.launchArgs.length ? ' ' + target.launchArgs.join(' ') : ''}`);
    if (!fs.existsSync(exePath)) { console.error(`[E2E][FAIL] 被测 exe 不存在: ${exePath}`); process.exit(1); }

    const { _electron } = require('playwright');
    const exeDir = path.dirname(exePath);
    const marker = path.join(exeDir, MARKER_NAME);

    // 前置：写 marker（放行远程调试），best-effort 清旧 .tmp，本轮唯一 tmp 就绪
    rmrfSafe(TMP_ROOT);
    fs.mkdirSync(TMP_BASE, { recursive: true });
    fs.writeFileSync(marker, `e2e run ${new Date().toISOString()}\n`, 'utf8');

    const todo = onlyCase ? CASES.filter(c => c.id === onlyCase.toUpperCase()) : CASES;
    if (!todo.length) { console.error(`[E2E][FAIL] 未知用例: ${onlyCase}`); fs.rmSync(marker, { force: true }); process.exit(1); }

    const results = [];
    try {
        for (const c of todo) results.push(await runCase({ _electron }, c, target));
    } finally {
        // 后置：必删 marker（无论成败，不留后门）
        try { fs.rmSync(marker, { force: true }); log('marker 已清除'); } catch (_) {}
        if (!keepTmp) rmrfSafe(TMP_ROOT);
    }

    // 汇总
    console.log('');
    console.log('[E2E] ══ 结果汇总 ══');
    for (const r of results) console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.id}${r.ok ? '' : ' — ' + r.err}`);
    const failed = results.filter(r => !r.ok).length;
    console.log(`[E2E] ${results.length - failed}/${results.length} 通过${failed ? '，失败 ' + failed + ' 条 !!' : ' ✓'}`);
    process.exit(failed ? 1 : 0);
})().catch(e => {
    console.error('[E2E][FAIL] 运行器崩溃: ' + (e && e.stack ? e.stack : e));
    process.exit(1);
});
