// ============================================================================
//  reconcile.js — 授权对账/诊断端点（2026-10-17 S1-O3）
//
//  路由：POST /api/license/reconcile
//
//  定位：解决「服务端授权记录 × 客户端本地 license.dat/license:code」无声分裂
//    （2026-10-17 P40 事故：KV 码记录被手工重置为 unused、设备本地 license.dat
//     仍有效 → 登录闸 entitlement=NO_LICENSE 反复弹激活框，客服只能 wrangler 手查）。
//    本端点把「同一 machineId 的服务端真实状态 + 客户端上报的本地状态」合并成
//    一份可执行的对账结果（actions），供客户端启动自检与后台「激活诊断」页消费。
//
//  铁律：
//    1. 默认【不写授权业务 KV】——唯一 KV 写是 IP/码级频控桶计数（infra 桶）。
//    2. 绝不伪造激活：repair 仅平台管理员可调，且只允许两类「有证据」的修复：
//       (a) 重建派生索引 mid_owners/mid_idx（不触碰授权记录）；
//       (b) 凭 redeemedDevices 台账（=该机确曾持管理员令牌兑换该码）+ 码 unused
//           + 配额未满 三条件，把该机补绑为该码设备（写 license 记录 + 审计日志
//           action=reconcile-rebind）；任何条件不满足一律 repairFailed，不制造授权。
//    3. repair 需平台管理员 Bearer token（platform_admin），非管理员只返回 repairDenied。
//    4. 不返回 licenseBase64；摘要不返回 phone/user。
//    5. 匿名调用对「未绑定本机」的码只回 codeExists 布尔，不回任何记录摘要
//       （对齐 lookup.js 的 bound 语义，杜绝匿名码探测 oracle）。
//
//  请求体：
//    {
//      "machineId": "06eded70c88eb835...",        // 必填，schema-guard 白名单
//      "code": "BNZC-XXXX-XXXX-XXXX-XXXX",        // 可选：客户端当前本地码（用于识别错位）
//      "client": {                                // 可选：客户端本地状态（仅用于对账判定）
//        "licenseStatus": "valid|invalid|missing",//   本地 license.dat 状态（桥 getStatus）
//        "code": "BNZC-..."                       //   本地 license:code 实际值
//      },
//      "repair": false                            // 可选：管理员受控修复（见铁律 2）
//    }
//
//  返回：
//    {
//      "success": true,
//      "state": "LICENSED|NO_LICENSE|LICENSE_EXPIRED|LICENSE_REVOKED",
//      "license": { code,status,type,edition,expiresAt,clinicName,maxDevices,devicesCount,
//                   productClass,clientClass } | null,
//      "codeExists": true|false,
//      "codeRecord": { ...摘要 } | null,          // 仅管理员或已绑定本机时返回
//      "client": { licenseStatus, code },
//      "actions": ["NO_ACTION"|"CLEAR_STALE_CODE"|"REINSTALL_LICENSE"|"SERVER_RECORD_MISMATCH"|
//                  "COMPLETE_ACTIVATION"|"REACTIVATE"|"RENEW"|"CONTACT_SUPPORT"],
//      "repaired": ["mid_index_refresh"|"rebind_by_redeem_ledger"] | [],
//      "repairDenied": false, "repairFailed": false, "repairReason": null,
//      "traceId": "rec-xxxxxxxx",
//      "serverTime": "2026-10-17T..."
//    }
// ============================================================================

import {
    getKV, getLicense, getDevices, getMaxDevices, checkRateLimit, checkCodeRateLimit,
    findLicensesByMachine, getDeviceBlock, versionOf, saveLicense, appendLicenseLog
} from './_lib/license-core.js';
import { isValidMachineId, isValidLicenseCode } from './_lib/schema-guard.js';
import { adjudicate, ENTITLEMENT_STATES } from './entitlement.js';
import { parseAuthHeader, isPlatformAdmin } from '../_lib/auth.js';

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

