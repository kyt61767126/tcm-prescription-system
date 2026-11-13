import { parseAuthHeader, isPlatformAdmin, isClinicAdmin, isAdmin, KV_SYSTEM_PLATFORM_MEDICINES, userMustChangePassword } from './_lib/auth.js';
import { getKV } from './_lib/kv.js';

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

function getDefaultMedicines() {
    return [
        { id: 1, name: "麻黄", code: "mh", unit: "g", costPrice: null, price: 0, dosage: 10, stock: 0 },
        { id: 2, name: "桂枝", code: "gz", unit: "g", costPrice: null, price: 0, dosage: 10, stock: 0 },
        { id: 3, name: "杏仁", code: "xr", unit: "g", costPrice: null, price: 0, dosage: 10, stock: 0 },
        { id: 4, name: "甘草", code: "gc", unit: "g", costPrice: null, price: 0, dosage: 10, stock: 0 },
        { id: 5, name: "石膏", code: "sg", unit: "g", costPrice: null, price: 0, dosage: 10, stock: 0 },
        { id: 6, name: "知母", code: "zm", unit: "g", costPrice: null, price: 0, dosage: 10, stock: 0 },
        { id: 7, name: "黄连", code: "hl", unit: "g", costPrice: null, price: 0, dosage: 10, stock: 0 },
        { id: 8, name: "黄芩", code: "hq", unit: "g", costPrice: null, price: 0, dosage: 10, stock: 0 },
        { id: 9, name: "黄柏", code: "hb", unit: "g", costPrice: null, price: 0, dosage: 10, stock: 0 },
        { id: 10, name: "栀子", code: "zz", unit: "g", costPrice: null, price: 0, dosage: 10, stock: 0 }
    ];
}

// ============================================================================
//  ★ 2026-11-13 药材设置同步（云桌面 ↔ 云 App）
//   KV 结构版本化：clinic:{cid}:medicines_v2 = { rev, items:[...], updatedAt }
//   兼容：v2 不存在时从旧键 clinic:{cid}:medicines 读取并归一化（保留旧键读取能力）；
//         sync 写入时同时回写旧键（仅存活项），site-admin 旧版整库读写仍可用。
//   冲突：记录级 LWW（updatedAt 毫秒）；删除为墓碑（deleted:true）。
// ============================================================================
const MED_V2_SUFFIX = ':medicines_v2';

