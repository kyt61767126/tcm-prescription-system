// ============================================================================
//  admin-list.js — 平台管理员列出"管理员激活"请求 API
//
//  路由：GET /api/license/admin-list?status=pending&limit=100
//
//  认证：Bearer token（platform_admin）
//
//  查询参数：
//    status: pending / activated / rejected / cancelled / all（默认 pending）
//    limit:  1-500，默认 100
//
//  返回：{ success: true, requests: [...] }
// ============================================================================

import { parseAuthHeader, isPlatformAdmin } from '../_lib/auth.js';
import { getKV } from './_lib/license-core.js';

function corsHeaders() {
    return {
        'Access-Control-Allow-Origin': 'https://tcm-prescription-system.pages.dev',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Request-ID',
        'Access-Control-Max-Age': '86400',
        'Content-Type': 'application/json'
    };
}

function json(data, status = 200) {
    return new Response(JSON.stringify(data), { status, headers: corsHeaders() });
}

const KV_ADMIN_REQ_PREFIX = 'admin_req:';
const KV_ADMIN_REQ_INDEX = 'admin_req_index';

// ★ 2026-09-06 待付款订单自动过期（修"激活审核"列表被测试单/弃单永久占据）：
//   pending_payment 记录刻意不进 admin_req_index，仅靠 order: 映射在待付款列表展示。
//   历史教训：联调测试单/客户弃单若无人点🗑会永远留在列表里（2026-09-06 实证：
//   "测试诊所"混在真实客户中间，需人工清 KV）。规则：超过 7 天未付款 → 视为弃单，
//   列表不再返回，并在读取路径惰性清理（admin_req + order: 映射 + active_order:
//   索引三键同删，对齐 deleteAdminRequest 清理语义；清理失败不影响列表返回）。
//   客户端 48h 后本就会另建新单（order-submit ACTIVE_ORDER_MAX_AGE_MS），7 天远超
//   该窗口，不会误伤慢付款客户；已付款(pending)/已激活记录不受影响。
const PENDING_PAYMENT_EXPIRE_MS = 7 * 24 * 60 * 60 * 1000;

function isExpiredPendingPayment(record) {
    if (!record || record.status !== 'pending_payment') return false;
    const t = new Date(record.submittedAt || record.createdAt || 0).getTime();
    return (Date.now() - t) > PENDING_PAYMENT_EXPIRE_MS;
}

// 过期弃单惰性清理：三键同删（orderKey 优先用扫描到的键，兜底 record.orderNo）
async function purgeExpiredPendingPayment(kv, record, orderKey) {
    const jobs = [];
    if (record && record.requestId) {
        jobs.push(kv.delete(KV_ADMIN_REQ_PREFIX + record.requestId).catch(() => null));
    }
    const ok = orderKey || (record && record.orderNo
        ? ('order:' + String(record.orderNo).trim().toUpperCase()) : null);
    if (ok) jobs.push(kv.delete(ok).catch(() => null));
    if (record && record.machineId) {
        jobs.push(kv.delete('active_order:' + record.machineId).catch(() => null));
    }
    await Promise.allSettled(jobs);
    console.log('[AdminList] 惰性清理过期弃单(7天未付款):', record && record.requestId, ok || '');
}

