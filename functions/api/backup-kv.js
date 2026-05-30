export async function onRequest(context) {
    const url = new URL(context.request.url);
    const secret = url.searchParams.get('secret');
    
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
