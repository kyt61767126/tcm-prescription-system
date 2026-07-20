package com.benneng.pres;

// ============================================================================
//  LicenseManager — APP 端授权管理（与桌面版 license-manager.js v2 一致）
//  功能：
//   - license.dat 校验（HMAC-SHA256 签名，v2 含 maxPrescriptions/features）
//   - 试用模式（7 天，XOR 混淆存储）
//   - 防时间回拨
//   - 在线激活（HTTP POST 云端 /api/license/validate）
//   - 处方计数（按月统计，XOR 混淆）
//   - 机器 ID 生成（SHA256(androidId + package + version + model).substring(0,32)）
//  安全：签名验证在 Java 层，攻击者难以通过修改 JS 绕过
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

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Iterator;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

public class LicenseManager {

    private static final String TAG = "LicenseManager";

    // ★ HMAC 密钥（与桌面版 license-manager.js / 云端 license-core.js 完全一致）
    private static final String LICENSE_HMAC_KEY = "bnzc_tcm_license_key_v1_2026";

    // ★ v3 新增：config.json 完整性签名密钥（与桌面版 license-manager.js / edit-config.ps1 完全一致）
    private static final String CONFIG_SIGN_KEY = "bnzc_config_sign_key_v1_2026";

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

    // ★ APK 签名校验（防反编译重打包）
    // 留空则不校验；填入发布签名的 SHA-256 指纹（小写无冒号）后启用
    // 获取方式：keytool -printcert -jarfile your.apk （取 SHA256: 后的值，去冒号转小写）
    private static final String EXPECTED_APK_SIGNATURE_SHA256 = "";

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

