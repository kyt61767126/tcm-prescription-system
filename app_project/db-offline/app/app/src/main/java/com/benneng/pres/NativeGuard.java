package com.benneng.pres;

// ============================================================================
//  NativeGuard — NDK 原生安全校验 JNI 桥（离线版，P0-NDK，2026-08-17；P1-[4.1] 动态注册；
//                 P1 验签下沉 2026-09-11）
//
//  作用：把 APK 签名校验中最易被逆向的关键逻辑（SHA-256 + 常量时间比对）
//        下沉到 libsecurityguard.so（纯 C++ 机器码）。
//  P1（2026-09-11）：V7 激活码 Ed25519 验签核心数学（SHA-512 + 域/点运算）同步下沉，
//        供 LicenseManager Java/native 双路互检（分叉 = 疑似 hook → fail-closed 拒绝）。
//
//  ★ 红线：宁可漏检不可误报、不允许正常用户闪退。
//  → System.loadLibrary 失败（.so 缺失/ABI 不匹配）时静默回退到调用方 Java 实现，
//    绝不抛异常导致 APP 崩溃。
//  → enableNative() 供业务代码判断 native 是否可用。
//
//  P1-[4.1]：native 方法改为 JNI_OnLoad 动态注册（RegisterNatives，类路径
//  com/benneng/pres/NativeGuard），返回值为 XOR 脱敏整数，本类异或还原为 boolean。
// ============================================================================

import android.util.Log;

public class NativeGuard {

    private static final String TAG = "NativeGuard";

    private static boolean libraryLoaded = false;
    private static boolean loadAttempted = false;

    // P1 验签下沉：Ed25519 自测结果进程内缓存（自测含 7 组点乘向量，避免每次验签重跑）
    private static volatile Boolean ed25519SelfTestCache = null;

    private static synchronized void ensureLoaded() {
        if (loadAttempted) return;
        loadAttempted = true;
        try {
            // 原生库失败绝不请求退出；仅标记回退
            System.loadLibrary("securityguard");
            libraryLoaded = true;
            Log.d(TAG, "NDK 原生安全库加载成功");
        } catch (Throwable t) {
            // 加载失败：回退 Java 实现（安全边界内降级）
            Log.w(TAG, "NDK 原生安全库加载失败，回退到 Java 实现: " + t.getMessage());
            libraryLoaded = false;
        }
    }

    /** native 是否可用（供调用方决定走 native 还是 Java） */
    public static boolean isAvailable() {
        ensureLoaded();
        return libraryLoaded;
    }

    /**
     * 原生 APK 签名校验：对给定签名证书字节计算 SHA-256 并与期望指纹常量时间比对
     * @param signatureBytes  签名证书原始字节（Signature.toByteArray()）
     * @param expectedSha256  期望的 SHA-256 指纹（小写十六进制，可由脚本注入）
     * @return true=通过；native 不可用时返回 false（调用方需自行回退 Java 校验）
     */
    public static boolean verifyApkSignature(byte[] signatureBytes, String expectedSha256) {
        ensureLoaded();
        if (!libraryLoaded) {
            return false; // 调用方感知到 native 不可用，回退 Java
        }
        if (signatureBytes == null || expectedSha256 == null) {
            return false;
        }
        try {
            // P1-[4.1] native 返回 XOR 脱敏整数，此处异或还原（掩码与 securityguard.cpp 一致）
            int r = nativeVerifyApkSignature(signatureBytes, expectedSha256);
            return (r ^ NDK_RESULT_MASK) == NDK_RESULT_OK;
        } catch (Throwable t) {
            Log.w(TAG, "NDK 校验异常，回退到 Java 实现: " + t.getMessage());
            return false;
        }
    }

    /**
     * ★ P1 验签下沉：原生 Ed25519 验签（RFC 8032，与 Java 纯实现数学流程完全对齐）
     * @param publicKey  32 字节公钥
     * @param message    签名内容（UTF-8 字节，不可为 null）
     * @param signature  64 字节签名
     * @return Boolean：true=通过 false=不通过；null=native 路瞬时失效（OOM/方法未注册等
     *         极端场景）——调用方对本单降级 Java 单路，绝不能当"验签失败"参与分叉判定
     *         （红线：宁可漏检不可误报）。
     */
    public static Boolean tryVerifyEd25519(byte[] publicKey, byte[] message, byte[] signature) {
        ensureLoaded();
        if (!libraryLoaded || publicKey == null || signature == null) {
            return null;
        }
        try {
            int r = nativeVerifyEd25519(publicKey, message, signature);
            return (r ^ NDK_RESULT_MASK) == NDK_RESULT_OK;
        } catch (Throwable t) {
            // UnsatisfiedLinkError 等：native 路失效而非验签失败，返回 null 降级
            Log.w(TAG, "NDK Ed25519 验签异常，本单降级 Java 路径: " + t.getMessage());
            return null;
        }
    }

    /**
     * ★ P1 验签下沉：native Ed25519 自测（RFC 8032 §7.1 标准 + 随机 + 篡改负向向量，
     * securityguard.cpp 内嵌，防 native 数学被编译器/ABI 差异破坏）。
     * 双路启用前置条件：自测不过 = native 数学不可信 → LicenseManager 回退纯 Java 单路
     * （不误伤正常用户）。结果进程内缓存。
     */
    public static boolean ed25519SelfTest() {
        Boolean cached = ed25519SelfTestCache;
        if (cached != null) return cached;
        boolean pass = false;
        if (isAvailable()) {
            try {
                int r = nativeSelfTest();
                pass = (r ^ NDK_RESULT_MASK) == NDK_RESULT_OK;
            } catch (Throwable t) {
                Log.w(TAG, "NDK Ed25519 自测异常，回退纯 Java 路径: " + t.getMessage());
                pass = false;
            }
        }
        if (!pass) {
            Log.w(TAG, "NDK Ed25519 自测未通过，V7 验签走纯 Java 单路（降级不误伤）");
        }
        ed25519SelfTestCache = pass;
        return pass;
    }

    // P1-[4.1] 结果脱敏掩码（与 securityguard.cpp NDK_RESULT_MASK / NDK_RESULT_OK 一致）
    private static final int NDK_RESULT_MASK = 0x1C;
    private static final int NDK_RESULT_OK   = 0x5A;

    private static native int nativeVerifyApkSignature(byte[] signatureBytes, String expectedSha256);

    // P1 验签下沉（2026-09-11）：JNI_OnLoad 动态注册（与上方方法同一 RegisterNatives 批次）
    private static native int nativeVerifyEd25519(byte[] publicKey, byte[] message, byte[] signature);
    private static native int nativeSelfTest();
}