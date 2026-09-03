// ============================================================================
//  license-write-service.js — 激活写端单一事实源（2026-09-03 架构收敛 P1）
//
//  为什么必须有这个文件：admin-submit / order-submit / order-paid /
//  admin-approve / admin-cancel / admin-delete / free-pass 曾经各自直接
//  KV.put(admin_req / admin_phone / admin_req_index)，7 文件各自维护 3 套
//  索引一致性 → admin-cancel 漏维护 admin_phone 索引、漏维护 admin_req_index
//  → Mate 70 用户取消后用同手机号重新提交永远被短路到已取消的旧记录，
//  永远登不上。
//
//  ★ 架构铁律：所有对 admin_req / admin_phone / admin_req_index / order
//    的写操作必须通过本文件的 5 个原子函数，禁止任何 API 直接
//    KV.put / KV.delete 上述四类 key。
//    （deleteAdminRequest 会同时清理 order 映射，保持双键一致性）
//
//  与既有 license-core.js 的关系：
//    - license-core.js 是"工具库"（生成码、HMAC、K 读），本文件是"写服务"
//    - 本文件继续复用 license-core.js 的 getKV / appendRequestIndex /
//      saveLicense 工具实现，不重复造轮子
//
//  对外 API：
//    createAdminRequest(kv, payload)                → {requestId, record} 全量写入 admin_req+phone_index+req_index
//    updateAdminRequestStatus(kv, requestId, patch) → 更新主记录 + 同步 phone_index status + 必要时 order 映射
//    cancelAdminRequest(kv, requestId)              → P0 根治：取消时重建 phone_index 防止同手机号重新提交被短路
//    deleteAdminRequest(kv, requestId)              → 物理删除：admin_req + phone_index(重建) + req_index(filter) + order(映射 delete)
//    markOrderPaid(kv, orderNo, payInfo)            → orderNo 找到 requestId → 补 paid 字段 + 同步 phone_index + 追加 req_index(缺失)
// ============================================================================

import { getKV, appendRequestIndex, saveLicense } from './license-core.js';

// —— 常量定义（与 license-core.js / 7 个 API 中各自内联副本保持一致；集中维护避免漂移）——
export const KV_ADMIN_REQ_PREFIX = 'admin_req:';
export const KV_ADMIN_PHONE_PREFIX = 'admin_phone:';
export const KV_ADMIN_REQ_INDEX = 'admin_req_index';

// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
// 内部工具：根据 rid 找对应 phone 的主记录后，从 admin_req_index 重建 phone 索引
// （原 admin-delete.js L111-L124 的内联重建逻辑，独立为唯一副本）
// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
async function _rebuildPhoneIndexFor(kv, phone, skipRequestId = null) {
    if (!phone) return;
    const index = (await kv.get(KV_ADMIN_REQ_INDEX, 'json')) || [];
    let replacement = null;
    for (const rid of index) {
        if (skipRequestId && rid === skipRequestId) continue;
        const rec = await kv.get(KV_ADMIN_REQ_PREFIX + rid, 'json').catch(() => null);
        if (!rec || String(rec.phone || '') !== String(phone)) continue;
        // 选择一个"最健康"的：activated > pending > pending_payment > rejected > cancelled
        const weight = { activated: 5, pending: 4, pending_payment: 3, rejected: 2, cancelled: 1 }[rec.status] || 0;
        if (!replacement || weight > replacement.weight) {
            replacement = { weight, requestId: rid, status: rec.status };
        }
    }
    if (replacement) {
        await kv.put(KV_ADMIN_PHONE_PREFIX + phone,
            JSON.stringify({ requestId: replacement.requestId, status: replacement.status }));
    } else {
        await kv.delete(KV_ADMIN_PHONE_PREFIX + phone);
    }
}

// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
// 内部工具：get/更新 admin_req_index 顺序或移除，不用每个 API 各自写
// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
async function _filterReqIndex(kv, requestId) {
    const index = (await kv.get(KV_ADMIN_REQ_INDEX, 'json')) || [];
    const newIndex = index.filter((r) => r !== requestId);
    await kv.put(KV_ADMIN_REQ_INDEX, JSON.stringify(newIndex));
    return newIndex;
}

