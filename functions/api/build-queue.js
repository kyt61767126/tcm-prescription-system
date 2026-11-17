// ============================================================================
//  build-queue.js — 打包队列 API
//
//  路由：POST /api/build-queue
//
//  认证：
//    - 管理动作（list/create/cancel/retry）→ Bearer token（platform_admin）
//    - 打包机动作（claim/update）→ 平台管理员 token，或请求头
//      X-Build-Token 命中环境变量 BUILD_QUEUE_TOKEN（本地打包机使用）
//
//  请求体（action）：
//    { action: "list",   limit?: 100 }
//    { action: "create", target, version?, note? }
//    { action: "claim" }                                  // 取最早 queued → building
//    { action: "update", taskId, status, version?, sha256?, sizeBytes?, downloadUrl?, message? }
//    { action: "cancel", taskId }
//    { action: "retry",  taskId }                         // failed/cancelled → queued
//
//  设计说明：
//    Cloudflare Pages 无法执行本地打包，队列只负责「任务登记 + 状态回执」；
//    打包机（本地 Windows）轮询 claim 拿任务，打包完成后 update 回执。
//    KV 最终一致，仅用于小团队协调，不做强并发锁。
// ============================================================================

import { parseAuthHeader, isPlatformAdmin } from './_lib/auth.js';
import { getKV } from './_lib/kv.js';

const KV_BUILD_TASK_PREFIX = 'build_task:';
const TASK_TTL_SECONDS = 30 * 24 * 3600;   // 30 天后自动清理
const MAX_LIST = 100;

const TARGETS = {
    'cloud-desktop': '云桌面',
    'cloud-app': '云 APP',
    'offline-desktop': '离线桌面',
    'offline-app': '离线 APP',
    'cloud-web': '云端网页',
    'hot-update': '热更新包'
};

const STATUSES = ['queued', 'building', 'success', 'failed', 'cancelled'];

function corsHeaders() {
    return {
        'Access-Control-Allow-Origin': 'https://tcm-prescription-system.pages.dev',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Build-Token, X-Request-ID',
        'Access-Control-Max-Age': '86400',
        'Content-Type': 'application/json'
    };
}

function json(data, status = 200) {
    return new Response(JSON.stringify(data), { status, headers: corsHeaders() });
}

function cleanStr(v, max) {
    return String(v == null ? '' : v).trim().slice(0, max);
}

function newTaskId() {
    return 'bt_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
}

async function readTask(kv, id) {
    const rec = await kv.get(KV_BUILD_TASK_PREFIX + id, 'json');
    return rec && rec.id ? rec : null;
}

async function listTasks(kv) {
    const listed = await kv.list({ prefix: KV_BUILD_TASK_PREFIX, limit: 1000 });
    // 键名含 base36 时间戳：倒序取最新 100 条（KV list 默认正序，直接 slice 会拿到最旧的）
    const keys = (listed.keys || []).map(k => k.name).sort().reverse().slice(0, MAX_LIST);
    const out = [];
    for (let i = 0; i < keys.length; i += 20) {
        const chunk = keys.slice(i, i + 20);
        const records = await Promise.all(chunk.map(k => kv.get(k, 'json').catch(() => null)));
        records.forEach(r => { if (r && r.id) out.push(r); });
    }
    out.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    return out;
}

function statsOf(tasks) {
    const stats = { queued: 0, building: 0, success: 0, failed: 0, cancelled: 0, total: tasks.length };
    tasks.forEach(t => { if (stats[t.status] != null) stats[t.status]++; });
    return stats;
}

