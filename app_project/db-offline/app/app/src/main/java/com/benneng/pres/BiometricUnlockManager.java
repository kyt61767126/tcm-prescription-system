package com.benneng.pres;

import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.security.keystore.UserNotAuthenticatedException;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;
import androidx.fragment.app.FragmentActivity;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.security.InvalidKeyException;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.security.UnrecoverableKeyException;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

import javax.crypto.AEADBadTagException;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * 指纹快速登录（2026-09-27）。
 *
 * 安全模型：
 *  - 指纹 <b>只替代输入密码</b>：解锁成功后把原密码返回给渲染层，由渲染层
 *    走原来的 handleLogin / verifyLoginGate 完整链路，绝不新增放行路径。
 *  - 每账号一把 Android Keystore AES-256-GCM 密钥，setUserAuthenticationRequired，
 *    setInvalidatedByBiometricEnrollment；密钥不可导出，录入新指纹自动作废。
 *  - 仅接受 BIOMETRIC_STRONG；硬件/录入不达标时调用方应完全隐藏入口。
 *  - 密文文件 = 12 字节 IV ‖ 密文（含 GCM tag），存私有目录 files/biometric，
 *    文件名为账号哈希，不暴露用户名。
 *
 * 线程：invoke 在桥线程，BiometricPrompt 在主线程。本类用 CountDownLatch
 * 把异步回调收口为同步 JSON 返回；任何异常/取消/超时均 fail-closed。
 */
public class BiometricUnlockManager {

    private static final String TAG = "BiometricUnlock";
    private static final String ANDROID_KEYSTORE = "AndroidKeyStore";
    private static final String KEY_PREFIX = "biou_";
    private static final String TRANSFORMATION = "AES/GCM/NoPadding";
    private static final int IV_LENGTH = 12;
    private static final int GCM_TAG_BITS = 128;
    private static final long PROMPT_TIMEOUT_MS = 45000;
    private static final String HASH_SALT = "hk-biometric-v1";

    private final FragmentActivity activity;
    private final File dir;

    public BiometricUnlockManager(FragmentActivity activity) {
        this.activity = activity;
        this.dir = new File(activity.getFilesDir(), "biometric");
    }

    // ====================================================================
    // 对外动作（返回 JSON 字符串约定与 MainActivity.invoke 一致）
    // ====================================================================