async function _ensureInReqIndex(kv, requestId) {
    const index = (await kv.get(KV_ADMIN_REQ_INDEX, 'json')) || [];
    if (!index.includes(requestId)) {
        index.unshift(requestId);
        await kv.put(KV_ADMIN_REQ_INDEX, JSON.stringify(index));
        return index;
    }
    return index;
}

// ============================================================================
// 1. createAdminRequest — 首次创建 admin_req 记录（Tab1 admin-submit / 官网 order-submit）
//   - 默认写 admin_req:{requestId} + admin_phone:{phone} + admin_req_index(unshift)
//   - 官网 pending_payment 订单调 createAdminRequest(kv, payload, { skipPhoneIndex:true, skipReqIndex:true })
//     以保持原语义：不写 phone 索引、不进后台待审列表（付款确认时 markOrderPaid 才入列）
//   - 任何入口创建都必须走这一个函数，不允许各自内联 put
// ============================================================================
export async function createAdminRequest(kv, payload, options) {
    if (!kv || !payload || typeof kv.put !== 'function') {
        throw new Error('[license-write-service] createAdminRequest: kv invalid');
    }
    const opts = options || {};
    const { requestId, phone } = payload;
    if (!requestId) throw new Error('[license-write-service] createAdminRequest: requestId required');
    if (!phone) throw new Error('[license-write-service] createAdminRequest: phone required');

    const record = Object.assign(
        { createdAt: new Date().toISOString() },
        payload,
        { status: payload.status || 'pending' }
    );
    await kv.put(KV_ADMIN_REQ_PREFIX + requestId, JSON.stringify(record));
    if (!opts.skipPhoneIndex) {
        await kv.put(KV_ADMIN_PHONE_PREFIX + phone,
            JSON.stringify({ requestId, status: record.status }));
    }
    if (!opts.skipReqIndex) {
        await appendRequestIndex(kv, requestId);  // license-core.js 工具（unshift 入列）
    } else {
        // 官网 pending_payment 不入列，但仍保证不与 appendRequestIndex 冲突
        // （即不做任何操作，保持与旧 order-submit L229 注释行为一致）
    }
    return { requestId, record };
}

// ============================================================================
// 1b. bindOrderToRequest — 官网订单号 ↔ requestId 映射创建（唯一写入口）
//   禁止任何云函数直接写 KV.put(order:X)：之前 order-submit 写 {requestId,phone}，
//   其他读端必须按此 JSON 格式读；deleteAdminRequest 删除时走匹配 JSON.requestId 的
//   一致实现（license-write-service 删除兜底逻辑已支持 JSON 兼容）。
// ============================================================================
export async function bindOrderToRequest(kv, orderNo, requestId, phone) {
    if (!kv || !orderNo || !requestId) throw new Error('[license-write-service] bindOrderToRequest: args');
    const ORDER_PREFIX = 'order:';
    const orderKey = String(orderNo).trim().toUpperCase();
    await kv.put(ORDER_PREFIX + orderKey, JSON.stringify({
        requestId: String(requestId),
        phone: phone ? String(phone) : ''
    }));
    return { orderKey, requestId, phone: phone || '' };
}