export async function onRequest(context) {
    const method = context.request.method;

    if (method === 'OPTIONS') {
        return new Response(null, { status: 200, headers: corsHeaders() });
    }
    if (method !== 'POST') {
        return json({ success: false, error: 'Method not allowed' }, 405);
    }

    try {
        const env = context.env;
        const kv = getKV(env);
        if (!kv) return json({ success: false, error: '存储不可用' }, 503);

        let body = {};
        try { body = await context.request.json(); } catch (e) { /* 空 body 视为 {} */ }
        const action = cleanStr(body.action, 20);

        // 打包机令牌：仅 claim/update 可用，且必须配置了 BUILD_QUEUE_TOKEN
        const buildToken = context.request.headers.get('X-Build-Token') || '';
        const agentOk = !!env.BUILD_QUEUE_TOKEN && buildToken === env.BUILD_QUEUE_TOKEN;
        const agentAllowed = agentOk && (action === 'claim' || action === 'update');

        let currentUser = null;
        let adminOk = false;
        if (!agentAllowed) {
            currentUser = await parseAuthHeader(context.request, env);
            adminOk = isPlatformAdmin(currentUser);
            if (!adminOk) return json({ success: false, error: '未授权：需要平台管理员' }, 401);
        }

        if (action === 'list') {
            const tasks = await listTasks(kv);
            return json({ success: true, tasks, stats: statsOf(tasks), targets: TARGETS });
        }

        if (action === 'create') {
            const target = cleanStr(body.target, 32);
            if (!TARGETS[target]) return json({ success: false, error: '未知打包目标' }, 400);
            const version = cleanStr(body.version, 40);
            const note = cleanStr(body.note, 200);

            // 同目标同版本已在排队/打包中则拒绝重复入队
            const existing = await listTasks(kv);
            const dup = existing.find(t =>
                t.target === target && (t.version || '') === version &&
                (t.status === 'queued' || t.status === 'building'));
            if (dup) {
                return json({ success: false, error: '相同目标与版本的任务已在队列中：' + dup.id }, 409);
            }

            const now = Date.now();
            const task = {
                id: newTaskId(),
                target,
                version,
                note,
                status: 'queued',
                createdAt: now,
                createdBy: currentUser && currentUser.username ? currentUser.username : 'admin',
                startedAt: null,
                finishedAt: null,
                sha256: '',
                sizeBytes: null,
                downloadUrl: '',
                message: ''
            };
            await kv.put(KV_BUILD_TASK_PREFIX + task.id, JSON.stringify(task), { expirationTtl: TASK_TTL_SECONDS });
            return json({ success: true, task });
        }

        if (action === 'claim') {
            const tasks = await listTasks(kv);
            const next = tasks.filter(t => t.status === 'queued').sort((a, b) => a.createdAt - b.createdAt)[0];
            if (!next) return json({ success: true, task: null, message: '队列为空' });
            next.status = 'building';
            next.startedAt = Date.now();
            next.claimedBy = agentOk ? 'build-agent' : ((currentUser && currentUser.username) || 'admin');
            await kv.put(KV_BUILD_TASK_PREFIX + next.id, JSON.stringify(next), { expirationTtl: TASK_TTL_SECONDS });
            return json({ success: true, task: next });
        }

        if (action === 'update') {
            const taskId = cleanStr(body.taskId, 64);
            const status = cleanStr(body.status, 16);
            if (!taskId || !['success', 'failed'].includes(status)) {
                return json({ success: false, error: 'taskId 与 status(success/failed) 必填' }, 400);
            }
            const task = await readTask(kv, taskId);
            if (!task) return json({ success: false, error: '任务不存在' }, 404);
            if (task.status === 'cancelled') return json({ success: false, error: '任务已取消，不能回执' }, 409);

            const sha256 = cleanStr(body.sha256, 64).toLowerCase();
            if (sha256 && !/^[a-f0-9]{64}$/.test(sha256)) {
                return json({ success: false, error: 'sha256 需为 64 位十六进制' }, 400);
            }
            const sizeBytes = body.sizeBytes == null || body.sizeBytes === '' ? null : Number(body.sizeBytes);
            if (sizeBytes != null && (!Number.isFinite(sizeBytes) || sizeBytes < 0)) {
                return json({ success: false, error: 'sizeBytes 非法' }, 400);
            }

            task.status = status;
            task.finishedAt = Date.now();
            task.version = cleanStr(body.version, 40) || task.version;
            task.sha256 = sha256 || task.sha256;
            task.sizeBytes = sizeBytes != null ? Math.round(sizeBytes) : task.sizeBytes;
            task.downloadUrl = cleanStr(body.downloadUrl, 500) || task.downloadUrl;
            task.message = cleanStr(body.message, 300);
            await kv.put(KV_BUILD_TASK_PREFIX + task.id, JSON.stringify(task), { expirationTtl: TASK_TTL_SECONDS });
            return json({ success: true, task });
        }

        if (action === 'cancel' || action === 'retry') {
            const taskId = cleanStr(body.taskId, 64);
            const task = await readTask(kv, taskId);
            if (!task) return json({ success: false, error: '任务不存在' }, 404);

            if (action === 'cancel') {
                if (task.status !== 'queued' && task.status !== 'building') {
                    return json({ success: false, error: '仅排队中/打包中的任务可取消' }, 409);
                }
                task.status = 'cancelled';
                task.finishedAt = Date.now();
                task.message = '管理员取消';
            } else {
                if (task.status !== 'failed' && task.status !== 'cancelled') {
                    return json({ success: false, error: '仅失败/已取消的任务可重试' }, 409);
                }
                task.status = 'queued';
                task.startedAt = null;
                task.finishedAt = null;
                task.sha256 = '';
                task.sizeBytes = null;
                task.downloadUrl = '';
                task.message = '';
            }
            await kv.put(KV_BUILD_TASK_PREFIX + task.id, JSON.stringify(task), { expirationTtl: TASK_TTL_SECONDS });
            return json({ success: true, task });
        }

        return json({ success: false, error: '未知 action' }, 400);
    } catch (e) {
        return json({ success: false, error: e.message || '服务异常' }, 500);
    }
}
