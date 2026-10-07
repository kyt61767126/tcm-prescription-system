// ============================================================================
//  admin-submit.js — 客户端"管理员激活"请求提交 API
//
//  路由：POST /api/license/admin-submit
//
//  无需登录认证（客户端激活前尚未登录），但有以下保护：
//    - 速率限制：每 IP 每小时 10 次提交
//    - 手机号格式校验
//    - 必填字段校验
//
//  请求体：
//    {
//      "clinicName": "惠康中医诊所",     // 必填
//      "adminName": "张医生",            // 必填
//      "phone": "13800138000",           // 必填（11位手机号）
//      "remark": "备注说明",             // 可选
//      "machineId": "abc123def456"       // 必填
//    }
//
//  返回：
//    { "success": true, "requestId": "REQ-XXXXXXXX-XXXX" }
//    { "success": false, "error": "错误原因" }
//
//  KV 数据结构：
//    key: admin_req:{requestId}
//    value: { requestId, clinicName, adminName, phone, remark, machineId,
//             status, submittedAt, resolvedAt, licenseCode, licenseBase64,
//             rejectReason, resolvedBy }
//    key: admin_req_index  -> [requestId1, requestId2, ...]
// ============================================================================

import {
    getKV, checkRateLimit, checkDeviceVersion, getDeviceBlock,
    // ★ 2026-10-06 机构版多设备免客服自动加机：复用 validate 多机权威链路
    getLicense, updateLicense, getDevices, getMaxDevices,
    buildLicenseData, encodeLicenseBase64, appendLicenseLog,
    detachDeviceFromOtherLicenses, setDeviceVersion, versionOf,
    evaluateProductClassGate, normalizeCodeProductClass // ★ 2026-10-07 码-端锁定闸
} from './_lib/license-core.js';
import { provisionCloudAccount, normalizeActivationPassword } from './_lib/admin-account.js';
// ★ 2026-09-17 P0 修复：补 KV_ADMIN_REQ_INDEX import——原 3 处使用（L51/L72/L399）
//   均未定义未导入，L399 在 onRequest 主体同步抛 ReferenceError → 全新手机号
//   （无 admin_phone 索引）走兜底扫描必 500，管理员激活申请通道对新客户损坏。
import { createAdminRequest, updateAdminRequestStatus, ensureLicenseV7, KV_ADMIN_REQ_INDEX } from './_lib/license-write-service.js';
import { findPhoneOccupancy, hashPassword, verifyPassword, getClinicsOrThrow, findClinicByName } from '../_lib/auth.js';
// ★ 2026-09-07 架构防御：手机号校验收口 schema-guard 单一副本
import { isValidPhone } from './_lib/schema-guard.js';

// ★ 2026-08-20 查找某手机号下最近一条"已通过"的激活申请
//   - 优先手机号索引（O(1)）；索引指向 pending/rejected 时再兜底扫描请求索引
//   - 只返回 status === 'activated' 的记录
async function findActivatedRequestForPhone(kv, phone) {
    try {
        if (!isValidPhone(phone)) return null;
        const idx = await kv.get('admin_phone:' + phone, 'json');
        if (idx && idx.requestId) {
            const rec = await kv.get(KV_ADMIN_REQ_PREFIX + idx.requestId, 'json');
            if (rec && rec.phone === phone && rec.status === 'activated') return rec;
        }
        // 兜底扫描（最新优先，找到即停），兼容索引指向过期/被覆盖申请的情况
        const list = (await kv.get(KV_ADMIN_REQ_INDEX, 'json')) || [];
        for (const rid of list.slice(0, 200)) {
            const rec = await kv.get(KV_ADMIN_REQ_PREFIX + rid, 'json');
            if (rec && rec.phone === phone && rec.status === 'activated') return rec;
            if (rec && rec.phone === phone && rec.status === 'pending') break; // 出现更新未审申请后不再往后找
        }
        return null;
    } catch (e) {
        console.warn('[AdminSubmit] 查找已激活申请失败:', e.message);
        return null;
    }
}

// ★ 2026-09-02 支付前置校验：查找该手机号或本设备"已完成付款"的官网订单
//   （order-paid 确认后写入 paidAt，状态 pending=待管理员核对 / activated=已激活）。
//   按索引最新在前扫描，命中即返回。
//   安全注意：machineId 为客户端任意提交参数（不可信），仅凭 machineId 命中的
//   记录严禁触发账号补开/密码归一化（防接管，对齐 admin-status 2026-08-31 修复），
//   本函数只做只读查找，账号操作由调用方按 phone 是否一致决定。
async function findPaidOrderForPhoneOrMachine(kv, phone, machineId) {
    try {
        const list = (await kv.get(KV_ADMIN_REQ_INDEX, 'json')) || [];
        for (const rid of list.slice(0, 200)) {
            const rec = await kv.get(KV_ADMIN_REQ_PREFIX + rid, 'json').catch(() => null);
            if (!rec || !rec.paidAt) continue;
            if (rec.status !== 'pending' && rec.status !== 'activated') continue;
            if (rec.phone === phone || (machineId && rec.machineId === machineId)) return rec;
        }
        return null;
    } catch (e) {
        console.warn('[AdminSubmit] 已付款订单查找失败:', e.message);
        return null;
    }
}

// ★ 2026-10-06 机构版多设备免客服自动加机（方案A：登录密码核验）
// 安全模型：admin-submit 是匿名接口、手机号半公开（名片/客服处可得），故 2026-09-03
// P0 决策禁止"仅凭手机号"在他机做任何授权/账号操作。密码是私密凭证，与登录同信任级：
// 持手机号+正确密码 = 账号本人，在多机配额内自动绑机不构成接管。
// ★ 双审修复（2026-10-07）：云端记录【只信诊所实时账号表】，不再接受 admin_req 内
//   注册哈希——用户改密/员工离职后旧密码必须立即失效（否则旧密码可永久加机，且经
//   owner 短路演化为账号接管 P0）。遍历所有诊所按 username/phone 命中（防诊所改名/
//   同名诊所失配，语义同 users.js findUserForLogin 的 KV 链路）。离线记录无实时账号
//   表，admin_req 注册哈希是唯一权威，保留。
// 任何异常仅告警并返回 false（fail-closed）。
async function verifyExistingDeviceSecret(kv, record, phone, rawPassword) {
    if (!rawPassword || typeof rawPassword !== 'string' || rawPassword.length < 8) return false;
    const _phone = String(phone || '').trim();
    if (record && record.appMode === 'cloud') {
        try {
            const clinics = await getClinicsOrThrow(kv);
            for (const clinic of clinics) {
                if (!clinic || !clinic.id) continue;
                const users = await kv.get(`clinic:${clinic.id}:users`, 'json').catch(() => null);
                if (!Array.isArray(users)) continue;
                const u = users.find(x => x && (x.username === _phone || x.phone === _phone));
                if (!u) continue;
                // 停用账号/停用诊所跳过（字段对齐 users.js：账号是布尔 disabled，
                //   诊所是 status==='disabled'；扫描语义同 findUserForLogin——跨诊所
                //   历史脏数据时可继续找其他启用诊所的同手机号账号）
                if (u.disabled === true || clinic.status === 'disabled') continue;
                if (u.passwordHash && u.salt &&
                    await verifyPassword(rawPassword, u.passwordHash, u.salt)) {
                    return true;
                }
                return false;  // 命中启用账号但密码错：终局，不再 fallthrough
            }
        } catch (e) { console.warn('[AutoBind] 云端实时账号密码核验异常:', e.message); }
        return false;
    }
    // 离线版：激活时设置的密码哈希即权威
    try {
        if (record && record.passwordHash && record.passwordSalt) {
            return await verifyPassword(rawPassword, record.passwordHash, record.passwordSalt);
        }
    } catch (e) { console.warn('[AutoBind] 记录密码核验异常:', e.message); }
    return false;
}

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
    // ★ 2026-08-30 CORS 回退对齐 users.js 先例：未知 Origin（含 file:// 客户端的 Origin: null，
    //   如离线APP WebView）回退 'null' 放行。激活申请/状态为公开注册链路（requestId 服务端随机签发，
    //   仅提交者持有，且接口自带 IP 限流），放行 null 与 users.js 登录接口同基线。
    const allowedOrigin = (origin && ALLOWED_ORIGINS.includes(origin)) ? origin : 'null';
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

