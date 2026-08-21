// ============================================================================
// normalize-config.js —— CONFIG 入口归一化关卡（T2 · 2026-08-21）
//
// 架构目的：所有外部数据进入 CONFIG 的必经关卡（单一收口）。
//   历史事故：1.2.101 激活/云端下发 config.json 中 users 为非数组
//   （双编码残留字符串 / 伪数组对象），渲染层 Object.assign(CONFIG, cfg)
//   全字段直灌 → CONFIG.users.map 抛错 → 【用户管理】点击无响应。
//
//   本文件在【入口端】拦截：不论数据来自 asar config.json、userData
//   config.json（getAppConfig IPC）还是云端同步，先过关卡再入 CONFIG：
//     · users   非数组 → 大声告警并【丢弃该字段】（保持现有/兜底值，绝不静默改写）
//               数组但含脏条目 → 逐条告警并过滤，只保留有 username 的对象
//     · edition 别名（institution/standard/中文标签…）→ 归一化为规范 key
//               （复用 edition-lock 的 window.__normalizeEdition，缺省时用内置副本）
//     · maxUsers 非数字 → 丢弃
//   返回净化后的浅拷贝，绝不修改入参。
//
// 加载方式：与 permission.js / edition-lock.js 相同，<script src> 直接加载，
//   依赖方通过 window.__normalizeIncomingConfig(cfg, sourceLabel) 调用。
// ============================================================================
(function (global) {
    'use strict';

    // ── edition 归一化（优先复用 edition-lock 的权威实现；内置副本兜底独立加载场景）──
    function __normalizeEditionLocal(e) {
        if (typeof global.__normalizeEdition === 'function') return global.__normalizeEdition(e);
        var s = String(e || '').trim();
        if (!s) return s;
        var x = s.toLowerCase();
        if (x === 'institution' || x === 'institutional' || x === 'jigou') return 'cloud_clinic';
        if (x === 'standard') return 'personal';
        if (x === 'yj') return 'cloud_clinic';
        if (x === 'yb') return 'cloud_personal';
        if (x === 'lj') return 'offline_clinic';
        if (x === 'lb') return 'offline_personal';
        if (s.indexOf('云端机构') >= 0) return 'cloud_clinic';
        if (s.indexOf('云端标准') >= 0) return 'cloud_personal';
        if (s.indexOf('离线机构') >= 0) return 'offline_clinic';
        if (s.indexOf('离线标准') >= 0) return 'offline_personal';
        if (s.indexOf('机构版') >= 0) return 'clinic';
        if (s.indexOf('标准版') >= 0) return 'personal';
        return s;
    }

    function warn(msg) {
        try { (console.warn || console.log).call(console, '[normalize-config]' + msg); } catch (_) {}
    }

    /**
     * CONFIG 入口关卡。
     * @param {object|null|undefined} cfg 原始配置（可能被污染）
     * @param {string} sourceLabel 数据来源标识（用于告警定位），如 'XHR-config.json'
     * @returns {object} 净化后的浅拷贝；入参非对象时返回 {}
     */
    function normalizeIncomingConfig(cfg, sourceLabel) {
        var src = sourceLabel || 'unknown-source';
        if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) {
            warn('[' + src + '] 配置非对象(' + Object.prototype.toString.call(cfg) + ')，按空配置处理');
            return {};
        }
        var out = {};
        for (var k in cfg) {
            if (!Object.prototype.hasOwnProperty.call(cfg, k)) continue;
            var v = cfg[k];

            if (k === 'users') {
                if (v === undefined || v === null) continue; // 未提供 → 不覆盖现有值
                if (!Array.isArray(v)) {
                    // ★ 1.2.101 同源毒数据：非数组（字符串/对象/Promise字符串化物）→ 大声拒绝
                    warn('[' + src + '] users 非数组(' + Object.prototype.toString.call(v) +
                        ', len=' + (v && v.length) + ')，已丢弃！现有用户配置保持不变');
                    continue;
                }
                var clean = [];
                for (var i = 0; i < v.length; i++) {
                    var u = v[i];
                    if (u && typeof u === 'object' && typeof u.username === 'string' && u.username) {
                        clean.push(u);
                    } else {
                        warn('[' + src + '] users[' + i + '] 缺少合法 username，已过滤: ' +
                            (function(){ try { return JSON.stringify(u).slice(0, 80); } catch (_) { return String(u); } })());
                    }
                }
                if (clean.length !== v.length) {
                    warn('[' + src + '] users 过滤完成: ' + v.length + ' → ' + clean.length + ' 条');
                }
                out.users = clean;
                continue;
            }

            if (k === 'edition') {
                if (v === undefined || v === null || v === '') continue;
                var norm = __normalizeEditionLocal(v);
                if (norm !== String(v)) {
                    warn('[' + src + '] edition 别名归一化: "' + v + '" → "' + norm + '"');
                }
                out.edition = norm;
                continue;
            }

            if (k === 'maxUsers') {
                if (typeof v !== 'number' || isNaN(v) || v < 0) {
                    warn('[' + src + '] maxUsers 非法(' + String(v) + ')，已丢弃');
                    continue;
                }
                out.maxUsers = v;
                continue;
            }

            out[k] = v; // 其余字段原样透传
        }
        return out;
    }

    global.__normalizeIncomingConfig = normalizeIncomingConfig;
})(typeof window !== 'undefined' ? window : globalThis);
