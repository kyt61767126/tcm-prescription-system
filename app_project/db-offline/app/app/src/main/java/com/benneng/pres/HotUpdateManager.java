package com.benneng.pres;

// ============================================================================
//  HotUpdateManager — 离线APP 静默热更新（Phase 2a，2026-09-14）
//
//  【与桌面端 Phase 1 的关系】shared/hot-update-core.cjs 的 Android 同构实现：
//    同一信任根（license v7 同一把 Ed25519 密钥对）、同一发布链（Cloudflare Pages
//    散文件 + 签名 manifest）、同一回退哲学（assets 打包版是永久兜底，永不改动 →
//    APK v1/v2/v3 签名/NativeGuard/SecurityGuard 防篡改链全部保持有效）。
//
//  【三道门禁（fail-closed，任何失败回退 assets 打包版）】
//    ① Ed25519 验签：version.json 清单签名（私钥 tools/secrets/ 不入库，公钥
//      常量下方 + LicenseManager.ED25519_VERIFY_PUBLIC_KEY_HEX 同一把——⚠️ 密钥
//      轮换时两处 + tools/gen-hotupdate-test-fixture.cjs 三处同步 + 重跑 fixture）
//    ② 逐文件 SHA-256：下载后校验 + 每次启动 resolveEntry 全量复验
//    ③ minAppCode 硬门禁（APP 特有）：热包 JS 依赖 AndroidNative 桥接口，原生层
//      升级后旧 APK 装新热包会调到不存在的桥方法 → localAppCode < minAppCode 时
//      跳过热更（VERIFY_NEED_APK），转 APK 整包更新通道（startApkUpdateCheck 链路）
//
//  【协议（Phase 2b 生成工具 tools/generate-app-hotupdate.cjs 与本类逐字符对齐）】
//    签名消息 = 'app-hotupdate-v1|<channel>|<hotVersion>|<signedAt>|n1:h1:s1|n2:...'
//    channel 固定 'app-local'（≠ 桌面 'cloud'/'local'——协议绑定，防桌面热包喂 APP）
//    manifest: { format:1, channel, hotVersion(YYYY.MM.DD-N), minAppCode, files[{name,
//               sha256, size}], signedAt(ms), signature(base64) }
//
//  【目录布局（filesDir 下，与桌面 userData 布局同构）】
//    hot-update/current/          当前生效热目录（manifest.json + 全部文件）
//    hot-update/pending-<ver>/    下载中（swap 成功才晋升 current）
//    hot-update/.hot-version      本地已生效版本 {hotVersion, signedAt}
//    hot-update/old-<ts>/         swap 瞬间旧 current（成功后即删）
//    hot-update/quarantine-<ts>/  启动复验失败的坏 current（隔离留现场）
//
//  【静默语义】后台线程检查+增量下载（本地同哈希直接复制，只拉变更文件）+原子
//    swap，不打断使用；新版下次启动生效（登录页淡绿横幅轻提示）。无网/超时/
//    验签失败一律静默跳过（离线 APP 红线：宁可漏检不可误报、绝不闪退）。
//
//  【JUnit 可测性】纯逻辑（验签/哈希/复验/隔离/swap 准备）全部为静态方法且零
//    android.* 依赖（日志经可注入 Logger；org.json 走 testImplementation 真实实现；
//    Ed25519/Base64/hex 全部内嵌纯 Java——minSdk=24 无 java.util.Base64，JVM 测试
//    无 android.util.Base64）。网络路径（checkUpdateAsync 的 HttpURLConnection）
//    不进 JUnit，由 Phase 2c E2E 验证。
//
//  【Ed25519 实现说明】与 LicenseManager 内部私有类 Ed25519 同构（RFC 8032 纯
//    Java 数学，BigInteger + SHA-512）。不抽公共类的原因：LicenseManager 是 license
//    链敏感文件（P0 保护范围），为其抽取重构的回归成本远高于独立同构副本；
//    Ed25519 数学是 RFC 标准固定内容，不存在"两处逻辑漂移"风险，仅需密钥轮换时
//    同步公钥常量。热更场景不做 Java/native 双路互检（那是 license 防本地 hook 的
//    特殊要求；热更威胁模型是 MITM/恶意 CDN，HTTPS + Ed25519 验签已覆盖）。
// ============================================================================

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.math.BigInteger;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.regex.Pattern;

