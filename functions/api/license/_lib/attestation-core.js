// ============================================================================
//  attestation-core.js — P3-B Android 设备证明核心库（云端 Pages Functions）
//
//  职责：
//    ① Google attestation 根指纹常量（信任锚：EC P-384 新根 + 3 个未过期 RSA 根）
//    ② 最小 X.509 DER 解析 + 逐证书 Web Crypto 验链到内置根
//    ③ KeyDescription attestation 扩展解析（头部/挑战/application/rootOfTrust）
//    ④ POP 验签（bnzc_poc_v1|mid|nonce，ECDSA P-256 raw R||S）
//    ⑤ 配置读取（KV config:attestation：observe/enforce、boot soft-fail）
//
//  ★ 实证（2026-09-27，字节级解析真机链 att_real.json）：
//    - getExtensionValue / extnValue 只包单层 OCTET STRING（载荷直接是 KeyDescription）；
//    - attestationSecurityLevel 是 ENUMERATED（0x0A）；
//    - 现代 AuthorizationList 的 KeyParameter = SEQUENCE{ tag INTEGER,
//      value [tag] IMPLICIT context tag }（purpose→a1 包 SET、algorithm→a2 包 INT、
//      rootOfTrust→[704] 包 RootOfTrust SEQ …），旧 schema 用通用 tag 直给——两者兼容；
//    - 华为软件链（非 Google 根）声称 attSec=TEE，但信任锚不符必须拒——根判定优先；
//    - 证书签名 ECDSA 是 DER，WebCrypto 只收 raw R||S，须摊平。
//
//  Cloudflare Workers Web Crypto 无 X.509 路径 API，故本模块自写最小 DER。
// ============================================================================

// ——— 协议常量（与 DeviceAttestationManager.java / offline.js 逐字符一致）———
export const ATTESTATION_OID = '1.3.6.1.4.1.11129.2.1.17';
export const POP_PREFIX = 'bnzc_poc_v1';
export const OFFICIAL_PACKAGE = 'com.benneng.pres.dingzhi';

/** 官方发布证书 SHA256（appSignatureDigests 白名单；keytool app-release.jks 实证）。 */
export const OFFICIAL_APP_SIGNATURE_DIGEST_HEX =
    'e5b2e4b3aac9de292b71e8d3c1643dfa68deb2c2a3ed385e27779a4601b7b54e';

// ——— 信任锚：Google attestation 根证书指纹（SHA-256(full cert DER) hex）———
// 字节级经两个独立仓库（quarkslab demo / LanternOps breeze）交叉印证，
// mailcow/php WebAuthn 根列表再次旁证。2016 根（2026-05 过期）不收录。
export const TRUSTED_GOOGLE_ROOT_FINGERPRINTS = Object.freeze([
    '6d9db4ce6c5c0b293166d08986e05774a8776ceb525d9e4329520de12ba4bcc0', // EC P-384 CA1（2026-02-01 起签）
    'cedb1cb6dc896ae5ec797348bce9286753c2b38ee71ce0fbe34a9a124880dfc', // RSA 2022→2042（当前根）
    'ab6641178a36e179aa0c1cdddf9a16eb45fa20943e2b8cd7c7c05c26cf8b487a', // RSA 2021→2036
    '1ef1a04b8ba58ab94589ac498c8982a783f24ea7307e0159a0c3a73b377d87cc'  // RSA 2019→2034
]);

// ——— 安全级枚举（KeyDescription 头）———
export const SEC_SOFTWARE = 0;
export const SEC_TEE = 1;
export const SEC_STRONGBOX = 2;

// ——— verifiedBootState 枚举（RootOfTrust）———
export const BOOT_VERIFIED = 0;
export const BOOT_SELF_SIGNED = 1;
export const BOOT_UNVERIFIED = 2;
export const BOOT_FAILED = 3;

// ——— AuthorizationList key tags（仅列使用到的）———
const TAG_PURPOSE = 1, TAG_ALGORITHM = 2, TAG_KEY_SIZE = 3, TAG_DIGEST = 5,
    TAG_EC_CURVE = 10, TAG_APPLICATION_ID = 600,
    TAG_CREATION_DATETIME = 701, TAG_ROOT_OF_TRUST = 704,
    TAG_OS_VERSION = 705, TAG_OS_PATCH = 706;

// ——— KV key / TTL ———
export const CONFIG_KEY = 'config:attestation';
export const attChallengeKey = mid => `att_ch:${mid}`;
export const deviceAttKey = mid => `device_att:${mid}`;
export const proofNonceKey = jti => `proof_nonce:${jti}`;
export const CHALLENGE_TTL_SEC = 600;      // 10 分钟
export const PROOF_NONCE_TTL_SEC = 600;     // 10 分钟

