package com.tcm.prescription;

import android.Manifest;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
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
import android.webkit.SslErrorHandler;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;
import android.widget.ProgressBar;
import android.widget.RelativeLayout;
import android.widget.TextView;
import android.widget.Toast;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;

import com.getcapacitor.BridgeActivity;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;

public class MainActivity extends BridgeActivity {

    // ============ 常量配置 ============
    // S3: 云端域名常量化，统一管理避免硬编码散落多处
    private static final String CLOUD_HOST = "tcm-prescription-system.pages.dev";
    private static final String CLOUD_URL = "https://" + CLOUD_HOST;
    // P3: 原生层期望的网页版本号，与 index.html 中 window.__APP_VERSION__ 保持同步
    // 修改云端逻辑后需同步更新此值与 index.html 中的版本号
    private static final String EXPECTED_APP_VERSION = "2026-07-15-v1";
    // T1: WebView 就绪轮询上限（30 次 × 100ms = 3 秒），避免无限循环且更快检测就绪
    private static final int MAX_WEBVIEW_READY_RETRIES = 30;
    private static final int WEBVIEW_READY_DELAY_MS = 100;
    private static final int REQ_CAMERA = 1003;
    private static final int REQ_STORAGE = 1001;

    private Handler mainHandler;
    private int webViewReadyRetries = 0;
    private RelativeLayout loadingLayout;
    private TextView loadingText;
    private volatile String cachedVideoRecorderScript = null;
    private boolean versionChecked = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // 只隐藏标题栏，不使用FLAG_FULLSCREEN（会导致内容延伸到状态栏下面）
        requestWindowFeature(Window.FEATURE_NO_TITLE);

        super.onCreate(savedInstanceState);

        // T5: 使用主线程 Looper 的 Handler，便于 onDestroy 统一清理
        mainHandler = new Handler(Looper.getMainLooper());

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

