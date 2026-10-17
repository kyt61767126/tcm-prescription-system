// ============================================================================
//  taobao-auto-activate.cjs — 淘宝"填码即自动开通"真机 E2E（CDP 驱动真实 exe）
//
//  复用项目既有 e2e 侦察姿势（cloud_desktop/e2e/probe-payurl-cdp.cjs）：
//    · BNZC_E2E=1 + exe 同级 e2e-enabled.marker → main.js 放行远程调试
//    · BNZC_E2E_DATA=<隔离目录> → 单实例锁之前 setPath('userData')，不污染真实数据
//    · --remote-debugging-port → Node 内置 WebSocket 连 CDP → Runtime.evaluate
//    · spawn(..., { stdio: 'ignore' }) → 避开沙箱管道限制
//
//  用法：
//    node e2e/taobao-auto-activate.cjs --edition=offline            # 空跑：只填表，不提交
//    node e2e/taobao-auto-activate.cjs --edition=cloud
//    node e2e/taobao-auto-activate.cjs --edition=offline \
//         --code=BNZC-XXXX-XXXX-XXXX-XXXX --phone=13900000001 \
//         --password=Abcd1234 --submit                              # 真实提交（消耗码）
//
//  退出码 0=通过；非 0=失败（失败原因打到 stdout）
// ============================================================================
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

// ---------------- 参数解析 ----------------
const argv = process.argv.slice(2);
const opt = (name, def) => {
    const hit = argv.find(a => a.startsWith('--' + name + '='));
    return hit ? hit.slice(name.length + 3) : def;
};
const EDITION = opt('edition', 'offline');
const CODE = opt('code', '');
const PHONE = opt('phone', '');
const PASSWORD = opt('password', 'Abcd1234');
const SUBMIT = argv.includes('--submit');
const KEEP = argv.includes('--keep');        // 跑完不删隔离目录，便于看 license.dat
const STUB_REQ = argv.includes('--stub-request');

if (!['offline', 'cloud'].includes(EDITION)) {
    console.error('--edition 只能是 offline 或 cloud');
    process.exit(2);
}
if (SUBMIT && (!CODE || !PHONE)) {
    console.error('--submit 需要同时提供 --code 和 --phone');
    process.exit(2);
}

const ROOT = path.resolve(__dirname, '..');
const PROJECT = EDITION === 'offline'
    ? path.join(ROOT, 'app_project', 'db-offline', 'desktop')
    : path.join(ROOT, 'app_project', 'db-yunduan', 'cloud_desktop');
const WU = path.join(PROJECT, 'dist', 'win-unpacked');
const MARKER = path.join(WU, 'e2e-enabled.marker');
const PORT = EDITION === 'offline' ? 9333 : 9334;
// ★ 沙箱约束：spawn 出来的进程只能写「工作区根」与 DSH 临时目录，
//   工作区子目录一律 EPERM。隔离 userData 因此放到系统临时目录，
//   既不碰工作区，也保证 Electron 子进程能写入自己的 userData。
const DATA = path.join(os.tmpdir(), 'kyt-taobao-e2e', `${EDITION}-${Date.now()}`);

const log = (m) => console.log('[' + EDITION + '] ' + m);
let failed = 0;
const check = (name, cond, detail) => {
    if (cond) log('PASS  ' + name);
    else { log('FAIL  ' + name + (detail ? '  —— ' + detail : '')); failed++; }
};

function findExe() {
    if (!fs.existsSync(WU)) throw new Error('未找到 win-unpacked 目录: ' + WU);
    const exe = fs.readdirSync(WU).find(f =>
        f.toLowerCase().endsWith('.exe') && !/^elevate\.exe$/i.test(f));
    if (!exe) throw new Error('win-unpacked 内未找到主 exe');
    return path.join(WU, exe);
}

