// ============================================================================
//  activate-from-ticket.js — 平台管理员审批通过"激活工单" API
//
//  路由：POST /api/license/activate-from-ticket
//
//  认证：Bearer token（platform_admin）
//
//  请求体：
//    {
//      "ticketNo": "TK-XXXXXXXX-XXXXXX",  // 必填
//      "type": "pro",                     // 可选：pro/personal，默认按工单 edition 映射
//      "days": 365,                       // 可选：有效天数（默认 365）
//      "expiresAt": "2027-12-31",         // 可选：到期日期（与 days 二选一）
//      "maxDevices": 2                    // 可选：默认 2（云端产品策略）
//    }
//
//  返回：{ success: true, code: "BNZC-...", license: "base64..." }
//
//  ★ 审批通过流程（复用 admin-approve 全链路）：
//    1. edition 意向 → 激活类型映射（管理员可覆盖）
//    2. 设备-版本绑定校验（同一设备只能注册一个版本）
//    3. 生成新激活码并绑定 clinicName/machineId（默认授权 2 台设备）
//    4. 自动开通云端账号（provisionCloudAccount）+ 激活密码归一化
//    5. 生成 license base64（客户端凭工单号+手机号登录即可获取）
//    6. 更新工单 status=approved，回写管理员最终决策（type/days/maxDevices）
// ============================================================================

import {
    parseAuthHeader, isPlatformAdmin
} from '../_lib/auth.js';
import {
    getKV, saveLicense, buildLicenseData, encodeLicenseBase64,
    generateActivationCode, appendLicenseLog, checkDeviceVersion,
    setDeviceVersion, versionOf
} from './_lib/license-core.js';
import { provisionCloudAccount, normalizeActivationPassword } from './_lib/admin-account.js';

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

const KV_TICKET_PREFIX = 'ticket:';

