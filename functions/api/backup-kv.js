// ============================================================================
// KV 全量备份 API（安全加固版）
// ============================================================================
// 安全改进：
//   1. 密钥从环境变量 BACKUP_SECRET 读取，不再硬编码
//   2. 密钥通过 Authorization 头传递，不再通过 URL query（避免日志泄露）
//   3. KV 绑定统一走 getKV() 兼容层
//   4. 添加 CORS 支持
// ============================================================================
import { corsResponse, handleOptions, getKV } from '../_lib/auth.js';

export async function onRequest(context) {
    const { request, env } = context;

    if (request.method === 'OPTIONS') return handleOptions();

    // 密钥校验：优先从环境变量读取，通过 Authorization 头传递
    const expectedSecret = env.BACKUP_SECRET;
    if (!expectedSecret) {
        return corsResponse({
            success: false,
            error: '备份功能未配置：请在 Cloudflare Pages 设置环境变量 BACKUP_SECRET'
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

    try {
        const kv = getKV(env);
        if (!kv) {
            return corsResponse({
                success: false,
                error: 'KV存储未配置'
            }, { status: 500 });
        }

        // 获取所有数据
        const keys = await kv.list();

        const backupData = {
            timestamp: new Date().toISOString(),
            version: '1.0.0',
            keys: {}
        };

        // 遍历所有key并获取值
        for (const key of keys.keys) {
            const value = await kv.get(key.name, 'json');
            backupData.keys[key.name] = value;
        }

        // 生成带日期的备份key
        const date = new Date().toISOString().split('T')[0];
        const timestamp = Date.now();
        const backupKey = `kv_backup_${date}_${timestamp}`;

        // 保存备份
        await kv.put(backupKey, JSON.stringify(backupData));

        return corsResponse({
            success: true,
            message: 'KV data backup completed successfully',
            backupKey: backupKey,
            keysCount: keys.keys.length,
            timestamp: backupData.timestamp
        });

    } catch (error) {
        console.error('Backup error:', error);
        // 不向客户端泄露内部错误细节
        return corsResponse({
            success: false,
            error: 'Backup failed'
        }, { status: 500 });
    }
}
