// ============================================================================
// edition-lock.js —— edition 状态归一化锁（Single-Truth-Source）
// 架构目的：彻底杜绝 CONFIG.edition / window.EDITION / Permission._edition
//   三处状态分道扬镳造成的"版本标签显示机构版但按钮按标准版"（2.18节）。
//   对 CONFIG 对象进行 Object.defineProperty(getter/setter) 拦截：
//   · getter 永远返回 userData 权威值（经 electronAPI.getAppConfig 最新回写的 CONFIG.__authoritativeEdition 缓存）
//   · setter 自动三写同步：同时写 CONFIG 存储槽 + window.EDITION + Permission._edition
//   · 任何代码读取 edition 值永远同源，再无"某一处更新后另一处还是旧值"。
// ============================================================================
(function (global) {
    'use strict';

    // ── CONFIG 对象可能在 HTML 内嵌 <script> 中已定义（const 不影响属性拦截）──
    function tryInstallLock() {
        if (typeof CONFIG === 'undefined') return false;
        if (CONFIG.__editionLocked) return true; // 已安装

        var _slot = CONFIG.edition || '';

        // 重新定义 CONFIG.edition 属性（CONFIG 是 const 变量，但其属性描述符可以改）
        try {
            Object.defineProperty(CONFIG, 'edition', {
                configurable: true,
                enumerable: true,
                get: function () {
                    // 1. 优先返回权威插槽（由 electronAPI.getAppConfig 回写 __authoritativeEdition 激活）
                    try { if (CONFIG.__authoritativeEdition) return String(CONFIG.__authoritativeEdition); } catch(_) {}
                    // 2. 否则回落到存储槽
                    return String(_slot || '');
                },
                set: function (v) {
                    var val = String(v || '').trim();
                    _slot = val;
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
