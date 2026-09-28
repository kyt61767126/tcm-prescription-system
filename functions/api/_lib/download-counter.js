// ============================================================================
//  download-counter.js — 官网实际下载埋点（D1 去重计数，单一事实源）
//
//  口径：按 IP+文件+UTC自然日 去重的「下载发起次数」（估算，非完成次数——
//        Worker 流式输出 + Range 断点续传下服务端无法感知客户端是否收完）。
//
//  写入点：
//    ① functions/api/dl.js            —— CF 边缘代理 GET（R2 命中 / GitHub 回源，200|206）
//    ② functions/downloads/[[path]].js —— /downloads/ 静态直链透传
//
//  存储：D1 download_uniq（见 _lib/schema.sql）。INSERT OR IGNORE 去重，
//        HEAD 探测 / Range 分片 / 浏览器重试 / 同天多次点击均只计 1 次。
//        KV 免费版仅 1000 写/天，下载埋点必须走 D1（10 万写/天）。
//
//  隐私：仅存 sha256(CF-Connecting-IP)，不存原始 IP；任何失败静默，绝不影响下载主链路。
// ============================================================================

import { getDB } from './d1.js';

const ALLOWED_EXT = ['.exe', '.apk'];

function utcDay(ts) {
    return new Date(ts).toISOString().slice(0, 10);
}

async function sha256Hex(s) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(s)));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function clientIP(request) {
    return request.headers.get('CF-Connecting-IP')
        || request.headers.get('X-Forwarded-For')
        || request.headers.get('X-Real-IP')
        || 'unknown';
}

// 调度一次去重计数。应在「确认能成功回包」后调用（200/206），HEAD/4xx/5xx 不计数。
// waitUntil 由各 onRequest 上下文注入；缺失时退化为当前异步执行（不 await 结果）。
export function recordDownload(env, waitUntil, fileName, requestOrIP) {
    try {
        if (!fileName) return;
        const name = String(fileName).toLowerCase();
        if (!ALLOWED_EXT.some(ext => name.endsWith(ext))) return;
        const ip = typeof requestOrIP === 'string' ? requestOrIP : clientIP(requestOrIP);
        if (!ip || ip === 'unknown') return;
        const db = getDB(env);
        if (!db) return; // D1 未绑定/未启用：静默跳过（部署窗口期安全降级）

        const job = (async () => {
            try {
                const ipHash = await sha256Hex(ip);
                await db.prepare(
                    'INSERT OR IGNORE INTO download_uniq (day, file, ip_hash, ts) VALUES (?, ?, ?, ?)'
                ).bind(utcDay(Date.now()), String(fileName), ipHash, Date.now()).run();
            } catch (e) {
                console.warn('[dl-count] 计数失败(不影响下载): ' + (e && e.message));
            }
        })();

        if (typeof waitUntil === 'function') {
            waitUntil(job);
        }
        // 无 waitUntil 时 job 已在执行，刻意不 await——计数不能拖慢/阻断下载响应
    } catch (e) {
        // 埋点任何异常都不允许影响下载
    }
}