// 工单版本意向 → 激活类型映射（与 normalizeClinicEdition / mapActivationTypeToEdition 口径对齐）
// 机构系：institution / institutional / jigou / clinic / pro / cloud_clinic / 机构版
// 标准系：personal / standard / cloud_personal / 标准版（含未知值兜底）
function mapEditionToType(edition) {
    const e = String(edition || '').trim().toLowerCase();
    if (['institution', 'institutional', 'jigou', 'clinic', 'pro', 'cloud_clinic'].includes(e) ||
        String(edition || '').includes('机构')) {
        return 'pro';
    }
    return 'personal';
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
            return json({ success: false, error: '仅平台总管理员可审批工单' }, 403);
        }

        const kv = getKV(context);
        if (!kv) {
            return json({ success: false, error: 'KV binding not found' }, 500);
        }

        const ip = getClientIP(context);
        const body = await context.request.json().catch(() => ({}));
        const ticketNo = String(body.ticketNo || '').trim();

        if (!ticketNo || !/^TK-[A-Z0-9]+-[A-Z0-9]+$/i.test(ticketNo)) {
            return json({ success: false, error: 'ticketNo 格式错误' }, 400);
        }

        // 读取工单
        const ticket = await kv.get(KV_TICKET_PREFIX + ticketNo, 'json');
        if (!ticket) {
            return json({ success: false, error: '工单不存在或已失效' }, 404);
        }
        if (ticket.status !== 'pending') {
            return json({
                success: false,
                error: `工单当前状态为 ${ticket.status}，无法审批（仅待审批状态可操作）`
            }, 400);
        }

        // ===== 参数解析（管理员最终确认权，未传时用工单意向的默认值）=====
        const type = (body.type && ['personal', 'pro'].includes(body.type))
            ? body.type
            : mapEditionToType(ticket.edition);
        const days = body.days ? parseInt(body.days, 10) : 365;
        const expiresAt = body.expiresAt || null;

        if (isNaN(days) || days < 1 || days > 3650) {
            return json({ success: false, error: 'days 必须是 1-3650 之间的整数' }, 400);
        }
        if (!days && !expiresAt) {
            return json({ success: false, error: '请提供 days 或 expiresAt' }, 400);
        }

        const clinicName = ticket.clinicName;
        if (!clinicName) {
            return json({ success: false, error: '工单中缺少诊所名称' }, 400);
        }

        // ★ 设备-版本绑定校验：若该设备已激活另一版本，则拒绝
        const deviceCheck = await checkDeviceVersion(kv, ticket.machineId, type);
        if (!deviceCheck.ok) {
            return json({ success: false, error: deviceCheck.error }, 403);
        }

        // ★ 云端产品策略：一个管理员默认授权 2 台设备（桌面+APP）
        let parsedMaxDevices = 2;
        if (body.maxDevices !== undefined && body.maxDevices !== null) {
            parsedMaxDevices = parseInt(body.maxDevices, 10);
            if (isNaN(parsedMaxDevices) || parsedMaxDevices < 1 || parsedMaxDevices > 10) {
                return json({ success: false, error: 'maxDevices 必须是 1-10 之间的整数' }, 400);
            }
        }

        // 计算到期时间
        let recordExpiresAt = null;
        if (expiresAt) {
            recordExpiresAt = new Date(expiresAt + 'T23:59:59+08:00').toISOString();
        }

        // 1. 生成新激活码并绑定 clinicName（工单的 machineId 作为首个设备）
        const code = generateActivationCode();
        const licenseRecord = {
            code: code,
            user: ticket.contactName,
            type: type,
            days: days || null,
            expiresAt: recordExpiresAt,
            issuedAt: new Date().toISOString(),
            issuedBy: currentUser.username,
            activatedAt: new Date().toISOString(),
            activatedIp: ip,
            machineId: ticket.machineId,  // 旧字段（兼容）
            clinicName: clinicName,
            maxDevices: parsedMaxDevices,
            devices: [{
                machineId: ticket.machineId,
                activatedAt: new Date().toISOString(),
                clinicName: clinicName,
                activatedIp: ip
            }],
            status: 'used',  // 直接标记为已使用（管理员已审批通过）
            note: (ticket.remark || '工单审批一键激活').trim().slice(0, 200)
        };

        await saveLicense(kv, licenseRecord);

        // 2. 云端账号自动开通（与 admin-approve 同链路）
        //    构造兼容 record：phone=工单联系电话，adminName=工单联系人
        //    ★ 统一 edition：以管理员最终选的 type 为准（不用用户注册时自选的 edition）
        const compatRecord = {
            phone: ticket.contactPhone,
            adminName: ticket.contactName,
            clinicName: clinicName,
            machineId: ticket.machineId,
            remark: ticket.remark,
            type: type,                    // 管理员最终确认的激活类型（pro/personal）
            edition: ticket.edition,       // 原始意向（provisionCloudAccount 内 type 优先）
            requestId: 'TICKET-' + ticketNo
        };
        try {
            await provisionCloudAccount(kv, compatRecord);
        } catch (e) {
            console.warn('[ActivateFromTicket] 云端账号开通失败（不影响license）:', e.message);
        }

        // 3. 激活密码归一化（手机号账号密码统一为默认 admin）
        try {
            await normalizeActivationPassword(kv, compatRecord);
        } catch (e) {
            console.warn('[ActivateFromTicket] 激活密码归一化失败（不影响license）:', e.message);
        }

        // 4. 设备-版本绑定：授权成功后绑定设备版本
        try {
            await setDeviceVersion(kv, ticket.machineId, versionOf(type), {
                licenseCode: code,
                clinicName: clinicName
            });
        } catch (e) { console.warn('[DeviceVersion] 绑定失败:', e.message); }

        await appendLicenseLog(kv, code, {
            action: 'generate',
            time: licenseRecord.issuedAt,
            ip: ip,
            operator: currentUser.username,
            detail: `activate-from-ticket: type=${type}, days=${days || 0}, expiresAt=${recordExpiresAt || 'null'}, clinicName=${clinicName}, maxDevices=${parsedMaxDevices}, ticketNo=${ticketNo}`
        });
        await appendLicenseLog(kv, code, {
            action: 'activate',
            time: licenseRecord.activatedAt,
            ip: ip,
            operator: currentUser.username,
            detail: `activate-from-ticket auto-activate: machineId=${ticket.machineId.substring(0, 8)}..., clinicName=${clinicName}, ticketNo=${ticketNo}`
        });

        // 5. 生成 license base64
        const licenseOptions = {
            clinicName: clinicName,
            machineId: ticket.machineId,
            licenseBinding: 'clinic+user+machine',
            maxDevices: parsedMaxDevices,
            devicesCount: 1,
            context: context  // 传递 context 以支持环境变量动态密钥
        };
        const licenseData = await buildLicenseData(licenseRecord, licenseOptions);
        const licenseBase64 = encodeLicenseBase64(licenseData);

        // 6. 更新工单 status=approved，回写管理员最终决策
        ticket.status = 'approved';
        ticket.resolvedAt = new Date().toISOString();
        ticket.resolvedBy = currentUser.username;
        ticket.licenseCode = code;
        ticket.licenseBase64 = licenseBase64;
        ticket.type = type;                 // 管理员最终选的版本（pro=机构版 / personal=标准版）
        ticket.days = days || null;
        ticket.expiresAt = recordExpiresAt || null;
        ticket.maxDevices = parsedMaxDevices;
        await kv.put(KV_TICKET_PREFIX + ticketNo, JSON.stringify(ticket));

        console.log('[ActivateFromTicket] 工单已通过:', ticketNo, 'code=', code,
            'clinic=', clinicName, 'type=', type, 'by=', currentUser.username);

        return json({
            success: true,
            status: 'approved',
            code: code,
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
        console.error('Activate from ticket error:', error);
        return json({ success: false, error: '服务器内部错误，请稍后再试' }, 500);
    }
}
