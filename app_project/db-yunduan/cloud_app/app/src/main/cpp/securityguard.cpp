// ============================================================================
//  securityguard.cpp — NDK 原生安全校验库（云端版，P0-NDK，2026-08-17）
//
//  目标：把 APK 签名校验中最易被逆向的关键逻辑（SHA-256 摘要 + 常量时间比对）
//        下沉到 NDK 原生层，提高反汇编/反篡改难度。
//
//  设计原则（红线：宁可漏检不可误报、不允许正常用户闪退）：
//  → 纯 C++ 实现，不依赖第三方库，避免 CI 拉取依赖失败。
//  → 调用方（Java）在 System.loadLibrary 失败或 native 不可用时自动回退到
//    原 Java 实现，.so 加载异常绝不导致闪退。
//  → 比对采用常量时间（constant-time），防止时序侧信道。
//
//  JNI 入口：Java_<包名>_<类名>_nativeVerifyApkSignature
//    - 云端版：com.tcm.prescription.NativeGuard（本文件符号）
//    - 离线版：com.benneng.pres.NativeGuard（见 db-offline，另一份副本）
//  （JNI 符号名随包名/类名变化，故两端各保存一份）
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
//  JNI 入口：nativeVerifyApkSignature(byte[] signatureBytes, String expectedSha256)
//  @param signatureBytes 签名证书原始字节（Signature.toByteArray()）
//  @param expectedSha256 由 Java 侧注入的期望 SHA-256 指纹
//  @return jboolean 1=通过 0=不通过
//  包名 com.tcm.prescription，类名 NativeGuard（云端版）
// ----------------------------------------------------------------------------
extern "C" JNIEXPORT jboolean JNICALL
Java_com_tcm_prescription_NativeGuard_nativeVerifyApkSignature(
        JNIEnv* env, jobject /*thiz*/,
        jbyteArray signatureBytes, jstring expectedSha256) {

    if (signatureBytes == NULL || expectedSha256 == NULL) {
        return JNI_FALSE;
    }

    jsize len = env->GetArrayLength(signatureBytes);
    if (len <= 0) return JNI_FALSE;

    jbyte* raw = env->GetByteArrayElements(signatureBytes, NULL);
    if (raw == NULL) return JNI_FALSE;

    std::string fingerprint = sha256Hex((const uint8_t*)raw, (size_t)len);
    env->ReleaseByteArrayElements(signatureBytes, raw, JNI_ABORT);

    const char* expected = env->GetStringUTFChars(expectedSha256, NULL);
    if (expected == NULL) return JNI_FALSE;
    std::string expectedStr(expected);
    env->ReleaseStringUTFChars(expectedSha256, expected);

    return constantTimeEqualsIgnoreCase(expectedStr, fingerprint) ? JNI_TRUE : JNI_FALSE;
}