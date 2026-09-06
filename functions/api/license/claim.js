// ============================================================================
//  claim.js — 激活统一认领端点（2026-09-07 P1 服务端收口②）
//
//  路由：POST /api/license/claim
//
//  P1 定位：统一认领门面——入口归一 + schema-guard 前置守门，实现转发
//    validate.js（诊所名绑定/手机号核验/换机解绑/邀请奖励等 465 行业务
//    逻辑原封不动；老客户端继续直调 validate，双轨并行零影响）。
//
//  与 validate 的差异（P2 客户端切换到 claim 的理由）：
//    ① machineId 进门先过 schema-guard 白名单——垃圾值连 license.devices
//      数组都进不去（老 validate 仅非空校验，是历史脏键事故的入口缺口，
//      setDeviceVersion 守门只挡了 device_version: 一类键，此处闭合最后缺口）
//    ② P2 起 claim 聚合全部激活方式（输码/管理员通过/工单/付款完成），
//      validate 降级为兼容别名后逐步退役
//
//  请求/响应：与 /api/license/validate 完全一致（行为等价，自测对拍保证）
// ============================================================================

import { onRequest as validateActivate } from './validate.js';
import { isValidMachineId } from './_lib/schema-guard.js';

// 拒绝响应的 CORS（与 validate.js 同款 Origin 白名单回显）
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

export async function onRequest(context) {
    const method = context.request.method;

    // OPTIONS / 非 POST：直接转发（validate 自带 CORS 与 405 语义，行为同源）
    if (method !== 'POST') {
        return validateActivate(context);
    }

    // ★ 前置守门：machineId 白名单校验（clone 读 body，不消费原 stream，
    //   validate 后续仍可正常 json()）
    try {
        const body = await context.request.clone().json().catch(() => ({}));
        const mid = String((body && body.machineId) || '').trim();
        if (mid && !isValidMachineId(mid)) {
            const origin = context.request.headers.get('Origin') || '';
            const allowedOrigin = (origin && ALLOWED_ORIGINS.includes(origin))
                ? origin : 'https://tcm-prescription-system.pages.dev';
            return new Response(JSON.stringify({
                success: false,
                error: '机器 ID 格式错误，请重启应用后重试（如持续出现请联系客服）'
            }), {
                status: 400,
                headers: {
                    'Access-Control-Allow-Origin': allowedOrigin,
                    'Vary': 'Origin',
                    'Content-Type': 'application/json'
                }
            });
        }
    } catch (_) { /* 预检失败不阻断，交给 validate 完整校验 */ }

    // 转发：claim = validate + 入口守门（P2 在此扩展聚合，实现不动）
    return validateActivate(context);
}
