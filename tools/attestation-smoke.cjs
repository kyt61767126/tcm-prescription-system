#!/usr/bin/env node
// ============================================================================
// attestation-smoke.cjs — P3-B Android 设备证明白盒冒烟
//
// 加载真实代码：
//   functions/api/license/_lib/attestation-core.js（验链/DER/扩展/POP/nonce/config）
//   functions/api/license/attestation/register.js（注册端点 + 重置裁决）
//   functions/api/license/entitlement.js（证明门集成）
//   functions/api/_lib/auth.js（signToken 构造 resetAuth）
//
// 合成链：自签 EC P-256 根 → 中间 → 叶子（带 KeyDescription 扩展；
//   softwareEnforced 用旧 schema 通用 TLV，teeEnforced 用现代 [tag] context
//   编码，两种解析路径同时覆盖）。默认不在信任集合 → 等价真机「华为软件链声称
//   TEE 但根不被信任」负向场景；通过 trustedRoots opts / env
//   ATTEST_EXTRA_TRUSTED_ROOTS 追加根后 → Tier A 正向。
//
// 退出码：0=全部通过；1=有用例失败。
// ============================================================================
'use strict';

const path = require('path');
const { pathToFileURL } = require('url');
const nodeCrypto = require('crypto');
const webcrypto = nodeCrypto.webcrypto;

const ROOT = path.join(__dirname, '..');
async function importRel(rel) {
    return import(pathToFileURL(path.join(ROOT, rel)).href);
}

// ---------- 测试框架 ----------
let pass = 0, failN = 0;
const failures = [];
function check(name, cond, detail) {
    if (cond) { pass++; console.log('  PASS  ' + name); }
    else {
        failN++;
        failures.push(name + (detail ? ' → ' + detail : ''));
        console.log('  FAIL  ' + name + (detail ? ' → ' + detail : ''));
    }
}
function section(t) { console.log('\n=== ' + t + ' ==='); }

// ============================================================================
//  MemKV（Cloudflare KV 最小模拟：string/json + expirationTtl）
// ============================================================================
class MemKV {
    constructor() { this.m = new Map(); }
    async get(key, opts) {
        const rec = this.m.get(key);
        if (!rec) return null;
        if (rec.expAt != null && rec.expAt < Date.now()) {
            this.m.delete(key);
            return null;
        }
        const isJson = opts === 'json' || (opts && opts.type === 'json');
        if (!isJson) return rec.value;
        try { return JSON.parse(rec.value); } catch (_) { return null; }
    }
    async put(key, value, opts = {}) {
        const expAt = opts.expirationTtl
            ? Date.now() + opts.expirationTtl * 1000 : null;
        this.m.set(key, { value: String(value), expAt });
    }
    async delete(key) { this.m.delete(key); }
    has(key) { return this.m.has(key); }
}

// ============================================================================
//  DER 基础工具
// ============================================================================
function u8(...parts) {
    return new Uint8Array(Buffer.concat(parts.map(p => Buffer.from(p))));
}
function derLen(n) {
    if (n < 0x80) return [n];
    const b = [];
    let v = n;
    while (v) { b.unshift(v & 0xff); v >>= 8; }
    return [0x80 | b.length, ...b];
}
/** 单字节 tag TLV。 */
function tlv(tag, content) {
    const c = content instanceof Uint8Array ? content : Uint8Array.from(content);
    return u8([tag], derLen(c.length), c);
}
/** 多字节 tag TLV（高号 context tag）。 */
function tlvTag(tagBytes, content) {
    const c = content instanceof Uint8Array ? content : Uint8Array.from(content);
    return u8(tagBytes, derLen(c.length), c);
}
function oidBytes(oid) {
    const parts = oid.split('.').map(Number);
    const out = [40 * parts[0] + parts[1]];
    for (let i = 2; i < parts.length; i++) {
        let v = parts[i];
        const stack = [v & 0x7f];
        v >>= 7;
        while (v) { stack.unshift(0x80 | (v & 0x7f)); v >>= 7; }
        out.push(...stack);
    }
    return Uint8Array.from(out);
}
/** 非负整数 → 最小字节。 */
function numBytes(n) {
    const b = [];
    let v = n;
    do { b.unshift(v & 0xff); v >>= 8; } while (v);
    return Uint8Array.from(b);
}
const asInt = n => tlv(0x02, numBytes(n));
/** OID TLV：oidBytes 只给内容，必须包 0x06。 */
const oid = dotted => tlv(0x06, oidBytes(dotted));

/**
 * context IMPLICIT 包裹：高号 tag（≥31）首字节 = 10(类) | 构造位 | 11111，
 * 后接 base-128 tag 号。
 */
function ctxTagBytes(num, constructed) {
    if (num < 31) return Uint8Array.of(0x80 | (constructed ? 0x20 : 0) | num);
    const first = 0x80 | (constructed ? 0x20 : 0) | 0x1f;
    const parts = [];
    let n = num;
    parts.push(n & 0x7f);
    n >>= 7;
    // base-128：除末字节外，续字节必须置最高位（0x80），如 600 → 84 58
    while (n) { parts.push(0x80 | (n & 0x7f)); n >>= 7; }
    return Uint8Array.of(first, ...parts.reverse());
}
function ctxImplicit(num, constructed, content) {
    return tlvTag(ctxTagBytes(num, constructed), content);
}

// ---------- 编码辅助 ----------
const toB64 = bytes => Buffer.from(bytes).toString('base64');
const hexToBytes = h => Uint8Array.from(Buffer.from(h, 'hex'));
const bytesToHex = b => Buffer.from(b).toString('hex');
const sha256Hex = b => nodeCrypto.createHash('sha256').update(Buffer.from(b)).digest('hex');
const randomBytesN = n => webcrypto.getRandomValues(new Uint8Array(n));

