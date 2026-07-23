package com.benneng.pres;

import android.Manifest;
import android.app.Activity;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.provider.MediaStore;
import android.util.Base64;
import android.util.Log;
import android.view.ViewGroup;
import android.view.Window;
import android.webkit.JavascriptInterface;
import android.webkit.JsPromptResult;
import android.webkit.JsResult;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;

/**
 * 本能中医处方 - 个人本地离线版（手机 APP）
 *
 * 纯 WebView 架构，离线加载 assets/public/index.html。
 * 通过 @JavascriptInterface 注入 electronAPI 桥接：
 *   - saveBackupFile：备份 JSON 写入公共 Downloads 目录
 *   - savePrescriptionImage：处方图片写入外部存储
 *   - quitApp：退出 APP
 * 主数据存储由网页 localStorage 完成（WebView 持久化）。
 */
public class MainActivity extends AppCompatActivity {

    private static final String TAG = "TCM-Pres";
    private static final String LOCAL_INDEX = "file:///android_asset/public/index.html";
    private static final int REQ_STORAGE = 1001;
    private static final int REQ_CAMERA = 1003;

    private WebView webView;
    private FrameLayout container;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private ValueCallback<Uri[]> filePathCallback;
    private static final int REQ_FILE_CHOOSER = 1002;
    private volatile String cachedVideoRecorderScript = null;
    // 媒体文件读取白名单（启动时初始化一次，避免每次调用都做 I/O 解析）
    // 彻底解决"加载失败"反复出现：统一路径解析，消除 getAbsolutePath vs getCanonicalPath 不一致
    private java.util.Set<String> mediaWhitelistedRoots = new java.util.HashSet<>();

    // ★ License 管理器（APP 端授权校验 + 处方计数 + 在线激活）
    // 与桌面版 license-manager.js / prescription-counter.js 逻辑一致
    private LicenseManager licenseManager;

    // ========================================================================
    // 生命周期
    // ========================================================================
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        super.onCreate(savedInstanceState);