// ============================================================================
// 2. updateAdminRequestStatus — 审核通过/拒绝、支付确认、任何状态流转
//   - 同步更新 admin_req 主记录 patch 字段
//   - 如 patch.status 存在，则同步 admin_phone:{phone} 索引状态
//     （若索引当前指向不是本 rid 且指向另一条有效 activated/pending → 不覆盖，
//      保留真实激活记录的权威性；否则 update 为本 rid 新状态）
//   - patch.status === 'activated' 时自动补 licenseBase64 和 orderNo/licenseCode
//     回写顺序：先 saveLicense(license-core.js 权威生成签名license)→ 再 patch 合并
// ============================================================================
export async function updateAdminRequestStatus(kv, requestId, patch) {
    if (!kv || !requestId || !patch) throw new Error('[license-write-service] updateAdminRequestStatus: args');
    const key = KV_ADMIN_REQ_PREFIX + requestId;
    const existing = await kv.get(key, 'json');
    if (!existing) {
        throw new Error(`[license-write-service] updateAdminRequestStatus: record ${requestId} not found`);
    }
    // activated 分支：
    //   - 若 existing 已有 licenseCode + licenseBase64(=admin-approve 显式 saveLicense 后写)
    //     → skip saveLicense，只把 patch 合并回写（避免重复生成新激活码/覆盖 devices）。
    //   - 否则（admin-submit / free-pass 复用等非 admin-approve 通道）→ saveLicense 权威生成。
    let record = existing;
    if (patch.status === 'activated') {
        const merged = Object.assign({}, existing, patch);
        const alreadyLicensed =
            existing.licenseCode && existing.licenseBase64 &&
            (!patch.licenseCode || patch.licenseCode === existing.licenseCode);
        if (alreadyLicensed) {
            record = Object.assign({}, merged, { updatedAt: new Date().toISOString() });
            await kv.put(key, JSON.stringify(record));
        } else {
            // saveLicense 内部写 license:{code} 并回写 record.licenseCode/licenseBase64/expiresAt/maxDevices/type/days
            record = await saveLicense(kv, merged);
        }
    } else {
        record = Object.assign({}, existing, patch, {
            updatedAt: new Date().toISOString()
        });
        await kv.put(key, JSON.stringify(record));
    }
    // 同步 phone 索引（若索引指向其它 activated 记录则不动）
    if (patch.status && record.phone) {
        const phoneIdx = await kv.get(KV_ADMIN_PHONE_PREFIX + record.phone, 'json').catch(() => null);
        let overwrite = true;
        if (phoneIdx && phoneIdx.requestId && phoneIdx.requestId !== requestId) {
            const other = await kv.get(KV_ADMIN_REQ_PREFIX + phoneIdx.requestId, 'json').catch(() => null);
            if (other && (other.status === 'activated' || other.status === 'pending')) {
                overwrite = false;  // 存在有效记录，不抢索引
            }
        }
        if (overwrite) {
            await kv.put(KV_ADMIN_PHONE_PREFIX + record.phone,
                JSON.stringify({ requestId, status: record.status }));
        }
    }
    return record;
}

// ============================================================================
// 3. cancelAdminRequest — P0 根治 admin-cancel 索引维护漏项
//   （原 admin-cancel.js L81-L87 仅写 status=cancelled，不维护 phone_index
//    不标记 req_index → 同手机号新提交永远被 admin_phone 索引短路到旧 cancelled）
// ============================================================================
export async function cancelAdminRequest(kv, requestId) {
    if (!kv || !requestId) throw new Error('[license-write-service] cancelAdminRequest: args');
    const key = KV_ADMIN_REQ_PREFIX + requestId;
    const record = await kv.get(key, 'json');
    if (!record) return { cancelled: false, reason: 'not_found', record: null };
    if (record.status === 'pending' || record.status === 'pending_payment') {
        const patched = Object.assign({}, record, {
            status: 'cancelled',
            cancelledAt: new Date().toISOString(),
            resolvedAt: new Date().toISOString(),
            resolvedBy: 'client'
        });
        await kv.put(key, JSON.stringify(patched));
        // ★ P0 关键修复：重建 phone 索引（若该 phone 下还有其他 pending/activated 则指向它；无则 delete 索引）
        if (record.phone) await _rebuildPhoneIndexFor(kv, record.phone, requestId);
        // req_index 不删（后台 admin-list 仍展示取消的，供管理员审计）
        return { cancelled: true, record: patched };
    }
    return { cancelled: false, reason: `status_not_cancellable:${record.status}`, record };
}

