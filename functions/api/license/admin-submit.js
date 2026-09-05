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

import { getKV, checkRateLimit, checkDeviceVersion } from './_lib/license-core.js';
import { provisionCloudAccount, normalizeActivationPassword } from './_lib/admin-account.js';
import { createAdminRequest, updateAdminRequestStatus } from './_lib/license-write-service.js';
import { findPhoneOccupancy, KV_SYSTEM_CLINICS } from '../_lib/auth.js';

// ★ 2026-08-20 查找某手机号下最近一条"已通过"的激活申请
//   - 优先手机号索引（O(1)）；索引指向 pending/rejected 时再兜底扫描请求索引
//   - 只返回 status === 'activated' 的记录
async function findActivatedRequestForPhone(kv, phone) {
    try {
        if (!/^1[3-9]\d{9}$/.test(phone)) return null;
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
                productName, edition, appMode, versionLabel, env, appModeCarrier, inviteCode } = body;

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
        if (!phone || !/^1[3-9]\d{9}$/.test(phone)) {
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
            const clinics = (await kv.get(KV_SYSTEM_CLINICS, 'json')) || [];
            const sameNameClinic = Array.isArray(clinics) && clinics.find(c => c && c.name === clinicName);
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
            console.warn('[AdminSubmit] 停用诊所同名检查失败(放行申请):', de && de.message);
        }

        // ★ 2026-08-20 已激活申请短路：该手机号此前已有"管理员审核通过"的激活申请（且可能
        //   因旧账号密码不一致导致登录 401）。此时不重复排队新申请，直接复用该已激活申请：
        //   做一次密码归一化（重置为默认 admin），返回该 requestId，让客户端轮询 admin-status
        //   拿到 activated 后提示"激活成功"，从而使用 133xxxx/admin 即可登录。
        //   ★ 2026-09-03 P0 安全修订：原注释"持有自己手机号即不构成接管"论证错误——手机号是
        //   公开信息且本接口匿名无验证码，必须校验提交者 machineId 属于该激活记录绑定设备
        //   （见下方 _isOwnerDevice），设备不匹配一律拒绝账号操作。
        {
            const existingActivated = await findActivatedRequestForPhone(kv, phone);
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
                    // ★ 2026-09-05 复核回滚：此处曾尝试"手机号核验通过即自动解绑换机"，
                    //   独立审查发现两条 P0 缺陷，已回滚为一律 409 拒绝：
                    //   ① 安全：existingActivated 就是用提交的 phone 查到的，
                    //      `record.phone === phone` 恒真，_phoneVerified 形同虚设——
                    //      攻击者知道受害者手机号（半公开）即可匿名解绑受害者设备，
                    //      且 fall-through 后 normalizeActivationPassword 会重置账号密码
                    //      = 完整云端接管（违反本文件 L249-267 的 09-03 P0 安全决策）。
                    //      validate.js 换机安全的前提是凭证为激活码（付费秘密），
                    //      admin-submit 凭证仅手机号（自报、非秘密），不可照搬。
                    //   ② 功能：buildLicenseData 签名为 (record, options) 2 参，
                    //      误传 (kv, code, opts, ctx) 必抛错；而 updateLicense 先执行已把
                    //      旧设备踢出 devices → 旧机掉激活、新机拿不到 license = 双输。
                    //   换机正当路径（既有，安全）：客服微信 hktzy1688 核验后后台
                    //   admin-approve 换机解绑 / 免费白名单；机构版多机走 Tab2 输同一激活码。
                    console.log('[AdminSubmit] 手机号命中已激活记录但设备不匹配，拒绝（换机走客服/后台）:',
                        phone, existingActivated.requestId);
                    return json({
                        success: false,
                        code: 'ALREADY_ACTIVATED_OTHER_DEVICE',
                        error: '该手机号已在其他设备完成激活。换机或需要在多台设备使用，请联系客服微信 hktzy1688 办理。'
                    }, 409);
                }
                // 若账号已被后台删除或从未建号，先补开（幂等），保证"删除后重注册"也能直接重建
                try {
                    await provisionCloudAccount(kv, existingActivated);
                } catch (e) {
                    console.warn('[AdminSubmit] 已激活申请账号补开失败:', e.message);
                }
                try {
                    await normalizeActivationPassword(kv, existingActivated);
                } catch (e) {
                    console.warn('[AdminSubmit] 已激活申请密码归一化失败:', e.message);
                }
                console.log('[AdminSubmit] 手机号已有已激活申请，短路复用:', phone, existingActivated.requestId);
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
                    console.log('[AdminSubmit] 白名单客户复用未付款申请进入等待:', phone, occ.detail.requestId);
                    return json({
                        success: true,
                        status: 'pending',
                        requestId: occ.detail.requestId,
                        message: '激活请求已提交，请耐心等待管理员审核'
                    });
                }
                if (!isTestEnv && !freePass) {
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
            const paid = await findPaidOrderForPhoneOrMachine(kv, phone, finalMachineId);
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
