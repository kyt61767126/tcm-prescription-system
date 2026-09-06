// ============================================================================
// write-apk-buildmeta.cjs — APK 打包时生成 assets/public/build-meta.json
//   （登录页自证真伪三元组：V1.0.0.246 · APK 246 · Build 2026/9/6 20:30:12）
//
//   背景（2026-09-06）：versionCode 246 在同版本多次打包中不变，登录页只显示
//   V1.0.0.246 —— 用户（微信传手机安装）无法区分装的是哪一次打包的 APK，
//   出现"我装的明明是 246 却还是旧代码"的排查困境。
//   页面 index-app.html loadBuildMeta() 已有 fetch ./build-meta.json 渲染逻辑，
//   本脚本只需在打包时写入该文件，零 HTML/JS 界面改动。
//   与桌面版 write-build-meta.cjs（package.json 版本源）并列，本脚本版本源=build.gradle。
//
// 用法：node write-apk-buildmeta.cjs <android_public_dir> <build_gradle_path>
// ============================================================================
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
if (!args[0] || !args[1]) {
    console.error('[write-apk-buildmeta] 缺少参数: <android_public_dir> <build_gradle_path>');
    process.exit(2);
}

const publicDir = path.resolve(args[0]);
const gradlePath = path.resolve(args[1]);
if (!fs.existsSync(publicDir)) { console.error('[write-apk-buildmeta] 目录不存在:', publicDir); process.exit(2); }
if (!fs.existsSync(gradlePath)) { console.error('[write-apk-buildmeta] build.gradle 不存在:', gradlePath); process.exit(2); }

const g = fs.readFileSync(gradlePath, 'utf8');
const vn = (g.match(/versionName\s+"([^"]+)"/) || [])[1] || '1.0.0';
const vc = (g.match(/versionCode\s+(\d+)/) || [])[1] || '0';
const displayVersion = vn + '.' + vc; // 1.0.0.246 —— 与 MainActivity SSOT 注入 V1.0.0.246 同源

var meta = {
    version: displayVersion,
    productName: '惠康中医-本地',
    buildTime: new Date().toISOString(),
    buildTimeLocal: new Date().toLocaleString('zh-CN', { hour12: false }),
    archMarker: 'APK ' + vc
};

const outPath = path.join(publicDir, 'build-meta.json');
fs.writeFileSync(outPath, JSON.stringify(meta, null, 2), 'utf8');
console.log('[write-apk-buildmeta] ' + outPath + ' :');
console.log('  V' + meta.version + ' | ' + meta.archMarker + ' | Build ' + meta.buildTimeLocal);
process.exit(0);
