// ============================================================================
//  logs.js — 激活码操作日志查询 API（管理员专用）
//
//  路由：GET /api/license/logs?code=BNZC-XXXX-XXXX-XXXX-XXXX
//
//  认证：Bearer token（platform_admin）
//
//  返回：
//    {
//      "success": true,
//      "code": "BNZC-XXXX-XXXX-XXXX-XXXX",
//      "logs": [
//        { "action": "generate", "time": "...", "ip": "...", "operator": "...", "detail": "..." },
//        { "action": "activate", "time": "...", "ip": "...", "operator": "...", "detail": "..." },
//        { "action": "unbind",   "time": "...", "ip": "...", "operator": "...", "detail": "..." }
//      ],
//      "count": 3,
//      "rawLogCount": 3,          // 仅 license_log 原始条数（不含下方叠加项）
//      "auditLedger": {...}|null, // ★ 淘宝自动开通台账（事实源=激活审核 admin_req）
//      "auditGaps": [...],        // ★ 审计缺口标记（license_log 写失败的显式留痕）
//      "auditReconciled": true    // ★ 台账在且无缺口 = 审计自洽
//    }
//
//  ★ 2026-10-09 审计单一事实源：logs 里会**额外叠加**两类条目（原有条目结构不变）：
//    taobao-{cloud|local}-auto-ledger —— 从 admin_req 反查的自动开通台账（即使 license_log
//                                       丢了成功行，开通事实依然可见）
//    audit-gap                       —— license_log 写失败留下的缺口（不再静默）
//
//  日志 action 取值：
//    generate   - 生成激活码（管理员）
//    activate   - 首次激活（用户客户端）
//    reactivate - 同设备重激活（用户客户端）
//    unbind     - 解绑机器（管理员）
//    disable    - 禁用激活码（管理员）
//    enable     - 启用激活码（管理员）
//    delete     - 删除激活码（管理员，仅控制台日志，KV 日志已随之删除）
// ============================================================================

import { parseAuthHeader, isPlatformAdmin } from '../_lib/auth.js';
import { getKV, getLicenseLogs, getLicenseLogGaps } from './_lib/license-core.js';
import { KV_PREFIX } from './_lib/schema-guard.js';

function corsHeaders() {
    return {
        'Access-Control-Allow-Origin': 'https://tcm-prescription-system.pages.dev',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Request-ID',
        'Access-Control-Max-Age': '86400',
        'Content-Type': 'application/json'
    };
}

function json(data, status = 200) {
    return new Response(JSON.stringify(data), { status, headers: corsHeaders() });
}