        // 后台预加载录像拍照脚本（避免 onPageFinished 时同步IO阻塞UI）
        preloadVideoRecorderScript();
    }

    private void configureWebView() {
        WebView webView = this.getBridge().getWebView();
        if (webView == null) {
            webViewReadyRetries++;
            if (webViewReadyRetries <= MAX_WEBVIEW_READY_RETRIES) {
                mainHandler.postDelayed(this::configureWebView, WEBVIEW_READY_DELAY_MS);
            }
            return;
        }

        // 创建加载进度布局（覆盖在 WebView 上方，加载完成后隐藏）
        // 优化：有缓存时不显示loading，直接让WebView显示缓存内容（与离线APP相同速度）
        if (loadingLayout == null) {
            loadingLayout = new RelativeLayout(this);
            loadingLayout.setLayoutParams(new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            ));
            loadingLayout.setBackgroundColor(0xFFFFFFFF);

            ProgressBar progressBar = new ProgressBar(this);
            RelativeLayout.LayoutParams pbParams = new RelativeLayout.LayoutParams(
                RelativeLayout.LayoutParams.WRAP_CONTENT,
                RelativeLayout.LayoutParams.WRAP_CONTENT
            );
            pbParams.addRule(RelativeLayout.CENTER_HORIZONTAL);
            pbParams.topMargin = dpToPx(180);
            loadingLayout.addView(progressBar, pbParams);

            loadingText = new TextView(this);
            loadingText.setText("正在加载云端处方系统...");
            loadingText.setTextSize(15);
            loadingText.setTextColor(0xFF666666);
            RelativeLayout.LayoutParams tvParams = new RelativeLayout.LayoutParams(
                RelativeLayout.LayoutParams.WRAP_CONTENT,
                RelativeLayout.LayoutParams.WRAP_CONTENT
            );
            tvParams.addRule(RelativeLayout.CENTER_HORIZONTAL);
            tvParams.topMargin = dpToPx(240);
            loadingLayout.addView(loadingText, tvParams);

            // 将加载布局添加到 WebView 的父视图
            ViewGroup rootView = (ViewGroup) webView.getParent();
            if (rootView != null) {
                rootView.addView(loadingLayout);
            }

            // 关键优化：检查是否有缓存
            // 有缓存（版本匹配）→ 不显示loading，WebView直接显示缓存内容（秒开）
            // 无缓存（首次启动/版本更新）→ 显示loading等待网络加载
            android.content.SharedPreferences cachePrefs = getSharedPreferences("app_config", MODE_PRIVATE);
            String cachedVersion = cachePrefs.getString("page_version", "");
            boolean hasCache = cachedVersion.equals(EXPECTED_APP_VERSION);
            if (hasCache) {
                // 有缓存：直接隐藏loading，让WebView秒开
                loadingLayout.setVisibility(View.GONE);
                Log.d("TCM-Pres", "有缓存（版本:" + cachedVersion + "），跳过loading直接显示页面");
            } else {
                // 无缓存：显示loading等待加载
                loadingLayout.setVisibility(View.VISIBLE);
                Log.d("TCM-Pres", "无缓存（首次启动或版本更新），显示loading");
            }
        }

        WebSettings settings = webView.getSettings();

        // 版本检查：如果 APP 版本更新了，清除 WebView 缓存强制加载最新页面
        // 这解决了用户看到旧缓存版本（如"媒体"文字未更新为"处方"）的问题
        android.content.SharedPreferences prefs = getSharedPreferences("app_config", MODE_PRIVATE);
        String lastVersion = prefs.getString("page_version", "");
        if (!lastVersion.equals(EXPECTED_APP_VERSION)) {
            Log.d("TCM-Pres", "页面版本变更: " + lastVersion + " -> " + EXPECTED_APP_VERSION + "，清除WebView缓存");
            webView.clearCache(true);
            // 清除 WebView 存储的数据（DOM Storage、数据库等）
            webView.clearFormData();
            android.webkit.WebStorage.getInstance().deleteAllData();
        }

        // LOAD_DEFAULT: 优先使用缓存，但会向服务器验证缓存是否过期（304则用缓存，200则加载新页面）
        // 配合版本检查机制：版本变更时onCreate清缓存，确保更新生效
        // 效果：版本匹配时秒开，页面有更新时自动加载最新版本
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        // 启用硬件加速，提升页面渲染性能
        webView.setLayerType(View.LAYER_TYPE_HARDWARE, null);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        settings.setJavaScriptEnabled(true);

        // S1: 关闭文件访问权限（APP 通过 server.url 远程加载云端页面，不需要访问本地文件系统）
        // 默认值在部分旧版本为 true，显式关闭可防止 XSS 读取 file:// 资源
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        // 禁止 HTTPS 页面加载 HTTP 资源（防止混合内容攻击）
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setTextZoom(100);

        // LOAD_NO_CACHE 模式下不需要启动时清缓存，每次加载都从网络获取
        webView.clearHistory();

        // 设置WebChromeClient，确保prompt/alert/confirm弹框正常工作
        webView.setWebChromeClient(new WebChromeClient() {
            // 授权摄像头和麦克风权限（录像拍照功能需要）
            @Override
            public void onPermissionRequest(PermissionRequest request) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                    for (String permission : request.getResources()) {
                        if (permission.equals(PermissionRequest.RESOURCE_VIDEO_CAPTURE) ||
                            permission.equals(PermissionRequest.RESOURCE_AUDIO_CAPTURE)) {
                            request.grant(request.getResources());
                            return;
                        }
                    }
                    request.deny();
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

            // 加载进度回调：实时更新loading文字显示百分比，让用户感知加载进度
            @Override
            public void onProgressChanged(WebView view, int newProgress) {
                super.onProgressChanged(view, newProgress);
                if (loadingText != null && loadingLayout != null && loadingLayout.getVisibility() == View.VISIBLE) {
                    if (newProgress < 100) {
                        loadingText.setText("正在加载云端处方系统 " + newProgress + "%");
                    } else {
                        loadingText.setText("正在加载云端处方系统...");
                    }
                }
            }
        });

        // 添加 JavaScript 接口，供网页调用退出 APP（点击"退出"按钮时直接返回手机主屏）
        webView.addJavascriptInterface(new Object() {
            @android.webkit.JavascriptInterface
            public void exit() {
                // 必须在主线程执行，且用 finishAndRemoveTask 确保真正退出到桌面
                // postAtFrontOfQueue 插入队列最前面，比 runOnUiThread 更快
                mainHandler.postAtFrontOfQueue(() -> {
                    finishAndRemoveTask();
                });
            }
        }, "AndroidAppExit");

        // 注入 NativeBridge：提供 savePrescriptionImage/saveVideoFile 等原生保存能力
        // 录像拍照功能通过此桥接将文件保存到本地文件系统（按月份分类 YYYY-MM）
        webView.addJavascriptInterface(new NativeBridge(), "AndroidNative");

        webView.setWebViewClient(new WebViewClient() {
            private boolean urlChecked = false;

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                // S3: URL 白名单校验，非云端域名的导航一律拦截
                String url = request.getUrl().toString();
                if (url.contains(CLOUD_HOST)) {
                    return false; // 允许加载
                }
                return true; // 拦截非云端导航，防止重定向到钓鱼站点
            }

            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) {
                super.onPageStarted(view, url, favicon);
                // 优化：有缓存时不显示loading（避免缓存加载时闪烁）
                // 只有首次启动/版本更新（无缓存）时才显示loading
                if (loadingLayout != null && loadingLayout.getVisibility() != View.GONE) {
                    // 检查是否已有缓存
                    android.content.SharedPreferences cachePrefs = getSharedPreferences("app_config", MODE_PRIVATE);
                    String cachedVersion = cachePrefs.getString("page_version", "");
                    if (!cachedVersion.equals(EXPECTED_APP_VERSION)) {
                        loadingLayout.setVisibility(View.VISIBLE);
                    }
                }
                if (!urlChecked && url != null && !url.contains(CLOUD_HOST)) {
                    urlChecked = true;
                    // 立即重定向到云端URL，不延迟（不添加时间戳，允许缓存）
                    view.loadUrl(CLOUD_URL);
                }
            }

            // API 23+：页面内容首次可见时调用，比 onPageFinished 更早
            // 此时页面已渲染出基本内容，提前隐藏loading让用户立即看到页面
            @Override
            public void onPageCommitVisible(WebView view, String url) {
                super.onPageCommitVisible(view, url);
                mainHandler.post(() -> {
                    if (loadingLayout != null) {
                        loadingLayout.setVisibility(View.GONE);
                    }
                });
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                int statusBarHeightPx = getStatusBarHeightPx();
                float density = getResources().getDisplayMetrics().density;
                int cssPx = (int) (statusBarHeightPx / density);
                view.evaluateJavascript("window.__STATUS_BAR_HEIGHT__ = " + cssPx + ";", null);

                // 记录页面版本到本地（供下次启动时 onCreate 版本检查使用）
                // 注意：不在onPageFinished中reload，避免双重加载导致启动变慢
                // 版本不匹配时的清缓存在下次启动的onCreate中处理
                if (!versionChecked && url != null && url.contains(CLOUD_HOST)) {
                    versionChecked = true;
                    view.evaluateJavascript("(window.__APP_VERSION__ || 'unknown')", value -> {
                        String pageVersion = value != null ? value.replace("\"", "") : "unknown";
                        android.content.SharedPreferences prefs = getSharedPreferences("app_config", MODE_PRIVATE);
                        prefs.edit().putString("page_version", pageVersion).apply();
                        Log.d("TCM-Pres", "页面版本: " + pageVersion + " (expected: " + EXPECTED_APP_VERSION + ")");
                    });
                }

                // 先隐藏loading，让用户立即看到页面
                mainHandler.post(() -> {
                    if (loadingLayout != null) {
                        loadingLayout.setVisibility(View.GONE);
                    }
                });

                // 布局修复脚本立即注入（体积小，影响UI布局）
                mainHandler.post(() -> injectLayoutFixScript(view));

                // 录像拍照脚本延迟到页面渲染稳定后注入（避免40KB脚本同步执行阻塞UI）
                // 300ms 是经验值：足够 React 完成首屏渲染，又不至于让用户感觉录像功能迟钝
                mainHandler.postDelayed(() -> injectVideoRecorderScript(view), 300);
            }

            // T3: 网络错误处理，避免白屏
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

            // S2: HTTPS 证书校验，防止中间人攻击
            @Override
            public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
                // 任何 SSL 错误都直接取消，不弹窗让用户决定
                // Cloudflare 证书稳定，出错说明可能被劫持，宁可不可用也不冒险
                handler.cancel();
            }
        });
    }

    /**
     * T3: 显示本地错误页（网络异常时避免白屏）
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
            "<h2>网络异常</h2>" +
            "<p>无法连接到服务器，请检查网络连接后重试</p>" +
            "<button onclick=\"location.href='" + CLOUD_URL + "?t=' + Date.now()\">重新加载</button>" +
            "</body></html>";
        webView.loadDataWithBaseURL(CLOUD_URL, errorHtml, "text/html", "UTF-8", null);
    }

    /**
     * dp 转 px
     */
    private int dpToPx(int dp) {
        float density = getResources().getDisplayMetrics().density;
        return (int) (dp * density + 0.5f);
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
                Log.d("TCM-Pres", "录像拍照脚本预加载完成，长度: " + cachedVideoRecorderScript.length());
            } catch (Exception e) {
                Log.e("TCM-Pres", "录像拍照脚本预加载失败", e);
            }
        }, "preload-vr-script").start();
    }

    /**
     * 同步读取录像拍照脚本（带缓存）
     * 优先使用预加载缓存，未命中则同步读取并缓存
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
            Log.d("TCM-Pres", "录像拍照脚本同步加载完成，长度: " + cachedVideoRecorderScript.length());
        } catch (Exception e) {
            Log.e("TCM-Pres", "录像拍照脚本同步加载失败", e);
            cachedVideoRecorderScript = "";
        }
        return cachedVideoRecorderScript;
    }

    /**
     * 注入录像拍照功能脚本（使用内存缓存，避免每次IO）
     * 脚本包含：electronAPI shim、录像/拍照 overlay、本地保存逻辑
     * 注：注入逻辑采用懒加载策略，shim 立即注入，样式和按钮延迟到首次打开overlay时
     */
    private void injectVideoRecorderScript(WebView webView) {
        String script = getVideoRecorderScript();
        if (script == null || script.isEmpty()) {
            Log.e("TCM-Pres", "录像拍照脚本为空，跳过注入");
            return;
        }
        webView.evaluateJavascript(script, null);
        Log.d("TCM-Pres", "录像拍照脚本注入成功");
    }

    private boolean hasDoneFirstResume = false;

    @Override
    public void onResume() {
        super.onResume();
        WebView webView = this.getBridge().getWebView();
        if (webView != null) {
            WebSettings settings = webView.getSettings();
            // LOAD_DEFAULT: 与 onCreate 保持一致，优先缓存但向服务器验证
            settings.setCacheMode(WebSettings.LOAD_DEFAULT);
            settings.setDomStorageEnabled(true);
            settings.setDatabaseEnabled(true);
            settings.setLoadWithOverviewMode(true);
            settings.setUseWideViewPort(true);
            settings.setJavaScriptEnabled(true);
            settings.setAllowFileAccess(false);
            settings.setAllowContentAccess(false);
            settings.setAllowFileAccessFromFileURLs(false);
            settings.setAllowUniversalAccessFromFileURLs(false);
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);

            if (hasDoneFirstResume) {
                // 非首次恢复：通过JS触发页面内同步逻辑（SyncEngine+药品刷新），不整页reload避免丢失编辑状态
                mainHandler.postDelayed(() -> {
                    if (webView != null) {
                        webView.evaluateJavascript(
                            "(function(){" +
                            "  window._layoutFixInjected = false;" +
                            "  if (typeof window.__onAppResume === 'function') { window.__onAppResume(); }" +
                            "})();", null);
                        injectLayoutFixScript(webView);
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
    //   图片：Pictures/本能中医处方/YYYY-MM/患者姓名_处方编号_photo.png
    //   视频：Movies/本能中医处方/YYYY-MM/患者姓名_处方编号_video.webm
    // ========================================================================
    public class NativeBridge {

        @JavascriptInterface
        public String invoke(String name, String jsonStr) {
            try {
                JSONObject args = new JSONObject(jsonStr);
                switch (name) {
                    case "savePrescriptionImage":
                        return savePrescriptionImage(args.optString("imageData", ""),
                                args.optString("fileName", "")).toString();
                    case "saveVideoFile":
                        return saveVideoFile(args.optString("base64Data", ""),
                                args.optString("fileName", "")).toString();
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
                    case "renameMediaFiles":
                        return renameMediaFiles(args.optString("patientName", ""),
                                args.optString("oldNo", ""),
                                args.optString("newNo", "")).toString();
                    case "deleteFile":
                        return deleteFile(args.optString("filePath", "")).toString();
                    default:
                        return fail("unknown method: " + name).toString();
                }
            } catch (Exception e) {
                Log.e("TCM-Pres", "invoke " + name + " 失败", e);
                return fail(e.getMessage()).toString();
            }
        }

        // ------------------------------------------------------------------
        // 处方图片：写入 Pictures/本能中医处方/YYYY-MM/ 目录
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
                Log.e("TCM-Pres", "savePrescriptionImage 失败", e);
                return fail(e.getMessage());
            }
        }

        // ------------------------------------------------------------------
        // 视频文件：写入 Pictures/本能中医处方/YYYY-MM/ 目录（与图片同目录，方便导出）
        // ------------------------------------------------------------------
        private JSONObject saveVideoFile(String base64Data, String fileName) {
            try {
                byte[] bytes = Base64.decode(base64Data, Base64.DEFAULT);

                String safeName = sanitize(fileName);
                if (safeName.isEmpty()) {
                    safeName = "video_" + System.currentTimeMillis() + ".webm";
                }
                if (!safeName.endsWith(".webm")) {
                    String base = safeName.replaceAll("\\.[^.]+$", "");
                    safeName = base + ".webm";
                }

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
                Log.e("TCM-Pres", "saveVideoFile 失败", e);
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
                Log.e("TCM-Pres", "getVideoDirectory 失败", e);
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
                Log.e("TCM-Pres", "saveBackupFile 失败", e);
                return fail(e.getMessage());
            }
        }

        // ------------------------------------------------------------------
        // 工具方法
        // ------------------------------------------------------------------
        private File getImageDir() {
            File dir;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                dir = new File(getExternalFilesDir(Environment.DIRECTORY_PICTURES), "本能中医处方");
            } else {
                File pictures = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES);
                dir = new File(pictures, "本能中医处方");
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
                dir = new File(getExternalFilesDir(Environment.DIRECTORY_MOVIES), "本能中医处方");
            } else {
                File movies = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_MOVIES);
                dir = new File(movies, "本能中医处方");
            }
            if (!dir.exists() && !dir.mkdirs()) {
                dir = new File(getFilesDir(), "prescription_videos");
                if (!dir.exists()) dir.mkdirs();
            }
            return dir;
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
                        new String[]{file.getName().endsWith(".webm") ? "video/webm" : (file.getName().endsWith(".jpg") || file.getName().endsWith(".jpeg")) ? "image/jpeg" : "image/png"},
                        null);
            }
        }

        private String sanitize(String name) {
            if (name == null) return "";
            return name.replaceAll("[\\\\/:*?\"<>|]", "_").trim();
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
                
                File imgDir = getImageDir();
                File vidDir = getVideoDir();
                
                java.util.Set<String> foundPaths = new java.util.HashSet<>();
                
                scanDirForMediaWithPrefixes(imgDir, prefix1, prefix2, files, foundPaths);
                scanDirForMediaWithPrefixes(vidDir, prefix1, prefix2, files, foundPaths);
                
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
                debug.append("prefix1=").append(prefix1);
                debug.append(" | prefix2=").append(prefix2);
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
                        fileObj.put("type", fileName.endsWith(".webm") ? "video" : "image");
                        fileObj.put("size", f.length());
                        fileObj.put("lastModified", lastMod);
                        files.put(fileObj);
                    } catch (Exception e) {
                        Log.e("TCM-Pres", "添加文件信息失败: " + fileName, e);
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
                        fileObj.put("type", f.getName().endsWith(".webm") ? "video" : "image");
                        fileObj.put("size", f.length());
                        fileObj.put("lastModified", f.lastModified());
                        files.put(fileObj);
                    } catch (Exception e) {
                        Log.e("TCM-Pres", "添加文件信息失败: " + f.getName(), e);
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
                            fileObj.put("type", fileName.endsWith(".webm") ? "video" : "image");
                            fileObj.put("size", f.length());
                            fileObj.put("lastModified", f.lastModified());
                            files.put(fileObj);
                        } catch (Exception e) {
                            Log.e("TCM-Pres", "添加文件信息失败: " + fileName, e);
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
                if (mimeType == null || mimeType.isEmpty()) {
                    if (filePath.endsWith(".webm")) mimeType = "video/webm";
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
                // 支持两种命名格式：姓名_编号 和 编号_姓名
                String[] oldPrefixes = {safeName + "_" + safeOldNo, safeOldNo + "_" + safeName};
                String[] newPrefixes = {safeName + "_" + safeNewNo, safeNewNo + "_" + safeName};
                JSONArray renamedFiles = new JSONArray();
                int renamed = 0;
                for (int i = 0; i < oldPrefixes.length; i++) {
                    renamed += renameFilesInDir(getImageDir(), oldPrefixes[i], newPrefixes[i], renamedFiles);
                    renamed += renameFilesInDir(getVideoDir(), oldPrefixes[i], newPrefixes[i], renamedFiles);
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
                                Log.e("TCM-Pres", "记录重命名信息失败", e);
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
                if (file.delete()) {
                    JSONObject result = new JSONObject();
                    result.put("success", true);
                    return result;
                } else {
                    return fail("删除文件失败");
                }
            } catch (Exception e) {
                Log.e("TCM-Pres", "deleteFile 失败", e);
                return fail("删除文件失败: " + e.getMessage());
            }
        }
    }
}
