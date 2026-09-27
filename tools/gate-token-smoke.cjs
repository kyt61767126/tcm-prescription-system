#!/usr/bin/env node
// ============================================================================
// gate-token-smoke.cjs — P3-A Gate Token 密码学一致性冒烟
//
// 加载真实代码：shared/auth-core/offline.js 的 IIFE-1（AuthCore.__gateTest），
// 签名侧与 functions/api/license/entitlement.js 的 signGateToken 同逻辑（ES256
// raw r||s，Web Crypto），用真实服务端私钥（%TEMP%\gate-p8.b64）签发，
// 验证「服务端签 → 客户端验」真实链路 + 各种攻击/边界输入 fail-closed。
//
// 退出码：0=全部通过；1=有用例失败；2=环境缺失（真实私钥不存在）
// ============================================================================
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const webcrypto = require('crypto').webcrypto;

const ROOT = path.join(__dirname, '..');

// ---------- 加载 offline.js IIFE-1（截至第一个 IIFE 结束） ----------
const src = fs.readFileSync(path.join(ROOT, 'shared/auth-core/offline.js'), 'utf8');
const cutIdx = src.indexOf("})(typeof window");
if (cutIdx < 0) { console.error('[FATAL] 找不到 IIFE-1 结束标记'); process.exit(1); }
const lineEnd = src.indexOf('\n', cutIdx);
const prefixCode = src.slice(0, lineEnd < 0 ? src.length : lineEnd);
const __memStore = new Map();
const sandbox = {
    console,
    setTimeout, clearTimeout, setInterval, clearInterval,
    addEventListener: () => {},
    removeEventListener: () => {},
    atob: (s) => Buffer.from(String(s), 'base64').toString('binary'),
    btoa: (s) => Buffer.from(String(s), 'binary').toString('base64'),
    crypto: webcrypto,
    TextEncoder, TextDecoder,
    localStorage: {
        getItem: (k) => __memStore.has(k) ? __memStore.get(k) : null,
        setItem: (k, v) => __memStore.set(k, String(v)),
        removeItem: (k) => __memStore.delete(k)
    },
    document: { readyState: 'complete', addEventListener: () => {} }
};
vm.runInNewContext(prefixCode, sandbox, { filename: 'offline.iife1.js' });
const gate = sandbox.AuthCore && sandbox.AuthCore.__gateTest;
if (!gate) { console.error('[FATAL] AuthCore.__gateTest 未挂载'); process.exit(1); }

