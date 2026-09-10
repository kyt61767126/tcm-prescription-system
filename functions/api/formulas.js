import { parseAuthHeader, isPlatformAdmin, isClinicAdmin, isAdmin } from './_lib/auth.js';
import { getKV, listAllKeys } from './_lib/kv.js';

// P1-6 安全增强：CORS 白名单
function corsHeaders(request) {
    const origin = request?.headers?.get('Origin') || '';
    if (!origin) {
        return {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Request-ID',
            'Access-Control-Max-Age': '86400',
            'Content-Type': 'application/json'
        };
    }
    const allowed = ['https://tcm-prescription-system.pages.dev', 'https://hjkangtcm.pages.dev', 'http://localhost:3000', 'http://localhost:8080', 'http://127.0.0.1:3000', 'http://127.0.0.1:8080'];
    const isPagesDev = origin.endsWith('.pages.dev') && origin.startsWith('https://');
    return {
        'Access-Control-Allow-Origin': (allowed.includes(origin) || isPagesDev) ? origin : 'null',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Request-ID',
        'Access-Control-Max-Age': '86400',
        'Vary': 'Origin',
        'Content-Type': 'application/json'
    };
}

function json(data, status = 200, request = null) {
    return new Response(JSON.stringify(data), { status, headers: corsHeaders(request) });
}

// ★ P2-B 统一：getKV 改用 _lib/kv.js 单一事实源（顶部 import）

export async function onRequest(context) {
    const url = new URL(context.request.url);
    const method = context.request.method;

    if (method === 'OPTIONS') {
        return new Response(null, { status: 200, headers: corsHeaders() });
    }

    try {
        const kv = getKV(context);
        if (!kv) {
            return json({ success: false, error: 'KV存储未配置', requireSetup: true }, 500);
        }

        const currentUser = await parseAuthHeader(context.request, context.env);

        // 确定方剂库存储模型（★ 2026-09-10 并发加固：诊所级改「每用户独立 key」）
        //   诊所（有 clinicId）：clinic:{clinicId}:formulas:{username} 每用户一 key，
        //     医师写自己的 key，天然互不覆盖（不再整数组读改写）；管理员读聚合。
        //   平台（platform_admin 无 clinicId）：维持 system:platform_formulas 单数组（仅总管理员改动、频率低）。
        const isClinicScope = !!(currentUser && currentUser.clinicId);
        const isPlatformScope = !!(currentUser && isPlatformAdmin(currentUser));
        if (!isClinicScope && !isPlatformScope) {
            return json({ success: false, error: '未授权访问，请先登录' }, 401);
        }

        const legacyKey = isClinicScope ? `clinic:${currentUser.clinicId}:formulas` : 'system:platform_formulas';
        const perUserPrefix = isClinicScope ? `clinic:${currentUser.clinicId}:formulas:` : null;

        // 诊所级读取：聚合所有 per-user key + 旧数组 key（去重，per-user 覆盖 legacy）
        async function readClinicFormulas() {
            const byKey = new Map();
            const legacy = await kv.get(legacyKey, 'json').catch(() => null);
            if (Array.isArray(legacy)) {
                for (const f of legacy) {
                    if (f && typeof f === 'object') byKey.set((f.createdBy || '') + '::' + (f.name || ''), f);
                }
            }
            const keys = await listAllKeys(kv, perUserPrefix);
            for (const k of keys) {
                const arr = await kv.get(k, 'json').catch(() => null);
                if (Array.isArray(arr)) {
                    for (const f of arr) {
                        if (f && typeof f === 'object') byKey.set((f.createdBy || '') + '::' + (f.name || ''), f);
                    }
                }
            }
            return Array.from(byKey.values());
        }

        // GET - 获取方剂库
        if (method === 'GET') {
            let formulas;
            if (isClinicScope) {
                formulas = await readClinicFormulas();
            } else {
                formulas = await kv.get(legacyKey, 'json').catch(() => null);
                if (!Array.isArray(formulas)) formulas = [];
            }
            return json({ success: true, data: formulas, count: formulas.length });
        }

        // POST/PUT - 保存方剂库（需要认证）
        if (method === 'POST' || method === 'PUT') {
            if (!currentUser) {
                return json({ success: false, error: '未授权访问，请先登录' }, 401);
            }

            let body;
            try {
                body = await context.request.json();
            } catch (error) {
                return json({ success: false, error: '请求数据格式错误' }, 400);
            }

            if (!body.formulas || !Array.isArray(body.formulas)) {
                return json({ success: false, error: '无效的方剂数据' }, 400);
            }

            const nowIso = new Date().toISOString();
            const formulasWithOwner = body.formulas.map(f => ({
                ...f,
                createdBy: f.createdBy || currentUser.username,
                updatedAt: nowIso
            }));

            let savedFormulas;
            if (!isClinicScope) {
                // 平台：维持整数组替换（并发低频，暂不迁移）
                savedFormulas = formulasWithOwner;
                await kv.put(legacyKey, JSON.stringify(savedFormulas));
            } else if (isAdmin(currentUser)) {
                // 管理员：整库替换 → 按 createdBy 分区写各自 per-user key，删除消失的 owner key 与旧数组 key
                const byOwner = new Map();
                for (const f of formulasWithOwner) {
                    const owner = f.createdBy || currentUser.username;
                    if (!byOwner.has(owner)) byOwner.set(owner, []);
                    byOwner.get(owner).push(f);
                }
                const existingKeys = await listAllKeys(kv, perUserPrefix);
                for (const k of existingKeys) {
                    const owner = k.slice(perUserPrefix.length);
                    if (!byOwner.has(owner)) await kv.delete(k);
                }
                for (const [owner, arr] of byOwner) {
                    await kv.put(perUserPrefix + owner, JSON.stringify(arr));
                }
                // 迁移：清掉旧整数组 key，避免读取重复
                await kv.delete(legacyKey);
                savedFormulas = formulasWithOwner;
            } else {
                // 医师：只写自己的 key（仅保留 createdBy=自己的方剂），天然与其他人并发保存互不覆盖
                const owner = currentUser.username;
                const mine = formulasWithOwner
                    .filter(f => f.createdBy === owner)
                    .map(f => ({ ...f, createdBy: owner, updatedAt: nowIso }));
                await kv.put(perUserPrefix + owner, JSON.stringify(mine));
                savedFormulas = await readClinicFormulas();
            }

            return json({ success: true, message: '方剂库保存成功', data: savedFormulas, count: savedFormulas.length });
        }

        return json({ success: false, error: 'Method not allowed' }, 405);

    } catch (error) {
        console.error('Formulas API error:', error);
        return json({ success: false, error: '服务器内部错误，请稍后再试' }, 500);
    }
}
