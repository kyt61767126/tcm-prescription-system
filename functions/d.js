// Cloudflare Pages Function: /d → 302 跳转到官方下载页（淘宝发货卡片用短链接，二维码更清晰）
export async function onRequest(context) {
    const url = new URL('/download', context.request.url);
    return Response.redirect(url.toString(), 302);
}
