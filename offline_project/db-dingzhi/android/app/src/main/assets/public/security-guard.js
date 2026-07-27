// ============================================================================
// security-guard.js — 轻量级安全防护模块
//
// 功能：
//   1. 反调试检测（debugger 检测，轻量级，不影响正常使用）
//   2. 完整性校验（exe/APK 自校验，防止被篡改后重新打包）
//
// 设计原则：
//   - 轻量级：不阻塞主线程，不影响正常使用
//   - 透明：仅在检测到异常时记录日志，不强制退出
//   - 兼容：同时支持 Electron 桌面版和 Android APP
//   - 可关闭：通过 localStorage.securityGuardDisabled='1' 可临时关闭
//
// 详见《public/云端版开发规范.md》第七节 7.5 安全防护规范
// ============================================================================
(function (global) {
    'use strict';

    const SecurityGuard = {
        _enabled: true,
        _debuggerDetected: false,
        _integrityChecked: false,

        init() {
            // 检查是否被手动关闭
            try {
                if (localStorage.getItem('securityGuardDisabled') === '1') {
                    this._enabled = false;
                    return;
                }
            } catch (e) { /* localStorage 不可用时默认启用 */ }

            // 调试模式下不启用（开发环境）
            try {
                if (location.search.includes('debug') ||
                    localStorage.getItem('debug') === '1') {
                    this._enabled = false;
                    return;
                }
            } catch (e) { /* 忽略 */ }

            if (!this._enabled) return;

            // 启动反调试检测
            this._startAntiDebug();

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
        // 策略：简单的 debugger 语句 + 时间差检测
        // 检测到调试器时仅记录日志，不强制退出，避免影响正常使用
        _startAntiDebug() {
            const self = this;

            // 方法 1：时间差检测（每 5 秒检测一次）
            // 当调试器暂停执行时，时间差会显著变大
            setInterval(() => {
                if (!self._enabled || self._debuggerDetected) return;

                const start = Date.now();
                // debugger 语句在调试器打开时会暂停执行
                // 使用 constructor 间接调用，避免静态分析直接检测 debugger 关键字
                try {
                    (function () { /* constructor */ }).constructor('debugger').call();
                } catch (e) { /* 某些环境会抛错，忽略 */ }
                const elapsed = Date.now() - start;

                // 正常情况下 elapsed < 10ms，调试器打开时会显著变大
                if (elapsed > 100) {
                    self._debuggerDetected = true;
                    console.warn('[SecurityGuard] 检测到调试器附加（时间差: ' + elapsed + 'ms）');
                    // 不强制退出，仅记录日志
                    // 防止误判导致软件无法使用
                }
            }, 5000);

            // 方法 2：检测 DevTools 是否打开（仅 Chromium 内核）
            // 通过 window 尺寸差判断，简单且不影响性能
            setInterval(() => {
                if (!self._enabled || self._debuggerDetected) return;

                try {
                    const threshold = 160;
                    const widthDiff = window.outerWidth - window.innerWidth;
                    const heightDiff = window.outerHeight - window.innerHeight;
                    // DevTools 打开时会有显著尺寸差（>threshold）
                    if (widthDiff > threshold || heightDiff > threshold) {
                        self._debuggerDetected = true;
                        console.warn('[SecurityGuard] 检测到 DevTools 可能已打开');
                    }
                } catch (e) { /* 忽略 */ }
            }, 10000);
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
