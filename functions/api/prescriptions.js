// 用户身份验证辅助函数
function parseAuthHeader(request) {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader) {
        return null;
    }
    
    try {
        if (authHeader.startsWith('Basic ')) {
            const base64Credentials = authHeader.substring(6);
            const credentials = atob(base64Credentials);
            const [username, role] = credentials.split(':');
            return { username, role, isAdmin: role === 'admin' };
        } else if (authHeader.startsWith('Bearer ')) {
            const token = authHeader.substring(7);
            return JSON.parse(atob(token));
        }
        return null;
    } catch (error) {
        console.error('Auth parsing error:', error);
        return null;
    }
}

export async function onRequest(context) {
    const url = new URL(context.request.url);
    const method = context.request.method;
    
    // 处理 CORS 预检请求
    if (method === 'OPTIONS') {
        return new Response(null, {
            status: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization',
                'Access-Control-Max-Age': '86400'
            }
        });
    }
    
    try {
        // 解析用户身份
        const currentUser = parseAuthHeader(context.request);
        if (!currentUser) {
            return new Response(JSON.stringify({
                success: false,
                error: '未授权访问，请先登录',
                requireAuth: true
            }), {
                status: 401,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                }
            });
        }
        
        // 支持多种KV绑定名称
        const envKeys = Object.keys(context.env || {});
        const kv = context.env.TCM_PRESCRIPTION_KV || 
                   context.env['tcm-prescription-kv'] || 
                   context.env['TCM-PRESCRIPTION-KV'] ||
                   context.env.KV || 
                   context.env.TCM_KV || 
                   context.env.PRESCRIPTION_KV;
        
        if (!kv) {
            console.error('KV binding not found. Available env keys:', envKeys);
            return new Response(JSON.stringify({
                success: false,
                error: 'KV binding not found. Please configure TCM_PRESCRIPTION_KV in Cloudflare Pages settings.',
                availableKeys: envKeys
            }), {
                status: 500,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                }
            });
        }
        
        const KV_PRESCRIPTIONS_KEY = 'prescriptions_all';
        
        // GET - 获取处方（根据用户角色筛选）
        if (method === 'GET') {
            let prescriptions = await kv.get(KV_PRESCRIPTIONS_KEY, 'json');
            if (!prescriptions) {
                prescriptions = [];
            }
            
            // 根据用户角色筛选数据
            let filteredPrescriptions = prescriptions;
            if (!currentUser.isAdmin) {
                // 普通用户只能看到自己的处方
                filteredPrescriptions = prescriptions.filter(p => 
                    p.createdBy === currentUser.username
                );
            }
            
            // 按时间倒序排序
            filteredPrescriptions.sort((a, b) => {
                const timeA = new Date(a.createdAt || a.date || 0).getTime();
                const timeB = new Date(b.createdAt || b.date || 0).getTime();
                return timeB - timeA;
            });
            
            return new Response(JSON.stringify({
                success: true,
                data: filteredPrescriptions,
                count: filteredPrescriptions.length,
                totalCount: prescriptions.length,
                userRole: currentUser.role,
                isAdmin: currentUser.isAdmin
            }), {
                status: 200,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                }
            });
        }
        
        // POST - 保存处方（支持单个或批量）
        if (method === 'POST') {
            const body = await context.request.json();
            
            if (!body.prescription) {
                return new Response(JSON.stringify({
                    success: false,
                    error: 'Missing prescription data'
                }), {
                    status: 400,
                    headers: {
                        'Content-Type': 'application/json',
                        'Access-Control-Allow-Origin': '*'
                    }
                });
            }
            
            let prescriptions = await kv.get(KV_PRESCRIPTIONS_KEY, 'json');
            if (!prescriptions) {
                prescriptions = [];
            }
            
            const now = new Date();
            const nowIso = now.toISOString();
            
            // 编号由前端从云端计数器获取，后端直接使用前端传递的编号
            if (Array.isArray(body.prescription)) {
                // 批量保存模式 - 对于批量导入的处方，保留原有编号
                const newPrescriptions = body.prescription.map(p => ({
                    ...p,
                    createdAt: p.createdAt || nowIso,
                    updatedAt: nowIso,
                    createdBy: p.createdBy || currentUser.username,
                    userId: p.userId || currentUser.username,
                    userRole: p.userRole || currentUser.role,
                    isAdmin: p.isAdmin || currentUser.isAdmin
                }));
                
                // 合并并去重（保留最新的）
                const idMap = new Map();
                [...prescriptions, ...newPrescriptions].forEach(p => {
                    idMap.set(p.id, p);
                });
                prescriptions = Array.from(idMap.values());
                
                // 按时间倒序排序
                prescriptions.sort((a, b) => {
                    const timeA = new Date(a.createdAt || a.date || 0).getTime();
                    const timeB = new Date(b.createdAt || b.date || 0).getTime();
                    return timeB - timeA;
                });
            } else {
                // 单条保存模式 - 使用前端传递的编号，添加用户身份信息
                const newPrescription = {
                    ...body.prescription,
                    id: body.prescription.id || Date.now(),
                    createdAt: body.prescription.createdAt || nowIso,
                    updatedAt: nowIso,
                    createdBy: currentUser.username,
                    userId: currentUser.username,
                    userRole: currentUser.role,
                    isAdmin: currentUser.isAdmin
                };
                
                // 去重
                prescriptions = prescriptions.filter(p => p.id !== newPrescription.id);
                prescriptions.push(newPrescription);
                
                // 按时间倒序排序，确保不同设备保存的处方按时间正确排列
                prescriptions.sort((a, b) => {
                    const timeA = new Date(a.createdAt || a.date || 0).getTime();
                    const timeB = new Date(b.createdAt || b.date || 0).getTime();
                    return timeB - timeA;
                });
            }
            
            // 保存到 KV
            await kv.put(KV_PRESCRIPTIONS_KEY, JSON.stringify(prescriptions));
            
            return new Response(JSON.stringify({
                success: true,
                data: prescriptions,
                count: prescriptions.length,
                message: 'Prescriptions saved successfully'
            }), {
                status: 200,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                }
            });
        }
        
        // DELETE - 删除处方（权限检查）
        if (method === 'DELETE') {
            const prescriptionId = url.searchParams.get('id');
            
            if (!prescriptionId) {
                return new Response(JSON.stringify({
                    success: false,
                    error: 'Missing prescription ID'
                }), {
                    status: 400,
                    headers: {
                        'Content-Type': 'application/json',
                        'Access-Control-Allow-Origin': '*'
                    }
                });
            }
            
            let prescriptions = await kv.get(KV_PRESCRIPTIONS_KEY, 'json');
            if (!prescriptions) {
                prescriptions = [];
            }
            
            // 查找要删除的处方
            const prescriptionToDelete = prescriptions.find(p => p.id.toString() === prescriptionId.toString());
            
            // 检查权限：只有创建者或管理员可以删除
            if (!prescriptionToDelete) {
                return new Response(JSON.stringify({
                    success: false,
                    error: 'Prescription not found'
                }), {
                    status: 404,
                    headers: {
                        'Content-Type': 'application/json',
                        'Access-Control-Allow-Origin': '*'
                    }
                });
            }
            
            if (prescriptionToDelete.createdBy !== currentUser.username && !currentUser.isAdmin) {
                return new Response(JSON.stringify({
                    success: false,
                    error: '无权删除此处方，只能删除自己创建的处方'
                }), {
                    status: 403,
                    headers: {
                        'Content-Type': 'application/json',
                        'Access-Control-Allow-Origin': '*'
                    }
                });
            }
            
            const initialLength = prescriptions.length;
            prescriptions = prescriptions.filter(p => p.id.toString() !== prescriptionId.toString());
            
            await kv.put(KV_PRESCRIPTIONS_KEY, JSON.stringify(prescriptions));
            
            return new Response(JSON.stringify({
                success: true,
                message: 'Prescription deleted successfully',
                deletedBy: currentUser.username
            }), {
                status: 200,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                }
            });
        }
        
        return new Response(JSON.stringify({
            success: false,
            error: 'Method not allowed'
        }), {
            status: 405,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            }
        });
        
    } catch (error) {
        console.error('KV API error:', error);
        return new Response(JSON.stringify({
            success: false,
            error: error.message || 'Internal server error'
        }), {
            status: 500,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            }
        });
    }
}
