// ============================================================================
//  heartbeat.js — License 心跳验证 API（客户端定期调用，防盗破解）
//
//  路由：POST /api/license/heartbeat
//
//  无需登录认证（客户端调用），但有以下保护：
//    - 速率限制：每 IP 每小时 30 次（比 validate 宽松，每 24 小时调用一次）
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
//    - 每 24 小时调用一次
//    - 离线超过 7 天自动锁定
//    - action != "ok" 时显示激活窗口
// ============================================================================

import {
    getKV, getLicense, updateLicense, checkRateLimit, getDevices, getMaxDevices, appendLicenseLog,
    setDeviceVersion, getDeviceVersion, reportUsage
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

        // 速率限制：每 IP 每小时 30 次
        const ip = getClientIP(context);
        const rateOk = await checkRateLimit(kv, `hb_${ip}`, 30);
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
        if (deviceMatched && (body.productClass || body.clientClass)) {
            const pc = ((body.productClass || '').trim()) || null;
            const cc = ((body.clientClass || '').trim()) || null;
            const found = devices.find(d => d.machineId === machineId);
            if (found && (found.productClass !== pc || found.clientClass !== cc)) {
                found.productClass = pc;
                found.clientClass = cc;
                try {
                    await updateLicense(kv, code, {
                        devices: devices,
                        maxDevices: maxDevices
                    });
                } catch (e) { console.warn('[Heartbeat] 设备端形态写入失败:', e.message); }
            }
            try {
                const prevBinding = await getDeviceVersion(kv, machineId);
                if (prevBinding) {
                    await setDeviceVersion(kv, machineId, prevBinding.version || 'standard', {
                        productClass: pc || undefined,
                        clientClass: cc || undefined,
                        licenseCode: prevBinding.licenseCode || undefined,
                        clinicName: prevBinding.clinicName || undefined
                    });
                }
            } catch (e) { console.warn('[Heartbeat] 设备绑定端形态更新失败:', e.message); }
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
