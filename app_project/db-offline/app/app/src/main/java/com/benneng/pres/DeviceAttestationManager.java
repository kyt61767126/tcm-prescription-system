package com.benneng.pres;

import android.content.Context;
import android.os.Build;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.security.KeyFactory;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.security.PrivateKey;
import java.security.SecureRandom;
import java.security.Signature;
import java.security.cert.Certificate;
import java.security.cert.X509Certificate;
import java.security.spec.ECGenParameterSpec;

/**
 * DeviceAttestationManager —— P3-B 设备证明（Android Key Attestation + POP）
 *
 * 职责：在 Android Keystore 中持有一把非导出 EC P-256 证明密钥（别名
 * {@link #KEY_ALIAS}），keygen 时携带服务端 challenge，由硬件（TEE/StrongBox）
 * 签发一条到 Google 认证根的 X.509 证书链；服务端据此做设备身份登记与 POP 验签。
 *
 * 铁律：所有对外方法均异常自捕获、返回结构化结果（ok/unsupported），
 * 绝不向调用方抛出——不支持设备走 Tier B（回退 P3-A）。
 *
 * ★ DER 实证（2026-09-27 华为真机 + 解析脚本）：
 *   ① X509Certificate.getExtensionValue(OID) 只包「单层」OCTET STRING：
 *      {@code 04 LL 30 ...}（载荷直接是 KeyDescription SEQUENCE，非双层）；
 *   ② attestationSecurityLevel / keymasterSecurityLevel 是 ENUMERATED
 *      （tag 0x0A），不是 INTEGER；
 *   ③ WebCrypto ECDSA.verify 只收 raw R||S（IEEE P1363），不收 DER，
 *      故 signProof 输出把 DER 签名摊平为 64 字节原始签名。
 */
public class DeviceAttestationManager {

    private static final String TAG = "DeviceAttestation";

    static final String KEYSTORE_PROVIDER = "AndroidKeyStore";
    static final String KEY_ALIAS = "bnzc_dev_v1";
    /** Key attestation 扩展 OID（X.509 v3 extension）。 */
    static final String ATTESTATION_OID = "1.3.6.1.4.1.11129.2.1.17";

    /** POP 签名串前缀（与服务端 attestation-core 约定逐字符一致）。 */
    static final String POP_PREFIX = "bnzc_poc_v1";

    // DER tag 常量
    private static final int TAG_INTEGER = 0x02;
    private static final int TAG_BIT_STRING = 0x03;
    private static final int TAG_OCTET_STRING = 0x04;
    private static final int TAG_NULL = 0x05;
    private static final int TAG_OID = 0x06;
    private static final int TAG_ENUMERATED = 0x0A;
    private static final int TAG_SEQUENCE = 0x30;

    // attestationSecurityLevel 枚举（KeyDescription 头部）
    public static final int SEC_LEVEL_SOFTWARE = 0;
    public static final int SEC_LEVEL_TEE = 1;
    public static final int SEC_LEVEL_STRONGBOX = 2;

    private final Context appContext;

    public DeviceAttestationManager(Context context) {
        this.appContext = context != null ? context.getApplicationContext() : null;
    }

    // ======================================================================
    //  可行性探针
    // ======================================================================

