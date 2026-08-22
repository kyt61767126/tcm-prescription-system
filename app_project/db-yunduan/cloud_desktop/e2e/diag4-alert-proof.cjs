// diag4：实锤 alert 阻塞假说
// 401 → currentUser=null → showUserManageModal() → alert('请先登录后再管理用户')
// Electron 原生 alert 同步阻塞渲染进程，无人点击 → evaluate 永久超时
// 验证：①等401处理后查 currentUser ②hook alert 后调用 showUserManageModal 拿到 __lastAlert
const fs = require('fs');
const path = require('path');
const { _electron } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const TMP = path.join(__dirname, '.tmp', 'diag4-' + Date.now());
fs.mkdirSync(TMP, { recursive: true });

const E2E_PASSWORD = 'E2ePass123!';
const config = {
    clinicName: 'E2E测试诊所', doctorName: 'E2E医师', edition: 'cloud_clinic',
    appMode: 'cloud', maxUsers: 5, productName: '惠康中医-云端',
    versionLabel: '云端机构版',
    users: [{ username: 'e2eadmin', password: E2E_PASSWORD, name: 'E2E管理员', role: 'admin' }],
};
fs.writeFileSync(path.join(TMP, 'config.json'), JSON.stringify(config, null, 2), 'utf8');

const devElectron = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');
const realAsar = path.join(ROOT, '_backup_asar', 'real_app.asar');
const marker = path.join(path.dirname(devElectron), 'e2e-enabled.marker');
fs.writeFileSync(marker, 'diag\n', 'utf8');

function ts() { return new Date().toISOString().substring(11, 23); }
function findWindow(app, urlPart, timeoutMs = 40000) {
    const deadline = Date.now() + timeoutMs;
    return new Promise((resolve, reject) => {
        const tick = async () => {
            try { const hit = app.windows().find(w => w.url().includes(urlPart)); if (hit) return resolve(hit); } catch (_) {}
            if (Date.now() > deadline) return reject(new Error('timeout ' + urlPart));
            setTimeout(tick, 400);
        };
        tick();
    });
}
async function probe(win, fn, timeoutMs, label) {
    try {
        const r = await Promise.race([
            win.evaluate(fn),
            new Promise(r2 => setTimeout(() => r2('TIMEOUT-' + timeoutMs + 'ms'), timeoutMs)),
        ]);
        console.log(`[${ts()}] ${label} => ${r}`);
        return r;
    } catch (e) {
        console.log(`[${ts()}] ${label} 抛错: ${e.message.substring(0, 150)}`);
        return 'ERR';
    }
}

(async () => {
    const app = await _electron.launch({
        executablePath: devElectron, args: [realAsar],
        env: { ...process.env, BNZC_E2E: '1', BNZC_E2E_DATA: TMP },
    });
    const events = [];
    try { app.context().on('pageerror', (e) => events.push(ts() + ' [PAGEERROR] ' + (e && e.message))); } catch (_) {}
    try { app.context().on('dialog', (d) => { events.push(ts() + ' [DIALOG] ' + d.type() + ': ' + (d.message() || '').slice(0, 150)); d.dismiss().catch(() => {}); }); } catch (_) {}
    try { app.context().on('console', (m) => { const t = m.type(); if (t === 'warning' || t === 'error') events.push(ts() + ' [CONSOLE.' + t + '] ' + m.text().slice(0, 150)); }); } catch (_) {}

    try {
        const loginWin = await findWindow(app, 'login.html');
        await loginWin.waitForSelector('#loginUsername', { timeout: 15000 });
        await loginWin.fill('#loginUsername', 'e2eadmin');
        await loginWin.fill('#loginPassword', E2E_PASSWORD);
        await loginWin.click('#btnOk');
        const mainWin = await findWindow(app, 'index.html');
        await mainWin.waitForFunction(() => {
            const b = document.getElementById('userManageBtn');
            return !!b && b.style.display !== 'none';
        }, null, { timeout: 20000 });
        console.log('[SETUP] OK');

        // 立即查 currentUser（401 处理前的窗口期）
        await probe(mainWin, () => {
            try { return 'currentUser=' + (typeof currentUser !== 'undefined' ? (currentUser ? currentUser.username : 'NULL') : 'UNDEF'); }
            catch (e) { return 'ERR:' + e.message; }
        }, 3000, 'CHECK-user-immediately');

        // 等 8 秒让 401 异步处理完成
        console.log('[WAIT] 8s 让 401 处理完成...');
        await new Promise(r => setTimeout(r, 8000));

        await probe(mainWin, () => {
            try { return 'currentUser=' + (typeof currentUser !== 'undefined' ? (currentUser ? currentUser.username : 'NULL') : 'UNDEF'); }
            catch (e) { return 'ERR:' + e.message; }
        }, 3000, 'CHECK-user-after-8s');

        // hook alert，防阻塞，然后调用 showUserManageModal
        await probe(mainWin, () => {
            window.__lastAlert = null;
            window.__origAlert = window.alert;
            window.alert = function (m) { window.__lastAlert = String(m); console.log('[HOOKED-ALERT]', m); };
            try { showUserManageModal(); } catch (e) { return 'FN-ERR:' + e.message; }
            const m = document.getElementById('userManageModal');
            window.alert = window.__origAlert;
            return JSON.stringify({ modal: m ? m.style.display : 'missing', lastAlert: window.__lastAlert });
        }, 3000, 'CALL-with-alert-hook');

        // 不 hook，直接调（预期 TIMEOUT —— alert 模态阻塞的最终实锤）
        await probe(mainWin, () => {
            try { showUserManageModal(); } catch (e) { return 'FN-ERR:' + e.message; }
            const m = document.getElementById('userManageModal');
            return m ? m.style.display : 'missing';
        }, 3000, 'CALL-without-hook (expect TIMEOUT)');
    } catch (e) {
        console.log('FLOW ERROR: ' + e.message);
    }

    console.log('===== EVENTS (' + events.length + ') =====');
    for (const ev of events) console.log(ev);
    try { app.close(); } catch (_) {}
    try { const p = app.process(); if (p) p.kill(); } catch (_) {}
    try { fs.rmSync(marker, { force: true }); } catch (_) {}
    process.exit(0);
})().catch(e => { console.error('FATAL: ' + e); try { fs.rmSync(marker, { force: true }); } catch (_) {} process.exit(1); });
