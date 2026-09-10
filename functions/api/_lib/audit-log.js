// ============================================================================
//  audit-log.js — 操作审计日志写入单一事实源（P2-B 并发加固 + P1 D1 迁移）
//
//  背景：users.js / prescriptions.js 曾各内联一份 writeAuditLog，逻辑为
//        「读整数组数组 → push → 写回」。KV 无 CAS，两请求并发 append 时
//        后写覆盖先写，导致审计条目丢失。
//
//  修复（P2-B）：改为「独立记录 key」写入，每条日志一个 KV 键，天然并发安全。
//  迁移（P1）：USE_D1=true 时 D1 + KV 双写，D1 优先读。
//
//  规则：★ 所有云函数写审计日志一律 import 本文件，禁止再写内联副本 ★
// ============================================================================

import { getDB, isD1Enabled } from './d1.js';

// 审计日志保留 90 天（与原实现一致）
const AUDIT_LOG_TTL_SECONDS = 90 * 24 * 60 * 60;

/**
 * 写入审计日志（KV 始终写，D1 在 USE_D1=true 时双写）
 *
 * @param {*} kv          KV 绑定
 * @param {string} clinicId
 * @param {string} username
 * @param {string} role
 * @param {string} action
 * @param {string} target
 * @param {object|Request} contextOrRequest  传入 context 时自动取 request+env 启用D1双写；
 *                                           传入 Request 时仅写 KV（兼容旧调用）
 * @param {object} extra
 */
export async function writeAuditLog(kv, clinicId, username, role, action, target, contextOrRequest, extra = {}) {
    try {
        // 兼容：传入 context 时取 request + env；传入 Request 时仅用 request
        const isContext = contextOrRequest && typeof contextOrRequest === 'object' && 'request' in contextOrRequest && 'env' in contextOrRequest;
        const request = isContext ? contextOrRequest.request : contextOrRequest;
        const env = isContext ? contextOrRequest.env : null;

        const now = new Date();
        const nowIso = now.toISOString();
        const date = nowIso.split('T')[0];
        const clinicKey = clinicId || 'platform';

        const entry = {
            timestamp: nowIso,
            username,
            role,
            action,
            target,
            ip: request?.headers?.get('CF-Connecting-IP') || 'unknown',
            userAgent: request?.headers?.get('User-Agent') || 'unknown',
            ...extra
        };

        // ★ P1：D1 双写（传入 context 且 USE_D1=true 时写 D1）
        if (env && isD1Enabled(env)) {
            const db = getDB(env);
            if (db) {
                try {
                    await db.prepare(`
                        INSERT INTO audit_logs (clinic_id, username, role, action, target, ip, user_agent, extra, created_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    `).bind(
                        clinicKey,
                        username || null,
                        role || null,
                        action || null,
                        target || null,
                        request?.headers?.get('CF-Connecting-IP') || 'unknown',
                        request?.headers?.get('User-Agent') || 'unknown',
                        extra && Object.keys(extra).length ? JSON.stringify(extra) : null,
                        nowIso
                    ).run();
                } catch (e) {
                    console.error('writeAuditLog D1 error:', e.message);
                }
            }
        }

        // KV 独立记录 key（始终写入，作为备份）
        const suffix = now.getTime() + '-' + Math.random().toString(36).slice(2, 10);
        const key = `audit_log:${clinicKey}:${date}:${suffix}`;
        await kv.put(key, JSON.stringify(entry), { expirationTtl: AUDIT_LOG_TTL_SECONDS });
    } catch (e) {
        console.error('writeAuditLog error:', e);
    }
}