const CLOCK_SKEW_MS = 5 * 60 * 1000;

// ============================================================================
//  配置（零部署开关）
//  KV config:attestation = { mode:'observe'|'enforce', bootSoftFail:bool }
// ============================================================================
export const DEFAULT_ATTESTATION_CONFIG = Object.freeze({
    mode: 'observe',          // observe=只观测；enforce=必须 proof/登记
    bootSoftFail: false       // deviceLocked/bootState 不符是否软放行（默认硬拒）
});

export async function getAttestationConfig(kv) {
    const cfg = { ...DEFAULT_ATTESTATION_CONFIG };
    try {
        const raw = kv ? await kv.get(CONFIG_KEY, 'json').catch(() => null) : null;
        if (raw && typeof raw === 'object') {
            if (raw.mode === 'enforce' || raw.mode === 'observe') cfg.mode = raw.mode;
            if (raw.bootSoftFail === true) cfg.bootSoftFail = true;
        }
    } catch (e) {
        console.warn('[attestation-core] 配置读取失败，用默认 observe:', e && e.message);
    }
    return cfg;
}

// ============================================================================
//  通用工具
// ============================================================================
function b64ToBytes(b64) {
    const bin = atob(String(b64).replace(/\s+/g, ''));
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return arr;
}

function bytesToB64(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
}

