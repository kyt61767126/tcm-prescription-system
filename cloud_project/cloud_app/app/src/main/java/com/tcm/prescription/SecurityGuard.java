package com.tcm.prescription;

// ============================================================================
//  SecurityGuard — 云端 APP 安全防护（独立于 LicenseManager）
//  参考：离线 APP LicenseManager.java 的 4 项安全优化（root/debugger/APK 签名）
//  差异：云端 APP 不需要 license 校验（云端账号已付费），仅做基础安全防护
//  使用：MainActivity.onCreate 中调用 SecurityGuard.checkAndExit(this)
// ============================================================================
//  2026-07-20 新增：结合最近安全升级，恢复被回退的安全防护能力
// ============================================================================

import android.app.Activity;
import android.content.Context;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.os.Build;
import android.util.Log;
import android.widget.Toast;

import java.security.MessageDigest;

public class SecurityGuard {

    private static final String TAG = "SecurityGuard";

    // ★ APK 签名校验（防反编译重打包）
    // 留空则跳过校验；填入发布签名的 SHA-256 指纹（小写无冒号）后启用
    // 获取方式：keytool -printcert -jarfile your.apk （取 SHA256: 后的值，去冒号转小写）
    // 由 generate-sign-hash.ps1 自动注入
    private static final String EXPECTED_SIGN_HASH = "";

    // ★ 安全检测开关
    private static final boolean ENABLE_ROOT_CHECK = true;
    private static final boolean ENABLE_DEBUGGER_CHECK = true;
    private static final boolean ENABLE_SIGNATURE_CHECK = true;  // 留空时自动跳过

    /**
     * 启动时安全检测：检测到威胁则 Toast 提示并退出 APP
     * 在 MainActivity.onCreate 中调用
     */
    public static void checkAndExit(Activity activity) {
        // 1. Root 检测
        if (ENABLE_ROOT_CHECK && isRooted(activity)) {
            Log.w(TAG, "安全检测：检测到 Root 设备，退出 APP");
            toastAndExit(activity, "检测到 Root 设备，为保护数据安全，APP 无法运行");
            return;
        }
        // 2. 调试器检测
        if (ENABLE_DEBUGGER_CHECK && isDebuggerAttached()) {
            Log.w(TAG, "安全检测：检测到调试器，退出 APP");
            toastAndExit(activity, "检测到调试器附加，APP 无法运行");
            return;
        }
        // 3. APK 签名校验
        if (ENABLE_SIGNATURE_CHECK && !EXPECTED_SIGN_HASH.isEmpty()) {
            if (!verifyApkSignature(activity)) {
                Log.w(TAG, "安全检测：APK 签名校验失败，退出 APP");
                toastAndExit(activity, "APK 签名校验失败，请从官方渠道下载");
                return;
            }
        }
        Log.d(TAG, "安全检测通过");
    }

    /**
     * Root 检测：检查 su 路径、Build.TAGS、Magisk 等常见 root 应用
     */
    public static boolean isRooted(Context context) {
        if (!ENABLE_ROOT_CHECK) return false;
        try {
            // 1. 检查 su 命令是否可执行
            String[] suPaths = {"/system/bin/su", "/system/xbin/su", "/sbin/su",
                    "/system/sd/xbin/su", "/system/bin/failsafe/su", "/data/local/xbin/su",
                    "/data/local/bin/su", "/data/local/su"};
            for (String path : suPaths) {
                if (new java.io.File(path).exists()) {
                    Log.w(TAG, "Root 检测：发现 su 路径 " + path);
                    return true;
                }
            }
            // 2. 检查 Build.TAGS（test-keys 是 root 固件标志）
            if (Build.TAGS != null && Build.TAGS.contains("test-keys")) {
                Log.w(TAG, "Root 检测：Build.TAGS 包含 test-keys");
                return true;
            }
            // 3. 检查 Magisk 等常见 root 应用包名
            String[] rootApps = {"com.topjohnwu.magisk", "eu.chainfire.supersu",
                    "com.koushikdutta.superuser", "com.thirdparty.superuser"};
            java.util.List<PackageInfo> pkgs = context.getPackageManager().getInstalledPackages(0);
            for (PackageInfo pi : pkgs) {
                for (String pkg : rootApps) {
                    if (pkg.equals(pi.packageName)) {
                        Log.w(TAG, "Root 检测：发现 root 应用 " + pkg);
                        return true;
                    }
                }
            }
        } catch (Exception e) {
            Log.w(TAG, "Root 检测异常（视为未 root）: " + e.getMessage());
        }
        return false;
    }

