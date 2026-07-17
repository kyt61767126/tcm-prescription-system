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
# 安全防护类（方案二：反调试 + 完整性校验 + 签名校验）
# 必须保留所有方法，防止 R8 优化删除看似未使用的安全检查
# ============================================================================
-keep class com.benneng.pres.SecurityGuard { *; }

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
