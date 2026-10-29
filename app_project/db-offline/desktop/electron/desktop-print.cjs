// ============================================================================
//  desktop-print.cjs — 桌面端打印域 IPC（双桌面共用唯一权威源）
//
//  ★ 2026-09-25 P2-3 打印域收口：从云桌面/离线桌面两份 main.js 等体抽取
//    （print-prescription 单个 handler + 隐藏打印窗实现，双端 115 行字节级
//    同体，改前 SHA256 一致：cd537a37...，逐行 diff=0 终验）。
//    方案：隐藏 BrowserWindow 加载处方 HTML dataURL → 等字体就绪 →
//    webContents.print 弹 Windows 系统打印对话框（A5/无边距/手动选打印机）→ 关闭。
//
//  依赖注入（与 desktop-fs-ipc.cjs / desktop-dialog.cjs 同款工厂模式）：
//    createDesktopPrintIpc({ ipcMain, BrowserWindow })。
//    Buffer/console/setTimeout 为主进程全局，无需注入；模块本体零平台分叉。
//  分发：shared/ → sync-all Group 21 → 2 个 electron 目录；
//    copy-consistency desktop-print 组（2 副本硬哈希门）。
//  铁律：改打印域逻辑只改本文件，禁止再改两份 main.js 内嵌副本。
//  注意：主进程域热更不可达，改动需双桌面重打 exe（可攒一批一起发）。
// ============================================================================
'use strict';

// ★ 2026-10-29 打印机默认纸张 A5（根治「每次打印都要在打印机设置里手动选 A5」）：
//   实测（Electron 35.7.5 + Windows 11 系统打印对话框）：
//     - 该对话框是 Windows 原生「Windows 打印」，界面明确提示「此应用不支持打印预览」；
//       此路径下 webContents.print 的 pageSize 选项【不生效】——传 A5 微米对象，对话框
//       的「打印首选项」仍显示 A4 / 210×297（驱动默认）。
//     - 对话框纸张实际取自 **Windows 每用户打印首选项（User Print Ticket，存 HKCU）**：
//       把该打印机 per-user 纸张设为 ISOA5 后，同一段代码弹出的首选项立刻变成
//       A5 / 148×210，且无需管理员权限、重启后仍保留。
//   做法：每次打印前（每台打印机每进程仅一次）用 PowerShell + System.Printing 把
//     「默认打印机」的 per-user 纸张校正为 ISOA5；失败（驱动不支持/策略限制）静默降级，
//     不影响打印本身。设置幂等：已是 ISOA5 直接返回，不写注册表。
//   注意：只改默认打印机；对话框里临时换别的打印机仍以那台机器自身默认值为准。
const a5EnsuredPrinters = new Set();

// ASCII-only 脚本（PowerShell 5.1 对 -Command 的中文/引号极敏感），打印机名走环境变量传参，
// 避免中文打印机名（如「导出为WPS PDF」）在命令行里被 GBK 破坏。
const ENSURE_A5_PS = [
    '$ErrorActionPreference="Stop"',
    'Add-Type -AssemblyName System.Printing',
    '$name=$env:HKZY_PRINTER_NAME',
    'if (-not $name) { "SKIP-NO-NAME"; exit 0 }',
    '$q=(New-Object System.Printing.LocalPrintServer).GetPrintQueue($name)',
    '$t=$q.UserPrintTicket',
    'if ($t -and $t.PageMediaSize -and $t.PageMediaSize.PageMediaSizeName -eq "ISOA5") { "A5-ALREADY"; exit 0 }',
    '$t.PageMediaSize=New-Object System.Printing.PageMediaSize([System.Printing.PageMediaSizeName]::ISOA5)',
    '$q.UserPrintTicket=$t',
    '$q.Commit()',
    '"A5-SET"'
].join('; ');

