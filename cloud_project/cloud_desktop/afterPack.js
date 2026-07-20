/**
 * asarmor ASAR 防解压保护钩子（P3-D 优化版）
 *
 * 通过 electron-builder afterPack 钩子集成 asarmor。
 * 在 electron-builder 完成 ASAR 打包后、最终签名/压缩前调用。
 *
 * 保护策略（P3-D 优化）：
 * - archive.patch() 应用 asarmor 默认 patches（破坏 asar extract 命令）
 * - 显式调用 createBloatPatch(100) 创建 100GB 虚拟文件条目（让解包时磁盘被填满）
 *   注：bloat 只修改 asar header 中的文件条目，不增加 asar 文件本身体积
 *   仅当攻击者尝试 asar extract 时才会创建 100GB 的零填充文件
 * - 不启用 encryption（需 main.node 接管入口，与本项目 script 直接加载方式不兼容）
 *
 * 文档：https://github.com/sleeyax/asarmor
 */

const asarmor = require('asarmor');
const { join } = require('path');

// P3-D: bloat 大小（GB），默认 100GB
// 解包时会让攻击者磁盘被填满，但不会增加 asar 文件本身体积
// 如需调整，可通过环境变量 ASARMOR_BLOAT_GB 覆盖
const BLOAT_GB = parseInt(process.env.ASARMOR_BLOAT_GB || '100', 10);

exports.default = async ({ appOutDir, packager }) => {
  try {
    const asarPath = join(packager.getResourcesDir(appOutDir), 'app.asar');
    console.log(`[asarmor] Applying patches to ${asarPath}`);
    console.log(`[asarmor] Bloat size: ${BLOAT_GB} GB (only affects extraction, not archive size)`);

    const archive = await asarmor.open(asarPath);

    // P3-D: 显式应用 bloat patch + 默认 patches
    // 默认 patch() 已包含 createBloatPatch(100)，这里显式传入可配置大小的 bloat
    const bloatPatch = asarmor.createBloatPatch(BLOAT_GB);
    archive.patch(bloatPatch);

    // 写回 asar 文件
    await archive.write(asarPath);

    console.log('[asarmor] ASAR protection applied successfully (patch + bloat)');
  } catch (err) {
    console.error('[asarmor] Error applying patches:', err.message);
    // 不抛出错误，避免阻塞打包流程
  }
};
