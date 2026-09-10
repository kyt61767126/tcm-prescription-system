// ============================================================================
//  migrate.js — KV 处方数据迁移到 D1（平台管理员调用）
//
//  用法：POST /api/migrate?target=prescriptions  Header: Authorization: Bearer <platform_admin_token>
//
//  功能：扫描 KV 中所有 clinic:{id}:prescriptions:{yymmdd} 和旧 clinic:{id}:prescriptions，
//        逐条 INSERT 到 D1 prescriptions 表，并同步 prescription_seq 序号。
//  幂等：基于 id 字段 ON CONFLICT DO UPDATE，可重复执行。
// ============================================================================

import { parseAuthHeader, isPlatformAdmin } from './_lib/auth.js';
import { getKV, listAllKeys } from './_lib/kv.js';
import { getDB, isD1Enabled } from './_lib/d1.js';

function getCorsHeaders() {
    return {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Content-Type': 'application/json; charset=utf-8'
    };
}

export async function onRequest(context) {
    if (context.request.method === 'OPTIONS') {
        return new Response(null, { status: 200, headers: getCorsHeaders() });
    }
    if (context.request.method !== 'POST') {
        return new Response(JSON.stringify({ success: false, error: 'Method not allowed' }), { status: 405, headers: getCorsHeaders() });
    }

    const auth = await parseAuthHeader(context.request, context.env);
    if (!auth || !isPlatformAdmin(auth)) {
        return new Response(JSON.stringify({ success: false, error: '仅平台管理员可执行迁移' }), { status: 403, headers: getCorsHeaders() });
    }

    const kv = getKV(context.env);
    const db = getDB(context.env);
    if (!isD1Enabled(context.env) || !db) {
        return new Response(JSON.stringify({ success: false, error: 'D1 未启用，请设置 USE_D1=true 并配置 DB 绑定' }), { status: 400, headers: getCorsHeaders() });
    }

    // target 参数可选：不传则迁移全部（处方+审计+方剂+设备+用户）
    const target = new URL(context.request.url).searchParams.get('target') || 'all';

    try {
        const stats = { scanned: 0, inserted: 0, updated: 0, errors: [] };

        // 1) 扫描所有诊所的处方 key（按日期分 key + 旧全量 key）
        if (target === 'all' || target === 'prescriptions') {
        const dateKeys = await listAllKeys(kv, 'clinic:');
        const rxKeys = dateKeys.filter(k =>
            k.startsWith('clinic:') && k.includes(':prescriptions')
        );

        for (const key of rxKeys) {
            try {
                const arr = await kv.get(key, 'json').catch(() => null);
                if (!Array.isArray(arr)) continue;
                for (const p of arr) {
                    if (!p || typeof p !== 'object' || !p.id) continue;
                    stats.scanned++;
                    try {
                        const before = await db.prepare('SELECT id FROM prescriptions WHERE id = ?').bind(String(p.id)).first();
                        const exists = !!before;
                        await db.prepare(`
                            INSERT INTO prescriptions (id, clinic_id, patient_name, doctor_name, created_by, date,
                                prescription_no, outpatient_no, diagnosis, items, total_amount, fee_status,
                                paid_at, paid_by, pay_method, media_files, extra, created_at, updated_at)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                            ON CONFLICT(id) DO UPDATE SET
                                patient_name=excluded.patient_name, doctor_name=excluded.doctor_name,
                                date=excluded.date, prescription_no=excluded.prescription_no,
                                outpatient_no=excluded.outpatient_no, diagnosis=excluded.diagnosis,
                                items=excluded.items, total_amount=excluded.total_amount,
                                fee_status=excluded.fee_status, paid_at=excluded.paid_at,
                                paid_by=excluded.paid_by, pay_method=excluded.pay_method,
                                media_files=excluded.media_files, extra=excluded.extra,
                                updated_at=excluded.updated_at
                        `).bind(
                            String(p.id),
                            p.clinicId || extractClinicIdFromKey(key),
                            p.patientName || null,
                            p.doctorName || null,
                            p.createdBy || '',
                            p.date || '',
                            p.prescriptionNo || null,
                            p.outpatientNo || null,
                            p.diagnosis || null,
                            JSON.stringify(p.items || []),
                            typeof p.totalAmount === 'number' ? p.totalAmount : 0,
                            p.feeStatus || 'unpaid',
                            p.paidAt || null,
                            p.paidBy || null,
                            p.payMethod || null,
                            p.mediaFiles ? JSON.stringify(p.mediaFiles) : null,
                            p.extra ? JSON.stringify(p.extra) : null,
                            p.createdAt || new Date().toISOString(),
                            p.updatedAt || null
                        ).run();
                        if (exists) stats.updated++; else stats.inserted++;
                    } catch (e) {
                        stats.errors.push({ id: p.id, error: e.message });
                    }
                }
            } catch (e) {
                stats.errors.push({ key, error: e.message });
            }
        }
        } // end prescriptions

        // 2) 同步编号计数器（从 KV clinic:{id}:prescription_seq:{yymmdd} 导入）
        if (target === 'all' || target === 'prescriptions') {
        const seqKeys = await listAllKeys(kv, 'clinic:');
        for (const key of seqKeys) {
            if (!key.includes(':prescription_seq:')) continue;
            try {
                const seqVal = parseInt(await kv.get(key) || '0', 10);
                if (!seqVal) continue;
                const parts = key.split(':');
                const clinicId = parts[1];
                const yymmdd = parts[3];
                await db.prepare(`
                    INSERT INTO prescription_seq (clinic_id, yymmdd, seq) VALUES (?, ?, ?)
                    ON CONFLICT(clinic_id, yymmdd) DO UPDATE SET seq = MAX(seq, excluded.seq)
                `).bind(clinicId, yymmdd, seqVal).run();
            } catch (e) {
                stats.errors.push({ key, error: e.message });
            }
        }
        } // end seq

        // 3) ★ P1：迁移审计日志（从 KV audit_log:{cid}:{date}:{ts} 导入 D1 audit_logs）
        if (target === 'all' || target === 'audit_logs') {
        const auditKeys = await listAllKeys(kv, 'audit_log:');
        let auditMigrated = 0;
        for (const key of auditKeys) {
            try {
                const val = await kv.get(key, 'json').catch(() => null);
                const parts = key.split(':');
                const cid = parts[1] || 'platform';
                if (Array.isArray(val)) {
                    // 旧数组格式
                    for (const e of val) {
                        if (!e || typeof e !== 'object') continue;
                        await db.prepare(`
                            INSERT INTO audit_logs (clinic_id, username, role, action, target, ip, user_agent, extra, created_at)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                        `).bind(
                            cid, e.username || null, e.role || null, e.action || null, e.target || null,
                            e.ip || null, (e.userAgent || null)?.slice(0, 500),
                            JSON.stringify(Object.fromEntries(Object.entries(e).filter(([k]) => !['timestamp','username','role','action','target','ip','userAgent'].includes(k)))),
                            e.timestamp || new Date().toISOString()
                        ).run();
                        auditMigrated++;
                    }
                } else if (val && typeof val === 'object') {
                    await db.prepare(`
                        INSERT INTO audit_logs (clinic_id, username, role, action, target, ip, user_agent, extra, created_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    `).bind(
                        cid, val.username || null, val.role || null, val.action || null, val.target || null,
                        val.ip || null, (val.userAgent || null)?.slice(0, 500),
                        JSON.stringify(Object.fromEntries(Object.entries(val).filter(([k]) => !['timestamp','username','role','action','target','ip','userAgent'].includes(k)))),
                        val.timestamp || new Date().toISOString()
                    ).run();
                    auditMigrated++;
                }
            } catch (e) {
                stats.errors.push({ key, error: e.message });
            }
        }
        stats.auditMigrated = auditMigrated;
        } // end audit_logs

        // 4) ★ P2：迁移方剂库（从 KV clinic:{id}:formulas:{username} + system:platform_formulas 导入 D1 formulas）
        if (target === 'all' || target === 'formulas') {
        const formulaKeys = await listAllKeys(kv, 'clinic:');
        const platFormulas = await kv.get('system:platform_formulas', 'json').catch(() => null);
        let formulaMigrated = 0;

        // 平台方剂
        if (Array.isArray(platFormulas)) {
            for (const f of platFormulas) {
                if (!f || typeof f !== 'object') continue;
                try {
                    const id = 'platform::' + (f.createdBy || '') + '::' + (f.name || '');
                    await db.prepare(`
                        INSERT INTO formulas (id, clinic_id, name, created_by, items, diagnosis, usage, is_public, extra, created_at, updated_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        ON CONFLICT(id) DO UPDATE SET name=excluded.name, items=excluded.items, updated_at=excluded.updated_at
                    `).bind(
                        id, 'platform', f.name || '', f.createdBy || '',
                        JSON.stringify(f.items || []), f.diagnosis || null, f.usage || null,
                        f.isPublic ? 1 : 0,
                        JSON.stringify(Object.fromEntries(Object.entries(f).filter(([k]) => !['name','createdBy','items','diagnosis','usage','isPublic','createdAt','updatedAt'].includes(k)))),
                        f.createdAt || new Date().toISOString(), f.updatedAt || new Date().toISOString()
                    ).run();
                    formulaMigrated++;
                } catch (e) { stats.errors.push({ formula: f.name, error: e.message }); }
            }
        }

        // 诊所方剂（per-user key + 旧数组 key）
        for (const key of formulaKeys) {
            if (!key.includes(':formulas')) continue;
            try {
                const arr = await kv.get(key, 'json').catch(() => null);
                if (!Array.isArray(arr)) continue;
                const parts = key.split(':');
                const cid = parts[1];
                for (const f of arr) {
                    if (!f || typeof f !== 'object') continue;
                    try {
                        const id = cid + '::' + (f.createdBy || '') + '::' + (f.name || '');
                        await db.prepare(`
                            INSERT INTO formulas (id, clinic_id, name, created_by, items, diagnosis, usage, is_public, extra, created_at, updated_at)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                            ON CONFLICT(id) DO UPDATE SET name=excluded.name, items=excluded.items, updated_at=excluded.updated_at
                        `).bind(
                            id, cid, f.name || '', f.createdBy || '',
                            JSON.stringify(f.items || []), f.diagnosis || null, f.usage || null,
                            f.isPublic ? 1 : 0,
                            JSON.stringify(Object.fromEntries(Object.entries(f).filter(([k]) => !['name','createdBy','items','diagnosis','usage','isPublic','createdAt','updatedAt'].includes(k)))),
                            f.createdAt || new Date().toISOString(), f.updatedAt || new Date().toISOString()
                        ).run();
                        formulaMigrated++;
                    } catch (e) { stats.errors.push({ formula: f.name, error: e.message }); }
                }
            } catch (e) { stats.errors.push({ key, error: e.message }); }
        }
        stats.formulaMigrated = formulaMigrated;
        } // end formulas

        // 5) ★ P3：迁移设备绑定（从 KV user_devices:{username} 导入 D1 user_devices）
        if (target === 'all' || target === 'devices') {
        const deviceKeys = await listAllKeys(kv, 'user_devices:');
        let deviceMigrated = 0;
        for (const key of deviceKeys) {
            try {
                const val = await kv.get(key, 'json').catch(() => null);
                if (!val || !Array.isArray(val.devices)) continue;
                const username = key.slice('user_devices:'.length);
                for (const d of val.devices) {
                    if (!d || !d.machineId) continue;
                    await db.prepare(`
                        INSERT INTO user_devices (username, machine_id, client_class, device_name, bound_at, last_seen_at)
                        VALUES (?, ?, ?, ?, ?, ?)
                        ON CONFLICT(username, machine_id) DO UPDATE SET
                            client_class=excluded.client_class, last_seen_at=excluded.last_seen_at
                    `).bind(username, d.machineId, d.clientClass || null, d.deviceName || null, d.boundAt || null, d.lastSeenAt || null).run();
                    deviceMigrated++;
                }
            } catch (e) { stats.errors.push({ key, error: e.message }); }
        }
        stats.deviceMigrated = deviceMigrated;
        } // end devices

        // 6) ★ P3：迁移用户表（从 KV clinic:{id}:users 导入 D1 clinic_users）
        if (target === 'all' || target === 'users') {
        const clinicKeys = await listAllKeys(kv, 'clinic:');
        let userMigrated = 0;
        for (const key of clinicKeys) {
            if (!key.endsWith(':users')) continue;
            try {
                const users = await kv.get(key, 'json').catch(() => null);
                if (!Array.isArray(users)) continue;
                const cid = key.split(':')[1];
                for (const u of users) {
                    if (!u || !u.username) continue;
                    await db.prepare(`
                        INSERT INTO clinic_users (clinic_id, username, name, role, phone, password_hash, salt, allowed_mode, cloud_enabled, extra, created_at, updated_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        ON CONFLICT(clinic_id, username) DO UPDATE SET
                            name=excluded.name, role=excluded.role, phone=excluded.phone,
                            password_hash=excluded.password_hash, salt=excluded.salt,
                            allowed_mode=excluded.allowed_mode, cloud_enabled=excluded.cloud_enabled,
                            extra=excluded.extra, updated_at=excluded.updated_at
                    `).bind(
                        cid, u.username, u.name || null, u.role || null, u.phone || null,
                        u.passwordHash || u.password || null, u.salt || null,
                        u.allowedMode || 'both', u.cloudEnabled ? 1 : 0,
                        JSON.stringify(Object.fromEntries(Object.entries(u).filter(([k]) => !['username','name','role','phone','passwordHash','password','salt','allowedMode','cloudEnabled','createdAt','updatedAt'].includes(k)))),
                        u.createdAt || null, u.updatedAt || new Date().toISOString()
                    ).run();
                    userMigrated++;
                }
            } catch (e) { stats.errors.push({ key, error: e.message }); }
        }
        stats.userMigrated = userMigrated;
        } // end users

        return new Response(JSON.stringify({ success: true, stats }), { status: 200, headers: getCorsHeaders() });
    } catch (e) {
        return new Response(JSON.stringify({ success: false, error: e.message }), { status: 500, headers: getCorsHeaders() });
    }
}

// 从 KV key 中提取 clinicId（clinic:{cid}:prescriptions:{yymmdd}）
function extractClinicIdFromKey(key) {
    const parts = key.split(':');
    return parts.length >= 2 ? parts[1] : '';
}
