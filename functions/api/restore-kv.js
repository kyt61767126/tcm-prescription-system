// ============================================================================
// KV 恢复 API（安全加固版）
// ============================================================================
// 安全改进：
//   1. 密钥从环境变量 BACKUP_SECRET 读取，不再硬编码
//   2. 密钥通过 Authorization 头传递，不再通过 URL query
//   3. KV 绑定统一走 getKV() 兼容层
//   4. 添加 CORS 支持
//   5. backupKey 仍通过 query 传递（非敏感信息）
// ============================================================================
import { corsResponse, handleOptions, getKV } from '../_lib/auth.js';

export async function onRequest(context) {
    const { request, env } = context;
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') return handleOptions();

    // 密钥校验：从环境变量读取，通过 Authorization 头传递
    const expectedSecret = env.BACKUP_SECRET;
    if (!expectedSecret) {
        return corsResponse({
            success: false,
            error: '恢复功能未配置：请在 Cloudflare Pages 设置环境变量 BACKUP_SECRET'
        }, { status: 503 });
    }

    const authHeader = request.headers.get('Authorization') || '';
    const providedSecret = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (providedSecret !== expectedSecret) {
        return corsResponse({
            success: false,
            error: 'Unauthorized: Invalid secret key'
        }, { status: 401 });
    }

    const backupKey = url.searchParams.get('backupKey');
    if (!backupKey) {
        return corsResponse({
            success: false,
            error: 'Missing backupKey parameter'
        }, { status: 400 });
    }

    try {
        const kv = getKV(env);
        if (!kv) {
            return corsResponse({
                success: false,
                error: 'KV存储未配置'
            }, { status: 500 });
        }

        // 获取备份数据
        const backupData = await kv.get(backupKey, 'json');

        if (!backupData) {
            return corsResponse({
                success: false,
                error: 'Backup not found or expired'
            }, { status: 404 });
        }

        if (!backupData.keys || typeof backupData.keys !== 'object') {
            return corsResponse({
                success: false,
                error: 'Invalid backup data format'
            }, { status: 400 });
        }

        // 恢复所有数据
        let restoredCount = 0;
        const errors = [];

        for (const [key, value] of Object.entries(backupData.keys)) {
            try {
                await kv.put(key, JSON.stringify(value));
                restoredCount++;
            } catch (error) {
                errors.push({ key: key, error: 'restore_failed' });
            }
        }

        return corsResponse({
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
        // 不向客户端泄露内部错误细节
        return corsResponse({
            success: false,
            error: 'Restore failed'
        }, { status: 500 });
    }
}