    /**
     * 调试器检测：检查 isDebuggerConnected 和 ro.debuggable
     */
    public static boolean isDebuggerAttached() {
        if (!ENABLE_DEBUGGER_CHECK) return false;
        try {
            // 1. 系统 debug 标志
            if (android.os.Debug.isDebuggerConnected()) {
                Log.w(TAG, "调试器检测：isDebuggerConnected=true");
                return true;
            }
            // 2. 系统属性 ro.debuggable（release 版应为 0）
            // SystemProperties 是 Android 隐藏 API，需通过反射调用
            String debuggable = getSystemProperty("ro.debuggable", "0");
            if ("1".equals(debuggable)) {
                Log.w(TAG, "调试器检测：ro.debuggable=1");
                return true;
            }
        } catch (Exception e) {
            // SystemProperties 可能不可访问，忽略
        }
        return false;
    }

    /**
     * APK 签名校验：比对当前 APK 签名的 SHA-256 与 EXPECTED_SIGN_HASH
     */
    public static boolean verifyApkSignature(Context context) {
        if (EXPECTED_SIGN_HASH.isEmpty()) {
            // 留空时跳过校验（开发阶段）
            return true;
        }
        try {
            PackageInfo pi = context.getPackageManager().getPackageInfo(
                    context.getPackageName(), PackageManager.GET_SIGNATURES);
            if (pi == null || pi.signatures == null || pi.signatures.length == 0) {
                Log.w(TAG, "签名校验：未获取到 APK 签名");
                return false;
            }
            Signature sig = pi.signatures[0];
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] hash = md.digest(sig.toByteArray());
            StringBuilder sb = new StringBuilder();
            for (byte b : hash) {
                sb.append(String.format("%02x", b));
            }
            String currentHash = sb.toString();
            if (!EXPECTED_SIGN_HASH.equals(currentHash)) {
                Log.w(TAG, "签名校验失败：expected=" + EXPECTED_SIGN_HASH + ", current=" + currentHash);
                return false;
            }
            return true;
        } catch (Exception e) {
            Log.e(TAG, "签名校验异常", e);
            return false;
        }
    }

    /**
     * 反射读取 Android 系统属性（替代隐藏 API android.os.SystemProperties）
     */
    private static String getSystemProperty(String key, String def) {
        try {
            Class<?> cls = Class.forName("android.os.SystemProperties");
            java.lang.reflect.Method m = cls.getMethod("get", String.class, String.class);
            Object val = m.invoke(null, key, def);
            return val != null ? val.toString() : def;
        } catch (Exception e) {
            return def;
        }
    }

    /**
     * 显示 Toast 提示并退出 APP
     */
    private static void toastAndExit(final Activity activity, final String message) {
        activity.runOnUiThread(() -> {
            try {
                Toast.makeText(activity, message, Toast.LENGTH_LONG).show();
            } catch (Exception ignored) {}
            // 延迟 2 秒退出，让用户看到提示
            new android.os.Handler(android.os.Looper.getMainLooper()).postDelayed(() -> {
                try {
                    activity.finishAffinity();
                    android.os.Process.killProcess(android.os.Process.myPid());
                } catch (Exception ignored) {}
            }, 2000);
        });
    }
}
