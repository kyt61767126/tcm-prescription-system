// ============================================================================
//  securityguard.cpp — NDK 原生安全校验库（P0-NDK，2026-08-17；P1-[4.1] 动态注册；
//                      P1 验签下沉 2026-09-11）
//
//  目标：把 APK 签名校验中最易被逆向的关键逻辑（SHA-256 摘要 + 常量时间比对）
//        下沉到 NDK 原生层，提高反汇编/反篡改难度。
//  P1（2026-09-11）：V7 激活码 Ed25519 验签核心数学（SHA-512 + 域运算 + 点运算）
//        同步下沉——Java 层 Ed25519 可被 Frida hook 返回 true 绕过，native 双路
//        互检分叉即 fail-closed（LicenseManager 集成，integrityState=2 上报封锁）。
//
//  设计原则（红线：宁可漏检不可误报、不允许正常用户闪退）：
//  → 纯 C++ 实现，不依赖第三方库，避免 CI 拉取依赖失败。
//  → 调用方（Java）在 System.loadLibrary 失败或 native 不可用时自动回退到
//    原 Java 实现，.so 加载异常绝不导致闪退。
//  → 比对采用常量时间（constant-time），防止时序侧信道。
//
//  P1-[4.1] 动态注册（2026-08-19）：
//  → 移除 Java_<包名>_<类名>_<方法名> 静态导出符号，改为 JNI_OnLoad 中用
//    RegisterNatives 动态绑定，.so 导出符号不再暴露类名/包名，降低逆向定位难度。
//  → 返回结果做 XOR 脱敏：通过=0x5A^MASK，不通过=0xA5^MASK，Java 侧异或还原。
//  → 绑定失败不返回非法版本（避免 JVM 拒绝加载库），仅清理挂起异常；Java 侧
//    调用未绑定方法会抛 UnsatisfiedLinkError，由 NativeGuard 的 try-catch 捕获回退。
// ============================================================================

#include <jni.h>
#include <string>
#include <cstdint>
#include <cstring>

// ----------------------------------------------------------------------------
//  SHA-256 实现（FIPS 180-4，完全离线，无外部依赖）
// ----------------------------------------------------------------------------
namespace {

inline uint32_t rotr32(uint32_t x, uint32_t n) { return (x >> n) | (x << (32 - n)); }

struct Sha256 {
    uint32_t state[8];
    uint64_t totalBits;
    uint8_t buffer[64];
    size_t bufferLen;

    static const uint32_t K[64];

    Sha256() {
        state[0] = 0x6a09e667u; state[1] = 0xbb67ae85u;
        state[2] = 0x3c6ef372u; state[3] = 0xa54ff53au;
        state[4] = 0x510e527fu; state[5] = 0x9b05688cu;
        state[6] = 0x1f83d9abu; state[7] = 0x5be0cd19u;
        totalBits = 0; bufferLen = 0;
    }

    void transform(const uint8_t block[64]) {
        uint32_t w[64];
        for (int i = 0; i < 16; ++i) {
            w[i] = ((uint32_t)block[i*4] << 24) | ((uint32_t)block[i*4+1] << 16) |
                   ((uint32_t)block[i*4+2] << 8) | (uint32_t)block[i*4+3];
        }
        for (int i = 16; i < 64; ++i) {
            uint32_t s0 = rotr32(w[i-15], 7) ^ rotr32(w[i-15], 18) ^ (w[i-15] >> 3);
            uint32_t s1 = rotr32(w[i-2], 17) ^ rotr32(w[i-2], 19) ^ (w[i-2] >> 10);
            w[i] = w[i-16] + s0 + w[i-7] + s1;
        }
        uint32_t a = state[0], b = state[1], c = state[2], d = state[3];
        uint32_t e = state[4], f = state[5], g = state[6], h = state[7];
        for (int i = 0; i < 64; ++i) {
            uint32_t S1 = rotr32(e, 6) ^ rotr32(e, 11) ^ rotr32(e, 25);
            uint32_t ch = (e & f) ^ (~e & g);
            uint32_t t1 = h + S1 + ch + K[i] + w[i];
            uint32_t S0 = rotr32(a, 2) ^ rotr32(a, 13) ^ rotr32(a, 22);
            uint32_t maj = (a & b) ^ (a & c) ^ (b & c);
            uint32_t t2 = S0 + maj;
            h = g; g = f; f = e; e = d + t1;
            d = c; c = b; b = a; a = t1 + t2;
        }
        state[0] += a; state[1] += b; state[2] += c; state[3] += d;
        state[4] += e; state[5] += f; state[6] += g; state[7] += h;
    }

    void update(const void* data, size_t len) {
        totalBits += (uint64_t)len * 8;
        const uint8_t* p = (const uint8_t*)data;
        while (len > 0) {
            size_t copy = 64 - bufferLen;
            if (copy > len) copy = len;
            memcpy(buffer + bufferLen, p, copy);
            bufferLen += copy;
            p += copy;
            len -= copy;
            if (bufferLen == 64) {
                transform(buffer);
                bufferLen = 0;
            }
        }
    }

