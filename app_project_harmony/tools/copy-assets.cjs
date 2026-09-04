#!/usr/bin/env node
/**
 * 鸿蒙前端资源只读拷贝脚本（Week1）
 * ------------------------------------------------------------------
 * 用途：把安卓 APP 已验证的前端运行子集（assets/public + video-recorder-inject.js）
 *      原样拷贝到鸿蒙工程 rawfile 目录；把安卓启动图标拷贝为鸿蒙应用图标。
 * 铁律（零改动保障）：
 *   1. 源目录（app_project/ 安卓工程）只读，物理上不写回任何字节；
 *   2. 输出仅限 app_project_harmony/ 内部；
 *   3. 拷贝为字节级原样复制，不做任何内容改写。
 * 用法：node copy-assets.cjs [cloud|offline|all]（默认 cloud；huikang-offline 未建时 all 会 warn 跳过）
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..'); // d:\trae_projects\kyt-zy
const HARMONY_ROOT = path.join(ROOT, 'app_project_harmony');

const SRC = {
  cloud: path.join(ROOT, 'app_project', 'db-yunduan', 'cloud_app', 'app', 'src', 'main', 'assets'),
  offline: path.join(ROOT, 'app_project', 'db-offline', 'app', 'app', 'src', 'main', 'assets'),
};
const DST = {
  cloud: path.join(HARMONY_ROOT, 'huikang-cloud', 'entry', 'src', 'main', 'resources', 'rawfile'),
  offline: path.join(HARMONY_ROOT, 'huikang-offline', 'entry', 'src', 'main', 'resources', 'rawfile'),
};
const ICON_SRC = {
  cloud: path.join(ROOT, 'app_project', 'db-yunduan', 'cloud_app', 'app', 'src', 'main', 'res', 'mipmap-xxhdpi', 'ic_launcher.png'),
  offline: path.join(ROOT, 'app_project', 'db-offline', 'app', 'app', 'src', 'main', 'res', 'mipmap-xxhdpi', 'ic_launcher.png'),
};

function assertDir(p, label) {
  if (!fs.existsSync(p)) {
    console.error(`[FAIL] 源目录不存在：${label} -> ${p}`);
    process.exit(1);
  }
}

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    const s = path.join(src, name);
    const d = path.join(dst, name);
    const st = fs.statSync(s);
    if (st.isDirectory()) {
      copyDir(s, d);
    } else {
      fs.copyFileSync(s, d); // 字节级原样复制
    }
  }
}

function copyFile(src, dst) {
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
}

function countFiles(dir) {
  let n = 0;
  if (!fs.existsSync(dir)) return 0;
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) n += countFiles(p);
    else n += 1;
  }
  return n;
}

function runOne(edition) {
  const src = SRC[edition];
  const dst = DST[edition];
  assertDir(src, `${edition} assets`);
  // 1) 前端子集：assets/public/* -> rawfile/*
  copyDir(path.join(src, 'public'), dst);
  // 2) 录像拍照注入脚本：assets/video-recorder-inject.js -> rawfile/
  const vjs = path.join(src, 'video-recorder-inject.js');
  if (fs.existsSync(vjs)) copyFile(vjs, path.join(dst, 'video-recorder-inject.js'));
  // 2b) 鸿蒙端注入脚本（从安卓 Java 逐字提取）：shared-inject/*.js -> rawfile/inject/
  const injectSrc = path.join(HARMONY_ROOT, 'shared-inject');
  if (fs.existsSync(injectSrc)) {
    copyDir(injectSrc, path.join(dst, 'inject'));
  } else {
    console.error('[FAIL] shared-inject 目录不存在：' + injectSrc);
    process.exit(1);
  }
  // 3) 图标：安卓 ic_launcher.png -> AppScope + entry 的 media/app_icon.png
  const iconSrc = ICON_SRC[edition];
  if (!fs.existsSync(iconSrc)) {
    console.error(`[FAIL] 图标源不存在：${iconSrc}`);
    process.exit(1);
  }
  const proj = path.join(HARMONY_ROOT, edition === 'cloud' ? 'huikang-cloud' : 'huikang-offline');
  copyFile(iconSrc, path.join(proj, 'AppScope', 'resources', 'base', 'media', 'app_icon.png'));
  copyFile(iconSrc, path.join(proj, 'entry', 'src', 'main', 'resources', 'base', 'media', 'app_icon.png'));
  console.log(`[OK] ${edition}: rawfile ${countFiles(dst)} 个文件；图标已拷贝`);
}

/**
 * 跑单个 edition；鸿蒙工程目录（DST 父目录）不存在时 warn 跳过，
 * 避免 all 模式下 offline 未建直接 process.exit(1) 挂死整个脚本。
 */
function runOneIfReady(edition) {
  const projDir = path.dirname(DST[edition]); // huikang-cloud 或 huikang-offline
  if (!fs.existsSync(projDir)) {
    console.warn(`[SKIP] ${edition} 鸿蒙工程目录不存在（${projDir}），跳过。`);
    console.warn(`       建好后重跑：node copy-assets.cjs ${edition}`);
    return false;
  }
  runOne(edition);
  return true;
}

const target = process.argv[2] || 'cloud';
let anyOk = false;
if (target === 'all') {
  anyOk |= runOneIfReady('cloud');
  anyOk |= runOneIfReady('offline');
  if (!anyOk) {
    console.error('[FAIL] cloud + offline 均无可用鸿蒙工程，全部跳过。');
    process.exit(1);
  }
} else if (target === 'cloud' || target === 'offline') {
  if (!runOneIfReady(target)) {
    process.exit(1);
  }
} else {
  console.error('用法：node copy-assets.cjs [cloud|offline|all]（默认 cloud）');
  process.exit(1);
}
console.log('[DONE] 源（安卓工程）未被修改（脚本只读源、只写 app_project_harmony/）。');
