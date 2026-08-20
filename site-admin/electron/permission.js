// ============================================================================
// permission.js — 版本权限控制模块
// 根据 config.json 的 edition 字段控制字段读写权限
// ============================================================================
(function (global) {
    'use strict';

    const Permission = {
        _edition: null,
        _config: null,
        _initialized: false,

        async init() {
            if (this._initialized) return;
            this._initialized = true;

            // 从 localStorage 或 electronAPI 读取配置
            try {
                if (global.electronAPI && global.electronAPI.getAppConfig) {
                    const result = await global.electronAPI.getAppConfig();
                    // Electron IPC 返回 { success, config } 格式
                    this._config = (result && result.config) ? result.config : (result || {});
                } else if (typeof CONFIG !== 'undefined' && CONFIG) {
                    // 离线版内嵌的 CONFIG 对象
                    this._config = CONFIG;
                } else {
                    const stored = localStorage.getItem('app_config');
                    this._config = stored ? JSON.parse(stored) : {};
                }
            } catch (e) {
                console.warn('读取版本配置失败:', e);
                this._config = {};
            }

            this._edition = this._config.edition || (global.EDITION) || 'cloud';
            // ★ 2026-08-17 关键修复：双源 edition 漂移防护
            //   CONFIG 由同步 XHR 从 asar/config.json 加载，本 Permission 由 electronAPI / localStorage 解析，
            //   可能不一致 → 顶部版本标签 vs 权限判断分道扬镳，造成「显示离线标准版但改密按钮缺失」。
            // ★★★ 2026-08-20 方向反转：CONFIG.edition 为权威 → Permission 采纳 CONFIG 值（而非反向覆盖 CONFIG）。
            //   旧的反向回写会把登录后已更新的机构版 CONFIG.edition 打回 init 时的旧值（cloud_personal），
            //   造成机构版管理员看不到【用户管理】只看到【修改密码】（版本按钮反复失灵根因）。
            try {
                if (typeof CONFIG !== 'undefined' && CONFIG && CONFIG.edition && String(CONFIG.edition) !== String(this._edition)) {
                    this._edition = String(CONFIG.edition);
                    console.log('[DBG] Permission adopted CONFIG.edition ->', this._edition);
                }
            } catch (_) { /* ignore non-render env */ }
            console.log('[DBG] Permission initialized, edition:', this._edition);
        },

        get edition() { return this._currentEdition(); },
        get config() { return this._config; },

        // ★★★ 2026-08-20 根治【版本状态双轨制】：edition 动态权威判定（单一读取链）
        //   旧实现：_edition 在 init() 时锁死；登录机构版后 CONFIG.edition / window.EDITION 已被
        //   getAppConfig/refreshVersionTags 更新为机构版，但 _edition 仍是初始 cloud_personal →
        //   isInstitutional()=false → 机构版管理员看不到【用户管理】。
        //   修复：每次判定实时读取 CONFIG.edition → window.EDITION → this._edition，
        //   任何一处更新（登录/激活/配置同步）立即生效，标签与权限永远同轨。
        _currentEdition() {
            try {
                if (typeof CONFIG !== 'undefined' && CONFIG && CONFIG.edition) return String(CONFIG.edition);
            } catch (_) {}
            try {
                if (global.EDITION) return String(global.EDITION);
            } catch (_) {}
            return String(this._edition || '');
        },

        // 主动同步 edition（登录后版本切换时可调用；三处同写保持单一权威）
        setEdition(ed) {
            var v = String(ed || '').trim();
            if (!v) return;
            this._edition = v;
            try { if (this._config) this._config.edition = v; } catch (_) {}
            try { if (typeof CONFIG !== 'undefined' && CONFIG) CONFIG.edition = v; } catch (_) {}
            try { global.EDITION = v; } catch (_) {}
        },

        // 版本判断（2026-08-08 规则1升级：只保留4个版本 YB/YJ/LB/LJ）
        //   YB = cloud_personal  云端标准版
        //   YJ = cloud_clinic    云端机构版
        //   LB = personal/offline_personal  离线标准版
        //   LJ = clinic/offline_clinic      离线机构版
        // 旧 key（cloud / offline / clinic_custom）向后兼容
        // ★ 2026-08-20 全部改为 _currentEdition() 动态判定（根治版本按钮反复失灵）
        isCloud() {
            return ['cloud', 'cloud_personal', 'cloud_clinic'].includes(this._currentEdition());
        },
        isOffline() {
            return ['offline', 'personal', 'clinic_custom', 'clinic',
                    'offline_personal', 'offline_clinic'].includes(this._currentEdition());
        },
        // 是否为"标准版（单用户，不能建子账号）"：YB + LB
        isPersonal() {
            return ['personal', 'cloud_personal', 'offline_personal'].includes(this._currentEdition());
        },
        // 是否为"机构版（多用户，管理子账号）"：YJ + LJ（兼容旧 clinic_custom/offline/clinic）
        isInstitutional() {
            return ['clinic_custom', 'offline', 'clinic', 'cloud_clinic', 'offline_clinic', 'cloud'].includes(this._currentEdition());
        },
        // 旧 API 兼容：isClinicCustom = isInstitutional
        isClinicCustom() {
            return this.isInstitutional();
        },

        // 权限判断（规则4：云端标准版只有管理员，不能建子账号；
        //         云端机构版管理员可增删子账号，子账号只能开方；
        //         离线标准版单账号；离线机构本地多用户）
        canEditClinicName() {
            // 所有版本允许修改诊所名称（2026-07-31 新规范）
            return true;
        },
        canEditDoctorName() {
            // 所有版本允许修改医师姓名（2026-07-31 新规范）
            return true;
        },
        canManageUsers() {
            // 规则4：只有"机构版"可以管理子账号
            return this.isInstitutional();
        },
        canSync() {
            // 规则1&2：只有云端版本能同步（但媒体不上云）
            return this.isCloud();
        },
        hasMultiUser() {
            return this.isInstitutional();
        },
        hasRememberPassword() {
            // 规则5：所有版本禁止记住密码，统一强制每次手动输密码
            return false;
        },
        hasUsernameDropdown() {
            // 规则4：仅机构版有多用户下拉；标准版单账号不需要下拉
            return this.isInstitutional();
        },

        // ===== 基于角色的权限判断（统一入口） =====
        // 所有角色判断都通过 AuthCore 的 isAdmin/isClinicAdmin/isPlatformAdmin
        // 确保离线版 admin 和云端版 clinic_admin 行为一致

        // ============================================================================
        // ★★★ 2026-08-17 Setup 1.0.38 根治【刀5：Permission 内部标准版硬守护】
        //  就算外部 enforceStandardEditionButtons 还没执行（时序问题），这里直接在 shouldShow 开头硬判：
        //    如果 CONFIG.edition=personal / window.EDITION=personal / window.PRODUCT_NAME=惠康中医-本地 / DOM锚点存在
        //    → 一律按"离线标准版（单用户=改密必现/用户管理必隐）"直接返回，不再判断 _edition 内部状态！
        // ============================================================================
        _isStandardEditionForced() {
            try {
                // ★★ 2026-08-19 机构版授权豁免：若当前 edition 为机构版，永不强制标准版。
                //   （离线/云端机构版激活后，主进程 get-app-config 将 config.edition 校正为机构版值，
                //    若此处仍按 personal/产品名强制标准版，会让激活的机构版被错误降级为单用户标准版）
                var INST_ED = ['clinic','offline_clinic','clinic_custom','offline','cloud_clinic','cloud'];
                try {
                    var cfgInst = (typeof CONFIG !== 'undefined' && CONFIG && CONFIG.edition) ? String(CONFIG.edition) : '';
                    var winInst = String(global.EDITION || '');
                    if (cfgInst && INST_ED.indexOf(cfgInst) >= 0) return false;
                    if (winInst && INST_ED.indexOf(winInst) >= 0) return false;
                    // ★ 2026-08-20 动态判定：_currentEdition() 实时读 CONFIG/EDITION，登录后机构版立即豁免
                    var curEd = this._currentEdition();
                    if (curEd && INST_ED.indexOf(curEd) >= 0) return false;
                } catch (_) {}
                // 判据1：CONFIG/WINDOW.EDITION 是 personal
                var cfgEd = (typeof CONFIG !== 'undefined' && CONFIG && CONFIG.edition) ? String(CONFIG.edition) : '';
                var winEd = String(global.EDITION || '');
                if (['personal','offline_personal'].indexOf(cfgEd) >= 0) return true;
                if (['personal','offline_personal'].indexOf(winEd) >= 0) return true;

                // 判据2：权威产品名=惠康中医-本地
                var cfgProd = (typeof CONFIG !== 'undefined' && CONFIG && CONFIG.productName) ? String(CONFIG.productName) : '';
                var winProd = String(global.PRODUCT_NAME || '');
                if (cfgProd === '惠康中医-本地' || winProd === '惠康中医-本地') return true;

                // 判据3：DOM权威锚点（HTML硬编码，JS全挂也能查到）
                // ★ 2026-08-20 云端保护：锚点是"惠康中医-本地（永久离线标准版）"专属判据；
                //   云端产品（APP_MODE=cloud / 产品名=惠康中医-云端）标准/机构形态由 userData
                //   激活配置决定，绝不能被锚点误判（曾致机构版管理员【用户管理】缺失）。
                try {
                    var _isCloudProd = false;
                    try {
                        if (String(global.APP_MODE || '') === 'cloud') _isCloudProd = true;
                        if (String(global.PRODUCT_NAME || '') === '惠康中医-云端') _isCloudProd = true;
                        if (typeof CONFIG !== 'undefined' && CONFIG && String(CONFIG.productName || '') === '惠康中医-云端') _isCloudProd = true;
                    } catch(_) {}
                    if (!_isCloudProd && global.document && document.getElementById && document.getElementById('_force_standard_edition_marker_')) return true;
                } catch(_) {}
            } catch(_) {}
            return false;
        },

        // 是否可以管理用户（仅机构版可管理子账号；标准版/单用户一律不可）
        canManageUsersByRole(user) {
            // ★ 标准版强制守护：一律不可管理用户（隐藏用户管理按钮）
            if (this._isStandardEditionForced()) return false;
            if (!this.isInstitutional()) return false;
            if (!user) return false;
            if (global.AuthCore && global.AuthCore.isClinicAdmin) {
                return global.AuthCore.isClinicAdmin(user);
            }
            // 回退：直接角色比较
            return user.role === 'admin' || user.role === 'clinic_admin';
        },

        // 是否可以修改密码（准则：试用=标准版=单用户=修改密码）
        // 非机构版（标准版/单用户）所有账号均可修改密码；
        // 机构版仅普通用户可修改密码，管理员使用账户管理（不显示修改密码）。
        canChangePassword(user) {
            // ★ 标准版强制守护：所有角色一律允许修改密码（显示改密按钮）
            if (this._isStandardEditionForced()) return true;
            if (!this.isInstitutional()) return true; // 标准版/单用户允许改密
            if (!user) return false;
            // 非个人版：管理员不显示修改密码（由账户管理覆盖），普通用户显示修改密码
            if (global.AuthCore && global.AuthCore.isClinicAdmin) {
                return !global.AuthCore.isClinicAdmin(user);
            }
            return user.role !== 'admin' && user.role !== 'clinic_admin';
        },

        // 是否显示账户管理按钮
        shouldShowUserManage(user) {
            return this.canManageUsersByRole(user);
        },

        // 是否显示修改密码按钮
        shouldShowChangePwd(user) {
            return this.canChangePassword(user);
        },

        // 是否显示开机自启选项
        shouldShowAutoStart(user) {
            if (this.isPersonal()) return false;
            if (!user) return false;
            if (global.AuthCore && global.AuthCore.isClinicAdmin) {
                return global.AuthCore.isClinicAdmin(user);
            }
            return user.role === 'admin' || user.role === 'clinic_admin';
        },

        // 是否可以查看所有处方（管理员可查看全部，普通用户只能查看自己的）
        canViewAllPrescriptions(user) {
            if (!user) return false;
            if (global.AuthCore && global.AuthCore.isClinicAdmin) {
                return global.AuthCore.isClinicAdmin(user);
            }
            return user.role === 'admin' || user.role === 'clinic_admin';
        },

        // 应用运行页权限控制
        applyRuntimePermissions() {
            const edition = this._currentEdition();
            console.log('[DBG] Applying runtime permissions for edition:', edition);

            // 诊所名称字段（2026-07-31 新规范：所有版本允许修改诊所名称）
            // 旧规则：personal/clinic_custom 设为只读，已废弃
            // const clinicNameInput = document.getElementById('clinicName');
            // if (clinicNameInput) {
            //     if (edition === 'personal' || edition === 'clinic_custom') {
            //         clinicNameInput.readOnly = true;
            //         clinicNameInput.style.backgroundColor = '#f0f0f0';
            //         clinicNameInput.style.cursor = 'not-allowed';
            //         clinicNameInput.title = '当前版本不支持修改诊所名称';
            //     }
            // }

            // 医师姓名字段（2026-07-31 新规范：所有版本允许修改医师姓名）
            // 旧规则：personal 设为只读，已废弃
            // if (edition === 'personal') {
            //     const defaultDoctorInput = document.getElementById('defaultDoctor');
            //     const doctorNameInput = document.getElementById('doctorName');
            //     [defaultDoctorInput, doctorNameInput].forEach(el => {
            //         if (el) {
            //             el.readOnly = true;
            //             el.style.backgroundColor = '#f0f0f0';
            //             el.style.cursor = 'not-allowed';
            //             el.title = '当前版本不支持修改医师姓名';
            //         }
            //     });
            // }

            // 用户管理按钮（标准版=单用户，隐藏账户管理，但保留修改密码）
            if (this.isPersonal()) {
                const userManageBtn = document.getElementById('userManageBtn');
                if (userManageBtn) userManageBtn.style.display = 'none';
                // 标准版保留修改密码功能，不再隐藏 changePwdBtn
            }
            // ★★★ 2026-08-21 机构版正向兜底：本函数只隐藏标准版的 userManageBtn，但相反场景（机构版）
            //   若此前的异步回调已把 userManageBtn 隐藏，这里必须显式恢复，确保按钮显示永远和权限一致。
            //   解决的 bug：updateUserDisplay 设置完 canManage→block 后，本函数异步执行，
            //   若 isPersonal()=false 分支不做任何事（之前的实现），userManageBtn 可能停留在被隐藏的旧状态；
            //   同时处方查阅按钮没有被任何地方覆盖，造成【处方查阅】显示/【用户管理】隐藏的诡异不一致。
            try {
                if (this.isInstitutional()) {
                    const umb = document.getElementById('userManageBtn');
                    const cpb = document.getElementById('changePwdBtn');
                    const cpr = document.getElementById('clinicPrescriptionBtn');
                    if (umb) {
                        var canMgmt = this.shouldShowUserManage(global.currentUser);
                        umb.style.display = canMgmt ? 'block' : 'none';
                        umb.style.visibility = canMgmt ? 'visible' : 'hidden';
                    }
                    if (cpb) {
                        var canChg = this.shouldShowChangePwd(global.currentUser);
                        cpb.style.display = canChg ? 'block' : 'none';
                        cpb.style.visibility = canChg ? 'visible' : 'hidden';
                    }
                    if (cpr) {
                        var canCpr = this.shouldShowUserManage(global.currentUser);
                        cpr.style.display = canCpr ? 'block' : 'none';
                        cpr.style.visibility = canCpr ? 'visible' : 'hidden';
                    }
                }
            } catch(_) {}

            // 同步入口屏蔽（非云端版）
            if (!this.isCloud()) {
                document.querySelectorAll('[onclick*="sync"], #syncBtn, #cloudSyncBtn, #syncStatus').forEach(el => {
                    el.style.display = 'none';
                });
            }
        },

        // 应用登录页权限控制
        applyLoginPermissions() {
            const edition = this._currentEdition();

            // 账号下拉框
            const dropdownBtn = document.getElementById('usernameDropdownBtn');
            if (dropdownBtn) {
                dropdownBtn.style.display = this.hasUsernameDropdown() ? '' : 'none';
            }

            // 记住密码容器
            const rememberPwdContainer = document.getElementById('rememberPasswordContainer');
            if (rememberPwdContainer) {
                rememberPwdContainer.style.display = this.hasRememberPassword() ? 'flex' : 'none';
            }

            // 云端标准版（personal）：用户名由平台管理员注册产生，首次登入手动输入，不自动填充
            // 旧逻辑（自动填充 doctorName 并设只读）已删除，因为云端单用户用户名 ≠ 医师姓名
        }
    };

    global.Permission = Permission;

})(typeof window !== 'undefined' ? window : this);
