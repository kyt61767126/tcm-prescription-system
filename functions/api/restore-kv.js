export async function onRequest(context) {
    const url = new URL(context.request.url);
    const secret = url.searchParams.get('secret');
    const backupKey = url.searchParams.get('backupKey');
    
    // 简单的密钥验证（生产环境应使用更安全的方式）
    if (secret !== 'tcm-backup-secret-2024') {
        return new Response(JSON.stringify({
            success: false,
            error: 'Unauthorized: Invalid secret key'
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
