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

        // 版本判断
        isCloud() { return this._edition === 'cloud'; },
        isOffline() { return this._edition === 'offline'; },
        isPersonal() { return this._edition === 'personal'; },
        isClinicCustom() { return this._edition === 'clinic_custom'; },

        // 权限判断
        canEditClinicName() {
            return this.isCloud() || this.isOffline();
        },
        canEditDoctorName() {
            return !this.isPersonal();
        },
        canManageUsers() {
            return !this.isPersonal();
        },
        canSync() {
            return this.isCloud();
        },
        hasMultiUser() {
            return !this.isPersonal();
        },
        hasRememberPassword() {
            return this.isPersonal();
        },
        hasUsernameDropdown() {
            return !this.isPersonal();
        },

        // ===== 基于角色的权限判断（统一入口） =====
        // 所有角色判断都通过 AuthCore 的 isAdmin/isClinicAdmin/isPlatformAdmin
        // 确保离线版 admin 和云端版 clinic_admin 行为一致

        // 是否可以管理用户（需要管理员角色 + 非个人版）
        canManageUsersByRole(user) {
            if (this.isPersonal()) return false;
            if (!user) return false;
            if (global.AuthCore && global.AuthCore.isClinicAdmin) {
                return global.AuthCore.isClinicAdmin(user);
            }
            // 回退：直接角色比较
            return user.role === 'admin' || user.role === 'clinic_admin';
        },

        // 是否可以修改密码（个人版所有用户均可；非个人版仅普通用户可修改密码，管理员使用账户管理）
        canChangePassword(user) {
            if (this.isPersonal()) return true; // 个人版允许改密
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

            // 诊所名称字段
            const clinicNameInput = document.getElementById('clinicName');
            if (clinicNameInput) {
                if (edition === 'personal' || edition === 'clinic_custom') {
                    clinicNameInput.readOnly = true;
                    clinicNameInput.style.backgroundColor = '#f0f0f0';
                    clinicNameInput.style.cursor = 'not-allowed';
                    clinicNameInput.title = '当前版本不支持修改诊所名称';
                }
            }

            // 医师姓名字段（个人定制版只读）
            if (edition === 'personal') {
                const defaultDoctorInput = document.getElementById('defaultDoctor');
                const doctorNameInput = document.getElementById('doctorName');
                [defaultDoctorInput, doctorNameInput].forEach(el => {
                    if (el) {
                        el.readOnly = true;
                        el.style.backgroundColor = '#f0f0f0';
                        el.style.cursor = 'not-allowed';
                        el.title = '当前版本不支持修改医师姓名';
                    }
                });
            }

            // 用户管理按钮（个人定制版隐藏账户管理，但保留修改密码）
            if (edition === 'personal') {
                const userManageBtn = document.getElementById('userManageBtn');
                if (userManageBtn) userManageBtn.style.display = 'none';
                // 个人版保留修改密码功能，不再隐藏 changePwdBtn
            }

            // 同步入口屏蔽（非云端版）
            if (edition !== 'cloud') {
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

            // 个人定制版：自动填充单一账号（显示医师姓名，不显示 username）
            if (edition === 'personal') {
                const usernameInput = document.getElementById('loginUsername');
                if (usernameInput && this._config) {
                    // ★个人版：显示医师姓名（doctorName），不显示 username（"admin"）
                    const displayName = this._config.doctorName
                        || (this._config.users && this._config.users.length > 0 && this._config.users[0].name
                            ? this._config.users[0].name
                            : '医师');
                    usernameInput.value = displayName;
                    usernameInput.readOnly = true;
                    usernameInput.style.backgroundColor = '#f0f0f0';
                }
            }
        }
    };

    global.Permission = Permission;

})(typeof window !== 'undefined' ? window : this);