// 脱敏：对外返回时隐藏 machineId 中间部分、电话中间 4 位
// ★ 平台管理员后台需要完整客户信息核对身份（电话/机器ID不脱敏）
// 此 API 仅 platform_admin 角色可访问（onRequest 入口已校验），无需脱敏
function maskRecord(record) {
    if (!record) return null;
    return {
        requestId: record.requestId,
        clinicName: record.clinicName,
        adminName: record.adminName,
        phone: record.phone || '',
        remark: record.remark || '',
        machineId: record.machineId || '',
        status: record.status,
        submittedAt: record.submittedAt,
        submittedIp: record.submittedIp || '',
        resolvedAt: record.resolvedAt || null,
        resolvedBy: record.resolvedBy || null,
        licenseCode: record.licenseCode || null,
        rejectReason: record.rejectReason || null,
        // ★ 版本信息：区分离线/云端、机构版/标准版
        productName: record.productName || '',
        edition: record.edition || '',
        appMode: record.appMode || '',
        versionLabel: record.versionLabel || '',
        // ★ 环境标记：test=测试环境，production=正式环境
        env: record.env || 'production',
        // ★ 官网订单扩展字段（后台核对付款信息用）
        orderSource: record.orderSource || '',
        orderNo: record.orderNo || '',
        orderPrice: record.orderPrice || '',
        payMethod: record.payMethod || '',
        payTxnLast6: record.payTxnLast6 || '',
        paidAt: record.paidAt || null,
        // ★ 2026-09-02 免费开通白名单标记（后台列表显示 🎫免费）
        freePass: !!record.freePass
    };
}