    /**
     * 探针：随机 challenge → 删除旧别名 → keygen（API31+ 先带设备属性，失败降级
     * 不带）→ 取证书链 → 解析 attestation 头（版本/安全级/challenge）→
     * 判定是否 Google 链。
     *
     * @return 结构化结果；成功含完整证书链（b64），可直接存档为 smoke 夹具。
     */
    public JSONObject probe() {
        JSONObject out = new JSONObject();
        try {
            out.put("sdkInt", Build.VERSION.SDK_INT);
            out.put("alias", KEY_ALIAS);

            byte[] challenge = new byte[16];
            new SecureRandom().nextBytes(challenge);

            // ① 先尝试带设备属性（API31+）；失败（ProviderException 等）降级为纯 challenge
            JSONObject gen = ensureDeviceKey(challenge, true, true);
            boolean deviceProps = gen.optBoolean("deviceProperties", false);
            if (!gen.optBoolean("ok", false)) {
                Log.w(TAG, "probe: 带设备属性 keygen 失败，降级不带设备属性重试: "
                        + gen.optString("error", ""));
                gen = ensureDeviceKey(challenge, false, true);
                deviceProps = false;
            }
            if (!gen.optBoolean("ok", false)) {
                out.put("ok", false);
                out.put("tier", "B");
                out.put("unsupported", gen.optString("unsupported", "keygen_failed"));
                out.put("error", gen.optString("error", ""));
                return out;
            }
            out.put("deviceProperties", deviceProps);

            // ② 取证书链
            X509Certificate[] chain = getCertificateChain();
            if (chain == null || chain.length == 0) {
                out.put("ok", false);
                out.put("tier", "B");
                out.put("unsupported", "no_cert_chain");
                return out;
            }

            // ③ 解析 attestation 头（版本/安全级/挑战/challenge）
            AttHead head = null;
            try {
                head = parseAttestationHead(chain[0]);
            } catch (Exception e) {
                Log.w(TAG, "probe: attestation 头解析失败（仍按链根判定）", e);
            }
            if (head != null) {
                out.put("attestationVersion", head.version);
                out.put("secLevel", head.attSecLevel);
                out.put("secLevelName", secLevelName(head.attSecLevel));
                out.put("keymasterVersion", head.kmVersion);
                out.put("keymasterSecLevel", head.kmSecLevel);
                out.put("challengeHex", toHex(head.challenge));
                out.put("challengeMatched", MessageDigest.isEqual(head.challenge, challenge));
            } else {
                out.put("attestationVersion", -1);
                out.put("secLevel", -1);
            }

            // ④ 描述链 + 判定
            JSONArray chainDesc = describeChain(chain);
            out.put("chainLength", chain.length);
            out.put("chain", chainDesc);

            boolean googleChain = hasGoogleRoot(chainDesc);
            boolean hardware = head != null
                    && (head.attSecLevel == SEC_LEVEL_TEE
                    || head.attSecLevel == SEC_LEVEL_STRONGBOX);
            boolean tierA = googleChain && hardware;
            out.put("googleChain", googleChain);
            out.put("hardware", hardware);
            out.put("tier", tierA ? "A" : "B");
            out.put("ok", true);

            // ⑤ 公钥标识与 SPKI（存档/登记复用）
            try {
                byte[] spki = chain[0].getPublicKey().getEncoded();
                out.put("spki", Base64.encodeToString(spki, Base64.NO_WRAP));
                out.put("keyId", keyIdFromSpki(spki));
            } catch (Exception e) {
                Log.w(TAG, "probe: 公钥读取失败", e);
            }
            return out;
        } catch (Exception e) {
            Log.e(TAG, "probe 异常", e);
            try {
                out.put("ok", false);
                out.put("tier", "B");
                out.put("unsupported", "probe_exception");
                out.put("error", String.valueOf(e.getMessage()));
            } catch (Exception ignored) {}
            return out;
        }
    }

    // ======================================================================
    //  keygen + 证书链
    // ======================================================================

