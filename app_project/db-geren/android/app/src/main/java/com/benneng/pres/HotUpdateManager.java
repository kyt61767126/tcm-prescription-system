package com.benneng.pres;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import android.util.Log;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/**
 * HotUpdateManager - 离线APP热更新管理器
 *
 * 功能：
 *   1. 启动时检查云端版本号（异步，不阻塞UI）
 *   2. 有新版本时下载 package.zip 并解压到本地
 *   3. WebView 优先加载热更新目录的 index.html，fallback 到打包文件
 *
 * 热更新流程：
 *   开发者：generate-hot-update.ps1 → 生成 version.json + package.zip → push GitHub → Cloudflare 部署
 *   用户端：APP启动 → 检查 version.json → 下载 package.zip → 解压 → 下次启动使用新文件
 *
 * 安全性：
 *   - HTTPS 传输
 *   - MD5 校验（可选，后续可添加）
 *   - 失败不影响正常使用（fallback 到打包文件）
 */
public class HotUpdateManager {
    private static final String TAG = "HotUpdate";
    private static final String CLOUD_HOST = "tcm-prescription-system.pages.dev";
    private static final String PREF_NAME = "hot_update_prefs";
    private static final String PREF_VERSION = "local_version";
    private static final String PREF_VERSION_NAME = "version_name"; // geren/dingzhi

    private final Context context;
    private final String versionName; // geren | dingzhi

    public HotUpdateManager(Context context, String versionName) {
        this.context = context;
        this.versionName = versionName;
    }

    /**
     * 获取热更新目录
     */
    public File getHotUpdateDir() {
        return new File(context.getFilesDir(), "hot-update");
    }

    /**
     * 获取热更新 index.html 的 file:// URL
     * @return 如果热更新目录有 index.html 返回 URL，否则返回 null
     */
    public String getHotUpdateIndexUrl() {
        File indexFile = new File(getHotUpdateDir(), "index.html");
        if (indexFile.exists() && indexFile.isFile()) {
            return "file://" + indexFile.getAbsolutePath();
        }
        return null;
    }

