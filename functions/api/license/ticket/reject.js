// ============================================================================
//  ticket/reject.js — 平台管理员拒绝"激活工单" API
//
//  路由：POST /api/license/ticket/reject
//
//  认证：Bearer token（platform_admin 或 C批新增 service 客服；拒绝动作写平台审计）
//
//  请求体：{ "ticketNo": "TK-XXXXXXXX-XXXXXX", "reason": "拒绝原因（客户可见）" }
//
//  返回：{ success: true, status: 'rejected' }
// ============================================================================

import { parseAuthHeader, isStaff } from '../../_lib/auth.js';
import { getKV } from '../_lib/license-core.js';
// ★ 2026-09-24 C批：客服可拒单，操作必留平台级审计（拒单此前仅 console.log）
import { writeAuditLog } from '../../_lib/audit-log.js';

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

const KV_TICKET_PREFIX = 'ticket:';

export async function onRequest(context) {
    const method = context.request.method;

    if (method === 'OPTIONS') {
        return new Response(null, { status: 200, headers: corsHeaders() });
    }

    if (method !== 'POST') {
        return json({ success: false, error: 'Method not allowed' }, 405);
    }

    try {
        // 平台员工认证（platform_admin 或 C批 service 客服）
        const currentUser = await parseAuthHeader(context.request, context.env);
        if (!currentUser || !isStaff(currentUser)) {
            return json({ success: false, error: '仅平台员工（管理员/客服）可拒绝工单' }, 403);
        }

        const kv = getKV(context);
        if (!kv) {
            return json({ success: false, error: 'KV binding not found' }, 500);
        }

        const body = await context.request.json().catch(() => ({}));
        const ticketNo = String(body.ticketNo || '').trim();
        const reason = String(body.reason || '').trim().slice(0, 300);

        if (!ticketNo || !/^TK-[A-Z0-9]+-[A-Z0-9]+$/i.test(ticketNo)) {
            return json({ success: false, error: 'ticketNo 格式错误' }, 400);
        }

        const ticketKey = KV_TICKET_PREFIX + ticketNo;
        const ticket = await kv.get(ticketKey, 'json');
        if (!ticket) {
            return json({ success: false, error: '工单不存在或已失效' }, 404);
        }

        // ★ 2026-09-24 安全收尾批 CAS：与 activate-from-ticket 同一状态机，
        //   防"审批通过处理中/已终态"与拒绝操作撞车。processing 超 10 分钟视为崩溃
        //   残留，允许拒绝以清理工单（拒绝不会发码，属安全方向）。
        const PROCESSING_TTL_MS = 10 * 60 * 1000;
        // 占用年龄口径与 activate-from-ticket 完全一致：processingAt 缺失/非法(NaN)/未来(负)
        //   一律视为过期可接管（此类污染仅 KV 权限级可达；拒绝不发码，方向安全；杜绝永久卡死）
        const isStaleProcessing = (t) => {
            if (!t || t.status !== 'processing') return false;
            if (!t.processingAt) return true;
            const age = Date.now() - new Date(t.processingAt).getTime();
            if (isNaN(age) || age < 0) return true;
            return age >= PROCESSING_TTL_MS;
        };
        if (ticket.status === 'approved' || ticket.status === 'rejected') {
            return json({
                success: false,
                code: 'TICKET_ALREADY_RESOLVED',
                error: `工单${ticket.status === 'approved' ? '已通过' : '已拒绝'}，请勿重复操作`
            }, 409);
        }
        if (ticket.status === 'processing' && !isStaleProcessing(ticket)) {
            return json({
                success: false,
                code: 'TICKET_PROCESSING',
                error: '工单正在审批处理中，暂时无法拒绝；如长时间未完成，请 10 分钟后再试'
            }, 409);
        }
        if (ticket.status !== 'pending' && ticket.status !== 'processing') {
            return json({
                success: false,
                error: `工单当前状态为 ${ticket.status}，无法拒绝（仅待审批状态可操作）`
            }, 400);
        }

        // CAS 终审：写 rejected 前复读一次——期间审批请求已占用/终审则放弃拒绝
        const cur = await kv.get(ticketKey, 'json');
        if (!cur) {
            return json({ success: false, error: '工单不存在或已失效' }, 404);
        }
        if (cur.status === 'approved' || cur.status === 'rejected') {
            return json({
                success: false,
                code: 'TICKET_ALREADY_RESOLVED',
                error: `工单刚被${cur.status === 'approved' ? '审批通过' : '拒绝'}，已刷新，请重新查看`
            }, 409);
        }
        if (cur.status === 'processing' && !isStaleProcessing(cur)) {
            return json({
                success: false,
                code: 'TICKET_PROCESSING',
                error: '工单正在审批处理中，暂时无法拒绝'
            }, 409);
        }
        if (cur.status !== 'pending' && !isStaleProcessing(cur)) {
            return json({ success: false, error: `工单状态已变化（${cur.status}），拒绝已中止` }, 409);
        }

        // 拒绝：写状态 + 拒绝原因（客户可见）；接管残留 processing 时清理占用字段
        const takeover = isStaleProcessing(cur);
        const prevProcessingBy = cur.processingBy || null;
        if (takeover) {
            console.warn('[TicketReject] 接管超时/异常残留 processing 工单并拒绝:', ticketNo,
                'prevBy=', prevProcessingBy, 'at=', cur.processingAt);
        }
        delete cur.processingBy;
        delete cur.processingAt;
        delete cur.processingToken;
        cur.status = 'rejected';
        cur.rejectReason = reason || '管理员未填写拒绝原因';
        cur.resolvedAt = new Date().toISOString();
        cur.resolvedBy = currentUser.username;
        await kv.put(ticketKey, JSON.stringify(cur));

        // ★ 写后冲突留痕（理论窄窗：存活超 10 分钟的 approve 请求恰在本请求读改写之间完成
        //   approved 终写，被本次 LWW 覆盖）。写后复读，仅当收敛结果显示 approved 才告警
        //   （读到 pending 多为同 colo 写后陈旧读，不告警，防噪声）；不回写、不改结果，
        //   仅留审计——码已发不可撤，由人工凭 audit + license 记录追回。
        try {
            const post = await kv.get(ticketKey, 'json');
            if (post && post.status === 'approved') {
                console.error('[TicketReject] ★拒绝写后发现工单已被审批通过（终态冲突）:',
                    ticketNo, 'approvedCode=', post.licenseCode, 'rejectBy=', currentUser.username);
                context.waitUntil(writeAuditLog(kv, null, currentUser.username, currentUser.role,
                    'ticket_reject_terminal_conflict', ticketNo, context, {
                        approvedLicenseCode: post.licenseCode || null,
                        approvedBy: post.resolvedBy || null
                    }));
            }
        } catch (pe) {
            console.warn('[TicketReject] 写后冲突复读失败（忽略）:', pe && pe.message);
        }

        // ★ C批：平台级审计（resolvedBy 同时留在工单内，双轨；waitUntil 不阻塞响应）
        //   接管残留单独留痕（谁清的谁的残留），不打印任何令牌值
        context.waitUntil(writeAuditLog(kv, null, currentUser.username, currentUser.role,
            'ticket_reject', ticketNo, context, {
                reason: cur.rejectReason,
                claimTakeover: takeover,
                prevProcessingBy: takeover ? prevProcessingBy : null
            }));

        console.log('[TicketReject] 工单已拒绝:', ticketNo,
            'reason=', cur.rejectReason, 'by=', currentUser.username);

        return json({ success: true, status: 'rejected' });

    } catch (error) {
        console.error('Ticket reject error:', error);
        return json({ success: false, error: '服务器内部错误，请稍后再试' }, 500);
    }
}
