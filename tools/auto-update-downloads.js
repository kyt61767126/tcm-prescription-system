#!/usr/bin/env node
// ============================================================================
// auto-update-downloads.js — 自动更新下载页面的APK文件
//
// 用法：node auto-update-downloads.js <target>
//   target: dingzhi / cloud / all
//
// 功能：
//   1. 查找刚打包的APK文件
//   2. --confirm 后复制到 public/downloads/ 目录
//   3. --confirm 后计算SHA-256并更新 hash-manifest.json 的 url 和 sha256
//   4. --push 手动确认后才提交并推送到GitHub（Cloudflare Pages自动部署）
//
// ★ 规范：打包产物禁止自动上传官方下载网站！
//   - 默认"只检查不落库"：不加 --confirm 时，不会把 APK 复制进 public/downloads/，
//     也不会改写 hash-manifest.json，避免未经验的 APK 被后续 git push 带上官方站点。
//   - 人工检查合规合格后，手动执行:
//       node auto-update-downloads.js <target> --confirm --push
//   - --confirm：把 APK 复制进 public/downloads/ 并更新 manifest（本地准备）
//   - --push：        git 提交并推送，触发官方下载页面部署（最终发布）
// ============================================================================

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const DOWNLOADS_DIR = path.join(PROJECT_ROOT, 'public', 'downloads');
const MANIFEST_PATH = path.join(PROJECT_ROOT, 'public', 'hash-manifest.json');
const { getProvenance } = require('./provenance');  // 发布来源声明（P0-[5.2]）

// 各APP的APK搜索路径和产品名称
// appDir: 项目根目录（包含 app/ 子目录），用于读取 build.gradle 版本号
// 统一安装包：标准版/机构版由运行时激活码决定（合并 8 包 → 4 包）
const APP_CONFIG = {
    'dingzhi': {
        // 离线统一包
        apkDir: path.join(PROJECT_ROOT, 'app_project', 'db-offline', 'app', 'app', 'build', 'outputs', 'apk', 'release'),
        appDir: path.join(PROJECT_ROOT, 'app_project', 'db-offline'),
        outputName: '惠康中医-本地.apk',
        configPath: path.join(PROJECT_ROOT, 'app_project', 'db-offline', 'desktop', 'config.json')
    },
    'cloud': {
        // 云端统一包
        apkDir: path.join(PROJECT_ROOT, 'app_project', 'db-yunduan', 'cloud_app', 'app', 'build', 'outputs', 'apk', 'release'),
        appDir: path.join(PROJECT_ROOT, 'app_project', 'db-yunduan', 'cloud_app'),
        outputName: '惠康中医-云端.apk',
        configPath: null
    }
};

function calculateSHA256(filePath) {
    const buffer = fs.readFileSync(filePath);
    const hash = crypto.createHash('sha256').update(buffer).digest('hex');
    return hash;
}

function getFileSize(filePath) {
    return fs.statSync(filePath).size;
}

function findApkFile(dir) {
    if (!fs.existsSync(dir)) return null;
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.apk'));
    if (files.length === 0) return null;
    const signed = files.find(f => !f.includes('unsigned'));
    return path.join(dir, signed || files[0]);
}

function readVersionFromGradle(appDir) {
    // 依次尝试候选路径（离线工程 appDir/app/app/build.gradle；云端工程 appDir/app/build.gradle）
    const candidates = [
        path.join(appDir, 'app', 'app', 'build.gradle'),
        path.join(appDir, 'app', 'build.gradle')
    ];
    for (const gradlePath of candidates) {
        try {
            if (!fs.existsSync(gradlePath)) continue;
            const content = fs.readFileSync(gradlePath, 'utf8');
            const nameMatch = content.match(/versionName\s+"([^"]+)"/);
            if (nameMatch) return nameMatch[1];
            const match = content.match(/versionCode\s+(\d+)/);
            if (match) return match[1];
        } catch (e) { /* 该路径不可读，尝试下一个 */ }
    }
    return '';
}

