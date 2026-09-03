// ============================================================================
//  admin-status.js — 客户端"管理员激活"状态查询 API
//
//  路由：GET /api/license/admin-status?requestId=REQ-XXXXXXXX-XXXX
//
//  无需登录认证（客户端激活前尚未登录），但通过 requestId 查询。
//
//  返回：
//    pending:    { success: true, status: "pending" }
//    activated:  { success: true, status: "activated", license: "base64..." }
//    rejected:   { success: true, status: "rejected", reason: "拒绝原因" }
//    cancelled:  { success: true, status: "cancelled" }
//    不存在:     { success: false, error: "请求不存在或已失效" }
// ============================================================================

import { getKV, checkRateLimit } from './_lib/license-core.js';
import { provisionCloudAccount, normalizeActivationPassword } from './_lib/admin-account.js';

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

function corsHeaders(origin) {
    // ★ 2026-08-30 CORS 回退对齐 users.js 先例：file:// 客户端（Origin: null，如离线APP WebView）放行
    const allowedOrigin = (origin && ALLOWED_ORIGINS.includes(origin)) ? origin : 'null';
    return {
        'Access-Control-Allow-Origin': allowedOrigin,
        'Vary': 'Origin',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Request-ID',
        'Access-Control-Max-Age': '86400',
        'Content-Type': 'application/json'
    };
}

function json(data, status, origin) {
    return new Response(JSON.stringify(data), { status, headers: corsHeaders(origin) });
}

function getClientIP(context) {
    return context.request.headers.get('CF-Connecting-IP') ||
           context.request.headers.get('X-Forwarded-For') ||
           context.request.headers.get('X-Real-IP') ||
           'unknown';
}

const KV_ADMIN_REQ_PREFIX = 'admin_req:';