// ============================================================================
// 4. deleteAdminRequest — 物理删除（admin-delete 后台操作）
//   原 admin-delete.js L83-L124 写的逻辑，统一唯一副本
// ============================================================================
export async function deleteAdminRequest(kv, requestId) {
    if (!kv || !requestId) throw new Error('[license-write-service] deleteAdminRequest: args');
    const key = KV_ADMIN_REQ_PREFIX + requestId;
    const record = await kv.get(key, 'json');
    if (!record) return { deleted: false, reason: 'not_found' };
    await kv.delete(key);
    await _filterReqIndex(kv, requestId);
    if (record.phone) await _rebuildPhoneIndexFor(kv, record.phone, requestId);
    // 删除 order: 映射（如果有的话）
    const ORDER_PREFIX_REAL = 'order:';
    if (record.orderNo) {
        await kv.delete(ORDER_PREFIX_REAL + record.orderNo);
    } else {
        // 兜底：扫描 order: 键找匹配值→rid
        try {
            const listed = await kv.list({ prefix: ORDER_PREFIX_REAL }).catch(() => null);
            if (listed && Array.isArray(listed.keys)) {
                for (const k of listed.keys) {
                    const raw = await kv.get(k.name, 'text').catch(() => null);
                    let matches = false;
                    try {
                        const o = JSON.parse(raw);
                        matches = o && typeof o === 'object' && o.requestId === requestId;
                    } catch (_) { matches = raw === requestId; }
                    if (matches) await kv.delete(k.name);
                }
            }
        } catch (_) { /* 忽略扫描失败 */ }
    }
    return { deleted: true, removedFromPhoneIndex: !!record.phone };
}

// ============================================================================
// 5. markOrderPaid — 官网订单付款确认（order-paid.js 唯一入口）
//   原 order-paid.js L72-L83 appendRequestIndex 内联副本 + L166-L169 phone_index
//   维护各自独立写 → 统一唯一实现，保证"订单映射→rid→三索引同步"顺序一致
// ============================================================================
export async function markOrderPaid(kv, orderNo, payInfo) {
    if (!kv || !orderNo) throw new Error('[license-write-service] markOrderPaid: args');
    const ORDER_PREFIX = 'order:';
    const orderMap = await kv.get(ORDER_PREFIX + orderNo, 'json').catch(() => null);
    // order-submit 写入的是 JSON {requestId, phone}；兼容纯 text(requestId)
    let requestId = null;
    if (orderMap && typeof orderMap === 'object') requestId = orderMap.requestId;
    else if (typeof orderMap === 'string') requestId = orderMap;
    if (!requestId) return { paid: false, reason: 'order_not_found' };
    const key = KV_ADMIN_REQ_PREFIX + requestId;
    const record = await kv.get(key, 'json');
    if (!record) return { paid: false, reason: 'request_not_found', requestId };
    const patch = Object.assign({}, payInfo || {}, {
        status: 'pending',          // 付款后入审核队列
        paidAt: payInfo && payInfo.paidAt ? payInfo.paidAt : new Date().toISOString()
    });
    const updated = Object.assign({}, record, patch, { updatedAt: new Date().toISOString() });
    await kv.put(key, JSON.stringify(updated));
    await kv.put(KV_ADMIN_PHONE_PREFIX + updated.phone,
        JSON.stringify({ requestId, status: 'pending' }));
    await _ensureInReqIndex(kv, requestId);  // order-submit 当时不入列，付款确认再入
    return { paid: true, requestId, record: updated };
}

// 修正 KV_ORDER_PREFIX：读取 order-submit.js 约定 JSON 格式，同时兼容老 text 格式
// （order 映射读/删辅助 export）
export const KV_ORDER_PREFIX_EXPORTED = 'order:';

