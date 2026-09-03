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
        for (const requestId of index) {
            if (records.length >= limit) break;
            const record = await kv.get(KV_ADMIN_REQ_PREFIX + requestId, 'json');
            if (!record) continue;
            if (statusFilter === 'all' || record.status === statusFilter) {
                records.push(maskRecord(record));
            }
        }

        return json({
            success: true,
            requests: records,
            count: records.length,
            filter: statusFilter
        });

    } catch (error) {
        console.error('Admin list error:', error);
        return json({ success: false, error: '服务器内部错误，请稍后再试' }, 500);
    }
}
