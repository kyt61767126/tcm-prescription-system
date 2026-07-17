package com.benneng.pres;

import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.os.Debug;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Enumeration;
import java.util.List;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;

/**
 * SecurityGuard - 统一安全防护（方案二：反调试 + 完整性校验 + 多点签名校验）
 *
 * 防护层级：
 *   1. 反调试检测：JDWP/Frida/Xposed/ptrace 检测
 *   2. APK 完整性校验：classes*.dex 的 SHA-256 比对（防二次打包）
 *   3. 签名校验：首次锁定 + 严格模式双模式
 *   4. 周期性安全巡检：每 30 秒执行一次，防止运行时注入
 *
 * 使用方式（在 MainActivity.onCreate 中）：
 *   SecurityGuard guard = new SecurityGuard(this);
 *   if (!guard.runStartupChecks()) { finishAndRemoveTask(); return; }
 *   guard.startPeriodicChecks();
 *
 * 在 MainActivity.onDestroy 中：
 *   guard.stopPeriodicChecks();
 *
 * 严格模式启用方法：
 *   1. 打包工具运行 generate-sign-hash.bat 生成实际哈希
 *   2. 将 EXPECTED_SIGN_HASH / EXPECTED_DEX_HASH 替换为实际值
 *   3. 重新打包 APK
 *
 * ProGuard 已配置保留此类所有 public 方法，可被反射/JS桥接调用
 */
public class SecurityGuard {

    private static final String TAG = "SecurityGuard";
    private static final String PREFS_NAME = "app_security";

    // ============================================================
    // 严格模式哈希配置（打包时由 generate-sign-hash.bat 自动注入实际值）
    // 留空  = 首次锁定模式（首次运行时锁定当前签名/哈希，后续比对）
    // 填值 = 严格模式（必须与指定哈希完全一致，否则拒绝运行）
    // ============================================================
    private static final String EXPECTED_SIGN_HASH = "";
    private static final String EXPECTED_DEX_HASH = "";

    /** 周期性反调试巡检间隔（毫秒） */
    private static final long CHECK_INTERVAL_MS = 30_000L;

    private final Context context;
    private final Handler handler;
    private Runnable periodicCheckRunnable;
    private volatile boolean terminated = false;

    public SecurityGuard(Context context) {
        // 使用 ApplicationContext 避免持有 Activity 引发内存泄漏
        this.context = context.getApplicationContext();
        this.handler = new Handler(Looper.getMainLooper());
    }

    // ============================================================
    // 启动检查（在 onCreate 中调用）
    // ============================================================
    public boolean runStartupChecks() {
        try {
            if (!verifySignature()) {
                Log.e(TAG, "启动检查失败：签名校验未通过");
                return false;
            }
            if (!verifyIntegrity()) {
                Log.e(TAG, "启动检查失败：完整性校验未通过");
                return false;
            }
            if (isBeingDebugged()) {
                Log.e(TAG, "启动检查失败：检测到调试器");
                return false;
            }
            return true;
        } catch (Throwable t) {
            Log.e(TAG, "启动安全检查异常", t);
            return false;
        }
    }

    // ============================================================
    // 周期性安全巡检（防止运行时 Frida 注入）
    // ============================================================
    public void startPeriodicChecks() {
        if (periodicCheckRunnable != null || terminated) return;
        periodicCheckRunnable = new Runnable() {
            @Override
            public void run() {
                if (terminated) return;
                try {
                    if (isBeingDebugged() || !verifySignature()) {
                        Log.e(TAG, "周期巡检发现安全威胁，触发安全退出");
                        terminated = true;
                        triggerSecurityExit();
                        return;
                    }
                } catch (Throwable t) {
                    Log.e(TAG, "周期巡检异常", t);
                }
                handler.postDelayed(this, CHECK_INTERVAL_MS);
            }
        };
        handler.postDelayed(periodicCheckRunnable, CHECK_INTERVAL_MS);
    }

    public void stopPeriodicChecks() {
        terminated = true;
        if (periodicCheckRunnable != null) {
            handler.removeCallbacks(periodicCheckRunnable);
            periodicCheckRunnable = null;
        }
    }

    /**
     * 安全退出：组合多种退出方式，提高 Hook 绕过难度
     * 不直接调用 System.exit（容易被 Hook），而是先抛 Error 让 ART 自然终止，
     * 再用 Process.killProcess + System.exit 兜底
     */
    private void triggerSecurityExit() {
        try {
            // 异步执行避免阻塞巡检线程
            new Thread(() -> {
                try {
                    android.os.Process.killProcess(android.os.Process.myPid());
                } catch (Throwable ignored) {}
                System.exit(1);
            }, "sec-exit").start();
            // 主线程抛 Error 触发 ART 崩溃
            throw new InternalError("Security check failed");
        } catch (InternalError e) {
            // 兜底
            android.os.Process.killProcess(android.os.Process.myPid());
            System.exit(1);
        }
    }

