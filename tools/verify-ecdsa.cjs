#!/usr/bin/env node
// tools/verify-ecdsa.cjs — 端到端验证 ECDSA v5 签名是否在云端生效
//
// 验证链路：调用云端 validate API → 解码返回的 license → 检查 signatureV5 字段 → 用客户端公钥验签
// 若 license 含有效 signatureV5 且公钥验签通过 → 云端私钥已正确配置，ECDSA 防伪造保护已激活
//
// 用法：
//   模式1（已有未使用的激活码）：
//     node tools/verify-ecdsa.cjs --code BNZC-XXXX-XXXX-XXXX-XXXX
//   模式2（管理员凭据自动生成测试激活码）：
//     node tools/verify-ecdsa.cjs --admin <用户名> <密码>
const crypto = require('crypto');

const API_BASE = 'https://tcm-prescription-system.pages.dev';
// 与客户端 license-manager.js / LicenseManager.java 嵌入的公钥完全一致
const ECDSA_PUBLIC_KEY_PEM =
    '-----BEGIN PUBLIC KEY-----\n' +
    'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEq+n38Pe0t0cDjNyoXTgXAyofbl01\n' +
    'sbaJBMVtUy6+MGwbFCo+YBY+mrmyRBweSL/e1bj9qsUHawEsR9B7PzYSBA==\n' +
    '-----END PUBLIC KEY-----';

