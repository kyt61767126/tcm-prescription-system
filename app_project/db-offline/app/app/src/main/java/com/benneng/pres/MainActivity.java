package com.benneng.pres;

import android.Manifest;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.provider.MediaStore;
import android.util.Base64;
import android.util.Log;
import android.view.View;
import android.view.Window;
import android.view.ViewGroup;
import android.webkit.JavascriptInterface;
import android.webkit.JsPromptResult;
import android.webkit.JsResult;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;
import android.widget.Toast;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;

import com.getcapacitor.BridgeActivity;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;

public class MainActivity extends BridgeActivity {

    // ============ 常量配置 ============
    private static final String TAG = "TCM_Prescription";
    // 离线APP：本地 assets 页面路径
    private static final String LOCAL_ASSET_URL = "file:///android_asset/public/index.html";
    private static final int REQ_CAMERA = 1003;
    private static final int REQ_STORAGE = 1001;
    // ★ WebView 就绪轮询（参考云端APP）：BridgeActivity 初始化时 WebView 可能未就绪
    private static final int MAX_WEBVIEW_READY_RETRIES = 30;
    private static final int WEBVIEW_READY_INTERVAL_MS = 100;
    private int webViewReadyRetries = 0;

    private Handler mainHandler;
    private volatile String cachedVideoRecorderScript = null;
    private boolean hasDoneFirstResume = false;
    // ★ 修复 2026-07-27：NativeBridge 实例引用，用于 onDestroy 时清理会话资源
    private NativeBridge nativeBridge = null;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // ★ 全局崩溃捕获：任何未捕获异常写入 crash_logs 目录，便于排查闪退原因
        Thread.setDefaultUncaughtExceptionHandler(new Thread.UncaughtExceptionHandler() {
            @Override
            public void uncaughtException(Thread t, Throwable e) {
                try {
                    Log.e(TAG, "★★★ 未捕获异常导致崩溃 ★★★", e);
                    File crashDir = new File(getFilesDir(), "crash_logs");
                    if (!crashDir.exists()) crashDir.mkdirs();
                    File crashFile = new File(crashDir, "crash_" + System.currentTimeMillis() + ".txt");
                    java.io.PrintWriter pw = new java.io.PrintWriter(new java.io.FileWriter(crashFile));
                    pw.println("时间: " + new java.util.Date());
                    pw.println("线程: " + t.getName());
                    String ver = "";
                    try { ver = getPackageManager().getPackageInfo(getPackageName(), 0).versionName; } catch (Exception ignored2) {}
                    pw.println("APP版本: " + ver);
                    pw.println("设备: " + Build.MODEL + " / " + Build.MANUFACTURER);
                    pw.println("Android: " + Build.VERSION.RELEASE + " (SDK " + Build.VERSION.SDK_INT + ")");
                    pw.println("========== 堆栈 ==========");
                    e.printStackTrace(pw);
                    pw.close();
                } catch (Exception ignored) {}
                android.os.Process.killProcess(android.os.Process.myPid());
            }
        });

        // 只隐藏标题栏，不使用FLAG_FULLSCREEN（会导致内容延伸到状态栏下面）
        requestWindowFeature(Window.FEATURE_NO_TITLE);

        super.onCreate(savedInstanceState);

        // T5: 使用主线程 Looper 的 Handler，便于 onDestroy 统一清理
        mainHandler = new Handler(Looper.getMainLooper());

        // ★ 安全检测（参考云端APP SecurityGuard）：root/调试器/签名/Frida/Xposed/模拟器
        // 异步执行避免阻塞启动，检测到威胁时 Toast 提示并退出
        mainHandler.post(() -> SecurityGuard.checkAndExit(this));

        // ★ P1-8 多层校验 Layer 2：Android 原生 License 启动校验
        // 在 WebView 加载前由 Java 层独立校验 license 有效性（试用过期/license 篡改/绑定不符等）
        // 与 JS 层 checkLicenseAndShowActivate 形成双保险
        if (!performNativeStartupLicenseCheck()) {
            return;
        }

