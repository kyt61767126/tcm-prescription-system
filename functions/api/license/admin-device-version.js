// ============================================================================
//  admin-device-version.js — 客服/平台管理员管理"设备-版本绑定" API
//
//  路由：POST /api/license/admin-device-version
//
//  认证：Bearer token（platform_admin）
//
//  请求体（action 三选一）：
//    { "action": "query",  "machineId": "06eded70..." }   → 查询单台设备绑定
//    { "action": "unbind",  "machineId": "06eded70..." }  → 解除单台设备绑定
//    { "action": "list" }                                  → 列出所有绑定（最多200条）
//
//  ★ 用途：客户需要换机/降级/紧急调整时，客服可解除某台设备的版本绑定，
//    解除后该设备可重新激活任意版本。仅总管理员可操作，操作留痕（日志）。
// ============================================================================

import { parseAuthHeader, isPlatformAdmin } from '../_lib/auth.js';
import {
    getKV, getDeviceVersion, removeDeviceVersion, listDeviceVersions
} from './_lib/license-core.js';

function corsHeaders() {
    return {
        'Access-Control-Allow-Origin': 'https://tcm-prescription-system.pages.dev',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Request-ID',
        'Access-Control-Max-Age': '86400',
        'Content-Type': 'application/json'
    };
}

function json(data, status = 200) {
    return new Response(JSON.stringify(data), { status, headers: corsHeaders() });
}

const VERSION_LABEL = { 'standard': '标准版', 'institution': '机构版' };

export async function onRequest(context) {
    const method = context.request.method;

    if (method === 'OPTIONS') {
        return new Response(null, { status: 200, headers: corsHeaders() });
    }

    if (method !== 'POST') {
        return json({ success: false, error: 'Method not allowed' }, 405);
    }

    try {
        const currentUser = await parseAuthHeader(context.request, context.env);
        if (!currentUser || !isPlatformAdmin(currentUser)) {
            return json({ success: false, error: '仅平台总管理员可管理设备版本绑定' }, 403);
        }

        const kv = getKV(context);
        if (!kv) {
            return json({ success: false, error: 'KV binding not found' }, 500);
        }

        const body = await context.request.json().catch(() => ({}));
        const action = body.action;

        if (action === 'list') {
            const bindings = await listDeviceVersions(kv, 200);
            const list = bindings.map(b => ({
                machineId: b.machineId,
                version: b.version,
                versionLabel: VERSION_LABEL[b.version] || b.version,
                licenseCode: b.licenseCode || null,
                clinicName: b.clinicName || null,
                boundAt: b.boundAt || null,
                productClass: b.productClass || null,
                clientClass: b.clientClass || null
            }));
            return json({ success: true, count: list.length, bindings: list });
        }

        if (action === 'query') {
            const machineId = String(body.machineId || '').trim();
            if (!machineId) return json({ success: false, error: '缺少 machineId' }, 400);
            const binding = await getDeviceVersion(kv, machineId);
            if (!binding || !binding.version) {
                return json({ success: true, found: false, binding: null });
            }
            return json({
                success: true,
                found: true,
                binding: {
                    machineId: binding.machineId,
                    version: binding.version,
                    versionLabel: VERSION_LABEL[binding.version] || binding.version,
                    licenseCode: binding.licenseCode || null,
                    clinicName: binding.clinicName || null,
                    boundAt: binding.boundAt || null,
                    productClass: binding.productClass || null,
                    clientClass: binding.clientClass || null
                }
            });
        }

        if (action === 'unbind') {
            const machineId = String(body.machineId || '').trim();
            if (!machineId) return json({ success: false, error: '缺少 machineId' }, 400);
            const binding = await getDeviceVersion(kv, machineId);
            const ok = await removeDeviceVersion(kv, machineId);
            return json({
                success: ok,
                removed: ok,
                machineId: machineId,
                previous: binding ? (VERSION_LABEL[binding.version] || binding.version) : null
            }, ok ? 200 : 500);
        }

        return json({ success: false, error: 'action 必须是 list/query/unbind' }, 400);
    } catch (e) {
        return json({ success: false, error: e.message || 'Internal server error' }, 500);
    }
}