    void finish(uint8_t out[32]) {
        uint64_t bitLen = totalBits;
        memset(buffer + bufferLen, 0, 64 - bufferLen);
        buffer[bufferLen] = 0x80;
        if (bufferLen >= 56) {
            transform(buffer);
            memset(buffer, 0, 64);
        }
        for (int i = 0; i < 8; ++i) {
            buffer[56 + i] = (uint8_t)(bitLen >> (56 - i * 8));
        }
        transform(buffer);
        for (int i = 0; i < 32; ++i) {
            out[i] = (uint8_t)(state[i >> 2] >> (24 - (i & 3) * 8));
        }
    }
};

const uint32_t Sha256::K[64] = {
    0x428a2f98u,0x71374491u,0xb5c0fbcfu,0xe9b5dba5u,0x3956c25bu,0x59f111f1u,
    0x923f82a4u,0xab1c5ed5u,0xd807aa98u,0x12835b01u,0x243185beu,0x550c7dc3u,
    0x72be5d74u,0x80deb1feu,0x9bdc06a7u,0xc19bf174u,0xe49b69c1u,0xefbe4786u,
    0x0fc19dc6u,0x240ca1ccu,0x2de92c6fu,0x4a7484aau,0x5cb0a9dcu,0x76f988dau,
    0x983e5152u,0xa831c66du,0xb00327c8u,0xbf597fc7u,0xc6e00bf3u,0xd5a79147u,
    0x06ca6351u,0x14292967u,0x27b70a85u,0x2e1b2138u,0x4d2c6dfcu,0x53380d13u,
    0x650a7354u,0x766a0abbu,0x81c2c92eu,0x92722c85u,0xa2bfe8a1u,0xa81a664bu,
    0xc24b8b70u,0xc76c51a3u,0xd192e819u,0xd6990624u,0xf40e3585u,0x106aa070u,
    0x19a4c116u,0x1e376c08u,0x2748774cu,0x34b0bcb5u,0x391c0cb3u,0x4ed8aa4au,
    0x5b9cca4fu,0x682e6ff3u,0x748f82eeu,0x78a5636fu,0x84c87814u,0x8cc70208u,
    0x90befffau,0xa4506cebu,0xbef9a3f7u,0xc67178f2u
};

std::string sha256Hex(const uint8_t* data, size_t len) {
    Sha256 h;
    h.update(data, len);
    uint8_t d[32];
    h.finish(d);
    static const char* hexc = "0123456789abcdef";
    std::string out;
    out.reserve(64);
    for (int i = 0; i < 32; ++i) {
        out.push_back(hexc[(d[i] >> 4) & 0x0f]);
        out.push_back(hexc[d[i] & 0x0f]);
    }
    return out;
}

// 常量时间不区分大小写比较（避免时序侧信道）
bool constantTimeEqualsIgnoreCase(const std::string& a, const std::string& b) {
    if (a.size() != b.size()) return false;
    uint8_t acc = 0;
    for (size_t i = 0; i < a.size(); ++i) {
        char ca = a[i]; char cb = b[i];
        if (ca >= 'A' && ca <= 'Z') ca = (char)(ca - 'A' + 'a');
        if (cb >= 'A' && cb <= 'Z') cb = (char)(cb - 'A' + 'a');
        acc |= (uint8_t)(ca ^ cb);
    }
    return acc == 0;
}

} // namespace

