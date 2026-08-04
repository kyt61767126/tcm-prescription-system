package com.benneng.pres;

// ============================================================================
//  LicenseManager — APP 端授权管理（与桌面版 license-manager.js v2 一致）
//  功能：
//   - license.dat 校验（HMAC-SHA256 签名，v2 含 maxPrescriptions/features）
//   - 试用模式（7 天，AES-256-CBC 加密存储）
//   - 防时间回拨
//   - 在线激活（HTTP POST 云端 /api/license/validate）
//   - 处方计数（按月统计，AES-256-CBC 加密）
//   - 机器 ID 生成（SHA256(androidId + package + version + model).substring(0,32)）
//  安全：签名验证在 Java 层，攻击者难以通过修改 JS 绕过
//  P2 优化：trial.dat / last-run.dat / prescription-count.dat 从 XOR 升级为
//          AES-256-CBC 加密，不同文件使用不同盐派生密钥（防一文件破解后全失守）
//          向后兼容：读取时若为旧 XOR 格式自动解密并迁移为 AES 格式
// ============================================================================

import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.os.Build;
import android.provider.Settings;
import android.util.Base64;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.FileReader;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.PublicKey;
import java.security.Signature;
import java.security.spec.X509EncodedKeySpec;
import java.util.Arrays;
import java.util.Iterator;
import javax.crypto.Cipher;
import javax.crypto.Mac;
import javax.crypto.spec.IvParameterSpec;
import javax.crypto.spec.SecretKeySpec;

public class LicenseManager {

    private static final String TAG = "LicenseManager";

    // ★ HMAC 密钥（与桌面版 license-manager.js / 云端 license-core.js 完全一致）
    private static final String LICENSE_HMAC_KEY = "bnzc_tcm_license_key_v1_2026";

    // ★ v5 新增：ECDSA P-256 验签公钥（PEM SPKI 格式，与桌面版 license-manager.js 一致）
    // 用于验证 license 中 signatureV5 字段（云端 ECDSA 私钥签发）
    // 公钥只能验签不能签发，即使被反编译提取也无法伪造 license
    private static final String ECDSA_VERIFY_PUBLIC_KEY_PEM =
            "-----BEGIN PUBLIC KEY-----\n" +
            "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEXqspDCFxlyS9wH0Kyb/fR9sqOeAG\n" +
            "DurLP5B6cwCvAhMF8Lvlzv9nnvdEWdY0+GytTCUsXWrBbDDgLrOufN1NNw==\n" +
            "-----END PUBLIC KEY-----";

    // ★ v3 新增：config.json 完整性签名密钥（与桌面版 license-manager.js / edit-config.ps1 完全一致）
    private static final String CONFIG_SIGN_KEY = "bnzc_config_sign_key_v1_2026";

    // ============================================================================
    //  ★ P1-3 新增：masterKey 派生密钥机制（与桌面版 license-manager.js / 云端 license-core.js 对齐）
    //  设计：
    //    - license.dat 中可能包含 masterKey 字段（云端 LICENSE_MASTER_KEY 配置后下发）
    //    - 若 license 含 masterKey，则从 masterKey 派生 HMAC/CONFIG_SIGN 密钥
    //    - 若不含 masterKey（旧版 license），fallback 到硬编码密钥（向后兼容）
    //  派生算法（与云端 license-core.js 保持一致）：
    //    effectiveHmacKey      = SHA256(masterKey + ':license-hmac:v1')
    //    effectiveConfigSignKey = SHA256(masterKey + ':config-sign:v1')
    //  使用：
    //    verifySignature 开头调用 setLicenseDataContext(data) 缓存当前 license
    //    随后所有签名校验/加密派生均使用 getEffectiveHmacKey() / getEffectiveConfigSignKey()
    // ============================================================================
    private JSONObject _currentLicenseData = null;

    private void setLicenseDataContext(JSONObject data) {
        _currentLicenseData = (data != null) ? data : null;
    }

    private String getLicenseMasterKey() {
        if (_currentLicenseData != null) {
            return _currentLicenseData.optString("masterKey", "");
        }
        return "";
    }

    private String getEffectiveHmacKey() {
        String mk = getLicenseMasterKey();
        if (mk != null && !mk.isEmpty()) {
            return sha256Hex(mk + ":license-hmac:v1");
        }
        return LICENSE_HMAC_KEY;
    }

    private String getEffectiveConfigSignKey() {
        String mk = getLicenseMasterKey();
        if (mk != null && !mk.isEmpty()) {
            return sha256Hex(mk + ":config-sign:v1");
        }
        return CONFIG_SIGN_KEY;
    }

    private String sha256Hex(String input) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] hash = md.digest(input.getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder();
            for (byte b : hash) {
                sb.append(String.format("%02x", b));
            }
            return sb.toString();
        } catch (Exception e) {
            Log.e(TAG, "SHA-256 计算失败", e);
            return "";
        }
    }

    // ★ P1-A 新增：license 文件加密格式标识和算法
    private static final String LICENSE_ENC_PREFIX = "ENC1:";  // 旧加密格式前缀（向后兼容）
    // ★ P3-C 新增：license 文件新格式前缀（含 HMAC 校验）
    private static final String LICENSE_ENC2_PREFIX = "ENC2:";
    private static final String AES_ALGORITHM = "AES/CBC/PKCS5Padding";

    // ★ P2 新增：trial / last-run / count 文件加密格式标识
    // 不同文件使用不同前缀和不同盐派生密钥（防一文件破解后全失守）
    private static final String TRIAL_ENC_PREFIX = "TRIAL1:";
    private static final String LASTRUN_ENC_PREFIX = "LASTRUN1:";
    private static final String COUNT_ENC_PREFIX = "COUNT1:";

    // 试用与时间回拨配置（与桌面版一致）
    private static final int DEFAULT_TRIAL_DAYS = 7;  // 默认试用期 7 天（可通过 SharedPreferences 修改，测试时设为 0）
    private static final long TIME_TAMPER_THRESHOLD = 24L * 60 * 60 * 1000; // 1 天

    // ★ 试用期配置存储（SharedPreferences，与桌面版 trial-config.json 对应）
    private static final String PREF_NAME = "license_config";
    private static final String PREF_KEY_TRIAL_DAYS = "trial_days";

    // ★ 激活码失败限速配置（防暴力尝试）
    private static final String PREF_KEY_ACTIVATE_FAIL_COUNT = "activate_fail_count";
    private static final String PREF_KEY_ACTIVATE_FIRST_FAIL_TIME = "activate_first_fail_time";
    private static final int ACTIVATE_FAIL_THRESHOLD = 5;        // 5 次失败后进入冷却
    private static final long ACTIVATE_COOLDOWN_MS = 5L * 60 * 1000;  // 冷却 5 分钟

    // ★ P1-9 代码完整性校验：检测关键 JS 文件是否被篡改
    private static final String PREF_KEY_JS_INTEGRITY_HASH = "js_integrity_baseline";

    // ★ APK 签名校验（防反编译重打包）
    // 留空则不校验；填入发布签名的 SHA-256 指纹（小写无冒号）后启用
    // 获取方式：keytool -printcert -jarfile your.apk （取 SHA256: 后的值，去冒号转小写）
