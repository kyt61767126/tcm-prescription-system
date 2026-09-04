package com.benneng.pres;

import org.json.JSONObject;

/**
 * ★ 2026-09-04 AR-03 自动化测试缺口修复：
 *   把 installAdminLicense 之后"立即自验 license.dat + 失败覆盖 success=false"的
 *   核心判定从 MainActivity 私有回调抽为纯静态工具方法 —— 依赖反转，不依赖
 *   Android Context / LicenseManager 实例化，JUnit 在 host 侧直接能测。
 *
 *   背景（与 KNOWLEDGE §1 / §2 一致：缺口层最小改动，不跨层大修）：
 *     2026-09-04 P0 修复：MainActivity.installAdminLicense 原设计缺陷——自验失败时
 *     success 仍为 true → 只写 warning → JS 层显示激活成功 → 用户重启后 license.dat
 *     实际 invalid → 弹原生"前往激活" → 死循环。2026-09-04 第二轮写了 success=false
 *     覆盖，但这段逻辑在 BridgePluginHandler 私有方法内部（深嵌 Activity），无法
 *     写 JUnit，只能靠手工点一遍华为 P40 → 未来再有人把 success=false 改坏，编译
 *     全绿但业务又炸。
 *
 *   设计原则（按 §2.4 缺口层改动）：
 *     - 零依赖：不 import android.*、不 new LicenseManager、不碰文件系统
 *     - 纯函数：输入(installResult, validateResult) 输出 JSONObject，无副作用
 *     - 失败语义：与 2026-09-04 P0 修复完全对齐 —— 当且仅当
 *         a) installResult.success == true AND b) validateResult.valid != true
 *       才覆盖：success=false + error(包含 message+type) + verifyType + verifyDetail
 *     - 放行语义(不改动)：install 已失败 → 原样返回；validate 返回 null 也进入失败
 *       覆盖(与原代码 optString("message","未知") / type="unknown" 一致)。
 *
 *   调用方式：MainActivity 里替换 10 行 if 为 LicenseInstallValidator.applySelfVerify(...)
 *   单元测试：src/test/java/com/benneng/pres/LicenseInstallValidatorTest.java（4 用例）
 */
public final class LicenseInstallValidator {

    private LicenseInstallValidator() {}

    /**
     * 许可证安装后自验（缺口层纯函数，供 JUnit 直接覆盖）
     *
     * @param installResult   LicenseManager.installAdminLicense() 的原始返回（允许 null）
     * @param validateResult  LicenseManager.validateLicense(machineId) 的原始返回（允许 null）
     *                        正常应至少有 optBoolean("valid") + optString("message") +
     *                        optString("type")；缺失项按"unknown/验证返回 null"兜底(与原
     *                        MainActivity 自验代码完全对齐)。
     * @return JSONObject（绝不会 null）
     *         - 如果 installResult 本身 success=false → 原样返回（null 时返回 fail 占位）
     *         - 如果 install success=true 且 validate.valid=true → 原样放行（不做任何修改）
     *         - 如果 install success=true 但 validate.valid != true → 覆盖 success=false
     *           并追加 error / verifyType / verifyDetail 三个字段（原行为精确复刻）
     */
    public static JSONObject applySelfVerify(JSONObject installResult, JSONObject validateResult)
            throws org.json.JSONException {
        if (installResult == null) {
            JSONObject empty = new JSONObject();
            empty.put("success", false);
            empty.put("error", "installAdminLicense 返回空");
            return empty;
        }

        // --- 放行条件：install 本身已经失败（走原 fail 分支） ---
        final boolean installOk = installResult.optBoolean("success", false);
        if (!installOk) return installResult;

        // --- 安装成功 → 做自验（与 MainActivity 原 L2488-2499 完全对齐） ---
        final boolean valid = validateResult != null && validateResult.optBoolean("valid", false);
        if (valid) return installResult; // ✅ 自验通过：原样返回

        // ❌ 自验失败 → 覆盖 success=false（与原代码逐字段一致）
        final String verifyMsg = (validateResult != null)
                ? validateResult.optString("message", "未知")
                : "验证返回 null";
        final String verifyType = (validateResult != null)
                ? validateResult.optString("type", "unknown")
                : "unknown";
        installResult.put("success", false);
        installResult.put("error",
                "激活数据写入成功但验证失败: " + verifyMsg + "（type=" + verifyType + "）");
        installResult.put("verifyType", verifyType);
        installResult.put("verifyDetail", verifyMsg);
        return installResult;
    }
}