function medSyncHash36(s) {
    let h = 0x811c9dc5;
    const str = String(s || '');
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = (h * 0x01000193) >>> 0;
    }
    return h.toString(36);
}
function medStableId(name) {
    return 'm' + medSyncHash36(String(name || '').trim());
}
function normalizeMedRecord(m, ts = 0) {
    if (!m || !m.name) return null;
    const r = { ...m };
    delete r._serverRev;
    r.name = String(r.name).trim();
    if (!r.id) r.id = medStableId(r.name);
    r.updatedAt = Number(r.updatedAt) || ts || 0;
    return r;
}
function normalizeMedList(list) {
    const out = [];
    const pos = new Map();
    (Array.isArray(list) ? list : []).forEach(m => {
        const r = normalizeMedRecord(m);
        if (!r) return;
        if (pos.has(r.id)) {
            const i = pos.get(r.id);
            if (r.updatedAt > out[i].updatedAt) out[i] = r;
            return;
        }
        pos.set(r.id, out.length);
        out.push(r);
    });
    return out;
}
async function readMedState(kv, clinicKey) {
    const v2 = await kv.get(clinicKey + MED_V2_SUFFIX, 'json');
    if (v2 && Array.isArray(v2.items)) {
        return { rev: Number(v2.rev) || 0, items: v2.items };
    }
    const legacy = await kv.get(clinicKey, 'json');
    const items = normalizeMedList(legacy).map(it => ({ ...it, _serverRev: 0 }));
    return { rev: 0, items: items };
}
function publicItem(it) {
    const copy = { ...it };
    delete copy._serverRev;
    return copy;
}
// 纯合并：记录级 LWW；返回 { rev, items, changed }（供 /api/medicines?sync=1 与离线验证复用）
export function mergeMedSyncState(state, upserts, tombstones) {
    let rev = Number(state.rev) || 0;
    const map = new Map((state.items || []).map(it => [it.id, it]));
    const changed = [];

    for (const raw of (Array.isArray(upserts) ? upserts : [])) {
        const it = normalizeMedRecord(raw);
        if (!it) continue;
        const cur = map.get(it.id);
        if (cur && Number(cur.updatedAt) > it.updatedAt) continue; // 服务端更新，拒绝旧值
        it._serverRev = ++rev;
        map.set(it.id, it);
        changed.push(it);
    }
    for (const raw of (Array.isArray(tombstones) ? tombstones : [])) {
        if (!raw || !raw.id) continue;
        const cur = map.get(raw.id);
        const ts = Number(raw.updatedAt) || Date.now();
        if (cur && Number(cur.updatedAt) > ts) continue;
        const tomb = cur
            ? { ...cur, deleted: true, updatedAt: ts, _serverRev: ++rev }
            : { id: raw.id, name: raw.name || '', deleted: true, updatedAt: ts, _serverRev: ++rev };
        map.set(raw.id, tomb);
        changed.push(tomb);
    }
    return { rev: rev, items: Array.from(map.values()), changed: changed };
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
        const isSync = url.searchParams.get('sync') === '1';

        // ==================== 同步通道（诊所级，版本化） ====================
        if (isSync) {
            if (!currentUser) {
                return json({ success: false, error: '未授权访问，请先登录' }, 401);
            }
            if (!currentUser.clinicId || isPlatformAdmin(currentUser)) {
                return json({ success: false, error: '同步通道仅适用于诊所账号' }, 400);
            }
            const clinicKey = `clinic:${currentUser.clinicId}:medicines`;

            if (method === 'GET') {
                const state = await readMedState(kv, clinicKey);
                const since = parseInt(url.searchParams.get('since') || '0', 10) || 0;
                const changed = since > 0
                    ? state.items.filter(it => (Number(it._serverRev) || 0) > since)
                    : state.items;
                return json({
                    success: true,
                    rev: state.rev,
                    count: changed.length,
                    items: changed.map(publicItem)
                });
            }

            if (method === 'POST' || method === 'PUT') {
                // 写侧权限：仅管理员（普通医生只读）
                if (await userMustChangePassword(context.env, currentUser)) {
                    return json({ success: false, code: 'MUST_CHANGE_PASSWORD', error: '首次登录请先修改密码后再操作' }, 403);
                }
                if (!isAdmin(currentUser)) {
                    return json({ success: false, error: '仅管理员可管理药品库' }, 403);
                }
                let body;
                try {
                    body = await context.request.json();
                } catch (error) {
                    return json({ success: false, error: '请求数据格式错误' }, 400);
                }
                if (body.op !== 'sync') {
                    return json({ success: false, error: '无效的同步请求' }, 400);
                }
                const upserts = Array.isArray(body.upserts) ? body.upserts : [];
                const tombstones = Array.isArray(body.tombstones) ? body.tombstones : [];
                const state = await readMedState(kv, clinicKey);
                const merged = mergeMedSyncState(state, upserts, tombstones);
                const rev = merged.rev;
                const changed = merged.changed;
                const all = merged.items;
                await kv.put(clinicKey + MED_V2_SUFFIX, JSON.stringify({ rev: rev, items: all, updatedAt: Date.now() }));
                // 兼容旧键：仅写存活项，保持 site-admin 旧版整库读取/保存可用
                await kv.put(clinicKey, JSON.stringify(all.filter(it => !it.deleted).map(publicItem)));

                return json({
                    success: true,
                    rev: rev,
                    count: changed.length,
                    items: changed.map(publicItem)
                });
            }

            return json({ success: false, error: 'Method not allowed' }, 405);
        }
        // ==================== 旧通道（保持原行为） ====================

        // 确定药品库的 KV key
        let medicinesKey;
        if (currentUser && isPlatformAdmin(currentUser)) {
            medicinesKey = KV_SYSTEM_PLATFORM_MEDICINES;
        } else if (currentUser && currentUser.clinicId) {
            medicinesKey = `clinic:${currentUser.clinicId}:medicines`;
        } else {
            // 未登录或无 clinicId，回退到平台兜底库
            medicinesKey = KV_SYSTEM_PLATFORM_MEDICINES;
        }

        // GET - 获取药品库
        if (method === 'GET') {
            let medicines = await kv.get(medicinesKey, 'json');
            // 如果诊所药品库为空，回退到平台兜底库
            if ((!medicines || !Array.isArray(medicines) || medicines.length === 0) && medicinesKey !== KV_SYSTEM_PLATFORM_MEDICINES) {
                medicines = await kv.get(KV_SYSTEM_PLATFORM_MEDICINES, 'json');
            }
            if (!medicines || !Array.isArray(medicines) || medicines.length === 0) {
                medicines = getDefaultMedicines();
                await kv.put(medicinesKey, JSON.stringify(medicines));
            }
            return json({ success: true, data: medicines, count: medicines.length });
        }

        // POST sync_platform - 同步平台兜底库到本诊所（保留 priority_use 标记）
        if (method === 'POST' && url.searchParams.get('medicine') === 'sync_platform') {
            if (!currentUser) {
                return json({ success: false, error: '未授权访问，请先登录' }, 401);
            }
            if (!isClinicAdmin(currentUser)) {
                return json({ success: false, error: '仅诊所管理员可同步平台兜底库' }, 403);
            }
            if (!currentUser.clinicId) {
                return json({ success: false, error: '无诊所ID' }, 400);
            }
            // ★ 二期：sync_platform 是整库覆写诊所药品库的写动作，与通用 POST/PUT
            //   保存同闸——mustChangePassword 首登期间 403。
            if (await userMustChangePassword(context.env, currentUser)) {
                return json({ success: false, code: 'MUST_CHANGE_PASSWORD', error: '首次登录请先修改密码后再操作' }, 403);
            }

            const clinicKey = `clinic:${currentUser.clinicId}:medicines`;
            const platformMedicines = await kv.get(KV_SYSTEM_PLATFORM_MEDICINES, 'json');
            const clinicMedicines = await kv.get(clinicKey, 'json') || [];

            if (!platformMedicines || !Array.isArray(platformMedicines) || platformMedicines.length === 0) {
                return json({ success: false, error: '平台兜底库为空，无法同步' }, 400);
            }

            // 合并：以平台兜底库为基础，保留本诊所已设置的 priority_use 标记
            const clinicMap = {};
            if (Array.isArray(clinicMedicines)) {
                for (const m of clinicMedicines) {
                    if (m.name) clinicMap[m.name] = m;
                }
            }

            const mergedMedicines = platformMedicines.map(pm => {
                const cm = clinicMap[pm.name];
                if (cm && cm.priority_use !== undefined) {
                    return { ...pm, priority_use: cm.priority_use };
                }
                return pm;
            });

            await kv.put(clinicKey, JSON.stringify(mergedMedicines));
            return json({ success: true, data: mergedMedicines, count: mergedMedicines.length });
        }

        // POST/PUT - 保存药品库（需要管理员认证）
        if (method === 'POST' || method === 'PUT') {
            if (!currentUser) {
                return json({ success: false, error: '未授权访问，请先登录' }, 401);
            }
            // ★ 二期：首登强制改密期间写库 403
            if (await userMustChangePassword(context.env, currentUser)) {
                return json({ success: false, code: 'MUST_CHANGE_PASSWORD', error: '首次登录请先修改密码后再操作' }, 403);
            }
            if (!isAdmin(currentUser)) {
                return json({ success: false, error: '仅管理员可管理药品库' }, 403);
            }

            let body;
            try {
                body = await context.request.json();
            } catch (error) {
                return json({ success: false, error: '请求数据格式错误' }, 400);
            }

            if (!body.medicines || !Array.isArray(body.medicines)) {
                return json({ success: false, error: '无效的药品数据' }, 400);
            }

            await kv.put(medicinesKey, JSON.stringify(body.medicines));
            return json({ success: true, message: '药品库保存成功', count: body.medicines.length });
        }

        return json({ success: false, error: 'Method not allowed' }, 405);

    } catch (error) {
        console.error('Medicines API error:', error);
        return json({ success: false, error: '服务器内部错误，请稍后再试' }, 500);
    }
}
