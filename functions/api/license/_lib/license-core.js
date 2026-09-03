// ============================================================================
//  license-core.js — 激活码系统核心库（云端 Pages Functions 使用）
//
//  功能：
//    - 生成激活码（BNZC-XXXX-XXXX-XXXX-XXXX 格式）
//    - HMAC-SHA256 签名（与客户端 license-manager.js v2 一致）
//    - KV 存储操作（save/get/list 激活码）
//    - license 数据组装（与客户端 license.dat 格式一致）
//
//  ★ 签名密钥和 LICENSE_TYPE_CONFIG 必须与客户端保持一致：
//    - app_project/db-offline/desktop/electron/license-manager.js
//    - app_project/db-yunduan/cloud_desktop/electron/license-manager.js
// ============================================================================

// ★ P2-B 统一：KV 绑定解析改用单一事实源 _lib/kv.js（本文件 getKV 仅再导出，供既有 8 个导入方使用）
import { getKV } from '../../_lib/kv.js';

// ★ 必须与客户端 license-manager.js 中的 LICENSE_HMAC_KEY 保持一致
// 优先从环境变量读取（Cloudflare Secrets），硬编码作为默认值（向后兼容）
// ★ P1-3 优化：如果配置了 LICENSE_MASTER_KEY，使用 masterKey 派生 HMAC 密钥
//   派生算法（与客户端 getEffectiveHmacKey 一致）：
//     effectiveHmacKey = SHA256(masterKey + ':license-hmac:v1')
//   优势：每个安装的 license 使用独立密钥，攻击者破解单一安装不会泄露其他安装密钥
async function getLicenseHmacKey(context) {
    // ★ P1-3: 优先使用 masterKey 派生密钥
    const masterKey = getLicenseMasterKey(context);
    if (masterKey) {
        const derived = await crypto.subtle.digest('SHA-256', strToBytes(masterKey + ':license-hmac:v1'));
        return bytesToHex(new Uint8Array(derived));
    }
    if (context && context.env && context.env.LICENSE_HMAC_KEY) {
        return context.env.LICENSE_HMAC_KEY;
    }
    // ★ typeof 保护：Cloudflare Workers/Pages runtime 无 process 全局，直接访问会抛 ReferenceError
    if (typeof process !== 'undefined' && process.env && process.env.LICENSE_HMAC_KEY) {
        return process.env.LICENSE_HMAC_KEY;
    }
    return 'bnzc_tcm_license_key_v1_2026';
}

const LICENSE_HMAC_KEY = 'bnzc_tcm_license_key_v1_2026';

// ★ P1 安全分发优化：从环境变量读取 masterKey（可选）
// 用途：写入 license.dat，客户端运行时派生 HMAC/CONFIG_SIGN 密钥，避免硬编码
// 未配置时 license 不含 masterKey 字段，客户端 fallback 到硬编码密钥（向后兼容）
// 配置方法：在 Cloudflare Pages 后台设置环境变量 LICENSE_MASTER_KEY（32+ 字符随机字符串）
function getLicenseMasterKey(context) {
    if (context && context.env && context.env.LICENSE_MASTER_KEY) {
        return context.env.LICENSE_MASTER_KEY;
    }
    if (typeof process !== 'undefined' && process.env && process.env.LICENSE_MASTER_KEY) {
        return process.env.LICENSE_MASTER_KEY;
    }
    return null;  // 未配置时不下发 masterKey，客户端用硬编码 fallback
}

// ★ v2: 版本类型默认配置（必须与 license-manager.js 中 LICENSE_TYPE_CONFIG 一致）
const LICENSE_TYPE_CONFIG = {
    trial: {
        maxPrescriptions: 30,
        features: []
    },
    personal: {
        maxPrescriptions: 0,  // 0 = 无限
        features: ['backup']
    },
    pro: {
        maxPrescriptions: 0,
        features: ['backup', 'sync', 'multi-device', 'priority-support']
    }
};

// 激活码字符集：去除易混淆字符 0/O/1/I
const ACTIVATION_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ACTIVATION_CODE_PREFIX = 'BNZC';
const ACTIVATION_CODE_GROUPS = 4;  // BNZC + 4 组，每组 4 字符
const ACTIVATION_CODE_GROUP_LENGTH = 4;

// KV key 前缀
const KV_LICENSE_PREFIX = 'license:';
const KV_LICENSE_INDEX = 'system:license_index';

// ——— 2026-09-03 (架构统一 P1) admin 激活索引常量：唯一副本供所有写端 API/Service 共享
//     原 admin-submit.js / order-paid.js / admin-delete.js 各自内联一份，长度和漂移难维护
const KV_ADMIN_REQ_INDEX = 'admin_req_index';

// ——— 2026-09-03 共享 appendRequestIndex：全局 admin_req_index 入队唯一实现
//     历史：admin-submit.js(L136) + order-paid.js(L72) 各一份内联副本，注释/大小都不一致。
//     规则：unshift 到队首、不存在才追加、满 1000 截断队尾（后台列表不崩）。
async function appendRequestIndex(kv, requestId) {
    try {
        const index = (await kv.get(KV_ADMIN_REQ_INDEX, 'json')) || [];
        if (!index.includes(requestId)) {
            index.unshift(requestId);
            if (index.length > 1000) index.length = 1000;
            await kv.put(KV_ADMIN_REQ_INDEX, JSON.stringify(index));
        }
    } catch (e) {
        console.warn('[license-core appendRequestIndex] 更新失败:', e && e.message || e);
    }
}

// ============================================================================
//  工具函数
// ============================================================================
function strToBytes(str) {
    return new TextEncoder().encode(str);
}

