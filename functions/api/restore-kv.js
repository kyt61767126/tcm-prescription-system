// ============================================================================
//  restore-kv.js — KV 数据恢复 API（platform_admin 专用）
//
//  路由：POST /api/restore-kv?backupKey=xxx
//
//  鉴权（双重，任一通过即可）：
//    1. Bearer Token（platform_admin 角色）
//    2. BACKUP_SECRET 环境变量（通过 X-Backup-Secret 头或 ?secret= 参数）
//
//  ★ 2026-08-04 安全优化：
//    - 常量时间密钥比较（防时序攻击）
//    - 操作限流（每 IP 每小时最多 2 次恢复，恢复是高风险操作）
//    - 审计日志（记录恢复操作者、IP、时间、恢复的 key 数量）
//    - 恢复前自动备份当前数据（防误恢复）
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

// ★ 操作限流：每 IP 每小时最多 2 次恢复（恢复是高风险操作）
const RESTORE_RATE_LIMIT_MAX = 2;
const RESTORE_RATE_LIMIT_TTL = 3600; // 1 小时（秒）

async function checkRestoreRateLimit(kv, request) {
    try {
        const ip = request.headers.get('CF-Connecting-IP') ||
                   request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ||
                   'unknown';
        if (ip === 'unknown') return { allowed: true, count: 0 };
        const key = 'restore_rate:' + ip;
        const count = parseInt(await kv.get(key) || '0', 10) + 1;
        await kv.put(key, String(count), { expirationTtl: RESTORE_RATE_LIMIT_TTL });
        return { allowed: count <= RESTORE_RATE_LIMIT_MAX, count };
    } catch (e) {
        return { allowed: true, count: 0 };
    }
}

