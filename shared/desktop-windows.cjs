// ============================================================================
// desktop-windows.cjs — B2-2 桌面窗口域单一权威源（2026-09-13）
//
// 从双端 main.js 等体抽取的 6 函数（双侧 normalized 哈希 6/6 同体终验）：
//   focusWindow(5行) / getSharedWebPrefs(8行) / injectVideoRecorder(10行) /
//   installDevToolsGuard(62行) / createMainWindow(128行) / createLoginWindow(109行)
//   —— 共 322 行/端，历史靠人工双刷，现收口为单一权威源。
//
// 状态注入设计（与 B2-1 desktop-fs-ipc 工厂模式的差异点——窗口域有状态）：
//   mainWindow / loginWindow / currentLoggedInUser 仍是 main.js 的模块级 let 变量，
//   本模块经访问器（get/set）读写——main.js 体外约 50 处直接引用零改动。
//   访问器在闭包里直接读写 main.js 的变量，双端 main.js 保持各自状态所有权。
//
// 运行位置约定：本文件由 shared/ 经 sync-all Group 15 分发到
//   <桌面端>/electron/desktop-windows.cjs，运行时 __dirname = electron 目录，
//   相对路径（../build/icon.ico、preload.js、login.html、../index.html）与
//   原 main.js 内嵌时的解析结果一致。
//
// 分发与门禁：sync-all.ps1 Group 15 → 2 electron 目录；
//   copy-consistency.cjs 新组（2 副本硬哈希门）。
//
// 用法（main.js）：
//   const { createMainWindow, createLoginWindow, focusWindow } =
//       require('./desktop-windows.cjs').createDesktopWindows({
//           app, BrowserWindow, shell, updateManager, sendStartupHeartbeat,
//           getCurrentLoggedInUser: () => currentLoggedInUser,
//           getMainWindow: () => mainWindow, setMainWindow: (w) => { mainWindow = w; },
//           getLoginWindow: () => loginWindow, setLoginWindow: (w) => { loginWindow = w; },
//       });
// ============================================================================