// CORS 按请求计算（不使用模块级 _currentRequest：同 isolate 并发请求会串用 Origin）
function corsHeaders(request) {
    const origin = request ? (request.headers.get('Origin') || '') : '';
    let allowedOrigin;
    if (origin === 'null') allowedOrigin = 'null'; // 桌面 file:// 渲染层兜底（与 entitlement 同口径）
    else allowedOrigin = (origin && ALLOWED_ORIGINS.includes(origin)) ? origin : 'https://tcm-prescription-system.pages.dev';
    return {
        'Access-Control-Allow-Origin': allowedOrigin,
        'Vary': 'Origin',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Request-ID',
        'Access-Control-Max-Age': '86400',
        'Content-Type': 'application/json'
    };
}
function json(data, status = 200, request = null, extraHeaders = null) {
    const headers = corsHeaders(request);
    if (extraHeaders) Object.keys(extraHeaders).forEach(function (k) { headers[k] = extraHeaders[k]; });
    return new Response(JSON.stringify(data), { status: status, headers: headers });
}
// 仅信任 Cloudflare 注入的 CF-Connecting-IP（不接受可伪造的 X-Forwarded-For）
function getClientIP(request) {
    return (request && request.headers.get('CF-Connecting-IP')) || 'unknown';
}
function makeTraceId() {
    try {
        const b = new Uint8Array(6);
        crypto.getRandomValues(b);
        return 'rec-' + Array.from(b).map(x => x.toString(16).padStart(2, '0')).join('');
    } catch (_) {
        return 'rec-' + Date.now().toString(16);
    }
}

// 服务端权威摘要（严格脱敏：不含 phone/user/licenseBase64）
function summarizeRecord(record) {
    if (!record) return null;
    const devices = getDevices(record);
    const d0 = devices[0] || {};
    return {
        code: record.code || null,
        status: record.status || null,
        type: record.type || null,
        edition: versionOf(record.type || record.edition),
        expiresAt: record.expiresAt || null,
        clinicName: record.clinicName || record.activatedClinicName || null,
        maxDevices: getMaxDevices(record),
        devicesCount: devices.length,
        productClass: record.productClass || d0.productClass || null,
        clientClass: d0.clientClass || null
    };
}

function isRecordBoundTo(record, machineId) {
    return !!record && getDevices(record).some(function (d) { return d && String(d.machineId) === String(machineId); });
}

// actions 判定（纯函数，便于单测）：
//  - LICENSED：本地码错位→清码；本地文件明确缺失/失效→重装；否则 NO_ACTION
//  - NO_LICENSE：本地 license 有效但服务端无授权 → SERVER_RECORD_MISMATCH（只诊断，不自动修复）；
//                 入参码 unused→COMPLETE_ACTIVATION；expired→RENEW；disabled→CONTACT_SUPPORT；否则 REACTIVATE
//  - EXPIRED→RENEW；REVOKED→CONTACT_SUPPORT
export function computeReconcileActions(state, license, codeRecord, client) {
    const actions = [];
    const c = client || {};
    const localCode = String(c.code || '').trim().toUpperCase();
    const licStatus = String(c.licenseStatus || '').trim().toLowerCase();
    if (state === ENTITLEMENT_STATES.LICENSED) {
        if (localCode && license && license.code && localCode !== String(license.code).toUpperCase()) {
            actions.push('CLEAR_STALE_CODE');
        }
        // 仅明确缺失/失效才重装；未上报（''）视为未知，不误报
        if (licStatus === 'missing' || licStatus === 'invalid') {
            actions.push('REINSTALL_LICENSE');
        }
        if (!actions.length) actions.push('NO_ACTION');
        return actions;
    }
    if (state === ENTITLEMENT_STATES.NO_LICENSE) {
        // 本地 license 有效 + 服务端无授权 = 经典「分裂」场景：只给诊断标识，
        // 自动修复必须走管理员受控 repair（redeemedDevices 台账证据），客户端不得自愈。
        if (licStatus === 'valid') {
            actions.push('SERVER_RECORD_MISMATCH');
            return actions;
        }
        const st = codeRecord ? String(codeRecord.status || '') : '';
        if (st === 'unused') actions.push('COMPLETE_ACTIVATION');
        else if (st === 'expired') actions.push('RENEW');
        else if (st === 'disabled') actions.push('CONTACT_SUPPORT');
        else actions.push('REACTIVATE');
        return actions;
    }
    if (state === ENTITLEMENT_STATES.LICENSE_EXPIRED) {
        actions.push('RENEW');
        return actions;
    }
    if (state === ENTITLEMENT_STATES.LICENSE_REVOKED) {
        actions.push('CONTACT_SUPPORT');
        return actions;
    }
    actions.push('CONTACT_SUPPORT');
    return actions;
}

function normalizeClientClass(v) {
    const s = String(v || '').trim().toLowerCase();
    return (s === 'app' || s === 'desktop') ? s : null;
}

