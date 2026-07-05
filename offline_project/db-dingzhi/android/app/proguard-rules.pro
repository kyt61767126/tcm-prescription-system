# ============================================================================
# ProGuard / R8 优化规则
# ============================================================================

# 保留行号信息，便于崩溃日志分析
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# 保留泛型签名
-keepattributes Signature
-keepattributes InnerClasses
-keepattributes EnclosingMethod

# 保留注解（反射依赖）
-keepattributes RuntimeVisibleAnnotations
-keepattributes RuntimeInvisibleAnnotations

# ============================================================================
# JavaScript 接口（WebView JS 调用）
# ============================================================================
-keepclassmembers class com.benneng.pres.** {
    public *;
}
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# ============================================================================
# AndroidX
# ============================================================================
-keep class com.google.android.material.** { *; }
-dontwarn com.google.android.material.**

# ============================================================================
# 缺失类警告抑制
# ============================================================================
-dontwarn com.google.errorprone.annotations.**
-dontwarn javax.annotation.**

# ============================================================================
# 优化选项
# ============================================================================
-dontpreverify
-ignorewarnings
-verbose
