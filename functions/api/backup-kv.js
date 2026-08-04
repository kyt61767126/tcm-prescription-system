// ============================================================================
//  backup-kv.js — KV 数据备份 API（platform_admin 专用）
//
//  路由：POST /api/backup-kv
//
//  鉴权（双重，任一通过即可）：
//    1. Bearer Token（platform_admin 角色）
//    2. BACKUP_SECRET 环境变量（通过 X-Backup-Secret 头或 ?secret= 参数）
//
//  ★ 2026-08-04 安全优化：
//    - 常量时间密钥比较（防时序攻击）
//    - 操作限流（每 IP 每小时最多 3 次备份，防 KV 配额耗尽）
//    - 审计日志（记录备份操作者、IP、时间、备份大小）
//    - 默认密钥检测警告
// ============================================================================

import { parseAuthHeader, isPlatformAdmin } from './_lib/auth.js';

// ★ 常量时间字符串比较（防时序攻击）
function constantTimeEqual(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    if (a.length !== b.length) return false;
    let result = 0;
    for (let i = 0; i < a.length; i++) {
        result |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return result === 0;
}

// ★ 操作限流：每 IP 每小时最多 3 次备份
const BACKUP_RATE_LIMIT_MAX = 3;
const BACKUP_RATE_LIMIT_TTL = 3600; // 1 小时（秒）

async function checkBackupRateLimit(kv, request) {
    try {
        const ip = request.headers.get('CF-Connecting-IP') ||
                   request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ||
                   'unknown';
        if (ip === 'unknown') return { allowed: true, count: 0 };
        const key = 'backup_rate:' + ip;
        const count = parseInt(await kv.get(key) || '0', 10) + 1;
        await kv.put(key, String(count), { expirationTtl: BACKUP_RATE_LIMIT_TTL });
        return { allowed: count <= BACKUP_RATE_LIMIT_MAX, count };
    } catch (e) {
        // 限流失败不阻塞业务
        return { allowed: true, count: 0 };
    }
}

// ★ 审计日志：记录备份操作
async function writeBackupAuditLog(kv, action, operator, request, extra = {}) {
    try {
        const date = new Date().toISOString().split('T')[0];
        const key = `audit_log:platform_backup:${date}`;
        const logs = (await kv.get(key, 'json')) || [];
        logs.push({
            timestamp: new Date().toISOString(),
            action: action,  // 'backup' / 'restore'
            operator: operator || 'unknown',
            ip: request?.headers?.get('CF-Connecting-IP') || 'unknown',
            userAgent: request?.headers?.get('User-Agent') || 'unknown',
            ...extra
        });
        // 保留最近 500 条
        if (logs.length > 500) logs.splice(0, logs.length - 500);
        await kv.put(key, JSON.stringify(logs), { expirationTtl: 180 * 24 * 60 * 60 }); // 保留 180 天
    } catch (e) {
        console.error('writeBackupAuditLog error:', e);
    }
}

function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json' }
    });
}

export async function onRequest(context) {
    const url = new URL(context.request.url);

    // P0-1 安全修复：弃用 URL 参数 secret，改用环境变量 + Bearer Token 双重鉴权
    // 1. Bearer Token 必须为 platform_admin 角色
    // 2. 服务端密钥来自环境变量 BACKUP_SECRET（不再硬编码）
    const BACKUP_SECRET = context.env.BACKUP_SECRET || '';
    const providedSecret = url.searchParams.get('secret') || context.request.headers.get('X-Backup-Secret') || '';

    // ★ 安全优化：检测默认/空密钥并警告
    if (!BACKUP_SECRET) {
        console.warn('[安全警告] BACKUP_SECRET 环境变量未配置，仅 Bearer Token 鉴权可用。建议在 Cloudflare Pages 后台设置 BACKUP_SECRET。');
    }

    // 双重校验：必须有有效 Token 或正确的环境变量密钥
    const currentUser = await parseAuthHeader(context.request, context.env);
    const isAuthorizedPlatformAdmin = currentUser && isPlatformAdmin(currentUser);
    // ★ 安全优化：使用常量时间比较密钥（防时序攻击），仅当 BACKUP_SECRET 已配置时生效
    const isAuthorizedBySecret = BACKUP_SECRET && providedSecret && constantTimeEqual(providedSecret, BACKUP_SECRET);

    if (!isAuthorizedPlatformAdmin && !isAuthorizedBySecret) {
        // ★ 记录未授权访问尝试
        const kv = context.env.TCM_PRESCRIPTION_KV || context.env.KV;
        if (kv) {
            await writeBackupAuditLog(kv, 'backup_unauthorized', currentUser?.username || 'anonymous', context.request, {
                reason: 'no_valid_token_or_secret'
            });
        }
        return json({
            success: false,
            error: 'Unauthorized: 需要 platform_admin Token 或正确的 BACKUP_SECRET 环境变量'
        }, 401);
    }

    // ★ 安全优化：操作限流（每 IP 每小时最多 3 次备份）
    const kv = context.env.TCM_PRESCRIPTION_KV || context.env.KV;
    if (kv) {
        const rateLimit = await checkBackupRateLimit(kv, context.request);
        if (!rateLimit.allowed) {
            return json({
                success: false,
                error: `备份操作过于频繁（本小时已执行 ${rateLimit.count} 次，上限 ${BACKUP_RATE_LIMIT_MAX} 次），请稍后再试`
            }, 429);
        }
    }

    if (!kv) {
        return json({ success: false, error: 'KV binding not found' }, 500);
    }

    try {
        // 获取所有数据
        const keys = await kv.list();

        const backupData = {
            timestamp: new Date().toISOString(),
            version: '1.0.0',
            keys: {}
        };

        // 遍历所有key并获取值
        let totalSize = 0;
        for (const key of keys.keys) {
            const value = await kv.get(key.name, 'json');
            backupData.keys[key.name] = value;
            // ★ 估算备份大小（用于审计日志）
            try {
                totalSize += JSON.stringify(value || '').length;
            } catch (e) { /* ignore */ }
        }

        // 生成带日期的备份key
        const date = new Date().toISOString().split('T')[0];
        const timestamp = Date.now();
        const backupKey = `kv_backup_${date}_${timestamp}`;

        // 保存备份
        await kv.put(backupKey, JSON.stringify(backupData));

        // ★ 记录审计日志
        await writeBackupAuditLog(kv, 'backup', currentUser?.username || 'secret_auth', context.request, {
            backupKey: backupKey,
            keysCount: keys.keys.length,
            estimatedSize: totalSize
        });

        // 返回成功响应
        return json({
            success: true,
            message: 'KV data backup completed successfully',
            backupKey: backupKey,
            keysCount: keys.keys.length,
            estimatedSize: totalSize,
            timestamp: backupData.timestamp
        });

    } catch (error) {
        console.error('Backup error:', error);
        // ★ 记录失败审计日志
        await writeBackupAuditLog(kv, 'backup_failed', currentUser?.username || 'secret_auth', context.request, {
            error: error.message
        });
        return json({
            success: false,
            error: error.message || 'Backup failed'
        }, 500);
    }
}
