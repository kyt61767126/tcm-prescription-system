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
    isTestMachine, checkRateLimit, findLicensesByMachine, getDeviceBlock, LICENSE_TYPE_CONFIG,
    getAccountTombstone
} from './_lib/license-core.js';
import { isValidMachineId } from './_lib/schema-guard.js';
import {
    getAttestationConfig,
    getDeviceRegistration,
    issueProofNonce,
    consumeProofNonce,
    verifyProof
} from './_lib/attestation-core.js';

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
    // ★ 2026-09-23：file:// 渲染端（桌面 loadFile/旧主进程缺失 IPC 时的兜底）
    //   Origin 恒为字符串 "null"——与 admin-submit/order-submit 同口径放行，
    //   否则预检失败、在线裁决在桌面端永不执行。
    let allowedOrigin;
    if (origin === 'null') allowedOrigin = 'null';
    else allowedOrigin = (origin && ALLOWED_ORIGINS.includes(origin)) ? origin : 'https://tcm-prescription-system.pages.dev';
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
        // 自愈路径：客户端丢 license.dat，按 machineId 反查找回绑定。
        // ★ P2-5：mid 派生索引 O(1)（旧实现遍历全量码索引，登录闸门高频路径）。
        //   readOnly：裁决纯只读铁律（E1），不回填/不清键，零业务写；索引缺失时
        //   退化为全扫（旧行为），由心跳/激活等写路径自然完成回填，首个命中语义不变。
        const hits = await findLicensesByMachine(kv, machineId, { readOnly: true });
        record = hits[0] || null;
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

    // ★ 2026-09-17 语音版：LICENSED 响应透传 features（服务端权威下发，
    //   客户端语音入口只信此字段，不信任本地版本号/可伪造标记）
    const typeConfig = LICENSE_TYPE_CONFIG[record.type] || {};
    const features = record.features || typeConfig.features || [];

    return {
        state: ENTITLEMENT_STATES.LICENSED,
        edition: versionOf(record.type),
        licenseCode: record.code || code,
        expiresAt: record.expiresAt || null,
        daysRemaining,
        clinicName: record.clinicName || record.activatedClinicName || null,
        maxDevices,
        devicesCount: devices.length,
        features,
        testMachine
    };
}

// ============================================================================
//  P3-B：设备证明门（仅 platform:'android' 客户端启用；桌面/云端零影响）
//
//  observe（默认）：门只观测不拦——canSign 恒 true，缺证明只标记 proofState +
//    下发 nonce 引导客户端补签（用于切 enforce 前的全网 telemetry）。
//  enforce：未登记 → needAttestation（不签 token）；已登记无 proof → needProof +
//    一次性 nonce（不签）；proof 验签失败 → 拒签并重新下发 nonce。
//
//  注意：本函数可能写 KV（issueProofNonce 落 10min 短 TTL 键）。adjudicate 仍
//    严格纯只读；写操作只发生在裁决之后的证明门，且键全部自带 TTL 自清理。
// ============================================================================
async function attestationGate(kv, machineId, body, result, config, accountState) {
    const out = {
        canSign: true,
        needProof: false,
        needAttestation: false,
        proofState: null,
        proofJti: null,
        proofNonceB64: null
    };

    // 仅 Android 客户端（显式 platform）且裁决 LICENSED 且无账号墓碑时启用
    if (String(body.platform || '') !== 'android') return out;
    if (result.state !== ENTITLEMENT_STATES.LICENSED || accountState) return out;

    const enforce = config.mode === 'enforce';
    const reg = await getDeviceRegistration(kv, machineId);
    const proof = (body.proof && typeof body.proof === 'object') ? body.proof : null;

    // ① 未登记
    if (!reg) {
        out.needAttestation = true;
        out.proofState = 'unregistered';
        out.canSign = !enforce;
        return out;
    }

    // ② 带 proof：消费一次性 nonce → kid 一致 → POP 验签
    if (proof) {
        let valid = false;
        try {
            const consumed = await consumeProofNonce(kv, String(proof.jti || ''));
            if (consumed && consumed.mid === machineId
                && String(proof.kid || '') === String(reg.kid || '')) {
                valid = await verifyProof({
                    spkiB64: reg.pub,
                    mid: machineId,
                    nonce: consumed.nonce,
                    sigB64: String(proof.sig || '')
                });
            }
        } catch (e) {
            console.warn('[entitlement] proof 校验异常（按失败处理）:', e && e.message);
        }

        if (valid) {
            out.proofState = 'verified';
            return out;  // canSign=true
        }

        out.proofState = 'invalid';
        if (enforce) {
            const n = await issueProofNonce(kv, machineId);
            if (n.jti) {
                out.needProof = true;
                out.proofJti = n.jti;
                out.proofNonceB64 = n.nonce;
            }
            out.canSign = false;
        }
        return out;  // observe：验签失败也放行（仅标记）
    }

    // ③ 无 proof：签发一次性 nonce 引导补签
    const n = await issueProofNonce(kv, machineId);
    if (n.jti) {
        out.needProof = true;
        out.proofJti = n.jti;
        out.proofNonceB64 = n.nonce;
    }
    out.proofState = 'missing';
    out.canSign = !enforce;
    return out;
}