function ensureDefaultPrinterA5(webContents) {
    return new Promise((resolve) => {
        if (process.platform !== 'win32') { resolve(false); return; }
        let done = false;
        const finish = (val) => { if (!done) { done = true; resolve(val); } };
        // 8 秒兜底：PowerShell/打印后台异常时不能拖住打印流程
        const timer = setTimeout(() => finish(false), 8000);

        webContents.getPrintersAsync().then((printers) => {
            const def = (printers || []).find((p) => p.isDefault) || (printers || [])[0];
            if (!def || !def.name) {
                clearTimeout(timer); finish(false); return;
            }
            if (a5EnsuredPrinters.has(def.name)) {
                clearTimeout(timer); finish(true); return;
            }
            const { execFile } = require('child_process');
            execFile('powershell.exe', [
                '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
                '-Command', ENSURE_A5_PS
            ], {
                env: Object.assign({}, process.env, { HKZY_PRINTER_NAME: def.name }),
                timeout: 7000,
                windowsHide: true
            }, (err, stdout) => {
                clearTimeout(timer);
                const out = String(stdout || '');
                if (!err && /A5-(SET|ALREADY)/.test(out)) {
                    a5EnsuredPrinters.add(def.name);
                    console.log('[print] 默认打印机纸张已确认为 A5:', def.name, out.trim());
                    finish(true);
                } else {
                    // 非致命：驱动不支持 A5 / 策略禁止写 PrintTicket / PowerShell 被禁用
                    console.warn('[print] 默认打印机纸张设置 A5 失败(不影响打印):',
                        def.name, err ? String(err.message || '').slice(0, 200) : out.trim());
                    finish(false);
                }
            });
        }).catch((e) => {
            clearTimeout(timer);
            console.warn('[print] getPrintersAsync 失败:', e && e.message);
            finish(false);
        });
    });
}

