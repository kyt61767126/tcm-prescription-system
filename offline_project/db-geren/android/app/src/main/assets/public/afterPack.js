/**
 * asarmor ASAR 防解压保护 + JavaScript 代码混淆钩子（防盗版增强版）
 *
 * 保护策略：
 * 1. asarmor: 防止 ASAR 解包
 *    - createBloatPatch(100): 创建 100GB 虚拟文件条目
 * 2. javascript-obfuscator: 混淆核心 JS 文件
 *    - 变量名混淆、字符串加密、控制流平坦化、死代码注入
 *
 * 文档：https://github.com/sleeyax/asarmor
 *       https://github.com/javascript-obfuscator/javascript-obfuscator
 */

const asarmor = require('asarmor');
const { join, basename } = require('path');
const fs = require('fs');

const BLOAT_GB = parseInt(process.env.ASARMOR_BLOAT_GB || '100', 10);

const OBFUSCATE_FILES = [
  'electron/main.js',
  'electron/license-manager.js',
  'auth-core.js',
  'permission.js',
  'prescription-core.js',
  'db-adapter.js',
  'medicine-dict.js',
  'patient-archive.js'
];

async function obfuscateFile(filePath) {
  try {
    const obfuscator = require('javascript-obfuscator');
    const content = fs.readFileSync(filePath, 'utf8');

    const obfuscated = obfuscator.obfuscate(content, {
      compact: true,
      controlFlowFlattening: true,
      controlFlowFlatteningThreshold: 0.8,
      deadCodeInjection: true,
      deadCodeInjectionThreshold: 0.4,
      stringArray: true,
      stringArrayEncoding: ['base64', 'rc4'],
      stringArrayThreshold: 0.8,
      transformObjectKeys: true,
      rotateStringArray: true,
      shuffleStringArray: true,
      splitStrings: true,
      splitStringsChunkLength: 10,
      identifierNamesGenerator: 'hexadecimal',
      identifiersPrefix: '_',
      selfDefending: true,
      disableConsoleOutput: true,
      log: false
    });

    fs.writeFileSync(filePath, obfuscated.getObfuscatedCode(), 'utf8');
    console.log(`[obfuscator] Obfuscated: ${basename(filePath)}`);
  } catch (err) {
    console.warn(`[obfuscator] Skip obfuscation (module not installed): ${basename(filePath)}`);
  }
}

exports.default = async ({ appOutDir, packager }) => {
  const resourcesDir = packager.getResourcesDir(appOutDir);
  const appDir = join(resourcesDir, 'app');

  console.log('[security] Applying code obfuscation...');
  for (const file of OBFUSCATE_FILES) {
    const filePath = join(appDir, file);
    if (fs.existsSync(filePath)) {
      await obfuscateFile(filePath);
    }
  }

  try {
    const asarPath = join(resourcesDir, 'app.asar');
    console.log(`[asarmor] Applying patches to ${asarPath}`);
    console.log(`[asarmor] Bloat size: ${BLOAT_GB} GB (only affects extraction, not archive size)`);

    const archive = await asarmor.open(asarPath);
    const bloatPatch = asarmor.createBloatPatch(BLOAT_GB);
    archive.patch(bloatPatch);
    await archive.write(asarPath);

    console.log('[asarmor] ASAR protection applied successfully (patch + bloat)');
  } catch (err) {
    console.error('[asarmor] Error applying patches:', err.message);
  }
};