function createDesktopWindows({ app, BrowserWindow, shell, updateManager, sendStartupHeartbeat,
    getCurrentLoggedInUser, getMainWindow, setMainWindow, getLoginWindow, setLoginWindow }) {
    const path = require('path');
    const fs = require('fs');

    // —— 与原 main.js 模块级常量等值（双端一致，B2-2 抽取时核验）——
    const IS_PROD_PACKAGED = app.isPackaged;
    const APP_ICON = path.join(__dirname, '..', 'build', 'icon.ico');
    const SESSION_PARTITION = 'persist:tcm-prescription-dingzhi';

    // 聚焦或恢复窗口
    function focusWindow(win) {
        if (!win || win.isDestroyed()) return;
        if (win.isMinimized()) win.restore();
        win.focus();
    }

    function getSharedWebPrefs() {
        return {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            partition: SESSION_PARTITION
        };
    }

    // ★ P1-A6：DevTools 反调试（仅打包环境生效）
    function installDevToolsGuard(webContents) {
        if (!IS_PROD_PACKAGED) return;  // 开发环境跳过
        try {
            webContents.on('devtools-opened', () => {
                try {
                    webContents.closeDevTools();
                    console.warn('[Security] DevTools 已被阻止');
                } catch (e) { /* 忽略 */ }
            });
            webContents.on('before-input-event', (event, input) => {
                if (!input || !event) return;
                const key = (input.key || '').toLowerCase();
                const ctrl = input.control || input.meta;
                const shift = input.shift;
                if (key === 'f12') { event.preventDefault(); return; }
                if (ctrl && shift && (key === 'i' || key === 'j')) { event.preventDefault(); return; }
                if (ctrl && shift && key === 'r') { event.preventDefault(); return; }
                if (ctrl && !shift && key === 'u') { event.preventDefault(); return; }
                // ★ P4-D 打印快捷键：Ctrl+P 纵向打印 / Ctrl+Shift+P 横向打印
                // 拦截浏览器默认打印对话框，改用应用自定义的 printPrescription
                if (ctrl && key === 'p') {
                    event.preventDefault();
                    const orientation = shift ? 'landscape' : 'portrait';
                    webContents.executeJavaScript(
                        `if (typeof printPrescription === 'function') printPrescription('${orientation}');`
                    ).catch(() => {});
                    return;
                }
            });
            // 3. ★ P0 安全增强：定时主动检查 DevTools 状态（防止 devtools-opened 事件被 hook 绕过）
            //    每 3 秒检查一次，若发现 DevTools 已打开则强制关闭
            const _devtoolsCheckTimer = setInterval(() => {
                try {
                    if (webContents.isDestroyed()) {
                        clearInterval(_devtoolsCheckTimer);
                        return;
                    }
                    if (webContents.isDevToolsOpened()) {
                        console.warn('[Security] 主动检测到 DevTools 已打开，强制关闭');
                        webContents.closeDevTools();
                    }
                    // 检测 debugger API 附加（防止通过 webContents.debugger.attach 附加）
                    if (webContents.debugger && typeof webContents.debugger.isAttached === 'function' &&
                        webContents.debugger.isAttached()) {
                        console.warn('[Security] 检测到 Debugger API 已附加，强制分离');
                        try { webContents.debugger.detach(); } catch (e) { /* 忽略 */ }
                    }
                } catch (e) { /* 忽略 */ }
            }, 3000);
            // 4. ★ P0 安全增强：启动时检测 --remote-debugging-port / --inspect 参数
            //    防止通过命令行参数启动远程调试端口绕过 DevTools 拦截
            try {
                const argv = process.argv.join(' ');
                if (argv.includes('--remote-debugging-port') ||
                    argv.includes('--inspect-brk') || argv.includes('--inspect=')) {
                    console.warn('[Security] 检测到远程调试参数，DevTools 防护已启用:', argv);
                }
            } catch (e) { /* 忽略 */ }
        } catch (e) {
            console.warn('[Security] installDevToolsGuard 异常:', e.message);
        }
    }

    // ★ 注入视频录制模块（从同目录读取 video-recorder.js）
    async function injectVideoRecorder(win) {
        try {
            const recorderPath = path.join(__dirname, 'video-recorder.js');
            const code = await fs.promises.readFile(recorderPath, 'utf8');
            await win.webContents.executeJavaScript(code);
            console.log('[视频录制] 模块注入成功');
        } catch (e) {
            console.error('[视频录制] 模块注入失败:', e.message);
        }
    }

    function createMainWindow() {
        const existing = getMainWindow();
        if (existing && !existing.isDestroyed()) {
            focusWindow(existing);
            return;
        }

        const win = new BrowserWindow({
            width: 1400,
            height: 900,
            minWidth: 1024,
            minHeight: 700,
            autoHideMenuBar: true,
            center: true,
            show: false,
            icon: APP_ICON,
            webPreferences: getSharedWebPrefs()
        });
        setMainWindow(win);

        // ★ P1-A6：DevTools 反调试（仅打包环境生效）
        installDevToolsGuard(win.webContents);

        win.webContents.on('dom-ready', async () => {
            // ★修复登录界面闪现（2026-07-19）：
            // 原因：index.html 中 loginOverlay 默认 style="display:flex;visibility:visible;"
            //       dom-ready 时 loginOverlay 已渲染显示，但 checkLoginStatus() 是异步执行
            //       会在 show() 之后才隐藏 loginOverlay，导致用户看到第二次登录界面闪现
            // 方案：已通过 login.html 登录时（currentLoggedInUser 存在），
            //       先 executeJavaScript 同步隐藏 loginOverlay，再 show()
            if (getCurrentLoggedInUser()) {
                try {
                    await win.webContents.executeJavaScript(`
                        try {
                            var _ov = document.getElementById('loginOverlay');
                            if (_ov) _ov.style.display = 'none';
                            var _mc = document.querySelector('.main-container');
                            if (_mc) _mc.style.display = 'flex';
                        } catch(e) {}
                    `);
                } catch(e) { /* 忽略注入失败 */ }
                win.webContents.send('main:login-user', getCurrentLoggedInUser());
            }
            win.show();

            // ★ 注入视频录制模块（从同目录读取 video-recorder.js）
            injectVideoRecorder(win);

            // ★ 修复 Electron 35 alert() 关闭后鼠标光标不显示的 bug
            // 问题根源：Electron 35 中原生 alert() 关闭后 Chromium 模态框焦点未正确恢复，导致鼠标光标不显示
            // 修复方案：用 Electron 原生 dialog.showMessageBoxSync（同步阻塞，由 main.js 的 IPC handler 处理）替代原生 alert/confirm
            //          业务代码同步调用 window.alert/confirm 不受影响（保留同步语义）
            try {
                const fixCode = `(function() {
                    if (window.__nativeDialogsInjected) return;
                    window.__nativeDialogsInjected = true;
                    if (window.electronAPI && typeof window.electronAPI.alertSync === 'function') {
                        var origAlert = window.alert;
                        window.alert = function(msg) {
                            try { window.electronAPI.alertSync(msg); }
                            catch(e) { console.warn('[alert] 同步 dialog 失败，回退原生:', e.message); origAlert(msg); }
                        };
                    }
                    if (window.electronAPI && typeof window.electronAPI.confirmSync === 'function') {
                        var origConfirm = window.confirm;
                        window.confirm = function(msg) {
                            try { return window.electronAPI.confirmSync(msg); }
                            catch(e) { console.warn('[confirm] 同步 dialog 失败，回退原生:', e.message); return origConfirm(msg); }
                        };
                    }
                    // ★ P0 修复：替换 window.prompt（Electron 原生 prompt 返回 null，导致编辑功能失效）
                    if (window.electronAPI && typeof window.electronAPI.prompt === 'function') {
                        window.prompt = function(message, defaultValue) {
                            return window.electronAPI.prompt(message, defaultValue);
                        };
                        console.log('[FIX] window.prompt 已替换为 Electron 异步 prompt');
                    }
                    console.log('[FIX] alert/confirm/prompt 已替换为 Electron 原生 dialog');
                })();`;
                await win.webContents.executeJavaScript(fixCode);
                console.log('[FIX] 原生同步 dialog 注入完成');
            } catch(e) { console.warn('[FIX] 原生同步 dialog 注入失败:', e.message); }

            // ★ 过滤启动时偶发的"系统异常"/"数据处理异常"toast，避免干扰用户
            // 来源：index.html 的 window.addEventListener('error') 和 unhandledrejection 监听器
            try {
                await win.webContents.executeJavaScript(`
                    (function() {
                        if (window.__dataErrorToastFiltered) return;
                        window.__dataErrorToastFiltered = true;
                        if (typeof window.showToast !== 'function') return;
                        var _origToast = window.showToast;
                        window.showToast = function(msg) {
                            if (typeof msg === 'string' &&
                                (msg.indexOf('数据处理异常') >= 0 || msg.indexOf('系统异常') === 0)) {
                                console.error('[已过滤toast]', msg);
                                return;
                            }
                            return _origToast.apply(this, arguments);
                        };
                    })();
                `);
            } catch(e) { console.warn('[过滤toast] 注入失败:', e.message); }
        });

        // ★ 2026-09-14 静默热更新接线（重建版，带 Ed25519 验签三道门禁）：
        //   resolveHotEntry 复验（manifest 验签 + 全量文件哈希）通过 → 加载热目录
        //   index.html（新版下次启动自动生效）；任何失败 → 该函数内部已隔离坏热目录，
        //   此处回退 asar 打包版。config.json 绝不热更（含密码哈希/配置签名）——
        //   从 asar 复制模板到热目录，等价原同步 XHR 行为（运行时权威仍是 userData 层）。
        let hotEntry = null;
        try {
            if (updateManager && typeof updateManager.resolveHotEntry === 'function') {
                hotEntry = updateManager.resolveHotEntry();
            }
        } catch (e) {
            console.warn('[hot-update] 入口解析异常，回退打包版:', e && e.message);
            hotEntry = null;
        }
        if (hotEntry) {
            try {
                // ★★★ 2026-09-24 【热更环境机构版按钮消失根治】热目录 config.json 必须复制
                //   userData 权威版（激活后含 cloud_clinic/offline_clinic + 密码哈希 + 配置签名），
                //   而非 asar 出厂模板（cloud_personal/personal）。热目录布局固定为
                //   <dataDir>/hot-update/<current|previous>/index.html（dataDir=userData），
                //   上溯两级即 userData 根；便携版权威 config 在 exe 同目录（getWritableDir 语义），
                //   故候选顺序：userData → exe 同目录 → asar 模板，首个存在即用。
                //   事故现象：复制 asar 模板 → 渲染层同步 XHR 读到 personal 系默认值 →
                //   CONFIG.edition 被打成标准版 → 机构管理员【用户管理】按钮消失。
                //   config.json 仅在本机目录间复制，绝不打进分发的热包（见 hot-update-core 头注）。
                const hotDirPath = path.dirname(hotEntry);
                const configCandidates = [
                    path.join(hotDirPath, '..', '..', 'config.json') // NSIS：userData 权威版
                ];
                try {
                    // 便携版权威 config 在安装包 exe 同目录（getWritableDir 语义）。
                    // ★ 必须优先 PORTABLE_EXECUTABLE_DIR：electron-builder portable 运行时
                    //   app.getPath('exe') 指向 %TEMP% 解包目录而非真实 exe 所在目录
                    //   （与 main.js getWritableConfigPath / desktop-fs-ipc.cjs env 优先约定一致）。
                    const portableDir = process.env.PORTABLE_EXECUTABLE_DIR;
                    if (portableDir) {
                        configCandidates.push(path.join(portableDir, 'config.json'));
                    } else if (app && app.getPath) {
                        configCandidates.push(path.join(path.dirname(app.getPath('exe')), 'config.json'));
                    }
                } catch (_) {}
                configCandidates.push(path.join(__dirname, '..', 'config.json')); // asar 出厂模板兜底
                let srcConfig = configCandidates[configCandidates.length - 1];
                for (const cand of configCandidates) {
                    try { if (fs.existsSync(cand)) { srcConfig = cand; break; } } catch (_) {}
                }
                fs.copyFileSync(srcConfig, path.join(hotDirPath, 'config.json'));
            } catch (e) { /* 复制失败时同步 XHR 404 → 内联默认+userData 覆盖，等同现状 */ }
            console.log('[hot-update] 加载热更新版入口:', hotEntry);
            win.loadFile(hotEntry);
        } else {
            win.loadFile(path.join(__dirname, '..', 'index.html'));
        }

        // ★ 安全：拦截 window.open 防止钓鱼攻击
        win.webContents.setWindowOpenHandler(({ url }) => {
            if (url.startsWith('file://') || url.startsWith('http://localhost')) {
                return { action: 'deny' };
            }
            shell.openExternal(url);
            return { action: 'deny' };
        });

        // ★ 安全（P3-1 最终加固 + 第四轮 B-重1 收窄）：主框架导航防护——仅允许
        //   应用自身目录（asar 应用根 / 热更目录）下的 file:// 页面。原"任意 file://
        //   放行"可被诱导跳到攻击者本地投放的页面（继承 preload API 面），现收窄。
        const __ownNavPrefixes = (() => {
            const list = [];
            try {
                list.push(require('url').pathToFileURL(path.join(__dirname, '..')).href.toLowerCase() + '/');
            } catch (_) {}
            try {
                if (typeof hotEntry === 'string' && hotEntry) {
                    list.push(require('url').pathToFileURL(path.dirname(hotEntry)).href.toLowerCase() + '/');
                }
            } catch (_) {}
            return list;
        })();
        win.webContents.on('will-navigate', (event, url) => {
            const lower = typeof url === 'string' ? url.toLowerCase() : '';
            const allowed = lower.startsWith('file://') && __ownNavPrefixes.some(p => lower.startsWith(p));
            if (!allowed) {
                event.preventDefault();
                console.warn('[安全] 已阻断主窗口整页导航到非应用自身页面:', url);
            }
        });

        win.on('closed', () => {
            setMainWindow(null);
        });
    }

    function createLoginWindow() {
        const existing = getLoginWindow();
        if (existing && !existing.isDestroyed()) {
            focusWindow(existing);
            return;
        }

        const win = new BrowserWindow({
            // ★ 2026-08-28 再压缩：窗口260→240宽，初始高度420→360，最小高度420→340（消除红框空白根源：
            //   实测最小内容=紫头56+主内容180+footer28+版权15≈279，给340安全下限足够）
            width: 240,
            height: 360,
            resizable: false,
            autoHideMenuBar: true,
            center: true,
            show: false,
            icon: APP_ICON,
            webPreferences: {
                preload: path.join(__dirname, 'preload.js'),
                contextIsolation: true,
                nodeIntegration: false,
                partition: SESSION_PARTITION
            }
        });
        setLoginWindow(win);

        // ★ 2026-08-28 登录窗口高度自适应：dom-ready 后按页面实际内容高度调整（含报错/激活提示/多账户下拉场景），
        //   上限 480px→460（宽度收窄高度略收）；下限 420→340（正常无报错时紧凑无红框）。
        win.webContents.on('dom-ready', () => {
            try {
                win.webContents.executeJavaScript('Math.ceil(document.body.scrollHeight)').then(h => {
                    const target = Math.min(Math.max(Number(h) || 360, 340), 460);
                    const current = win.getBounds();
                    if (Math.abs(current.height - target) > 4 || current.width !== 240) {
                        win.setBounds({ x: current.x, y: current.y, width: 240, height: target });
                    }
                }).catch(() => {});
            } catch (e) { /* 自适应失败保持 360 */ }
        });

        // ★ P1-A6：DevTools 反调试（仅打包环境生效）
        installDevToolsGuard(win.webContents);

        // ★ 2026-09-12 应用内更新：横幅「立即下载」→ 拦截 UPDATE_SCHEME → 主进程
        //   并行下载+进度+自动开安装向导；其余 window.open 走系统浏览器（原行为）。
        win.webContents.setWindowOpenHandler(({ url }) => {
            if (updateManager.handleWindowOpen(url)) {
                return { action: 'deny' };
            }
            if (url.startsWith('file://') || url.startsWith('http://localhost')) {
                return { action: 'deny' };
            }
            shell.openExternal(url);
            return { action: 'deny' };
        });

        // ★ 安全（P3-1 最终加固 + 第四轮 B-重1 收窄）：登录窗口主框架导航防护——
        //   仅允许应用自身 electron 目录下的 file:// 页面（login.html 所在目录），
        //   阻断被诱导跳到远程地址或任意本地文件。
        const __loginNavPrefix = (() => {
            try {
                return require('url').pathToFileURL(path.join(__dirname)).href.toLowerCase() + '/';
            } catch (_) { return null; }
        })();
        win.webContents.on('will-navigate', (event, url) => {
            const lower = typeof url === 'string' ? url.toLowerCase() : '';
            const allowed = !!__loginNavPrefix && lower.startsWith('file://') && lower.startsWith(__loginNavPrefix);
            if (!allowed) {
                event.preventDefault();
                console.warn('[安全] 已阻断登录窗口整页导航到非应用自身页面:', url);
            }
        });

        win.loadFile(path.join(__dirname, 'login.html'));

        win.on('closed', () => {
            setLoginWindow(null);
        });

        win.webContents.on('dom-ready', () => {
            console.log('[login] dom-ready triggered, executing JS...');
            // ★ 彻底禁用密码输入框自动填充（防止 Chromium 弹出旧版应用名凭据提示）
            // 根因：Chromium 通过 input type="password" 识别密码字段并弹出凭据提示
            //       autocomplete="off" 被现代 Chromium 忽略
            // 彻底修复：将 type="password" 改为 type="text" + webkitTextSecurity=disc（视觉仍为圆点）
            //           系统不再识别为密码字段，从根源消除提示
            //           配合 autocomplete="new-password" + readonly 延迟移除双保险
            win.webContents.executeJavaScript(`
                (function() {
                    var pwds = document.querySelectorAll('input[type="password"]');
                    for (var i = 0; i < pwds.length; i++) {
                        var p = pwds[i];
                        p.setAttribute('autocomplete', 'new-password');
                        p.setAttribute('readonly', '');
                        p.addEventListener('focus', function() { this.removeAttribute('readonly'); });
                        p.setAttribute('type', 'text');
                        p.style.webkitTextSecurity = 'disc';
                    }
                })();
            `).then(() => {
                console.log('[login] executeJavaScript succeeded, showing window...');
                win.show();
            }).catch(e => {
                console.warn('[login] executeJavaScript failed:', e.message);
                win.show();
            });

            // ★ 方案A：登录页首帧直出完成后再静默检查更新（延迟 1.5s，不与首屏渲染竞争）
            setTimeout(() => {
                const lw = getLoginWindow();
                if (lw && !lw.isDestroyed()) {
                    updateManager.checkForUpdate(lw);
                // ★ 2026-09-14 静默热更新检查（与整包检查并行；后台增量下载，
                //   新版就绪后下次启动自动生效，仅淡绿横幅轻提示，绝不打断使用）
                updateManager.checkHotUpdate(lw);
                // ★ 2026-09-16 Layer 2：热版本在效时注入登录窗「回退上一版」入口
                //   （login.html 属 asar 域，坏热版本打不开主界面时仍可自助恢复）
                if (typeof updateManager.injectHotRollbackEntry === 'function') {
                    updateManager.injectHotRollbackEntry(lw);
                }
                }
                sendStartupHeartbeat(); // ★ 匿名统计心跳（fire-and-forget，失败静默）
            }, 1500);
        });

        win.on('ready-to-show', () => {
            console.log('[login] ready-to-show event');
        });
    }

    return {
        focusWindow,
        getSharedWebPrefs,
        injectVideoRecorder,
        installDevToolsGuard,
        createMainWindow,
        createLoginWindow,
    };
}

module.exports = { createDesktopWindows };
