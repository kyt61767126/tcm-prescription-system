// ============================================================================
//  status.js — 激活码状态查询 + 管理 API（管理员专用）
//
//  路由：
//    GET  /api/license/status?code=BNZC-XXXX-XXXX-XXXX-XXXX   查询单个激活码状态
//    POST /api/license/status?action=unbind                   解绑机器 ID（允许换机）
//    POST /api/license/status?action=disable                  禁用激活码
//    POST /api/license/status?action=enable                   启用激活码
//    POST /api/license/status?action=delete                   删除激活码
//
//  认证：Bearer token（platform_admin）
// ============================================================================

import { parseAuthHeader, isPlatformAdmin } from '../_lib/auth.js';
import {
    getKV, getLicense, updateLicense, sanitizeRecord, KV_LICENSE_PREFIX, KV_LICENSE_INDEX
} from './_lib/license-core.js';

function corsHeaders() {
    return {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Request-ID',
        'Access-Control-Max-Age': '86400',
        'Content-Type': 'application/json'
    };
}

function json(data, status = 200) {
    return new Response(JSON.stringify(data), { status, headers: corsHeaders() });
}

// 删除激活码（从 KV 和索引中移除）
async function deleteLicense(kv, code) {
    const key = KV_LICENSE_PREFIX + code;
    await kv.delete(key);

    // 从索引中移除
    const index = (await kv.get(KV_LICENSE_INDEX, 'json')) || [];
    const newIndex = index.filter(c => c !== code);
    if (newIndex.length !== index.length) {
        await kv.put(KV_LICENSE_INDEX, JSON.stringify(newIndex));
    }
}

export async function onRequest(context) {
    const method = context.request.method;
    const url = new URL(context.request.url);

    if (method === 'OPTIONS') {
        return new Response(null, { status: 200, headers: corsHeaders() });
    }

    try {
        // 管理员认证
        const currentUser = await parseAuthHeader(context.request, context.env);
        if (!currentUser || !isPlatformAdmin(currentUser)) {
            return json({ success: false, error: '仅平台总管理员可管理激活码' }, 403);
        }

        const kv = getKV(context);
        if (!kv) {
            return json({ success: false, error: 'KV binding not found' }, 500);
        }

        // ===== GET：查询单个激活码状态 =====
        if (method === 'GET') {
            const code = url.searchParams.get('code');
            if (!code) {
                return json({ success: false, error: '请提供 code 参数' }, 400);
            }
            const record = await getLicense(kv, code);
            if (!record) {
                return json({ success: false, error: '激活码不存在' }, 404);
            }
            return json({ success: true, data: sanitizeRecord(record) });
        }

        // ===== POST：管理操作 =====
        if (method === 'POST') {
            const body = await context.request.json().catch(() => ({}));
            const { code, action } = body;

            if (!code || !action) {
                return json({ success: false, error: '请提供 code 和 action' }, 400);
            }

            const record = await getLicense(kv, code);
            if (!record) {
                return json({ success: false, error: '激活码不存在' }, 404);
            }

            let updates = {};
            let message = '';

            switch (action) {
                case 'unbind':
                    // 解绑机器 ID，重置为未使用
                    updates = {
                        status: 'unused',
                        machineId: null,
                        activatedAt: null,
                        activatedIp: null
                    };
                    message = '激活码已解绑，可重新激活';
                    break;

                case 'disable':
                    updates = { status: 'disabled' };
                    message = '激活码已禁用';
                    break;

                case 'enable':
                    // 启用：如果已绑定机器则恢复 used 状态，否则 unused
                    updates = {
                        status: record.machineId ? 'used' : 'unused'
                    };
                    message = '激活码已启用';
                    break;

                case 'delete':
                    await deleteLicense(kv, code);
                    return json({ success: true, message: '激活码已删除' });

                default:
                    return json({ success: false, error: '未知操作：' + action }, 400);
            }

            const updated = await updateLicense(kv, code, updates);
            return json({
                success: true,
                message: message,
                data: sanitizeRecord(updated)
            });
        }

        return json({ success: false, error: 'Method not allowed' }, 405);

    } catch (error) {
        console.error('License status error:', error);
        return json({ success: false, error: error.message || 'Internal server error' }, 500);
    }
}
