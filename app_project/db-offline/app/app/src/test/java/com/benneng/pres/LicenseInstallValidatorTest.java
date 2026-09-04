package com.benneng.pres;

import static org.junit.Assert.*;

import org.json.JSONObject;
import org.junit.Test;

/**
 * ★ 2026-09-04 AR-03 自动化测试覆盖（缺口层：LicenseInstallValidator.applySelfVerify）
 *   风险等级=低；影响范围=未来回归测试/CI 每次跑 Gradle test 都会校验一遍
 *   installAdminLicense 自验失败 → success=false 没有被手滑删改。
 *
 *   4 条用例覆盖 2026-09-04 P0 修复的全部语义分支：
 *     ① TC1: install ok, validate ok          → 原样放行 success=true  (不改动)
 *     ② TC2: install ok, validate invalid+型  → success=false, error含 type, verifyType注入
 *     ③ TC3: install ok, validate null        → success=false, "验证返回 null", verifyType=unknown
 *     ④ TC4: install failed, validate 任意    → 原样返回原 success=false (不自验短路)
 */
public class LicenseInstallValidatorTest {

    // --- TC1: 正常成功路径 —— 自验不应该改 success ---
    @Test
    public void applySelfVerify_installOk_validateOk_passesThroughUnchanged() throws Exception {
        JSONObject inst = new JSONObject();
        inst.put("success", true);
        inst.put("edition", "offline_pro");
        inst.put("note", "原附加字段应保留");

        JSONObject v = new JSONObject();
        v.put("valid", true);
        v.put("message", "授权有效到 2027-09-04");

        JSONObject out = LicenseInstallValidator.applySelfVerify(inst, v);

        assertTrue("TC1 success 应仍为 true", out.optBoolean("success", false));
        assertEquals("TC1 edition 原字段保留", "offline_pro", out.optString("edition"));
        assertEquals("TC1 note 原字段保留", "原附加字段应保留", out.optString("note"));
        assertFalse("TC1 不应注入 verifyType", out.has("verifyType"));
        assertFalse("TC1 不应注入 error 字段（自验通过）", out.has("error") &&
                out.optString("error").startsWith("激活数据写入成功但验证失败"));
    }

    // --- TC2: install 成功但自验 invalid —— 必须覆盖 success=false + 注入 3 字段 ---
    @Test
    public void applySelfVerify_installOk_validateInvalid_marksFailed() throws Exception {
        JSONObject inst = new JSONObject();
        inst.put("success", true);
        inst.put("warning", "旧实现只有 warning 不拦业务");

        JSONObject v = new JSONObject();
        v.put("valid", false);
        v.put("type", "SIGNATURE_BROKEN");
        v.put("message", "HMAC 校验失败(licensemanager.dat 内容被篡改)");

        JSONObject out = LicenseInstallValidator.applySelfVerify(inst, v);

        // ★ 核心断言：2026-09-04 P0 修复的目标——success=false（原设计缺陷会留 true）
        assertFalse("TC2 success 必须被覆盖为 false(P0 根因修复)",
                out.optBoolean("success", true));

        // ★ verifyType 字段必须注入（JS 层 offline.js L4500 showErr 会把它打印到 desc 里，
        //   客服一看到 SIGNATURE_BROKEN 就知道 license.dat 损坏 → 不走"客户重装"流程）
        assertEquals("TC2 verifyType=SIGNATURE_BROKEN",
                "SIGNATURE_BROKEN", out.optString("verifyType"));
        assertEquals("TC2 verifyDetail=原 message",
                "HMAC 校验失败(licensemanager.dat 内容被篡改)",
                out.optString("verifyDetail"));

        String err = out.optString("error");
        assertTrue("TC2 error 字段须包含原始 message", err.contains("HMAC 校验失败"));
        assertTrue("TC2 error 字段须包含 type 值", err.contains("SIGNATURE_BROKEN"));
        assertTrue("TC2 原 warning 字段仍保留(便于调试)", out.has("warning"));
    }

    // --- TC3: validate 返回 null（license.dat 完全写不进去 / 文件系统只读） ---
    @Test
    public void applySelfVerify_installOk_validateNull_marksFailedWithUnknown() throws Exception {
        JSONObject inst = new JSONObject();
        inst.put("success", true);

        JSONObject out = LicenseInstallValidator.applySelfVerify(inst, null);

        assertFalse("TC3 validate=null 也必须 success=false",
                out.optBoolean("success", true));
        assertEquals("TC3 verifyType=unknown 兜底",
                "unknown", out.optString("verifyType"));
        assertEquals("TC3 verifyDetail=验证返回 null 兜底",
                "验证返回 null", out.optString("verifyDetail"));
        assertTrue("TC3 error 字段包含'验证返回 null'",
                out.optString("error").contains("验证返回 null"));
    }

    // --- TC4: install 本身已经失败（如 installAdminLicense 内部抛异常）---
    @Test
    public void applySelfVerify_installFailed_returnsInstallResultDirectly() throws Exception {
        JSONObject inst = new JSONObject();
        inst.put("success", false);
        inst.put("error", "license.dat 写入失败: /sdcard 权限不足");
        inst.put("code", "WRITE_FAILED");

        // 即使 validate 返回 invalid，也不应该走自验覆盖分支（install 已失败）
        JSONObject v = new JSONObject();
        v.put("valid", false);
        v.put("type", "EXPIRED");
        v.put("message", "授权已过期");

        JSONObject out = LicenseInstallValidator.applySelfVerify(inst, v);

        assertFalse("TC4 success 仍是 false（原 install 失败）",
                out.optBoolean("success", true));
        assertEquals("TC4 error 字段是 install 原错误（不自验覆盖写）",
                "license.dat 写入失败: /sdcard 权限不足",
                out.optString("error"));
        assertEquals("TC4 code 原字段保留",
                "WRITE_FAILED", out.optString("code"));
        // ★ 关键：不自验覆盖 → verifyType 字段不应注入（没有覆盖动作发生）
        assertFalse("TC4 install 已失败时不应注入 verifyType(短路语义)",
                out.has("verifyType"));
    }

    // --- TC5(extra): installResult=null → 不 NPE，返回 fail 占位 ---
    @Test
    public void applySelfVerify_installNull_noNpeAndMarksFailed() throws Exception {
        JSONObject out = LicenseInstallValidator.applySelfVerify(null, null);
        assertNotNull("TC5 对 null 输入不返回 null", out);
        assertFalse("TC5 null install → success=false",
                out.optBoolean("success", true));
        assertTrue("TC5 error 说明 install 返回空",
                out.optString("error").contains("返回空"));
    }
}
