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
 * 用法：node copy-assets.cjs [cloud|offline|all]（默认 all）
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

const target = process.argv[2] || 'all';
if (target === 'all') {
  runOne('cloud');
  runOne('offline');
} else if (target === 'cloud' || target === 'offline') {
  runOne(target);
} else {
  console.error('用法：node copy-assets.cjs [cloud|offline|all]');
  process.exit(1);
}
console.log('[DONE] 源（安卓工程）未被修改（脚本只读源、只写 app_project_harmony/）。');
