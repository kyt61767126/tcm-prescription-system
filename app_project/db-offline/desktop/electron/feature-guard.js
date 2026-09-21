// ============================================================================
//  feature-guard.js — 功能权限校验（v2 版本管理）
//  功能：根据 license type/features 校验用户是否有权使用某功能
//  使用场景：数据备份/云端同步/多设备登录等专业版功能
//  调用：渲染进程通过 IPC 调用 checkFeature()/getAvailableFeatures()
// ============================================================================

const licenseManager = require('./license-manager');

// ★ 功能名称常量（避免硬编码字符串出错）
// ★ 2026-09-21 离线免费版（free）新增四个付费功能位：
//   DATA_EXPORT   数据导入导出（Excel/CSV 药库导入导出、历史处方导出、统计报表导出）
//   MEDIA_CAPTURE 拍照/录像
//   PRINT_CLEAN   无水印打印（免费版可打印但带「惠康中医免费版」水印）
//   VOICE_INPUT   语音录入（整方智能解析面板；2026-09-21 真机复测后用户拍板纳入）
const FEATURES = {
    BACKUP: 'backup',                    // 数据备份（一键备份/恢复/自动备份）
    SYNC: 'sync',                        // 云端同步
    MULTI_DEVICE: 'multi-device',        // 多设备登录
    PRIORITY_SUPPORT: 'priority-support',// 优先技术支持
    DATA_EXPORT: 'data-export',          // ★ 免费版付费墙：Excel/CSV 导入导出 + 统计报表导出
    MEDIA_CAPTURE: 'media-capture',      // ★ 免费版付费墙：拍照/录像
    PRINT_CLEAN: 'print-clean',          // ★ 免费版付费墙：无水印打印
    VOICE_INPUT: 'voice-input'           // ★ 免费版付费墙：语音录入（整方解析）
};

// ★ 功能中文名称映射（供 UI 显示）
const FEATURE_NAMES_CN = {
    'backup': '数据备份',
    'sync': '云端同步',
    'multi-device': '多设备登录',
    'priority-support': '优先技术支持',
    'data-export': 'Excel/CSV 导入导出',
    'media-capture': '拍照/录像',
    'print-clean': '无水印打印',
    'voice-input': '语音录入'
};

// ============================================================================
//  核心逻辑
// ============================================================================

// 检查是否有某功能权限
function hasFeature(featureName) {
    return licenseManager.hasFeature(featureName);
}

// 获取当前 license 类型
function getLicenseType() {
    return licenseManager.getLicenseType();
}

// ★ 2026-09-21 离线免费版付费墙：唯一墙标准 = licenseType === 'free'
//   设计依据（.trae/documents/离线免费版_plan.md）：free 复用 edition=personal，
//   免费差异全部由 license.type=free 表达。
//   - trial（无 license / 验签失败）= 评估期，全部功能放行（保持评估体验）；
//   - 历史付费 license 内嵌 features 可能不含 data-export/media-capture/print-clean
//     新位，不能因 checkFeature().allowed=false 误伤付费用户；
//   - 仅 free 签名 license（features 恒 []）被墙。
// 返回 true 仅当主进程确证当前为 free 档；任何异常返回 false（此函数只用于
// 「证明免费后拒绝」，拒绝动作在各执行点 fail-closed 包装内完成）。
function isFreeEdition() {
    try {
        return getLicenseType() === 'free';
    } catch (e) {
        console.warn('[FeatureGuard] isFreeEdition 判定异常:', e && e.message);
        return false;
    }
}

// 校验功能权限，返回 { allowed: boolean, message: string }
function checkFeature(featureName) {
    if (hasFeature(featureName)) {
        return {
            allowed: true,
            message: '功能可用',
            feature: featureName,
            featureName: FEATURE_NAMES_CN[featureName] || featureName
        };
    }
    const cnName = FEATURE_NAMES_CN[featureName] || featureName;
    const licenseType = getLicenseType();
    let upgradeHint = '';
    if (licenseType === 'free') {
        // ★ 2026-09-21 离线免费版：所有付费功能位缺失时的统一升级引导
        upgradeHint = '当前为【离线免费版】，升级标准版后即可使用此功能（开方、处方记录等基本功能永久免费）。';
    } else if (licenseType === 'trial') {
        upgradeHint = '当前为试用版，购买标准版或机构版后可使用此功能。';
    } else if (licenseType === 'personal') {
        upgradeHint = '当前为标准版，升级到机构版后可使用此功能。';
    } else {
        upgradeHint = '当前授权不支持此功能，请联系客服升级。';
    }
    return {
        allowed: false,
        message: '[' + cnName + '] 功能不可用。\n' + upgradeHint,
        feature: featureName,
        featureName: cnName,
        licenseType: licenseType
    };
}

// 获取当前 license 可用的所有功能列表
// ★ 第三轮终检 P1 修复（2026-08-16）：readLicense 只解密不验签，features 字段
//   可被篡改伪造功能列表。现使用前必须 verifySignature，验签失败返回空列表
//   （fail-closed；hasFeature/checkFeature 本就验签，此处对齐）。
function getAvailableFeatures() {
    const license = licenseManager.readLicense();
    if (!license) {
        // 试用模式
        return [];
    }
    try {
        if (typeof licenseManager.verifySignature === 'function' && !licenseManager.verifySignature(license)) {
            console.warn('[FeatureGuard] license 验签失败，功能列表返回空');
            return [];
        }
    } catch (e) {
        console.warn('[FeatureGuard] license 验签异常，功能列表返回空:', e.message);
        return [];
    }
    const normalized = licenseManager.normalizeLicense(license);
    return Array.isArray(normalized.features) ? normalized.features : [];
}

// 获取所有功能及其可用状态（供 UI 显示功能矩阵）
function getFeatureStatus() {
    const available = getAvailableFeatures();
    const allFeatures = Object.values(FEATURES);
    return allFeatures.map(f => ({
        feature: f,
        name: FEATURE_NAMES_CN[f] || f,
        available: available.indexOf(f) !== -1
    }));
}

// 便捷方法：检查备份权限
function checkBackup() {
    return checkFeature(FEATURES.BACKUP);
}

// 便捷方法：检查同步权限
function checkSync() {
    return checkFeature(FEATURES.SYNC);
}

// 便捷方法：检查多设备权限
function checkMultiDevice() {
    return checkFeature(FEATURES.MULTI_DEVICE);
}

// ★ 2026-09-21 免费版付费墙便捷方法（主进程 IPC fail-closed 用）
function checkDataExport() {
    return checkFeature(FEATURES.DATA_EXPORT);
}
function checkMediaCapture() {
    return checkFeature(FEATURES.MEDIA_CAPTURE);
}
function checkPrintClean() {
    return checkFeature(FEATURES.PRINT_CLEAN);
}
function checkVoiceInput() {
    return checkFeature(FEATURES.VOICE_INPUT);
}

module.exports = {
    FEATURES,
    FEATURE_NAMES_CN,
    hasFeature,
    getLicenseType,
    isFreeEdition,
    checkFeature,
    getAvailableFeatures,
    getFeatureStatus,
    checkBackup,
    checkSync,
    checkMultiDevice,
    checkDataExport,
    checkMediaCapture,
    checkPrintClean,
    checkVoiceInput
};
