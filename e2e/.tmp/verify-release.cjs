// 线上发布复验：下载页公布值 ↔ 服务端实际文件 ↔ 本地构建产物（三方对齐）
const crypto = require('crypto');
const PAGE = 'https://tcm-prescription-system.pages.dev/download';

async function hashUrl(url) {
    const r = await fetch(url);
    if (!r.ok) return { ok: false, status: r.status };
    const buf = Buffer.from(await r.arrayBuffer());
    return { ok: true, status: r.status, size: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex').toUpperCase() };
}
async function sizeUrl(url) {
    const r = await fetch(url, { headers: { Range: 'bytes=0-0' } });
    const cr = r.headers.get('content-range') || '';
    const total = cr.includes('/') ? Number(cr.split('/')[1]) : Number(r.headers.get('content-length') || 0);
    return { ok: r.ok || r.status === 206, status: r.status, size: total };
}

(async () => {
    const html = await (await fetch(PAGE)).text();
    console.log('=== 下载页公布的文件链接 ===');
    const links = [...html.matchAll(/href="([^"]+\.(?:apk|hap|exe|zip))"/gi)].map(m => m[1]);
    const uniq = [...new Set(links)];
    uniq.forEach(u => {
        const i = html.indexOf(u);
        const around = html.slice(Math.max(0, i - 400), i + 300)
            .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
        const ver = (around.match(/\d+\.\d+\.\d+(?:\.\d+)?/g) || []).join(',');
        const hash = (around.match(/\b[0-9a-fA-F]{64}\b/g) || []).map(h => h.toUpperCase());
        const size = (around.match(/[\d.]+\s*(?:MB|GB)/g) || []).join(',');
        console.log('  ' + u);
        console.log('      页面就近 version=' + (ver || '(无)') + '  size=' + (size || '(无)') + '  sha256=' + (hash.length ? hash.join(',') : '(无)'));
    });

    console.log('\n=== 服务端实际文件（实算）===');
    const base = 'https://tcm-prescription-system.pages.dev';
    const local = {
        'apk 云端': 'D:\\trae_projects\\kyt-zy\\app_project\\db-yunduan\\惠康中医-云端.apk',
        'apk 离线': 'D:\\trae_projects\\kyt-zy\\app_project\\db-offline\\惠康中医-本地.apk',
        'hap 鸿蒙': 'D:\\trae_projects\\kyt-zy\\app_project_harmony\\huikang-cloud\\huikang-cloud-release-signed.hap'
    };
    const fs = require('fs');
    for (const u of uniq) {
        const full = u.startsWith('http') ? u : base + (u.startsWith('/') ? u : '/' + u);
        const isMobile = /\.(apk|hap)$/i.test(u);
        const res = isMobile ? await hashUrl(full) : await sizeUrl(full);
        console.log('  ' + u);
        console.log('      ' + (res.ok ? 'OK' : 'HTTP ' + res.status) + '  服务端 size=' + Math.round((res.size || 0) / 1024) + 'KB' + (res.sha256 ? '  sha256=' + res.sha256 : '  (大文件未全量哈希，仅核对存在与大小)'));
    }

    console.log('\n=== 与本地构建产物比对（sha256）===');
    for (const [name, p] of Object.entries(local)) {
        if (!fs.existsSync(p)) { console.log('  ' + name + ': 本地缺失'); continue; }
        const h = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex').toUpperCase();
        const isUp = html.toUpperCase().includes(h);
        console.log('  ' + name + '  ' + h.slice(0, 16) + '…  下载页是否引用该哈希 = ' + (isUp ? '✅ 是' : '✗ 否（页面未公布或仍是旧值）'));
    }
})();
