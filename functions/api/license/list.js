// ============================================================================
//  list.js — 激活码列表查询 API（管理员专用）
//
//  路由：GET /api/license/list
//
//  查询参数：
//    status=unused|used|expired|disabled   按状态过滤（可选）
//    type=trial|personal|pro               按类型过滤（可选）
//    q=张三                                 按用户名/激活码/备注/机器码搜索（可选，机器码支持完整或前8位）
//
//  认证：Bearer token（platform_admin）
//
//  返回：
//    {
//      "success": true,
//      "data": [ { code, user, type, status, ... } ],
//      "count": 10,
//      "stats": { total, unused, used, expired, disabled }
//    }
// ============================================================================

import { parseAuthHeader, isPlatformAdmin } from '../_lib/auth.js';
import { getKV, listLicenses, sanitizeRecord, updateLicense } from './_lib/license-core.js';

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

// ★ 2026-09-08 版本显示对齐（惰性自愈）：历史 admin-approve 审核通过的记录
//   license.devices[].productClass/clientClass 缺失 → 激活码管理「类型」列只显
//   纯「标准版」，与激活审核「版本」列（🖥️桌面·离线标准版）不一致。
//   双数据源自愈（保证与用户管理/激活审核显示必然一致）：
//     源A admin_req（激活审核记录）：machineId 精确匹配 → appMode/appModeCarrier 派生
//     源B 诊所记录（system:clinics）：license.clinicName 定位诊所 → edition +
//        offlineCarrier 派生——与用户管理版本列【同一数据源】，兜底覆盖非审核
//        通道激活（直接发码→APP/桌面输码走 validate，无 admin_req）及索引截断遗漏
//   回填后持久化（一次性自愈）；稳态零开销：无缺失时直接短路，零额外 KV 读。
//   对齐 users.js 登录自愈 / admin-list 惰性清理的读路径自愈模式。
const BACKFILL_REQ_PREFIX = 'admin_req:';
const BACKFILL_REQ_INDEX = 'admin_req_index';
const BACKFILL_CLINICS_KEY = 'system:clinics';
const BACKFILL_REQ_SCAN_LIMIT = 800;   // admin_req 逐条读上限（KV 子请求保护，从最新往前取）

// 源B：诊所记录 → 端形态（clinic.edition: offline_*/cloud_* + offlineCarrier: desktop/app）
function deriveFromClinic(clinic) {
    if (!clinic) return null;
    const ed = String(clinic.edition || '');
    let pc = null;
    if (ed.indexOf('offline_') === 0) pc = 'offline';
    else if (ed.indexOf('cloud') === 0) pc = 'cloud';
    if (!pc) return null;
    const oc = String(clinic.offlineCarrier || '').toLowerCase();
    const cc = (pc === 'offline' && (oc === 'desktop' || oc === 'app')) ? oc : null;
    return { productClass: pc, clientClass: cc };
}

