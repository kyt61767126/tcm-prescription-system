// ============================================================================
// user-admin.js —— 用户管理共享逻辑权威源（二期方案）
//
// ★ 本文件是权威源：由 tools/sync-shared-blocks.cjs 以标记块形式注入
//   七份 index.html（public / cloud_desktop / cloud_app / 根 index.html /
//   db-offline desktop / index-app / db-offline app assets），勿手改各副本。
//
// 设计原则：
//   1. 纯逻辑、零 DOM 依赖（DOM 渲染仍留在各 index.html，云端/离线有差异）
//   2. AuthCore 可选依赖：AuthCore 未加载时退化为本地角色比较（防阻断）
//   3. 收口三类散判（一期 verify-role-centralized.ps1 门禁的豁免项归位）：
//      - 处方加载层 `currentUser.role !== 'admin' ? username : null`
//        → prescriptionFilterUser()（云端 clinic_admin 曾被当普通用户只载自己处方）
//      - 用户列表诊所归属过滤 → listVisibleUsers()
//      - 跨诊所本机残留判定 → isCrossClinicLocalRecord()
//      - 角色显示文案（管理员/前台收费/普通用户…）→ roleLabel()
//        （离线↔云端角色映射表：admin ≡ clinic_admin → 均显示"管理员"）
// ============================================================================
(function (global) {
    'use strict';

    // 角色显示文案统一映射（离线 admin 与云端 clinic_admin 语义等价，显示同名）
    var ROLE_LABELS = {
        admin: '管理员',
        clinic_admin: '管理员',
        platform_admin: '平台总管理员',
        cashier: '前台收费',
        doctor: '医师',
        user: '普通用户'
    };

    // 角色显示文案（user 参数可为用户对象或角色字符串）
    function roleLabel(user) {
        var role = (user && typeof user === 'object') ? (user.role || 'user') : (user || 'user');
        return ROLE_LABELS[String(role)] || '普通用户';
    }

    // 管理员级判定（AuthCore 优先，退化兜底；覆盖离线 admin + 云端 clinic_admin/platform_admin）
    function isAdminLevel(user) {
        if (!user) return false;
        if (global.AuthCore && global.AuthCore.isAdmin) return global.AuthCore.isAdmin(user);
        var role = String(user.role || '').toLowerCase();
        return role === 'admin' || role === 'clinic_admin' || role === 'platform_admin';
    }

    // 用户管理列表可见性过滤：
    //   ① 隐藏内置默认 admin（唯一管理员模式，2026-08-22）
    //   ② 云端诊所归属过滤：其他诊所在本机的登录残留不显示（2026-08-25 一期方案；
    //     无归属信息（本地账号/老数据）不过滤，重新登录即补全 clinicId）
    function listVisibleUsers(users, currentUser) {
        var curClinicId = (currentUser && currentUser.clinicId) || '';
        return (users || []).filter(function (u) {
            if (!u) return false;
            if (typeof global.isBuiltinDefaultAdmin === 'function' && global.isBuiltinDefaultAdmin(u)) return false;
            try {
                if (typeof isBuiltinDefaultAdmin === 'function' && isBuiltinDefaultAdmin(u)) return false;
            } catch (e) {}
            if (!u.clinicId || !curClinicId) return true;
            return u.clinicId === curClinicId;
        });
    }

    // 跨诊所本机缓存判定：target 是其他诊所账号在本机的残留记录（仅删本机、不动云端）
    function isCrossClinicLocalRecord(target, currentUser) {
        return !!(target && target.clinicId
            && currentUser && currentUser.clinicId
            && target.clinicId !== currentUser.clinicId);
    }

    // 处方加载层过滤用户：
    //   管理员级（含云端 clinic_admin/platform_admin）→ null（看全部）
    //   普通用户 → username（只看自己）
    //   ★ 二期收口：替代散落的 `currentUser.role !== 'admin' ? currentUser.username : null`
    function prescriptionFilterUser(user) {
        if (!user || !user.username) return null;
        if (isAdminLevel(user)) return null;
        return user.username;
    }

    global.UserAdmin = {
        ROLE_LABELS: ROLE_LABELS,
        roleLabel: roleLabel,
        isAdminLevel: isAdminLevel,
        listVisibleUsers: listVisibleUsers,
        isCrossClinicLocalRecord: isCrossClinicLocalRecord,
        prescriptionFilterUser: prescriptionFilterUser
    };
    return global.UserAdmin;
})(typeof window !== 'undefined' ? window : globalThis);