export async function onRequest(context) {
    const method = context.request.method;
    const origin = context.request.headers.get('Origin') || '';

    if (method === 'OPTIONS') {
        return new Response(null, { status: 200, headers: corsHeaders(origin) });
    }

    if (method !== 'GET') {
        return json({ success: false, error: 'Method not allowed' }, 405, origin);
    }

    try {
        const kv = getKV(context);
        if (!kv) {
            return json({ success: false, error: 'KV binding not found' }, 500, origin);
        }

        // 速率限制（每 IP 每小时 600 次，足够 5 秒轮询 5 分钟）
        const ip = getClientIP(context);
        const rateLimit = await checkRateLimit(kv, ip + ':admin-status', 600);
        if (!rateLimit.allowed) {
            return json({
                success: false,
                error: '查询过于频繁，请稍后再试',
                rateLimited: true
            }, 429, origin);
        }

        const url = new URL(context.request.url);
        const requestId = url.searchParams.get('requestId');
        // ★ 2026-08-30 可选 machineId：官网订单付费导引闭环。
        //   客户可能在客户端提交激活申请后，又通过官网订单付款购买（官网下单会生成新的
        //   requestId 记录），管理员激活的是官网订单记录。此时客户端轮询自己的旧
        //   requestId 永远 pending。带 machineId 兜底扫描：找到同设备已激活的记录
        //   即返回 activated，客户端自动完成激活（license 绑定的就是该 machineId）。
        const machineIdParam = url.searchParams.get('machineId') || '';

        if (!requestId) {
            return json({ success: false, error: '缺少 requestId 参数' }, 400, origin);
        }

        // 防止路径穿越：requestId 必须为字母数字+短横
        if (!/^REQ-[A-Z0-9]+-[A-F0-9]+$/i.test(requestId)) {
            return json({ success: false, error: 'requestId 格式错误' }, 400, origin);
        }

        let record = await kv.get(KV_ADMIN_REQ_PREFIX + requestId, 'json');
        if (!record) {
            return json({ success: false, error: '请求不存在或已失效' }, 404, origin);
        }

        // ★ machineId 兜底：自己的请求未激活时，扫描最近记录找同设备已激活的官网订单
        // ★ 安全修复（2026-08-31 开放前审查）：machineId 是客户端任意提交的参数（不可信），
        //   兜底命中【他人】记录时，仅返回 license（license 绑定真实 machineId，攻击者
        //   自己的机器验签必失败，无泄露风险）；必须跳过 provisionCloudAccount 与
        //   normalizeActivationPassword——否则攻击者提交自己的 requestId + 冒用受害者
        //   machineId，即可触发受害者手机号下全部账号密码被重置为默认 admin（接管账号）。
        let viaMachineIdFallback = false;
        if (machineIdParam && record.status !== 'activated') {
            try {
                const index = (await kv.get('admin_req_index', 'json')) || [];
                for (const rid of index.slice(0, 200)) {
                    if (rid === requestId) continue;
                    const rec = await kv.get(KV_ADMIN_REQ_PREFIX + rid, 'json');
                    if (rec && rec.machineId === machineIdParam && rec.status === 'activated') {
                        record = rec;
                        viaMachineIdFallback = true;
                        console.log('[AdminStatus] machineId 兜底命中:', rid, '(仅返回license，跳过账号操作)');
                        break;
                    }
                }
            } catch (e) {
                console.warn('[AdminStatus] machineId 兜底扫描失败（忽略）:', e.message);
            }
        }

        // 根据状态返回不同结构
        const status = record.status;
        if (status === 'pending') {
            return json({ success: true, status: 'pending' }, 200, origin);
        }
        if (status === 'activated') {
            // ★ 2026-08-19 幂等补开：修复上线前已通过但未创建云端账号的历史激活请求
            // admin-approve 的自动开通仅在审核通过那一刻执行；若当时该修复尚未部署，
            // 该请求就没有云端账号，客户端用手机号登录会 401。这里每次轮询 activated
            // 时都尝试补开（幂等，已存在则跳过），让历史激活直接可登录。
            // ★ 安全修复（2026-08-31）：machineId 兜底命中的他人记录跳过账号补开/密码
            //   归一化（machineId 参数不可信，见上方兜底扫描处注释），仅自己的
            //   requestId 走受信链路。
            if (!viaMachineIdFallback) {
                try {
                    await provisionCloudAccount(kv, record);
                } catch (e) {
                    console.warn('[AdminStatus] 云端账号补开失败（不影响license读取）:', e.message);
                }
                // ★ 2026-08-20 激活密码归一化：该手机号下既有旧账号若密码非 admin，
                //   重置为默认 admin，杜绝老账号旧密码导致登录 401。requestId 持有者才可到此。
                try {
                    await normalizeActivationPassword(kv, record);
                } catch (e) {
                    console.warn('[AdminStatus] 激活密码归一化失败（不影响license读取）:', e.message);
                }
            }
            // ★ 关键：客户端检查 status === 'activated' 时会取 result.license 写入 license.dat
            return json({
                success: true,
                status: 'activated',
                license: record.licenseBase64,
                licenseInfo: {
                    user: record.adminName,
                    clinicName: record.clinicName,
                    // ★ 2026-09-03 补 phone：客户端轮询中断重启后恢复领码（onAdminActivated
                    //   参数兜底）需要权威手机号；此前恢复场景 state 为空 → 建号被跳过，
                    //   已付款客户"激活成功却登录失败"。license 绑定 machineId，泄露无风险。
                    phone: record.phone || '',
                    licenseCode: record.licenseCode,
                    resolvedAt: record.resolvedAt
                }
            }, 200, origin);
        }
        if (status === 'rejected') {
            return json({
                success: true,
                status: 'rejected',
                reason: record.rejectReason || '管理员未填写拒绝原因'
            }, 200, origin);
        }
        if (status === 'cancelled') {
            return json({ success: true, status: 'cancelled' }, 200, origin);
        }

        // 未知状态兜底
        return json({ success: true, status: status || 'unknown' }, 200, origin);

    } catch (error) {
        console.error('Admin status error:', error);
        return json({ success: false, error: '服务器内部错误，请稍后再试' }, 500, origin);
    }
}
