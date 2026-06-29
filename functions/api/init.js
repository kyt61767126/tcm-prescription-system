// ============================================================================
// 系统初始化 API（仅首次部署时使用）
// ============================================================================
// 端点契约：
//   GET  /api/init                    检查系统是否已初始化
//   POST /api/init                    初始化首个平台总管理员账号
// ============================================================================
// 安全策略：
// - 仅当 system:platform_admins 为空时允许 POST 初始化
// - 一旦创建过任意 platform_admin，此端点永久拒绝（403）
// - 初始化后建议通过 Cloudflare Pages 路由规则将 /api/init 下线
// ============================================================================
import {
    ROLE, KV_NS, parseAuthHeader,
    hashPassword, generateSalt,
    corsResponse, handleOptions, getKV
} from '../_lib/auth.js';

export async function onRequest(context) {
    const { request, env } = context;
    const method = request.method;

    if (method === 'OPTIONS') return handleOptions(request);

    try {
        const kv = getKV(env);
        if (!kv) {
            return corsResponse({
                success: false,
                error: 'KV存储未配置。请在Cloudflare Pages设置中配置KV binding',
                requireSetup: true
            }, { status: 500 });
        }

        const admins = await kv.get(KV_NS.PLATFORM_ADMINS, 'json');
        const initialized = Array.isArray(admins) && admins.length > 0;

        // GET：检查初始化状态（不暴露管理员列表）
        if (method === 'GET') {
            return corsResponse({
                success: true,
                initialized,
                platformAdminCount: initialized ? admins.length : 0
            });
        }

        // POST：首次初始化
        if (method === 'POST') {
            if (initialized) {
                return corsResponse({
                    success: false,
                    error: '系统已初始化，如需新增平台管理员请联系现有平台管理员或直接修改 KV',
                    initialized: true
                }, { status: 403 });
            }
            const body = await request.json();
            if (!body.username || !body.password) {
                return corsResponse({ success: false, error: '用户名与密码不能为空' }, { status: 400 });
            }
            if (body.password.length < 8) {
                return corsResponse({ success: false, error: '密码长度至少 8 位' }, { status: 400 });
            }
            const salt = generateSalt();
            const passwordHash = await hashPassword(body.password, salt);
            const newAdmin = {
                username: body.username,
                name: body.name || body.username,
                role: ROLE.PLATFORM_ADMIN,
                passwordHash,
                salt,
                createdAt: new Date().toISOString()
            };
            await kv.put(KV_NS.PLATFORM_ADMINS, JSON.stringify([newAdmin]));
            return corsResponse({
                success: true,
                message: '平台总管理员初始化成功，请妥善保管账号',
                admin: { username: newAdmin.username, name: newAdmin.name, role: newAdmin.role }
            });
        }

        return corsResponse({ success: false, error: 'Method not allowed' }, { status: 405 });
    } catch (error) {
        console.error('Init API error:', error);
        return corsResponse({
            success: false,
            error: error.message || 'Internal server error'
        }, { status: 500 });
    }
}
