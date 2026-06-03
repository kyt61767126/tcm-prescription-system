// 用户身份验证辅助函数
function safeAtob(str) {
    try {
        const decoded = atob(str);
        return decodeURIComponent(Array.prototype.map.call(decoded, function(c) {
            return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
        }).join(''));
    } catch (e) {
        return atob(str);
    }
}

// 获取东八区当前时间
function getBeijingTime() {
    const now = new Date();
    // 转换为东八区时间
    const beijingTime = new Date(now.getTime() + (8 * 60 * 60 * 1000));
    return beijingTime;
}

// 格式化东八区日期为 YYMMDD
function formatBeijingDateYYMMDD(date) {
    const year = date.getUTCFullYear().toString().substring(2);
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    return year + month + day;
}

// 清洗历史异常编码 - 将时间戳格式转换为标准 YYMMDD + 序号
function cleanHistoricalPrescriptionNo(prescription, index, dateGroups) {
    let no = prescription.outpatientNo || prescription.prescriptionNo || '';
    
    // 如果已经是标准格式（6-8位数字），直接返回
    if (/^\d{6,8}$/.test(no)) {
        return no;
    }
    
    // 尝试解析时间戳
    let timestamp = null;
    if (/^\d{10}$/.test(no)) {
        timestamp = parseInt(no) * 1000;
    } else if (/^\d{13}$/.test(no)) {
        timestamp = parseInt(no);
    } else if (prescription.id && /^\d{10,13}$/.test(prescription.id.toString())) {
        const idStr = prescription.id.toString();
        timestamp = idStr.length === 10 ? parseInt(idStr) * 1000 : parseInt(idStr);
    } else if (prescription.createdAt) {
        timestamp = new Date(prescription.createdAt).getTime();
    }
    
    if (timestamp) {
        const date = new Date(timestamp);
        // 使用东八区时间
        const beijingDate = new Date(date.getTime() + (8 * 60 * 60 * 1000));
        const yymmdd = formatBeijingDateYYMMDD(beijingDate);
        
        if (!dateGroups[yymmdd]) {
            dateGroups[yymmdd] = 0;
        }
        dateGroups[yymmdd]++;
        
        return yymmdd + String(dateGroups[yymmdd]).padStart(2, '0');
    }
    
    // 都无法解析，返回默认
    const now = getBeijingTime();
    const yymmdd = formatBeijingDateYYMMDD(now);
    if (!dateGroups[yymmdd]) {
        dateGroups[yymmdd] = 0;
    }
    dateGroups[yymmdd]++;
    return yymmdd + String(dateGroups[yymmdd]).padStart(2, '0');
}

// 用户身份验证辅助函数（简化版，确保登录兼容性）
function parseAuthHeaderSimple(request) {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader) {
        return null;
    }
    
    try {
        if (authHeader.startsWith('Basic ')) {
            const base64Credentials = authHeader.substring(6);
            const credentials = safeAtob(base64Credentials);
            const [username, role] = credentials.split(':');
            return { 
                username, 
                role, 
                isAdmin: role === 'admin',
                allowSavePrescription: true  // 默认允许保存
            };
        } else if (authHeader.startsWith('Bearer ')) {
            const token = authHeader.substring(7);
            const userInfo = JSON.parse(safeAtob(token));
            return {
                ...userInfo,
                allowSavePrescription: true
            };
        }
        return null;
    } catch (error) {
        console.error('Auth parsing error:', error);
        return null;
    }
}

