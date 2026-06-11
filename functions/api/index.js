// 通用API路由处理 - 分发请求到相应的处理函数

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
    
    // 根据路径分发请求
    if (pathname.startsWith('/api/prescriptions')) {
        return handlePrescriptions(context);
    } else if (pathname.startsWith('/api/users')) {
        return handleUsers(context);
    } else if (pathname.startsWith('/api/medicines')) {
        return handleMedicines(context);
    } else if (pathname.startsWith('/api/formulas')) {
        return handleFormulas(context);
    }
    
    return new Response(JSON.stringify({
        success: false,
        error: 'API endpoint not found'
    }), {
        status: 404,
        headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
        }
    });
}

// 导入并调用处方API处理
async function handlePrescriptions(context) {
    const { onRequest: handlePrescriptionRequest } = await import('./prescriptions.js');
    return handlePrescriptionRequest(context);
}

// 导入并调用用户API处理
async function handleUsers(context) {
    const { onRequest: handleUsersRequest } = await import('./users.js');
    return handleUsersRequest(context);
}

// 导入并调用药品API处理
async function handleMedicines(context) {
    const { onRequest: handleMedicinesRequest } = await import('./medicines.js').catch(() => null);
    if (!handleMedicinesRequest) {
        return new Response(JSON.stringify({
            success: false,
            error: 'Medicines API not implemented'
        }), {
            status: 501,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            }
        });
    }
    return handleMedicinesRequest(context);
}

// 导入并调用方剂API处理
async function handleFormulas(context) {
    const { onRequest: handleFormulasRequest } = await import('./formulas.js').catch(() => null);
    if (!handleFormulasRequest) {
        return new Response(JSON.stringify({
            success: false,
            error: 'Formulas API not implemented'
        }), {
            status: 501,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            }
        });
    }
    return handleFormulasRequest(context);
}