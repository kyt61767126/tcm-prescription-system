package com.tcm.prescription;

import android.app.Application;
import android.content.Context;
import android.os.Looper;
import android.util.Log;
import android.webkit.WebView;

import androidx.annotation.NonNull;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewStartUpConfig;
import androidx.webkit.WebViewStartUpResult;

import java.util.concurrent.Executor;

/**
 * ★ 2026-10-04 批次D·D3：WebView 进程级预热。
 *
 * 冷启动中首次 WebView 初始化（加载系统 WebView provider、装载 Chromium native 库、
 * 拉起共享 browser 进程）真机 150~400ms，原本压在 MainActivity 主线程
 * configureWebView() 阶段，推迟首屏。本类在 Application.onCreate 即刻把这段进程级
 * 一次性初始化放到与启动流程并行的后台执行，主线程随后创建真实 WebView 时初始化
 * 通常已经完成；未完成时 provider 内部自带全局锁，并发首建只会等待同一初始化完成，
 * 不会重复初始化。
 *
 * 两条路径（安全评审 M1 整改）：
 * 1) androidx.webkit 1.14.0 的 WebViewCompat.startUpWebView 官方 API——不构造实例、
 *    不涉及非 UI 线程 Looper 建 WebView 的兼容性问题；该 compat API 无需特性常量
 *    门控（1.14 中无 STARTUP_API 常量），旧 provider 上内部自动退化为普通启动，
 *    回调仅有 onSuccess 且一定会被调用。必须跑 UI 线程的启动任务用
 *    setShouldRunUiThreadStartUpTasks(false) 推迟到真实首建（避免抢占启动期主线程）。
 * 2) 官方调用本身抛异常的极端环境，回退到"带 Looper 后台线程创建一次性实例后
 *    destroy"的既定做法：实例只用 Application Context、不加载 URL、同线程 destroy，
 *    随后 Looper.loop() 承接 Chromium 清理消息（线程空闲零 CPU、daemon 不拖进程退出）。
 * 全程 fail-open：任何失败仅日志，MainActivity 行为与未预热时完全一致。
 */
public class StartupApplication extends Application {

    private static final String TAG = "StartupApplication";

    @Override
    public void onCreate() {
        super.onCreate();
        try {
            final Context appContext = getApplicationContext();
            Executor backgroundExecutor = new Executor() {
                @Override
                public void execute(Runnable command) {
                    Thread t = new Thread(command, "wv-prewarm");
                    t.setDaemon(true);
                    t.start();
                }
            };

            // 1.14.0 真实签名：startUpWebView(Context, WebViewStartUpConfig,
            // WebViewCompat.WebViewStartUpCallback)，回调只有 onSuccess。
            WebViewStartUpConfig config = new WebViewStartUpConfig.Builder(backgroundExecutor)
                    .setShouldRunUiThreadStartUpTasks(false)
                    .build();
            WebViewCompat.startUpWebView(appContext, config,
                    new WebViewCompat.WebViewStartUpCallback() {
                        @Override
                        public void onSuccess(@NonNull WebViewStartUpResult result) {
                            Log.d(TAG, "D3 WebView 官方预热完成（startUpWebView，"
                                    + "uiThreadTotalMs=" + result.getTotalTimeInUiThreadMillis()
                                    + ", uiThreadMaxTaskMs=" + result.getMaxTimePerTaskInUiThreadMillis()
                                    + ", blockingLocations="
                                    + result.getBlockingStartUpLocations().size() + "）");
                        }
                    });
        } catch (Throwable e) {
            Log.w(TAG, "D3 官方预热调用失败，回退后台线程实例预热（不影响启动）: "
                    + e.getMessage());
            legacyWarmUp(getApplicationContext());
        }
    }

    /** 旧 provider/异常环境回退：后台 Looper 线程创建一次性 WebView 触发进程级初始化。 */
    private void legacyWarmUp(final Context appContext) {
        Thread t = new Thread(() -> {
            Looper.prepare();
            WebView warm = null;
            try {
                warm = new WebView(appContext);
                Log.d(TAG, "D3 WebView 回退预热完成（后台线程）");
            } catch (Throwable e) {
                Log.w(TAG, "D3 回退预热失败（忽略，主线程将按原路径初始化）: "
                        + e.getMessage());
            } finally {
                if (warm != null) {
                    try {
                        warm.destroy();
                    } catch (Throwable ignore) {
                        // 丢弃实例失败不影响真实 WebView
                    }
                }
            }
            // 保活：承接 Chromium 后续清理消息，之后永久空闲
            Looper.loop();
        }, "wv-prewarm-legacy");
        t.setDaemon(true);
        t.start();
    }
}
