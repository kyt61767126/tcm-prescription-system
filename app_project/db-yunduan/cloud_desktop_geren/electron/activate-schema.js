// ============================================================================
//  activate-schema.js — 激活流程统一数据Schema + 校验规则 + 错误码
//
//  设计原则（基于3个优化经验）：
//    ① 单一事实源：所有校验规则（手机格式、密码强度、必填字段）在此处定义
//    ② 结构化错误码：每个失败有明确的 step + reason code，前端可精准提示
//    ③ 前后端共用：前端HTML/JS用同一套常量，后端Node.js也引用
//    ④ Schema冻结：激活数据结构不可随意变更，版本号锁定
// ============================================================================

'use strict';

// ★ 激活数据Schema（v2.0，合并激活+注册）
const ACTIVATION_SCHEMA = {
    version: '2.0',
    fields: {
        clinicName:  { type: 'string', required: true,  maxLength: 100, label: '诊所名称' },
        adminName:   { type: 'string', required: true,  maxLength: 50,  label: '管理员/医师姓名' },
        phone:       { type: 'string', required: true,  pattern: 'phone', label: '联系电话' },
        password:    { type: 'string', required: true,  minLength: 8,  pattern: 'password', label: '登录密码' },
        password2:   { type: 'string', required: true,  matchField: 'password', label: '确认密码' },
        remark:      { type: 'string', required: false, maxLength: 500, label: '备注说明' }
    }
};