private static final String EXPECTED_APK_SIGNATURE_SHA256 = "e5b2e4b3aac9de292b71e8d3c1643dfa68deb2c2a3ed385e27779a4601b7b54e";

    // ★ 安全检测开关（root/debugger 检测）
    private static final boolean ENABLE_ROOT_CHECK = true;
    private static final boolean ENABLE_DEBUGGER_CHECK = true;

    // XOR 混淆密钥
    private static final String TRIAL_KEY = "bnzc_trial_key_v1";
    private static final String LASTRUN_KEY = "bnzc_lastrun_key_v1";
    private static final String COUNT_KEY = "bnzc_prescription_count_v1";

    // 文件名
    private static final String LICENSE_FILE = "license.dat";
    private static final String TRIAL_FILE = "trial.dat";
    private static final String LASTRUN_FILE = "last-run.dat";
    private static final String COUNT_FILE = "prescription-count.dat";
    // ★ P1-1 在线授权验证状态文件（独立于license.dat，不影响签名）
    private static final String VERIFY_STATE_FILE = "verify-state.dat";
    private static final String VERIFY_STATE_KEY = "bnzc_verify_state_v1";
    // ★ P1-2 激活码水印记录文件（追溯盗版泄露源）
    private static final String ACTIVATION_RECORD_FILE = "activation-record.dat";
    private static final String ACTIVATION_RECORD_KEY = "bnzc_activation_v1";

    // 云端激活 API
    private static final String ACTIVATE_API_URL = "https://tcm-prescription-system.pages.dev/api/license/validate";
    // ★ P1-1 在线验证 API（定期校验授权有效性）
    private static final String VERIFY_API_URL = "https://tcm-prescription-system.pages.dev/api/license/verify";
    private static final int ACTIVATE_TIMEOUT_MS = 15000;

    // ★ P1-1 在线验证阈值
    private static final long ONLINE_VERIFY_PROMPT_DAYS = 7;      // 超过7天提示验证
    private static final int ONLINE_VERIFY_PROMPT_PRESCRIPTIONS = 30; // 且超过30张处方
    private static final long ONLINE_VERIFY_DOWNGRADE_DAYS = 90;  // 超过90天降级试用

    // 版本类型默认配置（与桌面版 LICENSE_TYPE_CONFIG 一致）
    private static final int TRIAL_MAX_PRESCRIPTIONS = 30;
    private static final int PERSONAL_MAX_PRESCRIPTIONS = 0; // 0 = 无限
    private static final int PRO_MAX_PRESCRIPTIONS = 0;

    private final Context context;
    private final String packageName;
    private final String versionName;

    public LicenseManager(Context context) {
        this.context = context;
        this.packageName = context.getPackageName();
        String version = "1.0";
        try {
            PackageInfo pi = context.getPackageManager().getPackageInfo(packageName, 0);
            if (pi != null && pi.versionName != null) version = pi.versionName;
        } catch (PackageManager.NameNotFoundException e) {
            Log.w(TAG, "无法获取版本号，使用默认 1.0");
        }
        this.versionName = version;
    }

    // ========================================================================
    //  机器 ID 生成（与桌面版公式一致：SHA256(特征串).substring(0, 32)）
    //  桌面版：SHA256(exePath + hostname + username + platform)
    //  APP 端：SHA256(androidId + packageName + versionName + Build.MODEL)
    // ========================================================================
    public String getMachineId() {
        try {
            String androidId = Settings.Secure.getString(
                    context.getContentResolver(), Settings.Secure.ANDROID_ID);
            if (androidId == null) androidId = "";
            String model = Build.MODEL != null ? Build.MODEL : "";
            String manufacturer = Build.MANUFACTURER != null ? Build.MANUFACTURER : "";
            String src = androidId + "|" + packageName + "|" + versionName + "|" + manufacturer + "|" + model;
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] hash = md.digest(src.getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder();
            for (byte b : hash) {
                sb.append(String.format("%02x", b));
            }
            return sb.substring(0, 32);
        } catch (Exception e) {
            Log.e(TAG, "生成机器 ID 失败", e);
            // 失败时返回固定的回退 ID（避免完全无法激活）
            return "fallback_" + packageName.hashCode() + "_" + versionName.hashCode();
        }
    }

    // ========================================================================
    //  ★ 安全检测：Root 检测（防 root 设备篡改 license）
    // ========================================================================
    public boolean isRooted() {
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
            java.util.List<android.content.pm.PackageInfo> pkgs =
                    context.getPackageManager().getInstalledPackages(0);
            for (android.content.pm.PackageInfo pi : pkgs) {
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

    // ========================================================================
    //  ★ 安全检测：调试器检测（防 hook/调试绕过 license）
    // ========================================================================
    public boolean isDebuggerAttached() {
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

    // ========================================================================
    //  ★ P3-B 新增：模拟器检测（防 VM/Sandbox 分析）
    //  策略：检测 Build 系列属性中的模拟器特征（generic/sdk/goldfish/google_sdk 等）
    //  返回：true 表示检测到模拟器（仅记录日志，不阻塞运行，避免误判）
    //  ★ 重要：仅在 release 版启用，debug 模式跳过；只记录日志不阻塞运行
    // ========================================================================
    public boolean isEmulator() {
        try {
            // Build.FINGERPRINT 含 generic/sdk/google_sdk 等模拟器标志
            if (Build.FINGERPRINT != null) {
                String fp = Build.FINGERPRINT.toLowerCase();
                if (fp.contains("generic") || fp.contains("sdk") ||
                    fp.contains("google_sdk") || fp.contains("goldfish") ||
                    fp.contains("vbox") || fp.contains("ttvm")) {
                    Log.w(TAG, "模拟器检测：Build.FINGERPRINT 含模拟器特征: " + Build.FINGERPRINT);
                    return true;
                }
            }
            // Build.MODEL 含 sdk/google_sdk/Android SDK built for x86 等
            if (Build.MODEL != null) {
                String model = Build.MODEL.toLowerCase();
                if (model.contains("google_sdk") || model.contains("emulator") ||
                    model.contains("android sdk built for x86") || model.contains("sdk gphone")) {
                    Log.w(TAG, "模拟器检测：Build.MODEL 含模拟器特征: " + Build.MODEL);
                    return true;
                }
            }
            // Build.HARDWARE 含 goldfish/ranchu（Android 模拟器常用）
            if (Build.HARDWARE != null) {
                String hw = Build.HARDWARE.toLowerCase();
                if (hw.contains("goldfish") || hw.contains("ranchu") || hw.contains("vbox")) {
                    Log.w(TAG, "模拟器检测：Build.HARDWARE 含模拟器特征: " + Build.HARDWARE);
                    return true;
                }
            }
            // Build.PRODUCT 含 sdk/google_sdk/sdk_x86 等
            if (Build.PRODUCT != null) {
                String prod = Build.PRODUCT.toLowerCase();
                if (prod.contains("sdk") || prod.contains("google_sdk") || prod.contains("vbox")) {
                    Log.w(TAG, "模拟器检测：Build.PRODUCT 含模拟器特征: " + Build.PRODUCT);
                    return true;
                }
            }
            // Build.BRAND 含 generic/google
            if (Build.BRAND != null) {
                String brand = Build.BRAND.toLowerCase();
                if (brand.contains("generic")) {
                    Log.w(TAG, "模拟器检测：Build.BRAND=generic");
                    return true;
                }
            }
            // Build.MANUFACTURER 含 Genymotion/google
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

    // ========================================================================
    //  ★ P1-A4 新增：Frida 注入检测（防动态 hook 绕过 license 校验）
    //  策略：
    //   1. 检测默认端口 27042 是否可连接（Frida server 默认监听）
    //   2. 扫描 /proc/self/maps 中是否含 frida-gadget / frida-agent 字符串
    //  返回：true 表示检测到 Frida（阻塞运行）
    // ========================================================================
    public boolean isFridaInjected() {
        // 检测 1：尝试连接默认端口（5ms 超时，不影响启动速度）
        try (Socket socket = new Socket()) {
            socket.connect(new InetSocketAddress("127.0.0.1", 27042), 5);
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

    // ========================================================================
    //  ★ P1-A4 新增：Xposed 注入检测（防方法 hook 绕过 license 校验）
    //  策略：
    //   1. 检查 de.robv.android.xposed.XposedBridge 类是否已加载
    //   2. 检查堆栈中是否含 Xposed 相关帧
    //  返回：true 表示检测到 Xposed（阻塞运行）
    // ========================================================================
    public boolean isXposedInjected() {
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
     * 反射读取 Android 系统属性（替代隐藏 API android.os.SystemProperties）
     * @param key 属性名
     * @param def 默认值
     * @return 属性值；反射失败返回 def
     */
    private String getSystemProperty(String key, String def) {
        try {
            Class<?> cls = Class.forName("android.os.SystemProperties");
            java.lang.reflect.Method m = cls.getMethod("get", String.class, String.class);
            Object val = m.invoke(null, key, def);
            return val != null ? val.toString() : def;
        } catch (Exception e) {
            return def;
        }
    }

    // ========================================================================
    //  ★ 安全检测：APK 签名校验（防反编译重打包）
    //  P1-A5 升级：优先使用 GET_SIGNING_CERTIFICATES（API 28+）支持 v2/v3 签名方案，
    //             旧版本回退到 GET_SIGNATURES（仅支持 v1）
    // ========================================================================
    public boolean verifyApkSignature() {
        if (EXPECTED_APK_SIGNATURE_SHA256 == null || EXPECTED_APK_SIGNATURE_SHA256.isEmpty()) {
            // 未配置预期签名，跳过校验（开发阶段）
            return true;
        }
        try {
            android.content.pm.Signature[] signatures = getApkSignatures();
            if (signatures == null || signatures.length == 0) {
                Log.e(TAG, "APK 签名校验：未找到签名");
                return false;
            }
            for (android.content.pm.Signature sig : signatures) {
                MessageDigest md = MessageDigest.getInstance("SHA-256");
                byte[] digest = md.digest(sig.toByteArray());
                StringBuilder sb = new StringBuilder();
                for (byte b : digest) {
                    sb.append(String.format("%02x", b));
                }
                String fingerprint = sb.toString();
                if (EXPECTED_APK_SIGNATURE_SHA256.equalsIgnoreCase(fingerprint)) {
                    return true;
                }
                Log.e(TAG, "APK 签名校验：指纹不匹配 expected=" + EXPECTED_APK_SIGNATURE_SHA256 +
                        " actual=" + fingerprint);
            }
            return false;
        } catch (Exception e) {
            Log.e(TAG, "APK 签名校验异常", e);
            return false;
        }
    }

    /**
     * 获取 APK 签名数组
     * API 28+ 使用 GET_SIGNING_CERTIFICATES（支持 v2/v3 签名方案，防篡改更强）
     * API < 28 回退到 GET_SIGNATURES（仅 v1）
     */
    private android.content.pm.Signature[] getApkSignatures() {
        try {
            android.content.pm.PackageManager pm = context.getPackageManager();
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                // API 28+：使用 GET_SIGNING_CERTIFICATES 获取完整签名链
                android.content.pm.PackageInfo pi = pm.getPackageInfo(
                        packageName, android.content.pm.PackageManager.GET_SIGNING_CERTIFICATES);
                if (pi != null && pi.signingInfo != null) {
                    android.content.pm.Signature[] sigs = pi.signingInfo.getApkContentsSigners();
                    if (sigs != null && sigs.length > 0) return sigs;
                }
            }
            // API < 28：回退到 GET_SIGNATURES（仅支持 v1 签名）
            android.content.pm.PackageInfo pi = pm.getPackageInfo(
                    packageName, android.content.pm.PackageManager.GET_SIGNATURES);
            if (pi != null && pi.signatures != null && pi.signatures.length > 0) {
                return pi.signatures;
            }
        } catch (Exception e) {
            Log.e(TAG, "获取 APK 签名失败", e);
        }
        return null;
    }

    // ========================================================================
    //  ★ P1-A 新增：AES-256-CBC 加密（用于 license.dat 存储加密）
    //  方案：密钥从 machineId 派生，不同机器无法解密
    //  文件格式：ENC1:base64(iv(16) + ciphertext)
    //  旧格式：base64(JSON)（向后兼容，读取后自动迁移为加密格式）
    //  ★ P3-A 增强：密钥派生追加硬件指纹（Build.FINGERPRINT + DISPLAY + ID）
    //              防止通过克隆虚拟机/复制镜像绕过 machineId 校验
    //              旧 license.dat 仍可用（解密时双密钥尝试，新密钥失败回退旧密钥）
    // ========================================================================

    // ★ P3-A 新增：获取硬件指纹（Build 系列属性，缓存结果）
    // Build.FINGERPRINT：系统指纹，含品牌/型号/版本（同一型号设备相同，但模拟器会暴露）
    // Build.DISPLAY：系统显示版本号
    // Build.ID：系统版本 ID
    // 全部失败时返回空字符串（密钥派生降级为不含硬件指纹，兼容旧版）
    private String _hardwareFingerprintCache = null;
    private String getHardwareFingerprint() {
        if (_hardwareFingerprintCache != null) return _hardwareFingerprintCache;
        try {
            StringBuilder sb = new StringBuilder();
            if (Build.FINGERPRINT != null && !Build.FINGERPRINT.isEmpty()) {
                sb.append("fp=").append(Build.FINGERPRINT);
            }
            if (Build.DISPLAY != null && !Build.DISPLAY.isEmpty()) {
                if (sb.length() > 0) sb.append("|");
                sb.append("dp=").append(Build.DISPLAY);
            }
            if (Build.ID != null && !Build.ID.isEmpty()) {
                if (sb.length() > 0) sb.append("|");
                sb.append("id=").append(Build.ID);
            }
            // Build.SERIAL 在 Android 8.0+ 需要 READ_PHONE_STATE 权限，不使用
            if (sb.length() == 0) {
                _hardwareFingerprintCache = "";
            } else {
                MessageDigest md = MessageDigest.getInstance("SHA-256");
                byte[] hash = md.digest(sb.toString().getBytes(StandardCharsets.UTF_8));
                StringBuilder hex = new StringBuilder();
                for (byte b : hash) hex.append(String.format("%02x", b));
                _hardwareFingerprintCache = hex.toString();
            }
        } catch (Exception e) {
            _hardwareFingerprintCache = "";
        }
        return _hardwareFingerprintCache;
    }

    // ★ P3-A 新增：派生 AES-256 密钥（含硬件指纹）
    // 新密钥 = SHA256(machineId + hardwareFingerprint + LICENSE_HMAC_KEY)
    private SecretKeySpec deriveLicenseKey(String machineId) {
        try {
            String hwFp = getHardwareFingerprint();
            String combined = (machineId == null ? "" : machineId) + (hwFp == null ? "" : hwFp) + LICENSE_HMAC_KEY;
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] keyBytes = md.digest(combined.getBytes(StandardCharsets.UTF_8));
            return new SecretKeySpec(keyBytes, "AES");
        } catch (Exception e) {
            Log.e(TAG, "派生 license 密钥失败: " + e.getMessage());
            return null;
        }
    }

    // ★ P3-A 新增：旧密钥派生（不含硬件指纹，向后兼容旧 license.dat）
    private SecretKeySpec deriveLicenseKeyLegacy(String machineId) {
        try {
            String combined = (machineId == null ? "" : machineId) + LICENSE_HMAC_KEY;
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] keyBytes = md.digest(combined.getBytes(StandardCharsets.UTF_8));
            return new SecretKeySpec(keyBytes, "AES");
        } catch (Exception e) {
            return null;
        }
    }

    // ★ P3-C 新增：派生 license HMAC 密钥（含硬件指纹）
    private SecretKeySpec deriveLicenseHmacKey(String machineId) {
        try {
            String hwFp = getHardwareFingerprint();
            String combined = (machineId == null ? "" : machineId) + (hwFp == null ? "" : hwFp) + LICENSE_HMAC_KEY + ":hmac";
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            return new SecretKeySpec(md.digest(combined.getBytes(StandardCharsets.UTF_8)), "HmacSHA256");
        } catch (Exception e) {
            return null;
        }
    }

    // ★ P3-C 新增：旧 HMAC 密钥派生（不含硬件指纹，向后兼容）
    private SecretKeySpec deriveLicenseHmacKeyLegacy(String machineId) {
        try {
            String combined = (machineId == null ? "" : machineId) + LICENSE_HMAC_KEY + ":hmac";
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            return new SecretKeySpec(md.digest(combined.getBytes(StandardCharsets.UTF_8)), "HmacSHA256");
        } catch (Exception e) {
            return null;
        }
    }

    // 加密 license JSON 字符串
    // ★ P3-C 新增：加密后追加外层 HMAC 签名，文件格式 ENC2:hex(hmac):base64(iv+ciphertext)
    private String encryptLicenseContent(String jsonStr, String machineId) {
        try {
            SecretKeySpec key = deriveLicenseKey(machineId);
            if (key == null) return null;

            // 生成随机 IV（16 字节）
            byte[] iv = new byte[16];
            java.security.SecureRandom random = new java.security.SecureRandom();
            random.nextBytes(iv);

            Cipher cipher = Cipher.getInstance(AES_ALGORITHM);
            cipher.init(Cipher.ENCRYPT_MODE, key, new IvParameterSpec(iv));
            byte[] ciphertext = cipher.doFinal(jsonStr.getBytes(StandardCharsets.UTF_8));

            // 拼接 iv + ciphertext，Base64 编码
            byte[] combined = new byte[iv.length + ciphertext.length];
            System.arraycopy(iv, 0, combined, 0, iv.length);
            System.arraycopy(ciphertext, 0, combined, iv.length, ciphertext.length);
            String payload = Base64.encodeToString(combined, Base64.NO_WRAP);

            // ★ P3-C 新增：计算外层 HMAC（基于 machineId + 硬件指纹 + 密文）
            SecretKeySpec hmacKey = deriveLicenseHmacKey(machineId);
            if (hmacKey == null) return null;
            javax.crypto.Mac mac = javax.crypto.Mac.getInstance("HmacSHA256");
            mac.init(hmacKey);
            byte[] hmacBytes = mac.doFinal(payload.getBytes(StandardCharsets.UTF_8));
            StringBuilder hex = new StringBuilder();
            for (byte b : hmacBytes) hex.append(String.format("%02x", b));

            return LICENSE_ENC2_PREFIX + hex.toString() + ":" + payload;
        } catch (Exception e) {
            Log.e(TAG, "加密 license 失败: " + e.getMessage());
            return null;
        }
    }

    // 解密 license 字符串（返回 JSON 字符串，失败返回 null）
    // ★ P3-C 新增：优先 ENC2 格式（含 HMAC 校验），回退 ENC1 格式（向后兼容）
    // ★ P3-A 新增：双密钥尝试 - 优先新密钥（含硬件指纹），失败回退旧密钥
    private String decryptLicenseContent(String encryptedStr, String machineId) {
        if (encryptedStr == null) return null;
        // ★ P3-C 新增：优先尝试 ENC2 格式（含 HMAC 校验）
        if (encryptedStr.startsWith(LICENSE_ENC2_PREFIX)) {
            String rest = encryptedStr.substring(LICENSE_ENC2_PREFIX.length());
            int sep = rest.indexOf(':');
            if (sep < 0) return null;
            String storedHmac = rest.substring(0, sep);
            String base64Data = rest.substring(sep + 1);
            // 优先用新密钥校验 HMAC
            boolean hmacMatched = verifyHmac(storedHmac, base64Data, deriveLicenseHmacKey(machineId));
            // 旧 HMAC 密钥（不含硬件指纹，向后兼容）
            if (!hmacMatched) {
                hmacMatched = verifyHmac(storedHmac, base64Data, deriveLicenseHmacKeyLegacy(machineId));
            }
            if (!hmacMatched) {
                Log.e(TAG, "HMAC 校验失败（文件可能被替换/篡改）");
                return null;
            }
            // HMAC 校验通过，解密内容（双密钥尝试）
            String plaintext = tryDecryptAes(base64Data, deriveLicenseKey(machineId));
            if (plaintext != null) return plaintext;
            return tryDecryptAes(base64Data, deriveLicenseKeyLegacy(machineId));
        }
        // 旧 ENC1 格式 - 向后兼容
        if (encryptedStr.startsWith(LICENSE_ENC_PREFIX)) {
            String base64Data = encryptedStr.substring(LICENSE_ENC_PREFIX.length());
            // 优先尝试新密钥（含硬件指纹）
            String plaintext = tryDecryptAes(base64Data, deriveLicenseKey(machineId));
            if (plaintext != null) return plaintext;
            return tryDecryptAes(base64Data, deriveLicenseKeyLegacy(machineId));
        }
        return null;
    }

    // ★ P3-C 新增：HMAC 校验工具（常量时间比较，防时序攻击）
    private boolean verifyHmac(String storedHmacHex, String payload, SecretKeySpec hmacKey) {
        if (hmacKey == null || storedHmacHex == null) return false;
        try {
            javax.crypto.Mac mac = javax.crypto.Mac.getInstance("HmacSHA256");
            mac.init(hmacKey);
            byte[] expected = mac.doFinal(payload.getBytes(StandardCharsets.UTF_8));
            StringBuilder hex = new StringBuilder();
            for (byte b : expected) hex.append(String.format("%02x", b));
            // 常量时间比较（防时序攻击）
            if (hex.length() != storedHmacHex.length()) return false;
            int diff = 0;
            for (int i = 0; i < hex.length(); i++) {
                diff |= hex.charAt(i) ^ storedHmacHex.charAt(i);
            }
            return diff == 0;
        } catch (Exception e) {
            return false;
        }
    }

    // ★ P3-A 新增：通用 AES 解密尝试（用于双密钥回退）
    private String tryDecryptAes(String base64Data, SecretKeySpec key) {
        if (key == null) return null;
        try {
            byte[] data = Base64.decode(base64Data, Base64.DEFAULT);
            if (data == null || data.length < 32) return null;
            byte[] iv = new byte[16];
            byte[] ciphertext = new byte[data.length - 16];
            System.arraycopy(data, 0, iv, 0, 16);
            System.arraycopy(data, 16, ciphertext, 0, ciphertext.length);
            Cipher cipher = Cipher.getInstance(AES_ALGORITHM);
            cipher.init(Cipher.DECRYPT_MODE, key, new IvParameterSpec(iv));
            byte[] plaintext = cipher.doFinal(ciphertext);
            return new String(plaintext, StandardCharsets.UTF_8);
        } catch (Exception e) {
            return null;
        }
    }

    // ========================================================================
    //  ★ P2 新增：trial.dat / last-run.dat / prescription-count.dat AES-256-CBC 加密
    //  方案：与 license.dat 一致使用 AES-256-CBC，但派生不同密钥（不同盐）
    //       防止 license.dat 密钥被破解后 trial / last-run / count 同时失守
    //  文件格式：TRIAL1:/LASTRUN1:/COUNT1: + base64(iv(16) + ciphertext)
    //  旧格式：Base64(XOR(plaintext, key))（向后兼容，读取后自动迁移为 AES 格式）
    // ========================================================================

    // ★ P3-A 新增：派生 trial 加密密钥（含硬件指纹）
    private SecretKeySpec deriveTrialKey(String machineId) {
        try {
            String hwFp = getHardwareFingerprint();
            String combined = (machineId == null ? "" : machineId) + (hwFp == null ? "" : hwFp) + LICENSE_HMAC_KEY + ":trial";
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            return new SecretKeySpec(md.digest(combined.getBytes(StandardCharsets.UTF_8)), "AES");
        } catch (Exception e) {
            Log.e(TAG, "派生 trial 密钥失败: " + e.getMessage());
            return null;
        }
    }

    // ★ P3-A 新增：旧 trial 密钥派生（不含硬件指纹，向后兼容）
    private SecretKeySpec deriveTrialKeyLegacy(String machineId) {
        try {
            String combined = (machineId == null ? "" : machineId) + LICENSE_HMAC_KEY + ":trial";
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            return new SecretKeySpec(md.digest(combined.getBytes(StandardCharsets.UTF_8)), "AES");
        } catch (Exception e) {
            return null;
        }
    }

    // ★ P3-A 新增：派生 last-run 加密密钥（含硬件指纹）
    private SecretKeySpec deriveLastRunKey(String machineId) {
        try {
            String hwFp = getHardwareFingerprint();
            String combined = (machineId == null ? "" : machineId) + (hwFp == null ? "" : hwFp) + LICENSE_HMAC_KEY + ":lastrun";
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            return new SecretKeySpec(md.digest(combined.getBytes(StandardCharsets.UTF_8)), "AES");
        } catch (Exception e) {
            Log.e(TAG, "派生 last-run 密钥失败: " + e.getMessage());
            return null;
        }
    }

    // ★ P3-A 新增：旧 last-run 密钥派生（不含硬件指纹，向后兼容）
    private SecretKeySpec deriveLastRunKeyLegacy(String machineId) {
        try {
            String combined = (machineId == null ? "" : machineId) + LICENSE_HMAC_KEY + ":lastrun";
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            return new SecretKeySpec(md.digest(combined.getBytes(StandardCharsets.UTF_8)), "AES");
        } catch (Exception e) {
            return null;
        }
    }

    // ★ P3-A 新增：派生 count 加密密钥（含硬件指纹）
    private SecretKeySpec deriveCountKey(String machineId) {
        try {
            String hwFp = getHardwareFingerprint();
            String combined = (machineId == null ? "" : machineId) + (hwFp == null ? "" : hwFp) + LICENSE_HMAC_KEY + ":count";
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            return new SecretKeySpec(md.digest(combined.getBytes(StandardCharsets.UTF_8)), "AES");
        } catch (Exception e) {
            Log.e(TAG, "派生 count 密钥失败: " + e.getMessage());
            return null;
        }
    }

    // ★ P3-A 新增：旧 count 密钥派生（不含硬件指纹，向后兼容）
    private SecretKeySpec deriveCountKeyLegacy(String machineId) {
        try {
            String combined = (machineId == null ? "" : machineId) + LICENSE_HMAC_KEY + ":count";
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            return new SecretKeySpec(md.digest(combined.getBytes(StandardCharsets.UTF_8)), "AES");
        } catch (Exception e) {
            return null;
        }
    }

    // 通用 AES 加密：返回 PREFIX + base64(iv + ciphertext)
    private String aesEncrypt(String jsonStr, SecretKeySpec key, String prefix) {
        try {
            if (key == null) return null;
            byte[] iv = new byte[16];
            new java.security.SecureRandom().nextBytes(iv);
            Cipher cipher = Cipher.getInstance(AES_ALGORITHM);
            cipher.init(Cipher.ENCRYPT_MODE, key, new IvParameterSpec(iv));
            byte[] ciphertext = cipher.doFinal(jsonStr.getBytes(StandardCharsets.UTF_8));
            byte[] combined = new byte[iv.length + ciphertext.length];
            System.arraycopy(iv, 0, combined, 0, iv.length);
            System.arraycopy(ciphertext, 0, combined, iv.length, ciphertext.length);
            return prefix + Base64.encodeToString(combined, Base64.NO_WRAP);
        } catch (Exception e) {
            Log.e(TAG, "AES 加密失败: " + e.getMessage());
            return null;
        }
    }

    // 通用 AES 解密：返回 JSON 字符串，失败返回 null
    private String aesDecrypt(String encryptedStr, SecretKeySpec key, String prefix) {
        if (encryptedStr == null || !encryptedStr.startsWith(prefix)) return null;
        try {
            String base64Data = encryptedStr.substring(prefix.length());
            byte[] data = Base64.decode(base64Data, Base64.DEFAULT);
            if (data == null || data.length < 32) return null;
            if (key == null) return null;
            byte[] iv = new byte[16];
            byte[] ciphertext = new byte[data.length - 16];
            System.arraycopy(data, 0, iv, 0, 16);
            System.arraycopy(data, 16, ciphertext, 0, ciphertext.length);
            Cipher cipher = Cipher.getInstance(AES_ALGORITHM);
            cipher.init(Cipher.DECRYPT_MODE, key, new IvParameterSpec(iv));
            byte[] plaintext = cipher.doFinal(ciphertext);
            return new String(plaintext, StandardCharsets.UTF_8);
        } catch (Exception e) {
            return null;
        }
    }

    // trial 加解密
    private String encryptTrialContent(String jsonStr, String machineId) {
        return aesEncrypt(jsonStr, deriveTrialKey(machineId), TRIAL_ENC_PREFIX);
    }
    // ★ P3-A 新增：双密钥尝试 - 优先新密钥（含硬件指纹），失败回退旧密钥
    private String decryptTrialContent(String encryptedStr, String machineId) {
        if (encryptedStr == null || !encryptedStr.startsWith(TRIAL_ENC_PREFIX)) return null;
        String base64Data = encryptedStr.substring(TRIAL_ENC_PREFIX.length());
        String plaintext = tryDecryptAes(base64Data, deriveTrialKey(machineId));
        if (plaintext != null) return plaintext;
        return tryDecryptAes(base64Data, deriveTrialKeyLegacy(machineId));
    }

    // last-run 加解密
    private String encryptLastRunContent(String jsonStr, String machineId) {
        return aesEncrypt(jsonStr, deriveLastRunKey(machineId), LASTRUN_ENC_PREFIX);
    }
    // ★ P3-A 新增：双密钥尝试 - 优先新密钥（含硬件指纹），失败回退旧密钥
    private String decryptLastRunContent(String encryptedStr, String machineId) {
        if (encryptedStr == null || !encryptedStr.startsWith(LASTRUN_ENC_PREFIX)) return null;
        String base64Data = encryptedStr.substring(LASTRUN_ENC_PREFIX.length());
        String plaintext = tryDecryptAes(base64Data, deriveLastRunKey(machineId));
        if (plaintext != null) return plaintext;
        return tryDecryptAes(base64Data, deriveLastRunKeyLegacy(machineId));
    }

    // count 加解密
    private String encryptCountContent(String jsonStr, String machineId) {
        return aesEncrypt(jsonStr, deriveCountKey(machineId), COUNT_ENC_PREFIX);
    }
    // ★ P3-A 新增：双密钥尝试 - 优先新密钥（含硬件指纹），失败回退旧密钥
    private String decryptCountContent(String encryptedStr, String machineId) {
        if (encryptedStr == null || !encryptedStr.startsWith(COUNT_ENC_PREFIX)) return null;
        String base64Data = encryptedStr.substring(COUNT_ENC_PREFIX.length());
        String plaintext = tryDecryptAes(base64Data, deriveCountKey(machineId));
        if (plaintext != null) return plaintext;
        return tryDecryptAes(base64Data, deriveCountKeyLegacy(machineId));
    }

    // ========================================================================
    //  ★ 激活码失败限速（防暴力尝试激活码）
    // ========================================================================
    // 检查是否在冷却期。返回 null 表示可继续激活；返回非 null 表示冷却中（含错误信息）
    private JSONObject checkActivateRateLimit() {
        try {
            SharedPreferences prefs = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE);
            int failCount = prefs.getInt(PREF_KEY_ACTIVATE_FAIL_COUNT, 0);
            long firstFailTime = prefs.getLong(PREF_KEY_ACTIVATE_FIRST_FAIL_TIME, 0);
            long now = System.currentTimeMillis();

            if (failCount >= ACTIVATE_FAIL_THRESHOLD) {
                long remaining = ACTIVATE_COOLDOWN_MS - (now - firstFailTime);
                if (remaining > 0) {
                    long remainingSec = remaining / 1000;
                    JSONObject r = new JSONObject();
                    r.put("success", false);
                    r.put("error", "激活失败次数过多，请 " + remainingSec + " 秒后再试");
                    r.put("cooldown", true);
                    r.put("remainingMs", remaining);
                    return r;
                } else {
                    // 冷却期已过，重置计数
                    SharedPreferences.Editor editor = prefs.edit();
                    editor.putInt(PREF_KEY_ACTIVATE_FAIL_COUNT, 0);
                    editor.putLong(PREF_KEY_ACTIVATE_FIRST_FAIL_TIME, 0);
                    editor.apply();
                }
            }
        } catch (Exception e) {
            Log.e(TAG, "checkActivateRateLimit 异常", e);
        }
        return null;
    }

    // 记录激活失败（增加计数）
    private void recordActivateFailure() {
        try {
            SharedPreferences prefs = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE);
            int failCount = prefs.getInt(PREF_KEY_ACTIVATE_FAIL_COUNT, 0);
            long firstFailTime = prefs.getLong(PREF_KEY_ACTIVATE_FIRST_FAIL_TIME, 0);
            long now = System.currentTimeMillis();
            SharedPreferences.Editor editor = prefs.edit();
            if (failCount == 0 || firstFailTime == 0 ||
                    (now - firstFailTime) > ACTIVATE_COOLDOWN_MS) {
                // 首次失败或冷却期已过，重新开始计数
                editor.putInt(PREF_KEY_ACTIVATE_FAIL_COUNT, 1);
                editor.putLong(PREF_KEY_ACTIVATE_FIRST_FAIL_TIME, now);
            } else {
                editor.putInt(PREF_KEY_ACTIVATE_FAIL_COUNT, failCount + 1);
            }
            editor.apply();
        } catch (Exception e) {
            Log.e(TAG, "recordActivateFailure 异常", e);
        }
    }

    // 激活成功时重置失败计数
    private void resetActivateFailCount() {
        try {
            SharedPreferences prefs = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE);
            SharedPreferences.Editor editor = prefs.edit();
            editor.putInt(PREF_KEY_ACTIVATE_FAIL_COUNT, 0);
            editor.putLong(PREF_KEY_ACTIVATE_FIRST_FAIL_TIME, 0);
            editor.apply();
        } catch (Exception e) {
            Log.e(TAG, "resetActivateFailCount 异常", e);
        }
    }

    // ========================================================================
    //  XOR 混淆（与桌面版一致：Base64(XOR(plaintext, key))）
    // ========================================================================
    private String xorEncrypt(String text, String key) {
        try {
            byte[] textBytes = text.getBytes(StandardCharsets.UTF_8);
            byte[] keyBytes = key.getBytes(StandardCharsets.UTF_8);
            byte[] result = new byte[textBytes.length];
            for (int i = 0; i < textBytes.length; i++) {
                result[i] = (byte) (textBytes[i] ^ keyBytes[i % keyBytes.length]);
            }
            return Base64.encodeToString(result, Base64.NO_WRAP);
        } catch (Exception e) {
            return null;
        }
    }

    private String xorDecrypt(String base64, String key) {
        try {
            byte[] buf = Base64.decode(base64, Base64.DEFAULT);
            byte[] keyBytes = key.getBytes(StandardCharsets.UTF_8);
            byte[] result = new byte[buf.length];
            for (int i = 0; i < buf.length; i++) {
                result[i] = (byte) (buf[i] ^ keyBytes[i % keyBytes.length]);
            }
            return new String(result, StandardCharsets.UTF_8);
        } catch (Exception e) {
            return null;
        }
    }

    // ========================================================================
    //  HMAC-SHA256 签名（与桌面版 generateSignature 完全一致）
    //  v2 签名内容：user|type|issuedAt|expiresAt|maxPrescriptions|features
    //  v3 签名内容：在 v2 基础上增加 clinicName|machineId|licenseBinding
    //  v1 签名内容：user|type|issuedAt|expiresAt（向后兼容）
    // ========================================================================
    private String generateSignature(JSONObject data) {
        try {
            String content = buildSignatureContent(data, true, false);
            return hmacSha256(content);
        } catch (Exception e) {
            Log.e(TAG, "生成 v2 签名失败", e);
            return "";
        }
    }

    // ★ v3 新增：生成 v3 签名（含 clinicName/machineId/licenseBinding 三个绑定字段）
    private String generateSignatureV3(JSONObject data) {
        try {
            String content = buildSignatureContent(data, true, true);
            return hmacSha256(content);
        } catch (Exception e) {
            Log.e(TAG, "生成 v3 签名失败", e);
            return "";
        }
    }

    private String generateSignatureV1(JSONObject data) {
        try {
            String content = buildSignatureContent(data, false, false);
            return hmacSha256(content);
        } catch (Exception e) {
            Log.e(TAG, "生成 v1 签名失败", e);
            return "";
        }
    }

    // ★ v3 新增：v3 参数控制是否追加 clinicName|machineId|licenseBinding 三个绑定字段
    private String buildSignatureContent(JSONObject data, boolean v2, boolean v3) throws Exception {
        StringBuilder sb = new StringBuilder();
        sb.append(data.optString("user", ""));
        sb.append('|');
        sb.append(data.optString("type", ""));
        sb.append('|');
        sb.append(data.optString("issuedAt", ""));
        sb.append('|');
        sb.append(data.optString("expiresAt", ""));
        if (v2 || v3) {
            sb.append('|');
            // maxPrescriptions: 默认 0
            int max = data.optInt("maxPrescriptions", 0);
            sb.append(max);
            sb.append('|');
            // features: 逗号分隔
            JSONArray features = data.optJSONArray("features");
            if (features != null) {
                StringBuilder fs = new StringBuilder();
                for (int i = 0; i < features.length(); i++) {
                    if (i > 0) fs.append(',');
                    fs.append(features.getString(i));
                }
                sb.append(fs.toString());
            }
        }
        // ★ v3 新增：追加绑定字段
        if (v3) {
            sb.append('|');
            sb.append(data.optString("clinicName", ""));
            sb.append('|');
            sb.append(data.optString("machineId", ""));
            sb.append('|');
            sb.append(data.optString("licenseBinding", ""));
        }
        return sb.toString();
    }

    private String hmacSha256(String content) {
        // ★ P1-3: 使用 getEffectiveHmacKey() 派生密钥（masterKey 派生或硬编码 fallback）
        return hmacSha256WithKey(content, getEffectiveHmacKey());
    }

    // 签名验证（先 v5 ECDSA，再 v3，再 v2，最后 v1 向后兼容）
    private boolean verifySignature(JSONObject data) {
        String sig = data.optString("signature", "");
        if (sig == null || sig.isEmpty()) return false;

        // ★ P1-3: 缓存当前 license 数据上下文，供 getEffectiveHmacKey 派生密钥使用
        // 注意：此时 license 数据尚未验签，但 masterKey 字段不参与签名内容（云端在签名后添加），
        //      因此攻击者修改 masterKey 会导致派生密钥改变，但 cloud 签名仍按原 masterKey 计算，
        //      所以篡改后的 license 会验签失败（除非攻击者知道原 masterKey 并重算签名）。
        //      ECDSA v5（如果配置）提供更强的防篡改保证。
        setLicenseDataContext(data);

        // ★ v5 ECDSA 非对称验签优先校验（云端私钥签，客户端公钥验）
        // 优势：即使 APP 被反编译拿到公钥，也无法伪造签名（公钥只能验不能签）
        if (data.has("signatureV5") && ECDSA_VERIFY_PUBLIC_KEY_PEM != null
                && !ECDSA_VERIFY_PUBLIC_KEY_PEM.isEmpty()) {
            if (verifyECDSASignature(data)) {
                return true;
            }
            Log.w(TAG, "v5 ECDSA 验签失败，降级为 HMAC");
        }

        // ★ P1-3 新增：若 license 含 masterKey 字段，则 generateSignatureV3/V2 会自动使用 masterKey 派生密钥
        // 若验签失败，清除上下文，后续 fallback 到硬编码密钥（向后兼容旧 license）
        boolean hasMasterKey = data.has("masterKey") && !data.optString("masterKey", "").isEmpty();

        if (hasMasterKey) {
            // 尝试 1：masterKey 派生密钥验签
            if (data.has("clinicName") && data.has("machineId") && data.has("licenseBinding")) {
                String expectedV3mk = generateSignatureV3(data);
                if (sig.equalsIgnoreCase(expectedV3mk)) return true;
            }
            String expectedV2mk = generateSignature(data);
            if (sig.equalsIgnoreCase(expectedV2mk)) return true;
            // masterKey 派生密钥验签失败，清除上下文，后续用硬编码密钥 fallback
            setLicenseDataContext(null);
        }

        // 尝试 2：硬编码密钥 fallback（用于旧 license 无 masterKey，或 masterKey 验签失败的兜底）
        if (data.has("clinicName") && data.has("machineId") && data.has("licenseBinding")) {
            String expectedV3 = generateSignatureV3(data);
            if (sig.equalsIgnoreCase(expectedV3)) return true;
        }
        String expectedV2 = generateSignature(data);
        if (sig.equalsIgnoreCase(expectedV2)) return true;
        // v1 向后兼容：仅当旧版 license（无 maxPrescriptions 和 features 字段）才尝试 v1
        if (!data.has("maxPrescriptions") && !data.has("features")) {
            String expectedV1 = generateSignatureV1(data);
            if (sig.equalsIgnoreCase(expectedV1)) return true;
        }

        // 所有验签均失败，清除上下文（避免影响后续校验）
        setLicenseDataContext(null);
        return false;
    }

    // ★ v5 新增：ECDSA P-256 非对称验签（与桌面版 license-manager.js verifyECDSASignature 一致）
    // 云端用私钥签，客户端用公钥验；即使公钥被提取也无法伪造签名
    // 签名内容与 v3 一致（user|type|issuedAt|expiresAt|maxPrescriptions|features|clinicName|machineId|licenseBinding）
    // 签名值 signatureV5 为 hex(raw r||s 64字节)，需转为 DER 格式供 Java Signature.verify 使用
    private boolean verifyECDSASignature(JSONObject data) {
        String sigV5 = data.optString("signatureV5", "");
        if (sigV5 == null || sigV5.isEmpty() ||
                ECDSA_VERIFY_PUBLIC_KEY_PEM == null || ECDSA_VERIFY_PUBLIC_KEY_PEM.isEmpty()) {
            return false;
        }
        try {
            // 1. 构造签名内容（与云端 generateSignatureV5 一致）
            String content = buildSignatureContent(data, true, true);
            // 2. hex(raw) → raw bytes → DER
            byte[] rawSig = hexToBytes(sigV5);
            if (rawSig == null || rawSig.length != 64) return false;
            byte[] derSig = ecdsaRawToDer(rawSig);
            if (derSig == null) return false;
            // 3. 解析公钥 PEM（去头尾与空白后 Base64 解码）
            String b64 = ECDSA_VERIFY_PUBLIC_KEY_PEM
                    .replace("-----BEGIN PUBLIC KEY-----", "")
                    .replace("-----END PUBLIC KEY-----", "")
                    .replaceAll("\\s+", "");
            byte[] pubKeyBytes = Base64.decode(b64, Base64.DEFAULT);
            X509EncodedKeySpec keySpec = new X509EncodedKeySpec(pubKeyBytes);
            KeyFactory kf = KeyFactory.getInstance("EC");
            PublicKey publicKey = kf.generatePublic(keySpec);
            // 4. 验签
            Signature sig = Signature.getInstance("SHA256withECDSA");
            sig.initVerify(publicKey);
            sig.update(content.getBytes(StandardCharsets.UTF_8));
            return sig.verify(derSig);
        } catch (Exception e) {
            Log.w(TAG, "v5 ECDSA 验签异常: " + e.getMessage());
            return false;
        }
    }

    // ECDSA raw(r||s 64字节) → ASN.1 DER 编码（Java Signature.verify 需要 DER）
    // Web Crypto 输出 raw 格式，Java 期望 DER，需手动转换
    private byte[] ecdsaRawToDer(byte[] rawSig) {
        if (rawSig == null || rawSig.length != 64) return null;
        byte[] r = encodeEcdsaInteger(Arrays.copyOfRange(rawSig, 0, 32));
        byte[] s = encodeEcdsaInteger(Arrays.copyOfRange(rawSig, 32, 64));
        // SEQUENCE { INTEGER r, INTEGER s }
        ByteArrayOutputStream seq = new ByteArrayOutputStream();
        seq.write(0x30); // SEQUENCE tag
        int contentLen = r.length + s.length + 4; // 2 个 (0x02 tag + 1字节长度)
        seq.write(contentLen & 0xFF);
        seq.write(0x02); seq.write(r.length);
        seq.write(r, 0, r.length);
        seq.write(0x02); seq.write(s.length);
        seq.write(s, 0, s.length);
        return seq.toByteArray();
    }

    // DER INTEGER 编码：去掉前导零，最高位为1时补0（保证非负）
    private byte[] encodeEcdsaInteger(byte[] raw) {
        int offset = 0;
        while (offset < raw.length - 1 && raw[offset] == 0) offset++;
        int len = raw.length - offset;
        byte[] result;
        if ((raw[offset] & 0x80) != 0) {
            // 最高位为1，补前导0表示非负
            result = new byte[len + 1];
            result[0] = 0;
            System.arraycopy(raw, offset, result, 1, len);
        } else {
            result = new byte[len];
            System.arraycopy(raw, offset, result, 0, len);
        }
        return result;
    }

    // hex 字符串 → byte[]（小写/大写兼容）
    private byte[] hexToBytes(String hex) {
        if (hex == null || hex.length() % 2 != 0) return null;
        hex = hex.toLowerCase();
        byte[] result = new byte[hex.length() / 2];
        for (int i = 0; i < result.length; i++) {
            int hi = Character.digit(hex.charAt(i * 2), 16);
            int lo = Character.digit(hex.charAt(i * 2 + 1), 16);
            if (hi < 0 || lo < 0) return null;
            result[i] = (byte) ((hi << 4) | lo);
        }
        return result;
    }

    // ========================================================================
    //  文件读写
    // ========================================================================
    private File getFile(String name) {
        return new File(context.getFilesDir(), name);
    }

    // license.dat: 优先 ENC2:hex(hmac):base64(iv+ciphertext)，旧格式 ENC1 / base64 向后兼容
    public JSONObject readLicense() {
        return readLicense(getMachineId());
    }

    // ★ P1-A 新增：readLicense 可传入 machineId 用于解密
    public JSONObject readLicense(String machineId) {
        try {
            File f = getFile(LICENSE_FILE);
            if (!f.exists()) return null;
            byte[] bytes = readFileBytes(f);
            String content = new String(bytes, StandardCharsets.UTF_8).trim();

            // ★ 修复 2026-07-27：machineId 为 null 或空串时 fallback 到本机 machineId
            // 防止上游调用方传入空串导致解密失败（实际场景：validateLicense() 无参调用）
            String actualMachineId = (machineId != null && !machineId.isEmpty()) ? machineId : getMachineId();
            if (actualMachineId == null || actualMachineId.isEmpty()) {
                Log.e(TAG, "无法获取 machineId 解密 license");
                return null;
            }

            // ★ P3-C 新增：优先尝试 ENC2 格式（含 HMAC 校验）
            if (content.startsWith(LICENSE_ENC2_PREFIX)) {
                String json = decryptLicenseContent(content, actualMachineId);
                if (json == null) {
                    Log.e(TAG, "解密失败（machineId 不匹配 / 文件损坏 / HMAC 校验失败）");
                    return null;
                }
                return new JSONObject(json);
            }

            // ★ P1-A 新增：旧加密格式（ENC1:）
            if (content.startsWith(LICENSE_ENC_PREFIX)) {
                String json = decryptLicenseContent(content, actualMachineId);
                if (json == null) {
                    Log.e(TAG, "解密失败（machineId 不匹配或文件损坏）");
                    return null;
                }
                return new JSONObject(json);
            }

            // 旧格式（Base64）- 向后兼容
            String json = new String(Base64.decode(content, Base64.DEFAULT), StandardCharsets.UTF_8);
            return new JSONObject(json);
        } catch (Exception e) {
            Log.e(TAG, "读取 license 失败: " + e.getMessage());
            return null;
        }
    }

    // ★ P1-A 新增：writeLicenseContent 加密后写入（密钥从 machineId 派生）
    public boolean writeLicenseContent(String base64Content) {
        return writeLicenseContent(base64Content, getMachineId());
    }

    public boolean writeLicenseContent(String base64Content, String machineId) {
        try {
            File f = getFile(LICENSE_FILE);
            String actualMachineId = machineId != null ? machineId : getMachineId();
            if (actualMachineId == null || actualMachineId.isEmpty()) {
                Log.e(TAG, "无法获取 machineId，无法加密 license");
                return false;
            }

            // 解码 Base64 得到 JSON 字符串
            String jsonStr = new String(Base64.decode(base64Content.trim(), Base64.DEFAULT), StandardCharsets.UTF_8);

            // 验证是有效的 JSON（防止写入损坏数据）
            new JSONObject(jsonStr);

            // 加密并写入
            String encrypted = encryptLicenseContent(jsonStr, actualMachineId);
            if (encrypted == null) {
                Log.e(TAG, "加密 license 失败");
                return false;
            }
            try (FileOutputStream fos = new FileOutputStream(f)) {
                fos.write(encrypted.getBytes(StandardCharsets.UTF_8));
                fos.flush();
            }
            return true;
        } catch (Exception e) {
            Log.e(TAG, "写入 license 失败", e);
            return false;
        }
    }

    public boolean deleteLicense() {
        try {
            File f = getFile(LICENSE_FILE);
            return f.exists() && f.delete();
        } catch (Exception e) {
            return false;
        }
    }

    // trial.dat: AES-256-CBC 加密（旧格式 Base64(XOR(JSON)) 向后兼容）
    private JSONObject readTrial() {
        try {
            File f = getFile(TRIAL_FILE);
            if (!f.exists()) return null;
            byte[] bytes = readFileBytes(f);
            String content = new String(bytes, StandardCharsets.UTF_8).trim();
            String json = null;
            // ★ P2 新增：优先尝试新 AES 加密格式（TRIAL1:）
            if (content.startsWith(TRIAL_ENC_PREFIX)) {
                String mid = getMachineId();
                json = decryptTrialContent(content, mid);
                if (json == null) {
                    Log.e(TAG, "trial 解密失败（machineId 不匹配或文件损坏）");
                    return null;
                }
            } else {
                // 旧格式（XOR + Base64）- 向后兼容
                json = xorDecrypt(content, TRIAL_KEY);
                if (json == null) return null;
            }
            return new JSONObject(json);
        } catch (Exception e) {
            return null;
        }
    }

    private void writeTrial(JSONObject trial) {
        try {
            File f = getFile(TRIAL_FILE);
            String jsonStr = trial.toString();
            // ★ P2 新增：优先使用 AES-256-CBC 加密写入（密钥从 machineId 派生）
            String mid = getMachineId();
            String encrypted = (mid != null && !mid.isEmpty()) ? encryptTrialContent(jsonStr, mid) : null;
            if (encrypted == null) {
                // 回退到 XOR 加密（仅当 machineId 不可用时）
                Log.w(TAG, "machineId 不可用，trial 回退到 XOR 加密");
                encrypted = xorEncrypt(jsonStr, TRIAL_KEY);
            }
            try (FileOutputStream fos = new FileOutputStream(f)) {
                fos.write(encrypted.getBytes(StandardCharsets.UTF_8));
                fos.flush();
            }
        } catch (Exception e) {
            Log.e(TAG, "写入 trial 失败", e);
        }
    }

    // ★ 获取试用期天数（可配置，默认 7 天，测试时可设为 0 天立即触发激活）
    // 与桌面版 license-manager.js getTrialDays() 对应（桌面版用 trial-config.json）
    public int getTrialDays() {
        try {
            SharedPreferences prefs = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE);
            int days = prefs.getInt(PREF_KEY_TRIAL_DAYS, -1);
            if (days >= 0 && days <= 365) return days;
        } catch (Exception e) {
            Log.e(TAG, "读取试用期天数失败", e);
        }
        return DEFAULT_TRIAL_DAYS;
    }

    // ★ 设置试用期天数（持久化到 SharedPreferences，重启后生效）
    public JSONObject setTrialDays(int days) {
        JSONObject result = new JSONObject();
        try {
            if (days < 0 || days > 365) {
                result.put("success", false);
                result.put("error", "试用期天数必须在 0-365 之间");
                return result;
            }
            SharedPreferences prefs = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE);
            SharedPreferences.Editor editor = prefs.edit();
            editor.putInt(PREF_KEY_TRIAL_DAYS, days);
            editor.apply();
            result.put("success", true);
            result.put("trialDays", days);
        } catch (Exception e) {
            try {
                result.put("success", false);
                result.put("error", String.valueOf(e));
            } catch (Exception ignored) {}
        }
        return result;
    }

    // last-run.dat: AES-256-CBC 加密（旧格式 Base64(XOR(JSON)) 向后兼容）
    private JSONObject readLastRun() {
        try {
            File f = getFile(LASTRUN_FILE);
            if (!f.exists()) return null;
            byte[] bytes = readFileBytes(f);
            String content = new String(bytes, StandardCharsets.UTF_8).trim();
            String json = null;
            // ★ P2 新增：优先尝试新 AES 加密格式（LASTRUN1:）
            if (content.startsWith(LASTRUN_ENC_PREFIX)) {
                String mid = getMachineId();
                json = decryptLastRunContent(content, mid);
                if (json == null) {
                    Log.e(TAG, "last-run 解密失败（machineId 不匹配或文件损坏）");
                    return null;
                }
            } else {
                // 旧格式（XOR + Base64）- 向后兼容
                json = xorDecrypt(content, LASTRUN_KEY);
                if (json == null) return null;
            }
            return new JSONObject(json);
        } catch (Exception e) {
            return null;
        }
    }

    private void writeLastRun(long timestamp) {
        try {
            File f = getFile(LASTRUN_FILE);
            JSONObject data = new JSONObject();
            data.put("timestamp", timestamp);
            String jsonStr = data.toString();
            // ★ P2 新增：优先使用 AES-256-CBC 加密写入
            String mid = getMachineId();
            String encrypted = (mid != null && !mid.isEmpty()) ? encryptLastRunContent(jsonStr, mid) : null;
            if (encrypted == null) {
                Log.w(TAG, "machineId 不可用，last-run 回退到 XOR 加密");
                encrypted = xorEncrypt(jsonStr, LASTRUN_KEY);
            }
            try (FileOutputStream fos = new FileOutputStream(f)) {
                fos.write(encrypted.getBytes(StandardCharsets.UTF_8));
                fos.flush();
            }
        } catch (Exception e) {
            Log.e(TAG, "写入 last-run 失败", e);
        }
    }

    // prescription-count.dat: AES-256-CBC 加密（旧格式 Base64(XOR(JSON)) 向后兼容）
    private JSONObject readCounts() {
        try {
            File f = getFile(COUNT_FILE);
            if (!f.exists()) return new JSONObject();
            byte[] bytes = readFileBytes(f);
            String content = new String(bytes, StandardCharsets.UTF_8).trim();
            String json = null;
            // ★ P2 新增：优先尝试新 AES 加密格式（COUNT1:）
            if (content.startsWith(COUNT_ENC_PREFIX)) {
                String mid = getMachineId();
                json = decryptCountContent(content, mid);
                if (json == null) {
                    Log.e(TAG, "count 解密失败（machineId 不匹配或文件损坏）");
                    return new JSONObject();
                }
            } else {
                // 旧格式（XOR + Base64）- 向后兼容
                json = xorDecrypt(content, COUNT_KEY);
                if (json == null) return new JSONObject();
            }
            return new JSONObject(json);
        } catch (Exception e) {
            return new JSONObject();
        }
    }

    private void writeCounts(JSONObject counts) {
        try {
            File f = getFile(COUNT_FILE);
            String jsonStr = counts.toString();
            // ★ P2 新增：优先使用 AES-256-CBC 加密写入
            String mid = getMachineId();
            String encrypted = (mid != null && !mid.isEmpty()) ? encryptCountContent(jsonStr, mid) : null;
            if (encrypted == null) {
                Log.w(TAG, "machineId 不可用，count 回退到 XOR 加密");
                encrypted = xorEncrypt(jsonStr, COUNT_KEY);
            }
            try (FileOutputStream fos = new FileOutputStream(f)) {
                fos.write(encrypted.getBytes(StandardCharsets.UTF_8));
                fos.flush();
            }
        } catch (Exception e) {
            Log.e(TAG, "写入计数失败", e);
        }
    }

    // ========================================================================
    //  ★ P1-1 在线验证状态读写（verify-state.dat, XOR 加密）
    //  独立于 license.dat，不影响签名验证
    //  字段：lastOnlineVerify(时间戳), prescriptionsSinceVerify(处方计数)
    // ========================================================================
    private JSONObject readVerifyState() {
        try {
            File f = getFile(VERIFY_STATE_FILE);
            if (!f.exists()) return new JSONObject();
            byte[] bytes = readFileBytes(f);
            String content = new String(bytes, StandardCharsets.UTF_8).trim();
            String json = xorDecrypt(content, VERIFY_STATE_KEY);
            if (json == null) return new JSONObject();
            return new JSONObject(json);
        } catch (Exception e) {
            return new JSONObject();
        }
    }

    private void writeVerifyState(JSONObject state) {
        try {
            File f = getFile(VERIFY_STATE_FILE);
            String encrypted = xorEncrypt(state.toString(), VERIFY_STATE_KEY);
            try (FileOutputStream fos = new FileOutputStream(f)) {
                fos.write(encrypted.getBytes(StandardCharsets.UTF_8));
                fos.flush();
            }
        } catch (Exception e) {
            Log.e(TAG, "写入验证状态失败", e);
        }
    }

    // ========================================================================
    //  ★ P1-1 在线验证（POST /api/license/verify）
    //  云端校验 license 有效性，成功后更新 lastOnlineVerify 和清零计数
    //  网络不可用时不阻断（返回 success=false 但不锁死）
    // ========================================================================
    public JSONObject verifyOnline(String machineId) {
        HttpURLConnection conn = null;
        try {
            // 读取当前 license 获取激活码信息
            JSONObject rawLicense = readLicense(machineId);
            if (rawLicense == null) {
                return failResult("无有效授权，无法在线验证");
            }
            JSONObject license = normalizeLicense(rawLicense);
            if (license == null) {
                return failResult("授权文件格式错误");
            }

            // 读取激活记录获取 codeHash
            JSONObject activationRecord = readActivationRecord();
            String codeHash = activationRecord.optString("codeHash", "");

            URL url = new URL(VERIFY_API_URL);
            conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("POST");
            conn.setRequestProperty("Content-Type", "application/json; charset=UTF-8");
            conn.setRequestProperty("Accept", "application/json");
            conn.setConnectTimeout(ACTIVATE_TIMEOUT_MS);
            conn.setReadTimeout(ACTIVATE_TIMEOUT_MS);
            conn.setDoOutput(true);

            JSONObject reqBody = new JSONObject();
            reqBody.put("machineId", machineId != null ? machineId : "");
            reqBody.put("codeHash", codeHash);
            reqBody.put("user", license.optString("user", ""));
            reqBody.put("expiresAt", license.optString("expiresAt", ""));

            try (OutputStream os = conn.getOutputStream()) {
                os.write(reqBody.toString().getBytes(StandardCharsets.UTF_8));
                os.flush();
            }

            int codeResp = conn.getResponseCode();
            InputStream is = (codeResp >= 200 && codeResp < 400) ? conn.getInputStream() : conn.getErrorStream();
            if (is == null) {
                return failResult("服务器无响应 (HTTP " + codeResp + ")");
            }
            String response = readStream(is);
            Log.i(TAG, "在线验证响应: " + response);
            JSONObject respJson = new JSONObject(response);

            if (!respJson.optBoolean("success", false)) {
                return failResult(respJson.optString("message", "在线验证失败"));
            }

            // 验证成功，更新验证状态
            JSONObject verifyState = new JSONObject();
            verifyState.put("lastOnlineVerify", System.currentTimeMillis());
            verifyState.put("prescriptionsSinceVerify", 0);
            writeVerifyState(verifyState);

            JSONObject r = new JSONObject();
            r.put("success", true);
            r.put("message", "在线验证成功，授权有效");
            r.put("verifyTime", System.currentTimeMillis());
            return r;
        } catch (java.net.SocketTimeoutException e) {
            Log.w(TAG, "在线验证超时（不阻断使用）", e);
            return failResult("验证超时，请检查网络后重试");
        } catch (java.net.UnknownHostException e) {
            Log.w(TAG, "在线验证无法连接服务器（不阻断使用）", e);
            return failResult("无法连接服务器，请检查网络");
        } catch (Exception e) {
            Log.e(TAG, "在线验证失败", e);
            return failResult("验证失败: " + e.getMessage());
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    // ========================================================================
    //  ★ P1-2 激活码水印记录读写（activation-record.dat, XOR 加密）
    //  字段：codeHash(SHA256), activateTime(时间戳), machineId
    //  用途：发现盗版时读取 codeHash 反查源激活码 → 定位泄露用户
    // ========================================================================
    private JSONObject readActivationRecord() {
        try {
            File f = getFile(ACTIVATION_RECORD_FILE);
            if (!f.exists()) return new JSONObject();
            byte[] bytes = readFileBytes(f);
            String content = new String(bytes, StandardCharsets.UTF_8).trim();
            String json = xorDecrypt(content, ACTIVATION_RECORD_KEY);
            if (json == null) return new JSONObject();
            return new JSONObject(json);
        } catch (Exception e) {
            return new JSONObject();
        }
    }

    private void writeActivationRecord(JSONObject record) {
        try {
            File f = getFile(ACTIVATION_RECORD_FILE);
            String encrypted = xorEncrypt(record.toString(), ACTIVATION_RECORD_KEY);
            try (FileOutputStream fos = new FileOutputStream(f)) {
                fos.write(encrypted.getBytes(StandardCharsets.UTF_8));
                fos.flush();
            }
        } catch (Exception e) {
            Log.e(TAG, "写入激活记录失败", e);
        }
    }

    /** ★ P1-2 获取激活记录（供JS调用，用于追溯盗版） */
    public JSONObject getActivationRecord() {
        return readActivationRecord();
    }

    private byte[] readFileBytes(File f) throws Exception {
        try (java.io.FileInputStream fis = new java.io.FileInputStream(f)) {
            java.io.ByteArrayOutputStream baos = new java.io.ByteArrayOutputStream();
            byte[] buffer = new byte[8192];
            int len;
            while ((len = fis.read(buffer)) > 0) {
                baos.write(buffer, 0, len);
            }
            return baos.toByteArray();
        }
    }

    // ========================================================================
    //  版本类型规范化（与桌面版 normalizeLicense 一致）
    // ========================================================================
    private JSONObject normalizeLicense(JSONObject license) {
        if (license == null) return null;
        try {
            String type = license.optString("type", "personal");
            int defaultMax = getDefaultMaxPrescriptions(type);
            JSONArray defaultFeatures = getDefaultFeatures(type);

            JSONObject normalized = new JSONObject();
            normalized.put("user", license.optString("user", ""));
            normalized.put("type", type);
            normalized.put("issuedAt", license.optString("issuedAt", ""));
            normalized.put("expiresAt", license.optString("expiresAt", ""));
            // v2 新字段（旧版 license 缺失时用默认值）
            normalized.put("maxPrescriptions", license.has("maxPrescriptions") ?
                    license.getInt("maxPrescriptions") : defaultMax);
            // features
            JSONArray features = license.optJSONArray("features");
            if (features == null) features = defaultFeatures;
            normalized.put("features", features);
            if (license.has("signature")) {
                normalized.put("signature", license.getString("signature"));
            }
            // ★ v3 新增：透传绑定字段（旧版 license 无该字段时不设置）
            if (license.has("clinicName")) {
                normalized.put("clinicName", license.optString("clinicName", ""));
            }
            if (license.has("machineId")) {
                normalized.put("machineId", license.optString("machineId", ""));
            }
            if (license.has("licenseBinding")) {
                normalized.put("licenseBinding", license.optString("licenseBinding", ""));
            }
            // ★ P1-3 新增：透传 masterKey 字段（云端 LICENSE_MASTER_KEY 配置后下发，旧 license 无此字段）
            // 用途：license_getStatus 桥接返回时携带 masterKey，renderer 的 auth-core.js 调用 setMasterKey 注入密码哈希盐
            if (license.has("masterKey")) {
                normalized.put("masterKey", license.optString("masterKey", ""));
            }
            return normalized;
        } catch (Exception e) {
            Log.e(TAG, "normalizeLicense 失败", e);
            return null;
        }
    }

    // ========================================================================
    //  ★ v3 新增：本地诊所名/用户名读取 + 三因子绑定校验 + config 完整性校验
    // ========================================================================
    // 从 assets/public/config.json 读取本地诊所名
    public String getLocalClinicName() {
        try {
            InputStream is = context.getAssets().open("public/config.json");
            String json = readStream(is);
            JSONObject cfg = new JSONObject(json);
            return cfg.optString("clinicName", "");
        } catch (Exception e) {
            Log.w(TAG, "读取本地 config.json 诊所名失败: " + e.getMessage());
            return "";
        }
    }

    // 从 assets/public/config.json 读取本地医师名
    public String getLocalDoctorName() {
        try {
            InputStream is = context.getAssets().open("public/config.json");
            String json = readStream(is);
            JSONObject cfg = new JSONObject(json);
            return cfg.optString("doctorName", "");
        } catch (Exception e) {
            return "";
        }
    }

    // 读取输入流为字符串
    private String readStream(InputStream is) throws Exception {
        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        byte[] buf = new byte[1024];
        int len;
        while ((len = is.read(buf)) != -1) {
            baos.write(buf, 0, len);
        }
        is.close();
        return baos.toString("UTF-8");
    }

    // ★ v3 核心：校验 license 三因子绑定（clinicName + machineId）
    // 仅当 license 含 licenseBinding 字段时才校验
    public JSONObject checkLicenseBinding(JSONObject license, String localMachineId) {
        if (license == null || !license.has("licenseBinding")) {
            return successResult();  // 旧版 license 跳过
        }
        StringBuilder errs = new StringBuilder();
        // 机器 ID 校验
        String licenseMachineId = license.optString("machineId", "");
        if (!licenseMachineId.isEmpty() && localMachineId != null &&
                !licenseMachineId.equals(localMachineId)) {
            errs.append("机器标识不匹配（授权可能从其他设备复制）\n");
        }
        // 诊所名校验
        String licenseClinicName = license.optString("clinicName", "");
        String localClinicName = getLocalClinicName();
        if (!licenseClinicName.isEmpty() && !localClinicName.isEmpty() &&
                !licenseClinicName.equals(localClinicName)) {
            errs.append("诊所名不匹配（本地: ").append(localClinicName)
               .append(", 授权: ").append(licenseClinicName).append("）\n");
        }
        if (errs.length() > 0) {
            return failValidation(
                    "授权绑定校验失败：\n" + errs +
                    "\n请联系客服重新激活或检查 config.json 配置。",
                    "binding_mismatch");
        }
        return successResult();
    }

    // ★ v3 新增：校验 config.json 完整性签名
    // 防止用户修改 assets 中的 config.json 绕过 license 绑定校验
    public boolean verifyConfigIntegrity() {
        try {
            InputStream is = context.getAssets().open("public/config.json");
            String json = readStream(is);
            JSONObject cfg = new JSONObject(json);
            String sig = cfg.optString("configSignature", "");
            // 无 configSignature 字段 → 旧版 config.json，跳过校验（兼容性优先）
            if (sig.isEmpty()) return true;
            String issuedAt = cfg.optString("configIssuedAt", "");
            if (issuedAt.isEmpty()) return false;
            // 签名内容：clinicName|doctorName|edition|configIssuedAt
            String signContent = cfg.optString("clinicName", "") + "|" +
                                 cfg.optString("doctorName", "") + "|" +
                                 cfg.optString("edition", "") + "|" + issuedAt;
            // ★ P1-3: 使用 getEffectiveConfigSignKey() 派生密钥（从 license.masterKey 派生，向后兼容）
            // 注意：verifyConfigIntegrity 在 validateLicense 内部调用，此时 _currentLicenseData 已被 setLicenseDataContext 缓存
            String expected = hmacSha256WithKey(signContent, getEffectiveConfigSignKey());
            return sig.equalsIgnoreCase(expected);
        } catch (Exception e) {
            Log.w(TAG, "config.json 完整性校验异常: " + e.getMessage());
            return false;
        }
    }

    // 用指定密钥计算 HMAC-SHA256（用于 config.json 完整性校验）
    private String hmacSha256WithKey(String content, String key) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            SecretKeySpec keySpec = new SecretKeySpec(
                    key.getBytes(StandardCharsets.UTF_8), "HmacSHA256");
            mac.init(keySpec);
            byte[] hash = mac.doFinal(content.getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder();
            for (byte b : hash) {
                sb.append(String.format("%02x", b));
            }
            return sb.toString();
        } catch (Exception e) {
            return "";
        }
    }

    // ★ P1-9 代码完整性校验：检测 auth-core.js / license-manager.js 是否被篡改
    public boolean verifyJsIntegrity() {
        try {
            String[] criticalFiles = {"public/auth-core.js", "public/license/license-manager.js"};
            StringBuilder combined = new StringBuilder();
            for (String assetPath : criticalFiles) {
                try {
                    InputStream is = context.getAssets().open(assetPath);
                    byte[] bytes = readStreamBytes(is);
                    String hash = sha256Hex(bytes);
                    combined.append(hash).append('|');
                } catch (Exception e) {
                    Log.e(TAG, "[Integrity] 读取文件失败: " + assetPath);
                    return false;
                }
            }
            String currentHash = sha256Hex(combined.toString().getBytes(StandardCharsets.UTF_8));

            SharedPreferences prefs = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE);
            // ★ 版本化基线：版本号变化时自动重建基线，避免升级后完整性校验误报
            String baseline = prefs.getString(PREF_KEY_JS_INTEGRITY_HASH + "_v" + versionName, "");

            if (baseline.isEmpty()) {
                prefs.edit().putString(PREF_KEY_JS_INTEGRITY_HASH + "_v" + versionName, currentHash).apply();
                Log.i(TAG, "[Integrity] 首次运行，已建立完整性基线");
                return true;
            }

            if (baseline.equals(currentHash)) {
                Log.i(TAG, "[Integrity] 代码完整性校验通过");
                return true;
            }

            Log.e(TAG, "[Integrity] 代码完整性校验失败！检测到关键文件被篡改");
            Log.e(TAG, "[Integrity] 基线: " + baseline.substring(0, Math.min(16, baseline.length())) + "...");
            Log.e(TAG, "[Integrity] 当前: " + currentHash.substring(0, Math.min(16, currentHash.length())) + "...");
            return false;
        } catch (Exception e) {
            // ★安全优化：完整性校验异常时阻止启动（原为降级放行，存在安全风险）
            Log.e(TAG, "[Integrity] 完整性校验异常（阻止启动）: " + e.getMessage());
            return false;
        }
    }

    private String sha256Hex(byte[] data) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] hash = md.digest(data);
            StringBuilder sb = new StringBuilder();
            for (byte b : hash) {
                sb.append(String.format("%02x", b));
            }
            return sb.toString();
        } catch (NoSuchAlgorithmException e) {
            return "";
        }
    }

    private byte[] readStreamBytes(InputStream is) throws Exception {
        java.io.ByteArrayOutputStream baos = new java.io.ByteArrayOutputStream();
        byte[] buffer = new byte[4096];
        int len;
        while ((len = is.read(buffer)) != -1) {
            baos.write(buffer, 0, len);
        }
        is.close();
        return baos.toByteArray();
    }

    // 成功结果工厂
    private JSONObject successResult() {
        JSONObject r = new JSONObject();
        try { r.put("valid", true); } catch (Exception e) { /* ignore */ }
        return r;
    }

    private int getDefaultMaxPrescriptions(String type) {
        if ("trial".equals(type)) return TRIAL_MAX_PRESCRIPTIONS;
        if ("personal".equals(type)) return PERSONAL_MAX_PRESCRIPTIONS;
        if ("pro".equals(type)) return PRO_MAX_PRESCRIPTIONS;
        return PERSONAL_MAX_PRESCRIPTIONS;
    }

    private JSONArray getDefaultFeatures(String type) {
        JSONArray features = new JSONArray();
        if ("personal".equals(type) || "pro".equals(type)) {
            features.put("backup");
        }
        if ("pro".equals(type)) {
            features.put("sync");
            features.put("multi-device");
            features.put("priority-support");
        }
        // trial: 无高级功能
        return features;
    }

    // ========================================================================
    //  校验主逻辑（与桌面版 validateLicense 一致）
    //  返回 JSONObject:
    //    { valid, message, type, licenseType, maxPrescriptions, features, remainingDays }
    // ★ v3 新增：接受 localMachineId 参数用于三因子绑定校验，旧调用方式（无参）默认空串跳过机器 ID 校验
    // ========================================================================
    public JSONObject validateLicense() {
        return validateLicense(null);
    }

    public JSONObject validateLicense(String localMachineId) {
        // ★ 修复 2026-07-27：localMachineId 为 null/空时使用本机 machineId
        // 原代码 if (localMachineId == null) localMachineId = ""; 会导致 readLicense 空串解密失败，
        // 进而使激活后的 license.dat 无法读取，APP 误入试用模式（"授权状态 7 天"）
        if (localMachineId == null || localMachineId.isEmpty()) {
            localMachineId = getMachineId();
        }
        long now = System.currentTimeMillis();
        // ★ 修复 2026-07-27：添加诊断日志，帮助定位激活后重启仍显示试用模式的问题
        File licenseFile = getFile(LICENSE_FILE);
        Log.d(TAG, "validateLicense: machineId=" + localMachineId +
                   " license.dat exists=" + licenseFile.exists() +
                   " size=" + (licenseFile.exists() ? licenseFile.length() : 0));
        try {
            // ★ 安全检测 1：Root 检测（防 root 设备篡改 license）
            if (isRooted()) {
                return failValidation(
                        "检测到 Root 设备，软件无法运行。\n如需正常使用，请在非 Root 设备上安装。",
                        "rooted");
            }
            // ★ 安全检测 2：调试器检测（防 hook/调试绕过 license）
            if (isDebuggerAttached()) {
                return failValidation(
                        "检测到调试器已连接，软件无法运行。\n请关闭调试模式后重启应用。",
                        "debugger");
            }
            // ★ 安全检测 3：APK 签名校验（防反编译重打包）
            if (!verifyApkSignature()) {
                return failValidation(
                        "APK 签名校验失败，软件可能被篡改。\n请从官方渠道重新下载安装。",
                        "signature_mismatch");
            }
            // ★ P1-A4 新增：安全检测 4 - Frida Hook 框架检测（仅记录日志，不阻塞运行，避免误报闪退）
            if (isFridaInjected()) {
                Log.w(TAG, "检测到 Frida 注入特征（仅记录日志，不阻塞运行）");
            }
            // ★ P1-A4 新增：安全检测 5 - Xposed Hook 框架检测（仅记录日志，不阻塞运行，避免误报闪退）
            if (isXposedInjected()) {
                Log.w(TAG, "检测到 Xposed 注入特征（仅记录日志，不阻塞运行）");
            }

            // ★ P3-B 新增：模拟器检测（仅记录日志，不阻塞运行）
            // 用途：便于将来分析破解行为，避免误判合法用户
            if (isEmulator()) {
                Log.w(TAG, "检测到运行在模拟器环境中（仍允许运行，仅记录日志）");
            }

            // 1. 时间回拨检测
            JSONObject lastRun = readLastRun();
            if (lastRun != null && lastRun.has("timestamp")) {
                long lastTs = lastRun.getLong("timestamp");
                long diff = now - lastTs;
                if (diff < -TIME_TAMPER_THRESHOLD) {
                    return failValidation(
                            "检测到系统时间异常（时间回拨），软件已锁定。\n请恢复系统时间后重启，或联系客服重新激活。",
                            "tampered");
                }
            }

            // 2. 读取 license 文件
            // ★ P1-A 新增：传入 localMachineId 用于解密
            JSONObject rawLicense = readLicense(localMachineId);
            Log.d(TAG, "validateLicense: readLicense=" + (rawLicense != null ? "OK" : "null"));
            if (rawLicense != null) {
                // 先用原始字段验证签名
                if (!verifySignature(rawLicense)) {
                    return failValidation(
                            "授权文件已损坏或被篡改，请联系客服重新激活。",
                            "tampered");
                }
                // 签名验证通过，规范化字段
                JSONObject license = normalizeLicense(rawLicense);

                // ★ v3 新增：config.json 完整性校验（仅对绑定型 license 生效）
                if (license != null && license.has("licenseBinding") && !verifyConfigIntegrity()) {
                    JSONObject r = failValidation(
                            "配置文件 config.json 已被篡改或损坏，请重新打包或联系客服。\n（诊所名/医师名等关键字段签名校验失败）",
                            "config_tampered");
                    r.put("license", license);
                    return r;
                }

                // ★ v3 新增：三因子绑定校验（clinicName + machineId）
                // 仅当 license 含 licenseBinding 字段时才校验，旧版 license 自动跳过
                JSONObject bindingCheck = checkLicenseBinding(license, localMachineId);
                if (bindingCheck != null && !bindingCheck.optBoolean("valid", true)) {
                    JSONObject r = new JSONObject(bindingCheck.toString());
                    if (license != null) r.put("license", license);
                    return r;
                }

                // 校验到期时间
                String expiresAtStr = license.optString("expiresAt", "");
                long expiresAtMs = parseIsoDate(expiresAtStr);
                if (expiresAtMs == 0 || Long.MIN_VALUE == expiresAtMs) {
                    return failValidation("授权文件格式错误，请联系客服。", "invalid");
                }

                if (now > expiresAtMs) {
                    JSONObject r = failValidation(
                            "授权已过期。\n用户：" + license.optString("user", "") +
                                    "\n到期时间：" + expiresAtStr + "\n请联系客服续费。",
                            "expired");
                    r.put("license", license);
                    return r;
                }

                // license 有效
                writeLastRun(now);
                long remainingDays = (long) Math.ceil((expiresAtMs - now) / (24.0 * 60 * 60 * 1000));

                // ★ P1-1 在线授权验证：定期要求在线验证，防止离线破解后永久使用
                JSONObject verifyState = readVerifyState();
                long lastVerify = verifyState.optLong("lastOnlineVerify", 0);
                int prescriptionsSinceVerify = verifyState.optInt("prescriptionsSinceVerify", 0);
                long daysSinceVerify = (now - lastVerify) / (24 * 60 * 60 * 1000);

                if (lastVerify == 0) {
                    // 首次运行（刚激活或从旧版升级），初始化验证状态
                    verifyState.put("lastOnlineVerify", now);
                    verifyState.put("prescriptionsSinceVerify", 0);
                    writeVerifyState(verifyState);
                    lastVerify = now;
                    daysSinceVerify = 0;
                }

                if (daysSinceVerify > ONLINE_VERIFY_DOWNGRADE_DAYS) {
                    // 超过90天未验证，降级为试用模式（限制功能但不锁死）
                    JSONObject r = new JSONObject();
                    r.put("valid", true);
                    r.put("message", "授权有效（需在线验证）\n用户：" + license.optString("user", "") +
                            "\n已超过" + ONLINE_VERIFY_DOWNGRADE_DAYS + "天未在线验证，已降级为试用模式。\n请连接网络完成验证以恢复全部功能。");
                    r.put("type", "trial");
                    r.put("licenseType", "trial");
                    r.put("maxPrescriptions", TRIAL_MAX_PRESCRIPTIONS);
                    r.put("features", new JSONArray());
                    r.put("remainingDays", remainingDays);
                    r.put("needOnlineVerify", true);
                    r.put("verifyDowngraded", true);
                    r.put("license", license);
                    return r;
                }

                if (daysSinceVerify > ONLINE_VERIFY_PROMPT_DAYS && prescriptionsSinceVerify >= ONLINE_VERIFY_PROMPT_PRESCRIPTIONS) {
                    // 超过7天且30张处方未验证，提示但不阻断
                    JSONObject r = new JSONObject();
                    r.put("valid", true);
                    r.put("message", "授权有效\n用户：" + license.optString("user", "") +
                            "\n类型：" + license.optString("type", "") +
                            "\n到期：" + expiresAtStr +
                            "\n剩余：" + remainingDays + " 天" +
                            "\n\n⚠ 建议在线验证授权（已" + daysSinceVerify + "天未验证，" + prescriptionsSinceVerify + "张处方）");
                    r.put("type", "licensed");
                    r.put("licenseType", license.optString("type", "personal"));
                    r.put("maxPrescriptions", license.optInt("maxPrescriptions", 0));
                    r.put("features", license.optJSONArray("features"));
                    r.put("remainingDays", remainingDays);
                    r.put("needOnlineVerify", true);
                    r.put("license", license);
                    return r;
                }

                JSONObject r = new JSONObject();
                r.put("valid", true);
                r.put("message", "授权有效\n用户：" + license.optString("user", "") +
                        "\n类型：" + license.optString("type", "") +
                        "\n到期：" + expiresAtStr +
                        "\n剩余：" + remainingDays + " 天");
                r.put("type", "licensed");
                r.put("licenseType", license.optString("type", "personal"));
                r.put("maxPrescriptions", license.optInt("maxPrescriptions", 0));
                r.put("features", license.optJSONArray("features"));
                r.put("remainingDays", remainingDays);
                r.put("license", license);
                return r;
            }

            // 3. 无 license 文件，进入试用模式
            JSONObject trial = readTrial();
            int currentTrialDays = getTrialDays();   // ★ 当前配置的试用期天数
            if (trial == null) {
                trial = new JSONObject();
                trial.put("startTime", now);
                trial.put("expiresAt", now + (long) currentTrialDays * 24 * 60 * 60 * 1000);
                writeTrial(trial);
            } else if (currentTrialDays == 0) {
                // ★ 配置为 0 天时，立即过期（测试用）
                trial.put("expiresAt", trial.optLong("startTime", now));
                writeTrial(trial);
            } else {
                // ★ 配置变化时，重新计算 expiresAt（保留 startTime）
                long expectedExpiresAt = trial.optLong("startTime", now) + (long) currentTrialDays * 24 * 60 * 60 * 1000;
                if (trial.optLong("expiresAt", 0) != expectedExpiresAt) {
                    trial.put("expiresAt", expectedExpiresAt);
                    writeTrial(trial);
                }
            }

            long trialExpiresAtMs = trial.optLong("expiresAt", 0);
            if (trialExpiresAtMs == 0) {
                trialExpiresAtMs = trial.optLong("startTime", now) + (long) currentTrialDays * 24 * 60 * 60 * 1000;
            }
            if (now > trialExpiresAtMs) {
                JSONObject r = failValidation(
                        "试用期已到期（" + currentTrialDays + " 天）。\n请联系客服购买正式授权。",
                        "trial_expired");
                r.put("trial", trial);
                return r;
            }

            // 试用有效
            writeLastRun(now);
            long remainingDays = (long) Math.ceil((trialExpiresAtMs - now) / (24.0 * 60 * 60 * 1000));
            JSONObject r = new JSONObject();
            r.put("valid", true);
            r.put("message", "试用模式（剩余 " + remainingDays + " 天）\n请联系客服购买正式授权。");
            r.put("type", "trial");
            r.put("licenseType", "trial");
            r.put("maxPrescriptions", TRIAL_MAX_PRESCRIPTIONS);
            r.put("features", new JSONArray());
            r.put("remainingDays", remainingDays);
            return r;
        } catch (Exception e) {
            Log.e(TAG, "validateLicense 异常", e);
            return failValidation("授权校验异常: " + e.getMessage(), "error");
        }
    }

    private JSONObject failValidation(String message, String type) {
        try {
            JSONObject r = new JSONObject();
            r.put("valid", false);
            r.put("message", message);
            r.put("type", type);
            return r;
        } catch (Exception e) {
            return new JSONObject();
        }
    }

    // 解析 ISO 8601 日期（如 2026-12-31T23:59:59.000Z）
    private long parseIsoDate(String dateStr) {
        if (dateStr == null || dateStr.isEmpty()) return 0;
        try {
            // 兼容多种格式
            String s = dateStr.replace("Z", "+00:00");
            // 简单解析：支持 yyyy-MM-dd'T'HH:mm:ss.SSSXXX 和 yyyy-MM-dd'T'HH:mm:ssXXX
            java.text.SimpleDateFormat sdf;
            if (s.contains(".")) {
                sdf = new java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSSXXX", java.util.Locale.US);
            } else {
                sdf = new java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ssXXX", java.util.Locale.US);
            }
            sdf.setTimeZone(java.util.TimeZone.getTimeZone("UTC"));
            return sdf.parse(s).getTime();
        } catch (Exception e) {
            // 回退：尝试 yyyy-MM-dd
            try {
                java.text.SimpleDateFormat sdf = new java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.US);
                sdf.setTimeZone(java.util.TimeZone.getTimeZone("UTC"));
                return sdf.parse(dateStr).getTime();
            } catch (Exception e2) {
                return 0;
            }
        }
    }

    // ========================================================================
    //  在线激活（HTTP POST 云端 /api/license/validate）
    //  请求体：{ code, machineId, user, clinicName }
    //  响应体：{ success, license: base64, message, expiresAt, type, ... }
    // ★ v3 新增：clinicName 参数传给云端做绑定校验
    // ========================================================================
    public JSONObject activateOnline(String code, String machineId, String user) {
        return activateOnline(code, machineId, user, null);
    }

    public JSONObject activateOnline(String code, String machineId, String user, String clinicName) {
        HttpURLConnection conn = null;
        try {
            // ★ 激活码失败限速检查（防暴力尝试）
            JSONObject rateLimitResult = checkActivateRateLimit();
            if (rateLimitResult != null) {
                return rateLimitResult;
            }

            URL url = new URL(ACTIVATE_API_URL);
            conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("POST");
            conn.setRequestProperty("Content-Type", "application/json; charset=UTF-8");
            conn.setRequestProperty("Accept", "application/json");
            conn.setConnectTimeout(ACTIVATE_TIMEOUT_MS);
            conn.setReadTimeout(ACTIVATE_TIMEOUT_MS);
            conn.setDoOutput(true);

            JSONObject reqBody = new JSONObject();
            reqBody.put("code", code != null ? code.trim() : "");
            reqBody.put("machineId", machineId != null ? machineId : "");
            reqBody.put("user", user != null ? user : "");
            // ★ v3 新增：提交 clinicName（如填写）
            if (clinicName != null && !clinicName.isEmpty()) {
                reqBody.put("clinicName", clinicName);
            }

            try (OutputStream os = conn.getOutputStream()) {
                os.write(reqBody.toString().getBytes(StandardCharsets.UTF_8));
                os.flush();
            }

            int code_resp = conn.getResponseCode();
            InputStream is = (code_resp >= 200 && code_resp < 400) ? conn.getInputStream() : conn.getErrorStream();
            if (is == null) {
                return failResult("服务器无响应 (HTTP " + code_resp + ")");
            }
            String response = readStream(is);
            Log.i(TAG, "激活响应: " + response);
            JSONObject respJson = new JSONObject(response);

            if (!respJson.optBoolean("success", false)) {
                recordActivateFailure();  // ★ 云端返回激活失败，增加计数
                // ★ 修复：云端 API 返回 error 字段（非 message），优先读取 error 显示具体失败原因
                return failResult(respJson.optString("error", respJson.optString("message", "激活失败")));
            }

            // 获取 license base64 并写入文件
            String licenseBase64 = respJson.optString("license", "");
            if (licenseBase64 == null || licenseBase64.isEmpty()) {
                recordActivateFailure();
                return failResult("服务器返回的 license 数据为空");
            }
            // ★ P1-A 新增：传入 machineId 用于加密 license
            if (!writeLicenseContent(licenseBase64, machineId)) {
                recordActivateFailure();
                return failResult("写入 license 文件失败");
            }

            // 清除 trial 文件（已正式激活）
            try { getFile(TRIAL_FILE).delete(); } catch (Exception ignored) {}

            // ★ 激活成功，重置失败计数
            resetActivateFailCount();

            // ★ P1-1 初始化在线验证状态（激活时视为已验证）
            try {
                JSONObject vs = new JSONObject();
                vs.put("lastOnlineVerify", System.currentTimeMillis());
                vs.put("prescriptionsSinceVerify", 0);
                writeVerifyState(vs);
            } catch (Exception ve) {
                Log.w(TAG, "初始化验证状态失败(不影响激活)", ve);
            }

            // ★ P1-2 保存激活码水印（SHA256哈希，用于追溯盗版泄露源）
            try {
                MessageDigest md = MessageDigest.getInstance("SHA-256");
                byte[] hash = md.digest(code.trim().getBytes(StandardCharsets.UTF_8));
                StringBuilder sb = new StringBuilder();
                for (byte b : hash) sb.append(String.format("%02x", b));
                JSONObject ar = new JSONObject();
                ar.put("codeHash", sb.toString());
                ar.put("activateTime", System.currentTimeMillis());
                ar.put("machineId", machineId != null ? machineId : "");
                writeActivationRecord(ar);
            } catch (Exception ae) {
                Log.w(TAG, "保存激活记录失败(不影响激活)", ae);
            }

            JSONObject r = new JSONObject();
            r.put("success", true);
            r.put("message", "激活成功，请重启应用");
            r.put("license", licenseBase64);
            // 透传云端返回的字段
            if (respJson.has("type")) r.put("type", respJson.get("type"));
            if (respJson.has("expiresAt")) r.put("expiresAt", respJson.get("expiresAt"));
            if (respJson.has("user")) r.put("user", respJson.get("user"));
            return r;
        } catch (java.net.SocketTimeoutException e) {
            Log.e(TAG, "激活超时", e);
            recordActivateFailure();  // ★ 网络超时也算失败
            return failResult("激活超时，请检查网络后重试（15秒）");
        } catch (java.net.UnknownHostException e) {
            Log.e(TAG, "无法连接服务器", e);
            recordActivateFailure();  // ★ 网络错误不算激活失败（避免误伤）
            return failResult("无法连接服务器，请检查网络连接");
        } catch (Exception e) {
            Log.e(TAG, "激活失败", e);
            recordActivateFailure();  // ★ 激活失败增加计数
            return failResult("激活失败: " + e.getMessage());
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private JSONObject failResult(String msg) {
        try {
            JSONObject r = new JSONObject();
            r.put("success", false);
            r.put("error", msg);
            return r;
        } catch (Exception e) {
            return new JSONObject();
        }
    }

    // ========================================================================
    //  处方计数（与桌面版 prescription-counter.js 一致）
    // ========================================================================
    private String getCurrentMonthKey() {
        java.util.Calendar cal = java.util.Calendar.getInstance();
        int year = cal.get(java.util.Calendar.YEAR);
        int month = cal.get(java.util.Calendar.MONTH) + 1;
        return year + "-" + (month < 10 ? "0" + month : String.valueOf(month));
    }

    public int getCurrentMonthCount() {
        try {
            JSONObject counts = readCounts();
            return counts.optInt(getCurrentMonthKey(), 0);
        } catch (Exception e) {
            return 0;
        }
    }

    public int getMaxPrescriptions() {
        JSONObject license = readLicense();
        if (license == null) {
            // 无 license，试用模式
            return TRIAL_MAX_PRESCRIPTIONS;
        }
        JSONObject normalized = normalizeLicense(license);
        if (normalized == null) return TRIAL_MAX_PRESCRIPTIONS;
        return normalized.optInt("maxPrescriptions", 0);
    }

    public JSONObject canPrescribe() {
        try {
            int current = getCurrentMonthCount();
            int max = getMaxPrescriptions();
            JSONObject r = new JSONObject();
            if (max == 0) {
                r.put("allowed", true);
                r.put("current", current);
                r.put("max", 0);
                r.put("remaining", -1);
            } else {
                int remaining = Math.max(0, max - current);
                r.put("allowed", current < max);
                r.put("current", current);
                r.put("max", max);
                r.put("remaining", remaining);
            }
            return r;
        } catch (Exception e) {
            // 异常时默认放行（避免阻塞用户正常操作）
            try {
                JSONObject r = new JSONObject();
                r.put("allowed", true);
                r.put("current", 0);
                r.put("max", 0);
                r.put("remaining", -1);
                r.put("error", e.getMessage());
                return r;
            } catch (Exception e2) {
                return new JSONObject();
            }
        }
    }

    public int incrementPrescription() {
        try {
            String key = getCurrentMonthKey();
            JSONObject counts = readCounts();
            int newCount = counts.optInt(key, 0) + 1;
            counts.put(key, newCount);
            writeCounts(counts);
            // ★ P1-1 在线验证：增加自上次验证以来的处方计数
            try {
                JSONObject verifyState = readVerifyState();
                verifyState.put("prescriptionsSinceVerify", verifyState.optInt("prescriptionsSinceVerify", 0) + 1);
                writeVerifyState(verifyState);
            } catch (Exception ve) {
                Log.w(TAG, "更新验证计数失败(不影响处方保存)", ve);
            }
            return newCount;
        } catch (Exception e) {
            Log.e(TAG, "处方计数+1失败", e);
            return -1;
        }
    }

    public int decrementPrescription() {
        try {
            String key = getCurrentMonthKey();
            JSONObject counts = readCounts();
            int current = counts.optInt(key, 0);
            if (current > 0) {
                counts.put(key, current - 1);
                writeCounts(counts);
                return current - 1;
            }
            return 0;
        } catch (Exception e) {
            Log.e(TAG, "处方计数-1失败", e);
            return -1;
        }
    }

    public JSONObject getPrescriptionStatus() {
        try {
            int current = getCurrentMonthCount();
            int max = getMaxPrescriptions();
            String licenseType = getLicenseType();
            JSONObject r = new JSONObject();
            r.put("current", current);
            r.put("max", max);
            r.put("remaining", max == 0 ? -1 : Math.max(0, max - current));
            r.put("licenseType", licenseType);
            r.put("month", getCurrentMonthKey());
            return r;
        } catch (Exception e) {
            return new JSONObject();
        }
    }

    public String getLicenseType() {
        JSONObject license = readLicense();
        if (license == null) return "trial";
        if (!verifySignature(license)) return "trial";
        return license.optString("type", "personal");
    }

    // ========================================================================
    //  功能权限校验（与桌面版 feature-guard.js 一致）
    // ========================================================================
    public boolean hasFeature(String featureName) {
        try {
            JSONObject license = readLicense();
            if (license == null) return false;
            if (!verifySignature(license)) return false;
            JSONObject normalized = normalizeLicense(license);
            if (normalized == null) return false;
            JSONArray features = normalized.optJSONArray("features");
            if (features == null) return false;
            for (int i = 0; i < features.length(); i++) {
                if (featureName.equals(features.getString(i))) return true;
            }
            return false;
        } catch (Exception e) {
            return false;
        }
    }

    public JSONObject getFeatureStatus(String featureName) {
        try {
            JSONObject r = new JSONObject();
            r.put("allowed", hasFeature(featureName));
            r.put("feature", featureName);
            r.put("licenseType", getLicenseType());
            return r;
        } catch (Exception e) {
            try {
                // 异常默认放行
                JSONObject r = new JSONObject();
                r.put("allowed", true);
                r.put("feature", featureName);
                r.put("error", e.getMessage());
                return r;
            } catch (Exception e2) {
                return new JSONObject();
            }
        }
    }
}
