// ============================================================================
//  admin-device-reset.js — 测试设备后台记录一键清理 API（2026-09-09）
//
//  路由：POST /api/license/admin-device-reset
//
//  认证：Bearer token（platform_admin）
//
//  请求体：
//    { "target": "手机号|machineId|hwFp", "confirm": false }
//      target: 三 ID 一体匹配（phone / machineId / hwFp 全等）
//      confirm: 缺省/ false = 演练模式（只扫描返回清单，不删除）
//               true       = 执行模式（服务端重新扫描后删除 + 索引联动 + 复验）
//
//  返回（演练）：
//    { success, mode:"dry-run", targetKind, records:[{key,kind,desc,warn}],
//      indexPreview: { reqIndex, licIndex, clinics } }
//  返回（执行）：
//    { success, mode:"execute", deleted:[key], indexesUpdated:[...],
//      verifyFailed: 0, hint: "客户端还需本地清理（桌面 测试重置.bat / 手机卸载重装）" }
//
//  清理范围（与 tools/device-reset.cjs / KNOWLEDGE 三十六附 Runbook 一致）：
//    trial_fp:{hwFp} / admin_req:{rid}(走 deleteAdminRequest 原子服务) /
//    license:{code} + license_log:{code} / device_version:{mid} /
//    admin_phone:{phone} / clinic:{id}:users + system:clinics 条目 /
//    索引：admin_req_index(Service 维护) / system:license_index / system:clinics
//
//  安全设计（双保险，脚本同款）：
//    1. 演练默认——confirm 不为 true 绝不删
//    2. 付费客户警示——activated/used/active/有 orderNo 的记录 warn=true
//    3. 执行模式服务端重新扫描（不信任前端回传清单，防 TOCTOU/伪造）
// ============================================================================

import { parseAuthHeader, isPlatformAdmin } from '../_lib/auth.js';
import { getKV } from './_lib/license-core.js';
import { deleteAdminRequest } from './_lib/license-write-service.js';

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
    const allowedOrigin = (origin && ALLOWED_ORIGINS.includes(origin)) ? origin : 'https://tcm-prescription-system.pages.dev';
    return {
        'Access-Control-Allow-Origin': allowedOrigin,
        'Vary': 'Origin',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Request-ID',
        'Access-Control-Max-Age': '86400',
        'Content-Type': 'application/json'
    };
}

function json(data, status, origin) {
    return new Response(JSON.stringify(data), { status, headers: corsHeaders(origin) });
}

// —— 三 ID 归一识别 ——
function classifyTarget(t) {
    if (/^1[3-9]\d{9}$/.test(t)) return '手机号';
    if (/^[a-f0-9]{64}$/i.test(t)) return 'hwFp（试用指纹）';
    if (/^[A-Za-z0-9_-]{8,64}$/.test(t)) return 'machineId';
    return null; // 非法格式
}