    // 云端激活 API
    private static final String ACTIVATE_API_URL = "https://tcm-prescription-system.pages.dev/api/license/validate";
    private static final int ACTIVATE_TIMEOUT_MS = 15000;

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
    // ========================================================================
    public boolean verifyApkSignature() {
        if (EXPECTED_APK_SIGNATURE_SHA256 == null || EXPECTED_APK_SIGNATURE_SHA256.isEmpty()) {
            // 未配置预期签名，跳过校验（开发阶段）
            return true;
        }
        try {
            android.content.pm.PackageInfo pi = context.getPackageManager().getPackageInfo(
                    packageName, android.content.pm.PackageManager.GET_SIGNATURES);
            if (pi == null || pi.signatures == null || pi.signatures.length == 0) {
                Log.e(TAG, "APK 签名校验：未找到签名");
                return false;
            }
            for (android.content.pm.Signature sig : pi.signatures) {
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
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            SecretKeySpec keySpec = new SecretKeySpec(
                    LICENSE_HMAC_KEY.getBytes(StandardCharsets.UTF_8), "HmacSHA256");
            mac.init(keySpec);
            byte[] hash = mac.doFinal(content.getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder();
            for (byte b : hash) {
                sb.append(String.format("%02x", b));
            }
            return sb.toString();
        } catch (Exception e) {
            Log.e(TAG, "HMAC-SHA256 计算失败", e);
            return "";
        }
    }

    // 签名验证（先 v3，再 v2，最后 v1 向后兼容）
    private boolean verifySignature(JSONObject data) {
        String sig = data.optString("signature", "");
        if (sig == null || sig.isEmpty()) return false;
        // ★ v3 签名优先校验（含 clinicName/machineId/licenseBinding 时使用）
        if (data.has("clinicName") && data.has("machineId") && data.has("licenseBinding")) {
            String expectedV3 = generateSignatureV3(data);
            if (sig.equalsIgnoreCase(expectedV3)) return true;
        }
        // v2 签名校验
        String expectedV2 = generateSignature(data);
        if (sig.equalsIgnoreCase(expectedV2)) return true;
        // v1 向后兼容：仅当旧版 license（无 maxPrescriptions 和 features 字段）才尝试 v1
        if (!data.has("maxPrescriptions") && !data.has("features")) {
            String expectedV1 = generateSignatureV1(data);
            return sig.equalsIgnoreCase(expectedV1);
        }
        return false;
    }

    // ========================================================================
    //  文件读写
    // ========================================================================
    private File getFile(String name) {
        return new File(context.getFilesDir(), name);
    }

    // license.dat: Base64(JSON)
    public JSONObject readLicense() {
        try {
            File f = getFile(LICENSE_FILE);
            if (!f.exists()) return null;
            byte[] bytes = readFileBytes(f);
            String content = new String(bytes, StandardCharsets.UTF_8).trim();
            String json = new String(Base64.decode(content, Base64.DEFAULT), StandardCharsets.UTF_8);
            return new JSONObject(json);
        } catch (Exception e) {
            Log.e(TAG, "读取 license 失败: " + e.getMessage());
            return null;
        }
    }

    public boolean writeLicenseContent(String base64Content) {
        try {
            File f = getFile(LICENSE_FILE);
            try (FileOutputStream fos = new FileOutputStream(f)) {
                fos.write(base64Content.trim().getBytes(StandardCharsets.UTF_8));
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

    // trial.dat: Base64(XOR(JSON))
    private JSONObject readTrial() {
        try {
            File f = getFile(TRIAL_FILE);
            if (!f.exists()) return null;
            byte[] bytes = readFileBytes(f);
            String content = new String(bytes, StandardCharsets.UTF_8).trim();
            String json = xorDecrypt(content, TRIAL_KEY);
            if (json == null) return null;
            return new JSONObject(json);
        } catch (Exception e) {
            return null;
        }
    }

    private void writeTrial(JSONObject trial) {
        try {
            File f = getFile(TRIAL_FILE);
            String encrypted = xorEncrypt(trial.toString(), TRIAL_KEY);
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

    // last-run.dat: Base64(XOR(JSON{timestamp}))
    private JSONObject readLastRun() {
        try {
            File f = getFile(LASTRUN_FILE);
            if (!f.exists()) return null;
            byte[] bytes = readFileBytes(f);
            String content = new String(bytes, StandardCharsets.UTF_8).trim();
            String json = xorDecrypt(content, LASTRUN_KEY);
            if (json == null) return null;
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
            String encrypted = xorEncrypt(data.toString(), LASTRUN_KEY);
            try (FileOutputStream fos = new FileOutputStream(f)) {
                fos.write(encrypted.getBytes(StandardCharsets.UTF_8));
                fos.flush();
            }
        } catch (Exception e) {
            Log.e(TAG, "写入 last-run 失败", e);
        }
    }

    // prescription-count.dat: Base64(XOR(JSON{YYYY-MM: count})))
    private JSONObject readCounts() {
        try {
            File f = getFile(COUNT_FILE);
            if (!f.exists()) return new JSONObject();
            byte[] bytes = readFileBytes(f);
            String content = new String(bytes, StandardCharsets.UTF_8).trim();
            String json = xorDecrypt(content, COUNT_KEY);
            if (json == null) return new JSONObject();
            return new JSONObject(json);
        } catch (Exception e) {
            return new JSONObject();
        }
    }

    private void writeCounts(JSONObject counts) {
        try {
            File f = getFile(COUNT_FILE);
            String encrypted = xorEncrypt(counts.toString(), COUNT_KEY);
            try (FileOutputStream fos = new FileOutputStream(f)) {
                fos.write(encrypted.getBytes(StandardCharsets.UTF_8));
                fos.flush();
            }
        } catch (Exception e) {
            Log.e(TAG, "写入计数失败", e);
        }
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
            String expected = hmacSha256WithKey(signContent, CONFIG_SIGN_KEY);
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
        if (localMachineId == null) localMachineId = "";
        long now = System.currentTimeMillis();
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
            JSONObject rawLicense = readLicense();
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
                return failResult(respJson.optString("message", "激活失败"));
            }

            // 获取 license base64 并写入文件
            String licenseBase64 = respJson.optString("license", "");
            if (licenseBase64 == null || licenseBase64.isEmpty()) {
                recordActivateFailure();
                return failResult("服务器返回的 license 数据为空");
            }
            if (!writeLicenseContent(licenseBase64)) {
                recordActivateFailure();
                return failResult("写入 license 文件失败");
            }

            // 清除 trial 文件（已正式激活）
            try { getFile(TRIAL_FILE).delete(); } catch (Exception ignored) {}

            // ★ 激活成功，重置失败计数
            resetActivateFailCount();

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

    private String readStream(InputStream is) throws Exception {
        java.io.ByteArrayOutputStream baos = new java.io.ByteArrayOutputStream();
        byte[] buffer = new byte[8192];
        int len;
        while ((len = is.read(buffer)) > 0) {
            baos.write(buffer, 0, len);
        }
        return baos.toString("UTF-8");
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
