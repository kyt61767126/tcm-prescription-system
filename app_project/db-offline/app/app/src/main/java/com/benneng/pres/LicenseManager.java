package com.benneng.pres;

// ============================================================================
//  LicenseManager — APP 端授权管理（与桌面版 license-manager.js v2 一致）
//  功能：
//   - license.dat 校验（HMAC-SHA256 签名，v2 含 maxPrescriptions/features）
//   - 试用模式（7 天，AES-256-CBC 加密存储）
//   - 防时间回拨
//   - 在线激活（HTTP POST 云端 /api/license/claim 统一认领门面）
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
import java.math.BigInteger;
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
            "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEq+n38Pe0t0cDjNyoXTgXAyofbl01\n" +
            "sbaJBMVtUy6+MGwbFCo+YBY+mrmyRBweSL/e1bj9qsUHawEsR9B7PzYSBA==\n" +
            "-----END PUBLIC KEY-----";

    // ★ P1-[5.1][5.3] 新增：Ed25519 验签公钥（原始 32 字节 hex，RFC 8032）
    // 用于验证 license 中 signatureV7 字段（云端 Ed25519 私钥签发，工具 tools/gen-ed25519-keys.cjs）
    // 公钥只能验签不能签发，即使被反编译提取也无法伪造 license
    // 注意：minSdk=24 不支持 Android 原生 EdDSA（需 API 33+），故用下方纯 Java 实现（Ed25519 类）
    private static final String ED25519_VERIFY_PUBLIC_KEY_HEX =
            "22c2cdffeeeb8831c6423f0600905e53d92e4865e054489462abd396b6cfdabc";

    // ★ 密钥轮换兼容（2026-08-26 修复）：轮换前的旧公钥（P0-2 于 2026-08-26 轮换全部非对称密钥对）
    // 背景：轮换密钥后，客户端若只内置新公钥，存量用户 license（轮换前旧私钥签发的
    //      signatureV5/V6/V7）在新版 APK 上验签必然失败 → fail-closed → 误报
    //      "授权文件已损坏或被篡改"（违反"宁可漏检不可误报"红线）。
    // 修复：v5/v6/v7 验签按【新公钥 → 旧公钥】顺序尝试，任一通过即放行：
    //   - 轮换后签发的 license → 新公钥验过 ✓
    //   - 轮换前签发的存量 license → 旧公钥验过 ✓
    //   - 篡改的 license → 两个公钥都验不过 → 仍 fail-closed 拒绝（非对称保护不降级）
    // ⚠️ 下次密钥轮换时：把当前主公钥常量的值挪到 legacy 常量，再生成新密钥对填入主常量。
    // ⚠️ 移除时机：存量 license 全部过期/重新激活后（建议保留 ≥1 个授权周期）。
    private static final String LEGACY_ECDSA_VERIFY_PUBLIC_KEY_PEM =
            "-----BEGIN PUBLIC KEY-----\n" +
            "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEXqspDCFxlyS9wH0Kyb/fR9sqOeAG\n" +
            "DurLP5B6cwCvAhMF8Lvlzv9nnvdEWdY0+GytTCUsXWrBbDDgLrOufN1NNw==\n" +
            "-----END PUBLIC KEY-----";

    private static final String LEGACY_ED25519_VERIFY_PUBLIC_KEY_HEX =
            "f1b58e1d305ebdb856743fff7e400e60ec96ca0207f7b414aa5284673a221f33";

    // ★ 密钥轮换兼容：验签公钥列表（新→旧依次尝试）
    private static final String[] ECDSA_VERIFY_PUBLIC_KEYS = {
            ECDSA_VERIFY_PUBLIC_KEY_PEM, LEGACY_ECDSA_VERIFY_PUBLIC_KEY_PEM
    };
    private static final String[] ED25519_VERIFY_PUBLIC_KEYS = {
            ED25519_VERIFY_PUBLIC_KEY_HEX, LEGACY_ED25519_VERIFY_PUBLIC_KEY_HEX
    };

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

    // ★ APK 签名校验（防反编译重打包）★ P1-2 签名哈希碎片化存储
    // 明文 64 位哈希不再以单一字符串常量出现（防 smali/strings 静态搜索定位后篡改）：
    //   拆 4 片×16 hex 字符，每片先按位移 shift 做十六进制替换（(d+shift)%16），再整体反序存储；
    //   运行时由 expectedApkSignatureSha256() 重组比对。由 generate-sign-hash.ps1 自动注入。
    //   四片全空 = 未注入（开发阶段跳过校验，与旧版"留空则不校验"语义一致）；
    //   部分为空/含非 hex 字符 = 注入残缺或被篡改，重组结果必不匹配（fail-closed）。
