// ============================================================================
// user-store.js —— 用户数据存取权威源（T3 · 2026-08-21）
//
// 架构目的：把散落在 7 份 index.html 中的用户数据逻辑（getDefaultUsers /
//   getUsers / saveUsers / simpleEncrypt / simpleDecrypt）收归一份权威实现。
//   此前每修一次要同步 7 份（1.2.101 事故的放大器）。
//
// 分发方式：tools/sync-shared-blocks.cjs 将本文件内容【内联】到各 index.html
//   的标记块（>>> USER-STORE ... <<< USER-STORE-END）中，并提供同名薄包装函数
//   兼容 20+ 处既有调用点（签名零变化）。copy-consistency 校验标记块哈希
//   与本文件一致，漂移即阻断构建。
//   （不用 <script src>：避免独立文件 404 / 加载顺序 / 各端 build.files 三重风险）
//
// 行为契约（与 2026-08-21 修复版逐字节等价，零行为变化）：
//   get()             永远返回数组：localStorage 密文 → 解密 → JSON → legacy 账号
//                     过滤（doctor1/doctor2，过滤后落盘）→ 旧明文兼容 → 全链兜底管理员
//   save(users)       XORv1 加密后写 localStorage（同步，绝不能是 async —— 历史上
//                     async 版曾把 '[object Promise]' 写入导致用户数据丢失）
//   getDefaultUsers() CONFIG.users（必须数组，T2 关卡已在入口净化）→ 兜底 admin
//   remove(username)  过滤删除 + 落盘（新 API，供未来调用方迁移）
// ============================================================================
(function (global) {
    'use strict';

    var PASSWORD_SALT = 'bnzc_prescription_salt_v1';

    // XORv1 轻量混淆（与 localStorage 历史格式兼容；真安全靠 AuthCore PBKDF2）
    function simpleEncrypt(text) {
        if (!text) return '';
        var key = PASSWORD_SALT;
        var result = '';
        for (var i = 0; i < text.length; i++) {
            result += String.fromCharCode(text.charCodeAt(i) ^ key.charCodeAt(i % key.length));
        }
        return 'XORv1:' + btoa(unescape(encodeURIComponent(result)));
    }
    function simpleDecrypt(stored) {
        if (!stored || typeof stored !== 'string') return stored;
        // 兼容损坏数据（如历史 '[object Promise]'）：原样返回让上层走兜底
        if (stored.indexOf('XORv1:') !== 0) return stored;
        try {
            var text = decodeURIComponent(escape(atob(stored.substring(6))));
            var key = PASSWORD_SALT;
            var result = '';
            for (var i = 0; i < text.length; i++) {
                result += String.fromCharCode(text.charCodeAt(i) ^ key.charCodeAt(i % key.length));
            }
            return result;
        } catch (e) { return stored; }
    }

    var LEGACY_USERNAMES = ['doctor1', 'doctor2'];
    var FALLBACK_ADMIN = [{
        username: 'admin',
        password: '2f1e152dfbccedc7d947d7f9d40e0790be6289309cf6904af728b3cf822c361b',
        name: '管理员',
        role: 'admin'
    }];

    function currentConfig() {
        // CONFIG 是各 index.html 的顶层 const/let（不在 window 上），typeof 裸引用安全探测
        try { if (typeof CONFIG !== 'undefined' && CONFIG) return CONFIG; } catch (_) {}
        return {};
    }

    function getDefaultUsers() {
        var cfg = currentConfig();
        // 必须是数组（T2 入口关卡已在入口净化，此处双保险：毒数据在此再拦一次）
        if (Array.isArray(cfg.users) && cfg.users.length > 0) {
            try {
                return cfg.users.map(function (u) {
                    return {
                        username: u.username,
                        password: u.password,
                        name: u.name,
                        role: u.role || 'user'
                    };
                });
            } catch (e) {
                try { console.error('[UserStore] CONFIG.users map 失败，使用兜底默认管理员:', e); } catch (_) {}
            }
        }
        return [{
            username: 'admin',
            password: '2f1e152dfbccedc7d947d7f9d40e0790be6289309cf6904af728b3cf822c361b',
            name: '管理员',
            role: 'admin'
        }];
    }

    function get() {
        var saved = null;
        try { saved = localStorage.getItem('local_systemUsers'); } catch (_) {}
        if (saved) {
            try {
                var decrypted = simpleDecrypt(saved);
                var parsed = JSON.parse(decrypted);
                // 历史遗留账号清理（doctor1/doctor2），过滤后立即落盘
                var filtered = parsed.filter(function (u) { return LEGACY_USERNAMES.indexOf(u.username) < 0; });
                if (filtered.length !== parsed.length) {
                    var result = filtered.length > 0 ? filtered : getDefaultUsers();
                    try { save(result); } catch (_) {}
                    return result;
                }
                return parsed;
            } catch (e) {
                try {
                    // 可能是未加密的旧数据（版本升级过渡）
                    var raw = JSON.parse(saved);
                    if (Array.isArray(raw)) return raw;
                } catch (e2) {
                    try { console.error('[UserStore] 解析用户列表失败:', e, e2); } catch (_) {}
                }
            }
        }
        try {
            return getDefaultUsers();
        } catch (e) {
            try { console.error('[UserStore] getDefaultUsers 抛异常，使用兜底:', e); } catch (_) {}
            return [{ username: 'admin', password: '2f1e152dfbccedc7d947d7f9d40e0790be6289309cf6904af728b3cf822c361b', name: '管理员', role: 'admin' }];
        }
    }

    function save(users) {
        // 必须同步（历史教训：async 版曾写入 '[object Promise]' 毒数据）
        try { localStorage.setItem('local_systemUsers', simpleEncrypt(JSON.stringify(users))); } catch (e) {
            try { console.error('[UserStore] save 失败:', e); } catch (_) {}
        }
    }

    function remove(username) {
        var kept = get().filter(function (u) { return u.username !== username; });
        save(kept);
        return kept;
    }

    // ★ 2026-08-22 唯一管理员模式（KNOWLEDGE 2.36）配套：识别"内置默认 admin"。
    //   判定 = 用户名 admin 且密码仍是出厂默认哈希（未改密）。
    //   改过密码的 admin 视为实际在用账户，不隐藏；云端注册的同名账户密码非默认哈希，也不隐藏。
    //   背景：renderUserList 曾直接调用未定义的 isBuiltinDefaultAdmin → ReferenceError
    //   → catch 内 alert() 在 Electron 下同步阻塞渲染进程（E2E evaluate 永久超时的根因）。
    function isBuiltinDefaultAdmin(user) {
        return !!user
            && user.username === FALLBACK_ADMIN[0].username
            && user.password === FALLBACK_ADMIN[0].password;
    }

    var UserStore = {
        PASSWORD_SALT: PASSWORD_SALT,
        LEGACY_USERNAMES: LEGACY_USERNAMES,
        simpleEncrypt: simpleEncrypt,
        simpleDecrypt: simpleDecrypt,
        getDefaultUsers: getDefaultUsers,
        get: get,
        save: save,
        remove: remove,
        isBuiltinDefaultAdmin: isBuiltinDefaultAdmin
    };

    global.UserStore = UserStore;
    return UserStore;
})(typeof window !== 'undefined' ? window : globalThis);