// ----------------------------------------------------------------------------
//  动态 JNI 注册（P1-[4.1]）
//  → 核心实现函数在匿名 namespace 内（符号隐藏），不导出到 .so 符号表。
//  → JNI_OnLoad 中按类路径 FindClass + RegisterNatives 绑定，
//    离线版类路径 com/benneng/pres/NativeGuard。
// ----------------------------------------------------------------------------
namespace {

// 结果脱敏掩码（与 Java 侧 NativeGuard.NDK_RESULT_MASK / NDK_RESULT_OK 一致）
const jint NDK_RESULT_MASK = 0x1C;
const jint NDK_RESULT_OK   = 0x5A;   // 通过
const jint NDK_RESULT_FAIL = 0xA5;   // 不通过

// nativeVerifyApkSignature(byte[] signatureBytes, String expectedSha256)
// @return jint：结果经 XOR 脱敏后返回（Java 侧异或还原）
jint nativeVerifyApkSignatureImpl(JNIEnv* env, jobject /*thiz*/,
                                  jbyteArray signatureBytes, jstring expectedSha256) {
    if (signatureBytes == NULL || expectedSha256 == NULL) {
        return NDK_RESULT_FAIL ^ NDK_RESULT_MASK;
    }

    jsize len = env->GetArrayLength(signatureBytes);
    if (len <= 0) return NDK_RESULT_FAIL ^ NDK_RESULT_MASK;

    jbyte* raw = env->GetByteArrayElements(signatureBytes, NULL);
    if (raw == NULL) return NDK_RESULT_FAIL ^ NDK_RESULT_MASK;

    std::string fingerprint = sha256Hex((const uint8_t*)raw, (size_t)len);
    env->ReleaseByteArrayElements(signatureBytes, raw, JNI_ABORT);

    const char* expected = env->GetStringUTFChars(expectedSha256, NULL);
    if (expected == NULL) return NDK_RESULT_FAIL ^ NDK_RESULT_MASK;
    std::string expectedStr(expected);
    env->ReleaseStringUTFChars(expectedSha256, expected);

    bool ok = constantTimeEqualsIgnoreCase(expectedStr, fingerprint);
    return (ok ? NDK_RESULT_OK : NDK_RESULT_FAIL) ^ NDK_RESULT_MASK;
}

// ============================================================================
//  ★ P1 验签下沉（2026-09-11）：Ed25519（RFC 8032）验签 native 实现
//
//  目标：把 LicenseManager.verifyEd25519SignatureV7 的 V7 验签核心数学下沉到
//        native 层——Java 层 Ed25519 实现可被 Frida hook 返回 true 绕过，
//        native 层无导出符号（动态注册 + XOR 脱敏），hook 成本大幅提高。
//        配合 Java/native 双路互检（LicenseManager 侧）：分叉即 fail-closed
//        拒绝 + integrityState=2 上报（服务端 device_block 封锁在线能力）。
//
//  数学流程与 LicenseManager.Ed25519（Java 权威实现）完全对齐，保证双路结果
//  一致（分叉检测不误报）：
//    ① 公钥 y ≥ p 拒绝  ② S ≥ L 拒绝  ③ R/A 解压失败（无效点）拒绝
//    ④ k = SHA-512(R‖A‖M) mod L  ⑤ encode([S]B + [k](-A)) == R
//
//  常量来源：tools/_tmp/gen-ed25519-vectors.mjs / gen-sha512-const.mjs
//  从 Java 类十进制权威常量程序化生成（零手抄）；SHA-512 K/H 表经 Node
//  crypto(OpenSSL) 对拍验证，测试向量（RFC 8032 §7.1 TEST1-3 + 随机×2 +
//  篡改负向×2）同样经 OpenSSL 验证后嵌入 runEd25519SelfTest。
//
//  红线：无 __int128（armeabi-v7a 32 位 ABI 兼容）、无第三方依赖（纯 C++14）、
//       任何异常输入返回 false 绝不崩溃（nativeSelfTest 失败时 Java 侧回退
//       纯 Java 验签路径，不误伤正常用户）。
//        gf 数学结构参考 TweetNaCl（public domain）并按本项目重写适配。
// ============================================================================

// ----- SHA-512（FIPS 180-4），K/H 常量经 OpenSSL 对拍验证 -----
// （位于外层匿名 namespace 内，符号不导出）

static const uint64_t SHA512_K[80] = {
    0x428a2f98d728ae22,0x7137449123ef65cd,0xb5c0fbcfec4d3b2f,0xe9b5dba58189dbbc,
    0x3956c25bf348b538,0x59f111f1b605d019,0x923f82a4af194f9b,0xab1c5ed5da6d8118,
    0xd807aa98a3030242,0x12835b0145706fbe,0x243185be4ee4b28c,0x550c7dc3d5ffb4e2,
    0x72be5d74f27b896f,0x80deb1fe3b1696b1,0x9bdc06a725c71235,0xc19bf174cf692694,
    0xe49b69c19ef14ad2,0xefbe4786384f25e3,0x0fc19dc68b8cd5b5,0x240ca1cc77ac9c65,
    0x2de92c6f592b0275,0x4a7484aa6ea6e483,0x5cb0a9dcbd41fbd4,0x76f988da831153b5,
    0x983e5152ee66dfab,0xa831c66d2db43210,0xb00327c898fb213f,0xbf597fc7beef0ee4,
    0xc6e00bf33da88fc2,0xd5a79147930aa725,0x06ca6351e003826f,0x142929670a0e6e70,
    0x27b70a8546d22ffc,0x2e1b21385c26c926,0x4d2c6dfc5ac42aed,0x53380d139d95b3df,
    0x650a73548baf63de,0x766a0abb3c77b2a8,0x81c2c92e47edaee6,0x92722c851482353b,
    0xa2bfe8a14cf10364,0xa81a664bbc423001,0xc24b8b70d0f89791,0xc76c51a30654be30,
    0xd192e819d6ef5218,0xd69906245565a910,0xf40e35855771202a,0x106aa07032bbd1b8,
    0x19a4c116b8d2d0c8,0x1e376c085141ab53,0x2748774cdf8eeb99,0x34b0bcb5e19b48a8,
    0x391c0cb3c5c95a63,0x4ed8aa4ae3418acb,0x5b9cca4f7763e373,0x682e6ff3d6b2b8a3,
    0x748f82ee5defb2fc,0x78a5636f43172f60,0x84c87814a1f0ab72,0x8cc702081a6439ec,
    0x90befffa23631e28,0xa4506cebde82bde9,0xbef9a3f7b2c67915,0xc67178f2e372532b,
    0xca273eceea26619c,0xd186b8c721c0c207,0xeada7dd6cde0eb1e,0xf57d4f7fee6ed178,
    0x06f067aa72176fba,0x0a637dc5a2c898a6,0x113f9804bef90dae,0x1b710b35131c471b,
    0x28db77f523047d84,0x32caab7b40c72493,0x3c9ebe0a15c9bebc,0x431d67c49c100d4c,
    0x4cc5d4becb3e42b6,0x597f299cfc657e2a,0x5fcb6fab3ad6faec,0x6c44198c4a475817,
};
static const uint64_t SHA512_H0[8] = {
    0x6a09e667f3bcc908,0xbb67ae8584caa73b,0x3c6ef372fe94f82b,0xa54ff53a5f1d36f1,
    0x510e527fade682d1,0x9b05688c2b3e6c1f,0x1f83d9abfb41bd6b,0x5be0cd19137e2179,
};

inline uint64_t rotr64(uint64_t x, unsigned n) { return (x >> n) | (x << (64 - n)); }

struct Sha512 {
    uint64_t state[8];
    uint64_t lenLow, lenHigh;   // 已吸收比特数（128-bit 长度域）
    uint8_t buffer[128];
    size_t bufLen;

    Sha512() {
        for (int i = 0; i < 8; ++i) state[i] = SHA512_H0[i];
        lenLow = lenHigh = 0; bufLen = 0;
    }