// ★ 2026-08-28 版本更新提示修复：从 APK 产物本身提取 versionName/versionCode（真源），
//   防止 build.gradle 与实际打包产物不一致（如打包后又改了 gradle 未重打包）导致
//   APP 端更新横幅误报/漏报。aapt 不可用时回退 build.gradle。
function readVersionFromApk(apkFile, appDir) {
    const result = { version: '', versionCode: 0 };
    // aapt 候选路径：LOCALAPPDATA 与常见 SDK 目录（取最新 build-tools）
    const sdkRoots = [
        process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk') : null,
        process.env.ANDROID_HOME || null,
        'C:\\Android\\Sdk', 'D:\\Android\\Sdk'
    ].filter(Boolean);
    const aaptCandidates = [];
    for (const root of sdkRoots) {
        const btDir = path.join(root, 'build-tools');
        try {
            if (!fs.existsSync(btDir)) continue;
            fs.readdirSync(btDir)
                .filter(d => /^\d/.test(d))
                .sort((a, b) => parseInt(b) - parseInt(a))
                .forEach(d => aaptCandidates.push(path.join(btDir, d, 'aapt.exe')));
        } catch (e) { /* 忽略不可读目录 */ }
    }
    for (const aapt of aaptCandidates) {
        try {
            if (!fs.existsSync(aapt)) continue;
            const badging = execSync('"' + aapt + '" dump badging "' + apkFile + '"', {
                encoding: 'utf8', timeout: 30000, windowsHide: true
            });
            // 示例: package: name='com.tcm.prescription' versionCode='231' versionName='1.0.0'
            const m = badging.match(/versionCode='(\d+)'/);
            const nm = badging.match(/versionName='([^']*)'/);
            if (m) result.versionCode = parseInt(m[1], 10);
            if (nm) result.version = nm[1];
            if (result.versionCode > 0) return result;
        } catch (e) { /* 该 aapt 不可用，尝试下一个 */ }
    }
    // 回退：build.gradle（versionName 优先 versionCode）
    result.version = readVersionFromGradle(appDir);
    return result;
}

function updateDownloads(target) {
    console.log('[auto-update] 检查下载页面更新...');

    // ★ 规范：禁止自动上传！未加 --confirm 时绝不修改 public/downloads/ 和 hash-manifest.json
    const confirmed = process.argv.includes('--confirm');
    if (!confirmed) {
        console.log('  [规范] 打包产物禁止自动上传官方下载网站');
        console.log('  本次仅检查，不复制 APK、不改写 manifest（避免后续 git push 带上未经验证的包）');
        console.log('');
        const targets = target === 'all' ? Object.keys(APP_CONFIG) : [target];
        for (const key of targets) {
            const config = APP_CONFIG[key];
            if (!config) continue;
            // ★ 2026-08-30 与 --confirm 同源：项目根正式产物优先
            const rootApk = path.join(config.appDir, config.outputName);
            const apkFile = fs.existsSync(rootApk) ? rootApk : findApkFile(config.apkDir);
            if (apkFile) {
                const sizeMB = (getFileSize(apkFile) / 1024 / 1024).toFixed(1);
                console.log('  [待发布] ' + key + ': ' + config.outputName + ' (' + sizeMB + 'MB)');
            } else {
                console.log('  [SKIP] ' + key + ': 未找到 APK');
            }
        }
        console.log('');
        console.log('  请人工检查优化是否合规合格，确认后手动执行:');
        console.log('    node auto-update-downloads.js ' + target + ' --confirm --push');
        return false;
    }

    // 确保 downloads 目录存在
    if (!fs.existsSync(DOWNLOADS_DIR)) {
        fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
        console.log('  [OK] 创建 downloads 目录');
    }

    // 读取现有 manifest
    let manifest = {};
    try {
        manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
    } catch (e) {
        console.warn('  [WARN] 读取 manifest 失败，创建新的');
    }

    const now = new Date().toISOString();
    let updated = 0;
    const targets = target === 'all' ? Object.keys(APP_CONFIG) : [target];

    for (const key of targets) {
        const config = APP_CONFIG[key];
        if (!config) {
            console.log('  [SKIP] 未知目标: ' + key);
            continue;
        }

        // ★ 2026-08-30 修复源不一致（举一反三 auto-publish.js 同款坑）：
        //   原只从 gradle 输出目录（build/outputs/apk/release）复制——打包中途失败
        //   会残留半成品 gradle 输出，或与项目根已验收产物不一致（两个入口两个源）。
        //   现优先取项目根 build-app.bat 的正式产物（含文件名+大小校验的最终副本），
        //   不存在才回退 gradle 输出目录。
        const rootApk = path.join(config.appDir, config.outputName);
        const gradleApk = findApkFile(config.apkDir);
        const apkFile = fs.existsSync(rootApk) ? rootApk : gradleApk;
        if (!apkFile) {
            console.log('  [SKIP] ' + key + ' APK 未找到');
            continue;
        }
        if (fs.existsSync(rootApk) && gradleApk) {
            const rootSha = calculateSHA256(rootApk).toLowerCase();
            const gradleSha = calculateSHA256(gradleApk).toLowerCase();
            if (rootSha !== gradleSha) {
                console.warn('  [WARN] ' + key + ': 项目根产物与 gradle 输出 sha 不一致，以项目根为准（gradle 输出可能是半成品）');
            }
        }

        // 复制到 downloads 目录
        const destPath = path.join(DOWNLOADS_DIR, config.outputName);
        fs.copyFileSync(apkFile, destPath);
        console.log('  [OK] 复制 ' + config.outputName);

        // 计算 SHA-256
        const sha256 = calculateSHA256(destPath);
        const size = getFileSize(destPath);
        // ★ 版本信息从 APK 产物提取（真源），aapt 不可用回退 build.gradle
        const ver = readVersionFromApk(destPath, config.appDir);
        const version = ver.version || readVersionFromGradle(config.appDir);

        // 更新 manifest
        if (!manifest[key]) manifest[key] = {};
        manifest[key].apk = {
            version: version,
            versionCode: ver.versionCode > 0 ? ver.versionCode : undefined,
            sha256: sha256,
            url: '/downloads/' + config.outputName,
            size: size,
            updateTime: now,
            fileName: config.outputName
        };

        console.log('  [OK] ' + key + ': SHA256=' + sha256.substring(0, 16) + '... (' + (size / 1024 / 1024).toFixed(1) + 'MB)');
        updated++;
    }

    if (updated === 0) {
        console.log('[auto-update] 没有更新任何文件');
        return false;
    }

    // ★ 2026-08-24 修复：dingzhi→local manifest 双 key 同步（download.html 读 local，
    //   只写 dingzhi 会让 local key 停在旧版；与 publish-release.js 保持同一镜像逻辑）
    if (manifest.dingzhi) {
        manifest.local = JSON.parse(JSON.stringify(manifest.dingzhi));
    }

    // ★ P0-[5.2] Release Provenance：顶层写入发布来源声明（仓库/commit/构建者/时间/工具）
    manifest.provenance = getProvenance({ releaseTag: '' });

    // 写入 manifest
    fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 4), 'utf8');
    console.log('[auto-update] 更新 hash-manifest.json');

    return true;
}

