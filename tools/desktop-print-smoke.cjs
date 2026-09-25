#!/usr/bin/env node
// ============================================================================
//  desktop-print-smoke.cjs — P2-3 打印域模块功能冒烟（零依赖，stub electron）
//
//  用 stub ipcMain / BrowserWindow 加载真实 shared/desktop-print.cjs 工厂，
//  覆盖：handler 注册、隐藏窗参数、@page 剥离、打印选项（A5/横版/边距）、
//  成功/打印失败/页面加载失败/构造抛错 五条回路与窗口关闭时序。
//
//  用法: node tools/desktop-print-smoke.cjs
//  退出码: 0 全过；1 有失败
// ============================================================================
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { createDesktopPrintIpc } = require(path.join(ROOT, 'shared', 'desktop-print.cjs'));

let pass = 0, fail = 0;
function ok(cond, label) {
    if (cond) { pass++; }
    else { fail++; console.error('  [FAIL] ' + label); }
}

function makeEnv(opts) {
    opts = opts || {};
    const handlers = {};
    const windows = [];
    const printCalls = [];

    class StubBrowserWindow {
        constructor(o) {
            if (opts.ctorThrow) throw new Error('bw ctor boom');
            this.options = o;
            windows.push(this);
            this.closed = false;
            this.destroyed = false;
            const self = this;
            this.webContents = {
                _once: {},
                once(ev, cb) { this._once[ev] = cb; },
                executeJavaScript() { return Promise.resolve(); },
                print(o, cb) {
                    printCalls.push(o);
                    setImmediate(() => cb(opts.printSuccess !== false, opts.printSuccess === false ? '打印失败测试' : ''));
                }
            };
        }
        setMenu() { }
        loadURL(url) {
            this.loadedUrl = url;
            const self = this;
            setImmediate(() => {
                if (opts.failLoad) self.webContents._once['did-fail-load']({}, -3, 'ERR_FAIL');
                else self.webContents._once['did-finish-load']();
            });
        }
        close() { this.closed = true; this.destroyed = true; }
        isDestroyed() { return this.destroyed; }
    }

    const ipcMain = {
        handle(ch, fn) { handlers[ch] = fn; },
        on() { }, removeListener() { }
    };

    createDesktopPrintIpc({ ipcMain, BrowserWindow: StubBrowserWindow });
    return { handlers, windows, printCalls };
}

// did-finish-load 后内部有 500+200ms 真实等待
const WAIT = 900;

async function invoke(env, html, orientation) {
    return env.handlers['print-prescription']({ sender: {} }, html, orientation);
}

function decodeDataUrl(url) {
    const m = /^data:text\/html;charset=utf-8;base64,(.*)$/.exec(url);
    if (!m) return null;
    return Buffer.from(m[1], 'base64').toString('utf8');
}

(async () => {
    // —— 1. 注册面 ——
    const env0 = makeEnv({});
    ok(typeof env0.handlers['print-prescription'] === 'function', 'print-prescription handler 已注册');

    // —— 2. 成功回路（竖版）——
    {
        const env = makeEnv({});
        const html = '<style>@page { size: A5; margin: 0; }</style><body>处方内容</body>';
        const resultP = invoke(env, html, 'portrait');
        await new Promise(r => setTimeout(r, 50));
        ok(env.windows.length === 1, '成功回路：创建了 1 个打印窗');
        const w = env.windows[0];
        ok(w.options.show === false, '窗口 show:false（用户不可见）');
        ok(w.options.width === 600 && w.options.height === 850, '竖版窗口尺寸 600x850');
        ok(w.options.webPreferences.contextIsolation === true, 'contextIsolation:true');
        ok(w.options.webPreferences.nodeIntegration === false, 'nodeIntegration:false');
        const decoded = decodeDataUrl(w.loadedUrl);
        ok(decoded !== null && !decoded.includes('@page'), '@page 规则已剥离（防双重指定缩放）');
        ok(decoded !== null && decoded.includes('处方内容'), 'HTML 内容完整进入 dataURL');
        const result = await Promise.race([resultP, new Promise(r => setTimeout(() => r('TIMEOUT'), WAIT))]);
        ok(result === true, '成功回路返回 true');
        ok(w.closed === true && w.isDestroyed() === true, '成功后窗口已关闭');
        ok(env.printCalls.length === 1, 'webContents.print 被调用 1 次');
        const po = env.printCalls[0];
        ok(po.silent === false, 'silent:false（弹系统对话框手动选打印机）');
        ok(po.printBackground === true, 'printBackground:true');
        ok(po.pageSize === 'A5', '默认纸张 A5');
        ok(po.landscape === false, '竖版 landscape:false');
        ok(po.margins && po.margins.marginType === 'none', '无边距 marginType:none');
    }

    // —— 3. 横版 ——
    {
        const env = makeEnv({});
        const resultP = invoke(env, '<body>x</body>', 'landscape');
        await new Promise(r => setTimeout(r, 50));
        const w = env.windows[0];
        ok(w.options.width === 820 && w.options.height === 600, '横版窗口尺寸 820x600');
        const result = await Promise.race([resultP, new Promise(r => setTimeout(() => r('TIMEOUT'), WAIT))]);
        ok(result === true, '横版返回 true');
        ok(env.printCalls[0].landscape === true, '横版 landscape:true');
    }

    // —— 4. 打印机回调失败（契约：仍 resolve true，不阻断 UI）——
    {
        const env = makeEnv({ printSuccess: false });
        const result = await Promise.race([invoke(env, '<body>x</body>', 'portrait'), new Promise(r => setTimeout(() => r('TIMEOUT'), WAIT))]);
        ok(result === true, '打印机回调失败仍返回 true（现状契约）');
        ok(env.windows[0].closed === true, '打印失败后窗口仍关闭');
    }

    // —— 5. 页面加载失败 ——
    {
        const env = makeEnv({ failLoad: true });
        const result = await Promise.race([invoke(env, '<body>x</body>', 'portrait'), new Promise(r => setTimeout(() => r('TIMEOUT'), 100))]);
        ok(result === false, 'did-fail-load 返回 false');
        ok(env.windows[0].closed === true, '加载失败后窗口已关闭');
    }

    // —— 6. BrowserWindow 构造抛错（外层 catch）——
    {
        const env = makeEnv({ ctorThrow: true });
        const result = await invoke(env, '<body>x</body>', 'portrait');
        ok(result === false, '构造抛错时外层 catch 返回 false');
    }

    console.log('[DESKTOP-PRINT-SMOKE] 结果: ' + pass + '/' + (pass + fail) + (fail === 0 ? ' 通过 ✓' : ' 有失败 ✗'));
    process.exit(fail === 0 ? 0 : 1);
})();
