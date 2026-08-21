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

    // 云端机构版：管理员账户通过注册产生，首次启动无默认用户
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

    // 获取用户列表：合并 config.json（主要）+ localStorage（补充），以 username 去重
    function getUsers(config) {
        const cfg = getUsersFromConfig(config);
        const stored = getUsersFromStorage();
        const merged = new Map();
        // 优先添加 config.json 中的用户（注册/激活产生的）
        cfg.forEach(u => {
            if (u.username) merged.set(u.username, u);
        });
        // 补充 localStorage 中的用户（以 config 为准，不覆盖）
        stored.forEach(u => {
            if (u.username && !merged.has(u.username)) {
                merged.set(u.username, u);
            }
        });
        const result = Array.from(merged.values());
        if (result.length > 0) {
            return result.map(u => ({ ...u, displayName: u.name || u.username }));
        }
        return DEFAULT_USERS.map(normalizeUser).map(u => ({ ...u, displayName: u.name || u.username }));
    }

    function loadClinicName(config) {
        const name = localStorage.getItem(KEY_CLINIC_NAME) || config.clinicName;
        $('clinicName').textContent = name;
    }

    // ★ 2026-08-19 登录前保持「登录后显示版本」待登录提示，登录成功后置 _loggedIn 再刷新真实版本
    // ★ 铁闸4（2026-08-21）：启动画面自证真伪三元组 = Vx.x.xx | Build 时间戳 | Arch 2.xx
    //   build-meta.json 由构建阶段 tools/write-build-meta.cjs 写入，嵌入 asar 内。
    //   用户登录前就能看到真实版本/构建时间/Arch水印，装了假包一眼就能识破（三元组对不上）。
    let _loggedIn = false;
    let _configForTag = null;
    let _buildMeta = null;

    function loadBuildMeta() {
        // file://asar 内直接 fetch 相对路径即可（asarmor 不拦截同域 get 请求）
        try {
            fetch('./build-meta.json', { cache: 'no-store' })
                .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
                .then(function (m) {
                    _buildMeta = m;
                    // 立刻刷新一次标签（即使未登录也显示三元组在"登录后显示版本"位置）
                    try { applyEditionTag(_configForTag, true); } catch (_) {}
                })
                .catch(function (e) {
                    console.warn('[login] build-meta.json 缺失（可能是非构建环境/开发模式）：', e && e.message);
                });
        } catch (e) { /* fetch 未定义（理论不会） */ }
    }

    function applyEditionTag(config, forceShow) {
        var tag = document.querySelector('.version-tag');
        if (!tag) return;
        _configForTag = config || _configForTag;

        // ★ 铁闸4：有 buildMeta 时，登录前也显示"待登录提示+三元组"（自证真伪）
        var metaHtml = '';
        if (_buildMeta) {
            metaHtml = '<br><span style="font-size:10px;color:#888;font-weight:normal;">' +
                       'V' + _buildMeta.version + ' · Build ' +
                       (_buildMeta.buildTimeLocal || '') + ' · ' +
                       (_buildMeta.archMarker || '') +
                       '</span>';
        }

        if (!_loggedIn && !forceShow) {
            // 登录前保持骨架提示，但附加三元组（装了假包 → 用户立刻看出 Arch 版本对不上）
            tag.innerHTML = '【登录后显示版本】' + metaHtml;
            return;
        }
        // ★ 云端产品版本标签必须带"云端"前缀：优先取配置 versionLabel，缺失则按 edition 推断
        var vl = (_configForTag && _configForTag.versionLabel) ? String(_configForTag.versionLabel) : '';
        if (vl && vl.indexOf('云端') >= 0) {
            tag.innerHTML = '【' + vl + '】' + metaHtml;
            return;
        }
        var e = (_configForTag && _configForTag.edition) || '';
        var inst = ['clinic_custom', 'cloud', 'clinic', 'cloud_clinic', 'offline_clinic', 'institution'].indexOf(e) >= 0;
        tag.innerHTML = '【' + (inst ? '云端机构版' : '云端标准版') + '】' + metaHtml;
    }

    let _users = [];

    function initLoginInput(config) {
        const input = $('loginUsername');
        const users = getUsers(config);
        _users = users;
        
        // ★ 云端机构版：预填上次用户名（手机号），显示绿色提示
        let usernameToFill = null;
        const rememberedUser = localStorage.getItem(KEY_REMEMBER_USER);
        if (rememberedUser && !LEGACY_USERNAMES.includes(rememberedUser)) {
            usernameToFill = rememberedUser;
        } else if (users.length === 1 && users[0].username) {
            // ★ 刚激活成功：只有一个管理员账户时自动预填（一键激活场景）
            usernameToFill = users[0].username;
        }
        
        if (usernameToFill) {
            input.value = usernameToFill;
            localStorage.setItem(KEY_REMEMBER_USER, usernameToFill);
            // 绿色成功反馈：提示用户账号已预填
            showGreenHint(`✓ 账号已预填：${usernameToFill}，请输入密码登录`);
            // 自动聚焦到密码框
            setTimeout(() => {
                const pwd = $('loginPassword');
                if (pwd) pwd.focus();
            }, 200);
        }
    }
    
    // ★ 绿色成功反馈（账号预填/激活成功提示）
    function showGreenHint(msg) {
        let el = document.getElementById('loginGreenHint');
        if (!el) {
            el = document.createElement('div');
            el.id = 'loginGreenHint';
            el.style.cssText = 'color:#67c23a;font-size:12px;margin:6px 0;padding:6px 10px;background:#f0f9eb;border:1px solid #e1f3d8;border-radius:6px;text-align:left;line-height:1.5;';
            // 插入到 loginError 之前或 login-buttons 之前（稳定位置）
            const errEl = $('loginError');
            if (errEl && errEl.parentElement) {
                errEl.parentElement.insertBefore(el, errEl);
            } else {
                const buttons = document.querySelector('.login-buttons');
                if (buttons && buttons.parentElement) {
                    buttons.parentElement.insertBefore(el, buttons);
                }
            }
        }
        el.textContent = msg;
        el.style.display = 'block';
    }
    
    function hideGreenHint() {
        const el = document.getElementById('loginGreenHint');
        if (el) el.style.display = 'none';
    }
    
    // 检查是否有已注册的管理员账户
    function hasAdminUser(config) {
        const users = getUsers(config);
        return users.length > 0;
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
        hideGreenHint();
        // ★ 优化：防重复提交
        if (_loginInFlight) return;
        const username = $('loginUsername').value.trim();
        const password = $('loginPassword').value;
        if (!username) { showError('请输入手机号/用户名'); return; }
        if (!password) { showError('请输入密码'); return; }

        _loginInFlight = true;
        setLoginLoading(true);
        try {
            // ★ 如果还没有任何管理员账户 → 提示重新激活（新版激活时已自动创建账户）
            if (!_users || _users.length === 0) {
                if (confirm('ℹ️ 系统检测到还没有管理员账户！\n\n请先完成软件激活，激活时填写的手机号和密码将自动创建管理员账户。\n\n是否打开激活窗口？')) {
                    openActivationWindow();
                } else {
                    showError('⚠️ 请先激活软件');
                }
                return;
            }

            // ★ 支持手机号/用户名双模式登录：先按 username 查找，再按 phone 字段查找
            let user = _users.find(u => u.username === username);
            if (!user) {
                user = _users.find(u => u.phone && String(u.phone) === username);
            }

            // ★ 云端账户兼容（权威认证）：
            //   1) 本地用户表完全找不到该账户时，必须回退云端认证；
            //   2) 本地找到但本地密码校验失败时，仍需回退云端认证兜底——
            //      云端注册的账户（如 wgj）在本地 localStorage/config 可能残留旧记录，
            //      本地缓存密码与实际不一致，仅做本地校验会误报"密码错误"。
            //   云端点认证用 AuthCore.login() 走 /users?login=true，密码以云端为准。
            let _cloudAuth = null;

            // 本地密码是否校验通过（本地无该用户时视作不通过）
            let localPwdOk = false;
            if (user) {
                const storedPwd = user.password || '';
                const isHash = /^[a-f0-9]{64}$/.test(storedPwd);
                localPwdOk = isHash ? (storedPwd === await hashPassword(password)) : (storedPwd === password);
            }

            // 本地校验通过 → 直接用本地用户（后续版本匹配/password 走本地）
            if (!localPwdOk) {
                // 本地失败 → 尝试云端认证兜底
                if (window.AuthCore && typeof AuthCore.login === 'function') {
                    const cloudRes = await AuthCore.login(username, password);
                    if (cloudRes && cloudRes.success && cloudRes.user) {
                        _cloudAuth = cloudRes.user; // 含云端返回的 token
                        // 用云端用户填充本地匹配结果（后续版本匹配/password字段判断走云端）
                        user = {
                            username: _cloudAuth.username,
                            name: _cloudAuth.name || _cloudAuth.username,
                            role: _cloudAuth.role || 'user',
                            password: _cloudAuth.password || '',
                            token: _cloudAuth.token || ''
                        };
                    } else {
                        // ★ 诊断：记录云端认证返回的具体错误，供排查
                        const dbgErr = cloudRes && cloudRes.error ? String(cloudRes.error) : '未知错误';
                        console.error('[login] 云端认证失败:', dbgErr);
                        // 将真实错误写入 userData（save-user-data IPC）
                        try {
                            if (window.electronAPI && typeof window.electronAPI.saveUserData === 'function') {
                                await window.electronAPI.saveUserData('login_debug', JSON.stringify({ time: Date.now(), error: dbgErr, ok: false }));
                            }
                        } catch(e) { console.warn('[login] 写入诊断日志失败:', e); }
                    }
                }
                // 本地未放行 且 云端认证也失败（密码错误/网络异常/账户不存在）
                if (!_cloudAuth) {
                    // ★ 诊断增强：显示具体失败原因，便于定位（不隐藏真实错误）
                    let detailErr = '';
                    try {
                        const ret = await window.electronAPI.getUserData('login_debug');
                        if (ret && ret.success && ret.data) {
                            const dd = ret.data;
                            detailErr = dd.error ? String(dd.error) : '';
                        }
                    } catch(e) {}
                    const msg = detailErr ? ('登录失败：' + detailErr) : '手机号/用户名或密码错误';
                    showError(msg);
                    return;
                }
            }

            // ★ 严格版本匹配（安全隔离）：账户版本必须与电脑激活版本一致
            try {
                const appCfg = await getAppConfig();
                const machineEdition = (appCfg && appCfg.edition) || '';
                const machineIsInstitution = ['clinic_custom', 'clinic', 'cloud_clinic', 'offline_clinic', 'cloud', 'institution'].indexOf(machineEdition) >= 0;
                // 机构版账户：本地角色 admin/机构版，或云端角色 clinic_admin/platform_admin
                const accountIsInstitution =
                    (user.role === 'admin') ||
                    (user.role === 'clinic_admin') ||
                    (user.role === 'platform_admin');
                if (machineIsInstitution !== accountIsInstitution) {
                    if (machineIsInstitution) {
                        showError('⚠️ 该账户属于【标准版】，不能登录【机构版】电脑。请使用机构版账户登录，或在标准版电脑上使用该账户。');
                    } else {
                        showError('⚠️ 该账户属于【机构版】，不能登录【标准版】电脑。请使用标准版账户登录，或在机构版电脑上使用该账户。');
                    }
                    return;
                }
            } catch (e) { console.warn('[login] 版本匹配校验失败:', e); }

            // ★ 2026-08-20 历史处方修复（桌面与云端APP/网页保持一致）：
            //   本地密码校验通过时会走本地分支，user 可能没有云端 token，
            //   导致主界 index.html 读处方时提取不到 token → 历史处方不显示。
            //   这里在写登录态前，若缺 token 则用账号+密码调云端 AuthCore.login 补拉。
            try {
                let hasToken = !!(user.token || (user.cloud_token));
                if (!hasToken && typeof window.AuthCore === 'object' && typeof AuthCore.login === 'function') {
                    const rescue = await AuthCore.login(username, password, { adapter: AuthCore.cloudAdapter });
                    if (rescue && rescue.success && rescue.user && rescue.user.token) {
                        // 用云端返回的 token 补齐，保证后续云端 API 请求(Bearer)可用
                        user.token = rescue.user.token;
                        user.cloud_token = rescue.user.token;
                        if (!user.name) user.name = rescue.user.name || '';
                        if (!user.role) user.role = rescue.user.role || 'user';
                        console.log('[login] ✅ 登录成功，已补拉云端token，历史处方将走云端API');
                    } else {
                        console.warn('[login] ⚠️ 登录成功但云端补拉token失败' + (rescue && rescue.error ? (':' + rescue.error) : ''));
                    }
                }
            } catch (e) { console.warn('[login] 云端补拉token异常（不影响登录）:', e); }

            // ★ 优化：批量并行写入 AuthCore 存储
            // 云端账户回退登录时 user.token 来自云端 /users?login=true，必须保留，
            // 供主界面 index.html 构造 Bearer header（buildAuthHeader 依赖 user.token），
            // 否则后续云端 API 请求回退 Basic auth 会 401 触发自动登出。
            const userData = {
                username: user.username,
                name: user.name,
                role: user.role || 'user',
                token: user.token || ''
            };
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

            // ★ 统一规范：始终记住最近登录的用户名（密码仍需每次手动输入）
            localStorage.setItem(KEY_REMEMBER_USER, user.username);

            // P3-3: 移除"记住密码"功能（2026-08-08，规则5：每次手动输密码）
            // 清除历史遗留的记住密码，强制用户每次手动输入
            localStorage.removeItem('auth:savedPassword');

            // ★ 同步用户列表到 localStorage（供 index.html 主界面读取）
            try {
                if (window.electronAPI && window.electronAPI.getAppConfig) {
                    const cfgResult = await window.electronAPI.getAppConfig();
                    if (cfgResult && cfgResult.success && cfgResult.config && Array.isArray(cfgResult.config.users)) {
                        const usersToSave = cfgResult.config.users.map(normalizeUser);
                        localStorage.setItem(KEY_USERS, simpleEncrypt(JSON.stringify(usersToSave)));
                    }
                }
            } catch(e) { console.warn('同步用户列表失败:', e); }

            if (window.electronAPI && window.electronAPI.loginSuccess) {
                // ★ 2026-08-19 登录成功：待登录提示 → 刷新为真实版本
                _loggedIn = true;
                applyEditionTag(_configForTag);
                // ★ 绿色成功反馈：登录成功提示
                showGreenHint(`✓ 登录成功！欢迎 ${user.name || user.username}，正在进入系统...`);
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
        _configForTag = config;
        applyEditionTag(config); // 登录前 _loggedIn=false 保持「登录后显示版本」待登录提示
        loadBuildMeta(); // ★ 铁闸4：启动画面自证真伪三元组（asar内build-meta.json）
        initLoginInput(config);
        initLoginPermissions();
        // P3-3: 安全升级（2026-08-08）：移除记住密码功能，规则5强制每次手动输密码
        localStorage.removeItem('auth:savedPassword');
        $('loginPassword').value = '';
        $('btnOk').addEventListener('click', handleLogin);
        $('btnCancel').addEventListener('click', handleCancel);
        // ★ 优化：密码框回车直接登录，用户名框回车跳密码框
        $('loginPassword').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') handleLogin();
        });
        $('loginUsername').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); $('loginPassword').focus(); }
        });
        // ★ 优化：密码框输入足够长时自动提示可登录（绿色反馈已显示，保留手动触发以保证安全）

        // 显示试用期状态
        showTrialStatus();
        // ★ 2026-08-19 激活入口收敛：按激活状态显示/隐藏登录框极简提示
        updateLoginActivateHint();
        // ★ 2026-08-19 云端桌面同步：登录框注入"管理员激活"入口
        injectAdminActivateEntry();

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

                // ★ 激活成功后不标记向导完成 - 重启后需要弹出注册向导创建管理员账户
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
    // ★ 云端版：无试用、无激活流程，跳过此函数
    async function showTrialStatus() {
        // 云端版不需要显示试用状态，直接返回
        return;
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

    // ★ 2026-08-20 注册审核制：登录框注入"注册开通"入口（云端三端一致），调用 auth-core 的 openCloudRegister
    //   手机号即账号 + 自设密码，注册即时建号，管理员审核通过后即可登录
    function injectAdminActivateEntry() {
        try {
            if (!window.openCloudRegister) return; // auth-core(cloud.js) 未提供则跳过
            // ★ 2026-08-20 注册完成后自动隐藏
            try {
                if (window.localStorage && window.localStorage.getItem('auth:activationDone') === '1') return;
            } catch (e) {}
            if (document.getElementById('activateLoginEntry')) return; // 已注入过则跳过
            const container = document.querySelector('.login-box .login-buttons');
            if (!container) return;
            const entry = document.createElement('div');
            entry.id = 'activateLoginEntry';
            entry.style.cssText = 'margin-top:12px;padding:0 4px;';
            entry.innerHTML =
                '<div style="display:flex;align-items:center;justify-content:center;gap:6px;padding:10px 0;border-radius:7px;background:linear-gradient(135deg,#26a69a 0%,#00897b 100%);color:#fff;cursor:pointer;font-size:12px;font-weight:bold;text-align:center;-webkit-tap-highlight-color:transparent;" onclick="if(window.openCloudRegister){window.openCloudRegister();}">📝 注册开通</div>';
            container.parentNode.insertBefore(entry, container.nextSibling);
            // 隐藏原有极简激活提示（避免重复入口）
            const wrap = document.getElementById('activateHintWrap');
            if (wrap) wrap.style.display = 'none';
            console.log('[login] 登录框已注入 注册开通 入口');
        } catch (e) {
            console.warn('[login] 注入 注册开通 入口失败:', e);
        }
    }

    // ★ 2026-08-19 登录框激活入口收敛：仅未激活/试用到期显示极简提示，正式激活登录框洁净
    async function updateLoginActivateHint() {
        try {
            const wrap = document.getElementById('activateHintWrap');
            if (!wrap) return;
            let show = false;
            if (window.electronAPI && window.electronAPI.license && window.electronAPI.license.getStatus) {
                const st = await window.electronAPI.license.getStatus();
                if (st && st.valid === false) show = true;
            }
            wrap.style.display = show ? 'block' : 'none';
        } catch (e) { console.warn('[login] 更新激活提示失败:', e); }
    }

    // ===== 首次启动检测与向导 =====
    // ★ 云端版：激活成功后需要通过注册向导创建本地管理员账户
    function checkFirstRun(config) {
        try {
            const wizardDone = localStorage.getItem('firstRunWizardDone');
            const noAdmin = !hasAdminUser(config);

            // ★ 无管理员用户时显示醒目提示（即使向导被跳过也提示）
            const hint = document.getElementById('clinicSetupHint');
            if (hint) {
                if (noAdmin) {
                    hint.innerHTML = '⚠️ <b style="color:#e74c3c;">尚未注册管理员账户 - 点击此处立即注册</b>';
                    hint.style.display = 'block';
                    hint.style.fontSize = '13px';
                    hint.style.marginTop = '6px';
                    hint.style.padding = '6px 10px';
                    hint.style.background = '#fff5f5';
                    hint.style.borderRadius = '4px';
                    hint.style.border = '1px solid #fecaca';
                } else {
                    hint.style.display = 'none';
                }
            }

            // 如果向导未完成 且 没有任何管理员用户 → 弹出注册向导
            if (wizardDone !== '1' && noAdmin) {
                console.log('[FirstRun] 未检测到管理员账户，弹出注册向导');
                // 延迟一点打开向导，确保DOM完全渲染
                setTimeout(() => {
                    openFirstRunWizard(config);
                }, 300);
                return;
            }
            if (hasAdminUser(config)) {
                console.log('[FirstRun] 已有管理员账户，跳过向导，使用手机号+密码登录');
                // ★ 提示用户用手机号登录
                const hint = document.getElementById('clinicSetupHint');
                if (hint) {
                    hint.innerHTML = '💡 请用激活时填写的手机号和密码登录';
                    hint.style.display = 'block';
                    hint.style.fontSize = '12px';
                    hint.style.marginTop = '4px';
                    hint.style.padding = '4px 8px';
                    hint.style.background = '#f0f7ff';
                    hint.style.borderRadius = '4px';
                    hint.style.border = '1px solid #bfdbfe';
                    hint.style.color = '#1e40af';
                    setTimeout(() => { if (hint) hint.style.display = 'none'; }, 8000);
                }
            }
        } catch (e) {
            console.warn('[FirstRun] checkFirstRun 异常:', e);
        }
    }

    // ===== 首次配置向导 =====
    let _wizardStep = 1;
    let _wizardConfig = {};
    const WIZARD_TOTAL = 3;

    function openFirstRunWizard(config) {
        _wizardStep = 1;
        _wizardConfig = config || {};
        // 预填诊所名称和医师名（从激活时写入的config中读取）
        try {
            if (_wizardConfig) {
                const clinicInput = document.getElementById('wizardClinicName');
                const doctorInput = document.getElementById('wizardDoctorName');
                if (clinicInput && _wizardConfig.clinicName && !clinicInput.value) {
                    clinicInput.value = _wizardConfig.clinicName;
                    console.log('[Wizard] 预填诊所名:', _wizardConfig.clinicName);
                }
                if (doctorInput && _wizardConfig.doctorName && !doctorInput.value) {
                    doctorInput.value = _wizardConfig.doctorName;
                    console.log('[Wizard] 预填医师名:', _wizardConfig.doctorName);
                }
            }
            // ★ wizardUsername 输入过滤+实时提示：只允许字母/数字/下划线，强制首字符字母
            const uInput = document.getElementById('wizardUsername');
            if (uInput) {
                uInput.oninput = function() {
                    const raw = uInput.value;
                    // ① 完全匹配医师名 → 提示这是真实姓名，清空
                    if (_wizardConfig.doctorName && raw === _wizardConfig.doctorName) {
                        const hint = document.getElementById('wizardUsernameHint');
                        if (hint) {
                            hint.textContent = '💡 请输入系统登录用户名（建议英文/拼音），您的真实姓名「' + raw + '」请到第3步"管理员/医师真实姓名"处填写';
                            hint.style.display = 'block';
                        }
                    }
                    // ② 正则过滤：只保留字母/数字/下划线；如首字符非字母则截断
                    let filtered = raw.replace(/[^a-zA-Z0-9_]/g, '');
                    if (filtered.length > 0 && !/^[a-zA-Z]/.test(filtered)) {
                        const hint = document.getElementById('wizardUsernameHint');
                        if (hint) {
                            hint.textContent = '⚠️ 用户名必须以英文字母开头（数字/中文/符号已自动清除）';
                            hint.style.display = 'block';
                        }
                        filtered = filtered.replace(/^[^a-zA-Z]+/, '');
                    }
                    // ③ 长度实时提示
                    const hint = document.getElementById('wizardUsernameHint');
                    if (hint && (!_wizardConfig.doctorName || raw !== _wizardConfig.doctorName)) {
                        if (filtered.length > 0 && filtered.length < 4) {
                            hint.textContent = 'ℹ️ 还差 ' + (4 - filtered.length) + ' 位，用户名最少需 4 个字符（建议: wangguijie / wgjie / admin_wgj）';
                            hint.style.display = 'block';
                        } else if (filtered.length > 20) {
                            hint.textContent = '⚠️ 已超出 20 位限制（当前 ' + filtered.length + ' 位）';
                            hint.style.display = 'block';
                        } else if (ADMIN_USERNAME_REGEX.test(filtered)) {
                            hint.style.display = 'none';
                        } else if (filtered.length === 0) {
                            hint.style.display = 'none';
                        }
                    }
                    if (filtered.length > 20) filtered = filtered.substring(0, 20);
                    if (filtered !== raw) {
                        uInput.value = filtered;
                    }
                    // ④ 实时校验步骤2，控制下一步按钮
                    validateWizardStep2();
                };
                uInput.onfocus = function() {
                    const val = (uInput.value || '').trim();
                    if (val && /[\u4e00-\u9fa5]/.test(val)) {
                        uInput.value = '';
                        const hint = document.getElementById('wizardUsernameHint');
                        if (hint) {
                            hint.textContent = '💡 已清除自动填充的中文，请输入英文/拼音用户名';
                            hint.style.display = 'block';
                        }
                    }
                    validateWizardStep2();
                };
            }
            // ★ 给确认密码框绑定 oninput，实时校验步骤2
            const pwd2Input = document.getElementById('wizardPassword2');
            if (pwd2Input) {
                pwd2Input.oninput = function() { validateWizardStep2(); };
            }
        } catch(e) { console.warn('[Wizard] 预填信息失败:', e); }
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

        // 焦点设置：进入某步骤时自动定位到第一个输入框
        setTimeout(() => {
            try {
                if (_wizardStep === 1) {
                    const i = document.getElementById('wizardClinicName');
                    if (i) i.focus();
                } else if (_wizardStep === 2) {
                    const i = document.getElementById('wizardUsername');
                    if (i) i.focus();
                    validateWizardStep2(); // 初始化按钮状态
                } else if (_wizardStep === 3) {
                    const i = document.getElementById('wizardDoctorName');
                    if (i) i.focus();
                }
            } catch(e) {}
        }, 50);
    }

    function wizardNext() {
        if (_wizardStep === 1) {
            const name = document.getElementById('wizardClinicName').value.trim();
            if (!name) { alert('请输入诊所名称'); return; }
            if (name.length < 2 || name.length > 50) { alert('诊所名称长度需在 2-50 个字符之间'); return; }
        } else if (_wizardStep === 2) {
            // 改用 validateWizardStep2 返回（内联提示 + 按钮禁用已生效）
            const valid = validateWizardStep2(true);
            if (!valid) return;
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

        // ★ 注册管理员账户（云端机构版：通过注册创建管理员账户）
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
                    // ★ 修复：注册成功后清除 config 缓存并重新加载用户列表
                    // 根因：addUser 只保存到 config.json，但 _users 列表未更新，导致登录时找不到新注册的用户
                    appConfigCache = null;
                    try {
                        const freshConfig = await getAppConfig();
                        initLoginInput(freshConfig);
                        console.log('[Wizard] 用户列表已重新加载');
                    } catch (e) { console.warn('[Wizard] 重新加载用户列表失败:', e); }
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

    // ★ 注册向导步骤2统一校验：用户名/密码/确认密码
    // 返回 true=全部合法 false=存在问题；showInHint=true 时把错误写进 wizardUsernameHint
    function validateWizardStep2(showInHint) {
        const nextBtn = document.getElementById('wizardNextBtn');
        const username = document.getElementById('wizardUsername').value.trim();
        const pwd = document.getElementById('wizardPassword').value;
        const pwd2 = document.getElementById('wizardPassword2').value;
        const hint = document.getElementById('wizardUsernameHint');
        let valid = true;
        let msg = '';

        if (!ADMIN_USERNAME_REGEX.test(username)) {
            valid = false;
            if (username.length < 4) {
                msg = 'ℹ️ 用户名至少 4 位（当前 ' + username.length + ' 位），建议: wgjie / wangguijie / admin_wgj';
            } else if (username.length > 20) {
                msg = '⚠️ 用户名最多 20 位（当前 ' + username.length + ' 位）';
            } else if (!/^[a-zA-Z]/.test(username)) {
                msg = '⚠️ 用户名必须以英文字母开头';
            } else {
                msg = '⚠️ 用户名只能包含字母、数字或下划线';
            }
        } else if (!pwd || pwd.length < 8) {
            valid = false;
            msg = 'ℹ️ 密码至少 8 位（当前 ' + (pwd ? pwd.length : 0) + ' 位）';
        } else if (!/[a-zA-Z]/.test(pwd) || !/[0-9]/.test(pwd)) {
            valid = false;
            msg = 'ℹ️ 密码必须同时包含字母和数字';
        } else if (pwd !== pwd2) {
            valid = false;
            msg = '⚠️ 两次输入的密码不一致';
        }

        if (nextBtn) {
            if (valid) {
                nextBtn.disabled = false;
                nextBtn.style.opacity = '1';
                nextBtn.style.cursor = 'pointer';
            } else {
                nextBtn.disabled = true;
                nextBtn.style.opacity = '0.45';
                nextBtn.style.cursor = 'not-allowed';
            }
        }
        if (hint && showInHint && !valid) {
            hint.textContent = msg;
            hint.style.display = 'block';
        }
        return valid;
    }

    function checkWizardPassword() {
        const pwd = document.getElementById('wizardPassword').value;
        const indicator = document.getElementById('wizardPwdStrength');
        if (!pwd) { indicator.className = 'password-strength'; indicator.innerHTML = ''; validateWizardStep2(); return; }
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
        validateWizardStep2();
    }

    // ★ 密码显示/隐藏切换（统一登录框规范）
    window.togglePasswordVisibility = function() {
        const pwdInput = document.getElementById('loginPassword');
        const toggleBtn = document.querySelector('.password-toggle-btn');
        if (!pwdInput) return;
        if (pwdInput.type === 'password') {
            pwdInput.type = 'text';
            if (toggleBtn) { toggleBtn.textContent = '🙈'; toggleBtn.classList.add('visible'); }
        } else {
            pwdInput.type = 'password';
            if (toggleBtn) { toggleBtn.textContent = '👁️'; toggleBtn.classList.remove('visible'); }
        }
    };

    // ★ 将 HTML onclick 内联事件引用的函数暴露到全局作用域
    // login.js 使用 IIFE 包装，内部函数默认无法被 HTML onclick 访问
    window.openFirstRunWizard = openFirstRunWizard;
    window.openActivationWindow = openActivationWindow;
    window.wizardPrev = wizardPrev;
    window.wizardSkip = wizardSkip;
    window.wizardNext = wizardNext;
    window.checkWizardPassword = checkWizardPassword;
})();
