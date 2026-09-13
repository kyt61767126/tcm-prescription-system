'use strict';
// ============================================================================
// update-manager.cjs — 桌面端应用内更新器【唯一权威源】
// ★ 2026-09-13 架构收口：云桌面/离桌面 main.js 内嵌的两份 ~200 行同构更新器
//   （仅 channel URL 不同，历史靠人肉双改，09-12 /api/dl 代理修复就必须改两处）
//   抽为本模块。两份 main.js 只允许：
//     const updateManager = require('./update-manager.cjs').createDesktopUpdateManager({
//         checkUrl: 'https://.../updates/<cloud|local>/latest.json',
//         downloadPageUrl: 'https://.../download?card=<card-anchor>'
//     });
//   接线点仅两处：
//     ① 登录窗 dom-ready：updateManager.checkForUpdate(loginWindow)
//     ② setWindowOpenHandler：if (updateManager.handleWindowOpen(url)) return { action: 'deny' };
//   分发链：shared/ 权威源 → sync-all.ps1 Group 12 → 两个 electron/ 目录；
//   copy-consistency.cjs 硬哈希门（pre-push ⑦ / CI ⑥）拦截漂移。
//
// 机制（与 2026-09-12 版逐行等价，行为零变化）：
//   启动静默检查 latest.json（主进程 net.fetch 绕过渲染层 CSP/缓存，8s 超时）
//   → 三段式版本号比较（宁可漏检不可误报）→ 版本号/exeUrl 白名单防注入
//   → GitHub 直链自动包官网 /api/dl Cloudflare 代理 → 登录窗顶部黄色横幅
//   → 横幅点击经 kyt-desktop-update:// scheme 被 setWindowOpenHandler 拦截
//   → 4 连接并行分片下载（每分片独立 Range/25s 看门狗/6 次指数退避）
//   → 横幅实时进度速度 → 大小对账 → shell.openPath 自动开安装向导
//   → 任一步失败回退官网下载页（safeDownload v4 兜底）；网络异常一律静默跳过
// ============================================================================

const { app, net, shell } = require('electron');
const path = require('path');
const fsSync = require('fs');

const UPDATE_SCHEME = 'kyt-desktop-update://start';
// ★ 2026-09-13 v2 参数对齐官网 robustDownload v4（用户实测官网页 6 连接 ≈5MB/s
//   15 秒下完 78MB，而桌面更新器 4 连接卡 1-2%）：6 连接 / 15 次重试 / 15s 看门狗。
//   实测基线（同刻）：/api/dl 代理单连接 0.9MB/s（206 正常）、GitHub 直连 0B/s
//   （TLS 吊销检查被拦）——跨境链路单流随时可能整连接停滞，重试次数与退避
//   上限是存活关键（6 次×800ms 不够熬过 GitHub 抽风窗口）。
const UPDATE_DL_PARALLEL = 6;                 // 并行分片数（>8MB 才并行，对齐 robustDownload）
const UPDATE_DL_MIN_PARALLEL = 8 * 1048576;   // 小文件单流
const UPDATE_DL_WATCHDOG_MS = 15000;          // 单分片数据停滞超时（对齐 robustDownload 15s）
const UPDATE_DL_MAX_RETRY = 15;               // 单分片重试上限（对齐 robustDownload SEG_RETRIES）
const UPDATE_BANNER_EXTRA_HEIGHT = 40;        // 横幅腾出的窗口增高 px
const PROXY_BASE = 'https://tcm-prescription-system.pages.dev';

