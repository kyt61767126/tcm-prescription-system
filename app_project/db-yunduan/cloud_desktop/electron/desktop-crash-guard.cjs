// ============================================================================
//  desktop-crash-guard.cjs — 桌面端渲染进程崩溃自愈（双桌面共用）
//  ★ 2026-09-14 P3-A 崩溃韧性补强：此前双端 main.js 仅有 uncaughtException /
//    unhandledRejection 兜底，无 render-process-gone / child-process-gone——
//    渲染进程一旦崩溃（V8 异常/OOM/被杀）用户面对白屏无任何恢复。
//  本模块补齐（shared/ 唯一权威源 → sync-all Group 18 分发 → copy-consistency
//    哈希门）：
//    1. render-process-gone：主窗/登录窗崩溃 → 落 CRASH 日志 + 自动销毁旧壳重建
//       （登录态由渲染层 localStorage/auth-core 自恢复，主进程不干预）；
//       prompt 小窗等临时窗口崩溃仅记日志不重建；clean-exit（正常关窗）过滤不误报。
//    2. 连续崩溃熔断：60s 滑窗内 >=3 次 → showMessageBoxSync 提示 + 销毁全部窗口
//       → 依赖 window-all-closed 自然退出（不抢跑 quit，保住日志写入）。
//    3. child-process-gone：GPU/Utility 进程崩溃 Electron 会自动重启，仅审计日志。
//  依赖注入：createDesktopCrashGuard({ app, dialog, logger, createMainWindow,
//    createLoginWindow, getMainWindow, setMainWindow, getLoginWindow,
//    setLoginWindow }) —— 与 desktop-windows.cjs 同款访问器注入（B2-2 验证过），
//    窗口创建经注入复用，不改 desktop-windows.cjs（避免模块成环）。
//  铁律：改崩溃韧性逻辑只改本文件，禁止再改两份 main.js 内嵌副本。
// ============================================================================
'use strict';

function createDesktopCrashGuard({ app, dialog, logger,
    createMainWindow, createLoginWindow,
    getMainWindow, setMainWindow, getLoginWindow, setLoginWindow }) {

    const CRASH_WINDOW_MS = 60 * 1000;   // 滑窗：60 秒
    const CRASH_THRESHOLD = 3;           // 熔断阈值：60s 内主壳崩溃 >=3 次
    let crashStamps = [];                // 主壳崩溃时间戳（滑窗）
    let guardOff = false;                // 熔断后停止自动重建（防崩溃风暴）

    function logCrash(type, details) {
        try {
            logger.crash(type, new Error(
                'reason=' + (details && details.reason) +
                ' exitCode=' + (details && details.exitCode) +
                ' type=' + ((details && details.type) || 'renderer')
            ));
        } catch (e) { /* 日志失败不阻断自愈 */ }
    }

    // 安全销毁旧壳：崩溃后 webContents 已死但窗口壳可能仍存（白屏），必须 destroy
    function destroyShell(win) {
        try { if (win && !win.isDestroyed()) win.destroy(); } catch (e) { /* 已销毁 */ }
    }

    // 熔断：提示用户 + 销毁全部窗口 → window-all-closed 自然退出
    function tripBreaker() {
        guardOff = true;
        logCrash('crash-guard-breaker', { reason: 'continuous-crash', type: 'breaker' });
        try {
            dialog.showMessageBoxSync({
                type: 'error',
                title: '程序异常',
                message: '程序在短时间内多次异常崩溃，已停止自动恢复。\n\n' +
                    '崩溃日志已保存，请联系客服并提供日志文件\n' +
                    '（菜单「帮助-日志」或安装目录 logs 文件夹）。\n\n点击确定退出程序。',
                buttons: ['退出'],
                defaultId: 0,
                noLink: true
            });
        } catch (e) { /* 无父窗弹窗失败也继续退出 */ }
        destroyShell(getMainWindow());
        setMainWindow(null);
        destroyShell(getLoginWindow());
        setLoginWindow(null);
        // 不抢跑 app.quit()：由 window-all-closed 自然退出，保住日志写入
    }

    function rebuildMainWindow() {
        destroyShell(getMainWindow());
        setMainWindow(null);
        try { createMainWindow(); } catch (e) { logCrash('crash-guard-rebuild-fail', { reason: String(e && e.message || e), type: 'main' }); }
    }

    function rebuildLoginWindow() {
        destroyShell(getLoginWindow());
        setLoginWindow(null);
        try { createLoginWindow(); } catch (e) { logCrash('crash-guard-rebuild-fail', { reason: String(e && e.message || e), type: 'login' }); }
    }

    app.on('render-process-gone', (event, webContents, details) => {
        // ① 正常关窗（clean-exit）不计数不重建，防误报
        if (details && details.reason === 'clean-exit') return;

        const mainWin = getMainWindow();
        const loginWin = getLoginWindow();
        const isMain = mainWin && !mainWin.isDestroyed() && mainWin.webContents === webContents;
        const isLogin = loginWin && !loginWin.isDestroyed() && loginWin.webContents === webContents;

        // ② prompt 小窗等临时窗口崩溃：仅审计，不重建不计数
        if (!isMain && !isLogin) {
            logCrash('render-process-gone', details);
            return;
        }

        // ③ 主壳崩溃：落日志 + 计数
        logCrash('render-process-gone', details);
        const now = Date.now();
        crashStamps.push(now);
        crashStamps = crashStamps.filter(t => now - t < CRASH_WINDOW_MS);

        // ④ 熔断检查：60s 滑窗 >=3 次主壳崩溃 → 停止自愈，提示后退出
        if (crashStamps.length >= CRASH_THRESHOLD) {
            tripBreaker();
            return;
        }

        // ⑤ 未达阈值：销毁旧壳重建（createMainWindow 内部有存活检查，先置空防复用死壳）
        if (guardOff) return;
        if (isMain) rebuildMainWindow();
        else rebuildLoginWindow();
    });

    // GPU / Utility / Network service 等子进程崩溃：Electron 自动重启，仅审计
    app.on('child-process-gone', (event, details) => {
        logCrash('child-process-gone', details);
    });
}

module.exports = { createDesktopCrashGuard };
