#!/usr/bin/env node
// ============================================================================
//  update-manifest.js — 版本清单生成脚本
//
//  功能：
//    1. 读取指定端的 package.json 版本号
//    2. 查找打包生成的 exe 文件（NSIS installer + portable）
//    3. 计算 SHA256 哈希
//    4. 生成 latest.json 版本清单
//    5. 复制 exe 到 public/updates/{channel}/ 目录
//
//  用法：
//    node tools/update-manifest.js <channel> [--release-notes="更新说明"]
//
//  示例：
//    node tools/update-manifest.js dingzhi --release-notes="新增打印功能"
//    node tools/update-manifest.js cloud --release-notes="同步云端功能"
//
//  channel 取值：
//    dingzhi  → app_project/db-offline/desktop/
//    cloud    → app_project/db-yunduan/cloud_desktop/
// ============================================================================

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// 端配置映射
const CHANNEL_CONFIG = {
    dingzhi: {
        dir: 'app_project/db-offline/desktop',
        productName: '惠康中医-本地',
        outputDir: 'dist'
    },
    cloud: {
        dir: 'app_project/db-yunduan/cloud_desktop',
        productName: '惠康中医-云端',
        outputDir: 'dist'
    }
};

// 项目根目录
const ROOT_DIR = path.resolve(__dirname, '..');
const UPDATES_DIR = path.join(ROOT_DIR, 'public', 'updates');

// 解析命令行参数
function parseArgs() {
    const args = process.argv.slice(2);
    const channel = args[0];
    let releaseNotes = '版本更新';

    for (let i = 1; i < args.length; i++) {
        if (args[i].startsWith('--release-notes=')) {
            releaseNotes = args[i].substring('--release-notes='.length);
        }
    }

    if (!channel || !CHANNEL_CONFIG[channel]) {
        console.error('用法: node tools/update-manifest.js <channel> [--release-notes="更新说明"]');
        console.error('channel 取值: dingzhi, cloud');
        process.exit(1);
    }

    return { channel, releaseNotes };
}

// 计算 SHA256 哈希
function calculateSha256(filePath) {
    const buffer = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(buffer).digest('hex');
}

// 查找 exe 文件
function findExeFiles(endDir, outputDir, productName, version) {
    const distPath = path.join(ROOT_DIR, endDir, outputDir);
    if (!fs.existsSync(distPath)) {
        console.warn(`[WARN] 打包目录不存在: ${distPath}`);
        console.warn(`[WARN] 请先运行 npm run build 进行打包`);
        return { installer: null, portable: null };
    }

    const files = fs.readdirSync(distPath);
    const installerName = `${productName}-${version}-Setup.exe`;
    const portableName = `${productName}-${version}.exe`;

    // 也匹配带空格或不同命名风格的文件
    const installerPattern = new RegExp(`${productName}.*${version}.*Setup.*\\.exe$`, 'i');
    const portablePattern = new RegExp(`${productName}.*${version}.*\\.exe$`, 'i');

    let installer = null;
    let portable = null;

    for (const file of files) {
        const fullPath = path.join(distPath, file);
        if (!fs.statSync(fullPath).isFile()) continue;
        if (!file.endsWith('.exe')) continue;

        if (file === installerName || installerPattern.test(file)) {
            installer = { name: file, path: fullPath };
        } else if (file === portableName || (portablePattern.test(file) && !file.includes('Setup'))) {
            portable = { name: file, path: fullPath };
        }
    }

    return { installer, portable };
}

// 复制文件
function copyFile(src, dest) {
    if (!fs.existsSync(src)) return false;
    fs.copyFileSync(src, dest);
    return true;
}

// 生成版本清单
function generateManifest(channel, config, version, releaseNotes, installer, portable) {
    const today = new Date().toISOString().split('T')[0];
    const baseUrl = 'https://tcm-prescription-system.pages.dev/updates';
    const channelDir = path.join(UPDATES_DIR, channel);

    // 确保目录存在
    if (!fs.existsSync(channelDir)) {
        fs.mkdirSync(channelDir, { recursive: true });
    }

    // 复制 exe 文件到 updates 目录
    let installerUrl = '';
    let portableUrl = '';

    if (installer) {
        const destInstaller = path.join(channelDir, installer.name);
        console.log(`[COPY] 安装版: ${installer.path} → ${destInstaller}`);
        copyFile(installer.path, destInstaller);
        installerUrl = `${baseUrl}/${channel}/${encodeURIComponent(installer.name)}`;
    }

    if (portable) {
        const destPortable = path.join(channelDir, portable.name);
        console.log(`[COPY] 便携版: ${portable.path} → ${destPortable}`);
        copyFile(portable.path, destPortable);
        portableUrl = `${baseUrl}/${channel}/${encodeURIComponent(portable.name)}`;
    }

    // 生成 latest.json
    const manifest = {
        version: version,
        releaseDate: today,
        releaseNotes: releaseNotes,
        url: installerUrl,
        portableUrl: portableUrl,
        forceUpdate: false,
        minVersion: '1.0.0'
    };

    // 如果有 exe 文件，计算哈希
    if (installer) {
        manifest.sha256 = calculateSha256(installer.path);
    }

    const manifestPath = path.join(channelDir, 'latest.json');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 4), 'utf8');
    console.log(`[OK] 清单已生成: ${manifestPath}`);
    console.log(JSON.stringify(manifest, null, 2));

    return manifest;
}

// 主流程
function main() {
    const { channel, releaseNotes } = parseArgs();
    const config = CHANNEL_CONFIG[channel];

    console.log(`\n========== 生成 ${config.productName} 版本清单 ==========`);
    console.log(`通道: ${channel}`);
    console.log(`目录: ${config.dir}`);

    // 读取版本号
    const packageJsonPath = path.join(ROOT_DIR, config.dir, 'package.json');
    if (!fs.existsSync(packageJsonPath)) {
        console.error(`[ERROR] package.json 不存在: ${packageJsonPath}`);
        process.exit(1);
    }

    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    const version = packageJson.version;
    console.log(`版本: ${version}`);
    console.log(`更新说明: ${releaseNotes}\n`);

    // 查找 exe 文件
    const { installer, portable } = findExeFiles(config.dir, config.outputDir, config.productName, version);

    if (installer) {
        console.log(`[FOUND] 安装版: ${installer.name}`);
    } else {
        console.warn(`[WARN] 未找到安装版 exe`);
    }

    if (portable) {
        console.log(`[FOUND] 便携版: ${portable.name}`);
    } else {
        console.warn(`[WARN] 未找到便携版 exe`);
    }

    if (!installer && !portable) {
        console.warn(`\n[WARN] 未找到任何 exe 文件，仅更新版本号`);
        console.warn(`[WARN] 请手动复制 exe 到 public/updates/${channel}/ 目录`);
    }

    console.log('');

    // 生成清单
    generateManifest(channel, config, version, releaseNotes, installer, portable);

    console.log(`\n========== 完成 ==========`);
    console.log(`推送 GitHub 后 Cloudflare Pages 自动部署`);
    console.log(`访问 https://tcm-prescription-system.pages.dev/updates/${channel}/latest.json 验证\n`);
}

main();
