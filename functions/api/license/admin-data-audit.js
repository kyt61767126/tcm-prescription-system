// ============================================================================
//  admin-data-audit.js — 平台管理员"数据体检" API（2026-09-07 架构防御 C：自愈巡检）
//
//  路由：POST /api/license/admin-data-audit
//  认证：Bearer token（platform_admin）
//
//  请求体（action 二选一）：
//    { "action": "scan" }
//    { "action": "clean", "items": [ { "key": "order:BNZC-...", "type": "orphan_order" }, ... ] }
//
//  返回：
//    scan  → { success, scannedAt, summary:{total, byType}, issues:[{type,typeLabel,key,
//             reason,cleanable,cascadeKeys,detail}], truncated }
//    clean → { success, backupKey, summary:{deleted,skipped,failed}, results:[{key,type,
//             result, cascadeDeleted?, reason?}] }
//
//  ★ 背景（举一反三，三起事故的结构性根治）：
//    1. 孤儿 order: 映射（手工清 KV 漏删堆积 11 个——2026-09-06 实证）
//    2. 陈旧 active_order: 索引（同上 3 个）
//    3. 脏 key（device_version:{"success":false,...} 错误 JSON 当 machineId——2026-09-07 实证）
//    4. 过期 pending_payment（超 7 天弃单，admin-list 惰性清理兜底但依赖有人开列表）
//    5. free_pass_index 损坏（非数组/含幽灵手机号）
//
//  ★ 铁律（防误删）：
//    - scan 纯只读零副作用（不做任何 put/delete）
//    - clean 前逐键 get 重验证——复用 scan 同一 classify 函数（禁止两套判定逻辑，
//      判定漂移=误删事故源）；不匹配当前判定 → skip（可能已被 admin-list 惰性清理）
//    - 清理前整批备份 audit_backup:{ts}（cap 20 FIFO，超出删最老备份键）
//    - 数量保护：每前缀扫描上限 2000 键、报告上限 200 条（防未来膨胀拖死 Worker）
// ============================================================================

import { parseAuthHeader, isPlatformAdmin } from '../_lib/auth.js';
import { getKV } from './_lib/license-core.js';
import { KV_PREFIX, isValidMachineId, isValidOrderNo, isValidRequestId } from './_lib/schema-guard.js';

const PENDING_PAYMENT_EXPIRE_MS = 7 * 24 * 60 * 60 * 1000;   // 与 admin-list 同阈值
const ACTIVE_ORDER_MAX_AGE_MS = 48 * 60 * 60 * 1000;          // 与 write-service 同语义
const SCAN_KEY_LIMIT = 2000;    // 每前缀扫描上限
const REPORT_LIMIT = 200;       // 报告条数上限（防响应过大）
const BACKUP_INDEX_KEY = 'audit_backup_index';
const BACKUP_KEEP = 20;         // 备份保留份数 FIFO

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

// ============================================================================
// 判定函数（scan 与 clean 复用同一实现——防判定漂移导致误删）
//   返回 issue 对象或 null（null = 该键干净/不属于本类判定范围）
// ============================================================================

// order:{orderNo} 映射 → orphan_order / expired_pending_payment / null
async function classifyOrderMapping(kv, key, orderNo) {
    const raw = await kv.get(key, 'text').catch(() => null);
    if (raw === null) return null;
    let requestId = null, phone = '';
    try {
        const o = JSON.parse(raw);
        if (o && typeof o === 'object') { requestId = o.requestId || null; phone = o.phone || ''; }
        else if (typeof o === 'string') requestId = o;   // 老格式纯 text
    } catch (_) { requestId = null; }
    if (!requestId) {
        return { type: 'orphan_order', key, reason: '映射值无 requestId（损坏或非 JSON）',
            cascadeKeys: [], detail: { rawSnippet: String(raw).slice(0, 40) } };
    }
    const rec = await kv.get(KV_PREFIX.adminReq + requestId, 'json').catch(() => null);
    if (!rec) {
        return { type: 'orphan_order', key, reason: '映射指向的申请记录不存在（admin_req 已删，order 映射漏删）',
            cascadeKeys: [], detail: { requestId, phone } };
    }
    // 指向过期弃单（pending_payment 超 7 天）：主键是 admin_req，级联删 order + active_order
    if (rec.status === 'pending_payment') {
        const t = new Date(rec.submittedAt || rec.createdAt || 0).getTime();
        const ageDays = Math.floor((Date.now() - t) / 86400000);
        if ((Date.now() - t) > PENDING_PAYMENT_EXPIRE_MS) {
            return { type: 'expired_pending_payment', key: KV_PREFIX.adminReq + requestId,
                reason: '待付款订单超 7 天未付款（弃单）',
                cascadeKeys: [key].concat(rec.machineId ? [KV_PREFIX.activeOrder + rec.machineId] : []),
                detail: { requestId, orderNo: rec.orderNo || orderNo, phone: rec.phone, ageDays } };
        }
    }
    return null;
}

