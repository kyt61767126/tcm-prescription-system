// ============================================================================
// verify-fs-domain.cjs — B2-1 文件域抽取（desktop-fs-ipc.cjs）专项 E2E 验证·云桌面
//
// 与 db-offline/desktop/e2e/verify-fs-domain.cjs 同构（双端文件域字节级同体，
// 本脚本验证云桌面 main.js 集成点：require 工厂注入 + 启动链路 + 19 个 handler 注册）。
// 差异仅三处：config（cloud_clinic 机构版）、登录后等待标志（userManageBtn）、 productName。
//
// 与 run-e2e.cjs 的区别：
//   - 被测目标：dev electron.exe + 源码 electron/main.js 直启（不依赖打包产物，
//     改完 shared/desktop-fs-ipc.cjs 同步后即可立即回归，无需 20min 重打包）
//   - 断言域：文件域 IPC 真实落盘（媒体保存/查找/重命名/删除、用户数据、
//     备份读写、自动备份、路径白名单），而非登录/权限 UI
//
// 三重隔离（绝不触碰真实「安装盘\惠康中医媒体」与真实 userData）：
//   ① BNZC_E2E=1 + exe 同级 marker → 放行远程调试（main.js e2e 旁路）
//   ② BNZC_E2E_DATA → app.setPath('userData') 隔离（license / auto-backup 兜底）
//   ③ PORTABLE_EXECUTABLE_DIR → getExeDirectory 走便携分支：
//      媒体（downloads/<月>）、用户数据（data/）、备份（downloads/中医处方系统）、
//      config.json（main.js 便携读取点）全部落入临时目录
//
// 用例（F1-F6，renderer 真实 IPC 调用 + Node 侧落盘断言）：
//   F1 用户数据回环：save-user-data → get-user-data 深比较 + data/<key>.json 落盘
//   F2 媒体保存+查找：save-prescription-image → find-media-files 姓名_编号命中 + 字节校验
//   F3 媒体重命名：rename-media-files → 旧前缀查无、新前缀命中
//   F4 备份回环：save-backup-file → list-backup-files 含 → read-backup-file 内容一致
//   F5 自动备份回环：save → list → delete → 再列已无（userData/backups）
//   F6 媒体删除：delete-file 白名单正删落盘消失 + 白名单外路径拒绝
//
// 用法：node e2e\verify-fs-domain.cjs [--keep]
// 退出码：0 全过；1 任一失败
// ============================================================================
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TMP_ROOT = path.join(__dirname, '.tmp');
// ★ 每轮运行唯一 tmp 目录：强杀残留/Defender 句柄锁住旧目录时（EPERM），绝不阻断本轮
const TMP_BASE = path.join(TMP_ROOT, `fsverify-${process.pid}-${Date.now()}`);
const MARKER_NAME = 'e2e-enabled.marker';
const E2E_PASSWORD = 'E2ePass123!';
const USERNAME = 'e2eadmin';
// 1x1 透明 PNG（固定字节，便于落盘内容比对）
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const PNG_BUFFER = Buffer.from(PNG_B64, 'base64');

const keepTmp = process.argv.includes('--keep');

function rmrfSafe(p) {
    try { fs.rmSync(p, { recursive: true, force: true }); } catch (_) { /* 句柄锁定等，容忍 */ }
}

const t0 = Date.now();
const log = (m) => console.log(`[FSV +${String(Date.now() - t0).padStart(5)}ms] ${m}`);
let failures = 0;
let total = 0;
function assert(cond, label) {
    total++;
    if (cond) { log(`  ✓ ${label}`); return true; }
    failures++;
    log(`  ✗ FAIL: ${label}`);
    return false;
}

// —— findWindow / login / killApp：与 run-e2e.cjs 同款（经过打包流水线验证）——
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
    // ★ 反自动填充双保险（main.js dom-ready 注入）：密码框初始 readonly，focus 时才移除。
    //   先 focus 触发移除，确认可编辑后再填（与 run-e2e.cjs 同款修复）。
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
            //   taskkill /T 树杀 + 退化 kill 双兜底。
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

// 云桌面机构版 config（app 启动会自动补签名；本地账号走离线校验 fallback，与 run-e2e E1 同构）
function baseConfig() {
    return {
        clinicName: 'E2E文件域验证诊所',
        doctorName: 'E2E医师',
        edition: 'cloud_clinic',
        appMode: 'cloud',
        maxUsers: 5,
        productName: '惠康中医-云端',
        versionLabel: '云端机构版',
        users: [{ username: USERNAME, password: E2E_PASSWORD, name: 'E2E管理员', role: 'admin' }],
    };
}