    // ============================================================
    // 反调试检测（多点：启动 + 周期巡检 + 可被 JS 桥接调用）
    // ============================================================
    public boolean isBeingDebugged() {
        try {
            // 1. JDWP 调试器检测
            if (Debug.isDebuggerConnected()) {
                Log.e(TAG, "JDWP 调试器已连接");
                return true;
            }

            // 2. TracerPid 检测（ptrace 跟踪）
            String tracerPid = readStatusField("TracerPid");
            if (tracerPid != null && !tracerPid.trim().equals("0")) {
                Log.e(TAG, "TracerPid != 0: " + tracerPid);
                return true;
            }

            // 3. Frida 默认端口检测（27042/27043）
            if (isPortOpen("127.0.0.1", 27042, 50)) {
                Log.e(TAG, "Frida 默认端口 27042 开放");
                return true;
            }
            if (isPortOpen("127.0.0.1", 27043, 50)) {
                Log.e(TAG, "Frida 默认端口 27043 开放");
                return true;
            }

            // 4. Frida 内存映射检测
            if (checkMapsForFrida()) {
                Log.e(TAG, "Frida 内存映射检测到");
                return true;
            }

            // 5. Xposed 框架检测
            if (isXposedInstalled()) {
                Log.e(TAG, "Xposed 框架检测到");
                return true;
            }

            return false;
        } catch (Throwable t) {
            Log.e(TAG, "反调试检测异常", t);
            // 异常不视为威胁，避免误杀正常用户
            return false;
        }
    }

    /** 读取 /proc/self/status 中指定字段值 */
    private String readStatusField(String key) {
        BufferedReader reader = null;
        try {
            reader = new BufferedReader(new InputStreamReader(new FileInputStream("/proc/self/status")));
            String line;
            while ((line = reader.readLine()) != null) {
                if (line.startsWith(key + ":")) {
                    int idx = line.indexOf(':');
                    if (idx >= 0 && idx + 1 < line.length()) {
                        return line.substring(idx + 1).trim();
                    }
                }
            }
        } catch (Throwable ignored) {
        } finally {
            if (reader != null) try { reader.close(); } catch (Exception ignored) {}
        }
        return null;
    }

    /** 检测本地端口是否开放（用于 Frida 默认端口探测） */
    private boolean isPortOpen(String host, int port, int timeoutMs) {
        Socket socket = null;
        try {
            socket = new Socket();
            socket.connect(new InetSocketAddress(host, port), timeoutMs);
            return socket.isConnected();
        } catch (Throwable ignored) {
            return false;
        } finally {
            if (socket != null) try { socket.close(); } catch (Exception ignored) {}
        }
    }

    /** 扫描 /proc/self/maps 查找 Frida/gum-js 等注入特征 */
    private boolean checkMapsForFrida() {
        BufferedReader reader = null;
        try {
            reader = new BufferedReader(new InputStreamReader(new FileInputStream("/proc/self/maps")));
            String line;
            while ((line = reader.readLine()) != null) {
                // Frida 常见特征：frida-agent、gum-js-loop、gmain、linjector
                if (line.contains("frida") || line.contains("gum-js") ||
                    line.contains("gmain") || line.contains("linjector")) {
                    return true;
                }
            }
        } catch (Throwable ignored) {
        } finally {
            if (reader != null) try { reader.close(); } catch (Exception ignored) {}
        }
        return false;
    }

    /** 检测 Xposed 框架是否安装 */
    private boolean isXposedInstalled() {
        // 1. 反射加载 XposedBridge 类
        try {
            Class.forName("de.robv.android.xposed.XposedBridge");
            return true;
        } catch (ClassNotFoundException ignored) {
            // 未加载 Xposed
        }
        // 2. 检查 Xposed Installer 包名
        try {
            context.getPackageManager().getApplicationInfo("de.robv.android.xposed.installer", 0);
            return true;
        } catch (PackageManager.NameNotFoundException ignored) {
            // 未安装 Xposed Installer
        }
        // 3. 检查 LSPosed（Xposed 现代分支）
        try {
            context.getPackageManager().getApplicationInfo("org.lsposed.manager", 0);
            return true;
        } catch (PackageManager.NameNotFoundException ignored) {
            // 未安装 LSPosed
        }
        return false;
    }

    // ============================================================
    // APK 完整性校验（防二次打包）
    // ============================================================

