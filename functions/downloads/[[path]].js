// ============================================================================
//  functions/downloads/[[path]].js — /downloads/* 静态安装包直链的埋点透传层
//
//  背景（2026-09-28 P1）：
//    官网 download.html 的 APK 直链与部分 exe 直链指向 public/downloads/ 静态资源，
//    静态响应原本不经过任何函数，无法统计"官网实际下载次数"。本路由与静态路径
//    同名拦截，通过 context.next() 原样放行给 Pages 静态资源（Range/缓存行为不变），
//    仅在确认命中真实文件（200/206）后用 waitUntil 异步写 D1 去重计数。
//
//  口径：与 /api/dl 共用 _lib/download-counter.js（IP+文件+UTC自然日去重，估算）。
//
//  安全：不主动产出任何文件内容，只透传既有静态资源；非 .exe/.apk 不计数。
// ============================================================================

import { recordDownload } from '../api/_lib/download-counter.js';

export async function onRequest(context) {
    const { request } = context;
    const res = await context.next(); // 交给 Pages 静态资源（未命中自然 404）

    // 仅 GET 且确实命中安装包（200/206 + 二进制内容类型）才计数；
    // HEAD/404/其他后缀/404 HTML 兜底页一律不计数
    const ct = res.headers.get('content-type') || '';
    if (request.method === 'GET' && (res.status === 200 || res.status === 206)
        && !ct.includes('text/html')) {
        try {
            const pathname = new URL(request.url).pathname;
            const fileName = decodeURIComponent(pathname.split('/').pop() || '');
            recordDownload(context.env, context.waitUntil, fileName, request);
        } catch (e) {
            // 文件名解析失败不影响下载
        }
    }
    return res;
}
