// ============================================================================
//  admin-approve.js — 平台管理员审核"管理员激活"请求 API
//
//  路由：POST /api/license/admin-approve
//
//  认证：Bearer token（platform_admin）
//
//  请求体（通过）：
//    {
//      "requestId": "REQ-XXXXXXXX-XXXX",
//      "action": "approve",
//      "type": "personal",              // personal / pro（必填）
//      "days": 365,                     // 有效天数（与 expiresAt 二选一，默认 365）
//      "expiresAt": "2027-12-31",       // 到期日期（与 days 二选一）
//      "maxDevices": 1,                 // 最大设备数（可选，默认 1）
//      "maxPrescriptions": 0,           // 覆盖默认处方限制（可选）
//      "features": ["backup"],          // 覆盖默认功能列表（可选）
//      "note": "审核备注"               // 备注（可选）
//    }
//
//  请求体（拒绝）：
//    {
//      "requestId": "REQ-XXXXXXXX-XXXX",
//      "action": "reject",
//      "reason": "拒绝原因"
//    }
//
//  返回（通过）：
//    { success: true, licenseCode: "BNZC-...", license: "base64..." }
//
//  返回（拒绝）：{ success: true }
//
//  ★ 审核通过流程：
//    1. 自动生成新激活码（绑定 clinicName/machineId）
//    2. 立即调用 validate 逻辑激活该激活码（写入 devices[0]）
//    3. 生成 license base64
//    4. 更新请求记录 status=activated，存储 licenseBase64
//    5. 客户端下次轮询 admin-status 时获取 license 并写入 license.dat
// ============================================================================

import {
    parseAuthHeader, isPlatformAdmin, hashPassword,
    ROLE_CLINIC_ADMIN, KV_SYSTEM_CLINICS
} from '../_lib/auth.js';
import {
    getKV, saveLicense, buildLicenseData, encodeLicenseBase64,
    generateActivationCode, appendLicenseLog, getDevices, getMaxDevices,
    checkDeviceVersion, setDeviceVersion, versionOf
} from './_lib/license-core.js';

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

function getClientIP(context) {
    return context.request.headers.get('CF-Connecting-IP') ||
           context.request.headers.get('X-Forwarded-For') ||
           context.request.headers.get('X-Real-IP') ||
           'unknown';
}

const KV_ADMIN_REQ_PREFIX = 'admin_req:';