// active_order:{machineId} → stale_active_order / null
async function classifyActiveOrder(kv, key, machineId) {
    const entry = await kv.get(key, 'json').catch(() => null);
    if (!entry || !entry.requestId) return null;   // 空值无清理价值（list 即可跳过）
    const rec = await kv.get(KV_PREFIX.adminReq + entry.requestId, 'json').catch(() => null);
    let stale = false, reason = '';
    if (!rec) { stale = true; reason = '目标申请记录不存在（孤儿索引）'; }
    else if (rec.status !== 'pending_payment' && rec.status !== 'pending') {
        stale = true; reason = '订单已终态（' + rec.status + '），索引过期';
    } else {
        const t = new Date(rec.submittedAt || rec.createdAt || entry.createdAt || 0).getTime();
        if ((Date.now() - t) > ACTIVE_ORDER_MAX_AGE_MS) { stale = true; reason = '订单超 48h 仍在进行中状态（陈旧索引）'; }
    }
    if (!stale) return null;
    return { type: 'stale_active_order', key, reason,
        cascadeKeys: [], detail: { machineId: String(machineId).slice(0, 24), requestId: entry.requestId } };
}

// 裸 key 形状 → dirty_key / null（宽松取向：正则已对存量真实键全量核对零误伤）
function classifyKeyShape(prefix, key) {
    const id = key.slice(prefix.length);
    let bad = false;
    if (prefix === KV_PREFIX.deviceVersion || prefix === KV_PREFIX.testMachine || prefix === KV_PREFIX.activeOrder) {
        bad = !isValidMachineId(id);
    } else if (prefix === KV_PREFIX.order) {
        bad = !isValidOrderNo(id);
    } else if (prefix === KV_PREFIX.adminReq) {
        bad = !isValidRequestId(id);
    } else {
        return null;
    }
    if (!bad) return null;
    return { type: 'dirty_key', key, reason: 'key 的 ID 段不匹配格式（脏键，多为客户端桥错误值写入）',
        cascadeKeys: [], detail: { idSnippet: id.slice(0, 40) } };
}

// free_pass_index → free_pass_index_broken / null
async function classifyFreePassIndex(kv) {
    const idx = await kv.get('free_pass_index', 'json').catch(() => null);
    if (idx === null) return null;   // 无索引=正常（从未用过白名单功能）
    if (!Array.isArray(idx)) {
        return { type: 'free_pass_index_broken', key: 'free_pass_index',
            reason: '索引非数组（损坏）', cascadeKeys: [],
            detail: { valueSnippet: JSON.stringify(idx).slice(0, 40) } };
    }
    const ghosts = [];
    for (const ph of idx.slice(0, SCAN_KEY_LIMIT)) {
        const rec = await kv.get(KV_PREFIX.freePass + ph, 'json').catch(() => null);
        if (!rec) ghosts.push(ph);
    }
    if (ghosts.length === 0) return null;
    return { type: 'free_pass_index_broken', key: 'free_pass_index',
        reason: '索引含 ' + ghosts.length + ' 个幽灵手机号（记录已删，索引漏同步）',
        cascadeKeys: [], detail: { ghosts: ghosts.slice(0, 20) } };
}

// ============================================================================
// scan：纯只读全量体检
// ============================================================================
const TYPE_LABELS = {
    orphan_order: '孤儿订单映射',
    stale_active_order: '陈旧进行中订单索引',
    dirty_key: '脏键（格式非法）',
    expired_pending_payment: '过期未付款申请（超7天）',
    free_pass_index_broken: '免费白名单索引损坏'
};

