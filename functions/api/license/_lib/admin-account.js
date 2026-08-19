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
    KV_SYSTEM_CLINICS
} from '../../_lib/auth.js';

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
    console.log('[AdminAccount] 云端账号已开通:', phone, 'clinic=', clinicName);
}

// 审核通过记录 → 幂等开通云端诊所 + clinic_admin 账号
export async function provisionCloudAccount(kv, record) {
    const phone = (record.phone || '').trim();
    const clinicName = (record.clinicName || '').trim();
    if (!phone || !clinicName) return false;

    const now = new Date().toISOString();
    const clinics = (await kv.get(KV_SYSTEM_CLINICS, 'json')) || [];
    let clinic = clinics.find(c => c.name === clinicName);

    // 1) 存在同名诊所 → 直接补充账号
    if (clinic) {
        await ensureClinicUser(kv, clinic.id, clinicName, phone, record.adminName, now);
        return true;
    }

    // 2) 不存在 → 创建新诊所
    const clinicId = 'clinic_' + Array.from(crypto.getRandomValues(new Uint8Array(10)))
        .map(b => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('');
    clinic = { id: clinicId, name: clinicName, status: 'active', createdAt: now, updatedAt: now };
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