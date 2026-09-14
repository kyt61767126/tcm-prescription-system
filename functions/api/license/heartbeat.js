// ============================================================================
//  heartbeat.js — License 心跳验证 API（客户端定期调用，防盗破解）
//
//  路由：POST /api/license/heartbeat
//
//  无需登录认证（客户端调用），但有以下保护：
//    - 速率限制：每 IP 每小时 120 次（客户端 10 分钟周期上报，单台 6 次/h）
//    - 激活码格式校验
//    - 状态校验
//
//  请求体：
//    {
//      "code": "BNZC-XXXX-XXXX-XXXX-XXXX",
//      "machineId": "abc123def456"
//    }
//
//  返回：
//    {
//      "success": true,
//      "valid": true/false,
//      "action": "ok" | "expired" | "disabled" | "unknown" | "device_mismatch",
//      "expiresAt": "2025-12-31T23:59:59Z",
//      "daysRemaining": 365,
//      "serverTime": "2025-01-01T00:00:00Z"
//    }
//
//  客户端逻辑：
//    - 每 10 分钟调用一次（★ 2026-09-14：原 24h 防破解周期缩短为 10min，
//      同时作为后台在线统计数据源——服务端按 lastHeartbeat ≤15 分钟计在线）
//    - 离线超过 7 天自动锁定
//    - action != "ok" 时显示激活窗口
// ============================================================================

import {
    getKV, getLicense, updateLicense, checkRateLimit, getDevices, getMaxDevices, appendLicenseLog,
    setDeviceVersion, getDeviceVersion, reportUsage, sniffCarrierFromUA, patchClinicCarrier, getDeviceBlock
} from './_lib/license-core.js';

// ★ P2 安全修复：收紧 CORS，仅允许合法 Origin
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
        'Access-Control-Allow-Headers': 'Content-Type, X-Request-ID',
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

// 激活码格式校验
function isValidCodeFormat(code) {
    if (!code || typeof code !== 'string') return false;
    const pattern = /^BNZC-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;
    return pattern.test(code);
}

