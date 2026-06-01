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

// 使用KV存储生成处方编号
async function generatePrescriptionNo(kv, username, type) {
    const now = new Date();
    const year = now.getFullYear().toString().substring(2);
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const yymmdd = year + month + day;
    
    let storageKey, seq, prescriptionNo;
    
    if (type === 'yearly') {
        storageKey = `seq:${username}:yearly:${year}`;
        const stored = await kv.get(storageKey);
        seq = stored ? parseInt(stored, 10) : 0;
        seq += 1;
        await kv.put(storageKey, seq.toString());
        prescriptionNo = year + seq.toString().padStart(6, '0');
    } else {
        storageKey = `seq:${username}:daily:${yymmdd}`;
        const stored = await kv.get(storageKey);
        seq = stored ? parseInt(stored, 10) : 0;
        seq += 1;
        await kv.put(storageKey, seq.toString());
        prescriptionNo = yymmdd + seq.toString().padStart(2, '0');
    }
    
    return prescriptionNo;
}

// 获取下一个编号（不递增，用于预览）
async function peekNextPrescriptionNo(kv, username, type) {
    const now = new Date();
    const year = now.getFullYear().toString().substring(2);
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const yymmdd = year + month + day;
    
    let storageKey, seq, prescriptionNo;
    
    if (type === 'yearly') {
        storageKey = `seq:${username}:yearly:${year}`;
        const stored = await kv.get(storageKey);
        seq = stored ? parseInt(stored, 10) : 0;
        seq += 1;
        prescriptionNo = year + seq.toString().padStart(6, '0');
    } else {
        storageKey = `seq:${username}:daily:${yymmdd}`;
        const stored = await kv.get(storageKey);
        seq = stored ? parseInt(stored, 10) : 0;
        seq += 1;
        prescriptionNo = yymmdd + seq.toString().padStart(2, '0');
    }
    
    return prescriptionNo;
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
        
        // 支持多种KV绑定名称（Cloudflare配置中绑定名为KV）
        const envKeys = Object.keys(context.env || {});
        const kv = context.env.KV || 
                   context.env.TCM_PRESCRIPTION_KV || 
                   context.env['tcm-prescription-kv'] || 
                   context.env['TCM-PRESCRIPTION-KV'] ||
                   context.env.TCM_KV || 
                   context.env.PRESCRIPTION_KV;
        
        if (!kv) {
            console.error('KV binding not found. Available env keys:', envKeys);
            return new Response(JSON.stringify({
                success: false,
                error: 'KV存储未配置。请在Cloudflare Pages设置中配置KV binding，名称为TCM_PRESCRIPTION_KV',
                availableKeys: envKeys,
                requireSetup: true
            }), {
                status: 500,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                }
            });
        }
        
        const KV_PRESCRIPTIONS_KEY = 'prescriptions_all';
        
        // GET - 处理旧的编号请求端点（兼容旧客户端）
        if (method === 'GET') {
            if (url.pathname.includes('/current-prescription-no') || url.pathname.includes('/next-prescription-no')) {
                const type = url.searchParams.get('type') || 'daily';
                const now = new Date();
                const year = String(now.getFullYear()).slice(-2);
                const month = String(now.getMonth() + 1).padStart(2, '0');
                const day = String(now.getDate()).padStart(2, '0');
                
                let prescriptionNo;
                if (type === 'yearly') {
                    prescriptionNo = year + '000001';
                } else {
                    prescriptionNo = year + month + day + '01';
                }
                
                return new Response(JSON.stringify({
                    success: true,
                    prescriptionNo: prescriptionNo,
                    message: 'Using fallback number (old API)'
                }), {
                    status: 200,
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
            
            const now = new Date();
            const year = now.getFullYear().toString().substring(2);
            const formattedTotalCount = year + prescriptions.length.toString().padStart(6, '0');
            
            return new Response(JSON.stringify({
                success: true,
                data: filteredPrescriptions,
                count: filteredPrescriptions.length,
                totalCount: formattedTotalCount,
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
            console.log('POST /prescriptions called');
            console.log('Authorization header:', context.request.headers.get('Authorization'));
            console.log('Current user:', JSON.stringify(currentUser));
            
            let body;
            try {
                body = await context.request.json();
                console.log('Request body:', JSON.stringify(body).substring(0, 500));
            } catch (error) {
                console.error('Failed to parse request body:', error);
                return new Response(JSON.stringify({
                    success: false,
                    error: 'Failed to parse request body: ' + error.message
                }), {
                    status: 400,
                    headers: {
                        'Content-Type': 'application/json',
                        'Access-Control-Allow-Origin': '*'
                    }
                });
            }
            
            if (!body.prescription) {
                console.error('Missing prescription data in request');
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
            let nextPrescriptionNo = null;
            let nextClinicNo = null;
            let responseData;
            
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
                // 单条保存模式 - 后端自动分配编号（使用KV存储）
                // 获取短编号（YYMMDD + 当日序号）
                const outpatientNo = await generatePrescriptionNo(kv, currentUser.username, 'daily');
                
                console.log('Generated outpatientNo:', outpatientNo);
                
                const newPrescription = {
                    ...body.prescription,
                    id: body.prescription.id || Date.now(),
                    prescriptionNo: outpatientNo,
                    outpatientNo: outpatientNo,
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
                
                [nextPrescriptionNo, nextClinicNo] = await Promise.all([
                    peekNextPrescriptionNo(kv, currentUser.username, 'daily'),
                    peekNextPrescriptionNo(kv, currentUser.username, 'yearly')
                ]);
                
                responseData = {
                    success: true,
                    data: prescriptions,
                    savedPrescription: newPrescription,
                    count: prescriptions.length,
                    message: 'Prescriptions saved successfully',
                    nextPrescriptionNo: nextPrescriptionNo,
                    nextClinicNo: nextClinicNo
                };
            }
            
            // 保存到 KV
            try {
                console.log('Saving to KV, count:', prescriptions.length);
                await kv.put(KV_PRESCRIPTIONS_KEY, JSON.stringify(prescriptions));
                console.log('Saved to KV successfully');
            } catch (kvError) {
                console.error('KV put error:', kvError);
                return new Response(JSON.stringify({
                    success: false,
                    error: 'Failed to save to KV: ' + kvError.message,
                    requireSetup: true
                }), {
                    status: 500,
                    headers: {
                        'Content-Type': 'application/json',
                        'Access-Control-Allow-Origin': '*'
                    }
                });
            }
            
            // 返回响应（单条保存时已在上面定义responseData，批量保存时使用默认响应）
            if (!responseData) {
                responseData = {
                    success: true,
                    data: prescriptions,
                    count: prescriptions.length,
                    message: 'Prescriptions saved successfully'
                };
            }
            
            return new Response(JSON.stringify(responseData), {
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
