// ============================================================================
//  login.js - 登录窗口逻辑（不依赖 nodeIntegration，通过 electronAPI 调用主进程）
//  统一 localStorage key 前缀为 local_
//  用户列表与诊所名通过 IPC get-app-config 读取 config.json，不再正则解析 index.html
// ============================================================================
(function () {
    'use strict';

    // auth-core.js 兼容：若 window.AuthCore 可用则委托共享认证模块，否则使用本地实现作为 fallback
    const KEY_USERS = 'local_systemUsers';
    const KEY_REMEMBER_USER = 'local_rememberedUsername';
    const KEY_CLINIC_NAME = 'local_clinicName';

    // 云端标准版：管理员账户通过注册产生，首次启动无默认用户
    const DEFAULT_USERS = [];
    // ★ 历史遗留账号（doctor1/doctor2/张医生/李医生）需从 localStorage 和 config.users 中过滤
    const LEGACY_USERNAMES = ['doctor1', 'doctor2'];
    // ★ 管理员用户名校验规则：4-20位字母/数字/下划线
    const ADMIN_USERNAME_REGEX = /^[a-zA-Z][a-zA-Z0-9_]{3,19}$/;

    const PASSWORD_SALT = 'bnzc_prescription_salt_v1';
    async function hashPassword(password) {
        if (window.AuthCore) return AuthCore.hashPassword(password);
        if (!password) return '';
        try {
            const encoder = new TextEncoder();
            const data = encoder.encode(PASSWORD_SALT + password);
            const hashBuffer = await crypto.subtle.digest('SHA-256', data);
            return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
        } catch (e) {
            return password;
        }
    }

    // 与 index.html 的 simpleDecrypt 保持一致，用于解密 local_systemUsers（XORv1 格式）
    // 避免登录读不到修改后的密码（修改密码保存到 local_systemUsers 是加密的）
    function simpleDecrypt(stored) {
        if (!stored || typeof stored !== 'string') return stored;
        if (!stored.startsWith('XORv1:')) return stored;
        try {
            const text = decodeURIComponent(escape(atob(stored.substring(6))));
            const key = PASSWORD_SALT;
            let result = '';
            for (let i = 0; i < text.length; i++) {
                result += String.fromCharCode(text.charCodeAt(i) ^ key.charCodeAt(i % key.length));
            }
            return result;
        } catch(e) { return stored; }
    }
    // 与 index.html 的 simpleEncrypt 保持一致，用于加密 local_systemUsers
    function simpleEncrypt(text) {
        if (!text) return '';
        const key = PASSWORD_SALT;
        let result = '';
        for (let i = 0; i < text.length; i++) {
            result += String.fromCharCode(text.charCodeAt(i) ^ key.charCodeAt(i % key.length));
        }
        return 'XORv1:' + btoa(unescape(encodeURIComponent(result)));
    }

    function $(id) { return document.getElementById(id); }

    function showError(msg) {
        const el = $('loginError');
        el.textContent = msg;
        el.style.display = 'block';
    }
    function clearError() {
        $('loginError').style.display = 'none';
    }

    function safeParse(str, fallback) {
        try { return JSON.parse(str); } catch (e) { return fallback; }
    }

    function normalizeUser(u) {
        return {
            username: u.username || '',
            password: u.password || '',
            name: u.name || u.username || '',
            role: u.role || 'user'
        };
    }

    // 一次性获取 app config（IPC 缓存，避免重复跨进程调用）
    let appConfigCache = null;
    async function getAppConfig() {
        if (appConfigCache !== null) return appConfigCache;
        if (window.electronAPI && window.electronAPI.getAppConfig) {
            try {
                const r = await window.electronAPI.getAppConfig();
                if (r && r.success && r.config) {
                    appConfigCache = r.config;
                    return appConfigCache;
                }
            } catch (e) { /* ignore */ }
        }
        appConfigCache = {};
        return appConfigCache;
    }

    function getUsersFromConfig(config) {
        if (Array.isArray(config.users) && config.users.length > 0) {
            // ★ 过滤历史遗留账号（doctor1/doctor2/张医生/李医生）
            return config.users.map(normalizeUser).filter(u => u.username && u.password && !LEGACY_USERNAMES.includes(u.username));
        }
        return [];
    }

    function getUsersFromStorage() {
        const saved = localStorage.getItem(KEY_USERS);
        if (saved) {
            // 先用 simpleDecrypt 解密 XORv1 格式（与 index.html getUsers 一致）
            const decrypted = simpleDecrypt(saved);
            const users = safeParse(decrypted, []);
            if (Array.isArray(users) && users.length > 0) {
                // ★ 过滤历史遗留账号（doctor1/doctor2/张医生/李医生）
                const filtered = users.map(normalizeUser).filter(u => u.username && u.password && !LEGACY_USERNAMES.includes(u.username));
                return filtered;
            }
        }
        return [];
    }

    // 获取用户列表：优先使用 localStorage（用户管理中维护的），为空时回退到 config.json
    function getUsers(config) {
        const stored = getUsersFromStorage();
        if (stored.length > 0) {
            return stored.map(u => ({ ...u, displayName: u.name || u.username }));
        }
        const cfg = getUsersFromConfig(config);
        if (cfg.length > 0) {
            return cfg.map(u => ({ ...u, displayName: u.name || u.username }));
        }
        return DEFAULT_USERS.map(normalizeUser).map(u => ({ ...u, displayName: u.name || u.username }));
    }

    // 检查是否有已注册的管理员账户
    function hasAdminUser(config) {
        const users = getUsers(config);
        return users.length > 0;
    }

    function loadClinicName(config) {
        const name = localStorage.getItem(KEY_CLINIC_NAME) || config.clinicName;
        $('clinicName').textContent = name || '本能堂中医诊所';
    }

    let _users = [];

    // 初始化登录输入框（云端标准版：手动输入用户名）
    function initLoginInput(config) {
        const input = $('loginUsername');
        const users = getUsers(config);
        _users = users;
        
        // ★ 云端标准版：手动输入用户名，不自动填充
        const rememberedUser = localStorage.getItem(KEY_REMEMBER_USER);
        if (rememberedUser && !LEGACY_USERNAMES.includes(rememberedUser)) {
            input.value = rememberedUser;
            $('rememberUser').checked = true;
        }
    }

    // 版本权限控制
    async function initLoginPermissions() {
        try {
            if (window.Permission) {
                await Permission.init();
                Permission.applyLoginPermissions();
            }
        } catch(e) { console.warn('Login permission init failed:', e); }
    }

    // ★ 优化：登录防重复提交标志
    let _loginInFlight = false;

    function setLoginLoading(loading) {
        const btn = $('btnOk');
        const pwd = $('loginPassword');
        const input = $('loginUsername');
        if (!btn) return;
        if (loading) {
            btn.disabled = true;
            btn.dataset.originalText = btn.textContent;
            btn.textContent = '登录中...';
            if (pwd) pwd.disabled = true;
            if (input) input.disabled = true;
        } else {
            btn.disabled = false;
            if (btn.dataset.originalText) btn.textContent = btn.dataset.originalText;
            if (pwd) pwd.disabled = false;
            if (input) input.disabled = false;
        }
    }

    async function handleLogin() {
        clearError();
        // ★ 优化：防重复提交
        if (_loginInFlight) return;
        const username = $('loginUsername').value.trim();
        const password = $('loginPassword').value;
        if (!username) { showError('请输入用户名'); return; }
        if (!password) { showError('请输入密码'); return; }

        _loginInFlight = true;
        setLoginLoading(true);
        try {
            const user = _users.find(u => u.username === username);
            if (!user) {
                showError('用户名或密码错误');
                return;
            }
            const storedPwd = user.password || '';
            const isHash = /^[a-f0-9]{64}$/.test(storedPwd);
            const pwdOk = isHash ? (storedPwd === await hashPassword(password)) : (storedPwd === password);
            if (!pwdOk) {
                showError('用户名或密码错误');
                return;
            }

            // ★ 优化：批量并行写入 AuthCore 存储
            const userData = { username: user.username, name: user.name, role: user.role || 'user' };
            const userDataStr = JSON.stringify(userData);
            const loginDataStr = JSON.stringify({ loginTime: Date.now(), username: user.username });

            if (window.AuthCore) {
                try {
                    await Promise.all([
                        AuthCore.StorageAdapter.setItem('auth:currentUser', userDataStr),
                        AuthCore.StorageAdapter.setItem('auth:isLoggedIn', 'true'),
                        AuthCore.StorageAdapter.setItem('auth:loginData', loginDataStr)
                    ]);
                } catch(e) {}
            }
            localStorage.setItem('currentUser', userDataStr);
            localStorage.setItem('isLoggedIn', 'true');

            const remember = $('rememberUser').checked;
            if (remember) {
                localStorage.setItem(KEY_REMEMBER_USER, user.username);
            } else {
                localStorage.removeItem(KEY_REMEMBER_USER);
            }

            // P3-3: 移除"记住密码"功能（2026-08-08，规则5：每次手动输密码）
            // 清除历史遗留的记住密码，强制用户每次手动输入
            localStorage.removeItem('auth:savedPassword');
            const rememberPassword = document.getElementById('rememberPassword');
            if (rememberPassword) {
                rememberPassword.checked = false;
                rememberPassword.disabled = true;
                rememberPassword.title = '安全升级：为保护账户安全，不再支持记住密码';
            }

            if (window.electronAPI && window.electronAPI.loginSuccess) {
                await window.electronAPI.loginSuccess(userData);
            }
        } catch (e) {
            console.error('[login] handleLogin 异常:', e);
            showError('登录异常：' + (e && e.message ? e.message : '未知错误'));
        } finally {
            _loginInFlight = false;
            setLoginLoading(false);
        }
    }

    function handleCancel() {
        if (window.electronAPI && window.electronAPI.quitApp) {
            window.electronAPI.quitApp();
        }
    }

    // ★ 启动时主动清理 localStorage 中的历史遗留用户（doctor1/doctor2/张医生/李医生）
    function cleanLegacyUsers() {
        try {
            const saved = localStorage.getItem(KEY_USERS);
            if (saved) {
                const decrypted = simpleDecrypt(saved);
                const users = safeParse(decrypted, []);
                if (Array.isArray(users) && users.length > 0) {
                    const filtered = users.filter(u => !LEGACY_USERNAMES.includes(u.username));
                    if (filtered.length !== users.length) {
                        // 保存清理后的列表（用 simpleEncrypt 加密）
                        const valid = filtered.length > 0 ? filtered : DEFAULT_USERS;
                        localStorage.setItem(KEY_USERS, simpleEncrypt(JSON.stringify(valid)));
                        console.log('[login] 已清理历史遗留用户:', users.length, '->', valid.length);
                    }
                }
            }
        } catch(e) { console.warn('[login] cleanLegacyUsers error:', e); }
        // 清理指向 doctor1/doctor2 的 rememberedUsername
        try {
            const remembered = localStorage.getItem(KEY_REMEMBER_USER);
            if (remembered && LEGACY_USERNAMES.includes(remembered)) {
                localStorage.removeItem(KEY_REMEMBER_USER);
                console.log('[login] 已清理历史遗留 rememberedUsername:', remembered);
            }
        } catch(e) {}
    }

    document.addEventListener('DOMContentLoaded', async () => {
        const config = await getAppConfig();
        // ★ 主动清理历史遗留用户（在渲染登录界面之前）
        cleanLegacyUsers();
        loadClinicName(config);
        initLoginInput(config);
        initLoginPermissions();
        // P3-3: 安全升级（2026-08-08）：移除记住密码功能，规则5强制每次手动输密码
        localStorage.removeItem('auth:savedPassword');
        $('loginPassword').value = '';
        const rememberPassword = document.getElementById('rememberPassword');
        if (rememberPassword) {
            rememberPassword.checked = false;
            rememberPassword.disabled = true;
            rememberPassword.title = '安全升级：为保护账户安全，不再支持记住密码';
        }
        $('btnOk').addEventListener('click', handleLogin);
        $('btnCancel').addEventListener('click', handleCancel);
        $('loginPassword').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') handleLogin();
        });

        // 显示试用期状态
        showTrialStatus();

        // ★ bnzc:// 一键激活：检查是否有待激活数据
        await checkBnzcPendingActivation(config);

        // ★ bnzc:// 运行时监听（macOS open-url 或软件运行时收到链接）
        if (window.electronAPI && window.electronAPI.onBnzcPendingActivation) {
            window.electronAPI.onBnzcPendingActivation(async (data) => {
                console.log('[Bnzc] 收到运行时激活链接:', data.code);
                await performAutoActivation(data, config);
            });
        }

        // 首次启动检测：诊所名为默认值时弹出配置向导
        checkFirstRun(config);
    });

    // ===== bnzc:// 一键激活 =====
    async function checkBnzcPendingActivation(config) {
        try {
            if (!window.electronAPI || !window.electronAPI.bnzcGetPendingActivation) return;
            const result = await window.electronAPI.bnzcGetPendingActivation();
            if (result && result.success && result.data && result.data.code) {
                console.log('[Bnzc] 检测到待激活数据:', result.data.code);
                window.__bnzcHasPending = true;
                await performAutoActivation(result.data, config);
            }
        } catch (e) {
            console.warn('[Bnzc] 检查待激活数据失败:', e);
        }
    }

    async function performAutoActivation(data, config) {
        if (!data || !data.code) return;

        // ★ 隐藏首次配置向导，避免干扰
        const wizardOverlay = document.getElementById('wizardOverlay');
        if (wizardOverlay) wizardOverlay.classList.remove('show');
        const hint = document.getElementById('clinicSetupHint');
        if (hint) hint.style.display = 'none';

        // 显示激活进度提示
        const bar = document.getElementById('trialBar');
        if (bar) {
            bar.className = 'trial-bar';
            bar.innerHTML = '<span class="trial-text">🔄 正在通过激活链接自动激活...</span>';
            bar.style.display = 'flex';
        }

        try {
            const result = await window.electronAPI.bnzcAutoActivate({
                code: data.code,
                clinicName: data.clinicName || '',
                user: data.user || ''
            });

            if (result && result.success) {
                // 激活成功
                const typeInfo = result.licenseInfo ?
                    (result.licenseInfo.type === 'pro' ? '机构版' :
                     result.licenseInfo.type === 'personal' ? '标准版' : '已授权') : '已授权';
                const deviceMsg = result.deviceInfo ?
                    `\n（已绑定 ${result.deviceInfo.devicesCount}/${result.deviceInfo.maxDevices} 台设备）` : '';

                alert('✅ 激活成功！\n\n' +
                    '激活码：' + data.code + '\n' +
                    '版本：' + typeInfo + '\n' +
                    (data.clinicName ? '诊所：' + data.clinicName + '\n' : '') +
                    (result.licenseInfo && result.licenseInfo.expiresAt ?
                        '到期：' + result.licenseInfo.expiresAt.split('T')[0] + '\n' : '') +
                    deviceMsg +
                    '\n\n软件即将自动重启...');

                // 清除 pending 数据
                if (window.electronAPI.bnzcClearPendingActivation) {
                    window.electronAPI.bnzcClearPendingActivation();
                }

                // ★ 激活成功后完成首次向导
                try {
                    localStorage.setItem('firstRunWizardDone', '1');
                } catch(e) {}

                // 延迟 2 秒后重启
                setTimeout(() => {
                    if (window.electronAPI.license && window.electronAPI.license.restart) {
                        window.electronAPI.license.restart();
                    }
                }, 2000);
            } else {
                // 激活失败
                const errorMsg = (result && result.error) || '激活失败，请检查激活码是否正确';
                if (bar) {
                    bar.className = 'trial-bar expired';
                    bar.innerHTML = '<span class="trial-text">❌ 自动激活失败：' + errorMsg + '</span>' +
                        '<a class="trial-action" onclick="openActivationWindow()">手动激活 →</a>';
                }
                alert('❌ 自动激活失败：\n\n' + errorMsg + '\n\n请点击"手动激活"输入激活码，或联系客服协助。');

                // 清除失败的 pending 数据
                if (window.electronAPI.bnzcClearPendingActivation) {
                    window.electronAPI.bnzcClearPendingActivation();
                }

                // ★ 失败后恢复首次向导（让用户可以手动配置诊所信息）
                window.__bnzcHasPending = false;
                checkFirstRun(config);
            }
        } catch (e) {
            console.error('[Bnzc] auto-activate 异常:', e);
            if (bar) {
                bar.className = 'trial-bar expired';
                bar.innerHTML = '<span class="trial-text">❌ 自动激活异常</span>' +
                    '<a class="trial-action" onclick="openActivationWindow()">手动激活 →</a>';
            }

            // ★ 异常后恢复首次向导
            window.__bnzcHasPending = false;
            checkFirstRun(config);
        }
    }

    // ===== 试用期状态显示 =====
    async function showTrialStatus() {
        const bar = document.getElementById('trialBar');
        if (!bar) return;
        try {
            const status = await window.electronAPI.invoke('license:get-status');
            if (!status || !status.success) return;
            if (status.type === 'trial') {
                const days = status.remainingDays || 0;
                bar.className = 'trial-bar trial';
                bar.innerHTML = '<span class="trial-text">⏳ 试用期剩余 <b>' + days + '</b> 天</span>' +
                    '<a class="trial-action" onclick="openActivationWindow()">立即激活 →</a>';
                bar.style.display = 'flex';
            } else if (status.valid && status.type !== 'trial') {
                const typeNames = { personal: '标准版', pro: '机构版', permanent: '永久授权' };
                const typeName = typeNames[status.type] || '已授权';
                bar.className = 'trial-bar active';
                bar.innerHTML = '<span class="trial-text">✅ ' + typeName + ' 已激活' +
                    (status.expiresAt ? '（到期：' + status.expiresAt.split('T')[0] + '）' : '') + '</span>';
                bar.style.display = 'flex';
            } else if (!status.valid) {
                bar.className = 'trial-bar expired';
                bar.innerHTML = '<span class="trial-text">❌ 授权已过期</span>' +
                    '<a class="trial-action" onclick="openActivationWindow()">重新激活 →</a>';
                bar.style.display = 'flex';
            }
        } catch (e) { /* 无 license API 时静默跳过 */ }
    }

    // ===== 激活窗口 =====
    function openActivationWindow() {
        if (window.electronAPI && window.electronAPI.showActivationWindow) {
            window.electronAPI.showActivationWindow();
        } else if (window.electronAPI && window.electronAPI.license && window.electronAPI.license.show) {
            window.electronAPI.license.show();
        } else {
            alert('请在软件主菜单中选择「帮助 → 激活授权」打开激活窗口');
        }
    }

    // ===== 首次启动检测与向导 =====
    function checkFirstRun(config) {
        const DEFAULT_CLINIC_NAMES = ['本能堂中医诊所', '惠康中医诊所', '默认诊所'];
        const currentName = (config && config.clinicName) || '';
        const isDefault = !currentName || DEFAULT_CLINIC_NAMES.some(n => currentName === n);

        // ★ 如果有 bnzc:// 待激活数据，跳过首次向导（自动激活优先）
        if (window.__bnzcHasPending) {
            console.log('[Bnzc] 有待激活数据，跳过首次向导');
            return;
        }

        const wizardDone = localStorage.getItem('firstRunWizardDone');
        const hasAdmin = hasAdminUser(config);
        
        // ★ 云端标准版：没有管理员用户时必须注册
        if (!hasAdmin && !wizardDone) {
            document.getElementById('clinicSetupHint').textContent = '⚙️ 首次使用，点击注册管理员账户';
            document.getElementById('clinicSetupHint').style.display = 'block';
            setTimeout(() => openFirstRunWizard(), 800);
            return;
        }
        
        // 仅当使用默认诊所名且未完成过向导时显示
        if (isDefault && !wizardDone) {
            document.getElementById('clinicSetupHint').style.display = 'block';
            setTimeout(() => openFirstRunWizard(), 800);
        }
    }

    // ===== 首次配置向导 =====
    let _wizardStep = 1;
    const WIZARD_TOTAL = 3;

    function openFirstRunWizard() {
        _wizardStep = 1;
        renderWizard();
        document.getElementById('wizardOverlay').classList.add('show');
    }

    function closeFirstRunWizard() {
        document.getElementById('wizardOverlay').classList.remove('show');
    }

    function renderWizard() {
        // 更新步骤显示
        document.querySelectorAll('.wizard-step').forEach(s => s.classList.remove('active'));
        const stepEl = document.querySelector('.wizard-step[data-step="' + _wizardStep + '"]');
        if (stepEl) stepEl.classList.add('active');

        // 更新进度点
        const progress = document.getElementById('wizardProgress');
        progress.innerHTML = '';
        for (let i = 1; i <= WIZARD_TOTAL; i++) {
            const dot = document.createElement('div');
            dot.className = 'dot' + (i < _wizardStep ? ' done' : (i === _wizardStep ? ' active' : ''));
            progress.appendChild(dot);
        }

        // 导航按钮
        document.getElementById('wizardPrevBtn').style.display = _wizardStep > 1 ? '' : 'none';
        const nextBtn = document.getElementById('wizardNextBtn');
        nextBtn.textContent = _wizardStep === WIZARD_TOTAL ? '完成设置' : '下一步';
        document.getElementById('wizardSkipBtn').style.display = _wizardStep < WIZARD_TOTAL ? '' : 'none';
    }

    function wizardNext() {
        if (_wizardStep === 1) {
            const name = document.getElementById('wizardClinicName').value.trim();
            if (!name) { alert('请输入诊所名称'); return; }
            if (name.length < 2 || name.length > 50) { alert('诊所名称长度需在 2-50 个字符之间'); return; }
        } else if (_wizardStep === 2) {
            const username = document.getElementById('wizardUsername').value.trim();
            if (!username) { alert('请设置管理员用户名'); return; }
            if (!ADMIN_USERNAME_REGEX.test(username)) { 
                alert('用户名需为4-20位，以字母开头，只含字母、数字或下划线'); 
                return; 
            }
            const pwd = document.getElementById('wizardPassword').value;
            const pwd2 = document.getElementById('wizardPassword2').value;
            if (!pwd || pwd.length < 8) { alert('密码至少8位'); return; }
            if (!/[a-zA-Z]/.test(pwd) || !/[0-9]/.test(pwd)) { alert('密码必须同时包含字母和数字'); return; }
            if (pwd !== pwd2) { alert('两次输入的密码不一致'); return; }
        }

        if (_wizardStep < WIZARD_TOTAL) {
            _wizardStep++;
            renderWizard();
        } else {
            finishWizard();
        }
    }

    function wizardPrev() {
        if (_wizardStep > 1) { _wizardStep--; renderWizard(); }
    }

    function wizardSkip() {
        if (confirm('跳过设置？您可在登录后"基础设置"中随时修改。')) {
            localStorage.setItem('firstRunWizardDone', 'skipped');
            closeFirstRunWizard();
        }
    }

    async function finishWizard() {
        const clinicName = document.getElementById('wizardClinicName').value.trim();
        const username = document.getElementById('wizardUsername').value.trim();
        const newPassword = document.getElementById('wizardPassword').value;
        const doctorName = document.getElementById('wizardDoctorName').value.trim();
        const title = document.getElementById('wizardTitle').value.trim();

        // 保存诊所名到 config
        if (clinicName && window.electronAPI) {
            try {
                await window.electronAPI.updateConfig({
                    clinicName: clinicName,
                    doctorName: doctorName || '管理员',
                    title: title || ''
                });
            } catch (e) { console.warn('[Wizard] updateConfig failed:', e); }
        }

        // ★ 注册管理员账户（云端标准版：通过注册创建管理员账户）
        if (username && newPassword && window.electronAPI) {
            try {
                const result = await window.electronAPI.addUser({
                    username: username,
                    password: newPassword,
                    name: doctorName || '管理员',
                    role: 'admin'
                });
                if (result && result.success) {
                    alert('✅ 注册完成！\n\n🏥 诊所：' + clinicName + '\n👤 用户名：' + username + '\n👤 姓名：' + (doctorName || '管理员') + '\n🔑 管理员账户已创建\n\n请使用用户名和密码登录');
                } else {
                    alert('⚠️ 诊所信息已保存，但账户注册失败：' + (result.error || '请登录后在设置中创建账户'));
                }
            } catch (e) {
                alert('⚠️ 诊所信息已保存，请重新启动软件后在登录界面输入账户信息');
            }
        } else {
            alert('✅ 诊所名称已设置，请在登录界面输入注册的账户信息登录');
        }

        // 更新登录页显示
        if (clinicName) {
            document.getElementById('clinicName').textContent = clinicName;
            localStorage.setItem(KEY_CLINIC_NAME, clinicName);
        }
        document.getElementById('clinicSetupHint').style.display = 'none';
        localStorage.setItem('firstRunWizardDone', '1');
        closeFirstRunWizard();
    }

    function checkWizardPassword() {
        const pwd = document.getElementById('wizardPassword').value;
        const indicator = document.getElementById('wizardPwdStrength');
        if (!pwd) { indicator.className = 'password-strength'; indicator.innerHTML = ''; return; }
        let score = 0;
        if (pwd.length >= 8) score++;
        if (pwd.length >= 12) score++;
        if (/[a-z]/.test(pwd)) score++;
        if (/[A-Z]/.test(pwd)) score++;
        if (/[0-9]/.test(pwd)) score++;
        if (/[^a-zA-Z0-9]/.test(pwd)) score++;
        const colors = ['#e74c3c', '#e67e22', '#f39c12', '#f1c40f', '#27ae60', '#2ecc71'];
        const labels = ['太弱', '弱', '一般', '中等', '强', '非常强'];
        const color = colors[Math.min(score, colors.length - 1)];
        const label = labels[Math.min(score, labels.length - 1)];
        indicator.className = 'password-strength show';
        indicator.style.background = color + '22';
        indicator.style.color = color;
        indicator.style.border = '1px solid ' + color + '55';
        indicator.innerHTML = '强度：<b>' + label + '</b>' + (score < 3 ? '（需≥8位+字母+数字）' : '');
    }

    // ★ 将 HTML onclick 内联事件引用的函数暴露到全局作用域
    // login.js 使用 IIFE 包装，内部函数默认无法被 HTML onclick 访问
    window.openFirstRunWizard = openFirstRunWizard;
    window.openActivationWindow = openActivationWindow;
    window.wizardPrev = wizardPrev;
    window.wizardSkip = wizardSkip;
    window.wizardNext = wizardNext;
    window.checkWizardPassword = checkWizardPassword;
})();