function createDesktopPrintIpc({ ipcMain, BrowserWindow }) {
// ★ 打印处方（直接打印）
// 方案：隐藏窗口加载处方 HTML → 渲染进程调用 window.print() → 弹系统打印对话框 → 关闭
// 最快最简单，无预览窗口、无 PDF 中间步骤
// ★ 2026-08-02 同步云端 cloud_desktop 方案：隐藏窗口+字体等待+2分钟超时
//   旧方案（显示窗口+webContents.print+30秒超时）已废弃，用户体验差且超时过短
ipcMain.handle('print-prescription', async (event, html, orientation) => {
    try {
        // ★ 2026-09-25 安全加固①：仅主框架可调（拒绝被注入的 iframe 子框架）
        // ★ 2026-09-26 修复：Electron 35 WebFrameMain 无 isMainFrame 成员，
        //   主框架判定=parent===null（旧写法恒 undefined，会拒绝全部打印调用）。
        if (!event || !event.senderFrame || event.senderFrame.parent !== null) {
            console.warn('[print] reject non-main-frame invoke');
            return false;
        }
        const isLandscape = orientation === 'landscape';

        // 隐藏窗口（用户不可见）
        // ★ 2026-10-28 纸型改 A5（148×210mm，用户实际用纸）：隐藏窗须大于 148mm=559.4px@96dpi，
        //   否则 body 宽度超出视口触发滚动条，webContents.print() 会按视口宽度缩放内容。
        //   取 640px（纵向）/940px（横向），留足余量且与网页版预览窗口宽度一致。
        const printWin = new BrowserWindow({
            show: false,
            width: isLandscape ? 940 : 640,
            height: isLandscape ? 640 : 940,
            webPreferences: {
                contextIsolation: true,
                nodeIntegration: false,
                sandbox: true,        // ★ 2026-09-25 加固②：显式沙箱（不预载任何主进程能力）
                webSecurity: true     // ★ 显式开启同源策略
            }
        });
        printWin.setMenu(null);

        // ★ 彻底修复字体偏大：移除CSS @page的size规则，避免与webContents.print pageSize选项双重指定
        //   双重指定（CSS @page size + pageSize选项）触发Chromium fit-to-page缩放，内容被放大
        //   移除size后：纸张大小由pageSize选项唯一控制，边距由CSS @page margin:0唯一控制
        const processedHtml = String(html == null ? '' : html).replace(/@page\s*\{[^}]*\}/g, '');
        const base64Html = Buffer.from(processedHtml, 'utf8').toString('base64');
        const dataUrl = 'data:text/html;charset=utf-8;base64,' + base64Html;

        return new Promise((resolve) => {
            let settled = false;

            // ★ 2026-09-25 加固③：关窗用 destroy() 而非 close()——处方 HTML 里若注入
            //   onbeforeunload 返回非空串会阻止 close()（窗口残留/进程挂住）；
            //   destroy() 强制销毁，不触发 beforeunload/close 事件。
            const safeResolve = (val) => {
                if (settled) return;
                settled = true;
                if (!printWin.isDestroyed()) printWin.destroy();
                resolve(val);
            };

            // ★ 2026-09-25 加固④：打印窗内容是本地 data URL，禁止任何导航/跳转/新窗
            //   （处方 HTML 若被注入 <a target=_blank>/meta refresh/window.open 等，
            //   一律拒绝，防止隐藏窗被带去远程内容或挂起）。
            printWin.webContents.on('will-navigate', (navE) => {
                navE.preventDefault();
                console.warn('[print] navigation blocked');
                safeResolve(false);
            });
            printWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

            printWin.loadURL(dataUrl);

            // ★ 2026-10-29 与页面加载并行：先把默认打印机 per-user 纸张校正为 A5，
            //   这样弹系统打印对话框时「打印首选项」默认就是 A5/148×210，用户无需每次手改。
            //   （pageSize 选项在该原生对话框路径下不生效，实测见文件头注释）
            const a5Ready = ensureDefaultPrinterA5(printWin.webContents);

            // 页面加载完成后，等待布局和字体就绪，再调用打印
            printWin.webContents.once('did-finish-load', () => {
                setTimeout(async () => {
                    try {
                        // 强制布局刷新 + 等待字体加载
                        await printWin.webContents.executeJavaScript(
                            'document.body.offsetHeight; document.fonts ? document.fonts.ready : Promise.resolve()'
                        );
                        await new Promise(r => setTimeout(r, 200));
                        // ★ 2026-10-29 等 A5 校正完成（最多 8s，失败也放行）再弹对话框，
                        //   否则用户可能先看到 A4 首选项。
                        const a5Ok = await a5Ready;
                        if (!a5Ok) {
                            console.warn('[print] A5 默认纸张未确认，按打印机自身默认纸张继续打印');
                        }
                        // ★ 修复字体偏大（2026-09-25 起沿用）：CSS @page 与 pageSize/margins 双通道必须一致
                        //
                        // 原因：webContents.print({ pageSize, margins }) 选项与 CSS @page { size:148mm 210mm; margin:0 }
                        //   形成【双重指定】：
                        //   - Blink 布局引擎按 CSS @page 布局内容（通道A）
                        //   - Chrome 打印后端按 pageSize/margins 选项设置打印参数（通道B）
                        //   两者对纸张尺寸的内部表示不一致（浮点精度/DPI假设/舍入）会触发 fit-to-page 缩放，
                        //   缩放因子略>1.0，内容被放大。
                        //
                        // 做法：pageSize 用「微米」写死成与 CSS 完全相同的 A5（148000×210000），
                        //   margins:none 与 @page margin:0 对齐；隐藏窗宽度大于纸宽，避免滚动条引发缩放。
                        //   客户端打印机不固定，不做自动匹配：始终弹系统打印对话框，由用户手动选打印机。
                        //   ★ 2026-10-29 实测：Windows 原生对话框不读 pageSize，纸张由 per-user
                        //   打印首选项决定（见文件头 ensureDefaultPrinterA5）；pageSize 仍保留，
                        //   供未来 silent 直打/非 Windows 路径使用。
                        const printOptions = {
                            silent: false,
                            printBackground: true,
                            pageSize: { width: 148000, height: 210000 }, // ISO A5 148×210mm
                            landscape: isLandscape,
                            margins: { marginType: 'none' }
                        };
                        // ★ 2026-09-25 加固⑤：返回值反映真实打印结果（用户取消/
                        //   打印机失败 → false；渲染层当前未使用返回值，未来可据此提示）
                        printWin.webContents.print(printOptions, (success, failureReason) => {
                            if (!success && failureReason) {
                                console.error('[print] 打印失败:', failureReason);
                            }
                            safeResolve(success === true);
                        });
                    } catch (e) {
                        console.error('[print] 打印失败:', e);
                        safeResolve(false);
                    }
                }, 500);
            });

            printWin.webContents.once('did-fail-load', (_e, errorCode, errorDesc) => {
                console.error('[print] 页面加载失败:', errorCode, errorDesc);
                safeResolve(false);
            });

            // 超时保护：2分钟
            setTimeout(() => {
                if (!settled) {
                    console.warn('[print] 2分钟超时，自动关闭');
                    safeResolve(false);
                }
            }, 2 * 60 * 1000);
        });
    } catch (e) {
        console.error('打印失败:', e);
        return false;
    }
});
}

module.exports = { createDesktopPrintIpc, ensureDefaultPrinterA5 };