public class HotUpdateManager {

    private static final String TAG = "HotUpdateManager";

    // ==== 协议常量 ====
    /** 热更新分发地址（Phase 2b 产物 public/hot-update/app-local/，随 Git 部署） */
    public static final String HOT_UPDATE_BASE_URL =
            "https://tcm-prescription-system.pages.dev/hot-update/app-local";
    /** 签名消息前缀（≠桌面 'desktop-hotupdate-v1'，协议隔离） */
    static final String SIGN_PREFIX = "app-hotupdate-v1";
    /** 渠道名（协议绑定：manifest.channel 必须等于它才认） */
    static final String CHANNEL = "app-local";
    /** Ed25519 验签公钥（license v7 同信任根，同一把私钥签发）。
     *  ⚠️ 轮换时三处同步：本常量 + LicenseManager.ED25519_VERIFY_PUBLIC_KEY_HEX
     *  + tools/gen-hotupdate-test-fixture.cjs，并重跑 fixture。 */
    public static final String HOT_ED25519_PUBLIC_KEY_HEX =
            "22c2cdffeeeb8831c6423f0600905e53d92e4865e054489462abd396b6cfdabc";

    private static final Pattern SAFE_NAME_RE = Pattern.compile("^[A-Za-z0-9_./-]+$");
    private static final Pattern HOT_VERSION_RE = Pattern.compile("^\\d{4}\\.\\d{2}\\.\\d{2}-\\d+$");
    private static final int MAX_FILES = 50;
    private static final long MAX_FILE_BYTES = 20L * 1048576;
    private static final int HTTP_TIMEOUT_MS = 20000;

    // ==== verifyManifest 结果常量 ====
    public static final int VERIFY_OK      = 0;  // 验签通过且比本地新 → 可下载
    public static final int VERIFY_BAD     = 1;  // 验签/格式失败（fail-closed）
    public static final int VERIFY_STALE   = 2;  // 不比本地新 → 跳过
    public static final int VERIFY_NEED_APK = 3; // localAppCode < minAppCode → 转整包更新通道

    // ==== 可注入日志（JUnit 零 android 依赖；默认 null 不打） ====
    public interface Logger { void log(String msg); void warn(String msg); }
    private static volatile Logger sLogger = null;
    public static void setLogger(Logger l) { sLogger = l; }
    private static void logi(String msg) { Logger l = sLogger; if (l != null) l.log(msg); }
    private static void logw(String msg) { Logger l = sLogger; if (l != null) l.warn(msg); }

    // ==== 热包文件条目 ====
    public static final class HotFile {
        public String name;     // 相对路径（白名单字符，无 ..）
        public String sha256;   // 64 位小写 hex
        public long size;       // 字节数
    }

    // ========================================================================
    //  纯逻辑（JUnit 可测，零 Android 依赖）
    // ========================================================================

    /**
     * 规范化签名消息。★ 铁律：与 tools/gen-hotupdate-test-fixture.cjs 及
     * Phase 2b 生成工具的 buildSignMessage 逐字符一致（改一处必改另一处）。
     */
    public static String buildSignMessage(String channel, String hotVersion, long signedAt, List<HotFile> files) {
        StringBuilder sb = new StringBuilder(64 + files.size() * 96);
        sb.append(SIGN_PREFIX).append('|').append(channel).append('|')
          .append(hotVersion).append('|').append(signedAt);
        for (HotFile f : files) {
            sb.append('|').append(f.name).append(':').append(f.sha256).append(':').append(f.size);
        }
        return sb.toString();
    }

