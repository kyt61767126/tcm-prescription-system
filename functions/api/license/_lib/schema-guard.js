// ============================================================================
//  schema-guard.js — license 域字段校验单一来源 + KV key 工厂（2026-09-07 架构防御）
//
//  为什么必须有这个文件（举一反三，三起事故的结构性根因）：
//    1. 脏数据入库：客户端 getMachineId 桥失败返回错误 JSON 串被当 machineId
//       上报 → 真实客户的设备绑定写入垃圾 key device_version:{"success":false,...}
//       （2026-09-04 王宁宁中医诊所事故，条目三十三）。各入口校验各自内联、
//       规则漂移、覆盖不全——本文件统一为唯一副本。
//    2. key 拼接散落：'device_version:' + mid / 'order:' + orderNo 等拼接
//       散布 10+ 处，拼错/拼脏无从拦截——kvKey 工厂内嵌校验，非法入参
//       直接 throw，杜绝构造垃圾 key。
//
//  ★ 双通路边界（重要）：
//    - kvKey 工厂：仅写路径使用（写入前防脏，非法即 throw）
//    - KV_PREFIX 裸常量：体检/清理路径使用（admin-data-audit 必须能枚举
//      和删除脏 key——脏 key 恰恰不合法，不能被工厂拦住）
//
//  零依赖纯函数叶子模块：不 import 任何项目文件、不触 KV/crypto，
//    license-core / license-write-service / 各 API 三方引用均无循环依赖。
//
//  对外 API：
//    RE                      → 正则集（machineId/phone/orderNo/requestId/licenseCode）
//    KV_PREFIX               → 裸前缀常量（体检/清理路径用）
//    isValidMachineId(v)     → bool（显式拒 unknown/undefined 字面量）
//    isValidPhone(v) / isValidOrderNo(v) / isValidRequestId(v) / isValidLicenseCode(v)
//    normalizeOrderNo(v)     → trim + 大写归一
//    kvKey.xxx(...)          → 写路径 key 工厂（非法入参 throw Error）
// ============================================================================

// —— 正则集（宽松取向：宁可漏检不可误报；收紧前必须全量核对存量真实键）——
export const RE = {
    // 与客户端 normalizeMachineIdResult（shared/auth-core）白名单一致：
    // 桌面/APP 桥 32-64 位 hex、browser- 指纹、test-mid-、fallback_x_y 同字符集
    machineId:   /^[A-Za-z0-9_-]{8,64}$/,
    phone:       /^1[3-9]\d{9}$/,
    // 官网订单号：BNZC-DZ-202608291234-ABC1XY（对齐 order-submit L166 既有校验）
    orderNo:     /^BNZC-[A-Z]{2}-\d{12}-[A-Z0-9]{4,8}$/i,
    // 申请单号：REQ-0MTPRBE0S-B98C（历史变体长度 4-16，宽松覆盖）
    requestId:   /^REQ-[A-Z0-9]{4,16}-[A-Z0-9]{2,16}$/i,
    // 激活码：BNZC-XXXX-XXXX-XXXX-XXXX
    licenseCode: /^BNZC(-[A-Z0-9]{4}){4}$/i
};

// —— 裸前缀常量（体检/清理路径专用；写路径一律走 kvKey 工厂）——
export const KV_PREFIX = {
    adminReq:       'admin_req:',
    adminPhone:     'admin_phone:',
    order:          'order:',
    activeOrder:    'active_order:',
    deviceVersion:  'device_version:',
    testMachine:    'test_machine:',
    license:        'license:',
    licenseLog:     'license_log:',
    freePass:       'free_pass:'
};

// ============================================================================
// 字段校验器（单一副本，各 API 入口引用替换内联正则）
// ============================================================================
export function isValidMachineId(v) {
    if (typeof v !== 'string') return false;
    const s = v.trim();
    if (s === 'unknown' || s === 'undefined') return false;  // 垃圾字面量显式拒
    return RE.machineId.test(s);
}

export function isValidPhone(v) {
    if (v === null || v === undefined) return false;
    return RE.phone.test(String(v).trim());
}

export function isValidOrderNo(v) {
    if (typeof v !== 'string') return false;
    return RE.orderNo.test(v.trim());
}

export function isValidRequestId(v) {
    if (typeof v !== 'string') return false;
    return RE.requestId.test(v.trim());
}

export function isValidLicenseCode(v) {
    if (typeof v !== 'string') return false;
    return RE.licenseCode.test(v.trim());
}

// 订单号归一（trim + 大写）——bindOrderToRequest / order-submit / markOrderPaid 统一用
export function normalizeOrderNo(v) {
    return String(v || '').trim().toUpperCase();
}

// ============================================================================
// kvKey 工厂 — 写路径专用（非法入参直接 throw，杜绝构造垃圾 key）
//   设计：先验字段格式再拼 key，错误信息带字段名便于定位调用方。
//   清理/体检路径禁止用工厂（要能处理脏 key），用 KV_PREFIX 裸拼。
// ============================================================================
function _guard(name, ok, value) {
    if (!ok) {
        throw new Error('[schema-guard] 非法 ' + name + '，拒绝构造 KV key: '
            + String(value).slice(0, 60));
    }
}

export const kvKey = {
    adminReq(requestId) {
        _guard('requestId', isValidRequestId(requestId), requestId);
        return KV_PREFIX.adminReq + String(requestId).trim();
    },
    adminPhone(phone) {
        _guard('phone', isValidPhone(phone), phone);
        return KV_PREFIX.adminPhone + String(phone).trim();
    },
    order(orderNo) {
        _guard('orderNo', isValidOrderNo(orderNo), orderNo);
        return KV_PREFIX.order + normalizeOrderNo(orderNo);
    },
    activeOrder(machineId) {
        _guard('machineId', isValidMachineId(machineId), machineId);
        return KV_PREFIX.activeOrder + String(machineId).trim();
    },
    deviceVersion(machineId) {
        _guard('machineId', isValidMachineId(machineId), machineId);
        return KV_PREFIX.deviceVersion + String(machineId).trim();
    },
    testMachine(machineId) {
        _guard('machineId', isValidMachineId(machineId), machineId);
        return KV_PREFIX.testMachine + String(machineId).trim();
    },
    license(code) {
        _guard('licenseCode', isValidLicenseCode(code), code);
        return KV_PREFIX.license + String(code).trim().toUpperCase();
    },
    licenseLog(code) {
        _guard('licenseCode', isValidLicenseCode(code), code);
        return KV_PREFIX.licenseLog + String(code).trim().toUpperCase();
    },
    freePass(phone) {
        _guard('phone', isValidPhone(phone), phone);
        return KV_PREFIX.freePass + String(phone).trim();
    }
};