function pushToGitHub() {
    // ★ P1优化：APK打包后不自动git push，改为手动发布
    // 防止未经验证的APK直接推给所有用户
    // 如需自动推送，执行: node auto-update-downloads.js all --push
    const args = process.argv.slice(2);
    const autoPush = args.includes('--push');

    if (!autoPush) {
        console.log('');
        console.log('[auto-update] ★ APK文件已更新到 public/downloads/，但未自动推送');
        console.log('[auto-update] 请验证APK功能后，手动执行发布:');
        console.log('  1. 测试APK安装包是否正常');
        console.log('  2. 一键发布.bat （统一发布EXE+APK+manifest）');
        console.log('  3. 或手动推送: git add public/downloads/ public/hash-manifest.json && git commit && git push');
        console.log('');
        return;
    }

    try {
        console.log('[auto-update] (--push) 提交并推送到 GitHub...');

        // 添加文件
        execSync('git add public/downloads/ public/hash-manifest.json', { cwd: PROJECT_ROOT, stdio: 'ignore' });

        // 检查是否有变更
        const status = execSync('git status --porcelain', { cwd: PROJECT_ROOT, encoding: 'utf8' });
        if (!status.trim()) {
            console.log('  [SKIP] 没有变更需要提交');
            return;
        }

        // 提交
        execSync('git commit -m "chore(download): 更新APK下载文件"', { cwd: PROJECT_ROOT, stdio: 'ignore' });

        // 推送
        execSync('git push origin main', { cwd: PROJECT_ROOT, stdio: 'ignore' });

        console.log('[auto-update] 推送成功！Cloudflare Pages 将在1-2分钟内自动部署');
    } catch (e) {
        console.error('[auto-update] Git操作失败:', e.message);
        console.log('[auto-update] 请手动执行: git add public/downloads/ public/hash-manifest.json && git commit && git push');
    }
}

function main() {
    const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
    const target = args[0] || 'all';

    if (!['dingzhi', 'cloud', 'all'].includes(target)) {
        console.error('用法: node auto-update-downloads.js <target>');
        console.error('  target: dingzhi / cloud / all');
        process.exit(1);
    }

    const updated = updateDownloads(target);
    if (updated) {
        pushToGitHub();
    } else {
        console.log('[auto-update] 没有文件需要更新');
    }
}

main();