    /**
     * manifest 全量门禁：格式校验 → Ed25519 验签 → 版本比较 → minAppCode。
     * 任何异常返回 VERIFY_BAD（fail-closed，绝不抛出）。
     * @param localHotVersion 本地已生效热版本（null=首次，跳过版本比较）
     * @param localSignedAt   本地 signedAt
     * @param localAppCode    本地 APK versionCode（minAppCode 门禁用）
     */
    public static int verifyManifest(JSONObject manifest, String localHotVersion,
                                     long localSignedAt, int localAppCode) {
        try {
            if (manifest == null) return VERIFY_BAD;
            if (manifest.optInt("format", -1) != 1) return VERIFY_BAD;
            String channel = manifest.optString("channel", "");
            if (!CHANNEL.equals(channel)) return VERIFY_BAD;  // 协议绑定（防桌面热包喂 APP）
            String hotVersion = manifest.optString("hotVersion", "");
            if (!HOT_VERSION_RE.matcher(hotVersion).matches()) return VERIFY_BAD;
            long signedAt = manifest.optLong("signedAt", -1L);
            if (signedAt <= 0) return VERIFY_BAD;
            String sig = manifest.optString("signature", "");
            if (sig.isEmpty() || sig.length() > 200) return VERIFY_BAD;

            List<HotFile> files = parseFiles(manifest);
            if (files == null) return VERIFY_BAD;

            // ① Ed25519 验签
            String msg = buildSignMessage(channel, hotVersion, signedAt, files);
            byte[] pub = hexToBytes(HOT_ED25519_PUBLIC_KEY_HEX);
            byte[] sigBytes = base64Decode(sig);
            if (pub == null || sigBytes == null) return VERIFY_BAD;
            if (!Ed25519.verify(pub, msg.getBytes(StandardCharsets.UTF_8), sigBytes)) return VERIFY_BAD;

            // ② 版本比较（与桌面一致：同版本或 signedAt 不更新 → 已最新）
            if (localHotVersion != null && !localHotVersion.isEmpty()
                    && (hotVersion.equals(localHotVersion) || signedAt <= localSignedAt)) {
                return VERIFY_STALE;
            }

            // ③ minAppCode 硬门禁（热包要求的最低 APK versionCode）
            int minAppCode = manifest.optInt("minAppCode", 1);
            if (localAppCode > 0 && localAppCode < minAppCode) return VERIFY_NEED_APK;

            return VERIFY_OK;
        } catch (Exception e) {
            return VERIFY_BAD;
        }
    }

    /** 解析 manifest.files（含白名单校验；任何一项非法返回 null） */
    static List<HotFile> parseFiles(JSONObject manifest) {
        try {
            JSONArray arr = manifest.optJSONArray("files");
            if (arr == null || arr.length() == 0 || arr.length() > MAX_FILES) return null;
            List<HotFile> files = new ArrayList<>(arr.length());
            for (int i = 0; i < arr.length(); i++) {
                JSONObject o = arr.optJSONObject(i);
                if (o == null) return null;
                String name = o.optString("name", "");
                String sha = o.optString("sha256", "");
                if (!SAFE_NAME_RE.matcher(name).matches() || name.contains("..") || name.startsWith("/")) return null;
                if (!sha.matches("^[0-9a-f]{64}$")) return null;
                long size = o.optLong("size", -1L);
                if (size <= 0 || size > MAX_FILE_BYTES) return null;
                HotFile f = new HotFile();
                f.name = name;
                f.sha256 = sha;
                f.size = size;
                files.add(f);
            }
            return files;
        } catch (Exception e) {
            return null;
        }
    }

