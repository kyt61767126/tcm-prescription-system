package com.benneng.pres;

import static org.junit.Assert.*;

import org.json.JSONObject;
import org.junit.Before;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

import java.io.File;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.List;

/**
 * ★ 2026-09-14 离线APP 静默热更新 Phase 2a 单元测试（HotUpdateManager 纯逻辑层）。
 *
 * fixture（src/test/resources/hotupdate-fixture.json）由 tools/gen-hotupdate-test-fixture.cjs
 * 用真实私钥签发生成 → 本测试用 Java 侧验签 = Node 签发 ↔ Java 验签的跨实现
 * 交叉验证（协议互通终极证明）。确定性签名 → fixture 可 diff 入库，CI 无私钥可跑。
 *
 * 覆盖面（对齐桌面端 smoke-hot-update.cjs 语义）：
 *   ① buildSignMessage 规范化（与生成工具逐字符一致）
 *   ② 真实签名验签通过 / 篡改负例 ×6（版本/哈希/签名/渠道/路径穿越/字段类型）
 *   ③ 版本比较：同版本 STALE / signedAt 不更新 STALE / 首次(null) 不算 STALE
 *   ④ minAppCode 门禁：低于 → NEED_APK；等于 → OK
 *   ⑤ resolveEntry：好目录（含子目录）→ 入口路径；文件篡改 → null + 隔离现场
 *   ⑥ Ed25519 数学正确性（独立向量，绕开常量）
 *   ⑦ Base64 / hex / sha256 工具（含非法输入 fail-null 与已知向量）
 *   ⑧ ★ Layer 1 本地回退（2026-09-16，对齐桌面 smoke 用例 8-11）：黑名单（去重/
 *      FIFO 上限 5）/ verifyHotDir / rollbackLocal（previous 恢复 / builtin 兜底 /
 *      no-current）/ resolveEntry 黑名单自动恢复 / getActiveHotState
 */
public class HotUpdateManagerTest {

    @Rule
    public TemporaryFolder tmp = new TemporaryFolder();

    private JSONObject fixtureManifest;
    private JSONObject fixtureContents;
    private JSONObject fixtureVector;
    // ★ Layer 1：更旧版本（rollbackLocal 的 previous 目标；黑名单拉黑版本号，
    //   previous 与 current 必须不同版本才能测「恢复后递归复验通过」链路）
    private JSONObject fixtureManifestPrev;
    private JSONObject fixtureContentsPrev;

    private static JSONObject loadFixture() throws Exception {
        InputStream in = HotUpdateManagerTest.class
                .getClassLoader().getResourceAsStream("hotupdate-fixture.json");
        assertNotNull("fixture 资源缺失（先跑 node tools/gen-hotupdate-test-fixture.cjs）", in);
        java.io.ByteArrayOutputStream bos = new java.io.ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        while ((n = in.read(buf)) > 0) bos.write(buf, 0, n);
        in.close();
        return new JSONObject(new String(bos.toByteArray(), StandardCharsets.UTF_8));
    }

    @Before
    public void setUp() throws Exception {
        JSONObject fixture = loadFixture();
        fixtureManifest = fixture.getJSONObject("manifest");
        fixtureContents = fixture.getJSONObject("fileContents");
        fixtureManifestPrev = fixture.getJSONObject("manifestPrev");
        fixtureContentsPrev = fixture.getJSONObject("fileContentsPrev");
        fixtureVector = fixture.getJSONObject("ed25519Vector");
        HotUpdateManager.setLogger(new HotUpdateManager.Logger() {
            @Override public void log(String msg) { System.out.println("[hot-test] " + msg); }
            @Override public void warn(String msg) { System.out.println("[hot-test][W] " + msg); }
        });
    }

    private JSONObject manifestCopy() throws Exception {
        return new JSONObject(fixtureManifest.toString());
    }

