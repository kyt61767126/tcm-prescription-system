package com.tcm.prescription;

import android.app.Application;

/**
 * ★ 2026-10-06 P0 止血（云 APK build 314）：D3 WebView 进程预热已永久停用于本类。
 *
 * 事故：build 313（2026-10-05 批次D）在本类 onCreate 中调用
 * WebViewCompat.startUpWebView 做进程级预热，华为/荣耀机型（含部分鸿蒙/老 EMUI、
 * 系统 WebView provider 被禁用或多用户切换等异常环境）上在 Application 初始化阶段
 * 触发 native abort——进程在 MainActivity 创建前即被系统杀死，用户点图标看到的是
 * "立刻闪退回桌面、无任何界面、登录框完全不显示"；native 崩溃 Java 层
 * UncaughtExceptionHandler 抓不到，crash_logs 也无记录。
 *
 * 处置：AndroidManifest 已注销本类（无 android:name），release R8 收缩后本类不进
 * dex，启动路径与 build 311（已大规模验证）完全一致。D3 仅为 150~400ms 启动提速，
 * 零功能依赖，停用无功能损失。
 *
 * 恢复前置条件（缺一不可）：① 华为/荣耀（鸿蒙+EMUI 新老各一）、小米、OPPO/vivo、
 * 原生模拟器全系真机冷启动回归通过，含 WebView provider 停用/多用户/低版本 Android
 * 场景；② 回退路径禁止在非 UI 线程 new WebView（老 ROM 上同样 native abort）；
 * ③ 重新在 Manifest 注册并版号递增发版。
 */
public class StartupApplication extends Application {
    // 故意为空：Manifest 已注销，本类不会被实例化；保留文件仅为事故记录与恢复入口。
}