function getClientIP(context) {
    return context.request.headers.get('CF-Connecting-IP') ||
           context.request.headers.get('X-Forwarded-For') ||
           context.request.headers.get('X-Real-IP') ||
           'unknown';
}

// 生成请求 ID：REQ-XXXXXXXXXXXX-XXXX（12位时间戳后缀 + 4位随机）
function generateRequestId() {
    const ts = Date.now().toString(36).toUpperCase().padStart(9, '0').slice(-9);
    const rand = Array.from(crypto.getRandomValues(new Uint8Array(2)))
        .map(b => b.toString(16).toUpperCase().padStart(2, '0')).join('');
    return `REQ-${ts}-${rand}`;
}

const KV_ADMIN_REQ_PREFIX = 'admin_req:';

export async function onRequest(context) {
    _currentRequest = context.request;
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

        // 速率限制（防滥用，每 IP 每小时 10 次）
        const ip = getClientIP(context);
        const rateLimit = await checkRateLimit(kv, ip + ':admin-submit', 10);
        if (!rateLimit.allowed) {
            return json({
                success: false,
                error: '提交请求过于频繁，请稍后再试（每小时限 10 次）',
                rateLimited: true
            }, 429);
        }

        const body = await context.request.json().catch(() => ({}));
        const { clinicName, adminName, phone, remark, machineId,
                productName, edition, appMode, versionLabel, env, appModeCarrier, inviteCode, password } = body;

        // ★ 2026-08-22 纯网页环境（pages.dev 浏览器）无 electron / android machineId，
        //   前端传 'unknown' / '未知' / 短值时自动兜底生成 browser-xxx 临时机器ID。
        //   说明：桌面 / APP 端 "一机一版本绑定" 的强校验针对原生环境，浏览器环境
        //   用户可在任意终端注册激活，不强求真实 machineId，仅保证长度满足下游逻辑。
        let finalMachineId = (machineId || '').trim();
        const NEED_FALLBACK = !finalMachineId ||
            finalMachineId.length < 8 ||
            finalMachineId === 'unknown' ||
            finalMachineId === '未知';
        if (NEED_FALLBACK) {
            try {
                const rand = Array.from(new Uint8Array(9))
                    .map(b => b.toString(16).padStart(2, '0')).join('');
                finalMachineId = 'browser-' + rand; // 固定前缀 + 18 位随机 = 26 位
            } catch (e) {
                finalMachineId = 'browser-' + Date.now().toString(16) + Math.random().toString(16).slice(2, 10);
            }
        }

        // 参数校验
        if (!clinicName || typeof clinicName !== 'string' || clinicName.trim().length === 0) {
            return json({ success: false, error: '请填写诊所名称' }, 400);
        }
        if (clinicName.length > 100) {
            return json({ success: false, error: '诊所名称长度不能超过 100 字符' }, 400);
        }
        if (clinicName.includes('|')) {
            return json({ success: false, error: '诊所名称不能包含特殊字符 |' }, 400);
        }
        if (!adminName || typeof adminName !== 'string' || adminName.trim().length === 0) {
            return json({ success: false, error: '请填写管理员姓名' }, 400);
        }
        if (adminName.length > 50) {
            return json({ success: false, error: '管理员姓名长度不能超过 50 字符' }, 400);
        }
        if (!phone || !isValidPhone(phone)) {
            return json({ success: false, error: '请填写正确的 11 位手机号' }, 400);
        }
        if (!finalMachineId || typeof finalMachineId !== 'string' || finalMachineId.length < 8) {
            return json({ success: false, error: '机器 ID 无效，请重启软件后重试' }, 400);
        }
        if (remark && (typeof remark !== 'string' || remark.length > 500)) {
            return json({ success: false, error: '备注长度不能超过 500 字符' }, 400);
        }

        // ★ 2026-09-05 管理员激活路径补齐邀请码（选填）：格式对齐 validate.js（4~10位字母数字），
        //   统一转大写（findLicenseByInviteCode 内部 toUpperCase 匹配）；非法 400 前端可修正重提。
        const inviteCodeClean = (typeof inviteCode === 'string') ? inviteCode.trim().toUpperCase() : '';
        if (inviteCodeClean && !/^[A-Z0-9]{4,10}$/.test(inviteCodeClean)) {
            return json({ success: false, error: '邀请码格式不正确（4-10位字母或数字，没有可留空）' }, 400);
        }

        // ★ 2026-09-07 注册密码生效（维生素诊所测试反馈：自设密码被归一化 admin 丢弃）：
        //   客户端注册表单的密码（选填，HTTPS 传输与登录同级安全）哈希后随申请落库——
        //   审核通过后 provisionCloudAccount/normalizeActivationPassword 用它开账户/重置，
        //   而非硬编码 admin。不传/空/格式非法 → 无哈希 → 保持旧行为（默认密码 admin）。
        //   KV 只存 PBKDF2 哈希不存明文；admin-status 响应不下发（license 同级保密）。
        let passwordCred = null;
        const pwdRaw = (typeof password === 'string') ? password : '';
        if (pwdRaw) {
            if (pwdRaw.length < 8 || pwdRaw.length > 32 || !/[a-zA-Z]/.test(pwdRaw) || !/[0-9]/.test(pwdRaw)) {
                return json({ success: false, error: '密码需 8-32 位且同时包含字母和数字' }, 400);
            }
            const { passwordHash, salt } = await hashPassword(pwdRaw);
            passwordCred = { passwordHash, salt };
        }

        // ★ 设备-版本绑定校验：同一台设备只能提交一个版本
        // 若该设备已绑定另一版本，则拒绝提交该版本的激活请求
        //   （纯浏览器环境 finalMachineId = 'browser-xxx'，checkDeviceVersion 内部会对 browser- 前缀放行）
        if (edition) {
            const deviceCheck = await checkDeviceVersion(kv, finalMachineId, edition);
            if (!deviceCheck.ok) {
                return json({ success: false, error: deviceCheck.error }, 403);
            }
        }

        // ★ 2026-09-04 AR-01 修复：已停用（disabled）诊所——不允许匿名重新提交激活申请。
        //   风险等级=高；影响范围=provisionCloudAccount 已有同名诊所 status 升级语义。
        //   若诊所 status=disabled，代表平台管理员已**人工决策停用**该诊所（违规/欠费/注销等）。
        //   旧修复 provisionCloudAccount 的 disabled→active 升级分支会让"客户重新申请+付款→管理员
        //   审核通过"即可绕过停用决策，让平台的停用能力形同虚设。必须在申请入口处直接拦截：
        //   提示客户联系客服复开（正常业务流程），而不是让前台重注册一条请求去绕开护栏。
        try {
            // ★ 2026-09-24 安全收尾批：统一走 getClinicsOrThrow——存在但非数组/读取异常
            //   一律 fail-closed。旧实现 catch 后"放行申请"，KV 故障或清单损坏期间停用诊所
            //   可由匿名入口重新提交（三条通道必须同口径，见 KNOWLEDGE §26 P2→§28）。
            const clinics = await getClinicsOrThrow(kv);
            const sameNameClinic = findClinicByName(clinics, clinicName);
            if (sameNameClinic && sameNameClinic.status === 'disabled') {
                console.log('[AdminSubmit] ★ 同名诊所已停用(disabled)，拒绝新申请:',
                    clinicName, 'phone=', phone, 'machineId=', finalMachineId.substring(0, 8));
                return json({
                    success: false,
                    code: 'CLINIC_DISABLED',
                    error: '诊所「' + clinicName + '」已被停用，请联系客服微信 hktzy1688 办理复开，不要重新提交新的激活申请。'
                }, 409);
            }
        } catch (de) {
            console.warn('[AdminSubmit] 停用诊所同名检查失败(fail-closed 拒绝申请):', de && de.message);
            return json({
                success: false,
                code: 'CLINIC_CHECK_ERROR',
                error: '系统繁忙，暂时无法提交激活申请，请稍后再试；如持续失败请联系客服微信 hktzy1688'
            }, 503);
        }

        // ★ 2026-08-20 已激活申请短路：该手机号此前已有"管理员审核通过"的激活申请（且可能
        //   因旧账号密码不一致导致登录 401）。此时不重复排队新申请，直接复用该已激活申请：
        //   做一次密码归一化（重置为默认 admin），返回该 requestId，让客户端轮询 admin-status
        //   拿到 activated 后提示"激活成功"，从而使用 133xxxx/admin 即可登录。
        //   ★ 2026-09-03 P0 安全修订：原注释"持有自己手机号即不构成接管"论证错误——手机号是
        //   公开信息且本接口匿名无验证码，必须校验提交者 machineId 属于该激活记录绑定设备
        //   （见下方 _isOwnerDevice），设备不匹配一律拒绝账号操作。
        {
            let existingActivated = await findActivatedRequestForPhone(kv, phone);
            if (existingActivated) {
                // ★ 2026-09-03 P0 安全修复（匿名手机号账户接管漏洞）：
                //   admin-submit 是匿名接口（激活前无登录态），手机号不是秘密（名片/客服/
                //   公开渠道可得），且本接口不验证手机号持有权（无短信验证码）。原逻辑仅凭
                //   phone 命中已激活记录就执行 normalizeActivationPassword（把该手机号下全部
                //   云端账号密码重置为 admin）并下发 licenseBase64 —— 攻击者只要知道受害者
                //   手机号即可匿名提交（machineId 伪造任意 ≥8 位串即可通过格式校验），随后用
                //   "手机号 + admin" 登录接管云端诊所（处方/患者数据全泄露）。
                //   对齐 admin-status.js viaMachineIdFallback 防护哲学（该文件 L110-L114 注释
                //   明确描述了同一攻击）：只有"提交者设备 == 激活记录绑定设备"（=同机重装/
                //   重装 APP，machineId 设备级不变）才是受信场景，才允许账号补开/密码归一化/
                //   下发 license。设备不匹配（换机/冒用）不在此短路处理：换机走客服免费白名单
                //   或后台换机解绑（既有流程），机构版多机走 Tab2 输同一激活码（validate 多机
                //   校验自动加 devices）。
                const _boundMachines = new Set();
                if (existingActivated.machineId) _boundMachines.add(String(existingActivated.machineId));
                const _boundDevs = existingActivated.devices;
                if (Array.isArray(_boundDevs)) {
                    for (const _bd of _boundDevs) {
                        const _bm = (_bd && typeof _bd === 'object') ? (_bd.machineId || _bd.id || '') : _bd;
                        if (_bm) _boundMachines.add(String(_bm));
                    }
                }
                const _isOwnerDevice = !!finalMachineId && _boundMachines.has(String(finalMachineId));
                if (!_isOwnerDevice) {
                    // ================================================================
                    // ★ 2026-10-06 机构版多设备免客服自动加机（方案A：登录密码核验）
                    // ★ 2026-10-07 双审修复（P0/P1）：
                    //   ① 绝不回写 admin_req.devices——附属机一旦出现在 admin_req 即被
                    //      上方 owner 判定当作首机，匿名触发 normalizeActivationPassword
                    //      重置云端账号密码=账号接管（2026-09-03 同 sink P0）。多机权威
                    //      只存 license:{code}.devices。
                    //   ② 云端密码只信诊所实时账号表（见 verifyExistingDeviceSecret）。
                    //   ③ 授权被禁用/过期、设备跨版本、满额、密码错全部 fail-closed。
                    //   ④ 签发与过期闸前置于任何写库（镜像 validate L486-502），写库
                    //      顺序 detach→updateLicense→setDeviceVersion 与 validate 一致，
                    //      不回写 maxDevices（管理端独占配额，防并发抬升）。
                    //   ⑤ 配额判定先于密码核验：消除"密码对错预言机"侧信道。
                    //   ⑥ 密码核验前的匿名拒绝不回机位数/机位数上限（防客户分层枚举）。
                    // ================================================================
                    const __code = existingActivated.licenseCode || '';
                    const __licRec = __code ? await getLicense(kv, __code).catch(() => null) : null;
                    const __maxDev = __licRec ? getMaxDevices(__licRec) : 1;
                    const __licDevices = __licRec ? getDevices(__licRec) : [];
                    const __midStr = String(finalMachineId);
                    const __existingDev = __licDevices.find(d => d && String(d.machineId) === __midStr);
                    const __canMulti = !!__licRec && (__maxDev > 1 || !!__existingDev);

                    if (__canMulti) {
                        // 闸1：封锁设备一律拒（锚定提交机本身，不查首机）
                        const __blkNew = await getDeviceBlock(kv, __midStr);
                        if (__blkNew) {
                            console.warn('[AutoBind] 封锁设备自动加机被拒:', __midStr.slice(0, 8), __blkNew.reason);
                            return json({ success: false, error: '设备安全校验未通过，请更换设备或联系客服处理' }, 403);
                        }
                        // 闸2：授权状态（后台禁用/吊销/过期码不得借加机复活）
                        if (__licRec.status === 'disabled' || __licRec.status === 'expired') {
                            console.warn('[AutoBind] 授权已' + __licRec.status + '，拒绝加机:', phone, __code);
                            return json({ success: false, code: 'LICENSE_DISABLED',
                                error: '该授权已被停用，请联系客服微信 hktzy1688' }, 403);
                        }
                        // 闸3：设备-版本绑定（同一设备只能注册一个版本，镜像 validate L202-214）
                        const __verChk = await checkDeviceVersion(kv, __midStr, __licRec.type);
                        if (!__verChk.ok) {
                            await appendLicenseLog(kv, __code, {
                                action: 'auto-bind-denied',
                                time: new Date().toISOString(),
                                ip: ip,
                                operator: phone.trim(),
                                detail: '设备已绑' + (__verChk.boundLabel || '其他版本') + '，拒绝加机 machineId=' + __midStr.slice(0, 8) + '...'
                            }).catch(() => {});
                            return json({ success: false, error: __verChk.error || '该设备已绑定其他版本授权，无法重复绑定' }, 403);
                        }
                        if (__verChk.upgrade) {
                            await appendLicenseLog(kv, __code, {
                                action: 'version-upgrade',
                                time: new Date().toISOString(),
                                ip: ip,
                                operator: phone.trim(),
                                detail: '自动加机设备版本升级，machineId=' + __midStr.slice(0, 8) + '...'
                            }).catch(() => {});
                        }

                        // ★ 2026-10-07 请求端判定（双审加固版，统一走权威归一）：请求端
                        //   以【本次提交】客户端自报为准，非字符串/数组不再被 String() 强转
                        //   成合法值；'local'→offline；'app'/非法值忽略。
                        //   ① body.productClass（渲染层/新版 APP 显式上报 cloud/offline）；
                        //   ② body.appMode（Electron 激活窗与 auth-core 必报：cloud→cloud，
                        //      local/offline→offline；旧值 'app' 是载体非端，忽略）。
                        //   禁止回退 existingActivated.appMode——那是【首机】端：跨端加机
                        //   攻击（99 本地码第二台机挂云端软件）正是本闸要拦的场景，用首机
                        //   端会把攻击请求误判为 offline 放行。
                        let __pClass = null;
                        const __pcNorm = normalizeCodeProductClass(body.productClass);
                        if (__pcNorm && __pcNorm !== 'INVALID') __pClass = __pcNorm;
                        if (!__pClass) {
                            const __amNorm = normalizeCodeProductClass(body.appMode);
                            if (__amNorm && __amNorm !== 'INVALID') __pClass = __amNorm;
                        }
                        const __cClass = (typeof body.clientClass === 'string' && body.clientClass.trim())
                            ? body.clientClass.trim() : null;

                        // 闸0（2026-10-07 码-端锁定）：先于配额/验密——不泄露机位余量等
                        //   分层信息（与既有⑤"配额先于密码"同原则）。
                        //   · 预置锁端码（淘宝库存码，source='preset'）：必须同端加机；
                        //     旧客户端未上报端 → fail-closed 403 提示升级；同设备重激活同过闸；
                        //   · 派生锁（无预置历史码/官网码，source='device'）：观察期只审计
                        //     不拦截（双审中-2：旧客户端与历史混合端诊所零误伤）。
                        const __pcGate = evaluateProductClassGate(__licRec, __pClass);
                        if (!__pcGate.check.ok) {
                            const __reqEndDesc = __pcGate.requestEnd || '(缺失/无法识别)';
                            if (__pcGate.source === 'preset') {
                                await appendLicenseLog(kv, __code, {
                                    action: 'product-class-denied',
                                    time: new Date().toISOString(),
                                    ip: ip,
                                    operator: phone.trim(),
                                    detail: '自动加机/重激活端锁定拒绝：码锁端=' + __pcGate.locked +
                                        '，请求端=' + __reqEndDesc +
                                        '，machineId=' + __midStr.slice(0, 8) + '...，' +
                                        (__existingDev ? '同设备重激活' : '新设备加机') +
                                        '，原因=' + __pcGate.check.code
                                }).catch(() => {});
                                return json({ success: false, code: __pcGate.check.code, error: __pcGate.check.error }, 403);
                            }
                            await appendLicenseLog(kv, __code, {
                                action: 'product-class-derived-observe',
                                time: new Date().toISOString(),
                                ip: ip,
                                operator: phone.trim(),
                                detail: '自动加机/重激活派生端不一致观察（不拦截）：在册锁端=' + __pcGate.locked +
                                    '，请求端=' + __reqEndDesc +
                                    '，machineId=' + __midStr.slice(0, 8) + '...，' +
                                    (__existingDev ? '同设备重激活' : '新设备加机') +
                                    '，原因=' + __pcGate.check.code
                            }).catch(() => {});
                        }

                        let __newDevices;
                        let __isReactivate = false;
                        if (__existingDev) {
                            // 同设备重激活（权威 license 已绑，admin_req 漂移自愈）：免密，
                            // 动作对齐 validate 重激活（刷新激活时间/补空端形态/跨码清残留/版本绑定）
                            __isReactivate = true;
                            __existingDev.activatedAt = new Date().toISOString();
                            __existingDev.clinicName = __licRec.clinicName || existingActivated.clinicName || __existingDev.clinicName;
                            if (!__existingDev.clientClass && __cClass) __existingDev.clientClass = __cClass;
                            if (!__existingDev.productClass && __pClass) __existingDev.productClass = __pClass;
                            __newDevices = __licDevices.slice();
                            console.log('[AutoBind] 本机已在权威 license 绑定，按重激活处理:', phone, __code);
                        } else {
                            // 全新设备：先判配额（满额不验密码，防对错预言机）
                            if (__licDevices.length >= __maxDev) {
                                await appendLicenseLog(kv, __code, {
                                    action: 'auto-bind-denied',
                                    time: new Date().toISOString(),
                                    ip: ip,
                                    operator: phone.trim(),
                                    detail: '机位已满，拒绝加机 machineId=' + __midStr.slice(0, 8) + '..., devices=' + __licDevices.length + '/' + __maxDev
                                }).catch(() => {});
                                console.log('[AutoBind] 机位已满，拒绝加机:', phone, __licDevices.length + '/' + __maxDev);
                                return json({
                                    success: false,
                                    code: 'DEVICE_LIMIT',
                                    error: '该授权的设备名额已满。请先在不再使用的设备上解绑，或联系客服微信 hktzy1688 办理换机'
                                }, 409);
                            }
                            // 密码核验（私密凭证，与登录同信任级；fail-closed）
                            const __pwdOk = await verifyExistingDeviceSecret(kv, existingActivated, phone.trim(), pwdRaw);
                            if (!__pwdOk) {
                                // 未带密码：引导自助，不消耗失败桶（无 PBKDF2 成本，
                                //   且已有 IP 10/h 桶兜底；防匿名者烧掉他人小时配额）
                                if (!pwdRaw) {
                                    console.log('[AutoBind] 多机新设备未提供密码，引导自助:', phone);
                                    return json({
                                        success: false,
                                        code: 'AUTO_BIND_NEED_PASSWORD',
                                        error: '本机是该授权尚未绑定的新设备。若您的授权支持多台设备（机构版）且仍有余额，请在密码框输入该账号的【当前登录密码】后重新提交，系统将自动绑定本机，无需联系客服；也可切换到「激活码激活」页输入原激活码。注意：登录密码不足 8 位（如默认 admin）时无法使用本功能，请先在已激活设备上修改为 8 位以上含字母和数字的密码。'
                                    }, 409);
                                }
                                // 手机号桶防爆破：每小时 5 次【错误密码】（与 IP 10/h 双桶
                                //   独立，key 不含 IP → 分布式 IP 无法放大）
                                const __fl = await checkRateLimit(kv, 'autobindfail:' + phone.trim(), 5);
                                if (!__fl.allowed) {
                                    return json({
                                        success: false, code: 'AUTO_BIND_RATE_LIMITED',
                                        error: '密码核验尝试过于频繁，请 1 小时后再试；也可切换「激活码激活」页输入原激活码，或联系客服微信 hktzy1688'
                                    }, 429);
                                }
                                await appendLicenseLog(kv, __code, {
                                    action: 'auto-bind-denied',
                                    time: new Date().toISOString(),
                                    ip: ip,
                                    operator: phone.trim(),
                                    detail: '密码核验失败，拒绝自动加机 machineId=' + __midStr.slice(0, 8) + '..., devices=' + __licDevices.length + '/' + __maxDev
                                }).catch(() => {});
                                return json({
                                    success: false,
                                    code: 'AUTO_BIND_PASSWORD_MISMATCH',
                                    error: '登录密码核验未通过。请确认输入的是该账号【当前正在使用的登录密码】（非默认 admin、非支付密码）；忘记密码请在已登录设备修改为 8 位以上新密码后再试，或切换「激活码激活」页输入原激活码；换机请联系客服微信 hktzy1688。'
                                }, 409);
                            }
                            __newDevices = __licDevices.concat([{
                                machineId: __midStr,
                                activatedAt: new Date().toISOString(),
                                clinicName: __licRec.clinicName || existingActivated.clinicName || null,
                                activatedIp: ip,
                                productClass: __pClass,
                                clientClass: __cClass
                            }]);
                        }

                        // 先签发：锚定 firstActivatedAt 防续命（与 validate 同源），
                        //   过期在此拦截，确保随后写库不会产生"加机成功却拿到过期授权"
                        const __licenseRecord = Object.assign({}, __licRec, {
                            user: __licRec.user || existingActivated.adminName || 'user'
                        });
                        if (!__licenseRecord.firstActivatedAt && __licenseRecord.activatedAt) {
                            __licenseRecord.firstActivatedAt = __licenseRecord.activatedAt;
                        }
                        const __licenseData = await buildLicenseData(__licenseRecord, {
                            clinicName: __licRec.clinicName || existingActivated.clinicName || '',
                            machineId: __midStr,
                            licenseBinding: 'clinic+user+machine',
                            maxDevices: __maxDev,
                            devicesCount: __newDevices.length,
                            kv: kv,
                            context: context
                        });
                        const __expMs = new Date(__licenseData.expiresAt).getTime();
                        if (isNaN(__expMs) || Date.now() > __expMs) {
                            await appendLicenseLog(kv, __code, {
                                action: 'auto-bind-denied',
                                time: new Date().toISOString(),
                                ip: ip,
                                operator: phone.trim(),
                                detail: '授权已过期，拒绝加机/重激活 machineId=' + __midStr.slice(0, 8) + '...'
                            }).catch(() => {});
                            return json({ success: false, code: 'LICENSE_EXPIRED',
                                error: '该授权已到期，请续费后再在本机激活' }, 403);
                        }

                        // 闸后写库（仅 license 权威记录；不写 admin_req、不回写 maxDevices）
                        const __detached = await detachDeviceFromOtherLicenses(kv, __code, __midStr);
                        await updateLicense(kv, __code, { devices: __newDevices });
                        try {
                            await setDeviceVersion(kv, __midStr, versionOf(__licRec.type), {
                                licenseCode: __code,
                                clinicName: __licRec.clinicName || existingActivated.clinicName || '',
                                productClass: __pClass || undefined,
                                clientClass: __cClass || undefined
                            });
                        } catch (e) { console.warn('[AutoBind] 设备版本绑定失败:', e.message); }
                        if (__detached.length) {
                            await appendLicenseLog(kv, __code, {
                                action: 'cross-code-detach',
                                time: new Date().toISOString(),
                                ip: ip,
                                operator: phone.trim(),
                                detail: '自动加机绑定本码，已从 ' + __detached.length + ' 个旧码解绑: ' + __detached.join(', ')
                            }).catch(() => {});
                        }
                        await appendLicenseLog(kv, __code, {
                            action: __isReactivate ? 'reactivate' : 'device-auto-bind',
                            time: new Date().toISOString(),
                            ip: ip,
                            operator: phone.trim(),
                            detail: (__isReactivate ? '权威记录重激活(admin_req漂移自愈)' : '登录密码核验通过自动加机') +
                                ' machineId=' + __midStr.slice(0, 8) + '..., devices=' + __newDevices.length + '/' + __maxDev
                        }).catch(() => {});
                        console.log('[AutoBind] 设备激活完成:', phone, __code, __newDevices.length + '/' + __maxDev,
                            __isReactivate ? '(reactivate)' : '(auto-bind)');
                        return json({
                            success: true,
                            status: 'activated',
                            requestId: existingActivated.requestId,
                            autoBound: !__isReactivate,
                            message: __isReactivate
                                ? '已检测到本机授权，正在完成安装...'
                                : '登录密码核验通过，本机已自动绑定（第 ' + __newDevices.length + '/' + __maxDev + ' 台），正在完成安装...',
                            license: encodeLicenseBase64(__licenseData),
                            devicesCount: __newDevices.length,
                            maxDevices: __maxDev,
                            licenseInfo: {
                                user: existingActivated.adminName || '',
                                clinicName: existingActivated.clinicName || '',
                                phone: existingActivated.phone || '',
                                licenseCode: __code,
                                resolvedAt: existingActivated.resolvedAt || null
                            }
                        });
                    }

                    // 单机码 / 无权威 license 记录：维持 2026-09-03 P0 安全决策
                    // （换机正当路径：客服微信 hktzy1688 核验后后台换机解绑/免费白名单）
                    console.log('[AdminSubmit] 手机号命中已激活记录但设备不匹配，拒绝（换机走客服/后台）:',
                        phone, existingActivated.requestId);
                    return json({
                        success: false,
                        code: 'ALREADY_ACTIVATED_OTHER_DEVICE',
                        error: '该手机号已在其他设备完成激活。换机或需要在多台设备使用，请联系客服微信 hktzy1688 办理。'
                    }, 409);
                }
                // ★ 2026-09-07 注册密码生效：本机是 owner 设备（上面已严格校验 devices
                //   绑定）且 phone 恒匹配（existingActivated 按 phone 查出）——新提交带了
                //   密码则先写回记录再 normalize，用户"同机重提交改密码"即时生效。
                // ★ 2026-10-07 双审 P0 纵深防御：账号写操作（密码回写/provision/normalize）
                //   严格收窄到【首机 record.machineId】。admin_req.devices 理论上只可能
                //   含首机（多机加机只写 license 不写 admin_req），此处再判一次杜绝任何
                //   存量/脏数据让附属机进入匿名改密 sink（2026-09-03 P0 同路径）。
                const __isPrimaryOwner = !!finalMachineId &&
                    String(finalMachineId) === String(existingActivated.machineId || '');
                if (__isPrimaryOwner && passwordCred) {
                    try {
                        await updateAdminRequestStatus(kv, existingActivated.requestId, {
                            passwordHash: passwordCred.passwordHash, passwordSalt: passwordCred.salt });
                        existingActivated.passwordHash = passwordCred.passwordHash;
                        existingActivated.passwordSalt = passwordCred.salt;
                    } catch (e) { console.warn('[AdminSubmit] 已激活申请密码更新失败（忽略）:', e.message); }
                }
                // 若账号已被后台删除或从未建号，先补开（幂等），保证"删除后重注册"也能直接重建
                if (__isPrimaryOwner) try {
                    await provisionCloudAccount(kv, existingActivated);
                } catch (e) {
                    console.warn('[AdminSubmit] 已激活申请账号补开失败:', e.message);
                }
                if (__isPrimaryOwner) try {
                    await normalizeActivationPassword(kv, existingActivated);
                } catch (e) {
                    console.warn('[AdminSubmit] 已激活申请密码归一化失败:', e.message);
                }
                console.log('[AdminSubmit] 手机号已有已激活申请，短路复用:', phone, existingActivated.requestId,
                    __isPrimaryOwner ? '(primary-owner)' : '(devices-member:no-account-ops)');
                // ★ 2026-09-11 P2 可疑设备拦截：被封锁设备不下发 license（对齐 admin-status
                //   轮询出口/validate 激活出口，封锁锚定 machineId 换码无用）
                // ★ 2026-10-07 锚定提交机本身（而非仅首机），堵附属机借 owner 短路绕过封锁
                const __blkPhone = await getDeviceBlock(kv, String(finalMachineId || existingActivated.machineId || ''));
                if (__blkPhone) {
                    console.warn('[AdminSubmit] 已封锁设备提交，拒绝下发 license:',
                        existingActivated.machineId, 'reason=', __blkPhone.reason);
                    return json({ success: false, error: '设备安全校验未通过，请更换设备或联系客服处理' }, 403);
                }
                // ★ 2026-09-11 阶段1a 重签自愈：短路下发出口同样过 ensureLicenseV7
                //   （对齐 admin-status 轮询出口，防出口绕过），存量 license 升级 V7。
                existingActivated = await ensureLicenseV7(kv, existingActivated, context);
                // ★ 2026-09-03 根治激活登录失败：客户端"重新提交激活"时服务端直接下发
                //   license + licenseInfo(含phone)，客户端 onSubmitSuccess 立即
                //   走 onAdminActivated 完成领码建号，不再依赖 startPolling 首 5 秒。
                //   根因（现场实锤 Mate 70 / 15109308569，APP 212）：admin-submit 返回
                //   success+status=activated，但 startPolling 用 setInterval(...,5000)，
                //   首次 poll 至少 5s 后才触发；用户 5s 内切后台/关窗口 →
                //   onAdminActivated 从未跑 → 本地从未建号 → 登录必然失败。
                const li = {
                    user: existingActivated.adminName || '',
                    clinicName: existingActivated.clinicName || '',
                    phone: existingActivated.phone || '',
                    licenseCode: existingActivated.licenseCode || '',
                    resolvedAt: existingActivated.resolvedAt || null
                };
                return json({
                    success: true,
                    status: 'activated',
                    requestId: existingActivated.requestId,
                    message: '已检测到该手机号激活授权，正在完成安装...',
                    license: existingActivated.licenseBase64 || null,
                    licenseInfo: li
                });
            }
        }

        // ★ 2026-09-15 同设备已激活短路（换号场景，与 order-submit 同款修复）：
        //   已激活机器码换新手机号重新提交激活时，上方按手机号的短路查不到（新号无
        //   记录）→ 建新申请走支付前置 → PAYMENT_REQUIRED 付款面板；但轮询
        //   admin-status machineId 兜底随后命中本机旧授权 → "付款页→已激活"跳变
        //   困惑，且已建申请存在重复付款风险（实测：已激活手机重新注册→提交→
        //   付款页→提示已激活）。此处按 machineId 扫描最近记录（口径对齐
        //   admin-status machineId 兜底）：本机存在已激活记录 → 直接返回
        //   activated 短路，客户端进等待轮询后由 admin-status 完成装码。
        //   ★ 安全边界（与手机号短路的关键差异）：机器码扫描命中的是【旧手机号】
        //   的记录（phone ≠ 本次提交），机器码是客户端自报参数（不可信）——
        //   绝不做 provisionCloudAccount / normalizeActivationPassword 等账号
        //   操作（会重置旧号密码 = 匿名接管，违反 2026-09-03 P0 安全决策）；
        //   仅返回 activated + license（license 绑定 machineId，他机验签必
        //   失败，与 admin-status machineId 兜底同边界）。
        {
            const idxList = (await kv.get(KV_ADMIN_REQ_INDEX, 'json').catch(() => null)) || [];
            let machineActivated = null;
            for (const rid of idxList.slice(0, 200)) {
                const rec = await kv.get(KV_ADMIN_REQ_PREFIX + rid, 'json').catch(() => null);
                if (rec && String(rec.machineId || '') === finalMachineId &&
                    rec.status === 'activated') {
                    machineActivated = rec;
                    break;
                }
            }
            if (machineActivated) {
                // ★ 2026-09-11 同款可疑设备拦截：封锁设备不下发 license
                const __blk = await getDeviceBlock(kv, String(machineActivated.machineId || ''));
                if (__blk) {
                    console.warn('[AdminSubmit] 已封锁设备换号提交，拒绝下发 license:',
                        machineActivated.machineId, 'reason=', __blk.reason);
                    return json({ success: false, error: '设备安全校验未通过，请更换设备或联系客服处理' }, 403);
                }
                // ★ 阶段1a 重签自愈：短路下发出口过 ensureLicenseV7（防出口绕过）
                machineActivated = await ensureLicenseV7(kv, machineActivated, context);
                console.log('[AdminSubmit] 同设备已激活（换新手机号场景），短路复用不建新申请:',
                    'machineId=', String(finalMachineId).slice(0, 12) + '...',
                    'recordPhone=', machineActivated.phone, 'requestId=', machineActivated.requestId);
                return json({
                    success: true,
                    status: 'activated',
                    requestId: machineActivated.requestId,
                    message: '已检测到本机已有激活授权，正在完成安装...',
                    license: machineActivated.licenseBase64 || null,
                    licenseInfo: {
                        user: machineActivated.adminName || '',
                        clinicName: machineActivated.clinicName || '',
                        phone: machineActivated.phone || '',
                        licenseCode: machineActivated.licenseCode || '',
                        resolvedAt: machineActivated.resolvedAt || null
                    }
                });
            }
        }

        // ★ 2026-09-02 支付前置校验（激活流程完善：没有完成支付环节无法提交）：
        //   官网订单付款确认（order-paid）后记录带 paidAt 并进入待审队列。提交时统一判定：
        //   ① 已有"已付款待核对"申请 → 复用该申请，客户端直接进入等待轮询；
        //   ② 已有"未付款"的进行中申请 → 不再报"审核中"（误导），统一引导先完成支付；
        //   ③ 无进行中申请 → 按手机号/设备维度查已付款订单，查不到则拒绝提交，
        //      返回 code=PAYMENT_REQUIRED，客户端提示"请完成支付"并引导官网付款。
        //   env=test（测试环境/E2E 回归）放行不拦截。
        const isTestEnv = String(env || '').trim() === 'test';
        // ★ 2026-09-02 免费开通白名单：平台管理员在后台把手机号加入 free_pass 白名单后，
        //   该客户提交激活申请跳过支付前置校验（申请带 freePass 标记，仍需人工审核通过）。
        const freePass = await kv.get('free_pass:' + phone, 'json').catch(() => null);
        {
            const occ = await findPhoneOccupancy(kv, phone);
            if (occ && occ.kind === 'pending_activation') {
                if (occ.detail.paidAt) {
                    console.log('[AdminSubmit] 已付款申请待核对，复用进入等待:', phone, occ.detail.requestId);
                    // ★ 2026-09-05 复用补写邀请码：原记录无 inviteCode 而新提交带了 → 补写
                    //   （走 updateAdminRequestStatus 统一写服务，参照 appModeCarrier 补写先例；
                    //   失败仅 warn 不阻断复用——漏写损失一次奖励，不能误伤激活主流程）
                    if (inviteCodeClean && !occ.detail.inviteCode) {
                        try {
                            await updateAdminRequestStatus(kv, occ.detail.requestId, { inviteCode: inviteCodeClean });
                            console.log('[AdminSubmit] 复用申请补写邀请码:', occ.detail.requestId);
                        } catch (e) { console.warn('[AdminSubmit] 邀请码补写失败（忽略）:', e.message); }
                    }
                    // ★ 2026-09-07 注册密码生效：原记录（官网下单等）无密码哈希而新提交带了 → 补写
                    if (passwordCred && occ.detail.phone === phone) {
                        try {
                            await updateAdminRequestStatus(kv, occ.detail.requestId, {
                                passwordHash: passwordCred.passwordHash, passwordSalt: passwordCred.salt });
                            console.log('[AdminSubmit] 复用申请补写注册密码哈希:', occ.detail.requestId);
                        } catch (e) { console.warn('[AdminSubmit] 密码补写失败（忽略）:', e.message); }
                    }
                    return json({
                        success: true,
                        status: 'pending',
                        requestId: occ.detail.requestId,
                        message: '已检测到您的付款，管理员核对到账后即可激活'
                    });
                }
                if (freePass && occ.detail.machineId === finalMachineId) {
                    // 白名单客户已有未付款申请（同一台机器）→ 直接复用进入等待（免费开通通道）
                    // ★ 2026-09-02 复核加固：machineId 不一致（换机场景）不复用——旧申请
                    //   绑定旧机器，复用会导致审核后 license 绑错机器新设备无法激活；
                    //   换机时放行到下方创建新申请（新 machineId），管理员审核新记录即可。
                    // ★ 2026-09-05 P3-2 修复：白名单复用分支补写邀请码——对齐另两处复用
                    //   分支（已付款待核对/已付款订单）的补写逻辑；此前不对称遗漏，白名单
                    //   客户 pending 期间二次提交填写的邀请码被静默丢弃，结算时拿不到。
                    if (inviteCodeClean && !occ.detail.inviteCode) {
                        try {
                            await updateAdminRequestStatus(kv, occ.detail.requestId, { inviteCode: inviteCodeClean });
                            console.log('[AdminSubmit] 白名单复用申请补写邀请码:', occ.detail.requestId);
                        } catch (e) { console.warn('[AdminSubmit] 邀请码补写失败（忽略）:', e.message); }
                    }
                    // ★ 2026-09-07 注册密码生效：白名单复用分支补写密码（对齐另两处复用分支）
                    if (passwordCred && occ.detail.phone === phone) {
                        try {
                            await updateAdminRequestStatus(kv, occ.detail.requestId, {
                                passwordHash: passwordCred.passwordHash, passwordSalt: passwordCred.salt });
                            console.log('[AdminSubmit] 白名单复用申请补写注册密码哈希:', occ.detail.requestId);
                        } catch (e) { console.warn('[AdminSubmit] 密码补写失败（忽略）:', e.message); }
                    }
                    console.log('[AdminSubmit] 白名单客户复用未付款申请进入等待:', phone, occ.detail.requestId);
                    return json({
                        success: true,
                        status: 'pending',
                        requestId: occ.detail.requestId,
                        message: '激活请求已提交，请耐心等待管理员审核'
                    });
                }
                if (!isTestEnv && !freePass) {
                    // ★ 2026-09-06 P0 修复（邀请码丢失）：未付款 pending 申请重新提交（付款页
                    //   返回上一步补填邀请码场景）原直接 409 拦截——本次填写的邀请码被静默
                    //   丢弃（另三处复用分支均补写，此处不对称遗漏）。先补写再拦截，对齐
                    //   白名单/已付款分支；失败仅 warn 不阻断。
                    if (inviteCodeClean && !occ.detail.inviteCode) {
                        try {
                            await updateAdminRequestStatus(kv, occ.detail.requestId, { inviteCode: inviteCodeClean });
                            console.log('[AdminSubmit] 未付款pending申请补写邀请码:', occ.detail.requestId);
                        } catch (e) { console.warn('[AdminSubmit] 邀请码补写失败（忽略）:', e.message); }
                    }
                    // ★ 2026-09-07 注册密码生效：未付款 pending 拦截前补写密码（付款页返回重提场景）
                    if (passwordCred && occ.detail.phone === phone) {
                        try {
                            await updateAdminRequestStatus(kv, occ.detail.requestId, {
                                passwordHash: passwordCred.passwordHash, passwordSalt: passwordCred.salt });
                            console.log('[AdminSubmit] 未付款pending申请补写注册密码哈希:', occ.detail.requestId);
                        } catch (e) { console.warn('[AdminSubmit] 密码补写失败（忽略）:', e.message); }
                    }
                    console.log('[AdminSubmit] 存在未付款申请，拦截并引导完成支付:', phone, occ.detail.requestId);
                    return json({
                        success: false,
                        code: 'PAYMENT_REQUIRED',
                        error: '请完成支付：激活前请先在官网完成付款（支付宝/微信），付款后管理员核对即可自动激活'
                    }, 409);
                }
            }
        }
        // ★ 2026-09-02 复核修复：白名单客户（freePass）跳过支付前置检查直接创建申请；
        //   上一版此处漏写 && !freePass（并行编辑被覆盖），会导致白名单首次提交被误拦。
        if (!isTestEnv && !freePass) {
            let paid = await findPaidOrderForPhoneOrMachine(kv, phone, finalMachineId);
            if (paid && paid.status === 'pending') {
                console.log('[AdminSubmit] 命中已付款订单（待核对），复用进入等待:', phone, paid.requestId);
                // ★ 2026-09-03 复用补写载体：官网下单创建的 record 无 appModeCarrier（浏览器
                //   下单未知载体），客户端（桌面/APP）提交命中复用时补上，后台用户管理
                //   离线版才能显示"🖥️桌面·/📱APP·"。仅白名单值 desktop/app，防脏数据。
                if ((appModeCarrier === 'desktop' || appModeCarrier === 'app')) {
                    try {
                        // ★ 2026-09-03 P2: 复用订单补写载体走 updateAdminRequestStatus 统一索引
                        await updateAdminRequestStatus(kv, paid.requestId, { appModeCarrier });
                        console.log('[AdminSubmit] 复用订单补写载体(通过Service):', paid.requestId, appModeCarrier);
                    } catch (e) { console.warn('[AdminSubmit] 载体补写失败（忽略）:', e.message); }
                }
                // ★ 2026-09-05 复用补写邀请码（同上 paidAt 分支逻辑）：原记录无而新提交带了 → 补写
                if (inviteCodeClean && !paid.inviteCode) {
                    try {
                        await updateAdminRequestStatus(kv, paid.requestId, { inviteCode: inviteCodeClean });
                        console.log('[AdminSubmit] 复用订单补写邀请码:', paid.requestId);
                    } catch (e) { console.warn('[AdminSubmit] 邀请码补写失败（忽略）:', e.message); }
                }
                // ★ 2026-09-07 注册密码生效：复用订单补写密码。phone 必须严格匹配——该分支
                //   可能仅凭 machineId 命中"他人手机号"订单（machineId 不可信），此时补写
                //   提交者的密码会导致审核后他人账户密码被改（接管），必须排除。
                if (passwordCred && paid.phone === phone) {
                    try {
                        await updateAdminRequestStatus(kv, paid.requestId, {
                            passwordHash: passwordCred.passwordHash, passwordSalt: passwordCred.salt });
                        console.log('[AdminSubmit] 复用订单补写注册密码哈希:', paid.requestId);
                    } catch (e) { console.warn('[AdminSubmit] 密码补写失败（忽略）:', e.message); }
                }
                return json({
                    success: true,
                    status: 'pending',
                    requestId: paid.requestId,
                    message: '已检测到您的付款，管理员核对到账后即可激活'
                });
            }
            if (paid && paid.status === 'activated') {
                // ★ 仅凭 machineId 命中"他人手机号"订单时，不做账号补开/密码归一化
                //   （machineId 不可信，防接管，对齐 admin-status 2026-08-31 修复），
                //   但下发 license+licenseInfo（含手机号/激活码），客户端 submit 成功分支
                //   检测到 status=activated 且有 license 立即执行 onAdminActivated，
                //   不再依赖 startPolling 首 5s 不被用户打断。
                console.log('[AdminSubmit] 命中已付款且已激活订单，复用+下发license:', paid.requestId);
                // ★ 2026-09-11 P2 可疑设备拦截：被封锁设备不下发 license（同手机号短路点，
                //   四个下发出口全堵——verify/validate/admin-status/admin-submit）
                const __blkDev = await getDeviceBlock(kv, String(paid.machineId || ''));
                if (__blkDev) {
                    console.warn('[AdminSubmit] 已封锁设备命中订单，拒绝下发 license:',
                        paid.machineId, 'reason=', __blkDev.reason);
                    return json({ success: false, error: '设备安全校验未通过，请更换设备或联系客服处理' }, 403);
                }
                // ★ 2026-09-11 阶段1a 重签自愈：设备维度短路下发出口同样过 ensureLicenseV7
                paid = await ensureLicenseV7(kv, paid, context);
                const li2 = {
                    user: paid.adminName || '',
                    clinicName: paid.clinicName || '',
                    phone: paid.phone || '',
                    licenseCode: paid.licenseCode || '',
                    resolvedAt: paid.resolvedAt || null
                };
                return json({
                    success: true,
                    status: 'activated',
                    requestId: paid.requestId,
                    message: '已检测到该设备激活授权，正在完成安装...',
                    license: paid.licenseBase64 || null,
                    licenseInfo: li2
                });
            }
            console.log('[AdminSubmit] 未检测到付款记录，拦截提交（请完成支付）:', phone);
            return json({
                success: false,
                code: 'PAYMENT_REQUIRED',
                error: '请完成支付：激活前请先在官网完成付款（支付宝/微信），付款后管理员核对即可自动激活'
            }, 409);
        }

        // 生成请求 ID 并存储
        const requestId = generateRequestId();
        const recordPayload = {
            requestId: requestId,
            clinicName: clinicName.trim(),
            adminName: adminName.trim(),
            phone: phone.trim(),
            remark: (remark || '').trim(),
            machineId: finalMachineId,
            // pending / activated / rejected / cancelled
            // createAdminRequest 默认 status=pending，可传 status 覆盖
            submittedAt: new Date().toISOString(),
            submittedIp: ip,
            resolvedAt: null,
            resolvedBy: null,
            licenseCode: null,      // 审核通过时关联的激活码
            licenseBase64: null,    // 审核通过时下发的 license（base64）
            rejectReason: null,
            // ★ 版本信息：区分离线/云端、机构版/标准版
            productName: (productName || '').trim(),
            edition: (edition || '').trim(),
            appMode: (appMode || '').trim(),
            // ★ 2026-09-03 载体标识（desktop=离线桌面 / app=离线APP）：客户端提交时
            //   electronAPI 探测；审核通过后 provisionCloudAccount 写入诊所记录，
            //   后台用户管理离线版显示"🖥️桌面·/📱APP·"载体
            appModeCarrier: (appModeCarrier === 'desktop' || appModeCarrier === 'app') ? appModeCarrier : '',
            // ★ 2026-09-05 邀请码（选填）：管理员审核通过时结算（admin-approve applyInviteReward）
            inviteCode: inviteCodeClean || '',
            // ★ 2026-09-07 注册密码生效：审核通过后开账户用注册密码（而非默认 admin）
            passwordHash: passwordCred ? passwordCred.passwordHash : '',
            passwordSalt: passwordCred ? passwordCred.salt : '',
            versionLabel: (versionLabel || '').trim(),
            // ★ 环境标记：test=测试环境，production=正式环境
            env: (env || 'production').trim(),
            // ★ 2026-09-02 免费开通白名单标记：该申请经白名单通道免支付提交，后台列表显示 🎫免费
            freePass: !!freePass
        };

        // ★ 2026-09-03 (架构统一 P2) 统一走 createAdminRequest：
        //   一次性写 admin_req:{rid} + admin_phone:{phone}=pending +
        //   admin_req_index unshift（三处 KV 同步），
        //   原 L418-L423 三处 KV.put 内联副本 3→1，彻底消除各端漂移。
        const created = await createAdminRequest(kv, recordPayload);

        console.log('[AdminSubmit] 新激活请求(通过Service三索引同步):', created.requestId,
            'clinic=', clinicName, 'machineId=', finalMachineId.substring(0, 8) + '...',
            NEED_FALLBACK ? '(browser fallback)' : '');

        return json({
            success: true,
            requestId: created.requestId,
            message: '激活请求已提交，请耐心等待管理员审核'
        });

    } catch (error) {
        console.error('Admin submit error:', error);
        return json({ success: false, error: '服务器内部错误，请稍后再试' }, 500);
    }
}
