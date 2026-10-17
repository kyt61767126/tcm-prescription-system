// 构建后验证：新包里 login.html 发起本地注册是否已过帧门
// 判据：返回不再是「非法调用来源」，而是手机号校验错误（=帧门放行 ✓）；主进程不再打印 reject
const { spawn } = require('child_process');
const os = require('os');
const path = require('path');
const fs = require('fs');

const EXE = process.argv[2] || 'D:\\trae_projects\\kyt-zy\\app_project\\db-offline\\desktop\\dist\\win-unpacked\\惠康中医-本地.exe';
const PORT = Number(process.argv[3] || 9336);
const DATA = path.join(os.tmpdir(), 'bnzc-verify-register-' + Date.now());
const MARKER = path.join(path.dirname(EXE), 'e2e-enabled.marker');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function evalIn(wsUrl, expr) {
    return await new Promise((resolve) => {
        const ws = new WebSocket(wsUrl);
        const timer = setTimeout(() => { try { ws.close(); } catch (_) {} resolve({ _timeout: true }); }, 15000);
        ws.onopen = () => ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: expr, awaitPromise: true, returnByValue: true } }));
        ws.onmessage = (ev) => {
            try { const m = JSON.parse(ev.data); if (m.id === 1) { clearTimeout(timer); try { ws.close(); } catch (_) {} resolve(m.result && m.result.result ? m.result.result.value : m); } } catch (_) {}
        };
        ws.onerror = () => { clearTimeout(timer); resolve({ _wsError: true }); };
    });
}

(async () => {
    if (!fs.existsSync(EXE)) { console.log('❌ 找不到 exe: ' + EXE); process.exit(1); }
    fs.mkdirSync(DATA, { recursive: true });
    fs.writeFileSync(MARKER, 'e2e');
    const child = spawn(EXE, ['--remote-debugging-port=' + PORT], {
        stdio: ['ignore', 'pipe', 'pipe'], env: Object.assign({}, process.env, { BNZC_E2E: '1', BNZC_E2E_DATA: DATA })
    });
    let out = '';
    child.stdout.on('data', d => { out += d.toString(); });
    child.stderr.on('data', d => { out += d.toString(); });
    let exited = null; child.on('exit', c => { exited = c; });

    let pages = null;
    for (let i = 0; i < 60; i++) {
        await sleep(1000);
        if (exited !== null) break;
        try {
            const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
            const t = await r.json();
            pages = t.filter(x => x.type === 'page');
            if (pages && pages.length) break;
        } catch (_) {}
    }
    if (!pages || !pages.length) { console.log('❌ CDP 未就绪 exit=' + exited); console.log(out.slice(0, 800)); try { child.kill(); } catch (_) {} process.exit(1); }

    console.log('=== 包内页面 ===');
    pages.forEach(p => console.log('  ' + p.url));

    const probe = `(async () => {
        const api = (window.electronAPI && window.electronAPI.activate) || null;
        if (!api || typeof api.registerLocalUser !== 'function') return { noBridge: true, href: location.href };
        try { const r = await api.registerLocalUser({ phone: '123', password: 'abcdefgh1' }); return { result: r, href: location.href }; }
        catch (e) { return { err: String(e && e.message), href: location.href }; }
    })()`;

    let verdict = false;
    for (const p of pages) {
        if (!p.webSocketDebuggerUrl) continue;
        const res = await evalIn(p.webSocketDebuggerUrl, probe);
        const err = res && res.result && res.result.error;
        const href = (res && (res.href || (res.result && res.result.href))) || '';
        console.log('\n  页面: ' + (href || p.url));
        console.log('  返回: ' + JSON.stringify(res && res.result ? res.result : res));
        if (href.includes('login.html')) {
            if (err && /手机号/.test(err)) { verdict = true; console.log('  → ✅ 已过帧门（进入手机号校验）'); }
            else if (err && /非法调用来源/.test(err)) { console.log('  → ❌ 仍被帧门拒绝'); }
            else { console.log('  → ⚠ 非预期返回'); }
        }
    }
    await sleep(1200);
    const rejects = out.split(/\r?\n/).filter(l => /reject|非法调用来源/.test(l));
    console.log('\n主进程 reject 日志: ' + (rejects.length ? rejects.slice(-3).join(' | ') : '（无 ✓）'));

    try { child.kill(); } catch (_) {}
    try { fs.unlinkSync(MARKER); } catch (_) {}
    await sleep(800);
    console.log('\n=== 结论: ' + (verdict && rejects.length === 0 ? '✅ login.html 注册帧门已放行（修复生效）' : '⚠ 需复查') + ' ===');
    process.exit(verdict ? 0 : 1);
})();
