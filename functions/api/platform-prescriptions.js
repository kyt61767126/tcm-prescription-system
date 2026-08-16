import { parseAuthHeader, isPlatformAdmin, KV_SYSTEM_CLINICS } from './_lib/auth.js';
import { getKV } from './_lib/kv.js';

// ★ P2-E 修复：CORS 白名单（替代通配符 '*'，与 users.js P1-6 模式一致）
function getAllowedOrigins() {
    return [
        'https://tcm-prescription-system.pages.dev',
        'https://hjkangtcm.pages.dev',
        'http://localhost:3000',
        'http://localhost:8080',
        'http://127.0.0.1:3000',
        'http://127.0.0.1:8080'
    ];
}

function corsHeaders(request) {
    const origin = request?.headers?.get('Origin') || '';
    // 无 Origin 头（同源请求或非浏览器请求）：保持 '*' 向后兼容
    if (!origin) {
        return {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Request-ID',
            'Access-Control-Max-Age': '86400',
            'Content-Type': 'application/json'
        };
    }
    const allowed = getAllowedOrigins();
    // 允许 pages.dev 子域（每个诊所可能有自己的子域）
    const isPagesDev = origin.endsWith('.pages.dev') && origin.startsWith('https://');
    const allowedOrigin = (allowed.includes(origin) || isPagesDev) ? origin : 'null';
    return {
        'Access-Control-Allow-Origin': allowedOrigin,
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
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
        return new Response(null, { status: 200, headers: corsHeaders(context.request) });
    }

    try {
        const kv = getKV(context);
        if (!kv) {
            return json({ success: false, error: 'KV存储未配置', requireSetup: true }, 500, context.request);
        }

        const currentUser = await parseAuthHeader(context.request, context.env);
        if (!currentUser) {
            return json({ success: false, error: '未授权访问，请先登录', requireAuth: true }, 401, context.request);
        }

        if (!isPlatformAdmin(currentUser)) {
            return json({ success: false, error: '仅平台总管理员可访问处方监管' }, 403, context.request);
        }

        if (method === 'GET') {
            const clinic = url.searchParams.get('clinic') || '';
            const doctor = url.searchParams.get('doctor') || '';
            const patient = url.searchParams.get('patient') || '';
            const medicine = url.searchParams.get('medicine') || '';
            const startDate = url.searchParams.get('startDate') || '';
            const endDate = url.searchParams.get('endDate') || '';
            const keyword = url.searchParams.get('keyword') || '';

            const clinics = (await kv.get(KV_SYSTEM_CLINICS, 'json')) || [];
            let allPrescriptions = [];

            for (const c of clinics) {
                const clinicPrescriptions = (await kv.get(`clinic:${c.id}:prescriptions`, 'json')) || [];
                clinicPrescriptions.forEach(p => {
                    p.clinicId = c.id;
                    p.clinicName = c.name;
                });
                allPrescriptions = allPrescriptions.concat(clinicPrescriptions);
            }

            let filtered = allPrescriptions;

            if (clinic) {
                filtered = filtered.filter(p => p.clinicId === clinic);
            }

            if (doctor) {
                filtered = filtered.filter(p => 
                    (p.createdBy && p.createdBy.toLowerCase().includes(doctor.toLowerCase())) ||
                    (p.doctorName && p.doctorName.toLowerCase().includes(doctor.toLowerCase()))
                );
            }

            if (patient) {
                filtered = filtered.filter(p => 
                    p.name && p.name.toLowerCase().includes(patient.toLowerCase())
                );
            }

            if (medicine) {
                filtered = filtered.filter(p => {
                    if (!p.items || !Array.isArray(p.items)) return false;
                    return p.items.some(item => 
                        item.name && item.name.toLowerCase().includes(medicine.toLowerCase())
                    );
                });
            }

            if (startDate) {
                filtered = filtered.filter(p => {
                    const pDate = p.date || p.createdAt || '';
                    return pDate >= startDate;
                });
            }

            if (endDate) {
                filtered = filtered.filter(p => {
                    const pDate = p.date || p.createdAt || '';
                    return pDate <= endDate;
                });
            }

            if (keyword) {
                const kw = keyword.toLowerCase();
                filtered = filtered.filter(p => 
                    (p.outpatientNo && p.outpatientNo.toLowerCase().includes(kw)) ||
                    (p.name && p.name.toLowerCase().includes(kw)) ||
                    (p.diagnosis && p.diagnosis.toLowerCase().includes(kw)) ||
                    (p.createdBy && p.createdBy.toLowerCase().includes(kw)) ||
                    (p.clinicName && p.clinicName.toLowerCase().includes(kw)) ||
                    (p.items && Array.isArray(p.items) && p.items.some(item => 
                        item.name && item.name.toLowerCase().includes(kw)
                    ))
                );
            }

            filtered.sort((a, b) => {
                const dateA = new Date(a.createdAt || 0).getTime();
                const dateB = new Date(b.createdAt || 0).getTime();
                return dateB - dateA;
            });

            const stats = {
                total: allPrescriptions.length,
                filtered: filtered.length,
                totalClinics: clinics.length,
                totalDoctors: [...new Set(allPrescriptions.map(p => p.createdBy).filter(Boolean))].length,
                totalPatients: [...new Set(allPrescriptions.map(p => p.name).filter(Boolean))].length,
                totalAmount: allPrescriptions.reduce((sum, p) => sum + (parseFloat(p.totalAmount) || 0), 0)
            };

            const clinicStats = {};
            filtered.forEach(p => {
                const cn = p.clinicName || '未知诊所';
                if (!clinicStats[cn]) {
                    clinicStats[cn] = { count: 0, amount: 0 };
                }
                clinicStats[cn].count++;
                clinicStats[cn].amount += parseFloat(p.totalAmount) || 0;
            });

            return json({
                success: true,
                data: filtered,
                count: filtered.length,
                stats,
                clinicStats,
                clinics: clinics.map(c => ({ id: c.id, name: c.name }))
            }, 200, context.request);
        }

        return json({ success: false, error: '不支持的请求方法' }, 405, context.request);

    } catch (error) {
        // ★ P2-D 修复：错误详情仅记服务端日志，不向客户端泄露内部实现
        console.error('Platform prescriptions error:', error && error.message, error);
        return json({ success: false, error: '服务器内部错误，请稍后再试' }, 500, context.request);
    }
}