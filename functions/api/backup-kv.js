import { parseAuthHeader, isPlatformAdmin } from './_lib/auth.js';

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
        const kv = context.env.TCM_PRESCRIPTION_KV;
        
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
        
        // 返回成功响应
        return new Response(JSON.stringify({
            success: true,
            message: 'KV data backup completed successfully',
            backupKey: backupKey,
            keysCount: keys.keys.length,
            timestamp: backupData.timestamp
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
        
    } catch (error) {
        console.error('Backup error:', error);
        return new Response(JSON.stringify({
            success: false,
            error: error.message || 'Backup failed'
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}
