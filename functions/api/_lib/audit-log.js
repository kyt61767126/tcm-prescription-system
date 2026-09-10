// ============================================================================
//  audit-log.js — 操作审计日志写入单一事实源（P2-B 并发加固）
//
//  背景：users.js / prescriptions.js 曾各内联一份 writeAuditLog，逻辑为
//        「读整数组数组 → push → 写回」。KV 无 CAS，两请求并发 append 时
//        后写覆盖先写，导致审计条目丢失。
//
//  修复：改为「独立记录 key」写入，每条日志一个 KV 键，天然并发安全、无需读改写。
//        key 格式：audit_log:{clinicId|platform}:{YYYY-MM-DD}:{毫秒时间戳}-{随机后缀}
//        读取侧（audit-logs.js）已改为前缀扫描 + 双读兼容旧数组 key。
//
//  规则：★ 所有云函数写审计日志一律 import 本文件，禁止再写内联副本 ★
// ============================================================================

// 审计日志保留 90 天（与原实现一致）
const AUDIT_LOG_TTL_SECONDS = 90 * 24 * 60 * 60;

export async function writeAuditLog(kv, clinicId, username, role, action, target, request, extra = {}) {
    try {
        const now = new Date();
        const date = now.toISOString().split('T')[0];
        // 独立记录 key：毫秒时间戳 + 随机后缀，避免同毫秒多设备写入 key 撞车
        const suffix = now.getTime() + '-' + Math.random().toString(36).slice(2, 10);
        const key = `audit_log:${clinicId || 'platform'}:${date}:${suffix}`;
        const entry = {
            timestamp: now.toISOString(),
            username,
            role,
            action,
            target,
            ip: request?.headers?.get('CF-Connecting-IP') || 'unknown',
            userAgent: request?.headers?.get('User-Agent') || 'unknown',
            ...extra
        };
        await kv.put(key, JSON.stringify(entry), { expirationTtl: AUDIT_LOG_TTL_SECONDS });
    } catch (e) {
        console.error('writeAuditLog error:', e);
    }
}