    void update(const void* data, size_t len) {
        const uint8_t* p = (const uint8_t*)data;
        lenLow += (uint64_t)len * 8;
        if (lenLow < (uint64_t)len * 8) lenHigh++;   // 进位
        lenHigh += 0;  // len*8 < 2^64 单次调用不进高 64 位
        while (len > 0) {
            size_t take = 128 - bufLen;
            if (take > len) take = len;
            for (size_t i = 0; i < take; ++i) buffer[bufLen + i] = p[i];
            bufLen += take; p += take; len -= take;
            if (bufLen == 128) { transform(buffer); bufLen = 0; }
        }
    }

    void final(uint8_t out[64]) {
        buffer[bufLen++] = 0x80;
        if (bufLen > 112) { while (bufLen < 128) buffer[bufLen++] = 0; transform(buffer); bufLen = 0; }
        while (bufLen < 112) buffer[bufLen++] = 0;
        for (int i = 0; i < 8; ++i) buffer[112 + i] = (uint8_t)(lenHigh >> (56 - i * 8));
        for (int i = 0; i < 8; ++i) buffer[120 + i] = (uint8_t)(lenLow >> (56 - i * 8));
        transform(buffer);
        for (int i = 0; i < 8; ++i) {
            for (int j = 0; j < 8; ++j) out[i * 8 + j] = (uint8_t)(state[i] >> (56 - j * 8));
        }
    }