// ============================================================================
//  扫描：三 ID 一体匹配，返回 { records, reqIds, licCodes, clinicIds }
//  records: [{ key, kind, desc, warn }]；warn=true 为疑似真实客户/已付款
// ============================================================================
async function scanDeviceRecords(kv, target) {
    const records = [];
    const reqIds = [];
    const licCodes = [];
    const clinicNames = new Set();

    // 1. 试用指纹（list 前缀扫描，value.machineId 桥接 / 键全等）
    let listed;
    try { listed = await kv.list({ prefix: 'trial_fp:' }); } catch (_) { listed = null; }
    if (listed && Array.isArray(listed.keys)) {
        for (const k of listed.keys) {
            let v = null;
            try { v = await kv.get(k.name, 'json'); } catch (_) { v = null; }
            if (!v) continue;
            if (v.machineId === target || k.name === 'trial_fp:' + target) {
                records.push({
                    key: k.name,
                    kind: '试用指纹',
                    desc: `试用 ${v.trialCount} 次｜首试 ${v.firstTrialAt || '?'}｜${v.appMode || '?'} 平台`,
                    warn: false
                });
            }
        }
    }

    // 2. 激活申请（admin_req_index 全量遍历，phone/machineId 全等）
    const reqIndex = (await kv.get('admin_req_index', 'json')) || [];
    for (const rid of reqIndex) {
        let v = null;
        try { v = await kv.get('admin_req:' + rid, 'json'); } catch (_) { v = null; }
        if (!v) continue;
        if (v.phone === target || v.machineId === target) {
            reqIds.push(rid);
            records.push({
                key: 'admin_req:' + rid,
                kind: '激活申请',
                desc: `${v.status || '?'}｜${v.clinicName || '?'}｜${v.phone || '?'}｜${v.licenseCode || '无码'}`,
                warn: !!v.orderNo || v.status === 'activated'
            });
            if (v.clinicName) clinicNames.add(v.clinicName);
        }
    }

    // 3. License 记录（system:license_index 全量遍历）
    const licIndex = (await kv.get('system:license_index', 'json')) || [];
    for (const code of licIndex) {
        let v = null;
        try { v = await kv.get('license:' + code, 'json'); } catch (_) { v = null; }
        if (!v) continue;
        if (v.phone === target || v.machineId === target) {
            licCodes.push(code);
            records.push({
                key: 'license:' + code,
                kind: 'license',
                desc: `${v.status || '?'}｜${v.clinicName || v.user || '?'}｜${v.phone || '?'}`,
                warn: v.status === 'used'
            });
            records.push({ key: 'license_log:' + code, kind: 'license 日志', desc: '对应日志', warn: false });
            if (v.clinicName) clinicNames.add(v.clinicName);
        }
    }

    // 4. 直探测：设备版本键 + 手机号索引
    if (await kv.get('device_version:' + target, 'json').catch(() => null)) {
        records.push({ key: 'device_version:' + target, kind: '设备版本', desc: '设备版本绑定', warn: false });
    }
    if (await kv.get('admin_phone:' + target, 'json').catch(() => null)) {
        records.push({ key: 'admin_phone:' + target, kind: '手机号索引', desc: '登录索引', warn: false });
    }

    // 5. 诊所账号（clinicName 桥接 system:clinics；admin_req 删除后诊所表同步 filter）
    const clinics = (await kv.get('system:clinics', 'json')) || [];
    const clinicIds = [];
    for (const c of clinics) {
        if (clinicNames.has(c.name)) {
            clinicIds.push(c.id);
            records.push({
                key: 'clinic:' + c.id + ':users',
                kind: '诊所账号',
                desc: `诊所云端账号（${c.name}）`,
                warn: c.status === 'active'
            });
        }
    }

    return { records, reqIds, licCodes, clinicIds, clinicNames: [...clinicNames],
             reqIndexLen: reqIndex.length, licIndexLen: licIndex.length, clinicsLen: clinics.length };
}

// ============================================================================
//  执行删除（仅 confirm=true）：复用 deleteAdminRequest 原子服务 + license 直删
// ============================================================================
async function executeDeviceReset(kv, scan) {
    const deleted = [];
    const indexesUpdated = [];

    // 1. admin_req 走唯一写服务（删记录 + filter req_index + 重建 phone_index + 删 order 映射）
    for (const rid of scan.reqIds) {
        const r = await deleteAdminRequest(kv, rid);
        if (r && r.deleted) deleted.push('admin_req:' + rid);
    }
    if (scan.reqIds.length > 0) indexesUpdated.push('admin_req_index（Service 原子维护）');

    // 2. license + 日志直删 + license_index filter（license 域不在 write-service 五类 key 内）
    if (scan.licCodes.length > 0) {
        const licIndex = (await kv.get('system:license_index', 'json')) || [];
        const newLicIndex = licIndex.filter(c => !scan.licCodes.includes(c));
        for (const code of scan.licCodes) {
            await kv.delete('license:' + code);
            await kv.delete('license_log:' + code);
            deleted.push('license:' + code, 'license_log:' + code);
        }
        await kv.put('system:license_index', JSON.stringify(newLicIndex));
        indexesUpdated.push(`system:license_index（${licIndex.length} → ${newLicIndex.length}）`);
    }

    // 3. 试用指纹
    for (const rec of scan.records) {
        if (rec.kind === '试用指纹') {
            await kv.delete(rec.key);
            deleted.push(rec.key);
        }
    }

    // 4. 直探测键（幂等：deleteAdminRequest 可能已维护过 admin_phone）
    if (await kv.get('device_version:' + scan.target, 'json').catch(() => null)) {
        await kv.delete('device_version:' + scan.target);
        deleted.push('device_version:' + scan.target);
    }
    if (await kv.get('admin_phone:' + scan.target, 'json').catch(() => null)) {
        await kv.delete('admin_phone:' + scan.target);
        deleted.push('admin_phone:' + scan.target);
    }

    // 5. 诊所账号 + 诊所表 filter
    if (scan.clinicIds.length > 0) {
        const clinics = (await kv.get('system:clinics', 'json')) || [];
        const newClinics = clinics.filter(c => !scan.clinicIds.includes(c.id));
        for (const id of scan.clinicIds) {
            await kv.delete('clinic:' + id + ':users');
            deleted.push('clinic:' + id + ':users');
        }
        await kv.put('system:clinics', JSON.stringify(newClinics));
        indexesUpdated.push(`system:clinics（${clinics.length} → ${newClinics.length}）`);
    }

    // 6. 复验（已删键应全部查无）
    let verifyFailed = 0;
    for (const key of deleted) {
        const still = await kv.get(key, 'json').catch(() => null);
        if (still !== null) verifyFailed++;
    }

    return { deleted, indexesUpdated, verifyFailed };
}

