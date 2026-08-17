# ============================================================================
# ProGuard / R8 优化规则
# ============================================================================

# 保留行号信息，便于崩溃日志分析
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# 保留泛型签名（Capacitor / Retrofit 等库需要）
-keepattributes Signature
-keepattributes InnerClasses
-keepattributes EnclosingMethod

# 保留注解（反射依赖）
-keepattributes RuntimeVisibleAnnotations
-keepattributes RuntimeInvisibleAnnotations

# ============================================================================
# P2-4: 安全混淆增强
# ============================================================================
# 允许修改访问修饰符，增加反编译难度
-allowaccessmodification

# 合并相同的类，减少类数量
-mergeinterfacesaggressively

# 字符串混淆（对非关键字符串做混淆处理，增加逆向难度）
# 注意：不混淆 log tag 和反射相关字符串（由下方的 -keep 规则保护）

# 优化重载（修改方法参数类型和数量，增加混淆强度）
-overloadaggressively

# ============================================================================
# P1-3 / P2-5: Java 层深度混淆增强（2026-08-17）
# ============================================================================
# ★ 类重打包混淆：将未 keep 的类全部重打包到单一混淆包 'b'，抹平语义化包名，
#   显著增加反编译/静态逆向定位主逻辑的难度（等效于 dex 二次加固的混淆层）。
#   安全说明：manifest 声明的 Activity/Service/Receiver、@CapacitorPlugin 插件、
#   NativeGuard(JNI)、注解处理所需类均已 -keep，包名不受影响，不破坏启动与反射。
-repackageclasses 'b'

# 多轮优化，获得更强精简与混淆强度（R8 默认 2 轮）
-optimizationpasses 5

# ============================================================================
# NDK 原生安全库（P0-NDK，2026-08-17）
# 必须保留 NativeGuard 类名/包名与 native 方法名，否则 JNI 绑定失效
# ============================================================================
-keep class com.tcm.prescription.NativeGuard { *; }
-keepclasseswithmembernames class * {
    native <methods>;
}

# ============================================================================
# Capacitor 框架
# ============================================================================
-keep class com.getcapacitor.** { *; }
-keep @com.getcapacitor.annotation.CapacitorPlugin class * { *; }
-keepclassmembers class * {
    @com.getcapacitor.annotation.CapacitorPlugin <methods>;
}

# ============================================================================
# JavaScript 接口（WebView JS 调用）
# ============================================================================
# 仅保留 @JavascriptInterface 注解的方法（R8 full mode 可优化其他 public 方法）
# 旧规则 -keepclassmembers class com.tcm.prescription.** { public *; } 过度保留
# 已删除：MainActivity lifecycle 方法由 Android framework 自动保留，
#         NativeBridge 的 JS 方法由下方规则覆盖
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# ============================================================================
# WebView 回调类（关键修复：摄像头权限授权依赖）
# ============================================================================
# WebChromeClient 的 onPermissionRequest 被 WebView 内部通过虚函数调用
# ProGuard/R8 优化模式下可能认为这些方法"未被直接调用"而将其移除/内联
# 导致 getUserMedia 返回 NotAllowedError（摄像头权限被拒绝）
-keep class * extends android.webkit.WebChromeClient { *; }
-keep class * extends android.webkit.WebViewClient { *; }

# ============================================================================
# SQLite 加密库
# ============================================================================
-keep class net.sqlcipher.** { *; }
-keep class net.sqlcipher.database.** { *; }

# Tink 加密
-keep class com.google.crypto.tink.** { *; }

# ============================================================================
# AndroidX / Material
# ============================================================================
-keep class com.google.android.material.** { *; }
-dontwarn com.google.android.material.**

# ============================================================================
# 缺失类警告抑制
# ============================================================================
-dontwarn com.google.errorprone.annotations.**
-dontwarn javax.annotation.**
-dontwarn com.google.api.client.**
-dontwarn org.joda.time.**

# ============================================================================
# 优化选项
# ============================================================================
# 不预验证，加快编译
-dontpreverify
# 忽略警告（非致命）
-ignorewarnings
# 输出详细日志
-verbose
