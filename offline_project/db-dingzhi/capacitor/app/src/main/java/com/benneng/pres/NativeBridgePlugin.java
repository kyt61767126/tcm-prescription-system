package com.benneng.pres;

import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.widget.Toast;
import androidx.core.content.FileProvider;
import com.getcapacitor.Plugin;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashSet;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONObject;

@CapacitorPlugin(name = "NativeBridge")
public class NativeBridgePlugin extends Plugin {

    private Set<String> mediaWhitelistedRoots = new HashSet<>();

    // === 媒体白名单 ===
    private void initMediaWhitelist() {
        try {
            Context ctx = getContext();
            File extImg = ctx.getExternalFilesDir(Environment.DIRECTORY_PICTURES);
            if (extImg != null) {
                mediaWhitelistedRoots.add(new File(extImg, "惠康中医处方").getCanonicalPath() + File.separator);
                mediaWhitelistedRoots.add(new File(extImg, "本能中医处方").getCanonicalPath() + File.separator);
            }
            File extVid = ctx.getExternalFilesDir(Environment.DIRECTORY_MOVIES);
            if (extVid != null) {
                mediaWhitelistedRoots.add(new File(extVid, "惠康中医处方").getCanonicalPath() + File.separator);
                mediaWhitelistedRoots.add(new File(extVid, "本能中医处方").getCanonicalPath() + File.separator);
            }
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
                File pubImg = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES);
                if (pubImg != null) {
                    mediaWhitelistedRoots.add(new File(pubImg, "惠康中医处方").getCanonicalPath() + File.separator);
                    mediaWhitelistedRoots.add(new File(pubImg, "本能中医处方").getCanonicalPath() + File.separator);
                }
                File pubVid = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_MOVIES);
                if (pubVid != null) {
                    mediaWhitelistedRoots.add(new File(pubVid, "惠康中医处方").getCanonicalPath() + File.separator);
                    mediaWhitelistedRoots.add(new File(pubVid, "本能中医处方").getCanonicalPath() + File.separator);
                }
            }
            mediaWhitelistedRoots.add(new File(ctx.getFilesDir(), "prescription_images").getCanonicalPath() + File.separator);
            mediaWhitelistedRoots.add(new File(ctx.getFilesDir(), "prescription_videos").getCanonicalPath() + File.separator);
        } catch (Exception e) {
            // ignore
        }
    }

    private boolean isMediaPathAllowed(String filePath) {
        try {
            if (filePath == null || filePath.isEmpty()) return false;
            File f = new File(filePath);
            String canonical = f.getCanonicalPath();
            for (String root : mediaWhitelistedRoots) {
                if (canonical.startsWith(root)) return true;
            }
            return false;
        } catch (Exception e) {
            return false;
        }
    }

    // ========================================================================
    // ★ LicenseManager（从原离线APP完整移植，保持授权规则完全一致）
    // ========================================================================
    private LicenseManager licenseManager;

    @Override
    public void load() {
        super.load();
        initMediaWhitelist();
        getBridge().getWebView().addJavascriptInterface(this, "nativeBridge");
        // 初始化 LicenseManager
        licenseManager = new LicenseManager(getContext());
    }

    @JavascriptInterface
    public String getLicenseStatus() {
        try {
            return licenseManager.validateLicense().toString();
        } catch (Exception e) {
            return "{\"valid\":false,\"error\":\"" + e.getMessage() + "\"}";
        }
    }

    @JavascriptInterface
    public String validateLicense() {
        try {
            return licenseManager.validateLicense().toString();
        } catch (Exception e) {
            return "{\"valid\":false,\"message\":\"" + e.getMessage() + "\"}";
        }
    }

    @JavascriptInterface
    public String activateLicense(String code, String user) {
        try {
            String machineId = licenseManager.getMachineId();
            return licenseManager.activateOnline(code, machineId, user != null ? user : "").toString();
        } catch (Exception e) {
            return "{\"success\":false,\"message\":\"" + e.getMessage() + "\"}";
        }
    }

    @JavascriptInterface
    public String verifyOnline() {
        try {
            String machineId = licenseManager.getMachineId();
            return licenseManager.verifyOnline(machineId).toString();
        } catch (Exception e) {
            return "{\"success\":false,\"error\":\"" + e.getMessage() + "\"}";
        }
    }

    @JavascriptInterface
    public String getActivationRecord() {
        try {
            return licenseManager.getActivationRecord().toString();
        } catch (Exception e) {
            return "{\"success\":false,\"error\":\"" + e.getMessage() + "\"}";
        }
    }

    @JavascriptInterface
    public String setTrialDays(int days) {
        try {
            return licenseManager.setTrialDays(days).toString();
        } catch (Exception e) {
            return "{\"success\":false,\"error\":\"" + e.getMessage() + "\"}";
        }
    }

    @JavascriptInterface
    public int getTrialDays() {
        try {
            return licenseManager.getTrialDays();
        } catch (Exception e) {
            return 7;
        }
    }

    @JavascriptInterface
    public String getPrescriptionStatus() {
        try {
            return licenseManager.getPrescriptionStatus().toString();
        } catch (Exception e) {
            return "{\"success\":false,\"error\":\"" + e.getMessage() + "\"}";
        }
    }

    @JavascriptInterface
    public int incrementPrescription() {
        try {
            return licenseManager.incrementPrescription();
        } catch (Exception e) {
            return -1;
        }
    }

    // === @JavascriptInterface 方法 ===

    @JavascriptInterface
    public void quitApp() {
        getActivity().finish();
    }

    @JavascriptInterface
    public void showToast(final String message) {
        getActivity().runOnUiThread(() -> Toast.makeText(getContext(), message, Toast.LENGTH_SHORT).show());
    }

    @JavascriptInterface
    public String saveBackupFile(String filename, String content) {
        try {
            if (filename == null || filename.isEmpty()) {
                return "{\"success\":false,\"error\":\"文件名无效\"}";
            }
            // 安全校验：防止路径穿越
            if (filename.contains("..") || filename.contains("/") || filename.contains("\\")) {
                return "{\"success\":false,\"error\":\"文件名包含非法字符\"}";
            }
            if (!filename.endsWith(".json")) {
                filename = filename + ".json";
            }

            File downloadDir;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                // Android 10+ 使用 MediaStore
                ContentValues values = new ContentValues();
                values.put(MediaStore.Downloads.DISPLAY_NAME, filename);
                values.put(MediaStore.Downloads.MIME_TYPE, "application/json");
                values.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
                Uri uri = getContext().getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                if (uri != null) {
                    try (OutputStream os = getContext().getContentResolver().openOutputStream(uri)) {
                        os.write(content.getBytes(StandardCharsets.UTF_8));
                    }
                    return "{\"success\":true,\"path\":\"" + Environment.DIRECTORY_DOWNLOADS + "/" + filename + "\"}";
                }
            }
            // Android 9 及以下
            downloadDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
            if (downloadDir != null) {
                if (!downloadDir.exists()) downloadDir.mkdirs();
                File file = new File(downloadDir, filename);
                try (FileOutputStream fos = new FileOutputStream(file)) {
                    fos.write(content.getBytes(StandardCharsets.UTF_8));
                }
                return "{\"success\":true,\"path\":\"" + file.getAbsolutePath() + "\"}";
            }
            return "{\"success\":false,\"error\":\"无法访问下载目录\"}";
        } catch (Exception e) {
            return "{\"success\":false,\"error\":\"" + e.getMessage() + "\"}";
        }
    }

    @JavascriptInterface
    public String readFileAsBase64(String filePath) {
        try {
            if (!isMediaPathAllowed(filePath)) {
                return "{\"success\":false,\"error\":\"路径不在白名单内\"}";
            }
            File file = new File(filePath);
            if (!file.exists()) {
                return "{\"success\":false,\"error\":\"文件不存在\"}";
            }
            // ★ Binder 事务 1MB 限制保护：文件超过 700KB 时直接返回失败
            // 原因：base64 编码后大小 = 原文件 × 1.33，超过 Binder 1MB 限制会导致 TransactionTooLargeException
            // 视频文件通常较大，应使用 openFile 降级到系统播放器
            if (file.length() > 700 * 1024) {
                return "{\"success\":false,\"error\":\"文件过大，请使用系统播放器\"}";
            }
            byte[] data = new byte[(int) file.length()];
            try (java.io.FileInputStream fis = new java.io.FileInputStream(file)) {
                fis.read(data);
            }
            String base64 = Base64.encodeToString(data, Base64.NO_WRAP);
            return "{\"success\":true,\"data\":\"" + base64 + "\"}";
        } catch (Exception e) {
            return "{\"success\":false,\"error\":\"" + e.getMessage() + "\"}";
        }
    }

    @JavascriptInterface
    public void openFile(String filePath, String mimeType) {
        try {
            if (!isMediaPathAllowed(filePath)) return;
            File file = new File(filePath);
            if (!file.exists()) return;
            Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", file);
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(uri, mimeType != null ? mimeType : guessMimeType(filePath));
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
        } catch (Exception e) {
            // ignore
        }
    }

    @JavascriptInterface
    public String findMediaFiles(String folder) {
        try {
            JSONArray result = new JSONArray();
            Context ctx = getContext();
            File baseDir;
            if ("images".equals(folder)) {
                baseDir = ctx.getExternalFilesDir(Environment.DIRECTORY_PICTURES);
            } else if ("videos".equals(folder)) {
                baseDir = ctx.getExternalFilesDir(Environment.DIRECTORY_MOVIES);
            } else {
                return "[]";
            }
            if (baseDir == null) return "[]";

            File targetDir = new File(baseDir, "惠康中医处方");
            if (!targetDir.exists()) {
                targetDir = new File(baseDir, "本能中医处方");
            }
            if (!targetDir.exists()) return "[]";

            File[] files = targetDir.listFiles();
            if (files != null) {
                for (File f : files) {
                    JSONObject obj = new JSONObject();
                    obj.put("name", f.getName());
                    obj.put("path", f.getAbsolutePath());
                    obj.put("size", f.length());
                    obj.put("lastModified", f.lastModified());
                    result.put(obj);
                }
            }
            return result.toString();
        } catch (Exception e) {
            return "[]";
        }
    }

    @JavascriptInterface
    public String savePrescriptionImage(String filename, String base64Data) {
        try {
            Context ctx = getContext();
            File dir = new File(ctx.getExternalFilesDir(Environment.DIRECTORY_PICTURES), "惠康中医处方");
            if (!dir.exists()) dir.mkdirs();
            File file = new File(dir, filename);
            byte[] data = Base64.decode(base64Data, Base64.NO_WRAP);
            try (FileOutputStream fos = new FileOutputStream(file)) {
                fos.write(data);
            }
            return "{\"success\":true,\"path\":\"" + file.getAbsolutePath() + "\"}";
        } catch (Exception e) {
            return "{\"success\":false,\"error\":\"" + e.getMessage() + "\"}";
        }
    }

    @JavascriptInterface
    public String saveVideoFile(String filename, String base64Data) {
        try {
            Context ctx = getContext();
            File dir = new File(ctx.getExternalFilesDir(Environment.DIRECTORY_MOVIES), "惠康中医处方");
            if (!dir.exists()) dir.mkdirs();
            File file = new File(dir, filename);
            byte[] data = Base64.decode(base64Data, Base64.NO_WRAP);
            try (FileOutputStream fos = new FileOutputStream(file)) {
                fos.write(data);
            }
            return "{\"success\":true,\"path\":\"" + file.getAbsolutePath() + "\"}";
        } catch (Exception e) {
            return "{\"success\":false,\"error\":\"" + e.getMessage() + "\"}";
        }
    }

    @JavascriptInterface
    public void printHtml(String html) {
        // 简化版打印：通过WebView打印
        getActivity().runOnUiThread(() -> {
            try {
                android.print.PrintManager printManager = (android.print.PrintManager) getContext().getSystemService(Context.PRINT_SERVICE);
                android.print.PrintDocumentAdapter printAdapter = new android.print.PrintDocumentAdapter() {
                    @Override
                    public void onWrite(android.print.PageRange[] pages, android.os.ParcelFileDescriptor descriptor, android.os.CancellationSignal signal, android.print.PrintDocumentAdapter.WriteResultCallback callback) {
                        try (java.io.FileOutputStream fis = new java.io.FileOutputStream(descriptor.getFileDescriptor())) {
                            fis.write(html.getBytes(StandardCharsets.UTF_8));
                            callback.onWriteFinished(new android.print.PageRange[]{android.print.PageRange.ALL_PAGES});
                        } catch (Exception e) {
                            callback.onWriteFailed(e.getMessage());
                        }
                    }
                    @Override
                    public void onLayout(android.print.PrintAttributes oldAttributes, android.print.PrintAttributes newAttributes, android.os.CancellationSignal signal, android.print.PrintDocumentAdapter.LayoutResultCallback callback, android.os.Bundle extras) {
                        if (signal.isCanceled()) {
                            callback.onLayoutCancelled();
                            return;
                        }
                        android.print.PrintDocumentInfo info = new android.print.PrintDocumentInfo.Builder("prescription")
                                .setContentType(android.print.PrintDocumentInfo.CONTENT_TYPE_DOCUMENT)
                                .build();
                        callback.onLayoutFinished(info, true);
                    }
                };
                printManager.print("惠康中医处方", printAdapter, new android.print.PrintAttributes.Builder().build());
            } catch (Exception e) {
                // ignore
            }
        });
    }

    private String guessMimeType(String filePath) {
        if (filePath == null) return "application/octet-stream";
        String lower = filePath.toLowerCase();
        if (lower.endsWith(".webm")) return "video/webm";
        if (lower.endsWith(".mp4")) return "video/mp4";
        if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
        if (lower.endsWith(".png")) return "image/png";
        return "application/octet-stream";
    }

    // === 加密/解密 ===
    @JavascriptInterface
    public String encryptData(String data, String key) {
        try {
            javax.crypto.Cipher cipher = javax.crypto.Cipher.getInstance("AES/CBC/PKCS5Padding");
            byte[] keyBytes = new byte[16];
            byte[] providedKey = key.getBytes(StandardCharsets.UTF_8);
            System.arraycopy(providedKey, 0, keyBytes, 0, Math.min(providedKey.length, 16));
            javax.crypto.spec.SecretKeySpec secretKey = new javax.crypto.spec.SecretKeySpec(keyBytes, "AES");
            javax.crypto.spec.IvParameterSpec iv = new javax.crypto.spec.IvParameterSpec(keyBytes);
            cipher.init(javax.crypto.Cipher.ENCRYPT_MODE, secretKey, iv);
            byte[] encrypted = cipher.doFinal(data.getBytes(StandardCharsets.UTF_8));
            return Base64.encodeToString(encrypted, Base64.NO_WRAP);
        } catch (Exception e) {
            return null;
        }
    }

    @JavascriptInterface
    public String decryptData(String encryptedData, String key) {
        try {
            javax.crypto.Cipher cipher = javax.crypto.Cipher.getInstance("AES/CBC/PKCS5Padding");
            byte[] keyBytes = new byte[16];
            byte[] providedKey = key.getBytes(StandardCharsets.UTF_8);
            System.arraycopy(providedKey, 0, keyBytes, 0, Math.min(providedKey.length, 16));
            javax.crypto.spec.SecretKeySpec secretKey = new javax.crypto.spec.SecretKeySpec(keyBytes, "AES");
            javax.crypto.spec.IvParameterSpec iv = new javax.crypto.spec.IvParameterSpec(keyBytes);
            cipher.init(javax.crypto.Cipher.DECRYPT_MODE, secretKey, iv);
            byte[] decrypted = cipher.doFinal(Base64.decode(encryptedData, Base64.NO_WRAP));
            return new String(decrypted, StandardCharsets.UTF_8);
        } catch (Exception e) {
            return null;
        }
    }
}
