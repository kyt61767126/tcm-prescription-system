// ============================================================================
//  admin-account.js — 管理员激活通过后的云端账号自动开通（共享逻辑）
//
//  用途：管理员审核通过"管理员激活"请求后，为云端创建诊所 + clinic_admin 账号。
//  被 admin-approve.js（审核通过时立即开通）与 admin-status.js（轮询激活状态时
//  幂等补开，覆盖修复上线前已通过但未开账号的历史激活请求）共同调用。
//
//  规则：
//    - 仅当手机号非空且该账号尚未存在时创建；已存在则跳过（兼容多端共享手机号）
//    - 诊所按 clinicName 复用：已存在同名诊所不重复创建，仅补充账号到该诊所
//    - 密码留空默认 admin（与离线端默认密码一致；激活框密码留空时的默认值）
// ============================================================================

import {
    hashPassword,
    ROLE_CLINIC_ADMIN,
    ROLE_DOCTOR,
    KV_SYSTEM_CLINICS,
    getClinicsOrThrow,
    findPhoneOccupancy
} from '../../_lib/auth.js';
// ★ 2026-09-23 账号被真实重新开通时清除删除墓碑（同手机号重新激活恢复登录）
import { clearAccountTombstone } from './license-core.js';
// ★ 2026-10-08 淘宝云端码 claim 自动开通：审计三索引唯一写入口（无循环依赖：
//   license-write-service 只依赖 license-core/schema-guard，不 import 本文件）
import { createAdminRequest, KV_ADMIN_REQ_PREFIX } from './license-write-service.js';

// ★ 2026-09-03 产品模式感知：激活 type（personal/pro）→ 规范 edition key
//   必须结合产品模式（离线/云端），否则离线标准版审核通过后诊所 edition 被错写为
//   cloud_personal（用户管理显示"网页云端标准版"，实际客户买的是 99 元本地标准版）。
//
// 产品模式判定（优先级从高到低）：
//   1. record.appMode === 'local'        → 离线（官网下单 order-submit 写入）
//   2. record.appMode === 'cloud'        → 云端（官网下单 + 云端客户端提交）
//   3. record.appMode === 'offline'      → 离线（历史/兼容值）
//   4. versionLabel 含 本地/离线          → 离线；含 云端 → 云端
//   5. 兜底 cloud（保持旧行为，未知模式不改变现状）
//
// 旧客户端提交 appMode='app'（载体信息非产品模式）→ 走 4/5 兜底；
// 新版客户端（2026-09-03 起）离线端发 'local'、云端端发 'cloud'。
function resolveProductMode(record) {
    const am = String(record && record.appMode || '').toLowerCase();
    if (am === 'local' || am === 'offline') return 'local';
    if (am === 'cloud') return 'cloud';
    const vl = String(record && record.versionLabel || '');
    if (/本地|离线/.test(vl)) return 'local';
    if (/云端/.test(vl)) return 'cloud';
    return 'cloud';
}

function mapActivationTypeToEdition(type, record) {
    const t = String(type || '').toLowerCase();
    // ★ 2026-09-17 语音版：voice 仅云端（一期），直接返回规范 key cloud_voice。
    //   原实现无此分支，voice 会静默错归 cloud_personal（标准版权益，无语音入口）。
    if (t === 'voice' || t === 'cloud_voice') return 'cloud_voice';
    const isPro = (t === 'pro' || t === 'institution' || t === 'clinic');
    const mode = resolveProductMode(record);
    if (mode === 'local') return isPro ? 'offline_clinic' : 'offline_personal';
    return isPro ? 'cloud_clinic' : 'cloud_personal';
}

