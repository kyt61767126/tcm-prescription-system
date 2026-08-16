import { parseAuthHeader, isPlatformAdmin } from './_lib/auth.js';
import { getKV } from './_lib/kv.js';

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
        // ★ P2-A 修复：原 context.env.TCM_PRESCRIPTION_KV 未绑定导致 500，改用 _lib/kv.js 标准解析链
        const kv = getKV(context);
        if (!kv) {
            console.error('[restore] 无可用 KV 绑定');
            return new Response(JSON.stringify({
                success: false,
                error: '服务暂不可用，请稍后再试'
            }), {
                status: 503,
                headers: { 'Content-Type': 'application/json' }
            });
        }

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
        // ★ P2-C 修复：跳过备份 key 本身（旧备份可能包含 kv_backup_*，恢复会套娃写入）
        //   跳过 null 值（恢复无意义且会覆盖为 "null" 字符串）
        let restoredCount = 0;
        let skippedCount = 0;
        const errors = [];

        for (const [key, value] of Object.entries(backupData.keys)) {
            if (key.startsWith('kv_backup_') || value === null || value === undefined) {
                skippedCount++;
                continue;
            }
            try {
                await kv.put(key, JSON.stringify(value));
                restoredCount++;
            } catch (error) {
                console.error('[restore] 单key恢复失败:', key, error && error.message);
                errors.push({ key: key });
            }
        }

        // 返回恢复结果
        return new Response(JSON.stringify({
            success: true,
            message: 'KV data restore completed',
            backupKey: backupKey,
            backupTimestamp: backupData.timestamp,
            restoredCount: restoredCount,
            skippedCount: skippedCount,
            errorCount: errors.length,
            errors: errors.length > 0 ? errors : undefined
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });

    } catch (error) {
        // ★ P2-D 修复：错误详情仅记服务端日志，不向客户端泄露内部实现
        console.error('[restore] 服务器错误:', error && error.message, error);
        return new Response(JSON.stringify({
            success: false,
            error: '恢复失败，请稍后再试'
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}