export async function onRequest(context) {
    const method = context.request.method;

    if (method === 'OPTIONS') {
        return new Response(null, { status: 200, headers: corsHeaders() });
    }

    if (method !== 'GET') {
        return json({ success: false, error: 'Method not allowed' }, 405);
    }

    try {
        // 管理员认证
        const currentUser = await parseAuthHeader(context.request, context.env);
        if (!currentUser || !isPlatformAdmin(currentUser)) {
            return json({ success: false, error: '仅平台总管理员可查看激活请求列表' }, 403);
        }

        const kv = getKV(context);
        if (!kv) {
            return json({ success: false, error: 'KV binding not found' }, 500);
        }

        const url = new URL(context.request.url);
        const statusFilter = url.searchParams.get('status') || 'pending';
        const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit'), 10) || 100, 1), 500);

        // ★ 2026-09-03 待付款订单可见性：官网下单未付款（pending_payment）的记录
        //   刻意不进 admin_req_index（不应出现在待审列表），但客户卡在付款环节时
        //   管理员需要能看到并主动跟进（如电话指导扫码）。通过 KV list 按
        //   order: 前缀枚举订单映射 → 加载对应申请记录 → 按状态过滤。
        //   无需新增索引，历史卡单（索引建立前的订单）立即可见。
        if (statusFilter === 'pending_payment') {
            const records = [];
            try {
                let cursor = undefined;
                let fetched = 0;
                // 分页枚举 order: 前缀（每页最多 1000 keys，安全上限 2000 条映射）
                while (records.length < limit && fetched < 2000) {
                    const listOpts = { prefix: 'order:' };
                    if (cursor) listOpts.cursor = cursor;
                    const page = await kv.list(listOpts);
                    fetched += (page.keys || []).length;
                    for (const key of (page.keys || [])) {
                        if (records.length >= limit) break;
                        const mapping = await kv.get(key.name, 'json').catch(() => null);
                        if (!mapping || !mapping.requestId) continue;
                        const record = await kv.get(KV_ADMIN_REQ_PREFIX + mapping.requestId, 'json').catch(() => null);
                        if (!record || record.status !== 'pending_payment') continue;
                        // ★ 过期弃单（7天未付款）：不进列表 + 惰性清理三键
                        if (isExpiredPendingPayment(record)) {
                            await purgeExpiredPendingPayment(kv, record, key.name);
                            continue;
                        }
                        records.push(maskRecord(record));
                    }
                    if (page.list_complete || !page.cursor) break;
                    cursor = page.cursor;
                }
            } catch (e) {
                console.warn('[AdminList] 枚举待付款订单失败:', e.message);
            }
            // 最新提交的在前
            records.sort((a, b) => new Date(b.submittedAt || 0) - new Date(a.submittedAt || 0));
            return json({
                success: true,
                requests: records,
                count: records.length,
                filter: statusFilter
            });
        }

        // 读取索引
        const index = (await kv.get(KV_ADMIN_REQ_INDEX, 'json')) || [];

        // 逐个读取请求记录
        const records = [];
        const seen = new Set();
        for (const requestId of index) {
            if (records.length >= limit) break;
            const record = await kv.get(KV_ADMIN_REQ_PREFIX + requestId, 'json').catch(() => null);
            if (!record) continue;
            // ★ 过期弃单（7天未付款）：all 视图同样不返回 + 惰性清理三键
            if (isExpiredPendingPayment(record)) {
                await purgeExpiredPendingPayment(kv, record, null);
                continue;
            }
            let hit = (statusFilter === 'all');
            if (!hit && statusFilter === 'pending') {
                // ★ 2026-09-04 兼容状态别名：pending(旧命名 已付款待审核) / pending_approval(新命名统一入口)
                //   跟前端 L2518 统计口径保持一致，防止"已付款待审"在默认 pending 列表中消失
                hit = (record.status === 'pending' || record.status === 'pending_approval');
            }
            if (!hit && record.status === statusFilter) hit = true;
            if (hit) {
                records.push(maskRecord(record));
                seen.add(String(record.requestId || ''));
            }
        }

        // ★ 兜底枚举（2026-09-04 已付款代办消失根因修复）：
        //   当 statusFilter ∈ {pending, pending_payment, all} 时，除 admin_req_index 主路径外，
        //   再按 order: 前缀扫描所有订单映射 → 加载对应 admin_req → 把"索引漏写/写入最终一致延迟/
        //   旧版本 markOrderPaid 未入列"的孤儿记录按状态扫出来合并（与 pending_payment 分支对称）。
        //   客户真实场景：markOrderPaid 写 status=pending 成功、但 _ensureInReqIndex 因时序/一致性未入列，
        //   管理员后台"只看到未付款 pending_payment 但看不到已付款 pending"的 P0 直接修复。
        if ((statusFilter === 'pending' || statusFilter === 'pending_payment' || statusFilter === 'all') && records.length < limit) {
            try {
                let cursor = undefined;
                let scanned = 0;
                while (records.length < limit && scanned < 2000) {
                    const listOpts = { prefix: 'order:' };
                    if (cursor) listOpts.cursor = cursor;
                    const page = await kv.list(listOpts).catch(() => null);
                    if (!page || !Array.isArray(page.keys)) break;
                    scanned += page.keys.length;
                    for (const key of page.keys) {
                        if (records.length >= limit) break;
                        const mapping = await kv.get(key.name, 'json').catch(() => null);
                        if (!mapping || !mapping.requestId) continue;
                        const rid = String(mapping.requestId);
                        if (seen.has(rid)) continue;  // 已在主路径 records 中，避免重复
                        const record = await kv.get(KV_ADMIN_REQ_PREFIX + rid, 'json').catch(() => null);
                        if (!record) continue;
                        // ★ 过期弃单（7天未付款）：兜底枚举路径同样不返回 + 惰性清理三键
                        if (isExpiredPendingPayment(record)) {
                            await purgeExpiredPendingPayment(kv, record, key.name);
                            continue;
                        }
                        let keep = false;
                        if (statusFilter === 'all') keep = true;
                        else if (statusFilter === 'pending') keep = (record.status === 'pending' || record.status === 'pending_approval');
                        else if (statusFilter === 'pending_payment') keep = (record.status === 'pending_payment');
                        if (keep) {
                            records.push(maskRecord(record));
                            seen.add(rid);
                        }
                    }
                    if (page.list_complete || !page.cursor) break;
                    cursor = page.cursor;
                }
            } catch (e) {
                console.warn('[AdminList] 兜底枚举 order: 失败(不影响主路径):', e.message);
            }
        }

        // 统一按提交时间倒序（主路径 + 兜底记录一起排序，保证最新最前）
        records.sort((a, b) => new Date(b.submittedAt || 0) - new Date(a.submittedAt || 0));

        return json({
            success: true,
            requests: records.slice(0, limit),
            count: records.length,
            filter: statusFilter
        });

    } catch (error) {
        console.error('Admin list error:', error);
        return json({ success: false, error: '服务器内部错误，请稍后再试' }, 500);
    }
}
