// ============================================================================
//  cloud-api.js - 云端 API 通信模块（从云端 index.html 提取）
//
//  依赖全局变量：
//    - currentUser: 当前登录用户对象
//    - _cloudReachable: 云端可达性标志
//    - updateModeStatus(): 更新状态栏 UI 函数
//
//  暴露全局：
//    - window.CLOUD_API_BASE: 云端 API 基础 URL
//    - window.cloudFetch(): 带认证、超时、错误处理的云端请求函数
//
//  仅在 appMode === 'cloud' 时加载
// ============================================================================

// Cloudflare KV API 地址
window.CLOUD_API_BASE = 'https://tcm-prescription-system.pages.dev/api';

// 云端同步辅助函数 - 对用户、处方、药品、方剂API启用
window.cloudFetch = async function(url, options = {}) {
    if (!url.includes('/users') && !url.includes('/prescriptions') &&
        !url.includes('/medicines') && !url.includes('/formulas') &&
        !url.includes('/platform-prescriptions')) {
        return { success: false, error: 'Non-allowed API disabled', fromCloud: false };
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000);

    // ===== 🔐 修复: 5 级 Token 兜底（wgj 历史处方关键!） =====
    let bearerToken = '';
    try {
      const extractFromUserJSON = (s) => { try { const u = JSON.parse(s); return (u && u.token) ? u.token : ''; } catch(e){ return '';} };
      if (options && options.headers && options.headers.Authorization) bearerToken = String(options.headers.Authorization).replace(/^Bearers+/i,'');
      if (!bearerToken && typeof localStorage !== 'undefined') {
        bearerToken = extractFromUserJSON(localStorage.getItem('auth:currentUser'));
        if (!bearerToken) bearerToken = extractFromUserJSON(localStorage.getItem('currentUser'));
        if (!bearerToken) bearerToken = extractFromUserJSON(localStorage.getItem('cloud_currentUser'));
        if (!bearerToken) bearerToken = localStorage.getItem('authToken') || '';
      }
      if (!bearerToken && typeof window !== 'undefined' && window.__FORCE_CLOUD_TOKEN__) bearerToken = window.__FORCE_CLOUD_TOKEN__;
      if (!bearerToken && typeof globalThis !== 'undefined' && globalThis.__FORCE_CLOUD_TOKEN__) bearerToken = globalThis.__FORCE_CLOUD_TOKEN__;
    } catch(e) {}
    options = options || {};
    options.headers = options.headers || {};
    if (bearerToken && !options.headers.Authorization) options.headers.Authorization = 'Bearer ' + bearerToken;

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
            if (_cloudReachable !== true) { _cloudReachable = true; updateModeStatus(); }
        } else {
            if (_cloudReachable !== false) { _cloudReachable = false; updateModeStatus(); }
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
        if (_cloudReachable !== false) {
            _cloudReachable = false;
            updateModeStatus();
        }
        return { success: false, error: error.message, fromCloud: false };
    }
};
