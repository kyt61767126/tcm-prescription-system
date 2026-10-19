// ============================================================================
//  sw.js — 云端网页 / 云 APP 离线兜底壳（Service Worker）
//
//  背景：云端 APP 每次启动带 `_v=时间戳` 加载远程页面，断网冷启动时无本地兜底；
//  云端网页刷新断网也打不开。本 SW 在首次在线访问后把应用壳（index + 业务 JS +
//  vendor）缓存到设备本地，之后：
//    · 断网/弱网冷启动：导航请求 network-first → 失败回退缓存 index.html（同源、
//      同 localStorage/IndexedDB，离线登录缓存与本地处方数据可直接使用）；
//    · 静态资源：cache-first + 后台更新（带 ?cv= 的 URL 用 ignoreSearch 匹配）；
//    · API（/api/）、热更产物（/hot-update/）、管理端页面：绝不缓存，保持在线语义。
//  仅 https 注册（public/index.html 尾部脚本）；Electron file:// 自动跳过。
//  发布：改版本号 → push，浏览器/WebView 下次在线访问自动更新（skipWaiting）。
// ============================================================================
'use strict';

const SW_VERSION = '2026-10-19-1';
const CACHE_NAME = 'hkzy-shell-' + SW_VERSION;
const CACHE_PREFIX = 'hkzy-shell-';

// 应用壳预缓存（首次安装时抓取；单个失败不阻塞整体，运行时还会补缓存）
const PRECACHE = [
    '/',
    '/index.html',
    '/config.json',
    '/auth-core.js',
    '/permission.js',
    '/normalize-config.js',
    '/debug-logger.js',
    '/print-utils.js',
    '/medicine-dict.js',
    '/symptom-dict.js',
    '/cloud-api.js',
    '/performance-utils.js',
    '/prescription-core.js',
    '/stock-core.js',
    '/analytics-core.js',
    '/security-guard.js',
    '/voice-input.js',
    '/button-manager.js',
    '/edition-lock.js',
    '/electron/video-recorder.js',
    '/vendor/pinyin-pro.min.js',
    '/xlsx.full.min.js'
];

self.addEventListener('install', (event) => {
    event.waitUntil((async () => {
        try {
            const cache = await caches.open(CACHE_NAME);
            await Promise.all(PRECACHE.map(async (url) => {
                try {
                    const res = await fetch(new Request(url, { cache: 'reload' }));
                    if (res && res.ok) await cache.put(url, res.clone());
                } catch (e) { /* 单文件失败不阻塞安装 */ }
            }));
        } catch (e) { /* ignore */ }
        try { await self.skipWaiting(); } catch (e) {}
    })());
});

self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        try {
            const keys = await caches.keys();
            await Promise.all(keys
                .filter(k => k !== CACHE_NAME && k.indexOf(CACHE_PREFIX) === 0)
                .map(k => caches.delete(k)));
        } catch (e) { /* ignore */ }
        try { await self.clients.claim(); } catch (e) {}
    })());
});

self.addEventListener('message', (event) => {
    try { if (event.data === 'SKIP_WAITING') self.skipWaiting(); } catch (e) {}
});

// 允许缓存的同源静态资源（API/热更/管理端等一律放行走网络）
function cacheableStatic(pathname) {
    if (pathname.indexOf('/api/') === 0) return false;
    if (pathname.indexOf('/hot-update/') === 0) return false;
    if (pathname.indexOf('/admin/') === 0) return false;
    if (pathname === '/sw.js') return false;
    return true;
}

self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (!req || req.method !== 'GET') return;
    let url;
    try { url = new URL(req.url); } catch (e) { return; }
    if (url.origin !== self.location.origin) return; // 跨域（CDN 等）不接管

    // 页面导航：在线优先，失败回退缓存的 App Shell（断网冷启动兜底）
    if (req.mode === 'navigate') {
        event.respondWith((async () => {
            try { return await fetch(req); }
            catch (e) {
                try {
                    const cache = await caches.open(CACHE_NAME);
                    const cached = (await cache.match('/index.html', { ignoreSearch: true })) ||
                                   (await cache.match('/', { ignoreSearch: true }));
                    if (cached) return cached;
                } catch (e2) { /* ignore */ }
                throw e;
            }
        })());
        return;
    }

    if (!cacheableStatic(url.pathname)) return;

    // 静态资源：网络优先（在线永远拿最新，CV 版本不会被旧缓存拖后腿）；
    // 离线/失败时回退本地缓存（cache 匹配忽略 ?cv= 查询）
    event.respondWith((async () => {
        const cache = await caches.open(CACHE_NAME);
        try {
            const res = await fetch(req);
            if (res && res.ok) {
                try { cache.put(req, res.clone()); } catch (e) {}
            }
            return res;
        } catch (e) {
            try {
                const cached = await cache.match(req, { ignoreSearch: true });
                if (cached) return cached;
                const shell = await cache.match('/index.html', { ignoreSearch: true });
                if (shell) return shell;
            } catch (e2) { /* ignore */ }
            return new Response('', { status: 504, statusText: 'Offline' });
        }
    })());
});