async function scanAll(kv) {
    const issues = [];
    let truncated = false;
    const push = (issue) => {
        if (issues.length >= REPORT_LIMIT) { truncated = true; return; }
        issues.push(Object.assign({ typeLabel: TYPE_LABELS[issue.type] || issue.type, cleanable: true }, issue));
    };

    // 1) order: 前缀 → orphan + expired
    let listed = await kv.list({ prefix: KV_PREFIX.order, limit: SCAN_KEY_LIMIT }).catch(() => null);
    while (listed && Array.isArray(listed.keys)) {
        for (const k of listed.keys) {
            const shape = classifyKeyShape(KV_PREFIX.order, k.name);
            if (shape) { push(shape); continue; }
            const issue = await classifyOrderMapping(kv, k.name, k.name.slice(KV_PREFIX.order.length));
            if (issue) push(issue);
        }
        if (!listed.cursor) break;
        listed = await kv.list({ prefix: KV_PREFIX.order, limit: SCAN_KEY_LIMIT, cursor: listed.cursor }).catch(() => null);
    }

    // 2) active_order: 前缀 → stale + dirty
    listed = await kv.list({ prefix: KV_PREFIX.activeOrder, limit: SCAN_KEY_LIMIT }).catch(() => null);
    while (listed && Array.isArray(listed.keys)) {
        for (const k of listed.keys) {
            const shape = classifyKeyShape(KV_PREFIX.activeOrder, k.name);
            if (shape) { push(shape); continue; }
            const issue = await classifyActiveOrder(kv, k.name, k.name.slice(KV_PREFIX.activeOrder.length));
            if (issue) push(issue);
        }
        if (!listed.cursor) break;
        listed = await kv.list({ prefix: KV_PREFIX.activeOrder, limit: SCAN_KEY_LIMIT, cursor: listed.cursor }).catch(() => null);
    }

    // 3) device_version: / test_machine: / admin_req: → dirty_key
    for (const prefix of [KV_PREFIX.deviceVersion, KV_PREFIX.testMachine, KV_PREFIX.adminReq]) {
        let l = await kv.list({ prefix, limit: SCAN_KEY_LIMIT }).catch(() => null);
        while (l && Array.isArray(l.keys)) {
            for (const k of l.keys) {
                const shape = classifyKeyShape(prefix, k.name);
                if (shape) push(shape);
            }
            if (!l.cursor) break;
            l = await kv.list({ prefix, limit: SCAN_KEY_LIMIT, cursor: l.cursor }).catch(() => null);
        }
    }

    // 4) free_pass_index
    const fpIssue = await classifyFreePassIndex(kv);
    if (fpIssue) push(fpIssue);

    const byType = {};
    for (const it of issues) byType[it.type] = (byType[it.type] || 0) + 1;
    return { scannedAt: new Date().toISOString(), summary: { total: issues.length, byType }, issues, truncated };
}

// ============================================================================
// clean：重验证 → 备份 → 删除（幂等）
// ============================================================================
async function backupAndRotate(kv, backupId, items, operator) {
    // FIFO：超 20 份删最老
    const idx = (await kv.get(BACKUP_INDEX_KEY, 'json').catch(() => null)) || [];
    if (Array.isArray(idx) && idx.length >= BACKUP_KEEP) {
        const drop = idx.slice(BACKUP_KEEP - 1);
        for (const old of drop) await kv.delete('audit_backup:' + old).catch(() => null);
    }
    await kv.put('audit_backup:' + backupId, JSON.stringify({
        backupId, createdAt: new Date().toISOString(), operator: operator || 'platform_admin', items
    }));
    const newIdx = [backupId].concat((Array.isArray(idx) ? idx : []).filter(i => i !== backupId)).slice(0, BACKUP_KEEP);
    await kv.put(BACKUP_INDEX_KEY, JSON.stringify(newIdx));
}

async function cleanItems(kv, items, operator) {
    const results = [];
    const backupItems = [];
    let deleted = 0, skipped = 0, failed = 0;

    for (const item of (Array.isArray(items) ? items : []).slice(0, REPORT_LIMIT)) {
        const { key, type } = item || {};
        if (!key || !type) { results.push({ key: String(key || ''), type, result: 'failed', reason: '参数缺失' }); failed++; continue; }

        // ★ 重验证：复用 scan 同一 classify（判定漂移=误删事故源）
        let verified = null;
        try {
            if (type === 'orphan_order' || type === 'expired_pending_payment') {
                // expired 的报告 key 是 admin_req:，需经其 order 映射重新判定
                verified = await reverifyOrderRelated(kv, key, type);
            } else if (type === 'stale_active_order') {
                verified = (await classifyActiveOrder(kv, key, key.slice(KV_PREFIX.activeOrder.length)));
            } else if (type === 'dirty_key') {
                verified = classifyKeyShape(matchPrefix(key), key);
            } else if (type === 'free_pass_index_broken') {
                verified = await classifyFreePassIndex(kv);
            }
        } catch (_) { verified = null; }

        if (!verified) {
            results.push({ key, type, result: 'skipped', reason: '键已不存在或状态已变化（可能已被自动清理）' });
            skipped++;
            continue;
        }

        // ★ 主键存在性检查（幂等关键）：dirty_key 形状判定不查存在——已删的脏键
        //   重复 clean 会误报 deleted；统一物理存在性门禁，不存在一律 skip
        const mainExists = await kv.get(key, 'text').catch(() => null);
        if (mainExists === null) {
            results.push({ key, type, result: 'skipped', reason: '键已不存在（可能已被本轮或前轮清理）' });
            skipped++;
            continue;
        }

        try {
            const cascadeDeleted = [];
            if (type === 'free_pass_index_broken') {
                // 重建：以实际 free_pass: 键为准
                const oldVal = await kv.get(key, 'text').catch(() => null);
                if (oldVal !== null) backupItems.push({ key, type, value: oldVal });
                let l = await kv.list({ prefix: KV_PREFIX.freePass, limit: SCAN_KEY_LIMIT }).catch(() => null);
                const phones = [];
                while (l && Array.isArray(l.keys)) {
                    for (const k of l.keys) phones.push(k.name.slice(KV_PREFIX.freePass.length));
                    if (!l.cursor) break;
                    l = await kv.list({ prefix: KV_PREFIX.freePass, limit: SCAN_KEY_LIMIT, cursor: l.cursor }).catch(() => null);
                }
                await kv.put(key, JSON.stringify(phones));
                cascadeDeleted.push('重建为 ' + phones.length + ' 个真实手机号');
            } else {
                // 备份主键 + 级联键原值
                const mainVal = await kv.get(key, 'text').catch(() => null);
                if (mainVal !== null) backupItems.push({ key, type, value: mainVal });
                await kv.delete(key);
                for (const ck of (verified.cascadeKeys || [])) {
                    if (ck === key) continue;
                    const cv = await kv.get(ck, 'text').catch(() => null);
                    if (cv !== null) { backupItems.push({ key: ck, type: type + ':cascade', value: cv }); await kv.delete(ck); cascadeDeleted.push(ck); }
                }
            }
            results.push({ key, type, result: 'deleted', cascadeDeleted });
            deleted++;
        } catch (e) {
            results.push({ key, type, result: 'failed', reason: e.message });
            failed++;
        }
    }

    // 整批备份（有删除动作才写备份键）
    let backupKey = null;
    if (backupItems.length > 0) {
        backupKey = 'audit_backup:' + new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, 'Z').replace('T', 'T');
        await backupAndRotate(kv, backupKey.slice('audit_backup:'.length), backupItems, operator);
    }
    return { backupKey, summary: { deleted, skipped, failed }, results };
}