// 在指定诊所下补充（或不动）账号
// ★ 2026-08-23 唯一管理员加固（KNOWLEDGE 2.51）：该诊所已有 clinic_admin 时，
//   再次激活审核通过的新手机号开通为 doctor（普通用户），不再追加 clinic_admin。
//   背景：旧逻辑每次激活通过都无条件补 clinic_admin → 两次激活=两个管理员
//   （王桂杰+王桂双管理员事故根因）。如需更换管理员手机号，由平台管理员
//   在后台 update-user 调整角色（clinic_admin ↔ doctor 互转）。
// ★ 2026-09-07 注册密码生效：cred = record 的 { passwordHash, passwordSalt }
//   （admin-submit 哈希落库）——有则开账户用注册密码；无（官网下单/工单/旧记录）
//   则默认 admin（旧行为）。
async function ensureClinicUser(kv, clinicId, clinicName, phone, adminName, now, cred) {
    const users = (await kv.get(`clinic:${clinicId}:users`, 'json')) || [];
    const exists = users.some(u => u.username === phone || u.phone === phone);
    if (exists) return;

    const hasAdmin = users.some(u => u.role === ROLE_CLINIC_ADMIN);
    const role = hasAdmin ? ROLE_DOCTOR : ROLE_CLINIC_ADMIN;

    // 密码：注册密码（哈希落库）优先；留空默认 admin（与离线端默认密码一致）
    let passwordHash, salt;
    if (cred && cred.passwordHash && cred.passwordSalt) {
        passwordHash = cred.passwordHash;
        salt = cred.passwordSalt;
    } else {
        ({ passwordHash, salt } = await hashPassword('admin'));
    }
    users.push({
        username: phone,
        phone: phone,
        name: (adminName || phone).trim(),
        role: role,
        passwordHash,
        salt,
        allowedMode: 'both',
        cloudEnabled: true,
        allowSavePrescription: true,
        createdAt: now,
        updatedAt: now
    });
    await kv.put(`clinic:${clinicId}:users`, JSON.stringify(users));
    // 账号被真实重新开通：清除删除墓碑（同手机号重新激活即恢复，无需客服介入）
    try { await clearAccountTombstone(kv, phone); } catch (e) { console.warn('[AdminAccount] 清墓碑失败:', e && e.message); }
    console.log('[AdminAccount] 云端账号已开通:', phone, 'clinic=', clinicName, 'role=', role,
        hasAdmin ? '(诊所已有管理员，本次开通为普通用户)' : '(首个管理员)',
        (cred && cred.passwordHash) ? '(注册密码)' : '(默认密码 admin)');
}

