/**
 * asarmor ASAR 防解压保护钩子
 *
 * 通过 electron-builder afterPack 钩子集成 asarmor。
 * 在 electron-builder 完成 ASAR 打包后、最终签名/压缩前调用。
 *
 * 保护策略：
 * - archive.patch() 应用 asarmor 默认 patches（破坏 asar extract 命令）
 * - 不应用 bloat（避免 ASAR 体积膨胀影响分发）
 * - 不启用 encryption（需 main.node 接管入口，与本项目 script 直接加载方式不兼容）
 *
 * 文档：https://github.com/sleeyax/asarmor
 */

const asarmor = require('asarmor');
const { join } = require('path');

exports.default = async ({ appOutDir, packager }) => {
  try {
    const asarPath = join(packager.getResourcesDir(appOutDir), 'app.asar');
    console.log(`[asarmor] Applying patches to ${asarPath}`);

    const archive = await asarmor.open(asarPath);

    // 应用默认 patches（防止 asar extract）
    archive.patch();

    // 写回 asar 文件
    await archive.write(asarPath);

    console.log('[asarmor] ASAR protection applied successfully');
  } catch (err) {
    console.error('[asarmor] Error applying patches:', err.message);
    // 不抛出错误，避免阻塞打包流程
  }
};
