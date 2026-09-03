// ============================================================================
//  lookup.js — 已激活用户重装自愈：激活码原激活信息查询 API
//
//  路由：POST /api/license/lookup
//
//  用途：已激活用户卸载重装/覆盖安装新版本后，APP 提示重新激活时，
//        客户端凭「原激活码 + 本机 machineId」查询原激活信息（手机号/诊所名），
//        自动填写激活表单，用户只需点击"立即激活"即可一键恢复，无需重新填报。
//
//  请求体：
//    {
//      "code": "BNZC-XXXX-XXXX-XXXX-XXXX",   // 激活码
//      "machineId": "abc123def456"            // 本机设备 ID
//    }
//
//  返回（本机已在绑定设备列表）：
//    {
//      "success": true,
//      "bound": true,
//      "user": "张三/13812345678",            // 原激活用户（姓名/手机号）
//      "name": "张三",                          // 姓名（user 去掉手机号部分）
//      "phone": "13812345678",                 // 原激活手机号（登录账号）
//      "clinicName": "惠康中医诊所",            // 原绑定诊所名
//      "status": "used",
//      "expiresAt": "2027-08-29T00:00:00.000Z"
//    }
//
//  返回（本机未绑定，如换新手机）：
//    { "success": true, "bound": false }      // 不泄露任何原激活信息
//
//  安全：
//    - 速率限制：每 IP 每小时 20 次 + 激活码级每小时 5 次（与 validate 一致）
//    - 原激活信息仅返回给「已绑定设备」：攻击者仅凭激活码在陌生设备查询不到任何信息
//    - 激活码格式校验，无效格式直接拒绝
// ============================================================================

import {
    getKV, getLicense, checkRateLimit, checkCodeRateLimit, getDevices
} from './_lib/license-core.js';

const ALLOWED_ORIGINS = [
    'https://tcm-prescription-system.pages.dev',
    'capacitor://localhost',
    'ionic://localhost',
    'http://localhost',
    'https://localhost',
    'http://localhost:3000',
    'http://localhost:5173',
    'http://localhost:8080',
    'http://127.0.0.1',
    'https://127.0.0.1'
];

function corsHeaders(request) {
    const origin = request ? (request.headers.get('Origin') || '') : '';
    // ★ 2026-08-30 CORS 回退对齐 users.js 先例：file:// 客户端（Origin: null，如离线APP WebView）放行。
    //   激活码 lookup 仅回显本机已提交的激活信息（激活码+phone 需二者匹配），无敏感遍历面。
    const allowedOrigin = (origin && ALLOWED_ORIGINS.includes(origin)) ? origin : 'null';
    return {
        'Access-Control-Allow-Origin': allowedOrigin,
        'Vary': 'Origin',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Content-Type': 'application/json; charset=UTF-8'
    };
}

function json(request, data, status = 200) {
    return new Response(JSON.stringify(data), { status, headers: corsHeaders(request) });
}

// 从用户字符串中提取 11 位手机号
function extractPhone(s) {
    const m = String(s || '').match(/1[3-9]\d{9}/);
    return m ? m[0] : '';
}

export async function onRequestPost({ request, env }) {
    try {
        const kv = getKV(env);
        if (!kv) {
            return json(request, { success: false, error: '服务暂不可用，请稍后再试' }, 503);
        }

        // 速率限制（IP 级）
        const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
        const rateLimit = await checkRateLimit(kv, ip, 20);
        if (!rateLimit.allowed) {
            return json(request, { success: false, error: '请求过于频繁，请稍后再试' }, 429);
        }

        const body = await request.json().catch(() => ({}));
        const { code, machineId } = body;

        if (!code || typeof code !== 'string') {
            return json(request, { success: false, error: '请提供激活码' }, 400);
        }
        if (!machineId || typeof machineId !== 'string') {
            return json(request, { success: false, error: '请提供机器 ID' }, 400);
        }
        const pattern = /^BNZC-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;
        if (!pattern.test(code.trim())) {
            return json(request, { success: false, error: '激活码格式错误' }, 400);
        }

        // 激活码级短时频控（防试探）
        const codeRate = await checkCodeRateLimit(kv, code.trim(), 5);
        if (!codeRate.allowed) {
            return json(request, { success: false, error: '查询过于频繁，请 1 小时后再试' }, 429);
        }

        const record = await getLicense(kv, code.trim());
        if (!record) {
            return json(request, { success: false, error: '激活码不存在' }, 404);
        }

        // ★ 核心安全边界：仅当本机 machineId 已在该激活码的绑定设备列表中，
        //   才返回原激活信息（重装/覆盖安装场景 machineId 不变 → 可自动恢复）
        const devices = getDevices(record);
        const bound = devices.some(d => d && d.machineId === machineId);
        if (!bound) {
            return json(request, { success: true, bound: false });
        }

        const userStr = String(record.user || record.username || '');
        // ★ 2026-09-03 优先读 license 记录的 phone 字段（admin-approve 生成的新记录都有；
        //   user 字段多为诊所名不含手机号，extractPhone 解析不到会害客户端自愈拿不到手机号）
        const phone = String(record.phone || '').trim() || extractPhone(userStr);
        const name = phone ? userStr.replace(phone, '').replace(/[/\-\s]+$/, '').trim() : userStr.trim();

        return json(request, {
            success: true,
            bound: true,
            user: userStr,
            name: name,
            phone: phone,
            clinicName: record.clinicName || record.activatedClinicName || '',
            status: record.status || 'used',
            expiresAt: record.expiresAt || null
        });

    } catch (error) {
        console.error('License lookup error:', error);
        return json(request, { success: false, error: '服务器内部错误，请稍后再试' }, 500);
    }
}

export async function onRequestOptions({ request }) {
    return new Response(null, { status: 204, headers: corsHeaders(request) });
}