    void transform(const uint8_t block[128]) {
        uint64_t w[80];
        for (int i = 0; i < 16; ++i) {
            uint64_t v = 0;
            for (int j = 0; j < 8; ++j) v = (v << 8) | block[i * 8 + j];
            w[i] = v;
        }
        for (int i = 16; i < 80; ++i) {
            uint64_t s0 = rotr64(w[i-15], 1) ^ rotr64(w[i-15], 8) ^ (w[i-15] >> 7);
            uint64_t s1 = rotr64(w[i-2], 19) ^ rotr64(w[i-2], 61) ^ (w[i-2] >> 6);
            w[i] = w[i-16] + s0 + w[i-7] + s1;
        }
        uint64_t a = state[0], b = state[1], c = state[2], d = state[3];
        uint64_t e = state[4], f = state[5], g = state[6], h = state[7];
        for (int i = 0; i < 80; ++i) {
            uint64_t S1 = rotr64(e, 14) ^ rotr64(e, 18) ^ rotr64(e, 41);
            uint64_t ch = (e & f) ^ (~e & g);
            uint64_t t1 = h + S1 + ch + SHA512_K[i] + w[i];
            uint64_t S0 = rotr64(a, 28) ^ rotr64(a, 34) ^ rotr64(a, 39);
            uint64_t maj = (a & b) ^ (a & c) ^ (b & c);
            uint64_t t2 = S0 + maj;
            h = g; g = f; f = e; e = d + t1;
            d = c; c = b; b = a; a = t1 + t2;
        }
        state[0] += a; state[1] += b; state[2] += c; state[3] += d;
        state[4] += e; state[5] += f; state[6] += g; state[7] += h;
    }
};

// ----- Ed25519 常量（gen-ed25519-vectors.mjs 从 Java 类十进制权威源生成）-----
// 域元素 gf：radix 2^16 × 16 limbs，int64_t（无 __int128，32 位 ABI 兼容）
typedef int64_t gf[16];

static const int64_t ED_D[16] = {30883,4953,19914,30187,55467,16705,2637,112,59544,30585,16505,36039,65139,11119,27886,20995};
static const int64_t ED_D2[16] = {61785,9906,39828,60374,45398,33411,5274,224,53552,61171,33010,6542,64743,22239,55772,9222};
static const int64_t ED_SQRT_M1[16] = {41136,18958,6951,50414,58488,44335,6150,12099,55207,15867,153,11085,57099,20417,9344,11139};
static const int64_t ED_BASE_X[16] = {54554,36645,11616,51542,42930,38181,51040,26924,56412,64982,57905,49316,21502,52590,14035,8553};
static const int64_t ED_BASE_Y[16] = {26200,26214,26214,26214,26214,26214,26214,26214,26214,26214,26214,26214,26214,26214,26214,26214};
static const uint8_t ED_L[32] = {0xed,0xd3,0xf5,0x5c,0x1a,0x63,0x12,0x58,0xd6,0x9c,0xf7,0xa2,0xde,0xf9,0xde,0x14,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x10};
// p = 2^255-19 的小端 32 字节（y ≥ p 拒绝用）
static const uint8_t ED_P[32] = {0xed,0xff,0xff,0xff,0xff,0xff,0xff,0xff,0xff,0xff,0xff,0xff,0xff,0xff,0xff,0xff,
                                 0xff,0xff,0xff,0xff,0xff,0xff,0xff,0xff,0xff,0xff,0xff,0xff,0xff,0xff,0xff,0x7f};

static const gf GF_ZERO = {0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0};
static const gf GF_ONE  = {1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0};

// ----- gf 域运算（结构参考 TweetNaCl public domain，按本项目重写）-----

static void gf_copy(gf o, const gf a) { for (int i = 0; i < 16; ++i) o[i] = a[i]; }

static void gf_carry(gf o) {
    for (int i = 0; i < 16; ++i) {
        o[i] += (1LL << 16);
        int64_t c = o[i] >> 16;
        o[(i+1)*(i<15)] += c - 1 + 37 * (c-1) * (i==15);   // 2^256 ≡ 38 mod p
        o[i] -= c << 16;
    }
}

static void gf_cswap(gf p, gf q, int b) {   // 常数时间条件交换（b∈{0,1}，标量位需保密）
    int64_t mask = (int64_t)(-(int64_t)b);
    for (int i = 0; i < 16; ++i) {
        int64_t t = mask & (p[i] ^ q[i]);
        p[i] ^= t; q[i] ^= t;
    }
}

static void gf_add(gf o, const gf a, const gf b) { for (int i = 0; i < 16; ++i) o[i] = a[i] + b[i]; }
static void gf_sub(gf o, const gf a, const gf b) { for (int i = 0; i < 16; ++i) o[i] = a[i] - b[i]; }

static void gf_mul(gf o, const gf a, const gf b) {   // 别名安全（内部先算完 t 再写 o）
    int64_t t[31];
    for (int i = 0; i < 31; ++i) t[i] = 0;
    for (int i = 0; i < 16; ++i)
        for (int j = 0; j < 16; ++j) t[i+j] += a[i] * b[j];
    for (int i = 0; i < 15; ++i) t[i] += 38 * t[i+16];   // 2^256 ≡ 38 mod p
    for (int i = 0; i < 16; ++i) o[i] = t[i];
    // 3 次 carry 才充分规约（2^256 wrap-around 需多轮传播）。
    // 若只 carry 1 次，limb 可能仍很大（v^6 的 limb0 可达 2^42），
    // 累积乘法后 int64_t 溢出（UB），导致 pow22523 / ge_decompress 全错。
    gf_carry(o);
    gf_carry(o);
    gf_carry(o);
}

static void gf_sq(gf o, const gf a) { gf_mul(o, a, a); }

static void gf_inv(gf o, const gf i) {   // i^(p-2)，幂链指数 p-2（bit254..5,3,1,0 为 1）
    gf c;
    gf_copy(c, i);
    for (int a = 253; a >= 0; --a) {
        gf_sq(c, c);
        if (a != 2 && a != 4) gf_mul(c, c, i);
    }
    gf_copy(o, c);
}

static void gf_pack25519(uint8_t o[32], const gf n) {   // 完全规约到 [0,p) 再输出小端
    gf m, t;
    gf_copy(t, n);
    gf_carry(t); gf_carry(t); gf_carry(t);
    for (int j = 0; j < 2; ++j) {
        m[0] = t[0] - 0xffed;
        for (int i = 1; i < 15; ++i) {
            m[i] = t[i] - 0xffff - ((m[i-1] >> 16) & 1);
            m[i-1] &= 0xffff;
        }
        m[15] = t[15] - 0x7fff - ((m[14] >> 16) & 1);
        int b = (m[15] >> 16) & 1;
        m[14] &= 0xffff;
        gf_cswap(t, m, 1 - b);   // t ≥ p 时换入 m（t - p）
    }
    for (int i = 0; i < 16; ++i) {
        o[2*i] = (uint8_t)(t[i] & 0xff);
        o[2*i+1] = (uint8_t)(t[i] >> 8);
    }
}

static void gf_fromle(gf o, const uint8_t n[32]) {   // 小端字节加载（值可为 255-bit）
    for (int i = 0; i < 16; ++i) o[i] = n[2*i] + ((int64_t)n[2*i+1] << 8);
    o[15] &= 0x7fff;
}

static int gf_parity(const gf a) { uint8_t d[32]; gf_pack25519(d, a); return d[0] & 1; }

static bool gf_equal_packed(const gf a, const gf b) {   // 完全规约后比较（防未规约假相等）
    uint8_t da[32], db[32];
    gf_pack25519(da, a); gf_pack25519(db, b);
    uint8_t acc = 0;
    for (int i = 0; i < 32; ++i) acc |= da[i] ^ db[i];
    return acc == 0;
}

static bool bytes_ge(const uint8_t a[32], const uint8_t b[32]) {   // a ≥ b（小端，同已规约）
    for (int i = 31; i >= 0; --i) {
        if (a[i] > b[i]) return true;
        if (a[i] < b[i]) return false;
    }
    return true;
}

static void pow22523(gf o, const gf a) {   // a^((p-5)/8)，e=2^252-3：bit251..2=1,bit1=0,bit0=1
    gf r;
    gf_copy(r, a);   // 已覆盖 bit251（=1）
    for (int i = 250; i >= 0; --i) {
        gf_sq(r, r);
        if (i >= 2 || i == 0) gf_mul(r, r, a);
    }
    gf_copy(o, r);
}

// ----- ge：Edwards 曲线点（扩展齐次坐标 X:Y:Z:T）-----
struct Ge {
    gf x, y, z, t;
};

static void ge_add(Ge* p, const Ge* q) {   // p += q（TweetNaCl add 结构，D2 常量）
    gf a, b, c, d, t, e, f, g, h;
    gf_sub(a, p->y, p->x);
    gf_sub(t, q->y, q->x);
    gf_mul(a, a, t);
    gf_add(b, p->x, p->y);
    gf_add(t, q->x, q->y);
    gf_mul(b, b, t);
    gf_mul(c, p->t, q->t);
    gf_mul(c, c, ED_D2);
    gf_mul(d, p->z, q->z);
    gf_add(d, d, d);
    gf_sub(e, b, a);
    gf_sub(f, d, c);
    gf_add(g, d, c);
    gf_add(h, b, a);
    gf_mul(p->x, e, f);
    gf_mul(p->y, h, g);
    gf_mul(p->z, g, f);
    gf_mul(p->t, e, h);
}

static void ge_scalarmult(Ge* p, const Ge* q, const uint8_t s[32]) {
    // p = [s]q；Montgomery ladder（常数时间）；内部拷贝 q，不破坏调用方输入
    Ge qq = *q;
    gf_copy(p->x, GF_ZERO); gf_copy(p->y, GF_ONE);
    gf_copy(p->z, GF_ONE);  gf_copy(p->t, GF_ZERO);
    for (int i = 255; i >= 0; --i) {
        uint8_t b = (s[i/8] >> (i & 7)) & 1;
        gf_cswap(p->x, qq.x, b); gf_cswap(p->y, qq.y, b);
        gf_cswap(p->z, qq.z, b); gf_cswap(p->t, qq.t, b);
        ge_add(&qq, p);
        ge_add(p, p);
        gf_cswap(p->x, qq.x, b); gf_cswap(p->y, qq.y, b);
        gf_cswap(p->z, qq.z, b); gf_cswap(p->t, qq.t, b);
    }
}

static const Ge& basePoint() {   // C++11 magic static（线程安全，进程内一次构造）
    static Ge B = [] {
        Ge b;
        gf_copy(b.x, ED_BASE_X);
        gf_copy(b.y, ED_BASE_Y);
        gf_copy(b.z, GF_ONE);
        gf_mul(b.t, ED_BASE_X, ED_BASE_Y);
        return b;
    }();
    return B;
}

static void ge_pack(uint8_t r[32], const Ge* p) {
    gf zi, tx, ty;
    gf_inv(zi, p->z);
    gf_mul(tx, p->x, zi);
    gf_mul(ty, p->y, zi);
    gf_pack25519(r, ty);
    r[31] ^= (uint8_t)(gf_parity(tx) << 7);
}

// 解压 Edwards 点（RFC 8032 §5.1.3）；无效编码返回 false。
// 与 Java Ed25519.decompress 行为对齐：y≥p 拒绝 / sqrt 失败拒绝 / 符号位恢复，
// 不做 x==0&&sign 检查（对齐 Java，保证双路结果一致）。
static bool ge_decompress(Ge* r, const uint8_t p[32]) {
    gf y, y2, u, v, v3, v7, uv7, x, t0, vxx, check;
    gf_fromle(y, p);
    // y ≥ p 检查（完全规约后比较）
    uint8_t yb[32];
    gf_pack25519(yb, y);
    if (bytes_ge(yb, ED_P)) return false;
    gf_sq(y2, y);
    gf_sub(u, y2, GF_ONE);
    gf_mul(t0, ED_D, y2);
    gf_add(v, t0, GF_ONE);
    // x = u·v³·(u·v⁷)^((p-5)/8)
    gf_mul(v3, v, v); gf_mul(v3, v3, v);
    gf_mul(v7, v3, v3); gf_mul(v7, v7, v);
    gf_mul(uv7, u, v7);
    pow22523(t0, uv7);
    gf_mul(x, u, v3); gf_mul(x, x, t0);
    // 检查 v·x² == u；不匹配再试 x·sqrt(-1)
    gf_sq(vxx, x); gf_mul(check, v, vxx);
    if (!gf_equal_packed(check, u)) {
        gf xs;
        gf_mul(xs, x, ED_SQRT_M1);
        gf_sq(vxx, xs); gf_mul(check, v, vxx);
        if (!gf_equal_packed(check, u)) return false;
        gf_copy(x, xs);
    }
    int sign = (p[31] >> 7) & 1;
    if (gf_parity(x) != sign) gf_sub(x, GF_ZERO, x);
    gf_copy(r->x, x); gf_copy(r->y, y);
    gf_copy(r->z, GF_ONE);
    gf_mul(r->t, x, y);
    return true;
}

// S < L（canonical 标量检查，对齐 Java verify 步骤 2）
static bool sc_is_canonical(const uint8_t s[32]) {
    for (int i = 31; i >= 0; --i) {
        if (s[i] < ED_L[i]) return true;
        if (s[i] > ED_L[i]) return false;
    }
    return false;   // == L
}

// h(64B 小端) mod L → out(32B 小端)；逐位移位减法（简单可靠，验签非热路径）
static void sc_reduce512(const uint8_t h[64], uint8_t out[32]) {
    uint32_t Lw[8];
    for (int j = 0; j < 8; ++j)
        Lw[j] = (uint32_t)ED_L[4*j] | ((uint32_t)ED_L[4*j+1] << 8) |
                ((uint32_t)ED_L[4*j+2] << 16) | ((uint32_t)ED_L[4*j+3] << 24);
    uint32_t r[9] = {0,0,0,0,0,0,0,0,0};   // r < 2L < 2^254，9 words 够
    for (int i = 511; i >= 0; --i) {
        // r = r*2 + bit_i(h)
        uint32_t carry = (h[i/8] >> (i & 7)) & 1;
        for (int j = 0; j < 9; ++j) {
            uint32_t nc = r[j] >> 31;
            r[j] = (r[j] << 1) | carry;
            carry = nc;
        }
        // r ≥ L → r -= L
        // 注意：必须用"全相等才判定等于"的语义。
        // 原实现 cmp&&!ge 的问题：高位相等但低位更小（r < L）时 cmp 残留为 1，
        // 且 ge=false → 误判为 r == L → 减 L 下溢。
        bool greater = false;
        bool allEqual = true;
        for (int j = 8; j >= 0; --j) {
            uint32_t lj = (j < 8) ? Lw[j] : 0;
            if (r[j] > lj) { greater = true; allEqual = false; break; }
            if (r[j] < lj) { allEqual = false; break; }
        }
        if (greater || allEqual) {   // r ≥ L 才减
            uint32_t borrow = 0;
            for (int j = 0; j < 9; ++j) {
                uint32_t lj = (j < 8) ? Lw[j] : 0;
                uint32_t nb = ((uint64_t)r[j] < (uint64_t)lj + borrow) ? 1 : 0;
                r[j] = r[j] - lj - borrow;
                borrow = nb;
            }
        }
    }
    for (int j = 0; j < 8; ++j) {
        out[4*j]   = (uint8_t)(r[j]);
        out[4*j+1] = (uint8_t)(r[j] >> 8);
        out[4*j+2] = (uint8_t)(r[j] >> 16);
        out[4*j+3] = (uint8_t)(r[j] >> 24);
    }
}

// Ed25519 验签核心（与 LicenseManager.Ed25519.verify 数学流程一致）
static bool ed25519_verify(const uint8_t pub[32], const uint8_t* msg, size_t msgLen,
                           const uint8_t sig[64]) {
    // 1. S < L
    if (!sc_is_canonical(sig + 32)) return false;
    // 2. 解压 A（公钥），构造 -A（X 取负）
    Ge A;
    if (!ge_decompress(&A, pub)) return false;
    gf_sub(A.x, GF_ZERO, A.x);
    gf_sub(A.t, GF_ZERO, A.t);
    // 3. 解压 R（仅有效性校验，对齐 Java decompress(R) null 检查）
    Ge R;
    if (!ge_decompress(&R, sig)) return false;
    // 4. k = SHA-512(R‖A‖M) mod L
    uint8_t kb[32];
    {
        Sha512 s;
        s.update(sig, 32);       // R
        s.update(pub, 32);       // A
        s.update(msg, msgLen);   // M
        uint8_t h[64];
        s.final(h);
        sc_reduce512(h, kb);
    }
    // 5. p = [S]B + [k](-A)；encode(p) == R ?
    Ge p, tmp;
    ge_scalarmult(&p, &basePoint(), sig + 32);
    ge_scalarmult(&tmp, &A, kb);
    ge_add(&p, &tmp);
    uint8_t enc[32];
    ge_pack(enc, &p);
    uint8_t acc = 0;
    for (int i = 0; i < 32; ++i) acc |= enc[i] ^ sig[i];
    return acc == 0;
}

// ----- 自测向量（gen-ed25519-vectors.mjs 生成，RFC 8032 §7.1 + 随机 + 篡改负向）-----
struct Ed25519TestVector {
    const char* pubHex;    // 64 hex 字符
    const char* msgHex;    // 任意长度（可为空串）
    const char* sigHex;    // 128 hex 字符
    bool expect;
};
static const Ed25519TestVector ED_SELFTEST_VECTORS[] = {
    // RFC 8032 §7.1 TEST 1（空消息）
    { "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a", "",
      "e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b", true },
    // RFC 8032 §7.1 TEST 2
    { "3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c", "72",
      "92a009a9f0d4cab8720e820b5f642540a2b27b5416503f8fb3762223ebdb69da085ac1e43e15996e458f3613d0f11d8c387b2eaeb4302aeeb00d291612bb0c00", true },
    // RFC 8032 §7.1 TEST 3
    { "fc51cd8e6218a1a38da47ed00230f0580816ed13ba3303ac5deb911548908025", "af82",
      "6291d657deec24024827e69c3abe01a30ce548a284743a445e3680d7db5ac3ac18ff9b538d16f290ae67f760984dc6594a7c15e9716ed28dc027beceea1ec40a", true },
    // 随机向量 1（Node crypto/openssl 生成验证）
    { "928a483cf4e40749a9f869afe2be80e2c07f1852d0d8f863eaeeb8545f56101e",
      "0726456483a2c1e0ff1e3d5c7b9ab9d8f71635547392b1d0ef0e2d4c6b8aa9c8e7",
      "e3dc968878a2fda3a6436e74abe5d6f6386290d7a7185a1ba5ba74b605b3def2213cc9d01ad688d7f2ed67f1d41ffc2b18b1eb3fc2d5aa853d7a7095214caf04", true },
    // 随机向量 2
    { "216081ea7f01587d06f5e2ee91b8675443d51ccf2c031c56edae0a4d00ebb64f",
      "0e2d4c6b8aa9c8e70625446382a1c0dffe1d3c5b7a99b8d7f61534537291b0cfee0d2c4b6a89a8c7e60524436281a0bfdefd",
      "4d41ce957b3e3b461097f20654d8aba5d3a630d2e6e8953b28cb2cf73b559a0c2c092948e733e706a6a251ca4ac4e8d4127fcd6686e18e3e0de561c485317e06", true },
    // 负向：TEST 1 签名字节 10 翻转 1 bit → 必须拒绝
    { "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a", "",
      "e5564300c367ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b", false },
    // 负向：TEST 1 消息改为 0x00 → 必须拒绝
    { "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a", "00",
      "e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b", false },
};

static int hexVal(char c) {
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    if (c >= 'A' && c <= 'F') return c - 'A' + 10;
    return -1;
}

// 运行全部自测向量；全部符合预期返回 true（native 数学可信）
static bool runEd25519SelfTest() {
    uint8_t pub[32], msg[256], sig[64];
    for (size_t v = 0; v < sizeof(ED_SELFTEST_VECTORS) / sizeof(ED_SELFTEST_VECTORS[0]); ++v) {
        const Ed25519TestVector& tv = ED_SELFTEST_VECTORS[v];
        if (strlen(tv.pubHex) != 64 || strlen(tv.sigHex) != 128) return false;
        for (int i = 0; i < 32; ++i) {
            int hi = hexVal(tv.pubHex[2*i]), lo = hexVal(tv.pubHex[2*i+1]);
            if (hi < 0 || lo < 0) return false;
            pub[i] = (uint8_t)((hi << 4) | lo);
        }
        for (int i = 0; i < 64; ++i) {
            int hi = hexVal(tv.sigHex[2*i]), lo = hexVal(tv.sigHex[2*i+1]);
            if (hi < 0 || lo < 0) return false;
            sig[i] = (uint8_t)((hi << 4) | lo);
        }
        size_t msgLen = strlen(tv.msgHex) / 2;
        if (msgLen > sizeof(msg)) return false;
        for (size_t i = 0; i < msgLen; ++i) {
            int hi = hexVal(tv.msgHex[2*i]), lo = hexVal(tv.msgHex[2*i+1]);
            if (hi < 0 || lo < 0) return false;
            msg[i] = (uint8_t)((hi << 4) | lo);
        }
        bool got = ed25519_verify(pub, msg, msgLen, sig);
        if (got != tv.expect) return false;
    }
    return true;
}

// nativeVerifyEd25519(byte[] publicKey, byte[] message, byte[] signature)
// @return jint：XOR 脱敏结果（Java 侧 NativeGuard 还原）
jint nativeVerifyEd25519Impl(JNIEnv* env, jobject /*thiz*/,
                             jbyteArray publicKey, jbyteArray message, jbyteArray signature) {
    if (publicKey == NULL || signature == NULL) return NDK_RESULT_FAIL ^ NDK_RESULT_MASK;
    jsize pubLen = env->GetArrayLength(publicKey);
    jsize sigLen = env->GetArrayLength(signature);
    jsize msgLen = (message != NULL) ? env->GetArrayLength(message) : 0;
    if (pubLen != 32 || sigLen != 64 || msgLen < 0) return NDK_RESULT_FAIL ^ NDK_RESULT_MASK;

    jbyte* pubRaw = env->GetByteArrayElements(publicKey, NULL);
    if (pubRaw == NULL) return NDK_RESULT_FAIL ^ NDK_RESULT_MASK;
    jbyte* msgRaw = (message != NULL) ? env->GetByteArrayElements(message, NULL) : NULL;
    jbyte* sigRaw = env->GetByteArrayElements(signature, NULL);
    bool ok = false;
    if (sigRaw != NULL && (message == NULL || msgRaw != NULL)) {
        ok = ed25519_verify((const uint8_t*)pubRaw,
                            (const uint8_t*)msgRaw, (size_t)msgLen,
                            (const uint8_t*)sigRaw);
    }
    if (pubRaw != NULL) env->ReleaseByteArrayElements(publicKey, pubRaw, JNI_ABORT);
    if (msgRaw != NULL) env->ReleaseByteArrayElements(message, msgRaw, JNI_ABORT);
    if (sigRaw != NULL) env->ReleaseByteArrayElements(signature, sigRaw, JNI_ABORT);
    return (ok ? NDK_RESULT_OK : NDK_RESULT_FAIL) ^ NDK_RESULT_MASK;
}

// nativeSelfTest()：RFC 8032 向量 + 篡改负向自测
// @return jint：XOR 脱敏结果；Java 侧失败时回退纯 Java 验签（不误伤）
jint nativeSelfTestImpl(JNIEnv* /*env*/, jobject /*thiz*/) {
    return (runEd25519SelfTest() ? NDK_RESULT_OK : NDK_RESULT_FAIL) ^ NDK_RESULT_MASK;
}

} // namespace