// ============================================================================
// 主流程：launch（dev electron + 源码 main.js）→ 登录 → F1-F6 文件域断言
// ============================================================================
(async () => {
    console.log('[FSV] ══ B2-1 文件域抽取专项验证·云桌面（dev electron + 源码直启）══');
    const devElectron = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');
    const mainJs = path.join(ROOT, 'electron', 'main.js');
    const fsIpcCjs = path.join(ROOT, 'electron', 'desktop-fs-ipc.cjs');
    for (const [label, p] of [['dev electron', devElectron], ['electron/main.js 源码', mainJs], ['electron/desktop-fs-ipc.cjs', fsIpcCjs]]) {
        if (!fs.existsSync(p)) { console.error(`[FSV][FAIL] 缺少 ${label}: ${p}`); process.exit(1); }
    }
    log(`被测目标: dev electron + ${mainJs}（测最新 B2-1 代码，非打包产物）`);

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

    fs.writeFileSync(marker, `fs-verify ${new Date().toISOString()}\n`, 'utf8');

    let app = null;
    let passed = false;
    try {
        // ★ 启动即验证：B2-1 模块 require + 工厂注册 + 启动链路未被破坏
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

        const consoleBuf = [];
        try { app.context().on('console', (msg) => { try { consoleBuf.push(`[${msg.type()}] ${msg.text()}`); } catch (_) {} }); } catch (_) {}

        const loginWin = await findWindow(app, 'login.html', 30000);
        log('登录窗口就绪（desktop-fs-ipc.cjs 加载/注册未破坏启动链路）✓');

        const mainWinPromise = findWindow(app, 'index.html', 90000);
        mainWinPromise.catch(() => {});
        await login(loginWin, USERNAME, E2E_PASSWORD);
        const mainWin = await mainWinPromise;
        log('主窗口就绪');

        // 等权限流程跑完（机构版管理员：【用户管理】亮起 = edition/permission 已生效）
        await mainWin.waitForFunction(() => {
            const b = document.getElementById('userManageBtn');
            return !!b && b.style.display !== 'none';
        }, null, { timeout: 20000 });
        log('权限流程完成（机构版 admin），开始文件域断言');

        // ---------- F1 用户数据回环 ----------
        log('F1 用户数据：save → get 深比较 + 落盘');
        const f1Save = await mainWin.evaluate(() => window.electronAPI.saveUserData('e2e_fs_key', { hello: 'world', n: 42, arr: [1, 2, 3] }));
        assert(f1Save && f1Save.success === true, 'save-user-data 返回 success');
        const f1Get = await mainWin.evaluate(() => window.electronAPI.getUserData('e2e_fs_key'));
        assert(f1Get && f1Get.success === true
            && f1Get.data && f1Get.data.hello === 'world' && f1Get.data.n === 42
            && JSON.stringify(f1Get.data.arr) === '[1,2,3]', 'get-user-data 回读深比较一致');
        assert(fs.existsSync(path.join(portable, 'data', 'e2e_fs_key.json')), '落盘 data/e2e_fs_key.json（便携 data 目录）');
        // key 白名单反向：非法 key 必须被拒
        const f1Bad = await mainWin.evaluate(() => window.electronAPI.saveUserData('../evil', { x: 1 }));
        assert(f1Bad && f1Bad.success === false, '路径穿越 key（../evil）被 isSafeKey 拒绝');

        // ---------- F2 媒体保存+查找 ----------
        log('F2 媒体：save-prescription-image → find-media-files + 字节校验');
        const imgName = 'E2E患者_E2E0001.png';
        const f2Save = await mainWin.evaluate(async ({ dataUrl, name }) => window.electronAPI.savePrescriptionImage(dataUrl, name), { dataUrl: `data:image/png;base64,${PNG_B64}`, name: imgName });
        assert(f2Save && f2Save.success === true && f2Save.filePath, 'save-prescription-image 返回 success+filePath');
        assert(f2Save.filePath && fs.existsSync(f2Save.filePath), `落盘 ${imgName}`);
        assert(f2Save.filePath && fs.readFileSync(f2Save.filePath).equals(PNG_BUFFER), '落盘字节与传入 base64 完全一致');
        const monthDir = new Date().getFullYear() + '-' + String(new Date().getMonth() + 1).padStart(2, '0');
        assert(f2Save.directory && f2Save.directory === path.join(portable, 'downloads', monthDir), `月目录 = 便携 downloads\\${monthDir}`);
        const f2Find = await mainWin.evaluate(() => window.electronAPI.findMediaFiles('E2E患者', 'E2E0001'));
        assert(f2Find && f2Find.success === true && f2Find.files.some(f => f.name === imgName), 'find-media-files 姓名_编号命中刚保存文件');

        // ---------- F3 媒体重命名 ----------
        log('F3 媒体：rename-media-files（旧前缀查无、新前缀命中）');
        const f3Rename = await mainWin.evaluate(() => window.electronAPI.renameMediaFiles('E2E患者', 'E2E新患', 'E2E0001', 'E2E0002'));
        assert(f3Rename && f3Rename.success === true && f3Rename.renamed >= 1, `rename 计数 ≥ 1（实际 ${f3Rename && f3Rename.renamed}）`);
        const f3FindNew = await mainWin.evaluate(() => window.electronAPI.findMediaFiles('E2E新患', 'E2E0002'));
        assert(f3FindNew && f3FindNew.success === true && f3FindNew.files.length >= 1, '新前缀 E2E新患_E2E0002 命中');
        const f3FindOld = await mainWin.evaluate(() => window.electronAPI.findMediaFiles('E2E患者', 'E2E0001'));
        assert(f3FindOld && f3FindOld.files.length === 0, '旧前缀 E2E患者_E2E0001 已查无');
        const mediaPath = f3FindNew && f3FindNew.files[0] && f3FindNew.files[0].path;
        assert(!!mediaPath && fs.existsSync(mediaPath), '改名后文件真实存在于新路径');

        // ---------- F4 备份回环 ----------
        log('F4 备份：save-backup-file → list → read 回环');
        const backupName = 'e2e_backup_20260913.json';
        const backupJson = JSON.stringify({ e2e: true, ts: 1760000000000, note: 'fs-domain-verify' });
        const f4Save = await mainWin.evaluate(async ({ json, name }) => window.electronAPI.saveBackupFile(json, name), { json: backupJson, name: backupName });
        assert(f4Save && f4Save.success === true && f4Save.filePath, 'save-backup-file 返回 success+filePath');
        assert(f4Save.filePath && fs.existsSync(f4Save.filePath), `落盘 downloads\\中医处方系统\\${backupName}`);
        const f4List = await mainWin.evaluate(() => window.electronAPI.listBackupFiles());
        assert(f4List && f4List.success === true && f4List.files.some(f => f.fileName === backupName), 'list-backup-files 含刚写入备份');
        const f4Read = await mainWin.evaluate((name) => window.electronAPI.readBackupFile(name), backupName);
        assert(f4Read && f4Read.success === true && f4Read.json === backupJson, 'read-backup-file 内容与写入完全一致');

        // ---------- F5 自动备份回环（userData/backups，BNZC_E2E_DATA 隔离目录） ----------
        log('F5 自动备份：save → list → delete → 再列已无');
        const now = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        const autoName = `backup_${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.json`;
        const f5Save = await mainWin.evaluate(async ({ json, name }) => window.electronAPI.saveAutoBackup(json, name), { json: '{"a":1}', name: autoName });
        assert(f5Save && f5Save.success === true, 'save-auto-backup 返回 success');
        assert(fs.existsSync(path.join(userdata, 'backups', autoName)), '落盘 userData\\backups（e2e 隔离目录，未污染真实数据）');
        const f5List = await mainWin.evaluate(() => window.electronAPI.listAutoBackups());
        assert(f5List && f5List.success === true && f5List.files.some(f => f.fileName === autoName), 'list-auto-backups 含刚写入');
        const f5Del = await mainWin.evaluate((name) => window.electronAPI.deleteAutoBackup(name), autoName);
        assert(f5Del && f5Del.success === true, 'delete-auto-backup 返回 success');
        const f5List2 = await mainWin.evaluate(() => window.electronAPI.listAutoBackups());
        assert(f5List2 && !f5List2.files.some(f => f.fileName === autoName), '删除后 list 已无该备份');

        // ---------- F6 媒体删除 + 白名单 ----------
        log('F6 媒体删除：delete-file 正删 + 白名单外路径拒绝');
        const f6Del = await mainWin.evaluate((p) => window.electronAPI.deleteFile(p), mediaPath);
        assert(f6Del && f6Del.success === true, 'delete-file 白名单内正删成功');
        assert(!fs.existsSync(mediaPath), '媒体文件落盘已消失');
        const f6Bad = await mainWin.evaluate((p) => window.electronAPI.deleteFile(p), 'C:\\Windows\\win.ini');
        assert(f6Bad && f6Bad.success === false, '白名单外路径（C:\\Windows\\win.ini）删除被拒绝');

        passed = failures === 0;
        if (!passed && consoleBuf.length) {
            log('失败，最近 console（最多15条）：');
            for (const l of consoleBuf.slice(-15)) log('    ' + l);
        }
    } catch (e) {
        log(`FAIL: ${e.message}`);
    } finally {
        if (app) await killApp(app);
        try { fs.rmSync(marker, { force: true }); } catch (_) {}
        if (!keepTmp) rmrfSafe(TMP_BASE);
    }

    console.log('══════════════════════════════════════');
    if (passed) {
        console.log(`[PASS] 文件域专项验证 ALL PASS ✓（F1-F6，共 ${total} 项断言）`);
        console.log('[FSV] 验证对象：shared/desktop-fs-ipc.cjs 经 sync-all 分发后的云桌面副本');
        process.exit(0);
    } else {
        console.log(`[FAIL] 文件域专项验证失败（${failures} 项断言未过）`);
        process.exit(1);
    }
})();