    // 在 hotDir/<dirName> 下按指定 manifest+contents 搭建版本目录（current/previous 通用）
    private void buildVersionDir(File hotDir, String dirName,
                                 JSONObject manifest, JSONObject contents) throws Exception {
        File dir = new File(hotDir, dirName);
        assertTrue(dir.mkdirs());
        java.util.Iterator<String> it = contents.keys();
        while (it.hasNext()) {
            String name = it.next();
            File f = new File(dir, name);
            File parent = f.getParentFile();
            if (parent != null && !parent.isDirectory()) assertTrue(parent.mkdirs());
            try (java.io.FileOutputStream out = new java.io.FileOutputStream(f)) {
                out.write(contents.getString(name).getBytes(StandardCharsets.UTF_8));
            }
        }
        try (java.io.FileOutputStream out = new java.io.FileOutputStream(
                new File(dir, "manifest.json"))) {
            out.write(manifest.toString().getBytes(StandardCharsets.UTF_8));
        }
    }

    // 在临时目录里按 fixture 搭建 current 热目录（文件 + manifest.json）
    private File buildHotDir() throws Exception {
        return buildHotDir("hot-update");
    }

    private File buildHotDir(String dirName) throws Exception {
        File hotDir = tmp.newFolder(dirName);
        buildVersionDir(hotDir, "current", fixtureManifest, fixtureContents);
        return hotDir;
    }

    // 写 .hot-version（模拟 swap 后的本机生效版本记录）
    private void writeHotVersion(File hotDir, String hotVersion, long signedAt) throws Exception {
        JSONObject v = new JSONObject();
        v.put("hotVersion", hotVersion);
        v.put("signedAt", signedAt);
        try (java.io.FileOutputStream out = new java.io.FileOutputStream(
                new File(hotDir, ".hot-version"))) {
            out.write(v.toString().getBytes(StandardCharsets.UTF_8));
        }
    }

    private String readHotVersion(File hotDir) throws Exception {
        File f = new File(hotDir, ".hot-version");
        if (!f.isFile()) return null;
        return new JSONObject(new String(
                java.nio.file.Files.readAllBytes(f.toPath()), StandardCharsets.UTF_8))
                .optString("hotVersion", null);
    }

    private boolean hasQuarantine(File hotDir) {
        File[] children = hotDir.listFiles();
        if (children == null) return false;
        for (File c : children) {
            if (c.getName().startsWith("quarantine-")) return true;
        }
        return false;
    }

    // ======================================================================
    //  ① buildSignMessage 规范化
    // ======================================================================

    @Test
    public void buildSignMessage_matchesGeneratorFormat() throws Exception {
        List<HotUpdateManager.HotFile> files = HotUpdateManager.parseFiles(fixtureManifest);
        assertNotNull(files);
        // 手拼期望（与 tools/gen-hotupdate-test-fixture.cjs 同构逐字符一致）
        StringBuilder expect = new StringBuilder("app-hotupdate-v1|app-local|2026.09.14-1|1730000000000");
        for (HotUpdateManager.HotFile f : files) {
            expect.append('|').append(f.name).append(':').append(f.sha256).append(':').append(f.size);
        }
        String msg = HotUpdateManager.buildSignMessage("app-local", "2026.09.14-1",
                1730000000000L, files);
        assertEquals("签名消息须与生成工具逐字符一致", expect.toString(), msg);
    }

    // ======================================================================
    //  ② 真实签名验签 + 篡改负例
    // ======================================================================

    @Test
    public void verifyManifest_realSignature_crossVerifiedWithNode() throws Exception {
        // localAppCode=287 == minAppCode=287 → OK；localHotVersion=null → 首次不算 STALE
        int r = HotUpdateManager.verifyManifest(manifestCopy(), null, 0L, 287);
        assertEquals("Node 签发真实 manifest 须验签通过（跨实现交叉验证）",
                HotUpdateManager.VERIFY_OK, r);
    }