    /** 探针：{success, capable, canEnroll, authResult}。capable=false 时入口必须隐藏。 */
    public JSONObject probe() {
        try {
            BiometricManager bm = BiometricManager.from(activity);
            int r = bm.canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG);
            JSONObject o = new JSONObject();
            o.put("success", true);
            o.put("authResult", r);
            o.put("capable", r == BiometricManager.BIOMETRIC_SUCCESS);
            // BIOMETRIC_ERROR_NONE_ENROLLED = 有硬件但没录入指纹
            o.put("canEnroll", r == BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED);
            return o;
        } catch (Exception e) {
            Log.w(TAG, "probe 异常: " + e.getMessage());
            return fail("probe error");
        }
    }

    /** 指定账号是否已开通：{success, enrolled} */
    public JSONObject status(String username) {
        try {
            JSONObject o = new JSONObject();
            o.put("success", true);
            o.put("enrolled", isEnrolled(username));
            return o;
        } catch (Exception e) {
            return fail("status error");
        }
    }

    /** 列出全部已开通账号（哈希名）：{success, items:[...]} */
    public JSONObject list() {
        try {
            JSONArray arr = new JSONArray();
            File[] files = dir.listFiles();
            if (files != null) {
                for (File f : files) arr.put(f.getName());
            }
            JSONObject o = new JSONObject();
            o.put("success", true);
            o.put("items", arr);
            return o;
        } catch (Exception e) {
            return fail("list error");
        }
    }

    /**
     * 开通：生成/重置账号密钥 → 指纹验证 → 加密密码落盘。
     */
    public JSONObject enroll(String username, String password) {
        String u = normalize(username);
        if (u.isEmpty() || password == null || password.isEmpty()) {
            return fail("缺少用户名或密码");
        }
        if (!strongCapable()) return fail("本机不支持指纹解锁");

        final boolean existedBefore = isEnrolled(u);
        try {
            // M2：已开通用户重新开通（本质=用指纹加密新密码）必须复用旧密钥。
            //   若在认证前 createKey 覆盖，用户取消后旧 blob 由新密钥再也解不开，
            //   「保留旧凭据」承诺不成立。仅首次开通才建钥；取消时旧凭据原样可用。
            final SecretKey key = existedBefore ? getKey(alias(u)) : createKey(alias(u));
            final byte[] plain = password.getBytes(StandardCharsets.UTF_8);
            JSONObject res = authenticate(new CryptoJob() {
                @Override
                Cipher cipherForPrompt() throws Exception {
                    Cipher c = Cipher.getInstance(TRANSFORMATION);
                    c.init(Cipher.ENCRYPT_MODE, key);
                    return c;
                }

                @Override
                JSONObject runAfterAuth(Cipher authenticated) throws Exception {
                    Cipher c;
                    if (authenticated != null) {
                        c = authenticated;
                    } else {
                        // 旧版系统：先认证、认证后窗口内初始化
                        c = Cipher.getInstance(TRANSFORMATION);
                        c.init(Cipher.ENCRYPT_MODE, key);
                    }
                    byte[] iv = c.getIV();
                    byte[] ct = c.doFinal(plain);
                    try {
                        writeBlob(u, iv, ct);
                    } catch (Exception we) {
                        // 密文落盘失败 → 回滚刚生成的密钥，避免孤儿凭据
                        // （密钥在、密文不在 = status 永久 false 且占 Keystore 别名）
                        delete(u);
                        throw we;
                    }
                    return ok();
                }
            }, "开通指纹快速登录", "验证指纹以开通");
            // L3：取消/失败时，若是本次新建的密钥（此前未开通）则回滚，
            //   不留孤儿 Keystore 别名；已开通用户重新开通失败则保留旧凭据
            if (res == null || !res.optBoolean("success")) {
                if (!existedBefore) delete(u);
            }
            return res;
        } catch (Exception e) {
            Log.w(TAG, "enroll 失败: " + e.getMessage());
            if (!existedBefore) {
                try { delete(u); } catch (Exception ignored) {}
            }
            return fail("开通失败");
        }
    }

    /**
     * 解锁：指纹验证 → 解密 → 返回密码。任何异常都 fail-closed。
     */
    public JSONObject unlock(String username) {
        String u = normalize(username);
        if (u.isEmpty()) return fail("缺少用户名");
        if (!isEnrolled(u)) return fail("未开通");

        try {
            final SecretKey key = getKey(alias(u));
            final byte[] stored;
            try {
                stored = readBlob(u);
            } catch (Exception bad) {
                // M-2：密文文件确定性损坏（截断/长度非法）或不可读——不可恢复。
                //   若只回 failed，JS 不删不隐藏，入口每次必败永久假死；这里
                //   密钥+密文一并清掉，用户密码登录后重新开通。
                Log.w(TAG, "密文损坏不可读，自清: " + bad.getMessage());
                delete(u);
                return fail("invalidated", "指纹凭据已失效，请用密码登录后重新开通");
            }
            final byte[] iv = new byte[IV_LENGTH];
            final byte[] ct = new byte[stored.length - IV_LENGTH];
            System.arraycopy(stored, 0, iv, 0, IV_LENGTH);
            System.arraycopy(stored, IV_LENGTH, ct, 0, ct.length);

            JSONObject res = authenticate(new CryptoJob() {
                @Override
                Cipher cipherForPrompt() throws Exception {
                    Cipher c = Cipher.getInstance(TRANSFORMATION);
                    c.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(GCM_TAG_BITS, iv));
                    return c;
                }

                @Override
                JSONObject runAfterAuth(Cipher authenticated) throws Exception {
                    Cipher c;
                    if (authenticated != null) {
                        c = authenticated;
                    } else {
                        c = Cipher.getInstance(TRANSFORMATION);
                        c.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(GCM_TAG_BITS, iv));
                    }
                    byte[] plain = c.doFinal(ct);
                    JSONObject o = new JSONObject();
                    o.put("success", true);
                    o.put("password", new String(plain, StandardCharsets.UTF_8));
                    return o;
                }
            }, "指纹解锁", u);
            // H1：密钥作废（新增指纹/锁屏清空）或密文 GCM 校验失败（损坏/不匹配）
            //   均不可恢复——统一清掉密钥+密文，JS 据 code=invalidated 隐藏入口，
            //   用户本次用密码登录后重新开通。绝不静默保留假死入口。
            if (res != null && "invalidated".equals(res.optString("code"))) {
                delete(u);
            }
            return res;
        } catch (InvalidKeyException | UnrecoverableKeyException e) {
            // 密钥已失效（指纹库变更等；UserNotAuthenticatedException 与
            //   KeyPermanentlyInvalidatedException 均为 InvalidKeyException 子类，
            //   单 catch 父类即可；UnrecoverableKeyException 为密钥已损坏/丢失）。
            Log.w(TAG, "unlock 密钥失效: " + e.getClass().getSimpleName());
            delete(u);
            return fail("invalidated", "指纹凭据已失效，请用密码登录后重新开通");
        } catch (Exception e) {
            Log.w(TAG, "unlock 失败: " + e.getMessage());
            return fail("failed", "解锁失败，请使用密码登录");
        }
    }

    /** 关闭：删除密钥与密文文件。 */
    public JSONObject delete(String username) {
        String u = normalize(username);
        if (u.isEmpty()) return fail("缺少用户名");
        boolean removed = false;
        try {
            KeyStore ks = KeyStore.getInstance(ANDROID_KEYSTORE);
            ks.load(null);
            String a = alias(u);
            if (ks.containsAlias(a)) {
                ks.deleteEntry(a);
                removed = true;
            }
        } catch (Exception e) {
            Log.w(TAG, "delete key 异常: " + e.getMessage());
        }
        File f = blobFile(u);
        if (f.exists() && f.delete()) removed = true;
        try {
            JSONObject o = new JSONObject();
            o.put("success", true);
            o.put("removed", removed);
            return o;
        } catch (Exception e) {
            return fail("delete error");
        }
    }

    // ====================================================================
    // 内部实现
    // ====================================================================

    private boolean strongCapable() {
        try {
            return BiometricManager.from(activity)
                    .canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG)
                    == BiometricManager.BIOMETRIC_SUCCESS;
        } catch (Exception e) {
            return false;
        }
    }

    private boolean isEnrolled(String username) {
        try {
            String u = normalize(username);
            KeyStore ks = KeyStore.getInstance(ANDROID_KEYSTORE);
            ks.load(null);
            return ks.containsAlias(alias(u)) && blobFile(u).exists();
        } catch (Exception e) {
            return false;
        }
    }

    private SecretKey createKey(String alias) throws Exception {
        KeyGenerator kg = KeyGenerator.getInstance(
                KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE);
        KeyGenParameterSpec.Builder b = new KeyGenParameterSpec.Builder(
                alias,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setUserAuthenticationRequired(true)
                .setInvalidatedByBiometricEnrollment(true);
        kg.init(b.build());
        kg.generateKey();
        return getKey(alias);
    }

    private SecretKey getKey(String alias) throws Exception {
        KeyStore ks = KeyStore.getInstance(ANDROID_KEYSTORE);
        ks.load(null);
        return (SecretKey) ks.getKey(alias, null);
    }

    /**
     * 阻塞式指纹验证。现代路径携带 CryptoObject（init 成功）；API 23–27 上
     * init 会抛 UserNotAuthenticatedException → 不携带 CryptoObject，
     * 认证成功后在 runAfterAuth 内初始化。
     */
    private JSONObject authenticate(final CryptoJob job, String title, String subtitle)
            throws InterruptedException {
        // L4：finishing 与 destroyed 都拒绝，避免销毁竞态下在死 Activity 上弹窗
        if (activity.isFinishing() || activity.isDestroyed()) {
            return fail("unavailable", "页面不可用，请稍后重试");
        }

        Cipher promptCipher = null;
        try {
            promptCipher = job.cipherForPrompt();
        } catch (UserNotAuthenticatedException e) {
            promptCipher = null; // API23-27 先认证后使用
        } catch (InvalidKeyException e) {
            // H1：KeyPermanentlyInvalidatedException（新增/删除指纹、清空锁屏
            //   凭据后密钥作废）走这里——它继承 InvalidKeyException 而非
            //   UserNotAuthenticatedException。作废不可逆，unlock 收到
            //   invalidated 后清掉密钥与密文，避免入口永久假死。
            //   （UserNotAuthenticatedException 也是 InvalidKeyException 子类，
            //   但已在上一 catch 先截获走降级路径。）
            Log.w(TAG, "密钥作废: " + e.getClass().getSimpleName());
            return fail("invalidated", "指纹凭据已失效，请用密码登录后重新开通");
        } catch (Exception e) {
            Log.w(TAG, "cipher 初始化失败: " + e.getMessage());
            return fail("unavailable", "指纹凭据不可用，请使用密码登录");
        }
        final BiometricPrompt.CryptoObject crypto =
                promptCipher != null ? new BiometricPrompt.CryptoObject(promptCipher) : null;

        final CountDownLatch latch = new CountDownLatch(1);
        final AtomicReference<JSONObject> result = new AtomicReference<>(null);
        final AtomicReference<BiometricPrompt> promptRef = new AtomicReference<>(null);
        // L4：桥等待超时后，迟到的系统回调一律丢弃，不再做加解密
        final java.util.concurrent.atomic.AtomicBoolean expired =
                new java.util.concurrent.atomic.AtomicBoolean(false);

        mainHandlerPost(new Runnable() {
            @Override
            public void run() {
              try {
                if (expired.get() || activity.isFinishing() || activity.isDestroyed()) return;
                final BiometricPrompt prompt = new BiometricPrompt(
                        activity,
                        ContextCompat.getMainExecutor(activity),
                        new BiometricPrompt.AuthenticationCallback() {
                            @Override
                            public void onAuthenticationSucceeded(
                                    @NonNull BiometricPrompt.AuthenticationResult ar) {
                                try {
                                    if (expired.get()) return; // 已超时，丢弃迟到结果
                                    Cipher c = ar.getCryptoObject() != null
                                            ? ar.getCryptoObject().getCipher() : null;
                                    result.set(job.runAfterAuth(c));
                                } catch (UserNotAuthenticatedException e) {
                                    // M-1：仅 API24-27 无 CryptoObject 降级路径可能
                                    //   到达——认证已成功但 ROM 未放开密钥使用窗。
                                    //   这是系统/ROM 状态问题，密钥与密文都没坏，
                                    //   绝不能归 invalidated（否则会把好凭据删掉，
                                    //   指纹验证「成功」反而丢入口）。不删除，可重试。
                                    Log.w(TAG, "认证后密钥仍不可用(ROM): "
                                            + e.getClass().getSimpleName());
                                    result.set(fail("unavailable",
                                            "指纹验证未生效，请重试或使用密码登录"));
                                } catch (InvalidKeyException e) {
                                    // 密钥作废（指纹库变更等），不可恢复→自清
                                    Log.w(TAG, "认证后密钥失效: "
                                            + e.getClass().getSimpleName());
                                    result.set(fail("invalidated",
                                            "指纹凭据已失效，请用密码登录后重新开通"));
                                } catch (AEADBadTagException e) {
                                    // GCM 鉴权标签失败：密文损坏/与密钥不匹配，
                                    //   不可恢复→unlock 收到 invalidated 后自清
                                    Log.w(TAG, "密文校验失败: " + e.getMessage());
                                    result.set(fail("invalidated",
                                            "指纹凭据已失效，请用密码登录后重新开通"));
                                } catch (Exception e) {
                                    // enroll 写盘 IO 失败等：普通失败，不夸大为作废
                                    Log.w(TAG, "认证后处理失败: " + e.getMessage());
                                    result.set(fail("failed", "操作失败，请重试或使用密码登录"));
                                } finally {
                                    latch.countDown();
                                }
                            }

                            @Override
                            public void onAuthenticationError(int errorCode,
                                                              @NonNull CharSequence errString) {
                                if (expired.get()) return; // 迟到的取消/错误不覆盖结果
                                // errorCode 归一化为稳定 code+文案：各厂商 ROM 的
                                // errString 不一（中/英/定制），JS 按 code 分支，
                                // 不靠中文正则；除 cancel 外都给用户红字反馈
                                String code;
                                String msg;
                                switch (errorCode) {
                                    case BiometricPrompt.ERROR_USER_CANCELED:
                                    case BiometricPrompt.ERROR_NEGATIVE_BUTTON:
                                    case BiometricPrompt.ERROR_CANCELED:
                                        code = "cancel";
                                        msg = "已取消";
                                        break;
                                    case BiometricPrompt.ERROR_LOCKOUT:
                                        code = "lockout";
                                        msg = "指纹尝试次数过多，请稍后再试或使用密码登录";
                                        break;
                                    case BiometricPrompt.ERROR_LOCKOUT_PERMANENT:
                                        code = "lockout";
                                        msg = "指纹已被锁定，请使用密码登录";
                                        break;
                                    case BiometricPrompt.ERROR_TIMEOUT:
                                        code = "timeout";
                                        msg = "指纹验证超时，请使用密码登录";
                                        break;
                                    case BiometricPrompt.ERROR_NO_BIOMETRICS:
                                    case BiometricPrompt.ERROR_HW_NOT_PRESENT:
                                    case BiometricPrompt.ERROR_HW_UNAVAILABLE:
                                    case BiometricPrompt.ERROR_NO_DEVICE_CREDENTIAL:
                                        code = "unavailable";
                                        msg = "指纹暂不可用，请使用密码登录";
                                        break;
                                    default:
                                        code = "failed";
                                        msg = String.valueOf(errString);
                                }
                                result.set(fail(code, msg));
                                latch.countDown();
                            }

                            @Override
                            public void onAuthenticationFailed() {
                                // 单次指纹不匹配，系统会继续等待；不结束 latch
                            }
                        });

                BiometricPrompt.PromptInfo info =
                        new BiometricPrompt.PromptInfo.Builder()
                                .setTitle(title)
                                .setSubtitle(subtitle)
                                .setNegativeButtonText("使用密码")
                                .setAllowedAuthenticators(
                                        BiometricManager.Authenticators.BIOMETRIC_STRONG)
                                .build();
                if (crypto != null) prompt.authenticate(info, crypto);
                else prompt.authenticate(info);
                promptRef.set(prompt);
              } catch (Exception e) {
                  // L-4：守卫与构造之间的销毁竞态等异常不得在主线程崩溃；
                  //   放桥以失败结束（compareAndSet 避免覆盖已到的成功结果）
                  Log.w(TAG, "指纹弹窗失败: " + e.getMessage());
                  if (expired.compareAndSet(false, true)) {
                      result.compareAndSet(null,
                              fail("unavailable", "指纹暂不可用，请使用密码登录"));
                      latch.countDown();
                  }
              }
            }
        });

        boolean done = latch.await(PROMPT_TIMEOUT_MS, TimeUnit.MILLISECONDS);
        if (!done) {
            // 超时：先封死迟到回调，再回主线程取消弹窗，fail-closed
            expired.set(true);
            mainHandlerPost(new Runnable() {
                @Override
                public void run() {
                    BiometricPrompt p = promptRef.get();
                    if (p != null) {
                        try { p.cancelAuthentication(); } catch (Exception ignored) {}
                    }
                }
            });
            return fail("timeout", "指纹验证超时，请使用密码登录");
        }
        JSONObject r = result.get();
        return r != null ? r : fail("failed", "指纹验证失败，请使用密码登录");
    }

    private void mainHandlerPost(Runnable r) {
        activity.runOnUiThread(r);
    }

    // ---- 存储 ----

    private File blobFile(String username) {
        return new File(dir, userHash(username));
    }

    private synchronized void writeBlob(String username, byte[] iv, byte[] ct) throws Exception {
        if (!dir.exists() && !dir.mkdirs()) throw new IllegalStateException("mkdirs fail");
        File f = blobFile(username);
        ByteArrayOutputStream bos = new ByteArrayOutputStream();
        bos.write(iv);
        bos.write(ct);
        try (FileOutputStream fos = new FileOutputStream(f)) {
            fos.write(bos.toByteArray());
        }
    }

    private byte[] readBlob(String username) throws Exception {
        File f = blobFile(username);
        byte[] all = new byte[(int) f.length()];
        try (FileInputStream fis = new FileInputStream(f)) {
            int off = 0;
            while (off < all.length) {
                int n = fis.read(all, off, all.length - off);
                if (n < 0) break;
                off += n;
            }
        }
        // 合法结构 = 12B IV + 密文 + 16B GCM tag，明文至少 1B → 总长 ≥29。
        // 收紧到 <29 即判损坏（覆盖 13-27B 截断带，避免个别 ROM 对短于 tag
        // 的输入抛非 AEADBadTagException 而漏走 invalidated 自清）。
        if (all.length < IV_LENGTH + (GCM_TAG_BITS / 8) + 1) {
            throw new IllegalStateException("bad blob");
        }
        return all;
    }

    // ---- 工具 ----

    private static String normalize(String username) {
        return username == null ? "" : username.trim();
    }

    private static String alias(String username) {
        return KEY_PREFIX + userHash(username);
    }

    private static String userHash(String username) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] h = md.digest((HASH_SALT + "|" + username).getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder();
            for (byte b : h) sb.append(String.format("%02x", b));
            return sb.substring(0, 32);
        } catch (Exception e) {
            // SHA-256 必然可用
            throw new IllegalStateException(e);
        }
    }

    private static JSONObject ok() {
        try {
            return new JSONObject().put("success", true);
        } catch (Exception e) {
            return null;
        }
    }

    private static JSONObject fail(String msg) {
        return fail("failed", msg);
    }

    /**
     * 稳定错误码（JS 按 code 分支，不依赖中文文案、不依赖 ROM errString）：
     * cancel=用户主动取消；invalidated=密钥/密文失效已自清（指纹库变更等）；
     * lockout=尝试过多锁定；timeout=45s 超时；unavailable=硬件/页面不可用；
     * failed=其他。
     */
    private static JSONObject fail(String code, String msg) {
        try {
            return new JSONObject()
                    .put("success", false)
                    .put("code", code)
                    .put("error", msg);
        } catch (Exception e) {
            return null;
        }
    }

    /** 认证作业：分别定义弹窗时的 cipher 与认证成功后的执行体。 */
    private abstract static class CryptoJob {
        abstract Cipher cipherForPrompt() throws Exception;
        abstract JSONObject runAfterAuth(Cipher authenticatedCipher) throws Exception;
    }
}