    /**
     * 校验 APK 内所有 classes*.dex 的 SHA-256
     * - 严格模式：与 EXPECTED_DEX_HASH 比对
     * - 锁定模式：首次运行存储哈希，后续比对
     */
    public boolean verifyIntegrity() {
        try {
            String currentDexHash = computeDexHash();
            if (currentDexHash == null || currentDexHash.isEmpty()) {
                Log.e(TAG, "无法计算 dex 哈希，可能 APK 路径异常");
                return false;
            }

            SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);

            if (EXPECTED_DEX_HASH == null || EXPECTED_DEX_HASH.isEmpty()) {
                // 锁定模式
                String stored = prefs.getString("dex_sha256", null);
                if (stored == null) {
                    prefs.edit().putString("dex_sha256", currentDexHash).apply();
                    Log.i(TAG, "Dex 哈希首次锁定: " + currentDexHash);
                    return true;
                }
                boolean valid = stored.equals(currentDexHash);
                if (!valid) {
                    Log.e(TAG, "Dex 哈希校验失败！stored=" + stored + " actual=" + currentDexHash);
                }
                return valid;
            } else {
                // 严格模式
                boolean valid = EXPECTED_DEX_HASH.equals(currentDexHash);
                if (!valid) {
                    Log.e(TAG, "Dex 哈希校验失败！expected=" + EXPECTED_DEX_HASH + " actual=" + currentDexHash);
                }
                return valid;
            }
        } catch (Throwable t) {
            Log.e(TAG, "完整性校验异常", t);
            return false;
        }
    }

    /** 计算 APK 内所有 classes*.dex 的串联 SHA-256（按文件名排序确保稳定） */
    private String computeDexHash() {
        ZipFile zip = null;
        try {
            String apkPath = context.getPackageCodePath();
            File apkFile = new File(apkPath);
            if (!apkFile.exists()) return null;

            zip = new ZipFile(apkFile);
            MessageDigest md = MessageDigest.getInstance("SHA-256");

            // 收集所有 dex 文件并排序（保证哈希稳定）
            List<String> dexNames = new ArrayList<>();
            Enumeration<? extends ZipEntry> entries = zip.entries();
            while (entries.hasMoreElements()) {
                String name = entries.nextElement().getName();
                if (name.startsWith("classes") && name.endsWith(".dex")) {
                    dexNames.add(name);
                }
            }
            Collections.sort(dexNames);

            if (dexNames.isEmpty()) {
                Log.w(TAG, "APK 内未找到 dex 文件");
                return null;
            }

            for (String name : dexNames) {
                ZipEntry entry = zip.getEntry(name);
                if (entry == null) continue;
                InputStream is = null;
                try {
                    is = zip.getInputStream(entry);
                    byte[] buffer = new byte[8192];
                    int len;
                    while ((len = is.read(buffer)) > 0) {
                        md.update(buffer, 0, len);
                    }
                    // 分隔符防止拼接歧义
                    md.update((byte) '|');
                } finally {
                    if (is != null) try { is.close(); } catch (Exception ignored) {}
                }
            }

            byte[] hash = md.digest();
            StringBuilder sb = new StringBuilder();
            for (byte b : hash) sb.append(String.format("%02x", b));
            return sb.toString();
        } catch (Throwable t) {
            Log.e(TAG, "计算 dex 哈希失败", t);
            return null;
        } finally {
            if (zip != null) try { zip.close(); } catch (Exception ignored) {}
        }
    }

    // ============================================================
    // 签名校验（多点调用：onCreate + 周期巡检 + WebViewClient.onPageFinished）
    // ============================================================
    public boolean verifySignature() {
        try {
            PackageInfo info = context.getPackageManager().getPackageInfo(
                    context.getPackageName(), PackageManager.GET_SIGNATURES);
            Signature[] signatures = info.signatures;
            if (signatures == null || signatures.length == 0) {
                Log.e(TAG, "未获取到签名信息");
                return false;
            }

            String currentHash = sha256(signatures[0].toByteArray());

            if (EXPECTED_SIGN_HASH == null || EXPECTED_SIGN_HASH.isEmpty()) {
                // 首次锁定模式
                SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
                String stored = prefs.getString("sign_sha256", null);
                if (stored == null) {
                    prefs.edit().putString("sign_sha256", currentHash).apply();
                    Log.i(TAG, "签名首次锁定: " + currentHash);
                    return true;
                }
                boolean valid = stored.equals(currentHash);
                if (!valid) {
                    Log.e(TAG, "签名校验失败！可能被二次打包");
                }
                return valid;
            } else {
                // 严格模式
                boolean valid = EXPECTED_SIGN_HASH.equals(currentHash);
                if (!valid) {
                    Log.e(TAG, "签名校验失败！expected=" + EXPECTED_SIGN_HASH + " actual=" + currentHash);
                }
                return valid;
            }
        } catch (Throwable t) {
            Log.e(TAG, "签名校验异常", t);
            return false;
        }
    }

    private String sha256(byte[] data) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] hash = md.digest(data);
            StringBuilder sb = new StringBuilder();
            for (byte b : hash) sb.append(String.format("%02x", b));
            return sb.toString();
        } catch (NoSuchAlgorithmException e) {
            return "";
        }
    }
}
