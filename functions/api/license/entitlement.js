// ============================================================================
//  entitlement.js — 授权统一裁决端点（2026-09-07 P1 服务端收口①）
//
//  路由：POST /api/license/entitlement
//
//  设计铁律（KNOWLEDGE 条目三十六）：
//    1. 纯只读——本接口绝不写 KV（端形态上报继续走 /api/license/heartbeat，
//       裁决必须幂等/可重试/无副作用。探针 F3 断言本文件无任何写调用）。
//    2. 状态枚举唯一来源——四态只在服务端定义（ENTITLEMENT_STATES），
//       客户端只消费不自算。杜绝"服务端 activated / 客户端 trial 两头算"
//       的映射漏分支问题（历史"激活了却显示试用"根因）。
//    3. 裁决与签发分离——本接口不返回 licenseBase64；客户端丢码自愈时凭
//       返回的 licenseCode 走 /api/license/claim 领取 license.dat。
//
//  请求体：
//    { "machineId": "06eded70c88eb835...",   // 必填，schema-guard 白名单校验
//      "code": "BNZC-XXXX-XXXX-XXXX-XXXX" }  // 可选：O(1) 直查；缺省遍历索引
//                                             // （客户端丢 license.dat 自愈路径）
//
//  返回（统一契约，P2 客户端全端只消费此格式）：
//    {
//      "success": true,
//      "state": "LICENSED" | "NO_LICENSE" | "LICENSE_EXPIRED" | "LICENSE_REVOKED",
//      "edition": "institution" | "standard" | null,   // versionOf(record.type)
//      "licenseCode": "BNZC-..." | null,
//      "expiresAt": "2027-01-01T..." | null,           // null = 永久授权
//      "daysRemaining": 365 | -1,                      // -1 = 永久授权
//      "clinicName": "..." | null,
//      "maxDevices": 2, "devicesCount": 1,
//      "testMachine": false,                           // 测试机标记（客户端可
//      "serverTime": "2026-09-07T..."                  // 提示"测试模式"）
//    }
//
//  语义对齐（与现有 heartbeat.js 完全一致，不引入新判定）：
//    record.status='disabled'            → LICENSE_REVOKED
//    record.status='expired' 或到期时间过 → LICENSE_EXPIRED
//    record.status='unused' 或设备不匹配  → NO_LICENSE（未激活的码不算授权）
//    其余（used + 设备在绑定列表）        → LICENSED
//    expiresAt 为空                       → 永久（daysRemaining=-1，heartbeat 同款）
//
//  与老接口关系（P1 过渡期，老客户端零影响）：
//    status.js(POST 心跳) / heartbeat.js / validate.js 原样保留；
//    本接口是新增聚合视图，P2 客户端逐端切换后老接口逐个退役。
// ============================================================================

import {
    getKV, getLicense, getDevices, getMaxDevices, versionOf,
    isTestMachine, checkRateLimit, KV_LICENSE_INDEX
} from './_lib/license-core.js';
import { isValidMachineId } from './_lib/schema-guard.js';

// ★ 授权状态四态枚举——全项目（服务端+五端客户端）唯一权威定义。
//   客户端 UI 状态（试用中/试用过期/已激活/已过期/被撤销）= 本枚举 + 客户端
//   本地试用计时（离线版）的合成结果，合成规则只写一份（P2 auth-core 收口点）。
export const ENTITLEMENT_STATES = Object.freeze({
    LICENSED: 'LICENSED',               // 该设备有有效授权
    NO_LICENSE: 'NO_LICENSE',           // 该设备无任何授权记录
    LICENSE_EXPIRED: 'LICENSE_EXPIRED', // 授权已到期
    LICENSE_REVOKED: 'LICENSE_REVOKED'  // 授权被禁用（远程撤销）
});

// ★ P2 安全同款：收紧 CORS，仅允许合法 Origin
const ALLOWED_ORIGINS = [
    'https://tcm-prescription-system.pages.dev',
    'capacitor://localhost',
    'ionic://localhost',
    'http://localhost',
    'https://localhost',
    'http://localhost:3000',
    'http://localhost:5173',
    'http://localhost:8080',
    'http://127.0.0.1',
    'https://127.0.0.1'
];
let _currentRequest = null;

function corsHeaders() {
    const origin = _currentRequest ? (_currentRequest.headers.get('Origin') || '') : '';
    const allowedOrigin = (origin && ALLOWED_ORIGINS.includes(origin)) ? origin : 'https://tcm-prescription-system.pages.dev';
    return {
        'Access-Control-Allow-Origin': allowedOrigin,
        'Vary': 'Origin',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Request-ID',
        'Access-Control-Max-Age': '86400',
        'Content-Type': 'application/json'
    };
}

function json(data, status = 200) {
    return new Response(JSON.stringify(data), { status, headers: corsHeaders() });
}

function getClientIP(context) {
    return context.request.headers.get('CF-Connecting-IP') ||
           context.request.headers.get('X-Forwarded-For') ||
           context.request.headers.get('X-Real-IP') ||
           'unknown';
}