    @Test
    public void verifyManifest_tamperedHotVersion_rejected() throws Exception {
        JSONObject m = manifestCopy();
        m.put("hotVersion", "2026.09.14-9");
        assertEquals(HotUpdateManager.VERIFY_BAD,
                HotUpdateManager.verifyManifest(m, null, 0L, 287));
    }

    @Test
    public void verifyManifest_tamperedFileHash_rejected() throws Exception {
        JSONObject m = manifestCopy();
        m.getJSONArray("files").getJSONObject(0).put("sha256", "0");
        assertEquals(HotUpdateManager.VERIFY_BAD,
                HotUpdateManager.verifyManifest(m, null, 0L, 287));
    }

    @Test
    public void verifyManifest_forgedSignature_rejected() throws Exception {
        JSONObject m = manifestCopy();
        m.put("signature", "Zm9yZ2VkLXNpZ25hdHVyZQ=="); // "forged-signature" 的 base64
        assertEquals(HotUpdateManager.VERIFY_BAD,
                HotUpdateManager.verifyManifest(m, null, 0L, 287));
    }

    @Test
    public void verifyManifest_desktopChannel_rejected() throws Exception {
        // 协议绑定：桌面端 channel（local/cloud）热包喂 APP 必须拒绝
        JSONObject m = manifestCopy();
        m.put("channel", "local");
        assertEquals(HotUpdateManager.VERIFY_BAD,
                HotUpdateManager.verifyManifest(m, null, 0L, 287));
    }

    @Test
    public void verifyManifest_pathTraversalFileName_rejected() throws Exception {
        // parseFiles 白名单在验签前拦截（纵深防御：即使验签实现出 bug 也不允许穿越）
        JSONObject m = manifestCopy();
        JSONObject ef = new JSONObject();
        ef.put("name", "../../evil.js");
        ef.put("sha256", "0000000000000000000000000000000000000000000000000000000000000000");
        ef.put("size", 1);
        m.getJSONArray("files").put(ef);
        assertEquals(HotUpdateManager.VERIFY_BAD,
                HotUpdateManager.verifyManifest(m, null, 0L, 287));
    }

    @Test
    public void verifyManifest_badSignedAtType_rejected() throws Exception {
        JSONObject m = manifestCopy();
        m.put("signedAt", "not-a-number");
        assertEquals(HotUpdateManager.VERIFY_BAD,
                HotUpdateManager.verifyManifest(m, null, 0L, 287));
    }

    // ======================================================================
    //  ③ 版本比较
    // ======================================================================

    @Test
    public void verifyManifest_sameVersion_stale() throws Exception {
        assertEquals(HotUpdateManager.VERIFY_STALE,
                HotUpdateManager.verifyManifest(manifestCopy(), "2026.09.14-1", 1730000000000L, 287));
    }

    @Test
    public void verifyManifest_olderSignedAt_stale() throws Exception {
        // 本地 signedAt 更新（1730000001000 > 1730000000000）→ 远端不更新 → STALE
        assertEquals(HotUpdateManager.VERIFY_STALE,
                HotUpdateManager.verifyManifest(manifestCopy(), "2026.09.14-1", 1730000001000L, 287));
    }

    @Test
    public void verifyManifest_firstTime_neverStale() throws Exception {
        // localHotVersion=null（首次）→ 不算 STALE
        assertEquals(HotUpdateManager.VERIFY_OK,
                HotUpdateManager.verifyManifest(manifestCopy(), null, 1730000009000L, 287));
    }

    // ======================================================================
    //  ④ minAppCode 门禁
    // ======================================================================

    @Test
    public void verifyManifest_apkTooOld_needsApk() throws Exception {
        assertEquals(HotUpdateManager.VERIFY_NEED_APK,
                HotUpdateManager.verifyManifest(manifestCopy(), null, 0L, 286));
    }

    @Test
    public void verifyManifest_apkEqualMin_ok() throws Exception {
        assertEquals(HotUpdateManager.VERIFY_OK,
                HotUpdateManager.verifyManifest(manifestCopy(), null, 0L, 287));
    }