// ★ 统一校验规则（单点源，前端+后端共用）
const VALIDATORS = {
    // 中国大陆11位手机号（13-19开头）
    phone: {
        regex: /^1[3-9]\d{9}$/,
        message: '请输入正确的11位手机号',
        sanitize: (v) => (v || '').replace(/[^\d]/g, '').slice(0, 11)
    },
    // 密码：≥8位 + 同时包含字母和数字
    password: {
        minLength: 8,
        requireLetter: true,
        requireDigit: true,
        message: '密码至少8位，需同时包含字母和数字',
        validate: (v) => {
            if (!v || v.length < 8) return false;
            if (!/[a-zA-Z]/.test(v)) return false;
            if (!/\d/.test(v)) return false;
            return true;
        }
    },
    // 激活码格式
    activationCode: {
        regex: /^BNZC-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/i,
        message: '激活码格式错误，应为 BNZC-XXXX-XXXX-XXXX-XXXX',
        sanitize: (v) => (v || '').toUpperCase().replace(/[^A-Z0-9-]/g, '')
    },
    // 诊所名（不含特殊字符）
    clinicName: {
        maxLength: 100,
        forbidChars: '|<>\\{}\\$`',
        sanitize: (v) => (v || '').replace(/[|<>\\{}[\\]`]/g, '').trim(),
        message: '诊所名称包含非法字符'
    }
};

// ★ 结构化错误码（每个失败有精准定位）
const ERROR_CODES = {
    // 表单校验
    FIELD_REQUIRED:          { code: 'E100', field: null, message: '必填字段未填写' },
    FIELD_TOO_SHORT:         { code: 'E101', field: null, message: '内容过短' },
    FIELD_TOO_LONG:          { code: 'E102', field: null, message: '内容过长' },
    PHONE_FORMAT:            { code: 'E110', field: 'phone',   message: '手机号格式错误' },
    PHONE_REQUIRED:          { code: 'E111', field: 'phone',   message: '请填写手机号' },
    PASSWORD_WEAK:           { code: 'E120', field: 'password', message: '密码需至少8位且包含字母和数字' },
    PASSWORD_MISMATCH:       { code: 'E121', field: 'password2', message: '两次密码输入不一致' },
    CLINIC_NAME_INVALID:     { code: 'E130', field: 'clinicName', message: '诊所名称包含非法字符' },
    ACTIVATION_CODE_FORMAT:  { code: 'E140', field: 'code',     message: '激活码格式错误' },
    // 提交/网络
    SUBMIT_NETWORK:          { code: 'E200', message: '网络连接失败，请检查网络' },
    SUBMIT_SERVER_ERROR:     { code: 'E201', message: '服务器错误，请稍后重试' },
    SUBMIT_RATE_LIMIT:       { code: 'E202', message: '请求过于频繁，请稍后重试' },
    SUBMIT_DUPLICATE:        { code: 'E203', message: '该激活请求已提交，请勿重复提交' },
    // 审核状态
    STATUS_PENDING:          { code: 'S300', message: '审核中，请耐心等待' },
    STATUS_REJECTED:         { code: 'S301', message: '审核未通过，请联系管理员' },
    STATUS_CANCELLED:        { code: 'S302', message: '激活请求已取消' },
    STATUS_NOT_FOUND:        { code: 'S303', message: '未找到激活请求记录' },
    // License
    LICENSE_WRITE_FAILED:    { code: 'E400', message: 'License文件写入失败' },
    LICENSE_BINDING_MISMATCH:{ code: 'E401', message: 'License与当前机器不匹配' },
    LICENSE_SIGNATURE_INVALID:{code: 'E402', message: 'License签名无效' },
    // 系统
    SYSTEM_BUSY:             { code: 'E500', message: '系统繁忙，请稍后重试' },
    SYSTEM_UNKNOWN:          { code: 'E599', message: '未知错误，请联系客服' }
};

// ★ 前端校验（activate-window.html直接引用此模块的函数）
function validateActivationForm(data) {
    const errors = [];
    const getErr = (template, field) => ({ ...template, field });

    // 1) 必填检查
    if (!data.clinicName || !data.clinicName.trim())
        errors.push(getErr(ERROR_CODES.FIELD_REQUIRED, 'clinicName'));
    if (!data.adminName || !data.adminName.trim())
        errors.push(getErr(ERROR_CODES.FIELD_REQUIRED, 'adminName'));
    if (!data.phone)
        errors.push(getErr(ERROR_CODES.PHONE_REQUIRED, 'phone'));
    if (!data.password)
        errors.push(getErr(ERROR_CODES.FIELD_REQUIRED, 'password'));
    if (!data.password2)
        errors.push(getErr(ERROR_CODES.FIELD_REQUIRED, 'password2'));

    // 2) 格式检查
    if (data.phone && !VALIDATORS.phone.regex.test(data.phone))
        errors.push(getErr(ERROR_CODES.PHONE_FORMAT, 'phone'));

    // 3) 密码强度
    if (data.password && !VALIDATORS.password.validate(data.password))
        errors.push(getErr(ERROR_CODES.PASSWORD_WEAK, 'password'));

    // 4) 密码一致性
    if (data.password && data.password2 && data.password !== data.password2)
        errors.push(getErr(ERROR_CODES.PASSWORD_MISMATCH, 'password2'));

    // 5) 诊所名非法字符
    if (data.clinicName) {
        const sanitized = VALIDATORS.clinicName.sanitize(data.clinicName);
        if (sanitized !== data.clinicName)
            errors.push(getErr(ERROR_CODES.CLINIC_NAME_INVALID, 'clinicName'));
    }

    // 6) 长度检查
    if (data.clinicName && data.clinicName.length > 100)
        errors.push(getErr(ERROR_CODES.FIELD_TOO_LONG, 'clinicName'));
    if (data.adminName && data.adminName.length > 50)
        errors.push(getErr(ERROR_CODES.FIELD_TOO_LONG, 'adminName'));
    if (data.remark && data.remark.length > 500)
        errors.push(getErr(ERROR_CODES.FIELD_TOO_LONG, 'remark'));

    return {
        valid: errors.length === 0,
        errors,
        firstError: errors[0] || null
    };
}

// ★ 统一返回结构（IPC所有handler必须用此包装）
function okResult(data, extra = {}) {
    return { success: true, data, ...extra };
}
function errResult(code, message, extra = {}) {
    const err = typeof code === 'object' ? code : (ERROR_CODES[code] || ERROR_CODES.SYSTEM_UNKNOWN);
    return {
        success: false,
        error: { code: err.code, message: message || err.message, field: err.field },
        ...extra
    };
}

// ★ 配置文件Schema（config.json结构 + 默认值）
const CONFIG_DEFAULTS = {
    version: '2.0',
    edition: 'institution',
    clinicName: '',
    doctorName: '',
    appVersion: '1.2.11',
    users: [],
    // ★ 新增：激活时自动创建的管理员账户标记
    autoCreatedAdmin: false,
    createdAt: null,
    updatedAt: null
};

function applyConfigDefaults(config) {
    if (!config || typeof config !== 'object') config = {};
    const result = {};
    for (const key of Object.keys(CONFIG_DEFAULTS)) {
        result[key] = (config[key] !== undefined && config[key] !== null)
            ? config[key]
            : CONFIG_DEFAULTS[key];
    }
    // 合并users数组
    if (Array.isArray(config.users)) result.users = config.users;
    result.updatedAt = new Date().toISOString();
    return result;
}

// ★ 导出（Node.js环境）
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        ACTIVATION_SCHEMA,
        VALIDATORS,
        ERROR_CODES,
        CONFIG_DEFAULTS,
        validateActivationForm,
        okResult,
        errResult,
        applyConfigDefaults
    };
}

// ★ 浏览器全局（activate-window.html通过<script>引入）
if (typeof window !== 'undefined') {
    window.ActivationSchema = {
        VALIDATORS,
        ERROR_CODES,
        validateActivationForm
    };
}
