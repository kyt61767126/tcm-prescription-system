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

// ★ 2026-09-24 P1-B KV 降写：纯心跳（端形态无变化、无需补审计）整记录写近重复节流阈值。
//   客户端正常周期 10 分钟，在线判定窗口 15 分钟（users.js ONLINE_ACTIVE_MS）；
//   阈值取 5 分钟——只拦截抖动/重放/多实例重复上报，正常周期必写，在线口径零影响。
const HB_WRITE_MIN_MS = 5 * 60 * 1000;

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
    // ★ 2026-09-23：file:// 渲染端 Origin="null" 放行（与 entitlement/admin-submit 同口径）
    let allowedOrigin;
    if (origin === 'null') allowedOrigin = 'null';
    else allowedOrigin = (origin && ALLOWED_ORIGINS.includes(origin)) ? origin : 'https://tcm-prescription-system.pages.dev';
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
        //     ① 设备级 lastHeartbeat 每次心跳刷新（users.js 诊所聚合按 ≤15 分钟窗口计在线，
        //        区分 desktop/app 桶）——2026-09-24 起经 __devicePatch 原子更新本设备槽位
        //     ② 顶层 lastHeartbeat 与设备变更合并为一次 updateLicense
        //     ③ heartbeat 审计日志仍 7 天一条（控写放大，与在线判定无关）
        //   ★ 2026-09-24 P1-B KV 降写（原每台每心跳稳态 3 次 KV 写：license 整记录 +
        //     device_version 绑定 + usage 计数）：
        //     ① 设备槽位改走 updateLicense.__devicePatch（内部重读最新 record 只 patch 本
        //        设备）——大幅收窄同码多设备并发心跳整数组覆盖导致在线漏计的窗口（KV 无
        //        CAS，极端同刻碰撞仍可能丢一次刷新，下个 10 分钟周期自愈，15 分钟在线窗口
        //        不受影响）；
        //     ② 纯心跳近重复（< HB_WRITE_MIN_MS=5 分钟）跳过整记录写，正常 10 分钟周期必写，
        //        在线 15 分钟窗口零影响；端形态变化或需补 7 天审计时强制写；
        //     ③ device_version 绑定改语义 diff：五字段全等不写（原为无条件 put，每心跳一次，
        //        且 setDeviceVersion 每次把 boundAt 刷成心跳时间污染"绑定时间"语义）；
        //     ④ usage 计数持平不写（见 license-core.reportUsage）。
        //     降写后稳态约 1 次写/台/10 分钟（原 3 次），20 台活跃 ≈ 2.9k 写/天（原约 8.6k）。
        if (deviceMatched) {
            const repPc = ((body.productClass || '').trim()) || null;
            const repCc = ((body.clientClass || '').trim()) || null;
            const found = devices.find(d => d.machineId === machineId);
            let metaChanged = false;
            if (repPc || repCc) {
                // ① 显式上报：权威覆盖——★ 2026-09-14 按字段覆盖：仅覆盖客户端明确上报
                //   的字段（客户端判据不确定时省略 clientClass 只报 productClass，省略字段
                //   绝不清空已有值——防部分上报把 devices[].clientClass 冲成 null）
                if (found) {
                    if (repPc && found.productClass !== repPc) { found.productClass = repPc; metaChanged = true; }
                    if (repCc && found.clientClass !== repCc) { found.clientClass = repCc; metaChanged = true; }
                }
            } else if (found && (!found.productClass || !found.clientClass)) {
                // ② 嗅探兜底：仅补空字段（心跳接口仅离线端调用，productClass 兜底 offline）
                const sniffed = sniffCarrierFromUA(context.request);
                if (sniffed) {
                    if (!found.clientClass) { found.clientClass = sniffed; metaChanged = true; }
                    if (!found.productClass) { found.productClass = 'offline'; metaChanged = true; }
                    // 载体诊所兜底：官网订单建的诊所缺 offlineCarrier（用户管理
                    //   版本列显示纯「离线标准版」），幂等补写（仅空时）
                    try { await patchClinicCarrier(kv, record.clinicName, sniffed); } catch (e) { /* 内部 warn */ }
                }
            }
            if (found) {
                // 在线统计数据源：KV 中本设备上次心跳年龄（不在内存预改，保证节流判据准确）
                const prevDevHbMs = found.lastHeartbeat ? Date.parse(found.lastHeartbeat) : NaN;
                const hbAgeMs = Number.isFinite(prevDevHbMs) ? (now.getTime() - prevDevHbMs) : Infinity;
                const topPrevMs = record.lastHeartbeat ? Date.parse(record.lastHeartbeat) : NaN;
                const needAudit = !Number.isFinite(topPrevMs) ||
                    (now.getTime() - topPrevMs) >= 7 * 24 * 60 * 60 * 1000;
                const skipLicenseWrite = !metaChanged && !needAudit &&
                    Number.isFinite(hbAgeMs) && hbAgeMs < HB_WRITE_MIN_MS;
                if (!skipLicenseWrite) {
                    // 7 天审计与本次唯一一次整记录写同批（原匹配路径每 7 天会二次 updateLicense）
                    if (needAudit) {
                        try {
                            await appendLicenseLog(kv, code, { action: 'heartbeat', ip, detail: `machine:${machineId.substring(0, 8)}` });
                        } catch (e) { /* 审计失败不阻断心跳 */ }
                    }
                    try {
                        await updateLicense(kv, code, {
                            lastHeartbeat: serverTime,
                            maxDevices: maxDevices,
                            __devicePatch: {
                                machineId: machineId,
                                lastHeartbeat: serverTime,
                                productClass: found.productClass || null,
                                clientClass: found.clientClass || null
                            }
                        });
                    } catch (e) { console.warn('[Heartbeat] 设备心跳/端形态写入失败:', e.message); }
                }
            }
            // 设备-版本绑定端形态同步（上报/嗅探后的最终值）：语义字段全等则跳过写
            if (found && (found.productClass || found.clientClass)) {
                try {
                    const prevBinding = await getDeviceVersion(kv, machineId);
                    if (prevBinding) {
                        const nextVersion = prevBinding.version || 'standard';
                        const nextPc = found.productClass || prevBinding.productClass || null;
                        const nextCc = found.clientClass || prevBinding.clientClass || null;
                        const nextLc = prevBinding.licenseCode || null;
                        const nextCn = prevBinding.clinicName || null;
                        const bindingChanged =
                            (prevBinding.version || 'standard') !== nextVersion ||
                            (prevBinding.productClass || null) !== nextPc ||
                            (prevBinding.clientClass || null) !== nextCc ||
                            (prevBinding.licenseCode || null) !== nextLc ||
                            (prevBinding.clinicName || null) !== nextCn;
                        if (bindingChanged) {
                            await setDeviceVersion(kv, machineId, nextVersion, {
                                productClass: nextPc || undefined,
                                clientClass: nextCc || undefined,
                                licenseCode: nextLc || undefined,
                                clinicName: nextCn || undefined
                            });
                        }
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

        // 记录心跳日志（精简，避免 KV 写入过多）：每 7 天记录一次
        // ★ 2026-09-24 P1-B：设备匹配路径的审计 append + 时间戳刷新已在上方与唯一一次
        //   整记录写同批完成（含首次心跳顶层 lastHeartbeat 为空的情况），此处仅保留
        //   "设备未匹配"（未绑定设备的心跳）路径的旧行为：只刷顶层时间戳，不动 devices。
        if (!deviceMatched) {
            const topPrevMs = record.lastHeartbeat ? Date.parse(record.lastHeartbeat) : NaN;
            const needAudit = !Number.isFinite(topPrevMs) ||
                (now.getTime() - topPrevMs) >= 7 * 24 * 60 * 60 * 1000;
            if (needAudit) {
                try {
                    await appendLicenseLog(kv, code, { action: 'heartbeat', ip, detail: `machine:${machineId.substring(0, 8)}` });
                    await updateLicense(kv, code, { lastHeartbeat: serverTime });
                } catch(e) {}
            }
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