export async function onRequest(context) {
    _currentRequest = context.request;  // ★ P2：保存 request 供 CORS 动态检查
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

        // 速率限制：每 IP 每小时 120 次
        // ★ 2026-09-14 心跳周期 24h→10min（在线统计上报，users.js 按 ≤15 分钟窗口计在线）：
        //   单台 6 次/h，多设备诊所（如 4 台 APP + 桌面共用出口 IP）原 30/h 会误 429
        //   → 放宽至 120/h（≈20 台设备同 IP 满负荷仍有余量）
        const ip = getClientIP(context);
        const rateOk = await checkRateLimit(kv, `hb_${ip}`, 120);
        if (!rateOk.allowed) {
            return json({ success: false, error: '请求过于频繁，请稍后再试' }, 429);
        }

        const body = await context.request.json().catch(() => ({}));
        const { code, machineId } = body;

        // 参数校验
        if (!code || !machineId) {
            return json({ success: false, error: '缺少 code 或 machineId' }, 400);
        }
        if (!isValidCodeFormat(code)) {
            return json({ success: false, error: '激活码格式错误' }, 400);
        }

        // ★ 2026-09-11 P2 桌面完整性闭环：已封锁设备心跳拒绝（403，不续期）——
        //   与 verify.js / status.js / entitlement.js 同语义，封锁期间在线能力全卡死；
        //   TTL 7 天自动解除防伪造封锁 DoS，客服可删 device_block:{machineId} 解封
        const existingBlock = await getDeviceBlock(kv, machineId);
        if (existingBlock) {
            console.warn('[Heartbeat] 已封锁设备心跳被拒:', machineId, 'reason=', existingBlock.reason);
            return json({ success: false, error: '设备安全校验未通过，请更换设备或联系客服处理' }, 403);
        }

        const now = new Date();
        const serverTime = now.toISOString();

        // 查询激活码
        const record = await getLicense(kv, code);
        if (!record) {
            return json({
                success: true, valid: false, action: 'unknown',
                serverTime
            });
        }

        // 状态检查
        if (record.status === 'disabled') {
            return json({
                success: true, valid: false, action: 'disabled',
                serverTime
            });
        }

        if (record.status === 'unused') {
            // 未激活的激活码，心跳失败
            return json({
                success: true, valid: false, action: 'unknown',
                serverTime
            });
        }

        // 过期检查
        if (record.expiresAt) {
            const expireDate = new Date(record.expiresAt);
            if (now > expireDate) {
                // 自动标记过期
                if (record.status !== 'expired') {
                    try { await updateLicense(kv, code, { status: 'expired' }); } catch(e) {}
                }
                return json({
                    success: true, valid: false, action: 'expired',
                    expiresAt: record.expiresAt, daysRemaining: 0,
                    serverTime
                });
            }
        }

        // 设备绑定检查（devices 是对象数组 [{machineId,...}]，需遍历匹配）
        const devices = getDevices(record);
        const maxDevices = getMaxDevices(record);
        const deviceMatched = Array.isArray(devices) && devices.some(d => d.machineId === machineId);
        if (!deviceMatched) {
            // 设备不匹配
            if (devices.length >= maxDevices) {
                return json({
                    success: true, valid: false, action: 'device_mismatch',
                    serverTime
                });
            }
        }

        // ★ 端形态自动上报：心跳携带 productClass(cloud/offline)+clientClass(desktop/app)
        //   由客户端自动上报，同步持久化到 record.devices 与设备-版本绑定，
        //   供后台"激活码卡片/设备清单/设备绑定页"展示"云端/离线 + 桌面/APP"。
        //   ★ 2026-09-09 UA 嗅探兜底（官网订单载体缺失自愈）：老客户端不报端形态 →
        //     devices[].clientClass 恒空，后台显示纯「离线标准版」无📱APP/🖥️桌面前缀。
        //     心跳来自真实设备，UA 可判端形态。两语义严格分离：
        //     ① 客户端显式上报 = 权威，覆盖写（原语义不变）
        //     ② UA 嗅探兜底 = 仅补空字段，绝不覆盖已有值
        //   ★ 2026-09-14 在线统计（后台诊所管理「在线：🖥️桌面 X · 📱APP X」离线端归零修复）：
        //     ① 设备级 lastHeartbeat 无条件刷新（devices[].lastHeartbeat=serverTime，
        //        users.js 诊所聚合按 ≤15 分钟窗口计在线，区分 desktop/app 桶）
        //     ② 顶层 lastHeartbeat 与设备变更合并为一次 updateLicense（写量评估：
        //        客户端 10 分钟活跃上报 × 6/h/台，20 台活跃 ≈ 1.2k KV 写/天，付费额度内）
        //     ③ heartbeat 审计日志仍 7 天一条（控写放大，与在线判定无关）
        if (deviceMatched) {
            const repPc = ((body.productClass || '').trim()) || null;
            const repCc = ((body.clientClass || '').trim()) || null;
            const found = devices.find(d => d.machineId === machineId);
            let devicesDirty = false;
            if (found) {
                // ★ 在线统计数据源：设备级心跳时间戳（每次刷新，online 口径数据源）
                found.lastHeartbeat = serverTime;
                devicesDirty = true;
            }
            if (repPc || repCc) {
                // ① 显式上报：权威覆盖（原逻辑）
                if (found && ((found.productClass || null) !== repPc || (found.clientClass || null) !== repCc)) {
                    found.productClass = repPc;
                    found.clientClass = repCc;
                }
            } else if (found && (!found.productClass || !found.clientClass)) {
                // ② 嗅探兜底：仅补空字段（心跳接口仅离线端调用，productClass 兜底 offline）
                const sniffed = sniffCarrierFromUA(context.request);
                if (sniffed) {
                    if (!found.clientClass) { found.clientClass = sniffed; }
                    if (!found.productClass) { found.productClass = 'offline'; }
                    // 载体诊所兜底：官网订单建的诊所缺 offlineCarrier（用户管理
                    //   版本列显示纯「离线标准版」），幂等补写（仅空时）
                    try { await patchClinicCarrier(kv, record.clinicName, sniffed); } catch (e) { /* 内部 warn */ }
                }
            }
            if (devicesDirty) {
                try {
                    await updateLicense(kv, code, { devices: devices, maxDevices: maxDevices, lastHeartbeat: serverTime });
                } catch (e) { console.warn('[Heartbeat] 设备心跳/端形态写入失败:', e.message); }
            }
            // 设备-版本绑定端形态同步（上报/嗅探后的最终值）
            if (found && (found.productClass || found.clientClass)) {
                try {
                    const prevBinding = await getDeviceVersion(kv, machineId);
                    if (prevBinding) {
                        await setDeviceVersion(kv, machineId, prevBinding.version || 'standard', {
                            productClass: found.productClass || undefined,
                            clientClass: found.clientClass || undefined,
                            licenseCode: prevBinding.licenseCode || undefined,
                            clinicName: prevBinding.clinicName || undefined
                        });
                    }
                } catch (e) { console.warn('[Heartbeat] 设备绑定端形态更新失败:', e.message); }
            }
        }

        // 计算剩余天数
        let daysRemaining = 0;
        if (record.expiresAt) {
            const expireDate = new Date(record.expiresAt);
            daysRemaining = Math.ceil((expireDate - now) / (24 * 60 * 60 * 1000));
        } else {
            daysRemaining = -1; // 永久授权
        }

        // 记录心跳日志（精简，避免 KV 写入过多）
        // 每 7 天记录一次日志
        if (record.lastHeartbeat) {
            const lastHb = new Date(record.lastHeartbeat);
            if (now - lastHb < 7 * 24 * 60 * 60 * 1000) {
                // 7 天内已记录过心跳，跳过日志
            } else {
                try {
                    await appendLicenseLog(kv, code, { action: 'heartbeat', ip, detail: `machine:${machineId.substring(0, 8)}` });
                    await updateLicense(kv, code, { lastHeartbeat: serverTime });
                } catch(e) {}
            }
        } else {
            try {
                await appendLicenseLog(kv, code, { action: 'heartbeat', ip, detail: `machine:${machineId.substring(0, 8)}` });
                await updateLicense(kv, code, { lastHeartbeat: serverTime });
            } catch(e) {}
        }

        // ★ P2-3 计数上链：心跳随报当月处方计数（高水位跟踪 + 回拨对账）
        //   字段可选（旧客户端不带 → 不处理，宁可漏检不可误报）
        let usageInfo = null;
        if (body.rxCount !== undefined && body.rxCount !== null) {
            try {
                usageInfo = await reportUsage(kv, code, {
                    rxCount: body.rxCount,
                    rxMonth: body.rxMonth,
                    machineId: machineId,
                    ip: ip,
                    source: 'heartbeat'
                });
            } catch (e) { console.warn('[Heartbeat] 计数上报失败:', e.message); }
        }

        return json({
            success: true, valid: true, action: 'ok',
            expiresAt: record.expiresAt || null,
            daysRemaining,
            serverTime,
            usage: usageInfo ? { month: usageInfo.month, cloudCount: usageInfo.high } : undefined
        });

    } catch (error) {
        console.error('[heartbeat] error:', error);
        return json({ success: false, error: '服务器内部错误' }, 500);
    }
}