// ---------------- CDP helpers ----------------
async function listTargets() {
    const r = await fetch(`http://127.0.0.1:${PORT}/json`);
    return r.json();
}
async function findPage(match, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    let last = [];
    while (Date.now() < deadline) {
        try {
            last = await listTargets();
            const hit = last.find(p => (p.url || '').includes(match));
            if (hit) return hit;
        } catch (_) { /* 端口未就绪 */ }
        await new Promise(r => setTimeout(r, 500));
    }
    log('CDP 目标清单（未命中 ' + match + '）: ' +
        JSON.stringify(last.map(p => ({ type: p.type, url: p.url })), null, 2));
    throw new Error('超时未发现页面: ' + match);
}
function findActivateWindow(timeoutMs) { return findPage('activate-window', timeoutMs); }
function connect(wsUrl) {
    const ws = new WebSocket(wsUrl);
    return new Promise((res, rej) => {
        ws.onopen = () => res(ws);
        ws.onerror = (e) => rej(new Error('WebSocket 连接失败'));
    });
}
let seq = 0;
function evalOn(ws, expr, timeoutMs) {
    return new Promise((resolve, reject) => {
        const id = ++seq;
        const onMsg = (ev) => {
            try {
                const d = JSON.parse(ev.data);
                if (d.id === id) {
                    ws.removeEventListener('message', onMsg);
                    if (d.error) reject(new Error(JSON.stringify(d.error)));
                    else resolve(d.result);
                }
            } catch (_) {}
        };
        ws.addEventListener('message', onMsg);
        ws.send(JSON.stringify({
            id, method: 'Runtime.evaluate',
            params: { expression: expr, returnByValue: true, awaitPromise: true }
        }));
        setTimeout(() => {
            ws.removeEventListener('message', onMsg);
            reject(new Error('eval 超时: ' + expr.slice(0, 60)));
        }, timeoutMs || 20000);
    });
}
async function val(ws, expr) {
    const r = await evalOn(ws, expr);
    return r && r.result ? r.result.value : undefined;
}
async function waitFor(ws, expr, timeoutMs, label) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try { if (await val(ws, expr) === true) return true; } catch (_) {}
        await new Promise(r => setTimeout(r, 500));
    }
    throw new Error('等待超时(' + label + '): ' + expr.slice(0, 80));
}

// 云端账号是否"被自动开通"的硬证据：直接打公开登录端点
// （与客户端 auth-core.js cloudAdapter.authenticate 同一请求形状）
const API_BASE = 'https://tcm-prescription-system.pages.dev/api';
async function probeCloudLogin(username, password, machineId, clientClass) {
    const r = await fetch(API_BASE + '/users?login=true', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, machineId, clientClass })
    });
    let body = null;
    try { body = await r.json(); } catch (_) {}
    return { status: r.status, body };
}