// ★ 2026-10-09 审计单一事实源：淘宝自动开通台账从 admin_req 反查
//   背景：自动开通的持久台账写在 admin_req（orderSource=taobao-*-auto），而 license_log
//   那条成功行是"尽力而为"写；真机复现过"台账有、日志缺"的不可观测状态。此处把台账
//   直接叠进日志视图，使「这次自动开通过」的可见性不再依赖 license_log。
//   取数路径（O(1)，不做 admin_req_index 全表扫描，遵守 KNOWLEDGE §63 读放大铁律）：
//     taobao_auto_code:{code}（既有码级幂等键）→ requestId
//     admin_req:{requestId}（开通时写入的持久审计）
async function readAutoLedger(kv, code) {
    try {
        const marker = await kv.get('taobao_auto_code:' + code, 'json');
        if (!marker || !marker.requestId) return null;
        const rec = await kv.get(KV_PREFIX.adminReq + marker.requestId, 'json');
        if (!rec) return { requestId: marker.requestId, missing: true };
        return {
            requestId: marker.requestId,
            orderSource: rec.orderSource || '',
            autoSource: rec.autoSource || '',
            nameSource: rec.autoNameSource || '',
            appMode: rec.appMode || '',
            carrier: rec.appModeCarrier || '',
            status: rec.status || '',
            clinicName: rec.clinicName || '',
            phone: rec.phone || '',
            licenseCode: rec.licenseCode || '',
            createdAt: rec.createdAt || '',
            resolvedAt: rec.resolvedAt || ''
        };
    } catch (e) {
        console.warn('[LicenseLogs] 读取自动开通台账失败（不影响日志本体）:', e && e.message);
        return null;
    }
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
            return json({ success: false, error: '仅平台总管理员可查看操作日志' }, 403);
        }

        const kv = getKV(context);
        if (!kv) {
            return json({ success: false, error: 'KV binding not found' }, 500);
        }

        const url = new URL(context.request.url);
        const code = url.searchParams.get('code');
        if (!code) {
            return json({ success: false, error: '请提供 code 参数' }, 400);
        }

        // 激活码格式校验：BNZC-XXXX-XXXX-XXXX-XXXX
        if (!/^BNZC-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/.test(code)) {
            return json({ success: false, error: '激活码格式错误' }, 400);
        }

        const logs = await getLicenseLogs(kv, code);
        // 叠加两条"事实/缺口"信息（新增，均为可选字段；logs 结构对既有消费方不变）
        const gaps = await getLicenseLogGaps(kv, code);
        const ledger = await readAutoLedger(kv, code);

        const derived = [];
        if (ledger && !ledger.missing) {
            const isLocal = /local/.test(ledger.orderSource);
            derived.push({
                action: isLocal ? 'taobao-local-auto-ledger' : 'taobao-cloud-auto-ledger',
                time: ledger.resolvedAt || ledger.createdAt || '',
                ip: 'admin_req',
                operator: ledger.phone || 'system',
                detail: '淘宝' + (isLocal ? '本地' : '云端') + '码自动开通台账（来源：激活审核 admin_req · 单一事实源）'
                    + ' — requestId=' + ledger.requestId
                    + '，状态=' + (ledger.status || '-')
                    + '，诊所=' + (ledger.clinicName || '-') + '（名源=' + (ledger.nameSource || '-') + '）'
                    + '，来源标记=' + (ledger.orderSource || '-') + '/' + (ledger.autoSource || '-')
                    + (ledger.appMode ? '，模式=' + ledger.appMode : '')
                    + (ledger.carrier ? '，载体=' + ledger.carrier : '')
                    + '，记录时间=' + (ledger.createdAt || '-')
            });
        } else if (ledger && ledger.missing) {
            derived.push({
                action: 'audit-gap',
                time: '',
                ip: 'admin_req',
                operator: 'system',
                detail: '⚠ 码上存在自动开通指针（requestId=' + ledger.requestId
                    + '）但 admin_req 记录缺失——台账与索引不一致，请按 requestId 排查。'
            });
        }
        for (const g of gaps) {
            derived.push({
                action: 'audit-gap',
                time: g.time || g.gapAt || '',
                ip: g.ip || 'unknown',
                operator: g.operator || 'system',
                detail: '⚠ 审计缺口：本应写入的操作日志未落库（action=' + (g.action || '-')
                    + '，重试 ' + (g.attempts || '-') + ' 次后失败：' + (g.error || '-')
                    + '）。开通事实请以上方 admin_req 台账为准，勿据此判定"未开通"。'
            });
        }

        const merged = derived.concat(logs);
        // 统一按时间倒序（derived 的时间来自 admin_req，可能与 license_log 交错）
        merged.sort((a, b) => String(b.time || '').localeCompare(String(a.time || '')));

        return json({
            success: true,
            code: code,
            logs: merged,
            count: merged.length,
            rawLogCount: logs.length,          // license_log 原始条数（不含叠加项）
            auditLedger: ledger,               // 自动开通台账（admin_req 事实源），无则 null
            auditGaps: gaps,                   // 审计缺口标记，无则 []
            auditReconciled: !!(ledger && gaps.length === 0)  // 台账在、且无缺口 = 审计自洽
        });

    } catch (error) {
        console.error('License logs query error:', error);
        return json({ success: false, error: '服务器内部错误，请稍后再试' }, 500);
    }
}