function createDesktopUpdateManager(opts) {
    opts = opts || {};
    const checkUrl = opts.checkUrl;
    const downloadPageUrl = opts.downloadPageUrl;
    if (!checkUrl || !downloadPageUrl) {
        throw new Error('[update-manager] checkUrl / downloadPageUrl 必填');
    }

    let pendingUpdate = null;                 // { win, exeUrl, version }（injectUpdateBanner 时记录）
    let updateDownloading = false;

    function setUpdateBannerText(win, text, showLink, linkText) {
        if (!win || win.isDestroyed()) return;
        const code = '(function(){var b=document.getElementById(\'__updateBanner\');if(!b)return;'
            + 'var l=b.querySelector(\'#__updateLabel\');if(l)l.textContent=' + JSON.stringify(String(text)) + ';'
            + 'var k=b.querySelector(\'#__updateLink\');if(k){k.style.display=' + (showLink ? '\'\'' : '\'none\'') + ';'
            + 'if(k.style.display!==\'none\')k.textContent=' + JSON.stringify(String(linkText || '立即下载')) + ';}})();';
        win.webContents.executeJavaScript(code).catch(function () {});
    }

    function setUpdateBannerFill(win, pct) {
        if (!win || win.isDestroyed()) return;
        const code = '(function(){var f=document.getElementById(\'__updateFill\');if(f)f.style.width=\'' + Math.max(0, Math.min(100, pct)) + '%\';})();';
        win.webContents.executeJavaScript(code).catch(function () {});
    }

    // 探测下载源：Range 0-0 → 206 + Content-Range 总大小；200 = 无 Range 支持按单流全量
    async function probeUpdateFile(url) {
        const res = await net.fetch(url, { headers: { Range: 'bytes=0-0' }, signal: AbortSignal.timeout(20000) });
        if (!res.ok) throw new Error('探测失败 HTTP ' + res.status);
        const cr = res.headers.get('content-range');
        try { if (res.body && res.body.cancel) res.body.cancel(); } catch (e) { /* 已取消 */ }
        if (res.status === 206 && cr && /\/(\d+)$/.test(cr)) {
            return { size: parseInt(cr.match(/\/(\d+)$/)[1], 10), ranged: true };
        }
        const cl = res.headers.get('content-length');
        return { size: cl ? parseInt(cl, 10) : 0, ranged: false };
    }

    // 单分片流式落盘：数据到达即按偏移写 fd（内存占用极小），看门狗 + 指数退避重试
    async function fetchUpdateRange(url, fd, start, end, onChunk) {
        let attempt = 0;
        for (;;) {
            try {
                const ctl = new AbortController();
                let dog = setTimeout(function () { ctl.abort(); }, UPDATE_DL_WATCHDOG_MS);
                const feed = function () { clearTimeout(dog); dog = setTimeout(function () { ctl.abort(); }, UPDATE_DL_WATCHDOG_MS); };
                const res = await net.fetch(url, { headers: { Range: 'bytes=' + start + '-' + end }, signal: ctl.signal });
                if (res.status !== 206 && res.status !== 200) throw new Error('HTTP ' + res.status);
                const reader = res.body.getReader();
                let written = 0;
                for (;;) {
                    const r = await reader.read();
                    if (r.done) break;
                    feed();
                    const buf = Buffer.from(r.value);
                    fsSync.writeSync(fd, buf, 0, buf.length, start + written);
                    written += buf.length;
                    onChunk(buf.length);
                }
                clearTimeout(dog);
                if (written !== end - start + 1) throw new Error('分片不完整 ' + written + '/' + (end - start + 1));
                return written;
            } catch (e) {
                attempt++;
                if (attempt > UPDATE_DL_MAX_RETRY) throw e;
                // 退避对齐 robustDownload backoffMs：1s×n 封顶 5s（6 次×800ms 顶不过 GitHub 抽风窗口）
                await new Promise(function (r) { setTimeout(r, Math.min(1000 * attempt, 5000)); });
            }
        }
    }

    async function startInAppUpdateDownload() {
        const info = pendingUpdate;
        if (!info || !info.exeUrl) { shell.openExternal(downloadPageUrl); return; }
        if (updateDownloading) return;
        updateDownloading = true;
        const t0 = Date.now();
        try {
            setUpdateBannerText(info.win, '⬇ 正在准备下载…', false);
            const probe = await probeUpdateFile(info.exeUrl);
            const dest = path.join(app.getPath('temp'), 'kyt-update-' + info.version + '.exe');
            const fd = fsSync.openSync(dest, 'w');
            let done = 0, lastUi = 0;
            const ui = function (force) {
                const now = Date.now();
                if (!force && now - lastUi < 400) return;
                lastUi = now;
                const pct = probe.size ? Math.floor(done / probe.size * 100) : 0;
                const speed = (now - t0) > 500 ? (done / 1048576 / ((now - t0) / 1000)) : 0;
                setUpdateBannerText(info.win, '⬇ 下载中 ' + pct + '% · ' + speed.toFixed(1) + 'MB/s', false);
                setUpdateBannerFill(info.win, pct);
            };
            const onChunk = function (n) { done += n; ui(false); };
            if (probe.ranged && probe.size > UPDATE_DL_MIN_PARALLEL) {
                const per = Math.ceil(probe.size / UPDATE_DL_PARALLEL);
                await Promise.all(Array.from({ length: UPDATE_DL_PARALLEL }, function (_, i) {
                    const s = i * per, e = Math.min(probe.size - 1, s + per - 1);
                    return fetchUpdateRange(info.exeUrl, fd, s, e, onChunk);
                }));
            } else {
                await fetchUpdateRange(info.exeUrl, fd, 0, Math.max(0, probe.size - 1), onChunk);
            }
            fsSync.closeSync(fd);
            const real = fsSync.statSync(dest).size;
            if (probe.size && real !== probe.size) throw new Error('大小校验失败 ' + real + '/' + probe.size);
            console.log('[update] 应用内下载完成: ' + dest + ' (' + real + ' bytes)');
            setUpdateBannerText(info.win, '✅ 下载完成，正在打开安装程序…', false);
            setUpdateBannerFill(info.win, 100);
            shell.openPath(dest);
        } catch (e) {
            console.warn('[update] 应用内下载失败，回退官网下载页:', e && e.message);
            setUpdateBannerText(info.win, '❌ 下载失败，已打开官网下载页', true, '重试下载');
            shell.openExternal(downloadPageUrl);
        } finally {
            updateDownloading = false;
        }
    }

    // 三段式版本号比较：仅当远程版本严格大于本地版本才提示
    function isNewerRemoteVersion(remote, local) {
        if (!remote || !local) return false;
        const r = String(remote).split('.');
        const l = String(local).split('.');
        for (let i = 0; i < 3; i++) {
            const rv = parseInt(r[i], 10) || 0;
            const lv = parseInt(l[i], 10) || 0;
            if (rv > lv) return true;
            if (rv < lv) return false;
        }
        return false;
    }

    // ★ exe 直链白名单校验（与版本号校验同构的安全原则）：
    //   必须过五道关才允许注入横幅：https / .exe 后缀 / host 白名单（官方发布源）/
    //   长度上限 / 无注入字符。任何一项不过=回退官网下载页（向后兼容）。
    function isValidExeDownloadUrl(u) {
        if (typeof u !== 'string' || u.length === 0 || u.length > 500) return false;
        if (!/^https:\/\//i.test(u)) return false;
        if (!/\.exe$/i.test(u)) return false;
        if (!/^https:\/\/(github\.com\/|tcm-prescription-system\.pages\.dev\/)/i.test(u)) return false;
        if (/['"\\\s<>()]/.test(u)) return false;
        return true;
    }

    async function checkForUpdateAndNotify(win) {
        try {
            const res = await net.fetch(checkUrl, { signal: AbortSignal.timeout(8000) });
            if (!res.ok) {
                console.log('[update] 检查跳过: HTTP ' + res.status);
                return;
            }
            const latest = await res.json();
            const localVer = app.getVersion();
            const remoteVer = latest && latest.version;
            // 版本号白名单校验：防止 latest.json 被篡改后向 executeJavaScript 注入任意代码
            if (!/^[0-9A-Za-z.\-+]+$/.test(String(remoteVer || ''))) {
                console.log('[update] 检查跳过: 官网版本号格式异常');
                return;
            }
            if (!isNewerRemoteVersion(remoteVer, localVer)) {
                console.log('[update] 已是最新版本 v' + localVer);
                return;
            }
            console.log('[update] 发现新版本 v' + remoteVer + '（当前 v' + localVer + '），注入登录页横幅');
            // ★ 直链改走官网 /api/dl Cloudflare 代理：GitHub 直链大陆间歇性卡断
            //   （2026-09-12 实测点击后仅 ~1MB 停滞→下载失败；代理同刻 Range 1MB 秒收）。
            //   代理仅放行本仓库 Release 资产（functions/api/dl.js ASSET_RE），流式透传不改内容。
            const exeUrl = isValidExeDownloadUrl(latest.url)
                ? (/^https:\/\/github\.com\//i.test(latest.url)
                    ? PROXY_BASE + '/api/dl?f=' + encodeURIComponent(latest.url)
                    : latest.url)
                : null;
            injectUpdateBanner(win, remoteVer, exeUrl);
        } catch (e) {
            // 离线/超时/DNS 失败：静默跳过（宁可漏检不可误报，不打扰离线使用）
            console.log('[update] 检查跳过（网络不可用或超时）: ' + (e && e.message));
        }
    }

    function injectUpdateBanner(win, newVersion, exeUrl) {
        if (!win || win.isDestroyed()) return;
        try {
            // 窗口增高 40px 并重新居中，为顶部横幅腾出空间（不遮挡居中的登录卡片）
            win.setSize(260, 430 + UPDATE_BANNER_EXTRA_HEIGHT);
            win.center();
            // 横幅点击 → window.open(UPDATE_SCHEME) → setWindowOpenHandler 拦截
            //   → 主进程并行下载+进度+自动开安装向导。
            // exeUrl 白名单不过（null）时点击直接走官网下载页（safeDownload v4 兜底）。
            pendingUpdate = { win: win, exeUrl: exeUrl || null, version: String(newVersion) };
            const downloadTarget = exeUrl ? UPDATE_SCHEME : downloadPageUrl;
            const bannerCode = `
            (function() {
                if (document.getElementById('__updateBanner')) return;
                var b = document.createElement('div');
                b.id = '__updateBanner';
                b.style.cssText = 'position:fixed;top:0;left:0;right:0;height:32px;z-index:99999;'
                    + 'display:flex;align-items:center;justify-content:center;gap:6px;'
                    + 'background:linear-gradient(135deg,#fff8e1 0%,#ffecb3 100%);'
                    + 'border-bottom:1px solid #f0c040;font-size:11px;color:#7a5c00;'
                    + 'font-family:"Microsoft YaHei",sans-serif;overflow:hidden;';
                var fill = document.createElement('div');
                fill.id = '__updateFill';
                fill.style.cssText = 'position:absolute;left:0;top:0;bottom:0;width:0;'
                    + 'background:rgba(21,101,192,0.15);transition:width .3s;';
                b.appendChild(fill);
                var label = document.createElement('span');
                label.id = '__updateLabel';
                label.textContent = '🆕 新版 v' + ${JSON.stringify(String(newVersion))};
                label.style.cssText = 'position:relative;white-space:nowrap;';
                var link = document.createElement('span');
                link.id = '__updateLink';
                link.textContent = '立即下载';
                link.style.cssText = 'color:#1565c0;font-weight:bold;text-decoration:underline;cursor:pointer;position:relative;white-space:nowrap;';
                link.addEventListener('click', function() {
                    window.open(${JSON.stringify(downloadTarget)});
                });
                b.appendChild(label);
                b.appendChild(link);
                document.body.appendChild(b);
            })();
        `;
            win.webContents.executeJavaScript(bannerCode).catch(function(e) {
                console.warn('[update] 横幅注入失败:', e && e.message);
            });
        } catch (e) {
            console.warn('[update] 横幅注入异常:', e && e.message);
        }
    }

    return {
        scheme: UPDATE_SCHEME,
        // 登录窗 dom-ready 后调用（原 checkForUpdateAndNotify）
        checkForUpdate: checkForUpdateAndNotify,
        // setWindowOpenHandler 内调用：命中更新 scheme 触发下载并返回 true（调用方 deny 开窗）
        handleWindowOpen: function (url) {
            if (url === UPDATE_SCHEME) {
                startInAppUpdateDownload();
                return true;
            }
            return false;
        }
    };
}

module.exports = { createDesktopUpdateManager: createDesktopUpdateManager };