    /**
     * 生成（或复用）证明密钥。
     *
     * @param challenge    attestation challenge（非空才出证书链）
     * @param includeProps API31+ 是否请求设备属性（brand/model 等）
     * @param forceRegen   true 时先删除同名别名（探针/重置用）
     */
    public JSONObject ensureDeviceKey(byte[] challenge, boolean includeProps,
                                      boolean forceRegen) {
        JSONObject r = new JSONObject();
        try {
            KeyStore ks = KeyStore.getInstance(KEYSTORE_PROVIDER);
            ks.load(null);
            if (forceRegen && ks.containsAlias(KEY_ALIAS)) {
                ks.deleteEntry(KEY_ALIAS);
            }
            if (!ks.containsAlias(KEY_ALIAS)) {
                KeyPair kp = generateWithFallback(challenge, includeProps);
                if (kp == null) {
                    r.put("ok", false);
                    r.put("unsupported", "keygen_failed");
                    r.put("error", "generateKeyPair exhausted");
                    return r;
                }
                r.put("generated", true);
                if (kp.getPublic() != null) {
                    byte[] spki = kp.getPublic().getEncoded();
                    r.put("spki", Base64.encodeToString(spki, Base64.NO_WRAP));
                    r.put("keyId", keyIdFromSpki(spki));
                }
                // 新生成密钥：证书链正是针对本次 challenge 签发，随响应回传供登记；
                // 复用既有密钥时不带 chain（旧链 challenge 已失效，登记必被拒）。
                X509Certificate[] freshChain = getCertificateChain();
                if (freshChain != null && freshChain.length > 0) {
                    JSONArray chainB64 = new JSONArray();
                    for (X509Certificate c : freshChain) {
                        chainB64.put(Base64.encodeToString(c.getEncoded(),
                                Base64.NO_WRAP));
                    }
                    r.put("chain", chainB64);
                }
            } else {
                r.put("generated", false);
                r.put("deviceProperties", includeProps
                        && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S);
                byte[] spki = getPublicKeySpkiBytes();
                if (spki != null) {
                    r.put("spki", Base64.encodeToString(spki, Base64.NO_WRAP));
                    r.put("keyId", keyIdFromSpki(spki));
                }
            }
            r.put("ok", true);
            return r;
        } catch (Exception e) {
            Log.e(TAG, "ensureDeviceKey 失败", e);
            try {
                r.put("ok", false);
                r.put("unsupported", "keygen_failed");
                r.put("error", String.valueOf(e.getClass().getSimpleName())
                        + ": " + e.getMessage());
            } catch (Exception ignored) {}
            return r;
        }
    }