// 使用KV存储生成处方编号（东八区时间）
async function generatePrescriptionNo(kv, username, type) {
    const now = getBeijingTime();
    const year = now.getUTCFullYear().toString().substring(2);
    const yymmdd = formatBeijingDateYYMMDD(now);
    
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

// 获取下一个编号（不递增，用于预览，东八区时间）
async function peekNextPrescriptionNo(kv, username, type) {
    const now = getBeijingTime();
    const year = now.getUTCFullYear().toString().substring(2);
    const yymmdd = formatBeijingDateYYMMDD(now);
    
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

// 获取默认药品库
function getDefaultMedicines() {
    return [
        { id: 1, name: "麻黄", code: "mh", unit: "g", defaultDosage: 6 },
        { id: 2, name: "桂枝", code: "gz", unit: "g", defaultDosage: 6 },
        { id: 3, name: "杏仁", code: "xr", unit: "g", defaultDosage: 9 },
        { id: 4, name: "甘草", code: "gc", unit: "g", defaultDosage: 3 },
        { id: 5, name: "石膏", code: "sg", unit: "g", defaultDosage: 15 },
        { id: 6, name: "知母", code: "zm", unit: "g", defaultDosage: 9 },
        { id: 7, name: "黄连", code: "hl", unit: "g", defaultDosage: 3 },
        { id: 8, name: "黄芩", code: "hq", unit: "g", defaultDosage: 6 },
        { id: 9, name: "黄柏", code: "hb", unit: "g", defaultDosage: 6 },
        { id: 10, name: "栀子", code: "zz", unit: "g", defaultDosage: 6 }
    ];
}

export async function onRequest(context) {
    const url = new URL(context.request.url);
    const method = context.request.method;
    const pathname = url.pathname;
    
    // 处理 CORS 预检请求
    if (method === 'OPTIONS') {
        return new Response(null, {
            status: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization',
                'Access-Control-Max-Age': '86400'
            }
        });
    }
    
    try {
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
        
        // KV 存储 key 定义
        const KV_PRESCRIPTIONS_KEY = 'prescriptions_all';
        const KV_MEDICINES_KEY = 'medicines_all';
        const KV_FORMULAS_KEY = 'formulas_all';
        
        // 解析用户身份（简化版，确保登录兼容性）
        const currentUser = parseAuthHeaderSimple(context.request);
        
        // ============ 药品库 API ============
        if (pathname.includes('/medicines')) {
            if (method === 'GET') {
                let medicines = await kv.get(KV_MEDICINES_KEY, 'json');
                if (!medicines || !Array.isArray(medicines) || medicines.length === 0) {
                    medicines = getDefaultMedicines();
                    await kv.put(KV_MEDICINES_KEY, JSON.stringify(medicines));
                }
                return new Response(JSON.stringify({
                    success: true,
                    data: medicines
                }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
                });
            }
            
            if (!currentUser) {
                return new Response(JSON.stringify({ success: false, error: '未授权访问' }), { status: 401, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
            }
            
            if (method === 'POST' || method === 'PUT') {
                if (!currentUser.isAdmin) {
                    return new Response(JSON.stringify({ success: false, error: '仅管理员可管理药品库' }), { status: 403, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
                }
                const body = await context.request.json();
                if (body.medicines && Array.isArray(body.medicines)) {
                    await kv.put(KV_MEDICINES_KEY, JSON.stringify(body.medicines));
                    return new Response(JSON.stringify({ success: true, message: '药品库保存成功' }), { status: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
                }
                return new Response(JSON.stringify({ success: false, error: '无效的药品数据' }), { status: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
            }
        }
        
        // ============ 方剂库 API ============
        if (pathname.includes('/formulas')) {
            if (method === 'GET') {
                let formulas = await kv.get(KV_FORMULAS_KEY, 'json');
                if (!formulas || !Array.isArray(formulas)) {
                    formulas = [];
                    await kv.put(KV_FORMULAS_KEY, JSON.stringify(formulas));
                }
                return new Response(JSON.stringify({
                    success: true,
                    data: formulas
                }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
                });
            }
            
            if (!currentUser) {
                return new Response(JSON.stringify({ success: false, error: '未授权访问' }), { status: 401, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
            }
            
            if (method === 'POST' || method === 'PUT') {
                const body = await context.request.json();
                if (body.formulas && Array.isArray(body.formulas)) {
                    const formulasWithOwner = body.formulas.map(f => ({
                        ...f,
                        createdBy: f.createdBy || currentUser.username,
                        updatedAt: new Date().toISOString()
                    }));
                    let existingFormulas = await kv.get(KV_FORMULAS_KEY, 'json') || [];
                    if (currentUser.isAdmin) {
                        existingFormulas = formulasWithOwner;
                    } else {
                        const userFormulas = existingFormulas.filter(f => f.createdBy === currentUser.username);
                        const otherFormulas = existingFormulas.filter(f => f.createdBy !== currentUser.username);
                        existingFormulas = [...otherFormulas, ...formulasWithOwner.filter(f => f.createdBy === currentUser.username)];
                    }
                    await kv.put(KV_FORMULAS_KEY, JSON.stringify(existingFormulas));
                    return new Response(JSON.stringify({ success: true, message: '方剂库保存成功', data: existingFormulas }), { status: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
                }
                return new Response(JSON.stringify({ success: false, error: '无效的方剂数据' }), { status: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
            }
        }
        
        // ============ 处方 API 需要认证 ============
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
            
            // 按时间戳升序排序（最早的在前，确保编号按创建顺序生成）
            const sortedForSeq = [...filteredPrescriptions].sort((a, b) => {
                const idA = typeof a.id === 'number' ? a.id : 0;
                const idB = typeof b.id === 'number' ? b.id : 0;
                return idA - idB;
            });
            
            // 清洗历史异常编码，统一为标准格式
            const dateCounter = {};
            let needsUpdate = false;
            
            filteredPrescriptions = sortedForSeq.map((p, index) => {
                const cleanNo = cleanHistoricalPrescriptionNo(p, index, dateCounter);
                const currentNo = p.outpatientNo || p.prescriptionNo || '';
                
                if (cleanNo !== currentNo) {
                    needsUpdate = true;
                    return {
                        ...p,
                        prescriptionNo: cleanNo,
                        outpatientNo: cleanNo
                    };
                }
                return p;
            });
            
            // 按编号倒序排序（编号大的排在前面）
            filteredPrescriptions.sort((a, b) => {
                const noA = a.outpatientNo || a.prescriptionNo || '';
                const noB = b.outpatientNo || b.prescriptionNo || '';
                return noB.localeCompare(noA);
            });
            
            // 如果有编码被清洗，保存回KV存储
            if (needsUpdate) {
                const updatedPrescriptions = [...prescriptions];
                filteredPrescriptions.forEach(p => {
                    const index = updatedPrescriptions.findIndex(item => item.id === p.id);
                    if (index !== -1) {
                        updatedPrescriptions[index] = p;
                    }
                });
                await kv.put(KV_PRESCRIPTIONS_KEY, JSON.stringify(updatedPrescriptions));
            }
            
            const now = getBeijingTime();
            const year = now.getUTCFullYear().toString().substring(2);
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
            
            // 检查保存处方权限
            if (currentUser.allowSavePrescription === false) {
                return new Response(JSON.stringify({
                    success: false,
                    error: '您没有保存处方的权限，请联系管理员开通'
                }), {
                    status: 403,
                    headers: {
                        'Content-Type': 'application/json',
                        'Access-Control-Allow-Origin': '*'
                    }
                });
            }
            
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
            
            const now = getBeijingTime();
            const nowIso = now.toISOString();
            
            // 简化处理：统一处理单条和批量
            let prescriptionList = Array.isArray(body.prescription) ? body.prescription : [body.prescription];
            
            // 为每个处方生成编号
            const savedPrescriptions = [];
            for (const p of prescriptionList) {
                const outpatientNo = await generatePrescriptionNo(kv, currentUser.username, 'daily');
                const newPrescription = {
                    ...p,
                    id: p.id || Date.now(),
                    prescriptionNo: outpatientNo,
                    outpatientNo: outpatientNo,
                    createdAt: p.createdAt || nowIso,
                    updatedAt: nowIso,
                    createdBy: currentUser.username,
                    userId: currentUser.username,
                    userRole: currentUser.role,
                    isAdmin: currentUser.isAdmin
                };
                savedPrescriptions.push(newPrescription);
            }
            
            // 合并并去重
            const idMap = new Map();
            [...prescriptions, ...savedPrescriptions].forEach(p => {
                idMap.set(p.id, p);
            });
            prescriptions = Array.from(idMap.values());
            
            // 按编号倒序排序
            prescriptions.sort((a, b) => {
                const noA = a.outpatientNo || a.prescriptionNo || '';
                const noB = b.outpatientNo || b.prescriptionNo || '';
                return noB.localeCompare(noA);
            });
            
            // 获取下一个编号
            const [nextPrescriptionNo, nextClinicNo] = await Promise.all([
                peekNextPrescriptionNo(kv, currentUser.username, 'daily'),
                peekNextPrescriptionNo(kv, currentUser.username, 'yearly')
            ]);
            
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
            
            // 返回响应
            const responseData = {
                success: true,
                data: prescriptions,
                savedPrescription: savedPrescriptions[0],
                count: prescriptions.length,
                message: 'Prescriptions saved successfully',
                nextPrescriptionNo: nextPrescriptionNo,
                nextClinicNo: nextClinicNo,
                userRole: currentUser.role,
                isAdmin: currentUser.isAdmin
            };
            
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