function bytesToHex(bytes) {
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

// HMAC-SHA256 签名（Web Crypto API）
// ★ 签名内容必须与客户端 license-manager.js 的 generateSignature 完全一致
async function hmacSign(message, secret) {
    const key = await crypto.subtle.importKey(
        'raw',
        strToBytes(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
    );
    const sig = await crypto.subtle.sign('HMAC', key, strToBytes(message));
    return bytesToHex(new Uint8Array(sig));
}

// ============================================================================
//  ★ 任务2 新增：ECDSA P-256 非对称签名（v5）
//  - 私钥仅云端持有（Cloudflare Secrets: LICENSE_SIGN_PRIVATE_KEY）
//  - 公钥嵌入客户端（license-manager.js + LicenseManager.java）
//  - 现有 v1/v2/v3/v4 HMAC 签名继续工作（向后兼容）
//  - 新 license 同时包含 v4 HMAC + v5 ECDSA 双签名
//  - 客户端优先验 ECDSA，失败 fallback HMAC（兼容旧 license）
// ============================================================================
const ECDSA_CURVE = 'P-256';  // alias: 'prime256v1' / 'secp256r1'
const ECDSA_HASH = 'SHA-256';

// 从环境变量读取 ECDSA 私钥（PEM 格式 PKCS#8）
// 在 Cloudflare Pages 后台设置环境变量 LICENSE_SIGN_PRIVATE_KEY
function getEcdsaPrivateKeyPem(context) {
    if (context && context.env && context.env.LICENSE_SIGN_PRIVATE_KEY) {
        return context.env.LICENSE_SIGN_PRIVATE_KEY;
    }
    if (typeof process !== 'undefined' && process.env && process.env.LICENSE_SIGN_PRIVATE_KEY) {
        return process.env.LICENSE_SIGN_PRIVATE_KEY;
    }
    return null;  // 未配置 ECDSA 私钥时跳过 v5 签名
}

// 从 PEM 提取 base64 DER（去掉 BEGIN/END 头）
function pemToDer(pem) {
    return pem.replace(/-----BEGIN [A-Z ]+-----/g, '')
              .replace(/-----END [A-Z ]+-----/g, '')
              .replace(/\s+/g, '');
}

// base64 → Uint8Array
function base64ToBytes(b64) {
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return arr;
}

// 用 ECDSA P-256 私钥签名消息，返回 hex
async function ecdsaSign(message, privateKeyPem) {
    if (!privateKeyPem) throw new Error('ECDSA 私钥未配置');
    const derB64 = pemToDer(privateKeyPem);
    const derBytes = base64ToBytes(derB64);

    const key = await crypto.subtle.importKey(
        'pkcs8',
        derBytes,
        { name: 'ECDSA', namedCurve: ECDSA_CURVE },
        false,
        ['sign']
    );
    const sig = await crypto.subtle.sign(
        { name: 'ECDSA', hash: ECDSA_HASH },
        key,
        strToBytes(message)
    );
    // ECDSA 签名输出为 raw r||s 格式（Web Crypto 默认），转 hex
    return bytesToHex(new Uint8Array(sig));
}

// ★ v5 签名内容：与 v3 相同的字段（user|type|issuedAt|expiresAt|maxPrescriptions|features|clinicName|machineId|licenseBinding）
// 但用 ECDSA P-256 而非 HMAC。验签时用同样的 content。
async function generateSignatureV5(data, privateKeyPem) {
    const content = [
        data.user,
        data.type,
        data.issuedAt,
        data.expiresAt,
        String(data.maxPrescriptions !== undefined ? data.maxPrescriptions : 0),
        Array.isArray(data.features) ? data.features.join(',') : '',
        data.clinicName || '',
        data.machineId || '',
        data.licenseBinding || ''
    ].join('|');
    return ecdsaSign(content, privateKeyPem);
}

// ============================================================================
//  ★ P1-[2.2] 新增：ECDSA v6 防重放签名（serial / nonce / kid）
//  在 v5 的基础上追加 serial（激活码单调递增签发序号）和 nonce（本次签发随机数），
//  kid 标识所用密钥对（复用现有 ECDSA 密钥对 = 'v6-001'）。
//  防重放效果：
//    - serial 每次签发 +1，旧 license 副本的 serial 必然小于新签发值
//    - nonce 每次签发随机，即使内容相同签名也不同
//  兼容性：v6 只新增字段，不改动 v1~v5 的既有签名内容与密钥；客户端验签顺序 v6→v5→HMAC
// ============================================================================
// 生成 n 字节随机数 hex（Web Crypto getRandomValues，Cloudflare Workers 兼容）
function randomHexBytes(n) {
    const bytes = crypto.getRandomValues(new Uint8Array(n));
    return bytesToHex(bytes);
}

// ★ v6 签名内容 = v5 全部字段 + serial + nonce
async function generateSignatureV6(data, privateKeyPem, serial, nonce) {
    const content = [
        data.user,
        data.type,
        data.issuedAt,
        data.expiresAt,
        String(data.maxPrescriptions !== undefined ? data.maxPrescriptions : 0),
        Array.isArray(data.features) ? data.features.join(',') : '',
        data.clinicName || '',
        data.machineId || '',
        data.licenseBinding || '',
        String(serial),
        String(nonce)
    ].join('|');
    return ecdsaSign(content, privateKeyPem);
}

// ★ v6 签发序号：激活码单调递增计数（KV 持久化，防重放核心）
// KV key: license_serial:{CODE} → 签发次数；本次签发 serial = 上次 + 1
// KV 不可用时回退时间戳（fail-open，宁漏检不可误报，绝不阻塞正常激活）
async function getNextSerial(kv, code) {
    const key = 'license_serial:' + String(code || '').toUpperCase();
    try {
        if (kv) {
            const current = parseInt((await kv.get(key)) || '0', 10);
            const next = (isNaN(current) || current < 0) ? 1 : current + 1;
            await kv.put(key, String(next));
            return next;
        }
    } catch (e) {
        console.warn('[License] serial 计数失败，回退时间戳:', e.message);
    }
    return Date.now();
}

// ============================================================================
//  ★ P1-[5.1][5.3] 新增：Ed25519 签名（v7）
//  算法：Ed25519（RFC 8032，SHA-512 内部预哈希，签名固定 64 字节）
//  相比 ECDSA P-256 优势：
//    - 性能更高、签名更短（64B vs ECDSA DER ~70-72B）
//    - 常量时间实现，天然抗时序侧信道
//    - 无随机数缺陷风险（ECDSA 的 k 泄露可导致私钥泄露）
//  私钥仅云端持有（Cloudflare Secrets: LICENSE_SIGN_ED25519_PRIVATE_KEY，
//    PEM PKCS#8 格式，由 tools/gen-ed25519-keys.cjs 生成）。
//  公钥嵌入客户端（Node: ED25519_VERIFY_PUBLIC_KEY_PEM，Java: hex 公钥）。
//  兼容性：v7 只新增字段，不改动 v1~v6 既有签名；客户端验签顺序 v7→v6→v5→HMAC。
//  v7 仍带 sigKId='v7-001'，复用 v6 的 serial/nonce 防重放字段（内容含 sigSerial/sigNonce）。
// ============================================================================
const ED25519_SIGN_ALGO = 'Ed25519';  // RFC 8032

// 从环境变量读取 Ed25519 私钥（PEM PKCS#8）
// 在 Cloudflare Pages 后台设置环境变量 LICENSE_SIGN_ED25519_PRIVATE_KEY
function getEd25519PrivateKeyPem(context) {
    if (context && context.env && context.env.LICENSE_SIGN_ED25519_PRIVATE_KEY) {
        return context.env.LICENSE_SIGN_ED25519_PRIVATE_KEY;
    }
    if (typeof process !== 'undefined' && process.env && process.env.LICENSE_SIGN_ED25519_PRIVATE_KEY) {
        return process.env.LICENSE_SIGN_ED25519_PRIVATE_KEY;
    }
    return null;  // 未配置 Ed25519 私钥时跳过 v7 签名
}

// 用 Ed25519 私钥签名消息，返回 hex（Web Crypto：signature 固定 64 字节）
async function ed25519Sign(message, privateKeyPem) {
    if (!privateKeyPem) throw new Error('Ed25519 私钥未配置');
    const derB64 = pemToDer(privateKeyPem);
    const derBytes = base64ToBytes(derB64);

    const key = await crypto.subtle.importKey(
        'pkcs8',
        derBytes,
        { name: ED25519_SIGN_ALGO },
        false,
        ['sign']
    );
    const sig = await crypto.subtle.sign(ED25519_SIGN_ALGO, key, strToBytes(message));
    // Ed25519 签名固定 64 字节，转 hex
    return bytesToHex(new Uint8Array(sig));
}

// ★ v7 签名内容 = v5 全部字段 + sigSerial + sigNonce（与 v6 完全一致）
// Ed25519 对相同内容产生确定性签名，但 serial 每次 +1、nonce 每次随机，
// 因此即使 license 字段相同，每次签名的内容也不同（防重放仍生效）。
async function generateSignatureV7(data, privateKeyPem, serial, nonce) {
    const content = [
        data.user,
        data.type,
        data.issuedAt,
        data.expiresAt,
        String(data.maxPrescriptions !== undefined ? data.maxPrescriptions : 0),
        Array.isArray(data.features) ? data.features.join(',') : '',
        data.clinicName || '',
        data.machineId || '',
        data.licenseBinding || '',
        String(serial),
        String(nonce)
    ].join('|');
    return ed25519Sign(content, privateKeyPem);
}

// ★ v2 签名：与客户端 generateSignature 一致
// 内容：user|type|issuedAt|expiresAt|maxPrescriptions|features
async function generateSignature(data, secret) {
    const content = [
        data.user,
        data.type,
        data.issuedAt,
        data.expiresAt,
        String(data.maxPrescriptions !== undefined ? data.maxPrescriptions : 0),
        Array.isArray(data.features) ? data.features.join(',') : ''
    ].join('|');
    return hmacSign(content, secret || LICENSE_HMAC_KEY);
}

// ★ v3 签名：在 v2 基础上增加 clinicName/machineId/licenseBinding 三个绑定字段
// 内容：user|type|issuedAt|expiresAt|maxPrescriptions|features|clinicName|machineId|licenseBinding
// 仅当 clinicName/machineId/licenseBinding 同时存在时才使用 v3 签名
async function generateSignatureV3(data, secret) {
    const content = [
        data.user,
        data.type,
        data.issuedAt,
        data.expiresAt,
        String(data.maxPrescriptions !== undefined ? data.maxPrescriptions : 0),
        Array.isArray(data.features) ? data.features.join(',') : '',
        data.clinicName || '',
        data.machineId || '',
        data.licenseBinding || ''
    ].join('|');
    return hmacSign(content, secret || LICENSE_HMAC_KEY);
}

// ★ 统一签名生成入口：自动选择 v3 / v2
// 含 clinicName + machineId + licenseBinding → v3，否则 → v2
async function generateSignatureAuto(data, secret) {
    if (data.clinicName && data.machineId && data.licenseBinding) {
        return generateSignatureV3(data, secret);
    }
    return generateSignature(data, secret);
}

// ============================================================================
//  激活码生成
// ============================================================================
// 生成单个随机字符
function randomChar() {
    const bytes = crypto.getRandomValues(new Uint8Array(1));
    return ACTIVATION_CODE_CHARS[bytes[0] % ACTIVATION_CODE_CHARS.length];
}

// 生成一组 4 字符
function randomGroup() {
    let group = '';
    for (let i = 0; i < ACTIVATION_CODE_GROUP_LENGTH; i++) {
        group += randomChar();
    }
    return group;
}

// 生成完整激活码：BNZC-XXXX-XXXX-XXXX-XXXX
function generateActivationCode() {
    const groups = [ACTIVATION_CODE_PREFIX];
    for (let i = 0; i < ACTIVATION_CODE_GROUPS; i++) {
        groups.push(randomGroup());
    }
    return groups.join('-');
}

// ============================================================================
//  license 数据组装（与客户端 license.dat 格式一致）
// ============================================================================
// 根据激活码记录生成 license 数据（用于 validate API 返回给客户端）
// ★ v3 新增：options.clinicName + options.machineId + options.licenseBinding
// 三者同时存在时启用 v3 签名（含绑定字段），否则走 v2 签名（向后兼容）
// ★ v4 新增：options.maxDevices + options.devicesCount（多设备授权，仅显示用，不参与签名）
// ★ 新增：支持通过 options.secret 或 options.context 传入动态密钥（环境变量）
async function buildLicenseData(record, options = {}) {
    const config = LICENSE_TYPE_CONFIG[record.type] || LICENSE_TYPE_CONFIG.personal;
    const maxPrescriptions = record.maxPrescriptions !== undefined ? record.maxPrescriptions : config.maxPrescriptions;
    const features = record.features || config.features;

    // ★ 2026-08-26 激活有效期锚定规则（用户定版）：到期时间 =【首次激活时间 + record.days(默认365)】。
    //   不管软件问题/设备问题导致重新激活（同码同设备重激活、换机激活），到期时间一律不变
    //   （防止卸载重装反复"续命"）。firstActivatedAt 首次激活时由 validate.js 写入；
    //   存量旧记录无该字段时回退 activatedAt（尽力而为）。
    //   record.expiresAt 保留用途：①激活码使用期限（validate.js 过期校验）
    //   ②续费叠加保底（若晚于锚定到期日，取续费值，保持续费效果）。
    // ★ 2026-08-26 推广奖励：record.rewardDays（邀请奖励累计天数）直接叠加到期日，
    //   与锚定规则正交——锚定防"重装续命"，rewardDays 是平台主动发放的合法延期。
    let expiresAt;
    const baseDays = (record.days && record.days > 0) ? record.days : 365;
    const rewardDays = (record.rewardDays && record.rewardDays > 0) ? record.rewardDays : 0;
    let anchorMs = record.firstActivatedAt ? new Date(record.firstActivatedAt).getTime() : NaN;
    if (isNaN(anchorMs)) anchorMs = record.activatedAt ? new Date(record.activatedAt).getTime() : NaN;
    if (isNaN(anchorMs)) anchorMs = Date.now();
    expiresAt = new Date(anchorMs + (baseDays + rewardDays) * 24 * 60 * 60 * 1000).toISOString();
    if (record.expiresAt) {
        const renewExp = new Date(record.expiresAt);
        if (!isNaN(renewExp.getTime()) && renewExp.getTime() > new Date(expiresAt).getTime()) {
            expiresAt = renewExp.toISOString();  // 续费叠加效果保底（取更晚者）
        }
    }

    const data = {
        user: record.user || record.username || 'user',
        type: record.type,
        issuedAt: new Date().toISOString(),
        expiresAt: expiresAt,
        maxPrescriptions: maxPrescriptions,
        features: features
    };

    // ★ v3 新增：绑定字段（clinicName/machineId/licenseBinding）
    // 由 validate API 从客户端请求中传入，写入 license 实现三因子绑定
    if (options.clinicName && options.machineId) {
        data.clinicName = options.clinicName;
        data.machineId = options.machineId;
        data.licenseBinding = options.licenseBinding || 'clinic+user+machine';
    }

    // ★ v4 新增：多设备授权信息（仅显示用，不参与签名）
    // 客户端激活成功后可显示"已绑定 X/N 台设备"
    if (options.maxDevices !== undefined) {
        data.maxDevices = options.maxDevices;
        data.devicesCount = options.devicesCount || 1;
    }

    // ★ 自动选择 v3 / v2 签名
    // 优先使用 options.secret，否则从 options.context 读取环境变量（含 masterKey 派生逻辑）
    const secret = options.secret || (options.context ? await getLicenseHmacKey(options.context) : undefined);
    data.signature = await generateSignatureAuto(data, secret);

    // ★ 任务2 新增：附加 v5 ECDSA 签名（如果配置了 ECDSA 私钥）
    // 仅在配置了 LICENSE_SIGN_PRIVATE_KEY 环境变量时启用
    // 客户端优先验 v5，失败 fallback v3/v4 HMAC（向后兼容）
    if (options.context) {
        const ecdsaPrivateKey = getEcdsaPrivateKeyPem(options.context);
        if (ecdsaPrivateKey) {
            try {
                data.signatureV5 = await generateSignatureV5(data, ecdsaPrivateKey);
                data.signatureVersion = 5;
                console.log('[License] 已附加 v5 ECDSA 签名');
            } catch (e) {
                console.warn('[License] v5 ECDSA 签名失败（降级为 HMAC）:', e.message);
            }
        }
    }

    // ★ P1-[2.2] 新增：附加 v6 ECDSA 防重放签名（v5 内容 + serial + nonce + kid）
    // - serial：激活码单调递增签发序号（KV 计数，KV 不可用回退时间戳，fail-open）
    // - nonce ：本次签发随机数（16 字节 hex，即使内容相同每次签名也不同）
    // - kid   ：密钥标识，复用现有 ECDSA 密钥对 = 'v6-001'
    // 客户端优先验 v6，v6 验签失败 fail-closed 拒绝；serial 仅客户端审计告警（fail-open）
    if (options.context) {
        const ecdsaPrivateKey = getEcdsaPrivateKeyPem(options.context);
        if (ecdsaPrivateKey) {
            try {
                const serial = await getNextSerial(options.kv, record.code);
                const nonce = randomHexBytes(16);
                data.signatureV6 = await generateSignatureV6(data, ecdsaPrivateKey, serial, nonce);
                data.sigKId = 'v6-001';
                data.sigSerial = serial;
                data.sigNonce = nonce;
                data.signatureVersion = 6;
                console.log('[License] 已附加 v6 ECDSA 防重放签名 (serial=' + serial + ')');
            } catch (e) {
                console.warn('[License] v6 ECDSA 签名失败（降级为 v5）:', e.message);
            }
        }
    }

    // ★ P1-[5.1][5.3] 新增：附加 v7 Ed25519 签名（v5 内容 + serial + nonce + kid）
    // - 算法：Ed25519（RFC 8032），私钥存 LICENSE_SIGN_ED25519_PRIVATE_KEY
    // - serial/nonce 复用 v6 的防重放字段（KV 计数 + 随机数）
    // - kid 标识所用密钥对 = 'v7-001'
    // 客户端验签顺序 v7→v6→v5→HMAC；v7 签名失败自动降级 v6/v5（fail-open，不阻塞激活）
    if (options.context) {
        const ed25519PrivateKey = getEd25519PrivateKeyPem(options.context);
        if (ed25519PrivateKey) {
            try {
                // ★ 修复（2026-08-30 端到端验证发现）：复用 v6 已写入的 serial/nonce，
                //   禁止重新生成。原实现重复调用 getNextSerial/randomHexBytes 后
                //   覆盖 data.sigSerial/sigNonce，导致 license 下发的防重放字段
                //   与 signatureV6 实签值失配 → v6 验签必然失败（客户端因 v7 优先
                //   才未暴露；若 Ed25519 私钥缺失降级 v6 时将 fail-closed 全拒）。
                const serial = (data.sigSerial !== undefined && data.sigSerial !== null)
                    ? data.sigSerial : await getNextSerial(options.kv, record.code);
                const nonce = data.sigNonce || randomHexBytes(16);
                data.signatureV7 = await generateSignatureV7(data, ed25519PrivateKey, serial, nonce);
                data.sigKId = 'v7-001';
                data.sigSerial = serial;
                data.sigNonce = nonce;
                data.signatureVersion = 7;
                console.log('[License] 已附加 v7 Ed25519 签名 (serial=' + serial + ')');
            } catch (e) {
                console.warn('[License] v7 Ed25519 签名失败（降级为 v6/v5）:', e.message);
            }
        }
    }

    // ★ P1 安全分发优化：附加 masterKey（如果云端配置了 LICENSE_MASTER_KEY）
    // 用途：客户端运行时派生 HMAC/CONFIG_SIGN 密钥，避免硬编码
    // 注意：masterKey 不参与签名内容（在签名计算后添加），不影响验签逻辑
    // 未配置时不下发，客户端 fallback 到硬编码 LICENSE_HMAC_KEY（向后兼容）
    if (options.context) {
        const masterKey = getLicenseMasterKey(options.context);
        if (masterKey) {
            data.masterKey = masterKey;
            console.log('[License] 已附加 masterKey（客户端将派生动态密钥）');
        }
    }
    return data;
}

// 将 license 数据编码为 base64（客户端写入 license.dat 的格式）
function encodeLicenseBase64(data) {
    const json = JSON.stringify(data, null, 2);
    return btoa(String.fromCharCode(...new Uint8Array(strToBytes(json))));
}

// ============================================================================
//  KV 存储操作
// ============================================================================
// getKV 已统一至 ../../_lib/kv.js（P2-B），此处由顶部 import 提供并在文件尾再导出

// 保存激活码到 KV
// ★ 2026-09-03 P0 防御修复：补 return record——原无返回值，调用方拿 undefined 后
//   继续访问 .phone 等字段会 TypeError（admin-approve「无反应」案的次生坑）
async function saveLicense(kv, record) {
    const key = KV_LICENSE_PREFIX + record.code;
    await kv.put(key, JSON.stringify(record));

    // 更新索引
    const index = (await kv.get(KV_LICENSE_INDEX, 'json')) || [];
    if (!index.includes(record.code)) {
        index.push(record.code);
        await kv.put(KV_LICENSE_INDEX, JSON.stringify(index));
    }
    return record;
}

// 从 KV 读取激活码
async function getLicense(kv, code) {
    const key = KV_LICENSE_PREFIX + code;
    return await kv.get(key, 'json');
}

// 更新激活码（部分字段）
async function updateLicense(kv, code, updates) {
    const record = await getLicense(kv, code);
    if (!record) return null;
    const updated = { ...record, ...updates };
    await saveLicense(kv, updated);
    return updated;
}

// 列出所有激活码
async function listLicenses(kv) {
    const index = (await kv.get(KV_LICENSE_INDEX, 'json')) || [];
    const records = [];
    for (const code of index) {
        const record = await getLicense(kv, code);
        if (record) records.push(record);
    }
    return records;
}

// 隐藏敏感字段，返回安全的记录对象
// ★ v4 新增：maxDevices + devices 数组（多设备授权）
function sanitizeRecord(record) {
    const devices = getDevices(record);
    return {
        code: record.code,
        user: record.user || record.username,
        type: record.type,
        days: record.days,
        issuedAt: record.issuedAt,
        activatedAt: record.activatedAt,
        expiresAt: record.expiresAt,
        clinicName: record.clinicName || null,  // ★ v3 新增：绑定诊所名
        machineId: record.machineId ? record.machineId.substring(0, 8) + '...' : null,  // 仅显示前 8 位
        status: record.status,
        maxPrescriptions: record.maxPrescriptions,
        features: record.features,
        note: record.note || '',
        // ★ v4 新增：多设备授权字段
        maxDevices: record.maxDevices !== undefined ? record.maxDevices : 1,  // 默认 1（向后兼容旧激活码）
        devicesCount: devices.length,                                           // 已绑定设备数
        devices: devices.map(d => ({                                           // 已绑定设备列表（脱敏）
            machineId: d.machineId ? d.machineId.substring(0, 8) + '...' : null,
            activatedAt: d.activatedAt || null,
            clinicName: d.clinicName || null,
            productClass: d.productClass || null,   // ★ 端形态：cloud云端/offline离线
            clientClass: d.clientClass || null      // ★ 客户端形态：desktop桌面/app
        })),
        // ★ 2026-08-26 推广奖励字段（管理台邀请进度展示）
        inviteCode: record.inviteCode || null,        // 专属邀请码
        inviteCount: record.inviteCount || 0,         // 已成功邀请人数
        rewardDays: record.rewardDays || 0,           // 累计奖励天数
        invitedBy: record.invitedBy || null           // 由谁的邀请码邀请（被邀记录）
    };
}

// ★ v4 新增：获取激活码已绑定的设备数组（向后兼容旧 record.machineId 单值字段）
// 旧格式：record.machineId（单值）→ 返回 [{ machineId, activatedAt, clinicName }]
// 新格式：record.devices（数组）→ 直接返回
// 混合格式：优先 devices，若为空则从 machineId 转换
function getDevices(record) {
    if (!record) return [];
    // 新格式：devices 数组
    if (Array.isArray(record.devices) && record.devices.length > 0) {
        return record.devices;
    }
    // 旧格式：machineId 单值 → 转换为单元素数组
    if (record.machineId) {
        return [{
            machineId: record.machineId,
            activatedAt: record.activatedAt,
            clinicName: record.activatedClinicName || record.clinicName
        }];
    }
    return [];
}

// ★ v4 新增：获取激活码的最大设备数（默认 1，向后兼容）
function getMaxDevices(record) {
    if (!record) return 1;
    const n = parseInt(record.maxDevices, 10);
    if (isNaN(n) || n < 1) return 1;
    if (n > 10) return 10;  // 上限 10 台
    return n;
}

// ============================================================================
//  ★ 设备-版本绑定（同一台设备只能注册一个版本）
//  需求：同一台电脑/手机只能激活一个版本（标准版 OR 机构版）
//  一旦设备绑定某版本，另一个版本的激活/提交请求将被拒绝
//  KV key: device_version:{machineId}
//  值：{ machineId, version: 'standard'|'institution', licenseCode, clinicName, boundAt }
// ============================================================================
const KV_DEVICE_VERSION_PREFIX = 'device_version:';
const DEVICE_VERSION_LABEL = { 'standard': '标准版', 'institution': '机构版' };

// 判断 license type / edition 属于哪个版本（institution=机构版, standard=标准版）
// 兼容 type（personal/pro）和 edition（cloud_personal/cloud_clinic/clinic_custom...）多种写法
function versionOf(typeOrEdition) {
    const v = String(typeOrEdition || '').toLowerCase();
    if (['pro', 'institution', 'clinic', 'clinic_custom', 'cloud_clinic', 'offline_clinic', 'institutional'].includes(v)) {
        return 'institution';
    }
    return 'standard';  // personal / trial / cloud_personal / 其他未识别 → 标准版
}

// 读取设备已绑定版本（返回绑定记录或 null）
async function getDeviceVersion(kv, machineId) {
    if (!kv || !machineId) return null;
    try {
        return await kv.get(KV_DEVICE_VERSION_PREFIX + machineId, 'json');
    } catch (e) {
        console.warn('[DeviceVersion] 读取失败:', e.message);
        return null;
    }
}

// 写入设备版本绑定（保留已有 licenseCode/clinicName）
// ★ 2026-08 新增：meta.productClass（cloud云端/offline离线）、meta.clientClass（desktop桌面/app）。
//   由客户端心跳自动上报，后台据此展示每台设备的端形态。
async function setDeviceVersion(kv, machineId, version, meta = {}) {
    if (!kv || !machineId) return;
    // 测试机不持久化版本绑定，允许自由切换标准版/机构版
    if (await isTestMachine(kv, machineId)) return;
    const prev = await getDeviceVersion(kv, machineId);
    const binding = {
        machineId: machineId,
        version: version,
        licenseCode: meta.licenseCode || (prev && prev.licenseCode) || null,
        clinicName: meta.clinicName || (prev && prev.clinicName) || null,
        boundAt: new Date().toISOString(),
        productClass: meta.productClass || (prev && prev.productClass) || null,
        clientClass: meta.clientClass || (prev && prev.clientClass) || null
    };
    await kv.put(KV_DEVICE_VERSION_PREFIX + machineId, JSON.stringify(binding));
    return binding;
}

// 解除设备-版本绑定（客服在后端管理，用于客户换机/降级/紧急调整）
async function removeDeviceVersion(kv, machineId) {
    if (!kv || !machineId) return false;
    try {
        await kv.delete(KV_DEVICE_VERSION_PREFIX + machineId);
        console.log('[DeviceVersion] 已解除设备版本绑定:', machineId);
        return true;
    } catch (e) {
        console.warn('[DeviceVersion] 解除绑定失败:', e.message);
        return false;
    }
}

// 列出所有设备-版本绑定（供后台管理查看，最多返回 limit 条）
async function listDeviceVersions(kv, limit = 200) {
    if (!kv) return [];
    const out = [];
    try {
        const list = await kv.list({ prefix: KV_DEVICE_VERSION_PREFIX, limit });
        for (const k of list.keys) {
            const v = await kv.get(k.name, 'json');
            if (v) out.push(v);
        }
    } catch (e) {
        console.warn('[DeviceVersion] 列表读取失败:', e.message);
    }
    return out;
}

// ============================================================================
//  ★ 测试机白名单：标记为测试机的设备仅放开"一设备一版本"绑定校验，
//    使其可自由测试标准版/机构版的注册激活流程；客户设备不受影响，仍严格一机一版本
//  KV key: test_machine:{machineId} → { machineId, note, addedAt }
// ============================================================================
const KV_TEST_MACHINE_PREFIX = 'test_machine:';

async function isTestMachine(kv, machineId) {
    if (!kv || !machineId) return false;
    try {
        return await kv.get(KV_TEST_MACHINE_PREFIX + machineId) !== null;
    } catch (e) {
        console.warn('[TestMachine] 读取失败:', e.message);
        return false;
    }
}

async function setTestMachine(kv, machineId, note) {
    if (!kv || !machineId) return null;
    const rec = { machineId: machineId, note: note || '', addedAt: new Date().toISOString() };
    await kv.put(KV_TEST_MACHINE_PREFIX + machineId, JSON.stringify(rec));
    return rec;
}

async function removeTestMachine(kv, machineId) {
    if (!kv || !machineId) return;
    await kv.delete(KV_TEST_MACHINE_PREFIX + machineId);
}

async function listTestMachines(kv) {
    if (!kv) return [];
    const out = [];
    try {
        const list = await kv.list({ prefix: KV_TEST_MACHINE_PREFIX });
        for (const k of list.keys) {
            const v = await kv.get(k.name, 'json');
            if (v) out.push(v);
        }
    } catch (e) {
        console.warn('[TestMachine] 列表读取失败:', e.message);
    }
    return out;
}

// 校验设备版本与目标版本是否一致
// 返回：{ ok: true, binding } 或 { ok: false, binding, boundLabel, targetLabel, error }
async function checkDeviceVersion(kv, machineId, targetTypeOrEdition) {
    // 测试机白名单：仅放开"一设备一版本"绑定校验，其余安全校验照旧
    if (await isTestMachine(kv, machineId)) {
        return { ok: true, binding: null, testMachine: true };
    }
    const binding = await getDeviceVersion(kv, machineId);
    if (!binding || !binding.version) {
        return { ok: true, binding: null };
    }
    const targetVersion = versionOf(targetTypeOrEdition);
    if (binding.version === targetVersion) {
        return { ok: true, binding: binding };
    }
    // ★ 版本升级：允许"标准版 → 机构版"单向升级（客户加购升级版本）
    // 客户用机构版激活码在已绑定标准版的设备上激活，视为授权升级
    if (binding.version === 'standard' && targetVersion === 'institution') {
        return { ok: true, binding: binding, upgrade: true, from: 'standard', to: 'institution' };
    }
    // 其余情况（含"机构版 → 标准版"降级）拒绝
    const boundLabel = DEVICE_VERSION_LABEL[binding.version] || binding.version;
    const targetLabel = DEVICE_VERSION_LABEL[targetVersion] || targetVersion;
    return {
        ok: false,
        binding: binding,
        boundLabel: boundLabel,
        targetLabel: targetLabel,
        error: '该设备已激活【' + boundLabel + '】，不能激活【' + targetLabel + '】。'
            + (boundLabel === '机构版'
                ? '【机构版】为最高版本，不支持降级为标准版。如需调整，请联系客服。'
                : '同一台设备只能注册一个版本。如需从【标准版】升级到【机构版】，请使用【机构版】激活码在软件内重新激活。')
    };
}

// ============================================================================
//  ★ 操作日志（任务5 新增）：记录每个激活码的所有操作历史
//  KV key: license_log:{code}，值为 JSON 数组
//  每条记录：{ action, time, ip, operator, detail }
//  最多保留 200 条（防止无限增长），FIFO 队列
// ============================================================================
const KV_LICENSE_LOG_PREFIX = 'license_log:';
const LICENSE_LOG_MAX_ENTRIES = 200;

// 追加操作日志（fire-and-forget，不阻塞主流程）
async function appendLicenseLog(kv, code, entry) {
    if (!kv || !code || !entry || !entry.action) return;
    try {
        const logKey = KV_LICENSE_LOG_PREFIX + code;
        const logs = (await kv.get(logKey, 'json')) || [];
        // 补全字段
        const logEntry = {
            action: entry.action,
            time: entry.time || new Date().toISOString(),
            ip: entry.ip || 'unknown',
            operator: entry.operator || 'system',
            detail: entry.detail || ''
        };
        logs.push(logEntry);
        // 超过上限时丢弃最旧的（FIFO）
        if (logs.length > LICENSE_LOG_MAX_ENTRIES) {
            logs.splice(0, logs.length - LICENSE_LOG_MAX_ENTRIES);
        }
        await kv.put(logKey, JSON.stringify(logs));
    } catch (e) {
        console.warn('[LicenseLog] 追加日志失败:', e.message);
    }
}

// 查询激活码操作日志
async function getLicenseLogs(kv, code) {
    if (!kv || !code) return [];
    try {
        const logKey = KV_LICENSE_LOG_PREFIX + code;
        const logs = (await kv.get(logKey, 'json')) || [];
        // 按时间倒序（最新的在前）
        return logs.slice().reverse();
    } catch (e) {
        console.warn('[LicenseLog] 查询日志失败:', e.message);
        return [];
    }
}

// 删除激活码日志（删除激活码时同步清理）
async function deleteLicenseLogs(kv, code) {
    if (!kv || !code) return;
    try {
        await kv.delete(KV_LICENSE_LOG_PREFIX + code);
    } catch (e) {
        console.warn('[LicenseLog] 删除日志失败:', e.message);
    }
}

// ============================================================================
//  ★ 2026-08-26 推广奖励（邀请激活阶梯奖励）
//  规则（用户定版）：邀请人每成功邀请 1 人付费激活 → +90 天，累计封顶 4 人/360 天；
//  被邀请人首次付费激活填邀请码 → +30 天试用期延长。
//  防刷硬条件（缺一发奖即拒绝）：
//    ①被邀激活码必须非 trial（付费激活才计）
//    ②被邀 machineId ≠ 邀请人任何已绑设备（防自邀/换机自刷）
//    ③被邀 machineId 未出现在邀请人 inviteRewardLog（防重复计同一设备）
//    ④邀请人 inviteCount < 4（封顶）
// ============================================================================
const INVITE_REWARD_DAYS_PER_PERSON = 90;   // 邀请人每人奖励天数
const INVITE_MAX_INVITEES = 4;              // 封顶人数（4×90=360天）
const INVITE_BONUS_DAYS_INVITEE = 30;       // 被邀请人奖励天数
const INVITE_CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';  // 去易混淆字符（I/L/O/0/1）

// 生成 6 位邀请码（如 7K3F9Q）
function generateInviteCode() {
    const bytes = crypto.getRandomValues(new Uint8Array(6));
    let code = '';
    for (let i = 0; i < 6; i++) {
        code += INVITE_CODE_CHARS[bytes[i] % INVITE_CODE_CHARS.length];
    }
    return code;
}

// 确保激活码记录上有邀请码（首次激活时生成，幂等：已有则沿用）
async function ensureInviteCode(kv, record) {
    if (!kv || !record || !record.code) return record;
    if (record.inviteCode) return record;
    // 邀请码全局唯一：冲突时重生成（最多3次，仍冲突直接带前缀兜底）
    for (let i = 0; i < 3; i++) {
        const candidate = generateInviteCode();
        const existing = await findLicenseByInviteCode(kv, candidate);
        if (!existing) {
            await updateLicense(kv, record.code, { inviteCode: candidate });
            return { ...record, inviteCode: candidate };
        }
    }
    const fallback = (record.code || 'X').replace(/[^A-Z0-9]/g, '').substring(0, 6).padEnd(6, 'X');
    await updateLicense(kv, record.code, { inviteCode: fallback });
    return { ...record, inviteCode: fallback };
}

// 按邀请码查找激活码记录（扫全量 license 记录，量级百级以内，KV 读额度充足）
async function findLicenseByInviteCode(kv, inviteCode) {
    if (!kv || !inviteCode) return null;
    const code = String(inviteCode).trim().toUpperCase();
    const records = await listLicenses(kv);
    return records.find(r => r.inviteCode && String(r.inviteCode).toUpperCase() === code) || null;
}

// 发放邀请奖励（validate.js 激活成功时调用）
// 返回 { granted: true, inviterCount, rewardDays, inviteeBonusDays } 或 { granted: false, reason }
async function applyInviteReward(kv, { inviteCode, inviteeCode, inviteeRecord, machineId, phone, ip }) {
    try {
        if (!kv || !inviteCode || !inviteeRecord || !machineId) {
            return { granted: false, reason: '参数缺失' };
        }
        // ①付费激活才计（trial 试用不计）
        if (inviteeRecord.type === 'trial') {
            return { granted: false, reason: '试用激活不计入邀请奖励' };
        }
        const inviter = await findLicenseByInviteCode(kv, inviteCode);
        if (!inviter) {
            return { granted: false, reason: '邀请码无效' };
        }
        // 邀请人自己已激活的设备不能再被邀（防自邀）
        const inviterDevices = getDevices(inviter);
        if (inviterDevices.some(d => d.machineId === machineId)) {
            return { granted: false, reason: '不能自己邀请自己' };
        }
        // ②封顶检查
        const inviteCount = inviter.inviteCount || 0;
        if (inviteCount >= INVITE_MAX_INVITEES) {
            return { granted: false, reason: '邀请奖励已达上限（4人/360天）' };
        }
        // ③同一设备不重复计
        const rewardLog = Array.isArray(inviter.inviteRewardLog) ? inviter.inviteRewardLog : [];
        if (rewardLog.some(e => e && e.machineId === machineId)) {
            return { granted: false, reason: '该设备已计入邀请奖励' };
        }
        // ④防环：被邀人不能反过来是邀请人的邀请人（A邀B后B再邀A）
        if (inviter.invitedBy && inviteeRecord.inviteCode &&
            String(inviter.invitedBy).toUpperCase() === String(inviteeRecord.inviteCode).toUpperCase()) {
            return { granted: false, reason: '不能相互邀请套奖励' };
        }

        // === 发奖：邀请人 +90 天 ===
        const newCount = inviteCount + 1;
        const newRewardDays = Math.min((inviter.rewardDays || 0) + INVITE_REWARD_DAYS_PER_PERSON,
            INVITE_MAX_INVITEES * INVITE_REWARD_DAYS_PER_PERSON);
        rewardLog.push({
            machineId: machineId,
            phone: phone || '',
            inviteeCode: inviteeCode || '',
            time: new Date().toISOString(),
            rewardDays: INVITE_REWARD_DAYS_PER_PERSON,
            ip: ip || 'unknown'
        });
        await updateLicense(kv, inviter.code, {
            inviteCount: newCount,
            rewardDays: newRewardDays,
            inviteRewardLog: rewardLog
        });
        // 审计日志（邀请人码）
        await appendLicenseLog(kv, inviter.code, {
            action: 'invite-reward',
            time: new Date().toISOString(),
            ip: ip || 'unknown',
            operator: inviter.user || inviter.username || 'unknown',
            detail: `邀请第${newCount}人成功(${(machineId || '').substring(0, 8)}...)，+${INVITE_REWARD_DAYS_PER_PERSON}天，累计${newRewardDays}天`
        });
        return {
            granted: true,
            inviterCount: newCount,
            rewardDays: newRewardDays,
            inviteeBonusDays: INVITE_BONUS_DAYS_INVITEE
        };
    } catch (e) {
        // 发奖失败不阻断激活主流程（宁漏发不误伤）
        console.warn('[InviteReward] 发放失败:', e.message);
        return { granted: false, reason: '服务器错误' };
    }
}

// ============================================================================
//  ★ P2-3 计数上链：处方计数高水位跟踪 + 回拨（本地篡改）对账
//  KV key: usage:{code}，值为 JSON：
//    {
//      months: { "2026-08": 45 },          // 每月高水位计数（只增不减）
//      lastReport: { month, count, time, ip, machineId, source },
//      rollbackEvents: 0                    // 累计回拨（疑似本地清零/篡改）次数
//    }
//  规则（宁可漏检不可误报）：
//    - 高水位按【服务器月份】记键（防攻击者改本地时钟伪造月份绕过）
//    - 客户端上报月份 ≠ 服务器当月（月界时钟偏差）→ 只记录 lastReport，不对账
//    - 上报计数 > 同月高水位 → 更新高水位（正常增长）
//    - 上报计数 < 同月高水位 → 疑似本地清零，记 count_rollback 操作日志并累加
//    - 月份只保留最近 6 个月，防 KV 无限膨胀
//  调用方：heartbeat.js（心跳随报）/ verify.js（在线验证对账）/ admin-risk.js（展示）
// ============================================================================
const KV_USAGE_PREFIX = 'usage:';
const USAGE_KEEP_MONTHS = 6;

async function reportUsage(kv, code, report) {
    if (!kv || !code || !report) return null;
    const count = Number(report.rxCount);
    if (!Number.isFinite(count) || count < 0) return null;  // 未上报/非法值不处理
    const serverMonth = new Date().toISOString().substring(0, 7);
    const clientMonth = (typeof report.rxMonth === 'string' && /^\d{4}-\d{2}$/.test(report.rxMonth))
        ? report.rxMonth : null;
    const key = KV_USAGE_PREFIX + code;
    try {
        const data = (await kv.get(key, 'json')) || { months: {}, lastReport: null, rollbackEvents: 0 };
        if (!data.months || typeof data.months !== 'object') data.months = {};
        let rollback = false;
        let high = Number(data.months[serverMonth]) || 0;
        if (clientMonth && clientMonth !== serverMonth) {
            // 月界时钟偏差：不更新高水位、不对账（防误报），仅记录
        } else if (count > high) {
            data.months[serverMonth] = count;
            high = count;
        } else if (count < high) {
            rollback = true;
            data.rollbackEvents = (Number(data.rollbackEvents) || 0) + 1;
        }
        data.lastReport = {
            month: clientMonth || serverMonth,
            count: count,
            time: new Date().toISOString(),
            ip: report.ip || 'unknown',
            machineId: report.machineId ? String(report.machineId).substring(0, 8) + '...' : null,
            source: report.source || 'unknown'
        };
        // 只保留最近 N 个月（monthKey 字典序 = 时间序）
        const monthKeys = Object.keys(data.months).sort();
        while (monthKeys.length > USAGE_KEEP_MONTHS) {
            delete data.months[monthKeys.shift()];
        }
        await kv.put(key, JSON.stringify(data));
        if (rollback) {
            // 疑似本地清零/篡改：落审计日志（admin-risk 风控页可见）
            await appendLicenseLog(kv, code, {
                action: 'count_rollback',
                ip: report.ip || 'unknown',
                detail: '本地计数:' + count + ' 云端高水位:' + high + ' month:' + serverMonth +
                        ' source:' + (report.source || 'unknown')
            });
        }
        return { rollback: rollback, high: high, count: count, month: serverMonth };
    } catch (e) {
        console.warn('[Usage] 计数上报失败:', e.message);
        return null;
    }
}

// 读取某激活码的 usage 记录（admin-risk 风控展示用）
async function getUsage(kv, code) {
    if (!kv || !code) return null;
    try {
        return await kv.get(KV_USAGE_PREFIX + code, 'json');
    } catch (e) {
        return null;
    }
}

// ============================================================================
//  速率限制（简单 KV 实现，防止暴力破解）
// ============================================================================
// 记录 IP 的校验请求次数
async function checkRateLimit(kv, ip, maxPerHour = 5) {
    const key = `ratelimit:license:${ip}:${Math.floor(Date.now() / (60 * 60 * 1000))}`;
    const current = parseInt(await kv.get(key) || '0', 10);
    if (current >= maxPerHour) {
        return { allowed: false, current, max: maxPerHour };
    }
    await kv.put(key, String(current + 1), { expirationTtl: 3600 });
    return { allowed: true, current: current + 1, max: maxPerHour };
}

// ★ P0-1 安全补强：激活码级短时频控（防对单一合法激活码做换机试探/暴力爆破）
// 与 checkRateLimit（按 IP）不同，本函数按激活码维度限流，用于 validate.js 等
// 客户端激活入口。KV key 使用激活码大写（license:{code} 已含同样信息，无额外暴露）
async function checkCodeRateLimit(kv, code, maxPerHour = 5) {
    const normalized = String(code || '').toUpperCase();
    if (!normalized) return { allowed: false, current: 0, max: maxPerHour };
    const key = `ratelimit:code:${normalized}:${Math.floor(Date.now() / (60 * 60 * 1000))}`;
    const current = parseInt(await kv.get(key) || '0', 10);
    if (current >= maxPerHour) {
        return { allowed: false, current, max: maxPerHour };
    }
    await kv.put(key, String(current + 1), { expirationTtl: 3600 });
    return { allowed: true, current: current + 1, max: maxPerHour };
}

// ============================================================================
//  导出
// ============================================================================
export {
    LICENSE_HMAC_KEY,
    LICENSE_TYPE_CONFIG,
    ACTIVATION_CODE_CHARS,
    KV_LICENSE_PREFIX,
    KV_LICENSE_INDEX,
    generateActivationCode,
    generateSignature,
    generateSignatureV3,
    generateSignatureAuto,
    buildLicenseData,
    encodeLicenseBase64,
    getKV,
    appendRequestIndex,
    saveLicense,
    getLicense,
    updateLicense,
    listLicenses,
    sanitizeRecord,
    checkRateLimit,
    checkCodeRateLimit,  // ★ P0-1 新增：激活码级短时频控
    getDevices,        // ★ v4 新增：获取激活码已绑定的设备数组
    getMaxDevices,     // ★ v4 新增：获取激活码的最大设备数
    // ★ 设备-版本绑定：同一台设备只能注册一个版本
    versionOf,              // 判断 type/edition 属于机构版还是标准版
    getDeviceVersion,       // 读取设备已绑定版本
    setDeviceVersion,       // 写入设备版本绑定
    removeDeviceVersion,    // 解除设备版本绑定（客服后台管理）
    listDeviceVersions,     // 列出所有设备版本绑定
    checkDeviceVersion,     // 校验设备版本是否与目标版本一致
    isTestMachine,          // 判断设备是否在测试机白名单
    setTestMachine,         // 标记测试机
    removeTestMachine,      // 取消测试机
    listTestMachines,       // 列出测试机
    // ★ 任务5 新增：操作日志
    appendLicenseLog,  // 追加激活码操作日志
    getLicenseLogs,    // 查询激活码操作日志
    deleteLicenseLogs, // 删除激活码日志（删激活码时调用）
    // ★ P2-3 新增：计数上链（处方计数高水位 + 回拨对账）
    reportUsage,       // 心跳/在线验证时上报计数并检测本地篡改
    getUsage,          // 读取计数上报记录（风控展示）
    // ★ 2026-08-26 新增：推广奖励（邀请激活阶梯奖励 90天/人 封顶4人360天）
    INVITE_REWARD_DAYS_PER_PERSON,   // 邀请人每人奖励天数（90）
    INVITE_MAX_INVITEES,             // 封顶人数（4）
    INVITE_BONUS_DAYS_INVITEE,       // 被邀请人奖励天数（30）
    generateInviteCode,              // 生成6位邀请码
    ensureInviteCode,                // 确保激活码记录有邀请码（幂等）
    findLicenseByInviteCode,         // 按邀请码查激活码记录
    applyInviteReward,               // 发放邀请奖励（validate 激活成功时调用）
    // ★ 任务2 新增：ECDSA P-256 非对称签名
    ecdsaSign,              // 用 ECDSA 私钥签名消息
    generateSignatureV5,    // 生成 v5 签名（ECDSA P-256）
    getEcdsaPrivateKeyPem,    // 从环境变量读取 ECDSA 私钥（PEM 格式）
    // ★ P1-[2.2] 新增：ECDSA v6 防重放签名
    generateSignatureV6,    // 生成 v6 签名（v5 内容 + serial + nonce）
    getNextSerial,          // 激活码单调递增签发序号（KV 持久化，防重放核心）
    // ★ P1 安全分发优化：masterKey 下发
    getLicenseMasterKey     // 从环境变量读取 LICENSE_MASTER_KEY（可选，未配置返回 null）
};
