#!/usr/bin/env node
// ============================================================================
// calculate-hash.js — 自动计算 APK/exe 的 SHA-256 校验值并更新 hash-manifest.json
//
// 用法：node calculate-hash.js
// 运行时机：打包完成后自动运行（集成到 build-app.bat）
//
// 功能：
//   1. 查找各APP的APK输出文件
//   2. 计算SHA-256校验值
//   3. 更新 public/hash-manifest.json
//   4. 下载页动态读取显示校验值
// ============================================================================

import { createRequire } from 'module';
import { fileURLToPath } from 'url';
const require = createRequire(import.meta.url);

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 项目根目录 (kyt-zy/) — shared/ 在根目录下1层，只需上溯1级
const PROJECT_ROOT = path.resolve(__dirname, '..');
const MANIFEST_PATH = path.join(PROJECT_ROOT, 'public', 'hash-manifest.json');

// APK 文件搜索路径 (Android 工程根目录: app/)
const APK_PATHS = {
    'dingzhi': path.join(PROJECT_ROOT, 'app_project', 'db-offline', 'app', 'app', 'build', 'outputs', 'apk', 'release'),
    'geren': path.join(PROJECT_ROOT, 'app_project', 'db-offline', 'app_geren', 'app', 'build', 'outputs', 'apk', 'release'),
};

// 桌面版 exe 搜索路径 (key 与 APK_PATHS 一致, dingzhi/geren 同时含 APK+EXE)
const EXE_PATHS = {
    'cloud': path.join(PROJECT_ROOT, 'app_project', 'db-yunduan', 'cloud_desktop', 'dist'),
    'geren-cloud': path.join(PROJECT_ROOT, 'app_project', 'db-yunduan', 'cloud_desktop_geren', 'dist'),
    'dingzhi': path.join(PROJECT_ROOT, 'app_project', 'db-offline', 'desktop', 'dist'),
    'geren': path.join(PROJECT_ROOT, 'app_project', 'db-offline', 'desktop_geren', 'dist'),
};

/**
 * 计算文件的 SHA-256
 */
function calculateSHA256(filePath) {
    const buffer = fs.readFileSync(filePath);
    const hash = crypto.createHash('sha256').update(buffer).digest('hex');
    return hash;
}

/**
 * 获取文件大小（字节）
 */
function getFileSize(filePath) {
    return fs.statSync(filePath).size;
}

/**
 * 在目录中查找 APK 文件
 */
function findApkFile(dir) {
    if (!fs.existsSync(dir)) return null;
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.apk'));
    if (files.length === 0) return null;
    // 优先选择不含 unsigned 的文件
    const signed = files.find(f => !f.includes('unsigned'));
    return path.join(dir, signed || files[0]);
}

/**
 * 在目录中查找 exe 文件
 */
function findExeFile(dir) {
    if (!fs.existsSync(dir)) return null;
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.exe'));
    if (files.length === 0) return null;
    // 优先选择 Setup 安装版
    const setup = files.find(f => f.includes('Setup'));
    const portable = files.find(f => !f.includes('Setup'));
    return {
        setup: setup ? path.join(dir, setup) : null,
        portable: portable ? path.join(dir, portable) : null
    };
}

/**
 * 从 build.gradle 读取版本号
 */
function readVersionFromGradle(appDir) {
    try {
        // Android 工程根目录: app/app/build.gradle
        const gradlePath = path.join(appDir, 'app', 'app', 'build.gradle');
        if (!fs.existsSync(gradlePath)) return '';
        const content = fs.readFileSync(gradlePath, 'utf8');
        const match = content.match(/versionCode\s+(\d+)/);
        const nameMatch = content.match(/versionName\s+"([^"]+)"/);
        if (nameMatch) return nameMatch[1];
        if (match) return match[1];
        return '';
    } catch (e) {
        return '';
    }
}

function main() {
    console.log('[hash] 开始计算文件校验值...');

    // 读取现有 manifest
    let manifest = {};
    try {
        manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
    } catch (e) {
        console.warn('[hash] 读取 manifest 失败，创建新的');
    }

    const now = new Date().toISOString();
    let updated = 0;

    // 计算 APK 校验值
    for (const [key, dir] of Object.entries(APK_PATHS)) {
        const apkFile = findApkFile(dir);
        if (!apkFile) {
            console.log('  [SKIP] ' + key + ' APK 未找到');
            continue;
        }

        const sha256 = calculateSHA256(apkFile);
        const size = getFileSize(apkFile);
        const version = readVersionFromGradle(path.join(dir, '..', '..', '..', '..'));

        if (!manifest[key]) manifest[key] = {};
        // 保留现有 url 和 fileName，避免 auto-update-downloads.js 失败时 url 丢失
        const existingApk = manifest[key].apk || {};
        manifest[key].apk = {
            version: version,
            sha256: sha256,
            url: existingApk.url || '',
            size: size,
            updateTime: now,
            fileName: existingApk.fileName || path.basename(apkFile)
        };

        console.log('  [OK] ' + key + ' APK: ' + sha256.substring(0, 16) + '... (' + (size / 1024 / 1024).toFixed(1) + 'MB)');
        updated++;
    }

    // 计算 exe 校验值
    for (const [key, dir] of Object.entries(EXE_PATHS)) {
        const exeFiles = findExeFile(dir);
        if (!exeFiles) {
            console.log('  [SKIP] ' + key + ' exe 未找到');
            continue;
        }

        if (!manifest[key]) manifest[key] = {};
        const existingExe = manifest[key].exe || {};
        const existingPortable = manifest[key].portable || {};

        if (exeFiles.setup) {
            const sha256 = calculateSHA256(exeFiles.setup);
            const size = getFileSize(exeFiles.setup);
            manifest[key].exe = {
                version: '',
                sha256: sha256,
                url: existingExe.url || '',
                size: size,
                updateTime: now,
                fileName: path.basename(exeFiles.setup)
            };
            console.log('  [OK] ' + key + ' exe(Setup): ' + sha256.substring(0, 16) + '... (' + (size / 1024 / 1024).toFixed(1) + 'MB)');
            updated++;
        }

        if (exeFiles.portable) {
            const sha256 = calculateSHA256(exeFiles.portable);
            const size = getFileSize(exeFiles.portable);
            manifest[key].portable = {
                version: '',
                sha256: sha256,
                url: existingPortable.url || '',
                size: size,
                updateTime: now,
                fileName: path.basename(exeFiles.portable)
            };
            console.log('  [OK] ' + key + ' exe(Portable): ' + sha256.substring(0, 16) + '... (' + (size / 1024 / 1024).toFixed(1) + 'MB)');
            updated++;
        }
    }

    // 写入 manifest
    fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 4), 'utf8');
    console.log('[hash] 完成: 更新 ' + updated + ' 个文件校验值');
    console.log('[hash] 输出: ' + MANIFEST_PATH);
}

main();
