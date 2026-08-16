// ============================================================================
//  admin-test-machine.js — 平台管理员管理"测试机白名单" API
//
//  路由：POST /api/license/admin-test-machine
//
//  认证：Bearer token（platform_admin）
//
//  请求体（action 三选一）：
//    { "action": "add",    "machineId": "06eded70...", "note": "本机测试" }
//    { "action": "remove", "machineId": "06eded70..." }
//    { "action": "list" }
//
//  返回：
//    add    → { success: true, testMachine: {...} }
//    remove → { success: true }
//    list   → { success: true, machines: [...] }
//
//  ★ 用途：测试电脑可自由测试标准版/机构版的注册激活流程。
//    仅在 checkDeviceVersion 中放开"一设备一版本"绑定校验，
//    客户设备不受影响，仍严格一台设备一个版本。
// ============================================================================

import { parseAuthHeader, isPlatformAdmin } from '../_lib/auth.js';
import {
    getKV, setTestMachine, removeTestMachine, listTestMachines
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

export async function onRequest(context) {
    const method = context.request.method;

    if (method === 'OPTIONS') {
        return new Response(null, { status: 200, headers: corsHeaders() });
    }

    if (method !== 'POST') {
        return json({ success: false, error: 'Method not allowed' }, 405);
    }

    try {
        // 管理员认证
        const currentUser = await parseAuthHeader(context.request, context.env);
        if (!currentUser || !isPlatformAdmin(currentUser)) {
            return json({ success: false, error: '仅平台总管理员可管理测试机' }, 403);
        }

        const kv = getKV(context);
        if (!kv) {
            return json({ success: false, error: 'KV binding not found' }, 500);
        }

        const body = await context.request.json().catch(() => ({}));
        const action = body.action;

        if (action === 'list') {
            const machines = await listTestMachines(kv);
            return json({ success: true, machines });
        }

        if (action === 'add') {
            const machineId = String(body.machineId || '').trim();
            if (!machineId) {
                return json({ success: false, error: '缺少 machineId' }, 400);
            }
            if (!/^[a-f0-9]{32}$/i.test(machineId)) {
                return json({ success: false, error: 'machineId 格式错误（应为 32 位十六进制机器码）' }, 400);
            }
            const note = String(body.note || '').slice(0, 100);
            const rec = await setTestMachine(kv, machineId, note);
            return json({ success: true, testMachine: rec });
        }

        if (action === 'remove') {
            const machineId = String(body.machineId || '').trim();
            if (!machineId) {
                return json({ success: false, error: '缺少 machineId' }, 400);
            }
            await removeTestMachine(kv, machineId);
            return json({ success: true, removed: machineId });
        }

        return json({ success: false, error: 'action 必须是 add/remove/list' }, 400);
    } catch (e) {
        return json({ success: false, error: e.message || 'Internal server error' }, 500);
    }
}