// 审核通过记录 → 幂等开通云端诊所 + clinic_admin 账号
export async function provisionCloudAccount(kv, record) {
    const phone = (record.phone || '').trim();
    const clinicName = (record.clinicName || '').trim();
    if (!phone || !clinicName) return false;

    const now = new Date().toISOString();
    // ★ 2026-08-22 统一 edition：根据激活类型生成规范 edition key
    //   优先级：record.type（管理员审核最终确认的 pro/personal）
    //         > record.edition（前端提交时用户自选的 institution/personal，兼容老记录）
    //   两者都没有时，mapActivationTypeToEdition 内部兜底为 cloud_personal（标准版）
    const rawActivation = record.type || record.edition;
    const targetEdition = mapActivationTypeToEdition(rawActivation, record);
    // ★ 2026-09-03 离线版载体（desktop=离线桌面 / app=离线APP）：写入诊所记录，
    //   后台用户管理离线版显示"🖥️桌面·离线标准版 / 📱APP·离线标准版"。
    //   来源：record.appModeCarrier（新客户端提交 / 官网订单 dp 参数 / 复用补写）；
    //   兜底：旧客户端 record.appMode='app' 即载体值（非产品模式）。
    //   云端版不写（载体由 user_devices 登录绑定实时反映，比激活时点更准）。
    const rawCarrier = String(record.appModeCarrier || '').toLowerCase();
    const targetCarrier = (rawCarrier === 'desktop' || rawCarrier === 'app')
        ? rawCarrier
        : (String(record.appMode || '').toLowerCase() === 'app' ? 'app' : '');
    // ★ 2026-09-24 安全收尾批：统一权威入口。旧写法非数组时 `.find` 抛错或被上游吞掉，
    //   更危险的是落到"新建分支 clinics.push"会把整张诊所清单覆盖成仅含新诊所的数组
    //   （=全量诊所数据事故）。非数组/读取异常直接抛错，由调用方 try/catch 决定，
    //   三条审批链的停用闸会先于此函数拦截，自愈类调用方（validate/admin-status/登录）
    //   本来就包 try/catch，抛错=本次不开通，下次轮询重试，不污染数据。
    const clinics = await getClinicsOrThrow(kv);
    let clinic = clinics.find(c => c.name === clinicName);
    let clinicsDirty = false;

    // ★ 2026-10-08 淘宝无人通道属主护栏（双审修复）：自动开通携带
    //   __autoRequestId 时，同名诊所若属于【另一次】自动开通请求，说明预检→落库
    //   之间名字被并发抢注（不同买家手机尾号相同/同名自报并发）。绝不能走下方
    //   "同名补号、已有 admin 则降 doctor" 语义（=买家以 doctor 身份进别人诊所
    //   看他人处方）；抛命名冲突由 commit 重新唯名后重试。同 requestId 命中=
    //   本请求的幂等重试/半成态补开，照常放行；人工通道（无 __autoRequestId）
    //   语义完全不变。
    const __autoReqId = record.__autoRequestId ? String(record.__autoRequestId) : '';
    if (clinic && __autoReqId && String(clinic.autoRequestId || '') !== __autoReqId) {
        // 注意：clinic.autoRequestId 缺省（人工通道创建的同名诊所）同样按冲突处理——
        //   自动通道是 create-only 语义，只认"本请求自己建的诊所"。
        const __e = new Error('AUTO_NAME_COLLISION: ' + clinicName);
        __e.code = 'AUTO_NAME_COLLISION';
        throw __e;
    }

    // 1) 存在同名诊所 → 补齐 / 更新 edition + status，再补充账号
    //   规则：
    //     - ★ 2026-09-04 P0 修复：已有同名 clinic 漏 status 升级 → 自助注册
    //       （status=test）经管理员激活审核通过后仍停留在 test → 登录闸门 L1319
    //       判定 test 返回 403 PENDING_APPROVAL → 客户已激活却永远登不上。
    //       admin-approve 审核通过语义上就是"把诊所激活"，所以无论原状态是 test
    //       还是 disabled，一律强制升级为 active（以管理员决策为准）。
    //     - 早期遗留（clinic.edition 空）→ 补为 targetEdition
    //     - 已有 edition 但与本次 targetEdition 不一致 → **强制更新为本次 targetEdition**
    //       （以最近一次管理员审核的激活类型为准；例如第一次审错了标准版，第二次改回机构
    //        版，必须覆盖，否则诊所 edition 永远卡死为标准版）
    if (clinic) {
        // ★ P0 强制状态升级（test/disabled → active）
        if (clinic.status !== 'active') {
            const oldStatus = clinic.status || '(empty)';
            clinic.status = 'active';
            clinic.updatedAt = now;
            clinicsDirty = true;
            console.log('[AdminAccount] ★ 诊所状态升级:', clinicName, oldStatus, '→ active (admin-approve)');
        }
        // ★ 2026-09-21 语音版权益叠加（P0：机构诊所升级语音后丢失用户管理/处方查阅）：
        //   语音版=加购权益，不是版本线替换。机构诊所（cloud_clinic 等）voice 升级
        //   时 edition 必须保持机构版不变，只叠加 voiceEnabled=true —— 否则
        //   provisionCloudAccount 强制覆盖 edition=cloud_voice → 机构管理员登录后
        //   【用户管理】消失只剩【修改密码】（button-manager 断言 isInst=false 不保护）。
        //   个人版诊所 voice 升级：edition cloud_personal → cloud_voice（版本线语义，
        //   cloud_voice 权益=标准版+语音，行为不变），同样补 voiceEnabled=true 统一口径。
        const __voiceTarget = (targetEdition === 'cloud_voice');
        const __clinicEd = String(clinic.edition || '').toLowerCase();
        const __clinicIsInst = ['cloud_clinic', 'clinic', 'institution', 'institutional', 'clinic_custom'].indexOf(__clinicEd) >= 0;
        if (__voiceTarget && __clinicIsInst) {
            if (clinic.voiceEnabled !== true) {
                clinic.voiceEnabled = true;
                clinic.updatedAt = now;
                clinicsDirty = true;
            }
            // activationType 记录加购动作，但 edition/版本标签口径不漂移
            if (record.type) clinic.activationType = record.type;
            clinicsDirty = true; // activationType 回写
            console.log('[AdminAccount] 机构诊所语音权益叠加（edition 保持', clinic.edition, '）:', clinicName, '+voiceEnabled=true');
        } else {
            if (__voiceTarget && clinic.voiceEnabled !== true) {
                clinic.voiceEnabled = true;
                clinic.updatedAt = now;
                clinicsDirty = true;
            }
            const needPatchEdition = !clinic.edition || (clinic.edition !== targetEdition);
            if (needPatchEdition) {
                const oldEd = clinic.edition || '(empty)';
                clinic.edition = targetEdition;
                clinic.updatedAt = now;
                // 同时同步 activationType 字段，保持与 edition 口径一致
                if (record.type) clinic.activationType = record.type;
                else if (record.edition) clinic.activationType = record.edition;
                clinicsDirty = true;
                console.log('[AdminAccount] 诊所 edition 更新:', clinicName, oldEd, '→', targetEdition,
                    '(source:', rawActivation, ')');
            }
        }
        // ★ 2026-09-03 离线版载体写入/更新（仅离线版；有值才写，不覆盖为空）
        if (targetEdition.indexOf('offline_') === 0 && targetCarrier && clinic.offlineCarrier !== targetCarrier) {
            clinic.offlineCarrier = targetCarrier;
            clinic.updatedAt = now;
            clinicsDirty = true;
            console.log('[AdminAccount] 诊所离线载体更新:', clinicName, '→', targetCarrier);
        }
        if (clinicsDirty) {
            await kv.put(KV_SYSTEM_CLINICS, JSON.stringify(clinics));
        }
        await ensureClinicUser(kv, clinic.id, clinicName, phone, record.adminName, now, record);
        return true;
    }

    // 2) 不存在 → 创建新诊所（显式带 edition 字段，统一规范）
    const clinicId = 'clinic_' + Array.from(crypto.getRandomValues(new Uint8Array(10)))
        .map(b => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('');
    // ★ 2026-09-07 云端诊所有效期与激活挂钩：新建诊所 expiresAt = 激活到期日 +
    //   邀请奖励天数（被邀请人 +30）。此前诊所不写 expiresAt，靠 users.js 登录
    //   自愈补默认 365 天（不感知激活天数/邀请奖励，管理员直填到期日也被无视）。
    //   record.expiresAt 优先（admin-approve 预写管理员直填值），否则 days+奖励计算。
    //   admin-approve 审核点已把 __inviteeBonusDays 预写进 record.inviteeBonusDays；
    //   admin-status 补开点读 KV 同名字段（activatePatch 落库），两路同源。
    const __rewardDays = Number(record.inviteeBonusDays) || 0;
    const __clinicExpiresAt = record.expiresAt
        ? new Date(record.expiresAt).toISOString()
        : new Date(Date.now() +
            ((Number(record.days) || 365) + __rewardDays) * 24 * 60 * 60 * 1000).toISOString();
    clinic = {
        id: clinicId,
        name: clinicName,
        status: 'active',
        createdAt: now,
        updatedAt: now,
        edition: targetEdition,          // ★ 新诊所统一写入 edition
        activationType: record.type || null,
        // ★ 2026-10-08 淘宝无人通道属主标记：仅自动开通写；供并发命名冲突时
        //   识别"本请求自建诊所"（幂等补开）vs"别人的诊所"（必须换名）。
        autoRequestId: __autoReqId || undefined,
        // ★ 2026-09-03 离线版载体（desktop/app，云端版不写）
        offlineCarrier: (targetEdition.indexOf('offline_') === 0 && targetCarrier) ? targetCarrier : undefined,
        expiresAt: __clinicExpiresAt,
        source: 'activation'
    };
    clinics.push(clinic);
    await kv.put(KV_SYSTEM_CLINICS, JSON.stringify(clinics));

    await ensureClinicUser(kv, clinicId, clinicName, phone, record.adminName, now, record);
    return true;
}

// ★ 2026-08-20 激活密码归一化：把"该激活申请手机号"下所有启用状态（非禁用诊所以外的
//   cloudEnabled）账号的密码统一重置为注册密码（2026-09-07 前为默认 admin）。
// 背景：老账号可能因历史版本默认密码不同、或手机号跨诊所重复而无法用注册密码登录（401）。
//   findUserForLogin 按诊所顺序返回第一个匹配账号，这里全量重置，保证登录端命中的那个
//   也必然与注册密码一致，从根上消除"登录提示 401 / 旧密码遮蔽新账号"。
// ★ 2026-09-07 注册密码生效：record 带 passwordHash/passwordSalt（admin-submit 哈希落库）
//   → 重置为注册密码；无（官网下单/工单/旧记录）→ 保持默认 admin（旧行为）。
// 安全性：只在"激活通过的受信链路"（admin-approve / admin-status / admin-submit 探测到
//   已激活申请）调用，调用方要么是持有该激活申请的客户端，要么是平台管理员。
//   绝不能在匿名登录的自愈路径调用（否则等于任何人可用手机号重置为 admin 接管账号）。
// 幂等：已是目标密码（哈希串一致）则跳过，避免无谓写 KV。
export async function normalizeActivationPassword(kv, record) {
    try {
        const phone = (record && record.phone ? String(record.phone).trim() : '');
        if (!/^1[3-9]\d{9}$/.test(phone)) return { changed: false, reason: 'not_phone' };
        // 注册密码哈希优先；无则默认 admin
        let passwordHash, salt;
        if (record && record.passwordHash && record.passwordSalt) {
            passwordHash = record.passwordHash;
            salt = record.passwordSalt;
        } else {
            ({ passwordHash, salt } = await hashPassword('admin'));
        }

        const clinics = (await kv.get(KV_SYSTEM_CLINICS, 'json')) || [];
        let changed = false, updated = 0;
        for (const clinic of clinics) {
            const key = `clinic:${clinic.id}:users`;
            const users = (await kv.get(key, 'json')) || [];
            let dirty = false;
            for (const u of users) {
                const isTarget = u && ((u.username === phone) || (u.phone === phone));
                if (!isTarget) continue;
                if (clinic.status === 'disabled') continue; // 禁用诊所不理会，登录优先返回启用诊所
                // 已是目标密码（PBKDF2 含随机 salt，哈希串一致才跳过）则无需重置
                if (u.passwordHash === passwordHash && u.salt === salt) continue;
                u.passwordHash = passwordHash;
                u.salt = salt;
                u.updatedAt = new Date().toISOString();
                dirty = true;
                updated++;
            }
            if (dirty) {
                await kv.put(key, JSON.stringify(users));
                changed = true;
            }
        }
        return { changed, updated };
    } catch (e) {
        console.warn('[AdminAccount] 激活密码归一化失败:', e.message);
        return { changed: false, updated: 0, error: e.message };
    }
}

// ============================================================================
// ★ 2026-10-08 淘宝云端备货码「填码即开通」一期（KNOWLEDGE §60，纯服务端）
//
// 背景：淘宝 199/399 云端码开码即预置 productClass='cloud'（后台
//   TAOBAO_STOCK_PRESETS），91 卡券自动发码、客户在激活窗填码+手机号自助
//   激活。validate/claim 历史上只签发 license、不开云端诊所账号（云账号仅经
//   付费订单→人工审核/工单产生），客户"码已激活、无账号可登"必须客服补走
//   注册→确认收款→审核。本模块在【码记录硬证据】（预置 cloud，非客户端
//   自报）+ 首激 + 手机号在网无占用三条件齐备时，claim 成功即自动开通。
//
// ★★ 安全边界（每次改动逐条复核）：
//   1. 调用资格由 validate.js 按【码记录】判定：__pcGate.source==='preset'
//      && locked==='cloud' && 端闸 check.ok（99 离线预置码在此之前已 403）
//      && status==='unused' 首机首激；本助手不采信任何客户端自报产品端；
//   2. 手机号在网双查：admin_req 申请索引（findPhoneOccupancy）+ 遍历全部
//      诊所 clinic:{id}:users 真实账号行（含禁用诊所/停用账号行——占位语义
//      宁严勿松，防给老客户静默开第二个同名手机账号）；管理员删除账号=用户
//      行已移除，允许重开（provisionCloudAccount 内清删除墓碑）；
//   3. 客户自报诊所名仅在【全局无同名诊所】时采信：provisionCloudAccount 对
//      同名诊所是"补账号"语义（该诊所已有管理员时新号降为 doctor=进别人所
//      看别人方），人工通道靠管理员把关，无人通道必须在代码里堵死这个越权
//      注入；重名/未填一律用服务端唯一名「中医诊所·手机尾号XXXX」；
//   4. 审计先行：先落 status=activated 的 admin_req 三索引（admin-list 历史
//      可见、admin-status 按机重签、登录自愈 maybeProvisionFromActivation
//      幂等补开），再 provisionCloudAccount；provision 失败不回滚 license
//      （码已签发是主结果），客户首次登录时自愈补开；
//   5. 一期初始密码固定 admin（与工单/无密码官网订单同水位），自设密码随
//      二期客户端把激活窗已收集的密码随 claim 上传后闭环。
// ============================================================================

// 手机号是否已是任一诊所真实账号（用户行存在即占用；墓碑删除=行不存在=未占用）
export async function phoneHasCloudAccount(kv, phone) {
    const ph = String(phone || '').trim();
    if (!/^1[3-9]\d{9}$/.test(ph)) return null;
    const clinics = await getClinicsOrThrow(kv);
    for (const clinic of clinics) {
        const users = (await kv.get(`clinic:${clinic.id}:users`, 'json').catch(() => null)) || [];
        const hit = users.find(u => u && (u.username === ph || u.phone === ph));
        if (hit) {
            return {
                clinicId: clinic.id,
                clinicName: clinic.name,
                role: hit.role || '',
                disabled: hit.disabled === true
            };
        }
    }
    return null;
}

// 兜底名随机后缀字符集（去易混 0/o/1/i/l）
const AUTO_NAME_RAND_CHARS = 'abcdefghjkmnpqrstuvwxyz23456789';
function autoNameRandomSuffix(len) {
    return Array.from(crypto.getRandomValues(new Uint8Array(len)))
        .map(b => AUTO_NAME_RAND_CHARS[b % AUTO_NAME_RAND_CHARS.length]).join('');
}
function autoNameBase(phone) {
    const tail = /\d{4}$/.test(String(phone || '')) ? String(phone).slice(-4) : '0000';
    return '中医诊所·' + tail;
}
function autoNameMachinePart(machineId) {
    return String(machineId || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 6);
}

// 在【给定诊所清单】上选一个当前唯一的兜底名：尾号 → 撞则加机器指纹 →
//   再撞循环随机后缀。调用方负责提供新鲜清单（落库点会重读）。
function pickFallbackName(clinics, phone, machineId) {
    const taken = (n) => clinics.some(c => c && c.name === n);
    const base = autoNameBase(phone);
    if (!taken(base)) return base;
    const midPart = autoNameMachinePart(machineId);
    const withMid = base + (midPart ? '·' + midPart : '');
    if (!taken(withMid)) return withMid;
    for (let i = 0; i < 12; i++) {
        const cand = base + '·' + autoNameRandomSuffix(3);
        if (!taken(cand)) return cand;
    }
    return base + '·' + midPart + '·' + autoNameRandomSuffix(6);
}

// 自动开通唯名解析：客户起名 2~50 字、无管道符且全局无同名才采信，否则服务端
//   兜底唯一名。nameSource：client=客户起名采信；fallback=客户未填；
//   fallback-collision=客户起名合法但撞名；fallback-invalid=超长/过短/含非法字符。
export async function resolveAutoCloudClinicName(kv, opts) {
    const o = opts || {};
    const phone = String(o.phone || '').trim();
    const machineId = String(o.machineId || '');
    const submitted = String(o.submittedName || '').trim();
    const clinics = await getClinicsOrThrow(kv);
    if (submitted) {
        const valid = submitted.length >= 2 && submitted.length <= 50 && !submitted.includes('|');
        if (valid && !clinics.some(c => c && c.name === submitted)) {
            return { clinicName: submitted, nameSource: 'client' };
        }
        return {
            clinicName: pickFallbackName(clinics, phone, machineId),
            nameSource: valid ? 'fallback-collision' : 'fallback-invalid'
        };
    }
    return { clinicName: pickFallbackName(clinics, phone, machineId), nameSource: 'fallback' };
}

// 落库点重新唯名（预检→落库并发窗撞名后的重试入口）：重读最新诊所清单，
//   直接选带机器指纹/随机后缀的唯一兜底名，不再尝试客户原名。
export async function regenerateAutoCloudClinicName(kv, opts) {
    const clinics = await getClinicsOrThrow(kv);
    return { clinicName: pickFallbackName(clinics, opts.phone, opts.machineId), nameSource: 'fallback-race' };
}

// 占号+唯名预检（纯读；validate 在任何写库/签发前调用。读异常向上抛由调用方
//   按 fail-closed 处理=本次不开通，绝不影响 license 主流程）
export async function preflightTaobaoCloudAuto(kv, opts) {
    const o = opts || {};
    const phone = String(o.phone || '').trim();
    if (!/^1[3-9]\d{9}$/.test(phone)) return { ok: false, reason: 'bad-phone' };
    if (!o.machineId || !o.code) return { ok: false, reason: 'bad-args' };
    const occupied = await findPhoneOccupancy(kv, phone);
    if (occupied) return { ok: false, reason: 'req-' + occupied.kind };
    const existed = await phoneHasCloudAccount(kv, phone);
    if (existed) return { ok: false, reason: 'cloud-account-exists', clinicName: existed.clinicName };
    const resolved = await resolveAutoCloudClinicName(kv, {
        phone, machineId: o.machineId, submittedName: o.submittedName
    });
    return { ok: true, phone: phone, clinicName: resolved.clinicName, nameSource: resolved.nameSource };
}

// 一码一诊所幂等键：码级标记，防同码并发双开（KV 无事务，窄窗内第二请求读到
//   标记即放弃开通；读/写异常不阻断——下方 provision 属主护栏仍能阻止跨所注入）
function autoCodeMarkerKey(code) { return 'taobao_auto_code:' + code; }

// 落库开通（createAdminRequest 审计三索引 → provisionCloudAccount）。
//   双审加固（KNOWLEDGE §60）：①占号复查 fail-closed（KV 读异常=放弃开通）；
//   ②码级幂等键；③落库点【新鲜重读】唯名，provision create-only 属主护栏，
//   撞名换随机唯名重试，彻底杜绝"补号降 doctor 进别人所"；④仅 personal/pro。
export async function commitTaobaoCloudAuto(kv, opts) {
    const p = opts || {};
    const phone = String(p.phone || '').trim();
    const code = String(p.code || '').trim();
    const machineId = String(p.machineId || '').trim();
    if (!/^1[3-9]\d{9}$/.test(phone) || !machineId) return { ok: false, reason: 'bad-args' };
    if (!/^BNZC-[A-HJ-NP-Z2-9]{4}(-[A-HJ-NP-Z2-9]{4}){3}$/.test(code)) return { ok: false, reason: 'bad-code' };
    const rawType = String(p.type || 'personal').toLowerCase();
    if (rawType !== 'personal' && rawType !== 'pro') return { ok: false, reason: 'type-not-eligible' };
    const actType = rawType === 'pro' ? 'pro' : 'personal';

    // ① 防御性复查（预检→落库并发窗）：fail-closed，读异常绝不按"无占用"放行
    let occupied = null;
    try {
        occupied = await findPhoneOccupancy(kv, phone);
    } catch (e) {
        return { ok: false, reason: 'recheck-read-error', detail: e && e.message };
    }
    if (occupied) return { ok: false, reason: 'req-' + occupied.kind + '-race' };
    try {
        const existed = await phoneHasCloudAccount(kv, phone);
        if (existed) return { ok: false, reason: 'cloud-account-exists-race', clinicName: existed.clinicName };
    } catch (e) {
        return { ok: false, reason: 'recheck-read-error', detail: e && e.message };
    }

    // ② 码级幂等键（同码并发/重试只允许一次自动开通）
    const markerKey = autoCodeMarkerKey(code);
    const marker = await kv.get(markerKey, 'json').catch(() => null);
    if (marker && marker.requestId) {
        return { ok: false, reason: 'code-already-provisioned', requestId: marker.requestId };
    }

    const now = new Date().toISOString();
    // requestId 形状与 admin-submit.generateRequestId 同构（REQ-<ts36*9>-<hex4>）
    const ts = Date.now().toString(36).toUpperCase().padStart(9, '0').slice(-9);
    const rand = Array.from(crypto.getRandomValues(new Uint8Array(2)))
        .map(b => b.toString(16).toUpperCase().padStart(2, '0')).join('');
    const requestId = `REQ-${ts}-${rand}`;
    const days = Number(p.days) > 0 ? Number(p.days) : 365;
    // 非法日期串（脏数据）按无 expiresAt 处理，避免 toISOString 抛错使开通静默失败
    let expiresAt = null;
    if (p.expiresAt) {
        const __d = new Date(p.expiresAt);
        if (!isNaN(__d.getTime())) expiresAt = __d.toISOString();
    }
    // 被邀请人 +30 天奖励与 validate 签发的 license 同源贯通（provisionCloudAccount
    //   对 expiresAt 优先、否则 days+inviteeBonusDays；与 admin-approve 链路口径一致）
    const inviteeBonusDays = Number(p.inviteeBonusDays) || 0;

    // ③ 落库点新鲜唯名（不复用预检结果——预检到此处间隔整段 validate 多次 KV 往返）
    const fresh = await resolveAutoCloudClinicName(kv, {
        phone, machineId, submittedName: String(p.submittedName || '').trim()
    });
    let clinicName = fresh.clinicName;
    let nameSource = fresh.nameSource;

    // 审计记录：字段形状对齐 admin-submit recordPayload——admin-list 历史列表、
    //   admin-status 按机重签、users.js 登录自愈三条读链全部直接复用。
    const buildRecord = () => ({
        requestId,
        clinicName,
        adminName: '',
        phone,
        remark: '淘宝云端备货码 claim 自动开通（初始密码 admin，首次登录请改密）',
        machineId,
        status: 'activated',
        submittedAt: now,
        createdAt: now,
        resolvedAt: now,
        resolvedBy: 'system:taobao-cloud-auto',
        licenseCode: code,
        licenseBase64: null,
        rejectReason: null,
        productName: '',
        edition: actType === 'pro' ? 'institution' : 'personal',
        appMode: 'cloud',
        appModeCarrier: '',
        inviteCode: '',
        passwordHash: '',
        passwordSalt: '',
        versionLabel: '',
        env: 'production',
        freePass: false,
        orderSource: 'taobao-cloud-auto',
        // provisionCloudAccount 兼容字段
        type: actType,
        days,
        expiresAt,
        inviteeBonusDays,
        autoSource: 'taobao-cloud-code',
        autoNameSource: nameSource,
        submittedIp: p.ip || '',
        activatedIp: p.ip || ''
    });
    let record = buildRecord();
    // 三索引原子序列：admin_req:{rid} + admin_phone:{phone}=activated + index unshift
    await createAdminRequest(kv, record);
    await kv.put(markerKey, JSON.stringify({ requestId, phone, at: now })).catch((e) => {
        console.warn('[TaobaoCloudAuto] 码级幂等键写入失败（不影响开通，属主护栏兜底）:', e && e.message);
    });

    // ④ provision create-only：撞名（属主非本请求）→ 换新鲜随机唯名重试，至多 3 次
    let provisioned = false;
    let provisionError = '';
    for (let attempt = 0; attempt < 3; attempt++) {
        if (attempt > 0) {
            const regen = await regenerateAutoCloudClinicName(kv, { phone, machineId });
            clinicName = regen.clinicName;
            nameSource = regen.nameSource;
            record = buildRecord();
            // 审计记录同步最终名（三索引中 admin_phone 只含 requestId，无需动）
            await kv.put(KV_ADMIN_REQ_PREFIX + requestId, JSON.stringify(record)).catch(() => {});
        }
        try {
            await provisionCloudAccount(kv, {
                phone,
                adminName: '',
                clinicName,
                machineId,
                type: actType,
                days,
                expiresAt,
                inviteeBonusDays,
                appMode: 'cloud',
                requestId,
                __autoRequestId: requestId
            });
            provisioned = true;
            break;
        } catch (e) {
            if (e && e.code === 'AUTO_NAME_COLLISION' && attempt < 2) {
                console.warn('[TaobaoCloudAuto] 诊所名并发撞名，换唯名重试:', clinicName, '→');
                continue;
            }
            // 不抛：license 已签发是主结果；审计记录已在，登录/状态轮询自愈补开
            provisionError = (e && e.message) || String(e);
            console.warn('[TaobaoCloudAuto] provisionCloudAccount 失败（不影响license，登录自愈补开）:', provisionError);
            break;
        }
    }
    return { ok: true, requestId, clinicName, nameSource, provisioned, provisionError };
}

// license 签发后回填审计记录（validate 在 encodeLicenseBase64 之后调用）：
//   admin-status machineId 自救扫描命中本记录时必须带真实 license，否则会回
//   license:null 让客户端误判"已自动安装"。仅回填本通道记录、幂等、失败不阻断。
export async function attachLicenseToAutoRequest(kv, requestId, licenseBase64) {
    try {
        const rid = String(requestId || '');
        if (!/^REQ-[A-Z0-9]+-[A-F0-9]+$/i.test(rid) || !licenseBase64) return false;
        const key = KV_ADMIN_REQ_PREFIX + rid;
        const rec = await kv.get(key, 'json').catch(() => null);
        if (!rec || rec.orderSource !== 'taobao-cloud-auto') return false;
        if (rec.licenseBase64) return true;
        rec.licenseBase64 = licenseBase64;
        await kv.put(key, JSON.stringify(rec));
        return true;
    } catch (e) {
        console.warn('[TaobaoCloudAuto] license 回填审计记录失败（不影响激活）:', e && e.message);
        return false;
    }
}