// ---------- 导入真实服务端私钥 ----------
const p8File = path.join(os.tmpdir(), 'gate-p8-v2.b64');
if (!fs.existsSync(p8File)) {
    console.error('[SKIP] 真实私钥 %TEMP%\\gate-p8-v2.b64 不存在，无法验证真实链路');
    process.exit(2);
}
const p8b64 = fs.readFileSync(p8File, 'utf8').trim();
async function importP8(b64) {
    const der = Uint8Array.from(Buffer.from(b64, 'base64'));
    return webcrypto.subtle.importKey('pkcs8', der,
        { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
}
async function main() {
const signKey = await importP8(p8b64);

// ---------- 与 entitlement.js 同源的编码/签名 ----------
function b64urlFromBytes(u8) {
    return Buffer.from(u8).toString('base64')
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlFromStr(str) { return b64urlFromBytes(Buffer.from(str, 'utf8')); }

async function signToken(payload, privKey, { kid = 'v2', alg = 'ES256', typ = 'JWT', rawHeader } = {}) {
    const header = rawHeader || { alg, typ, kid };
    const si = b64urlFromStr(JSON.stringify(header)) + '.'
             + b64urlFromStr(JSON.stringify(payload));
    const sigBuf = await webcrypto.subtle.sign(
        { name: 'ECDSA', hash: 'SHA-256' }, privKey, Buffer.from(si, 'utf8'));
    return si + '.' + b64urlFromBytes(new Uint8Array(sigBuf));
}

// ---------- 测试框架 ----------
let pass = 0, failN = 0;
const failures = [];
function check(name, cond, detail) {
    if (cond) { pass++; console.log('  PASS  ' + name); }
    else { failN++; failures.push(name + (detail ? ' → ' + detail : '')); console.log('  FAIL  ' + name + (detail ? ' → ' + detail : '')); }
}

const MID = 'testmid0123456789abcdef0123456789ab';
const nowSec = Math.floor(Date.now() / 1000);
function mkPayload(over) {
    return Object.assign({
        v: 1, mid: MID, username: '测试账号', state: 'LICENSED', type: 'standard',
        features: ['rx'], licExp: nowSec + 365 * 86400,
        iat: nowSec, exp: nowSec + 48 * 3600,
        jti: 'j-' + Math.random().toString(36).slice(2, 10)
    }, over || {});
}
// 翻转签名段中段固定位置字符：中段字符编码完整 6 bit，翻转必改签名字节。
// ★ 勿翻末字符：raw r||s base64url 末字符只有 2 个有效位，1/4 概率翻转无效（假红）。
function flipSigChar(token) {
    const parts = token.split('.');
    const seg = parts[2];
    const idx = Math.min(10, seg.length - 1);
    const c = seg[idx];
    const repl = /[A-M]/.test(c) ? 'N' : 'A';
    parts[2] = seg.slice(0, idx) + repl + seg.slice(idx + 1);
    return parts.join('.');
}

// evaluateOfflineGate 使用的存储键，每个用例前清空
const STORE_KEYS = ['license:gateToken', 'license:clockOffsetMs', 'license:maxLocalTime'];
async function resetStore() {
    for (const k of STORE_KEYS) { try { await gate.removeItem(k); } catch (e) {} }
}
async function setupGateStore(token, { offset = '0', maxLocal } = {}) {
    await resetStore();
    if (token != null) await gate.setItem('license:gateToken', token);
    if (offset != null) await gate.setItem('license:clockOffsetMs', offset);
    await gate.setItem('license:maxLocalTime',
        String(maxLocal != null ? maxLocal : Date.now() - 60000));
}

console.log('\n=== P3-A Gate Token Smoke ===\n');

// 0. 私钥公钥配对检查：真实私钥导出的公钥必须 = offline.js 内置 v1 公钥
{
    const privKeyObj = require('crypto').createPrivateKey({
        key: Buffer.from(p8b64, 'base64'), format: 'der', type: 'pkcs8'
    });
    const pubKeyObj = require('crypto').createPublicKey(privKeyObj);
    const spkiB64 = pubKeyObj.export({ format: 'der', type: 'spki' }).toString('base64');
    check('真实私钥公钥 = offline.js 内置 v2 公钥',
        spkiB64 === gate.GATE_VERIFY_PUBKEYS.v2, spkiB64.slice(0, 32) + '…');
}

// 1. 正常 token 验签
{
    const token = await signToken(mkPayload(), signKey);
    const p = await gate.verifyGateToken(token, MID, Date.now());
    check('正常 token 验签通过且字段完整', !!(p && p.state === 'LICENSED' && p.mid === MID));
}

// 2. 过期 token（exp 已过）
{
    const token = await signToken(mkPayload({ iat: nowSec - 100000, exp: nowSec - 3600 }), signKey);
    const p = await gate.verifyGateToken(token, MID, Date.now());
    check('过期 token 拒绝', p === null);
}

// 3. mid 不符（token 签给别的设备）
{
    const token = await signToken(mkPayload({ mid: 'othermid0123456789abcdef012345678' }), signKey);
    const p = await gate.verifyGateToken(token, MID, Date.now());
    check('mid 不符拒绝', p === null);
}

// 4. 签名篡改
{
    const token = flipSigChar(await signToken(mkPayload(), signKey));
    const p = await gate.verifyGateToken(token, MID, Date.now());
    check('签名篡改拒绝', p === null);
}

// 5. payload 篡改（解码-改-重编码，签名不变）
{
    const good = await signToken(mkPayload(), signKey);
    const parts = good.split('.');
    const tampered = b64urlFromStr(b64urlToStrLocal(parts[1]).replace('standard', 'ultimate'));
    const p = await gate.verifyGateToken([parts[0], tampered, parts[2]].join('.'), MID, Date.now());
    check('payload 篡改拒绝', p === null);
}
function b64urlToStrLocal(s) {
    return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

// 6. 未知 kid
{
    const token = await signToken(mkPayload(), signKey, { kid: 'v9' });
    const p = await gate.verifyGateToken(token, MID, Date.now());
    check('未知 kid 拒绝', p === null);
}

// 7. 错公钥（他人密钥对，kid 仍标 v1）
{
    const kp2 = await webcrypto.subtle.generateKey(
        { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const token = await signToken(mkPayload(), kp2.privateKey, { kid: 'v1' });
    const p = await gate.verifyGateToken(token, MID, Date.now());
    check('非权威密钥签名拒绝', p === null);
}

// 8. 时钟边界：exp 晚 2 秒通过（现场取时，防用例间耗时越界）；早 1 秒拒绝
{
    const curSec = Math.floor(Date.now() / 1000);
    const ttl1 = await signToken(mkPayload({ iat: curSec, exp: curSec + 2 }), signKey);
    const p1 = await gate.verifyGateToken(ttl1, MID, Date.now());
    const ttl0 = await signToken(mkPayload({ iat: curSec, exp: curSec - 1 }), signKey);
    const p0 = await gate.verifyGateToken(ttl0, MID, Date.now());
    check('exp=now+2s 边界放行', p1 !== null);
    check('exp=now-1s 边界拒绝', p0 === null);
}

// 9. TTL 边界：1h TTL token（GATE_TOKEN_TTL_HOURS 最小 1h 语义）当前有效
{
    const token = await signToken(mkPayload({ exp: nowSec + 3600 }), signKey);
    const p = await gate.verifyGateToken(token, MID, Date.now());
    check('TTL=1h token 有效', p !== null && p.exp - p.iat === 3600);
}

// 10. 降级/缺字段：空串、非三段、非 ES256、无 v、无 mid
{
    const cases = [
        ['空串', ''],
        ['非三段', 'a.b'],
        ['非 ES256（none）', null],
        ['payload 无 v', null],
        ['payload 无 mid', null]
    ];
    let allReject = true;
    for (const [label, pre] of cases) {
        let token;
        if (pre === null) {
            if (label.includes('none')) {
                token = await signToken(mkPayload(), signKey, { rawHeader: { alg: 'none', typ: 'JWT', kid: 'v1' } });
            } else if (label.includes('无 v')) {
                token = await signToken(mkPayload({ v: undefined }), signKey);
            } else {
                const p = mkPayload(); delete p.mid;
                token = await signToken(p, signKey);
            }
        } else token = pre;
        const r = await gate.verifyGateToken(token, MID, Date.now());
        if (r !== null) { allReject = false; console.log('    未拒绝: ' + label); }
    }
    check('降级/缺字段全部拒绝', allReject);
}

// 11. evaluateOfflineGate：正常 token 放行
{
    const token = await signToken(mkPayload(), signKey);
    await setupGateStore(token);
    const r = await gate.evaluateOfflineGate(MID);
    check('evaluateOfflineGate 正常放行', r.ok === true);
}

// 12. evaluateOfflineGate：无基线（从未在线）→ no-baseline
{
    await setupGateStore(null, { offset: null });
    const r = await gate.evaluateOfflineGate(MID);
    check('evaluateOfflineGate 无基线拒绝', r.ok === false && r.reason === 'no-baseline');
}

// 13. evaluateOfflineGate：时间回拨 → rollback
{
    const token = await signToken(mkPayload(), signKey);
    await setupGateStore(token, { maxLocal: Date.now() + 24 * 3600 * 1000 });
    const r = await gate.evaluateOfflineGate(MID);
    check('evaluateOfflineGate 回拨拒绝', r.ok === false && r.reason === 'rollback');
}

// 14. evaluateOfflineGate：时钟偏移超 10 分钟 → offset
{
    const token = await signToken(mkPayload(), signKey);
    await setupGateStore(token, { offset: String(11 * 60 * 1000) });
    const r = await gate.evaluateOfflineGate(MID);
    check('evaluateOfflineGate 偏移超限拒绝', r.ok === false && r.reason === 'offset');
}

// 15. evaluateOfflineGate：token 缺失/过期 → expired
{
    await setupGateStore('', { offset: '0' });
    const r1 = await gate.evaluateOfflineGate(MID);
    const oldToken = await signToken(mkPayload({ exp: nowSec - 100 }), signKey);
    await setupGateStore(oldToken, { offset: '0' });
    const r2 = await gate.evaluateOfflineGate(MID);
    check('evaluateOfflineGate token 缺失/过期拒绝',
        r1.ok === false && r1.reason === 'expired' && r2.ok === false && r2.reason === 'expired');
}

// 16. 负向偏移超限 → offset
{
    const token = await signToken(mkPayload(), signKey);
    await setupGateStore(token, { offset: String(-11 * 60 * 1000) });
    const r = await gate.evaluateOfflineGate(MID);
    check('负向偏移超限拒绝', r.ok === false && r.reason === 'offset');
}

// 17. iat 签名下界：adjustedNow 回拨 1 年（等同删锚点+回拨时钟）拒绝；容差 5min 内放行
{
    const token = await signToken(mkPayload(), signKey);
    const pBack = await gate.verifyGateToken(token, MID, Date.now() - 365 * 86400 * 1000);
    const pTol = await gate.verifyGateToken(token, MID, Date.now() - 4 * 60 * 1000);
    check('iat 下界：回拨 1 年拒绝', pBack === null);
    check('iat 下界：容差内放行', pTol !== null);
}

// 18. licExp：授权在窗口内到期 → 离线拒绝；未到期放行
{
    const tExp = await signToken(mkPayload({ licExp: nowSec - 100 }), signKey);
    const pExp = await gate.verifyGateToken(tExp, MID, Date.now());
    const tOk = await signToken(mkPayload({ licExp: nowSec + 100 }), signKey);
    const pOk = await gate.verifyGateToken(tOk, MID, Date.now());
    check('licExp 已过期拒绝', pExp === null);
    check('licExp 未到期放行', pOk !== null);
}

// 19. ISO 字符串型 licExp（旧/脏数据）→ 解析 NaN fail-closed，绝不放行
{
    const token = await signToken(mkPayload({
        licExp: new Date(nowSec * 1000 + 100000).toISOString()
    }), signKey);
    const p = await gate.verifyGateToken(token, MID, Date.now());
    check('ISO 型 licExp 脏数据拒绝', p === null);
}

// 20. 窗口内回拨有界行为（残留认知）：token 已签发 24h（iat=now-24h），
//   adjustedNow 回拨 12h 仍落在 [iat,exp) → 按无状态验签语义放行；
//   回拨到 iat 之前（-25h）→ iat 下界拒绝。该残留需 root 存储写权限，由 P3-B 收敛。
{
    const token = await signToken(mkPayload({
        iat: nowSec - 24 * 3600, exp: nowSec + 24 * 3600
    }), signKey);
    const pIn = await gate.verifyGateToken(token, MID, Date.now() - 12 * 3600 * 1000);
    const pBefore = await gate.verifyGateToken(token, MID, Date.now() - 25 * 3600 * 1000);
    check('窗口内回拨（有界残留）行为固定', pIn !== null);
    check('回拨至 iat 前拒绝', pBefore === null);
}

await resetStore();

console.log('\n=== Result: ' + pass + ' passed, ' + failN + ' failed ===');
if (failN > 0) {
    console.error('\n失败用例:\n - ' + failures.join('\n - '));
    process.exit(1);
}
console.log('[OK] gate token smoke 全部通过');
}

main().catch(e => { console.error('[FATAL]', e); process.exit(1); });
