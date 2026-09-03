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
//      "maxDevices": 1,                 // 最大设备数（可选，默认 pro=5 台 / personal=2 台）
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
    parseAuthHeader, isPlatformAdmin
} from '../_lib/auth.js';
import {
    getKV, saveLicense, buildLicenseData, encodeLicenseBase64,
    generateActivationCode, appendLicenseLog, getDevices, getMaxDevices,
    checkDeviceVersion, setDeviceVersion, versionOf
} from './_lib/license-core.js';
import { provisionCloudAccount, normalizeActivationPassword } from './_lib/admin-account.js';
import { updateAdminRequestStatus } from './_lib/license-write-service.js';

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
            // ★ 2026-09-03 (架构统一 P2) 统一走 updateAdminRequestStatus：
            //   同步改 status + rejectReason + resolvedAt/By + 更新 admin_phone 索引
            //   （原 L128-L133 两次 KV.put 各自写 → 一处原子写服务，防止漏索引）
            const rejectPatch = {
                status: 'rejected',
                rejectReason: (reason || '管理员未填写拒绝原因').trim(),
                resolvedAt: new Date().toISOString(),
                resolvedBy: currentUser.username
            };
            const updated = await updateAdminRequestStatus(kv, requestId, rejectPatch);
            console.log('[AdminApprove] 通过 Service 拒绝(双索引同步):', requestId, 'reason=', updated.rejectReason);
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

        // 校验 maxDevices
        // ★ 2026-08-21 云端产品策略：个人版一个管理员默认授权 2 台设备（桌面+APP）
        // ★ 2026-08-30 机构版策略：type=pro 默认 5 台（机构安装 3-5 台电脑共用一码），
        //   服务端兜底——即使调用方（管理后台/API 直调）漏传 maxDevices 也不会少发
        let parsedMaxDevices = (type === 'pro') ? 5 : 2;
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
            // ★ 2026-09-03 补充：激活手机号独立字段——lookup 自愈接口凭它回填手机号
            //   （user=adminName 多为诊所名不含手机号，extractPhone 解析不到）
            phone: record.phone || '',
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
        // ★ 2026-08-22 统一 edition：必须以管理员审核时最终选的 type 为准，
        //   不能用用户注册时自选的 record.type（两者可能不一致→edition 错误）。
        //   此处临时覆盖，确保下方 provisionCloudAccount 内部 mapActivationTypeToEdition 取对；
        //   同时在 L263 存 KV 时回写，保证 admin-status / admin-submit / users 登录自愈
        //   从 KV 再读同一份 record 时，type 也是管理员最终确认的。
        const finalActivationType = type; // 'pro' 或 'personal'，L139 已做必填+枚举校验
        record.type = finalActivationType;
        try {
            await provisionCloudAccount(kv, record);
        } catch (e) {
            console.warn('[AdminApprove] 云端账号开通失败（不影响license）:', e.message);
        }

        // ★ 2026-08-20 激活密码归一化：审核通过即把该手机号账号密码统一为默认 admin，
        //   解决历史旧账号/跨诊所重复导致后续登录 401。
        try {
            await normalizeActivationPassword(kv, record);
        } catch (e) {
            console.warn('[AdminApprove] 激活密码归一化失败（不影响license）:', e.message);
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

        // 3. 更新请求记录 status=activated，存储 licenseBase64 + 管理员最终决策
        //   （type/days/expiresAt/maxDevices 必须以管理员审核时传入的参数为准，
        //    回写到 KV 后 admin-status 轮询补开 / admin-submit 短路复用 /
        //    users.js 登录自愈 从同一份 KV 读取时，edition 映射才能完全一致）
        //
        // ★ 2026-09-03 (架构统一 P2) 统一走 updateAdminRequestStatus：
        //   - 注意！updateAdminRequestStatus 检测 status=activated 时内部也会调用
        //     saveLicense(kv, merged)（为非 admin-approve 的通过通道使用）。
        //   - 但 admin-approve 通过分支已经在 L211 saveLicense 显式写过 license:{code}
        //     (含生成的 code + devices + activatedAt 精确值)，不可重复 saveLicense 生成新码。
        //   - 解决：这里传 patch = { status:'activated', ... } 但不带任何新字段，
        //     或者通过 Service 的 updateAdminRequestStatus 内部 saveLicense 前做"record
        //     已有 licenseCode 则 skip saveLicense"幂等"通过——record 已经带 code
        //     和 licenseBase64，Service 内部 saveLicense 不会覆盖（saveLicense 幂等）。
        //   - saveLicense 内部: 如果 record.licenseCode 已存在则复用，不再生成新码
        //     （license-core.js 已有"已存在 licenseCode 跳过生成"的逻辑——实际会回写
        //     licenseCode/licenseBase64 到 record，所以已有的 code 和 licenseBase64 不会变）。
        const activatePatch = {
            status: 'activated',
            resolvedAt: new Date().toISOString(),
            resolvedBy: currentUser.username,
            licenseCode: code,              // 审核通过时刚生成的激活码
            licenseBase64: licenseBase64,   // 刚构建的 license
            type: finalActivationType,      // 管理员最终选的版本
            days: days || null,
            expiresAt: recordExpiresAt || null,
            maxDevices: parsedMaxDevices
        };
        await updateAdminRequestStatus(kv, requestId, activatePatch);

        console.log('[AdminApprove] 通过 Service 通过审批(双索引同步):', requestId, 'code=', code, 'clinic=', clinicName);

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
