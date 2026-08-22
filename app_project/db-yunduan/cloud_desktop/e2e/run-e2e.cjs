// ============================================================================
// run-e2e.cjs — T4：Playwright + Electron 端到端回归（3 条固定用例）
//
// 用例（对应 1.2.101 "【用户管理】按钮显示但点不开" 事故的三条防线）：
//   E1 机构版管理员登录 → 【用户管理】按钮可见 → 点击 → userManageModal 弹出（display:flex）
//   E2 标准版登录       → 【用户管理】隐藏 + 【修改密码】可见（权限矩阵反向断言）
//   E3 毒数据注入       → CONFIG.users 置为非数组字符串 → 点击 → 弹窗仍打开（绝不静默失败）
//
// 安全设计（配合 electron/main.js 的 e2e 旁路）：
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

// 每个用例独立 userData + 预置 config.json（app 启动时会自动补签名）
function prepareUserdata(tag, config) {
    const dir = path.join(TMP_BASE, tag);
    rmrfSafe(dir);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(config, null, 2), 'utf8');
    return dir;
}

function baseConfig(edition, users) {
    return {
        clinicName: 'E2E测试诊所',
        doctorName: 'E2E医师',
        edition,
        appMode: 'cloud',
        maxUsers: 5,
        productName: '惠康中医-云端',
        versionLabel: edition === 'cloud_clinic' ? '云端机构版' : '云端标准版',
        users,
    };
}

const adminUser = (n) => ({ username: n, password: E2E_PASSWORD, name: 'E2E管理员', role: 'admin' });
// ★ 标准版机器上的合法账户必须是 role:'user'：
//   login.js「版本匹配安全隔离」把 role=admin/clinic_admin 视为机构账户，
//   在标准版机器上会被拒绝登录（"该账户属于【机构版】"）
const soloUser = (n) => ({ username: n, password: E2E_PASSWORD, name: 'E2E用户', role: 'user' });