// ★★ 2026-08-19 云端账号自动开通
//   审核通过"管理员激活"请求时，为云端创建诊所 + clinic_admin 账号（username=激活手机号）。
//   仅当手机号非空且该账号尚未存在时执行；已存在则跳过（兼容历史多端共享同一手机号）。
//   诊所按 clinicName 复用：已存在同名诊所则不重复创建，仅补充账号到该诊所。
async function provisionCloudAccount(kv, record) {
    const phone = (record.phone || '').trim();
    const clinicName = (record.clinicName || '').trim();
    if (!phone || !clinicName) return;

    const now = new Date().toISOString();
    const clinics = (await kv.get(KV_SYSTEM_CLINICS, 'json')) || [];
    let clinic = clinics.find(c => c.name === clinicName);

    // 1) 存在同名诊所 → 直接复用
    if (clinic) {
        await ensureClinicUser(kv, clinic.id, clinicName, phone, record.adminName, now);
        return;
    }

    // 2) 不存在 → 创建新诊所
    const clinicId = 'clinic_' + Array.from(crypto.getRandomValues(new Uint8Array(10)))
        .map(b => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('');
    clinic = { id: clinicId, name: clinicName, status: 'active', createdAt: now, updatedAt: now };
    clinics.push(clinic);
    await kv.put(KV_SYSTEM_CLINICS, JSON.stringify(clinics));

    await ensureClinicUser(kv, clinicId, clinicName, phone, record.adminName, now);
}

// 在指定诊所下补充（或不动）clinic_admin 账号
async function ensureClinicUser(kv, clinicId, clinicName, phone, adminName, now) {
    const users = (await kv.get(`clinic:${clinicId}:users`, 'json')) || [];
    const exists = users.some(u => u.username === phone || u.phone === phone);
    if (exists) return;

    // 密码留空默认 admin（与离线端默认密码一致；激活框密码留空时的默认值）
    const { passwordHash, salt } = await hashPassword('admin');
    users.push({
        username: phone,
        phone: phone,
        name: (adminName || phone).trim(),
        role: ROLE_CLINIC_ADMIN,
        passwordHash,
        salt,
        allowedMode: 'both',
        cloudEnabled: true,
        allowSavePrescription: true,
        createdAt: now,
        updatedAt: now
    });
    await kv.put(`clinic:${clinicId}:users`, JSON.stringify(users));
    console.log('[AdminApprove] 云端账号已开通:', phone, 'clinic=', clinicName);
}

export async function onRequest(context) {
    const method = context.request.method;

    if (method === 'OPTIONS') {
        return new Response(null, { status: 200, headers: corsHeaders() });
    }

    if (method !== 'POST') {
        return json({ success: false, error: 'Method not allowed' }, 405);
    }

    try {
        // 管理员认证
        const currentUser = await parseAuthHeader(context.request, context.env);
        if (!currentUser || !isPlatformAdmin(currentUser)) {
            return json({ success: false, error: '仅平台总管理员可审核激活请求' }, 403);
        }

        const kv = getKV(context);
        if (!kv) {
            return json({ success: false, error: 'KV binding not found' }, 500);
        }

        const ip = getClientIP(context);
        const body = await context.request.json().catch(() => ({}));
        const { requestId, action, type, days, expiresAt, maxDevices, maxPrescriptions, features, note, reason } = body;

        // 参数校验
        if (!requestId) {
            return json({ success: false, error: '缺少 requestId' }, 400);
        }
        if (!/^REQ-[A-Z0-9]+-[A-F0-9]+$/i.test(requestId)) {
            return json({ success: false, error: 'requestId 格式错误' }, 400);
        }
        if (action !== 'approve' && action !== 'reject') {
            return json({ success: false, error: 'action 必须是 approve 或 reject' }, 400);
        }

        // 读取请求记录
        const record = await kv.get(KV_ADMIN_REQ_PREFIX + requestId, 'json');
        if (!record) {
            return json({ success: false, error: '激活请求不存在或已失效' }, 404);
        }

        // 仅 pending 状态允许审核
        if (record.status !== 'pending') {
            return json({
                success: false,
                error: `请求当前状态为 ${record.status}，无法审核（仅 pending 状态可审核）`
            }, 400);
        }

        // ===== 拒绝分支 =====
        if (action === 'reject') {
            record.status = 'rejected';
            record.rejectReason = (reason || '管理员未填写拒绝原因').trim();
            record.resolvedAt = new Date().toISOString();
            record.resolvedBy = currentUser.username;
            await kv.put(KV_ADMIN_REQ_PREFIX + requestId, JSON.stringify(record));
            console.log('[AdminApprove] 请求已拒绝:', requestId, 'reason=', record.rejectReason);
            return json({ success: true, status: 'rejected' });
        }

        // ===== 通过分支 =====
        // 参数校验：type 必填
        if (!type || !['personal', 'pro'].includes(type)) {
            return json({ success: false, error: 'type 必须是 personal 或 pro' }, 400);
        }
        // 校验 days 或 expiresAt 至少有一个
        if (!days && !expiresAt) {
            return json({ success: false, error: '请提供 days 或 expiresAt' }, 400);
        }

        // 校验 clinicName（来自请求记录）
        const clinicName = record.clinicName;
        if (!clinicName) {
            return json({ success: false, error: '请求记录中缺少 clinicName' }, 400);
        }

        // ★ 设备-版本绑定校验：审核通过前确认设备版本一致
        // 若该设备已激活另一版本，则拒绝通过该版本的授权请求
        const deviceCheck = await checkDeviceVersion(kv, record.machineId, type);
        if (!deviceCheck.ok) {
            return json({ success: false, error: deviceCheck.error }, 403);
        }

        // 校验 maxDevices（可选，默认 1）
        let parsedMaxDevices = 1;
        if (maxDevices !== undefined && maxDevices !== null) {
            parsedMaxDevices = parseInt(maxDevices, 10);
            if (isNaN(parsedMaxDevices) || parsedMaxDevices < 1 || parsedMaxDevices > 10) {
                return json({ success: false, error: 'maxDevices 必须是 1-10 之间的整数' }, 400);
            }
        }

        // 计算到期时间
        let recordExpiresAt = null;
        if (expiresAt) {
            recordExpiresAt = new Date(expiresAt + 'T23:59:59+08:00').toISOString();
        } else if (days) {
            // 不预计算（buildLicenseData 内部按 days 计算）
        }

        // 1. 生成新激活码并绑定 clinicName（请求中的 machineId 作为首个设备）
        const code = generateActivationCode();
        const licenseRecord = {
            code: code,
            user: record.adminName,
            type: type,
            days: days || null,
            expiresAt: recordExpiresAt,
            issuedAt: new Date().toISOString(),
            issuedBy: currentUser.username,
            activatedAt: new Date().toISOString(),
            activatedIp: ip,
            machineId: record.machineId,  // 旧字段（兼容）
            clinicName: clinicName,
            maxDevices: parsedMaxDevices,
            devices: [{
                machineId: record.machineId,
                activatedAt: new Date().toISOString(),
                clinicName: clinicName,
                activatedIp: ip
            }],
            status: 'used',  // 直接标记为已使用（管理员已审核通过）
            maxPrescriptions: maxPrescriptions !== undefined ? maxPrescriptions : undefined,
            features: features || undefined,
            note: (note || record.remark || '管理员一键激活').trim()
        };

        await saveLicense(kv, licenseRecord);

        // ★★ 2026-08-19 云端账号自动开通
        //   （解决"激活通过后，云端APP/桌面用手机号登录返回 401"）
        //   admin-approve 之前只生成 license，从不创建云端诊所/账号，
        //   前端提示"账号已在云端创建，用手机号登录"，但 findUserForLogin 找不到 → 401。
        //   此处为云端机构版/标准版自动开通：诊所（按名称复用，不重复建）+ clinic_admin 账号
        //   （username=激活手机号，密码留空默认 admin，与离线端默认密码一致）。
        try {
            await provisionCloudAccount(kv, record);
        } catch (e) {
            console.warn('[AdminApprove] 云端账号开通失败（不影响license）:', e.message);
        }

        // ★ 设备-版本绑定：授权成功后绑定设备版本（同一设备只能注册一个版本）
        try {
            await setDeviceVersion(kv, record.machineId, versionOf(type), {
                licenseCode: code,
                clinicName: clinicName
            });
        } catch (e) { console.warn('[DeviceVersion] 绑定失败:', e.message); }

        await appendLicenseLog(kv, code, {
            action: 'generate',
            time: licenseRecord.issuedAt,
            ip: ip,
            operator: currentUser.username,
            detail: `admin-approve: type=${type}, days=${days || 0}, expiresAt=${recordExpiresAt || 'null'}, clinicName=${clinicName}, maxDevices=${parsedMaxDevices}, requestId=${requestId}`
        });
        await appendLicenseLog(kv, code, {
            action: 'activate',
            time: licenseRecord.activatedAt,
            ip: ip,
            operator: currentUser.username,
            detail: `admin-approve auto-activate: machineId=${record.machineId.substring(0, 8)}..., clinicName=${clinicName}, requestId=${requestId}`
        });

        // 2. 生成 license base64（与 validate.js 相同的流程）
        const licenseOptions = {
            clinicName: clinicName,
            machineId: record.machineId,
            licenseBinding: 'clinic+user+machine',
            maxDevices: parsedMaxDevices,
            devicesCount: 1,
            context: context  // 传递 context 以支持环境变量动态密钥
        };
        const licenseData = await buildLicenseData(licenseRecord, licenseOptions);
        const licenseBase64 = encodeLicenseBase64(licenseData);

        // 3. 更新请求记录 status=activated，存储 licenseBase64
        record.status = 'activated';
        record.resolvedAt = new Date().toISOString();
        record.resolvedBy = currentUser.username;
        record.licenseCode = code;
        record.licenseBase64 = licenseBase64;
        await kv.put(KV_ADMIN_REQ_PREFIX + requestId, JSON.stringify(record));

        console.log('[AdminApprove] 请求已通过:', requestId, 'code=', code, 'clinic=', clinicName);

        return json({
            success: true,
            status: 'activated',
            licenseCode: code,
            license: licenseBase64,
            licenseInfo: {
                user: licenseData.user,
                type: licenseData.type,
                issuedAt: licenseData.issuedAt,
                expiresAt: licenseData.expiresAt,
                clinicName: licenseData.clinicName,
                maxDevices: licenseData.maxDevices || 1
            }
        });

    } catch (error) {
        console.error('Admin approve error:', error);
        return json({ success: false, error: '服务器内部错误，请稍后再试' }, 500);
    }
}
