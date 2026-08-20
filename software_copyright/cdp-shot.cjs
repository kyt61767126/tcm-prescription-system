// CDP 截图工具：真实时间等待（解决 virtual-time-budget 下 IndexedDB 挂起问题）
// 用法：node cdp-shot.cjs <shots.json>
// shots.json: [{url, out, width, height, waitExpr, waitTimeoutMs, settleMs, landscape}]
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9333;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function waitForDebugPort(timeoutMs = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (r.ok) return (await r.json()).webSocketDebuggerUrl || true;
    } catch (e) {}
    await sleep(300);
  }
  throw new Error('debug port not ready');
}

class CdpTab {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.listeners = [];
    ws.addEventListener('message', ev => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
      } else if (msg.method) { this.listeners.forEach(l => l(msg)); }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  onEvent(fn) { this.listeners.push(fn); }
  close() { try { this.ws.close(); } catch (e) {} }
}

async function main() {
  const shots = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  // 清理上次残留的调试 Edge（只杀占用 9333 的进程，不动用户自己开的浏览器）
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/json/version`, { signal: AbortSignal.timeout(1000) });
    if (r.ok) {
      const v = await r.json();
      if (v.Browser) {
        console.log('stale debug edge detected, killing...');
        const { execSync } = require('child_process');
        const out = execSync('netstat -ano | findstr ":9333" | findstr "LISTENING"').toString();
        const pid = parseInt(out.trim().split(/\s+/).pop(), 10);
        if (pid) { execSync(`taskkill /T /F /PID ${pid}`, { stdio: 'ignore' }); }
        await sleep(1500);
      }
    }
  } catch (e) {}
  const udd = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-shot-'));
  const edge = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${udd}`,
    'about:blank'
  ], { stdio: 'ignore' });
  edge.on('error', e => { console.error('EDGE LAUNCH FAIL', e.message); process.exit(1); });

  try {
    await waitForDebugPort();
    for (const s of shots) {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/new`, { method: 'PUT' });
      const tab = await r.json();
      const ws = new WebSocket(tab.webSocketDebuggerUrl);
      await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
      const cdp = new CdpTab(ws);
      await cdp.send('Page.enable');
      await cdp.send('Runtime.enable');
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: s.width, height: s.height, deviceScaleFactor: 1, mobile: false
      });
      // 导航（/json/new 的 url 参数在本版 Edge 不生效，改用 Page.navigate）
      let loaded = false;
      const onEv = m => { if (m.method === 'Page.loadEventFired') loaded = true; };
      cdp.onEvent(onEv);
      await cdp.send('Page.navigate', { url: s.url });
      const t0 = Date.now();
      while (!loaded && Date.now() - t0 < 30000) await sleep(200);
      // 轮询等待表达式
      if (s.waitExpr) {
        const t0 = Date.now();
        const timeout = s.waitTimeoutMs || 20000;
        let ok = false;
        while (Date.now() - t0 < timeout) {
          try {
            const ev = await cdp.send('Runtime.evaluate', { expression: s.waitExpr, returnByValue: true });
            if (ev.result && ev.result.value === true) { ok = true; break; }
          } catch (e) {}
          await sleep(400);
        }
        console.log(`${path.basename(s.out)} waitExpr ${ok ? 'OK' : 'TIMEOUT'}`);
        if (!ok) {
          try {
            const dbg = await cdp.send('Runtime.evaluate', { expression: `JSON.stringify({url:location.href, title:document.title, ready:document.readyState, trace:(document.documentElement.getAttribute('data-demo')||'').slice(0,200), body:document.body?document.body.innerHTML.slice(0,150):'NOBODY'})`, returnByValue: true });
            console.log('  DEBUG: ' + dbg.result.value);
          } catch (e) { console.log('  DEBUG err: ' + e.message); }
        }
      }
      await sleep(s.settleMs || 1200);
      const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(s.out, Buffer.from(shot.data, 'base64'));
      console.log(`${path.basename(s.out)} saved (${Math.round(shot.data.length * 3 / 4 / 1024)} KB)`);
      cdp.close();
      await fetch(`http://127.0.0.1:${PORT}/json/close/${tab.id}`).catch(() => {});
      await sleep(300);
    }
  } finally {
    try { const { execSync } = require('child_process'); execSync(`taskkill /T /F /PID ${edge.pid}`, { stdio: 'ignore' }); } catch (e) { try { edge.kill(); } catch (e2) {} }
    try { fs.rmSync(udd, { recursive: true, force: true }); } catch (e) {}
  }
}

main().then(() => process.exit(0)).catch(e => { console.error('FATAL', e); process.exit(1); });
