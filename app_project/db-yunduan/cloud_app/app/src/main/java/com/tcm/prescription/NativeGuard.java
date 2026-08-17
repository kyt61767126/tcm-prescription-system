package com.tcm.prescription;

// ============================================================================
//  NativeGuard — NDK 原生安全校验 JNI 桥（云端版，P0-NDK，2026-08-17）
//
//  作用：把 APK 签名校验中最易被逆向的关键逻辑（SHA-256 + 常量时间比对）
//        下沉到 libsecurityguard.so（纯 C++ 机器码）。
//
//  ★ 红线：宁可漏检不可误报、不允许正常用户闪退。
//  → System.loadLibrary 失败（.so 缺失/ABI 不匹配）时静默回退到调用方 Java 实现，
//    绝不抛异常导致 APP 崩溃。
//  → isAvailable() 供业务代码判断 native 是否可用。
//  → verifyApkSignature 在 native 不可用/异常时返回 false，由调用方回退 Java 校验。
// ============================================================================

import android.util.Log;

public class NativeGuard {

    private static final String TAG = "NativeGuard";

    private static boolean libraryLoaded = false;
    private static boolean loadAttempted = false;

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
            return nativeVerifyApkSignature(signatureBytes, expectedSha256);
        } catch (Throwable t) {
            Log.w(TAG, "NDK 校验异常，回退到 Java 实现: " + t.getMessage());
            return false;
        }
    }

    private static native boolean nativeVerifyApkSignature(byte[] signatureBytes, String expectedSha256);
}