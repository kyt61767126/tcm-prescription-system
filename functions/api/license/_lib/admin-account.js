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
    verifyPassword,
    ROLE_CLINIC_ADMIN,
    ROLE_DOCTOR,
    KV_SYSTEM_CLINICS
} from '../../_lib/auth.js';

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
async function ensureClinicUser(kv, clinicId, clinicName, phone, adminName, now) {
    const users = (await kv.get(`clinic:${clinicId}:users`, 'json')) || [];
    const exists = users.some(u => u.username === phone || u.phone === phone);
    if (exists) return;

    const hasAdmin = users.some(u => u.role === ROLE_CLINIC_ADMIN);
    const role = hasAdmin ? ROLE_DOCTOR : ROLE_CLINIC_ADMIN;

    // 密码留空默认 admin（与离线端默认密码一致；激活框密码留空时的默认值）
    const { passwordHash, salt } = await hashPassword('admin');
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
    console.log('[AdminAccount] 云端账号已开通:', phone, 'clinic=', clinicName, 'role=', role,
        hasAdmin ? '(诊所已有管理员，本次开通为普通用户)' : '(首个管理员)');
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
    const clinics = (await kv.get(KV_SYSTEM_CLINICS, 'json')) || [];
    let clinic = clinics.find(c => c.name === clinicName);
    let clinicsDirty = false;

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
        await ensureClinicUser(kv, clinic.id, clinicName, phone, record.adminName, now);
        return true;
    }

    // 2) 不存在 → 创建新诊所（显式带 edition 字段，统一规范）
    const clinicId = 'clinic_' + Array.from(crypto.getRandomValues(new Uint8Array(10)))
        .map(b => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('');
    clinic = {
        id: clinicId,
        name: clinicName,
        status: 'active',
        createdAt: now,
        updatedAt: now,
        edition: targetEdition,          // ★ 新诊所统一写入 edition
        activationType: record.type || null,
        // ★ 2026-09-03 离线版载体（desktop/app，云端版不写）
        offlineCarrier: (targetEdition.indexOf('offline_') === 0 && targetCarrier) ? targetCarrier : undefined,
        source: 'activation'
    };
    clinics.push(clinic);
    await kv.put(KV_SYSTEM_CLINICS, JSON.stringify(clinics));

    await ensureClinicUser(kv, clinicId, clinicName, phone, record.adminName, now);
    return true;
}

// ★ 2026-08-20 激活密码归一化：把"该激活申请手机号"下所有启用状态（非禁用诊所以外的
//   cloudEnabled）账号的密码统一重置为默认 admin。
// 背景：老账号可能因历史版本默认密码不同、或手机号跨诊所重复而无法用 admin 登录（401）。
//   findUserForLogin 按诊所顺序返回第一个匹配账号，这里全量重置，保证登录端命中的那个
//   也必然是 admin，从根上消除"登录提示 401 / 旧密码遮蔽新账号"。
// 安全性：只在"激活通过的受信链路"（admin-approve / admin-status / admin-submit 探测到
//   已激活申请）调用，调用方要么是持有该激活申请的客户端，要么是平台管理员。
//   绝不能在匿名登录的自愈路径调用（否则等于任何人可用手机号重置为 admin 接管账号）。
// 幂等：verifyPassword 已为 admin 则跳过，避免无谓写 KV。
export async function normalizeActivationPassword(kv, record) {
    try {
        const phone = (record && record.phone ? String(record.phone).trim() : '');
        if (!/^1[3-9]\d{9}$/.test(phone)) return { changed: false, reason: 'not_phone' };
        const { passwordHash, salt } = await hashPassword('admin');

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
                // 已是 admin 则无需重置
                try {
                    const ok = await verifyPassword('admin', u.passwordHash, u.salt);
                    if (ok) continue;
                } catch (e) {}
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