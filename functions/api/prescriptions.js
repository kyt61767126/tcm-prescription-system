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
        
        // GET - 获取所有处方
        if (method === 'GET') {
            let prescriptions = await kv.get(KV_PRESCRIPTIONS_KEY, 'json');
            if (!prescriptions) {
                prescriptions = [];
            }
            
            return new Response(JSON.stringify({
                success: true,
                data: prescriptions,
                count: prescriptions.length
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
            
            const now = new Date().toISOString();
            
            if (Array.isArray(body.prescription)) {
                // 批量保存模式
                const newPrescriptions = body.prescription.map(p => ({
                    ...p,
                    createdAt: p.createdAt || now,
                    updatedAt: now
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
                // 单条保存模式
                const newPrescription = {
                    ...body.prescription,
                    id: body.prescription.id || Date.now(),
                    createdAt: body.prescription.createdAt || now,
                    updatedAt: now
                };
                
                // 去重
                prescriptions = prescriptions.filter(p => p.id !== newPrescription.id);
                prescriptions.unshift(newPrescription);
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
        
        // DELETE - 删除处方
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
            
            const initialLength = prescriptions.length;
            prescriptions = prescriptions.filter(p => p.id.toString() !== prescriptionId.toString());
            
            if (prescriptions.length === initialLength) {
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
            
            await kv.put(KV_PRESCRIPTIONS_KEY, JSON.stringify(prescriptions));
            
            return new Response(JSON.stringify({
                success: true,
                message: 'Prescription deleted successfully'
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
