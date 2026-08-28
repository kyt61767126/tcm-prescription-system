// ============================================================================
//  admin-usage.js — 云端 KV 用量监控 API（推广奖励配套）
//
//  路由：POST /api/license/admin-usage
//
//  认证：Bearer token（platform_admin）
//
//  请求体：
//    { "action": "scan" }   → 扫描云端诊所数据占用，返回用量概览
//
//  监控内容（Cloudflare KV 免费额度对照，提前预警付费时机）：
//    - 云端诊所数、每诊所处方数/处方块大小（KB）、垃圾箱大小
//    - 云端总存储估算（对比免费额度 1GB）
//    - 写入额度风险提示：KV 免费版 1000 写/天，按每保存一张处方
//      = 1 次整块写入估算，约 25~40 家活跃云端诊所会顶满——给出阈值提示
//    - 离线 license 记录数（推广奖励增长观察）
//
//  数据源（全部已有，零新增采集、零额外 KV 写入）：
//    - system:clinics                  诊所清单
//    - clinic:{id}:prescriptions       处方块（读出算大小）
//    - clinic:{id}:prescriptions_trash 垃圾箱块
//    - license 索引                     激活码记录数
// ============================================================================

import { parseAuthHeader, isPlatformAdmin, KV_SYSTEM_CLINICS } from '../_lib/auth.js';
import { getKV, listLicenses } from './_lib/license-core.js';

function corsHeaders() {
    return {
        'Access-Control-Allow-Origin': 'https://tcm-prescription-system.pages.dev',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Request-ID',
        'Access-Control-Max-Age': '86400',
        'Content-Type': 'application/json'
    };
}

function json(data, status = 200) {
    return new Response(JSON.stringify(data), { status, headers: corsHeaders() });
}

// Cloudflare KV 免费额度（常量对照，2026 年标准）
const KV_FREE_LIMITS = {
    storageBytes: 1024 * 1024 * 1024,      // 1 GB
    writesPerDay: 1000,                     // 1000 次/天
    readsPerDay: 100000,                    // 10 万次/天
    valueMaxBytes: 25 * 1024 * 1024         // 单值 25 MB
};

// 写入额度风险阈值：估算活跃诊所 × 平均写次数 vs 免费 1000 写/天
const ACTIVE_WRITE_ESTIMATE_PER_CLINIC = 30;   // 每活跃诊所估算 30 写/天（20-40张处方）
const WRITE_WARN_CLINICS = Math.floor(KV_FREE_LIMITS.writesPerDay / ACTIVE_WRITE_ESTIMATE_PER_CLINIC); // ≈33家

