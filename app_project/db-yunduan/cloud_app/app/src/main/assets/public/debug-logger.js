// ============================================================================
// debug-logger.js — 统一调试日志模块（P0-[6.3] logger 统一）
// 格式: [DBG][HH:mm:ss][版本][设备][模块] 操作 行为数据
// ★ 防泄露：所有敏感字段（password/token/activationCode 等）值统一打码
// ★ 统一：以 shared/debug-logger.js 为唯一权威源，修改后必须跑 tools/sync-all.ps1
//         同步到所有分发目录（public / electron / desktop / app assets）
// ============================================================================
(function (global) {
    'use strict';

    // 敏感字段名（键名匹配，值统一打码；不匹配具体值避免误伤）
    const SENSITIVE_KEY_RE = /(password|pwd|passwd|token|secret|activation|authcode|auth_code|apikey|api_key|accesskey|access_key|cookie|credential|authorization|signature|privatekey|private_key)/i;

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

        // 递归脱敏：对象/数组按敏感键打码，防 token/密码/激活码泄露
        _redact(value, depth) {
            depth = depth || 0;
            if (depth > 6) return '[depth]';
            if (value === null || value === undefined) return value;
            if (typeof value === 'string') return value;
            if (Array.isArray(value)) return value.map(v => this._redact(v, depth + 1));
            if (typeof value === 'object') {
                const out = {};
                for (const k of Object.keys(value)) {
                    if (SENSITIVE_KEY_RE.test(k)) {
                        const v = value[k];
                        out[k] = (v === null || v === undefined) ? v : '***';
                    } else {
                        out[k] = this._redact(value[k], depth + 1);
                    }
                }
                return out;
            }
            return value;
        },

        _now() {
            const d = new Date();
            const pad = n => String(n).padStart(2, '0');
            return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
        },

        _format(module, action) {
            return `[DBG][${this._now()}][${this._version}][${this._device}][${module}] ${action}`;
        },

        log(module, action, data) {
            if (!this._enabled) return;
            this.init();
            console.log(this._format(module, action), this._redact(data) || '');
        },

        warn(module, action, data) {
            this.init();
            console.warn(this._format(module, action), this._redact(data) || '');
        },

        error(module, action, data) {
            this.init();
            console.error(this._format(module, action), this._redact(data) || '');
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
