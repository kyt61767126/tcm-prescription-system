// ============================================================================
// edition-lock.js —— edition 状态归一化锁（Single-Truth-Source）
// 架构目的：彻底杜绝 CONFIG.edition / window.EDITION / Permission._edition
//   三处状态分道扬镳造成的"版本标签显示机构版但按钮按标准版"（2.18节）。
//   对 CONFIG 对象进行 Object.defineProperty(getter/setter) 拦截：
//   · getter 永远返回 userData 权威值（经 electronAPI.getAppConfig 最新回写的 CONFIG.__authoritativeEdition 缓存）
//   · setter 自动三写同步：同时写 CONFIG 存储槽 + window.EDITION + Permission._edition
//   · 任何代码读取 edition 值永远同源，再无"某一处更新后另一处还是旧值"。
//
//  ★ 铁闸3（2026-08-21）：edition 写入端归一化双保险
//     真根因：激活/版本切换流程到处写 institution/standard/中文标签 等别名，
//     Permission 读取端要做一万种兼容还会漏。
//     根治：CONFIG.edition setter 在写入前先 __normalizeEdition 归一化到规范 key，
//     三写同步全是规范 key，config.json 落地文件也是规范 key。
//     同时 get 端再加一次 __normalizeEdition 兜底（防止绕过 setter 直写 __authoritativeEdition）。
// ============================================================================
(function (global) {
    'use strict';

    // ── 与 shared/permission.js 保持一致的归一化函数（两处硬编码，故意冗余） ──
    //   不 require/import，兼容 <script> 直接加载；与 Permission 实现逐行同步修改
    function __normalizeEdition(e) {
        var s = String(e || '').trim();
        if (!s) return s;
        var x = s.toLowerCase();
        if (x === 'institution' || x === 'institutional' || x === 'jigou') return 'cloud_clinic';
        if (x === 'standard') return 'personal';
        if (x === 'yj') return 'cloud_clinic';
        if (x === 'yb') return 'cloud_personal';
        if (x === 'lj') return 'offline_clinic';
        if (x === 'lb') return 'offline_personal';
        if (x.indexOf('云端机构') >= 0) return 'cloud_clinic';
        if (x.indexOf('云端标准') >= 0) return 'cloud_personal';
        if (x.indexOf('离线机构') >= 0) return 'offline_clinic';
        if (x.indexOf('离线标准') >= 0) return 'offline_personal';
        if (x.indexOf('机构版') >= 0) return 'clinic';
        if (x.indexOf('标准版') >= 0) return 'personal';
        return s;
    }
    global.__normalizeEdition = __normalizeEdition;

    // ── CONFIG 对象可能在 HTML 内嵌 <script> 中已定义（const 不影响属性拦截）──
    function tryInstallLock() {
        if (typeof CONFIG === 'undefined') return false;
        if (CONFIG.__editionLocked) return true; // 已安装

        var _slot = CONFIG.edition || '';
        // 安装锁的同时立即归一化现有槽值（否则旧 config.json 中的 institution 不会被纠正）
        _slot = __normalizeEdition(_slot);

        // 重新定义 CONFIG.edition 属性（CONFIG 是 const 变量，但其属性描述符可以改）
        try {
            Object.defineProperty(CONFIG, 'edition', {
                configurable: true,
                enumerable: true,
                get: function () {
                    var v = '';
                    // 1. 优先返回权威插槽（由 electronAPI.getAppConfig 回写 __authoritativeEdition 激活）
                    try { if (CONFIG.__authoritativeEdition) v = String(CONFIG.__authoritativeEdition); } catch(_) {}
                    // ★ 2026-09-01 时序竞态兜底（E1 偶发超时第三轮修复）：Permission.init() 的
                    //   IPC 回调早于 index.html 内嵌 const CONFIG 声明落地时，CONFIG 处于 TDZ，
                    //   权威 edition 改暂存于 Permission 实例（permission.js 先于内嵌脚本加载，
                    //   实例必然存在）。插槽为空时由此兜底，userData 权威值不再被 asar 出厂
                    //   默认(cloud_personal)经同步XHR反向掩盖 → 机构版用户管理按钮不再消失。
                    try { if (!v && global.Permission && global.Permission._authoritativeEdition) v = String(global.Permission._authoritativeEdition); } catch(_) {}
                    // 2. 否则回落到存储槽
                    if (!v) v = String(_slot || '');
                    // ★ 铁闸3 getter 兜底：绕过 setter 直写 __authoritativeEdition 的值也要归一化
                    return __normalizeEdition(v);
                },
                set: function (v) {
                    // ★ 铁闸3 setter 归一化：任何写 CONFIG.edition 的代码都会自动写规范 key
                    var val = __normalizeEdition(String(v || '').trim());
                    _slot = val;
                    // ★ 2026-08-29 运行时写同步权威插槽：Permission.init 已把 userData 权威 edition
                    //   写入 __authoritativeEdition（getter 最优先读取）。若 setter 不同步该插槽，
                    //   登录版本切换（auth-core CONFIG.edition=targetEd）/ 启动缓存恢复等合法运行时
                    //   写入会被 init 时的快照永久掩盖（"写入无效"回退）。故每次 setter 写入同时
                    //   刷新权威插槽 = 最新写入者胜出，与 getter 优先级闭环自洽。
                    try { CONFIG.__authoritativeEdition = val; } catch(_) {}
                    // 三写同步，保持向后兼容
                    try { global.EDITION = val; } catch(_) {}
                    try { if (global.Permission) global.Permission._edition = val; } catch(_) {}
                    try { if (global.Permission && typeof global.Permission.setEdition === 'function') {} /* setEdition 里已会写三处，避免循环 */ } catch(_) {}
                    // 写成功后，再触发一次按钮对齐
                    try { if (typeof global.__applyUserButtons === 'function') global.__applyUserButtons(); } catch(_) {}
                    return true;
                }
            });
            CONFIG.__editionLocked = true;

            // 若 Permission 已存在，同步其 _edition 到 CONFIG 现在的值
            try {
                var cur = CONFIG.edition;
                if (cur && global.EDITION !== cur) global.EDITION = cur;
                if (cur && global.Permission && global.Permission._edition !== cur) global.Permission._edition = cur;
            } catch(_) {}
            return true;
        } catch (e) {
            // TypeError: Cannot redefine property（理论上不会发生，因为 CONFIG 是 object literal 默认 configurable）
            try { if (console && console.warn) console.warn('[edition-lock] 锁失败，退化为轮询同步', e.message || e); } catch(_) {}
            // 退化为 2s 轮询兜底同步（10 次后停止）
            var ticks = 0;
            var timer = setInterval(function () {
                try {
                    if (++ticks > 10) { clearInterval(timer); return; }
                    var ce = ''; try { ce = String(CONFIG.edition || ''); } catch(_) {}
                    if (ce) {
                        try { if (global.EDITION !== ce) global.EDITION = ce; } catch(_) {}
                        try { if (global.Permission && Permission._edition !== ce) global.Permission._edition = ce; } catch(_) {}
                    }
                } catch(_) {}
            }, 2000);
            return false;
        }
    }

    function activateOnReady() {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', function () { tryInstallLock(); });
        } else {
            tryInstallLock();
        }
        // load 再试一次（极端情况下 CONFIG 在 DOMContentLoaded 后才定义）
        window.addEventListener('load', function () { if (!CONFIG || !CONFIG.__editionLocked) tryInstallLock(); });
    }

    // 立即尝试；若 CONFIG 还未定义，会在 DOMContentLoaded 再试
    if (typeof CONFIG !== 'undefined') {
        tryInstallLock();
    } else {
        activateOnReady();
    }

    // 暴露 API
    global.__editionLockInstall = tryInstallLock;

})(window);
