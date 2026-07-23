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

import java.io.BufferedReader;
import java.io.FileReader;
import java.net.Socket;
import java.security.MessageDigest;
import java.util.Arrays;

public class SecurityGuard {

    private static final String TAG = "SecurityGuard";

    // ★ APK 签名校验（防反编译重打包）
    // 留空则跳过校验；填入发布签名的 SHA-256 指纹（小写无冒号）后启用
    // 获取方式：keytool -printcert -jarfile your.apk （取 SHA256: 后的值，去冒号转小写）
    // 由 generate-sign-hash.ps1 自动注入
    private static final String EXPECTED_SIGN_HASH = "e5b2e4b3aac9de292b71e8d3c1643dfa68deb2c2a3ed385e27779a4601b7b54e";

    // ★ 安全检测开关
    private static final boolean ENABLE_ROOT_CHECK = true;
    private static final boolean ENABLE_DEBUGGER_CHECK = true;
    private static final boolean ENABLE_SIGNATURE_CHECK = true;  // 留空时自动跳过
    // P1-A4 新增：模拟器/Frida/Xposed 检测开关
    private static final boolean ENABLE_FRIDA_CHECK = true;
    private static final boolean ENABLE_XPOSED_CHECK = true;
    private static final boolean ENABLE_EMULATOR_CHECK = true;  // 仅记录日志不阻塞

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
        // 4. Frida Hook 框架检测（防动态注入绕过安全检测）
        if (ENABLE_FRIDA_CHECK && isFridaInjected()) {
            Log.w(TAG, "安全检测：检测到 Frida 注入，退出 APP");
            toastAndExit(activity, "检测到 Frida 注入框架，APP 无法运行");
            return;
        }
        // 5. Xposed Hook 框架检测（防方法 hook 绕过逻辑）
        if (ENABLE_XPOSED_CHECK && isXposedInjected()) {
            Log.w(TAG, "安全检测：检测到 Xposed 注入，退出 APP");
            toastAndExit(activity, "检测到 Xposed 注入框架，APP 无法运行");
            return;
        }
        // 6. 模拟器检测（仅记录日志，不阻塞运行，避免误判合法用户）
        if (ENABLE_EMULATOR_CHECK && isEmulator()) {
            Log.w(TAG, "安全检测：检测到运行在模拟器环境（仍允许运行，仅记录日志）");
        }
        Log.d(TAG, "安全检测通过");
    }

    /**
     * Frida 注入检测：
     * 1. 检测默认端口 27042 是否可连接（Frida server 默认监听）
     * 2. 扫描 /proc/self/maps 中是否含 frida-gadget / frida-agent 字符串
     */
    public static boolean isFridaInjected() {
        if (!ENABLE_FRIDA_CHECK) return false;
        // 检测 1：尝试连接默认端口（5ms 超时，不影响启动速度）
        try (Socket socket = new Socket()) {
            socket.connect(new java.net.InetSocketAddress("127.0.0.1", 27042), 5);
            if (socket.isConnected()) {
                Log.w(TAG, "Frida 检测：端口 27042 可连接，疑似 Frida server");
                return true;
            }
        } catch (Exception e) {
            // 端口未开放，正常
        }
        // 检测 2：扫描 /proc/self/maps
        try (BufferedReader reader = new BufferedReader(new FileReader("/proc/self/maps"))) {
            String line;
            while ((line = reader.readLine()) != null) {
                if (line.contains("frida-gadget") || line.contains("frida-agent") ||
                    line.contains("frida-server")) {
                    Log.w(TAG, "Frida 检测：/proc/self/maps 含 frida 特征: " + line.trim());
                    return true;
                }
            }
        } catch (Exception e) {
            // 读取失败，忽略
        }
        return false;
    }

    /**
     * Xposed 注入检测：
     * 1. 检查 de.robv.android.xposed.XposedBridge 类是否已加载
     * 2. 检查堆栈中是否含 Xposed 相关帧
     */
    public static boolean isXposedInjected() {
        if (!ENABLE_XPOSED_CHECK) return false;
        try {
            // 检测 1：尝试加载 XposedBridge 类
            Class.forName("de.robv.android.xposed.XposedBridge");
            Log.w(TAG, "Xposed 检测：de.robv.android.xposed.XposedBridge 类已加载");
            return true;
        } catch (ClassNotFoundException e) {
            // 未加载，正常
        }
        // 检测 2：检查当前堆栈是否含 Xposed 帧
        try {
            StackTraceElement[] stack = Thread.currentThread().getStackTrace();
            for (StackTraceElement elem : stack) {
                if (elem.getClassName().startsWith("de.robv.android.xposed") ||
                    elem.getClassName().contains("xposed")) {
                    Log.w(TAG, "Xposed 检测：堆栈含 Xposed 帧: " + elem.getClassName());
                    return true;
                }
            }
        } catch (Exception e) {
            // 忽略
        }
        return false;
    }

    /**
     * 模拟器检测：检查 Build 系列属性中的模拟器特征
     * 仅记录日志，不阻塞运行（避免误判合法用户）
     */
    public static boolean isEmulator() {
        try {
            if (Build.FINGERPRINT != null) {
                String fp = Build.FINGERPRINT.toLowerCase();
                if (fp.contains("generic") || fp.contains("sdk") ||
                    fp.contains("google_sdk") || fp.contains("goldfish") ||
                    fp.contains("vbox") || fp.contains("ttvm")) {
                    Log.w(TAG, "模拟器检测：Build.FINGERPRINT 含模拟器特征: " + Build.FINGERPRINT);
                    return true;
                }
            }
            if (Build.MODEL != null) {
                String model = Build.MODEL.toLowerCase();
                if (model.contains("google_sdk") || model.contains("emulator") ||
                    model.contains("android sdk built for x86") || model.contains("sdk gphone")) {
                    Log.w(TAG, "模拟器检测：Build.MODEL 含模拟器特征: " + Build.MODEL);
                    return true;
                }
            }
            if (Build.HARDWARE != null) {
                String hw = Build.HARDWARE.toLowerCase();
                if (hw.contains("goldfish") || hw.contains("ranchu") || hw.contains("vbox")) {
                    Log.w(TAG, "模拟器检测：Build.HARDWARE 含模拟器特征: " + Build.HARDWARE);
                    return true;
                }
            }
            if (Build.PRODUCT != null) {
                String prod = Build.PRODUCT.toLowerCase();
                if (prod.contains("sdk") || prod.contains("google_sdk") || prod.contains("vbox")) {
                    Log.w(TAG, "模拟器检测：Build.PRODUCT 含模拟器特征: " + Build.PRODUCT);
                    return true;
                }
            }
            if (Build.MANUFACTURER != null) {
                String mfr = Build.MANUFACTURER.toLowerCase();
                if (mfr.contains("genymotion") || mfr.contains("unknown")) {
                    Log.w(TAG, "模拟器检测：Build.MANUFACTURER 含模拟器特征: " + Build.MANUFACTURER);
                    return true;
                }
            }
        } catch (Exception e) {
            // 检测异常时不阻塞
        }
        return false;
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
     * P1-A5 升级：优先使用 GET_SIGNING_CERTIFICATES（API 28+）支持 v2/v3 签名方案，
     *            旧版本回退到 GET_SIGNATURES（仅支持 v1）
     */
    public static boolean verifyApkSignature(Context context) {
        if (EXPECTED_SIGN_HASH.isEmpty()) {
            // 留空时跳过校验（开发阶段）
            return true;
        }
        try {
            Signature[] signatures = getApkSignatures(context);
            if (signatures == null || signatures.length == 0) {
                Log.w(TAG, "签名校验：未获取到 APK 签名");
                return false;
            }
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            for (Signature sig : signatures) {
                byte[] hash = md.digest(sig.toByteArray());
                StringBuilder sb = new StringBuilder();
                for (byte b : hash) {
                    sb.append(String.format("%02x", b));
                }
                String currentHash = sb.toString();
                if (EXPECTED_SIGN_HASH.equalsIgnoreCase(currentHash)) {
                    return true;
                }
                Log.w(TAG, "签名校验：指纹不匹配 expected=" + EXPECTED_SIGN_HASH +
                        " current=" + currentHash);
            }
            return false;
        } catch (Exception e) {
            Log.e(TAG, "签名校验异常", e);
            return false;
        }
    }

    /**
     * 获取 APK 签名数组
     * API 28+ 使用 GET_SIGNING_CERTIFICATES（支持 v2/v3 签名方案，防篡改更强）
     * API < 28 回退到 GET_SIGNATURES（仅 v1）
     */
    private static Signature[] getApkSignatures(Context context) {
        try {
            PackageManager pm = context.getPackageManager();
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                // API 28+：使用 GET_SIGNING_CERTIFICATES 获取完整签名链
                PackageInfo pi = pm.getPackageInfo(
                        context.getPackageName(), PackageManager.GET_SIGNING_CERTIFICATES);
                if (pi != null && pi.signingInfo != null) {
                    // ★ 修复：原代码 getApkContentsSigners() 调用了2次（重复且无意义）
                    //   正确逻辑：优先取 past signers（历史签名，兼容密钥轮换），
                    //   为空时再取 current signers（当前签名）
                    //   两者都返回签名者数组，任一匹配预期哈希即通过
                    Signature[] sigs = pi.signingInfo.getApkContentsSigners();
                    if (sigs != null && sigs.length > 0) return sigs;
                    // 回退：获取历史签名者（支持 v3 签名密钥轮换场景）
                    sigs = pi.signingInfo.getSigningCertificateHistory();
                    if (sigs != null && sigs.length > 0) return sigs;
                }
            }
            // API < 28：回退到 GET_SIGNATURES（仅支持 v1 签名）
            PackageInfo pi = pm.getPackageInfo(
                    context.getPackageName(), PackageManager.GET_SIGNATURES);
            if (pi != null && pi.signatures != null && pi.signatures.length > 0) {
                return pi.signatures;
            }
        } catch (Exception e) {
            Log.e(TAG, "获取 APK 签名失败", e);
        }
        return null;
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
