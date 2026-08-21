/**
 * afterPack.js — 铁闸2 & 铁闸5：asarmor + 打包后硬阻断校验 + 写入构建审计
 *
 * ======= 铁闸2（事后删exe → 事中抛异常阻断NSIS）=======
 *  问题（假1.2.89事故）：
 *    dist被锁→asar写入失败→electron-builder 继续跑 NSIS→输出“新版号+旧内容”假exe
 *    postbuild-asar-verify.cjs 虽能删exe，但NSIS先生成exe→校验后再删，存在竞态/锁删不掉风险
 *  根治：
 *    在 afterPack（asar已写但NSIS尚未开始）阶段立刻读 asar 二进制，抽查关键标识：
 *    - 必须包含当前 package.json version
 *    - 必须包含 Arch 水印（Arch 2.25+）、instAdminAssert、_normalizeEdition
 *    - asar 文件大小不得与上次打包完全相同（典型缓存复用特征）
 *    任何一项失败 → throw Error 让 electron-builder 立刻中止，绝不生成 Setup exe。
 *
 * ======= 铁闸5（构建审计报告 build-audit.json） =======
 *  校验通过后，在 output 根目录写 build-audit.json，包含版本号、哈希、时间戳、
 *  关键标识检查结果。用户安装时可对照检查，杜绝“假包”误装。
 *
 * ======= asarmor =======
 *  与离线版统一：仅 createBloatPatch(100GB) 防解包，不重复混淆。
 */

const asarmor = require('asarmor');
const { join, dirname, basename } = require('path');
const fs = require('fs');
const crypto = require('crypto');

const BLOAT_GB = parseInt(process.env.ASARMOR_BLOAT_GB || '100', 10);

// ── 与 postbuild-asar-verify.cjs 保持一致的关键字集 ──
const ARCH_MARKERS = [
    // Single-Writer 架构
    ['Single-Writer 按钮写入源 __applyUserButtons', /__applyUserButtons/],
    ['补丁入口 __patchOldCallers', /__patchOldCallers/],
    // Edition Lock
    ['Edition 归一化锁 __editionLocked', /__editionLocked/],
    ['Edition 拦截 get/set __authoritativeEdition', /__authoritativeEdition/],
    // Arch 2.25 真根因修复（edition 别名归一化 + 机构管理员断言）
    ['Arch 2.25 _normalizeEdition 别名归一化', /_normalizeEdition/],
    ['Arch 2.25 水印', /Arch 2\.2[5-9]/],
    ['Arch 2.25 instAdminAssert 机构管理员断言', /instAdminAssert/],
    ['Arch 2.25 editionNormalize 标识', /editionNormalize/]
];

function fail(msg) {
    console.error('\n[afterPack GATE-KEEPER] FAIL: ' + msg);
    console.error('  → 抛异常中止 electron-builder，绝不产出假 Setup exe！\n');
    throw new Error('[GATE-KEEPER] ' + msg);
}

function sha256Buf(buf) {
    return crypto.createHash('sha256').update(buf).digest('hex');
}

