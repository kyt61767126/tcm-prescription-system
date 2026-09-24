// ============================================================================
//  activate-from-ticket.js — 平台管理员审批通过"激活工单" API
//
//  路由：POST /api/license/activate-from-ticket
//
//  认证：Bearer token（platform_admin 或 C批新增 service 客服）
//
//  请求体：
//    {
//      "ticketNo": "TK-XXXXXXXX-XXXXXX",  // 必填
//      "type": "pro",                     // 可选：pro/personal，默认按工单 edition 映射
//      "days": 365,                       // 可选：有效天数（默认 365）
//      "expiresAt": "2027-12-31",         // 可选：到期日期（与 days 二选一）
//      "maxDevices": 2                    // 可选：默认 pro=5 台（机构 3-5 台共用一码）/ personal=2 台
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
//
//  ★ 2026-09-24 P1-B 与主审核 admin-approve 安全对齐（工单通道曾为绕过缺口）：
//    - AR-01 停用诊所硬闸：同名诊所 status=disabled → 409 CLINIC_DISABLED，
//      检查异常 fail-closed 500（与主审核同款，防停用诊所处经工单通道复活）；
//    - licenseRecord 写 firstActivatedAt 锚点（防重激活续命，P0-2026-09-11 同款）；
//    - licenseRecord 写 phone=ticket.contactPhone（lookup 自愈/登录链需要）。
//    不适用项（工单协议无源数据，非缺口）：devices[0] 端形态（工单无 appMode 字段，
//    审批请求 UA 是管理员浏览器不可嗅探，靠客户端心跳补）、邀请码结算（工单无 inviteCode）。
// ============================================================================