export async function onRequest(context) {
    const method = context.request.method;
    const origin = context.request.headers.get('Origin') || '';

    if (method === 'OPTIONS') {
        return new Response(null, { status: 200, headers: corsHeaders(origin) });
    }
    if (method !== 'POST') {
        return json({ success: false, error: 'Method not allowed' }, 405, origin);
    }

    try {
        // 鉴权：仅平台总管理员
        const currentUser = await parseAuthHeader(context.request, context.env);
        if (!currentUser || !isPlatformAdmin(currentUser)) {
            return json({ success: false, error: '仅平台总管理员可执行设备清理' }, 403, origin);
        }

        const kv = getKV(context);
        if (!kv) {
            return json({ success: false, error: 'KV binding not found' }, 500, origin);
        }

        const body = await context.request.json().catch(() => ({}));
        const target = String(body.target || '').trim();
        const confirm = body.confirm === true;

        if (!target) {
            return json({ success: false, error: '缺少 target（手机号/机器码/试用指纹）' }, 400, origin);
        }
        const targetKind = classifyTarget(target);
        if (!targetKind) {
            return json({ success: false, error: 'target 格式非法（支持手机号/机器码/64位指纹）' }, 400, origin);
        }

        // 扫描（演练/执行共用；执行时重新扫描，不信任前端回传）
        const scan = await scanDeviceRecords(kv, target);
        scan.target = target;

        if (scan.records.length === 0) {
            return json({
                success: true,
                mode: confirm ? 'execute' : 'dry-run',
                targetKind,
                records: [],
                message: '未找到任何关联记录——该输入可能已是干净状态，或 ID 有误。（提示：trial_fp 的键是 64 位 hwFp，不是 32 位 machineId）'
            }, 200, origin);
        }

        if (!confirm) {
            // 演练：返回清单 + 索引预览
            return json({
                success: true,
                mode: 'dry-run',
                targetKind,
                records: scan.records,
                indexPreview: {
                    reqIndex: scan.reqIds.length > 0 ? `${scan.reqIndexLen} → ${scan.reqIndexLen - scan.reqIds.length}` : null,
                    licIndex: scan.licCodes.length > 0 ? `${scan.licIndexLen} → ${scan.licIndexLen - scan.licCodes.length}` : null,
                    clinics: scan.clinicIds.length > 0 ? `${scan.clinicsLen} → ${scan.clinicsLen - scan.clinicIds.length}（${scan.clinicNames.join('、')}）` : null
                }
            }, 200, origin);
        }

        // 执行
        const result = await executeDeviceReset(kv, scan);
        console.log('[DeviceReset] target=' + target + ' (' + targetKind + ') 删除 ' + result.deleted.length +
            ' 键，索引更新 ' + result.indexesUpdated.length + ' 处，复验失败 ' + result.verifyFailed);

        return json({
            success: result.verifyFailed === 0,
            mode: 'execute',
            targetKind,
            deleted: result.deleted,
            indexesUpdated: result.indexesUpdated,
            verifyFailed: result.verifyFailed,
            hint: '后台清理完成。客户端还需本地清理才能当新设备：桌面运行 测试重置.bat / 手机卸载重装 APP，之后联网首启 = 全新客户。'
        }, 200, origin);

    } catch (error) {
        console.error('Admin device reset error:', error);
        return json({ success: false, error: '服务器内部错误：' + (error.message || '请稍后再试') }, 500, origin);
    }
}
