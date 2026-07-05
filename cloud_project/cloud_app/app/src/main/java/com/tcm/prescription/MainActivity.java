package com.tcm.prescription;

import android.graphics.Bitmap;
import android.net.http.SslError;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Window;
import android.view.ViewGroup;
import android.webkit.JsPromptResult;
import android.webkit.JsResult;
import android.webkit.SslErrorHandler;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    // ============ 常量配置 ============
    // S3: 云端域名常量化，统一管理避免硬编码散落多处
    private static final String CLOUD_HOST = "tcm-prescription-system.pages.dev";
    private static final String CLOUD_URL = "https://" + CLOUD_HOST;
    // P3: 原生层期望的网页版本号，与 index.html 中 window.__APP_VERSION__ 保持同步
    // 修改云端逻辑后需同步更新此值与 index.html 中的版本号
    private static final String EXPECTED_APP_VERSION = "2026-07-05-v3";
    // T1: WebView 就绪轮询上限（30 次 × 100ms = 3 秒），避免无限循环且更快检测就绪
    private static final int MAX_WEBVIEW_READY_RETRIES = 30;
    private static final int WEBVIEW_READY_DELAY_MS = 100;

    private Handler mainHandler;
    private int webViewReadyRetries = 0;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // 只隐藏标题栏，不使用FLAG_FULLSCREEN（会导致内容延伸到状态栏下面）
        requestWindowFeature(Window.FEATURE_NO_TITLE);

        super.onCreate(savedInstanceState);

        // T5: 使用主线程 Looper 的 Handler，便于 onDestroy 统一清理
        mainHandler = new Handler(Looper.getMainLooper());

        // 立即配置 WebView，不延迟，加快启动速度
        configureWebView();
    }

    private void configureWebView() {
        WebView webView = this.getBridge().getWebView();
        if (webView == null) {
            // T1: 加最大重试次数，避免 WebView 一直为 null 时无限循环
            webViewReadyRetries++;
            if (webViewReadyRetries <= MAX_WEBVIEW_READY_RETRIES) {
                mainHandler.postDelayed(this::configureWebView, WEBVIEW_READY_DELAY_MS);
            }
            return;
        }

        WebSettings settings = webView.getSettings();
        // LOAD_NO_CACHE: 不使用本地缓存，每次都从网络加载最新版本
        // 彻底解决版本校验 reload 导致的闪动问题（用户要求一次性解决）
        settings.setCacheMode(WebSettings.LOAD_NO_CACHE);
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

        // LOAD_NO_CACHE 模式下不需要启动时清缓存，每次加载都从网络获取
        webView.clearHistory();

        // 设置WebChromeClient，确保prompt/alert/confirm弹框正常工作
        webView.setWebChromeClient(new WebChromeClient() {
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
                mainHandler.postAtFrontOfQueue(() -> {
                    finishAndRemoveTask();
                });
            }
        }, "AndroidAppExit");

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
                // S3: 检查加载的URL是否是云端URL（允许带查询参数）
                if (!urlChecked && url != null && !url.contains(CLOUD_HOST)) {
                    urlChecked = true;
                    // 加载的不是云端URL，强制加载云端URL（带时间戳绕过缓存）
                    mainHandler.postDelayed(() -> {
                        view.loadUrl(CLOUD_URL + "?" + System.currentTimeMillis());
                    }, 100);
                }
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                // 注入状态栏高度（CSS px），供布局修正使用
                int statusBarHeightPx = getStatusBarHeightPx();
                float density = getResources().getDisplayMetrics().density;
                int cssPx = (int) (statusBarHeightPx / density);
                view.evaluateJavascript("window.__STATUS_BAR_HEIGHT__ = " + cssPx + ";", null);

                // 立即注入布局修正（必须最先执行）
                injectLayoutFixScript(view);

                // LOAD_NO_CACHE 模式下，每次都从网络加载最新版本，不需要版本校验 reload
                // 彻底避免 onPageFinished 中版本不匹配触发的闪动问题
                // 离线逻辑已迁移至云端网页 index.html（LocalDB + SyncEngine），原生层不再注入离线脚本
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

    private boolean hasDoneFirstResume = false;

    @Override
    public void onResume() {
        super.onResume();
        WebView webView = this.getBridge().getWebView();
        if (webView != null) {
            WebSettings settings = webView.getSettings();
            // LOAD_NO_CACHE: 从后台恢复时也不使用缓存，与 onCreate 保持一致
            settings.setCacheMode(WebSettings.LOAD_NO_CACHE);
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
}
