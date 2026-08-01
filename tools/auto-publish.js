#!/usr/bin/env node
// ============================================================================
// auto-publish.js — 自动检查 exe/apk 变化并发布到 GitHub Release
//
// 用法：
//   node tools/auto-publish.js              # 自动检查所有 exe+apk，有变化才发布
//   node tools/auto-publish.js --check      # 只检查不发布（预览有哪些需要更新）
//   node tools/auto-publish.js --force      # 强制发布（即使没有变化）
//   node tools/auto-publish.js --target=exe # 只检查 exe
//   node tools/auto-publish.js --target=apk # 只检查 apk
//
// 工作原理：
//   1. 扫描本地所有 exe（各项目 dist/）和 apk（public/downloads/）
//   2. 计算每个文件的 sha256
//   3. 与 hash-manifest.json 中已记录的 sha256 比较
//   4. 若有新文件或 hash 变化，自动调用 publish-release.js 发布
//   5. 若全部一致，提示"无需更新"并退出
//
// 典型场景：
//   - 你刚打包了新 exe → 双击 build.bat → 运行 auto-publish.js → 自动上传
//   - 你没打包任何东西 → 运行 auto-publish.js → 提示"无需更新"
// ============================================================================

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const MANIFEST_PATH = path.join(PROJECT_ROOT, 'public', 'hash-manifest.json');
const DOWNLOADS_DIR = path.join(PROJECT_ROOT, 'public', 'downloads');

const APP_CONFIG = {
    'cloud': {
        apkName: '惠康中医-云端.apk',
        gradlePath: path.join(PROJECT_ROOT, 'app_project', 'db-yunduan', 'cloud_app', 'app', 'build.gradle'),
        distDir: path.join(PROJECT_ROOT, 'app_project', 'db-yunduan', 'cloud_desktop', 'dist'),
    },
    'dingzhi': {
        apkName: '惠康中医-定制.apk',
        gradlePath: path.join(PROJECT_ROOT, 'app_project', 'db-offline', 'app', 'app', 'build.gradle'),
        distDir: path.join(PROJECT_ROOT, 'app_project', 'db-offline', 'desktop', 'dist'),
    },
    'geren': {
        apkName: '惠康中医-个人.apk',
        gradlePath: path.join(PROJECT_ROOT, 'app_project', 'db-offline', 'app_geren', 'app', 'build.gradle'),
        distDir: path.join(PROJECT_ROOT, 'app_project', 'db-offline', 'desktop_geren', 'dist'),
    }
};

function calculateSHA256(filePath) {
    const buffer = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(buffer).digest('hex');
}

function getFileSize(filePath) {
    return fs.statSync(filePath).size;
}

function formatSize(bytes) {
    return (bytes / 1024 / 1024).toFixed(2) + ' MB';
}

// 扫描所有本地文件
function scanLocalFiles(target) {
    const files = [];
    const appKeys = Object.keys(APP_CONFIG);

    for (const key of appKeys) {
        const config = APP_CONFIG[key];

        // APK
        if (target === 'all' || target === 'apk') {
            if (config.apkName) {
                const apkPath = path.join(DOWNLOADS_DIR, config.apkName);
                if (fs.existsSync(apkPath)) {
                    files.push({
                        appKey: key,
                        type: 'apk',
                        path: apkPath,
                        name: config.apkName,
                        size: getFileSize(apkPath),
                        sha256: calculateSHA256(apkPath).toLowerCase(),
                    });
                }
            }
        }

        // exe（安装版 + 便携版）
        if (target === 'all' || target === 'exe') {
            if (config.distDir && fs.existsSync(config.distDir)) {
                const exes = fs.readdirSync(config.distDir).filter(f => f.endsWith('.exe'));
                for (const exe of exes) {
                    const exePath = path.join(config.distDir, exe);
                    const isSetup = /\bSetup\b/.test(exe);
                    files.push({
                        appKey: key,
                        type: isSetup ? 'exe' : 'portable',
                        path: exePath,
                        name: exe,
                        size: getFileSize(exePath),
                        sha256: calculateSHA256(exePath).toLowerCase(),
                    });
                }
            }
        }
    }

    return files;
}

// 读取已发布的 manifest
function loadManifest() {
    try {
        return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
    } catch (e) {
        return {};
    }
}

// 比较本地文件与 manifest，找出需要发布的
function detectChanges(localFiles, manifest) {
    const changes = [];
    const unchanged = [];

    for (const f of localFiles) {
        const recorded = manifest[f.appKey] && manifest[f.appKey][f.type];
        if (!recorded) {
            // manifest 中没有记录 → 新文件
            changes.push({ ...f, reason: '新增（manifest 无记录）' });
        } else if (recorded.sha256 && recorded.sha256.toLowerCase() !== f.sha256) {
            // sha256 不一致 → 文件已变化
            changes.push({ ...f, reason: '已更新（sha256 变化）', oldSha: recorded.sha256 });
        } else if (!recorded.url) {
            // sha256 一致但 URL 缺失 → 需要补发布
            changes.push({ ...f, reason: 'URL 缺失' });
        } else {
            unchanged.push(f);
        }
    }

    return { changes, unchanged };
}

