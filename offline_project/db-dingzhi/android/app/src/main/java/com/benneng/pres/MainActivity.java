package com.benneng.pres;

import android.Manifest;
import android.app.Activity;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
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
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;

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
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private ValueCallback<Uri[]> filePathCallback;
    private static final int REQ_FILE_CHOOSER = 1002;

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
        setContentView(webView);
        getWindow().setBackgroundDrawable(null);
        configureWebView();
    }

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
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
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
            }
        });

        webView.loadUrl(LOCAL_INDEX);
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
            "    findMediaFiles: function(patientName, prescriptionNo){" +
            "      return new Promise(function(resolve){" +
            "        try { var r = callNative('findMediaFiles', JSON.stringify({patientName:patientName,prescriptionNo:prescriptionNo})); resolve(r); }" +
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
            "    quitApp: function(){ N.quitApp(); return P({success:true}); }" +
            "  };" +
            "  window.IS_ELECTRON = true;" +
            "})();";
        view.evaluateJavascript(js, null);
    }

    @Override
    public void onBackPressed() {
        if (webView != null) {
            webView.evaluateJavascript("handleAndroidBack()", new ValueCallback<String>() {
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
    // JavaScript 接口
    // ========================================================================
    public class NativeBridge {

        @JavascriptInterface
        public String invoke(String name, String jsonStr) {
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
                    case "getVideoDirectory":
                        return getVideoDirectory().toString();
                    case "findMediaFiles":
                        return findMediaFiles(args.optString("patientName", ""),
                                args.optString("prescriptionNo", "")).toString();
                    case "openFile":
                        return openFile(args.optString("filePath", ""),
                                args.optString("mimeType", "")).toString();
                    case "readFileAsBase64":
                        return readFileAsBase64(args.optString("filePath", "")).toString();
                    case "renameMediaFiles":
                        return renameMediaFiles(args.optString("patientName", ""),
                                args.optString("oldNo", ""),
                                args.optString("newNo", "")).toString();
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
                    safeName = "prescription_" + System.currentTimeMillis() + ".png";
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
                Log.e(TAG, "saveVideoFile 失败", e);
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
                dir = new File(getFilesDir(), "videos");
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
                String mimeType = "application/json";
                if (file.getName().endsWith(".png")) {
                    mimeType = "image/png";
                } else if (file.getName().endsWith(".jpg") || file.getName().endsWith(".jpeg")) {
                    mimeType = "image/jpeg";
                } else if (file.getName().endsWith(".webm")) {
                    mimeType = "video/webm";
                }
                android.media.MediaScannerConnection.scanFile(
                        getApplicationContext(),
                        new String[]{file.getAbsolutePath()},
                        new String[]{mimeType},
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
                r.put("error", msg != null ? msg : "unknown error");
                return r;
            } catch (Exception e) {
                return new JSONObject();
            }
        }

        private JSONObject findMediaFiles(String patientName, String prescriptionNo) {
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
                String prefix = safeName + "_" + safeNo;
                File imgDir = getImageDir();
                File vidDir = getVideoDir();
                scanDirForMedia(imgDir, prefix, files);
                scanDirForMedia(vidDir, prefix, files);
                StringBuilder debug = new StringBuilder();
                debug.append("prefix=").append(prefix);
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
                return fail("查找媒体文件失败: " + e.getMessage());
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
