// ============================================================================
//  validate.js — 激活码校验 API（客户端激活时调用）
//
//  路由：POST /api/license/validate
//
//  无需登录认证（客户端激活前尚未登录），但有以下保护：
//    - 速率限制：每 IP 每小时 5 次校验请求
//    - 激活码格式校验
//    - 状态校验（unused 或 同机器重激活）
//
//  请求体：
//    {
//      "code": "BNZC-XXXX-XXXX-XXXX-XXXX",   // 激活码
//      "machineId": "abc123def456",           // 客户端机器 ID
//      "user": "张三",                        // 用户名（可选，覆盖激活码上的 user）
//      "clinicName": "本能堂中医诊所"          // ★ v3 新增：诊所名（激活码绑定时必填）
//    }
//
//  返回（成功）：
//    {
//      "success": true,
//      "license": "base64-encoded-license",   // 客户端写入 license.dat
//      "licenseInfo": {                        // license 元信息（不包含签名）
//        "user": "...", "type": "...", "expiresAt": "...",
//        "maxPrescriptions": 0, "features": [...],
//        "clinicName": "...", "licenseBinding": "clinic+user+machine"
//      }
//    }
//
//  返回（失败）：
//    { "success": false, "error": "错误原因" }
// ============================================================================

import {
    getKV, getLicense, updateLicense, saveLicense,
    buildLicenseData, encodeLicenseBase64, checkRateLimit,
    checkCodeRateLimit,  // ★ P0-1 激活码级短时频控
    getDevices, getMaxDevices, appendLicenseLog,
    checkDeviceVersion, setDeviceVersion, versionOf,
    ensureInviteCode, applyInviteReward, findLicenseByInviteCode,
    INVITE_BONUS_DAYS_INVITEE, INVITE_MAX_INVITEES
} from './_lib/license-core.js';

// ★ P2 安全修复：收紧 CORS，仅允许合法 Origin
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
let _currentRequest = null;

