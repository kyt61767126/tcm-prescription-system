// ============================================================================
// 下载代理：/api/dl?f=<github-release-url>
//
// 背景（2026-08-31）：国内网络直连 GitHub Release（release-assets.githubusercontent.com）
// 实测仅 ~0.14 MB/s，75MB 安装包常被浏览器中断报"无法下载 - 网络问题"。
// 本函数把下载走 Cloudflare 边缘中转（用户→Cloudflare→GitHub），与官网同域。
//
// ★ 2026-08-31 v2：支持 Range 断点续传（透传客户端 Range 头到上游，
//   返回 206 + Content-Range）。75MB 下载链路任一环抖动时，浏览器/前端
//   下载器可从断点恢复，而不是从头重来报"网络中断"。
//
// ★ 2026-09-13 v3：R2 缓存层（过渡方案，客户端/官网/更新器零改动）——
//   R2 命中：直接从 R2 返回（CF 内部网络，消除 CF↔GitHub 跨境段卡死，
//     可靠性质变：实测 GitHub 直链 0 B/s 卡死场景下 R2 链路恒可用；
//     用户↔CF 段速度仍受 CF 免费版大陆访问常态 ~0.5MB/s 限制，彻底
//     提速待国内 OSS——见 KNOWLEDGE §18 统筹路线 P2）。
//   R2 未命中：当前请求走 v2 GitHub 代理链路正常回传（不阻塞），同时
//     waitUntil 异步全量拉取一次写进 R2 预热（首个请求触发，此后全部
//     R2 命中；并发分片请求下 put 幂等覆盖，无一致性风险）。
//   R2 绑定缺失（env.DOWNLOADS undefined，部署窗口期/本地 dev）：
//     自动回退 v2 纯 GitHub 链路，行为与旧版完全一致（安全灰度开关）。
//
// 安全约束（不变）：
//   ① 仅放行本仓库 kyt61767126/tcm-prescription-system 的 /releases/download/ 资产，
//     拒绝任意 URL 代理（防开放代理滥用/SSRF）。R2 key 由 ASSET_RE 捕获组
//     派生（releases/<tag>/<file>），标签/文件名仅 [^/?#]+ 且作为对象 key
//     直写 R2，无路径注入面。
//   ② 文件完整性由官网页面展示的 SHA-256 值兜底（代理不改内容，流式透传；
//     R2 仅缓存透传所得字节，put 幂等同源覆盖）。
// ============================================================================

