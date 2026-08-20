// ============================================================================
// button-manager.js —— 按钮三件套单一写入源（Single-Writer Architecture）
// 架构目的：彻底杜绝"异步回调最后执行=生效"的按钮显示竞态
//   历史上 userManageBtn/changePwdBtn/clinicPrescriptionBtn 被多个函数
//   （updateUserDisplay/enforce D层/applyRuntimePermissions/enforce catch）
//   独立赋值，微任务调度相对顺序随机 → 每次打补丁出新 bug。
//   本文件作为唯一写入权威，所有旧函数运行时被 __patchOldCallers() 替换为
//   调用本文件的 __applyUserButtons()。
// 加载方式：shared/permission.js 最开头 document.write 注入本脚本（因为
//   index.html 零改动约束，只能走已有 entry 动态加载）。
// ============================================================================
(function (global) {
    'use strict';

    var INSTITUTIONAL_EDITIONS = ['clinic','offline_clinic','clinic_custom','offline','cloud_clinic','cloud','clinic_custom','institution'];
    var PERSONAL_EDITIONS = ['personal','offline_personal','cloud_personal'];

    // ──────────────── 单一计算：canManage / canChangePwd ────────────────
    function __computePermissions(user, edition) {
        user = user || (typeof currentUser !== 'undefined' ? currentUser : null) || null;
        var e = edition || __getEdition();
        var isInst = INSTITUTIONAL_EDITIONS.indexOf(e) >= 0;
        var isPersonal = PERSONAL_EDITIONS.indexOf(e) >= 0;

        var canManage = false;
        var canChangePwd = true;
        try {
            if (global.Permission && typeof Permission.shouldShowUserManage === 'function') {
                canManage = Permission.shouldShowUserManage(user);
            } else {
                canManage = !!(user && (user.role === 'admin' || user.role === 'clinic_admin'));
                // 标准版/单用户 → 单用户不显示用户管理
                if (isPersonal) canManage = false;
                // 机构版 → 只有管理员显示
                if (isInst) canManage = !!(user && (user.role === 'admin' || user.role === 'clinic_admin'));
            }
            if (global.Permission && typeof Permission.shouldShowChangePwd === 'function') {
                canChangePwd = Permission.shouldShowChangePwd(user);
            } else {
                if (isPersonal) canChangePwd = true; // 标准版保留改密
                if (isInst) canChangePwd = !(user && (user.role === 'admin' || user.role === 'clinic_admin')); // 机构版管理员走用户管理
            }
        } catch(_) {}
        return { canManage: !!canManage, canChangePwd: !!canChangePwd, isInst: isInst, isPersonal: isPersonal };
    }

    function __getEdition() {
        try { if (typeof CONFIG !== 'undefined' && CONFIG && CONFIG.edition) return String(CONFIG.edition); } catch(_) {}
        try { if (global.EDITION) return String(global.EDITION); } catch(_) {}
        try { if (global.Permission && Permission._edition) return String(Permission._edition); } catch(_) {}
        return '';
    }

    // ──────────────── 唯一写入入口（三件套按钮永远走这里） ────────────────
    function __applyUserButtons(user, edition) {
        var p = __computePermissions(user, edition);
        var umb = document.getElementById('userManageBtn');
        var cpb = document.getElementById('changePwdBtn');
        var cpr = document.getElementById('clinicPrescriptionBtn');
        if (umb) { umb.style.display = p.canManage ? 'block' : 'none'; umb.style.visibility = p.canManage ? 'visible' : 'hidden'; }
        if (cpb) { cpb.style.display = p.canChangePwd ? 'block' : 'none'; cpb.style.visibility = p.canChangePwd ? 'visible' : 'hidden'; }
        if (cpr) { cpr.style.display = p.canManage ? 'block' : 'none'; cpr.style.visibility = p.canManage ? 'visible' : 'hidden'; }
        // 移动端按钮 btn2（【用户管理】→ 改密码在移动端是改密图标，无移动端时无此按钮）
        try {
            var btn2 = document.getElementById('mobileBtn2');
            if (btn2) {
                if (p.isPersonal) {
                    btn2.setAttribute('data-action', 'changePassword');
                    var icon = btn2.querySelector('.icon'); if (icon) icon.textContent = '🔑';
                    var label = btn2.querySelector('.label'); if (label) label.textContent = '改密';
                } else if (p.isInst) {
                    btn2.setAttribute('data-action', 'userManage');
                    var _icon2 = btn2.querySelector('.icon'); if (_icon2) _icon2.textContent = '👥';
                    var _label2 = btn2.querySelector('.label'); if (_label2) _label2.textContent = '用户';
                }
                btn2.style.display = '';
            }
        } catch(_) {}
        return p;
    }

    // ──────────────── Setup 权威模式的 edition 纠正（只改状态不碰 DOM，DOM 由 __applyUserButtons 统一写） ────────────────
    function __enforceStandardEditionInner(reason) {
        var isDesktopLocal = false;
        try {
            if (typeof IS_ELECTRON !== 'undefined' && IS_ELECTRON) isDesktopLocal = true;
            if (global.electronAPI && global.electronAPI.isElectron) isDesktopLocal = true;
            if (isDesktopLocal && global.APP_MODE && String(global.APP_MODE) !== 'offline') isDesktopLocal = false;
            // 云端保护：APP_MODE=cloud 即使是 Electron 也不算惠康中医-本地权威
            try { if (String(global.APP_MODE || '') === 'cloud') isDesktopLocal = false; } catch(_) {}
        } catch(_) {}

        var tag = (typeof getEditionTag === 'function') ? String(getEditionTag()) : '';
        var globalProduct = (typeof window.PRODUCT_NAME !== 'undefined') ? String(window.PRODUCT_NAME) : '';
        var configProduct = ''; try { if (typeof CONFIG !== 'undefined') configProduct = String(CONFIG.productName || ''); } catch(_) {}
        var configEdition = ''; try { if (typeof CONFIG !== 'undefined') configEdition = String(CONFIG.edition || ''); } catch(_) {}
        var globalEdition = String(global.EDITION || '');
        var domMarker = !!(document.getElementById('_force_standard_edition_marker_'));

        // ★ 2026-08-20 云端保护：HTML 锚点是"惠康中医-本地"专属判据，云端产品不应用
        var isCloudProduct = false;
        try {
            if (String(global.APP_MODE || '') === 'cloud') isCloudProduct = true;
            if (String(globalProduct) === '惠康中医-云端' || String(configProduct) === '惠康中医-云端') isCloudProduct = true;
        } catch(_) {}
        var softMarker = !isCloudProduct && domMarker;

        var isStandardSoft = false
            || (tag.indexOf('标准版') >= 0)
            || (globalProduct === '惠康中医-本地')
            || (configProduct === '惠康中医-本地')
            || (['personal', 'offline_personal'].indexOf(configEdition) >= 0)
            || (globalEdition === 'personal' || globalEdition === 'offline_personal')
            || softMarker;

        // ★ 机构版豁免（所有出口前最后统一由 __applyUserButtons 正向对齐）
        var _cfgIsInst = configEdition && INSTITUTIONAL_EDITIONS.indexOf(configEdition) >= 0;
        var _winIsInst = globalEdition && INSTITUTIONAL_EDITIONS.indexOf(globalEdition) >= 0;
        var _permIsInst = false; try { if (global.Permission && Permission._edition && INSTITUTIONAL_EDITIONS.indexOf(String(Permission._edition)) >= 0) _permIsInst = true; } catch(_) {}
        var institutionExempt = _cfgIsInst || _winIsInst || _permIsInst;

        var mustEnforce = isDesktopLocal || isStandardSoft;
        if (!institutionExempt && mustEnforce) {
            // A) edition 强制 personal（通过归一化锁 setter 自动三写同步）
            try {
                if (typeof CONFIG !== 'undefined' && CONFIG) CONFIG.edition = 'personal';
                else global.EDITION = 'personal';
            } catch(_) { try { global.EDITION = 'personal'; } catch(_) {} }
            try { if (global.Permission && typeof Permission.setEdition === 'function') Permission.setEdition('personal'); } catch(_) {}
            try { if (global.Permission) Permission._edition = 'personal'; } catch(_) {}
            // C) role 强制 user（单用户）
            try {
                if (typeof currentUser !== 'undefined' && currentUser) currentUser.role = 'user';
                var _us = localStorage.getItem('currentUser');
                if (_us) { try { var _u = JSON.parse(_us); _u.role = 'user'; localStorage.setItem('currentUser', JSON.stringify(_u)); } catch(_) {} }
            } catch(_) {}
        }
        // ★★★ 所有出口（豁免 OR 强制执行完毕）最后统一由 Single-Writer 对齐 DOM，永远一致
        try { return __applyUserButtons(); } catch(_) {}
    }

    // ──────────────── 运行时替换所有旧调用方 ────────────────
    function __patchOldCallers() {
        // 1) 覆盖全局 enforceStandardEditionButtons → 统一走权威模式 + 单一写入
        global.enforceStandardEditionButtons = function (reason) {
            try { return __enforceStandardEditionInner(reason); } catch(e) {
                try { if (typeof console !== 'undefined' && console.warn) console.warn('[btn-mgr] enforce 异常（已吞）:', e.message || e); } catch(_) {}
                // 异常兜底最后也走 Single-Writer 保证一致
                try { return __applyUserButtons(); } catch(_) {}
            }
        };

        // 2) 覆盖 Permission.applyRuntimePermissions → 机构版/个人版都只委托 Single-Writer
        if (global.Permission && Permission.applyRuntimePermissions) {
            var _orig = Permission.applyRuntimePermissions;
            Permission.applyRuntimePermissions = function () {
                try { _orig.call(Permission); } catch(_) {}
                // 覆盖旧函数里的不对称隐藏：让 Single-Writer 以最新权威状态重算并落 DOM
                try { __applyUserButtons(); } catch(_) {}
                // 同步入口屏蔽（非云端版）——旧逻辑，保留（非三件套按钮，不属于 Single-Writer 范围）
                try {
                    var isCloudNow = false;
                    try { if (typeof CONFIG !== 'undefined' && CONFIG) isCloudNow = ['cloud','cloud_personal','cloud_clinic','institution','clinic_custom'].indexOf(String(CONFIG.edition)) >= 0; } catch(_) {}
                    if (!isCloudNow) {
                        var nds = document.querySelectorAll('[onclick*=\"sync\"], #syncBtn, #cloudSyncBtn, #syncStatus');
                        if (nds && nds.forEach) nds.forEach(function(el){ try { el.style.display = 'none'; } catch(_){} });
                    }
                } catch(_) {}
            };
        }

        // 3) Wrapper updateUserDisplay：旧函数还是会做业务逻辑（用户名显示/基础设置等），但三件套按钮由 Single-Writer 最终覆盖
        if (typeof global.updateUserDisplay === 'function') {
            var _origUpdateUser = global.updateUserDisplay;
            global.updateUserDisplay = function () {
                try { _origUpdateUser.apply(global, arguments); } catch(e) {
                    try { if (console && console.warn) console.warn('[btn-mgr] updateUserDisplay 异常:', e.message || e); } catch(_) {}
                }
                // 旧 updateUserDisplay 内部也给三件套按钮赋值（多写源），这里用 Single-Writer 最终覆盖掉
                try { __applyUserButtons(); } catch(_) {}
            };
        }
    }

    // ──────────────── 公共 API 暴露 ────────────────
    global.__applyUserButtons = __applyUserButtons;
    global.__computePermissions = __computePermissions;
    global.__patchOldCallers = __patchOldCallers;
    global.__INSTITUTIONAL_EDITIONS = INSTITUTIONAL_EDITIONS;
    global.__PERSONAL_EDITIONS = PERSONAL_EDITIONS;

    // 立即打补丁（DOMContentLoaded 前执行也 OK，因为只是覆盖函数对象，不访问 DOM）
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { try { __patchOldCallers(); } catch(_) {} });
        // 补丁生效后再在 load 时跑一次对齐（此时 Permission.init 已就绪）
        window.addEventListener('load', function () { try { __applyUserButtons(); } catch(_) {} });
    } else {
        try { __patchOldCallers(); } catch(_) {}
    }

})(window);