// 与云端 license-core.js generateSignatureV5 完全一致的签名内容构造
// 字段顺序：user|type|issuedAt|expiresAt|maxPrescriptions|features|clinicName|machineId|licenseBinding
function buildSignatureContent(data) {
    return [
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
}

// ECDSA raw(r||s 64字节) → ASN.1 DER（与 LicenseManager.java ecdsaRawToDer 一致）
function ecdsaRawToDer(rawSig) {
    const r = encodeEcdsaInteger(rawSig.slice(0, 32));
    const s = encodeEcdsaInteger(rawSig.slice(32, 64));
    const contentLen = r.length + s.length + 4;
    return Buffer.concat([
        Buffer.from([0x30, contentLen, 0x02, r.length]), r,
        Buffer.from([0x02, s.length]), s
    ]);
}
function encodeEcdsaInteger(raw) {
    let offset = 0;
    while (offset < raw.length - 1 && raw[offset] === 0) offset++;
    if (raw[offset] & 0x80) {
        return Buffer.concat([Buffer.from([0]), raw.slice(offset)]);
    }
    return raw.slice(offset);
}

async function http(method, path, body, token) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = 'Bearer ' + token;
    const res = await fetch(API_BASE + path, {
        method, headers,
        body: body ? JSON.stringify(body) : undefined
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch (e) { /* 非 JSON */ }
    return { status: res.status, json, text };
}

async function login(username, password) {
    const r = await http('POST', '/api/users?login=true', { username, password });
    if (!r.json || !r.json.token) {
        throw new Error('登录失败: ' + (r.json && r.json.error ? r.json.error : r.text));
    }
    return r.json.token;
}

async function generateTestCode(token) {
    const r = await http('POST', '/api/license/generate', {
        type: 'trial', days: 1, maxDevices: 1, count: 1, user: 'ecdsa-test-user'
    }, token);
    if (!r.json || !r.json.success) {
        throw new Error('生成激活码失败: ' + (r.json && r.json.error ? r.json.error : r.text));
    }
    // 返回格式 {success:true, codes:[{code,...}], count:N}
    const codes = r.json.codes || [];
    if (codes.length === 0) throw new Error('生成激活码失败（codes 为空）: ' + r.text);
    return codes[0].code;
}

async function validateCode(code) {
    const r = await http('POST', '/api/license/validate', {
        code: code,
        machineId: 'ecdsa-verify-test-' + Date.now(),
        user: 'ecdsa-test'
    });
    if (!r.json || !r.json.success) {
        throw new Error('激活失败: ' + (r.json && r.json.error ? r.json.error : r.text));
    }
    return r.json;
}

function decodeLicense(b64) {
    const jsonStr = Buffer.from(b64, 'base64').toString('utf8');
    return JSON.parse(jsonStr);
}

function verifyEcdsa(data) {
    const sigV5 = data.signatureV5;
    if (!sigV5) {
        return { ok: false, reason: 'license 无 signatureV5 字段 → 云端未配置 LICENSE_SIGN_PRIVATE_KEY，ECDSA 未生效（当前仅 HMAC）' };
    }
    const content = buildSignatureContent(data);
    const rawSig = Buffer.from(sigV5, 'hex');
    if (rawSig.length !== 64) {
        return { ok: false, reason: 'signatureV5 长度异常：' + rawSig.length + ' 字节（期望 64）' };
    }
    const derSig = ecdsaRawToDer(rawSig);
    const verifier = crypto.createVerify('SHA256');
    verifier.update(Buffer.from(content, 'utf8'));
    const ok = verifier.verify({ key: ECDSA_PUBLIC_KEY_PEM }, derSig);
    return { ok, content, sigLen: rawSig.length, sigVer: data.signatureVersion };
}

async function main() {
    const args = process.argv.slice(2);
    let code;
    if (args[0] === '--code') {
        code = args[1];
        if (!code) {
            console.error('请提供激活码: node tools/verify-ecdsa.cjs --code BNZC-XXXX-XXXX-XXXX-XXXX');
            process.exit(1);
        }
    } else if (args[0] === '--delete') {
        // 删除测试激活码：node tools/verify-ecdsa.cjs --delete <激活码> <用户名> <密码>
        const code = args[1], username = args[2], password = args[3];
        if (!code || !username || !password) {
            console.error('用法: node tools/verify-ecdsa.cjs --delete <激活码> <用户名> <密码>');
            process.exit(1);
        }
        console.log('登录云端...');
        const token = await login(username, password);
        console.log('登录成功，删除激活码', code);
        const r = await http('POST', '/api/license/status', { code: code, action: 'delete' }, token);
        console.log('─'.repeat(60));
        console.log(r.json ? JSON.stringify(r.json, null, 2) : r.text);
        console.log('─'.repeat(60));
        process.exit(r.json && r.json.success ? 0 : 1);
    } else if (args[0] === '--admin') {
        const username = args[1], password = args[2];
        if (!username || !password) {
            console.error('请提供管理员凭据: node tools/verify-ecdsa.cjs --admin <用户名> <密码>');
            process.exit(1);
        }
        console.log('[1/4] 登录云端...');
        const token = await login(username, password);
        console.log('      登录成功');
        console.log('[2/4] 生成测试激活码...');
        code = await generateTestCode(token);
        console.log('      激活码:', code);
    } else {
        console.error('用法:');
        console.error('  node tools/verify-ecdsa.cjs --code <激活码>');
        console.error('  node tools/verify-ecdsa.cjs --admin <用户名> <密码>');
        process.exit(1);
    }

    console.log('[3/4] 调用 validate 激活（生成带签名的 license）...');
    const result = await validateCode(code);
    console.log('      激活成功，已拿到 license');
    const license = decodeLicense(result.license);

    console.log('[4/4] 检查 ECDSA v5 签名...');
    console.log('─'.repeat(60));
    console.log('license 字段:', Object.keys(license).join(', '));
    console.log('signatureVersion:', license.signatureVersion);
    if (license.signatureV5) {
        console.log('signatureV5: 存在 (' + license.signatureV5.length + ' 字符 hex)');
    } else {
        console.log('signatureV5: 不存在');
    }
    console.log('─'.repeat(60));
    const verify = verifyEcdsa(license);
    if (verify.ok) {
        console.log(' ECDSA v5 验签成功！云端私钥已生效，license 防伪造保护已激活');
        console.log(' 签名内容: ' + verify.content);
    } else {
        console.log(' 验签失败: ' + verify.reason);
        if (verify.content) console.log(' 签名内容: ' + verify.content);
    }
    console.log('─'.repeat(60));
    if (verify.ok) process.exit(0); else process.exit(2);
}

main().catch(e => { console.error('错误:', e.message); process.exit(1); });
