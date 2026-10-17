// 线上发布复验（二）：找下载页真实数据源，比对线上文件 ↔ 本地构建产物
const crypto = require('crypto'); const fs = require('fs');
const BASE = 'https://tcm-prescription-system.pages.dev';
const SHA = (b) => crypto.createHash('sha256').update(b).digest('hex').toUpperCase();

async function get(url) { const r = await fetch(url, { redirect: 'follow' }); return { r, t: await r.text() }; }
async function probe(url) {
    const r = await fetch(url, { headers: { Range: 'bytes=0-0' } });
    const cr = r.headers.get('content-range') || '';
    const size = cr.includes('/') ? Number(cr.split('/')[1]) : Number(r.headers.get('content-length') || 0);
    return { status: r.status, size };
}
async function hashLive(url) {
    const r = await fetch(url);
    if (!r.ok) return null;
    return { size: 0, sha: SHA(Buffer.from(await r.arrayBuffer())) };
}

(async () => {
    const { t: html } = await get(BASE + '/download');
    console.log('=== 页面里引用的 json / downloads 路径 ===');
    const jsons = [...new Set([...html.matchAll(/["'`]([^"'`]*\.json[^"'`]*)["'`]/g)].map(m => m[1]))];
    const dls = [...new Set([...html.matchAll(/["'`]([^"'`]*downloads\/[^"'`]*)["'`]/g)].map(m => m[1]))];
    jsons.slice(0, 8).forEach(u => console.log('  json: ' + u));
    dls.slice(0, 10).forEach(u => console.log('  下载路径: ' + u));

    console.log('\n=== 线上 json 内容（公布值）===');
    for (const j of jsons.slice(0, 4)) {
        const url = j.startsWith('http') ? j : BASE + (j.startsWith('/') ? j : '/' + j);
        try {
            const { r, t } = await get(url);
            if (!r.ok) { console.log('  ' + j + ' → HTTP ' + r.status); continue; }
            console.log('  ' + j + ' → ' + t.replace(/\s+/g, ' ').slice(0, 700));
        } catch (e) { console.log('  ' + j + ' → ' + e.message); }
    }

    console.log('\n=== 线上 APK 实算 sha256（对比本地构建产物）===');
    const local = {
        '云端 APK(319)': ['app_project/db-yunduan/惠康中医-云端.apk', 'public/downloads/惠康中医-云端.apk'],
        '离线 APK(317)': ['app_project/db-offline/惠康中医-本地.apk', 'public/downloads/惠康中医-本地.apk']
    };
    for (const [name, [dist, pub]] of Object.entries(local)) {
        const lh = fs.existsSync(dist) ? SHA(fs.readFileSync(dist)) : '(无)';
        const ph = fs.existsSync(pub) ? SHA(fs.readFileSync(pub)) : '(无)';
        const url = BASE + '/downloads/' + encodeURIComponent(require('path').basename(pub));
        const live = await hashLive(url).catch(() => null);
        console.log('  ' + name);
        console.log('      dist   ' + lh.slice(0, 24) + '…');
        console.log('      本地发布集 ' + (ph === '(无)' ? '(无)' : ph.slice(0, 24) + '…') + '   与 dist 一致=' + (ph === lh ? '✅' : '✗'));
        console.log('      线上 ' + (live ? live.sha.slice(0, 24) + '…   与 dist 一致=' + (live.sha === lh ? '✅' : '✗') + '   size=' + Math.round(live.size / 1024) + 'KB' : '(取不到)'));
    }

    console.log('\n=== 线上桌面安装包（页面/发布集里的 .exe 实际大小）===');
    for (const n of ['惠康中医-本地 Setup 1.0.226.exe', '惠康中医-本地 Setup 1.0.273.exe', '惠康中医-云端 Setup 1.2.169.exe', '惠康中医-云端 Setup 1.2.267.exe']) {
        const p = await probe(BASE + '/downloads/' + encodeURIComponent(n)).catch(() => null);
        console.log('  ' + n.padEnd(38) + (p && p.status !== 404 ? 'HTTP ' + p.status + '  ' + Math.round(p.size / 1048576 * 100) / 100 + 'MB' : '404 不存在'));
    }
})();