function corsHeaders() {
    const origin = _currentRequest ? (_currentRequest.headers.get('Origin') || '') : '';
    const allowedOrigin = (origin && ALLOWED_ORIGINS.includes(origin)) ? origin : 'https://tcm-prescription-system.pages.dev';
    return {
        'Access-Control-Allow-Origin': allowedOrigin,
        'Vary': 'Origin',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Request-ID',
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

// 获取客户端 IP（用于速率限制）
function getClientIP(context) {
    return context.request.headers.get('CF-Connecting-IP') ||
           context.request.headers.get('X-Forwarded-For') ||
           context.request.headers.get('X-Real-IP') ||
           'unknown';
}

// 激活码格式校验：BNZC-XXXX-XXXX-XXXX-XXXX
function isValidCodeFormat(code) {
    if (!code || typeof code !== 'string') return false;
    const pattern = /^BNZC-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;
    return pattern.test(code);
}

export async function onRequest(context) {
    _currentRequest = context.request;  // ★ P2：保存 request 供 CORS 动态检查
    const method = context.request.method;

    if (method === 'OPTIONS') {
        return new Response(null, { status: 200, headers: corsHeaders() });
    }

    if (method !== 'POST') {
        return json({ success: false, error: 'Method not allowed' }, 405);
    }

    try {
        const kv = getKV(context);
        if (!kv) {
            return json({ success: false, error: 'KV binding not found' }, 500);
        }

        // 速率限制（防暴力尝试，20次/小时足够测试且安全）
        const ip = getClientIP(context);
        const rateLimit = await checkRateLimit(kv, ip, 20);
        if (!rateLimit.allowed) {
            return json({
                success: false,
                error: '校验请求过于频繁，请稍后再试（每小时限 20 次）',
                rateLimited: true
            }, 429);
        }

        const body = await context.request.json().catch(() => ({}));
        const { code, machineId, user, clinicName, productClass, clientClass, inviteCode, phone } = body;

        // ★ 2026-08-29 已激活用户重装/换机自愈：手机号身份核验
        //   客户端提交的 user（可能为"姓名/手机号"或纯姓名）与 phone 字段中提取手机号，
        //   与激活码原绑定 user 中的手机号一致 → 视为原激活本人，自动恢复原激活信息：
        //   ① 跳过诊所名严格匹配（自动沿用原绑定 clinicName，无需用户重填）
        //   ② 换机解绑二次校验放行（原逻辑要求 user 字符串全等，"张三/138..." vs "138..." 会误拦）
        const phoneOf = (s) => { const m = String(s || '').match(/1[3-9]\d{9}/); return m ? m[0] : ''; };
        const clientPhone = phoneOf(user) || ((typeof phone === 'string' && /^1[3-9]\d{9}$/.test(phone.trim())) ? phone.trim() : '');

        // 参数校验
        if (!code) {
            return json({ success: false, error: '请提供激活码' }, 400);
        }
        if (!machineId) {
            return json({ success: false, error: '请提供机器 ID' }, 400);
        }
        if (!isValidCodeFormat(code)) {
            return json({ success: false, error: '激活码格式错误' }, 400);
        }
        // ★ P0-1 安全补强：激活码级短时频控（防对单一合法激活码做换机试探/暴力爆破）
        // 与上面的 IP 限流（每 IP 每小时 20 次）叠加，从"激活码"维度再限一层
        const codeRate = await checkCodeRateLimit(kv, code, 5);
        if (!codeRate.allowed) {
            return json({
                success: false,
                error: '该激活码校验过于频繁，请 1 小时后再试（每小时限 5 次）',
                rateLimited: true
            }, 429);
        }
        // ★ v3 新增：clinicName 长度/字符校验
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

        // ★ 设备-版本绑定校验：同一台设备只能注册一个版本
        // 若该设备已激活【标准版】或【机构版】，则拒绝激活另一版本
        const deviceCheck = await checkDeviceVersion(kv, machineId, record.type);
        if (!deviceCheck.ok) {
            await appendLicenseLog(kv, code, {
                action: 'device-binding-denied',
                time: new Date().toISOString(),
                ip: ip,
                operator: user || record.user || 'unknown',
                detail: '设备已绑定' + deviceCheck.boundLabel + '，拒绝' + deviceCheck.targetLabel + '激活'
            });
            return json({ success: false, error: deviceCheck.error }, 403);
        }

        // ★ 版本升级：标准版→机构版，记录升级日志（审计留痕）
        if (deviceCheck.upgrade) {
            await appendLicenseLog(kv, code, {
                action: 'version-upgrade',
                time: new Date().toISOString(),
                ip: ip,
                operator: user || record.user || 'unknown',
                detail: '设备从【标准版】升级到【机构版】, machineId=' + machineId.substring(0, 8) + '...'
            });
        }

        // ★ v4 新增：多设备授权校验
        // 1. 获取已绑定设备列表（兼容旧 record.machineId 单值字段）
        // ★ 2026-08-25 顺序调整：设备列表上移——同设备重激活判定需先于诊所名校验
        //   （卸载重装场景 machineId 不变，设备已在绑定列表，无需再向客户索要诊所名）
        const devices = getDevices(record);
        const maxDevices = getMaxDevices(record);
        const existingDevice = devices.find(d => d.machineId === machineId);

        // ★ 2026-08-29 手机号身份核验：客户端手机号与激活码原绑定手机号一致
        //   → 原激活本人（换机/重装场景），自动恢复原激活信息，跳过严格匹配
        const recordPhone = phoneOf(record.user || record.username || '');
        const phoneVerified = !!(clientPhone && recordPhone && clientPhone === recordPhone);

        // ★ v3 新增：诊所名绑定校验
        // 仅当激活码生成时已绑定 clinicName 时才校验（向后兼容旧激活码）
        // ★ 2026-08-25：同设备重激活（existingDevice 命中）自动跳过诊所名校验——
        //   license 始终按 record.clinicName 生成，重装客户只需重输激活码即可恢复
        // ★ 2026-08-29：手机号核验通过（phoneVerified）同样跳过——原激活本人换机时
        //   无需重填诊所名，服务端自动沿用原绑定 clinicName（"自动填写原激活信息"）
        if (record.clinicName && !existingDevice && !phoneVerified) {
            if (!clinicName || clinicName.trim() === '') {
                return json({
                    success: false,
                    error: '此激活码已绑定诊所，激活时必须提供 clinicName',
                    needClinicName: true
                }, 400);
            }
            if (clinicName !== record.clinicName) {
                return json({
                    success: false,
                    error: `诊所名与激活码绑定的诊所不一致（绑定：${record.clinicName}，输入：${clinicName}），请联系客服核对`
                }, 403);
            }
        }

        if (record.status === 'used' && !existingDevice) {
            // 新设备激活：检查是否还有配额
            if (devices.length >= maxDevices) {
                // ★ P1 修复：换机解绑二次校验
                // 仅当新设备的 user 与 license 原始绑定 user 一致时才允许自动解绑
                // 防止攻击者获取激活码后在未知机器上激活挤掉合法用户
                // ★ 2026-08-29：user 全等比对升级为「手机号比对」——原激活本人重装/换机时
                //   user 字符串形态不同（"张三/138..." vs "138..."）会被误拦要求联系客服；
                //   手机号一致即视为本人（手机号=登录账号，仅本人知晓）
                const originalUser = record.user || record.username || '';
                if (user && originalUser && user !== originalUser && !phoneVerified) {
                    await appendLicenseLog(kv, code, {
                        action: 'unbind-denied',
                        time: new Date().toISOString(),
                        ip: ip,
                        operator: user,
                        detail: `拒绝换机：新设备 user='${user}' 与授权 user='${originalUser}' 不一致`
                    });
                    return json({
                        success: false,
                        error: '设备数已达上限，且用户名与授权用户不匹配，请联系客服处理换机'
                    }, 403);
                }
                // ★ 换机模式：自动解绑最旧的设备，允许新设备激活
                const oldestDevice = devices[0];
                await appendLicenseLog(kv, code, {
                    action: 'auto-unbind',
                    time: new Date().toISOString(),
                    ip: ip,
                    operator: 'system',
                    detail: `auto-unbind oldest device ${oldestDevice.machineId.substring(0, 8)}... for new device ${machineId.substring(0, 8)}..., remaining=${devices.length - 1}/${maxDevices}`
                });
                devices.shift();  // 移除最旧的设备
                // 继续后续激活流程（新设备会被添加到 devices 数组）
            }
            // 配额充足，允许新设备激活（在后续 updateLicense 中添加到 devices 数组）
        }
        // existingDevice 存在 → 同设备重激活，允许（不增加设备数）
        // record.status === 'unused' → 首次激活，允许

        // 到期校验（如果激活码本身有 expiresAt）
        if (record.expiresAt) {
            const expireDate = new Date(record.expiresAt);
            if (Date.now() > expireDate.getTime()) {
                await updateLicense(kv, code, { status: 'expired' });
                return json({ success: false, error: '激活码已过期' }, 403);
            }
        }

        // 覆盖 user（如果客户端提供了）
        const licenseUser = user || record.user || record.username || 'user';

        // ★ 2026-08-26 推广奖励：邀请码处理（可选字段，不影响既有激活流程）
        //  仅【新设备首次付费激活】且携带邀请码时发奖：邀请人 +90 天（封顶4人360天），
        //  被邀请人 +30 天。防刷条件见 license-core.applyInviteReward。
        let inviteResult = { granted: false };
        let inviteeBonusDays = 0;
        let invitedByCode = null;
        if (inviteCode && typeof inviteCode === 'string' && /^[A-Za-z0-9]{4,10}$/.test(inviteCode.trim())
            && !existingDevice && record.type !== 'trial') {
            inviteResult = await applyInviteReward(kv, {
                inviteCode: inviteCode.trim(),
                inviteeCode: code,
                inviteeRecord: record,
                machineId: machineId,
                phone: (typeof phone === 'string' ? phone : ''),
                ip: ip
            });
            if (inviteResult.granted) {
                inviteeBonusDays = INVITE_BONUS_DAYS_INVITEE;   // 被邀请人 +30 天
                const inviter = await findLicenseByInviteCode(kv, inviteCode.trim());
                invitedByCode = inviter ? inviter.inviteCode : null;
            } else {
                // 发奖被拒仅记审计日志，不阻断激活（宁可漏发不可误伤）
                await appendLicenseLog(kv, code, {
                    action: 'invite-reward-denied',
                    time: new Date().toISOString(),
                    ip: ip,
                    operator: licenseUser,
                    detail: `邀请码=${String(inviteCode).trim()} 拒绝原因=${inviteResult.reason || 'unknown'}`
                });
            }
        }

        // ★ 给本激活码生成专属邀请码（幂等：已有沿用）——激活成功者即具备邀请资格
        const recordWithInvite = await ensureInviteCode(kv, record);

        // 生成 license 数据
        // ★ v3 新增：将 clinicName + machineId + licenseBinding 传给 buildLicenseData
        // 仅当激活码已绑定诊所名时才启用 v3 签名（含绑定字段）
        // ★ v4 新增：将 maxDevices + devicesCount 传给 buildLicenseData（仅显示用，不参与签名）
        // ★ 推广奖励：合并邀请码 + 被邀奖励天数（被邀请人 +30 天本次签发即生效）
        const licenseRecord = {
            ...record,
            inviteCode: recordWithInvite.inviteCode,
            rewardDays: (record.rewardDays || 0) + inviteeBonusDays,
            user: licenseUser
        };
        const licenseOptions = {};
        if (record.clinicName) {
            licenseOptions.clinicName = record.clinicName;
            licenseOptions.machineId = machineId;
            licenseOptions.licenseBinding = 'clinic+user+machine';
        }
        // ★ v4 新增：多设备授权信息（仅显示用）
        licenseOptions.maxDevices = maxDevices;
        licenseOptions.devicesCount = existingDevice ? devices.length : devices.length + 1;
        // ★ 新增：传递 context 以支持环境变量动态密钥
        licenseOptions.context = context;
        // ★ P1-[2.2] 新增：传递 kv 供 v6 防重放签名使用单调递增签发序号
        licenseOptions.kv = kv;
        const licenseData = await buildLicenseData(licenseRecord, licenseOptions);

        // 更新激活码记录：标记为已使用，绑定机器 ID + 诊所名
        // ★ v4 新增：如果是新设备激活，添加到 devices 数组
        const isReactivation = !!existingDevice;  // 同设备重激活 vs 新设备首次激活
        const updates = {
            status: 'used',
            machineId: machineId,  // 保留旧字段（向后兼容，= devices[0].machineId）
            activatedAt: getNowISO(),
            activatedIp: ip,
            user: licenseUser
        };
        // ★ 2026-08-26 有效期锚定：首次激活时间只写一次（后续重激活/换机激活不变），
        //   buildLicenseData 用 firstActivatedAt + days 计算固定到期时间
        if (!record.firstActivatedAt) {
            updates.firstActivatedAt = getNowISO();
        }
        // ★ 推广奖励：持久化邀请码 / 被邀奖励天数 / 邀请人标识（幂等）
        if (recordWithInvite.inviteCode && recordWithInvite.inviteCode !== record.inviteCode) {
            updates.inviteCode = recordWithInvite.inviteCode;
        }
        if (inviteeBonusDays > 0) {
            updates.rewardDays = (record.rewardDays || 0) + inviteeBonusDays;
            updates.invitedBy = invitedByCode;
        }
        // ★ v3 新增：首次激活时记录 clinicName（已使用重激活时不变更）
        if (record.clinicName && !record.activatedClinicName) {
            updates.activatedClinicName = record.clinicName;
        }
        // ★ v4 新增：更新 devices 数组
        const newDevices = devices.slice();  // 复制现有设备列表
        if (existingDevice) {
            // 同设备重激活：更新该设备的激活时间
            existingDevice.activatedAt = getNowISO();
            existingDevice.clinicName = record.clinicName || existingDevice.clinicName;
        } else {
            // 新设备激活：添加到数组
            const pClass = (productClass || '').trim() || null;
            const cClass = (clientClass || '').trim() || null;
            newDevices.push({
                machineId: machineId,
                activatedAt: getNowISO(),
                clinicName: record.clinicName || clinicName || null,
                activatedIp: ip,
                productClass: pClass,
                clientClass: cClass
            });
        }
        updates.devices = newDevices;
        updates.maxDevices = maxDevices;
        await updateLicense(kv, code, updates);

        // ★ 设备-版本绑定：激活成功后绑定设备版本（同一设备只能注册一个版本）
        try {
            await setDeviceVersion(kv, machineId, versionOf(record.type), {
                licenseCode: code,
                clinicName: record.clinicName || clinicName || '',
                productClass: (productClass || '').trim() || undefined,
                clientClass: (clientClass || '').trim() || undefined
            });
        } catch (e) { console.warn('[DeviceVersion] 绑定失败:', e.message); }

        // ★ P0 修复：存储 codeHash → code 映射（供 verify.js 反查真实校验）
        // verify.js 通过 codeHash 反查 code，再查询 license 记录进行真实校验
        try {
            const codeHashBuf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code));
            const codeHashHex = Array.from(new Uint8Array(codeHashBuf)).map(b => b.toString(16).padStart(2, '0')).join('');
            await kv.put(`codehash:${codeHashHex}`, code);
        } catch (e) { /* 忽略映射存储失败，不影响激活 */ }

        // ★ 任务5：记录激活/重激活日志
        await appendLicenseLog(kv, code, {
            action: isReactivation ? 'reactivate' : 'activate',
            time: updates.activatedAt,
            ip: ip,
            operator: licenseUser,
            detail: `machineId=${machineId.substring(0, 8)}..., clinicName=${record.clinicName || 'null'}, devicesCount=${newDevices.length}/${maxDevices}`
        });

        // 编码为 base64（客户端写入 license.dat 的格式）
        const licenseBase64 = encodeLicenseBase64(licenseData);

        return json({
            success: true,
            license: licenseBase64,
            // ★ 2026-08-26 推广奖励信息（激活成功页展示：专属邀请码 + 阶梯进度 + 本次奖励）
            inviteInfo: {
                inviteCode: recordWithInvite.inviteCode || null,
                inviteCount: record.inviteCount || 0,                    // 已成功邀请人数
                maxInvitees: INVITE_MAX_INVITEES,                        // 封顶 4 人
                rewardDays: (record.rewardDays || 0) + inviteeBonusDays, // 累计奖励天数
                inviteeBonusDays: inviteeBonusDays,                      // 本次作为被邀请人所得（30）
                invitedBy: invitedByCode                                 // 本次激活使用的邀请人码
            },
            licenseInfo: {
                user: licenseData.user,
                type: licenseData.type,
                issuedAt: licenseData.issuedAt,
                expiresAt: licenseData.expiresAt,
                maxPrescriptions: licenseData.maxPrescriptions,
                features: licenseData.features,
                clinicName: licenseData.clinicName || null,           // ★ v3 新增
                licenseBinding: licenseData.licenseBinding || null,   // ★ v3 新增
                maxDevices: licenseData.maxDevices || 1,                // ★ v4 新增
                devicesCount: licenseData.devicesCount || 1             // ★ v4 新增
            }
        });

    } catch (error) {
        console.error('License validate error:', error);
        return json({ success: false, error: '服务器内部错误，请稍后再试' }, 500);
    }
}
