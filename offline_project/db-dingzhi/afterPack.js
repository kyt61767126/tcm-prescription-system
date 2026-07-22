/**
 * asarmor ASAR 闃茶В鍘嬩繚鎶ら挬瀛愶紙闃茬洍鐗堝寮虹増锛? *
 * 淇濇姢绛栫暐锛? * 1. asarmor: 闃叉 ASAR 瑙ｅ寘
 *    - createBloatPatch(100): 鍒涘缓 100GB 铏氭嫙鏂囦欢鏉＄洰
 *
 * 娉ㄦ剰锛欽S 浠ｇ爜娣锋穯鐢?tools/obfuscate.js 鍦ㄦ墦鍖呭墠瀹屾垚锛堣交閲忕骇閰嶇疆锛夛紝
 *      姝ゅ涓嶅啀閲嶅娣锋穯銆備箣鍓嶄娇鐢?RC4+stringArray+controlFlowFlattening
 *      婵€杩涙贩娣嗗鑷存闈㈢増 main.js 鍦?Electron 涓昏繘绋嬩腑 require/crypto
 *      璋冪敤澶辫触锛岀▼搴忛潤榛樺穿婧冩棤娉曟墦寮€銆? *
 * 鏂囨。锛歨ttps://github.com/sleeyax/asarmor
 */

const asarmor = require('asarmor');
const { join } = require('path');
const fs = require('fs');

const BLOAT_GB = parseInt(process.env.ASARMOR_BLOAT_GB || '100', 10);

exports.default = async ({ appOutDir, packager }) => {
  const resourcesDir = packager.getResourcesDir(appOutDir);

  try {
    const asarPath = join(resourcesDir, 'app.asar');
    console.log([asarmor] Applying patches to  + asarPath);
    console.log([asarmor] Bloat size:  + BLOAT_GB +  GB (only affects extraction, not archive size));

    const archive = await asarmor.open(asarPath);
    const bloatPatch = asarmor.createBloatPatch(BLOAT_GB);
    archive.patch(bloatPatch);
    await archive.write(asarPath);

    console.log('[asarmor] ASAR protection applied successfully (patch + bloat)');
  } catch (err) {
    console.error('[asarmor] Error applying patches:', err.message);
  }
};