function bytesToHex(bytes) {
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function sha256Bytes(bytes) {
    return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
}

export function randomChallengeB64() {
    return bytesToB64(crypto.getRandomValues(new Uint8Array(16)));
}

export function randomProofNonceB64() {
    return bytesToB64(crypto.getRandomValues(new Uint8Array(16)));
}

/** kid = SHA-256(SPKI) 前 16 hex（与 Java keyIdFromSpki 同口径）。 */
export async function kidFromSpkiB64(spkiB64) {
    const h = await sha256Bytes(b64ToBytes(spkiB64));
    return bytesToHex(h.slice(0, 8));
}

// ============================================================================
//  最小 DER 游标
// ============================================================================
class DerCursor {
    constructor(bytes, start = 0, end = bytes.length) {
        this.b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
        this.p = start;
        this.end = end;
    }
    atEnd() { return this.p >= this.end; }
    peekTagByte() { return this.b[this.p]; }

    /** 读一个 TLV：{tag, len, val(子视图bytes), headerStart, headerLen}。 */
    tlv() {
        const headerStart = this.p;
        const tag = this.b[this.p++];
        // 高号 tag（high-tag-number form）：首字节低 5 位全 1（0x1F），
        // 后续 base-128 字节（最高位=续读标记）必须在长度字节之前跳过。
        // context tag 600/704/705/706 等真实 Google 链必走此形式。
        if ((tag & 0x1f) === 0x1f) {
            while (this.b[this.p++] & 0x80) { /* 读到最高位 0 为止 */ }
        }
        let len = this.b[this.p++];
        if (len & 0x80) {
            const n = len & 0x7F;
            len = 0;
            for (let i = 0; i < n; i++) len = (len << 8) | this.b[this.p++];
        }
        const valStart = this.p;
        const val = this.b.subarray(valStart, valStart + len);
        this.p += len;
        return { tag, len, val, headerStart, valStart,
                 raw: this.b.subarray(headerStart, valStart + len) };
    }
}

function decodeOid(bytes) {
    if (!bytes.length) return '';
    const parts = [Math.floor(bytes[0] / 40), bytes[0] % 40];
    let v = 0;
    for (let i = 1; i < bytes.length; i++) {
        v = (v << 7) | (bytes[i] & 0x7F);
        if (!(bytes[i] & 0x80)) { parts.push(v); v = 0; }
    }
    return parts.join('.');
}

function parseAsn1Time(tag, bytes) {
    const s = String.fromCharCode(...bytes).replace(/[Zz]$/, '');
    let iso;
    if (tag === 0x17) { // UTCTime YYMMDDHHMMSS
        const y2 = parseInt(s.slice(0, 2), 10);
        const year = (y2 >= 50 ? 1900 : 2000) + y2;
        iso = `${year}-${s.slice(2, 4)}-${s.slice(4, 6)}T${s.slice(6, 8)}:${s.slice(8, 10)}:${s.slice(10, 12) || '00'}Z`;
    } else { // GeneralizedTime
        iso = `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(8, 10)}:${s.slice(10, 12) || '00'}:${s.slice(12, 14) || '00'}Z`;
    }
    return Date.parse(iso);
}

// ============================================================================
//  X.509 Certificate 解析
// ============================================================================
const OID_RSA_ENCRYPTION = '1.2.840.113549.1.1.1';
const OID_EC_PUBLIC_KEY = '1.2.840.10045.2.1';
const OID_P256 = '1.2.840.10045.3.1.7';
const OID_P384 = '1.3.132.0.34';
const OID_P521 = '1.3.132.0.35';

/**
 * 解析一个 DER Certificate：
 * @returns {{tbsRaw, sigAlgOid, sigValue, spkiRaw, keyClass, curveOid,
 *            notBefore, notAfter, extensions:Map, der}}
 */
function parseCertificate(derBytes) {
    const root = new DerCursor(derBytes);
    const cert = root.tlv();
    if (cert.tag !== 0x30) throw new Error('cert: outer not SEQUENCE');
    const c = new DerCursor(cert.val);

    const tbs = c.tlv();
    if (tbs.tag !== 0x30) throw new Error('cert: tbs not SEQUENCE');
    const tbsRaw = tbs.raw;

    const outerSigAlg = c.tlv();      // signatureAlgorithm
    const outerSigVal = c.tlv();      // signatureValue BIT STRING
    const sigOidNode = new DerCursor(outerSigAlg.val).tlv();
    const sigAlgOid = decodeOid(sigOidNode.val);
    if (outerSigVal.tag !== 0x03 || outerSigVal.len < 1) {
        throw new Error('cert: signatureValue not BIT STRING');
    }

    // —— 解析 tbs ——
    const t = new DerCursor(tbs.val);
    let node = t.tlv();
    if (node.tag === 0xA0) node = t.tlv();     // version [0] → node=serial（仅此一读）
    node = t.tlv(); // inner sigAlg
    node = t.tlv(); // issuer
    const validity = t.tlv();
    const vc = new DerCursor(validity.val);
    const nf = vc.tlv(), na = vc.tlv();
    const notBefore = parseAsn1Time(nf.tag, nf.val);
    const notAfter = parseAsn1Time(na.tag, na.val);
    node = t.tlv(); // subject
    const spki = t.tlv();
    const spkiRaw = spki.raw;

    // SPKI algorithm
    const sp = new DerCursor(spki.val);
    const spAlg = sp.tlv();
    const spAlgC = new DerCursor(spAlg.val);
    const spkiAlgOidNode = spAlgC.tlv();
    const keyAlgOid = decodeOid(spkiAlgOidNode.val);
    let keyClass = null, curveOid = null;
    if (keyAlgOid === OID_RSA_ENCRYPTION) {
        keyClass = 'RSA';
    } else if (keyAlgOid === OID_EC_PUBLIC_KEY) {
        keyClass = 'EC';
        const param = spAlgC.tlv();
        curveOid = decodeOid(param.val);
    }

    // 可选 unique ids + extensions [3]
    let extensions = null;
    while (!t.atEnd()) {
        const x = t.tlv();
        if (x.tag === 0xA3) {
            const xc = new DerCursor(x.val);
            const seq = xc.tlv(); // SEQUENCE OF Extension
            extensions = new Map();
            const ec = new DerCursor(seq.val);
            while (!ec.atEnd()) {
                const ex = ec.tlv(); // Extension SEQUENCE
                const er = new DerCursor(ex.val);
                const oidN = er.tlv();
                const oid = decodeOid(oidN.val);
                let critical = false;
                if (er.peekTagByte() === 0x01) { critical = true; er.tlv(); }
                const extVal = er.tlv(); // OCTET STRING（载荷内容）
                extensions.set(oid, { critical, value: extVal.val });
            }
        }
    }

    // basicConstraints（X.509 OID 2.5.29.19）：
    //   SEQ { cA BOOLEAN DEFAULT FALSE, pathLenConstraint INTEGER OPTIONAL }
    // 无扩展或 SEQ 为空 → cA=false。
    let isCA = false, pathLen = null;
    const bcExt = extensions && extensions.get('2.5.29.19');
    if (bcExt) {
        const bcSeq = new DerCursor(bcExt.value).tlv();
        const bcc = new DerCursor(bcSeq.val);
        if (bcc.peekTagByte() === 0x01) {
            const caN = bcc.tlv();
            isCA = caN.val.length > 0 && caN.val[0] === 0xff;
        }
        if (!bcc.atEnd() && bcc.peekTagByte() === 0x02) {
            const plN = bcc.tlv();
            let v = 0;
            for (const b of plN.val) v = v * 256 + b;
            pathLen = v;
        }
    }

    return {
        tbsRaw, sigAlgOid,
        sigValue: outerSigVal.val.subarray(1),  // 去掉 BIT STRING unused-bits 字节
        spkiRaw, keyClass, curveOid,
        notBefore, notAfter, extensions,
        isCA, pathLen
    };
}

// 签名算法 OID → {keyClass, hash}
const SIG_ALG_MAP = {
    // SHA-1 已移除（2026-09 P3-B 安全收口）：Google attestation 链早已使用
    // SHA-256+，接受 SHA-1 只增加降级伪造面。
    '1.2.840.113549.1.1.11': { keyClass: 'RSA', hash: 'SHA-256' },
    '1.2.840.113549.1.1.12': { keyClass: 'RSA', hash: 'SHA-384' },
    '1.2.840.113549.1.1.13': { keyClass: 'RSA', hash: 'SHA-512' },
    '1.2.840.10045.4.3.2': { keyClass: 'EC', hash: 'SHA-256' },
    '1.2.840.10045.4.3.3': { keyClass: 'EC', hash: 'SHA-384' },
    '1.2.840.10045.4.3.4': { keyClass: 'EC', hash: 'SHA-512' }
};

const CURVE_COMPONENT_LEN = {
    [OID_P256]: 32, [OID_P384]: 48, [OID_P521]: 66
};

/** 用 parent 证书公钥验 child 证书签名（Web Crypto）。 */
async function verifyOneCert(child, parent) {
    const info = SIG_ALG_MAP[child.sigAlgOid];
    if (!info) throw new Error('unsupported sig alg: ' + child.sigAlgOid);
    if (info.keyClass !== parent.keyClass) {
        throw new Error('sig alg / parent key class mismatch');
    }

    if (parent.keyClass === 'RSA') {
        const key = await crypto.subtle.importKey(
            'spki', parent.spkiRaw,
            { name: 'RSASSA-PKCS1-v1_5' }, false, ['verify']);
        return crypto.subtle.verify(
            { name: 'RSASSA-PKCS1-v1_5' }, key, child.sigValue, child.tbsRaw);
    }
    // EC：DER 签名摊平为 raw R||S
    const compLen = CURVE_COMPONENT_LEN[parent.curveOid];
    if (!compLen) throw new Error('unsupported EC curve: ' + parent.curveOid);
    const rawSig = derEcdsaToRaw(child.sigValue, compLen);
    if (!rawSig) throw new Error('ecdsa signature unwrap failed');
    const key = await crypto.subtle.importKey(
        'spki', parent.spkiRaw,
        { name: 'ECDSA', namedCurve: parent.curveOid === OID_P256 ? 'P-256'
            : parent.curveOid === OID_P384 ? 'P-384' : 'P-521' },
        false, ['verify']);
    return crypto.subtle.verify(
        { name: 'ECDSA', hash: info.hash }, key, rawSig, child.tbsRaw);
}

/** DER ECDSA 签名（SEQUENCE{r INT, s INT}）→ raw R||S（每节 compLen）。 */
export function derEcdsaToRaw(derBytes, compLen) {
    try {
        const c = new DerCursor(derBytes);
        const seq = c.tlv();
        if (seq.tag !== 0x30) return null;
        const rc = new DerCursor(seq.val);
        const rN = rc.tlv(), sN = rc.tlv();
        if (rN.tag !== 0x02 || sN.tag !== 0x02) return null;
        const norm = n => {
            let b = n.val;
            let off = 0;
            while (off < b.length - 1 && b[off] === 0) off++;
            b = b.subarray(off);
            if (b.length > compLen) return null;
            const out = new Uint8Array(compLen);
            out.set(b, compLen - b.length);
            return out;
        };
        const r = norm(rN), s = norm(sN);
        if (!r || !s) return null;
        const out = new Uint8Array(compLen * 2);
        out.set(r, 0);
        out.set(s, compLen);
        return out;
    } catch (e) {
        return null;
    }
}

// ============================================================================
//  证书链验证
// ============================================================================
/**
 * @param {string[]} certChainB64 叶子在前
 * @param {object}   opts { trustedRoots?:string[], nowMs?:number, checkValidity?:bool }
 * @returns {Promise<{ok:boolean, reason?:string, parsed?:object[], rootFp?:string}>}
 */
export async function verifyCertChain(certChainB64, opts = {}) {
    const trusted = new Set(opts.trustedRoots || TRUSTED_GOOGLE_ROOT_FINGERPRINTS);
    const nowMs = opts.nowMs || Date.now();
    try {
        if (!Array.isArray(certChainB64) || certChainB64.length < 1) {
            return { ok: false, reason: 'empty_chain' };
        }
        const parsed = certChainB64.map(b64 => parseCertificate(b64ToBytes(b64)));

        // 有效期检查（含小时钟宽限）
        if (opts.checkValidity !== false) {
            for (const p of parsed) {
                if (nowMs < p.notBefore - CLOCK_SKEW_MS) {
                    return { ok: false, reason: 'cert_not_yet_valid' };
                }
                if (nowMs > p.notAfter + CLOCK_SKEW_MS) {
                    return { ok: false, reason: 'cert_expired' };
                }
            }
        }

        // 根判定①：末节指纹必须在信任锚集合（优先于一切结构约束）
        const root = parsed[parsed.length - 1];
        const rootFp = bytesToHex(await sha256Bytes(certChainB64[certChainB64.length - 1]
            ? b64ToBytes(certChainB64[certChainB64.length - 1]) : new Uint8Array()));
        if (!trusted.has(rootFp)) {
            return { ok: false, reason: 'untrusted_root', rootFp };
        }

        // 根判定②：根必须是 cA=TRUE
        if (!root.isCA) {
            return { ok: false, reason: 'root_not_ca', rootFp };
        }

        // CA 身份约束（防「叶子当 CA / 链中插入证书」伪造）：
        //   · 每个非根证书的签发者必须 cA=TRUE；
        //   · 链首证书必须是终端实体（cA≠TRUE），其余非根证书必须是 CA。
        for (let i = 0; i < parsed.length - 1; i++) {
            const child = parsed[i], issuer = parsed[i + 1];
            if (!issuer.isCA) {
                return { ok: false, reason: 'issuer_not_ca', rootFp };
            }
            if (i === 0) {
                if (child.isCA) {
                    return { ok: false, reason: 'leaf_is_ca', rootFp };
                }
            } else if (!child.isCA) {
                return { ok: false, reason: 'non_ca_certificate_in_chain', rootFp };
            }
        }

        // 逐节验签（叶→根）
        for (let i = 0; i < parsed.length - 1; i++) {
            let passed = false;
            try {
                passed = await verifyOneCert(parsed[i], parsed[i + 1]);
            } catch (e) {
                return { ok: false, reason: 'sig_verify_error:' + e.message, rootFp };
            }
            if (!passed) return { ok: false, reason: 'bad_signature', rootFp };
        }

        // 根判定③：自签
        try {
            if (!(await verifyOneCert(root, root))) {
                return { ok: false, reason: 'root_not_self_signed', rootFp };
            }
        } catch (e) {
            return { ok: false, reason: 'root_selfsig_error:' + e.message, rootFp };
        }
        return { ok: true, parsed, rootFp };
    } catch (e) {
        return { ok: false, reason: 'parse_error:' + (e && e.message) };
    }
}

// ============================================================================
//  KeyDescription / AuthorizationList 解析
// ============================================================================
/**
 * 解析叶子证书的 attestation 扩展：
 * @returns {Promise<{version, attSecLevel, kmVersion, kmSecLevel, challenge,
 *            softwareEnforced, teeEnforced}>}
 */
export function parseAttestationExtension(parsedLeaf) {
    const ext = parsedLeaf.extensions && parsedLeaf.extensions.get(ATTESTATION_OID);
    if (!ext) throw new Error('attestation extension missing');
    const kc = new DerCursor(ext.value);
    const seq = kc.tlv();
    if (seq.tag !== 0x30) throw new Error('KeyDescription not SEQUENCE');
    const s = new DerCursor(seq.val);

    const version = readUniversalInt(s, 0x02);
    const attSecLevel = readUniversalInt(s, 0x0A);
    const kmVersion = readUniversalInt(s, 0x02);
    const kmSecLevel = readUniversalInt(s, 0x0A);
    const challenge = s.tlv();
    if (challenge.tag !== 0x04) throw new Error('challenge not OCTET STRING');
    const uniqueId = s.tlv();
    if (uniqueId.tag !== 0x04) throw new Error('uniqueId not OCTET STRING');

    // 后续字段位置随 schema 变化（Keymaster: certList/issuerList 两 SEQ；
    // KeyMint: certs/issuer 两 OCTET；厂商变体可能只有一个 SEQ）——按内容
    // 特征识别两个 AuthorizationList，其余一律跳过。
    const authLists = [];
    while (!s.atEnd() && authLists.length < 2) {
        const tlv = s.tlv();
        if (tlv.tag === 0x30 && looksLikeAuthorizationList(tlv.val)) {
            authLists.push(parseAuthorizationList(tlv.val));
        }
        // 0x04（KeyMint certs/issuer）、SEQ(cert list/issuer list/厂商结构) 均跳过
    }

    return {
        version, attSecLevel, kmVersion, kmSecLevel,
        challenge: challenge.val,
        softwareEnforced: authLists[0] || emptyAuth(),
        teeEnforced: authLists[1] || authLists[0] || emptyAuth()
    };
}

function readUniversalInt(cursor, wantTag) {
    const n = cursor.tlv();
    if (n.tag !== wantTag) {
        throw new Error(`expected tag 0x${wantTag.toString(16)} got 0x${n.tag.toString(16)}`);
    }
    let v = 0;
    for (const b of n.val) v = v * 256 + b;
    return v;
}

/**
 * 判定 SEQ 内容是否 AuthorizationList：每个 KeyParameter 是 SEQ，
 * 其首元素为 INTEGER（key tag）。证书列表的子 SEQ（Certificate）首元素是 SEQ。
 */
function looksLikeAuthorizationList(bytes) {
    if (!bytes.length) return false;
    try {
        const c = new DerCursor(bytes);
        const first = c.tlv();
        if (first.tag !== 0x30) return false;
        const inner = new DerCursor(first.val);
        return inner.peekTagByte() === 0x02;
    } catch (e) {
        return false;
    }
}

function emptyAuth() {
    return { packageName: null, signatureDigests: [], rootOfTrust: null,
             osVersion: null, osPatch: null };
}

/**
 * 解析 AuthorizationList：
 * KeyParameter = SEQUENCE { tag INTEGER, value }；
 * value 现代编码为 [tag] IMPLICIT context 包裹（构造型），旧编码为通用直给。
 */
function parseAuthorizationList(bytes) {
    const out = emptyAuth();
    const c = new DerCursor(bytes);
    while (!c.atEnd()) {
        const kp = c.tlv();
        if (kp.tag !== 0x30) continue;
        const pr = new DerCursor(kp.val);
        const tagN = pr.tlv();
        if (tagN.tag !== 0x02) continue;
        let keyTag = 0;
        for (const b of tagN.val) keyTag = keyTag * 256 + b;

        let value = pr.tlv();
        // 现代 context tag：剥掉 [tag] 外壳，内容即真实结构 TLV 字节（30…）；
        // 旧 schema：value 本身就是通用 TLV（用 raw 含头部）。
        const structBytes = (value.tag & 0xC0) === 0x80 ? value.val : value.raw;

        if (keyTag === TAG_APPLICATION_ID) {
            const app = parseKeyMasterApplication(structBytes);
            out.packageName = app.packageName;
            out.signatureDigests = app.signatureDigests;
        } else if (keyTag === TAG_ROOT_OF_TRUST) {
            out.rootOfTrust = parseRootOfTrust(structBytes);
        } else if (keyTag === TAG_OS_VERSION) {
            out.osVersion = readValueInt(structBytes);
        } else if (keyTag === TAG_OS_PATCH) {
            out.osPatch = readValueInt(structBytes);
        }
    }
    return out;
}

/**
 * 从（可能 context 剥壳后的）内容里读一个 INTEGER 值。
 * 兼容两种形态：
 *   · 旧 schema/显式 TLV：02 len bytes
 *   · KeyMaster IMPLICIT context 原语（[705]/[706] INTEGER）：内容直接是整数字节，
 *     无 02 头部——直接按整数内容解释。
 */
function readValueInt(bytes) {
    try {
        const c = new DerCursor(bytes);
        const n = c.tlv();
        if (n.tag === 0x02 && c.atEnd()) {
            let v = 0;
            for (const b of n.val) v = v * 256 + b;
            return v;
        }
    } catch (e) { /* 落到无头部解释 */ }
    // 无头部：全部字节即整数内容（非空才算）
    if (!bytes || !bytes.length) return null;
    let v = 0;
    for (const b of bytes) v = v * 256 + b;
    return v;
}

/**
 * KeyMasterApplication：
 * SEQUENCE { packageName OCTET_STRING, signatures SEQUENCE OF OCTET_STRING }
 */
function parseKeyMasterApplication(bytes) {
    const c = new DerCursor(bytes);
    const seq = c.tlv();
    if (seq.tag !== 0x30) throw new Error('application not SEQUENCE');
    const a = new DerCursor(seq.val);
    const pkg = a.tlv();
    if (pkg.tag !== 0x04) throw new Error('packageName not OCTET STRING');
    const packageName = String.fromCharCode(...pkg.val);
    const sigs = a.tlv();
    if (sigs.tag !== 0x30) throw new Error('signatures not SEQUENCE');
    const signatureDigests = [];
    const sc = new DerCursor(sigs.val);
    while (!sc.atEnd()) {
        const s = sc.tlv();
        if (s.tag !== 0x04) continue;
        // 32 字节 = 已是证书 SHA256 摘要；否则当作 DER 证书算摘要（兼容 API24-30）
        if (s.val.length === 32) {
            signatureDigests.push(bytesToHex(s.val));
        } else {
            // 异步摘要无法在此同步返回——记录原始标记，由上层异步归一
            signatureDigests.push('raw:' + bytesToB64(s.val));
        }
    }
    return { packageName, signatureDigests };
}

/** RootOfTrust：{ bootKey, deviceLocked, verifiedBootState, bootHash? }。 */
function parseRootOfTrust(bytes) {
    const c = new DerCursor(bytes);
    const seq = c.tlv();
    if (seq.tag !== 0x30) return null;
    const r = new DerCursor(seq.val);
    const bk = r.tlv();
    if (bk.tag !== 0x04) return null;
    const locked = r.tlv();
    if (locked.tag !== 0x01) return null;
    const state = r.tlv();
    if (state.tag !== 0x0A) return null;
    let bootHash = null;
    if (!r.atEnd()) {
        const bh = r.tlv();
        if (bh.tag === 0x04) bootHash = bh.val;
    }
    return {
        verifiedBootKey: bk.val,
        deviceLocked: locked.val.length > 0 && locked.val[0] !== 0,
        verifiedBootState: state.val[0],
        verifiedBootHash: bootHash
    };
}

/**
 * 异步归一 application 签名：把旧 schema 的 raw DER 证书转成 SHA256 hex。
 * 在 verifyAndParseRegistration 中调用（那里可 await）。
 */
async function normalizeSignatureDigests(list) {
    const out = [];
    for (const item of list) {
        if (item.startsWith('raw:')) {
            const h = await sha256Bytes(b64ToBytes(item.slice(4)));
            out.push(bytesToHex(h));
        } else out.push(item);
    }
    return out;
}

// ============================================================================
//  注册一站式验证（register.js 调用）
// ============================================================================
/**
 * @param {object} args
 *   kv, mid, certChainB64, expectedChallengeB64, config?, nowMs?
 * @returns {Promise<{ok, reason?, info?}>}
 * info: { spkiB64, kid, secLevel, boot:{locked,state}, osVersion, osPatch,
 *         packageName }
 */
export async function verifyAndParseRegistration(args = {}) {
    const {
        kv, mid, certChainB64, expectedChallengeB64,
        config = DEFAULT_ATTESTATION_CONFIG, nowMs, chainOpts = null
    } = args;
    void kv;
    try {
        if (!mid) return { ok: false, reason: 'missing_mid' };

        // ① 验链到 Google 根（含有效期）。chainOpts 仅由 register.js 的
        //    ATTEST_EXTRA_TRUSTED_ROOTS 紧急根迁移开关传入（默认 null=内建锚）。
        const chain = await verifyCertChain(
            certChainB64, Object.assign({ nowMs }, chainOpts || {}));
        if (!chain.ok) return { ok: false, reason: chain.reason };

        // ② 解析 attestation 扩展
        let kd;
        try {
            kd = parseAttestationExtension(chain.parsed[0]);
        } catch (e) {
            return { ok: false, reason: 'attestation_parse_failed:' + e.message };
        }

        // ③ 安全级必须 TEE/StrongBox
        if (kd.attSecLevel !== SEC_TEE && kd.attSecLevel !== SEC_STRONGBOX) {
            return { ok: false, reason: 'security_level_not_hardware' };
        }

        // ④ challenge 匹配
        const expected = b64ToBytes(expectedChallengeB64);
        if (kd.challenge.length !== expected.length
            || !constantTimeEqual(kd.challenge, expected)) {
            return { ok: false, reason: 'challenge_mismatch' };
        }

        // ⑤ 取 app/boot 信息（teeEnforced 优先，回退 softwareEnforced）
        const tee = kd.teeEnforced || emptyAuth();
        const sw = kd.softwareEnforced || emptyAuth();
        let packageName = tee.packageName || sw.packageName;
        let sigDigests = tee.signatureDigests.length
            ? tee.signatureDigests : sw.signatureDigests;
        sigDigests = await normalizeSignatureDigests(sigDigests);
        const rootOfTrust = tee.rootOfTrust || sw.rootOfTrust;

        // ⑥ app 身份硬校验（包名 + 发布指纹）——不可 soft-fail
        if (!packageName || packageName !== OFFICIAL_PACKAGE) {
            return { ok: false, reason: 'package_name_mismatch' };
        }
        if (!sigDigests.includes(OFFICIAL_APP_SIGNATURE_DIGEST_HEX)) {
            return { ok: false, reason: 'app_signature_mismatch' };
        }

        // ⑦ boot 校验（deviceLocked + Verified）——soft-fail 可配
        let bootWarn = null;
        if (!rootOfTrust) {
            bootWarn = 'root_of_trust_missing';
        } else if (!rootOfTrust.deviceLocked
            || rootOfTrust.verifiedBootState !== BOOT_VERIFIED) {
            bootWarn = rootOfTrust.deviceLocked
                ? 'boot_state_not_verified' : 'device_not_locked';
        }
        if (bootWarn && !config.bootSoftFail) {
            return { ok: false, reason: bootWarn };
        }

        // ⑧ 叶子公钥 SPKI + kid
        const spkiB64 = bytesToB64(chain.parsed[0].spkiRaw);
        const kid = await kidFromSpkiB64(spkiB64);

        return {
            ok: true,
            bootWarn,
            info: {
                spkiB64,
                kid,
                secLevel: kd.attSecLevel,
                boot: rootOfTrust ? {
                    locked: rootOfTrust.deviceLocked,
                    state: rootOfTrust.verifiedBootState
                } : null,
                osVersion: tee.osVersion || sw.osVersion || null,
                osPatch: tee.osPatch || sw.osPatch || null,
                packageName
            }
        };
    } catch (e) {
        return { ok: false, reason: 'verify_exception:' + (e && e.message) };
    }
}

// ============================================================================
//  POP 验签
// ============================================================================
/**
 * @param {object} a { spkiB64, mid, nonce, sigB64 }
 * @returns {Promise<boolean>}
 */
export async function verifyProof(a = {}) {
    try {
        const { spkiB64, mid, nonce, sigB64 } = a;
        if (!spkiB64 || !mid || !nonce || !sigB64) return false;
        const spki = b64ToBytes(spkiB64);
        // 只接受 EC 公钥（parseCertificate 校验）
        const parsed = parseCertificateLeafSpki(spki);
        if (parsed.keyClass !== 'EC') return false;
        const key = await crypto.subtle.importKey(
            'spki', spki,
            { name: 'ECDSA', namedCurve: parsed.curveOid === OID_P256 ? 'P-256'
                : parsed.curveOid === OID_P384 ? 'P-384' : 'P-521' },
            false, ['verify']);
        const message = `${POP_PREFIX}|${mid}|${nonce}`;
        return crypto.subtle.verify(
            { name: 'ECDSA', hash: 'SHA-256' },
            key, b64ToBytes(sigB64),
            new TextEncoder().encode(message));
    } catch (e) {
        console.warn('[attestation-core] verifyProof 异常（按失败处理）:', e && e.message);
        return false;
    }
}

/** 仅解析 SPKI（POP 用，输入是公钥不是证书）。 */
function parseCertificateLeafSpki(spkiBytes) {
    const c = new DerCursor(spkiBytes);
    const spki = c.tlv();
    if (spki.tag !== 0x30) throw new Error('spki not SEQUENCE');
    const s = new DerCursor(spki.val);
    const alg = s.tlv();
    const ac = new DerCursor(alg.val);
    const algOid = decodeOid(ac.tlv().val);
    let keyClass = null, curveOid = null;
    if (algOid === OID_RSA_ENCRYPTION) keyClass = 'RSA';
    else if (algOid === OID_EC_PUBLIC_KEY) {
        keyClass = 'EC';
        curveOid = decodeOid(ac.tlv().val);
    }
    return { keyClass, curveOid };
}

// ============================================================================
//  proof nonce 签发/消费（entitlement.js）
// ============================================================================
/** 签发一次性 proof nonce（KV proof_nonce:{jti}，10 分钟）。返回 {jti, nonce}。 */
export async function issueProofNonce(kv, mid) {
    const jti = crypto.randomUUID();
    const nonce = randomProofNonceB64();
    try {
        await kv.put(proofNonceKey(jti), JSON.stringify({ nonce, mid: mid || '' }),
            { expirationTtl: PROOF_NONCE_TTL_SEC });
    } catch (e) {
        console.warn('[attestation-core] proof nonce 落 KV 失败:', e && e.message);
        return { jti: null, nonce: null };
    }
    return { jti, nonce };
}

/**
 * 消费 nonce（读后即删，防重放）；失败/不存在返回 null。
 * 返回 {nonce, mid}。
 */
export async function consumeProofNonce(kv, jti) {
    if (!kv || !jti) return null;
    const key = proofNonceKey(jti);
    try {
        const rec = await kv.get(key, 'json').catch(() => null);
        if (!rec || !rec.nonce) return null;
        await kv.delete(key).catch(() => {});
        return { nonce: rec.nonce, mid: rec.mid || '' };
    } catch (e) {
        console.warn('[attestation-core] consumeProofNonce 失败:', e && e.message);
        return null;
    }
}

/** 读取设备登记记录（device_att:{mid}）。 */
export async function getDeviceRegistration(kv, mid) {
    if (!kv || !mid) return null;
    try {
        return await kv.get(deviceAttKey(mid), 'json').catch(() => null);
    } catch (e) {
        return null;
    }
}

// ============================================================================
//  常量时间比较
// ============================================================================
function constantTimeEqual(a, b) {
    if (!a || !b || a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
    return diff === 0;
}

// 内部解析器导出（smoke 白盒测试用）
export { parseCertificate };