// ============================================================================
// 6. 免费开通白名单（free_pass）三原子函数 — 2026-09-03 架构统一 P2 收官
//
//  背景：free-pass.js L113-L117 / L129-L133 原来直接写 free_pass:{phone} 与
//    free_pass_index 两处 KV 独立维护，任何一处失败会导致"记录已加但索引无"或
//    "索引有但记录被删"的不一致；也没有统一的 operator/addedAt 时间戳兜底。
//
//  铁律：free_pass:记录 / free_pass_index 的写入口，必须经过本文件三函数之一
//    — upsertFreePass(kv, phone, {note, operator})
//    — removeFreePass(kv, phone)
//    — listFreePass(kv, limit=500)
//    读端：admin-submit.js 单独 kv.get('free_pass:'+phone) 仍是合法的 (O(1) 读，
//    不属于"写端一致性"覆盖的范畴)；admin-submit 不写 free_pass。
// ============================================================================
const KV_FREE_PASS_PREFIX = 'free_pass:';
const KV_FREE_PASS_INDEX = 'free_pass_index';

export async function upsertFreePass(kv, phone, opts) {
    if (!kv || !phone || typeof kv.put !== 'function') throw new Error('[license-write-service] upsertFreePass: args');
    const cleanPhone = String(phone).trim();
    if (!/^1[3-9]\d{9}$/.test(cleanPhone)) throw new Error('[license-write-service] 手机号格式错误');
    const operator = opts && opts.operator ? String(opts.operator) : 'platform_admin';
    const note = opts ? String(opts.note || '').slice(0, 100) : '';
    const exist = await kv.get(KV_FREE_PASS_PREFIX + cleanPhone, 'json').catch(() => null);
    const record = {
        phone: cleanPhone,
        note: note || (exist ? exist.note : ''),
        addedAt: exist && exist.addedAt ? exist.addedAt : new Date().toISOString(),
        addedBy: exist && exist.addedBy ? exist.addedBy : operator,
        updatedAt: new Date().toISOString()
    };
    await kv.put(KV_FREE_PASS_PREFIX + cleanPhone, JSON.stringify(record));
    // 索引：不存在才 unshift 最前
    const index = (await kv.get(KV_FREE_PASS_INDEX, 'json').catch(() => null)) || [];
    if (!Array.isArray(index)) {
        // 兜底：损坏的索引重建
        await kv.put(KV_FREE_PASS_INDEX, JSON.stringify([cleanPhone]));
    } else if (!index.includes(cleanPhone)) {
        index.unshift(cleanPhone);
        await kv.put(KV_FREE_PASS_INDEX, JSON.stringify(index));
    }
    return { record, isNew: !exist };
}

export async function removeFreePass(kv, phone) {
    if (!kv || !phone) throw new Error('[license-write-service] removeFreePass: args');
    const cleanPhone = String(phone).trim();
    if (!/^1[3-9]\d{9}$/.test(cleanPhone)) throw new Error('[license-write-service] 手机号格式错误');
    await kv.delete(KV_FREE_PASS_PREFIX + cleanPhone);
    // 索引 filter 同步移除
    const index = (await kv.get(KV_FREE_PASS_INDEX, 'json').catch(() => null)) || [];
    if (Array.isArray(index) && index.includes(cleanPhone)) {
        const newIndex = index.filter(p => p !== cleanPhone);
        await kv.put(KV_FREE_PASS_INDEX, JSON.stringify(newIndex));
        return { phone: cleanPhone, removedFromIndex: true };
    }
    return { phone: cleanPhone, removedFromIndex: false };
}

export async function listFreePass(kv, limit) {
    if (!kv) throw new Error('[license-write-service] listFreePass: args');
    const cap = (limit && limit > 0) ? limit : 500;
    const phones = (await kv.get(KV_FREE_PASS_INDEX, 'json').catch(() => null)) || [];
    const list = [];
    if (!Array.isArray(phones)) return list;
    for (const ph of phones.slice(0, cap)) {
        const rec = await kv.get(KV_FREE_PASS_PREFIX + ph, 'json').catch(() => null);
        if (rec && rec.phone) list.push(rec);
    }
    return list;
}

export const KV_FREE_PASS_PREFIX_EXPORTED = KV_FREE_PASS_PREFIX;
export const KV_FREE_PASS_INDEX_EXPORTED = KV_FREE_PASS_INDEX;
