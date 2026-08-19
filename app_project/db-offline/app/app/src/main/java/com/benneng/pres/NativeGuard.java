package com.benneng.pres;

// ============================================================================
//  NativeGuard — NDK 原生安全校验 JNI 桥（离线版，P0-NDK，2026-08-17；P1-[4.1] 动态注册）
//
//  作用：把 APK 签名校验中最易被逆向的关键逻辑（SHA-256 + 常量时间比对）
//        下沉到 libsecurityguard.so（纯 C++ 机器码）。
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

    // P1-[4.1] 结果脱敏掩码（与 securityguard.cpp NDK_RESULT_MASK / NDK_RESULT_OK 一致）
    private static final int NDK_RESULT_MASK = 0x1C;
    private static final int NDK_RESULT_OK   = 0x5A;

    private static native int nativeVerifyApkSignature(byte[] signatureBytes, String expectedSha256);
}