function main() {
    console.log('============================================');
    console.log('  惠康中医 · 自动检查并发布工具');
    console.log('  （扫描本地文件 → 比对 manifest → 自动发布）');
    console.log('============================================\n');

    // 解析参数
    const args = process.argv.slice(2);
    let target = 'all';
    let checkOnly = false;
    let force = false;

    for (const arg of args) {
        if (arg.startsWith('--target=')) {
            target = arg.substring('--target='.length);
        } else if (arg === '--check') {
            checkOnly = true;
        } else if (arg === '--force') {
            force = true;
        }
    }

    const validTargets = ['all', 'apk', 'exe'];
    if (!validTargets.includes(target)) {
        console.error('[ERROR] --target 只支持: ' + validTargets.join('/'));
        process.exit(1);
    }

    // 1. 扫描本地文件
    console.log('[1/3] 扫描本地 ' + (target === 'all' ? 'exe + apk' : target) + ' 文件...');
    const localFiles = scanLocalFiles(target);
    if (localFiles.length === 0) {
        console.log('  [WARN] 没有找到任何文件');
        console.log('  提示：先运行 build.bat（桌面版）或 build-app.bat（APP）打包');
        process.exit(0);
    }
    console.log('  找到 ' + localFiles.length + ' 个文件:');
    for (const f of localFiles) {
        console.log('    - [' + f.appKey + '] ' + f.type + ': ' + f.name + ' (' + formatSize(f.size) + ')');
    }
    console.log();

    // 2. 比对 manifest
    console.log('[2/3] 比对 hash-manifest.json...');
    const manifest = loadManifest();
    const { changes, unchanged } = detectChanges(localFiles, manifest);

    if (unchanged.length > 0) {
        console.log('  [OK] ' + unchanged.length + ' 个文件无变化:');
        for (const f of unchanged) {
            console.log('    - [' + f.appKey + '] ' + f.type + ': ' + f.name);
        }
    }

    if (changes.length > 0) {
        console.log('  [CHANGE] ' + changes.length + ' 个文件需要发布:');
        for (const f of changes) {
            console.log('    - [' + f.appKey + '] ' + f.type + ': ' + f.name + ' (' + f.reason + ')');
        }
    }
    console.log();

    // 3. 决定是否发布
    if (checkOnly) {
        console.log('[3/3] --check 模式，只检查不发布');
        if (changes.length > 0) {
            console.log('  如需发布，运行: node tools/auto-publish.js');
            process.exit(2);  // 有变化时返回 2
        } else {
            console.log('  所有文件都是最新，无需发布');
            process.exit(0);
        }
    }

    if (changes.length === 0 && !force) {
        console.log('[3/3] 所有文件都是最新，无需发布');
        console.log('  （如需强制重新发布，加 --force 参数）');
        process.exit(0);
    }

    // 调用 publish-release.js 发布
    const publishTarget = (changes.length > 0 && target === 'all')
        ? detectPublishTarget(changes)  // 只发布有变化的类型
        : target;

    // 自动生成版本号 v{YYYY}.{MM}.{DD}-{HHmm}
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const versionTag = `v${now.getFullYear()}.${pad(now.getMonth() + 1)}.${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;

    console.log('[3/3] 自动调用 publish-release.js 发布...');
    console.log('  版本号: ' + versionTag);
    console.log('  target: ' + publishTarget);
    console.log('  变更文件数: ' + changes.length);
    console.log();

    const publishArgs = ['tools/publish-release.js', '--target=' + publishTarget, versionTag];
    console.log('  执行命令: node ' + publishArgs.join(' '));
    console.log('--------------------------------------------');

    const result = spawnSync('node', publishArgs, {
        cwd: PROJECT_ROOT,
        stdio: 'inherit',  // 直接透传输出
        timeout: 1200000,  // 20 分钟超时
    });

    console.log('--------------------------------------------');
    if (result.status === 0) {
        console.log('\n[OK] 自动发布完成！');
        console.log('  Release: https://github.com/kyt61767126/tcm-prescription-system/releases/tag/' + versionTag);
        console.log('  下载页: https://tcm-prescription-system.pages.dev/download');
    } else {
        console.error('\n[ERROR] 发布失败，退出码: ' + result.status);
        console.error('  可手动运行: node ' + publishArgs.join(' '));
        process.exit(result.status || 1);
    }
}

// 根据变更文件推断 publish target
function detectPublishTarget(changes) {
    const types = new Set(changes.map(c => c.type));
    // 如果变更包含 apk 和 exe/portable，用 all
    // 如果只有 apk，用 apk
    // 如果只有 exe/portable，用 exe
    if (types.has('apk') && (types.has('exe') || types.has('portable'))) {
        return 'all';
    } else if (types.has('apk')) {
        return 'apk';
    } else {
        return 'exe';
    }
}

main();