    @Test
    public void verifyManifest_resolvePath_skipsAppCodeGate() throws Exception {
        // resolveEntry 复验不检查版本/minAppCode（localAppCode 传 0 → 跳过 minAppCode
        // 分支）——只做验签+完整性
        assertEquals(HotUpdateManager.VERIFY_OK,
                HotUpdateManager.verifyManifest(manifestCopy(), null, 0L, 0));
    }

    // ======================================================================
    //  ⑤ resolveEntry（启动复验 + 隔离回退）
    // ======================================================================

    @Test
    public void resolveEntry_validHotDir_returnsEntryWithSubdir() throws Exception {
        File hotDir = buildHotDir();
        String entry = HotUpdateManager.resolveEntry(hotDir);
        assertNotNull("合法热目录须返回入口", entry);
        assertTrue(entry.endsWith("current" + File.separator + "index.html"));
        assertTrue(new File(entry).isFile());
        assertTrue("子目录文件须复验通过（vendor/xlsx.full.min.js 在清单内）",
                new File(new File(entry).getParentFile(), "vendor/xlsx.full.min.js").isFile());
    }

    @Test
    public void resolveEntry_noManifest_returnsNull() throws Exception {
        File hotDir = tmp.newFolder("hot-empty");
        assertNull(HotUpdateManager.resolveEntry(hotDir));
    }

    @Test
    public void resolveEntry_tamperedFile_quarantinedAndFallback() throws Exception {
        File hotDir = buildHotDir();
        // 篡改清单内文件（追加字节 → 哈希失配）
        File victim = new File(hotDir, "current/prescription-core.js");
        try (java.io.FileOutputStream out = new java.io.FileOutputStream(victim, true)) {
            out.write("<!-- tampered -->".getBytes(StandardCharsets.UTF_8));
        }
        String entry = HotUpdateManager.resolveEntry(hotDir);
        assertNull("文件被篡改后入口不信任", entry);
        File[] children = hotDir.listFiles();
        boolean hasQuarantine = false;
        if (children != null) {
            for (File c : children) {
                if (c.getName().startsWith("quarantine-")) hasQuarantine = true;
            }
        }
        assertTrue("坏热目录须隔离留现场（quarantine-*）", hasQuarantine);
        assertFalse("current 须已不存在（下次启动走 assets 打包版）",
                new File(hotDir, "current").exists());
    }

    @Test
    public void resolveEntry_missingEntryFile_quarantined() throws Exception {
        File hotDir = buildHotDir();
        assertTrue(new File(hotDir, "current/index.html").delete());
        assertNull(HotUpdateManager.resolveEntry(hotDir));
        assertFalse(new File(hotDir, "current").exists());
    }

    // ======================================================================
    //  ⑥ Ed25519 数学正确性（独立向量：私钥导出公钥 + 空消息）
    // ======================================================================

    @Test
    public void ed25519_emptyMessageVector_verifies() throws Exception {
        byte[] pub = HotUpdateManager.hexToBytes(fixtureVector.getString("publicKeyHex"));
        byte[] sig = HotUpdateManager.base64Decode(fixtureVector.getString("signatureBase64"));
        byte[] msg = fixtureVector.getString("message").getBytes(StandardCharsets.UTF_8);
        assertNotNull(pub);
        assertNotNull(sig);
        assertEquals(32, pub.length);
        assertEquals(64, sig.length);
        // ★ 独立向量与 HOT_ED25519_PUBLIC_KEY_HEX 常量同源（同一把私钥导出）
        assertEquals("向量公钥须与常量同源", HotUpdateManager.HOT_ED25519_PUBLIC_KEY_HEX,
                HotUpdateManager.toHexLower(pub));
        assertTrue("Ed25519 空消息向量须验签通过（Java 数学实现正确性）",
                HotUpdateManager.Ed25519.verify(pub, msg, sig));
    }

