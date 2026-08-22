#!/usr/bin/env node
// ============================================================================
// calculate-hash.js — 打包后计算本地产物 SHA-256（只读打印，绝不改写发布清单）
//
// 用法：node calculate-hash.js
// 运行时机：打包完成后自动运行（集成到 build-app.bat）
//
// ★ 2026-08-23 行为变更（KNOWLEDGE 2.48，根治下载页"哈希不一致"）：
//   旧版把本地构建产物的 sha256/size 写进 public/hash-manifest.json，但 url 仍指向
//   旧发布产物 → 线上下载页显示的校验值与用户实际下载的文件不一致；且
//   auto-publish.js 依赖 manifest 记录"已发布哈希"做变更检测，被构建期改写后检测
//   静默失效；one-click-pack.ps1 -AutoCommit 还会把被改写的 manifest 自动提交上线。
//   现改为只读：manifest 仅由发布工具（publish-release.js /
//   auto-update-downloads.js --confirm / 一键发布.bat）在真正发布时写入。
//
// 功能：
//   1. 查找各APP的APK/exe输出文件并计算 SHA-256（打印到构建日志）
//   2. 与 manifest 已发布哈希对比，提示"一致 / 本地新构建待人工发布"
//   3. 不修改 public/hash-manifest.json
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
};

// 桌面版 exe 搜索路径 (key 与 APK_PATHS 一致, dingzhi 同时含 APK+EXE)
const EXE_PATHS = {
    'cloud': path.join(PROJECT_ROOT, 'app_project', 'db-yunduan', 'cloud_desktop', 'dist'),
    'dingzhi': path.join(PROJECT_ROOT, 'app_project', 'db-offline', 'desktop', 'dist'),
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
 * 只读加载已发布 manifest（用于对比提示；读取失败不影响打印）
 */
function loadManifest() {
    try {
        return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
    } catch (e) {
        return {};
    }
}

/**
 * 对比本地哈希与已发布哈希，返回提示语
 */
function comparePublished(label, sha256, manifest) {
    const appKey = label.split('/')[0];
    const type = label.split('/')[1];
    const entry = manifest[appKey] && manifest[appKey][type];
    if (!entry || !entry.sha256) {
        return '（manifest 暂无记录）';
    }
    if (entry.sha256 === sha256) {
        return '（与已发布版本一致）';
    }
    return '（本地新构建，尚未发布——下载页继续提供已发布旧版属正常；人工核验后经 一键发布.bat / auto-update-downloads.js --confirm 发布）';
}

function main() {
    console.log('[hash] 计算本地产物校验值（只读模式，不修改 hash-manifest.json）...');

    const manifest = loadManifest();
    let count = 0;

    // 计算 APK 校验值
    for (const [key, dir] of Object.entries(APK_PATHS)) {
        const apkFile = findApkFile(dir);
        if (!apkFile) {
            console.log('  [SKIP] ' + key + ' APK 未找到');
            continue;
        }
        const sha256 = calculateSHA256(apkFile);
        const size = getFileSize(apkFile);
        console.log('  [OK] ' + key + ' APK ' + path.basename(apkFile) + ': '
            + sha256.substring(0, 16) + '... (' + (size / 1024 / 1024).toFixed(1) + 'MB) '
            + comparePublished(key + '/apk', sha256, manifest));
        count++;
    }

    // 计算 exe 校验值
    for (const [key, dir] of Object.entries(EXE_PATHS)) {
        const exeFiles = findExeFile(dir);
        if (!exeFiles) {
            console.log('  [SKIP] ' + key + ' exe 未找到');
            continue;
        }

        if (exeFiles.setup) {
            const sha256 = calculateSHA256(exeFiles.setup);
            const size = getFileSize(exeFiles.setup);
            console.log('  [OK] ' + key + ' exe(Setup) ' + path.basename(exeFiles.setup) + ': '
                + sha256.substring(0, 16) + '... (' + (size / 1024 / 1024).toFixed(1) + 'MB) '
                + comparePublished(key + '/exe', sha256, manifest));
            count++;
        }

        if (exeFiles.portable) {
            const sha256 = calculateSHA256(exeFiles.portable);
            const size = getFileSize(exeFiles.portable);
            console.log('  [OK] ' + key + ' exe(Portable) ' + path.basename(exeFiles.portable) + ': '
                + sha256.substring(0, 16) + '... (' + (size / 1024 / 1024).toFixed(1) + 'MB) '
                + comparePublished(key + '/portable', sha256, manifest));
            count++;
        }
    }

    console.log('[hash] 完成: 已列出 ' + count + ' 个本地产物校验值（未写入 manifest——发布时由发布工具更新，保证下载页哈希与实际下载文件一致）');
}

main();
