import { parseAuthHeader, isPlatformAdmin, isClinicAdmin, isAdmin } from './_lib/auth.js';
import { getKV, listAllKeys } from './_lib/kv.js';
import { getDB, isD1Enabled } from './_lib/d1.js';

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

function safeJsonParse(str, fallback) {
    try { return JSON.parse(str); } catch (e) { return fallback; }
}

// D1 行 → 方剂对象
function d1RowToFormula(row) {
    return {
        id: row.id,
        name: row.name,
        createdBy: row.created_by,
        items: row.items ? safeJsonParse(row.items, []) : [],
        diagnosis: row.diagnosis,
        usage: row.usage,
        isPublic: row.is_public === 1,
        extra: row.extra ? safeJsonParse(row.extra, {}) : {},
        createdAt: row.created_at,
        updatedAt: row.updated_at
    };
}

// D1 批量 upsert 方剂
async function d1UpsertFormulas(db, clinicKey, formulas) {
    for (const f of formulas) {
        const id = f.id || (clinicKey + '::' + (f.createdBy || '') + '::' + (f.name || ''));
        await db.prepare(`
            INSERT INTO formulas (id, clinic_id, name, created_by, items, diagnosis, usage, is_public, extra, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                name=excluded.name, items=excluded.items, diagnosis=excluded.diagnosis,
                usage=excluded.usage, is_public=excluded.is_public, extra=excluded.extra,
                updated_at=excluded.updated_at
        `).bind(
            id, clinicKey,
            f.name || '',
            f.createdBy || '',
            JSON.stringify(f.items || []),
            f.diagnosis || null,
            f.usage || null,
            f.isPublic ? 1 : 0,
            f.extra ? JSON.stringify(f.extra) : null,
            f.createdAt || new Date().toISOString(),
            f.updatedAt || new Date().toISOString()
        ).run();
    }
}

// D1 删除指定 owner 的全部方剂（管理员整库替换时用）
async function d1DeleteByOwner(db, clinicKey, owner) {
    await db.prepare(`DELETE FROM formulas WHERE clinic_id = ? AND created_by = ?`).bind(clinicKey, owner).run();
}

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
        const d1On = isD1Enabled(context.env);
        const db = getDB(context.env);

        // 确定方剂库存储模型
        const isClinicScope = !!(currentUser && currentUser.clinicId);
        const isPlatformScope = !!(currentUser && isPlatformAdmin(currentUser));
        if (!isClinicScope && !isPlatformScope) {
            return json({ success: false, error: '未授权访问，请先登录' }, 401);
        }

        const clinicKey = isClinicScope ? currentUser.clinicId : 'platform';
        const legacyKey = isClinicScope ? `clinic:${currentUser.clinicId}:formulas` : 'system:platform_formulas';
        const perUserPrefix = isClinicScope ? `clinic:${currentUser.clinicId}:formulas:` : null;

        // 诊所级 KV 读取：聚合所有 per-user key + 旧数组 key
        async function readClinicFormulasKV() {
            const byKey = new Map();
            const legacy = await kv.get(legacyKey, 'json').catch(() => null);
            if (Array.isArray(legacy)) {
                for (const f of legacy) {
                    if (f && typeof f === 'object') byKey.set((f.createdBy || '') + '::' + (f.name || ''), f);
                }
            }
            if (perUserPrefix) {
                const keys = await listAllKeys(kv, perUserPrefix);
                for (const k of keys) {
                    const arr = await kv.get(k, 'json').catch(() => null);
                    if (Array.isArray(arr)) {
                        for (const f of arr) {
                            if (f && typeof f === 'object') byKey.set((f.createdBy || '') + '::' + (f.name || ''), f);
                        }
                    }
                }
            }
            return Array.from(byKey.values());
        }

        // D1 读取方剂
        async function readFormulasD1() {
            const result = await db.prepare(`SELECT * FROM formulas WHERE clinic_id = ? ORDER BY datetime(updated_at) DESC`).bind(clinicKey).all();
            if (!result || !result.success) return [];
            return result.results.map(d1RowToFormula);
        }

        // GET - 获取方剂库
        if (method === 'GET') {
            let formulas;
            if (d1On && db) {
                formulas = await readFormulasD1();
                if (formulas.length === 0) {
                    // D1 为空，回退 KV（迁移过渡期）
                    formulas = isClinicScope ? await readClinicFormulasKV() : (await kv.get(legacyKey, 'json').catch(() => null) || []);
                }
            } else if (isClinicScope) {
                formulas = await readClinicFormulasKV();
            } else {
                formulas = await kv.get(legacyKey, 'json').catch(() => null);
                if (!Array.isArray(formulas)) formulas = [];
            }
            return json({ success: true, data: formulas, count: formulas.length });
        }

        // POST/PUT - 保存方剂库
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
                // 平台级：D1 整库替换 + KV 备份
                if (d1On && db) {
                    await db.prepare(`DELETE FROM formulas WHERE clinic_id = ?`).bind(clinicKey).run();
                    await d1UpsertFormulas(db, clinicKey, formulasWithOwner);
                }
                savedFormulas = formulasWithOwner;
                await kv.put(legacyKey, JSON.stringify(savedFormulas));
            } else if (isAdmin(currentUser)) {
                // 管理员：整库替换
                if (d1On && db) {
                    // D1：先删后写（按 owner 分区）
                    await db.prepare(`DELETE FROM formulas WHERE clinic_id = ?`).bind(clinicKey).run();
                    await d1UpsertFormulas(db, clinicKey, formulasWithOwner);
                }
                // KV：按 createdBy 分区写各自 per-user key
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
                await kv.delete(legacyKey);
                savedFormulas = formulasWithOwner;
            } else {
                // 医师：只写自己的方剂
                const owner = currentUser.username;
                const mine = formulasWithOwner
                    .filter(f => f.createdBy === owner)
                    .map(f => ({ ...f, createdBy: owner, updatedAt: nowIso }));
                if (d1On && db) {
                    // D1：先删自己的，再写
                    await d1DeleteByOwner(db, clinicKey, owner);
                    await d1UpsertFormulas(db, clinicKey, mine);
                }
                // KV：只写自己的 key
                await kv.put(perUserPrefix + owner, JSON.stringify(mine));
                // 返回聚合后的全所处方（管理员可见全所，医师只看到自己的）
                savedFormulas = d1On && db ? await readFormulasD1() : await readClinicFormulasKV();
                if (!isAdmin(currentUser)) {
                    savedFormulas = savedFormulas.filter(f => f.createdBy === owner);
                }
            }

            return json({ success: true, message: '方剂库保存成功', data: savedFormulas, count: savedFormulas.length });
        }

        return json({ success: false, error: 'Method not allowed' }, 405);

    } catch (error) {
        console.error('Formulas API error:', error);
        return json({ success: false, error: '服务器内部错误，请稍后再试' }, 500);
    }
}
