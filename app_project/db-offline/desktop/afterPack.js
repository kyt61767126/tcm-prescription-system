/**
 * asarmor ASAR 防解压保护插件（离线版增强）
 *
 * 保护策略：
 * 1. asarmor: 防止 ASAR 解包
 *    - createBloatPatch(100): 创建 100GB 虚拟文件条目
 *
 * 注意：JS 代码混淆由 tools/obfuscate.js 在打包前完成（轻量级配置），
 *      此处不再重复混淆。之前使用 RC4+stringArray+controlFlowFlattening
 *      激进混淆导致桌面版 main.js 在 Electron 主进程中 require/crypto
 *      调用失败，程序静默崩溃无法打开。
 *
 * 文档：https://github.com/sleeyax/asarmor
 */

const asarmor = require('asarmor');
const { join } = require('path');
const fs = require('fs');

const BLOAT_GB = parseInt(process.env.ASARMOR_BLOAT_GB || '100', 10);

exports.default = async ({ appOutDir, packager }) => {
  const resourcesDir = packager.getResourcesDir(appOutDir);

  try {
    const asarPath = join(resourcesDir, 'app.asar');
    console.log('[asarmor] Applying patches to ' + asarPath);
    console.log('[asarmor] Bloat size: ' + BLOAT_GB + ' GB (only affects extraction, not archive size)');

    const archive = await asarmor.open(asarPath);
    const bloatPatch = asarmor.createBloatPatch(BLOAT_GB);
    archive.patch(bloatPatch);
    await archive.write(asarPath);

    console.log('[asarmor] ASAR protection applied successfully (patch + bloat)');
  } catch (err) {
    console.error('[asarmor] Error applying patches:', err.message);
  }

  // ★ P1-[3.1] 嵌入 PE 自定义完整性区段 .bnzc（EXE 签名自校验第二路）
  // asarmor 只改 app.asar 不改 exe；此处对主 exe 嵌入完整性区段（非阻塞告警）。
  // ★ 2026-08-19 时机说明：electron-builder 顺序为 copy exe → afterPack(本钩子)
  //   → rcedit(图标/版本写 exe)。本钩子嵌入的哈希会被 rcedit 修改作废，
  //   最终哈希由 build.bat 两段式打包的 Phase 2（pe-zone-sign embed）在 rcedit
  //   之后重新校正；此处保留嵌入仅作布局防御层（单独 npm run build 时 .bnzc
  //   布局合法、哈希可能失效，运行时 self-check 为 fail-open 告警不阻断）。
  try {
    const peGuard = require('../../../shared/pe-guard.cjs');
    const productFilename = packager.appInfo.productFilename;
    const mainExe = join(appOutDir, productFilename + '.exe');
    if (fs.existsSync(mainExe)) {
      const r = peGuard.embedZone(mainExe);
      console.log('[pe-guard] .bnzc 完整性区段嵌入成功 (mode=' + r.mode + ') -> ' + mainExe);
    } else {
      console.warn('[pe-guard] 未找到主 exe: ' + mainExe + '，跳过 .bnzc 嵌入');
    }
  } catch (err) {
    console.warn('[pe-guard] PE 完整性区段嵌入失败（非阻塞）: ' + err.message);
  }
};
