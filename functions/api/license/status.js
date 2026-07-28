// ============================================================================
//  status.js — 激活码状态查询 + 管理 API（管理员专用）+ 客户端心跳检测
//
//  路由：
//    GET  /api/license/status?code=BNZC-XXXX-XXXX-XXXX-XXXX   查询单个激活码状态
//    POST /api/license/status?action=unbind                   解绑机器 ID（允许换机）
//    POST /api/license/status?action=disable                  禁用激活码
//    POST /api/license/status?action=enable                   启用激活码
//    POST /api/license/status?action=delete                   删除激活码
//    POST /api/license/status                                 客户端心跳检测（无需认证）
//
//  认证：Bearer token（platform_admin）— 管理操作
//        无需认证 — 客户端心跳检测
// ============================================================================

import { parseAuthHeader, isPlatformAdmin } from '../_lib/auth.js';
import {
    getKV, getLicense, updateLicense, sanitizeRecord, KV_LICENSE_PREFIX, KV_LICENSE_INDEX,
    getDevices, getMaxDevices, appendLicenseLog, deleteLicenseLogs
} from './_lib/license-core.js';

function corsHeaders() {
    return {
        'Access-Control-Allow-Origin': 'https://tcm-prescription-system.pages.dev',
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

// 获取客户端 IP（用于日志记录）
function getClientIP(context) {
    return context.request.headers.get('CF-Connecting-IP') ||
           context.request.headers.get('X-Forwarded-For') ||
           context.request.headers.get('X-Real-IP') ||
           'unknown';
}

// ★ 客户端心跳检测：根据 machineId 查询授权状态，支持远程撤销
async function handleHeartbeat(kv, body) {
    const { machineId } = body;
    if (!machineId) {
        return json({ revoked: false, warning: '未提供 machineId' });
    }

    const index = (await kv.get(KV_LICENSE_INDEX, 'json')) || [];
    for (const code of index) {
        const record = await getLicense(kv, code);
        if (!record) continue;

        const devices = getDevices(record);
        const matchedDevice = devices.find(d => d.machineId === machineId);
        if (matchedDevice) {
            if (record.status === 'disabled') {
                return json({
                    revoked: true,
                    reason: '授权已被禁用，请联系客服',
                    code: code
                });
            }

            const expiresAt = record.expiresAt;
            if (expiresAt && new Date(expiresAt) < new Date()) {
                return json({
                    revoked: true,
                    reason: '授权已过期',
                    code: code
                });
            }

            return json({
                revoked: false,
                code: code,
                type: record.type,
                expiresAt: expiresAt
            });
        }
    }

    return json({ revoked: false, warning: '未找到绑定的授权记录' });
}

export async function onRequest(context) {
    const method = context.request.method;
    const url = new URL(context.request.url);

    if (method === 'OPTIONS') {
        return new Response(null, { status: 200, headers: corsHeaders() });
    }

    try {
        const kv = getKV(context);
        if (!kv) {
            return json({ success: false, error: 'KV binding not found' }, 500);
        }

        // ★ 客户端心跳检测：POST /api/license/status（无需认证）
        // ★ 注意：Request.body 是 stream 只能读一次，必须缓存供后续管理操作复用
        let postBody = null;
        if (method === 'POST') {
            postBody = await context.request.json().catch(() => ({}));
            const { action, machineId } = postBody;

            if (!action && machineId) {
                return handleHeartbeat(kv, postBody);
            }
        }

        // 管理员认证（仅管理操作需要）
        const currentUser = await parseAuthHeader(context.request, context.env);
        if (!currentUser || !isPlatformAdmin(currentUser)) {
            return json({ success: false, error: '仅平台总管理员可管理激活码' }, 403);
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
            // ★ 复用心跳检测阶段已读取的 body（Request.body 只能读一次）
            const body = postBody || await context.request.json().catch(() => ({}));
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
            let logDetail = '';

            switch (action) {
                case 'unbind':
                    // ★ v4 新增：支持指定 machineId 解绑单台设备（多设备授权场景）
                    // 不传 machineId 时解绑所有设备（向后兼容旧行为）
                    const targetMachineId = body.machineId;
                    if (targetMachineId) {
                        // 解绑单台设备：从 devices 数组中移除
                        const devices = getDevices(record);
                        let newDevices = devices.filter(d => d.machineId !== targetMachineId);
                        let matchedFullMachineId = targetMachineId;
                        // ★ 兼容 UI 截断显示：精确匹配失败时，若 machineId 以 "..." 结尾
                        //   （sanitizeRecord 返回的前8位+"..."格式），回退到前缀匹配。
                        //   前 8 位 hex 已足够在单激活码范围内唯一标识设备。
                        if (newDevices.length === devices.length && targetMachineId.endsWith('...')) {
                            const prefix = targetMachineId.slice(0, -3);  // 去掉 "..."
                            if (prefix.length >= 6) {
                                const matched = devices.find(d => d.machineId && d.machineId.startsWith(prefix));
                                if (matched) {
                                    newDevices = devices.filter(d => d !== matched);
                                    matchedFullMachineId = matched.machineId;
                                }
                            }
                        }
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
                        logDetail = `machineId=${matchedFullMachineId.substring(0, 8)}..., remaining=${newDevices.length}/${getMaxDevices(record)}`;
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
                        logDetail = 'all devices';
                    }
                    break;

                case 'disable':
                    updates = { status: 'disabled' };
                    message = '激活码已禁用';
                    logDetail = 'disabled by admin';
                    break;

                case 'enable':
                    // 启用：如果已绑定机器则恢复 used 状态，否则 unused
                    const devices = getDevices(record);
                    updates = {
                        status: devices.length > 0 ? 'used' : 'unused'
                    };
                    message = '激活码已启用';
                    logDetail = `enabled, status=${updates.status}, devices=${devices.length}`;
                    break;

                case 'delete':
                    await deleteLicense(kv, code);
                    // ★ 任务5：删除激活码时同步删除日志
                    await deleteLicenseLogs(kv, code);
                    // 删除操作无法记录日志（KV 已被删除），只能在管理员操作日志中体现
                    console.log(`[LicenseLog] 激活码 ${code} 已被 ${currentUser.username} 删除（IP: ${getClientIP(context)}）`);
                    return json({ success: true, message: '激活码已删除' });

                default:
                    return json({ success: false, error: '未知操作：' + action }, 400);
            }

            const updated = await updateLicense(kv, code, updates);
            // ★ 任务5：记录管理操作日志
            await appendLicenseLog(kv, code, {
                action: action,
                time: new Date().toISOString(),
                ip: getClientIP(context),
                operator: currentUser.username,
                detail: logDetail
            });
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
