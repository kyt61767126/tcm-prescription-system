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
# P2-4: 安全混淆增强（与云端 APP 一致）
# ============================================================================
# 允许修改访问修饰符，增加反编译难度
-allowaccessmodification

# 合并相同的类，减少类数量
-mergeinterfacesaggressively

# 优化重载（修改方法参数类型和数量，增加混淆强度）
-overloadaggressively

# ============================================================================
# JavaScript 接口（WebView JS 调用）
# ============================================================================
# 旧规则过度保留 public *，R8 full mode 下仅保留 @JavascriptInterface 方法即可
# MainActivity lifecycle 方法由 Android framework 自动保留
# SecurityGuard 单独保留，NativeBridge 的 JS 方法由下方规则覆盖
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