async function backfillDeviceClass(kv, records) {
    // 1. 找出缺端形态的设备 machineId（仅已绑定设备的记录；未使用激活码无设备，天然跳过）
    const needMid = new Set();
    for (const r of records) {
        if (!Array.isArray(r.devices)) continue;
        for (const d of r.devices) {
            if (d && d.machineId && !d.productClass) needMid.add(d.machineId);
        }
    }
    if (needMid.size === 0) return;   // 稳态短路：零额外 KV 读

    const map = new Map();

    // 2. 源A：扫描激活审核记录（activated 且 machineId 命中缺失集）
    //    同一设备多次激活：索引后写覆盖先写 → 最近一次审核结果生效
    try {
        const index = (await kv.get(BACKFILL_REQ_INDEX, 'json')) || [];
        const ids = Array.isArray(index) ? index.slice(-BACKFILL_REQ_SCAN_LIMIT) : [];
        const reqs = await Promise.all(ids.map(id =>
            kv.get(BACKFILL_REQ_PREFIX + id, 'json').catch(() => null)));
        for (const q of reqs) {
            if (!q || q.status !== 'activated' || !q.machineId || !needMid.has(q.machineId)) continue;
            const pc = (q.appMode === 'cloud') ? 'cloud'
                : ((q.appMode === 'local' || q.appMode === 'offline') ? 'offline' : null);
            if (!pc) continue;
            const cc = (q.appModeCarrier === 'desktop' || q.appModeCarrier === 'app')
                ? q.appModeCarrier : null;
            map.set(q.machineId, { productClass: pc, clientClass: cc });
        }
    } catch (e) {
        console.warn('[ListBackfill] 扫描激活审核记录失败:', e.message);
    }

    // 3. 源B：诊所记录兜底（源A未命中的 machineId；与用户管理显示同源）
    const remain = new Set([...needMid].filter(mid => !map.has(mid)));
    if (remain.size > 0) {
        try {
            const clinics = (await kv.get(BACKFILL_CLINICS_KEY, 'json')) || [];
            if (Array.isArray(clinics) && clinics.length) {
                for (const r of records) {
                    if (!Array.isArray(r.devices) || !r.clinicName) continue;
                    const missing = r.devices.filter(d =>
                        d && d.machineId && !d.productClass && remain.has(d.machineId));
                    if (!missing.length) continue;
                    // 同名诊所定位：多条时用激活手机号匹配诊所用户筛选，无 phone/未中取最近一条
                    let cands = clinics.filter(c => c && c.name === r.clinicName);
                    if (!cands.length) continue;
                    if (cands.length > 1 && r.phone) {
                        const matched = [];
                        for (const c of cands) {
                            const users = await kv.get('clinic:' + c.id + ':users', 'json').catch(() => null);
                            if (Array.isArray(users) &&
                                users.some(u => u && (u.username === r.phone || u.phone === r.phone))) {
                                matched.push(c);
                            }
                        }
                        if (matched.length) cands = matched;
                    }
                    const derived = deriveFromClinic(cands[cands.length - 1]);
                    if (derived) {
                        for (const d of missing) {
                            map.set(d.machineId, derived);
                            remain.delete(d.machineId);
                        }
                        console.log('[ListBackfill] 诊所兜底命中:', r.clinicName,
                            derived.productClass + '/' + (derived.clientClass || '-'));
                    }
                }
            }
        } catch (e) {
            console.warn('[ListBackfill] 诊所兜底扫描失败:', e.message);
        }
    }
    if (map.size === 0) return;

    // 4. 回填内存记录并持久化（updateLicense 读改写；失败不阻断列表返回）
    for (const r of records) {
        if (!Array.isArray(r.devices)) continue;
        let changed = false;
        for (const d of r.devices) {
            if (d && d.machineId && !d.productClass && map.has(d.machineId)) {
                const m = map.get(d.machineId);
                d.productClass = m.productClass;
                d.clientClass = m.clientClass;
                changed = true;
            }
        }
        if (changed && r.code) {
            try {
                await updateLicense(kv, r.code, { devices: r.devices });
                console.log('[ListBackfill] 已回填端形态:', r.code);
            } catch (e) {
                console.warn('[ListBackfill] 回填失败:', r.code, e.message);
            }
        }
    }
}

export async function onRequest(context) {
    const method = context.request.method;
    const url = new URL(context.request.url);

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
            return json({ success: false, error: '仅平台总管理员可查看激活码列表' }, 403);
        }

        const kv = getKV(context);
        if (!kv) {
            return json({ success: false, error: 'KV binding not found' }, 500);
        }

        const statusFilter = url.searchParams.get('status');
        const typeFilter = url.searchParams.get('type');
        const q = url.searchParams.get('q');

        // 获取所有激活码
        let records = await listLicenses(kv);

        // ★ 2026-09-08 惰性回填端形态（激活码管理「类型」列与激活审核「版本」列显示对齐）
        await backfillDeviceClass(kv, records);

        // 统计
        const stats = {
            total: records.length,
            unused: 0,
            used: 0,
            expired: 0,
            disabled: 0
        };
        for (const r of records) {
            if (stats[r.status] !== undefined) {
                stats[r.status]++;
            }
        }

        // 过滤
        if (statusFilter) {
            records = records.filter(r => r.status === statusFilter);
        }
        if (typeFilter) {
            records = records.filter(r => r.type === typeFilter);
        }
        if (q) {
            const lowerQ = q.toLowerCase();
            records = records.filter(r =>
                (r.code && r.code.toLowerCase().includes(lowerQ)) ||
                (r.user && r.user.toLowerCase().includes(lowerQ)) ||
                (r.username && r.username.toLowerCase().includes(lowerQ)) ||
                (r.note && r.note.toLowerCase().includes(lowerQ)) ||
                // ★ 2026-08-25 按机器码反查激活码：匹配旧 machineId 单值 + v4 devices 数组
                //   （此处 r 为 sanitize 前原始记录，含完整 32 位机器码；子串匹配，输入前 8 位亦可命中）
                (r.machineId && r.machineId.toLowerCase().includes(lowerQ)) ||
                (Array.isArray(r.devices) && r.devices.some(d => d.machineId && d.machineId.toLowerCase().includes(lowerQ)))
            );
        }

        // 按签发时间倒序
        records.sort((a, b) => {
            const ta = a.issuedAt ? new Date(a.issuedAt).getTime() : 0;
            const tb = b.issuedAt ? new Date(b.issuedAt).getTime() : 0;
            return tb - ta;
        });

        return json({
            success: true,
            data: records.map(sanitizeRecord),
            count: records.length,
            stats: stats
        });

    } catch (error) {
        console.error('License list error:', error);
        return json({ success: false, error: '服务器内部错误，请稍后再试' }, 500);
    }
}
