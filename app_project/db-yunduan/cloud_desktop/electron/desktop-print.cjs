// ============================================================================
//  desktop-print.cjs — 桌面端打印域 IPC（双桌面共用唯一权威源）
//
//  ★ 2026-09-25 P2-3 打印域收口：从云桌面/离线桌面两份 main.js 等体抽取
//    （print-prescription 单个 handler + 隐藏打印窗实现，双端 115 行字节级
//    同体，改前 SHA256 一致：cd537a37...，逐行 diff=0 终验）。
//    方案：隐藏 BrowserWindow 加载处方 HTML dataURL → 等字体就绪 →
//    webContents.print 弹系统打印对话框（默认 B5/无边距/手动选打印机）→ 关闭。
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
        // ★ 2026-10-28 纸型改 B5（176×250mm）：隐藏窗须大于 176mm=665.2px@96dpi，
        //   否则 body 宽度超出视口触发滚动条，webContents.print() 会按视口宽度缩放内容。
        //   取 720px（纵向）/1000px（横向），与网页版预览窗口宽度一致。
        const printWin = new BrowserWindow({
            show: false,
            width: isLandscape ? 1000 : 720,
            height: isLandscape ? 720 : 1000,
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

            // 页面加载完成后，等待布局和字体就绪，再调用打印
            printWin.webContents.once('did-finish-load', () => {
                setTimeout(async () => {
                    try {
                        // 强制布局刷新 + 等待字体加载
                        await printWin.webContents.executeJavaScript(
                            'document.body.offsetHeight; document.fonts ? document.fonts.ready : Promise.resolve()'
                        );
                        await new Promise(r => setTimeout(r, 200));
                        // ★ 修复字体偏大（2026-09-25 起沿用）：CSS @page 与 pageSize/margins 双通道必须一致
                        //
                        // 原因：webContents.print({ pageSize, margins }) 选项与 CSS @page { size:176mm 250mm; margin:0 }
                        //   形成【双重指定】：
                        //   - Blink 布局引擎按 CSS @page 布局内容（通道A）
                        //   - Chrome 打印后端按 pageSize/margins 选项设置打印参数（通道B）
                        //   两者对纸张尺寸的内部表示不一致（浮点精度/DPI假设/舍入）会触发 fit-to-page 缩放，
                        //   缩放因子略>1.0，内容被放大。
                        //
                        // 做法：pageSize 用「微米」写死成与 CSS 完全相同的 B5（176000×250000），
                        //   margins:none 与 @page margin:0 对齐；隐藏窗宽度大于纸宽，避免滚动条引发缩放。
                        //   客户端打印机不固定，不做自动匹配：始终弹系统打印对话框，由用户手动选打印机，
                        //   pageSize 仅作为对话框默认纸张。
                        const printOptions = {
                            silent: false,
                            printBackground: true,
                            pageSize: { width: 176000, height: 250000 }, // ISO B5 176×250mm
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

module.exports = { createDesktopPrintIpc };
