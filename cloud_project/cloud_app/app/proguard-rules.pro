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
#         SecurityGuard 单独保留，NativeBridge 的 JS 方法由下方规则覆盖
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
