// ============================================================================
//  admin-device-version.js — 客服/平台管理员管理"设备-版本绑定" API
//
//  路由：POST /api/license/admin-device-version
//
//  认证：Bearer token（platform_admin 或 C批新增 service 客服；客服视图 machineId 脱敏）
//
//  请求体（action 三选一）：
//    { "action": "query",  "machineId": "06eded70..." }   → 查询单台设备绑定
//    { "action": "unbind",  "machineId": "06eded70..." }  → 解除单台设备绑定
//    { "action": "list" }                                  → 列出所有绑定（最多200条）
//
//  ★ 用途：客户需要换机/降级/紧急调整时，客服可解除某台设备的版本绑定，
//    解除后该设备可重新激活任意版本。管理员/客服均可操作，操作双轨留痕
//    （平台审计 writeAuditLog + 命中码的 appendLicenseLog）。
// ============================================================================

import { parseAuthHeader, isStaff, isService } from '../_lib/auth.js';
import {
    getKV, getDeviceVersion, removeDeviceVersion, listDeviceVersions, appendLicenseLog
} from './_lib/license-core.js';
// ★ 2026-09-24 C批：unbind 下放给客服，必须补平台级审计（原实现仅 console.log）
import { writeAuditLog } from '../_lib/audit-log.js';
// ★ C批双审：machineId 白名单统一走 schema-guard 单一副本（8-64，与 setDeviceVersion 同口径）
import { isValidMachineId } from './_lib/schema-guard.js';

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

// ★ C批：客服视图脱敏（与工单列表一致 6+6；管理员仍看全量，供线下核对）
function maybeMask(id, maskIt) {
    if (!maskIt || !id) return id;
    return id.length <= 12 ? id.replace(/./g, '•') : id.slice(0, 6) + '••••' + id.slice(-6);
}

export async function onRequest(context) {
    const method = context.request.method;

    if (method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: corsHeaders() });
    }

    if (method !== 'POST') {
        return json({ success: false, error: 'Method not allowed' }, 405);
    }

    try {
        const currentUser = await parseAuthHeader(context.request, context.env);
        if (!currentUser || !isStaff(currentUser)) {
            return json({ success: false, error: '仅平台员工（管理员/客服）可管理设备版本绑定' }, 403);
        }
        // 客服看到的 machineId 一律脱敏；其解绑动作凭客户提供的完整 machineId 执行
        const callerIsService = isService(currentUser);
        const ip = context.request.headers.get('CF-Connecting-IP') ||
            context.request.headers.get('X-Forwarded-For') || 'unknown';

        const kv = getKV(context);
        if (!kv) {
            return json({ success: false, error: 'KV binding not found' }, 500);
        }

        const body = await context.request.json().catch(() => ({}));
        const action = body.action;

        if (action === 'list') {
            const bindings = await listDeviceVersions(kv, 200);
            const list = bindings.map(b => ({
                machineId: maybeMask(b.machineId, callerIsService),
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
            if (!isValidMachineId(machineId)) return json({ success: false, error: 'machineId 格式无效' }, 400);
            const binding = await getDeviceVersion(kv, machineId);
            if (!binding || !binding.version) {
                return json({ success: true, found: false, binding: null });
            }
            return json({
                success: true,
                found: true,
                binding: {
                    machineId: maybeMask(binding.machineId, callerIsService),
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
            if (!isValidMachineId(machineId)) return json({ success: false, error: 'machineId 格式无效' }, 400);
            const binding = await getDeviceVersion(kv, machineId);
            const ok = await removeDeviceVersion(kv, machineId);

            // ★ C批：双轨留痕——平台级审计（按操作人，无论命中与否）+
            //   命中绑定时追加到该激活码 license 日志（与 auto-unbind 同流可查）。
            const auditExtra = {
                hit: !!binding,
                version: binding ? (binding.version || null) : null,
                licenseCode: binding ? (binding.licenseCode || null) : null,
                clinicName: binding ? (binding.clinicName || null) : null,
                machineIdHint: machineId.slice(0, 8)
            };
            context.waitUntil(writeAuditLog(kv, null, currentUser.username, currentUser.role,
                'device_unbind', machineId.slice(0, 8) + '…', context, auditExtra));
            if (ok && binding && binding.licenseCode) {
                context.waitUntil(appendLicenseLog(kv, binding.licenseCode, {
                    action: 'admin-device-unbind',
                    time: new Date().toISOString(),
                    ip,
                    operator: currentUser.username,
                    detail: `[admin-device] ${currentUser.role} 解绑设备 ${machineId.slice(0, 8)}...` +
                        `（version=${binding.version || '-'}）`
                }).catch(() => {}));
            }

            return json({
                success: ok,
                removed: ok,
                machineId: maybeMask(machineId, callerIsService),
                previous: binding ? (VERSION_LABEL[binding.version] || binding.version) : null
            }, ok ? 200 : 500);
        }

        return json({ success: false, error: 'action 必须是 list/query/unbind' }, 400);
    } catch (e) {
        return json({ success: false, error: e.message || 'Internal server error' }, 500);
    }
}