export async function onRequest(context) {
    const method = context.request.method;

    if (method === 'OPTIONS') {
        return new Response(null, { status: 200, headers: corsHeaders() });
    }
    if (method !== 'POST') {
        return json({ success: false, error: 'Method not allowed' }, 405);
    }

    try {
        const currentUser = await parseAuthHeader(context.request, context.env);
        if (!currentUser || !isPlatformAdmin(currentUser)) {
            return json({ success: false, error: '仅平台总管理员可查看用量监控' }, 403);
        }

        const kv = getKV(context);
        if (!kv) {
            return json({ success: false, error: 'KV binding not found' }, 500);
        }

        const body = await context.request.json().catch(() => ({}));
        if (body.action !== 'scan') {
            return json({ success: false, error: 'action 必须是 scan' }, 400);
        }

        // ---------- 云端诊所扫描 ----------
        const clinics = (await kv.get(KV_SYSTEM_CLINICS, 'json')) || [];
        const clinicDetails = [];
        let totalBytes = 0;
        let maxBlockClinic = null;

        for (const clinic of clinics) {
            if (!clinic || !clinic.id) continue;
            const entry = {
                clinicId: clinic.id,
                clinicName: clinic.name || clinic.clinicName || ('诊所' + clinic.id),
                prescriptions: 0,
                trash: 0,
                sizeKB: 0,
                largest: false
            };
            try {
                // 处方块：直接取原始字符串算字节（避免 JSON 解析大块开销）
                const rxRaw = await kv.get(`clinic:${clinic.id}:prescriptions`);
                if (rxRaw) {
                    entry.prescriptions = (() => {
                        try {
                            const arr = JSON.parse(rxRaw);
                            return Array.isArray(arr) ? arr.length : 0;
                        } catch (e) { return -1; }
                    })();
                    entry.sizeKB += Math.round(rxRaw.length * 2 / 1024);  // UTF-16 近似（JSON.stringify 后含中文）
                }
                const trashRaw = await kv.get(`clinic:${clinic.id}:prescriptions_trash`);
                if (trashRaw) {
                    entry.trash = (() => {
                        try {
                            const arr = JSON.parse(trashRaw);
                            return Array.isArray(arr) ? arr.length : 0;
                        } catch (e) { return -1; }
                    })();
                    entry.sizeKB += Math.round(trashRaw.length * 2 / 1024);
                }
            } catch (e) { /* 单诊所读取失败不影响整体 */ }
            totalBytes += entry.sizeKB * 1024;
            clinicDetails.push(entry);
            if (!maxBlockClinic || entry.sizeKB > maxBlockClinic.sizeKB) maxBlockClinic = entry;
        }
        if (maxBlockClinic) maxBlockClinic.largest = true;

        // ---------- 离线 license 记录（推广增长观察） ----------
        let licenseCount = 0;
        let inviteActiveCount = 0;    // 已有邀请码的激活用户
        let inviteRewardTotal = 0;    // 全平台累计发放奖励天数
        let inviteesCount = 0;        // 全平台累计成功邀请人次
        try {
            const records = await listLicenses(kv);
            licenseCount = records.length;
            for (const r of records) {
                if (r.inviteCode) inviteActiveCount++;
                if (r.inviteCount) inviteesCount += r.inviteCount;
                if (r.rewardDays) inviteRewardTotal += r.rewardDays;
            }
        } catch (e) { /* license 扫描失败不影响云端用量统计 */ }

        // ---------- 风险评估 ----------
        const risks = [];
        if (clinics.length >= WRITE_WARN_CLINICS) {
            risks.push({
                level: 'warn',
                text: `云端诊所数已达 ${clinics.length} 家（估算写入风险线 ~${WRITE_WARN_CLINICS} 家）。KV 免费写入额度 1000 次/天，建议关注 Cloudflare 后台 Analytics 的实际写入量，超出前迁移 R2 或升级 Workers 付费版（$5/月）。`
            });
        }
        const storagePct = totalBytes / KV_FREE_LIMITS.storageBytes;
        if (storagePct > 0.5) {
            risks.push({
                level: storagePct > 0.8 ? 'high' : 'warn',
                text: `云端存储估算已占免费额度（1GB）的 ${(storagePct * 100).toFixed(1)}%，建议清理垃圾箱或规划 R2 迁移。`
            });
        }
        const largestKB = maxBlockClinic ? maxBlockClinic.sizeKB : 0;
        if (largestKB > 15 * 1024) {  // 15MB（接近单值 25MB 上限）
            risks.push({
                level: 'warn',
                text: `「${maxBlockClinic.clinicName}」处方块已达 ${largestKB}KB（单值上限 25MB），建议引导该诊所归档历史处方。`
            });
        }
        if (risks.length === 0) {
            risks.push({ level: 'ok', text: '云端用量健康，免费额度余量充足，暂无需付费扩容。' });
        }

        return json({
            success: true,
            scannedAt: new Date().toISOString(),
            cloud: {
                clinicCount: clinicDetails.length,
                totalSizeKB: Math.round(totalBytes / 1024),
                totalSizeMB: (totalBytes / 1024 / 1024).toFixed(2),
                storageLimitMB: Math.round(KV_FREE_LIMITS.storageBytes / 1024 / 1024),
                storagePct: (storagePct * 100).toFixed(2),
                writeLimitPerDay: KV_FREE_LIMITS.writesPerDay,
                writeWarnClinics: WRITE_WARN_CLINICS,
                clinics: clinicDetails.sort((a, b) => b.sizeKB - a.sizeKB)
            },
            license: {
                total: licenseCount,
                inviteActive: inviteActiveCount,
                invitees: inviteesCount,
                rewardDaysTotal: inviteRewardTotal
            },
            risks: risks
        });

    } catch (error) {
        console.error('[admin-usage] 服务器错误:', error);
        return json({ success: false, error: '服务器内部错误' }, 500);
    }
}