        // Android 6.0+ 动态申请相机和麦克风权限（录像拍照功能需要）
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA)
                    != PackageManager.PERMISSION_GRANTED ||
                ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
                    != PackageManager.PERMISSION_GRANTED) {
                ActivityCompat.requestPermissions(this,
                        new String[]{Manifest.permission.CAMERA, Manifest.permission.RECORD_AUDIO}, REQ_CAMERA);
            }
        }

        // Android 9 及以下需要 WRITE_EXTERNAL_STORAGE 权限保存文件
        if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.P) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.WRITE_EXTERNAL_STORAGE)
                    != PackageManager.PERMISSION_GRANTED) {
                ActivityCompat.requestPermissions(this,
                        new String[]{Manifest.permission.WRITE_EXTERNAL_STORAGE}, REQ_STORAGE);
            }
        }

        // 立即配置 WebView，不延迟，加快启动速度
        configureWebView();

        // ★ 修复 2026-07-27：清理上次启动遗留的 upload_*临时文件（用户可能未 commit 就退出）
        // 在后台线程执行避免阻塞启动
        new Thread(this::cleanupStaleTempFiles, "cleanup-temp").start();

        // 后台预加载录像拍照脚本（避免 onPageFinished 时同步IO阻塞UI）
        preloadVideoRecorderScript();

        // ★ 离线APP：加载本地 assets 页面（带就绪轮询，参考云端APP）
        loadLocalAssetWithRetry();
    }

    // ★ P1-8 多层校验 Layer 2：Android 原生启动 License 校验
    // 在 WebView 加载前由 Java 层独立校验，与 JS 层（auth-core.js checkLicenseAndShowActivate）形成双保险
    // 即使攻击者 hook JS 层绕过校验，Java 层仍会拦截
    // 返回 true=允许启动，false=已弹窗并阻止启动
    private boolean performNativeStartupLicenseCheck() {
        try {
            LicenseManager lm = new LicenseManager(this);
            String machineId = lm.getMachineId();
            JSONObject result = lm.validateLicense(machineId);
            if (result == null) {
                Log.w(TAG, "[StartupCheck] validateLicense 返回 null，跳过原生校验");
                return true;
            }
            boolean valid = result.optBoolean("valid", false);
            if (valid) {
                Log.i(TAG, "[StartupCheck] 授权有效，允许启动：type=" + result.optString("type", ""));
                // ★ P1-9 代码完整性校验：检测 auth-core.js / license-manager.js 是否被篡改
                if (!lm.verifyJsIntegrity()) {
                    showFatalLicenseErrorAndExit("检测到关键代码文件已被篡改，软件无法启动。\n请从官方渠道重新下载安装。");
                    return false;
                }
                return true;
            }
            String reason = result.optString("type", "unknown");
            String message = result.optString("message", "授权校验失败，应用无法启动");
            Log.e(TAG, "[StartupCheck] 授权校验失败：type=" + reason + " msg=" + message);
            showFatalLicenseErrorAndExit(message);
            return false;
        } catch (Exception e) {
            // ★安全优化：原生校验异常时阻止启动（原为降级到JS层校验，存在安全风险）
            Log.e(TAG, "[StartupCheck] 原生校验异常（阻止启动）", e);
            showFatalLicenseErrorAndExit("软件校验异常，请重新安装或联系客服。");
            return false;
        }
    }

    // 显示致命 License 错误对话框并退出 APP
    private void showFatalLicenseErrorAndExit(String message) {
        mainHandler.post(() -> {
            try {
                new androidx.appcompat.app.AlertDialog.Builder(this)
                        .setTitle("授权校验失败")
                        .setMessage(message)
                        .setCancelable(false)
                        .setPositiveButton("退出", (d, w) -> {
                            finishAffinity();
                            android.os.Process.killProcess(android.os.Process.myPid());
                        })
                        .show();
            } catch (Exception e) {
                Log.e(TAG, "[StartupCheck] 显示错误对话框失败", e);
                finishAffinity();
                android.os.Process.killProcess(android.os.Process.myPid());
            }
        });
    }

    /**
     * ★ 修复 2026-07-27：清理 cacheDir 中的 upload_*临时文件
     * 上次启动时用户可能在 startMediaSession 后未 commit 就退出，临时文件会一直占用 cacheDir
     * 启动时清理避免 cacheDir 无限增长
     */
    private void cleanupStaleTempFiles() {
        try {
            File cacheDir = getCacheDir();
            File[] files = cacheDir.listFiles();
            if (files == null) return;
            int cleaned = 0;
            for (File f : files) {
                String name = f.getName();
                // 仅清理 mediaSession 的临时文件（upload_ 前缀），不清理其他缓存
                if (name.startsWith("upload_")) {
                    if (f.delete()) {
                        cleaned++;
                    }
                }
            }
            if (cleaned > 0) {
                Log.d(TAG, "清理上次启动遗留临时文件: " + cleaned + " 个");
            }
        } catch (Exception e) {
            Log.w(TAG, "清理临时文件失败（非致命）: " + e.getMessage());
        }
    }

    /**
     * 加载本地 assets 页面（带 WebView 就绪轮询）
     * 参考云端APP MainActivity：BridgeActivity 初始化时 WebView 可能未就绪
     * 最多重试 30 次 ×100ms = 3秒，避免白屏
     */
    private void loadLocalAssetWithRetry() {
        WebView webView = this.getBridge().getWebView();
        if (webView != null) {
            webView.loadUrl(LOCAL_ASSET_URL);
            return;
        }
        if (webViewReadyRetries < MAX_WEBVIEW_READY_RETRIES) {
            webViewReadyRetries++;
            Log.w(TAG, "WebView 未就绪，重试 " + webViewReadyRetries + "/" + MAX_WEBVIEW_READY_RETRIES);
            mainHandler.postDelayed(this::loadLocalAssetWithRetry, WEBVIEW_READY_INTERVAL_MS);
        } else {
            Log.e(TAG, "WebView 就绪轮询失败，无法加载本地页面");
        }
    }

    private void configureWebView() {
        WebView webView = this.getBridge().getWebView();
        if (webView == null) {
            Log.e(TAG, "configureWebView: WebView 为 null");
            return;
        }

        // ★ 适配状态栏（解决 Android 16 edge-to-edge 强制模式）
        // Capacitor BridgeActivity 内部管理 WebView 布局，但 Android 15+ targetSdk=36
        // 强制 edge-to-edge，WebView 内容会延伸到状态栏下方。
        // 通过 WindowInsetsListener + 资源 ID 双保险设置 WebView 顶部 padding。
        final int statusBarHeight = getStatusBarHeightPx();
        webView.setPadding(0, statusBarHeight, 0, 0);
        ViewCompat.setOnApplyWindowInsetsListener(webView, (v, insets) -> {
            Insets systemBars = insets.getInsets(WindowInsetsCompat.Type.systemBars());
            Insets cutout = insets.getInsets(WindowInsetsCompat.Type.displayCutout());
            int insetTop = Math.max(systemBars.top, cutout.top);
            int finalTop = Math.max(insetTop, statusBarHeight);
            if (v.getPaddingTop() != finalTop) {
                v.setPadding(0, finalTop, 0, 0);
            }
            return insets;
        });
        ViewCompat.requestApplyInsets(webView);

        WebSettings settings = webView.getSettings();

        // 离线APP：不使用缓存，每次从本地 assets 加载
        settings.setCacheMode(WebSettings.LOAD_NO_CACHE);
        // 启用硬件加速，提升页面渲染性能
        webView.setLayerType(View.LAYER_TYPE_HARDWARE, null);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        settings.setJavaScriptEnabled(true);

        // ★ 离线APP：允许访问本地文件系统（file:// URL 加载本地页面和资源）
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        // ★ P2 安全修复：禁止 JS 通过 file:// URL 读取本地文件（与 android 版对齐）
        // Capacitor 使用 https://localhost 协议加载资源，不依赖 file:// 协议
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(true);
        // 允许混合内容（离线页面可能需要加载 http 资源）
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        settings.setTextZoom(100);

        // ★ 禁用表单自动填充（防止 Android Autofill 弹出凭据提示）
        settings.setSaveFormData(false);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            webView.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_NO);
            disableAutofillRecursive(webView);
            // 拦截 Autofill 服务的所有未完成请求（系统级，最强防线）
            try {
                android.view.autofill.AutofillManager afm = (android.view.autofill.AutofillManager) getSystemService(android.view.autofill.AutofillManager.class);
                if (afm != null) {
                    afm.cancel();
                }
            } catch (Throwable ignored) {}
        }

        webView.clearHistory();

        // 设置WebChromeClient，确保prompt/alert/confirm弹框正常工作
        webView.setWebChromeClient(new WebChromeClient() {
            // 授权摄像头和麦克风权限（录像拍照功能需要）
            // ★ 参考云端APP：校验 request.getOrigin() 必须为本地 file:// 资源
            // ★ 修复 2026-07-27：精细化 grant，只授予 VIDEO/AUDIO 权限，不授予其他资源
            //   原代码 request.grant(request.getResources()) 会授予请求中的全部资源，
            //   如果将来 WebView 请求了新的敏感资源（如地理位置），也会被自动授予
            @Override
            public void onPermissionRequest(PermissionRequest request) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                    // 来源校验：仅允许本地 file:// 页面请求摄像头/麦克风
                    String origin = request.getOrigin() != null ? request.getOrigin().toString() : null;
                    if (origin == null || !origin.startsWith("file://")) {
                        Log.w(TAG, "onPermissionRequest 拒绝非本地来源: " + origin);
                        request.deny();
                        return;
                    }
                    // ★ 修复：收集请求中实际属于 VIDEO/AUDIO 的资源，只 grant 这些
                    java.util.List<String> allowed = new java.util.ArrayList<>();
                    for (String permission : request.getResources()) {
                        if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(permission) ||
                            PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(permission)) {
                            allowed.add(permission);
                        }
                    }
                    if (allowed.isEmpty()) {
                        Log.w(TAG, "onPermissionRequest 无 VIDEO/AUDIO 资源，拒绝");
                        request.deny();
                    } else {
                        request.grant(allowed.toArray(new String[0]));
                    }
                }
            }

            @Override
            public boolean onJsPrompt(WebView view, String url, String message, String defaultValue, JsPromptResult result) {
                // 创建输入框，显示默认值（原账户信息）
                final EditText input = new EditText(view.getContext());
                input.setLayoutParams(new ViewGroup.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.WRAP_CONTENT
                ));
                if (defaultValue != null && !defaultValue.isEmpty()) {
                    input.setText(defaultValue);
                    // 选中所有文本，方便用户直接修改
                    input.selectAll();
                }

                // 显示带输入框的弹框
                new android.app.AlertDialog.Builder(view.getContext())
                    .setTitle("提示")
                    .setMessage(message)
                    .setView(input)
                    .setPositiveButton("确定", (dialog, which) -> {
                        String value = input.getText().toString();
                        result.confirm(value);
                    })
                    .setNegativeButton("取消", (dialog, which) -> result.cancel())
                    .setOnCancelListener(dialog -> result.cancel())
                    .show();
                return true;
            }

            @Override
            public boolean onJsAlert(WebView view, String url, String message, JsResult result) {
                new android.app.AlertDialog.Builder(view.getContext())
                    .setTitle("提示")
                    .setMessage(message)
                    .setPositiveButton("确定", (dialog, which) -> result.confirm())
                    .setOnCancelListener(dialog -> result.cancel())
                    .show();
                return true;
            }

            @Override
            public boolean onJsConfirm(WebView view, String url, String message, JsResult result) {
                new android.app.AlertDialog.Builder(view.getContext())
                    .setTitle("提示")
                    .setMessage(message)
                    .setPositiveButton("确定", (dialog, which) -> result.confirm())
                    .setNegativeButton("取消", (dialog, which) -> result.cancel())
                    .setOnCancelListener(dialog -> result.cancel())
                    .show();
                return true;
            }
        });

        // 添加 JavaScript 接口，供网页调用退出 APP（点击"退出"按钮时直接返回手机主屏）
        webView.addJavascriptInterface(new Object() {
            @android.webkit.JavascriptInterface
            public void exit() {
                // 必须在主线程执行，且用 finishAndRemoveTask 确保真正退出到桌面
                // postAtFrontOfQueue 插入队列最前面，比 runOnUiThread 更快
                // ★ 修复 2026-07-28：追加 System.exit(0) 杀死进程，确保下次启动是全新进程
                //   仅 finishAndRemoveTask() 不杀进程，Android 可能保留进程在后台，
                //   用户再次点击图标时只是恢复旧任务，WebView 状态保留导致跳过登录界面
                mainHandler.postAtFrontOfQueue(() -> {
                    finishAndRemoveTask();
                    System.exit(0);
                });
            }
        }, "AndroidAppExit");

        // 注入 NativeBridge：提供 savePrescriptionImage/saveVideoFile 等原生保存能力
        // 录像拍照功能通过此桥接将文件保存到本地文件系统（按月份分类 YYYY-MM）
        // 注意：nativeBridge 对象由 NativeBridgePlugin（Capacitor插件）自动注册，
        //       此处注册的 AndroidNative 提供更完整的 invoke 分发能力（供 video-recorder-inject.js 使用）
        // ★ 修复 2026-07-27：保存 NativeBridge 实例引用，onDestroy 时清理会话资源
        nativeBridge = new NativeBridge();
        webView.addJavascriptInterface(nativeBridge, "AndroidNative");

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                // ★ 参考云端APP严格校验：仅允许本地 file:// + path 前缀 /android_asset/
                // 防止 file://attacker.com/payload 这类伪 URL 绕过
                android.net.Uri uri = request.getUrl();
                String scheme = uri.getScheme();
                String path = uri.getPath();
                if ("file".equals(scheme) && path != null && path.startsWith("/android_asset/")) {
                    return false; // 允许加载本地 assets
                }
                if ("content".equals(scheme)) {
                    return false; // 允许 ContentProvider
                }
                // ★ 一键联系微信客服：放行 weixin:// 协议，尝试唤起微信客户端
                // 安全策略：仅 weixin:// 单一 scheme 白名单，Intent 由系统解析（无微信则静默失败，不影响 APP）
                if ("weixin".equals(scheme)) {
                    try {
                        startActivity(new android.content.Intent(android.content.Intent.ACTION_VIEW, android.net.Uri.parse("weixin://")));
                    } catch (Exception e) {
                        android.util.Log.w("MainActivity", "weixin:// 唤起微信失败（未安装？）: " + e.getMessage());
                    }
                    return true;
                }
                return true; // 拦截外部导航
            }

            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) {
                super.onPageStarted(view, url, favicon);
                // 提前注入 anti-autofill（虽然 DOM 可能未加载完，但 evaluateJavascript 会排队执行）
                injectAutocompleteOff(view);
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                int statusBarHeightPx = getStatusBarHeightPx();
                float density = getResources().getDisplayMetrics().density;
                int cssPx = (int) (statusBarHeightPx / density);
                view.evaluateJavascript("window.__STATUS_BAR_HEIGHT__ = " + cssPx + ";", null);
                injectAutocompleteOff(view);

                // ★ 注入 electronAPI 桥接（离线APP特有：license/login/print 等方法）
                // video-recorder-inject.js 加载后会在此基础上增强（分片上传、录像拍照）
                mainHandler.post(() -> injectElectronApiShim(view));

                // ★ 注入键盘适配（状态栏已由 WebView setPadding 处理，不再注入 statusBarFix）
                mainHandler.post(() -> injectKeyboardAdapter(view));

                // 布局修复脚本立即注入（体积小，影响UI布局）
                mainHandler.post(() -> injectLayoutFixScript(view));

                // 录像拍照脚本延迟到页面渲染稳定后注入（避免40KB脚本同步执行阻塞UI）
                // 300ms 是经验值：足够 React 完成首屏渲染，又不至于让用户感觉录像功能迟钝
                mainHandler.postDelayed(() -> injectVideoRecorderScript(view), 300);
            }

            // ★ 参考云端APP：SSL 证书错误直接取消，防止中间人攻击
            @Override
            public void onReceivedSslError(WebView view, android.webkit.SslErrorHandler handler, android.net.http.SslError error) {
                handler.cancel();
            }

            // 网络错误处理，避免白屏
            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                super.onReceivedError(view, request, error);
                // 只处理主框架错误，子资源错误不影响页面整体展示
                if (request.isForMainFrame()) {
                    showErrorPage(view);
                }
            }

            @Override
            public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
                super.onReceivedHttpError(view, request, response);
                // 主框架 5xx 错误显示错误页
                if (request.isForMainFrame() && response.getStatusCode() >= 500) {
                    showErrorPage(view);
                }
            }
        });
    }

    /**
     * 显示本地错误页（页面加载失败时避免白屏）
     */
    private void showErrorPage(WebView webView) {
        String errorHtml = "<!DOCTYPE html><html><head><meta charset='UTF-8'>" +
            "<meta name='viewport' content='width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no'>" +
            "<style>" +
            "  body { font-family: -apple-system, sans-serif; text-align: center; padding: 60px 24px; background: #f9fafb; color: #374151; }" +
            "  h2 { font-size: 20px; margin-bottom: 12px; color: #111827; }" +
            "  p { font-size: 14px; color: #6b7280; margin-bottom: 24px; line-height: 1.6; }" +
            "  button { padding: 12px 28px; font-size: 15px; background: #2563eb; color: #fff; " +
            "    border: none; border-radius: 6px; -webkit-tap-highlight-color: transparent; }" +
            "  button:active { background: #1d4ed8; }" +
            "</style></head><body>" +
            "<h2>页面加载失败</h2>" +
            "<p>无法加载本地页面，请重试</p>" +
            "<button onclick=\"location.href='" + LOCAL_ASSET_URL + "'\">重新加载</button>" +
            "</body></html>";
        webView.loadDataWithBaseURL(LOCAL_ASSET_URL, errorHtml, "text/html", "UTF-8", null);
    }

    /**
     * dp 转 px
     */
    private int dpToPx(int dp) {
        float density = getResources().getDisplayMetrics().density;
        return (int) (dp * density + 0.5f);
    }

    /**
     * NativeBridge 调用来源校验，仅允许本地 file:// 页面调用
     * 防止 XSS 注入页面或第三方页面调用 readFileAsBase64 读取沙箱任意文件
     */
    private boolean isCallerAllowed() {
        try {
            WebView webView = this.getBridge().getWebView();
            if (webView == null) return false;
            String url = webView.getUrl();
            if (url == null) return false;
            // 允许 file:// (离线assets) 和 https://localhost (Capacitor内部URL)
            return url.startsWith("file://") || url.startsWith("https://localhost") || url.startsWith("http://localhost");
        } catch (Exception e) {
            return false;
        }
    }

    /**
     * 获取状态栏高度（px）
     */
    private int getStatusBarHeightPx() {
        int result = 0;
        int resourceId = getResources().getIdentifier("status_bar_height", "dimen", "android");
        if (resourceId > 0) {
            result = getResources().getDimensionPixelSize(resourceId);
        }
        return result;
    }

    /**
     * ★ 注入 electronAPI 桥接（离线APP特有）
     * 将 window.electronAPI 的方法代理到 nativeBridge（由 NativeBridgePlugin 通过
     * addJavascriptInterface 注入的对象），使原本为 Electron 设计的网页能在
     * Android 离线环境中运行。
     *
     * 注意：本方法注入的是基础版本，video-recorder-inject.js 加载后会覆盖为更完整的版本
     * （包含分片上传、录像拍照 overlay 等），并提供基于 AndroidNative.invoke 的会话方法。
     */
    private void injectElectronApiShim(WebView webView) {
        String js = "(function(){" +
            "  if (window.electronAPI && window.electronAPI.__nativeBridgeProxy) return;" +
            "  function callNative(name, args) {" +
            "    try { return AndroidNative.invoke(name, JSON.stringify(args)); }" +
            "    catch(e){ return JSON.stringify({success:false,error:String(e)}); }" +
            "  }" +
            "  function callNativeAsync(name, args) {" +
            "    return new Promise(function(resolve, reject) {" +
            "      try {" +
            "        var r = callNative(name, args);" +
            "        var obj = JSON.parse(r);" +
            "        resolve(obj);" +
            "      } catch(e) { reject(e); }" +
            "    });" +
            "  }" +
            "  window.electronAPI = {" +
            "    __nativeBridgeProxy: true," +
            "    isElectron: true," +
            "    isAndroidAPP: true," +
            "    saveUserData: function(key, data) { return new Promise(function(resolve){ try { localStorage.setItem(key, JSON.stringify(data)); resolve(true); } catch(e){ resolve(false); } }); }," +
            "    getUserData: function(key) { return new Promise(function(resolve){ try { var v = localStorage.getItem(key); resolve(v ? JSON.parse(v) : null); } catch(e){ resolve(null); } }); }," +
            "    loginSuccess: function(user) { return new Promise(function(resolve){ try { localStorage.setItem('currentUser', JSON.stringify(user)); resolve(true); } catch(e){ resolve(false); } }); }," +
            "    getCurrentUser: function() { return new Promise(function(resolve){ try { var v = localStorage.getItem('currentUser'); resolve(v ? JSON.parse(v) : null); } catch(e){ resolve(null); } }); }," +
            "    saveBackupFile: function(filename, content) { return callNativeAsync('saveBackupFile', {jsonStr: content, fileName: filename}); }," +
            "    readFileAsBase64: function(filePath) {" +
            "      return new Promise(function(resolve, reject){" +
            "        try {" +
            "          var r = callNative('readFileAsBase64', {filePath: filePath});" +
            "          var obj = JSON.parse(r);" +
            "          resolve(obj);" +
            "        } catch(e) { resolve({success:false, error:String(e)}); }" +
            "      });" +
            "    }," +
            "    openFile: function(filePath, mimeType) { return callNativeAsync('openFile', {filePath: filePath, mimeType: mimeType||''}); }," +
            "    quitApp: function() { callNative('quitApp', {}); }," +
            "    printPrescription: function(html, orientation) { return callNativeAsync('printPrescription', {html: html, orientation: orientation||'portrait'}); }," +
            "    showToast: function(message) { callNative('showToast', {message: message}); }," +
            "    encryptData: function(data, key) { return callNativeAsync('encryptData', {data: data, key: key}); }," +
            "    decryptData: function(encryptedData, key) { return callNativeAsync('decryptData', {encryptedData: encryptedData, key: key}); }," +
            "    savePrescriptionImage: function(imageData, fileName) { return callNativeAsync('savePrescriptionImage', {imageData: imageData, fileName: fileName}); }," +
            "    saveVideoFile: function(base64Data, fileName) { return callNativeAsync('saveVideoFile', {base64Data: base64Data, fileName: fileName}); }," +
            "    startMediaSession: function(fileName) { return callNativeAsync('startMediaSession', {fileName: fileName}); }," +
            "    appendMediaChunk: function(sessionId, chunkBase64, index, total) { return callNativeAsync('appendMediaChunk', {sessionId: sessionId, chunkBase64: chunkBase64, index: index, total: total}); }," +
            "    commitMediaSession: function(sessionId, fileName, type) { return callNativeAsync('commitMediaSession', {sessionId: sessionId, fileName: fileName, type: type||'image'}); }," +
            "    findMediaFiles: function(patientName, prescriptionNo, createdAt) { return callNativeAsync('findMediaFiles', {patientName: patientName||'', prescriptionNo: prescriptionNo||'', createdAt: createdAt||''}); }," +
            "    startReadSession: function(filePath) { return callNativeAsync('startReadSession', {filePath: filePath}); }," +
            "    readNextChunk: function(sessionId) { return callNativeAsync('readNextChunk', {sessionId: sessionId}); }," +
            "    closeReadSession: function(sessionId) { callNative('closeReadSession', {sessionId: sessionId}); }," +
            "    license: {" +
            "      getStatus: function() { return callNativeAsync('getLicenseStatus', {}); }," +
            "      validate: function() { return callNativeAsync('validateLicense', {}); }," +
            "      activate: { importLicense: function(){ return Promise.resolve({success:false, error:'APP端不支持离线license文件导入，请使用在线激活'}); } }," +
            "      setTrialDays: function(days){ return callNativeAsync('setTrialDays', {days: days}); }," +
            "      getTrialDays: function(){ return callNativeAsync('getTrialDays', {}); }," +
            "      verifyOnline: function(){ return callNativeAsync('verifyOnline', {}); }," +
            "      getActivationRecord: function(){ return callNativeAsync('getActivationRecord', {}); }" +
            "    }," +
            "activate: {" +
            "      show: function(){ return new Promise(function(resolve){ try { window.dispatchEvent(new CustomEvent('app:show-activate')); resolve({success:true}); } catch(e){ resolve({success:false,error:String(e)}); } }); }," +
            "      submit: function(code, user, password){ return callNativeAsync('activateLicense', {code: code, user: user||'', password: password||'admin'}); }," +
            "      getMachineId: function(){ return callNativeAsync('getMachineId', {}); }," +
            "      installAdminLicense: function(args){ return callNativeAsync('installAdminLicense', {licenseBase64: (args&&args.license)||'', user: (args&&args.adminName)||(args&&args.user)||'', clinicName: (args&&args.clinicName)||'', password: (args&&args.password)||'admin', loginUsername: (args&&args.phone)||'', phone: (args&&args.phone)||''}); }," +
            "      close: function(){ return Promise.resolve({success:true}); }," +
            "      restart: function(){ return callNativeAsync('appRestart', {}); }" +
            "    }" +
            "  };" +
            "})();";
        webView.evaluateJavascript(js, null);
    }

    /**
     * ★ 注入键盘适配脚本（离线APP特有）
     * 监听窗口 resize 事件，处理虚拟键盘弹出/收起时的视口变化，
     * 并确保输入框在键盘弹出时滚动到可见区域。
     */
    private void injectKeyboardAdapter(WebView webView) {
        String js = "(function(){" +
            "  if (window.__keyboardAdapterApplied) return;" +
            "  window.__keyboardAdapterApplied = true;" +
            "  var originalHeight = window.innerHeight;" +
            "  window.addEventListener('resize', function() {" +
            "    var currentHeight = window.innerHeight;" +
            "    if (currentHeight < originalHeight - 50) {" +
            "      document.body.classList.add('keyboard-visible');" +
            "    } else {" +
            "      document.body.classList.remove('keyboard-visible');" +
            "    }" +
            "  });" +
            "  document.addEventListener('focusin', function(e) {" +
            "    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {" +
            "      setTimeout(function() {" +
            "        e.target.scrollIntoView({ behavior: 'smooth', block: 'center' });" +
            "      }, 300);" +
            "    }" +
            "  });" +
            "})();";
        webView.evaluateJavascript(js, null);
    }

    /**
     * ★ 彻底禁用密码输入框的自动填充（防止 Android Autofill 弹出旧版应用名称提示）
     * 问题：点击密码输入框时，Android 系统弹出"惠康中医诊所管理系统"凭据提示（旧名"本能中医处方系统"）
     * 根因：Android Autofill 通过 Accessibility 虚拟节点树直接访问 WebView 内部 input，
     *       View 级别 setImportantForAutofill(NO) 无法阻止；Autofill 提示显示系统数据库中的旧应用名
     * 彻底修复（三层防线）：
     *   1. AndroidManifest android:importantForAutofill="no"（系统级禁用，最强防线）
     *   2. disableAutofillRecursive 递归设置所有子 View IMPORTANT_FOR_AUTOFILL_NO（双保险）
     *   3. 本方法 JS 注入：MutationObserver 持续监控动态密码框
     *      + data-lpignore/data-form-type/role 等多属性，防止第三方密码管理器识别
     *   注意：不可将 type='password' 改为 type='text' + webkitTextSecurity
     *         HarmonyOS 4.2 上 webkitTextSecurity 不生效，且 type='text' 导致输入法弹出旧应用名候选词
     */
    private void injectAutocompleteOff(WebView webView) {
        String js = "(function(){" +
            "  function np(p){" +
            "    if (!p || p.__bnAf) return;" +
            "    p.__bnAf = 1;" +
            "    p.setAttribute('autocomplete', 'new-password');" +
            "    p.setAttribute('data-lpignore', 'true');" +
            "    p.setAttribute('data-form-type', 'other');" +
            "    p.setAttribute('role', 'textbox');" +
            "    p.setAttribute('readonly', '');" +
            "    p.addEventListener('focus', function() { this.removeAttribute('readonly'); });" +
            "  }" +
            "  function scan(){" +
            "    var s = 'input[type=\"password\"],input[autocomplete*=\"password\"],input[name*=\"password\"],input[name*=\"pwd\"]';" +
            "    var l = document.querySelectorAll(s);" +
            "    for (var i = 0; i < l.length; i++) { np(l[i]); }" +
            "  }" +
            "  scan();" +
            "  if (!window.__bnAfObs) {" +
            "    window.__bnAfObs = new MutationObserver(function() { scan(); });" +
            "    var t = document.body || document.documentElement;" +
            "    if (t) window.__bnAfObs.observe(t, {childList: true, subtree: true, attributes: true, attributeFilter: ['type']});" +
            "  }" +
            "})();";
        webView.evaluateJavascript(js, null);
    }

    /**
     * 递归设置 View 及所有子 View 的 importantForAutofill=NO（双保险）
     * 配合 AndroidManifest 的 android:importantForAutofill="no" 彻底禁用 Autofill
     */
    private void disableAutofillRecursive(View view) {
        if (view == null) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            view.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_NO);
        }
        if (view instanceof ViewGroup) {
            ViewGroup group = (ViewGroup) view;
            for (int i = 0; i < group.getChildCount(); i++) {
                disableAutofillRecursive(group.getChildAt(i));
            }
        }
    }

    /**
     * 注入布局修正脚本
     * 注意：状态栏已由 Android 主题处理（windowTranslucentStatus=false + statusBarColor），
     * WebView 内容从状态栏下方开始，不再注入 padding-top，避免顶部出现双重空白。
     */
    private void injectLayoutFixScript(WebView webView) {
        String js = "(function() {" +
            "  if (window._layoutFixInjected) return;" +
            "  window._layoutFixInjected = true;" +
            "  var style = document.createElement('style');" +
            "  style.id = 'app-layout-fix';" +
            "  style.textContent = '" +
            "    html, body { box-sizing: border-box !important; }" +
            "    .top-tabs-left, .top-tabs { position: relative !important; z-index: 10 !important; }" +
            "  ';" +
            "  document.head.appendChild(style);" +
            "})();";
        webView.evaluateJavascript(js, null);
    }

    /**
     * 预加载录像拍照脚本到内存缓存（在后台线程执行，避免阻塞UI）
     * 首次调用会触发assets读取，后续调用直接使用缓存
     * ★ 修复 2026-07-27：改用 try-with-resources 确保异常时 InputStream 关闭，防止 FD 泄漏
     */
    private void preloadVideoRecorderScript() {
        if (cachedVideoRecorderScript != null) return;
        new Thread(() -> {
            try (InputStream is = getAssets().open("video-recorder-inject.js")) {
                java.io.ByteArrayOutputStream baos = new java.io.ByteArrayOutputStream();
                byte[] buffer = new byte[8192];
                int len;
                while ((len = is.read(buffer)) > 0) {
                    baos.write(buffer, 0, len);
                }
                cachedVideoRecorderScript = baos.toString("UTF-8");
                Log.d(TAG, "录像拍照脚本预加载完成，长度: " + cachedVideoRecorderScript.length());
            } catch (Exception e) {
                Log.e(TAG, "录像拍照脚本预加载失败", e);
            }
        }, "preload-vr-script").start();
    }

    /**
     * 同步读取录像拍照脚本（带缓存）
     * 优先使用预加载缓存，未命中则同步读取并缓存
     * ★ 修复 2026-07-27：改用 try-with-resources 确保异常时 InputStream 关闭，防止 FD 泄漏
     */
    private String getVideoRecorderScript() {
        if (cachedVideoRecorderScript != null) return cachedVideoRecorderScript;
        try (InputStream is = getAssets().open("video-recorder-inject.js")) {
            java.io.ByteArrayOutputStream baos = new java.io.ByteArrayOutputStream();
            byte[] buffer = new byte[8192];
            int len;
            while ((len = is.read(buffer)) > 0) {
                baos.write(buffer, 0, len);
            }
            cachedVideoRecorderScript = baos.toString("UTF-8");
            Log.d(TAG, "录像拍照脚本同步加载完成，长度: " + cachedVideoRecorderScript.length());
        } catch (Exception e) {
            Log.e(TAG, "录像拍照脚本同步加载失败", e);
            cachedVideoRecorderScript = "";
        }
        return cachedVideoRecorderScript;
    }

    /**
     * 注入录像拍照功能脚本（使用内存缓存，避免每次IO）
     * 脚本包含：electronAPI shim（完整版）、录像/拍照 overlay、本地保存逻辑
     * 注：注入逻辑采用懒加载策略，shim 立即注入，样式和按钮延迟到首次打开overlay时
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
    public void onResume() {
        super.onResume();
        WebView webView = this.getBridge().getWebView();
        if (webView != null) {
            // ★ 优化：onCreate 已配置 WebSettings，onResume 不再重复设置
            // 重复设置 WebSettings 会触发 WebView 重新计算配置，影响恢复速度
            if (hasDoneFirstResume) {
                // 非首次恢复：通过JS触发页面内同步逻辑（SyncEngine+药品刷新），不整页reload避免丢失编辑状态
                // ★ 修复 2026-07-27：lambda 闭包持有 webView 引用，WebView 销毁后调用 evaluateJavascript 会抛异常
                //   WebView 没有 isDestroyed() 公共 API，用 try-catch 兜底是最稳妥的方案
                final WebView finalWebView = webView;
                mainHandler.postDelayed(() -> {
                    if (finalWebView == null) {
                        Log.w(TAG, "onResume postDelayed: WebView 为 null，跳过 JS 注入");
                        return;
                    }
                    try {
                        finalWebView.evaluateJavascript(
                            "(function(){" +
                            "  window._layoutFixInjected = false;" +
                            "  if (typeof window.__onAppResume === 'function') { window.__onAppResume(); }" +
                            "})();", null);
                        injectLayoutFixScript(finalWebView);
                    } catch (Exception e) {
                        // WebView 已销毁或不可用时 evaluateJavascript 会抛 IllegalStateException
                        Log.w(TAG, "onResume JS 注入失败（WebView 可能已销毁）: " + e.getMessage());
                    }
                }, 100);
            } else {
                hasDoneFirstResume = true;
            }
        }
    }

    @Override
    public void onBackPressed() {
        WebView webView = this.getBridge().getWebView();
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    // T4: onDestroy 释放 WebView 资源，防止内存泄漏
    // 注意：BridgeActivity 的 onDestroy 是 public，覆盖时必须保持 public
    @Override
    public void onDestroy() {
        // T5: 清理所有待执行的 Handler 回调，防止 Activity 销毁后延迟任务执行导致崩溃
        if (mainHandler != null) {
            mainHandler.removeCallbacksAndMessages(null);
        }
        // ★ 修复 2026-07-27：清理 mediaSessions 临时文件（防止 cacheDir 文件泄漏）
        // 用户可能在 startMediaSession 后未 commit 就退出 APP，临时文件会一直占用 cacheDir
        if (nativeBridge != null) {
            nativeBridge.cleanupSessions();
        }
        WebView webView = this.getBridge() != null ? this.getBridge().getWebView() : null;
        if (webView != null) {
            // 移除 JS Interface，防止持有 Activity 引用
            webView.removeJavascriptInterface("AndroidAppExit");
            webView.removeJavascriptInterface("AndroidNative");
            // 从父视图移除并销毁
            ViewGroup parent = (ViewGroup) webView.getParent();
            if (parent != null) {
                parent.removeView(webView);
            }
            webView.removeAllViews();
            webView.destroy();
        }
        super.onDestroy();
    }

    // ========================================================================
    // NativeBridge：JavaScript 桥接，提供本地文件保存能力
    // 录像拍照功能通过此桥接将文件保存到本地文件系统
    // 保存路径：
    //   图片：Pictures/惠康中医处方/YYYY-MM/患者姓名_处方编号_photo.png
    //   视频：Movies/惠康中医处方/YYYY-MM/患者姓名_处方编号_video.webm
    //
    // 注意：基础文件操作（saveBackupFile/readFileAsBase64/openFile/quitApp/printHtml 等）
    //       已由 NativeBridgePlugin（Capacitor插件）通过 nativeBridge 对象提供。
    //       本类注册为 AndroidNative，提供更完整的 invoke 分发能力（供 video-recorder-inject.js 使用），
    //       包含分片上传/读取、文件查找、重命名、删除等会话型操作。
    // ========================================================================
    public class NativeBridge {

        @JavascriptInterface
        public void printHtml(final String html) {
            mainHandler.post(new Runnable() {
                @Override
                public void run() {
                    try {
                        WebView printWebView = new WebView(MainActivity.this);
                        printWebView.loadDataWithBaseURL(null, html, "text/html", "UTF-8", null);

                        PrintManager printManager = (PrintManager) getSystemService(Context.PRINT_SERVICE);
                        PrintDocumentAdapter printAdapter = printWebView.createPrintDocumentAdapter();

                        PrintAttributes attrs = new PrintAttributes.Builder()
                            .setMediaSize(PrintAttributes.MediaSize.ISO_A5)
                            .setResolution(new PrintAttributes.Resolution("res", "pdf", 300, 300))
                            .setMinMargins(PrintAttributes.Margins.NO_MARGINS)
                            .build();

                        String jobName = "惠康中医处方 " + new java.text.SimpleDateFormat("yyyyMMdd-HHmmss", java.util.Locale.CHINA).format(new java.util.Date());
                        printManager.print(jobName, printAdapter, attrs);
                        Log.d(TAG, "printHtml 已调起系统打印: " + jobName);
                    } catch (Exception e) {
                        Log.e(TAG, "printHtml 失败", e);
                        Toast.makeText(MainActivity.this, "打印失败：" + e.getMessage(), Toast.LENGTH_LONG).show();
                    }
                }
            });
        }

        // ★ 保留 quitApp 作为 @JavascriptInterface，供 index.html 直接调用 AndroidNative.quitApp()
        // ★ 修复 2026-07-28：finishAffinity() 必须在 UI 线程调用（JavascriptInterface 默认在后台线程）
        //   追加 System.exit(0) 杀死进程，确保下次启动是全新进程，彻底解决"退出后重开自动登入"问题
        @JavascriptInterface
        public void quitApp() {
            mainHandler.post(() -> {
                finishAffinity();
                System.exit(0);
            });
        }

        @JavascriptInterface
        public String invoke(String name, String jsonStr) {
            Log.d(TAG, "NativeBridge.invoke: " + name + ", jsonLen=" + (jsonStr != null ? jsonStr.length() : 0));
            // P1-6: 调用来源校验（分层策略）
            // 敏感读取/删除操作必须校验来源，防止 XSS 读取沙箱任意文件
            // 保存/查找/分片上传操作放宽校验，避免 WebView URL 短暂变化导致功能不可用
            if (isSensitiveOperation(name) && !isCallerAllowed()) {
                Log.w(TAG, "NativeBridge.invoke 拒绝非本地调用: " + name);
                return fail("permission denied").toString();
            }
            try {
                JSONObject args = new JSONObject(jsonStr);
                switch (name) {
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
                    case "saveBackupFile":
                        return saveBackupFile(args.optString("jsonStr", ""),
                                args.optString("fileName", "")).toString();
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
                        return renameMediaFiles(
                                args.optString("oldPatientName", args.optString("patientName", "")),
                                args.optString("newPatientName", args.optString("patientName", "")),
                                args.optString("oldNo", ""),
                                args.optString("newNo", "")).toString();
                    case "deleteFile":
                        return deleteFile(args.optString("filePath", "")).toString();
                    case "printPrescription":
                        return printPrescription(args.optString("html", ""),
                                args.optString("orientation", "portrait")).toString();
                    // ★ 以下为从 NativeBridgePlugin 迁移的方法（方向3：统一到 JavascriptInterface 架构）
                    case "getLicenseStatus":
                        return getLicenseStatus().toString();
                    case "validateLicense":
                        return validateLicense().toString();
                    case "activateLicense":
                        return activateLicense(args.optString("code", ""),
                                args.optString("user", ""),
                                args.optString("password", "admin")).toString();
                    case "installAdminLicense":
                        // ★ 管理员激活：安装后端审批已生成的 license（无需网络校验激活码）
                        return installAdminLicense(
                                args.optString("licenseBase64", ""),
                                args.optString("user", args.optString("adminName", "")),
                                args.optString("clinicName", ""),
                                args.optString("password", "admin"),
                                args.optString("loginUsername", args.optString("phone", "")),
                                args.optString("phone", "")).toString();
                    case "getMachineId":
                        return getMachineIdJson().toString();
                    case "verifyOnline":
                        return verifyOnline().toString();
                    case "getActivationRecord":
                        return getActivationRecord().toString();
                    case "appRestart":
                        return appRestart().toString();
                    case "setTrialDays":
                        return setTrialDays(args.optInt("days", 7)).toString();
                    case "getTrialDays":
                        return getTrialDaysJson().toString();
                    case "getPrescriptionStatus":
                        return getPrescriptionStatus().toString();
                    case "incrementPrescription":
                        return incrementPrescriptionJson().toString();
                    case "encryptData":
                        return encryptData(args.optString("data", ""),
                                args.optString("key", "")).toString();
                    case "decryptData":
                        return decryptData(args.optString("encryptedData", ""),
                                args.optString("key", "")).toString();
                    case "showToast":
                        showToast(args.optString("message", ""));
                        return ok().toString();
                    case "quitApp":
                        // ★ 修复 2026-07-28：切到 UI 线程 + 杀进程，与 quitApp() @JavascriptInterface 一致
                        mainHandler.post(() -> {
                            finishAffinity();
                            System.exit(0);
                        });
                        return ok().toString();
                    default:
                        return fail("unknown method: " + name).toString();
                }
            } catch (Exception e) {
                Log.e(TAG, "invoke " + name + " 失败", e);
                return fail(e.getMessage()).toString();
            }
        }

        // ------------------------------------------------------------------
        // P1-6 分层校验：仅敏感操作需要来源校验
        // 敏感：deleteFile（可删文件）
        // 非敏感：readFileAsBase64（已有 isMediaPathAllowed 路径白名单校验，仅允许读取媒体目录文件）
        //        startReadSession/readNextChunk/closeReadSession（路径白名单校验，见 startReadSession）
        //        savePrescriptionImage/saveVideoFile/saveMediaSession（只写指定目录）、findMediaFiles（按模式查找）
        // ★ readFileAsBase64 从敏感列表移除：避免 startReadSession 失败回退到 readFileAsBase64 时
        //    被 isCallerAllowed 误拦截（URL 短暂变化导致），路径白名单已足够安全
        // ------------------------------------------------------------------
        private boolean isSensitiveOperation(String name) {
            return "deleteFile".equals(name);
        }

        // ------------------------------------------------------------------
        // 处方图片：写入 Pictures/惠康中医处方/YYYY-MM/ 目录
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
        // 打印处方：通过 Android 原生 PrintManager API 调起系统打印对话框
        // 背景：Android WebView 默认不支持 window.print()，iframe.print() 会静默失败
        // 实现：创建临时 WebView 加载 HTML，使用其 PrintDocumentAdapter 交给 PrintManager
        // ------------------------------------------------------------------
        private JSONObject printPrescription(String html, String orientation) {
            try {
                if (html == null || html.isEmpty()) {
                    return fail("打印内容为空");
                }
                // 必须在主线程创建 WebView 和调用 PrintManager
                final String htmlContent = html;
                final boolean isLandscape = "landscape".equals(orientation);
                final String jobName = "惠康中医处方 " + new java.text.SimpleDateFormat("yyyyMMdd-HHmmss", java.util.Locale.CHINA).format(new java.util.Date());

                mainHandler.post(new Runnable() {
                    @Override
                    public void run() {
                        try {
                            WebView printWebView = new WebView(MainActivity.this);
                            printWebView.loadDataWithBaseURL(null, htmlContent, "text/html", "UTF-8", null);

                            PrintManager printManager = (PrintManager) getSystemService(Context.PRINT_SERVICE);
                            PrintDocumentAdapter printAdapter = printWebView.createPrintDocumentAdapter();

                            PrintAttributes attrs = new PrintAttributes.Builder()
                                .setMediaSize(isLandscape ? PrintAttributes.MediaSize.ISO_A5.asLandscape() : PrintAttributes.MediaSize.ISO_A5)
                                .setResolution(new PrintAttributes.Resolution("res", "pdf", 300, 300))
                                .setMinMargins(PrintAttributes.Margins.NO_MARGINS)
                                .build();

                            printManager.print(jobName, printAdapter, attrs);
                            Log.d(TAG, "printPrescription 已调起系统打印: " + jobName);
                        } catch (Exception e) {
                            Log.e(TAG, "printPrescription 调起打印失败", e);
                            Toast.makeText(MainActivity.this, "打印失败：" + e.getMessage(), Toast.LENGTH_LONG).show();
                        }
                    }
                });

                JSONObject r = new JSONObject();
                r.put("success", true);
                r.put("message", "已调起系统打印对话框");
                return r;
            } catch (Exception e) {
                Log.e(TAG, "printPrescription 失败", e);
                return fail(e.getMessage());
            }
        }

        // ------------------------------------------------------------------
        // 视频文件：写入 Pictures/惠康中医处方/YYYY-MM/ 目录（与图片同目录，方便导出）
        // ------------------------------------------------------------------
        private JSONObject saveVideoFile(String base64Data, String fileName) {
            try {
                byte[] bytes = Base64.decode(base64Data, Base64.DEFAULT);

                String safeName = sanitize(fileName);
                if (safeName.isEmpty()) {
                    safeName = "video_" + System.currentTimeMillis() + ".webm";
                }
                // 保留前端传入的原始扩展名（mp4/webm），不强制改名
                // 前端根据设备 MediaRecorder 支持的 mimeType 决定扩展名
                // 强制改 .webm 会导致 MP4 内容的文件扩展名不匹配，播放器无法识别

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

        /**
         * ★ 修复 2026-07-27：清理所有未完成的 mediaSession 和 readSession（用于 onDestroy）
         * 防止用户在 startMediaSession 后未 commit 就退出 APP，临时文件和 FileInputStream 泄漏
         */
        public void cleanupSessions() {
            try {
                // 清理 mediaSessions：删除临时文件
                if (!mediaSessions.isEmpty()) {
                    int cleaned = 0;
                    java.util.Iterator<java.util.Map.Entry<String, File>> it = mediaSessions.entrySet().iterator();
                    while (it.hasNext()) {
                        java.util.Map.Entry<String, File> entry = it.next();
                        File f = entry.getValue();
                        if (f != null && f.exists()) {
                            if (f.delete()) cleaned++;
                        }
                        it.remove();
                    }
                    if (cleaned > 0) {
                        Log.d(TAG, "onDestroy 清理 mediaSessions 临时文件: " + cleaned + " 个");
                    }
                }
                // 清理 readSessions：关闭 FileInputStream
                if (!readSessions.isEmpty()) {
                    int closed = 0;
                    java.util.Iterator<java.util.Map.Entry<String, ReadSession>> it2 = readSessions.entrySet().iterator();
                    while (it2.hasNext()) {
                        java.util.Map.Entry<String, ReadSession> entry = it2.next();
                        ReadSession rs = entry.getValue();
                        if (rs != null && rs.fis != null) {
                            try { rs.fis.close(); closed++; } catch (Exception ignored) {}
                        }
                        it2.remove();
                    }
                    if (closed > 0) {
                        Log.d(TAG, "onDestroy 关闭 readSessions 文件句柄: " + closed + " 个");
                    }
                }
            } catch (Exception e) {
                Log.w(TAG, "cleanupSessions 异常（非致命）: " + e.getMessage());
            }
        }

        private JSONObject startMediaSession(String fileName) {
            try {
                String sessionId = "media_" + System.currentTimeMillis() + "_" + (int) (Math.random() * 100000);
                String safeName = sanitize(fileName);
                if (safeName.isEmpty()) {
                    safeName = "media_" + System.currentTimeMillis();
                }
                File tempFile = new File(getCacheDir(), "upload_" + sessionId + "_" + safeName);
                // 确保临时文件不存在（清理可能的残留）
                if (tempFile.exists()) tempFile.delete();
                mediaSessions.put(sessionId, tempFile);
                Log.d(TAG, "startMediaSession: sessionId=" + sessionId + ", tempFile=" + tempFile.getAbsolutePath());
                JSONObject r = new JSONObject();
                r.put("success", true);
                r.put("sessionId", sessionId);
                return r;
            } catch (Exception e) {
                Log.e(TAG, "startMediaSession 失败", e);
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
                    Log.d(TAG, "appendMediaChunk: sessionId=" + sessionId + ", index=" + (index + 1) + "/" + total + ", fileSize=" + tempFile.length());
                }
                JSONObject r = new JSONObject();
                r.put("success", true);
                r.put("index", index);
                r.put("total", total);
                r.put("fileSize", tempFile.length());
                return r;
            } catch (Exception e) {
                Log.e(TAG, "appendMediaChunk 失败 (sessionId=" + sessionId + ", index=" + index + ")", e);
                // 失败时清理临时文件
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
                Log.d(TAG, "commitMediaSession: sessionId=" + sessionId + ", type=" + type + ", tempSize=" + tempFile.length());

                // 统一保存到 Pictures/惠康中医处方/YYYY-MM/ 目录（图片视频同目录，方便导出）
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
                // 若目标已存在则覆盖
                if (targetFile.exists()) targetFile.delete();

                // 先尝试 rename（同分区快速），失败则复制
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
                Log.d(TAG, "commitMediaSession 成功: " + targetFile.getAbsolutePath() + ", size=" + targetFile.length());

                JSONObject r = new JSONObject();
                r.put("success", true);
                r.put("filePath", targetFile.getAbsolutePath());
                r.put("directory", targetDir.getAbsolutePath());
                r.put("fileName", safeName);
                r.put("fileSize", targetFile.length());
                return r;
            } catch (Exception e) {
                Log.e(TAG, "commitMediaSession 失败 (sessionId=" + sessionId + ")", e);
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
        // 工具方法
        // ------------------------------------------------------------------
        private File getImageDir() {
            File dir;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                File external = getExternalFilesDir(Environment.DIRECTORY_PICTURES);
                File newDir = new File(external, "惠康中医处方");
                File oldDir = new File(external, "本能中医处方");
                dir = (newDir.exists() || !oldDir.exists()) ? newDir : oldDir;
            } else {
                File pictures = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES);
                File newDir = new File(pictures, "惠康中医处方");
                File oldDir = new File(pictures, "本能中医处方");
                dir = (newDir.exists() || !oldDir.exists()) ? newDir : oldDir;
            }
            if (!dir.exists() && !dir.mkdirs()) {
                dir = new File(getFilesDir(), "prescription_images");
                if (!dir.exists()) dir.mkdirs();
            }
            return dir;
        }

        private File getVideoDir() {
            File dir;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                File external = getExternalFilesDir(Environment.DIRECTORY_MOVIES);
                File newDir = new File(external, "惠康中医处方");
                File oldDir = new File(external, "本能中医处方");
                dir = (newDir.exists() || !oldDir.exists()) ? newDir : oldDir;
            } else {
                File movies = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_MOVIES);
                File newDir = new File(movies, "惠康中医处方");
                File oldDir = new File(movies, "本能中医处方");
                dir = (newDir.exists() || !oldDir.exists()) ? newDir : oldDir;
            }
            if (!dir.exists() && !dir.mkdirs()) {
                dir = new File(getFilesDir(), "prescription_videos");
                if (!dir.exists()) dir.mkdirs();
            }
            return dir;
        }

        // 统一路径校验：使用 canonicalPath.startsWith(root) 校验文件路径必须在允许的根目录下
        // 获取所有可能的媒体目录（新旧目录都包含）
        // 解决：用户既用过旧版本（本能中医处方）又用过新版本（惠康中医处方）时，
        // getImageDir() 只返回一个目录，导致另一个目录下的文件无法通过白名单校验
        private java.util.List<File> getAllMediaDirs() {
            java.util.List<File> dirs = new java.util.ArrayList<>();
            File imgDir = getImageDir();
            File vidDir = getVideoDir();
            if (imgDir != null) dirs.add(imgDir);
            if (vidDir != null) dirs.add(vidDir);
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    File extPic = getExternalFilesDir(Environment.DIRECTORY_PICTURES);
                    File extMov = getExternalFilesDir(Environment.DIRECTORY_MOVIES);
                    if (extPic != null) {
                        File newImg = new File(extPic, "惠康中医处方");
                        File oldImg = new File(extPic, "本能中医处方");
                        if (!dirs.contains(newImg)) dirs.add(newImg);
                        if (!dirs.contains(oldImg)) dirs.add(oldImg);
                    }
                    if (extMov != null) {
                        File newVid = new File(extMov, "惠康中医处方");
                        File oldVid = new File(extMov, "本能中医处方");
                        if (!dirs.contains(newVid)) dirs.add(newVid);
                        if (!dirs.contains(oldVid)) dirs.add(oldVid);
                    }
                } else {
                    File picDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES);
                    File movDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_MOVIES);
                    if (picDir != null) {
                        File newImg = new File(picDir, "惠康中医处方");
                        File oldImg = new File(picDir, "本能中医处方");
                        if (!dirs.contains(newImg)) dirs.add(newImg);
                        if (!dirs.contains(oldImg)) dirs.add(oldImg);
                    }
                    if (movDir != null) {
                        File newVid = new File(movDir, "惠康中医处方");
                        File oldVid = new File(movDir, "本能中医处方");
                        if (!dirs.contains(newVid)) dirs.add(newVid);
                        if (!dirs.contains(oldVid)) dirs.add(oldVid);
                    }
                }
            } catch (Exception e) {
                Log.e(TAG, "getAllMediaDirs 异常", e);
            }
            return dirs;
        }

        // 统一路径校验：使用 canonicalPath.startsWith(root) 校验文件路径必须在允许的根目录下
        // 同步离线版本 isMediaPathAllowed 安全实现，供 readFileAsBase64/deleteFile/openFile 共用
        // ★ 兼容新旧两个目录（惠康中医处方 / 本能中医处方），避免旧文件无法打开
        private boolean isMediaPathAllowed(String filePath) {
            try {
                if (filePath == null || filePath.isEmpty()) return false;
                File f = new File(filePath);
                String canonicalPath = f.getCanonicalPath();
                for (File dir : getAllMediaDirs()) {
                    if (dir != null) {
                        String dirPath = dir.getCanonicalPath();
                        if (!dirPath.isEmpty() && canonicalPath.startsWith(dirPath)) return true;
                    }
                }
                Log.w(TAG, "isMediaPathAllowed 拒绝非白名单路径: " + canonicalPath);
                return false;
            } catch (Exception e) {
                Log.e(TAG, "isMediaPathAllowed 异常: " + filePath, e);
                return false;
            }
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
            return name.replaceAll("[\\\\/:*?\"<>|]", "_").trim();
        }

        private JSONObject ok() {
            try {
                JSONObject r = new JSONObject();
                r.put("success", true);
                return r;
            } catch (Exception e) {
                return null;
            }
        }

        private JSONObject fail(String msg) {
            try {
                JSONObject r = new JSONObject();
                r.put("success", false);
                r.put("error", msg);
                return r;
            } catch (Exception e) {
                return null;
            }
        }

        // ------------------------------------------------------------------
        // ★ License/加密/Toast（从 NativeBridgePlugin 迁移，方向3统一架构）
        // ------------------------------------------------------------------
        private LicenseManager licenseManager;

        private LicenseManager getLM() {
            if (licenseManager == null) {
                licenseManager = new LicenseManager(MainActivity.this);
            }
            return licenseManager;
        }

        private JSONObject getLicenseStatus() {
            try { return getLM().validateLicense(); }
            catch (Exception e) { return fail(e.getMessage()); }
        }

        private JSONObject getMachineIdJson() {
            try {
                JSONObject r = new JSONObject();
                r.put("success", true);
                r.put("machineId", getLM().getMachineId());
                return r;
            } catch (Exception e) {
                return fail(e.getMessage());
            }
        }

        private JSONObject validateLicense() {
            try { return getLM().validateLicense(); }
            catch (Exception e) { return fail(e.getMessage()); }
        }

        private JSONObject activateLicense(String code, String user, String password) {
            try {
                String machineId = getLM().getMachineId();
                // ★ 解析"姓名/手机号"：手机号作为登录账号，姓名作为显示名
                String raw = user != null ? user.trim() : "";
                String phone = "";
                int phoneStart = -1;
                java.util.regex.Matcher m = java.util.regex.Pattern.compile("1[3-9]\\d{9}").matcher(raw);
                if (m.find()) {
                    phone = m.group();
                    phoneStart = m.start();
                }
                String name = (phoneStart >= 0) ? raw.substring(0, phoneStart) : raw;
                name = name.replaceAll("[/\\-\\s]+$", "").trim();
                String loginUsername = phone.isEmpty() ? raw : phone;
                JSONObject result = getLM().activateOnline(code, machineId, name, "", password, loginUsername, phone);
                // ★ 修复 2026-07-27：激活成功后立即验证 license.dat 是否可正确读取
                // 这样可以在激活时就发现问题，而不是等用户重启后才发现问题
                if (result != null && result.optBoolean("success", false)) {
                    JSONObject verify = getLM().validateLicense(machineId);
                    boolean valid = verify != null && verify.optBoolean("valid", false);
                    String verifyType = verify != null ? verify.optString("type", "") : "";
                    Log.d(TAG, "激活后验证: valid=" + valid + " type=" + verifyType +
                               " machineId=" + machineId);
                    if (!valid) {
                        // license.dat 写入成功但读取失败，说明加密/解密有问题
                        String verifyMsg = verify != null ? verify.optString("message", "未知") : "验证返回 null";
                        Log.e(TAG, "激活后验证失败: " + verifyMsg);
                        result.put("warning", "激活数据写入后验证异常: " + verifyMsg + "（machineId=" + machineId + "）");
                    }
                }
                return result;
            } catch (Exception e) { return fail(e.getMessage()); }
        }

        // ★ 管理员激活：安装后端审批已生成的 license（复用 LicenseManager.installAdminLicense）
        private JSONObject installAdminLicense(String licenseBase64, String user, String clinicName,
                                               String password, String loginUsername, String phone) {
            try {
                String machineId = getLM().getMachineId();
                JSONObject result = getLM().installAdminLicense(
                        licenseBase64, machineId, user, clinicName, password, loginUsername, phone);
                if (result != null && result.optBoolean("success", false)) {
                    // 与 activateLicense 一致：激活后立即验证 license 是否可读
                    JSONObject verify = getLM().validateLicense(machineId);
                    boolean valid = verify != null && verify.optBoolean("valid", false);
                    if (!valid) {
                        String verifyMsg = verify != null ? verify.optString("message", "未知") : "验证返回 null";
                        Log.e(TAG, "管理员激活后验证失败: " + verifyMsg);
                        result.put("warning", "激活数据写入后验证异常: " + verifyMsg);
                    }
                }
                return result;
            } catch (Exception e) { return fail(e.getMessage()); }
        }

        // ★ 修复 2026-07-27：真正重启 APP（替代原来空实现的 restart）
        // 激活成功后 JS 端调用 electronAPI.activate.restart()，此处真正重启
        private JSONObject appRestart() {
            try {
                Log.d(TAG, "appRestart: 正在重启 APP");
                mainHandler.post(() -> {
                    try {
                        Intent intent = getPackageManager().getLaunchIntentForPackage(getPackageName());
                        if (intent != null) {
                            intent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_NEW_TASK);
                            startActivity(intent);
                        }
                        finish();
                    } catch (Exception e) {
                        Log.e(TAG, "appRestart 异常", e);
                    }
                });
                JSONObject r = new JSONObject();
                r.put("success", true);
                return r;
            } catch (Exception e) {
                return fail(e.getMessage());
            }
        }

        private JSONObject verifyOnline() {
            try {
                String machineId = getLM().getMachineId();
                return getLM().verifyOnline(machineId);
            } catch (Exception e) { return fail(e.getMessage()); }
        }

        private JSONObject getActivationRecord() {
            try { return getLM().getActivationRecord(); }
            catch (Exception e) { return fail(e.getMessage()); }
        }

        private JSONObject setTrialDays(int days) {
            try { return getLM().setTrialDays(days); }
            catch (Exception e) { return fail(e.getMessage()); }
        }

        private JSONObject getTrialDaysJson() {
            try {
                JSONObject r = new JSONObject();
                r.put("success", true);
                r.put("trialDays", getLM().getTrialDays());
                return r;
            } catch (Exception e) { return fail(e.getMessage()); }
        }

        private JSONObject getPrescriptionStatus() {
            try { return getLM().getPrescriptionStatus(); }
            catch (Exception e) { return fail(e.getMessage()); }
        }

        private JSONObject incrementPrescriptionJson() {
            try {
                int count = getLM().incrementPrescription();
                JSONObject r = new JSONObject();
                r.put("success", true);
                r.put("count", count);
                return r;
            } catch (Exception e) { return fail(e.getMessage()); }
        }

        private JSONObject encryptData(String data, String key) {
            try {
                javax.crypto.Cipher cipher = javax.crypto.Cipher.getInstance("AES/CBC/PKCS5Padding");
                byte[] keyBytes = new byte[16];
                byte[] providedKey = key.getBytes(java.nio.charset.StandardCharsets.UTF_8);
                System.arraycopy(providedKey, 0, keyBytes, 0, Math.min(providedKey.length, 16));
                javax.crypto.spec.SecretKeySpec secretKey = new javax.crypto.spec.SecretKeySpec(keyBytes, "AES");
                javax.crypto.spec.IvParameterSpec iv = new javax.crypto.spec.IvParameterSpec(keyBytes);
                cipher.init(javax.crypto.Cipher.ENCRYPT_MODE, secretKey, iv);
                byte[] encrypted = cipher.doFinal(data.getBytes(java.nio.charset.StandardCharsets.UTF_8));
                String base64 = android.util.Base64.encodeToString(encrypted, android.util.Base64.NO_WRAP);
                JSONObject r = new JSONObject();
                r.put("success", true);
                r.put("data", base64);
                return r;
            } catch (Exception e) { return fail(e.getMessage()); }
        }

        private JSONObject decryptData(String encryptedData, String key) {
            try {
                javax.crypto.Cipher cipher = javax.crypto.Cipher.getInstance("AES/CBC/PKCS5Padding");
                byte[] keyBytes = new byte[16];
                byte[] providedKey = key.getBytes(java.nio.charset.StandardCharsets.UTF_8);
                System.arraycopy(providedKey, 0, keyBytes, 0, Math.min(providedKey.length, 16));
                javax.crypto.spec.SecretKeySpec secretKey = new javax.crypto.spec.SecretKeySpec(keyBytes, "AES");
                javax.crypto.spec.IvParameterSpec iv = new javax.crypto.spec.IvParameterSpec(keyBytes);
                cipher.init(javax.crypto.Cipher.DECRYPT_MODE, secretKey, iv);
                byte[] decrypted = cipher.doFinal(android.util.Base64.decode(encryptedData, android.util.Base64.NO_WRAP));
                String plain = new String(decrypted, java.nio.charset.StandardCharsets.UTF_8);
                JSONObject r = new JSONObject();
                r.put("success", true);
                r.put("data", plain);
                return r;
            } catch (Exception e) { return fail(e.getMessage()); }
        }

        private void showToast(final String message) {
            runOnUiThread(() -> android.widget.Toast.makeText(MainActivity.this, message, android.widget.Toast.LENGTH_SHORT).show());
        }

        private JSONObject findMediaFiles(String patientName, String prescriptionNo, String createdAt) {
            try {
                JSONArray files = new JSONArray();
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

                // ★ 扫描所有可能的媒体目录（新旧目录都扫描），避免遗漏旧版本保存的文件
                java.util.List<File> allDirs = getAllMediaDirs();
                java.util.Set<String> foundPaths = new java.util.HashSet<>();

                for (File dir : allDirs) {
                    if (dir != null && dir.exists()) {
                        scanDirForMediaWithPrefixes(dir, prefix1, prefix2, files, foundPaths);
                    }
                }

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
                    for (File dir : allDirs) {
                        if (dir != null && dir.exists()) {
                            scanDirForMediaByNameAndTime(dir, safeName, timeRange[0], timeRange[1], files, foundPaths);
                        }
                    }
                }

                // ★ 回退2：按"姓名+时间"仍未找到时，按处方编号匹配（不限时间）
                // 场景：先拍照后录入姓名时，文件名暂用最近患者名/unknown，若重命名未执行/失败，
                // 文件名中的编号（拍照时编号框的值）仍与处方编号一致，按编号仍可命中
                if (files.length() == 0 && !safeNo.isEmpty()) {
                    for (File dir : allDirs) {
                        if (dir != null && dir.exists()) {
                            scanDirForMediaByNameOnly(dir, safeNo, files, foundPaths);
                        }
                    }
                }

                // ★ 回退3：按编号仍未找到时，按患者姓名匹配（不限时间）
                // 场景：编号异常/为空，但文件名已绑定患者姓名
                if (files.length() == 0) {
                    for (File dir : allDirs) {
                        if (dir != null && dir.exists()) {
                            scanDirForMediaByNameOnly(dir, safeName, files, foundPaths);
                        }
                    }
                }

                StringBuilder debug = new StringBuilder();
                debug.append("prefix1=").append(prefix1);
                debug.append(" | prefix2=").append(prefix2);
                debug.append(" | createdAt=").append(createdAt);
                debug.append(" | scannedDirs=").append(allDirs.size());
                for (File dir : allDirs) {
                    if (dir != null) {
                        debug.append(" | dir=").append(dir.getAbsolutePath()).append(" exists=").append(dir.exists());
                        if (dir.exists()) {
                            java.util.List<String> af = new java.util.ArrayList<>();
                            collectAllFiles(dir, af, 10);
                            debug.append(" files:").append(String.join(", ", af));
                        }
                    }
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

        // 解析 createdAt 时间字符串，返回 [startTime, endTime] 毫秒时间戳范围（当天 ±1 天）
        private long[] parseTimeRange(String createdAt) {
            try {
                // 支持 ISO 格式：2026-07-12T10:30:00.000Z 或 2026-07-12 10:30:00
                String dateStr = createdAt.trim().replace('T', ' ');
                if (dateStr.contains(".")) dateStr = dateStr.substring(0, dateStr.indexOf('.'));
                if (dateStr.contains("Z")) dateStr = dateStr.replace("Z", "");
                java.text.SimpleDateFormat sdf = new java.text.SimpleDateFormat("yyyy-MM-dd HH:mm:ss", java.util.Locale.US);
                sdf.setTimeZone(java.util.TimeZone.getTimeZone("UTC"));
                java.util.Date date = sdf.parse(dateStr);
                long time = date.getTime();
                // 当天 00:00 - 次日 23:59:59（±1天容错）
                long dayStart = time - 24 * 60 * 60 * 1000L;
                long dayEnd = time + 48 * 60 * 60 * 1000L;
                return new long[]{dayStart, dayEnd};
            } catch (Exception e) {
                // 解析失败，返回宽松时间范围（前后7天）
                long now = System.currentTimeMillis();
                return new long[]{now - 7L * 24 * 60 * 60 * 1000, now + 7L * 24 * 60 * 60 * 1000};
            }
        }

        // 按患者姓名和时间范围查找文件（回退策略）
        private void scanDirForMediaByNameAndTime(File dir, String patientName, long startTime, long endTime, JSONArray files, java.util.Set<String> foundPaths) {
            if (dir == null || !dir.exists()) return;
            File[] children = dir.listFiles();
            if (children == null) return;
            for (File f : children) {
                if (f.isDirectory()) {
                    scanDirForMediaByNameAndTime(f, patientName, startTime, endTime, files, foundPaths);
                } else {
                    String fileName = f.getName();
                    // 文件名必须包含患者姓名
                    if (!fileName.contains(patientName)) continue;
                    // 文件修改时间必须在时间范围内
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
                        Log.e(TAG, "添加文件信息失败: " + fileName, e);
                    }
                }
            }
        }

        // ★ 仅按关键词匹配文件名（不限时间），供回退2/回退3使用
        private void scanDirForMediaByNameOnly(File dir, String keyword, JSONArray files, java.util.Set<String> foundPaths) {
            if (dir == null || !dir.exists() || keyword == null || keyword.isEmpty()) return;
            File[] children = dir.listFiles();
            if (children == null) return;
            for (File f : children) {
                if (f.isDirectory()) {
                    scanDirForMediaByNameOnly(f, keyword, files, foundPaths);
                } else {
                    String fileName = f.getName();
                    if (!fileName.contains(keyword)) continue;
                    String filePath = f.getAbsolutePath();
                    if (foundPaths.contains(filePath)) continue;
                    foundPaths.add(filePath);
                    try {
                        JSONObject fileObj = new JSONObject();
                        fileObj.put("name", fileName);
                        fileObj.put("path", filePath);
                        fileObj.put("type", fileName.endsWith(".webm") || fileName.endsWith(".mp4") ? "video" : "image");
                        fileObj.put("size", f.length());
                        fileObj.put("lastModified", f.lastModified());
                        files.put(fileObj);
                    } catch (Exception e) {
                        Log.e(TAG, "添加文件信息失败: " + fileName, e);
                    }
                }
            }
        }

        private void scanDirForMedia(File dir, String prefix, JSONArray files) {
            if (dir == null || !dir.exists()) return;
            File[] children = dir.listFiles();
            if (children == null) return;
            for (File f : children) {
                if (f.isDirectory()) {
                    scanDirForMedia(f, prefix, files);
                } else if (f.getName().contains(prefix)) {
                    try {
                        JSONObject fileObj = new JSONObject();
                        fileObj.put("name", f.getName());
                        fileObj.put("path", f.getAbsolutePath());
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

        private void scanDirForMediaWithPrefixes(File dir, String prefix1, String prefix2, JSONArray files, java.util.Set<String> foundPaths) {
            if (dir == null || !dir.exists()) return;
            File[] children = dir.listFiles();
            if (children == null) return;
            for (File f : children) {
                if (f.isDirectory()) {
                    scanDirForMediaWithPrefixes(f, prefix1, prefix2, files, foundPaths);
                } else {
                    String fileName = f.getName();
                    if (fileName.contains(prefix1) || fileName.contains(prefix2)) {
                        String filePath = f.getAbsolutePath();
                        if (foundPaths.contains(filePath)) continue;
                        foundPaths.add(filePath);
                        try {
                            JSONObject fileObj = new JSONObject();
                            fileObj.put("name", fileName);
                            fileObj.put("path", filePath);
                            fileObj.put("type", fileName.endsWith(".webm") || fileName.endsWith(".mp4") ? "video" : "image");
                            fileObj.put("size", f.length());
                            fileObj.put("lastModified", f.lastModified());
                            files.put(fileObj);
                        } catch (Exception e) {
                            Log.e(TAG, "添加文件信息失败: " + fileName, e);
                        }
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
                File file = new File(filePath);
                if (!file.exists()) {
                    return fail("文件不存在: " + filePath);
                }
                // 路径白名单校验：只允许打开图片/视频目录下的文件
                if (!isMediaPathAllowed(filePath)) {
                    return fail("路径不在允许的目录内");
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
                // 路径白名单校验：只允许读取图片/视频目录下的文件
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
                // 路径白名单校验：使用 getAllMediaDirs() 兼容新旧目录
                String canonicalPath = file.getCanonicalPath();
                boolean allowed = false;
                for (File dir : getAllMediaDirs()) {
                    if (dir != null) {
                        String dirPath = dir.getCanonicalPath();
                        if (!dirPath.isEmpty() && canonicalPath.startsWith(dirPath)) {
                            allowed = true;
                            break;
                        }
                    }
                }
                if (!allowed) {
                    Log.w(TAG, "startReadSession 拒绝非白名单路径: " + canonicalPath);
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
                Log.d(TAG, "startReadSession: sessionId=" + sessionId + ", fileSize=" + rs.fileSize + ", mime=" + rs.mimeType);
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
                // 每片 256KB 原始字节（base64 后约 349KB，加 JSON 包装远低于 1MB）
                int chunkLen = 256 * 1024;
                byte[] buffer = new byte[chunkLen];
                int read = rs.fis.read(buffer);
                if (read < 0) {
                    // EOF
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
                if (read == chunkLen) {
                    actual = buffer;
                } else {
                    actual = new byte[read];
                    System.arraycopy(buffer, 0, actual, 0, read);
                }
                String chunkBase64 = Base64.encodeToString(actual, Base64.NO_WRAP);
                rs.readOffset += read;
                boolean eof = rs.readOffset >= rs.fileSize;
                JSONObject r = new JSONObject();
                r.put("success", true);
                r.put("chunk", chunkBase64);
                r.put("read", read);
                r.put("eof", eof);
                r.put("offset", rs.readOffset);
                r.put("total", rs.fileSize);
                return r;
            } catch (Exception e) {
                Log.e(TAG, "readNextChunk 失败 (sessionId=" + sessionId + ")", e);
                closeReadSession(sessionId);
                return fail("读取分片失败: " + e.getMessage());
            }
        }

        private JSONObject closeReadSession(String sessionId) {
            ReadSession rs = readSessions.remove(sessionId);
            if (rs != null) {
                try { rs.fis.close(); } catch (Exception ignored) {}
                Log.d(TAG, "closeReadSession: sessionId=" + sessionId + ", readOffset=" + rs.readOffset + "/" + rs.fileSize);
            }
            try {
                JSONObject r = new JSONObject();
                r.put("success", true);
                return r;
            } catch (Exception e) {
                return fail(e.getMessage());
            }
        }

        private JSONObject renameMediaFiles(String oldPatientName, String newPatientName, String oldNo, String newNo) {
            try {
                String safeOldName = sanitize(oldPatientName);
                String safeNewName = sanitize(newPatientName);
                String safeOldNo = sanitize(oldNo);
                String safeNewNo = sanitize(newNo);
                if (safeOldName.isEmpty() || safeNewName.isEmpty() || safeOldNo.isEmpty() || safeNewNo.isEmpty()) {
                    return fail("参数不完整");
                }
                // 支持两种命名格式：姓名_编号 和 编号_姓名
                String[] oldPrefixes = {safeOldName + "_" + safeOldNo, safeOldNo + "_" + safeOldName};
                String[] newPrefixes = {safeNewName + "_" + safeNewNo, safeNewNo + "_" + safeNewName};
                JSONArray renamedFiles = new JSONArray();
                int renamed = 0;
                java.util.List<File> allDirs = getAllMediaDirs();
                for (int i = 0; i < oldPrefixes.length; i++) {
                    for (File dir : allDirs) {
                        renamed += renameFilesInDir(dir, oldPrefixes[i], newPrefixes[i], renamedFiles);
                    }
                }
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

        private JSONObject deleteFile(String filePath) {
            try {
                File file = new File(filePath);
                if (!file.exists()) {
                    return fail("文件不存在: " + filePath);
                }
                // 路径白名单校验：只允许删除图片/视频目录下的文件
                if (!isMediaPathAllowed(filePath)) {
                    return fail("路径不在允许的目录内");
                }
                if (file.delete()) {
                    JSONObject result = new JSONObject();
                    result.put("success", true);
                    return result;
                } else {
                    return fail("删除文件失败");
                }
            } catch (Exception e) {
                Log.e(TAG, "deleteFile 失败", e);
                return fail("删除文件失败: " + e.getMessage());
            }
        }
    }
}