// 裁决核心（纯只读）：按 code 直查或按 machineId 遍历索引，返回统一契约
async function adjudicate(kv, machineId, code) {
    const now = new Date();
    let record = null;

    if (code) {
        // 快路径：客户端带码直查（正常路径 O(1)）
        const r = await getLicense(kv, code);
        if (r && getDevices(r).some(d => d.machineId === machineId)) {
            record = r;
        }
    } else {
        // 自愈路径：客户端丢 license.dat，按 machineId 遍历索引找回绑定
        // （与 status.js handleHeartbeat 同模式；正序首个命中，语义一致）
        const index = (await kv.get(KV_LICENSE_INDEX, 'json')) || [];
        for (const c of index) {
            const r = await getLicense(kv, c);
            if (!r) continue;
            if (getDevices(r).some(d => d.machineId === machineId)) { record = r; break; }
        }
    }

    // 测试机标记（客户端可提示"测试模式"；纯读，不写绑定）
    let testMachine = false;
    try { testMachine = await isTestMachine(kv, machineId); } catch (_) {}

    const base = {
        edition: null,
        licenseCode: null,
        expiresAt: null,
        daysRemaining: 0,
        clinicName: null,
        maxDevices: 0,
        devicesCount: 0,
        testMachine
    };

    if (!record) {
        // 无记录 / 码不存在 / 设备不在此码绑定列表 / 码未激活
        return { state: ENTITLEMENT_STATES.NO_LICENSE, ...base, licenseCode: code || null };
    }

    const devices = getDevices(record);
    const maxDevices = getMaxDevices(record);

    if (record.status === 'disabled') {
        return { state: ENTITLEMENT_STATES.LICENSE_REVOKED, ...base,
                 licenseCode: record.code || code, edition: versionOf(record.type),
                 expiresAt: record.expiresAt || null, clinicName: record.clinicName || record.activatedClinicName || null,
                 maxDevices, devicesCount: devices.length };
    }

    if (record.status === 'unused') {
        // 未激活的码不算授权（与 heartbeat.js L140-146 语义一致）
        return { state: ENTITLEMENT_STATES.NO_LICENSE, ...base, licenseCode: code || record.code || null };
    }

    // 过期判定（status='expired' 或到期时间已过；expiresAt 为空 = 永久不过期）
    if (record.status === 'expired' ||
        (record.expiresAt && new Date(record.expiresAt) < now)) {
        return { state: ENTITLEMENT_STATES.LICENSE_EXPIRED, ...base,
                 licenseCode: record.code || code, edition: versionOf(record.type),
                 expiresAt: record.expiresAt || null, daysRemaining: 0,
                 clinicName: record.clinicName || record.activatedClinicName || null,
                 maxDevices, devicesCount: devices.length };
    }

    // LICENSED：有效授权
    const daysRemaining = record.expiresAt
        ? Math.ceil((new Date(record.expiresAt) - now) / (24 * 60 * 60 * 1000))
        : -1;  // 永久授权（heartbeat.js 同款语义）

    return {
        state: ENTITLEMENT_STATES.LICENSED,
        edition: versionOf(record.type),
        licenseCode: record.code || code,
        expiresAt: record.expiresAt || null,
        daysRemaining,
        clinicName: record.clinicName || record.activatedClinicName || null,
        maxDevices,
        devicesCount: devices.length,
        testMachine
    };
}

export async function onRequest(context) {
    _currentRequest = context.request;  // CORS 动态检查
    const method = context.request.method;

    if (method === 'OPTIONS') {
        return new Response(null, { status: 200, headers: corsHeaders() });
    }

    if (method !== 'POST') {
        return json({ success: false, error: 'Method not allowed' }, 405);
    }

    try {
        const kv = getKV(context);
        if (!kv) {
            return json({ success: false, error: 'KV binding not found' }, 500);
        }

        // 速率限制：每 IP 每小时 60 次（启动 1 次 + 24h 轮询，远宽裕）
        const ip = getClientIP(context);
        const rateOk = await checkRateLimit(kv, `ent_${ip}`, 60);
        if (!rateOk.allowed) {
            return json({ success: false, error: '请求过于频繁，请稍后再试' }, 429);
        }

        const body = await context.request.json().catch(() => ({}));
        const machineId = String(body.machineId || '').trim();
        const code = body.code ? String(body.code).trim().toUpperCase() : '';

        // 参数校验：machineId 必填 + schema-guard 白名单
        // （垃圾 machineId 在门口就拒——与客户端 normalizeMachineIdResult 同规则）
        if (!machineId) {
            return json({ success: false, error: '缺少 machineId' }, 400);
        }
        if (!isValidMachineId(machineId)) {
            return json({ success: false, error: '机器 ID 格式错误' }, 400);
        }

        const result = await adjudicate(kv, machineId, code);
        return json({
            success: true,
            ...result,
            serverTime: new Date().toISOString()
        });

    } catch (error) {
        console.error('[entitlement] error:', error);
        return json({ success: false, error: '服务器内部错误，请稍后再试' }, 500);
    }
}
