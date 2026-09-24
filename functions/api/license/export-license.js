// ============================================================================
//  export-license.js — 导出离线激活 license 文件（管理员/客服专用）
//
//  路由：POST /api/license/export-license
//
//  认证：Bearer token（platform_admin 或 C批新增 service 客服）
//        或 LICENSE_EXPORT_SECRET 环境变量（过渡期密钥，需在请求头 X-Export-Secret 传递；
//        在 Cloudflare 后台将该变量置空即可关闭密钥通道）
//  客服通道额外限制（2026-09-24 双审修复）：
//    - 满额码换机：user 必填且必须与授权登记用户一致（禁止省略短路）
//    - 账号维度 30/h + 激活码维度 10/h 频控（IP 20/h 桶之外叠加，防换 IP 批量发码）
//    - machineId 必须过 schema-guard 白名单（8-64 位）
//
//  用途：
//    当客户机器无法联网激活时，客服根据客户提供的机器ID和激活码，
//    调用此接口生成 license.dat 文件内容（base64），通过微信/邮件发给客户。
//    客户在激活窗口点击"导入离线激活文件"按钮选择该文件即可完成激活。
//
//  请求体：
//    {
//      "code": "BNZC-XXXX-XXXX-XXXX-XXXX",   // 激活码（必填）
//      "machineId": "客户提供的32位hex",       // 必填（离线激活的关键）
//      "clinicName": "本能堂中医诊所",          // 若激活码已绑定则必填
//      "user": "张三"                          // 可选，覆盖激活码 user
//    }
//
//  返回（成功）：
//    {
//      "success": true,
//      "license": "base64-encoded-license",   // 客户端写入 license.dat
//      "licenseInfo": { ... },                 // license 元信息
//      "fileName": "license.dat"               // 建议保存的文件名
//    }
//
//  与 validate.js 的区别：
//    - validate.js 是客户端直接调用（无认证 + IP 限速 20/h）
//    - export-license 是管理员/客服调用（Bearer 认证或独立密钥 + IP 限速 20/h，2026-09-24 P0-1 起）
//    - 两者底层均调用 buildLicenseData + encodeLicenseBase64，license 内容完全等价
// ============================================================================

import { parseAuthHeader, isPlatformAdmin, isStaff, constantTimeEqual } from '../_lib/auth.js';
import {
    getKV, getLicense, updateLicense,
    buildLicenseData, encodeLicenseBase64,
    getDevices, getMaxDevices, appendLicenseLog,
    checkRateLimit, checkCodeRateLimit
} from './_lib/license-core.js';
// ★ C批双审：machineId 白名单统一走 schema-guard 单一副本（8-64 位，拒 unknown/undefined）
import { isValidMachineId } from './_lib/schema-guard.js';

function corsHeaders() {
    return {
        'Access-Control-Allow-Origin': 'https://tcm-prescription-system.pages.dev',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Request-ID, X-Export-Secret',
        'Access-Control-Max-Age': '86400',
        'Content-Type': 'application/json'
    };
}

function json(data, status = 200) {
    return new Response(JSON.stringify(data), { status, headers: corsHeaders() });
}

function getNowISO() {
    return new Date().toISOString();
}

function getClientIP(context) {
    return context.request.headers.get('CF-Connecting-IP') ||
           context.request.headers.get('X-Forwarded-For') ||
           context.request.headers.get('X-Real-IP') ||
           'unknown';
}

// 激活码格式校验
function isValidCodeFormat(code) {
    if (!code || typeof code !== 'string') return false;
    const pattern = /^BNZC-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;
    return pattern.test(code);
}

