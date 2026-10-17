// CDP 助手：对手机测试包 WebView 执行 JS 并打印返回值
// 用法: node cdp-eval.cjs <wsUrl> <jsFile>
const fs = require('fs');
const wsUrl = process.argv[2];
const expr = fs.readFileSync(process.argv[3], 'utf8');
const ws = new WebSocket(wsUrl);
let id = 0;
const pending = new Map();
function send(method, params = {}) {
    return new Promise((resolve, reject) => {
        const mid = ++id;
        pending.set(mid, { resolve, reject });
        ws.send(JSON.stringify({ id: mid, method, params }));
    });
}
ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
        const { resolve, reject } = pending.get(m.id);
        pending.delete(m.id);
        m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
    }
};
ws.onerror = (e) => { console.error('WS ERROR', e.message || e); process.exit(2); };
ws.onopen = async () => {
    try {
        await send('Runtime.enable');
        const r = await send('Runtime.evaluate', {
            expression: expr, awaitPromise: true, returnByValue: true, timeout: 30000
        });
        if (r.exceptionDetails) {
            console.log('EXCEPTION:', JSON.stringify(r.exceptionDetails.exception ? r.exceptionDetails.exception.description : r.exceptionDetails.text));
            process.exit(3);
        }
        console.log(JSON.stringify(r.result.value, null, 2));
        ws.close();
        process.exit(0);
    } catch (e) {
        console.error('EVAL FAILED:', e.message);
        process.exit(4);
    }
};
setTimeout(() => { console.error('TIMEOUT'); process.exit(5); }, 40000);
