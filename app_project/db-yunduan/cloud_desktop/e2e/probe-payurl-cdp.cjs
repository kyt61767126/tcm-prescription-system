// ============================================================================
// probe-payurl-cdp.cjs — CDP 直连驱动真实 exe，复现注册→付款 URL 链路
// 绕开 Playwright（当前环境 launch 挂死）：--remote-debugging-port=9222 +
// BNZC_E2E 旁路（marker）→ Node 24 内置 WebSocket 连 CDP → Runtime.evaluate。
// 流程：activate-window 弹出 → 填表(step1) → toStep2Btn(state) → showPayRequired()
//   → 读 payGuideUrlText —— 断言 URL 带全参（mid/ed/dp/cn/n/p/r）。
// ============================================================================
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const WU = path.resolve(__dirname, '..', 'dist', 'win-unpacked');
const EXE = path.join(WU, fs.readdirSync(WU).find(f => f.toLowerCase().endsWith('.exe') && !/^elevate\.exe$/i.test(f)));
const MARKER = path.join(WU, 'e2e-enabled.marker');
const DATA = path.join(__dirname, '.tmp', `cdp-${process.pid}`);

const log = (m) => console.log('[CDP] ' + m);
let fail = 0;
const check = (name, cond, detail) => {
    if (cond) log('PASS ' + name);
    else { log('FAIL ' + name + (detail ? ' —— ' + detail : '')); fail++; }
};

async function getPages() {
    for (let i = 0; i < 40; i++) {
        try {
            const r = await fetch('http://127.0.0.1:9222/json');
            const pages = await r.json();
            const hit = pages.find(p => p.url.includes('activate-window'));
            if (hit) return hit;
        } catch (_) {}
        await new Promise(r => setTimeout(r, 500));
    }
    throw new Error('CDP 60s 内未发现 activate-window 页面');
}

async function evalOn(ws, expr) {
    return new Promise((resolve, reject) => {
        const id = ++evalOn._seq;
        const onMsg = (ev) => {
            try {
                const d = JSON.parse(ev.data);
                if (d.id === id) {
                    ws.removeEventListener('message', onMsg);
                    if (d.error) reject(new Error(JSON.stringify(d.error)));
                    else resolve(d.result);
                }
            } catch (e) {}
        };
        ws.addEventListener('message', onMsg);
        ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true, awaitPromise: true } }));
        setTimeout(() => { ws.removeEventListener('message', onMsg); reject(new Error('eval 超时')); }, 20000);
    });
}
evalOn._seq = 0;

(async () => {
    fs.mkdirSync(DATA, { recursive: true });
    fs.writeFileSync(path.join(DATA, 'config.json'), JSON.stringify({
        clinicName: 'CDP探针诊所', doctorName: 'CDP医师', edition: 'cloud_personal',
        appMode: 'cloud', productName: '惠康中医-云端', users: []
    }, null, 2));
    fs.writeFileSync(MARKER, 'cdp probe\n', 'utf8');

    const child = spawn(EXE, ['--remote-debugging-port=9222'], {
        env: { ...process.env, BNZC_E2E: '1', BNZC_E2E_DATA: DATA },
        stdio: 'ignore', detached: false,
    });
    log('exe 已启动 PID=' + child.pid);

    try {
        const page = await getPages();
        log('activate-window: ' + page.url);

        const ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((res, rej) => { ws.onopen = res; ws.onerror = (e) => rej(new Error('ws error')); });

        // 等 DOM ready（state/showPayRequired 就绪）
        for (let i = 0; i < 30; i++) {
            const r = await evalOn(ws, `typeof showPayRequired === 'function' && typeof state === 'object' && typeof state === 'object'`);
            if (r && r.result && r.result.value === true) break;
            await new Promise(r => setTimeout(r, 500));
            if (i === 29) throw new Error('activate-window 页面函数 15s 未就绪');
        }

        // ★ 纯前端驱动（与真实 PAYMENT_REQUIRED 同一函数链）
        const url = (await evalOn(ws, `(function(){
            try { switchTab('admin'); } catch (e) {}
            try { selectEdition('institution'); } catch (e) {}
            document.getElementById('clinicName').value = 'CDP付款测试诊所';
            document.getElementById('adminName').value = 'CDP付款测试医师';
            var ph = document.getElementById('phone');
            ph.value = '19912345678';
            ph.dispatchEvent(new Event('input', { bubbles: true }));
            var rk = document.getElementById('remark');
            if (rk) rk.value = 'CDP付款链路测试';
            document.getElementById('toStep2Btn').click();
            showPayRequired();
            var t = document.getElementById('payGuideUrlText');
            return t ? t.textContent : '(missing)';
        })()`)).result.value;
        log('付款 URL: ' + url);

        check('U1 download.html+mid', /download\.html\?mid=[^&]+/.test(url), url);
        check('U2 ed=cloud-pro', url.includes('&ed=cloud-pro'), url);
        check('U3 dp=desktop', url.includes('&dp=desktop'), url);
        check('U4 cn', url.includes('&cn=' + encodeURIComponent('CDP付款测试诊所')), url);
        check('U5 n', url.includes('&n=' + encodeURIComponent('CDP付款测试医师')), url);
        check('U6 p', url.includes('&p=19912345678'), url);
        check('U7 r', url.includes('&r=' + encodeURIComponent('CDP付款链路测试')), url);

        // 面板可见性（waiting 显示 + 标题含"支付"）
        const ui = (await evalOn(ws, `(function(){
            var w = document.getElementById('waiting');
            return { shown: w ? w.style.display : 'missing', title: (document.querySelector('#waiting .title')||{}).textContent || '' };
        })()`)).result.value;
        log('面板: ' + JSON.stringify(ui));
        check('U8 showPayRequired 生效', ui.shown === 'block' && /支付/.test(ui.title), JSON.stringify(ui));

        // 官网回填链路对拍（浏览器实测已 PASS，此处仅 URL 侧）
        ws.close();
    } finally {
        try { spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (_) {}
        await new Promise(r => setTimeout(r, 1500));
        try { fs.rmSync(MARKER, { force: true }); } catch (_) {}
        try { fs.rmSync(DATA, { recursive: true, force: true }); } catch (_) {}
    }

    console.log('');
    if (fail) { console.log('[CDP] FAIL ' + fail + ' 条断言未过！'); process.exit(1); }
    console.log('[CDP] 全部通过 ✓');
})().catch(e => {
    console.error('[CDP][FAIL] ' + (e && e.stack ? e.stack : e));
    try { fs.rmSync(MARKER, { force: true }); } catch (_) {}
    process.exit(1);
});