import {
    parseAuthHeader, isStaff,
    getClinicsOrThrow, findClinicByName
} from '../_lib/auth.js';
import {
    getKV, saveLicense, buildLicenseData, encodeLicenseBase64,
    generateActivationCode, appendLicenseLog, checkDeviceVersion,
    setDeviceVersion, versionOf, detachDeviceFromOtherLicenses,
    PAID_LICENSE_TYPES
} from './_lib/license-core.js';
import { provisionCloudAccount, normalizeActivationPassword } from './_lib/admin-account.js';
// ★ 2026-09-24 C批双审：审批通过=service 可达最高价值写操作（发付费码+开云端账号），
//   除单码 license 日志外必须落平台级审计，与 reject/unbind 同流可在 audit-logs 追溯
import { writeAuditLog } from '../_lib/audit-log.js';

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
// 语音系：voice / cloud_voice / 语音版（★ 2026-09-17 一期补齐，原漏映射会错归标准版）
// 标准系：personal / standard / cloud_personal / 标准版（含未知值兜底）
function mapEditionToType(edition) {
    const e = String(edition || '').trim().toLowerCase();
    if (['institution', 'institutional', 'jigou', 'clinic', 'pro', 'cloud_clinic'].includes(e) ||
        String(edition || '').includes('机构')) {
        return 'pro';
    }
    if (['voice', 'cloud_voice'].includes(e) || String(edition || '').includes('语音')) {
        return 'voice';
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

    // CAS 回滚句柄：占用成功后赋值；外层 catch 凭它把崩溃残留的 processing 退回 pending
    let rollbackClaim = null;
    // 已生成落库的码：外层 catch 回滚时带上它打日志，防码已发/工单回 pending 产生孤儿码无迹可查
    let issuedCode = null;

    try {
        // 平台员工认证（platform_admin 或 C批 service 客服——客服一键审批即代发激活码，
        // 属用户明确授予能力；下方 AR-01 停用闸/锚点三件套等功能闸门对两类角色同等生效）
        const currentUser = await parseAuthHeader(context.request, context.env);
        if (!currentUser || !isStaff(currentUser)) {
            return json({ success: false, error: '仅平台员工（管理员/客服）可审批工单' }, 403);
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
        const ticketKey = KV_TICKET_PREFIX + ticketNo;
        const ticket = await kv.get(ticketKey, 'json');
        if (!ticket) {
            return json({ success: false, error: '工单不存在或已失效' }, 404);
        }

        // ★ 2026-09-24 安全收尾批 CAS 状态机（防双击/并发双发付费码）：
        //   pending 可审批；approved/rejected 终态 409；processing=他人/前一次请求占用中。
        //   KV 无原子 CAS，采用"processing 占用态 + 随机占用令牌 + 写后复核 + 发码前终审"
        //   逼近互斥；崩溃残留 processing 超 10 分钟允许接管；占用后任何业务错误回滚 pending。
        const PROCESSING_TTL_MS = 10 * 60 * 1000;
        // 占用年龄：NaN（processingAt 缺失/非法）或负值（未来时间，仅 KV 权限级可污染）
        // 一律视为已过期可接管——信任 status 而非可脏时间戳，杜绝工单永久卡死
        const processingAgeMs = (t) => {
            if (!t || !t.processingAt) return NaN;
            return Date.now() - new Date(t.processingAt).getTime();
        };
        if (ticket.status === 'approved' || ticket.status === 'rejected') {
            return json({
                success: false,
                code: 'TICKET_ALREADY_RESOLVED',
                error: `工单${ticket.status === 'approved' ? '已通过' : '已拒绝'}，请勿重复操作`
            }, 409);
        }
        if (ticket.status === 'processing') {
            const ageMs = processingAgeMs(ticket);
            const isFresh = !(isNaN(ageMs) || ageMs < 0 || ageMs >= PROCESSING_TTL_MS);
            if (isFresh) {
                return json({
                    success: false,
                    code: 'TICKET_PROCESSING',
                    error: '工单正在处理中，请勿重复点击（若长时间未完成，请 10 分钟后再试）'
                }, 409);
            }
            console.warn('[ActivateFromTicket] 接管超时/异常残留 processing 工单:', ticketNo,
                'prevBy=', ticket.processingBy, 'at=', ticket.processingAt);
            context.waitUntil(writeAuditLog(kv, null, currentUser.username, currentUser.role,
                'ticket_claim_takeover', ticketNo, context, {
                    channel: 'activate',
                    prevProcessingBy: ticket.processingBy || null,
                    prevProcessingAt: ticket.processingAt || null
                }));
        } else if (ticket.status !== 'pending') {
            return json({
                success: false,
                error: `工单当前状态为 ${ticket.status}，无法审批（仅待审批状态可操作）`
            }, 400);
        }

        // ===== 参数解析（管理员最终确认权，未传时用工单意向的默认值）=====
        // ★ 2026-09-17 改用权威付费类型集合（原硬编码 ['personal','pro'] 漏 voice）
        const type = (body.type && PAID_LICENSE_TYPES.includes(body.type))
            ? body.type
            : mapEditionToType(ticket.edition);
        const days = body.days ? parseInt(body.days, 10) : 365;
        const expiresAt = body.expiresAt || null;

        if (isNaN(days) || days < 1 || days > 3650) {
            return json({ success: false, error: 'days 必须是 1-3650 之间的整数' }, 400);
        }
        // 注：工单一键通过设计为 days 缺省固定 365（body.days 未传时），expiresAt 可覆盖
        //   到期日；不存在主审核"days/expiresAt 二选一必填"场景，故无该必填校验。

        const clinicName = ticket.clinicName;
        if (!clinicName) {
            return json({ success: false, error: '工单中缺少诊所名称' }, 400);
        }

        // ★ 云端产品策略：个人版一个管理员默认授权 2 台设备（桌面+APP）
        // ★ 2026-08-30 机构版策略：type=pro 默认 5 台（机构安装 3-5 台电脑共用一码），
        //   工单审批页只传 ticketNo 不传 maxDevices，服务端必须按 type 兜底
        // ★ 2026-09-17 语音版策略：type=voice 默认 1 台（1年/1设备产品语义）
        // ★ CAS：参数校验全部前移到"占用工单"之前——非法请求不得留下 processing 残留
        let parsedMaxDevices = (type === 'pro') ? 5 : (type === 'voice' ? 1 : 2);
        if (body.maxDevices !== undefined && body.maxDevices !== null) {
            parsedMaxDevices = parseInt(body.maxDevices, 10);
            if (isNaN(parsedMaxDevices) || parsedMaxDevices < 1 || parsedMaxDevices > 10) {
                return json({ success: false, error: 'maxDevices 必须是 1-10 之间的整数' }, 400);
            }
        }

        // 计算到期时间（纯计算，置于占用前）
        let recordExpiresAt = null;
        if (expiresAt) {
            recordExpiresAt = new Date(expiresAt + 'T23:59:59+08:00').toISOString();
        }

        // ===== CAS 占用：立即写 processing + 随机令牌，把双击的第二个请求挡在发码之前 =====
        const claimToken = Array.from(crypto.getRandomValues(new Uint8Array(16)))
            .map(b => b.toString(16).padStart(2, '0')).join('');
        // 回滚助手必须先于占用 put 就绪：连"put 实际落盘但 Promise reject / 随后复核 GET 瞬断"
        //   这类极端情况，外层 catch 也能拿到句柄（否则工单卡 processing 到 10 分钟 TTL）。
        //   仅"仍由本次请求持有令牌"才允许退回 pending，绝不覆盖他人终态/占用；陈旧 pending 读下 no-op。
        const rollbackToPending = async (why) => {
            try {
                const cur = await kv.get(ticketKey, 'json');
                if (cur && cur.status === 'processing' && cur.processingToken === claimToken) {
                    cur.status = 'pending';
                    delete cur.processingBy;
                    delete cur.processingAt;
                    delete cur.processingToken;
                    await kv.put(ticketKey, JSON.stringify(cur));
                    console.log('[ActivateFromTicket] 工单占用已回滚 pending:', ticketNo, 'why=', why);
                    context.waitUntil(writeAuditLog(kv, null, currentUser.username, currentUser.role,
                        'ticket_claim_rollback', ticketNo, context, {
                            reason: String(why || '').slice(0, 80),
                            issuedCode: issuedCode || null
                        }));
                }
            } catch (re) {
                console.warn('[ActivateFromTicket] 回滚 pending 失败:', re && re.message);
            }
        };
        rollbackClaim = rollbackToPending;
        ticket.status = 'processing';
        ticket.processingBy = currentUser.username;
        ticket.processingAt = new Date().toISOString();
        ticket.processingToken = claimToken;
        await kv.put(ticketKey, JSON.stringify(ticket));
        // 写后立即复核：并发双击时两次写 LWW，败者读到他人令牌即弃权（KV 全球最终一致，
        //   极端陈旧读只会让真正胜者误弃权返回 409——失败方向安全；同时尽力回滚自己的占用，
        //   陈旧读到 pending 时回滚 no-op，残留 10 分钟 TTL 自愈）
        const claimed = await kv.get(ticketKey, 'json');
        if (!claimed || claimed.status !== 'processing' || claimed.processingToken !== claimToken) {
            await rollbackToPending('post-claim-verify');
            return json({
                success: false,
                code: 'TICKET_PROCESSING',
                error: '工单正在处理中，请勿重复点击'
            }, 409);
        }

        // ★ 设备-版本绑定校验：若该设备已激活另一版本，则拒绝（占用后失败需回滚）
        const deviceCheck = await checkDeviceVersion(kv, ticket.machineId, type);
        if (!deviceCheck.ok) {
            await rollbackToPending('device-check');
            return json({ success: false, error: deviceCheck.error }, 403);
        }

        // ★ 2026-09-24 P1-B AR-01 对齐（主审核 admin-approve 2026-09-04 已有此闸）：
        //   同名诊所 status=disabled 时，工单审批通过也必须拒绝。工单通道与主审核通道是
        //   激活的两个并列入口，缺这道闸时停用诊所可由"提交工单→另一位管理员一键通过"
        //   复活（provisionCloudAccount disabled→active），平台停用护栏名存实亡。
        // ★ 2026-09-24 安全收尾批：统一走 getClinicsOrThrow——键缺失按空表；
        //   存在但非数组/读取异常 fail-closed（旧写法 `Array.isArray(x) && x.find()`
        //   对非数组合法 JSON 静默放行 = 停用闸失效）。占用后失败需回滚 pending。
        try {
            const clinics = await getClinicsOrThrow(kv);
            const sameNameClinic = findClinicByName(clinics, clinicName);
            if (sameNameClinic && sameNameClinic.status === 'disabled') {
                console.log('[ActivateFromTicket] ★ 同名诊所已停用(disabled)，拒绝工单通过:',
                    clinicName, 'ticketNo=', ticketNo, 'by=', currentUser && currentUser.username);
                await rollbackToPending('clinic-disabled');
                return json({
                    success: false,
                    code: 'CLINIC_DISABLED',
                    error: '诊所「' + clinicName + '」状态为「已停用」，无法通过工单激活。\n' +
                        '若客户确实需要复开，请先在用户管理后台把该诊所状态改为「待审核」或删除该诊所后，再审批此工单。'
                }, 409);
            }
        } catch (de) {
            console.warn('[ActivateFromTicket] 停用诊所同名检查失败(拒绝通过以保安全):', de && de.message);
            await rollbackToPending('clinic-gate-error');
            // 响应固定文案：内部 KV 键名等细节只进服务端日志，不回显给调用方
            return json({
                success: false,
                code: 'CLINIC_CHECK_ERROR',
                error: '诊所状态检查异常，请稍后重试；如持续失败请联系系统管理员'
            }, 500);
        }

        // ===== CAS 终审：不可逆发码（生成付费码+开云端账号）前再读一次，令牌不匹配立即弃权 =====
        const beforeIssue = await kv.get(ticketKey, 'json');
        if (!beforeIssue || beforeIssue.status !== 'processing' ||
            beforeIssue.processingToken !== claimToken) {
            return json({
                success: false,
                code: 'TICKET_PROCESSING',
                error: '工单状态已变化（可能正在被另一请求处理），本次操作已中止，请刷新列表'
            }, 409);
        }

        // 1. 生成新激活码并绑定 clinicName（工单的 machineId 作为首个设备）
        const code = generateActivationCode();
        // ★ 2026-09-24 P1-B：统一激活时刻（与主审核同款），并显式固化 firstActivatedAt
        //   锚点（buildLicenseData 有效期三级回退 firstActivatedAt → activatedAt → now；
        //   不写锚点则该码日后被重激活时可能漂移 = 续命漏洞，P0-2026-09-11）。
        const __approveNow = new Date().toISOString();
        const licenseRecord = {
            code: code,
            user: ticket.contactName,
            // ★ 2026-09-24 P1-B 对齐主审核：独立手机号字段——lookup 自愈接口凭它回填
            //   手机号（user=contactName 多为联系人/诊所名，extractPhone 解析不到）
            phone: ticket.contactPhone || '',
            type: type,
            days: days || null,
            expiresAt: recordExpiresAt,
            issuedAt: __approveNow,
            issuedBy: currentUser.username,
            activatedAt: __approveNow,
            firstActivatedAt: __approveNow,
            activatedIp: ip,
            machineId: ticket.machineId,  // 旧字段（兼容）
            clinicName: clinicName,
            maxDevices: parsedMaxDevices,
            devices: [{
                machineId: ticket.machineId,
                activatedAt: __approveNow,
                clinicName: clinicName,
                activatedIp: ip
                // 注：工单协议无 appMode/appModeCarrier 源数据，端形态留空，
                //   由客户端首次心跳经 UA 嗅探/显式上报补全（heartbeat 仅补空不覆盖）
            }],
            status: 'used',  // 直接标记为已使用（管理员已审批通过）
            note: (ticket.remark || '工单审批一键激活').trim().slice(0, 200)
        };

        await saveLicense(kv, licenseRecord);
        issuedCode = code;  // 码已落库：此后外层 catch 回滚日志会带上它便于人工回收孤儿码

        // ★ 2026-09-23 单设备单码：新码已入库，清理该设备在其他诊所码的残留绑定
        const detachedCodes = await detachDeviceFromOtherLicenses(kv, code, ticket.machineId);
        if (detachedCodes.length) {
            await appendLicenseLog(kv, code, {
                action: 'cross-code-detach',
                time: new Date().toISOString(),
                ip: ip,
                operator: currentUser.username,
                detail: `工单激活绑定设备，已从旧码解绑: ${detachedCodes.join(', ')}`
            });
        }

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

        // 6. 更新工单 status=approved，回写管理员最终决策（清理 CAS 占用字段）
        // ★ CAS 终写复核：本码已发不可逆，覆盖前最后一读——若占用已超时被他人接管并产出
        //   终态（approved/rejected），绝不盲写覆盖；本码记入冲突审计供人工回收/解绑。
        const beforeTerminal = await kv.get(ticketKey, 'json');
        if (!beforeTerminal || beforeTerminal.status !== 'processing' ||
            beforeTerminal.processingToken !== claimToken) {
            console.error('[ActivateFromTicket] ★终写复核失败，放弃覆盖终态（码已发，需人工核对）:',
                ticketNo, 'localCode=', code, 'remoteStatus=', beforeTerminal && beforeTerminal.status,
                'remoteCode=', beforeTerminal && beforeTerminal.licenseCode, 'by=', currentUser.username);
            context.waitUntil(writeAuditLog(kv, null, currentUser.username, currentUser.role,
                'ticket_approve_terminal_conflict', ticketNo, context, {
                    localLicenseCode: code,
                    remoteStatus: beforeTerminal ? beforeTerminal.status : 'missing',
                    remoteLicenseCode: beforeTerminal && beforeTerminal.licenseCode ? beforeTerminal.licenseCode : null,
                    machineIdHint: ticket.machineId ? ticket.machineId.substring(0, 8) : null
                }));
            return json({
                success: false,
                code: 'TICKET_PROCESSED_ELSEWHERE',
                error: '工单可能已被另一请求处理完成，本次未覆盖审批结果；请刷新列表核对。' +
                    '如发现同工单两个激活码，请联系管理员在激活码列表核查回收'
            }, 409);
        }
        ticket.status = 'approved';
        delete ticket.processingBy;
        delete ticket.processingAt;
        delete ticket.processingToken;
        ticket.resolvedAt = new Date().toISOString();
        ticket.resolvedBy = currentUser.username;
        ticket.licenseCode = code;
        ticket.licenseBase64 = licenseBase64;
        ticket.type = type;                 // 管理员最终选的版本（pro=机构版 / personal=标准版）
        ticket.days = days || null;
        ticket.expiresAt = recordExpiresAt || null;
        ticket.maxDevices = parsedMaxDevices;
        await kv.put(KV_TICKET_PREFIX + ticketNo, JSON.stringify(ticket));

        // ★ C批双审：平台级审计（waitUntil 不阻塞响应；操作者取自 token，不可被参数伪造）
        context.waitUntil(writeAuditLog(kv, null, currentUser.username, currentUser.role,
            'ticket_approve', ticketNo, context, {
                licenseCode: code,
                type,
                days: days || null,
                expiresAt: recordExpiresAt || null,
                maxDevices: parsedMaxDevices,
                clinicName: clinicName || null,
                machineIdHint: ticket.machineId ? ticket.machineId.substring(0, 8) : null
            }));

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
        console.error('Activate from ticket error:', error, 'issuedCode=', issuedCode || 'none');
        // CAS：占用后抛错（如 KV 写许可中断），尽力把工单退回 pending，防崩溃残留卡死。
        //   若码已落库（issuedCode 非空），回滚审计会带码号，供人工回收孤儿码。
        if (rollbackClaim) {
            try { await rollbackClaim('outer-error' + (issuedCode ? ':code=' + issuedCode : '')); } catch (_) { /* 忽略二次异常 */ }
        }
        return json({ success: false, error: '服务器内部错误，请稍后再试' }, 500);
    }
}
