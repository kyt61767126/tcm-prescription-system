// ============================================================================
// 下载代理：/api/dl?f=<github-release-url>
//
// 背景（2026-08-31）：国内网络直连 GitHub Release（release-assets.githubusercontent.com）
// 实测仅 ~0.14 MB/s，75MB 安装包常被浏览器中断报"无法下载 - 网络问题"。
// 本函数把下载走 Cloudflare 边缘中转（用户→Cloudflare→GitHub），与官网同域。
//
// 安全约束：
//   ① 仅放行本仓库 kyt61767126/tcm-prescription-system 的 /releases/download/ 资产，
//     拒绝任意 URL 代理（防开放代理滥用/SSRF）。
//   ② 文件完整性由官网页面展示的 SHA-256 值兜底（代理不改内容，流式透传）。
// ============================================================================

const REPO_BASE = 'https://github.com/kyt61767126/tcm-prescription-system/releases/download/';
const ASSET_RE = /^https:\/\/github\.com\/kyt61767126\/tcm-prescription-system\/releases\/download\/[^/?#]+\/[^/?#]+$/;

function resolveTarget(raw) {
    if (!raw) return null;
    let t = String(raw);
    if (t.startsWith('/')) t = 'https://github.com' + t;
    if (!ASSET_RE.test(t)) return null;
    return t;
}

function corsHeaders() {
    return {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS'
    };
}

export async function onRequestOptions() {
    return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function onRequestHead({ request }) {
    const u = new URL(request.url);
    const target = resolveTarget(u.searchParams.get('f'));
    if (!target) return new Response('forbidden', { status: 403, headers: corsHeaders() });
    const upstream = await fetch(target, { method: 'HEAD', redirect: 'follow' });
    const h = {
        ...corsHeaders(),
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': 'attachment; filename="' + target.split('/').pop() + '"'
    };
    const len = upstream.headers.get('content-length');
    if (len) h['Content-Length'] = len;
    return new Response(null, { status: upstream.ok ? 200 : 502, headers: h });
}

export async function onRequestGet({ request }) {
    const u = new URL(request.url);
    const target = resolveTarget(u.searchParams.get('f'));
    if (!target) return new Response('forbidden', { status: 403, headers: corsHeaders() });

    let upstream;
    try {
        upstream = await fetch(target, { redirect: 'follow' });
    } catch (e) {
        return new Response('upstream error', { status: 502, headers: corsHeaders() });
    }
    if (!upstream.ok || !upstream.body) {
        return new Response('upstream ' + upstream.status, { status: 502, headers: corsHeaders() });
    }

    const fileName = target.split('/').pop();
    const h = {
        ...corsHeaders(),
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': 'attachment; filename="' + fileName + '"',
        'Cache-Control': 'no-store',
        'X-Proxy-Source': 'github-release'
    };
    const len = upstream.headers.get('content-length');
    if (len) h['Content-Length'] = len;

    return new Response(upstream.body, { status: 200, headers: h });
}