        // Android 6.0+ 动态申请存储权限（仅 28 及以下需要 WRITE_EXTERNAL_STORAGE）
        if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.P) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.WRITE_EXTERNAL_STORAGE)
                    != PackageManager.PERMISSION_GRANTED) {
                ActivityCompat.requestPermissions(this,
                        new String[]{Manifest.permission.WRITE_EXTERNAL_STORAGE}, REQ_STORAGE);
            }
        }

        // Android 6.0+ 动态申请相机和麦克风权限
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA)
                    != PackageManager.PERMISSION_GRANTED ||
                ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
                    != PackageManager.PERMISSION_GRANTED) {
                ActivityCompat.requestPermissions(this,
                        new String[]{Manifest.permission.CAMERA, Manifest.permission.RECORD_AUDIO}, REQ_CAMERA);
            }
        }

        // 创建 WebView 并立即配置
        webView = new WebView(this);
        // ★ 适配状态栏（无 padding 方案）：WebView 填满整个屏幕，网页顶部紫色（header-section/login-overlay）
        // 与状态栏紫色(#667eea)融合，无额外 padding 区域。onPageFinished 时注入 CSS 让 header-section
        // 内容下移避开状态栏。此方案消除顶部灰白行/紫色加宽条，操作界面紧贴状态栏下方。
        container = new FrameLayout(this);
        int statusBarHeight = getStatusBarHeight();
        container.setLayoutParams(new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT));
        webView.setLayoutParams(new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT));
        container.addView(webView);
        setContentView(container);
        configureWebView();

        // ★ 初始化 License 管理器（APP 端授权校验）
        licenseManager = new LicenseManager(this);

        // 初始化媒体文件读取白名单（只解析一次，避免运行时 I/O 不稳定）
        initMediaWhitelist();

        // 后台预加载录像拍照脚本（避免 onPageFinished 时同步IO阻塞UI）
        preloadVideoRecorderScript();
    }

    // ★ 适配状态栏：通过资源 ID 获取状态栏高度（兜底，HyperOS / MIUI 也用此标准资源）
    private int getStatusBarHeight() {
        try {
            int resId = getResources().getIdentifier("status_bar_height", "dimen", "android");
            if (resId > 0) {
                return getResources().getDimensionPixelSize(resId);
            }
        } catch (Exception e) { /* 忽略 */ }
        // 兜底：24dp 转 px（Android 标准状态栏高度）
        return (int) (24 * getResources().getDisplayMetrics().density);
    }

    // ★ 适配状态栏：onAttachedToWindow 兜底再次触发 insets 分发
    // 应对某些 ROM 在 onCreate 时拦截 insets 派发导致 listener 不触发
    @Override
    public void onAttachedToWindow() {
        super.onAttachedToWindow();
    }

    // 初始化媒体文件读取白名单：缓存所有可能的目录（外部 + 内部 fallback）
    // 彻底解决 getExternalFilesDir 返回 null 时白名单失效的问题
    private void initMediaWhitelist() {
        mediaWhitelistedRoots.clear();
        try {
            // 外部存储目录（Android 10+）
            File extImg = getExternalFilesDir(Environment.DIRECTORY_PICTURES);
            if (extImg != null) {
                File d = new File(extImg, "本能中医处方");
                mediaWhitelistedRoots.add(d.getCanonicalPath() + File.separator);
            }
            File extVid = getExternalFilesDir(Environment.DIRECTORY_MOVIES);
            if (extVid != null) {
                File d = new File(extVid, "本能中医处方");
                mediaWhitelistedRoots.add(d.getCanonicalPath() + File.separator);
            }
            // Android 9 及以下：外部公共目录
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
                File pubImg = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES);
                if (pubImg != null) {
                    File d = new File(pubImg, "本能中医处方");
                    mediaWhitelistedRoots.add(d.getCanonicalPath() + File.separator);
                }
                File pubVid = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_MOVIES);
                if (pubVid != null) {
                    File d = new File(pubVid, "本能中医处方");
                    mediaWhitelistedRoots.add(d.getCanonicalPath() + File.separator);
                }
            }
            // 内部 fallback 目录（getExternalFilesDir 返回 null 时使用）
            mediaWhitelistedRoots.add(new File(getFilesDir(), "prescription_images").getCanonicalPath() + File.separator);
            mediaWhitelistedRoots.add(new File(getFilesDir(), "prescription_videos").getCanonicalPath() + File.separator);
            Log.i(TAG, "媒体白名单初始化完成: " + mediaWhitelistedRoots.size() + " 个根目录");
        } catch (Exception e) {
            Log.e(TAG, "initMediaWhitelist 失败", e);
        }
    }

    /** 媒体路径白名单校验（Activity级别，供NativeBridge和WebViewClient共用） */
    private boolean isMediaPathAllowed(String filePath) {
        try {
            if (filePath == null || filePath.isEmpty()) return false;
            File f = new File(filePath);
            String canonical = f.getCanonicalPath();
            for (String root : mediaWhitelistedRoots) {
                if (canonical.startsWith(root)) return true;
            }
            Log.w(TAG, "isMediaPathAllowed 拒绝非白名单路径: " + canonical);
            return false;
        } catch (Exception e) {
            Log.e(TAG, "isMediaPathAllowed 异常: " + filePath, e);
            return false;
        }
    }

    /** 根据文件名推断MIME类型 */
    private String guessMimeType(String filePath) {
        if (filePath == null) return "application/octet-stream";
        String lower = filePath.toLowerCase();
        if (lower.endsWith(".webm")) return "video/webm";
        if (lower.endsWith(".mp4")) return "video/mp4";
        if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
        if (lower.endsWith(".png")) return "image/png";
        return "application/octet-stream";
    }

    // ========================================================================
    // 签名校验（防盗：防止二次打包/篡改）
    // ========================================================================
    // 安全防护已于 2026-07-19 应用户要求回退到 7月17日18:00 之前的状态
    // 如需恢复防盗防破解功能，请从 commit 0f49e52 cherry-pick SecurityGuard 相关代码

    // ========================================================================
    // WebView 配置
    // ========================================================================
    private void configureWebView() {
        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setCacheMode(WebSettings.LOAD_NO_CACHE);
        s.setAllowFileAccess(true);
        s.setAllowContentAccess(true);
        s.setAllowFileAccessFromFileURLs(true);
        s.setAllowUniversalAccessFromFileURLs(true);
        // 允许 file:// 页面加载 http://local-media/ 资源（内嵌视频播放需要）
        // shouldInterceptRequest 会拦截并返回本地文件流，不存在真实网络请求
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        s.setTextZoom(100);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setSupportMultipleWindows(true);
        s.setJavaScriptCanOpenWindowsAutomatically(true);

        webView.clearHistory();
        webView.addJavascriptInterface(new NativeBridge(), "AndroidNative");

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(android.webkit.PermissionRequest request) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                    for (String permission : request.getResources()) {
                        if (permission.equals(android.webkit.PermissionRequest.RESOURCE_VIDEO_CAPTURE) ||
                            permission.equals(android.webkit.PermissionRequest.RESOURCE_AUDIO_CAPTURE)) {
                            request.grant(request.getResources());
                            return;
                        }
                    }
                    request.deny();
                }
            }

            @Override
            public boolean onJsPrompt(WebView view, String url, String message, String defaultValue, JsPromptResult result) {
                Context ctx = view.getContext();
                float density = ctx.getResources().getDisplayMetrics().density;
                int pad12 = (int)(12 * density);
                int pad16 = (int)(16 * density);

                final EditText input = new EditText(ctx);
                input.setHint("请在此输入...");
                input.setPadding(pad12, pad12, pad12, pad12);
                input.setTextSize(14);
                // 给输入框加可见边框，解决部分机型看不到输入框的问题
                android.graphics.drawable.GradientDrawable bg = new android.graphics.drawable.GradientDrawable();
                bg.setColor(0xFFFFFFFF);
                bg.setStroke((int)(2 * density), 0xFF888888);
                bg.setCornerRadius(6 * density);
                input.setBackground(bg);
                if (defaultValue != null && !defaultValue.isEmpty()) {
                    input.setText(defaultValue);
                    input.selectAll();
                }

                // 把提示文字和输入框放进同一个 LinearLayout，确保在小屏幕上都可见
                android.widget.LinearLayout container = new android.widget.LinearLayout(ctx);
                container.setOrientation(android.widget.LinearLayout.VERTICAL);
                container.setPadding(pad16, pad12, pad16, 0);
                if (message != null && !message.isEmpty()) {
                    android.widget.TextView msgText = new android.widget.TextView(ctx);
                    msgText.setText(message);
                    msgText.setTextSize(14);
                    android.widget.LinearLayout.LayoutParams msgLp = new android.widget.LinearLayout.LayoutParams(
                            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
                    msgLp.setMargins(0, 0, 0, pad12);
                    container.addView(msgText, msgLp);
                }
                android.widget.LinearLayout.LayoutParams inputLp = new android.widget.LinearLayout.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
                container.addView(input, inputLp);

                new android.app.AlertDialog.Builder(ctx)
                        .setTitle("请输入")
                        .setView(container)
                        .setPositiveButton("确定", (d, w) -> result.confirm(input.getText().toString()))
                        .setNegativeButton("取消", (d, w) -> result.cancel())
                        .setOnCancelListener(d -> result.cancel())
                        .show();
                return true;
            }

            @Override
            public boolean onJsAlert(WebView view, String url, String message, JsResult result) {
                new android.app.AlertDialog.Builder(view.getContext())
                        .setTitle("提示")
                        .setMessage(message)
                        .setPositiveButton("确定", (d, w) -> result.confirm())
                        .setOnCancelListener(d -> result.cancel())
                        .show();
                return true;
            }

            @Override
            public boolean onJsConfirm(WebView view, String url, String message, JsResult result) {
                new android.app.AlertDialog.Builder(view.getContext())
                        .setTitle("提示")
                        .setMessage(message)
                        .setPositiveButton("确定", (d, w) -> result.confirm())
                        .setNegativeButton("取消", (d, w) -> result.cancel())
                        .setOnCancelListener(d -> result.cancel())
                        .show();
                return true;
            }

            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (filePathCallback != null) {
                    filePathCallback.onReceiveValue(null);
                }
                filePathCallback = callback;
                Intent intent = params.createIntent();
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                try {
                    startActivityForResult(intent, REQ_FILE_CHOOSER);
                } catch (Exception e) {
                    filePathCallback = null;
                    Toast.makeText(MainActivity.this, "无法打开文件选择器", Toast.LENGTH_SHORT).show();
                    return false;
                }
                return true;
            }

            @Override
            public boolean onCreateWindow(WebView view, boolean isDialog, boolean isUserGesture, android.os.Message resultMsg) {
                WebView printView = new WebView(MainActivity.this);
                WebSettings ps = printView.getSettings();
                ps.setJavaScriptEnabled(true);
                ps.setDomStorageEnabled(true);
                printView.addJavascriptInterface(new NativeBridge(), "AndroidNative");

                printView.setWebViewClient(new WebViewClient() {
                    @Override
                    public void onPageFinished(WebView v, String url) {
                        super.onPageFinished(v, url);
                        v.evaluateJavascript(
                            "if(window.print){var _p=window.print;window.print=function(){" +
                            "var h=document.documentElement.outerHTML;" +
                            "AndroidNative.printHtml(h);" +
                            "};}", null);
                    }
                });

                WebView.WebViewTransport transport = (WebView.WebViewTransport) resultMsg.obj;
                transport.setWebView(printView);
                resultMsg.sendToTarget();
                return true;
            }
        });

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                injectElectronApiShim(view);
                injectStatusBarFix(view);
                injectLoginUsernameFix(view);
                // 延迟注入录像拍照脚本（等待页面渲染稳定）
                mainHandler.postDelayed(() -> injectVideoRecorderScript(view), 300);
            }

            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, String url) {
                return handleMediaRequest(url, null);
            }

            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, android.webkit.WebResourceRequest request) {
                if (request == null) return null;
                String url = request.getUrl() != null ? request.getUrl().toString() : null;
                // 获取请求头（用于 Range 请求）
                java.util.Map<String, String> headers = null;
                try {
                    headers = request.getRequestHeaders();
                } catch (Throwable ignored) {}
                return handleMediaRequest(url, headers);
            }
        });

        webView.loadUrl(LOCAL_INDEX);
    }

    /**
     * 处理本地媒体文件请求（http://local-media/ + 路径）
     * 支持 Range 请求（视频 seek 必需），返回 200 或 206
     */
    private WebResourceResponse handleMediaRequest(String url, java.util.Map<String, String> headers) {
        if (url == null || !url.startsWith("http://local-media/")) {
            return null;
        }
        try {
            String filePath = url.substring("http://local-media/".length());
            filePath = java.net.URLDecoder.decode(filePath, "UTF-8");
            if (!isMediaPathAllowed(filePath)) {
                Log.w(TAG, "媒体路径不在白名单内: " + filePath);
                return null;
            }
            File file = new File(filePath);
            if (!file.exists() || !file.isFile()) {
                Log.w(TAG, "媒体文件不存在: " + filePath);
                return null;
            }
            String mimeType = guessMimeType(filePath);
            long fileLen = file.length();

            // 解析 Range 请求头（HTML5 video 通常会发送）
            long start = 0;
            long end = fileLen - 1;
            boolean hasRange = false;
            if (headers != null) {
                for (java.util.Map.Entry<String, String> e : headers.entrySet()) {
                    if (e.getKey() != null && e.getKey().equalsIgnoreCase("Range") && e.getValue() != null) {
                        String val = e.getValue().trim();
                        if (val.startsWith("bytes=")) {
                            String range = val.substring(6);
                            int dash = range.indexOf('-');
                            if (dash >= 0) {
                                try {
                                    String s = range.substring(0, dash).trim();
                                    String e2 = range.substring(dash + 1).trim();
                                    if (!s.isEmpty()) start = Long.parseLong(s);
                                    if (!e2.isEmpty()) end = Long.parseLong(e2);
                                    hasRange = true;
                                } catch (Exception ignored) {}
                            }
                        }
                    }
                }
            }

            // 修正 end 边界
            if (end < 0 || end >= fileLen) end = fileLen - 1;
            if (start < 0) start = 0;
            if (start > end) start = 0;

            long contentLen = end - start + 1;
            final long startOffset = start;
            final long limit = contentLen;

            // 使用 RandomAccessFile 包装成 InputStream，支持从指定位置读取指定长度
            // 这样既能 seek 到 Range 请求的 start 位置，又能限制读取长度（206 响应）
            java.io.InputStream inputStream = new java.io.InputStream() {
                private java.io.RandomAccessFile raf;
                private long remaining;
                private boolean initialized = false;
                private void ensureInit() throws java.io.IOException {
                    if (!initialized) {
                        raf = new java.io.RandomAccessFile(file, "r");
                        raf.seek(startOffset);
                        remaining = limit;
                        initialized = true;
                    }
                }
                @Override
                public int read() throws java.io.IOException {
                    ensureInit();
                    if (remaining <= 0) return -1;
                    int b = raf.read();
                    if (b >= 0) remaining--;
                    return b;
                }
                @Override
                public int read(byte[] b, int off, int len) throws java.io.IOException {
                    ensureInit();
                    if (remaining <= 0) return -1;
                    int toRead = (int) Math.min(len, remaining);
                    int n = raf.read(b, off, toRead);
                    if (n > 0) remaining -= n;
                    return n;
                }
                @Override
                public void close() throws java.io.IOException {
                    if (raf != null) {
                        try { raf.close(); } catch (Exception ignored) {}
                    }
                }
            };

            // 视频是二进制流，encoding 必须为 null（不能是 UTF-8）
            WebResourceResponse resp = new WebResourceResponse(mimeType, null, inputStream);

            final java.util.Map<String, String> respHeaders = new java.util.HashMap<>();
            respHeaders.put("Access-Control-Allow-Origin", "*");
            respHeaders.put("Accept-Ranges", "bytes");
            respHeaders.put("Content-Length", String.valueOf(contentLen));

            if (hasRange) {
                // 206 Partial Content（视频 seek 需要）
                resp.setStatusCodeAndReasonPhrase(206, "Partial Content");
                respHeaders.put("Content-Range", "bytes " + start + "-" + end + "/" + fileLen);
            } else {
                resp.setStatusCodeAndReasonPhrase(200, "OK");
            }
            resp.setResponseHeaders(respHeaders);
            return resp;
        } catch (Exception e) {
            Log.e(TAG, "拦截媒体请求失败: " + url, e);
            return null;
        }
    }

    /**
     * 注入 window.electronAPI 桥接层。
     * isElectron=true 使网页走 Electron 代码分支；
     * saveBackupFile/savePrescriptionImage/quitApp 调用原生方法；
     * 其余方法为 no-op，数据由 localStorage 持久化。
     */
    private void injectElectronApiShim(WebView view) {
        String js = "(function(){" +
            "  if (window.electronAPI && window.electronAPI.__injected) return;" +
            "  var N = window.AndroidNative;" +
            "  if (!N) return;" +
            "  function P(v){ return Promise.resolve(v); }" +
            "  function callNative(name, json){ return JSON.parse(N.invoke(name, json||'{}')); }" +
            "  window.electronAPI = {" +
            "    __injected: true," +
            "    isElectron: true," +
            "    saveUserData: function(k,d){ return P({success:true}); }," +
            "    getUserData: function(k){ return P({success:false,data:null}); }," +
            "    saveBackupFile: function(jsonStr, fileName){" +
            "      return new Promise(function(resolve){" +
            "        try { var r = callNative('saveBackupFile', JSON.stringify({jsonStr:jsonStr,fileName:fileName})); resolve(r); }" +
            "        catch(e){ resolve({success:false, error:String(e)}); }" +
            "      });" +
            "    }," +
            "    savePrescriptionImage: function(imageData, fileName){" +
            "      return new Promise(function(resolve){" +
            "        try { var r = callNative('savePrescriptionImage', JSON.stringify({imageData:imageData,fileName:fileName})); resolve(r); }" +
            "        catch(e){ resolve({success:false, error:String(e)}); }" +
            "      });" +
            "    }," +
            "    saveVideoFile: function(arrayBuffer, fileName){" +
            "      return new Promise(function(resolve){" +
            "        try { var bytes=new Uint8Array(arrayBuffer); var bin=''; for(var i=0;i<bytes.length;i+=8192){bin+=String.fromCharCode.apply(null,bytes.subarray(i,i+8192));} var r = callNative('saveVideoFile', JSON.stringify({base64Data:btoa(bin),fileName:fileName})); resolve(r); }" +
            "        catch(e){ resolve({success:false, error:String(e)}); }" +
            "      });" +
            "    }," +
            "    getVideoDirectory: function(){" +
            "      return new Promise(function(resolve){" +
            "        try { var r = callNative('getVideoDirectory', '{}'); resolve(r); }" +
            "        catch(e){ resolve({success:false, error:String(e)}); }" +
            "      });" +
            "    }," +
            "    findMediaFiles: function(patientName, prescriptionNo, createdAt){" +
            "      return new Promise(function(resolve){" +
            "        try { var r = callNative('findMediaFiles', JSON.stringify({patientName:patientName,prescriptionNo:prescriptionNo,createdAt:createdAt||''})); resolve(r); }" +
            "        catch(e){ resolve({success:false, error:String(e), files:[]}); }" +
            "      });" +
            "    }," +
            "    openFile: function(filePath, mimeType){" +
            "      return new Promise(function(resolve){" +
            "        try { var r = callNative('openFile', JSON.stringify({filePath:filePath,mimeType:mimeType||''})); resolve(r); }" +
            "        catch(e){ resolve({success:false, error:String(e)}); }" +
            "      });" +
            "    }," +
            "    readFileAsBase64: function(filePath){" +
            "      return new Promise(function(resolve){" +
            "        try { var r = callNative('readFileAsBase64', JSON.stringify({filePath:filePath})); resolve(r); }" +
            "        catch(e){ resolve({success:false, error:String(e)}); }" +
            "      });" +
            "    }," +
            "    renameMediaFiles: function(patientName, oldNo, newNo){" +
            "      return new Promise(function(resolve){" +
            "        try { var r = callNative('renameMediaFiles', JSON.stringify({patientName:patientName,oldNo:oldNo,newNo:newNo})); resolve(r); }" +
            "        catch(e){ resolve({success:false, error:String(e), renamed:0}); }" +
            "      });" +
            "    }," +
            "    loginSuccess: function(u){ return P({success:true}); }," +
            "    getCurrentUser: function(){ return P(null); }," +
            "    onLoginUser: function(cb){ /* no-op */ }," +
            "    setAutoStart: function(en){ return P({success:true}); }," +
            "    quitApp: function(){ N.quitApp(); return P({success:true}); }," +
            // ★ License 命名空间（与桌面版 preload.js license 命名空间接口一致）
            "    license: {" +
            "      validate: function(){ return new Promise(function(resolve){ try { resolve(callNative('license_validate', '{}')); } catch(e){ resolve({valid:false, type:'error', message:String(e)}); } }); }," +
            "      getStatus: function(){ return new Promise(function(resolve){ try { resolve(callNative('license_getStatus', '{}')); } catch(e){ resolve({success:false, error:String(e)}); } }); }," +
            "      getMachineId: function(){ return new Promise(function(resolve){ try { resolve(callNative('license_getMachineId', '{}')); } catch(e){ resolve(null); } }); }," +
            "      canPrescribe: function(){ return new Promise(function(resolve){ try { resolve(callNative('license_canPrescribe', '{}')); } catch(e){ resolve({allowed:true, error:String(e)}); } }); }," +
            "      incrementPrescription: function(){ return new Promise(function(resolve){ try { resolve(callNative('license_incrementPrescription', '{}')); } catch(e){ resolve({success:false, error:String(e)}); } }); }," +
            "      decrementPrescription: function(){ return new Promise(function(resolve){ try { resolve(callNative('license_decrementPrescription', '{}')); } catch(e){ resolve({success:false, error:String(e)}); } }); }," +
            "      getPrescriptionStatus: function(){ return new Promise(function(resolve){ try { resolve(callNative('license_getPrescriptionStatus', '{}')); } catch(e){ resolve({current:0, max:0, remaining:-1, error:String(e)}); } }); }," +
            "      checkFeature: function(feature){ return new Promise(function(resolve){ try { resolve(callNative('license_checkFeature', JSON.stringify({feature:feature}))); } catch(e){ resolve({allowed:true, feature:feature, error:String(e)}); } }); }," +
            "      activate: { /* 离线 license 文件导入，APP 端不支持 */" +
            "        importLicense: function(){ return P({success:false, error:'APP端不支持离线license文件导入，请使用在线激活'}); }" +
            "      }," +
            "      setTrialDays: function(days){ return new Promise(function(resolve){ try { resolve(callNative('license_setTrialDays', JSON.stringify({days:days}))); } catch(e){ resolve({success:false, error:String(e)}); } }); }," +
            "      getTrialDays: function(){ return new Promise(function(resolve){ try { resolve(callNative('license_getTrialDays', '{}')); } catch(e){ resolve({success:false, trialDays:7, error:String(e)}); } }); }" +
            "    }," +
            // ★ activate 命名空间（与桌面版 preload.js activate 命名空间接口一致）
            "    activate: {" +
            "      show: function(){ return new Promise(function(resolve){ try { window.dispatchEvent(new CustomEvent('app:show-activate')); resolve({success:true}); } catch(e){ resolve({success:false, error:String(e)}); } }); }," +
            "      submit: function(code, user){ return new Promise(function(resolve){ try { resolve(callNative('license_activateOnline', JSON.stringify({code:code,user:user||''}))); } catch(e){ resolve({success:false, error:String(e)}); } }); }," +
            "      close: function(){ return P({success:true}); }," +
            "      restart: function(){ return new Promise(function(resolve){ try { resolve(callNative('license_restart', '{}')); } catch(e){ resolve({success:false, error:String(e)}); } }); }," +
            "      getMachineId: function(){ return new Promise(function(resolve){ try { resolve(callNative('license_getMachineId', '{}')); } catch(e){ resolve(null); } }); }" +
            "    }" +
            "  };" +
            "  window.IS_ELECTRON = true;" +
            "})();";
        view.evaluateJavascript(js, null);
    }

    /**
     * 预加载录像拍照脚本到内存缓存（在后台线程执行，避免阻塞UI）
     */
    private void preloadVideoRecorderScript() {
        if (cachedVideoRecorderScript != null) return;
        new Thread(() -> {
            try {
                InputStream is = getAssets().open("video-recorder-inject.js");
                java.io.ByteArrayOutputStream baos = new java.io.ByteArrayOutputStream();
                byte[] buffer = new byte[8192];
                int len;
                while ((len = is.read(buffer)) > 0) {
                    baos.write(buffer, 0, len);
                }
                is.close();
                cachedVideoRecorderScript = baos.toString("UTF-8");
                Log.d(TAG, "录像拍照脚本预加载完成，长度: " + cachedVideoRecorderScript.length());
            } catch (Exception e) {
                Log.e(TAG, "录像拍照脚本预加载失败", e);
            }
        }, "preload-vr-script").start();
    }

    /**
     * 同步读取录像拍照脚本（带缓存）
     */
    private String getVideoRecorderScript() {
        if (cachedVideoRecorderScript != null) return cachedVideoRecorderScript;
        try {
            InputStream is = getAssets().open("video-recorder-inject.js");
            java.io.ByteArrayOutputStream baos = new java.io.ByteArrayOutputStream();
            byte[] buffer = new byte[8192];
            int len;
            while ((len = is.read(buffer)) > 0) {
                baos.write(buffer, 0, len);
            }
            is.close();
            cachedVideoRecorderScript = baos.toString("UTF-8");
            Log.d(TAG, "录像拍照脚本同步加载完成，长度: " + cachedVideoRecorderScript.length());
        } catch (Exception e) {
            Log.e(TAG, "录像拍照脚本同步加载失败", e);
            cachedVideoRecorderScript = "";
        }
        return cachedVideoRecorderScript;
    }

    /**
     * ★ 注入状态栏避让 CSS（无 padding 方案配套）
     * WebView 填满屏幕，网页顶部紫色与状态栏紫色融合。
     * header-section 内容需要下移避开状态栏，注入 padding-top。
     * login-overlay 紫色渐变与状态栏融合，login-container 居中不受影响。
     */
    private void injectStatusBarFix(WebView webView) {
        int sbHeight = getStatusBarHeight();
        String js = "(function(){" +
            "  if (document.getElementById('status-bar-fix')) return;" +
            "  var s = document.createElement('style');" +
            "  s.id = 'status-bar-fix';" +
            "  s.textContent = '@media screen and (max-width: 768px) {" +
            "    .header-section { padding-top: " + sbHeight + "px !important; }" +
            "  }';" +
            "  document.head.appendChild(s);" +
            "})();";
        webView.evaluateJavascript(js, null);
    }

    /**
     * ★ 个人版：确保登入界面用户名输入框显示医师姓名（CONFIG.doctorName），
     * 不被 initRememberedCredentials 中的 rememberedUsername（如 admin）覆盖。
     * 延迟 600ms 执行，确保在 init()/initRememberedCredentials() 之后执行。
     */
    private void injectLoginUsernameFix(WebView webView) {
        String js = "(function(){" +
            "  setTimeout(function() {" +
            "    try {" +
            "      var input = document.getElementById('loginUsername');" +
            "      if (!input) return;" +
            "      var overlay = document.getElementById('loginOverlay');" +
            "      if (overlay && overlay.style.display === 'none') return;" +  // 已登录则不修改
            "      var name = (typeof CONFIG !== 'undefined' && CONFIG.doctorName) ? CONFIG.doctorName : '卢二灼';" +
            "      input.value = name;" +
            "    } catch(e) { console.warn('loginUsername fix error:', e); }" +
            "  }, 600);" +
            "})();";
        webView.evaluateJavascript(js, null);
    }

    /**
     * 注入录像拍照功能脚本（使用内存缓存，避免每次IO）
     */
    private void injectVideoRecorderScript(WebView webView) {
        String script = getVideoRecorderScript();
        if (script == null || script.isEmpty()) {
            Log.e(TAG, "录像拍照脚本为空，跳过注入");
            return;
        }
        webView.evaluateJavascript(script, null);
        Log.d(TAG, "录像拍照脚本注入成功");
    }

    @Override
    public void onBackPressed() {
        if (webView != null) {
            // 使用 typeof 检查避免 JS 函数未定义时抛 ReferenceError（导致"系统异常"提示）
            webView.evaluateJavascript("(typeof handleAndroidBack === 'function') ? handleAndroidBack() : false", new ValueCallback<String>() {
                @Override
                public void onReceiveValue(String value) {
                    if (value == null || value.equals("false") || value.equals("\"false\"")) {
                        MainActivity.super.onBackPressed();
                    }
                }
            });
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.removeJavascriptInterface("AndroidNative");
            ((ViewGroup) webView.getParent()).removeView(webView);
            webView.removeAllViews();
            webView.destroy();
            webView = null;
        }
        mainHandler.removeCallbacksAndMessages(null);
        super.onDestroy();
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, @NonNull String[] permissions, @NonNull int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQ_STORAGE) {
            boolean granted = grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED;
            if (!granted) {
                Toast.makeText(this, "未授予存储权限，备份文件可能无法保存", Toast.LENGTH_LONG).show();
            }
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQ_FILE_CHOOSER && filePathCallback != null) {
            Uri[] results = null;
            if (resultCode == Activity.RESULT_OK && data != null && data.getData() != null) {
                results = new Uri[]{data.getData()};
            } else if (resultCode == Activity.RESULT_OK && data != null && data.getClipData() != null) {
                int count = data.getClipData().getItemCount();
                results = new Uri[count];
                for (int i = 0; i < count; i++) {
                    results[i] = data.getClipData().getItemAt(i).getUri();
                }
            }
            filePathCallback.onReceiveValue(results);
            filePathCallback = null;
        }
    }

    // ========================================================================
    // P1-6: NativeBridge 调用来源校验，仅允许本地 assets 页面调用
    // 防止 XSS 注入页面或第三方页面调用 readFileAsBase64 读取沙箱任意文件
    // ========================================================================
    private boolean isCallerAllowed() {
        try {
            if (webView == null) return false;
            String url = webView.getUrl();
            return url != null && url.startsWith("file:///android_asset/");
        } catch (Exception e) {
            return false;
        }
    }

    // P1-6: 分层校验 - 仅敏感操作需校验来源，保存/查找操作跳过校验
    // readFileAsBase64 / openFile 不再列为敏感操作：内部已用 isMediaPathAllowed 路径白名单校验
    // 彻底解决"加载失败"反复出现：避免 isCallerAllowed 误拦截导致视频播放
    private boolean isSensitiveOperation(String name) {
        return "deleteFile".equals(name);
    }

    // ========================================================================
    // JavaScript 接口
    // ========================================================================
    public class NativeBridge {

        @JavascriptInterface
        public String invoke(String name, String jsonStr) {
            // P1-6: 分层校验 - 仅敏感操作校验来源，保存/查找操作跳过校验
            // 防止 WebView URL 短暂变化时误拦截保存/查找操作
            if (isSensitiveOperation(name) && !isCallerAllowed()) {
                Log.w(TAG, "NativeBridge.invoke 拒绝非本地调用: " + name);
                return fail("permission denied").toString();
            }
            try {
                JSONObject args = new JSONObject(jsonStr);
                switch (name) {
                    case "saveBackupFile":
                        return saveBackupFile(args.optString("jsonStr", ""),
                                args.optString("fileName", "")).toString();
                    case "savePrescriptionImage":
                        return savePrescriptionImage(args.optString("imageData", ""),
                                args.optString("fileName", "")).toString();
                    case "saveVideoFile":
                        return saveVideoFile(args.optString("base64Data", ""),
                                args.optString("fileName", "")).toString();
                    case "startMediaSession":
                        return startMediaSession(args.optString("fileName", "")).toString();
                    case "appendMediaChunk":
                        return appendMediaChunk(args.optString("sessionId", ""),
                                args.optString("chunkBase64", ""),
                                args.optInt("index", 0),
                                args.optInt("total", 0)).toString();
                    case "commitMediaSession":
                        return commitMediaSession(args.optString("sessionId", ""),
                                args.optString("fileName", ""),
                                args.optString("type", "image")).toString();
                    case "getVideoDirectory":
                        return getVideoDirectory().toString();
                    case "findMediaFiles":
                        return findMediaFiles(args.optString("patientName", ""),
                                args.optString("prescriptionNo", ""),
                                args.optString("createdAt", "")).toString();
                    case "openFile":
                        return openFile(args.optString("filePath", ""),
                                args.optString("mimeType", "")).toString();
                    case "readFileAsBase64":
                        return readFileAsBase64(args.optString("filePath", "")).toString();
                    case "startReadSession":
                        return startReadSession(args.optString("filePath", "")).toString();
                    case "readNextChunk":
                        return readNextChunk(args.optString("sessionId", "")).toString();
                    case "closeReadSession":
                        return closeReadSession(args.optString("sessionId", "")).toString();
                    case "renameMediaFiles":
                        return renameMediaFiles(args.optString("patientName", ""),
                                args.optString("oldNo", ""),
                                args.optString("newNo", "")).toString();
                    // ★ License 相关调用（与桌面版 IPC 接口保持一致）
                    case "license_validate":
                        // ★ v3 新增：传入 localMachineId 用于三因子绑定校验
                        return licenseManager.validateLicense(licenseManager.getMachineId()).toString();
                    case "license_getStatus":
                        try {
                            // ★ v3 新增：传入 localMachineId 用于绑定校验
                            JSONObject r = licenseManager.validateLicense(licenseManager.getMachineId());
                            r.put("prescriptionStatus", licenseManager.getPrescriptionStatus());
                            r.put("machineId", licenseManager.getMachineId());
                            r.put("success", r.optBoolean("valid", false));
                            return r.toString();
                        } catch (Exception e) {
                            return fail(e.getMessage()).toString();
                        }
                    case "license_getMachineId":
                        try {
                            JSONObject r = new JSONObject();
                            r.put("success", true);
                            r.put("machineId", licenseManager.getMachineId());
                            return r.toString();
                        } catch (Exception e) {
                            return fail(e.getMessage()).toString();
                        }
                    case "license_canPrescribe":
                        return licenseManager.canPrescribe().toString();
                    case "license_incrementPrescription":
                        try {
                            int n = licenseManager.incrementPrescription();
                            JSONObject r = new JSONObject();
                            r.put("success", n >= 0);
                            r.put("count", n);
                            return r.toString();
                        } catch (Exception e) {
                            return fail(e.getMessage()).toString();
                        }
                    case "license_decrementPrescription":
                        try {
                            int n = licenseManager.decrementPrescription();
                            JSONObject r = new JSONObject();
                            r.put("success", n >= 0);
                            r.put("count", n);
                            return r.toString();
                        } catch (Exception e) {
                            return fail(e.getMessage()).toString();
                        }
                    case "license_getPrescriptionStatus":
                        return licenseManager.getPrescriptionStatus().toString();
                    case "license_checkFeature":
                        return licenseManager.getFeatureStatus(args.optString("feature", "")).toString();
                    case "license_activateOnline":
                        // JavascriptInterface 在 JavaBridge 线程执行，可直接网络请求
                        // ★ v3 新增：APP 端 clinicName 为只读配置，直接从本地 config.json 读取（避免 JS 层篡改）
                        String activateResult = licenseManager.activateOnline(
                                args.optString("code", ""),
                                licenseManager.getMachineId(),
                                args.optString("user", ""),
                                licenseManager.getLocalClinicName()
                        ).toString();
                        // ★ v4 新增：激活成功后 Toast 显示"已绑定 X/N 台设备"
                        try {
                            JSONObject resultObj = new JSONObject(activateResult);
                            if (resultObj.optBoolean("success", false)) {
                                JSONObject info = resultObj.optJSONObject("licenseInfo");
                                if (info != null) {
                                    int maxDev = info.optInt("maxDevices", 1);
                                    int devCount = info.optInt("devicesCount", 1);
                                    // 多设备授权时显示配额信息（单设备时不显示，保持原行为）
                                    if (maxDev > 1) {
                                        final int fd = devCount, fm = maxDev;
                                        mainHandler.post(() -> {
                                            try {
                                                android.widget.Toast.makeText(MainActivity.this,
                                                        "激活成功！已绑定 " + fd + "/" + fm + " 台设备",
                                                        android.widget.Toast.LENGTH_LONG).show();
                                            } catch (Exception e) {
                                                Log.w(TAG, "Toast 显示失败", e);
                                            }
                                        });
                                    }
                                }
                            }
                        } catch (Exception e) {
                            Log.w(TAG, "解析 activateOnline result 失败", e);
                        }
                        return activateResult;
                    case "license_restart":
                        // 重启 APP
                        mainHandler.post(() -> {
                            try {
                                Intent i = getPackageManager().getLaunchIntentForPackage(getPackageName());
                                if (i != null) {
                                    i.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_NEW_TASK);
                                    startActivity(i);
                                }
                                finishAndRemoveTask();
                            } catch (Exception e) {
                                Log.e(TAG, "重启 APP 失败", e);
                            }
                        });
                        try {
                            JSONObject r = new JSONObject();
                            r.put("success", true);
                            return r.toString();
                        } catch (Exception e) {
                            return fail(e.getMessage()).toString();
                        }
                    case "license_setTrialDays":
                        // ★ 设置试用期天数（测试用，0=立即过期，默认 7）
                        return licenseManager.setTrialDays(args.optInt("days", 7)).toString();
                    case "license_getTrialDays":
                        // ★ 获取试用期天数
                        try {
                            JSONObject r = new JSONObject();
                            r.put("success", true);
                            r.put("trialDays", licenseManager.getTrialDays());
                            return r.toString();
                        } catch (Exception e) {
                            return fail(e.getMessage()).toString();
                        }
                    default:
                        return fail("unknown method: " + name).toString();
                }
            } catch (Exception e) {
                Log.e(TAG, "invoke " + name + " 失败", e);
                return fail(e.getMessage()).toString();
            }
        }

        @JavascriptInterface
        public void quitApp() {
            mainHandler.post(() -> {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                    finishAndRemoveTask();
                } else {
                    finish();
                }
            });
        }

        @JavascriptInterface
        public void printHtml(final String html) {
            mainHandler.post(() -> {
                try {
                    WebView printView = new WebView(MainActivity.this);
                    printView.getSettings().setJavaScriptEnabled(true);
                    printView.setWebViewClient(new WebViewClient() {
                        @Override
                        public void onPageFinished(WebView v, String url) {
                            super.onPageFinished(v, url);
                            android.print.PrintManager pm = (android.print.PrintManager)
                                    getSystemService(Context.PRINT_SERVICE);
                            String jobName = "本能中医处方_" + System.currentTimeMillis();
                            android.print.PrintDocumentAdapter adapter;
                            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                                adapter = v.createPrintDocumentAdapter(jobName);
                            } else {
                                adapter = v.createPrintDocumentAdapter();
                            }
                            android.print.PrintAttributes attrs = new android.print.PrintAttributes.Builder()
                                    .setMediaSize(android.print.PrintAttributes.MediaSize.ISO_A5)
                                    .setMinMargins(android.print.PrintAttributes.Margins.NO_MARGINS)
                                    .build();
                            pm.print(jobName, adapter, attrs);
                        }
                    });
                    printView.loadDataWithBaseURL(null, html, "text/html", "UTF-8", null);
                } catch (Exception e) {
                    Log.e(TAG, "printHtml 失败", e);
                    Toast.makeText(MainActivity.this, "打印失败: " + e.getMessage(), Toast.LENGTH_LONG).show();
                }
            });
        }

        // ------------------------------------------------------------------
        // 备份文件：写入公共 Downloads/中医处方系统/ 目录
        // ------------------------------------------------------------------
        private JSONObject saveBackupFile(String jsonStr, String fileName) {
            try {
                String safeName = sanitize(fileName);
                if (safeName.isEmpty()) {
                    safeName = "backup_" + System.currentTimeMillis() + ".json";
                }

                String subDir = "中医处方系统";

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    // Android 10+：通过 MediaStore 写入公共 Downloads 目录
                    ContentValues values = new ContentValues();
                    values.put(MediaStore.Downloads.DISPLAY_NAME, safeName);
                    values.put(MediaStore.Downloads.MIME_TYPE, "application/json");
                    values.put(MediaStore.Downloads.RELATIVE_PATH,
                            Environment.DIRECTORY_DOWNLOADS + "/" + subDir + "/");
                    Uri uri = getContentResolver().insert(
                            MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                    if (uri == null) {
                        return fail("无法创建备份文件");
                    }
                    try (OutputStream os = getContentResolver().openOutputStream(uri)) {
                        if (os == null) return fail("无法打开备份文件输出流");
                        os.write(jsonStr.getBytes("UTF-8"));
                        os.flush();
                    }
                    JSONObject r = new JSONObject();
                    r.put("success", true);
                    r.put("fileName", safeName);
                    r.put("filePath", "downloads/" + subDir + "/" + safeName);
                    return r;
                } else {
                    // Android 9-：直接写入公共 Downloads 目录
                    File downloads = Environment.getExternalStoragePublicDirectory(
                            Environment.DIRECTORY_DOWNLOADS);
                    File dir = new File(downloads, subDir);
                    if (!dir.exists() && !dir.mkdirs()) {
                        dir = new File(getFilesDir(), "backups");
                        if (!dir.exists()) dir.mkdirs();
                    }
                    File file = new File(dir, safeName);
                    try (FileOutputStream fos = new FileOutputStream(file)) {
                        fos.write(jsonStr.getBytes("UTF-8"));
                        fos.flush();
                    }
                    notifyMediaScanner(file);
                    JSONObject r = new JSONObject();
                    r.put("success", true);
                    r.put("fileName", safeName);
                    r.put("filePath", "downloads/" + subDir + "/" + safeName);
                    return r;
                }
            } catch (Exception e) {
                Log.e(TAG, "saveBackupFile 失败", e);
                return fail(e.getMessage());
            }
        }

        // ------------------------------------------------------------------
        // 处方图片：写入 Pictures/本能中医处方/ 目录
        // ------------------------------------------------------------------
        private JSONObject savePrescriptionImage(String imageData, String fileName) {
            try {
                String base64 = imageData;
                if (base64.startsWith("data:image/png;base64,")) {
                    base64 = base64.substring("data:image/png;base64,".length());
                } else if (base64.startsWith("data:image/jpeg;base64,")) {
                    base64 = base64.substring("data:image/jpeg;base64,".length());
                }
                byte[] bytes = Base64.decode(base64, Base64.DEFAULT);

                String safeName = sanitize(fileName);
                if (safeName.isEmpty()) {
                    safeName = "prescription_" + System.currentTimeMillis() + ".jpg";
                }

                File dir = getImageDir();
                if (dir == null) {
                    return fail("无法创建图片目录");
                }
                // 按月份分类子目录，方便查阅（与桌面版保持一致）
                dir = new File(dir, getCurrentMonthFolder());
                if (!dir.exists() && !dir.mkdirs()) {
                    return fail("无法创建月份目录");
                }
                File file = new File(dir, safeName);
                try (FileOutputStream fos = new FileOutputStream(file)) {
                    fos.write(bytes);
                    fos.flush();
                }
                notifyMediaScanner(file);

                JSONObject r = new JSONObject();
                r.put("success", true);
                r.put("filePath", file.getAbsolutePath());
                r.put("directory", dir.getAbsolutePath());
                return r;
            } catch (Exception e) {
                Log.e(TAG, "savePrescriptionImage 失败", e);
                return fail(e.getMessage());
            }
        }

        // ------------------------------------------------------------------
        // 视频文件：写入 Pictures/本能中医处方/ 目录（与图片同目录，方便导出）
        // ------------------------------------------------------------------
        private JSONObject saveVideoFile(String base64Data, String fileName) {
            try {
                byte[] bytes = Base64.decode(base64Data, Base64.DEFAULT);

                String safeName = sanitize(fileName);
                if (safeName.isEmpty()) {
                    safeName = "video_" + System.currentTimeMillis() + ".webm";
                }
                // 保留前端传入的原始扩展名（mp4/webm），不强制改名

                File dir = getImageDir();
                if (dir == null) {
                    return fail("无法创建视频目录");
                }
                // 按月份分类子目录，方便查阅（与桌面版保持一致）
                dir = new File(dir, getCurrentMonthFolder());
                if (!dir.exists() && !dir.mkdirs()) {
                    return fail("无法创建月份目录");
                }
                File file = new File(dir, safeName);
                try (FileOutputStream fos = new FileOutputStream(file)) {
                    fos.write(bytes);
                    fos.flush();
                }
                notifyMediaScanner(file);

                JSONObject r = new JSONObject();
                r.put("success", true);
                r.put("filePath", file.getAbsolutePath());
                r.put("directory", dir.getAbsolutePath());
                r.put("fileName", safeName);
                return r;
            } catch (Exception e) {
                Log.e(TAG, "saveVideoFile 失败", e);
                return fail(e.getMessage());
            }
        }

        // ------------------------------------------------------------------
        // 分片上传（解决 Binder 事务 1MB 限制）
        // 大文件（视频、高清照片）的 base64 编码远超 1MB，无法通过单次 invoke 调用传递
        // 流程：startMediaSession → 多次 appendMediaChunk → commitMediaSession
        // 临时文件存放在 app cacheDir，commit 时迁移到目标月份目录
        // ------------------------------------------------------------------
        private final java.util.Map<String, File> mediaSessions = new java.util.concurrent.ConcurrentHashMap<>();

        private JSONObject startMediaSession(String fileName) {
            try {
                String sessionId = "media_" + System.currentTimeMillis() + "_" + (int) (Math.random() * 100000);
                String safeName = sanitize(fileName);
                if (safeName.isEmpty()) {
                    safeName = "media_" + System.currentTimeMillis();
                }
                File tempFile = new File(getCacheDir(), "upload_" + sessionId + "_" + safeName);
                if (tempFile.exists()) tempFile.delete();
                mediaSessions.put(sessionId, tempFile);
                Log.d("TCM-Pres", "startMediaSession: sessionId=" + sessionId + ", tempFile=" + tempFile.getAbsolutePath());
                JSONObject r = new JSONObject();
                r.put("success", true);
                r.put("sessionId", sessionId);
                return r;
            } catch (Exception e) {
                Log.e("TCM-Pres", "startMediaSession 失败", e);
                return fail(e.getMessage());
            }
        }

        private JSONObject appendMediaChunk(String sessionId, String chunkBase64, int index, int total) {
            try {
                File tempFile = mediaSessions.get(sessionId);
                if (tempFile == null) {
                    return fail("无效或已过期的 sessionId: " + sessionId);
                }
                byte[] bytes = Base64.decode(chunkBase64, Base64.DEFAULT);
                try (java.io.FileOutputStream fos = new java.io.FileOutputStream(tempFile, true)) {
                    fos.write(bytes);
                    fos.flush();
                }
                if (index % 10 == 0 || index == total - 1) {
                    Log.d("TCM-Pres", "appendMediaChunk: sessionId=" + sessionId + ", index=" + (index + 1) + "/" + total + ", fileSize=" + tempFile.length());
                }
                JSONObject r = new JSONObject();
                r.put("success", true);
                r.put("index", index);
                r.put("total", total);
                r.put("fileSize", tempFile.length());
                return r;
            } catch (Exception e) {
                Log.e("TCM-Pres", "appendMediaChunk 失败 (sessionId=" + sessionId + ", index=" + index + ")", e);
                File tempFile = mediaSessions.remove(sessionId);
                if (tempFile != null && tempFile.exists()) tempFile.delete();
                return fail(e.getMessage());
            }
        }

        private JSONObject commitMediaSession(String sessionId, String fileName, String type) {
            File tempFile = null;
            try {
                tempFile = mediaSessions.remove(sessionId);
                if (tempFile == null || !tempFile.exists()) {
                    return fail("会话文件不存在: " + sessionId);
                }
                Log.d("TCM-Pres", "commitMediaSession: sessionId=" + sessionId + ", type=" + type + ", tempSize=" + tempFile.length());

                File targetDir = getImageDir();
                if (targetDir == null) {
                    tempFile.delete();
                    return fail("无法创建目标目录");
                }
                targetDir = new File(targetDir, getCurrentMonthFolder());
                if (!targetDir.exists() && !targetDir.mkdirs()) {
                    tempFile.delete();
                    return fail("无法创建月份目录");
                }

                String safeName = sanitize(fileName);
                if (safeName.isEmpty()) {
                    safeName = "media_" + System.currentTimeMillis() + ("video".equals(type) ? ".webm" : ".jpg");
                }

                File targetFile = new File(targetDir, safeName);
                if (targetFile.exists()) targetFile.delete();

                if (!tempFile.renameTo(targetFile)) {
                    try (java.io.FileInputStream fis = new java.io.FileInputStream(tempFile);
                         java.io.FileOutputStream fos = new java.io.FileOutputStream(targetFile)) {
                        byte[] buffer = new byte[8192];
                        int len;
                        while ((len = fis.read(buffer)) > 0) {
                            fos.write(buffer, 0, len);
                        }
                        fos.flush();
                    }
                    tempFile.delete();
                }

                notifyMediaScanner(targetFile);
                Log.d("TCM-Pres", "commitMediaSession 成功: " + targetFile.getAbsolutePath() + ", size=" + targetFile.length());

                JSONObject r = new JSONObject();
                r.put("success", true);
                r.put("filePath", targetFile.getAbsolutePath());
                r.put("directory", targetDir.getAbsolutePath());
                r.put("fileName", safeName);
                r.put("fileSize", targetFile.length());
                return r;
            } catch (Exception e) {
                Log.e("TCM-Pres", "commitMediaSession 失败 (sessionId=" + sessionId + ")", e);
                if (tempFile != null && tempFile.exists()) tempFile.delete();
                return fail(e.getMessage());
            }
        }

        // ------------------------------------------------------------------
        // 获取视频目录路径
        // ------------------------------------------------------------------
        private JSONObject getVideoDirectory() {
            try {
                File dir = getVideoDir();
                JSONObject r = new JSONObject();
                r.put("success", true);
                r.put("directory", dir != null ? dir.getAbsolutePath() : "");
                return r;
            } catch (Exception e) {
                Log.e(TAG, "getVideoDirectory 失败", e);
                return fail(e.getMessage());
            }
        }

        // ------------------------------------------------------------------
        // 工具方法
        // ------------------------------------------------------------------
        private File getBackupDir() {
            File dir;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                dir = new File(getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), "中医处方系统");
            } else {
                File downloads = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
                dir = new File(downloads, "中医处方系统");
            }
            if (!dir.exists() && !dir.mkdirs()) {
                dir = new File(getFilesDir(), "backups");
                if (!dir.exists()) dir.mkdirs();
            }
            return dir;
        }

        private File getImageDir() {
            File dir = null;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                File external = getExternalFilesDir(Environment.DIRECTORY_PICTURES);
                if (external != null) {
                    dir = new File(external, "本能中医处方");
                }
            } else {
                File pictures = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES);
                if (pictures != null) {
                    dir = new File(pictures, "本能中医处方");
                }
            }
            if (dir == null || (!dir.exists() && !dir.mkdirs())) {
                dir = new File(getFilesDir(), "prescription_images");
                if (!dir.exists()) dir.mkdirs();
            }
            return dir;
        }

        private File getVideoDir() {
            File dir = null;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                File external = getExternalFilesDir(Environment.DIRECTORY_MOVIES);
                if (external != null) {
                    dir = new File(external, "本能中医处方");
                }
            } else {
                File movies = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_MOVIES);
                if (movies != null) {
                    dir = new File(movies, "本能中医处方");
                }
            }
            if (dir == null || (!dir.exists() && !dir.mkdirs())) {
                dir = new File(getFilesDir(), "prescription_videos");
                if (!dir.exists()) dir.mkdirs();
            }
            return dir;
        }

        // 统一路径校验：调用 Activity 级别的 isMediaPathAllowed（供NativeBridge和WebViewClient共用）
        private boolean isMediaPathAllowed(String filePath) {
            return MainActivity.this.isMediaPathAllowed(filePath);
        }

        private String getCurrentMonthFolder() {
            java.util.Calendar cal = java.util.Calendar.getInstance();
            int year = cal.get(java.util.Calendar.YEAR);
            int month = cal.get(java.util.Calendar.MONTH) + 1;
            return year + "-" + (month < 10 ? "0" + month : String.valueOf(month));
        }

        private void notifyMediaScanner(File file) {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
                android.media.MediaScannerConnection.scanFile(
                        getApplicationContext(),
                        new String[]{file.getAbsolutePath()},
                        new String[]{(file.getName().endsWith(".webm") || file.getName().endsWith(".mp4")) ? (file.getName().endsWith(".mp4") ? "video/mp4" : "video/webm") : (file.getName().endsWith(".jpg") || file.getName().endsWith(".jpeg")) ? "image/jpeg" : "image/png"},
                        null);
            }
        }

        private String sanitize(String name) {
            if (name == null) return "";
            // 与 JS sanitizeStr 保持一致：先替换非法字符为 _，再删除所有空格
            return name.replaceAll("[\\\\/:*?\"<>|]", "_").replace(" ", "").trim();
        }

        private JSONObject fail(String msg) {
            try {
                JSONObject r = new JSONObject();
                r.put("success", false);
                r.put("error", msg != null ? msg : "unknown error");
                return r;
            } catch (Exception e) {
                return new JSONObject();
            }
        }

        private JSONObject findMediaFiles(String patientName, String prescriptionNo, String createdAt) {
            try {
                JSONArray files = new JSONArray();
                java.util.Set<String> foundPaths = new java.util.HashSet<>();
                String safeName = sanitize(patientName);
                String safeNo = sanitize(prescriptionNo);
                if (safeName.isEmpty()) {
                    JSONObject result = new JSONObject();
                    result.put("success", true);
                    result.put("files", files);
                    return result;
                }
                String prefix1 = safeName + "_" + safeNo;
                String prefix2 = safeNo + "_" + safeName;
                File imgDir = getImageDir();
                File vidDir = getVideoDir();
                scanDirForMedia(imgDir, prefix1, prefix2, files, foundPaths);
                scanDirForMedia(vidDir, prefix1, prefix2, files, foundPaths);
                // 回退策略：如果按编号未找到文件，用患者姓名+创建时间范围查找
                if (files.length() == 0) {
                    long[] timeRange;
                    if (!createdAt.isEmpty()) {
                        timeRange = parseTimeRange(createdAt);
                    } else {
                        // createdAt为空，使用宽松时间范围（前后30天）
                        long now = System.currentTimeMillis();
                        timeRange = new long[]{now - 30L * 24 * 60 * 60 * 1000, now + 24 * 60 * 60 * 1000L};
                    }
                    scanDirForMediaByNameAndTime(imgDir, safeName, timeRange[0], timeRange[1], files, foundPaths);
                    scanDirForMediaByNameAndTime(vidDir, safeName, timeRange[0], timeRange[1], files, foundPaths);
                }
                StringBuilder debug = new StringBuilder();
                debug.append("prefix1=").append(prefix1).append(" prefix2=").append(prefix2);
                debug.append(" | createdAt=").append(createdAt);
                debug.append(" | imgDir=").append(imgDir != null ? imgDir.getAbsolutePath() : "null").append(" exists=").append(imgDir != null && imgDir.exists());
                debug.append(" | vidDir=").append(vidDir != null ? vidDir.getAbsolutePath() : "null").append(" exists=").append(vidDir != null && vidDir.exists());
                if (imgDir != null && imgDir.exists()) {
                    java.util.List<String> af = new java.util.ArrayList<>();
                    collectAllFiles(imgDir, af, 10);
                    debug.append(" | imgFiles: ").append(String.join(", ", af));
                }
                if (vidDir != null && vidDir.exists()) {
                    java.util.List<String> af = new java.util.ArrayList<>();
                    collectAllFiles(vidDir, af, 10);
                    debug.append(" | vidFiles: ").append(String.join(", ", af));
                }
                JSONObject result = new JSONObject();
                result.put("success", true);
                result.put("files", files);
                result.put("debug", debug.toString());
                return result;
            } catch (Exception e) {
                return fail("查找处方文件失败: " + e.getMessage());
            }
        }

        private long[] parseTimeRange(String createdAt) {
            try {
                String dateStr = createdAt.trim().replace('T', ' ');
                if (dateStr.contains(".")) dateStr = dateStr.substring(0, dateStr.indexOf('.'));
                if (dateStr.contains("Z")) dateStr = dateStr.replace("Z", "");
                java.text.SimpleDateFormat sdf = new java.text.SimpleDateFormat("yyyy-MM-dd HH:mm:ss", java.util.Locale.US);
                sdf.setTimeZone(java.util.TimeZone.getTimeZone("UTC"));
                java.util.Date date = sdf.parse(dateStr);
                long time = date.getTime();
                return new long[]{time - 24 * 60 * 60 * 1000L, time + 48 * 60 * 60 * 1000L};
            } catch (Exception e) {
                long now = System.currentTimeMillis();
                return new long[]{now - 7L * 24 * 60 * 60 * 1000, now + 7L * 24 * 60 * 60 * 1000};
            }
        }

        private void scanDirForMediaByNameAndTime(File dir, String patientName, long startTime, long endTime, JSONArray files, java.util.Set<String> foundPaths) {
            if (dir == null || !dir.exists()) return;
            File[] children = dir.listFiles();
            if (children == null) return;
            for (File f : children) {
                if (f.isDirectory()) {
                    scanDirForMediaByNameAndTime(f, patientName, startTime, endTime, files, foundPaths);
                } else {
                    String fileName = f.getName();
                    if (!fileName.contains(patientName)) continue;
                    long lastMod = f.lastModified();
                    if (lastMod < startTime || lastMod > endTime) continue;
                    String filePath = f.getAbsolutePath();
                    if (foundPaths.contains(filePath)) continue;
                    foundPaths.add(filePath);
                    try {
                        JSONObject fileObj = new JSONObject();
                        fileObj.put("name", fileName);
                        fileObj.put("path", filePath);
                        fileObj.put("type", fileName.endsWith(".webm") || fileName.endsWith(".mp4") ? "video" : "image");
                        fileObj.put("size", f.length());
                        fileObj.put("lastModified", lastMod);
                        files.put(fileObj);
                    } catch (Exception e) {
                        Log.e("TCM-Pres", "添加文件信息失败: " + fileName, e);
                    }
                }
            }
        }

        private void scanDirForMedia(File dir, String prefix1, String prefix2, JSONArray files, java.util.Set<String> foundPaths) {
            if (dir == null || !dir.exists()) return;
            File[] children = dir.listFiles();
            if (children == null) return;
            for (File f : children) {
                if (f.isDirectory()) {
                    scanDirForMedia(f, prefix1, prefix2, files, foundPaths);
                } else if (f.getName().contains(prefix1) || f.getName().contains(prefix2)) {
                    String path = f.getAbsolutePath();
                    if (foundPaths.contains(path)) continue;
                    foundPaths.add(path);
                    try {
                        JSONObject fileObj = new JSONObject();
                        fileObj.put("name", f.getName());
                        fileObj.put("path", path);
                        fileObj.put("type", f.getName().endsWith(".webm") || f.getName().endsWith(".mp4") ? "video" : "image");
                        fileObj.put("size", f.length());
                        fileObj.put("lastModified", f.lastModified());
                        files.put(fileObj);
                    } catch (Exception e) {
                        Log.e(TAG, "添加文件信息失败: " + f.getName(), e);
                    }
                }
            }
        }

        private void collectAllFiles(File dir, java.util.List<String> files, int max) {
            if (dir == null || !dir.exists() || files.size() >= max) return;
            File[] children = dir.listFiles();
            if (children == null) return;
            for (File f : children) {
                if (files.size() >= max) return;
                if (f.isDirectory()) {
                    collectAllFiles(f, files, max);
                } else {
                    files.add(f.getName());
                }
            }
        }

        private JSONObject openFile(String filePath, String mimeType) {
            try {
                if (!isMediaPathAllowed(filePath)) {
                    return fail("路径不在允许的目录内");
                }
                File file = new File(filePath);
                if (!file.exists()) {
                    return fail("文件不存在: " + filePath);
                }
                if (mimeType == null || mimeType.isEmpty()) {
                    if (filePath.endsWith(".webm")) mimeType = "video/webm";
                    else if (filePath.endsWith(".mp4")) mimeType = "video/mp4";
                    else if (filePath.endsWith(".png")) mimeType = "image/png";
                    else if (filePath.endsWith(".jpg") || filePath.endsWith(".jpeg")) mimeType = "image/jpeg";
                    else mimeType = "*/*";
                }
                Uri uri = FileProvider.getUriForFile(MainActivity.this,
                        getPackageName() + ".fileprovider", file);
                Intent intent = new Intent(Intent.ACTION_VIEW);
                intent.setDataAndType(uri, mimeType);
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(intent);
                JSONObject result = new JSONObject();
                result.put("success", true);
                return result;
            } catch (Exception e) {
                return fail("打开文件失败: " + e.getMessage());
            }
        }

        private JSONObject readFileAsBase64(String filePath) {
            try {
                File file = new File(filePath);
                if (!file.exists()) {
                    return fail("文件不存在: " + filePath);
                }
                // 路径白名单校验（内部安全，不再依赖 isCallerAllowed）
                // 彻底解决 WebView URL 短暂变化时回退分支被误拦截导致"加载失败"
                if (!isMediaPathAllowed(filePath)) {
                    return fail("路径不在允许的目录内");
                }
                java.io.FileInputStream fis = new java.io.FileInputStream(file);
                java.io.ByteArrayOutputStream baos = new java.io.ByteArrayOutputStream();
                byte[] buffer = new byte[8192];
                int len;
                while ((len = fis.read(buffer)) > 0) {
                    baos.write(buffer, 0, len);
                }
                fis.close();
                byte[] bytes = baos.toByteArray();
                String base64 = Base64.encodeToString(bytes, Base64.NO_WRAP);
                String mimeType;
                if (filePath.endsWith(".webm")) mimeType = "video/webm";
                else if (filePath.endsWith(".mp4")) mimeType = "video/mp4";
                else if (filePath.endsWith(".png")) mimeType = "image/png";
                else if (filePath.endsWith(".jpg") || filePath.endsWith(".jpeg")) mimeType = "image/jpeg";
                else mimeType = "application/octet-stream";
                JSONObject result = new JSONObject();
                result.put("success", true);
                result.put("data", "data:" + mimeType + ";base64," + base64);
                return result;
            } catch (Exception e) {
                return fail("读取文件失败: " + e.getMessage());
            }
        }

        // ------------------------------------------------------------------
        // 分片读取（解决 Binder 事务 1MB 限制）
        // 大文件读取时返回的 base64 字符串远超 1MB，必须分片读取
        // 流程：startReadSession → 多次 readNextChunk → closeReadSession
        // 用 session 维护 FileInputStream 和已读位置，每片 256KB 原始字节
        // ------------------------------------------------------------------
        private static class ReadSession {
            java.io.FileInputStream fis;
            long fileSize;
            long readOffset;
            String mimeType;
        }
        private final java.util.Map<String, ReadSession> readSessions = new java.util.concurrent.ConcurrentHashMap<>();

        private JSONObject startReadSession(String filePath) {
            ReadSession rs = new ReadSession();
            try {
                File file = new File(filePath);
                if (!file.exists()) {
                    return fail("文件不存在: " + filePath);
                }
                // 路径白名单校验：使用预缓存的白名单（避免运行时 I/O 不稳定）
                if (!isMediaPathAllowed(filePath)) {
                    return fail("路径不在允许的目录内");
                }

                rs.fis = new java.io.FileInputStream(file);
                rs.fileSize = file.length();
                rs.readOffset = 0;
                if (filePath.endsWith(".webm")) rs.mimeType = "video/webm";
                else if (filePath.endsWith(".mp4")) rs.mimeType = "video/mp4";
                else if (filePath.endsWith(".png")) rs.mimeType = "image/png";
                else if (filePath.endsWith(".jpg") || filePath.endsWith(".jpeg")) rs.mimeType = "image/jpeg";
                else rs.mimeType = "application/octet-stream";

                String sessionId = "read_" + System.currentTimeMillis() + "_" + (int) (Math.random() * 100000);
                readSessions.put(sessionId, rs);
                Log.d("TCM-Pres", "startReadSession: sessionId=" + sessionId + ", fileSize=" + rs.fileSize + ", mime=" + rs.mimeType);
                JSONObject r = new JSONObject();
                r.put("success", true);
                r.put("sessionId", sessionId);
                r.put("fileSize", rs.fileSize);
                r.put("mimeType", rs.mimeType);
                return r;
            } catch (Exception e) {
                try { if (rs.fis != null) rs.fis.close(); } catch (Exception ignored) {}
                return fail("启动读取会话失败: " + e.getMessage());
            }
        }

        private JSONObject readNextChunk(String sessionId) {
            ReadSession rs = readSessions.get(sessionId);
            if (rs == null || rs.fis == null) {
                return fail("无效或已关闭的读取会话: " + sessionId);
            }
            try {
                int chunkLen = 256 * 1024;
                byte[] buffer = new byte[chunkLen];
                int totalRead = 0;
                int retry = 0;
                // 处理部分读取和 read==0 边缘情况，最多重试 3 次
                // 彻底解决网络挂载存储或 FUSE 文件系统的读取不稳定问题
                while (totalRead < chunkLen && retry < 3) {
                    int read = rs.fis.read(buffer, totalRead, chunkLen - totalRead);
                    if (read < 0) break;  // EOF
                    if (read == 0) {
                        retry++;
                        try { Thread.sleep(10); } catch (InterruptedException ie) { break; }
                        continue;
                    }
                    totalRead += read;
                    // 已到文件末尾，不再继续读
                    if (rs.readOffset + totalRead >= rs.fileSize) break;
                }
                if (totalRead == 0) {
                    // EOF 或无数据可读
                    JSONObject r = new JSONObject();
                    r.put("success", true);
                    r.put("chunk", "");
                    r.put("read", 0);
                    r.put("eof", true);
                    r.put("offset", rs.readOffset);
                    r.put("total", rs.fileSize);
                    return r;
                }
                byte[] actual;
                if (totalRead == chunkLen) {
                    actual = buffer;
                } else {
                    actual = new byte[totalRead];
                    System.arraycopy(buffer, 0, actual, 0, totalRead);
                }
                String chunkBase64 = Base64.encodeToString(actual, Base64.NO_WRAP);
                rs.readOffset += totalRead;
                boolean eof = rs.readOffset >= rs.fileSize;
                JSONObject r = new JSONObject();
                r.put("success", true);
                r.put("chunk", chunkBase64);
                r.put("read", totalRead);
                r.put("eof", eof);
                r.put("offset", rs.readOffset);
                r.put("total", rs.fileSize);
                return r;
            } catch (Exception e) {
                Log.e("TCM-Pres", "readNextChunk 失败 (sessionId=" + sessionId + ")", e);
                // 不主动 closeReadSession，让 JS 端的 closeReadSession 调用来清理
                return fail("读取分片失败: " + e.getMessage());
            }
        }

        private JSONObject closeReadSession(String sessionId) {
            ReadSession rs = readSessions.remove(sessionId);
            if (rs != null) {
                try { rs.fis.close(); } catch (Exception ignored) {}
                Log.d("TCM-Pres", "closeReadSession: sessionId=" + sessionId + ", readOffset=" + rs.readOffset + "/" + rs.fileSize);
            }
            try {
                JSONObject r = new JSONObject();
                r.put("success", true);
                return r;
            } catch (Exception e) {
                return fail(e.getMessage());
            }
        }

        private JSONObject renameMediaFiles(String patientName, String oldNo, String newNo) {
            try {
                String safeName = sanitize(patientName);
                String safeOldNo = sanitize(oldNo);
                String safeNewNo = sanitize(newNo);
                if (safeName.isEmpty() || safeOldNo.isEmpty() || safeNewNo.isEmpty()) {
                    return fail("参数不完整");
                }
                if (safeOldNo.equals(safeNewNo)) {
                    JSONObject result = new JSONObject();
                    result.put("success", true);
                    result.put("renamed", 0);
                    result.put("message", "编号相同，无需重命名");
                    return result;
                }
                String oldPrefix = safeName + "_" + safeOldNo;
                String newPrefix = safeName + "_" + safeNewNo;
                JSONArray renamedFiles = new JSONArray();
                int renamed = 0;
                renamed += renameFilesInDir(getImageDir(), oldPrefix, newPrefix, renamedFiles);
                renamed += renameFilesInDir(getVideoDir(), oldPrefix, newPrefix, renamedFiles);
                JSONObject result = new JSONObject();
                result.put("success", true);
                result.put("renamed", renamed);
                result.put("files", renamedFiles);
                return result;
            } catch (Exception e) {
                return fail("重命名文件失败: " + e.getMessage());
            }
        }

        private int renameFilesInDir(File dir, String oldPrefix, String newPrefix, JSONArray renamedFiles) {
            if (dir == null || !dir.exists()) return 0;
            int count = 0;
            File[] children = dir.listFiles();
            if (children == null) return 0;
            for (File f : children) {
                if (f.isDirectory()) {
                    count += renameFilesInDir(f, oldPrefix, newPrefix, renamedFiles);
                } else {
                    String name = f.getName();
                    if (name.contains(oldPrefix)) {
                        String newName = name.replace(oldPrefix, newPrefix);
                        File newFile = new File(f.getParent(), newName);
                        if (f.renameTo(newFile)) {
                            count++;
                            try {
                                JSONObject fileObj = new JSONObject();
                                fileObj.put("oldName", name);
                                fileObj.put("newName", newName);
                                fileObj.put("path", newFile.getAbsolutePath());
                                renamedFiles.put(fileObj);
                            } catch (Exception e) {
                                Log.e(TAG, "记录重命名信息失败", e);
                            }
                        }
                    }
                }
            }
            return count;
        }
    }
}