    @Test
    public void ed25519_tamperedMessage_rejected() throws Exception {
        byte[] pub = HotUpdateManager.hexToBytes(fixtureVector.getString("publicKeyHex"));
        byte[] sig = HotUpdateManager.base64Decode(fixtureVector.getString("signatureBase64"));
        byte[] msg = "tampered".getBytes(StandardCharsets.UTF_8);
        assertFalse(HotUpdateManager.Ed25519.verify(pub, msg, sig));
    }

    @Test
    public void ed25519_shortKey_rejected() {
        byte[] pub = new byte[31];
        byte[] sig = new byte[64];
        assertFalse(HotUpdateManager.Ed25519.verify(pub, new byte[0], sig));
    }

    // ======================================================================
    //  ⑦ Base64 / hex / sha256 工具
    // ======================================================================

    @Test
    public void base64Decode_stdRoundtrip() throws Exception {
        byte[] out = HotUpdateManager.base64Decode("SGVsbG8=");
        assertNotNull(out);
        assertEquals("Hello", new String(out, StandardCharsets.UTF_8));
        // 88 chars（64 字节签名的 base64 形态）
        byte[] sig = HotUpdateManager.base64Decode(fixtureVector.getString("signatureBase64"));
        assertNotNull(sig);
        assertEquals(64, sig.length);
    }

    @Test
    public void base64Decode_illegalInput_returnsNull() {
        assertNull("非法字符", HotUpdateManager.base64Decode("a*b"));
        assertNull("长度余 1", HotUpdateManager.base64Decode("abcde"));
        assertNull("null", HotUpdateManager.base64Decode(null));
        assertNull("空串", HotUpdateManager.base64Decode(""));
        assertNull("4 个 pad", HotUpdateManager.base64Decode("===="));
    }

    @Test
    public void hexToBytes_roundtrip() {
        byte[] b = HotUpdateManager.hexToBytes("0a1B2c");
        assertNotNull(b);
        assertEquals(3, b.length);
        assertEquals("0a1b2c", HotUpdateManager.toHexLower(b));
        assertNull(HotUpdateManager.hexToBytes("abc"));      // 奇数长度
        assertNull(HotUpdateManager.hexToBytes("zz"));       // 非 hex 字符
    }

    @Test
    public void sha256_fileAndBytesConsistent() throws Exception {
        byte[] data = "sha256 consistency check 数据含中文".getBytes(StandardCharsets.UTF_8);
        File f = tmp.newFile("sha.txt");
        try (java.io.FileOutputStream out = new java.io.FileOutputStream(f)) {
            out.write(data);
        }
        assertEquals("文件流式哈希须与内存哈希一致",
                HotUpdateManager.sha256Hex(data), HotUpdateManager.sha256Hex(f));
        // 已知向量：SHA-256("abc") 标准值
        assertEquals("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
                HotUpdateManager.sha256Hex("abc".getBytes(StandardCharsets.UTF_8)));
    }

    // ======================================================================
    //  ⑧ ★ Layer 1 本地回退（2026-09-16；对齐桌面 smoke-hot-update.cjs 用例 8-11）
    // ======================================================================

    @Test
    public void blacklist_emptyOrMissing_readsEmpty() throws Exception {
        File hotDir = tmp.newFolder("hot-bl-empty");
        assertTrue("无黑名单文件 = 空表", HotUpdateManager.readBlacklist(hotDir).isEmpty());
        assertFalse(HotUpdateManager.isBlacklisted(hotDir, "2026.09.14-1"));
        assertFalse("null/空版本永不命中", HotUpdateManager.isBlacklisted(hotDir, null));
    }

