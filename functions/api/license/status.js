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
    getKV, getLicense, updateLicense, sanitizeRecord, KV_LICENSE_PREFIX, KV_LICENSE_INDEX,
    getDevices, getMaxDevices
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
                    // ★ v4 新增：支持指定 machineId 解绑单台设备（多设备授权场景）
                    // 不传 machineId 时解绑所有设备（向后兼容旧行为）
                    const targetMachineId = body.machineId;
                    if (targetMachineId) {
                        // 解绑单台设备：从 devices 数组中移除
                        const devices = getDevices(record);
                        const newDevices = devices.filter(d => d.machineId !== targetMachineId);
                        if (newDevices.length === devices.length) {
                            return json({ success: false, error: '未找到指定的 machineId' }, 404);
                        }
                        updates = {
                            devices: newDevices,
                            maxDevices: getMaxDevices(record)
                        };
                        // 如果还有剩余设备，保持 used 状态；否则重置为 unused
                        if (newDevices.length === 0) {
                            updates.status = 'unused';
                            updates.machineId = null;
                            updates.activatedAt = null;
                            updates.activatedIp = null;
                            message = '已解绑该设备（最后一台），激活码重置为未使用';
                        } else {
                            // 更新 machineId 字段为剩余设备的第一台（向后兼容）
                            updates.machineId = newDevices[0].machineId;
                            updates.activatedAt = newDevices[0].activatedAt;
                            message = `已解绑 1 台设备，剩余 ${newDevices.length} 台`;
                        }
                    } else {
                        // 解绑所有设备（旧行为）
                        updates = {
                            status: 'unused',
                            machineId: null,
                            activatedAt: null,
                            activatedIp: null,
                            devices: [],
                            maxDevices: getMaxDevices(record)
                        };
                        message = '激活码已解绑所有设备，可重新激活';
                    }
                    break;

                case 'disable':
                    updates = { status: 'disabled' };
                    message = '激活码已禁用';
                    break;

                case 'enable':
                    // 启用：如果已绑定机器则恢复 used 状态，否则 unused
                    const devices = getDevices(record);
                    updates = {
                        status: devices.length > 0 ? 'used' : 'unused'
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