export async function onRequest(context) {
    const request = context.request;
    const method = request.method;
    if (method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request) });
    const traceId = makeTraceId();
    if (method !== 'POST') return json({ success: false, error: 'Method not allowed', traceId }, 405, request);

    try {
        const kv = getKV(context);
        if (!kv) return json({ success: false, error: 'KV binding not found', traceId }, 500, request);

        const ip = getClientIP(request);
        const rateOk = await checkRateLimit(kv, `recon_${ip}`, 40);
        if (!rateOk.allowed) {
            return json({ success: false, error: '请求过于频繁，请稍后再试', traceId }, 429, request, { 'Retry-After': '60' });
        }

        const rawBody = await request.json().catch(() => null);
        const body = (rawBody && typeof rawBody === 'object') ? rawBody : {};
        const machineId = String(body.machineId || '').trim();
        const rawCode = body.code ? String(body.code).trim().toUpperCase() : '';
        const code = (rawCode && isValidLicenseCode(rawCode)) ? rawCode : '';
        const client = (body.client && typeof body.client === 'object') ? {
            licenseStatus: String(body.client.licenseStatus || '').slice(0, 16).toLowerCase(),
            code: String(body.client.code || '').trim().toUpperCase().slice(0, 64)
        } : { licenseStatus: '', code: '' };

        if (!machineId) return json({ success: false, error: '缺少 machineId', traceId }, 400, request);
        if (!isValidMachineId(machineId)) return json({ success: false, error: '机器 ID 格式错误', traceId }, 400, request);
        if (rawCode && !code) return json({ success: false, error: '激活码格式错误', traceId }, 400, request);

        // 管理员身份（决定诊断详细度与 repair 权限）；匿名请求不因此失败
        let currentUser = null;
        try { currentUser = await parseAuthHeader(request, context.env); } catch (_) { currentUser = null; }
        const isAdminUser = !!(currentUser && isPlatformAdmin(currentUser));

        // 匿名 + 带码：码级短时频控（防半知码枚举；管理员/诊断页不受限）
        if (!isAdminUser && code) {
            const codeRate = await checkCodeRateLimit(kv, code, 5);
            if (!codeRate.allowed) {
                return json({ success: false, error: '请求过于频繁，请稍后再试', traceId }, 429, request, { 'Retry-After': '60' });
            }
        }

        // 已封锁设备：与 entitlement 同口径拒绝
        const block = await getDeviceBlock(kv, machineId);
        if (block) {
            return json({ success: false, error: '设备安全校验未通过，请更换设备或联系客服处理', traceId }, 403, request);
        }

        // 纯只读裁决（与 entitlement 同源，不引入第二套判定）
        let ent = await adjudicate(kv, machineId, code);

        // ★ 2026-10-17 S1-O3（代码审查修正）：带码快路径 NO_LICENSE 时，用 machineId
        //   再裁决一次——本地残留/错位码会让码快路径查不到绑定，但 mid 索引才是本机真值；
        //   命中 LICENSED 即「码错位」，后续 actions 才会产出 CLEAR_STALE_CODE（原死分支）。
        if (ent && ent.state === ENTITLEMENT_STATES.NO_LICENSE && code) {
            try {
                const entMid = await adjudicate(kv, machineId, '');
                if (entMid && entMid.state === ENTITLEMENT_STATES.LICENSED) ent = entMid;
            } catch (_) { /* 二次裁决失败保留原结果（fail-safe） */ }
        }

        // 本机授权记录摘要：只在「记录确实绑定本机」时返回，杜绝匿名码探测
        let license = null;
        if (ent && ent.licenseCode && ent.state && ent.state !== ENTITLEMENT_STATES.NO_LICENSE) {
            const rec = await getLicense(kv, ent.licenseCode).catch(() => null);
            if (isRecordBoundTo(rec, machineId)) license = summarizeRecord(rec);
        }

        // 入参码记录：匿名未绑定 → 只回 codeExists；管理员/已绑定才回摘要
        let codeExists = false;
        let codeRecord = null;
        let codeStatusRec = null;
        let codeRecBound = false;
        if (code) {
            const raw = await getLicense(kv, code).catch(() => null);
            codeExists = !!raw;
            codeRecBound = isRecordBoundTo(raw, machineId);
            // actions 判定用的码状态（内部使用；仅管理员/已绑定才可见，匿名不构成状态 oracle）
            if (raw && (isAdminUser || codeRecBound)) {
                codeRecord = summarizeRecord(raw);
                codeStatusRec = { status: raw.status || '' };
            }
        }

        let actions = computeReconcileActions(ent.state, license, codeStatusRec, {
            licenseStatus: client.licenseStatus,
            code: client.code || code
        });

        // ── repair（管理员显式请求；仅两类有证据的修复，绝不伪造授权）──────────
        let repaired = [];
        let repairDenied = false;
        let repairFailed = false;
        let repairReason = null;
        if (body.repair === true) {
            if (!isAdminUser) {
                repairDenied = true;
                repairReason = 'admin_required';
            } else if (ent.state === ENTITLEMENT_STATES.LICENSED) {
                // (a) 重建派生索引（写索引 ≠ 改授权）
                try {
                    const hits = await findLicensesByMachine(kv, machineId, { forceScan: true });
                    if (hits && hits.length > 0) {
                        repaired.push('mid_index_refresh');
                        if (code) {
                            await appendLicenseLog(kv, code, {
                                action: 'reconcile-index-refresh',
                                time: new Date().toISOString(),
                                ip: ip,
                                operator: currentUser.username,
                                detail: `machineId=${machineId.slice(0, 8)}...`
                            }).catch(() => {});
                        }
                    } else {
                        repairFailed = true;
                        repairReason = 'no_bound_record';
                    }
                } catch (e) {
                    repairFailed = true;
                    repairReason = 'index_refresh_error';
                    console.warn('[reconcile] repair 索引重建失败:', e && e.message);
                }
            } else if (ent.state === ENTITLEMENT_STATES.NO_LICENSE && code) {
                // (b) 凭 redeemedDevices 台账证据补绑（P40 场景：令牌已兑、码记录被重置 unused）
                const rec = await getLicense(kv, code).catch(() => null);
                const ledger = rec && Array.isArray(rec.redeemedDevices) ? rec.redeemedDevices : [];
                const hasLedgerEvidence = ledger.indexOf(String(machineId)) !== -1;
                if (!rec) {
                    repairFailed = true; repairReason = 'code_not_found';
                } else if (String(rec.status) !== 'unused') {
                    repairFailed = true; repairReason = 'code_status_' + String(rec.status);
                } else if (!hasLedgerEvidence) {
                    repairFailed = true; repairReason = 'no_redeem_evidence';
                } else if (getDevices(rec).length >= getMaxDevices(rec)) {
                    repairFailed = true; repairReason = 'quota_full';
                } else {
                    try {
                        const now = new Date().toISOString();
                        const devices = getDevices(rec).filter(function (d) { return d && String(d.machineId) !== String(machineId); });
                        devices.push({
                            machineId: machineId,
                            activatedAt: now,
                            clinicName: rec.clinicName || rec.activatedClinicName || '',
                            productClass: rec.productClass || null,
                            clientClass: normalizeClientClass(body.clientClass),
                            activatedIp: ip,
                            repairSource: 'reconcile-rebind'
                        });
                        const updated = Object.assign({}, rec, {
                            devices: devices,
                            status: 'used',
                            activatedAt: rec.activatedAt || now,
                            firstActivatedAt: rec.firstActivatedAt || rec.activatedAt || now,
                            activatedIp: ip,
                            activatedClinicName: rec.activatedClinicName || rec.clinicName || ''
                        });
                        if (!updated.machineId) updated.machineId = machineId;
                        await saveLicense(kv, updated);
                        await appendLicenseLog(kv, code, {
                            action: 'reconcile-rebind',
                            time: now,
                            ip: ip,
                            operator: currentUser.username,
                            detail: `machineId=${machineId.slice(0, 8)}... evidence=redeemedDevices devicesCount=${devices.length}/${getMaxDevices(rec)}`
                        }).catch(() => {});
                        repaired.push('rebind_by_redeem_ledger');
                        console.log('[reconcile] repair rebind 完成:', String(code).slice(0, 12), 'by=', currentUser.username);
                        // 重新裁决并刷新响应（仅本次请求，不改变默认只读语义）
                        ent = await adjudicate(kv, machineId, code);
                        const rec2 = await getLicense(kv, code).catch(() => null);
                        if (rec2 && isRecordBoundTo(rec2, machineId)) license = summarizeRecord(rec2);
                        if (isAdminUser && rec2) codeRecord = summarizeRecord(rec2);
                        actions = computeReconcileActions(ent.state, license, { status: rec2 ? rec2.status : '' }, {
                            licenseStatus: client.licenseStatus, code: client.code || code
                        });
                    } catch (e) {
                        repairFailed = true;
                        repairReason = 'rebind_error';
                        console.warn('[reconcile] repair rebind 失败:', e && e.message);
                    }
                }
            } else {
                repairFailed = true;
                repairReason = 'repair_not_applicable';
            }
        }

        return json({
            success: true,
            state: ent.state,
            license: license,
            codeExists: codeExists,
            codeRecord: codeRecord,
            client: client,
            actions: actions,
            repaired: repaired,
            repairDenied: repairDenied,
            repairFailed: repairFailed,
            repairReason: repairReason,
            traceId: traceId,
            serverTime: new Date().toISOString()
        }, 200, request);
    } catch (error) {
        console.error('[reconcile] error:', error);
        return json({ success: false, error: '服务器内部错误，请稍后再试', traceId }, 500, request);
    }
}
