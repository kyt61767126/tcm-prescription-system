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
-keepclassmembers class com.tcm.prescription.** {
    public *;
}
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# ============================================================================
# 安全防护类（方案二：反调试 + 完整性校验 + 签名校验）
# 必须保留所有方法，防止 R8 优化删除看似未使用的安全检查
# ============================================================================
-keep class com.tcm.prescription.SecurityGuard { *; }

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