// admin_req:/order: 相关的重验证（expired 主键是 admin_req，经 order: 映射链复判）
async function reverifyOrderRelated(kv, key, type) {
    if (type === 'orphan_order') {
        return await classifyOrderMapping(kv, key, key.slice(KV_PREFIX.order.length));
    }
    // expired_pending_payment：key = admin_req:{rid}，需找到指向它的 order 映射复判
    const rid = key.slice(KV_PREFIX.adminReq.length);
    let l = await kv.list({ prefix: KV_PREFIX.order, limit: SCAN_KEY_LIMIT }).catch(() => null);
    while (l && Array.isArray(l.keys)) {
        for (const k of l.keys) {
            const issue = await classifyOrderMapping(kv, k.name, k.name.slice(KV_PREFIX.order.length));
            if (issue && issue.type === 'expired_pending_payment' && issue.key === key) return issue;
        }
        if (!l.cursor) break;
        l = await kv.list({ prefix: KV_PREFIX.order, limit: SCAN_KEY_LIMIT, cursor: l.cursor }).catch(() => null);
    }
    return null;
}

function matchPrefix(key) {
    for (const p of [KV_PREFIX.order, KV_PREFIX.activeOrder, KV_PREFIX.deviceVersion, KV_PREFIX.testMachine, KV_PREFIX.adminReq]) {
        if (key.startsWith(p)) return p;
    }
    return '';
}

// ============================================================================
// onRequest
// ============================================================================
export async function onRequest(context) {
    const method = context.request.method;

    if (method === 'OPTIONS') {
        return new Response(null, { status: 200, headers: corsHeaders() });
    }
    if (method !== 'POST') {
        return json({ success: false, error: 'Method not allowed' }, 405);
    }

    try {
        const currentUser = await parseAuthHeader(context.request, context.env);
        if (!currentUser || !isPlatformAdmin(currentUser)) {
            return json({ success: false, error: '仅平台总管理员可执行数据体检' }, 403);
        }

        const kv = getKV(context);
        if (!kv) {
            return json({ success: false, error: 'KV binding not found' }, 500);
        }

        const body = await context.request.json().catch(() => ({}));
        const action = body.action;
        const operator = (currentUser && (currentUser.username || currentUser.name)) || 'platform_admin';

        if (action === 'scan') {
            const report = await scanAll(kv);
            return json(Object.assign({ success: true }, report));
        }

        if (action === 'clean') {
            const result = await cleanItems(kv, body.items, operator);
            console.log('[DataAudit] 清理完成:', JSON.stringify(result.summary), '备份:', result.backupKey, '操作人:', operator);
            return json(Object.assign({ success: true }, result));
        }

        return json({ success: false, error: 'action 必须是 scan/clean' }, 400);
    } catch (e) {
        return json({ success: false, error: e.message || 'Internal server error' }, 500);
    }
}