private static final String[] SIGN_FRAGMENTS = { "e732e1ff809370a3", "5a8ef1c7e839c26d", "18b6016d5f5e10b9", "7de404a9fd32000b" };
    private static final int[] SIGN_FRAGMENT_SHIFTS = { 5, 11, 3, 9 };

    private static volatile String sExpectedApkSignature = null;

    /** ★ P1-2：运行时重组碎片得到期望签名 SHA-256（静态缓存；格式非法时返回不可能匹配的占位串） */
    private static String expectedApkSignatureSha256() {
        if (sExpectedApkSignature != null) return sExpectedApkSignature;
        StringBuilder sb = new StringBuilder(64);
        boolean valid = true;
        for (int i = 0; i < SIGN_FRAGMENTS.length && valid; i++) {
            String frag = SIGN_FRAGMENTS[i];
            if (frag == null || frag.isEmpty()) continue;  // 空片跳过：全空=未配置，部分空=重组不完整必失败
            if (i >= SIGN_FRAGMENT_SHIFTS.length) { valid = false; break; }
            int shift = SIGN_FRAGMENT_SHIFTS[i];
            for (int j = frag.length() - 1; j >= 0; j--) {   // 反序还原
                int d = Character.digit(frag.charAt(j), 16);
                if (d < 0) { valid = false; break; }         // 非 hex 字符=被篡改
                sb.append(Character.forDigit((d - shift + 16) % 16, 16));
            }
        }
        sExpectedApkSignature = valid ? sb.toString() : "#invalid-fragment#";
        if (!valid) Log.e(TAG, "签名哈希碎片格式非法（疑似被篡改），按校验失败处理");
        return sExpectedApkSignature;
    }

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
    // ★ 第三轮终检 P1-3 新增：两个状态文件的 AES 加密格式前缀（与 TRIAL1:/LASTRUN1: 机制一致）
    private static final String VERIFYSTATE_ENC_PREFIX = "VSTATE1:";
    private static final String ACTREC_ENC_PREFIX = "ACTREC1:";
    // ★ 第三轮终检 P1-2 新增：试用期天数 HMAC 签名 key（防 root 直接改 license_config.xml 明文延长试用）
    private static final String PREF_KEY_TRIAL_DAYS_SIG = "trial_days_sig";
    // ★ APP版可写 config.json 路径（filesDir 副本，首次从 assets 复制，激活后可修改 clinicName/doctorName）
    private static final String CONFIG_FILE = "config.json";

    // 云端激活 API
    // ★ P2 服务端收口（KNOWLEDGE 条目三十七）：激活统一走 claim 门面
    //   （claim = validate 业务逻辑 + machineId schema-guard 前置守门，行为等价对拍保证）
    private static final String ACTIVATE_API_URL = "https://tcm-prescription-system.pages.dev/api/license/claim";
    // ★ P1-1 在线验证 API（定期校验授权有效性）
    private static final String VERIFY_API_URL = "https://tcm-prescription-system.pages.dev/api/license/verify";
    // ★ 2026-08-15 防重复试用：试用注册 API（硬件指纹判重）
    private static final String TRIAL_REGISTER_API_URL = "https://tcm-prescription-system.pages.dev/api/trial/register";
    // ★ 2026-09-06 原生领码自愈：管理员激活状态查询 API（machineId 兜底查询，
    //   服务端语义：仅返回绑定该 machineId 的 license，无账号写操作，安全边界不变）
    private static final String ADMIN_STATUS_API_URL = "https://tcm-prescription-system.pages.dev/api/license/admin-status";
    // ★ 2026-09-06 原生领码自愈：节流（冷启动+onResume 双触发，60s 内不重复查询）
    private static final long NATIVE_SYNC_THROTTLE_MS = 60_000L;
    private static volatile long sLastNativeSyncAt = 0L;
    // ★ 2026-09-06 并发安装互斥：JS 自愈（桥线程）与 Java 原生自愈（后台线程）可能
    //   同时调 installAdminLicense 并发写 config.json → 静态锁串行化（跨实例生效）
    private static final Object sInstallLock = new Object();
    // ★ 试用次数阈值（与后端 MAX_TRIALS 一致）
    private static final int MAX_TRIALS = 1;   // 2026-08-16：一个设备一次试用（防卸载重装刷试用）
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
    // ★ 2026-08-26 完整性基线误报修复：versionName 恒为 "1.0.0" 从不变化，
    //   覆盖安装新版（auth-core.js 已改）后旧基线不匹配 → 误报"文件被篡改"。
    //   基线 key 改用 versionCode（每次重打包必递增），升级自动重建基线。
    private final long versionCode;

    public LicenseManager(Context context) {
        this.context = context;
        this.packageName = context.getPackageName();
        String version = "1.0";
        long code = 0;
        try {
            PackageInfo pi = context.getPackageManager().getPackageInfo(packageName, 0);
            if (pi != null && pi.versionName != null) version = pi.versionName;
            if (pi != null) code = pi.versionCode;
        } catch (PackageManager.NameNotFoundException e) {
            Log.w(TAG, "无法获取版本号，使用默认 1.0");
        }
        this.versionName = version;
        this.versionCode = code;
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
    //  ★ 2026-08-15 防重复试用：硬件指纹（防卸载重装重置试用）
    //  组合 ANDROID_ID + Build.SERIAL + Build.MODEL + Build.FINGERPRINT + manufacturer
    //  SHA256 → 64位 hex，与后端 hwFp 校验格式一致
    // ========================================================================
    public String getHwFingerprint() {
        try {
            String androidId = Settings.Secure.getString(
                    context.getContentResolver(), Settings.Secure.ANDROID_ID);
            if (androidId == null) androidId = "";
            String serial = "";
            try { serial = Build.SERIAL; } catch (Exception e) { }
            if (serial == null) serial = "";
            String model = Build.MODEL != null ? Build.MODEL : "";
            String manufacturer = Build.MANUFACTURER != null ? Build.MANUFACTURER : "";
            String fingerprint = Build.FINGERPRINT != null ? Build.FINGERPRINT : "";
            String src = androidId + "|" + serial + "|" + manufacturer + "|" + model + "|" + fingerprint;
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] hash = md.digest(src.getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder();
            for (byte b : hash) {
                sb.append(String.format("%02x", b));
            }
            return sb.toString();
        } catch (Exception e) {
            Log.e(TAG, "生成硬件指纹失败", e);
            // 失败时回退到 machineId 补齐到 64 位（保证格式合法，弱化指纹）
            String mid = getMachineId();
            String padded = mid + mid + mid + mid;
            return padded.substring(0, 64);
        }
    }

    // ========================================================================
    //  ★ 2026-08-15 防重复试用：云端试用注册（宽限模式）
    //  行为：首次创建试用时上报硬件指纹，云端判定是否允许。
    //  宽限模式：网络不可用/超时/解析失败时默认允许（返回 true），不阻断首次使用；
    //  仅当云端明确返回 allowed=false（次数超限）时才拒绝。
    //  返回：true=允许试用，false=云端拒绝（试用次数已达上限）
    // ========================================================================
    public boolean registerTrialOnline() {
        HttpURLConnection conn = null;
        try {
            URL url = new URL(TRIAL_REGISTER_API_URL);
            conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("POST");
            conn.setRequestProperty("Content-Type", "application/json; charset=UTF-8");
            conn.setRequestProperty("Accept", "application/json");
            conn.setConnectTimeout(8000);
            conn.setReadTimeout(8000);
            conn.setDoOutput(true);

            JSONObject reqBody = new JSONObject();
            reqBody.put("hwFp", getHwFingerprint());
            reqBody.put("machineId", getMachineId());
            reqBody.put("productName", "惠康中医");
            reqBody.put("edition", "offline");
            reqBody.put("appMode", "app");

            try (OutputStream os = conn.getOutputStream()) {
                os.write(reqBody.toString().getBytes(StandardCharsets.UTF_8));
                os.flush();
            }

            int codeResp = conn.getResponseCode();
            InputStream is = (codeResp >= 200 && codeResp < 400) ? conn.getInputStream() : conn.getErrorStream();
            if (is == null) return true; // 宽限：无响应默认允许
            String response = readStream(is);
            Log.i(TAG, "试用注册响应: " + response);
            JSONObject respJson = new JSONObject(response);

            if (respJson.optBoolean("success", false)) {
                return respJson.optBoolean("allowed", true);
            }
            return true; // 云端返回非成功，宽限默认允许
        } catch (java.net.SocketTimeoutException e) {
            Log.w(TAG, "试用注册超时（宽限允许）", e);
            return true;
        } catch (java.net.UnknownHostException e) {
            Log.w(TAG, "试用注册无法连接（宽限允许）", e);
            return true;
        } catch (Exception e) {
            Log.w(TAG, "试用注册异常（宽限允许）", e);
            return true;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    // ========================================================================
    //  ★ 2026-09-06 原生领码自愈（架构级根治"激活成功后仍显示试用7天"老问题）
    //
    //  历史病灶：license.dat 的落盘完全依赖 JS WebView 层 4 条链路（Tab1 轮询 /
    //  断点续传 resumeAdminPendingRequest / 存量自愈 healMissingDesktopLicenseFile /
    //  手动重激），任一环节断链（WebView 切后台被杀/桥序列化异常/用户不开设置页/
    //  审批滞后于会话）= 服务端已 activated 但本地无 license → 登录后授权区
    //  一直显示"试用期剩余X天"，用户被迫手动重新激活。桌面端 2026-09-05 已把
    //  自愈下沉到主进程（app.whenReady 断点续传），APP 的 Java 层一直没有对等物。
    //
    //  本方法 = APP 的 Java 原生兜底权威：本地无可解密 license.dat 时，凭本机
    //  machineId 查询 admin-status（服务端仅返回绑定该机器的 license，无账号
    //  副作用），命中已激活 → 复用 installAdminLicense 原生落盘（写 license.dat
    //  + 删 trial + 同步 config + UPSERT 账号[密码保留]）。与 JS 层自愈并存：
    //  JS 是快路径，Java 是每次冷启动/onResume 必跑的权威兜底，不再依赖任何
    //  UI 会话存活。
    //
    //  触发点：MainActivity 冷启动（continueStartupAfterLicenseCheck）+ onResume
    //  （用户从官网付款页切回 APP 的关键时刻）。60s 静态节流防重复。
    //  宽容失败：网络异常/未激活/已授权 一律静默返回，绝不阻断启动。
    // ========================================================================
    public interface NativeSyncCallback {
        void onLicenseInstalled();
    }

    public boolean syncLicenseFromServer(NativeSyncCallback cb) {
        long now = System.currentTimeMillis();
        if (now - sLastNativeSyncAt < NATIVE_SYNC_THROTTLE_MS) return false;
        sLastNativeSyncAt = now;
        HttpURLConnection conn = null;
        try {
            String mid = getMachineId();
            if (mid == null || mid.isEmpty()) {
                Log.w(TAG, "[NativeSync] machineId 为空，跳过原生领码自愈");
                return false;
            }
            // ★ 2026-09-06 回归修复（严重）：门控——本地必须已存在注册账号（非内置admin）
            //   才允许原生领码。全新安装（删数据/重装）时服务端仍残留本机 machineId 的
            //   历史激活记录，若不门控会：①冷启动直接装 license 跳过注册页；②账号不存在
            //   时 syncCreateActivationUser 用默认密码 admin 建号，与用户激活表单密码
            //   错位 → 付款激活后无法登入。注册（建号）与激活（license）是两个独立阶段，
            //   license 恢复永远不得先于/跳过注册建号。
            if (!hasRegisteredLocalAccount()) {
                Log.d(TAG, "[NativeSync] 本地无注册账号（全新安装未注册），跳过原生领码自愈");
                return false;
            }
            // 已有本地 license（可解密）→ 无需同步（已授权=正常；已过期=重装同一张
            // license 无意义，走续费流程）
            if (readLicense(mid) != null) {
                Log.d(TAG, "[NativeSync] 本地 license.dat 已存在，跳过原生领码自愈");
                return false;
            }
            URL url = new URL(ADMIN_STATUS_API_URL + "?machineId=" +
                    java.net.URLEncoder.encode(mid, "UTF-8"));
            conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("GET");
            conn.setRequestProperty("Accept", "application/json");
            conn.setConnectTimeout(8000);
            conn.setReadTimeout(8000);
            int rc = conn.getResponseCode();
            InputStream is = (rc >= 200 && rc < 400) ? conn.getInputStream() : conn.getErrorStream();
            if (is == null) return false;
            String response = readStream(is);
            Log.i(TAG, "[NativeSync] admin-status 响应: " + response);
            JSONObject resp = new JSONObject(response);
            if (!resp.optBoolean("success", false)) return false;
            if (!"activated".equals(resp.optString("status", ""))) return false;
            String license = resp.optString("license", "");
            if (license == null || license.isEmpty()) {
                Log.w(TAG, "[NativeSync] 服务端已激活但 license 为空，跳过");
                return false;
            }
            JSONObject li = resp.optJSONObject("licenseInfo");
            String user = (li != null) ? li.optString("user", "") : "";
            String clinicName = (li != null) ? li.optString("clinicName", "") : "";
            String phone = (li != null) ? li.optString("phone", "") : "";
            String licenseCode = (li != null) ? li.optString("licenseCode", "") : "";
            // password 传空：账号已存在（注册创建）时 installAdminLicense UPSERT
            // 保留原密码（2026-09-04 方案B 密码写点唯一化），不会重置注册密码；
            // loginUsername=phone：登录账号=手机号（与 JS 自愈/激活收尾路径一致）
            JSONObject inst = installAdminLicense(license, mid, user, clinicName,
                    "", phone, phone, licenseCode);
            if (inst != null && inst.optBoolean("success", false)) {
                Log.i(TAG, "[NativeSync] 原生领码自愈成功：服务端已激活 → license.dat 已落盘");
                if (cb != null) {
                    try { cb.onLicenseInstalled(); } catch (Exception ce) {
                        Log.w(TAG, "[NativeSync] 回调异常(不影响落盘): " + ce.getMessage());
                    }
                }
                return true;
            }
            Log.w(TAG, "[NativeSync] 原生落盘失败: " + ((inst != null) ? inst.optString("error", "") : "null"));
            return false;
        } catch (java.net.SocketTimeoutException e) {
            Log.w(TAG, "[NativeSync] 查询超时（静默跳过）");
            return false;
        } catch (java.net.UnknownHostException e) {
            Log.w(TAG, "[NativeSync] 无法连接服务器（静默跳过）");
            return false;
        } catch (Exception e) {
            Log.w(TAG, "[NativeSync] 原生领码自愈异常（静默跳过）: " + e.getMessage());
            return false;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    // ========================================================================
    //  ★ 2026-09-06 架构重构：单一装码入口（JS 显式调用）
    //
    //  历史病灶：JS 层 4 条装码链路（Tab1 轮询 / observer / 断点续传 / 存量自愈）
    //  各自 fetch license 并写盘，与 Java 冷启动原生自愈三路并发、竞态写
    //  license.dat/config.json。重构后 JS 检测到 activated 一律调本方法：
    //    · 同步返回明确状态（installed/pending/unregistered/already_licensed/error）
    //    · 不节流（JS 显式触发，由 sInstallLock 串行化防并发写）
    //    · 注册门控不放松（license 恢复永不得先于注册建号）
    //  冷启动 syncLicenseFromServer 保留为兜底（节流+静默）。
    //
    //  注意：本方法在桥线程同步执行（AndroidNative.invoke），含 8s 超时网络请求，
    //  不得在 UI 线程调用（JS 桥 @JavascriptInterface 本身在 binder 线程）。
    // ========================================================================
    public JSONObject installLicenseFromServerBridge(String machineId) {
        HttpURLConnection conn = null;
        try {
            String mid = (machineId == null || machineId.isEmpty()) ? getMachineId() : machineId;
            if (mid == null || mid.isEmpty()) return failResult("无法获取本机设备标识");
            if (!hasRegisteredLocalAccount()) {
                JSONObject r = new JSONObject();
                r.put("success", true); r.put("status", "unregistered");
                r.put("message", "本地无注册账号，请先完成注册");
                return r;
            }
            if (readLicense(mid) != null) {
                JSONObject r = new JSONObject();
                r.put("success", true); r.put("status", "already_licensed");
                r.put("message", "本机授权已存在，无需重复安装");
                return r;
            }
            URL url = new URL(ADMIN_STATUS_API_URL + "?machineId=" +
                    java.net.URLEncoder.encode(mid, "UTF-8"));
            conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("GET");
            conn.setRequestProperty("Accept", "application/json");
            conn.setConnectTimeout(8000);
            conn.setReadTimeout(8000);
            int rc = conn.getResponseCode();
            InputStream is = (rc >= 200 && rc < 400) ? conn.getInputStream() : conn.getErrorStream();
            if (is == null) return failResult("服务器无响应（HTTP " + rc + "），请稍后重试");
            String response = readStream(is);
            Log.i(TAG, "[BridgeInstall] admin-status 响应: " + response);
            JSONObject resp = new JSONObject(response);
            if (!resp.optBoolean("success", false)) {
                return failResult(resp.optString("error", "订单状态查询失败"));
            }
            String st = resp.optString("status", "");
            if (!"activated".equals(st)) {
                JSONObject r = new JSONObject();
                r.put("success", true);
                r.put("status", "pending_payment".equals(st) ? "pending_payment" : "pending");
                r.put("message", "pending_payment".equals(st) ? "订单待付款" : "订单审核中");
                return r;
            }
            String license = resp.optString("license", "");
            if (license == null || license.isEmpty()) {
                return failResult("服务端已激活但 license 数据为空，请联系客服");
            }
            JSONObject li = resp.optJSONObject("licenseInfo");
            String user = (li != null) ? li.optString("user", "") : "";
            String clinicName = (li != null) ? li.optString("clinicName", "") : "";
            String phone = (li != null) ? li.optString("phone", "") : "";
            String licenseCode = (li != null) ? li.optString("licenseCode", "") : "";
            JSONObject inst = installAdminLicense(license, mid, user, clinicName,
                    "", phone, phone, licenseCode);
            if (inst != null && inst.optBoolean("success", false)) {
                Log.i(TAG, "[BridgeInstall] 单一装码入口成功：license.dat 已落盘");
                JSONObject r = new JSONObject();
                r.put("success", true); r.put("status", "installed");
                r.put("message", "激活成功");
                return r;
            }
            return failResult((inst != null) ? inst.optString("error", "license 安装失败") : "license 安装失败");
        } catch (java.net.SocketTimeoutException e) {
            return failResult("查询超时，请检查网络后重试");
        } catch (java.net.UnknownHostException e) {
            return failResult("无法连接服务器，请检查网络后重试");
        } catch (Exception e) {
            Log.w(TAG, "[BridgeInstall] 装码异常: " + e.getMessage());
            return failResult("装码异常：" + e.getMessage());
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    // ========================================================================
    //  ★ 2026-09-06 架构重构：激活流程状态持久化（config.json 独立字段 activationFlow）
    //
    //  { orderNo, requestId, status: 'pending_payment'|'pending'|..., edition,
    //    phone, updatedAt }
    //  独立字段不参与 configSignature 签名（签名内容仅
    //  clinicName|doctorName|edition|configIssuedAt），故 needSign=false 写入，
    //  完整性校验不受影响。localStorage 丢失/WebView 数据清除后流程仍可恢复。
    // ========================================================================
    public JSONObject setActivationFlowState(String json) {
        try {
            JSONObject cfg = readConfigJSON();
            if (cfg == null) cfg = new JSONObject();
            if (json == null || json.trim().isEmpty()) {
                cfg.remove("activationFlow");
            } else {
                JSONObject state;
                try { state = new JSONObject(json); }
                catch (Exception pe) { return failResult("流程状态数据格式错误"); }
                state.put("updatedAt", String.valueOf(System.currentTimeMillis()));
                cfg.put("activationFlow", state);
            }
            boolean ok = writeConfigJSON(cfg, false);
            Log.i(TAG, "[FlowState] 保存" + (ok ? "成功" : "失败") + ": " +
                    (json == null || json.trim().isEmpty() ? "(已清除)" : json));
            JSONObject r = new JSONObject();
            r.put("success", ok);
            if (!ok) r.put("error", "config.json 写入失败");
            return r;
        } catch (Exception e) {
            Log.w(TAG, "[FlowState] 保存异常: " + e.getMessage());
            return failResult("流程状态保存异常：" + e.getMessage());
        }
    }

    public JSONObject getActivationFlowState() {
        JSONObject r = new JSONObject();
        try {
            JSONObject cfg = readConfigJSON();
            JSONObject state = (cfg != null) ? cfg.optJSONObject("activationFlow") : null;
            r.put("success", true);
            r.put("state", state != null ? state : new JSONObject());
        } catch (Exception e) {
            try { r.put("success", false); r.put("error", e.getMessage()); }
            catch (Exception ignored) {}
        }
        return r;
    }

    // ★ 2026-09-06 门控辅助：config.users 是否存在注册账号（用户名非内置 admin）。
    //   registerLocalUser（注册）/激活建号均以手机号为 username；全新安装仅有
    //   内置 admin（或空）→ false。作为原生领码自愈的前置门，杜绝 license 恢复
    //   劫持全新安装的 注册→激活 标准流程。
    private boolean hasRegisteredLocalAccount() {
        try {
            JSONObject cfg = readConfigJSON();
            if (cfg == null) return false;
            org.json.JSONArray users = cfg.optJSONArray("users");
            if (users == null) return false;
            for (int i = 0; i < users.length(); i++) {
                org.json.JSONObject u = users.optJSONObject(i);
                if (u != null) {
                    String uname = u.optString("username", "");
                    if (!uname.isEmpty() && !"admin".equals(uname)) return true;
                }
            }
        } catch (Exception e) {
            Log.w(TAG, "[NativeSync] 读注册账号失败(视为未注册): " + e.getMessage());
        }
        return false;
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
    //  ★ P1-1（2026-08-26）：native/Java 双路交叉校验 + 完整性状态参与业务决策
    //    - 双路一致通过 → 放行（INTEGRITY_OK）
    //    - 双路一致失败 → 真篡改，拒绝（INTEGRITY_FAIL，原有行为）
    //    - native 不可用 → 仅 Java 校验（INTEGRITY_NATIVE_UNAVAILABLE，原有降级）
    //    - ★ 双路结果分叉 → 安全层被 hook/替换（stub .so 恒真 / hook Java 比对），
    //      本地结论不可信 → 走云端验证仲裁（arbitrateIntegrityViaCloud）
    // ========================================================================
    // 完整性状态常量（verifyOnline 上报服务端审计用）
    public static final int INTEGRITY_OK = 0;                  // 双路一致通过
    public static final int INTEGRITY_NATIVE_UNAVAILABLE = 1;  // .so 缺失，仅 Java 校验通过
    public static final int INTEGRITY_INCONSISTENT = 2;        // native/Java 分叉（疑似 hook）
    public static final int INTEGRITY_FAIL = 3;                // 双路一致失败（真篡改）

    private volatile int lastIntegrityState = INTEGRITY_OK;

    /** 最近一次签名校验的完整性状态（供业务决策/云端上报审计） */
    public int getLastIntegrityState() {
        return lastIntegrityState;
    }

    public boolean verifyApkSignature() {
        if (expectedApkSignatureSha256().isEmpty()) {
            // 未配置预期签名，跳过校验（开发阶段）
            lastIntegrityState = INTEGRITY_OK;
            return true;
        }
        try {
            android.content.pm.Signature[] signatures = getApkSignatures();
            if (signatures == null || signatures.length == 0) {
                Log.e(TAG, "APK 签名校验：未找到签名");
                lastIntegrityState = INTEGRITY_FAIL;
                return false;
            }
            boolean javaPass = javaVerifyApkSignature(signatures);
            // ★ P0-NDK：native 可用时与 Java 双路交叉校验；不可用时回退 Java，绝不闪退
            if (!NativeGuard.isAvailable()) {
                lastIntegrityState = javaPass ? INTEGRITY_NATIVE_UNAVAILABLE : INTEGRITY_FAIL;
                return javaPass;
            }
            boolean nativePass = true;
            for (android.content.pm.Signature sig : signatures) {
                if (!NativeGuard.verifyApkSignature(
                        sig.toByteArray(), expectedApkSignatureSha256())) {
                    nativePass = false;
                    break;
                }
            }
            if (nativePass && javaPass) {
                lastIntegrityState = INTEGRITY_OK;
                return true;
            }
            if (!nativePass && !javaPass) {
                lastIntegrityState = INTEGRITY_FAIL;
                Log.e(TAG, "APK 签名校验：native/Java 双路一致失败（真篡改）expected=" +
                        expectedApkSignatureSha256());
                return false;
            }
            // ★ P1-1：双路分叉。同一输入+同算法+同常量，正常情况下不可能分叉；
            //   分叉说明其中一路被 hook/替换，本地结论不可信 → 云端 license verify 仲裁
            //   （服务端真实查 KV 激活码记录+设备绑定，本地伪造无法通过）。
            lastIntegrityState = INTEGRITY_INCONSISTENT;
            Log.e(TAG, "APK 签名校验：native=" + nativePass + " java=" + javaPass +
                    " 结果不一致（安全层疑似被 hook），转云端仲裁");
            return arbitrateIntegrityViaCloud();
        } catch (Exception e) {
            Log.e(TAG, "APK 签名校验异常", e);
            lastIntegrityState = INTEGRITY_FAIL;
            return false;
        }
    }

    /** Java 路签名校验：对签名证书数组逐一计算 SHA-256 与期望指纹比对（从原方法抽出） */
    private boolean javaVerifyApkSignature(android.content.pm.Signature[] signatures) throws Exception {
        for (android.content.pm.Signature sig : signatures) {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] digest = md.digest(sig.toByteArray());
            StringBuilder sb = new StringBuilder();
            for (byte b : digest) {
                sb.append(String.format("%02x", b));
            }
            String fingerprint = sb.toString();
            if (expectedApkSignatureSha256().equalsIgnoreCase(fingerprint)) {
                return true;
            }
            Log.e(TAG, "APK 签名校验：Java 指纹不匹配 expected=" + expectedApkSignatureSha256() +
                    " actual=" + fingerprint);
        }
        return false;
    }

    /**
     * ★ P1-1：完整性不一致时的云端仲裁（"不一致走云端验证"）。
     * 网络 IO 放后台线程（validateLicense 可能在主线程被调用，直接联网会
     * NetworkOnMainThreadException），当前线程 CountDownLatch 有界等待 4s。
     *  - 云端可达且 license/设备有效 → 放行（服务端 verify 日志已记录该设备行为，可追溯撤销）
     *  - 云端返回无效 / 超时 → 拒绝
     * 红线评估：正常用户双路对同一输入结果必然一致，不会进入本分支，
     *           fail-closed 不误伤正常用户（"宁可漏检不可误报"针对的是正常路径误报）。
     */
    private boolean arbitrateIntegrityViaCloud() {
        try {
            final java.util.concurrent.CountDownLatch latch = new java.util.concurrent.CountDownLatch(1);
            final java.util.concurrent.atomic.AtomicBoolean verdict =
                    new java.util.concurrent.atomic.AtomicBoolean(false);
            final String mid = getMachineId();
            Thread t = new Thread(() -> {
                try {
                    JSONObject r = verifyOnline(mid);
                    verdict.set(r != null && r.optBoolean("success", false));
                } catch (Exception e) {
                    Log.w(TAG, "完整性云端仲裁请求异常: " + e.getMessage());
                    verdict.set(false);
                } finally {
                    latch.countDown();
                }
            }, "integrity-arbitration");
            t.setDaemon(true);
            t.start();
            boolean got = latch.await(4, java.util.concurrent.TimeUnit.SECONDS);
            boolean ok = got && verdict.get();
            Log.i(TAG, "完整性云端仲裁结果: " + ok + (got ? "" : "（4s 超时）"));
            return ok;
        } catch (InterruptedException ie) {
            Thread.currentThread().interrupt();
            return false;
        } catch (Exception e) {
            Log.e(TAG, "完整性云端仲裁异常", e);
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

    // ============================================================================
    //  ★ P1-[2.1] 密钥三层 + HKDF 改造（本地文件加密密钥派生升级，2026-08-19）
    //  三层结构（RFC 5869 HKDF-SHA256，与桌面版 license-manager.js 完全一致）：
    //    第一层 根密钥 IKM     = LICENSE_HMAC_KEY（静态主密钥，与激活码签名链路共用常量，不改动）
    //    第二层 设备主密钥 PRK = HKDF-Extract(salt = 设备指纹(machineId|hwFp), IKM)
    //                          绑定到具体设备：破解一台不影响其他机器、防跨机复制
    //    第三层 用途密钥 OKM   = HKDF-Expand(PRK, info = 'bnzc:local-file:v1:<用途>', 32)
    //                          license/license-hmac/trial/lastrun/count/vstate/actrec 域分离
    //  说明：
    //    1) 仅升级“本地文件加密”的密钥派生；激活码签名链路（HMAC 签名 / ECDSA v5 验签）不动。
    //    2) 旧 SHA256 派生保留为回退：存量加密文件仍可读取（HKDF → SHA256含hwFp → SHA256无hwFp
    //       三级回退），读到后重新保存即自动迁移为 HKDF 派生。
    // ============================================================================
    private static final String HKDF_SALT_PREFIX = "bnzc:local:";
    private static final String HKDF_INFO_PREFIX = "bnzc:local-file:v1:";
    private static final String HKDF_ALGO = "HmacSHA256";
    private static final int HKDF_SHA256_LEN = 32;

    // RFC 5869 HKDF-Extract: PRK = HMAC-Hash(salt, IKM)
    private byte[] hkdfExtract(byte[] salt, byte[] ikm) {
        try {
            Mac mac = Mac.getInstance(HKDF_ALGO);
            mac.init(new SecretKeySpec(salt, HKDF_ALGO));
            return mac.doFinal(ikm);
        } catch (Exception e) {
            Log.e(TAG, "HKDF-Extract 失败: " + e.getMessage());
            return null;
        }
    }

    // RFC 5869 HKDF-Expand: OKM = T(1)||...||T(N)
    // SHA-256 下 32 字节只需 1 轮：T(1) = HMAC(PRK, info || 0x01)；>32 字节走通用多轮
    private byte[] hkdfExpand(byte[] prk, byte[] info, int keylen) {
        try {
            if (keylen <= HKDF_SHA256_LEN) {
                Mac mac = Mac.getInstance(HKDF_ALGO);
                mac.init(new SecretKeySpec(prk, HKDF_ALGO));
                mac.update(info);
                mac.update((byte) 0x01);
                byte[] okm = mac.doFinal();
                if (okm.length == keylen) return okm;
                byte[] out = new byte[keylen];
                System.arraycopy(okm, 0, out, 0, keylen);
                return out;
            }
            // 多轮通用实现（keylen > 32，当前未用到，保留完整性）
            byte[] t = new byte[0];
            byte[] prev = new byte[0];
            int n = (keylen + HKDF_SHA256_LEN - 1) / HKDF_SHA256_LEN;
            for (int i = 1; i <= n; i++) {
                Mac mac = Mac.getInstance(HKDF_ALGO);
                mac.init(new SecretKeySpec(prk, HKDF_ALGO));
                mac.update(prev);
                mac.update(info);
                mac.update((byte) i);
                prev = mac.doFinal();
                byte[] nxt = new byte[t.length + prev.length];
                System.arraycopy(t, 0, nxt, 0, t.length);
                System.arraycopy(prev, 0, nxt, t.length, prev.length);
                t = nxt;
            }
            if (t.length == keylen) return t;
            byte[] out = new byte[keylen];
            System.arraycopy(t, 0, out, 0, keylen);
            return out;
        } catch (Exception e) {
            Log.e(TAG, "HKDF-Expand 失败: " + e.getMessage());
            return null;
        }
    }

    // 第三层：用途密钥（域分离，info 带独立前缀防止与激活码签名链路混淆）
    private SecretKeySpec deriveHkdfPurposeKey(String machineId, String purpose, String algo) {
        try {
            String hwFp = getHardwareFingerprint();
            String salt = HKDF_SALT_PREFIX + (machineId == null ? "" : machineId)
                    + "|" + (hwFp == null ? "" : hwFp);
            byte[] prk = hkdfExtract(salt.getBytes(StandardCharsets.UTF_8),
                    LICENSE_HMAC_KEY.getBytes(StandardCharsets.UTF_8));
            if (prk == null) return null;
            byte[] okm = hkdfExpand(prk, (HKDF_INFO_PREFIX + purpose).getBytes(StandardCharsets.UTF_8), 32);
            if (okm == null) return null;
            return new SecretKeySpec(okm, algo);  // algo = "AES" 或 "HmacSHA256"
        } catch (Exception e) {
            Log.e(TAG, "派生 HKDF 用途密钥失败(" + purpose + "): " + e.getMessage());
            return null;
        }
    }

    // ★ P1-[2.1] 各用途 HKDF 密钥（与桌面版 license-manager.js 一一对应）
    private SecretKeySpec deriveLicenseKeyHkdf(String machineId)           { return deriveHkdfPurposeKey(machineId, "license", "AES"); }
    private SecretKeySpec deriveLicenseHmacKeyHkdf(String machineId)       { return deriveHkdfPurposeKey(machineId, "license-hmac", "HmacSHA256"); }
    private SecretKeySpec deriveTrialKeyHkdf(String machineId)             { return deriveHkdfPurposeKey(machineId, "trial", "AES"); }
    private SecretKeySpec deriveLastRunKeyHkdf(String machineId)           { return deriveHkdfPurposeKey(machineId, "lastrun", "AES"); }
    private SecretKeySpec deriveCountKeyHkdf(String machineId)             { return deriveHkdfPurposeKey(machineId, "count", "AES"); }
    private SecretKeySpec deriveVerifyStateKeyHkdf(String machineId)       { return deriveHkdfPurposeKey(machineId, "vstate", "AES"); }
    private SecretKeySpec deriveActivationRecordKeyHkdf(String machineId)  { return deriveHkdfPurposeKey(machineId, "actrec", "AES"); }

    // 加密 license JSON 字符串
    // ★ P3-C 新增：加密后追加外层 HMAC 签名，文件格式 ENC2:hex(hmac):base64(iv+ciphertext)
    private String encryptLicenseContent(String jsonStr, String machineId) {
        try {
            // ★ P1-[2.1] 改用 HKDF 派生密钥（旧版读取时三级回退自动兼容）
            SecretKeySpec key = deriveLicenseKeyHkdf(machineId);
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
            // ★ P1-[2.1] 改用 HKDF 派生 HMAC 密钥
            SecretKeySpec hmacKey = deriveLicenseHmacKeyHkdf(machineId);
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
    // ★ P1-[2.1] 升级：三级回退（HKDF → SHA256含hwFp → SHA256无hwFp）
    private String decryptLicenseContent(String encryptedStr, String machineId) {
        if (encryptedStr == null) return null;
        // ★ P3-C 新增：优先尝试 ENC2 格式（含 HMAC 校验）
        if (encryptedStr.startsWith(LICENSE_ENC2_PREFIX)) {
            String rest = encryptedStr.substring(LICENSE_ENC2_PREFIX.length());
            int sep = rest.indexOf(':');
            if (sep < 0) return null;
            String storedHmac = rest.substring(0, sep);
            String base64Data = rest.substring(sep + 1);
            // 三级 HMAC 密钥候选：HKDF → 旧SHA256(含hwFp) → 最旧SHA256(无hwFp)
            boolean hmacMatched = verifyHmac(storedHmac, base64Data, deriveLicenseHmacKeyHkdf(machineId));
            if (!hmacMatched) {
                hmacMatched = verifyHmac(storedHmac, base64Data, deriveLicenseHmacKey(machineId));
            }
            if (!hmacMatched) {
                hmacMatched = verifyHmac(storedHmac, base64Data, deriveLicenseHmacKeyLegacy(machineId));
            }
            if (!hmacMatched) {
                Log.e(TAG, "HMAC 校验失败（文件可能被替换/篡改）");
                return null;
            }
            // HMAC 校验通过，解密内容（三级密钥尝试）
            String plaintext = tryDecryptAes(base64Data, deriveLicenseKeyHkdf(machineId));
            if (plaintext != null) return plaintext;
            plaintext = tryDecryptAes(base64Data, deriveLicenseKey(machineId));
            if (plaintext != null) return plaintext;
            return tryDecryptAes(base64Data, deriveLicenseKeyLegacy(machineId));
        }
        // 旧 ENC1 格式 - 向后兼容
        if (encryptedStr.startsWith(LICENSE_ENC_PREFIX)) {
            String base64Data = encryptedStr.substring(LICENSE_ENC_PREFIX.length());
            // 三级密钥尝试：HKDF → 旧SHA256(含hwFp) → 最旧SHA256(无hwFp)
            String plaintext = tryDecryptAes(base64Data, deriveLicenseKeyHkdf(machineId));
            if (plaintext != null) return plaintext;
            plaintext = tryDecryptAes(base64Data, deriveLicenseKey(machineId));
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
    // ★ P1-[2.1] 改用 HKDF 派生密钥（旧版读取时三级回退自动兼容）
    private String encryptTrialContent(String jsonStr, String machineId) {
        return aesEncrypt(jsonStr, deriveTrialKeyHkdf(machineId), TRIAL_ENC_PREFIX);
    }
    // ★ P1-[2.1] 升级：三级回退（HKDF → SHA256含hwFp → SHA256无hwFp）
    private String decryptTrialContent(String encryptedStr, String machineId) {
        if (encryptedStr == null || !encryptedStr.startsWith(TRIAL_ENC_PREFIX)) return null;
        String base64Data = encryptedStr.substring(TRIAL_ENC_PREFIX.length());
        String plaintext = tryDecryptAes(base64Data, deriveTrialKeyHkdf(machineId));
        if (plaintext != null) return plaintext;
        plaintext = tryDecryptAes(base64Data, deriveTrialKey(machineId));
        if (plaintext != null) return plaintext;
        return tryDecryptAes(base64Data, deriveTrialKeyLegacy(machineId));
    }

    // last-run 加解密
    // ★ P1-[2.1] 改用 HKDF 派生密钥（旧版读取时三级回退自动兼容）
    private String encryptLastRunContent(String jsonStr, String machineId) {
        return aesEncrypt(jsonStr, deriveLastRunKeyHkdf(machineId), LASTRUN_ENC_PREFIX);
    }
    // ★ P1-[2.1] 升级：三级回退（HKDF → SHA256含hwFp → SHA256无hwFp）
    private String decryptLastRunContent(String encryptedStr, String machineId) {
        if (encryptedStr == null || !encryptedStr.startsWith(LASTRUN_ENC_PREFIX)) return null;
        String base64Data = encryptedStr.substring(LASTRUN_ENC_PREFIX.length());
        String plaintext = tryDecryptAes(base64Data, deriveLastRunKeyHkdf(machineId));
        if (plaintext != null) return plaintext;
        plaintext = tryDecryptAes(base64Data, deriveLastRunKey(machineId));
        if (plaintext != null) return plaintext;
        return tryDecryptAes(base64Data, deriveLastRunKeyLegacy(machineId));
    }

    // count 加解密
    // ★ P1-[2.1] 改用 HKDF 派生密钥（旧版读取时三级回退自动兼容）
    private String encryptCountContent(String jsonStr, String machineId) {
        return aesEncrypt(jsonStr, deriveCountKeyHkdf(machineId), COUNT_ENC_PREFIX);
    }
    // ★ P1-[2.1] 升级：三级回退（HKDF → SHA256含hwFp → SHA256无hwFp）
    private String decryptCountContent(String encryptedStr, String machineId) {
        if (encryptedStr == null || !encryptedStr.startsWith(COUNT_ENC_PREFIX)) return null;
        String base64Data = encryptedStr.substring(COUNT_ENC_PREFIX.length());
        String plaintext = tryDecryptAes(base64Data, deriveCountKeyHkdf(machineId));
        if (plaintext != null) return plaintext;
        plaintext = tryDecryptAes(base64Data, deriveCountKey(machineId));
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

    // ★ P0-2 加固（2026-08-26）：masterKey 一致性校验（防替换/删除 masterKey 的降级攻击）
    // 背景：masterKey 不参与 v5/v6/v7 非对称签名内容（云端在签名后添加），单靠非对称验签
    //      无法发现 masterKey 被篡改。攻击者替换/删除 masterKey 后可控制客户端派生密钥
    //      （HMAC/CONFIG_SIGN），进而伪造 config.json 完整性签名。
    // 修复：非对称验签通过后，用 license 当前 masterKey 派生密钥重算 v3/v2 HMAC，
    //      必须与云端下发的 signature 一致（与桌面版 license-manager.js verifyMasterKeyConsistency 对齐）：
    //      - masterKey 被替换 → 派生密钥变化 → HMAC 不匹配 → 拒绝
    //      - masterKey 被删除 → fallback 硬编码密钥 → 与云端 masterKey 派生密钥不匹配 → 拒绝
    //      - 正常 license（云端配置 masterKey）→ 派生一致 → 通过
    //      - 云端未配置 masterKey 时签发的 license（无该字段，HMAC 为硬编码密钥所签）→ 通过（向后兼容）
    // ★ 红线：宁可漏检不可误报。校验异常时放行（仅记日志），绝不阻塞正常用户。
    private boolean verifyMasterKeyConsistency(JSONObject data) {
        try {
            String sig = data.optString("signature", "");
            if (sig == null || sig.isEmpty()) return true;
            // setLicenseDataContext(data) 已缓存 masterKey，generateSignatureV3/V2 自动用派生密钥
            if (data.has("clinicName") && data.has("machineId") && data.has("licenseBinding")) {
                String expectedV3 = generateSignatureV3(data);
                if (sig.equalsIgnoreCase(expectedV3)) return true;
            }
            String expectedV2 = generateSignature(data);
            if (sig.equalsIgnoreCase(expectedV2)) return true;
            Log.w(TAG, "masterKey 一致性校验失败（masterKey 疑似被篡改/删除），拒绝该 license");
            setLicenseDataContext(null);
            return false;
        } catch (Exception e) {
            // 异常按放行处理（宁可漏检不可误报）
            Log.w(TAG, "masterKey 一致性校验异常（放行）: " + e.getMessage());
            return true;
        }
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

        // ★ P1-[5.1][5.3] 新增：v7 Ed25519 签名优先校验（内容 = v5 全部字段 + sigSerial + sigNonce）
        // v7 验签失败直接拒绝（fail-closed，与 v6/v5 一致）：license 声明由 v7 云端签发却验不过，
        //   说明字段被篡改后重算了对称 HMAC；若降级到 v6/v5/HMAC 会让非对称验签保护形同虚设。
        // 旧版 license（无 signatureV7 字段）不受影响，继续走 v6/v5/HMAC 链路。
        if (data.has("signatureV7") && ED25519_VERIFY_PUBLIC_KEY_HEX != null
                && !ED25519_VERIFY_PUBLIC_KEY_HEX.isEmpty()) {
            if (verifyEd25519SignatureV7(data)) {
                // ★ P0-2 加固（2026-08-26）：非对称验签通过后还需校验 masterKey 一致性
                //（masterKey 不参与 v7 签名内容，防替换/删除 masterKey 的降级攻击，见方法注释）
                return verifyMasterKeyConsistency(data);
            }
            Log.w(TAG, "v7 Ed25519 验签失败，拒绝该 license（fail-closed）");
            setLicenseDataContext(null);
            return false;
        }

        // ★ P1-[2.2] 新增：v6 ECDSA 防重放签名优先校验（内容 = v5 全部字段 + sigSerial + sigNonce）
        // v6 验签失败直接拒绝（fail-closed，与 v5 一致）：license 声明由 v6 云端签发却验不过，
        //   说明字段被篡改后重算了对称 HMAC；若降级到 v5/HMAC 会让非对称验签保护形同虚设。
        // 旧版 license（无 signatureV6 字段）不受影响，继续走 v5/HMAC 链路。
        if (data.has("signatureV6") && ECDSA_VERIFY_PUBLIC_KEY_PEM != null
                && !ECDSA_VERIFY_PUBLIC_KEY_PEM.isEmpty()) {
            if (verifyECDSASignatureV6(data)) {
                // ★ P0-2 加固（2026-08-26）：同上，masterKey 一致性校验
                return verifyMasterKeyConsistency(data);
            }
            Log.w(TAG, "v6 ECDSA 验签失败，拒绝该 license（fail-closed）");
            setLicenseDataContext(null);
            return false;
        }

        // ★ v5 ECDSA 非对称验签优先校验（云端私钥签，客户端公钥验）
        // 优势：即使 APP 被反编译拿到公钥，也无法伪造签名（公钥只能验不能签）
        if (data.has("signatureV5") && ECDSA_VERIFY_PUBLIC_KEY_PEM != null
                && !ECDSA_VERIFY_PUBLIC_KEY_PEM.isEmpty()) {
            if (verifyECDSASignature(data)) {
                // ★ P0-2 加固（2026-08-26）：同上，masterKey 一致性校验
                return verifyMasterKeyConsistency(data);
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

    // ★ 密钥轮换兼容（2026-08-26 修复）：用指定 ECDSA 公钥 PEM 验签（v5/v6 共用）
    private boolean verifyEcdsaWithPem(String pem, String content, byte[] derSig) {
        try {
            String b64 = pem
                    .replace("-----BEGIN PUBLIC KEY-----", "")
                    .replace("-----END PUBLIC KEY-----", "")
                    .replaceAll("\\s+", "");
            byte[] pubKeyBytes = Base64.decode(b64, Base64.DEFAULT);
            X509EncodedKeySpec keySpec = new X509EncodedKeySpec(pubKeyBytes);
            KeyFactory kf = KeyFactory.getInstance("EC");
            PublicKey publicKey = kf.generatePublic(keySpec);
            Signature sig = Signature.getInstance("SHA256withECDSA");
            sig.initVerify(publicKey);
            sig.update(content.getBytes(StandardCharsets.UTF_8));
            return sig.verify(derSig);
        } catch (Exception e) {
            return false;
        }
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
            // 3. ★ 密钥轮换兼容：新公钥 → 旧公钥依次尝试（任一通过即放行）
            for (String pem : ECDSA_VERIFY_PUBLIC_KEYS) {
                if (pem == null || pem.isEmpty()) continue;
                if (verifyEcdsaWithPem(pem, content, derSig)) return true;
            }
            return false;
        } catch (Exception e) {
            Log.w(TAG, "v5 ECDSA 验签异常: " + e.getMessage());
            return false;
        }
    }

    // ★ P1-[2.2] 新增：v6 ECDSA P-256 非对称验签（防重放）
    // 签名内容 = v5 全部字段 + sigSerial + sigNonce，与云端 generateSignatureV6 完全一致
    private boolean verifyECDSASignatureV6(JSONObject data) {
        String sigV6 = data.optString("signatureV6", "");
        if (sigV6 == null || sigV6.isEmpty() ||
                ECDSA_VERIFY_PUBLIC_KEY_PEM == null || ECDSA_VERIFY_PUBLIC_KEY_PEM.isEmpty()) {
            return false;
        }
        try {
            // 1. 构造签名内容（与云端 generateSignatureV6 一致）
            String content = buildSignatureContent(data, true, true)
                    + "|" + String.valueOf(data.optLong("sigSerial", 0))
                    + "|" + data.optString("sigNonce", "");
            // 2. hex(raw) → raw bytes → DER
            byte[] rawSig = hexToBytes(sigV6);
            if (rawSig == null || rawSig.length != 64) return false;
            byte[] derSig = ecdsaRawToDer(rawSig);
            if (derSig == null) return false;
            // 3. ★ 密钥轮换兼容：新公钥 → 旧公钥依次尝试（任一通过即放行）
            for (String pem : ECDSA_VERIFY_PUBLIC_KEYS) {
                if (pem == null || pem.isEmpty()) continue;
                if (verifyEcdsaWithPem(pem, content, derSig)) return true;
            }
            return false;
        } catch (Exception e) {
            Log.w(TAG, "v6 ECDSA 验签异常: " + e.getMessage());
            return false;
        }
    }

    // ★ P1-[5.1][5.3] 新增：v7 Ed25519 非对称验签（防重放）
    // 签名内容 = v5 全部字段 + sigSerial + sigNonce，与云端 generateSignatureV7 完全一致
    // 算法：Ed25519（RFC 8032），纯 Java 实现（minSdk=24 无原生 EdDSA，见下方 Ed25519 类）
    private boolean verifyEd25519SignatureV7(JSONObject data) {
        String sigV7 = data.optString("signatureV7", "");
        if (sigV7 == null || sigV7.isEmpty() ||
                ED25519_VERIFY_PUBLIC_KEY_HEX == null || ED25519_VERIFY_PUBLIC_KEY_HEX.isEmpty()) {
            return false;
        }
        try {
            // 1. 构造签名内容（与云端 generateSignatureV7 一致）
            String content = buildSignatureContent(data, true, true)
                    + "|" + String.valueOf(data.optLong("sigSerial", 0))
                    + "|" + data.optString("sigNonce", "");
            // 2. 签名 hex → 64 字节
            byte[] sigBytes = hexToBytes(sigV7);
            if (sigBytes == null || sigBytes.length != 64) return false;
            // 3. ★ 密钥轮换兼容：新公钥 → 旧公钥依次尝试（任一通过即放行）
            for (String hex : ED25519_VERIFY_PUBLIC_KEYS) {
                if (hex == null || hex.isEmpty()) continue;
                byte[] pubKey = hexToBytes(hex);
                if (pubKey == null || pubKey.length != 32) continue;
                if (Ed25519.verify(pubKey, content.getBytes(StandardCharsets.UTF_8), sigBytes)) return true;
            }
            return false;
        } catch (Exception e) {
            Log.w(TAG, "v7 Ed25519 验签异常: " + e.getMessage());
            return false;
        }
    }

    // ========================================================================
    //  ★ P1-[5.1][5.3] 新增：Ed25519 纯 Java 验签实现（RFC 8032）
    //  背景：minSdk=24 的设备不支持 Android 原生 EdDSA（需 API 33+ / JDK 15+ 的 Ed25519），
    //        引入 BouncyCastle 会增大 APK 体积并引入打包/混淆风险，
    //        故用 BigInteger + SHA-512 纯 Java 实现 Ed25519 验签（仅验签，不含私钥运算）。
    //  说明：BigInteger 模运算并非严格常量时间；但对"验签"场景（输入公开、不含私钥
    //        运算，时序不泄露任何机密）可接受。验签失败返回 false，绝不抛异常导致闪退。
    //  引用：RFC 8032 §5.1（Ed25519）、§5.1.3（点解码）、§5.1.7（验签）
    // ========================================================================
    private static final class Ed25519 {
        private static final BigInteger P = new BigInteger(
                "57896044618658097711785492504343953926634992332820282019728792003956564819949"); // 2^255 - 19
        private static final BigInteger L = new BigInteger(
                "7237005577332262213973186563042994240857116359379907606001950938285454250989"); // 2^252 + 27742317777372353535851937790883648493
        private static final BigInteger D = new BigInteger(
                "37095705934669439343138083508754565189542113879843219016388785533085940283555"); // -121665/121666 mod p
        private static final BigInteger SQRT_M1 = new BigInteger(
                "19681161376707505956807079304988542015446066515923890162744021073123829784752"); // 2^((p-1)/4) mod p
        private static final BigInteger[] BASE = {
                new BigInteger("15112221349535400772501151409588531511454012693041857206046113283949847762202"),
                new BigInteger("46316835694926478169428394003475163141307993866256225615783033603165251855960")
        };

        /** 单位元 (0,1) 用 null 表示，add 与 scalarMul 自动处理 */
        private static BigInteger[] add(BigInteger[] p, BigInteger[] q) {
            if (p == null) return q;
            if (q == null) return p;
            BigInteger x1 = p[0], y1 = p[1], x2 = q[0], y2 = q[1];
            // Edwards 曲线 a=-1：x3=(x1y2+x2y1)/(1+d*x1x2y1y2), y3=(y1y2+x1x2)/(1-d*x1x2y1y2)
            BigInteger t = x1.multiply(x2).multiply(y1).multiply(y2).mod(P);
            BigInteger denom1 = BigInteger.ONE.add(D.multiply(t)).mod(P);
            BigInteger denom2 = BigInteger.ONE.subtract(D.multiply(t)).mod(P);
            BigInteger x3 = x1.multiply(y2).add(x2.multiply(y1))
                    .multiply(denom1.modInverse(P)).mod(P);
            BigInteger y3 = y1.multiply(y2).add(x1.multiply(x2))
                    .multiply(denom2.modInverse(P)).mod(P);
            return new BigInteger[]{ x3, y3 };
        }

        /** 标量乘法：double-and-add */
        private static BigInteger[] scalarMul(BigInteger k, BigInteger[] point) {
            BigInteger[] result = null; // 单位元
            BigInteger[] addend = point;
            while (k.signum() > 0) {
                if (k.testBit(0)) result = add(result, addend);
                addend = add(addend, addend);
                k = k.shiftRight(1);
            }
            return result == null ? new BigInteger[]{ BigInteger.ZERO, BigInteger.ONE } : result;
        }

        /** 小端字节 → 正 BigInteger */
        private static BigInteger littleEndian(byte[] b) {
            byte[] reversed = new byte[b.length + 1]; // 前导 0 保证非负
            for (int i = 0; i < b.length; i++) reversed[i + 1] = b[b.length - 1 - i];
            return new BigInteger(reversed);
        }

        /** BigInteger → 小端字节（固定 length 字节，截断高位） */
        private static byte[] toLittleEndian(BigInteger v, int length) {
            byte[] bigEndian = v.toByteArray();
            byte[] out = new byte[length];
            for (int i = 0; i < length && i < bigEndian.length; i++) {
                out[i] = bigEndian[bigEndian.length - 1 - i];
            }
            return out;
        }

        /** p ≡ 5 (mod 8) 下的模平方根；非平方剩余返回 null */
        private static BigInteger modSqrt(BigInteger a) {
            BigInteger c = a.modPow(P.add(BigInteger.valueOf(3)).shiftRight(3), P); // a^((p+3)/8)
            if (c.multiply(c).mod(P).equals(a)) return c;
            BigInteger c2 = c.multiply(SQRT_M1).mod(P);
            if (c2.multiply(c2).mod(P).equals(a)) return c2;
            return null;
        }

        /** 从压缩编码解压 Edwards 点（RFC 8032 §5.1.3）；非法编码返回 null */
        private static BigInteger[] decompress(byte[] encoded) {
            byte[] yBytes = encoded.clone();
            yBytes[31] &= 0x7f; // 清除符号位
            BigInteger y = littleEndian(yBytes);
            if (y.compareTo(P) >= 0) return null;
            // x^2 = (y^2 - 1) / (d*y^2 + 1)
            BigInteger y2 = y.multiply(y).mod(P);
            BigInteger u = y2.subtract(BigInteger.ONE).mod(P);
            BigInteger v = D.multiply(y2).add(BigInteger.ONE).mod(P);
            BigInteger x = modSqrt(u.multiply(v.modInverse(P)).mod(P));
            if (x == null) return null;
            // 符号位：x 为奇数 ↔ 符号位为 1
            boolean sign = (encoded[31] & 0x80) != 0;
            if ((x.testBit(0) ? 1 : 0) != (sign ? 1 : 0)) {
                x = P.subtract(x);
            }
            return new BigInteger[]{ x, y };
        }

        /** 压缩编码 Edwards 点（32 字节小端，最高位为 x 符号位） */
        private static byte[] encode(BigInteger[] p) {
            byte[] out = toLittleEndian(p[1], 32);
            if (p[0].testBit(0)) out[31] |= 0x80;
            return out;
        }

        /**
         * Ed25519 验签（RFC 8032 §5.1.7）
         * @param publicKey 32 字节压缩公钥
         * @param message   待验消息（license 签名内容 UTF-8）
         * @param signature 64 字节签名（R||S）
         * @return 验签是否通过；任何异常返回 false（绝不抛异常）
         */
        static boolean verify(byte[] publicKey, byte[] message, byte[] signature) {
            if (publicKey == null || publicKey.length != 32) return false;
            if (signature == null || signature.length != 64) return false;
            try {
                // 1. 解压公钥 A
                BigInteger[] A = decompress(publicKey);
                if (A == null) return false;
                // 2. S < L（否则拒绝，防签名伪造）
                byte[] sBytes = new byte[32];
                System.arraycopy(signature, 32, sBytes, 0, 32);
                BigInteger S = littleEndian(sBytes);
                if (S.compareTo(L) >= 0) return false;
                // 3. 解压 R
                byte[] rBytes = new byte[32];
                System.arraycopy(signature, 0, rBytes, 0, 32);
                BigInteger[] R = decompress(rBytes);
                if (R == null) return false;
                // 4. h = SHA-512(R || A || M) 取 64 字节 → 模 L 标量
                ByteArrayOutputStream baos = new ByteArrayOutputStream(64 + 32 + message.length);
                baos.write(signature, 0, 32);   // R
                baos.write(publicKey, 0, 32);   // A
                baos.write(message);            // M
                byte[] h = MessageDigest.getInstance("SHA-512").digest(baos.toByteArray());
                BigInteger hScalar = littleEndian(h).mod(L);
                // 5. 校验 [S]B + [h](-A) == R
                BigInteger[] SB = scalarMul(S, BASE);
                BigInteger[] negA = { A[0].negate().mod(P), A[1] };
                BigInteger[] hNegA = scalarMul(hScalar, negA);
                BigInteger[] check = add(SB, hNegA);
                if (check == null) check = new BigInteger[]{ BigInteger.ZERO, BigInteger.ONE };
                byte[] checkBytes = encode(check);
                for (int i = 0; i < 32; i++) {
                    if (checkBytes[i] != rBytes[i]) return false;
                }
                return true;
            } catch (Exception e) {
                return false;
            }
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

    // ========================================================================
    //  ★ APP版 config.json 可写副本机制（与桌面版对齐）
    //  - 首次启动: 从 assets/public/config.json 复制到 filesDir/config.json
    //  - 后续所有读/写: 统一走 filesDir 副本（可修改，可重签名）
    //  - 若 filesDir 副本损坏: fallback 到 assets 重新复制
    // ========================================================================
    private File getConfigFile() {
        File f = getFile(CONFIG_FILE);
        if (!f.exists()) {
            // 首次启动：从 assets/public/config.json 复制到 filesDir
            try {
                InputStream is = context.getAssets().open("public/config.json");
                String json = readStream(is);
                writeFileBytes(f, json.getBytes(StandardCharsets.UTF_8));
                Log.i(TAG, "config.json 已复制到 filesDir 副本（首次启动）");
            } catch (Exception e) {
                Log.w(TAG, "初始化 config.json 副本失败: " + e.getMessage());
            }
        }
        return f;
    }

    private JSONObject readConfigJSON() {
        try {
            File f = getConfigFile();
            if (f.exists()) {
                String json = new String(readFileBytes(f), StandardCharsets.UTF_8).trim();
                if (!json.isEmpty()) return new JSONObject(json);
            }
            // filesDir 损坏/不存在，fallback 到 assets
            InputStream is = context.getAssets().open("public/config.json");
            return new JSONObject(readStream(is));
        } catch (Exception e) {
            Log.w(TAG, "readConfigJSON 失败: " + e.getMessage());
            return new JSONObject();
        }
    }

    private JSONObject signConfig(JSONObject cfg) {
        try {
            String issuedAt = cfg.optString("configIssuedAt", "");
            if (issuedAt.isEmpty()) {
                issuedAt = String.valueOf(System.currentTimeMillis());
                cfg.put("configIssuedAt", issuedAt);
            }
            String signContent = cfg.optString("clinicName", "") + "|" +
                                 cfg.optString("doctorName", "") + "|" +
                                 cfg.optString("edition", "") + "|" + issuedAt;
            String sig = hmacSha256WithKey(signContent, getEffectiveConfigSignKey());
            cfg.put("configSignature", sig);
            return cfg;
        } catch (Exception e) {
            Log.w(TAG, "signConfig 失败: " + e.getMessage());
            return cfg;
        }
    }

    private boolean writeConfigJSON(JSONObject cfg, boolean needSign) {
        try {
            if (needSign) {
                // 签名前先确保 license 上下文已设置（用于 masterKey 派生密钥）
                // 调用方应先调用 setLicenseDataContext 或 validateLicense
                cfg = signConfig(cfg);
            }
            String json = cfg.toString(2);
            writeFileBytes(getConfigFile(), json.getBytes(StandardCharsets.UTF_8));
            Log.i(TAG, "config.json 已写入 filesDir 副本（签名=" + (needSign ? "已更新" : "未修改") + "）");
            return true;
        } catch (Exception e) {
            Log.w(TAG, "writeConfigJSON 失败: " + e.getMessage());
            return false;
        }
    }

    private void writeFileBytes(File f, byte[] bytes) throws Exception {
        try (java.io.FileOutputStream fos = new java.io.FileOutputStream(f)) {
            fos.write(bytes);
            fos.flush();
        }
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

    // ★ 第三轮终检 P1-2 修复：trial_days 明文存储于 SharedPreferences 可被 root 直接篡改
    //   （改为 365 + 删 trial.dat = 365 天试用）。现读取时必须通过 HMAC 签名校验
    //   （machineId 绑定，签名不匹配/缺失一律回退默认 7 天）。
    //   setTrialDays（JS 桥接合法配置路径）写入时自动计算签名，正常配置流程不受影响。
    private String computeTrialDaysSignature(int days) {
        try {
            String mid = getMachineId();
            String msg = (mid == null ? "" : mid) + "|" + days + "|trialdays";
            javax.crypto.Mac mac = javax.crypto.Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(LICENSE_HMAC_KEY.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            byte[] out = mac.doFinal(msg.getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder();
            for (byte b : out) sb.append(String.format("%02x", b));
            return sb.toString();
        } catch (Exception e) {
            Log.e(TAG, "计算试用期签名失败", e);
            return null;
        }
    }

    // ★ 获取试用期天数（可配置，默认 7 天，测试时可设为 0 天立即触发激活）
    // 与桌面版 license-manager.js getTrialDays() 对应（桌面版用 trial-config.json）
    public int getTrialDays() {
        try {
            SharedPreferences prefs = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE);
            int days = prefs.getInt(PREF_KEY_TRIAL_DAYS, -1);
            if (days >= 0 && days <= 365) {
                // ★ P1-2 修复：签名校验，不通过（明文被篡改/旧版无签名）回退默认值
                String expectSig = computeTrialDaysSignature(days);
                String savedSig = prefs.getString(PREF_KEY_TRIAL_DAYS_SIG, "");
                if (expectSig != null && expectSig.equals(savedSig)) {
                    return days;
                }
                Log.w(TAG, "试用期配置签名校验失败（可能被篡改），回退默认 " + DEFAULT_TRIAL_DAYS + " 天");
            }
        } catch (Exception e) {
            Log.e(TAG, "读取试用期天数失败", e);
        }
        return DEFAULT_TRIAL_DAYS;
    }

    // ★ 设置试用期天数（持久化到 SharedPreferences，含 HMAC 签名，重启后生效）
    public JSONObject setTrialDays(int days) {
        JSONObject result = new JSONObject();
        try {
            if (days < 0 || days > 365) {
                result.put("success", false);
                result.put("error", "试用期天数必须在 0-365 之间");
                return result;
            }
            String sig = computeTrialDaysSignature(days);
            if (sig == null) {
                result.put("success", false);
                result.put("error", "签名计算失败，无法设置试用期");
                return result;
            }
            SharedPreferences prefs = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE);
            SharedPreferences.Editor editor = prefs.edit();
            editor.putInt(PREF_KEY_TRIAL_DAYS, days);
            editor.putString(PREF_KEY_TRIAL_DAYS_SIG, sig);
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

    // ★ P1-[2.2] 修复：合并写入，保留 sigSerialSeen 等审计字段（避免覆盖丢失）
    private void writeLastRun(long timestamp) {
        JSONObject data = readLastRun();
        if (data == null) data = new JSONObject();
        try {
            data.put("timestamp", timestamp);
        } catch (Exception e) {
            // 仅 timestamp 写入失败，忽略（后续仍有 writeLastRun(JSONObject) 落盘）
        }
        writeLastRun(data);
    }

    private void writeLastRun(JSONObject data) {
        try {
            File f = getFile(LASTRUN_FILE);
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

    // ★ P1-[2.2] 新增：v6 serial 防重放审计（fail-open，仅警告记录，绝不阻塞激活）
    // 与桌面版 license-manager.js auditSigSerial 逻辑一致：
    //   以 user|issuedAt 为键记录已见最高 sigSerial；同一签发批次再次出现更小/相等 serial → 疑似重放告警
    private void auditSigSerial(JSONObject data) {
        try {
            if (data == null || !data.has("signatureV6") || !data.has("sigSerial")) return;
            long serial;
            try {
                serial = data.getLong("sigSerial");
            } catch (Exception e) {
                return;
            }
            if (serial <= 0) return;
            String key = data.optString("user", "") + "|" + data.optString("issuedAt", "");
            JSONObject lastRun = readLastRun();
            JSONObject seen = (lastRun != null && lastRun.has("sigSerialSeen"))
                    ? lastRun.optJSONObject("sigSerialSeen") : new JSONObject();
            boolean isNew = !seen.has(key);
            long prev = isNew ? 0 : seen.getLong(key);
            if (!isNew && serial <= prev) {
                Log.w(TAG, "疑似授权文件重放：同一签发批次 serial=" + serial
                        + " 已见更高 serial=" + prev + "（仅记录告警，不阻断运行）");
            }
            if (isNew || serial > prev) {
                seen.put(key, serial);
                // 上限 20 条，淘汰最旧（JSONObject.keys 顺序，仅防膨胀）
                if (seen.length() > 20) {
                    Iterator<String> it = seen.keys();
                    String firstKey = null;
                    while (it.hasNext()) firstKey = it.next();
                    if (firstKey != null) seen.remove(firstKey);
                }
                if (lastRun == null) lastRun = new JSONObject();
                lastRun.put("sigSerialSeen", seen);
                writeLastRun(lastRun);
            }
        } catch (Exception e) {
            Log.w(TAG, "serial 审计异常: " + e.getMessage());
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
    // ★ 第三轮终检 P1-3 修复：verify-state.dat 从 XOR 混淆升级为 AES-256-CBC
    //   原格式可被伪造（反编译拿到硬编码 XOR 密钥后可把 lastOnlineVerify 改为当前时间、
    //   prescriptionsSinceVerify 清零，永久避开 90 天在线验证降级）。
    //   密钥从 machineId+硬件指纹派生（与 trial/last-run 机制一致）；
    //   旧 XOR 格式仍可读（向后兼容存量安装），读取成功后立即以 AES 重新保存完成迁移。
    private SecretKeySpec deriveVerifyStateKey(String machineId) {
        try {
            String hwFp = getHardwareFingerprint();
            String combined = (machineId == null ? "" : machineId) + (hwFp == null ? "" : hwFp) + LICENSE_HMAC_KEY + ":vstate";
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            return new SecretKeySpec(md.digest(combined.getBytes(StandardCharsets.UTF_8)), "AES");
        } catch (Exception e) {
            return null;
        }
    }

    private JSONObject readVerifyState() {
        try {
            File f = getFile(VERIFY_STATE_FILE);
            if (!f.exists()) return new JSONObject();
            byte[] bytes = readFileBytes(f);
            String content = new String(bytes, StandardCharsets.UTF_8).trim();
            String json = null;
            boolean legacy = false;
            if (content.startsWith(VERIFYSTATE_ENC_PREFIX)) {
                String base64Data = content.substring(VERIFYSTATE_ENC_PREFIX.length());
                // ★ P1-[2.1] HKDF 优先，失败回退旧 SHA256 密钥
                json = tryDecryptAes(base64Data, deriveVerifyStateKeyHkdf(getMachineId()));
                if (json == null) {
                    json = tryDecryptAes(base64Data, deriveVerifyStateKey(getMachineId()));
                }
            } else {
                // 旧格式（XOR + Base64）- 向后兼容
                json = xorDecrypt(content, VERIFY_STATE_KEY);
                legacy = (json != null);
            }
            if (json == null) return new JSONObject();
            JSONObject state = new JSONObject(json);
            if (legacy) writeVerifyState(state);  // 立即迁移为 AES 格式
            return state;
        } catch (Exception e) {
            return new JSONObject();
        }
    }

    private void writeVerifyState(JSONObject state) {
        try {
            File f = getFile(VERIFY_STATE_FILE);
            String jsonStr = state.toString();
            String mid = getMachineId();
            String encrypted = (mid != null && !mid.isEmpty())
                    ? aesEncrypt(jsonStr, deriveVerifyStateKeyHkdf(mid), VERIFYSTATE_ENC_PREFIX) : null;
            if (encrypted == null) {
                Log.w(TAG, "machineId 不可用，verify-state 回退到 XOR 加密");
                encrypted = xorEncrypt(jsonStr, VERIFY_STATE_KEY);
            }
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
            // ★ P1-1：上报客户端完整性状态（0=正常 1=native不可用 2=不一致 3=失败），仅服务端审计用
            reqBody.put("integrityState", lastIntegrityState);

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
            // ★ 第三轮终检 P1-1 修复：记录服务器时间基准（verify.js 返回毫秒时间戳），
            //   用于检测本地时钟回拨（删 last-run.dat + 改系统时间续命）
            long serverTimeMs = respJson.optLong("verifyTime", 0);
            if (serverTimeMs > 0) verifyState.put("lastServerTime", serverTimeMs);
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
    // ★ 第三轮终检 P1-3 修复：activation-record.dat 同步升级 AES-256-CBC
    //   （原 XOR 可被伪造清除/篡改激活水印，machineId+硬件指纹派生密钥防跨机复制；
    //    旧 XOR 格式向后兼容读取，成功后立即迁移保存）
    private SecretKeySpec deriveActivationRecordKey(String machineId) {
        try {
            String hwFp = getHardwareFingerprint();
            String combined = (machineId == null ? "" : machineId) + (hwFp == null ? "" : hwFp) + LICENSE_HMAC_KEY + ":actrec";
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            return new SecretKeySpec(md.digest(combined.getBytes(StandardCharsets.UTF_8)), "AES");
        } catch (Exception e) {
            return null;
        }
    }

    private JSONObject readActivationRecord() {
        try {
            File f = getFile(ACTIVATION_RECORD_FILE);
            if (!f.exists()) return new JSONObject();
            byte[] bytes = readFileBytes(f);
            String content = new String(bytes, StandardCharsets.UTF_8).trim();
            String json = null;
            boolean legacy = false;
            if (content.startsWith(ACTREC_ENC_PREFIX)) {
                String base64Data = content.substring(ACTREC_ENC_PREFIX.length());
                // ★ P1-[2.1] HKDF 优先，失败回退旧 SHA256 密钥
                json = tryDecryptAes(base64Data, deriveActivationRecordKeyHkdf(getMachineId()));
                if (json == null) {
                    json = tryDecryptAes(base64Data, deriveActivationRecordKey(getMachineId()));
                }
            } else {
                // 旧格式（XOR + Base64）- 向后兼容
                json = xorDecrypt(content, ACTIVATION_RECORD_KEY);
                legacy = (json != null);
            }
            if (json == null) return new JSONObject();
            JSONObject record = new JSONObject(json);
            if (legacy) writeActivationRecord(record);  // 立即迁移为 AES 格式
            return record;
        } catch (Exception e) {
            return new JSONObject();
        }
    }

    private void writeActivationRecord(JSONObject record) {
        try {
            File f = getFile(ACTIVATION_RECORD_FILE);
            String jsonStr = record.toString();
            String mid = getMachineId();
            String encrypted = (mid != null && !mid.isEmpty())
                    ? aesEncrypt(jsonStr, deriveActivationRecordKeyHkdf(mid), ACTREC_ENC_PREFIX) : null;
            if (encrypted == null) {
                Log.w(TAG, "machineId 不可用，activation-record 回退到 XOR 加密");
                encrypted = xorEncrypt(jsonStr, ACTIVATION_RECORD_KEY);
            }
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
            // ★ P1-[2.2] 新增：透传 v6 ECDSA 防重放签名相关字段（旧 license 无此字段时不设置）
            if (license.has("signatureV6")) {
                normalized.put("signatureV6", license.optString("signatureV6", ""));
            }
            if (license.has("sigKId")) {
                normalized.put("sigKId", license.optString("sigKId", ""));
            }
            if (license.has("sigSerial")) {
                normalized.put("sigSerial", license.getLong("sigSerial"));
            }
            if (license.has("sigNonce")) {
                normalized.put("sigNonce", license.optString("sigNonce", ""));
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
    // 从 filesDir/config.json（可写副本）读取本地诊所名
    public String getLocalClinicName() {
        try {
            JSONObject cfg = readConfigJSON();
            return cfg.optString("clinicName", "");
        } catch (Exception e) {
            Log.w(TAG, "读取本地诊所名失败: " + e.getMessage());
            return "";
        }
    }

    // 从 filesDir/config.json（可写副本）读取本地医师名
    public String getLocalDoctorName() {
        try {
            JSONObject cfg = readConfigJSON();
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
        // ★ 第三轮终检 P2 修复：license 含 machineId 但本地获取为空时原会跳过校验，
        //   现 fail-closed（与桌面版 checkLicenseBinding 修复对齐）
        String licenseMachineId = license.optString("machineId", "");
        boolean localMidEmpty = (localMachineId == null || localMachineId.isEmpty());
        if (!licenseMachineId.isEmpty() && localMidEmpty) {
            errs.append("无法获取本机机器标识，授权绑定校验失败（环境异常）\n");
        } else if (!licenseMachineId.isEmpty() && !licenseMachineId.equals(localMachineId)) {
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
    // 防止用户修改 filesDir/config.json 绕过 license 绑定校验（统一走可写副本）
    public boolean verifyConfigIntegrity() {
        try {
            JSONObject cfg = readConfigJSON();
            String sig = cfg.optString("configSignature", "");
            // ★ 第三轮终检 P2 修复：无 configSignature 原返回 true 兜底放行（攻击者删签名
            //   字段即可绕过完整性校验）→ 改为 fail-closed 返回 false。
            //   安全性依据：本函数仅在 license 含 licenseBinding（v3+ 激活）时被调用，
            //   激活同步已保证写签名（含无签名时强制重写，见 activateOnline）。
            if (sig.isEmpty()) {
                Log.w(TAG, "config.json 无签名，完整性校验不通过（fail-closed）");
                return false;
            }
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
            // ★ 版本化基线（2026-08-26 修复）：改用 versionCode（versionName 恒为 1.0.0 不变，
            //   曾导致覆盖安装新版 auth-core.js 后旧基线不匹配 → 误报"文件被篡改"）
            String baselineKey = PREF_KEY_JS_INTEGRITY_HASH + "_vc" + versionCode;
            String baseline = prefs.getString(baselineKey, "");

            if (baseline.isEmpty()) {
                prefs.edit().putString(baselineKey, currentHash).apply();
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
        // ★ 第三轮终检 P1-1 修复：服务器时间基准——本地时间比最近一次服务器时间慢 1 天以上
        //   （可能删 last-run.dat 后回拨系统时钟续命）时，所有时间判定改用服务器基准，
        //   保证授权到期/在线验证周期/试用到期不被时钟回拨绕过。
        //   不做硬性锁定（避免服务器与设备正常钟差导致付费用户误伤），仅校正判定基准。
        long effectiveNow = now;
        try {
            long lastServerTime = readVerifyState().optLong("lastServerTime", 0);
            if (lastServerTime > 0 && now < lastServerTime - TIME_TAMPER_THRESHOLD) {
                Log.w(TAG, "本地时间落后服务器基准超过1天（疑似时钟回拨），时间判定改用服务器基准");
                effectiveNow = lastServerTime;
            }
        } catch (Exception ignored) {}
        // ★ 修复 2026-07-27：添加诊断日志，帮助定位激活后重启仍显示试用模式的问题
        File licenseFile = getFile(LICENSE_FILE);
        Log.d(TAG, "validateLicense: machineId=" + localMachineId +
                   " license.dat exists=" + licenseFile.exists() +
                   " size=" + (licenseFile.exists() ? licenseFile.length() : 0));
        try {
            // ★ 安全检测 1：Root 检测（仅记录日志，不阻塞运行，避免 busybox/su 路径误报闪退）
            if (isRooted()) {
                Log.w(TAG, "检测到 Root 设备特征（仅记录日志，不阻塞运行）");
            }
            // ★ 安全检测 2：调试器检测（仅记录日志，不阻塞运行，避免国产手机 ro.debuggable=1 误报闪退）
            if (isDebuggerAttached()) {
                Log.w(TAG, "检测到调试器特征（仅记录日志，不阻塞运行）");
            }
            // ★ 安全检测 3：APK 签名校验（防反编译重打包，P1-1：双路交叉+云端仲裁）
            if (!verifyApkSignature()) {
                if (getLastIntegrityState() == INTEGRITY_INCONSISTENT) {
                    // 双路分叉且云端仲裁未通过（无效授权/超时/网络不可达）
                    return failValidation(
                            "安全校验异常，云端验证未通过。\n请检查网络后重启，或从官方渠道重新下载安装。",
                            "integrity_inconsistent");
                }
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

                // ★ P1-[2.2] 新增：v6 serial 防重放审计（仅警告记录，fail-open，不影响放行）
                auditSigSerial(license);

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

                if (effectiveNow > expiresAtMs) {
                    JSONObject r = failValidation(
                            "授权已过期。\n用户：" + license.optString("user", "") +
                                    "\n到期时间：" + expiresAtStr + "\n请联系客服续费。",
                            "expired");
                    r.put("license", license);
                    return r;
                }

                // license 有效
                writeLastRun(now);
                long remainingDays = (long) Math.ceil((expiresAtMs - effectiveNow) / (24.0 * 60 * 60 * 1000));

                // ★ P1-1 在线授权验证：定期要求在线验证，防止离线破解后永久使用
                JSONObject verifyState = readVerifyState();
                long lastVerify = verifyState.optLong("lastOnlineVerify", 0);
                int prescriptionsSinceVerify = verifyState.optInt("prescriptionsSinceVerify", 0);
                long daysSinceVerify = (effectiveNow - lastVerify) / (24 * 60 * 60 * 1000);

                if (lastVerify == 0) {
                    // 首次运行（刚激活或从旧版升级），初始化验证状态
                    verifyState.put("lastOnlineVerify", effectiveNow);
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
                // ★ 2026-08-15 防重复试用：首次创建试用前先上报硬件指纹到云端
                // 宽限模式：网络失败默认允许；仅云端明确拒绝（次数超限）才阻止
                if (!registerTrialOnline()) {
                    JSONObject r = failValidation(
                            "该设备试用次数已达上限，无法继续试用。\n请联系客服购买正式授权。",
                            "trial_limit_reached");
                    return r;
                }
                trial = new JSONObject();
                trial.put("startTime", now);
                trial.put("expiresAt", now + (long) currentTrialDays * 24 * 60 * 60 * 1000);
                writeTrial(trial);
                // ★ 试用版默认版本：标准版（首次启动时设置）
                try {
                    JSONObject cfg = readConfigJSON();
                    String curEdition = cfg.optString("edition", "");
                    if (curEdition.isEmpty() || curEdition.equals("offline")) {
                        syncConfigEdition("personal");  // 默认标准版
                    }
                } catch (Exception ignored) {}
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
            if (effectiveNow > trialExpiresAtMs) {
                JSONObject r = failValidation(
                        "试用期已到期（" + currentTrialDays + " 天）。\n请联系客服购买正式授权。",
                        "trial_expired");
                r.put("trial", trial);
                return r;
            }

            // 试用有效
            writeLastRun(now);
            long remainingDays = (long) Math.ceil((trialExpiresAtMs - effectiveNow) / (24.0 * 60 * 60 * 1000));
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
    //  在线激活（HTTP POST 云端 /api/license/claim 统一认领门面）
    //  请求体：{ code, machineId, user, clinicName }
    //  响应体：{ success, license: base64, message, expiresAt, type, ... }
    // ★ v3 新增：clinicName 参数传给云端做绑定校验
    // ========================================================================
    public JSONObject activateOnline(String code, String machineId, String user) {
        return activateOnline(code, machineId, user, null);
    }

    // ★ 2026-08-17 激活流程改「用户名(姓名/手机号)+默认密码admin」：
    //   该 7 参重载在激活成功后，自动创建登录账号（手机号为登录账号，密码可留空=admin）
    public JSONObject activateOnline(String code, String machineId, String user, String clinicName,
                                     String password, String loginUsername, String phone) {
        return activateOnline(code, machineId, user, clinicName, password, loginUsername, phone, null);
    }

    // ★ 2026-08-26 推广奖励：8 参重载，透传好友邀请码（选填）→ 服务端发奖
    //   （邀请人+90天封顶4人360天，本机+30天）
    // ★ 2026-08-29 重装/换机自愈：phone 随激活请求提交服务端做手机号身份核验
    //   （核验通过自动恢复原激活绑定信息，无需重填诊所名）
    public JSONObject activateOnline(String code, String machineId, String user, String clinicName,
                                     String password, String loginUsername, String phone, String inviteCode) {
        JSONObject result = activateOnline(code, machineId, user, clinicName, inviteCode, phone);
        if (result != null && result.optBoolean("success", false)) {
            // 创建/确保登录账号：使用用户名/手机号 + 默认密码 admin，登入后用户自行修改密码
            try {
                String effPwd = (password == null || password.isEmpty()) ? "admin" : password;
                String login = (loginUsername == null || loginUsername.isEmpty()) ? user : loginUsername;
                syncCreateActivationUser(login, phone, effPwd, user);
            } catch (Exception ue) {
                Log.w(TAG, "创建激活登录账号失败(不影响激活): " + ue.getMessage());
            }
        }
        return result;
    }

    public JSONObject activateOnline(String code, String machineId, String user, String clinicName) {
        return activateOnline(code, machineId, user, clinicName, null);
    }

    // ★ 2026-08-26 推广奖励：5 参实现，inviteCode（好友邀请码）随激活请求提交
    public JSONObject activateOnline(String code, String machineId, String user, String clinicName, String inviteCode) {
        return activateOnline(code, machineId, user, clinicName, inviteCode, null);
    }

    // ★ 2026-08-29 重装/换机自愈：6 参实现，phone 随激活请求提交 →
    //   服务端手机号身份核验通过后自动恢复原激活绑定信息（原诊所名/原账号）
    public JSONObject activateOnline(String code, String machineId, String user, String clinicName,
                                     String inviteCode, String phone) {
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
            // ★ 2026-08-28 推广奖励：提交好友邀请码（选填）→ 服务端发奖
            if (inviteCode != null && !inviteCode.trim().isEmpty()) {
                reqBody.put("inviteCode", inviteCode.trim());
            }
            // ★ 2026-08-29 重装/换机自愈：提交手机号 → 服务端手机号身份核验
            //   （与原激活绑定的手机号一致时自动恢复原激活信息，跳过诊所名严格匹配）
            if (phone != null && phone.trim().matches("1[3-9]\\d{9}")) {
                reqBody.put("phone", phone.trim());
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

            // ★ APP版：同步 clinicName 和 doctorName(user) 到 filesDir/config.json 副本
            //  - 与桌面版 activate.js 同步逻辑对齐：防止三因子绑定校验失败(诊所名不匹配)
            //  - 激活参数传入的 user → doctorName，clinicName → config.clinicName
            try {
                // ① 解析刚写入的 license 内容，获取 clinicName 和设置签名密钥上下文(masterKey派生)
                JSONObject licenseData = null;
                try {
                    String jsonStr = decryptLicenseContent(licenseBase64, machineId);
                    if (jsonStr != null && !jsonStr.isEmpty()) licenseData = new JSONObject(jsonStr);
                } catch (Exception parseEx) { /* 解析失败不影响激活 */ }
                if (licenseData == null) {
                    // fallback: 读刚写入的文件
                    licenseData = readLicense(machineId);
                }
                if (licenseData != null) {
                    setLicenseDataContext(licenseData); // 供 getEffectiveConfigSignKey() 使用 masterKey
                }
                String syncClinicName = "";
                // ★ 2026-09-06 P0 修复（绑定校验诊所名不匹配）：同步 config.clinicName
                //   以 license 内已签发的权威值为准优先——官网下单页「姓名/诊所名称」
                //   单框设计，客户常把"诊所名 / 医师名"一并填入并写进申请，服务端照此
                //   签发 license.clinicName；若以激活表单参数为准同步，config.clinicName
                //   与 license.clinicName 不一致 → checkLicenseBinding 报"诊所名不匹配"
                //   阻断启动。反转优先级后以 license 覆盖，激活参数仅在 license 无该
                //   字段时兜底（旧版 license）。
                if (licenseData != null) {
                    syncClinicName = licenseData.optString("clinicName", "");
                }
                if (syncClinicName.isEmpty() && clinicName != null) syncClinicName = clinicName;
                // ② 读取当前filesDir的config并更新
                JSONObject cfg = readConfigJSON();
                boolean changed = false;
                if (!syncClinicName.isEmpty() && !syncClinicName.equals(cfg.optString("clinicName", ""))) {
                    cfg.put("clinicName", syncClinicName);
                    Log.i(TAG, "激活同步: config.clinicName → " + syncClinicName);
                    changed = true;
                }
                if (user != null && !user.isEmpty() && !user.equals(cfg.optString("doctorName", ""))) {
                    cfg.put("doctorName", user);
                    Log.i(TAG, "激活同步: config.doctorName → " + user);
                    changed = true;
                }
                // ③ 写回filesDir（自动重签名，保持完整性校验通过）
                // ★ 第三轮终检 P2 修复：config 无签名时（旧版升级后重激活且内容无变化）
                //   也强制重写签名，避免 verifyConfigIntegrity fail-closed 后误拦
                boolean noSig = cfg.optString("configSignature", "").isEmpty();
                if (changed || noSig) writeConfigJSON(cfg, true);
            } catch (Exception syncErr) {
                Log.w(TAG, "激活后同步config失败(不影响激活): " + syncErr.getMessage());
            }

            // ★ 同步版本信息（edition + 用户角色）
            // ★ 2026-09-07 P0 修复（与装码路径同族）：激活响应顶层无 type 字段
            //   （嵌在 licenseInfo.type），原 respJson.optString("type") 恒取默认
            //   "personal" → config.edition 被错写。修复：优先读 licenseInfo.type，
            //   兜底读刚写盘的 license.dat（本函数上方已 writeLicenseContent）。
            try {
                String licenseType = "personal";
                JSONObject li = respJson.optJSONObject("licenseInfo");
                if (li != null && !li.optString("type", "").trim().isEmpty()) {
                    licenseType = li.optString("type", "personal");
                } else {
                    JSONObject ld = readLicense(machineId);
                    if (ld != null) licenseType = ld.optString("type", "personal");
                }
                syncConfigEdition(licenseType);
            } catch (Exception edErr) {
                Log.w(TAG, "版本同步失败(不影响激活): " + edErr.getMessage());
            }

            // ★ P1-1 初始化在线验证状态（激活时视为已验证）
            try {
                JSONObject vs = new JSONObject();
                vs.put("lastOnlineVerify", System.currentTimeMillis());
                vs.put("prescriptionsSinceVerify", 0);
                // ★ 第三轮终检 P1-1 修复：激活响应含 verifyTime 则记录服务器时间基准
                long actServerTime = respJson.optLong("verifyTime", 0);
                if (actServerTime > 0) vs.put("lastServerTime", actServerTime);
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
                // ★ 2026-08-29 推广奖励：补存明文激活码（激活记录文件本身已 AES 加密，
                //   风险与桌面版 localStorage 存明文同级）。用途：renderer 的 loadInviteInfo
                //   三来源取码兜底（getActivationRecord 桥接透出），查询专属邀请码。
                ar.put("code", code.trim());
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
            // ★ 2026-08-28 推广奖励：透传邀请信息（专属邀请码+进度+奖励天数，供激活成功页展示）
            if (respJson.has("inviteInfo")) r.put("inviteInfo", respJson.get("inviteInfo"));
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

    // ========================================================================
    //  ★ 管理员激活：安装后端审批已生成的 license（无需网络校验激活码）
    //    与 activateOnline 成功后安装流程一致（写license+清trial+同步config/版本
    //    +初始化验证状态+创建登录账号），但 license 来自 admin-status 返回，而非本机联网校验。
    //  ========================================================================
    public JSONObject installAdminLicense(String licenseBase64, String machineId, String user,
                                          String clinicName, String password,
                                          String loginUsername, String phone, String licenseCode) {
        // ★ 2026-09-06 并发安装互斥：JS 自愈（桥线程）与 Java 原生领码自愈（后台线程）
        //   可能并发调用本方法（同时写 license.dat/config.json）→ 静态锁串行化；
        //   二次安装同一张 license 幂等无害（config UPSERT 同值 no-op）
        synchronized (sInstallLock) {
        try {
            if (licenseBase64 == null || licenseBase64.isEmpty()) {
                return failResult("服务器返回的 license 数据为空");
            }
            String mid = (machineId == null || machineId.isEmpty()) ? getMachineId() : machineId;

            // 1. 写入 license 文件
            if (!writeLicenseContent(licenseBase64, mid)) {
                return failResult("写入 license 文件失败");
            }

            // 2. 清除 trial 文件（已正式激活）
            try { getFile(TRIAL_FILE).delete(); } catch (Exception ignored) {}

            // 3. 激活成功，重置失败计数
            resetActivateFailCount();

            // 4. 同步 clinicName 和 doctorName(user) 到 filesDir/config.json 副本
            try {
                JSONObject licenseData = null;
                try {
                    String jsonStr = decryptLicenseContent(licenseBase64, mid);
                    if (jsonStr != null && !jsonStr.isEmpty()) licenseData = new JSONObject(jsonStr);
                } catch (Exception parseEx) { /* 解析失败不影响激活 */ }
                if (licenseData == null) {
                    licenseData = readLicense(mid);
                }
                if (licenseData != null) {
                    setLicenseDataContext(licenseData); // 供 getEffectiveConfigSignKey() 使用 masterKey
                }
                String syncClinicName = "";
                // ★ 2026-09-06 P0 修复（绑定校验诊所名不匹配）：同步 config.clinicName
                //   以 license 内已签发的权威值为准优先——官网下单页「姓名/诊所名称」
                //   单框设计，客户常把"诊所名 / 医师名"一并填入并写进申请，服务端照此
                //   签发 license.clinicName；若以激活表单参数为准同步，config.clinicName
                //   与 license.clinicName 不一致 → checkLicenseBinding 报"诊所名不匹配"
                //   阻断启动。反转优先级后以 license 覆盖，激活参数仅在 license 无该
                //   字段时兜底（旧版 license）。
                if (licenseData != null) {
                    syncClinicName = licenseData.optString("clinicName", "");
                }
                if (syncClinicName.isEmpty() && clinicName != null) syncClinicName = clinicName;
                JSONObject cfg = readConfigJSON();
                boolean changed = false;
                if (!syncClinicName.isEmpty() && !syncClinicName.equals(cfg.optString("clinicName", ""))) {
                    cfg.put("clinicName", syncClinicName);
                    Log.i(TAG, "管理员激活同步: config.clinicName → " + syncClinicName);
                    changed = true;
                }
                if (user != null && !user.isEmpty() && !user.equals(cfg.optString("doctorName", ""))) {
                    cfg.put("doctorName", user);
                    Log.i(TAG, "管理员激活同步: config.doctorName → " + user);
                    changed = true;
                }
                boolean noSig = cfg.optString("configSignature", "").isEmpty();
                if (changed || noSig) writeConfigJSON(cfg, true);
            } catch (Exception syncErr) {
                Log.w(TAG, "管理员激活后同步config失败(不影响激活): " + syncErr.getMessage());
            }

            // 5. 同步版本信息（edition + 用户角色）
            // ★ 2026-09-07 P0 修复（机构版错显【修改密码】根因）：服务端 license 是
            //   纯 base64（无 ENC 前缀），decryptLicenseContent 对其必返回 null →
            //   licenseType 停留默认 "personal" → syncConfigEdition("personal") 把
            //   config.edition 错写成 personal → 重启后 getAppConfigBridge 返回
            //   personal → 前端 enforceStandardEditionButtons 错显【修改密码】。
            //   修复：与第 4 步 clinicName 同步段同款 readLicense 兜底——license.dat
            //   已在本函数第 1 步加密写盘，readLicense 走 ENC2 解密必成功。
            try {
                String licenseType = "personal";
                JSONObject ld = null;
                try {
                    String jsonStr = decryptLicenseContent(licenseBase64, mid);
                    if (jsonStr != null && !jsonStr.isEmpty()) {
                        ld = new JSONObject(jsonStr);
                    }
                } catch (Exception parseEx) { /* 走读盘兜底 */ }
                if (ld == null) {
                    ld = readLicense(mid); // 读刚写盘的 license.dat（ENC2 解密）
                }
                if (ld != null) {
                    licenseType = ld.optString("type", "personal");
                }
                syncConfigEdition(licenseType);
            } catch (Exception edErr) {
                Log.w(TAG, "管理员激活版本同步失败(不影响激活): " + edErr.getMessage());
            }

            // 6. 初始化在线验证状态（激活时视为已验证）
            try {
                JSONObject vs = new JSONObject();
                vs.put("lastOnlineVerify", System.currentTimeMillis());
                vs.put("prescriptionsSinceVerify", 0);
                writeVerifyState(vs);
            } catch (Exception ve) {
                Log.w(TAG, "管理员激活初始化验证状态失败(不影响激活)", ve);
            }

            // 7. 保存激活记录（★ 2026-08-29 邀请码自愈：服务端 admin-status 已返回真实激活码
            //    licenseInfo.licenseCode，此处存明文 code + codeHash，供 loadInviteInfo
            //    第3来源（getActivationRecord）读取；旧版本激活无码则留空，由 machineId 联网兜底）
            try {
                JSONObject ar = new JSONObject();
                String code = (licenseCode == null ? "" : licenseCode.trim());
                if (!code.isEmpty()) {
                    try {
                        MessageDigest md = MessageDigest.getInstance("SHA-256");
                        byte[] hash = md.digest(code.getBytes(StandardCharsets.UTF_8));
                        StringBuilder sb = new StringBuilder();
                        for (byte b : hash) sb.append(String.format("%02x", b));
                        ar.put("codeHash", sb.toString());
                    } catch (Exception he) {
                        ar.put("codeHash", "");
                    }
                    ar.put("code", code);
                } else {
                    ar.put("codeHash", "");
                }
                ar.put("adminActivated", true);
                ar.put("activateTime", System.currentTimeMillis());
                ar.put("machineId", mid);
                writeActivationRecord(ar);
            } catch (Exception ae) {
                Log.w(TAG, "管理员激活保存激活记录失败(不影响激活)", ae);
            }

            // 8. 创建登录账号（手机号为登录账号，密码可留空=admin）
            try {
                String effPwd = (password == null || password.isEmpty()) ? "admin" : password;
                String login = (loginUsername == null || loginUsername.isEmpty()) ? user : loginUsername;
                syncCreateActivationUser(login, phone, effPwd, user);
            } catch (Exception ue) {
                Log.w(TAG, "管理员激活创建登录账号失败(不影响激活): " + ue.getMessage());
            }

            JSONObject r = new JSONObject();
            r.put("success", true);
            r.put("message", "激活成功，请重启应用");
            r.put("license", licenseBase64);
            return r;
        } catch (Exception e) {
            Log.e(TAG, "管理员激活安装失败", e);
            return failResult("激活失败: " + e.getMessage());
        }
        } // synchronized(sInstallLock)
    }


    // ========================================================================
    //  ★ 版本规范化：将API返回的license type映射为config.json标准edition值
    //    并确定用户角色：机构版=admin，标准版=user
    //  ========================================================================
    private JSONObject normalizeEdition(String rawType) {
        JSONObject result = new JSONObject();
        try {
            String t = (rawType != null) ? rawType.toLowerCase().trim() : "";
            // 标准版（个人/标准）
            if (t.equals("personal") || t.equals("standard")) {
                result.put("edition", "personal");
                result.put("role", "user");
                result.put("isInstitutional", false);
            }
            // 机构版（机构/专业）
            // ★ 2026-09-07 白名单对齐服务端 versionOf（license-core.js 认 7 种）：
            //   原 4 种缺 cloud_clinic/offline_clinic/institutional，服务端签发
            //   这些值时会被误归 personal（错显【修改密码】）。
            else if (t.equals("pro") || t.equals("institution") || t.equals("clinic") || t.equals("clinic_custom")
                    || t.equals("cloud_clinic") || t.equals("offline_clinic") || t.equals("institutional")) {
                result.put("edition", "clinic");
                result.put("role", "admin");
                result.put("isInstitutional", true);
            }
            // 默认：标准版
            else {
                result.put("edition", "personal");
                result.put("role", "user");
                result.put("isInstitutional", false);
            }
        } catch (Exception e) {
            try {
                result.put("edition", "personal");
                result.put("role", "user");
                result.put("isInstitutional", false);
            } catch (Exception ignored) {}
        }
        return result;
    }

    // ========================================================================
    //  ★ 同步 config.edition 和用户角色到 filesDir/config.json
    //  ========================================================================
    private void syncConfigEdition(String rawType) {
        try {
            JSONObject editionInfo = normalizeEdition(rawType);
            String newEdition = editionInfo.optString("edition", "personal");
            String newRole = editionInfo.optString("role", "user");
            boolean isInstitutional = editionInfo.optBoolean("isInstitutional", false);

            JSONObject cfg = readConfigJSON();
            boolean changed = false;

            // 更新 edition
            if (!newEdition.equals(cfg.optString("edition", ""))) {
                cfg.put("edition", newEdition);
                Log.i(TAG, "版本同步: config.edition → " + newEdition);
                changed = true;
            }

            // 调整用户角色
            if (cfg.has("users")) {
                org.json.JSONArray users = cfg.optJSONArray("users");
                if (users != null) {
                    for (int i = 0; i < users.length(); i++) {
                        org.json.JSONObject u = users.optJSONObject(i);
                        if (u != null) {
                            String oldRole = u.optString("role", "");
                            if (!newRole.equals(oldRole)) {
                                u.put("role", newRole);
                                Log.i(TAG, "版本同步: 用户 " + u.optString("username", "?") + " role → " + newRole);
                                changed = true;
                            }
                        }
                    }
                }
            }

            if (changed) writeConfigJSON(cfg, true);
        } catch (Exception e) {
            Log.w(TAG, "同步版本信息失败(不影响激活): " + e.getMessage());
        }
    }

    // ★ 2026-08-24 登录自愈：读取 config.json 中的激活账号（users 数组）供前端同步到 localStorage
    //   背景：installAdminLicense/activateOnline 创建的账号写在 filesDir/config.json 的 users 里，
    //   但前端登录只读 localStorage.local_systemUsers，两侧脱节导致"激活成功却登录失败"。
    //   前端启动时调用此接口 UPSERT，保证两侧一致（历史错密码账号也能被纠正）。
    public JSONObject getActivationUsers() {
        JSONObject r = new JSONObject();
        try {
            JSONObject cfg = readConfigJSON();
            org.json.JSONArray users = cfg.optJSONArray("users");
            if (users == null) users = new org.json.JSONArray();
            r.put("success", true);
            r.put("users", users);
            // ★ 2026-09-06 第七轮修复：补 config 顶层诊所名/医师名。激活弹窗预填降级链
            //   （localStorage registrationInfo 丢失时桥兜底）原先只取 users[].name/phone，
            //   诊所名仅靠 WebView CONFIG.clinicName（会话旧值/空）→ 预填条件不满足 →
            //   注册用户选版本后静默落入"填写信息"表单页（条目十七同族缺口）。
            r.put("clinicName", cfg.optString("clinicName", ""));
            r.put("doctorName", cfg.optString("doctorName", ""));
        } catch (Exception e) {
            try { r.put("success", false); r.put("error", String.valueOf(e.getMessage())); } catch (Exception ignored) {}
        }
        return r;
    }

    // ========================================================================
    // ★ 2026-09-06 机构版按钮修复：getAppConfig 桥（对齐桌面 main.js 'get-app-config'）
    //   背景：安卓 electronAPI shim 缺 getAppConfig → index.html L927 异步加载
    //   userData 权威 config 整段不执行 → CONFIG.edition 恒为出厂 personal →
    //   enforceStandardEditionButtons 强制标准版对齐 → 机构版顶部错显示【修改密码】。
    //   语义：读 filesDir config.json（fallback assets）→ 合并 defaults →
    //   非正式机构版强制 personal + admin 降级 user（防 config 篡改）→ {success, config}
    // ========================================================================
    public JSONObject getAppConfigBridge() {
        JSONObject r = new JSONObject();
        try {
            // defaults（与桌面 get-app-config 完全一致）
            JSONObject merged = new JSONObject();
            merged.put("clinicName", "本能堂中医诊所");
            merged.put("doctorName", "本能堂");
            merged.put("edition", "personal");
            merged.put("productName", "惠康中医-本地");

            // filesDir 权威 config 覆盖 defaults（逐键合并，cfg 优先）
            JSONObject cfg = readConfigJSON();
            java.util.Iterator<String> it = cfg.keys();
            while (it.hasNext()) {
                String k = it.next();
                merged.put(k, cfg.opt(k));
            }

            // 授权身份判定（对齐桌面：validateLicense 有效 + license.type 机构类）
            // 注意用 license.type 而非降级后的 licenseType —— 90 天未在线验证降级分支
            // 仍是正式授权，桌面端同语义（readLicense().type 判定），保持一致防误伤。
            // ★ 2026-09-07 P0 修复：判定改用 normalizeEdition(单一来源)——原独立 4 种
            //   白名单与服务端 versionOf（7 种）漂移，license.type=offline_clinic 等
            //   会被误判非机构版 → 强制 personal → 错显【修改密码】。
            boolean formalInstitution = false;
            String formalLicType = "";
            try {
                JSONObject vr = validateLicense();
                if (vr != null && vr.optBoolean("valid", false)) {
                    JSONObject lic = vr.optJSONObject("license");
                    formalLicType = lic != null ? lic.optString("type", "").toLowerCase().trim() : "";
                    formalInstitution = normalizeEdition(formalLicType).optBoolean("isInstitutional", false);
                }
            } catch (Exception ve) {
                Log.w(TAG, "getAppConfig 授权身份判定失败（保守按非机构版）: " + ve.getMessage());
            }

            if (!formalInstitution) {
                // 未正式授权(试用/过期/空)或非机构版 → 强制标准版 + 管理员降级
                merged.put("edition", "personal");
                merged.put("productName", "惠康中医-本地");
                org.json.JSONArray users = merged.optJSONArray("users");
                if (users != null) {
                    for (int i = 0; i < users.length(); i++) {
                        org.json.JSONObject u = users.optJSONObject(i);
                        if (u != null && ("admin".equals(u.optString("role", ""))
                                || "clinic_admin".equals(u.optString("role", "")))) {
                            u.put("role", "user");
                        }
                    }
                }
            } else if (!"clinic".equals(merged.optString("edition", ""))) {
                // ★ 2026-09-07 P0 修复（存量自愈，对齐桌面 main.js 装码即绑定）：
                //   正式机构版授权但 config.edition 错写——历史装码 bug 曾把
                //   config.edition 错写成 personal 且用户角色被降级 user
                //   （decryptLicenseContent 对服务端纯 base64 必 null →
                //   syncConfigEdition("personal") 错写）。此处落盘自愈：
                //   syncConfigEdition 内部 changed 才写（幂等），恢复 edition=clinic
                //   + 用户角色 admin；存量设备无需重走激活，重启即恢复【用户管理】。
                try {
                    if (!formalLicType.isEmpty()) {
                        syncConfigEdition(formalLicType);
                        // 落盘已恢复（edition=clinic + users role=admin），merged 重读对齐
                        org.json.JSONArray healedUsers = readConfigJSON().optJSONArray("users");
                        if (healedUsers != null) merged.put("users", healedUsers);
                    }
                } catch (Exception healErr) {
                    Log.w(TAG, "getAppConfig 机构版自愈落盘失败: " + healErr.getMessage());
                }
                merged.put("edition", "clinic");
                Log.i(TAG, "getAppConfig: 机构版授权校正 edition → clinic（自愈，license.type=" + formalLicType + "）");
            }

            r.put("success", true);
            r.put("config", merged);
        } catch (Exception e) {
            try {
                r.put("success", false);
                r.put("error", String.valueOf(e.getMessage()));
            } catch (Exception ignored) {}
        }
        return r;
    }

    // ★ 2026-09-04 方案B 注册前置：本地注册（先注册后激活）——离线端唯一密码写点
    //   注册=创建手机号登录账号（明文密码与 syncCreateActivationUser 存储格式一致，
    //   登录时前端自动兼容并升级哈希）；激活链永远不覆盖已注册密码（见 syncCreateActivationUser）。
    public JSONObject registerLocalUser(String clinicName, String doctorName, String phone, String password) {
        JSONObject r = new JSONObject();
        try {
            if (phone == null || !phone.trim().matches("^1[3-9]\\d{9}$")) {
                r.put("success", false); r.put("error", "请输入正确的11位手机号"); return r;
            }
            if (password == null || password.length() < 8 || "admin".equals(password)
                    || !password.matches(".*[a-zA-Z].*") || !password.matches(".*\\d.*")) {
                r.put("success", false); r.put("error", "密码至少8位且须同时包含字母和数字"); return r;
            }
            String effPhone = phone.trim();
            JSONObject cfg = readConfigJSON();
            // 同步诊所名/医师名（注册即写入 config，激活时服务端信息与此对齐）
            String effClinic = clinicName == null ? "" : clinicName.trim();
            String effDoctor = doctorName == null ? "" : doctorName.trim();
            if (!effClinic.isEmpty() && !effClinic.equals(cfg.optString("clinicName", ""))) {
                cfg.put("clinicName", effClinic);
            }
            if (!effDoctor.isEmpty() && !effDoctor.equals(cfg.optString("doctorName", ""))) {
                cfg.put("doctorName", effDoctor);
            }
            org.json.JSONArray users = cfg.optJSONArray("users");
            if (users == null) { users = new org.json.JSONArray(); cfg.put("users", users); }
            int existsIdx = -1;
            for (int i = 0; i < users.length(); i++) {
                org.json.JSONObject u = users.optJSONObject(i);
                if (u != null && effPhone.equals(u.optString("username", ""))) { existsIdx = i; break; }
            }
            long now = System.currentTimeMillis();
            String effName = effDoctor.isEmpty() ? effPhone : effDoctor;
            if (existsIdx >= 0) {
                org.json.JSONObject u = users.optJSONObject(existsIdx);
                if (u == null) u = new org.json.JSONObject();
                u.put("username", effPhone);
                u.put("phone", effPhone);
                u.put("password", password);
                u.put("name", effName);
                u.put("role", "admin");
                if (!u.has("registeredAt")) u.put("registeredAt", now);
                u.put("lastPwdUpdatedAt", now);
                u.put("updatedAt", now);
                users.put(existsIdx, u);
                Log.i(TAG, "本地注册 UPSERT 更新: phone=" + effPhone);
            } else {
                org.json.JSONObject nu = new org.json.JSONObject();
                nu.put("username", effPhone);
                nu.put("phone", effPhone);
                nu.put("password", password);
                nu.put("name", effName);
                nu.put("role", "admin");
                nu.put("registeredAt", now);
                nu.put("lastPwdUpdatedAt", now);
                nu.put("updatedAt", now);
                users.put(nu);
                Log.i(TAG, "本地注册新增账号: phone=" + effPhone + " clinic=" + effClinic);
            }
            // ★ 幽灵默认账户移除：注册完成后，出厂试用 admin（密码仍为原生默认，未被用户改过）一并删除。
            //   保守判定（宁可漏删不可误删）：username='admin' 且 password 为明文 'admin' 或出厂哈希
            //   （sha256('bnzc_prescription_salt_v1'+'admin')，与 assets/public/config.json 出厂值一致）；
            //   用户改过密码的真实 admin 账户保留。
            {
                org.json.JSONArray cleaned = new org.json.JSONArray();
                final String defaultAdminHash = "2f1e152dfbccedc7d947d7f9d40e0790be6289309cf6904af728b3cf822c361b";
                boolean removed = false;
                for (int i = 0; i < users.length(); i++) {
                    org.json.JSONObject u = users.optJSONObject(i);
                    boolean keep = true;
                    if (u != null && "admin".equals(u.optString("username", ""))) {
                        String p = u.optString("password", "");
                        if ("admin".equals(p) || defaultAdminHash.equals(p)) { keep = false; removed = true; }
                    }
                    if (keep) cleaned.put(u);
                }
                if (removed) {
                    users = cleaned;
                    cfg.put("users", users);
                    Log.i(TAG, "本地注册: 已移除出厂默认试用账户 admin（原生默认口令，未被用户改过）");
                }
            }
            writeConfigJSON(cfg, true);
            r.put("success", true);
            r.put("users", users);
        } catch (Exception e) {
            try { r.put("success", false); r.put("error", String.valueOf(e.getMessage())); } catch (Exception ignored) {}
        }
        return r;
    }

    // ★ 2026-09-06 第八轮修复（Single-Writer 补全）：改密/重置/编辑用户 回写 config.json 权威层。
    //   背景：第七轮 addLocalActivationUser 改为「Java 权威源强制覆盖 localStorage 镜像」后，
    //   前端三个密码写点（忘记密码重置/用户管理编辑/修改密码）里只有"修改密码"接了 renameUser
    //   桥（且 APP 端 MainActivity 未暴露该桥 = 静默空操作），忘记密码/编辑用户两处则完全没回写
    //   ——用户改完密码，下次冷启动启动自愈 UPSERT 又把 config.json 旧密码盖回 localStorage
    //   （"改密/重置重启后失效"）。本方法对齐桌面 electron/main.js 的 user:rename-username 语义：
    //   - 按 username 或 phone 定位 config 账户（兼容改名后旧号回登的自愈场景）
    //   - newUsername 空 = 只改密不改名（忘记密码重置场景）
    //   - phone 保底：旧 username 是手机号且 phone 空 → 先落 phone（保手机号登录）
    //   - newPassword 非空 → 明文写入（与 registerLocalUser 存储格式一致，前端登录自动兼容
    //     并升级哈希）+ lastPwdUpdatedAt 时间戳（供前端镜像比对基线）
    //   - config 无该账户（纯本地账号）→ no-op 返回 synced:false（本地已保存，非错误）
    public JSONObject renameUserBridge(String oldUsername, String newUsername, String newPassword) {
        JSONObject r = new JSONObject();
        try {
            if (oldUsername == null || oldUsername.trim().isEmpty()) {
                r.put("success", false); r.put("error", "缺少原账号"); return r;
            }
            String oldName = oldUsername.trim();
            String newName = (newUsername == null) ? "" : newUsername.trim();
            String newPwd = (newPassword == null) ? "" : newPassword;
            JSONObject cfg = readConfigJSON();
            org.json.JSONArray users = cfg.optJSONArray("users");
            if (users == null) { r.put("success", true); r.put("synced", false); return r; }
            int idx = -1;
            for (int i = 0; i < users.length(); i++) {
                org.json.JSONObject u = users.optJSONObject(i);
                if (u != null && oldName.equals(u.optString("username", ""))) { idx = i; break; }
            }
            if (idx < 0) {
                for (int i = 0; i < users.length(); i++) {
                    org.json.JSONObject u = users.optJSONObject(i);
                    if (u != null && oldName.equals(u.optString("phone", ""))) { idx = i; break; }
                }
            }
            if (idx < 0) { r.put("success", true); r.put("synced", false); return r; }
            org.json.JSONObject u = users.optJSONObject(idx);
            if (u == null) u = new org.json.JSONObject();
            // phone 保底：原 username 是手机号且 phone 为空 → 先落 phone（保手机号登录）
            if (oldName.matches("^1[3-9]\\d{9}$") && u.optString("phone", "").isEmpty()) {
                u.put("phone", oldName);
            }
            if (!newName.isEmpty() && !newName.equals(u.optString("username", ""))) {
                u.put("username", newName);
            }
            long now = System.currentTimeMillis();
            if (!newPwd.isEmpty()) {
                u.put("password", newPwd);
                u.put("lastPwdUpdatedAt", now);
            }
            u.put("updatedAt", now);
            users.put(idx, u);
            writeConfigJSON(cfg, true);
            Log.i(TAG, "renameUser 回写 config.json: " + oldName + " -> " +
                    (newName.isEmpty() ? u.optString("username", "?") : newName) +
                    (newPwd.isEmpty() ? "" : " (密码已同步)"));
            r.put("success", true); r.put("synced", true);
        } catch (Exception e) {
            try { r.put("success", false); r.put("error", String.valueOf(e.getMessage())); } catch (Exception ignored) {}
        }
        return r;
    }

    // ★ 2026-08-17 激活流程改「用户名(姓名/手机号)+默认密码admin」：
    //   激活成功后自动创建登录账号；已存在同名账号则跳过；密码明文存储，登入时前端自动兼容并升级
    private void syncCreateActivationUser(String username, String phone, String password, String name) {
        if (username == null || username.isEmpty()) return;
        try {
            JSONObject cfg = readConfigJSON();
            org.json.JSONArray users = cfg.optJSONArray("users");
            if (users == null) {
                users = new org.json.JSONArray();
                cfg.put("users", users);
            }
            int existsIdx = -1;
            for (int i = 0; i < users.length(); i++) {
                org.json.JSONObject u = users.optJSONObject(i);
                if (u != null && username.equals(u.optString("username", ""))) { existsIdx = i; break; }
            }
            final String effPwd = (password == null || password.isEmpty()) ? "admin" : password;
            final String effName = (name == null || name.isEmpty()) ? username : name;
            if (existsIdx >= 0) {
                // --- 2026-09-04 AR-双锁死：UPSERT UPDATE（不再 exists=return）---
                // ★ 2026-09-04 方案B 密码写点唯一化（取代旧"UPDATE 强制覆盖密码"条款）：
                //   账号已存在（注册创建）时激活收尾只补 phone/name，绝不覆盖密码——
                //   防止激活收尾把注册密码重置回 admin（Mate 70 第7案密码错位的架构级根治）。
                //   密码仅三个写点：registerLocalUser（注册）/ 修改密码 / 账号不存在时的激活兜底建号。
                org.json.JSONObject u = users.optJSONObject(existsIdx);
                if (u == null) u = new org.json.JSONObject();
                u.put("username", username);
                if (phone != null && !phone.isEmpty()) u.put("phone", phone);
                else if (!u.has("phone")) u.put("phone", "");
                if (u.optString("password", "").isEmpty()) u.put("password", effPwd);
                u.put("name", effName);
                u.put("role", "admin");
u.put("updatedAt", System.currentTimeMillis());

                users.put(existsIdx, u);
                Log.i(TAG, "激活登录账号 UPSERT 更新(密码保留): username=" + username + " phone=" + phone + " name=" + effName);
            } else {
                org.json.JSONObject nu = new org.json.JSONObject();
                nu.put("username", username);
                if (phone != null && !phone.isEmpty()) nu.put("phone", phone);
                nu.put("password", effPwd);
                nu.put("name", effName);
                nu.put("role", "admin");nu.put("lastPwdUpdatedAt", System.currentTimeMillis());
nu.put("updatedAt", System.currentTimeMillis());

                users.put(nu);
                Log.i(TAG, "激活登录账号 UPSERT 新增: username=" + username + " phone=" + phone + " name=" + effName);
            }
            writeConfigJSON(cfg, true);
        } catch (Exception ex) {
            Log.w(TAG, "创建登录账号异常(不影响激活): " + ex.getMessage());
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
        // ★ 第三轮终检 P1 修复：readLicense 只解密不验签，maxPrescriptions 字段可被篡改
        //   （与桌面版 prescription-counter.js 修复对齐），验签失败按试用限制处理
        try {
            if (!verifySignature(license)) {
                Log.w(TAG, "license 验签失败，处方上限按试用限制处理");
                return TRIAL_MAX_PRESCRIPTIONS;
            }
        } catch (Exception e) {
            Log.w(TAG, "license 验签异常，处方上限按试用限制处理: " + e.getMessage());
            return TRIAL_MAX_PRESCRIPTIONS;
        }
        JSONObject normalized = normalizeLicense(license);
        if (normalized == null) return TRIAL_MAX_PRESCRIPTIONS;
        return normalized.optInt("maxPrescriptions", 0);
    }

    public JSONObject canPrescribe() {
        try {
            // ★ 2026-09-05 试用到期只读模式：license 无效且属试用到期族（trial_expired/
            //   trial_limit_reached）→ 原生层直接禁开方（只读模式放行查看历史数据，
            //   JS 层 savePrescription 守卫 + 本处双保险）。校验异常不扩大拦截面，
            //   回落原计数逻辑（启动闸 performNativeStartupLicenseCheck 已拦截异常态）。
            try {
                JSONObject lic = validateLicense();
                if (lic != null && !lic.optBoolean("valid", false)) {
                    String lt = lic.optString("type", "");
                    if ("trial_expired".equals(lt) || "trial_limit_reached".equals(lt)) {
                        JSONObject ro = new JSONObject();
                        ro.put("allowed", false);
                        ro.put("current", 0);
                        ro.put("max", -1);
                        ro.put("remaining", 0);
                        ro.put("readOnly", true);
                        return ro;
                    }
                }
            } catch (Exception ve) {
                Log.w(TAG, "canPrescribe 试用状态检查异常(回落计数逻辑): " + ve.getMessage());
            }
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
            // ★ 第三轮终检修复：授权执行点异常时 fail-closed（与桌面版 IPC 修复对齐），
            //   按试用限制拒绝，避免构造异常（如损坏 count 文件）绕过处方上限
            try {
                JSONObject r = new JSONObject();
                r.put("allowed", false);
                r.put("current", 0);
                r.put("max", TRIAL_MAX_PRESCRIPTIONS);
                r.put("remaining", 0);
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