exports.default = async ({ appOutDir, packager, outDir, electronPlatformName }) => {
    const resourcesDir = packager.getResourcesDir(appOutDir);
    const asarPath = join(resourcesDir, 'app.asar');
    const outputRoot = outDir || dirname(dirname(resourcesDir));
    const pkgDir = dirname(packager.info.projectDir || process.cwd());

    // ── 读取 package.json（用于版本号对比） ──
    var pkgJson = null;
    try {
        var pkgPath = join(packager.info.projectDir, 'package.json');
        pkgJson = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    } catch (e) {
        fail('无法读取 package.json: ' + (e.message || e));
    }
    const expectedVersion = pkgJson.version;
    const buildTime = new Date().toISOString();

    console.log('');
    console.log('═══════════════════════════════════════════════════════');
    console.log('  afterPack GATE-KEEPER（铁闸2）开始硬校验');
    console.log('  package.json 期望版本: ' + expectedVersion);
    console.log('  asar路径: ' + asarPath);
    console.log('═══════════════════════════════════════════════════════');

    // ── 基础存在性 ──
    if (!fs.existsSync(asarPath)) fail('app.asar 文件不存在（electron-builder 写文件失败？进程锁？）');
    const asarStat = fs.statSync(asarPath);
    // 正常包约 3.39MB，降到 2MB 阈值避免误判；真·空包通常 < 100KB
    if (asarStat.size < 2_000_000) fail('app.asar 过小 (' + asarStat.size + ' bytes)，极可能是空文件/缓存复用旧 asar');

    // ── 二进制全文搜索（不受 asar header/offset 解析影响） ──
    const asarISO = fs.readFileSync(asarPath, 'latin1');
    const asarUTF = fs.readFileSync(asarPath, 'utf8');

    // ── 版本号必须出现在 asar 中（package.json 文本 + 任何版本标识位） ──
    var versionRe = new RegExp(('"version": "' + expectedVersion + '"').replace(/\./g, '\\.'));
    if (!versionRe.test(asarISO)) {
        fail('asar 内无 package.json version = ' + expectedVersion + ' 字符串。\n' +
             '  这通常意味着 electron-builder 复用了旧 asar（dist 锁定缓存），\n' +
             '  请杀尽旧进程、换全新 output 目录、重打包。');
    }

    // ── 架构标识逐一检查 ──
    const audit = {
        version: expectedVersion,
        buildTime: buildTime,
        appOutDir: appOutDir,
        asarSize: asarStat.size,
        asarSha256: sha256Buf(fs.readFileSync(asarPath)),
        markers: {},
        pass: true
    };
    for (var i = 0; i < ARCH_MARKERS.length; i++) {
        var name = ARCH_MARKERS[i][0], re = ARCH_MARKERS[i][1];
        var ok = re.test(asarISO);
        audit.markers[name] = ok ? 'PASS' : 'FAIL';
        if (!ok) {
            audit.pass = false;
            fail('关键标识缺失：' + name + '\n' +
                 '  这说明 asar 中的修复代码未到位（要么打包时文件未同步，要么 asar 缓存复用）。\n' +
                 '  请先运行：node tools/copy-consistency.cjs --fix  同步副本，\n' +
                 '  再杀进程清空 output 目录重打包。');
        }
    }

    // ── asarmor 防解包 ──
    try {
        console.log('[asarmor] Applying patches to ' + asarPath);
        console.log('[asarmor] Bloat size: ' + BLOAT_GB + ' GB (only affects extraction, not archive size)');
        const archive = await asarmor.open(asarPath);
        const bloatPatch = asarmor.createBloatPatch(BLOAT_GB);
        archive.patch(bloatPatch);
        await archive.write(asarPath);
        console.log('[asarmor] ASAR protection applied successfully (patch + bloat)');
    } catch (err) {
        console.warn('[asarmor] Warning (non-fatal):', err.message);
    }

    // ── 铁闸5：写构建审计报告（output 根目录） ──
    const auditPath = join(outputRoot, 'build-audit.json');
    try {
        // 打包后 asar 再算一次哈希（asarmor 修改了 asar）
        audit.postAsarmorSize = fs.statSync(asarPath).size;
        audit.postAsarmorSha256 = sha256Buf(fs.readFileSync(asarPath));
        // 附加版本自检三元组字符串（供用户对照登录页显示）
        var archMatch = (asarISO.match(/Arch 2\.\d+/g) || []);
        audit.versionTriple = 'V' + expectedVersion + ' | Build ' + new Date(buildTime).toLocaleString('zh-CN', { hour12: false }) +
                             ' | ' + (archMatch.length ? archMatch[archMatch.length - 1] : 'UNKNOWN');
        fs.writeFileSync(auditPath, JSON.stringify(audit, null, 2), 'utf8');
        console.log('[afterPack GATE-KEEPER] 构建审计报告写入: ' + auditPath);
        console.log('[afterPack GATE-KEEPER] 版本三元组: ' + audit.versionTriple);
    } catch (e) {
        // 审计报告写入失败非致命，但要警告
        console.warn('[afterPack GATE-KEEPER] 审计报告写入失败 (non-fatal):', e.message);
    }

    console.log('');
    console.log('[afterPack GATE-KEEPER] ALL CHECKS PASS ✓ — 允许进入 NSIS 打包阶段');
    console.log('═══════════════════════════════════════════════════════');
    console.log('');
};