// JNI_OnLoad：动态注册（必须导出，供 JVM 加载时发现）
// 绑定失败时不返回非法版本（避免 JVM 拒绝加载库导致整体不可用），
// 仅清理挂起异常；Java 侧调用未绑定方法抛 UnsatisfiedLinkError → 回退 Java 实现。
extern "C" JNIEXPORT jint JNICALL
JNI_OnLoad(JavaVM* vm, void* /*reserved*/) {
    JNIEnv* env = NULL;
    if (vm->GetEnv((void**)&env, JNI_VERSION_1_6) != JNI_OK) {
        return JNI_ERR;
    }

    jclass clazz = env->FindClass("com/benneng/pres/NativeGuard");
    if (clazz == NULL) {
        env->ExceptionClear(); // 清理挂起的 NoClassDefFoundError
        return JNI_VERSION_1_6;
    }

    static const JNINativeMethod methods[] = {
        { "nativeVerifyApkSignature", "([BLjava/lang/String;)I", (void*)nativeVerifyApkSignatureImpl },
        // P1 验签下沉：Ed25519 验签 + native 自测（符号签名）
        { "nativeVerifyEd25519", "([B[B[B)I", (void*)nativeVerifyEd25519Impl },
        { "nativeSelfTest", "()I", (void*)nativeSelfTestImpl },
    };
    if (env->RegisterNatives(clazz, methods,
                             sizeof(methods) / sizeof(methods[0])) != JNI_OK) {
        env->ExceptionClear();
        env->DeleteLocalRef(clazz);
        return JNI_VERSION_1_6;
    }
    env->DeleteLocalRef(clazz);
    return JNI_VERSION_1_6;
}