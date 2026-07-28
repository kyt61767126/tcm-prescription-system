#!/usr/bin/env node
// ============================================================================
// auto-update-downloads.js — 自动更新下载页面的APK文件
//
// 用法：node auto-update-downloads.js <target>
//   target: dingzhi / geren / cloud / geren-cloud / all
//
// 功能：
//   1. 查找刚打包的APK文件
//   2. 复制到 public/downloads/ 目录
//   3. 计算SHA-256并更新 hash-manifest.json 的 url 和 sha256
//   4. 自动提交并推送到GitHub（Cloudflare Pages自动部署）
// ============================================================================

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const DOWNLOADS_DIR = path.join(PROJECT_ROOT, 'public', 'downloads');
const MANIFEST_PATH = path.join(PROJECT_ROOT, 'public', 'hash-manifest.json');

// 各APP的APK搜索路径和产品名称
const APP_CONFIG = {
    'dingzhi': {
        apkDir: path.join(PROJECT_ROOT, 'offline_project', 'db-dingzhi', 'capacitor', 'app', 'build', 'outputs', 'apk', 'release'),
        outputName: '惠康中医-定制.apk',
        configPath: path.join(PROJECT_ROOT, 'offline_project', 'db-dingzhi', 'config.json')
    },
    'geren': {
        apkDir: path.join(PROJECT_ROOT, 'offline_project', 'db-geren', 'capacitor', 'app', 'build', 'outputs', 'apk', 'release'),
        outputName: '惠康中医-个人.apk',
        configPath: path.join(PROJECT_ROOT, 'offline_project', 'db-geren', 'config.json')
    },
    'cloud': {
        apkDir: path.join(PROJECT_ROOT, 'cloud_project', 'cloud_app', 'app', 'build', 'outputs', 'apk', 'release'),
        outputName: '惠康中医-云端.apk',
        configPath: path.join(PROJECT_ROOT, 'cloud_project', 'config.json')
    },
    'geren-cloud': {
        // 云端个人版：独立项目 cloud_app_geren（包名 com.tcm.prescription.geren）
        apkDir: path.join(PROJECT_ROOT, 'cloud_project', 'cloud_app_geren', 'app', 'build', 'outputs', 'apk', 'release'),
        outputName: '惠康中医-云端个人版.apk',
        configPath: path.join(PROJECT_ROOT, 'cloud_project', 'config.json')
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
    try {
        // Support capacitor/, android/, and direct app/ directory structures
        const capPath = path.join(appDir, 'capacitor', 'app', 'build.gradle');
        const androidPath = path.join(appDir, 'android', 'app', 'build.gradle');
        const directPath = path.join(appDir, 'app', 'build.gradle');
        const gradlePath = fs.existsSync(capPath) ? capPath : (fs.existsSync(androidPath) ? androidPath : (fs.existsSync(directPath) ? directPath : ''));
        if (!gradlePath) return '';
        const content = fs.readFileSync(gradlePath, 'utf8');
        const nameMatch = content.match(/versionName\s+"([^"]+)"/);
        if (nameMatch) return nameMatch[1];
        const match = content.match(/versionCode\s+(\d+)/);
        if (match) return match[1];
        return '';
    } catch (e) {
        return '';
    }
}

function updateDownloads(target) {
    console.log('[auto-update] 开始自动更新下载页面...');

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

        // 查找APK文件
        const apkFile = findApkFile(config.apkDir);
        if (!apkFile) {
            console.log('  [SKIP] ' + key + ' APK 未找到');
            continue;
        }

        // 复制到 downloads 目录
        const destPath = path.join(DOWNLOADS_DIR, config.outputName);
        fs.copyFileSync(apkFile, destPath);
        console.log('  [OK] 复制 ' + config.outputName);

        // 计算 SHA-256
        const sha256 = calculateSHA256(destPath);
        const size = getFileSize(destPath);
        const version = readVersionFromGradle(path.join(config.apkDir, '..', '..', '..', '..'));

        // 更新 manifest
        if (!manifest[key]) manifest[key] = {};
        manifest[key].apk = {
            version: version,
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

    // 写入 manifest
    fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 4), 'utf8');
    console.log('[auto-update] 更新 hash-manifest.json');

    return true;
}

function pushToGitHub() {
    try {
        console.log('[auto-update] 提交并推送到 GitHub...');

        // 添加文件
        execSync('git add public/downloads/ public/hash-manifest.json', { cwd: PROJECT_ROOT, stdio: 'ignore' });

        // 检查是否有变更
        const status = execSync('git status --porcelain', { cwd: PROJECT_ROOT, encoding: 'utf8' });
        if (!status.trim()) {
            console.log('  [SKIP] 没有变更需要提交');
            return;
        }

        // 提交
        execSync('git commit -m "chore(download): 自动更新APK下载文件"', { cwd: PROJECT_ROOT, stdio: 'ignore' });

        // 推送
        execSync('git push origin main', { cwd: PROJECT_ROOT, stdio: 'ignore' });

        console.log('[auto-update] 推送成功！Cloudflare Pages 将在1-2分钟内自动部署');
    } catch (e) {
        console.error('[auto-update] Git操作失败:', e.message);
        console.log('[auto-update] 请手动执行: git add public/downloads/ public/hash-manifest.json && git commit && git push');
    }
}

function main() {
    const target = process.argv[2] || 'all';

    if (!['dingzhi', 'geren', 'cloud', 'geren-cloud', 'all'].includes(target)) {
        console.error('用法: node auto-update-downloads.js <target>');
        console.error('  target: dingzhi / geren / cloud / geren-cloud / all');
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
