import { parseAuthHeader, isPlatformAdmin } from './_lib/auth.js';
import { getKV, listAllKeys } from './_lib/kv.js';

export async function onRequest(context) {
    const url = new URL(context.request.url);

    // P0-1 安全修复：弃用 URL 参数 secret，改用环境变量 + Bearer Token 双重鉴权
    // 1. Bearer Token 必须为 platform_admin 角色
    // 2. 服务端密钥来自环境变量 BACKUP_SECRET（不再硬编码）
    const BACKUP_SECRET = context.env.BACKUP_SECRET || '';
    const providedSecret = url.searchParams.get('secret') || context.request.headers.get('X-Backup-Secret') || '';

    // 双重校验：必须有有效 Token 或正确的环境变量密钥
    const currentUser = await parseAuthHeader(context.request, context.env);
    const isAuthorizedPlatformAdmin = currentUser && isPlatformAdmin(currentUser);
    const isAuthorizedBySecret = BACKUP_SECRET && providedSecret && providedSecret === BACKUP_SECRET;

    if (!isAuthorizedPlatformAdmin && !isAuthorizedBySecret) {
        return new Response(JSON.stringify({
            success: false,
            error: 'Unauthorized: 需要 platform_admin Token 或正确的 BACKUP_SECRET 环境变量'
        }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' }
        });
    }
    
    try {
        // ★ P2-A 修复：原 context.env.TCM_PRESCRIPTION_KV 未在 wrangler.toml 绑定，
        //   kv 为 undefined → kv.list() 抛 TypeError → 每次调用 500（功能完全失效）。
        //   改用 _lib/kv.js 标准解析链（P2-B 单一事实源）。
        const kv = getKV(context);
        if (!kv) {
            console.error('[backup] 无可用 KV 绑定');
            return new Response(JSON.stringify({
                success: false,
                error: '服务暂不可用，请稍后再试'
            }), {
                status: 503,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // ★ P2-C 修复：分页遍历所有 key（kv.list() 每页最多 1000 个，不翻页会静默截断）
        const allKeyNames = await listAllKeys(kv);
        // ★ P2-C 修复：排除旧备份 key，防止备份雪球膨胀（备份套备份）
        const dataKeyNames = allKeyNames.filter(name => !name.startsWith('kv_backup_'));

        const backupData = {
            timestamp: new Date().toISOString(),
            version: '1.0.0',
            keys: {}
        };

        // 遍历所有key并获取值（跳过空值，避免恢复时写入无意义的 "null" 字符串）
        let skippedNull = 0;
        for (const keyName of dataKeyNames) {
            const value = await kv.get(keyName, 'json');
            if (value === null) { skippedNull++; continue; }
            backupData.keys[keyName] = value;
        }

        // 生成带日期的备份key
        const date = new Date().toISOString().split('T')[0];
        const timestamp = Date.now();
        const backupKey = `kv_backup_${date}_${timestamp}`;

        // 保存备份
        await kv.put(backupKey, JSON.stringify(backupData));

        // 返回成功响应
        return new Response(JSON.stringify({
            success: true,
            message: 'KV data backup completed successfully',
            backupKey: backupKey,
            keysCount: Object.keys(backupData.keys).length,
            totalKeysInKV: allKeyNames.length,
            skippedBackupKeys: allKeyNames.length - dataKeyNames.length,
            skippedNullValues: skippedNull,
            timestamp: backupData.timestamp
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });

    } catch (error) {
        // ★ P2-D 修复：错误详情仅记服务端日志，不向客户端泄露内部实现
        console.error('[backup] 服务器错误:', error && error.message, error);
        return new Response(JSON.stringify({
            success: false,
            error: '备份失败，请稍后再试'
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}