    /**
     * 获取当前本地热更新版本号
     */
    public String getLocalVersion() {
        SharedPreferences prefs = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE);
        return prefs.getString(PREF_VERSION, "");
    }

    /**
     * 异步检查并下载更新（不阻塞UI）
     * 在 MainActivity.onCreate 中调用
     */
    public void checkAndDownloadUpdate() {
        new Thread(() -> {
            try {
                Log.d(TAG, "开始检查热更新...");

                // 1. 获取云端版本号
                String latestVersion = fetchLatestVersion();
                if (latestVersion == null || latestVersion.isEmpty()) {
                    Log.d(TAG, "无法获取云端版本号，跳过热更新");
                    return;
                }

                // 2. 获取本地版本号
                String localVersion = getLocalVersion();

                // 3. 比较版本号
                if (latestVersion.equals(localVersion)) {
                    Log.d(TAG, "已是最新版本: " + localVersion);
                    return;
                }

                // 4. 下载更新包
                Log.d(TAG, "发现新版本: " + latestVersion + " (当前: " + localVersion + ")");
                String downloadUrl = "https://" + CLOUD_HOST + "/hot-update/" + versionName + "/package.zip";
                File zipFile = downloadFile(downloadUrl);
                if (zipFile == null) {
                    Log.e(TAG, "下载更新包失败");
                    return;
                }

                // 5. 解压到临时目录，校验后替换
                File tempDir = new File(context.getCacheDir(), "hot-update-temp");
                if (tempDir.exists()) {
                    deleteRecursive(tempDir);
                }
                tempDir.mkdirs();

                boolean extracted = extractZip(zipFile, tempDir);
                zipFile.delete();

                if (!extracted) {
                    Log.e(TAG, "解压更新包失败");
                    deleteRecursive(tempDir);
                    return;
                }

                // 6. 替换热更新目录
                File hotUpdateDir = getHotUpdateDir();
                if (hotUpdateDir.exists()) {
                    deleteRecursive(hotUpdateDir);
                }

                // 重命名临时目录为热更新目录
                if (!tempDir.renameTo(hotUpdateDir)) {
                    // renameTo 可能因跨文件系统失败，用 copy fallback
                    copyDirectory(tempDir, hotUpdateDir);
                    deleteRecursive(tempDir);
                }

                // 7. 保存版本号
                SharedPreferences prefs = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE);
                prefs.edit().putString(PREF_VERSION, latestVersion).putString(PREF_VERSION_NAME, versionName).apply();

                Log.d(TAG, "热更新完成: " + latestVersion + "，下次启动生效");

            } catch (Exception e) {
                Log.e(TAG, "热更新检查失败", e);
            }
        }, "hot-update-check").start();
    }

    /**
     * 获取云端最新版本号
     */
    private String fetchLatestVersion() {
        HttpURLConnection conn = null;
        try {
            String urlStr = "https://" + CLOUD_HOST + "/hot-update/" + versionName + "/latest.json";
            URL url = new URL(urlStr);
            conn = (HttpURLConnection) url.openConnection();
            conn.setConnectTimeout(5000);
            conn.setReadTimeout(5000);
            conn.setRequestMethod("GET");

            int code = conn.getResponseCode();
            if (code != 200) {
                Log.w(TAG, "获取版本号 HTTP " + code);
                return null;
            }

            InputStream is = conn.getInputStream();
            byte[] buffer = new byte[4096];
            StringBuilder sb = new StringBuilder();
            int len;
            while ((len = is.read(buffer)) != -1) {
                sb.append(new String(buffer, 0, len, "UTF-8"));
            }
            is.close();

            String json = sb.toString();
            // 简单解析 {"version":"xxx","url":"xxx"}
            String version = extractJsonField(json, "version");
            Log.d(TAG, "云端版本号: " + version);
            return version;

        } catch (Exception e) {
            Log.w(TAG, "获取云端版本号失败: " + e.getMessage());
            return null;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    /**
     * 下载文件
     */
    private File downloadFile(String urlStr) {
        HttpURLConnection conn = null;
        try {
            URL url = new URL(urlStr);
            conn = (HttpURLConnection) url.openConnection();
            conn.setConnectTimeout(10000);
            conn.setReadTimeout(30000);
            conn.setRequestMethod("GET");

            int code = conn.getResponseCode();
            if (code != 200) {
                Log.e(TAG, "下载失败 HTTP " + code);
                return null;
            }

            File tempFile = new File(context.getCacheDir(), "hot-update-package.zip");
            if (tempFile.exists()) tempFile.delete();

            InputStream is = conn.getInputStream();
            FileOutputStream fos = new FileOutputStream(tempFile);
            byte[] buffer = new byte[8192];
            int len;
            while ((len = is.read(buffer)) != -1) {
                fos.write(buffer, 0, len);
            }
            fos.close();
            is.close();

            Log.d(TAG, "下载完成: " + tempFile.length() + " bytes");
            return tempFile;

        } catch (Exception e) {
            Log.e(TAG, "下载文件失败", e);
            return null;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    /**
     * 解压 ZIP 文件
     */
    private boolean extractZip(File zipFile, File targetDir) {
        try {
            FileInputStream fis = new FileInputStream(zipFile);
            ZipInputStream zis = new ZipInputStream(fis);
            ZipEntry entry;
            byte[] buffer = new byte[8192];
            while ((entry = zis.getNextEntry()) != null) {
                File outFile = new File(targetDir, entry.getName());
                // 安全检查：防止 ZIP 路径穿越攻击
                String canonicalTarget = targetDir.getCanonicalPath();
                String canonicalOutput = outFile.getCanonicalPath();
                if (!canonicalOutput.startsWith(canonicalTarget)) {
                    Log.e(TAG, "安全警告：ZIP 条目路径越界: " + entry.getName());
                    continue;
                }
                if (entry.isDirectory()) {
                    outFile.mkdirs();
                } else {
                    outFile.getParentFile().mkdirs();
                    FileOutputStream fos = new FileOutputStream(outFile);
                    int len;
                    while ((len = zis.read(buffer)) != -1) {
                        fos.write(buffer, 0, len);
                    }
                    fos.close();
                }
                zis.closeEntry();
            }
            zis.close();
            fis.close();
            return true;
        } catch (Exception e) {
            Log.e(TAG, "解压失败", e);
            return false;
        }
    }

    /**
     * 简单 JSON 字段提取（避免引入完整 JSON 库）
     */
    private String extractJsonField(String json, String field) {
        String pattern = "\"" + field + "\"";
        int idx = json.indexOf(pattern);
        if (idx < 0) return null;
        int colonIdx = json.indexOf(':', idx + pattern.length());
        if (colonIdx < 0) return null;
        int quoteStart = json.indexOf('"', colonIdx + 1);
        if (quoteStart < 0) return null;
        int quoteEnd = json.indexOf('"', quoteStart + 1);
        if (quoteEnd < 0) return null;
        return json.substring(quoteStart + 1, quoteEnd);
    }

    /**
     * 递归删除文件/目录
     */
    private void deleteRecursive(File file) {
        if (file.isDirectory()) {
            File[] children = file.listFiles();
            if (children != null) {
                for (File child : children) {
                    deleteRecursive(child);
                }
            }
        }
        file.delete();
    }

    /**
     * 复制目录（renameTo 跨文件系统失败时的 fallback）
     */
    private void copyDirectory(File src, File dst) {
        if (src.isDirectory()) {
            dst.mkdirs();
            File[] children = src.listFiles();
            if (children != null) {
                for (File child : children) {
                    copyDirectory(child, new File(dst, child.getName()));
                }
            }
        } else {
            try {
                FileInputStream fis = new FileInputStream(src);
                FileOutputStream fos = new FileOutputStream(dst);
                byte[] buffer = new byte[8192];
                int len;
                while ((len = fis.read(buffer)) != -1) {
                    fos.write(buffer, 0, len);
                }
                fos.close();
                fis.close();
            } catch (Exception e) {
                Log.e(TAG, "复制文件失败: " + src, e);
            }
        }
    }
}
