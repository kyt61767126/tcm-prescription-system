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

import { getKV, checkRateLimit, sniffCarrierFromUA, patchClinicCarrier, patchLicenseDeviceCarrier } from './_lib/license-core.js';
import { provisionCloudAccount, normalizeActivationPassword } from './_lib/admin-account.js';
import { updateAdminRequestStatus, ensureLicenseV7 } from './_lib/license-write-service.js';

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

        let viaMachineIdFallback = false;
        let record = null;
        if (requestId) {
            // 防止路径穿越：requestId 必须为字母数字+短横
            if (!/^REQ-[A-Z0-9]+-[A-F0-9]+$/i.test(requestId)) {
                return json({ success: false, error: 'requestId 格式错误' }, 400, origin);
            }
            record = await kv.get(KV_ADMIN_REQ_PREFIX + requestId, 'json');
            if (!record) {
                return json({ success: false, error: '请求不存在或已失效' }, 404, origin);
            }
        } else if (machineIdParam && machineIdParam.length >= 8) {
            // ★ 2026-09-04 P0 machineId-only 自救查询：客户端提交被支付前置拦截
            //   （PAYMENT_REQUIRED）时不产生 requestId——官网订单的 requestId 客户端
            //   不持有。客户付款完成、管理员审核通过后切回 APP，前台化触发的
            //   resumeAdminPendingRequest 无 requestId 可查 → 激活永远检测不到
            //   （现场实锤 13398628215 重复付款 3 次仍登录失败）。
            //   凭本机 machineId 扫描最近记录（索引最新在前）：已激活（最新优先）→
            //   下发 license；待审（pending/pending_payment/pending_approval，最新）→
            //   原样返回状态；无命中 → 404。
            //   安全语义同下方兜底扫描：machineId 不可信，仅返回 license（绑定该
            //   machineId，他机验签必失败），跳过账号补开/密码归一化。
            try {
                const index = (await kv.get('admin_req_index', 'json')) || [];
                let hitPending = null;
                for (const rid of index.slice(0, 200)) {
                    const rec = await kv.get(KV_ADMIN_REQ_PREFIX + rid, 'json').catch(() => null);
                    if (!rec || !rec.machineId || String(rec.machineId) !== machineIdParam) continue;
                    if (rec.status === 'activated') {
                        record = rec;
                        viaMachineIdFallback = true;
                        console.log('[AdminStatus] machineId-only 自救命中已激活:', rid, '(仅返回license，跳过账号操作)');
                        break;
                    }
                    if (!hitPending && (rec.status === 'pending' || rec.status === 'pending_payment' || rec.status === 'pending_approval')) {
                        hitPending = rec; // 记住最新待审，继续向后找更早已激活记录
                    }
                }
                if (!record && hitPending) record = hitPending;
            } catch (e) {
                console.warn('[AdminStatus] machineId-only 自救扫描失败（忽略）:', e.message);
            }
            if (!record) {
                return json({ success: false, error: '请求不存在或已失效' }, 404, origin);
            }
        } else {
            return json({ success: false, error: '缺少 requestId 参数' }, 400, origin);
        }

        // ★ machineId 兜底：自己的请求未激活时，扫描最近记录找同设备已激活的官网订单
        // ★ 安全修复（2026-08-31 开放前审查）：machineId 是客户端任意提交的参数（不可信），
        //   兜底命中【他人】记录时，仅返回 license（license 绑定真实 machineId，攻击者
        //   自己的机器验签必失败，无泄露风险）；必须跳过 provisionCloudAccount 与
        //   normalizeActivationPassword——否则攻击者提交自己的 requestId + 冒用受害者
        //   machineId，即可触发受害者手机号下全部账号密码被重置为默认 admin（接管账号）。
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
            // ★ 2026-09-09 载体 UA 嗅探自愈（官网订单载体缺失）：装机轮询来自真实设备，
            //   UA 可判端形态。官网浏览器下单（dp 空）的记录 appModeCarrier 空 →
            //   诊所缺 offlineCarrier / license.devices 缺 clientClass → 后台显示纯
            //   「离线标准版」无📱APP/🖥️桌面前缀。此处幂等补写（只补空字段）：
            //   ① admin_req.appModeCarrier ② license.devices[].productClass/clientClass
            //   ③ 诊所 offlineCarrier。UA 判不出（桌面浏览器测试）静默跳过。
            const __sniffCarrier = sniffCarrierFromUA(context.request);
            if (__sniffCarrier && !record.appModeCarrier) {
                try {
                    await updateAdminRequestStatus(kv, record.requestId || requestId, { appModeCarrier: __sniffCarrier });
                    record.appModeCarrier = __sniffCarrier;
                    console.log('[AdminStatus] 载体嗅探补写 admin_req:', record.clinicName, '→', __sniffCarrier);
                } catch (e) { console.warn('[AdminStatus] 载体补写失败（忽略）:', e.message); }
                try {
                    if (record.licenseCode) {
                        await patchLicenseDeviceCarrier(kv, record.licenseCode,
                            record.machineId, 'offline', __sniffCarrier);
                    }
                } catch (e) { /* 已在函数内 warn */ }
                try {
                    await patchClinicCarrier(kv, record.clinicName, __sniffCarrier);
                } catch (e) { /* 已在函数内 warn */ }
            }
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
            // ★ 2026-09-11 P0 过期 license 不下发（假激活死循环根治）：admin_req.
            //   licenseBase64 是审核通过那一刻签名固化的文件，license 过期后本接口
            //   仍返回 activated+license → 客户端轮询/自愈（heal/syncLicenseFromServer）
            //   反复落盘过期 license → "激活成功却进不去"死循环（现场实锤：激活1
            //   中医诊所 license 9-11 06:21 过期后，客户端每次自愈都装回过期文件）。
            //   过期改返回 license_expired 状态且不带 license 字段：旧客户端不满足
            //   status==='activated' 判定自然不落盘；新客户端（auth-core 同轮更新）
            //   识别该状态显示"已过期请续费"。
            let __licenseExpiredAt = null;
            try {
                if (record.licenseBase64) {
                    const __bin = atob(record.licenseBase64);
                    const __bytes = Uint8Array.from(__bin, c => c.charCodeAt(0));
                    const __lic = JSON.parse(new TextDecoder().decode(__bytes));
                    const __expMs = new Date(__lic.expiresAt).getTime();
                    if (!isNaN(__expMs) && Date.now() > __expMs) {
                        __licenseExpiredAt = __lic.expiresAt;
                    }
                }
            } catch (e) { /* 解析失败按未过期处理（不阻断既有流程） */ }
            if (__licenseExpiredAt) {
                // 到期日按北京时间显示（UTC slice 会比实际到期日早一天，客户困惑）
                const __expBJ = new Date(new Date(__licenseExpiredAt).getTime() + 8 * 3600e3).toISOString().slice(0, 10);
                return json({
                    success: true,
                    status: 'license_expired',
                    expiresAt: __licenseExpiredAt,
                    message: `授权已于 ${__expBJ} 到期，请续费后重新激活`,
                    licenseInfo: {
                        user: record.adminName,
                        clinicName: record.clinicName,
                        phone: record.phone || '',
                        licenseCode: record.licenseCode,
                        resolvedAt: record.resolvedAt
                    }
                }, 200, origin);
            }
            // ★ 2026-09-11 阶段1a 存量 license 重签自愈：下发出口统一升级 V7。
            //   admin_req.licenseBase64 缺 signatureV7（V7 上线前的存量文件）时，
            //   用 license:{code} 权威记录重签（锚点确定性重算，expiresAt 不变），
            //   存量用户联网轮询一次即自动升级非对称签名文件。幂等：已带 V7 零写入。
            //   必须在过期拦截之后：过期 license 不重签不下发，维持 license_expired。
            record = await ensureLicenseV7(kv, record, context);
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
                },
                // ★ 2026-09-05 管理员激活路径邀请码：activated 响应带 inviteInfo
                //   （对齐 validate.js L439 字段语义，前端 onAdminActivated 成功页展示
                //   专属邀请码+奖励到账）。旧记录无 inviteCode 字段 → 条件展开不序列化，
                //   前端判空跳过，向后兼容。
                ...(record.inviteCode ? {
                    inviteInfo: {
                        inviteCode: record.inviteCode,
                        inviteCount: record.inviteCount || 0,
                        maxInvitees: 4,
                        rewardDays: record.inviteeBonusDays || 0,
                        inviteeBonusDays: record.inviteeBonusDays || 0,
                        invitedBy: record.invitedBy || null
                    }
                } : {})
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