    /** 文件 SHA-256（小写 hex）。文件 ≤20MB（manifest 门禁），全量读安全。 */
    public static String sha256Hex(File f) throws IOException {
        InputStream in = null;
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            in = new FileInputStream(f);
            byte[] buf = new byte[16384];
            int n;
            while ((n = in.read(buf)) > 0) md.update(buf, 0, n);
            return toHexLower(md.digest());
        } catch (java.security.NoSuchAlgorithmException impossible) {
            throw new IOException("SHA-256 unavailable");
        } finally {
            if (in != null) try { in.close(); } catch (IOException ignored) {}
        }
    }

    static String sha256Hex(byte[] data) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            return toHexLower(md.digest(data));
        } catch (java.security.NoSuchAlgorithmException impossible) {
            return null;
        }
    }

    /**
     * ★ 启动复验（主入口加载前调用）：manifest 验签 + 全量文件哈希复验。
     * 通过 → 返回 current/index.html 绝对路径；任何失败 → 隔离坏目录并返回
     * null（调用方回退 assets 打包版）。
     * 只做验签+完整性，不做版本/minAppCode 比较（下载时已门禁；APK versionCode
     * 只升不降 → 已下载热包对当前 APK 永远适用）。
     * @param hotUpdateDir filesDir/hot-update
     */
    public static String resolveEntry(File hotUpdateDir) {
        File currentDir = new File(hotUpdateDir, "current");
        try {
            File manifestFile = new File(currentDir, "manifest.json");
            if (!manifestFile.isFile()) return null;
            JSONObject manifest = new JSONObject(readTextFile(manifestFile));
            if (verifyManifest(manifest, null, 0L, 0) != VERIFY_OK) {
                quarantine(currentDir, "bad-signature");
                return null;
            }
            List<HotFile> files = parseFiles(manifest);
            if (files == null) { quarantine(currentDir, "bad-files"); return null; }
            for (HotFile f : files) {
                File fp = new File(currentDir, f.name);
                if (!fp.isFile() || fp.length() != f.size || !sha256Hex(fp).equals(f.sha256)) {
                    quarantine(currentDir, "hash-mismatch:" + f.name);
                    return null;
                }
            }
            File entry = new File(currentDir, "index.html");
            if (!entry.isFile()) { quarantine(currentDir, "no-entry"); return null; }
            return entry.getAbsolutePath();
        } catch (Exception e) {
            logw("resolveEntry 异常，回退 assets 打包版: " + e);
            quarantine(currentDir, "exception");
            return null;
        }
    }

    /** 隔离坏 current 目录（rename 失败则删除；隔离优于删除——留现场排查） */
    private static void quarantine(File currentDir, String reason) {
        try {
            logw("热目录复验失败(" + reason + ")，隔离并回退 assets 打包版");
            if (currentDir.isDirectory()) {
                File q = new File(currentDir.getParentFile(), "quarantine-" + System.currentTimeMillis());
                if (!currentDir.renameTo(q)) deleteTree(currentDir);
            }
        } catch (Throwable ignored) {}
    }

    // ========================================================================
    //  实例逻辑（Context 数据目录注入；网络路径不进 JUnit，Phase 2c E2E 覆盖）
    // ========================================================================

    private final File baseDir;      // <filesDir>/hot-update
    private final String baseUrl;
    private final int localAppCode;
    private volatile boolean busy = false;

    /** 热更新结果回调（均在后台线程触发；UI 操作调用方自行 post 到主线程） */
    public interface OnResult {
        /** 新热版本已就绪（下次启动生效） */
        void onApplied(String hotVersion);
        /** 热包要求更高 APK（minAppCode 门禁），转整包更新通道（由 startApkUpdateCheck 负责） */
        void onNeedApk();
    }

    public HotUpdateManager(File filesDir, String baseUrl, int localAppCode) {
        this.baseDir = new File(filesDir, "hot-update");
        this.baseUrl = baseUrl == null ? HOT_UPDATE_BASE_URL : baseUrl.replaceAll("/+$", "");
        this.localAppCode = localAppCode;
    }

    /**
     * 静默检查+增量下载+原子 swap（后台线程；防重入：一次生命周期只跑一轮）。
     * 全程 best-effort：任何失败静默放弃（保持 current 不变，下次启动回退旧版/assets 版）。
     */
    public void checkUpdateAsync(final OnResult cb) {
        if (busy) return;
        busy = true;
        Thread t = new Thread(() -> {
            File pendingDir = null;
            try {
                // 延迟 2s：等登录页首帧稳定，不与首屏渲染竞争（对齐 startApkUpdateCheck 模式）
                Thread.sleep(2000L);
                JSONObject manifest = new JSONObject(
                        new String(httpGet(baseUrl + "/version.json"), StandardCharsets.UTF_8));

                // 本地已生效版本
                String localVer = null;
                long localSignedAt = 0;
                File verFile = new File(baseDir, ".hot-version");
                if (verFile.isFile()) {
                    try {
                        JSONObject v = new JSONObject(readTextFile(verFile));
                        localVer = v.optString("hotVersion", null);
                        localSignedAt = v.optLong("signedAt", 0L);
                    } catch (Exception ignored) {}
                }

                int r = verifyManifest(manifest, localVer, localSignedAt, localAppCode);
                if (r == VERIFY_STALE) { logi("热版本已是最新 " + localVer); return; }
                if (r == VERIFY_NEED_APK) {
                    logi("热包要求 APK build ≥ " + manifest.optInt("minAppCode", 0)
                            + "（当前 " + localAppCode + "），转整包更新通道");
                    if (cb != null) cb.onNeedApk();
                    return;
                }
                if (r != VERIFY_OK) { logw("version.json 验签失败（fail-closed 跳过）"); return; }

                String hotVersion = manifest.optString("hotVersion");
                logi("发现新热版本 " + hotVersion + "（本地 " + (localVer == null ? "无" : localVer) + "），开始静默下载");

                // 逐文件下载/增量复制到 pending
                List<HotFile> files = parseFiles(manifest);
                if (files == null) { logw("文件清单解析失败"); return; }
                pendingDir = new File(baseDir, "pending-" + hotVersion);
                deleteTree(pendingDir);
                if (!pendingDir.mkdirs()) throw new IOException("mkdir 失败 " + pendingDir);
                File currentDir = new File(baseDir, "current");
                for (HotFile f : files) {
                    File dst = new File(pendingDir, f.name);
                    File parent = dst.getParentFile();
                    if (parent != null && !parent.isDirectory() && !parent.mkdirs()) {
                        throw new IOException("mkdir 失败 " + parent);
                    }
                    // 增量：current 同哈希文件直接复制（免下载）
                    File cur = new File(currentDir, f.name);
                    if (cur.isFile() && cur.length() == f.size && sha256Hex(cur).equals(f.sha256)) {
                        copyFile(cur, dst);
                        continue;
                    }
                    byte[] buf = downloadWithRetry(f);
                    if (buf.length != f.size || !f.sha256.equals(sha256Hex(buf))) {
                        throw new IOException("哈希校验失败 " + f.name);
                    }
                    writeBytes(dst, buf);
                }

                // pending 全量复验（防下载过程中磁盘异常）+ manifest 副本
                for (HotFile f : files) {
                    File fp = new File(pendingDir, f.name);
                    if (!fp.isFile() || fp.length() != f.size || !sha256Hex(fp).equals(f.sha256)) {
                        throw new IOException("pending 复验失败 " + f.name);
                    }
                }
                writeBytes(new File(pendingDir, "manifest.json"),
                        manifest.toString().getBytes(StandardCharsets.UTF_8));

                // 原子 swap：current → old-<ts>；pending → current；成功后删 old
                File oldDir = new File(baseDir, "old-" + System.currentTimeMillis());
                if (currentDir.isDirectory() && !currentDir.renameTo(oldDir)) {
                    throw new IOException("swap 失败：current → old");
                }
                if (!pendingDir.renameTo(currentDir)) {
                    // 回滚：把 old 还原为 current（尽力而为，失败则下次启动走 assets）
                    if (oldDir.isDirectory()) { oldDir.renameTo(currentDir); }
                    throw new IOException("swap 失败：pending → current");
                }
                pendingDir = null;
                deleteTree(oldDir);

                // 记录生效版本
                JSONObject v = new JSONObject();
                v.put("hotVersion", hotVersion);
                v.put("signedAt", manifest.optLong("signedAt", 0L));
                writeBytes(new File(baseDir, ".hot-version"),
                        v.toString().getBytes(StandardCharsets.UTF_8));

                logi("新热版本 " + hotVersion + " 已就绪，下次启动生效");
                if (cb != null) cb.onApplied(hotVersion);
            } catch (Throwable err) {
                logw("静默更新失败（保持 current 不变）: " + err);
                if (pendingDir != null) deleteTree(pendingDir);
            } finally {
                busy = false;
            }
        }, "hot-update-check");
        t.setDaemon(true);
        t.start();
    }

    // ------------------------------------------------------------------
    //  网络与磁盘小工具（实例侧；不进 JUnit）
    // ------------------------------------------------------------------

    private byte[] downloadWithRetry(HotFile f) throws IOException {
        IOException last = null;
        for (int attempt = 1; attempt <= 3; attempt++) {
            try {
                // 文件名白名单 [A-Za-z0-9_./-] 全部 URL 安全，无需编码
                byte[] buf = httpGet(baseUrl + "/" + f.name);
                if (buf.length == f.size && f.sha256.equals(sha256Hex(buf))) return buf;
                last = new IOException("大小/哈希不符 " + f.name + " (" + buf.length + "/" + f.size + ")");
            } catch (IOException e) {
                last = e;
            }
            if (attempt < 3) {
                try { Thread.sleep(800L * attempt); } catch (InterruptedException ie) {
                    Thread.currentThread().interrupt();
                    throw new IOException("interrupted");
                }
            }
        }
        throw new IOException("下载失败 " + f.name + ": " + last);
    }

    private byte[] httpGet(String url) throws IOException {
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(url).openConnection();
            conn.setConnectTimeout(HTTP_TIMEOUT_MS);
            conn.setReadTimeout(HTTP_TIMEOUT_MS);
            conn.setRequestProperty("Cache-Control", "no-cache");
            int code = conn.getResponseCode();
            if (code != 200) throw new IOException("HTTP " + code + " " + url);
            InputStream in = conn.getInputStream();
            ByteArrayOutputStream bos = new ByteArrayOutputStream(16384);
            byte[] buf = new byte[16384];
            int n;
            while ((n = in.read(buf)) > 0) bos.write(buf, 0, n);
            in.close();
            return bos.toByteArray();
        } finally {
            if (conn != null) try { conn.disconnect(); } catch (Throwable ignored) {}
        }
    }

    static void deleteTree(File dir) {
        try {
            if (dir == null || !dir.exists()) return;
            File[] children = dir.listFiles();
            if (children != null) {
                for (File c : children) {
                    if (c.isDirectory()) deleteTree(c);
                    else c.delete();
                }
            }
            dir.delete();
        } catch (Throwable ignored) {}
    }

    static void copyFile(File src, File dst) throws IOException {
        InputStream in = null;
        OutputStream out = null;
        try {
            in = new FileInputStream(src);
            out = new FileOutputStream(dst);
            byte[] buf = new byte[16384];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        } finally {
            if (in != null) try { in.close(); } catch (IOException ignored) {}
            if (out != null) try { out.close(); } catch (IOException ignored) {}
        }
    }

    static void writeBytes(File f, byte[] data) throws IOException {
        File parent = f.getParentFile();
        if (parent != null && !parent.isDirectory()) parent.mkdirs();
        try (OutputStream out = new FileOutputStream(f)) {
            out.write(data);
        }
    }

    static String readTextFile(File f) throws IOException {
        InputStream in = null;
        try {
            in = new FileInputStream(f);
            ByteArrayOutputStream bos = new ByteArrayOutputStream(16384);
            byte[] buf = new byte[16384];
            int n;
            while ((n = in.read(buf)) > 0) bos.write(buf, 0, n);
            return new String(bos.toByteArray(), StandardCharsets.UTF_8);
        } finally {
            if (in != null) try { in.close(); } catch (IOException ignored) {}
        }
    }

    // ------------------------------------------------------------------
    //  hex / Base64（minSdk=24 无 java.util.Base64；JVM 测试无 android.util.* → 内嵌）
    // ------------------------------------------------------------------

    static byte[] hexToBytes(String hex) {
        if (hex == null || hex.length() % 2 != 0) return null;
        try {
            int len = hex.length() / 2;
            byte[] out = new byte[len];
            for (int i = 0; i < len; i++) {
                int hi = Character.digit(hex.charAt(i * 2), 16);
                int lo = Character.digit(hex.charAt(i * 2 + 1), 16);
                if (hi < 0 || lo < 0) return null;
                out[i] = (byte) ((hi << 4) | lo);
            }
            return out;
        } catch (Exception e) {
            return null;
        }
    }

    static String toHexLower(byte[] bytes) {
        char[] hex = "0123456789abcdef".toCharArray();
        StringBuilder sb = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) {
            sb.append(hex[(b >> 4) & 0xF]).append(hex[b & 0xF]);
        }
        return sb.toString();
    }

    /** RFC 4648 标准 Base64 解码（含 padding 校验；非法输入返回 null 绝不抛） */
    static byte[] base64Decode(String s) {
        if (s == null || s.isEmpty()) return null;
        int[] rev = BASE64_REV;
        ByteArrayOutputStream bos = new ByteArrayOutputStream(s.length());
        int acc = 0, bits = 0, pad = 0;
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c == '=') { pad++; continue; }
            if (pad > 0) return null;  // '=' 后不允许再出现数据字符
            if (c >= 128 || rev[c] < 0) return null;
            acc = (acc << 6) | rev[c];
            bits += 6;
            if (bits >= 8) {
                bits -= 8;
                bos.write((acc >> bits) & 0xFF);
            }
        }
        if (pad > 2) return null;
        int rem = s.length() - pad;
        if (pad == 1 && rem % 4 != 3) return null;
        if (pad == 2 && rem % 4 != 2) return null;
        if (pad == 0 && rem % 4 == 1) return null;
        return bos.toByteArray();
    }

    private static final int[] BASE64_REV = buildBase64Rev();
    private static int[] buildBase64Rev() {
        int[] rev = new int[128];
        java.util.Arrays.fill(rev, -1);
        String std = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        for (int i = 0; i < std.length(); i++) rev[std.charAt(i)] = i;
        return rev;
    }

    // ========================================================================
    //  Ed25519 纯 Java 验签（RFC 8032；与 LicenseManager.Ed25519 同构——见类头注释）
    // ========================================================================
    static final class Ed25519 {
        private static final BigInteger P = new BigInteger(
                "57896044618658097711785492504343953926634992332820282019728792003956564819949"); // 2^255-19
        private static final BigInteger L = new BigInteger(
                "7237005577332262213973186563042994240857116359379907606001950938285454250989");
        private static final BigInteger D = new BigInteger(
                "37095705934669439343138083508754565189542113879843219016388785533085940283555");
        private static final BigInteger SQRT_M1 = new BigInteger(
                "19681161376707505956807079304988542015446066515923890162744021073123829784752");
        private static final BigInteger[] BASE = {
                new BigInteger("15112221349535400772501151409588531511454012693041857206046113283949847762202"),
                new BigInteger("46316835694926478169428394003475163141307993866256225615783033603165251855960")
        };

        private static BigInteger[] add(BigInteger[] p, BigInteger[] q) {
            if (p == null) return q;
            if (q == null) return p;
            BigInteger x1 = p[0], y1 = p[1], x2 = q[0], y2 = q[1];
            BigInteger t = x1.multiply(x2).multiply(y1).multiply(y2).mod(P);
            BigInteger denom1 = BigInteger.ONE.add(D.multiply(t)).mod(P);
            BigInteger denom2 = BigInteger.ONE.subtract(D.multiply(t)).mod(P);
            BigInteger x3 = x1.multiply(y2).add(x2.multiply(y1))
                    .multiply(denom1.modInverse(P)).mod(P);
            BigInteger y3 = y1.multiply(y2).add(x1.multiply(x2))
                    .multiply(denom2.modInverse(P)).mod(P);
            return new BigInteger[]{ x3, y3 };
        }

        private static BigInteger[] scalarMul(BigInteger k, BigInteger[] point) {
            BigInteger[] result = null;
            BigInteger[] addend = point;
            while (k.signum() > 0) {
                if (k.testBit(0)) result = add(result, addend);
                addend = add(addend, addend);
                k = k.shiftRight(1);
            }
            return result == null ? new BigInteger[]{ BigInteger.ZERO, BigInteger.ONE } : result;
        }

        private static BigInteger littleEndian(byte[] b) {
            byte[] reversed = new byte[b.length + 1];
            for (int i = 0; i < b.length; i++) reversed[i + 1] = b[b.length - 1 - i];
            return new BigInteger(reversed);
        }

        private static byte[] toLittleEndian(BigInteger v, int length) {
            byte[] bigEndian = v.toByteArray();
            byte[] out = new byte[length];
            for (int i = 0; i < length && i < bigEndian.length; i++) {
                out[i] = bigEndian[bigEndian.length - 1 - i];
            }
            return out;
        }

        private static BigInteger modSqrt(BigInteger a) {
            BigInteger c = a.modPow(P.add(BigInteger.valueOf(3)).shiftRight(3), P);
            if (c.multiply(c).mod(P).equals(a)) return c;
            BigInteger c2 = c.multiply(SQRT_M1).mod(P);
            if (c2.multiply(c2).mod(P).equals(a)) return c2;
            return null;
        }

        private static BigInteger[] decompress(byte[] encoded) {
            byte[] yBytes = encoded.clone();
            yBytes[31] &= 0x7f;
            BigInteger y = littleEndian(yBytes);
            if (y.compareTo(P) >= 0) return null;
            BigInteger y2 = y.multiply(y).mod(P);
            BigInteger u = y2.subtract(BigInteger.ONE).mod(P);
            BigInteger v = D.multiply(y2).add(BigInteger.ONE).mod(P);
            BigInteger x = modSqrt(u.multiply(v.modInverse(P)).mod(P));
            if (x == null) return null;
            boolean sign = (encoded[31] & 0x80) != 0;
            if ((x.testBit(0) ? 1 : 0) != (sign ? 1 : 0)) {
                x = P.subtract(x);
            }
            return new BigInteger[]{ x, y };
        }

        private static byte[] encode(BigInteger[] p) {
            byte[] out = toLittleEndian(p[1], 32);
            if (p[0].testBit(0)) out[31] |= 0x80;
            return out;
        }

        /** Ed25519 验签（RFC 8032 §5.1.7）；任何异常返回 false（绝不抛出） */
        static boolean verify(byte[] publicKey, byte[] message, byte[] signature) {
            if (publicKey == null || publicKey.length != 32) return false;
            if (signature == null || signature.length != 64) return false;
            try {
                BigInteger[] A = decompress(publicKey);
                if (A == null) return false;
                byte[] sBytes = new byte[32];
                System.arraycopy(signature, 32, sBytes, 0, 32);
                BigInteger S = littleEndian(sBytes);
                if (S.compareTo(L) >= 0) return false;
                byte[] rBytes = new byte[32];
                System.arraycopy(signature, 0, rBytes, 0, 32);
                BigInteger[] R = decompress(rBytes);
                if (R == null) return false;
                ByteArrayOutputStream baos = new ByteArrayOutputStream(64 + 32 + message.length);
                baos.write(signature, 0, 32);
                baos.write(publicKey, 0, 32);
                baos.write(message);
                byte[] h = MessageDigest.getInstance("SHA-512").digest(baos.toByteArray());
                BigInteger hScalar = littleEndian(h).mod(L);
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
}