// ---------------- 主流程 ----------------
(async () => {
    const exe = findExe();
    log('exe          = ' + exe);
    log('隔离 userData = ' + DATA);
    log('CDP 端口      = ' + PORT);
    log('模式          = ' + (SUBMIT ? '★真实提交（会消耗码）' : '空跑（不提交，不消耗码）'));

    fs.mkdirSync(DATA, { recursive: true });

    // 模拟"首启买家"：隔离目录本身为空态。若本机服务端已有该设备记录，
    // activate-window 的断链自愈（autoRestore 的 machineId 兜底）会把旧授权
    // 自动装回来，掩盖新买家场景 —— 用一枚无 edition 的申请存根让它提前 return。
    if (STUB_REQ) {
        fs.writeFileSync(path.join(DATA, 'admin-request-id.dat'), JSON.stringify({
            requestId: 'REQ-E2E-NONE', clinicName: '', adminName: '',
            phone: '', password: '', savedAt: new Date().toISOString()
        }), 'utf8');
        log('已写入 admin-request-id.dat 存根（无 edition → autoRestore 提前返回）');
    }

    const markerExisted = fs.existsSync(MARKER);
    if (!markerExisted) {
        log('缺少 E2E 旁路 marker: ' + MARKER);
        log('（沙箱内 spawn 进程无法在 win-unpacked 下建文件，需由外部先行放置）');
        process.exit(3);
    }
    log('marker 已就位（外部预置）');

    // ★ 沙箱禁止管道 stdio，但允许重定向到文件 → 用它抓 exe 的 stdout/stderr
    const outFd = fs.openSync(path.join(DATA, 'stdout.log'), 'a');
    const errFd = fs.openSync(path.join(DATA, 'stderr.log'), 'a');
    const child = spawn(exe, [`--remote-debugging-port=${PORT}`], {
        env: Object.assign({}, process.env, { BNZC_E2E: '1', BNZC_E2E_DATA: DATA }),
        stdio: ['ignore', outFd, errFd], detached: false,
    });
    log('exe 已启动 PID=' + child.pid);
    child.on('error', (e) => log('spawn error: ' + e.message));
    let exited = null;
    child.on('exit', (code, sig) => { exited = { code, sig }; log('exe 退出 code=' + code + ' sig=' + sig); });

    let ws = null;
    try {
        // ---- 阶段一：登录窗 ----
        // 全新买家处于试用期时，登录窗的「点此激活」链接是隐藏的；
        // 真实入口是 openActivationWindow()（该链接 onclick 调的就是它）。
        const loginPage = await findPage('login.html', 90000);
        log('login = ' + loginPage.url);
        const loginWs = await connect(loginPage.webSocketDebuggerUrl);
        await waitFor(loginWs, `typeof openActivationWindow === 'function'`, 30000, 'login 页就绪');
        const loginInfo = await val(loginWs, `(function(){
            var t=(document.body.innerText||'').replace(/\\s+/g,' ');
            var a=document.getElementById('activateLink');
            return JSON.stringify({
              tail: t.slice(0,400),
              hasActivateLink: !!a,
              linkVisible: !!(a && a.offsetParent !== null)
            });
        })()`);
        log('登录窗状态 = ' + loginInfo);
        await evalOn(loginWs, `openActivationWindow(); true`);
        try { loginWs.close(); } catch (_) {}
        log('已调用 openActivationWindow()');

        // ---- 阶段二：激活窗 ----
        const page = await findActivateWindow(60000);
        log('activate-window = ' + page.url);
        const MID = (page.url.match(/machineId=([0-9a-f]+)/i) || [])[1] || '';
        log('机器ID（应用自报，权威） = ' + MID);
        ws = await connect(page.webSocketDebuggerUrl);

        await waitFor(ws, `typeof switchTab === 'function' && !!document.getElementById('skipToCode')`,
            30000, '页面就绪');
        check('激活窗已就绪（switchTab / skipToCode 可用）', true);

        // 读取当前呈现，记录首启状态（是否被断链自愈劫持）
        const boot = await val(ws, `(function(){
            return JSON.stringify({
              editionSelector: (document.getElementById('editionSelector')||{}).style ?
                               document.getElementById('editionSelector').style.display : 'n/a',
              tabContainer: (document.getElementById('tabContainer')||{}).style ?
                            document.getElementById('tabContainer').style.display : 'n/a',
              globalError: (document.getElementById('globalError')||{}).textContent || '',
              bodyHead: (document.body.innerText||'').replace(/\\s+/g,' ').slice(0,300)
            });
        })()`);
        log('首启呈现 = ' + boot);

        // 版本三元组（已激活/未激活提示也算证据）
        const ver = await val(ws, `(function(){
            var t=(document.body.innerText||'').match(/V\\d+\\.\\d+\\.\\d+[^\\n]{0,60}/);
            return t?t[0]:'(未找到版本串)';
        })()`);
        log('版本痕迹 = ' + ver);

        // ★ 走真实买家路径：直达链接 → Tab2 激活码激活
        await evalOn(ws, `document.getElementById('skipToCode').click(); true`);
        await new Promise(r => setTimeout(r, 400));
        const tabOk = await val(ws,
            `document.getElementById('tabContainer').style.display === 'block' &&
             document.getElementById('tab-code').classList.contains('active')`);
        check('点「已有激活码？直接输入 →」后进入 Tab2 激活码页', tabOk === true);

        // 填 Step1
        await evalOn(ws, `(function(){
            var c=document.getElementById('activationCode');
            c.value=${JSON.stringify(CODE || 'BNZC-TEST-TEST-TEST-TEST')};
            c.dispatchEvent(new Event('input',{bubbles:true}));
            var p=document.getElementById('codePhone');
            p.value=${JSON.stringify(PHONE || '13900000001')};
            p.dispatchEvent(new Event('input',{bubbles:true}));
            return true;
        })()`);
        const step1 = await val(ws, `JSON.stringify({
            code: document.getElementById('activationCode').value,
            phone: document.getElementById('codePhone').value,
            identityVisible: document.getElementById('codeIdentityFields')
                             .style.display !== 'none'
        })`);
        log('Step1 已填 = ' + step1);

        await evalOn(ws, `document.getElementById('codeToStep2Btn').click(); true`);
        await waitFor(ws, `document.getElementById('codeStep2').style.display !== 'none'`,
            10000, 'Step2 出现');
        check('Step1 → Step2 切换成功', true);

        await evalOn(ws, `(function(){
            var a=document.getElementById('codePassword'), b=document.getElementById('codePassword2');
            a.value=${JSON.stringify(PASSWORD)}; a.dispatchEvent(new Event('input',{bubbles:true}));
            b.value=${JSON.stringify(PASSWORD)}; b.dispatchEvent(new Event('input',{bubbles:true}));
            return true;
        })()`);
        check('Step2 密码已填（' + PASSWORD.length + ' 位）',
            (await val(ws, `document.getElementById('codePassword').value.length`)) === PASSWORD.length);

        if (!SUBMIT) {
            const ready = await val(ws, `(function(){
                return JSON.stringify({
                  submitEnabled: !document.getElementById('codeSubmitBtn').disabled,
                  submitText: document.getElementById('codeSubmitBtn').innerText.trim(),
                  step1Code: document.getElementById('activationCode').value,
                  step2Visible: document.getElementById('codeStep2').style.display !== 'none'
                });
            })()`);
            log('提交前状态 = ' + ready);
            log('');
            log('=== 空跑完成：表单链路全部走通，已停在「🚀 立即激活」之前，未发出任何 claim 请求 ===');
        } else {
            // 预热：客户端 claim 只有 15s 超时预算；先用 node 打同域端点把
            // Worker 冷启动 + TLS 链路变热，避免"恰好卡在冷启"导致客户端超时。
            const t0 = Date.now();
            try {
                await Promise.all([
                    fetch(API_BASE + '/license/status?machineId=' + MID).catch(() => {}),
                    fetch(API_BASE + '/users?login=true', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ username: 'warmup_' + MID, password: 'warmup123' })
                    }).catch(() => {})
                ]);
            } catch (_) {}
            log('预热完成，用时 ' + (Date.now() - t0) + 'ms');

            let outcome = null;
            for (let attempt = 1; attempt <= 3; attempt++) {
                log('★ 第 ' + attempt + ' 次点击「🚀 立即激活」'
                    + (attempt > 1 ? '（同机重激活幂等，不会多耗码）' : ''));
                const tClick = Date.now();
                await evalOn(ws, `document.getElementById('codeSubmitBtn').click(); true`);

                outcome = null;
                const deadline = Date.now() + 90000;
                while (Date.now() < deadline) {
                    try {
                        outcome = await val(ws, `(function(){
                            var g=document.getElementById('globalError');
                            var s=document.getElementById('successView') || document.getElementById('codeSuccess');
                            var txt=(document.body.innerText||'').replace(/\\s+/g,' ');
                            return JSON.stringify({
                              globalError: (g && g.classList.contains('show')) ? g.textContent : '',
                              successVisible: !!(s && s.style.display !== 'none' && s.offsetParent !== null),
                              hasInitialPwd: !!document.getElementById('initialPasswordBlock'),
                              submitDisabled: document.getElementById('codeSubmitBtn').disabled,
                              tail: txt.slice(0,500)
                            });
                        })()`);
                        const o = JSON.parse(outcome);
                        if (o.globalError || o.successVisible || /激活成功|验证成功|已激活/.test(o.tail)) break;
                    } catch (e) {
                        outcome = JSON.stringify({ note: '页面已消失（可能正在重启）: ' + e.message });
                        break;
                    }
                    await new Promise(r => setTimeout(r, 1000));
                }
                log('第 ' + attempt + ' 次结果（' + (Date.now() - tClick) + 'ms）= ' + outcome);

                let o = {};
                try { o = JSON.parse(outcome); } catch (_) {}
                if (!o.globalError) break;                  // 成功 / 页面已消失
                if (!/超时/.test(o.globalError)) break;     // 非超时错误不重试
                if (attempt < 3) {
                    log('客户端超时 → 2s 后重试（真实客户同样会再点一次）');
                    await new Promise(r => setTimeout(r, 2000));
                }
            }
            log('提交结果 = ' + outcome);

            // 客户端网络层证据
            try {
                const e2 = fs.readFileSync(path.join(DATA, 'stderr.log'), 'utf8');
                const o2 = fs.readFileSync(path.join(DATA, 'stdout.log'), 'utf8');
                const net = (e2 + '\n' + o2).split('\n')
                    .filter(l => /timeout|超时|fetch|ECONN|ETIMEDOUT|ENOTFOUND|claim|activateOnline|网络/i.test(l))
                    .slice(-12);
                if (net.length) { log('--- 客户端网络日志 ---'); net.forEach(l => log('   ' + l.trim())); }
            } catch (_) {}

            // 本地落盘证据
            await new Promise(r => setTimeout(r, 3000));
            const licPath = path.join(DATA, 'license.dat');
            const cfgPath = path.join(DATA, 'config.json');
            const hasLic = fs.existsSync(licPath);
            check('隔离 userData 内 license.dat 已落盘', hasLic,
                hasLic ? '' : '未落盘 = 本地装码失败');
            if (fs.existsSync(cfgPath)) {
                try {
                    const c = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
                    log('config.json: edition=' + c.edition + ' appMode=' + c.appMode +
                        ' clinicName=' + c.clinicName + ' users=' + (c.users || []).length);
                    const u = (c.users || [])[0];
                    if (u) log('  首个账号: username=' + u.username + ' role=' + u.role +
                        ' name=' + u.name + ' mustChangePassword=' + !!u.mustChangePassword);
                } catch (e) { log('config.json 解析失败: ' + e.message); }
            }

            // ★ "自动开通"的最终判据：用买家手机号+密码打公开登录端点
            try {
                const r = await probeCloudLogin(PHONE, PASSWORD, MID, 'desktop');
                log('云端登录探测: HTTP ' + r.status + '  ' +
                    JSON.stringify(r.body).slice(0, 320));
                if (EDITION === 'cloud') {
                    check('云端账号已被自动开通（手机号+密码登录成功）',
                        !!(r.body && r.body.success && r.body.user),
                        '登录未成功 → 自动开通未生效');
                } else {
                    log('（离线端此项仅参考：离线台账诊所不一定会开放云端登录）');
                }
            } catch (e) { log('云端登录探测失败: ' + e.message); }
        }
    } catch (err) {
        try {
            const o1 = fs.readFileSync(path.join(DATA, 'stdout.log'), 'utf8');
            const e1 = fs.readFileSync(path.join(DATA, 'stderr.log'), 'utf8');
            log('--- exe stdout (tail) ---');
            log(o1.slice(-2500) || '(空)');
            log('--- exe stderr (tail) ---');
            log(e1.slice(-2500) || '(空)');
        } catch (_) { log('(未能读取 exe 日志)'); }
        log('exe 退出状态: ' + (exited ? JSON.stringify(exited) : '仍在运行（但无 CDP）'));
        log('隔离目录: ' + DATA);
        check('驱动流程', false, err.message);
    } finally {
        try { if (ws) ws.close(); } catch (_) {}
        try { child.kill(); } catch (_) {}
        // Electron 会派生 GPU/渲染子进程，按镜像名兜底清干净
        try {
            require('child_process').spawnSync('taskkill', ['/f', '/im', path.basename(exe)],
                { stdio: 'ignore' });
        } catch (_) {}
        // marker 由外部预置，此处不删（沙箱内无法删除 win-unpacked 下文件）
        if (!KEEP && !SUBMIT && failed === 0) {
            try { fs.rmSync(DATA, { recursive: true, force: true }); } catch (_) {}
        } else {
            log('隔离目录保留: ' + DATA);
        }
    }

    log('');
    log('=== 结果: ' + (failed === 0 ? '全部通过' : failed + ' 项失败') + ' ===');
    process.exit(failed === 0 ? 0 : 1);
})();
