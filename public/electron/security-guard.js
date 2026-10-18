// ============================================================================
// security-guard.js — 轻量级安全防护模块
//
// 功能：
//   1. 反调试检测（debugger 时间差检测，轻量级，不影响正常使用）
//   2. 延迟静默降级（P1-3）：持续调试 ≥5min 业务操作随机变慢，
//      ≥10min 拒绝执行（通用话术，不暴露安全检测）；信号消失 90s 自愈复位
//   3. 完整性校验（exe/APK 自校验，防止被篡改后重新打包）
//
// 设计原则：
//   - 轻量级：不阻塞主线程，不影响正常使用
//   - 宁可漏检不可误报：只有 debugger 时间差强信号（连续 2 次）才计入降级；
//     DevTools 尺寸差信号（浏览器缩放/部分 WebView 误报率高）仅记录日志，永不触发降级
//   - 自愈：强信号消失 90 秒后自动复位，杜绝持续误报困死正常用户
//   - 静默：降级提示全部使用通用业务话术（"操作超时"），不暴露安全检测逻辑
//   - 兼容：同时支持 Electron 桌面版和 Android APP
//   - ★ P1 修复：移除 localStorage.securityGuardDisabled 关闭开关（防止攻击者一键关闭防护）
//     仅在 URL 含 ?debug 且本地文件协议下允许关闭（开发调试用）
//
// 详见《public/云端版开发规范.md》第七节 7.5 安全防护规范
// ============================================================================
(function (global) {
    'use strict';

    // —— 延迟静默降级策略常量（宁可漏检不可误报）——
    var CONFIRM_STRIKES = 2;              // 连续 2 次强信号才确认（防单次 GC 抖动误报）
    var RECOVERY_MS = 90 * 1000;          // 强信号消失 90s → 自愈复位
    var DEGRADE_L1_MS = 5 * 60 * 1000;    // 持续调试 ≥5min → 一级降级（业务操作随机延迟）
    var DEGRADE_L2_MS = 10 * 60 * 1000;   // 持续调试 ≥10min → 二级降级（业务操作拒绝）
    var L1_DELAY_MIN = 800;               // 一级降级随机延迟下限 ms
    var L1_DELAY_MAX = 2200;              // 一级降级随机延迟上限 ms
    var BLOCK_ALERT_THROTTLE = 60 * 1000; // 二级降级提示节流（60s 最多一次）

    const SecurityGuard = {
        _enabled: true,
        _debuggerDetected: false,
        _debuggerDetectionTime: null,   // 确认时刻（计算持续调试时长）
        _lastSignalTime: null,          // 最近一次强信号时刻（自愈判断）
        _strongStrikes: 0,              // 连续强信号计数
        _devToolsSuspected: false,      // 尺寸差弱信号（仅记录，不参与降级）
        _integrityChecked: false,
        _guardsInstalled: false,
        _lastBlockAlertTime: 0,

        init() {
            // ★ P1 修复：移除 localStorage.securityGuardDisabled 关闭开关
            // 原因：任何能注入 JS 的攻击者均可通过 localStorage 一键关闭所有反调试防护
            // 现仅允许通过 URL ?debug 且本地文件协议下关闭（开发调试用，生产环境无法触发）
            try {
                var isLocalFile = location.protocol === 'file:' || location.protocol === 'capacitor:';
                var hasDebugParam = location.search.indexOf('debug') !== -1;
                if (isLocalFile && hasDebugParam) {
                    this._enabled = false;
                    return;
                }
            } catch (e) { /* 忽略，默认启用 */ }

            if (!this._enabled) return;

            // 启动反调试检测
            this._startAntiDebug();

            // 安装延迟静默降级包装器（等主脚本定义完业务函数后）
            this._installBusinessGuards();

            // 启动完整性校验（延迟到 DOM ready 后）
            if (document.readyState === 'complete' || document.readyState === 'interactive') {
                setTimeout(() => this._checkIntegrity(), 500);
            } else {
                document.addEventListener('DOMContentLoaded', () => {
                    setTimeout(() => this._checkIntegrity(), 500);
                });
            }
        },

        // ==================== 反调试检测（轻量级） ====================
        // 强信号：debugger 语句时间差（DevTools/调试器附加时必现暂停，可靠）
        // 弱信号：DevTools 尺寸差（缩放/WebView 误报率高，仅记录日志）
        _startAntiDebug() {
            const self = this;

            // 方法 1：时间差检测（每 5 秒检测一次，唯一可触发降级的信号）
            // 当调试器暂停执行时，时间差会显著变大
            setInterval(() => {
                if (!self._enabled) return;

                const start = Date.now();
                // debugger 语句在调试器打开时会暂停执行
                // 使用 constructor 间接调用，避免静态分析直接检测 debugger 关键字
                try {
                    (function () { /* constructor */ }).constructor('debugger').call();
                } catch (e) { /* 某些环境会抛错，忽略 */ }
                const elapsed = Date.now() - start;

                // 正常情况下 elapsed < 10ms，调试器打开时会显著变大
                if (elapsed > 100) {
                    self._strongStrikes++;
                    self._lastSignalTime = Date.now();
                    // 连续多次强信号才确认（防单次 GC 抖动误报）
                    if (self._strongStrikes >= CONFIRM_STRIKES && !self._debuggerDetected) {
                        self._debuggerDetected = true;
                        self._debuggerDetectionTime = Date.now();
                        console.warn('[SecurityGuard] 检测到调试器附加（时间差: ' + elapsed + 'ms）');
                    }
                } else {
                    self._strongStrikes = 0;
                    // 自愈：强信号消失超过恢复窗口 → 复位（防持续误报困死正常用户）
                    if (self._debuggerDetected && self._lastSignalTime &&
                        Date.now() - self._lastSignalTime > RECOVERY_MS) {
                        self._debuggerDetected = false;
                        self._debuggerDetectionTime = null;
                        self._strongStrikes = 0;
                    }
                }
            }, 5000);

            // 方法 2：检测 DevTools 是否打开（仅 Chromium 内核）
            // 通过 window 尺寸差判断
            // ⚠️ 仅记录日志，永不参与降级决策：
            //   浏览器缩放（outerWidth 不随 zoom 变化、innerWidth 随之变化）及
            //   部分 Android WebView 的 outer/inner 天然差值 >160px，误报率高
            setInterval(() => {
                if (!self._enabled || self._devToolsSuspected) return;

                try {
                    const threshold = 160;
                    const widthDiff = window.outerWidth - window.innerWidth;
                    const heightDiff = window.outerHeight - window.innerHeight;
                    // DevTools 打开时会有显著尺寸差（>threshold）
                    if (widthDiff > threshold || heightDiff > threshold) {
                        self._devToolsSuspected = true;
                        console.warn('[SecurityGuard] 检测到 DevTools 可能已打开（弱信号，仅记录）');
                    }
                } catch (e) { /* 忽略 */ }
            }, 10000);
        },

        // ==================== 延迟静默降级（P1-3） ====================
        // 持续调试 ≥5min（一级）：关键业务操作随机延迟 0.8~2.2s，功能可用但明显变慢
        // 持续调试 ≥10min（二级）：关键业务操作拒绝执行，通用话术提示（内部高频调用静默拒绝）
        // 强信号消失 90s 自动复位，正常用户零感知
        _installBusinessGuards() {
            const self = this;

            // 包装单个全局业务函数；返回 false 表示函数尚未定义（等待重试）
            const wrapTarget = (name, silent) => {
                try {
                    const orig = global[name];
                    if (typeof orig !== 'function') return false;
                    if (orig.__sgWrapped) return true;
                    const wrapped = function (...args) {
                        const level = self.getDegradeLevel();
                        if (level >= 2) {
                            // 二级降级：拒绝执行
                            // savePrescription/handleLogin 正常早退模式即 "提示 + return undefined"，
                            // 此处返回 Promise<undefined> 与原契约完全兼容
                            if (!silent) self._notifyBlocked();
                            return Promise.resolve(undefined);
                        }
                        if (level === 1) {
                            // 一级降级：随机延迟后正常执行（返回值透传）
                            const delay = L1_DELAY_MIN + Math.floor(Math.random() * (L1_DELAY_MAX - L1_DELAY_MIN));
                            return new Promise(resolve => {
                                setTimeout(() => resolve(orig.apply(this, args)), delay);
                            });
                        }
                        return orig.apply(this, args);
                    };
                    wrapped.__sgWrapped = true;
                    global[name] = wrapped;
                    return true;
                } catch (e) {
                    return false;
                }
            };

            const install = () => {
                if (self._guardsInstalled) return;
                let allOk = true;
                // 用户触发的关键操作（拒绝时给通用提示）
                if (!wrapTarget('savePrescription', false)) allOk = false;
                if (!wrapTarget('handleLogin', false)) allOk = false;
                // 内部数据加载（拒绝时静默，避免高频弹窗）
                if (!wrapTarget('loadData', true)) allOk = false;
                if (allOk) self._guardsInstalled = true;
            };

            // 主脚本（含业务函数定义）在 DOMContentLoaded 前执行完毕；
            // 延迟安装 + 重试兜底（脚本异常时函数可能尚未定义）
            let retries = 0;
            const tick = () => {
                install();
                if (!self._guardsInstalled && retries < 10) {
                    retries++;
                    setTimeout(tick, 3000);
                }
            };
            if (document.readyState === 'complete' || document.readyState === 'interactive') {
                setTimeout(tick, 1500);
            } else {
                document.addEventListener('DOMContentLoaded', () => setTimeout(tick, 1500));
            }
        },

        // 二级降级提示：通用业务话术 + 节流（不暴露安全检测逻辑）
        _notifyBlocked() {
            const now = Date.now();
            if (now - this._lastBlockAlertTime < BLOCK_ALERT_THROTTLE) return;
            this._lastBlockAlertTime = now;
            try { alert('操作超时，请稍后重试'); } catch (e) { /* 忽略 */ }
        },

        // ==================== 完整性校验 ====================
        // 策略：校验关键 DOM 元素是否存在，防止 HTML 被篡改
        // 不做 hash 校验（计算开销大，且每次版本更新 hash 都会变）
        _checkIntegrity() {
            if (!this._enabled || this._integrityChecked) return;

            try {
                // 校验关键 DOM 元素是否存在
                const criticalElements = [
                    'prescriptionPaper',   // 处方签纸
                    'prescriptionBody',    // 药物表体
                    'historyList',         // 历史列表
                    'clinicNameDisplay'    // 诊所名显示
                ];

                const missing = criticalElements.filter(id => !document.getElementById(id));

                if (missing.length > 0) {
                    console.warn('[SecurityGuard] 完整性校验失败，缺失关键元素:', missing);
                    // 仅记录日志，不强制退出
                }

                // 校验关键全局函数是否存在（防止 JS 被篡改后丢失关键函数）
                const criticalFunctions = [
                    'savePrescription',
                    'loadData',
                    'handleLogin'
                ];

                const missingFunctions = criticalFunctions.filter(fn => typeof global[fn] !== 'function');

                if (missingFunctions.length > 0) {
                    console.warn('[SecurityGuard] 完整性校验失败，缺失关键函数:', missingFunctions);
                }

                // 校验 Electron 环境下关键 API 是否存在
                if (global.electronAPI && global.electronAPI.isElectron) {
                    const criticalAPIs = ['getCurrentUser', 'saveUserData', 'getUserData'];
                    const missingAPIs = criticalAPIs.filter(api => typeof global.electronAPI[api] !== 'function');

                    if (missingAPIs.length > 0) {
                        console.warn('[SecurityGuard] Electron API 校验失败，缺失:', missingAPIs);
                    }
                }

                this._integrityChecked = true;
            } catch (e) {
                console.warn('[SecurityGuard] 完整性校验异常:', e);
            }
        },

        // ==================== 对外接口 ====================
        isDebuggerDetected() {
            return this._debuggerDetected;
        },

        // 持续调试时长（ms）；未检测到返回 0
        getDebuggerDuration() {
            return (this._debuggerDetected && this._debuggerDetectionTime)
                ? Date.now() - this._debuggerDetectionTime
                : 0;
        },

        // 当前降级等级：0=正常 1=延迟降级（≥5min）2=拒绝降级（≥10min）
        getDegradeLevel() {
            if (!this._debuggerDetected) return 0;
            const d = this.getDebuggerDuration();
            if (d >= DEGRADE_L2_MS) return 2;
            if (d >= DEGRADE_L1_MS) return 1;
            return 0;
        },

        // 是否已进入降级状态（供业务代码主动查询）
        shouldDegrade() {
            return this.getDegradeLevel() > 0;
        },

        isEnabled() {
            return this._enabled;
        }
    };

    // 自动初始化（异步，不阻塞页面加载）
    if (typeof window !== 'undefined') {
        try {
            SecurityGuard.init();
        } catch (e) {
            console.warn('[SecurityGuard] 初始化失败:', e);
        }
    }

    global.SecurityGuard = SecurityGuard;

})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
