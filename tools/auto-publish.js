#!/usr/bin/env node
// ============================================================================
// auto-publish.js — 自动检查 exe/apk 变化并发布到 GitHub Release
//
// 用法：
//   node tools/auto-publish.js                   # 只检查所有 exe+apk 是否有变化（不发布）
//   node tools/auto-publish.js --check           # 只检查不发布（预览有哪些需要更新）
//   node tools/auto-publish.js --publish         # 人工确认合规合格后，手动发布有变化的产物（仅上传变化文件）
//   node tools/auto-publish.js --publish --force # 强制发布（即使没有变化）
//   node tools/auto-publish.js --target=exe      # 只检查 exe
//   node tools/auto-publish.js --target=apk      # 只检查 apk
//
// 工作原理：
//   1. 扫描本地所有 exe（各项目 dist/）和 apk（public/downloads/）
//   2. 计算每个文件的 sha256
//   3. 与 hash-manifest.json 中已记录的 sha256 比较
//   4. 若有新文件或 hash 变化，提示需发布（默认不发布）
//   5. 若全部一致，提示"无需更新"并退出
//
// ★ 规范：打包产物禁止自动上传官方下载网站！
//   - 默认"只检查不发布"，绝不自动上传。
//   - 必须由人检查优化是否合规合格后，手动加 --publish 才会调用发布工具上传。
//   - 发布时会自动携带 --confirm --push，即：手动确认 + 手动提交官方页面部署。
//
// 典型场景：
//   - 你刚打包了新 exe → 双击 build.bat → 运行 auto-publish.js → 只提示有变化、不上传
//   - 人工测试/审查通过 → 运行 auto-publish.js --publish → 手动上传发布
// ============================================================================

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const MANIFEST_PATH = path.join(PROJECT_ROOT, 'public', 'hash-manifest.json');
// ★ 2026-08-30 架构收口：产物路径/定位逻辑统一引用 artifact-locate.js 单一权威模块，
//   本工具不再自维护 APP_CONFIG（历史上三工具三份路径配置各自演化，是"新 APK
//   无法发布"事故的架构根因）。exe 的 distDir 亦取自模块。
const { APPS: APP_CONFIG, locateApk, syncApkToDownloads } = require('./artifact-locate');

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

        // APK（★ 2026-08-30 定位逻辑收口 artifact-locate.js：项目根产物优先，
        //   回退 gradle 输出/public/downloads 旧包；fromBuild=true 在 --publish 阶段同步）
        if (target === 'all' || target === 'apk') {
            if (config.apkName) {
                const loc = locateApk(key);
                // 陈旧源守卫：透出模块返回的 WARN（半成品嫌疑/产物缺失）
                for (const w of (loc.warnings || [])) {
                    console.warn('  [WARN] ' + w);
                }
                if (loc.found) {
                    files.push({
                        appKey: key,
                        type: 'apk',
                        path: loc.path,
                        fromBuild: loc.fromBuild,
                        name: config.apkName,
                        size: getFileSize(loc.path),
                        sha256: calculateSHA256(loc.path).toLowerCase(),
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
    // ★ 规范：打包产物禁止自动上传官方下载网站！
    //   默认"只检查不发布"，必须人工检查合规合格后手动加 --publish 才会上传。
    const allowsPublish = args.includes('--publish');

    if (checkOnly || !allowsPublish) {
        console.log('[3/3] 只检查不发布（规范：禁止自动上传官方下载网站）');
        if (changes.length > 0) {
            console.log('  发现 ' + changes.length + ' 个待发布产物。请人工检查优化是否合规合格，确认后手动发布:');
            console.log('    node tools/auto-publish.js --target=' + target + ' --publish');
            console.log('  （--publish 会调用发布工具并携带 --confirm --push，即手动确认+手动部署）');
        } else {
            console.log('  所有文件都是最新，无需发布');
        }
        // ★ 2026-09-01 修复运算符优先级 bug：原 checkOnly || changes.length > 0 ? 2 : 0
        //   被解析为 (checkOnly || ...) ? 2 : 0——check 模式即使无变更也退出码 2，
        //   调用方误判"有待发布变更"。正确语义：有变更=2（待发布），无变更=0（最新）。
        process.exit(changes.length > 0 ? 2 : 0);
    }

    if (changes.length === 0 && !force) {
        // ★ 2026-09-01 无变更提示明确化：官网与本地产物完全一致，非失败。
        console.log('[3/3] 所有文件都是最新，无需发布');
        console.log('\n============================================');
        console.log('  无需发布：官网已是最新版本');
        console.log('============================================');
        console.log('  本地产物与官网 hash 完全一致（' + unchanged.length + ' 个文件比对通过）');
        console.log('  下载页: https://tcm-prescription-system.pages.dev/download');
        console.log('  （如确需强制重新上传，加 --force --publish 参数）');
        console.log('============================================\n');
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

    console.log('[3/3] 人工确认发布（--publish → --confirm --push）...');
    console.log('  版本号: ' + versionTag);
    console.log('  target: ' + publishTarget);
    console.log('  变更文件数: ' + changes.length);
    console.log();

    // ★ 2026-08-30 发布前置：把项目根新构建 APK 同步进 public/downloads/
    //   （publish-release.js 从该目录上传 + Cloudflare Pages 下载源）。
    //   仅在 --publish 人工确认阶段执行——check 模式绝不落盘，遵守
    //   "打包产物禁止自动上传官方下载网站"规范。
    //   同步逻辑收口 artifact-locate.js（带 sha256 校验）。
    for (const f of changes) {
        if (f.type === 'apk' && f.fromBuild) {
            const r = syncApkToDownloads(f);
            if (r.ok) {
                console.log('  [OK] ' + r.message + ' (' + formatSize(f.size) + ')');
            } else {
                console.error('  [ERROR] ' + r.message);
                process.exit(1);
            }
        }
    }

    // ★ 2026-08-28 增量发布：透传 --changed-only，publish-release.js 与 manifest 比对
    //   sha256 后仅上传有变化的产物（原先按类型全量上传，未变化版本的同类型产物也被重传）
    const publishArgs = ['tools/publish-release.js', '--target=' + publishTarget, '--confirm', '--push', '--changed-only', versionTag];
    console.log('  执行命令: node ' + publishArgs.join(' '));
    console.log('--------------------------------------------');

    const result = spawnSync('node', publishArgs, {
        cwd: PROJECT_ROOT,
        stdio: 'inherit',  // 直接透传输出
        timeout: 1200000,  // 20 分钟超时
    });

    console.log('--------------------------------------------');
    if (result.status === 0) {
        // ★ 2026-09-01 结果汇总增强：列明本次上传产物清单 + URL + 生效提示，
        //   用户无需回翻上游日志即可确认"发布了什么、去哪里看"。
        console.log('\n============================================');
        console.log('  发布成功！');
        console.log('============================================');
        console.log('  版本号: ' + versionTag);
        console.log('  本次上传 ' + changes.length + ' 个产物:');
        for (const f of changes) {
            console.log('    - ' + f.name + ' (' + formatSize(f.size) + ')');
        }
        console.log('  Release: https://github.com/kyt61767126/tcm-prescription-system/releases/tag/' + versionTag);
        console.log('  下载页: https://tcm-prescription-system.pages.dev/download');
        console.log('  Cloudflare Pages 将在 1-2 分钟内自动部署下载页');
        console.log('============================================\n');
    } else {
        console.error('\n============================================');
        console.error('  发布失败，退出码: ' + result.status);
        console.error('============================================');
        console.error('  当前状态与补救方法见上方 [ERROR] 明细');
        console.error('  手动重试: node ' + publishArgs.join(' '));
        console.error('============================================\n');
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
