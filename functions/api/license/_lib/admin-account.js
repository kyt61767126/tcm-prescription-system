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