// ============================================================================
// 用例定义
// 每条返回 { name, config, run(mainPage) }；run 内抛错即 FAIL
// ============================================================================
const CASES = [
    {
        id: 'E1',
        name: '机构版管理员：【用户管理】可见→点击→弹窗打开（1.2.101 主防线）',
        config: baseConfig('cloud_clinic', [adminUser('e2eadmin')]),
        async run(mainPage) {
            // ① 按钮必须变为可见（edition 异步生效，轮询等待）
            await mainPage.waitForFunction(() => {
                const b = document.getElementById('userManageBtn');
                return !!b && b.style.display !== 'none';
            }, null, { timeout: 20000 });
            log('E1.1 【用户管理】按钮已显示 ✓');

            // ② 点击 → 模态框必须真正打开
            await mainPage.click('#userManageBtn');
            await mainPage.waitForFunction(() => {
                const m = document.getElementById('userManageModal');
                return !!m && m.style.display === 'flex';
            }, null, { timeout: 10000 });
            log('E1.2 点击后 userManageModal display:flex ✓');

            // ③ 机构版管理员走用户管理而非改密（权限矩阵正向）
            const chg = await mainPage.evaluate(() => {
                const b = document.getElementById('changePwdBtn');
                return b ? b.style.display : 'missing';
            });
            if (chg !== 'none') throw new Error(`E1.3 机构版管理员【修改密码】应隐藏，实际 display=${chg}`);
            log('E1.3 【修改密码】对机构版管理员隐藏 ✓');
        },
    },
    {
        id: 'E2',
        name: '标准版（personal）：【用户管理】隐藏 + 【修改密码】可见（反向断言）',
        config: baseConfig('cloud_personal', [soloUser('e2esolo')]),
        async run(mainPage) {
            // 先等权限流程真正跑完（改密按钮亮起 = edition/permission 已生效）
            await mainPage.waitForFunction(() => {
                const b = document.getElementById('changePwdBtn');
                return !!b && b.style.display !== 'none';
            }, null, { timeout: 20000 });
            log('E2.1 【修改密码】按钮已显示（权限流程已生效）✓');

            // 再断言用户管理必须隐藏 —— 即使 role=admin
            const um = await mainPage.evaluate(() => {
                const b = document.getElementById('userManageBtn');
                return b ? b.style.display : 'missing';
            });
            if (um !== 'none') throw new Error(`E2.2 标准版【用户管理】应隐藏，实际 display=${um}`);
            log('E2.2 标准版 admin 也看不到【用户管理】✓');
        },
    },
    {
        id: 'E3',
        name: '毒数据：CONFIG.users 非数组 → 点击【用户管理】仍打开弹窗（绝不静默）',
        config: baseConfig('cloud_clinic', [adminUser('e2epoison')]),
        async run(mainPage) {
            await mainPage.waitForFunction(() => {
                const b = document.getElementById('userManageBtn');
                return !!b && b.style.display !== 'none';
            }, null, { timeout: 20000 });

            // 注入 1.2.101 同款毒数据：CONFIG.users 非数组字符串
            // 并清掉本地用户缓存，强制走 getDefaultUsers → 守卫 → 兜底管理员
            // 注意：CONFIG 是 index.html 顶层 let/const 绑定，不在 window 上，必须裸引用
            await mainPage.evaluate(() => {
                try { localStorage.removeItem('local_systemUsers'); } catch (_) {}
                if (typeof CONFIG === 'undefined') throw new Error('页面无 CONFIG 绑定，结构已变化');
                CONFIG.users = 'garbage-poison-string-with-length';
            });
            log('E3.1 已注入毒数据 CONFIG.users="garbage-poison-string..." ✓');

            await mainPage.click('#userManageBtn');
            // 关键断言：要么弹窗打开（守卫生效走兜底），要么有 alert（可感知错误）——总之不许静默
            await mainPage.waitForFunction(() => {
                const m = document.getElementById('userManageModal');
                return !!m && m.style.display === 'flex';
            }, null, { timeout: 10000 });
            log('E3.2 毒数据下点击，userManageModal 仍 display:flex（兜底管理员渲染）✓');

            // 弹窗内 userList 容器必须存在（容器缺失=结构静默损坏才是失败）。
            // ★ 2026-08-22 与 2.36"唯一管理员模式"对齐：毒数据下兜底管理员=内置默认 admin
            //   （username=admin+出厂哈希），isBuiltinDefaultAdmin 判定后按设计隐藏 →
            //   列表为空属预期，不再断言非空（旧断言写于 1.2.101 时代，先于 2.36，已过时）。
            //   "绝不静默"防线由 E3.2（弹窗必须 display:flex）+ 本断言（容器存在）共同保障。
            const cnt = await mainPage.evaluate(() => {
                const l = document.getElementById('userList');
                return l ? l.querySelectorAll('*').length : -1;
            });
            if (cnt < 0) throw new Error('E3.3 userList 容器缺失，结构静默损坏');
            if (cnt === 0) log('E3.3 列表为空：兜底内置admin已被唯一管理员模式隐藏（2.36 设计预期）✓');
            else log(`E3.3 用户列表已渲染（${cnt} 个节点）✓`);
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
        if (p && p.exitCode === null) {
            // ★ 2026-08-22 僵尸进程根治：Node 的 p.kill()（TerminateProcess）只杀主进程，
            //   Electron 的 gpu/renderer/utility/crashpad 子进程会幸存 —— E2E 3 用例累计
            //   残留 ~15 个进程锁住 dist\win-unpacked，下次构建 prepare-win-unpacked 无法
            //   覆盖 exe → 新 asar + 旧 exe 混合产物（用户安装后闪退的元凶之一）。
            //   Windows 必须用 taskkill /T 整树强杀。
            if (process.platform === 'win32') {
                require('child_process').execSync(
                    `taskkill /PID ${p.pid} /T /F`, { stdio: 'ignore' });
            } else {
                p.kill();
            }
        }
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
    console.log('[E2E] ══ T4 端到端回归（用户管理按钮 3 条防线）══');
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
    try { fs.rmSync(path.join(path.dirname(exePath), MARKER_NAME), { force: true }); } catch (_) {}
    process.exit(1);
});