// 鉴权：平台员工 Bearer token（platform_admin 或 C批新增 service 客服）
//   或 LICENSE_EXPORT_SECRET 独立密钥（过渡期保留，后续可在 KV 侧轮换为空关闭）
async function authenticate(context) {
    // 方式1：平台员工 Bearer token（platform_admin 全量；service 仅本端点等客服面）
    try {
        const currentUser = await parseAuthHeader(context.request, context.env);
        if (currentUser && isStaff(currentUser)) {
            return {
                ok: true,
                operator: currentUser.username || (isPlatformAdmin(currentUser) ? 'admin' : 'service'),
                role: isPlatformAdmin(currentUser) ? 'platform_admin' : 'service',
                method: isPlatformAdmin(currentUser) ? 'bearer' : 'bearer-service'
            };
        }
    } catch (e) { /* 继续尝试方式2 */ }

    // 方式2：LICENSE_EXPORT_SECRET 独立密钥（客服专用，无需登录管理后台）
    const exportSecret = context.env.LICENSE_EXPORT_SECRET;
    if (exportSecret) {
        const providedSecret = context.request.headers.get('X-Export-Secret');
        // ★ P1修复：改用常量时间比较，防止时序攻击
        if (providedSecret && constantTimeEqual(providedSecret, exportSecret)) {
            return { ok: true, operator: 'export-secret', role: 'secret', method: 'secret' };
        }
    }

    return { ok: false, error: '需要平台员工权限（管理员/客服）或有效的 LICENSE_EXPORT_SECRET' };
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
        // 鉴权
        const auth = await authenticate(context);
        if (!auth.ok) {
            return json({ success: false, error: auth.error }, 403);
        }

        const kv = getKV(context);
        if (!kv) {
            return json({ success: false, error: 'KV binding not found' }, 500);
        }

        const ip = getClientIP(context);

        // ★ 2026-09-24 P0-1 安全补强：客服发码端点 IP 频控 20/h（ip 拼 ':export'
        // 独立计数桶，与 admin-submit/order-submit 等端点同款惯例；不与
        // validate/invite/lookup 匿名激活流量共桶，防办公 NAT 下正常激活流量
        // 连带饿死客服发码）。
        // 背景：X-Export-Secret 曾随 generate-license.ps1 入库 git（仓库阅读者均可获得），
        // 端点长期"无限速"，密钥轮换后仍需限速兜底，防批量签发/换机试探挤掉合法设备。
        // 客服日常为低频操作（一单一次），20/h 不影响正常业务。
        const rateLimit = await checkRateLimit(kv, ip + ':export', 20);
        if (!rateLimit.allowed) {
            return json({
                success: false,
                error: '操作过于频繁（每小时限 20 次），请稍后再试',
                rateLimited: true
            }, 429);
        }

        // ★ 2026-09-24 C批双审修复：service 客服通道叠加【账号维度】频控 30/h——
        // IP 桶可被代理池绕过（每 IP 独立 20/h），账号桶跨 IP 聚合，被盗客服号无法批量发码。
        // admin/secret 通道维持既有 IP 单桶，不改变存量行为。
        const callerIsService = auth.role === 'service';
        if (callerIsService) {
            // 独立前缀 ratelimit:staffexport，与匿名 IP 桶 key 空间彻底隔离
            const accLimit = await checkRateLimit(kv, 'staff-export:' + auth.operator, 30, 'ratelimit:staffexport');
            if (!accLimit.allowed) {
                return json({
                    success: false,
                    error: '客服发码操作过于频繁（每账号每小时限 30 次），请稍后再试',
                    rateLimited: true
                }, 429);
            }
        }

        const body = await context.request.json().catch(() => ({}));
        const { code, user, clinicName } = body;
        const machineId = typeof body.machineId === 'string' ? body.machineId.trim() : '';

        // 参数校验
        if (!code) {
            return json({ success: false, error: '请提供激活码（code）' }, 400);
        }
        if (!machineId) {
            return json({ success: false, error: '请提供机器 ID（machineId，由客户提供）' }, 400);
        }
        // ★ C批双审：与全链路口径一致（schema-guard：8-64 位英文/数字/_/-，拒 unknown 字面量）
        if (!isValidMachineId(machineId)) {
            return json({ success: false, error: '机器码格式无效（需 8-64 位英文、数字、下划线或连字符）' }, 400);
        }
        if (!isValidCodeFormat(code)) {
            return json({ success: false, error: '激活码格式错误，应为 BNZC-XXXX-XXXX-XXXX-XXXX' }, 400);
        }
        // ★ C批双审修复：service 通道叠加【激活码维度】频控 10/h，
        // 防对单一客户的码做换机踢机试探；admin/secret 通道不追加。
        if (callerIsService) {
            // 独立码桶前缀，不与客户端 validate 的 5/h 桶共计数
            const codeLimit = await checkCodeRateLimit(kv, code, 10, 'ratelimit:staffexport:code');
            if (!codeLimit.allowed) {
                return json({
                    success: false,
                    error: '同一激活码操作过于频繁（每小时限 10 次），请稍后再试',
                    rateLimited: true
                }, 429);
            }
        }
        // clinicName 字符校验
        if (clinicName !== undefined && clinicName !== null && clinicName !== '') {
            if (typeof clinicName !== 'string') {
                return json({ success: false, error: 'clinicName 必须是字符串' }, 400);
            }
            if (clinicName.includes('|')) {
                return json({ success: false, error: 'clinicName 不能包含特殊字符 "|"' }, 400);
            }
            if (clinicName.length > 100) {
                return json({ success: false, error: 'clinicName 长度不能超过 100 字符' }, 400);
            }
        }

        // 查询激活码
        const record = await getLicense(kv, code);
        if (!record) {
            return json({ success: false, error: '激活码不存在' }, 404);
        }

        // 状态校验
        if (record.status === 'disabled') {
            return json({ success: false, error: '激活码已被禁用，请联系管理员' }, 403);
        }
        if (record.status === 'expired') {
            return json({ success: false, error: '激活码已过期' }, 403);
        }

        // 诊所名绑定校验（与 validate.js 一致）
        if (record.clinicName) {
            if (!clinicName || clinicName.trim() === '') {
                return json({
                    success: false,
                    error: '此激活码已绑定诊所，必须提供 clinicName',
                    needClinicName: true
                }, 400);
            }
            if (clinicName !== record.clinicName) {
                return json({
                    success: false,
                    error: `诊所名与激活码绑定的诊所不一致（绑定：${record.clinicName}，输入：${clinicName}）`
                }, 403);
            }
        }

        // 多设备授权校验（与 validate.js 一致，支持换机解绑）
        const devices = getDevices(record);
        const maxDevices = getMaxDevices(record);
        const existingDevice = devices.find(d => d.machineId === machineId);

        if (record.status === 'used' && !existingDevice) {
            if (devices.length >= maxDevices) {
                // ★ 2026-09-24 C批双审修复（High）：换机归属闸按通道分级
                //   旧逻辑 `if (user && originalUser && user!==originalUser)` 有两个洞：
                //   ①user 可省略→条件短路，任意 machineId 直接踢掉最旧合法设备；
                //   ②user 对客服在 list 接口明文可见，照抄即过（弱归属凭据）。
                //   现对 service 客服通道收紧为【强制】：user 必传、授权登记用户必须存在、
                //   二者必须一致，否则拒绝并写 unbind-denied 审计（客服须先在线下核验
                //   客户身份并按登记用户名填写）。admin/secret 通道维持原可选校验（既有行为）。
                const originalUser = record.user || record.username || '';
                const providedUser = typeof user === 'string' ? user.trim() : '';
                let denyReason = '';
                if (callerIsService) {
                    if (!providedUser) denyReason = '客服换机必须填写与授权登记一致的联系人用户名';
                    else if (!originalUser) denyReason = '该授权缺少登记用户，无法完成客服换机，请联系管理员处理';
                    else if (providedUser !== originalUser) denyReason = '联系人与授权登记用户不一致';
                } else if (providedUser && originalUser && providedUser !== originalUser) {
                    denyReason = '设备数已达上限，且用户名与授权用户不匹配，请联系客服处理换机';
                }
                if (denyReason) {
                    // 日志字段截断（用户可控输入，防超长串污染日志；KV 为 JSON 结构化存储无换行注入面）
                    const cut = s => String(s).slice(0, 60);
                    await appendLicenseLog(kv, code, {
                        action: 'unbind-denied',
                        time: new Date().toISOString(),
                        ip: ip,
                        operator: auth.operator,
                        detail: `[export] 拒绝换机(${auth.method})：provided='${cut(providedUser)}' original='${cut(originalUser)}' reason=${denyReason}`
                    });
                    return json({ success: false, error: denyReason }, 403);
                }
                // 换机模式：自动解绑最旧设备
                const oldestDevice = devices[0];
                await appendLicenseLog(kv, code, {
                    action: 'auto-unbind',
                    time: new Date().toISOString(),
                    ip: ip,
                    operator: auth.operator,
                    detail: `[export] auto-unbind oldest device ${oldestDevice.machineId.substring(0, 8)}... for new device ${machineId.substring(0, 8)}..., remaining=${devices.length - 1}/${maxDevices}`
                });
                devices.shift();
            }
        }

        // 到期校验
        if (record.expiresAt) {
            const expireDate = new Date(record.expiresAt);
            if (Date.now() > expireDate.getTime()) {
                await updateLicense(kv, code, { status: 'expired' });
                return json({ success: false, error: '激活码已过期' }, 403);
            }
        }

        // 覆盖 user（如果提供了；trim 归一化，与换机闸 providedUser 同口径）
        const licenseUser = (typeof user === 'string' ? user.trim() : '') || record.user || record.username || 'user';

        // 生成 license 数据（复用 buildLicenseData）
        const licenseRecord = { ...record, user: licenseUser };
        const licenseOptions = {};
        if (record.clinicName) {
            licenseOptions.clinicName = record.clinicName;
            licenseOptions.machineId = machineId;
            licenseOptions.licenseBinding = 'clinic+user+machine';
        }
        licenseOptions.maxDevices = maxDevices;
        licenseOptions.devicesCount = existingDevice ? devices.length : devices.length + 1;
        licenseOptions.context = context;
        const licenseData = await buildLicenseData(licenseRecord, licenseOptions);

        // 更新激活码记录（与 validate.js 一致）
        const isReactivation = !!existingDevice;
        const updates = {
            status: 'used',
            machineId: machineId,
            activatedAt: getNowISO(),
            activatedIp: ip,
            user: licenseUser
        };
        if (record.clinicName && !record.activatedClinicName) {
            updates.activatedClinicName = record.clinicName;
        }
        const newDevices = devices.slice();
        if (existingDevice) {
            existingDevice.activatedAt = getNowISO();
            existingDevice.clinicName = record.clinicName || existingDevice.clinicName;
        } else {
            newDevices.push({
                machineId: machineId,
                activatedAt: getNowISO(),
                clinicName: record.clinicName || clinicName || null,
                activatedIp: ip
            });
        }
        updates.devices = newDevices;
        updates.maxDevices = maxDevices;
        await updateLicense(kv, code, updates);

        // 记录日志（标记为离线导出）
        await appendLicenseLog(kv, code, {
            action: isReactivation ? 'export-offline-reactivate' : 'export-offline',
            time: updates.activatedAt,
            ip: ip,
            operator: auth.operator,
            detail: `[export-offline] machineId=${machineId.substring(0, 8)}..., clinicName=${record.clinicName || 'null'}, devicesCount=${newDevices.length}/${maxDevices}, authMethod=${auth.method}`
        });

        // 编码为 base64
        const licenseBase64 = encodeLicenseBase64(licenseData);

        // 生成建议的文件名（含诊所名/用户名/日期，便于客服管理）
        const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        const safeName = (record.clinicName || licenseUser || 'user').replace(/[\\/:*?"<>|]/g, '_').substring(0, 20);
        const fileName = `license_${safeName}_${machineId.substring(0, 8)}_${dateStr}.dat`;

        return json({
            success: true,
            license: licenseBase64,
            licenseInfo: {
                user: licenseData.user,
                type: licenseData.type,
                issuedAt: licenseData.issuedAt,
                expiresAt: licenseData.expiresAt,
                maxPrescriptions: licenseData.maxPrescriptions,
                features: licenseData.features,
                clinicName: licenseData.clinicName || null,
                licenseBinding: licenseData.licenseBinding || null,
                maxDevices: licenseData.maxDevices || 1,
                devicesCount: licenseData.devicesCount || 1
            },
            fileName: fileName,
            message: 'license 已生成，请将文件安全发送给客户。客户在激活窗口点击"导入离线激活文件"按钮选择此文件即可完成激活。'
        });

    } catch (error) {
        console.error('License export error:', error);
        return json({ success: false, error: '服务器内部错误，请稍后再试' }, 500);
    }
}
