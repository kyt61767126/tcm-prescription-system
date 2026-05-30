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
        const kv = context.env.TCM_PRESCRIPTION_KV;
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
        
        // POST - 保存处方
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
            
            // 添加新处方
            const newPrescription = {
                ...body.prescription,
                id: Date.now(),
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };
            
            prescriptions.unshift(newPrescription);
            
            // 保存到 KV
            await kv.put(KV_PRESCRIPTIONS_KEY, JSON.stringify(prescriptions));
            
            return new Response(JSON.stringify({
                success: true,
                data: newPrescription,
                message: 'Prescription saved successfully'
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
