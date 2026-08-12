// ============================================================================
//  cloud-api.js - 云端 API 通信模块
//
//  暴露全局：
//    - window.CLOUD_API_BASE: 云端 API 基础 URL
//    - window.cloudFetch(): 带认证、超时、错误处理的云端请求函数
//
//  兼容：自动适配 _cloudReachable / updateModeStatus 缺失场景
// ============================================================================

// Cloudflare KV API 地址
window.CLOUD_API_BASE = 'https://tcm-prescription-system.pages.dev/api';

// 确保全局变量存在（兼容不同版本的 index.html）
if (typeof window._cloudReachable === 'undefined') {
    window._cloudReachable = null;
}
if (typeof window.updateModeStatus !== 'function') {
    window.updateModeStatus = function() { /* no-op */ };
}

// 云端同步辅助函数 - 对用户、处方、药品、方剂API启用
window.cloudFetch = async function(url, options = {}) {
    if (!url.includes('/users') && !url.includes('/prescriptions') &&
        !url.includes('/medicines') && !url.includes('/formulas') &&
        !url.includes('/platform-prescriptions')) {
        return { success: false, error: 'Non-allowed API disabled', fromCloud: false };
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    try {
        const response = await fetch(url, {
            ...options,
            signal: controller.signal,
            cache: 'no-cache',
            headers: {
                'Content-Type': 'application/json',
                ...options.headers
            }
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            const errorText = await response.text();
            console.error('Cloud fetch HTTP error, status:', response.status);
            // 检测 401 认证失效：自动清除登录状态并跳转登录界面
            if (response.status === 401) {
                let parsed = null;
                try { parsed = JSON.parse(errorText.replace(/^\uFEFF/, '').trim()); } catch(e) {}
                if (parsed && parsed.requireAuth === true) {
                    console.warn('[Auth] Token 已过期或无效，触发重新登录');
                    try {
                        currentUser = null;
                        if (window.AuthCore && AuthCore.logout) {
                            AuthCore.logout().catch(e => console.warn('AuthCore.logout failed:', e));
                        }
                        localStorage.removeItem('cloud_currentUser');
                        localStorage.removeItem('cloud_isLoggedIn');
                        localStorage.removeItem('currentUser');
                        localStorage.removeItem('isLoggedIn');
                        sessionStorage.removeItem('currentUser');
                    } catch(e) {}
                    const overlay = document.getElementById('loginOverlay');
                    if (overlay) overlay.style.display = 'flex';
                    return { success: false, error: '登录已过期，请重新登录', requireAuth: true, fromCloud: true };
                }
            }
            throw new Error('HTTP error! status: ' + response.status);
        }

        const text = await response.text();
        const cleanText = text.replace(/^\uFEFF/, '').trim();
        const data = JSON.parse(cleanText);

        const isReachable = !(data && data.success === false);
        if (isReachable) {
            if (window._cloudReachable !== true) { window._cloudReachable = true; window.updateModeStatus(); }
        } else {
            if (window._cloudReachable !== false) { window._cloudReachable = false; window.updateModeStatus(); }
        }

        if (Array.isArray(data) || typeof data === 'object' && data !== null) {
            if (Array.isArray(data)) {
                return { success: true, fromCloud: true, data: data };
            }
            if (data.success === undefined) {
                return { ...data, success: true, fromCloud: true };
            }
            return { ...data, fromCloud: true };
        }

        throw new Error('Invalid response format');

    } catch (error) {
        clearTimeout(timeoutId);
        console.error('Cloud sync failed:', error.message);
        if (window._cloudReachable !== false) {
            window._cloudReachable = false;
            window.updateModeStatus();
        }
        return { success: false, error: error.message, fromCloud: false };
    }
};