const ASSET_RE = /^https:\/\/github\.com\/kyt61767126\/tcm-prescription-system\/releases\/download\/([^/?#]+)\/([^/?#]+)$/;

function resolveTarget(raw) {
    if (!raw) return null;
    let t = String(raw);
    if (t.startsWith('/')) t = 'https://github.com' + t;
    const m = ASSET_RE.exec(t);
    if (!m) return null;
    return { url: t, key: 'releases/' + m[1] + '/' + m[2], fileName: m[2] };
}

function corsHeaders() {
    return {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
        // 暴露给前端下载器读取（断点续传需要拿到总大小）
        'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges'
    };
}

// 解析单段 Range（bytes=start-end / bytes=start- / bytes=-suffix，按 size 收边）。
// 非法/空段返回 null → 按全量 200 处理；多段（含逗号）本项目下载器不发，同样落 null。
function parseRange(header, size) {
    if (!header) return null;
    const m = /^bytes=(\d*)-(\d*)$/.exec(String(header).trim());
    if (!m || (m[1] === '' && m[2] === '')) return null;
    if (m[1] === '') {
        const n = parseInt(m[2], 10);
        const length = Math.min(n, size);
        return { offset: size - length, length: length };
    }
    const start = parseInt(m[1], 10);
    const end = (m[2] === '') ? size - 1 : Math.min(parseInt(m[2], 10), size - 1);
    if (start > end) return null;
    return { offset: start, length: end - start + 1 };
}

// R2 miss 时异步预热：全量拉取一次写 R2（当前请求已走 GitHub 链路回传，不受影响）。
// head 二次检查减少并发重复拉取；put 幂等，竞态下覆盖同内容无风险。
function primeR2Cache(env, waitUntil, key, target) {
    if (!env.DOWNLOADS || !waitUntil) return;
    waitUntil((async () => {
        try {
            const head = await env.DOWNLOADS.head(key);
            if (head) return;
            const res = await fetch(target, { redirect: 'follow' });
            if (res.ok && res.body) {
                await env.DOWNLOADS.put(key, res.body, {
                    httpMetadata: { contentType: 'application/octet-stream' }
                });
                console.log('[dl] R2 预热完成: ' + key);
            } else {
                console.warn('[dl] R2 预热跳过: 上游 HTTP ' + res.status);
            }
        } catch (e) {
            console.warn('[dl] R2 预热失败(下次请求自动重试): ' + (e && e.message));
        }
    })());
}

export async function onRequestOptions() {
    return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function onRequestHead({ request, env, waitUntil }) {
    const u = new URL(request.url);
    const target = resolveTarget(u.searchParams.get('f'));
    if (!target) return new Response('forbidden', { status: 403, headers: corsHeaders() });

    // ① R2 命中：直接回大小（免回源 GitHub）
    if (env.DOWNLOADS) {
        try {
            const meta = await env.DOWNLOADS.head(target.key);
            if (meta) {
                const h = {
                    ...corsHeaders(),
                    'Content-Type': 'application/octet-stream',
                    'Content-Disposition': 'attachment; filename="' + target.fileName + '"',
                    'Accept-Ranges': 'bytes',
                    'X-Proxy-Source': 'r2-cache',
                    'Content-Length': String(meta.size)
                };
                return new Response(null, { status: 200, headers: h });
            }
        } catch (e) { /* R2 异常 → 回退 GitHub 链路 */ }
        primeR2Cache(env, waitUntil, target.key, target.url);
    }

    // ② R2 miss / 绑定缺失：回源 GitHub HEAD（v2 行为）
    const upstream = await fetch(target.url, { method: 'HEAD', redirect: 'follow' });
    const h = {
        ...corsHeaders(),
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': 'attachment; filename="' + target.fileName + '"',
        'Accept-Ranges': 'bytes',
        'X-Proxy-Source': 'github-release'
    };
    const len = upstream.headers.get('content-length');
    if (len) h['Content-Length'] = len;
    return new Response(null, { status: upstream.ok ? 200 : 502, headers: h });
}

export async function onRequestGet({ request, env, waitUntil }) {
    const u = new URL(request.url);
    const target = resolveTarget(u.searchParams.get('f'));
    if (!target) return new Response('forbidden', { status: 403, headers: corsHeaders() });

    // ① R2 缓存优先：命中直接返回（CF 内部网络，Range 原生 206）
    if (env.DOWNLOADS) {
        try {
            const meta = await env.DOWNLOADS.head(target.key);
            if (meta) {
                const r = parseRange(request.headers.get('range'), meta.size);
                // ranged get 前先算好 offset/length（越界会被 R2 拒绝），全量走无 range get
                const obj = await env.DOWNLOADS.get(target.key, r ? { range: r } : undefined);
                if (obj && obj.body) {
                    const h = {
                        ...corsHeaders(),
                        'Content-Type': 'application/octet-stream',
                        'Content-Disposition': 'attachment; filename="' + target.fileName + '"',
                        'Cache-Control': 'no-store',
                        'Accept-Ranges': 'bytes',
                        'X-Proxy-Source': 'r2-cache'
                    };
                    if (r) {
                        h['Content-Length'] = String(r.length);
                        h['Content-Range'] = 'bytes ' + r.offset + '-' + (r.offset + r.length - 1) + '/' + meta.size;
                        return new Response(obj.body, { status: 206, headers: h });
                    }
                    h['Content-Length'] = String(meta.size);
                    return new Response(obj.body, { status: 200, headers: h });
                }
            }
        } catch (e) {
            console.warn('[dl] R2 读失败(回退 GitHub 链路): ' + (e && e.message));
        }
        // miss：异步预热，当前请求不等待
        primeR2Cache(env, waitUntil, target.key, target.url);
    }

    // ② R2 miss / 绑定缺失：v2 GitHub 代理链路（透传 Range 断点续传）
    const clientRange = request.headers.get('range');
    const fetchInit = { redirect: 'follow' };
    if (clientRange) {
        fetchInit.headers = { Range: clientRange };
    }

    let upstream;
    try {
        upstream = await fetch(target.url, fetchInit);
    } catch (e) {
        return new Response('upstream error', { status: 502, headers: corsHeaders() });
    }
    // 206（Range 命中）或 200（完整下载）都放行
    if ((!upstream.ok && upstream.status !== 206) || !upstream.body) {
        return new Response('upstream ' + upstream.status, { status: 502, headers: corsHeaders() });
    }

    const h = {
        ...corsHeaders(),
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': 'attachment; filename="' + target.fileName + '"',
        'Cache-Control': 'no-store',
        'Accept-Ranges': 'bytes',
        'X-Proxy-Source': 'github-release'
    };
    // 透传长度与 Range 元信息
    const len = upstream.headers.get('content-length');
    if (len) h['Content-Length'] = len;
    const contentRange = upstream.headers.get('content-range');
    if (contentRange) h['Content-Range'] = contentRange;

    // 上游返回 206 → 原样透传 206（断点续传命中）
    if (upstream.status === 206) {
        return new Response(upstream.body, { status: 206, headers: h });
    }
    return new Response(upstream.body, { status: 200, headers: h });
}
