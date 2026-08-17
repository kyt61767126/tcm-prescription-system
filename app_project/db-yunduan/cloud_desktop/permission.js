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
            console.log('[DBG] Permission initialized, edition:', this._edition);
        },

        get edition() { return this._edition; },
        get config() { return this._config; },

        // 版本判断（2026-08-08 规则1升级：只保留4个版本 YB/YJ/LB/LJ）
        //   YB = cloud_personal  云端标准版
        //   YJ = cloud_clinic    云端机构版
        //   LB = personal/offline_personal  离线标准版
        //   LJ = clinic/offline_clinic      离线机构版
        // 旧 key（cloud / offline / clinic_custom）向后兼容
        isCloud() {
            return ['cloud', 'cloud_personal', 'cloud_clinic'].includes(this._edition);
        },
        isOffline() {
            return ['offline', 'personal', 'clinic_custom', 'clinic',
                    'offline_personal', 'offline_clinic'].includes(this._edition);
        },
        // 是否为"标准版（单用户，不能建子账号）"：YB + LB
        isPersonal() {
            return ['personal', 'cloud_personal', 'offline_personal'].includes(this._edition);
        },
        // 是否为"机构版（多用户，管理子账号）"：YJ + LJ（兼容旧 clinic_custom/offline/clinic）
        isInstitutional() {
            return ['clinic_custom', 'offline', 'clinic', 'cloud_clinic', 'offline_clinic'].includes(this._edition);
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

        // 是否可以管理用户（仅机构版可管理子账号；标准版/单用户一律不可）
        canManageUsersByRole(user) {
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
            const edition = this._edition;
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

            // 同步入口屏蔽（非云端版）
            if (!this.isCloud()) {
                document.querySelectorAll('[onclick*="sync"], #syncBtn, #cloudSyncBtn, #syncStatus').forEach(el => {
                    el.style.display = 'none';
                });
            }
        },

        // 应用登录页权限控制
        applyLoginPermissions() {
            const edition = this._edition;

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