// ★ 审计日志：记录恢复操作
async function writeRestoreAuditLog(kv, action, operator, request, extra = {}) {
    try {
        const date = new Date().toISOString().split('T')[0];
        const key = `audit_log:platform_backup:${date}`;
        const logs = (await kv.get(key, 'json')) || [];
        logs.push({
            timestamp: new Date().toISOString(),
            action: action,  // 'restore' / 'restore_pre_backup' / 'restore_unauthorized' / 'restore_failed'
            operator: operator || 'unknown',
            ip: request?.headers?.get('CF-Connecting-IP') || 'unknown',
            userAgent: request?.headers?.get('User-Agent') || 'unknown',
            ...extra
        });
        // 保留最近 500 条
        if (logs.length > 500) logs.splice(0, logs.length - 500);
        await kv.put(key, JSON.stringify(logs), { expirationTtl: 180 * 24 * 60 * 60 });
    } catch (e) {
        console.error('writeRestoreAuditLog error:', e);
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
    const backupKey = url.searchParams.get('backupKey');

    // P0-1 安全修复：与 backup-kv.js 一致的双重鉴权
    const BACKUP_SECRET = context.env.BACKUP_SECRET || '';
    const providedSecret = url.searchParams.get('secret') || context.request.headers.get('X-Backup-Secret') || '';

    // ★ 安全优化：检测默认/空密钥并警告
    if (!BACKUP_SECRET) {
        console.warn('[安全警告] BACKUP_SECRET 环境变量未配置，仅 Bearer Token 鉴权可用。建议在 Cloudflare Pages 后台设置 BACKUP_SECRET。');
    }

    const currentUser = await parseAuthHeader(context.request, context.env);
    const isAuthorizedPlatformAdmin = currentUser && isPlatformAdmin(currentUser);
    // ★ 安全优化：常量时间比较密钥
    const isAuthorizedBySecret = BACKUP_SECRET && providedSecret && constantTimeEqual(providedSecret, BACKUP_SECRET);

    const kv = context.env.TCM_PRESCRIPTION_KV || context.env.KV;

    if (!isAuthorizedPlatformAdmin && !isAuthorizedBySecret) {
        // ★ 记录未授权访问尝试
        if (kv) {
            await writeRestoreAuditLog(kv, 'restore_unauthorized', currentUser?.username || 'anonymous', context.request, {
                reason: 'no_valid_token_or_secret',
                attemptedBackupKey: backupKey || 'none'
            });
        }
        return json({
            success: false,
            error: 'Unauthorized: 需要 platform_admin Token 或正确的 BACKUP_SECRET 环境变量'
        }, 401);
    }

    if (!backupKey) {
        return json({
            success: false,
            error: 'Missing backupKey parameter'
        }, 400);
    }

    // ★ 安全优化：操作限流（每 IP 每小时最多 2 次恢复）
    if (kv) {
        const rateLimit = await checkRestoreRateLimit(kv, context.request);
        if (!rateLimit.allowed) {
            return json({
                success: false,
                error: `恢复操作过于频繁（本小时已执行 ${rateLimit.count} 次，上限 ${RESTORE_RATE_LIMIT_MAX} 次），恢复是高风险操作，请确认后稍后再试`
            }, 429);
        }
    }

    if (!kv) {
        return json({ success: false, error: 'KV binding not found' }, 500);
    }

    try {
        // 获取备份数据
        const backupData = await kv.get(backupKey, 'json');

        if (!backupData) {
            return json({
                success: false,
                error: 'Backup not found or expired'
            }, 404);
        }

        if (!backupData.keys || typeof backupData.keys !== 'object') {
            return json({
                success: false,
                error: 'Invalid backup data format'
            }, 400);
        }

        // ★ 安全优化：恢复前自动备份当前数据（防误恢复）
        try {
            const currentKeys = await kv.list();
            const preRestoreBackup = {
                timestamp: new Date().toISOString(),
                version: '1.0.0',
                reason: 'pre_restore_auto_backup',
                sourceBackupKey: backupKey,
                keys: {}
            };
            for (const k of currentKeys.keys) {
                // 跳过已有的备份 key，避免循环备份
                if (k.name.startsWith('kv_backup_')) continue;
                preRestoreBackup.keys[k.name] = await kv.get(k.name, 'json');
            }
            const preBackupKey = `kv_backup_prerestore_${Date.now()}`;
            await kv.put(preBackupKey, JSON.stringify(preRestoreBackup));
            await writeRestoreAuditLog(kv, 'restore_pre_backup', currentUser?.username || 'secret_auth', context.request, {
                preBackupKey: preBackupKey,
                sourceBackupKey: backupKey
            });
        } catch (preBackupErr) {
            console.error('[恢复前备份失败]', preBackupErr);
            // 恢复前备份失败不阻塞恢复流程，但记录警告
        }

        // 恢复所有数据
        let restoredCount = 0;
        const errors = [];

        for (const [key, value] of Object.entries(backupData.keys)) {
            try {
                await kv.put(key, JSON.stringify(value));
                restoredCount++;
            } catch (error) {
                errors.push({
                    key: key,
                    error: error.message
                });
            }
        }

        // ★ 记录恢复审计日志
        await writeRestoreAuditLog(kv, 'restore', currentUser?.username || 'secret_auth', context.request, {
            backupKey: backupKey,
            backupTimestamp: backupData.timestamp,
            restoredCount: restoredCount,
            errorCount: errors.length
        });

        // 返回恢复结果
        return json({
            success: true,
            message: 'KV data restore completed',
            backupKey: backupKey,
            backupTimestamp: backupData.timestamp,
            restoredCount: restoredCount,
            errorCount: errors.length,
            errors: errors.length > 0 ? errors : undefined
        });

    } catch (error) {
        console.error('Restore error:', error);
        await writeRestoreAuditLog(kv, 'restore_failed', currentUser?.username || 'secret_auth', context.request, {
            backupKey: backupKey,
            error: error.message
        });
        return json({
            success: false,
            error: error.message || 'Restore failed'
        }, 500);
    }
}