// ============================================================================
//  P3-A：Gate Token 签名（ES256 / EC P-256）
//  服务端裁决放行态时签发短周期 token，客户端内置公钥离线验签（见 offline.js）。
//  私钥仅从环境变量读取：GATE_SIGN_P8_B64=PKCS#8 DER base64（CF secret，不入库）；
//  GATE_SIGN_KID（默认 v1）支持密钥轮换；GATE_TOKEN_TTL_HOURS（默认 48）。
// ============================================================================

let _gateSignKeyCache = null;  // { p8, key }（key 为已 import 的 CryptoKey）

function b64urlFromBytes(u8) {
    let bin = '';
    for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlFromStr(str) {
    return b64urlFromBytes(new TextEncoder().encode(str));
}

async function getGateSigningKey(p8b64) {
    if (_gateSignKeyCache && _gateSignKeyCache.p8 === p8b64) {
        return _gateSignKeyCache.key;
    }
    const der = Uint8Array.from(atob(p64ToB64(p8b64)), c => c.charCodeAt(0));
    const keyPromise = crypto.subtle.importKey(
        'pkcs8', der,
        { name: 'ECDSA', namedCurve: 'P-256' },
        false, ['sign']
    );
    _gateSignKeyCache = { p8: p8b64, key: await keyPromise };
    return _gateSignKeyCache.key;
}

// 环境变量可能存为标准 base64 或 base64url，统一成标准 base64
function p64ToB64(s) {
    s = s.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    return s;
}

async function signGateToken(payload, env) {
    const p8b64 = env && env.GATE_SIGN_P8_B64;
    if (!p8b64) throw new Error('GATE_SIGN_P8_B64 未配置');
    const kid = (env && env.GATE_SIGN_KID) || 'v1';
    const header = { alg: 'ES256', typ: 'JWT', kid };
    const signingInput = b64urlFromStr(JSON.stringify(header)) + '.'
                       + b64urlFromStr(JSON.stringify(payload));
    const key = await getGateSigningKey(p8b64);
    const sigBuf = await crypto.subtle.sign(
        { name: 'ECDSA', hash: 'SHA-256' },
        key,
        new TextEncoder().encode(signingInput)
    );
    return signingInput + '.' + b64urlFromBytes(new Uint8Array(sigBuf));
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
        // ★ 2026-09-23 账号删除联动：带 username 时只读账号墓碑，命中在响应带
        //   accountState=ACCOUNT_REVOKED（客户端硬拒，即使设备授权仍有效）。
        const username = String(body.username || '').trim().slice(0, 64);

        // 参数校验：machineId 必填 + schema-guard 白名单
        // （垃圾 machineId 在门口就拒——与客户端 normalizeMachineIdResult 同规则）
        if (!machineId) {
            return json({ success: false, error: '缺少 machineId' }, 400);
        }
        if (!isValidMachineId(machineId)) {
            return json({ success: false, error: '机器 ID 格式错误' }, 400);
        }

        // ★ 2026-09-11 P2 桌面完整性闭环：已封锁设备裁决拒绝（403）。纯读检查
        //   （getDeviceBlock 仅 kv.get）——本端点「纯只读」铁律（探针 F3：零写调用）
        //   不破坏；封锁写入只在 status.js（桌面强信号上报）/ verify.js（安卓）。
        //   被拒客户端按"裁决不可达"回退本地状态，本地使用不阻断（红线）。
        const block = await getDeviceBlock(kv, machineId);
        if (block) {
            console.warn('[entitlement] 已封锁设备裁决被拒:', machineId, 'reason=', block.reason);
            return json({ success: false, error: '设备安全校验未通过，请更换设备或联系客服处理' }, 403);
        }

        // ★ 账号墓碑只读检查（getAccountTombstone 仅 kv.get）——纯只读铁律不破坏。
        let accountState = null;
        let accountDeletedAt = null;
        if (username) {
            const tomb = await getAccountTombstone(kv, username);
            if (tomb) {
                accountState = 'ACCOUNT_REVOKED';
                accountDeletedAt = tomb.deletedAt || null;
                console.warn('[entitlement] 账号已删除仍尝试登录:', username, 'machineId=', machineId);
            }
        }

        const result = await adjudicate(kv, machineId, code);

        // ★ P3-B：设备证明门（仅 Android；observe 默认不拦）。必须在签发前完成。
        const attConfig = await getAttestationConfig(kv);
        const att = await attestationGate(
            kv, machineId, body, result, attConfig, accountState);

        // ★ P3-A：放行态签发短周期 gate token。账号墓碑命中（accountState）不签；
        //   P3-B enforce 未过证明门（att.canSign=false）不签；
        //   私钥缺失/签名异常只降级（不带 token），绝不阻塞在线登录。
        let gateToken = null;
        if (result.state === ENTITLEMENT_STATES.LICENSED
            && !accountState && att.canSign) {
            try {
                // TTL 合法性：非数/非法配置回退 48h；钳制 [1h,168h]（防错配架空吊销节奏）
                let ttlHours = Number((context.env && context.env.GATE_TOKEN_TTL_HOURS));
                if (!Number.isFinite(ttlHours) || ttlHours <= 0) ttlHours = 48;
                ttlHours = Math.min(168, Math.max(1, ttlHours));
                const iatSec = Math.floor(Date.now() / 1000);
                // licExp 与 iat/exp 同型 = epoch 秒（result.expiresAt 契约为 ISO，转换；
                //   永久授权/解析失败 → null，客户端按永久语义放行）
                let licExpSec = null;
                if (result.expiresAt) {
                    const licMs = Date.parse(result.expiresAt);
                    if (Number.isFinite(licMs)) licExpSec = Math.floor(licMs / 1000);
                }
                const tokenPayload = {
                    v: 1,
                    mid: machineId,
                    username: username || '',
                    state: result.state,
                    type: result.edition || null,
                    features: result.features || [],
                    licExp: licExpSec,
                    iat: iatSec,
                    exp: iatSec + ttlHours * 3600,
                    jti: crypto.randomUUID()
                };
                gateToken = await signGateToken(tokenPayload, context.env);
            } catch (ge) {
                console.warn('[entitlement] gate token 签发失败（降级，不阻塞）:', ge.message);
            }
        }

        return json({
            success: true,
            ...result,
            accountState,
            accountDeletedAt,
            // P3-B 设备证明引导（非 Android 端全为 null/false，零影响）
            needAttestation: att.needAttestation,
            needProof: att.needProof,
            proofState: att.proofState,
            proofNonce: att.proofJti
                ? { jti: att.proofJti, nonce: att.proofNonceB64 } : null,
            attMode: String(body.platform || '') === 'android' ? attConfig.mode : null,
            gateToken,
            serverTime: new Date().toISOString()
        });

    } catch (error) {
        console.error('[entitlement] error:', error);
        return json({ success: false, error: '服务器内部错误，请稍后再试' }, 500);
    }
}