    @Test
    public void blacklist_addDetect_dedup_fifo() throws Exception {
        File hotDir = tmp.newFolder("hot-bl");
        HotUpdateManager.addToBlacklist(hotDir, "v-a", 1L, "t");
        assertTrue("写入后须命中", HotUpdateManager.isBlacklisted(hotDir, "v-a"));
        assertFalse(HotUpdateManager.isBlacklisted(hotDir, "v-b"));
        // 去重：同版本重复拉黑不产生第二条
        HotUpdateManager.addToBlacklist(hotDir, "v-a", 2L, "t2");
        assertEquals(1, HotUpdateManager.readBlacklist(hotDir).size());
        // FIFO 上限 5：再加 5 条共 6 → 最旧的 v-a 被淘汰
        for (int i = 0; i < 5; i++) {
            HotUpdateManager.addToBlacklist(hotDir, "v-" + (char) ('b' + i), (long) i, "t");
        }
        List<String> bl = HotUpdateManager.readBlacklist(hotDir);
        assertEquals("上限 5 条", 5, bl.size());
        assertFalse("最旧条目须被 FIFO 淘汰", bl.contains("v-a"));
        assertTrue(bl.contains("v-f"));
    }

    @Test
    public void verifyHotDir_validAndTampered() throws Exception {
        File hotDir = buildHotDir();
        File current = new File(hotDir, "current");
        assertTrue("合法目录（manifest 验签+入口+逐文件哈希）须通过",
                HotUpdateManager.verifyHotDir(current, fixtureManifest));
        // 篡改清单内文件 → 哈希失配
        try (java.io.FileOutputStream out = new java.io.FileOutputStream(
                new File(current, "prescription-core.js"), true)) {
            out.write("<!-- tampered -->".getBytes(StandardCharsets.UTF_8));
        }
        assertFalse("文件篡改后须复验失败",
                HotUpdateManager.verifyHotDir(current, fixtureManifest));
        assertFalse("null manifest 直接失败",
                HotUpdateManager.verifyHotDir(current, null));
    }

    @Test
    public void rollbackLocal_goodPrevious_restoresPrevious() throws Exception {
        // 场景：current=v2(2026.09.14-1) 出问题，previous=v1(2026.09.13-1) 完好
        File hotDir = buildHotDir();
        buildVersionDir(hotDir, "previous", fixtureManifestPrev, fixtureContentsPrev);
        writeHotVersion(hotDir, "2026.09.14-1", 1730000000000L);

        HotUpdateManager.RollbackResult r = HotUpdateManager.rollbackLocal(hotDir, "test");
        assertTrue(r.ok);
        assertEquals("previous 复验通过须晋升 current", "previous", r.restored);
        assertEquals("2026.09.13-1", r.hotVersion);

        // 坏 v2 拉黑留档，v1 不受牵连
        assertTrue(HotUpdateManager.isBlacklisted(hotDir, "2026.09.14-1"));
        assertFalse(HotUpdateManager.isBlacklisted(hotDir, "2026.09.13-1"));
        // v1 晋升 current、previous 消费掉、坏 v2 隔离留现场
        assertEquals("2026.09.13-1", readHotVersion(hotDir));
        assertFalse(new File(hotDir, "previous").exists());
        assertTrue("坏 current 须隔离留现场", hasQuarantine(hotDir));
        // 恢复后的 current 走完整 resolveEntry 复验通过（Layer 1 核心链路）
        String entry = HotUpdateManager.resolveEntry(hotDir);
        assertNotNull("恢复的 previous 须通过启动复验", entry);
        assertTrue(entry.endsWith("current" + File.separator + "index.html"));
    }

    @Test
    public void rollbackLocal_noPrevious_fallsBackToBuiltin() throws Exception {
        // 场景：current=v2 出问题且无 previous → 回 assets 打包版（清 .hot-version）
        File hotDir = buildHotDir();
        writeHotVersion(hotDir, "2026.09.14-1", 1730000000000L);

        HotUpdateManager.RollbackResult r = HotUpdateManager.rollbackLocal(hotDir, "test");
        assertTrue(r.ok);
        assertEquals("无 previous 须回 assets 兜底", "builtin", r.restored);
        assertTrue(HotUpdateManager.isBlacklisted(hotDir, "2026.09.14-1"));
        assertFalse("current 须已隔离消失", new File(hotDir, "current").exists());
        assertTrue(hasQuarantine(hotDir));
        assertNull(".hot-version 须清除（下次启动走 assets）", readHotVersion(hotDir));
        assertNull("resolveEntry 须返回 null（调用方回 assets）",
                HotUpdateManager.resolveEntry(hotDir));
        assertFalse("登录页入口探测须为 false", HotUpdateManager.getActiveHotState(hotDir));
    }

