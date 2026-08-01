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
};