// ============================================================================
//  密钥与签名
// ============================================================================
async function ecPair() {
    return webcrypto.subtle.generateKey(
        { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
}
async function rsaPair() {
    return webcrypto.subtle.generateKey(
        { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048,
          publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true,
        ['sign', 'verify']);
}

/** ECDSA raw 签名 → 证书用 DER SEQUENCE{r,s}（带前导零规则）。 */
async function signEcdsaDer(kp, msg) {
    const raw = new Uint8Array(await webcrypto.subtle.sign(
        { name: 'ECDSA', hash: 'SHA-256' }, kp.privateKey, msg));
    const half = raw.length >> 1;
    const derInt = b0 => {
        let b = b0;
        let i = 0;
        while (i < b.length - 1 && b[i] === 0) i++;
        b = b.subarray(i);
        if (b[0] & 0x80) b = u8([0], b);
        return tlv(0x02, b);
    };
    return tlv(0x30, u8(derInt(raw.subarray(0, half)), derInt(raw.subarray(half))));
}

/** POP 用 raw R||S base64。 */
async function signProofRaw(kp, mid, nonce) {
    const msg = `bnzc_poc_v1|${mid}|${nonce}`;
    const raw = new Uint8Array(await webcrypto.subtle.sign(
        { name: 'ECDSA', hash: 'SHA-256' }, kp.privateKey, Buffer.from(msg, 'utf8')));
    return toB64(raw);
}

// ============================================================================
//  X.509 证书构造（ECDSA P-256 / SHA-256）
// ============================================================================
const OID_ECDSA_SHA256 = '1.2.840.10045.4.3.2';
function nameOf(cn) {
    // Name: SEQ{ SEQ{ OID(commonName 2.5.4.3), UTF8String } }
    return tlv(0x30, tlv(0x30, u8(
        oid('2.5.4.3'), tlv(0x0c, Buffer.from(cn, 'utf8')))));
}
function utcTime(d) {
    const p = n => String(n).padStart(2, '0');
    const s = p(d.getUTCFullYear() % 100) + p(d.getUTCMonth() + 1)
        + p(d.getUTCDate()) + p(d.getUTCHours()) + p(d.getUTCMinutes())
        + p(d.getUTCSeconds()) + 'Z';
    return tlv(0x17, Buffer.from(s, 'ascii'));
}

/**
 * 构造一张证书。自签根：issuerCN=subjectCN 且 issuerKP=subjectKP。
 */
async function buildCert(o) {
    const sigAlg = tlv(0x30, oid(OID_ECDSA_SHA256));
    const spkiDer = new Uint8Array(await webcrypto.subtle.exportKey(
        'spki', o.subjectKP.publicKey));
    const tbs = tlv(0x30, u8(
        tlv(0xA0, tlv(0x02, [2])),                       // version v3 [0] EXPLICIT
        tlv(0x02, numBytes(o.serial)),                   // serial
        sigAlg,                                          // inner sigAlg
        nameOf(o.issuerCN),
        tlv(0x30, u8(utcTime(o.notBefore), utcTime(o.notAfter))),
        nameOf(o.subjectCN),
        spkiDer,
        tlv(0xA3, tlv(0x30, u8(...o.extensions)))        // extensions [3]
    ));
    const sig = await signEcdsaDer(o.issuerKP, tbs);
    return tlv(0x30, u8(tbs, sigAlg,
        tlv(0x03, u8([0], sig))));                        // BIT STRING unused=0
}

// ============================================================================
//  KeyDescription / AuthorizationList 构造
// ============================================================================
function applicationSeq(app) {
    // SEQ{ packageName OCTET, signatures SEQ{ OCTET(32字节摘要) } }
    return tlv(0x30, u8(
        tlv(0x04, Buffer.from(app.pkg, 'utf8')),
        tlv(0x30, tlv(0x04, app.digest))
    ));
}
function rootOfTrustSeq(rot) {
    // SEQ{ bootKey OCTET32, deviceLocked BOOLEAN, verifiedBootState ENUMERATED }
    return tlv(0x30, u8(
        tlv(0x04, rot.bootKey),
        tlv(0x01, [rot.locked ? 0xff : 0x00]),
        tlv(0x0A, [rot.bootState])
    ));
}

/** 旧 schema：value 为通用 TLV 直给。 */
function oldAuthList(app, rot, osVersion, osPatch) {
    return tlv(0x30, u8(
        tlv(0x30, u8(asInt(600), applicationSeq(app))),
        tlv(0x30, u8(asInt(704), rootOfTrustSeq(rot))),
        tlv(0x30, u8(asInt(705), asInt(osVersion))),
        tlv(0x30, u8(asInt(706), asInt(osPatch)))
    ));
}
/** 现代 schema：value 为 [tag] IMPLICIT context 包裹。 */
function modernAuthList(app, rot, osVersion, osPatch) {
    return tlv(0x30, u8(
        tlv(0x30, u8(asInt(600),
            ctxImplicit(600, true, applicationSeq(app)))),
        tlv(0x30, u8(asInt(704),
            ctxImplicit(704, true, rootOfTrustSeq(rot)))),
        tlv(0x30, u8(asInt(705),
            ctxImplicit(705, false, numBytes(osVersion)))),
        tlv(0x30, u8(asInt(706),
            ctxImplicit(706, false, numBytes(osPatch))))
    ));
}
function buildKeyDescription(o) {
    return tlv(0x30, u8(
        asInt(o.version),
        tlv(0x0A, [o.attSec]),
        asInt(o.kmVersion),
        tlv(0x0A, [o.kmSec]),
        tlv(0x04, o.challenge),
        tlv(0x04, o.uniqueId),
        o.softwareAuth,
        o.teeAuth
    ));
}

// ============================================================================
//  合成链：根/中间一次生成；叶子按变体参数每次新生成
// ============================================================================
const NOW = Date.now();
const DAY = 864e5;
const MID = 'testmid0123456789abcdef0123456789ab';
const LIC_CODE = 'BNZC-AAAA-BBBB-CCCC-DDDD';

/** X.509 basicConstraints 扩展（Extension TLV）：ca=true/false，可选 pathLen。 */
function bcExt(ca, pathLen) {
    let inner = ca ? tlv(0x01, Uint8Array.of(0xff)) : u8(...[]);
    if (Number.isInteger(pathLen)) inner = u8(inner, tlv(0x02, numBytes(pathLen)));
    return tlv(0x30, u8(oid('2.5.29.19'), tlv(0x04, tlv(0x30, inner))));
}

async function makeRoot(cn) {
    const kp = await ecPair();
    const der = await buildCert({
        subjectCN: cn, subjectKP: kp, issuerCN: cn, issuerKP: kp,
        serial: 1, notBefore: new Date(NOW - DAY),
        notAfter: new Date(NOW + 3650 * DAY), extensions: [bcExt(true)]
    });
    return { cn, kp, der };
}

async function buildLeaf(root, inter, opts = {}) {
    const kp = await ecPair();
    const challenge = opts.challenge || randomBytesN(16);
    const app = {
        pkg: opts.pkg,
        digest: hexToBytes(opts.digest)
    };
    const rot = {
        bootKey: opts.bootKey || randomBytesN(32),
        locked: opts.locked,
        bootState: opts.bootState
    };
    const osVersion = opts.osVersion;
    const osPatch = opts.osPatch;
    const kd = buildKeyDescription({
        version: 3, attSec: opts.attSec, kmVersion: 3, kmSec: opts.attSec,
        challenge, uniqueId: new Uint8Array(16),
        softwareAuth: oldAuthList(app, rot, osVersion, osPatch),
        teeAuth: modernAuthList(app, rot, osVersion, osPatch)
    });
    const extensions = opts.noExt ? []
        : [tlv(0x30, u8(oid(opts.oid), tlv(0x04, kd)))];
    const der = await buildCert({
        subjectCN: 'Android Keystore Key', subjectKP: kp,
        issuerCN: inter.cn, issuerKP: inter.kp,
        serial: Math.floor(Math.random() * 1e9) + 1,
        notBefore: new Date(NOW - DAY),
        notAfter: new Date(NOW + 730 * DAY),
        extensions
    });
    return {
        der, kp, challenge,
        spkiB64: toB64(new Uint8Array(await webcrypto.subtle.exportKey(
            'spki', kp.publicKey))),
        chainB64: [toB64(der), toB64(inter.der), toB64(root.der)]
    };
}

/** 翻转证书尾部签名字节（避开 DER 结构字节）。 */
function flipSigByte(derBytes) {
    const out = Uint8Array.from(derBytes);
    const idx = out.length - 6;
    out[idx] ^= 0xff;
    return out;
}

// ============================================================================
//  端点调用辅助
// ============================================================================
function makeContext(kv, body, opts = {}) {
    const headers = new Map();
    headers.set('Origin', opts.origin || 'https://tcm-prescription-system.pages.dev');
    headers.set('CF-Connecting-IP', opts.ip || '10.0.0.1');
    headers.set('Content-Type', 'application/json');
    const request = {
        method: opts.method || 'POST',
        headers,
        json: async () => body
    };
    return {
        request,
        env: Object.assign({ KV: kv }, opts.env || {}),
        waitUntil: async () => {}
    };
}
async function callEndpoint(mod, context) {
    const resp = await mod.onRequest(context);
    const text = await resp.text();
    let data = null;
    try { data = JSON.parse(text); } catch (_) {}
    return { status: resp.status, data };
}

/** KV 中放一张授权码夹具。 */
async function putLicense(kv, o = {}) {
    const rec = {
        code: o.code || LIC_CODE,
        type: o.type || 'pro',
        status: o.status || 'used',
        devices: [{ machineId: o.mid || MID }],
        expiresAt: new Date(NOW + 365 * DAY).toISOString(),
        activatedAt: new Date(NOW - DAY).toISOString()
    };
    if (o.user) rec.user = o.user;
    if (o.clinicName) rec.clinicName = o.clinicName;
    await kv.put('license:' + rec.code, JSON.stringify(rec));
    const idx = (await kv.get('system:license_index', 'json')) || [];
    if (!idx.includes(rec.code)) {
        idx.push(rec.code);
        await kv.put('system:license_index', JSON.stringify(idx));
    }
    return rec;
}

/** 走完整 challenge→register 流程登记一张叶子（真实设备时序）。 */
let regMod = null;
let regChainCtx = null;   // {root, inter, defaultOpts}，由 main 注入
async function registerChain(kv, spec, env, ip) {
    const ch = await callEndpoint(regMod, makeContext(kv,
        { action: 'challenge', mid: MID }, { env, ip }));
    // 真实设备：服务端下发 challenge → 用该 challenge 现生成密钥与证书
    const challengeBytes = Buffer.from(ch.data.challenge, 'base64');
    const leaf = await buildLeaf(regChainCtx.root, regChainCtx.inter,
        { ...regChainCtx.defaultOpts, ...(spec || {}), challenge: challengeBytes });
    const reg = await callEndpoint(regMod, makeContext(kv,
        { action: 'register', mid: MID, certChain: leaf.chainB64 },
        { env, ip }));
    return { ch, reg, leaf };
}

/** 仅取服务端 challenge 并用它现建叶子（用于需要自定义 register body 的用例）。 */
async function fetchChallengeAndBuild(kv, env, ip, spec) {
    const ch = await callEndpoint(regMod, makeContext(kv,
        { action: 'challenge', mid: MID }, { env, ip }));
    const challengeBytes = Buffer.from(ch.data.challenge, 'base64');
    return buildLeaf(regChainCtx.root, regChainCtx.inter,
        { ...regChainCtx.defaultOpts, ...(spec || {}), challenge: challengeBytes });
}

// ============================================================================
//  主流程
// ============================================================================
async function main() {
    const core = await importRel('functions/api/license/_lib/attestation-core.js');
    regMod = await importRel('functions/api/license/attestation/register.js');
    const entMod = await importRel('functions/api/license/entitlement.js');
    const authMod = await importRel('functions/api/_lib/auth.js');

    const {
        verifyCertChain, parseCertificate, parseAttestationExtension,
        verifyAndParseRegistration, verifyProof, issueProofNonce,
        consumeProofNonce, getDeviceRegistration, kidFromSpkiB64,
        derEcdsaToRaw, getAttestationConfig, CHALLENGE_TTL_SEC
    } = core;
    const {
        ATTESTATION_OID, OFFICIAL_PACKAGE, OFFICIAL_APP_SIGNATURE_DIGEST_HEX,
        TRUSTED_GOOGLE_ROOT_FINGERPRINTS, SEC_TEE, BOOT_VERIFIED,
        CONFIG_KEY
    } = core;

    // 固定根/中间 + 默认叶子（默认参数=官方包、官方指纹、TEE、locked、Verified）
    const root = await makeRoot('P3B Test Root');
    const inter = await makeRoot('P3B Test Intermediate');   // 同构生成后再用根签
    inter.der = await buildCert({
        subjectCN: inter.cn, subjectKP: inter.kp,
        issuerCN: root.cn, issuerKP: root.kp,
        serial: 2, notBefore: new Date(NOW - DAY),
        notAfter: new Date(NOW + 3650 * DAY), extensions: [bcExt(true)]
    });
    const ROOT_FP = sha256Hex(root.der);

    const defaultOpts = {
        pkg: OFFICIAL_PACKAGE,
        digest: OFFICIAL_APP_SIGNATURE_DIGEST_HEX,
        locked: true, bootState: BOOT_VERIFIED, attSec: SEC_TEE,
        osVersion: 120000, osPatch: 20220901, oid: ATTESTATION_OID
    };
    const leaf = await buildLeaf(root, inter, defaultOpts);
    regChainCtx = { root, inter, defaultOpts };

    // ------------------------------------------------------------------ A
    section('A. 证书解析与链验证');

    {
        const p = parseCertificate(leaf.der);
        check('叶子解析：EC/P-256 且含 attestation 扩展',
            p.keyClass === 'EC'
            && p.curveOid === '1.2.840.10045.3.1.7'
            && p.extensions.has(ATTESTATION_OID));
        check('叶子有效期窗口包含当前时间',
            p.notBefore <= NOW && p.notAfter >= NOW);
        check('叶子签名可摊平为 raw R||S',
            !!derEcdsaToRaw(p.sigValue, 32));
    }
    {
        const r = await verifyCertChain(leaf.chainB64);
        check('默认信任锚：非 Google 根 → untrusted_root 且回传指纹',
            r.ok === false && r.reason === 'untrusted_root'
            && r.rootFp === ROOT_FP);
    }
    {
        const r = await verifyCertChain(leaf.chainB64,
            { trustedRoots: [ROOT_FP] });
        check('追加合成根后：验链通过（3 节）',
            r.ok === true && r.parsed.length === 3 && r.rootFp === ROOT_FP);
    }
    {
        const bad = Uint8Array.from(leaf.chainB64);
        const chain = leaf.chainB64.slice();
        chain[0] = toB64(flipSigByte(leaf.der));
        const r = await verifyCertChain(chain, { trustedRoots: [ROOT_FP] });
        check('叶子签名被篡改 → bad_signature',
            !r.ok && r.reason === 'bad_signature', r.reason);
    }
    {
        const chain = leaf.chainB64.slice();
        chain[1] = toB64(flipSigByte(inter.der));
        const r = await verifyCertChain(chain, { trustedRoots: [ROOT_FP] });
        check('中间证书签名被篡改 → bad_signature',
            !r.ok && r.reason === 'bad_signature', r.reason);
    }
    {
        const r = await verifyCertChain([]);
        check('空链 → empty_chain', !r.ok && r.reason === 'empty_chain');
    }
    {
        const r = await verifyCertChain(leaf.chainB64,
            { trustedRoots: [ROOT_FP], nowMs: NOW + 4000 * DAY });
        check('超远未来时间 → cert_expired',
            !r.ok && r.reason === 'cert_expired', r.reason);
    }
    {
        const r = await verifyCertChain(leaf.chainB64,
            { trustedRoots: [ROOT_FP], nowMs: NOW - 30 * DAY });
        check('超远过去时间 → cert_not_yet_valid',
            !r.ok && r.reason === 'cert_not_yet_valid', r.reason);
    }
    {
        const r = await verifyCertChain(leaf.chainB64, {
            trustedRoots: [ROOT_FP], nowMs: NOW + 4000 * DAY,
            checkValidity: false
        });
        check('checkValidity:false 跳过有效期 → 通过', r.ok === true);
    }
    {
        // 根证书由另一把密钥签发（subject 与 issuer 同名但不自签）
        const rootKp2 = await ecPair();
        const signerKp2 = await ecPair();
        const root2Der = await buildCert({
            subjectCN: 'Bad Self-Signed Root', subjectKP: rootKp2,
            issuerCN: 'Bad Self-Signed Root', issuerKP: signerKp2,
            serial: 9, notBefore: new Date(NOW - DAY),
            notAfter: new Date(NOW + 3650 * DAY), extensions: [bcExt(true)]
        });
        const kpx = await ecPair();
        const interX = await buildCert({
            subjectCN: 'X', subjectKP: kpx,
            issuerCN: 'Bad Self-Signed Root', issuerKP: rootKp2,
            serial: 3, notBefore: new Date(NOW - DAY),
            notAfter: new Date(NOW + 3650 * DAY), extensions: []
        });
        const r = await verifyCertChain([toB64(interX), toB64(root2Der)],
            { trustedRoots: [sha256Hex(root2Der)] });
        check('根非自签 → root_not_self_signed',
            !r.ok && r.reason === 'root_not_self_signed', r.reason);
    }

    // ------------------------------------------------------------------ B
    section('B. KeyDescription 扩展解析与注册一站式验证');

    {
        const kd = parseAttestationExtension(parseCertificate(leaf.der));
        check('头部：attSecLevel=TEE(1)', kd.attSecLevel === 1);
        check('challenge 与下发一致',
            bytesToHex(kd.challenge) === bytesToHex(leaf.challenge));
        check('softwareEnforced（旧编码）：包名/指纹/锁定/boot/os 全解析',
            kd.softwareEnforced.packageName === OFFICIAL_PACKAGE
            && kd.softwareEnforced.signatureDigests
                .includes(OFFICIAL_APP_SIGNATURE_DIGEST_HEX)
            && kd.softwareEnforced.rootOfTrust.deviceLocked === true
            && kd.softwareEnforced.rootOfTrust.verifiedBootState === 0
            && kd.softwareEnforced.osVersion === 120000
            && kd.softwareEnforced.osPatch === 20220901);
        check('teeEnforced（现代 context 编码）：包名/指纹/锁定/boot/os 全解析',
            kd.teeEnforced.packageName === OFFICIAL_PACKAGE
            && kd.teeEnforced.signatureDigests
                .includes(OFFICIAL_APP_SIGNATURE_DIGEST_HEX)
            && kd.teeEnforced.rootOfTrust.deviceLocked === true
            && kd.teeEnforced.rootOfTrust.verifiedBootState === 0
            && kd.teeEnforced.osVersion === 120000
            && kd.teeEnforced.osPatch === 20220901);
    }
    {
        // 真机等价负向：链能解析但默认锚不信任 → 必须拒
        const r = await verifyAndParseRegistration({
            kv: new MemKV(), mid: MID, certChainB64: leaf.chainB64,
            expectedChallengeB64: toB64(leaf.challenge)
        });
        check('默认锚：注册验证 → untrusted_root（真机软件链同理）',
            !r.ok && r.reason === 'untrusted_root', r.reason);
    }
    {
        const r = await verifyAndParseRegistration({
            kv: new MemKV(), mid: MID, certChainB64: leaf.chainB64,
            expectedChallengeB64: toB64(leaf.challenge),
            chainOpts: { trustedRoots: [ROOT_FP] }
        });
        check('追加信任根：注册验证通过且 info 完整',
            r.ok === true && r.info.spkiB64 === leaf.spkiB64
            && r.info.kid === await kidFromSpkiB64(leaf.spkiB64)
            && r.info.secLevel === SEC_TEE
            && r.info.boot.state === BOOT_VERIFIED
            && r.info.packageName === OFFICIAL_PACKAGE);
    }
    {
        const r = await verifyAndParseRegistration({
            kv: new MemKV(), mid: MID, certChainB64: leaf.chainB64,
            expectedChallengeB64: toB64(randomBytesN(16)),
            chainOpts: { trustedRoots: [ROOT_FP] }
        });
        check('challenge 不符 → challenge_mismatch',
            !r.ok && r.reason === 'challenge_mismatch');
    }
    {
        const l2 = await buildLeaf(root, inter,
            Object.assign({}, defaultOpts, { attSec: 0 }));
        const r = await verifyAndParseRegistration({
            kv: new MemKV(), mid: MID, certChainB64: l2.chainB64,
            expectedChallengeB64: toB64(l2.challenge),
            chainOpts: { trustedRoots: [ROOT_FP] }
        });
        check('安全级 Software → security_level_not_hardware',
            !r.ok && r.reason === 'security_level_not_hardware', r.reason);
    }
    {
        const l2 = await buildLeaf(root, inter,
            Object.assign({}, defaultOpts, { pkg: 'com.evil.fake' }));
        const r = await verifyAndParseRegistration({
            kv: new MemKV(), mid: MID, certChainB64: l2.chainB64,
            expectedChallengeB64: toB64(l2.challenge),
            chainOpts: { trustedRoots: [ROOT_FP] }
        });
        check('包名不符 → package_name_mismatch',
            !r.ok && r.reason === 'package_name_mismatch');
    }
    {
        const l2 = await buildLeaf(root, inter,
            Object.assign({}, defaultOpts,
                { digest: 'a'.repeat(64) }));
        const r = await verifyAndParseRegistration({
            kv: new MemKV(), mid: MID, certChainB64: l2.chainB64,
            expectedChallengeB64: toB64(l2.challenge),
            chainOpts: { trustedRoots: [ROOT_FP] }
        });
        check('发布指纹不符 → app_signature_mismatch',
            !r.ok && r.reason === 'app_signature_mismatch');
    }
    {
        const l2 = await buildLeaf(root, inter,
            Object.assign({}, defaultOpts, { locked: false }));
        const r = await verifyAndParseRegistration({
            kv: new MemKV(), mid: MID, certChainB64: l2.chainB64,
            expectedChallengeB64: toB64(l2.challenge),
            chainOpts: { trustedRoots: [ROOT_FP] }
        });
        check('deviceLocked=false（默认硬拒）→ device_not_locked',
            !r.ok && r.reason === 'device_not_locked', r.reason);
    }
    {
        const l2 = await buildLeaf(root, inter,
            Object.assign({}, defaultOpts, { bootState: 2 }));
        const r = await verifyAndParseRegistration({
            kv: new MemKV(), mid: MID, certChainB64: l2.chainB64,
            expectedChallengeB64: toB64(l2.challenge),
            chainOpts: { trustedRoots: [ROOT_FP] }
        });
        check('bootState≠Verified（硬拒）→ boot_state_not_verified',
            !r.ok && r.reason === 'boot_state_not_verified', r.reason);
    }
    {
        const l2 = await buildLeaf(root, inter,
            Object.assign({}, defaultOpts, { locked: false }));
        const r = await verifyAndParseRegistration({
            kv: new MemKV(), mid: MID, certChainB64: l2.chainB64,
            expectedChallengeB64: toB64(l2.challenge),
            config: { mode: 'observe', bootSoftFail: true },
            chainOpts: { trustedRoots: [ROOT_FP] }
        });
        check('bootSoftFail=true：带 bootWarn 软放行',
            r.ok === true && r.bootWarn === 'device_not_locked');
    }
    {
        const l2 = await buildLeaf(root, inter,
            Object.assign({}, defaultOpts, { noExt: true }));
        const r = await verifyAndParseRegistration({
            kv: new MemKV(), mid: MID, certChainB64: l2.chainB64,
            expectedChallengeB64: toB64(l2.challenge),
            chainOpts: { trustedRoots: [ROOT_FP] }
        });
        check('叶子无 attestation 扩展 → attestation_parse_failed',
            !r.ok && /^attestation_parse_failed/.test(r.reason), r.reason);
    }

    // ------------------------------------------------------------------ C
    section('C. POP 持有性证明验签');

    {
        const nonce = toB64(randomBytesN(16));
        const sig = await signProofRaw(leaf.kp, MID, nonce);
        const ok = await verifyProof({
            spkiB64: leaf.spkiB64, mid: MID, nonce, sigB64: sig
        });
        check('合法 proof 验签通过', ok === true);
    }
    {
        const nonce = toB64(randomBytesN(16));
        const sig = await signProofRaw(leaf.kp, MID, nonce);
        const a = await verifyProof({
            spkiB64: leaf.spkiB64, mid: 'othermid9999999999999999999999',
            nonce, sigB64: sig
        });
        const b = await verifyProof({
            spkiB64: leaf.spkiB64, mid: MID,
            nonce: toB64(randomBytesN(16)), sigB64: sig
        });
        check('mid/nonce 不一致 → 拒绝', a === false && b === false);
    }
    {
        const nonce = toB64(randomBytesN(16));
        const sigBuf = Uint8Array.from(
            Buffer.from(await signProofRaw(leaf.kp, MID, nonce), 'base64'));
        sigBuf[10] ^= 0xff;
        const ok = await verifyProof({
            spkiB64: leaf.spkiB64, mid: MID, nonce,
            sigB64: toB64(sigBuf)
        });
        check('签名被翻转 → 拒绝', ok === false);
    }
    {
        const kp = await rsaPair();
        const spkiB64 = toB64(new Uint8Array(
            await webcrypto.subtle.exportKey('spki', kp.publicKey)));
        const ok = await verifyProof({
            spkiB64, mid: MID, nonce: toB64(randomBytesN(16)),
            sigB64: 'AA=='
        });
        check('RSA 公钥 proof → 拒绝（只接受 EC）', ok === false);
    }
    {
        const ok = await verifyProof({ spkiB64: '', mid: '', nonce: '', sigB64: '' });
        check('参数缺失 → 拒绝', ok === false);
    }

    // ------------------------------------------------------------------ D
    section('D. proof nonce 一次性 + mid 绑定');

    {
        const kv = new MemKV();
        const n = await issueProofNonce(kv, MID);
        check('签发：jti/nonce 均有值', !!n.jti && !!n.nonce);
        const c1 = await consumeProofNonce(kv, n.jti);
        check('首次消费：返回 nonce 且绑定 mid',
            !!c1 && c1.nonce === n.nonce && c1.mid === MID);
        const c2 = await consumeProofNonce(kv, n.jti);
        check('二次消费 → null（读后即删防重放）', c2 === null);
    }
    {
        const kv = new MemKV();
        const c = await consumeProofNonce(kv, 'no-such-jti');
        check('未知 jti → null', c === null);
    }

    // ------------------------------------------------------------------ E
    section('E. register 端点：注册流程与重置裁决四策略');

    {
        const kv = new MemKV();
        const r = await callEndpoint(regMod, makeContext(kv, null,
            { method: 'OPTIONS' }));
        check('OPTIONS → 200', r.status === 200);
    }
    {
        const kv = new MemKV();
        const r = await callEndpoint(regMod, makeContext(kv,
            { action: 'challenge', mid: MID }, { ip: '10.1.0.1' }));
        check('challenge：成功且 KV 已落短 TTL 键',
            r.status === 200 && r.data.success && !!r.data.challenge
            && kv.has('att_ch:' + MID));
    }
    {
        const kv = new MemKV();
        const env = { ATTEST_EXTRA_TRUSTED_ROOTS: ROOT_FP };
        const { ch, reg } = await registerChain(kv, leaf, env, '10.1.0.2');
        check('首次登记：allowed/registered=first',
            ch.data.success && reg.status === 200 && reg.data.allowed === true
            && reg.data.registered === 'first');
        check('登记记录已写且 challenge 已删',
            kv.has('device_att:' + MID) && !kv.has('att_ch:' + MID));
    }
    {
        const kv = new MemKV();
        const env = { ATTEST_EXTRA_TRUSTED_ROOTS: ROOT_FP };
        const r1 = await registerChain(kv, null, env, '10.1.0.3');
        // 幂等语义：同窗口内重复投递同一 register body（重试安全）。
        // 重建与首次相同的 challenge 记录后，用完全相同的证书链重放。
        await kv.put('att_ch:' + MID, JSON.stringify({
            challenge: r1.ch.data.challenge,
            exp: Math.floor(Date.now() / 1000) + CHALLENGE_TTL_SEC
        }));
        const r = await callEndpoint(regMod, makeContext(kv, {
            action: 'register', mid: MID, certChain: r1.leaf.chainB64
        }, { env, ip: '10.1.0.3' }));
        check('同公钥重复注册：registered=idempotent',
            r.data.allowed === true && r.data.registered === 'idempotent');
    }
    {
        // 策略①：free 免费 → 放行轮换
        const kv = new MemKV();
        await putLicense(kv, { type: 'free' });
        const env = { ATTEST_EXTRA_TRUSTED_ROOTS: ROOT_FP };
        await registerChain(kv, leaf, env, '10.1.0.4');
        const r2 = await registerChain(kv, null, env, '10.1.0.4');
        const att = await kv.get('device_att:' + MID, 'json');
        check('免费设备密钥轮换：rotated/free/rotationCount=1',
            r2.reg.data.allowed === true
            && r2.reg.data.registered === 'rotated'
            && r2.reg.data.rotationReason === 'free'
            && r2.reg.data.rotationCount === 1
            && att.pub === r2.leaf.spkiB64);
    }
    {
        // 策略②-a：付费码无 resetAuth → 拒绝（HTTP200）
        const kv = new MemKV();
        await putLicense(kv, { type: 'pro', user: 'owner1' });
        const env = { ATTEST_EXTRA_TRUSTED_ROOTS: ROOT_FP };
        await registerChain(kv, leaf, env, '10.1.0.5');
        const leaf2 = await buildLeaf(root, inter, defaultOpts);
        const r2 = await registerChain(kv, leaf2, env, '10.1.0.5');
        check('付费无凭证：HTTP200 + allowed:false + RESET_AUTH_REQUIRED',
            r2.reg.status === 200 && r2.reg.data.allowed === false
            && r2.reg.data.code === 'RESET_AUTH_REQUIRED'
            && r2.reg.data.reason === 'device_reset_denied');
    }
    {
        // 策略②-b：付费码 + resetAuth 用户归属一致 → 放行
        const kv = new MemKV();
        await putLicense(kv, { type: 'pro', user: 'owner1' });
        const env = {
            ATTEST_EXTRA_TRUSTED_ROOTS: ROOT_FP,
            AUTH_SECRET: 'smoke-test-secret'
        };
        await registerChain(kv, leaf, env, '10.1.0.6');
        const token = await authMod.signToken(
            { username: 'owner1', role: 'doctor' },
            { KV: kv, AUTH_SECRET: 'smoke-test-secret' });
        const leaf2 = await fetchChallengeAndBuild(kv, env, '10.1.0.6');
        const r2 = await callEndpoint(regMod, makeContext(kv, {
            action: 'register', mid: MID, certChain: leaf2.chainB64,
            resetAuth: token
        }, { env, ip: '10.1.0.6' }));
        check('付费 + 账号归属一致：rotated/paid',
            r2.data.allowed === true && r2.data.registered === 'rotated'
            && r2.data.rotationReason === 'paid');
    }
    {
        // 策略②-c：resetAuth 用户名不符且无诊所归属 → 拒绝
        const kv = new MemKV();
        await putLicense(kv, { type: 'pro', user: 'owner1' });
        const env = {
            ATTEST_EXTRA_TRUSTED_ROOTS: ROOT_FP,
            AUTH_SECRET: 'smoke-test-secret'
        };
        await registerChain(kv, leaf, env, '10.1.0.7');
        const token = await authMod.signToken(
            { username: 'intruder', role: 'doctor' },
            { KV: kv, AUTH_SECRET: 'smoke-test-secret' });
        const leaf2 = await fetchChallengeAndBuild(kv, env, '10.1.0.7');
        const r2 = await callEndpoint(regMod, makeContext(kv, {
            action: 'register', mid: MID, certChain: leaf2.chainB64,
            resetAuth: token
        }, { env, ip: '10.1.0.7' }));
        check('付费 + resetAuth 归属不符：拒绝',
            r2.data.allowed === false
            && r2.data.code === 'RESET_AUTH_REQUIRED');
    }
    {
        // 策略②-d：用户名不符但诊所归属一致 → 放行
        const kv = new MemKV();
        await putLicense(kv, {
            type: 'pro', user: 'someoneelse', clinicName: '仁德堂'
        });
        await kv.put('system:clinics', JSON.stringify([
            { id: 'cid8', name: '仁德堂' }
        ]));
        const env = {
            ATTEST_EXTRA_TRUSTED_ROOTS: ROOT_FP,
            AUTH_SECRET: 'smoke-test-secret'
        };
        await registerChain(kv, leaf, env, '10.1.0.8');
        const token = await authMod.signToken(
            { username: 'doc2', role: 'doctor', clinicId: 'cid8' },
            { KV: kv, AUTH_SECRET: 'smoke-test-secret' });
        const leaf2 = await fetchChallengeAndBuild(kv, env, '10.1.0.8');
        const r2 = await callEndpoint(regMod, makeContext(kv, {
            action: 'register', mid: MID, certChain: leaf2.chainB64,
            resetAuth: token
        }, { env, ip: '10.1.0.8' }));
        check('付费 + 诊所归属一致：rotated/paid',
            r2.data.allowed === true && r2.data.rotationReason === 'paid');
    }
    {
        // 策略③-a：trial → RESET_AUTH_REQUIRED
        const kv = new MemKV();
        await putLicense(kv, { type: 'trial' });
        const env = { ATTEST_EXTRA_TRUSTED_ROOTS: ROOT_FP };
        await registerChain(kv, leaf, env, '10.1.0.9');
        const leaf2 = await buildLeaf(root, inter, defaultOpts);
        const r2 = await registerChain(kv, leaf2, env, '10.1.0.9');
        check('trial 密钥重置：RESET_AUTH_REQUIRED',
            r2.reg.data.allowed === false
            && r2.reg.data.code === 'RESET_AUTH_REQUIRED');
    }
    {
        // 策略③-b：无任何授权 → NO_ENTITLEMENT
        const kv = new MemKV();
        const env = { ATTEST_EXTRA_TRUSTED_ROOTS: ROOT_FP };
        await registerChain(kv, leaf, env, '10.1.0.10');
        const leaf2 = await buildLeaf(root, inter, defaultOpts);
        const r2 = await registerChain(kv, leaf2, env, '10.1.0.10');
        check('无授权密钥重置：NO_ENTITLEMENT',
            r2.reg.data.allowed === false
            && r2.reg.data.code === 'NO_ENTITLEMENT');
    }
    {
        // resetAuth 为垃圾串 → verifyToken null → 拒绝
        const kv = new MemKV();
        await putLicense(kv, { type: 'pro', user: 'owner1' });
        const env = {
            ATTEST_EXTRA_TRUSTED_ROOTS: ROOT_FP,
            AUTH_SECRET: 'smoke-test-secret'
        };
        await registerChain(kv, leaf, env, '10.1.0.11');
        const leaf2 = await fetchChallengeAndBuild(kv, env, '10.1.0.11');
        const r2 = await callEndpoint(regMod, makeContext(kv, {
            action: 'register', mid: MID, certChain: leaf2.chainB64,
            resetAuth: 'garbage.token.xxx'
        }, { env, ip: '10.1.0.11' }));
        check('伪造 resetAuth：拒绝', r2.data.allowed === false);
    }
    {
        // 无 challenge 直接注册
        const kv = new MemKV();
        const r = await callEndpoint(regMod, makeContext(kv, {
            action: 'register', mid: MID, certChain: leaf.chainB64
        }, {
            env: { ATTEST_EXTRA_TRUSTED_ROOTS: ROOT_FP },
            ip: '10.1.0.12'
        }));
        check('未先 challenge：challenge_expired',
            r.data.allowed === false && r.data.reason === 'challenge_expired');
    }
    {
        const kv = new MemKV();
        await callEndpoint(regMod, makeContext(kv,
            { action: 'challenge', mid: MID }, { ip: '10.1.0.13' }));
        const r = await callEndpoint(regMod, makeContext(kv, {
            action: 'register', mid: MID
        }, { ip: '10.1.0.13' }));
        check('缺 certChain：missing_cert_chain',
            r.data.allowed === false && r.data.reason === 'missing_cert_chain');
    }
    {
        const kv = new MemKV();
        const r = await callEndpoint(regMod, makeContext(kv,
            { action: 'challenge', mid: 'bad mid!!' }, { ip: '10.1.0.14' }));
        check('非法 mid → 400', r.status === 400);
    }
    {
        // 限流：同 IP 连续 21 次 challenge → 第 21 次 429
        const kv = new MemKV();
        let got429 = false;
        for (let i = 0; i < 21; i++) {
            const r = await callEndpoint(regMod, makeContext(kv,
                { action: 'challenge', mid: MID }, { ip: '10.2.0.1' }));
            if (r.status === 429) got429 = true;
        }
        check('每 IP 20/h：第 21 次 → 429', got429);
    }
    {
        // 紧急根开关：合法根 + 垃圾条目混合 → 合法根生效；纯垃圾 → 仍不信任
        const kv = new MemKV();
        const env = {
            ATTEST_EXTRA_TRUSTED_ROOTS: ROOT_FP + ',zzz, nothex123'
        };
        const r = await registerChain(kv, leaf, env, '10.1.0.15');
        check('追加根含非法条目：合法根仍生效（非法整条忽略）',
            r.reg.data.allowed === true && r.reg.data.registered === 'first');

        const kv2 = new MemKV();
        const r2 = await registerChain(kv2, leaf,
            { ATTEST_EXTRA_TRUSTED_ROOTS: 'zzz, qqq' }, '10.1.0.16');
        check('仅非法条目：内建锚不被替换 → untrusted_root',
            r2.reg.data.allowed === false
            && r2.reg.data.reason === 'untrusted_root');
    }
    {
        // 安全 H1 回归：链前插入证书（叶子当 CA / 非叶占据链首）→ 拒
        const r = await verifyCertChain(
            [toB64(inter.der), ...leaf.chainB64],
            { trustedRoots: [ROOT_FP] });
        check('链前插入证书（叶子当 CA 攻击）→ CA 身份约束拒绝',
            !r.ok && (r.reason === 'issuer_not_ca'
                || r.reason === 'leaf_is_ca'
                || r.reason === 'non_ca_certificate_in_chain'), r.reason);
    }
    {
        // 功能 H1 回归：free+paid 跨码残留，索引指向 free——
        // forceScan 后应见付费码，无 resetAuth 的重置 → RESET_AUTH_REQUIRED
        const kv = new MemKV();
        const FREE_C = 'BNZC-FREE-0000-0000-0001';
        const PAID_C = 'BNZC-PAID-0000-0000-0001';
        await putLicense(kv, { type: 'free', code: FREE_C });
        await putLicense(kv, { type: 'pro', code: PAID_C, user: 'ownerX' });
        await kv.put('mid_idx:' + MID, JSON.stringify(FREE_C));
        const env = { ATTEST_EXTRA_TRUSTED_ROOTS: ROOT_FP };
        await registerChain(kv, null, env, '10.1.0.21');
        const r2 = await registerChain(kv, null, env, '10.1.0.21');
        check('free+paid 残留：密钥重置必须归属核验（forceScan 穷尽）',
            r2.reg.data.allowed === false
            && r2.reg.data.code === 'RESET_AUTH_REQUIRED',
            r2.reg.data.code || r2.reg.data.reason);
    }
    {
        // 功能 M1 回归：active free + 已过期付费残留——
        // 过期付费码不参与阻断，重置按 free 放行
        const kv = new MemKV();
        const FREE_C = 'BNZC-FREE-0000-0000-0002';
        const PAID_C = 'BNZC-PAID-0000-0000-0002';
        await putLicense(kv, { type: 'free', code: FREE_C });
        await putLicense(kv, { type: 'pro', code: PAID_C, user: 'ownerY' });
        const prec = await kv.get('license:' + PAID_C, 'json');
        prec.expiresAt = new Date(NOW - DAY).toISOString();
        await kv.put('license:' + PAID_C, JSON.stringify(prec));
        const env = { ATTEST_EXTRA_TRUSTED_ROOTS: ROOT_FP };
        await registerChain(kv, null, env, '10.1.0.22');
        const r2 = await registerChain(kv, null, env, '10.1.0.22');
        check('过期付费码不阻断：按 free 放行轮换',
            r2.reg.data.allowed === true
            && r2.reg.data.registered === 'rotated'
            && r2.reg.data.rotationReason === 'free',
            r2.reg.data.code || r2.reg.data.reason);
    }

    // ------------------------------------------------------------------ F
    section('F. entitlement 证明门：observe/enforce 集成');

    /** 全新 enforce 环境：授权码 + 叶子登记。 */
    async function setupEnforce(ip) {
        const kv = new MemKV();
        await putLicense(kv, { type: 'pro' });
        await kv.put(CONFIG_KEY, JSON.stringify(
            { mode: 'enforce', bootSoftFail: false }));
        const env = {
            ATTEST_EXTRA_TRUSTED_ROOTS: ROOT_FP,
            AUTH_SECRET: 'smoke-test-secret'
        };
        const { leaf: l } = await registerChain(kv, null, env, ip);
        return { kv, env, l };
    }

    {
        // 非 Android：证明字段全空
        const kv = new MemKV();
        await putLicense(kv, { type: 'pro' });
        const r = await callEndpoint(entMod, makeContext(kv,
            { machineId: MID }, { ip: '10.3.0.1' }));
        check('非 Android：proofState/attMode 为 null',
            r.data.proofState === null && r.data.attMode === null
            && r.data.needProof === false);
    }
    {
        // Android observe 未登记 → needAttestation
        const kv = new MemKV();
        await putLicense(kv, { type: 'pro' });
        const r = await callEndpoint(entMod, makeContext(kv,
            { machineId: MID, platform: 'android' }, { ip: '10.3.0.2' }));
        check('observe 未登记：needAttestation + unregistered',
            r.data.needAttestation === true
            && r.data.proofState === 'unregistered'
            && r.data.attMode === 'observe');
    }
    {
        // Android observe 已登记无 proof → missing + nonce
        const kv = new MemKV();
        await putLicense(kv, { type: 'pro' });
        const env = { ATTEST_EXTRA_TRUSTED_ROOTS: ROOT_FP };
        await registerChain(kv, leaf, env, '10.3.0.3');
        const r = await callEndpoint(entMod, makeContext(kv,
            { machineId: MID, platform: 'android' }, { ip: '10.3.0.3' }));
        check('observe 已登记：needProof + missing + 一次性 nonce',
            r.data.needProof === true && r.data.proofState === 'missing'
            && !!(r.data.proofNonce && r.data.proofNonce.nonce));
    }
    {
        // enforce 未登记
        const kv = new MemKV();
        await putLicense(kv, { type: 'pro' });
        await kv.put(CONFIG_KEY, JSON.stringify({ mode: 'enforce' }));
        const r = await callEndpoint(entMod, makeContext(kv,
            { machineId: MID, platform: 'android' }, { ip: '10.3.0.4' }));
        check('enforce 未登记：needAttestation',
            r.data.needAttestation === true
            && r.data.proofState === 'unregistered');
    }
    {
        // enforce 完整两步：取 nonce → 签 proof → verified
        const { kv, env, l } = await setupEnforce('10.3.0.5');
        const r1 = await callEndpoint(entMod, makeContext(kv,
            { machineId: MID, platform: 'android' }, { env, ip: '10.3.0.5' }));
        check('enforce 已登记首次：missing 并下发 nonce',
            r1.data.proofState === 'missing' && r1.data.needProof === true);
        const { jti, nonce } = r1.data.proofNonce;
        const reg = await getDeviceRegistration(kv, MID);
        const sig = await signProofRaw(l.kp, MID, nonce);
        const r2 = await callEndpoint(entMod, makeContext(kv, {
            machineId: MID, platform: 'android',
            proof: { jti, kid: reg.kid, sig }
        }, { env, ip: '10.3.0.5' }));
        check('带合法 proof：verified',
            r2.data.proofState === 'verified'
            && r2.data.needProof === false);
    }
    {
        // enforce 伪造签名 → invalid + 重新下发新 nonce
        const { kv, env, l } = await setupEnforce('10.3.0.6');
        const r1 = await callEndpoint(entMod, makeContext(kv,
            { machineId: MID, platform: 'android' }, { env, ip: '10.3.0.6' }));
        const n1 = r1.data.proofNonce;
        const sigBuf = Uint8Array.from(
            Buffer.from(await signProofRaw(l.kp, MID, n1.nonce), 'base64'));
        sigBuf[20] ^= 0xff;
        const reg = await getDeviceRegistration(kv, MID);
        const r2 = await callEndpoint(entMod, makeContext(kv, {
            machineId: MID, platform: 'android',
            proof: { jti: n1.jti, kid: reg.kid, sig: toB64(sigBuf) }
        }, { env, ip: '10.3.0.6' }));
        check('伪造 proof：invalid 且重发新 nonce（旧 jti 不复用）',
            r2.data.proofState === 'invalid'
            && r2.data.needProof === true
            && r2.data.proofNonce.jti !== n1.jti);
    }
    {
        // 攻击：nonce 绑定的是别的 mid → 拒绝
        const { kv, env, l } = await setupEnforce('10.3.0.7');
        const otherMid = 'othermid000000000000000000000000aa';
        const n = await issueProofNonce(kv, otherMid);
        const sig = await signProofRaw(l.kp, MID, n.nonce);
        const reg = await getDeviceRegistration(kv, MID);
        const r = await callEndpoint(entMod, makeContext(kv, {
            machineId: MID, platform: 'android',
            proof: { jti: n.jti, kid: reg.kid, sig }
        }, { env, ip: '10.3.0.7' }));
        check('nonce mid 绑定不符：invalid', r.data.proofState === 'invalid');
    }
    {
        // 攻击：proof.kid 与登记公钥不符（他钥签的 proof）
        const { kv, env } = await setupEnforce('10.3.0.8');
        const r1 = await callEndpoint(entMod, makeContext(kv,
            { machineId: MID, platform: 'android' }, { env, ip: '10.3.0.8' }));
        const evilLeaf = await buildLeaf(root, inter, defaultOpts);
        const sig = await signProofRaw(evilLeaf.kp, MID,
            r1.data.proofNonce.nonce);
        const r = await callEndpoint(entMod, makeContext(kv, {
            machineId: MID, platform: 'android',
            proof: { jti: r1.data.proofNonce.jti, kid: evilLeaf.kid || 'x', sig }
        }, { env, ip: '10.3.0.8' }));
        check('proof kid 与登记不符：invalid',
            r.data.proofState === 'invalid');
    }
    {
        // 账号墓碑命中：证明门整体跳过
        const kv = new MemKV();
        await putLicense(kv, { type: 'pro' });
        await kv.put('account_tombstone:user1', JSON.stringify(
            { username: 'user1', deletedAt: new Date().toISOString() }));
        const r = await callEndpoint(entMod, makeContext(kv, {
            machineId: MID, platform: 'android', username: 'user1'
        }, { ip: '10.3.0.9' }));
        check('账号已删除：accountState 且证明门跳过',
            r.data.accountState === 'ACCOUNT_REVOKED'
            && r.data.proofState === null);
    }
    {
        // 无授权 + Android：证明门不启用
        const kv = new MemKV();
        const r = await callEndpoint(entMod, makeContext(kv, {
            machineId: MID, platform: 'android'
        }, { ip: '10.3.0.10' }));
        check('NO_LICENSE 时证明字段为空',
            r.data.state === 'NO_LICENSE' && r.data.proofState === null);
    }

    // ---------- 汇总 ----------
    console.log('\n============================================');
    console.log(`P3-B Attestation Smoke：${pass} PASS / ${failN} FAIL`);
    if (failN) {
        console.log('失败项：');
        for (const f of failures) console.log('  - ' + f);
        process.exit(1);
    }
}

main().catch(e => {
    console.error('FATAL:', e);
    process.exit(1);
});