    @Test
    public void rollbackLocal_badPrevious_fallsBackToBuiltin() throws Exception {
        // 场景：previous 也被篡改 → 复验失败跳过恢复，直接回 assets 兜底
        File hotDir = buildHotDir();
        buildVersionDir(hotDir, "previous", fixtureManifestPrev, fixtureContentsPrev);
        try (java.io.FileOutputStream out = new java.io.FileOutputStream(
                new File(hotDir, "previous/prescription-core.js"), true)) {
            out.write("<!-- tampered -->".getBytes(StandardCharsets.UTF_8));
        }

        HotUpdateManager.RollbackResult r = HotUpdateManager.rollbackLocal(hotDir, "test");
        assertTrue(r.ok);
        assertEquals("坏 previous 不得晋升，须回 assets 兜底", "builtin", r.restored);
        assertFalse(new File(hotDir, "current").exists());
        // 坏 previous 保留留现场（与桌面端语义一致：只告警不删；下次 swap 前
        // checkUpdateAsync 的 deleteTree(previous) 会清理，不会污染后续链路）
        assertTrue(new File(hotDir, "previous").exists());
        assertNull(HotUpdateManager.resolveEntry(hotDir));
    }

    @Test
    public void rollbackLocal_noCurrent_fails() throws Exception {
        File hotDir = tmp.newFolder("hot-nocur");
        HotUpdateManager.RollbackResult r = HotUpdateManager.rollbackLocal(hotDir, "test");
        assertFalse("无 current 须失败（无可回退）", r.ok);
        assertEquals("no-current", r.reason);
    }

    @Test
    public void resolveEntry_blacklistedCurrent_autoRestoresPrevious() throws Exception {
        // 场景：rollbackLocal 半途中断等残局——v2 已拉黑但仍霸占 current
        //   → resolveEntry 须自动本地回退到 v1 并递归复验通过
        File hotDir = buildHotDir();
        buildVersionDir(hotDir, "previous", fixtureManifestPrev, fixtureContentsPrev);
        HotUpdateManager.addToBlacklist(hotDir, "2026.09.14-1", 1730000000000L, "test");
        // 前置确认：黑名单版本在效（登录页入口探测 false）
        assertFalse(HotUpdateManager.getActiveHotState(hotDir));

        String entry = HotUpdateManager.resolveEntry(hotDir);
        assertNotNull("黑名单 current 须自动回退恢复 previous", entry);
        assertEquals("恢复后生效版本须为 v1", "2026.09.13-1", readHotVersion(hotDir));
        assertTrue(hasQuarantine(hotDir));
        assertFalse("恢复的 v1 须在效", HotUpdateManager.isBlacklisted(hotDir, "2026.09.13-1"));
    }

    @Test
    public void getActiveHotState_scenarios() throws Exception {
        // 好 current → true（登录页「回退上一版」入口显示的判据）
        assertTrue(HotUpdateManager.getActiveHotState(buildHotDir("hot-good")));
        // 无 current → false
        assertFalse(HotUpdateManager.getActiveHotState(tmp.newFolder("hot-none")));
        // current 验签失败（篡改 manifest）→ false
        File hotDir = buildHotDir("hot-badsig");
        JSONObject m = manifestCopy();
        m.put("hotVersion", "2026.09.14-9");  // 破坏签名
        try (java.io.FileOutputStream out = new java.io.FileOutputStream(
                new File(hotDir, "current/manifest.json"))) {
            out.write(m.toString().getBytes(StandardCharsets.UTF_8));
        }
        assertFalse("验签失败须视为不在效", HotUpdateManager.getActiveHotState(hotDir));
    }
}
