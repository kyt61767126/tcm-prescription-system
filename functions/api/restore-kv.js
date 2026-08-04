import { parseAuthHeader, isPlatformAdmin } from './_lib/auth.js';

export async function onRequest(context) {
    const url = new URL(context.request.url);
    const backupKey = url.searchParams.get('backupKey');

    // P0-1 安全修复：与 backup-kv.js 一致的双重鉴权
    const BACKUP_SECRET = context.env.BACKUP_SECRET || '';
    const providedSecret = url.searchParams.get('secret') || context.request.headers.get('X-Backup-Secret') || '';

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
    
    if (!backupKey) {
        return new Response(JSON.stringify({
            success: false,
            error: 'Missing backupKey parameter'
        }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
        });
    }
    
    try {
        const kv = context.env.TCM_PRESCRIPTION_KV;
        
        // 获取备份数据
        const backupData = await kv.get(backupKey, 'json');
        
        if (!backupData) {
            return new Response(JSON.stringify({
                success: false,
                error: 'Backup not found or expired'
            }), {
                status: 404,
                headers: { 'Content-Type': 'application/json' }
            });
        }
        
        if (!backupData.keys || typeof backupData.keys !== 'object') {
            return new Response(JSON.stringify({
                success: false,
                error: 'Invalid backup data format'
            }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
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
        
        // 返回恢复结果
        return new Response(JSON.stringify({
            success: true,
            message: 'KV data restore completed',
            backupKey: backupKey,
            backupTimestamp: backupData.timestamp,
            restoredCount: restoredCount,
            errorCount: errors.length,
            errors: errors.length > 0 ? errors : undefined
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
        
    } catch (error) {
        console.error('Restore error:', error);
        return new Response(JSON.stringify({
            success: false,
            error: error.message || 'Restore failed'
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}