    /**
     * keygen 两段降级：先按 includeProps 构建（API31+ 带设备属性）；
     * 设备属性导致 ProviderException 时，以纯 challenge 重试。
     */
    private KeyPair generateWithFallback(byte[] challenge, boolean includeProps)
            throws Exception {
        boolean propsApplied = includeProps
                && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S;
        KeyPairGenerator kpg = KeyPairGenerator.getInstance(
                KeyProperties.KEY_ALGORITHM_EC, KEYSTORE_PROVIDER);
        KeyGenParameterSpec.Builder b = new KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_SIGN | KeyProperties.PURPOSE_VERIFY)
                .setAlgorithmParameterSpec(new ECGenParameterSpec("secp256r1"))
                .setDigests(KeyProperties.DIGEST_SHA256);
        if (challenge != null && challenge.length > 0) {
            b.setAttestationChallenge(challenge);
        }
        if (propsApplied) {
            b.setDevicePropertiesAttestationIncluded(true);
        }
        try {
            kpg.initialize(b.build());
            return kpg.generateKeyPair();
        } catch (Exception eIfProps) {
            if (!propsApplied) throw eIfProps;
            Log.w(TAG, "generateWithFallback: 设备属性 keygen 失败，降级纯 challenge",
                    eIfProps);
            KeyGenParameterSpec.Builder b2 = new KeyGenParameterSpec.Builder(
                    KEY_ALIAS,
                    KeyProperties.PURPOSE_SIGN | KeyProperties.PURPOSE_VERIFY)
                    .setAlgorithmParameterSpec(new ECGenParameterSpec("secp256r1"))
                    .setDigests(KeyProperties.DIGEST_SHA256);
            if (challenge != null && challenge.length > 0) {
                b2.setAttestationChallenge(challenge);
            }
            kpg.initialize(b2.build());
            return kpg.generateKeyPair();
        }
    }

    /** 读取证明密钥的证书链；失败返回 null。 */
    public X509Certificate[] getCertificateChain() {
        try {
            KeyStore ks = KeyStore.getInstance(KEYSTORE_PROVIDER);
            ks.load(null);
            Certificate[] certs = ks.getCertificateChain(KEY_ALIAS);
            if (certs == null || certs.length == 0) return null;
            X509Certificate[] x509 = new X509Certificate[certs.length];
            for (int i = 0; i < certs.length; i++) {
                x509[i] = (X509Certificate) certs[i];
            }
            return x509;
        } catch (Exception e) {
            Log.e(TAG, "getCertificateChain 失败", e);
            return null;
        }
    }

    /**
     * POP 签名：用证明私钥对 {@code bnzc_poc_v1|{mid}|{nonce}} 做
     * ECDSA/SHA-256，输出 raw R||S（64 字节 base64，WebCrypto 直收）。
     *
     * @return 结构化结果 {ok, kid, sig}；异常/无密钥 → unsupported。
     */
    public JSONObject signProof(String mid, String nonce) {
        JSONObject r = new JSONObject();
        try {
            if (mid == null || mid.length() == 0 || nonce == null
                    || nonce.length() == 0) {
                r.put("ok", false);
                r.put("unsupported", "bad_args");
                return r;
            }
            KeyStore ks = KeyStore.getInstance(KEYSTORE_PROVIDER);
            ks.load(null);
            if (!ks.containsAlias(KEY_ALIAS) || ks.getCertificate(KEY_ALIAS) == null) {
                r.put("ok", false);
                r.put("unsupported", "no_key");
                return r;
            }
            PrivateKey pk = (PrivateKey) ks.getKey(KEY_ALIAS, null);
            if (pk == null) {
                r.put("ok", false);
                r.put("unsupported", "no_private_key");
                return r;
            }
            String message = POP_PREFIX + "|" + mid + "|" + nonce;
            Signature sig = Signature.getInstance("SHA256withECDSA");
            sig.initSign(pk);
            sig.update(message.getBytes("UTF-8"));
            byte[] der = sig.sign();
            byte[] raw = derEcdsaToRaw(der, 32);
            if (raw == null) {
                r.put("ok", false);
                r.put("unsupported", "sig_format");
                return r;
            }
            r.put("ok", true);
            r.put("kid", getKeyId());
            r.put("sig", Base64.encodeToString(raw, Base64.NO_WRAP));
            return r;
        } catch (Exception e) {
            Log.e(TAG, "signProof 失败", e);
            try {
                r.put("ok", false);
                r.put("unsupported", "sign_exception");
                r.put("error", String.valueOf(e.getClass().getSimpleName())
                        + ": " + e.getMessage());
            } catch (Exception ignored) {}
            return r;
        }
    }

    /** 当前证明公钥的 keyId（SHA-256(SPKI) 前 16 位 hex）；失败返回 ""。 */
    public String getKeyId() {
        byte[] spki = getPublicKeySpkiBytes();
        return spki != null ? keyIdFromSpki(spki) : "";
    }

    /** 当前证明公钥 SPKI（base64）；失败返回 null。 */
    public String getPublicKeySpki() {
        byte[] spki = getPublicKeySpkiBytes();
        return spki != null ? Base64.encodeToString(spki, Base64.NO_WRAP) : null;
    }

    private byte[] getPublicKeySpkiBytes() {
        try {
            KeyStore ks = KeyStore.getInstance(KEYSTORE_PROVIDER);
            ks.load(null);
            Certificate c = ks.getCertificate(KEY_ALIAS);
            return c != null && c.getPublicKey() != null
                    ? c.getPublicKey().getEncoded() : null;
        } catch (Exception e) {
            Log.e(TAG, "getPublicKeySpkiBytes 失败", e);
            return null;
        }
    }

    // ======================================================================
    //  attestation 头最小 DER 解析
    // ======================================================================

    /** 头部解析结果。 */
    private static class AttHead {
        int version;
        int attSecLevel;
        int kmVersion;
        int kmSecLevel;
        byte[] challenge;
    }

    /**
     * 从叶子证书 attestation 扩展解析 KeyDescription 头部五个字段：
     * attestationVersion(INTEGER) / attestationSecurityLevel(ENUMERATED) /
     * keymasterVersion(INTEGER) / keymasterSecurityLevel(ENUMERATED) /
     * attestationChallenge(OCTET STRING)。
     *
     * getExtensionValue 只包单层 OCTET STRING（实证）：
     * {@code 04 LL [KeyDescription SEQUENCE]}。
     */
    private AttHead parseAttestationHead(X509Certificate leaf) throws Exception {
        byte[] ext = leaf.getExtensionValue(ATTESTATION_OID);
        if (ext == null) throw new IllegalStateException("attestation extension missing");
        DerCursor d = new DerCursor(ext);
        d.expect(TAG_OCTET_STRING);      // 外层唯一 OCTET STRING
        d.readLength();
        d.expect(TAG_SEQUENCE);
        d.readLength();
        AttHead h = new AttHead();
        h.version = d.readInteger(TAG_INTEGER);
        h.attSecLevel = d.readInteger(TAG_ENUMERATED);
        h.kmVersion = d.readInteger(TAG_INTEGER);
        h.kmSecLevel = d.readInteger(TAG_ENUMERATED);
        h.challenge = d.readOctetString(TAG_OCTET_STRING);
        return h;
    }

    /** 最小 DER TLV 游标（仅大端、 definite length）。 */
    private static class DerCursor {
        final byte[] d;
        int p;

        DerCursor(byte[] data) { this.d = data; }

        int expect(int tag) {
            int t = d[p++] & 0xFF;
            if (t != tag) {
                throw new IllegalStateException("expected tag 0x"
                        + Integer.toHexString(tag) + " got 0x"
                        + Integer.toHexString(t) + " at " + (p - 1));
            }
            return tag;
        }

        int readLength() {
            int b = d[p++] & 0xFF;
            if ((b & 0x80) == 0) return b;
            int n = b & 0x7F;
            int v = 0;
            for (int i = 0; i < n; i++) v = (v << 8) | (d[p++] & 0xFF);
            return v;
        }

        int readInteger(int wantTag) {
            expect(wantTag);
            int len = readLength();
            int v = 0;
            for (int i = 0; i < len; i++) v = (v << 8) | (d[p++] & 0xFF);
            return v;
        }

        byte[] readOctetString(int wantTag) {
            expect(wantTag);
            int len = readLength();
            byte[] v = new byte[len];
            System.arraycopy(d, p, v, 0, len);
            p += len;
            return v;
        }
    }

    /**
     * DER ECDSA 签名 → raw R||S（固定 componentLen 字节）。
     * 结构：{@code SEQUENCE { r INTEGER, s INTEGER }}；
     * 去掉每节符号前导零后左侧补零。失败返回 null。
     */
    static byte[] derEcdsaToRaw(byte[] der, int componentLen) {
        try {
            int[] p = {0};
            if ((der[p[0]++] & 0xFF) != TAG_SEQUENCE) return null;
            skipLen(der, p);
            byte[] r = readDerIntBytes(der, p);
            byte[] s = readDerIntBytes(der, p);
            if (r == null || s == null) return null;
            byte[] raw = new byte[componentLen * 2];
            if (r.length > componentLen || s.length > componentLen) return null;
            System.arraycopy(r, 0, raw, componentLen - r.length, r.length);
            System.arraycopy(s, 0, raw, componentLen * 2 - s.length, s.length);
            return raw;
        } catch (Exception e) {
            return null;
        }
    }

    private static void skipLen(byte[] d, int[] p) {
        int b = d[p[0]++] & 0xFF;
        if ((b & 0x80) != 0) {
            int n = b & 0x7F;
            for (int i = 0; i < n; i++) p[0]++;
        }
    }

    private static byte[] readDerIntBytes(byte[] d, int[] p) {
        if ((d[p[0]++] & 0xFF) != TAG_INTEGER) return null;
        int len = (int) readLenStatic(d, p);
        byte[] v = new byte[len];
        System.arraycopy(d, p[0], v, 0, len);
        p[0] += len;
        // 去掉大端无符号表示的前导零
        int off = 0;
        while (off < v.length - 1 && v[off] == 0) off++;
        if (off == 0) return v;
        byte[] t = new byte[v.length - off];
        System.arraycopy(v, off, t, 0, t.length);
        return t;
    }

    private static long readLenStatic(byte[] d, int[] p) {
        int b = d[p[0]++] & 0xFF;
        if ((b & 0x80) == 0) return b;
        int n = b & 0x7F;
        long v = 0;
        for (int i = 0; i < n; i++) v = (v << 8) | (d[p[0]++] & 0xFF);
        return v;
    }

    // ======================================================================
    //  证书链描述 / 链根判定
    // ======================================================================

    /** 逐证书输出 subjectDN / issuerDN / 完整 DER（b64，存档为夹具）。 */
    private JSONArray describeChain(X509Certificate[] chain) {
        JSONArray arr = new JSONArray();
        try {
            for (int i = 0; i < chain.length; i++) {
                JSONObject c = new JSONObject();
                c.put("i", i);
                c.put("subject", String.valueOf(chain[i].getSubjectDN()));
                c.put("issuer", String.valueOf(chain[i].getIssuerDN()));
                c.put("b64", Base64.encodeToString(chain[i].getEncoded(),
                        Base64.NO_WRAP));
                arr.put(c);
            }
        } catch (Exception e) {
            Log.e(TAG, "describeChain 失败", e);
        }
        return arr;
    }

    /**
     * 链根判定：末证书为自签（subject==issuer）且 DN 含 Google 认证根特征。
     * 根 CN 形如「Android Hardware Attestation Root」「Key Attestation CA1」
     * 及 serialNumber=f92009e… 的根；软件链末根也含 "attestation root"。
     */
    private boolean hasGoogleRoot(JSONArray chainDesc) {
        try {
            if (chainDesc.length() == 0) return false;
            JSONObject last = chainDesc.getJSONObject(chainDesc.length() - 1);
            String subject = last.optString("subject", "");
            String issuer = last.optString("issuer", "");
            boolean selfSigned = subject.equalsIgnoreCase(issuer);
            boolean google = isGoogleRootDn(subject);
            if (google && selfSigned) return true;
            // 链中任一 DN 出现 Google 根特征也算（部分链根 issuer 非自签）
            for (int i = 0; i < chainDesc.length(); i++) {
                String dn = chainDesc.getJSONObject(i).optString("issuer", "")
                        + " " + chainDesc.getJSONObject(i).optString("subject", "");
                if (isGoogleRootDn(dn)) return true;
            }
            return false;
        } catch (Exception e) {
            Log.w(TAG, "hasGoogleRoot 判定异常", e);
            return false;
        }
    }

    /** 判定 DN 是否为 Google attestation 根特征。 */
    private static boolean isGoogleRootDn(String dn) {
        String l = dn.toLowerCase();
        boolean rootWord = l.contains("attestation root")
                || l.contains("key attestation ca")
                || l.contains("f92009e853b6b045");
        return rootWord && (l.contains("android") || l.contains("google")
                || l.contains("attestation"));
    }

    private static String secLevelName(int level) {
        switch (level) {
            case SEC_LEVEL_SOFTWARE: return "Software";
            case SEC_LEVEL_TEE: return "TrustedEnvironment";
            case SEC_LEVEL_STRONGBOX: return "StrongBox";
            default: return "Unknown";
        }
    }

    // ======================================================================
    //  公钥标识 / 编解码工具
    // ======================================================================

    /** keyId = SHA-256(SPKI) 前 16 位 hex（登记/POP kid 一致口径）。 */
    public static String keyIdFromSpki(byte[] spki) {
        try {
            byte[] h = MessageDigest.getInstance("SHA-256").digest(spki);
            StringBuilder sb = new StringBuilder();
            for (int i = 0; i < 8; i++) sb.append(String.format("%02x", h[i]));
            return sb.toString();
        } catch (Exception e) {
            return "";
        }
    }

    static String toHex(byte[] b) {
        StringBuilder sb = new StringBuilder();
        for (byte x : b) sb.append(String.format("%02x", x));
        return sb.toString();
    }
}
