// ============================================================================
// debug-logger.js — 统一调试日志模块
// 格式: [DBG][版本][设备][模块] 操作 行为数据
// ============================================================================
(function (global) {
    'use strict';

    const DBG = {
        _enabled: false,
        _version: 'unknown',
        _device: 'unknown',

        init() {
            // 检测是否启用调试模式
            this._enabled = (
                location.search.includes('debug') ||
                localStorage.getItem('debug') === '1' ||
                (global.electronAPI && global.electronAPI.isDebugMode)
            );

            // 检测设备类型
            const ua = navigator.userAgent || '';
            if (/Android/i.test(ua)) {
                this._device = 'Android';
            } else if (/Win/i.test(ua)) {
                this._device = 'Windows';
            } else if (/Mac/i.test(ua)) {
                this._device = 'macOS';
            } else if (/Linux/i.test(ua)) {
                this._device = 'Linux';
            } else {
                this._device = 'Unknown';
            }

            // 获取版本信息
            if (global.Permission && Permission._edition) {
                this._version = Permission._edition;
            } else if (typeof CONFIG !== 'undefined' && CONFIG && CONFIG.edition) {
                this._version = CONFIG.edition;
            } else if (global.EDITION) {
                this._version = global.EDITION;
            }
        },

        _format(module, action) {
            return `[DBG][${this._version}][${this._device}][${module}] ${action}`;
        },

        log(module, action, data) {
            if (!this._enabled) return;
            this.init();
            console.log(this._format(module, action), data || '');
        },

        warn(module, action, data) {
            this.init();
            console.warn(this._format(module, action), data || '');
        },

        error(module, action, data) {
            this.init();
            console.error(this._format(module, action), data || '');
        },

        // 便捷方法：自动捕获函数名
        wrap(module, fn, action) {
            const self = this;
            return function (...args) {
                self.log(module, action || fn.name || 'anonymous', { args: args.length });
                try {
                    const result = fn.apply(this, args);
                    if (result && typeof result.then === 'function') {
                        return result.then(r => {
                            self.log(module, (action || fn.name) + '.done', { success: true });
                            return r;
                        }).catch(e => {
                            self.error(module, (action || fn.name) + '.error', e.message);
                            throw e;
                        });
                    }
                    self.log(module, (action || fn.name) + '.done', { success: true });
                    return result;
                } catch (e) {
                    self.error(module, (action || fn.name) + '.error', e.message);
                    throw e;
                }
            };
        }
    };

    // 自动初始化
    DBG.init();

    global.DBG = DBG;

})(typeof window !== 'undefined' ? window : this);
