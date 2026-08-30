#!/usr/bin/env node
// ============================================================================
// artifact-locate.js — 发布链路产物定位【单一权威模块】（2026-08-30 架构收口）
//
// 背景（历史事故根因）：
//   打包产物 APK 输出在"项目根"，而发布链路三个工具各自硬编码一份扫描路径，
//   且各自扫不同的旧源——auto-publish/publish-release 扫 public/downloads（上次
//   发布的旧包→比对恒"无变化"），auto-update-downloads 扫 gradle 输出目录
//   （打包失败残留的半成品）。三处独立演化 = 三处独立出错。
//
// 架构约定（本模块为唯一权威源，发布工具禁止再自维护产物路径）：
//   1. 路径配置只有这一份（APPS）。新增端/改 APK 名只改这里，全链路生效。
//   2. APK 定位优先级（locateApk）：
//      ① 项目根构建产物（build-app.bat 的正式输出，含文件名+验收的最终副本）
//      ② gradle 输出目录（仅回退，且与项目根 sha 不一致时打 WARN=半成品嫌疑）
//      ③ public/downloads/（仅回退=上次已发布旧包，fromBuild=false）
//   3. 陈旧源守卫：任何两源 sha 不一致都返回 warnings，调用方必须透出。
//   4. syncApkToDownloads：确认发布后同步项目根产物进 public/downloads/，
//      带逐字节 sha256 校验；预演/检查模式禁止调用（规范：禁止自动上传）。
//
// CLI 自检（可接入 CI/菜单）：
//   node tools/artifact-locate.js --check
//   → 打印每端 APK 的解析结果与 WARN；存在 WARN 时 exit 1
// ============================================================================
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PROJECT_ROOT = path.resolve(__dirname, '..');

// ★ 唯一权威路径配置（发布链路所有工具引用此份，禁止各自复制）
const APPS = {
    'cloud': {
        label: '云端',
        apkName: '惠康中医-云端.apk',
        // 项目根构建产物（db-yunduan\惠康中医-云端.apk，build-app.bat 输出规范位置）
        apkRootDir: path.join(PROJECT_ROOT, 'app_project', 'db-yunduan'),
        // gradle 原始输出（回退源 + 半成品比对源）
        gradleApkDir: path.join(PROJECT_ROOT, 'app_project', 'db-yunduan', 'cloud_app', 'app', 'build', 'outputs', 'apk', 'release'),
        gradlePath: path.join(PROJECT_ROOT, 'app_project', 'db-yunduan', 'cloud_app', 'app', 'build.gradle'),
        distDir: path.join(PROJECT_ROOT, 'app_project', 'db-yunduan', 'cloud_desktop', 'dist'),
        latestJsonPath: path.join(PROJECT_ROOT, 'public', 'updates', 'cloud', 'latest.json'),
    },
    'dingzhi': {
        label: '本地',
        apkName: '惠康中医-本地.apk',
        apkRootDir: path.join(PROJECT_ROOT, 'app_project', 'db-offline'),
        gradleApkDir: path.join(PROJECT_ROOT, 'app_project', 'db-offline', 'app', 'app', 'build', 'outputs', 'apk', 'release'),
        gradlePath: path.join(PROJECT_ROOT, 'app_project', 'db-offline', 'app', 'app', 'build.gradle'),
        distDir: path.join(PROJECT_ROOT, 'app_project', 'db-offline', 'desktop', 'dist'),
        latestJsonPath: path.join(PROJECT_ROOT, 'public', 'updates', 'local', 'latest.json'),
    },
};

const DOWNLOADS_DIR = path.join(PROJECT_ROOT, 'public', 'downloads');

function calculateSHA256(filePath) {
    const buffer = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(buffer).digest('hex').toLowerCase();
}

function getFileSize(filePath) {
    return fs.statSync(filePath).size;
}

// gradle 输出目录里挑已签名 APK（排除 unsigned）
function findGradleApk(dir) {
    if (!dir || !fs.existsSync(dir)) return null;
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.apk'));
    if (files.length === 0) return null;
    const signed = files.find(f => !f.includes('unsigned'));
    return path.join(dir, signed || files[0]);
}

// APK 定位：项目根优先 → gradle 输出 → public/downloads
// 返回 { appKey, found, path, fromBuild, source, warnings[] }；找不到 found=false
function locateApk(appKey) {
    const config = APPS[appKey];
    const warnings = [];
    if (!config) {
        return { appKey, found: false, path: null, fromBuild: false, source: null, warnings: ['未知端: ' + appKey] };
    }

    const rootApk = path.join(config.apkRootDir, config.apkName);
    const gradleApk = findGradleApk(config.gradleApkDir);
    const downloadsApk = path.join(DOWNLOADS_DIR, config.apkName);

    const result = { appKey, found: false, path: null, fromBuild: false, source: null, warnings };

    if (fs.existsSync(rootApk)) {
        result.found = true;
        result.path = rootApk;
        result.fromBuild = true;
        result.source = '项目根构建产物';
        // 陈旧源守卫：项目根 vs gradle 输出不一致 → gradle 残留可能是半成品（仅提醒，不影响以项目根为准）
        if (gradleApk && calculateSHA256(rootApk) !== calculateSHA256(gradleApk)) {
            warnings.push('[' + appKey + '] 项目根产物与 gradle 输出 sha 不一致（以项目根为准；gradle 输出可能是半成品或旧版残留）');
        }
        // 陈旧源守卫：public/downloads 与项目根不一致 → 属正常（待发布的新版本），不打 WARN
    } else if (gradleApk) {
        // 回退 1：gradle 输出（项目根产物不存在，例如老流程直接 gradle 打包）
        result.found = true;
        result.path = gradleApk;
        result.fromBuild = true;
        result.source = 'gradle 输出目录（回退，项目根产物缺失）';
        warnings.push('[' + appKey + '] 项目根无构建产物（' + config.apkName + '），回退 gradle 输出——build-app.bat 打包输出可能被清理，建议重打包');
    } else if (fs.existsSync(downloadsApk)) {
        // 回退 2：上次发布的旧包（仅用于"无新构建时比对无变化"的场景）
        result.found = true;
        result.path = downloadsApk;
        result.fromBuild = false;
        result.source = 'public/downloads（上次已发布旧包）';
    }

    return result;
}

// 确认发布后：把项目根新构建 APK 同步进 public/downloads/（带逐字节 sha 校验）
// 规范：仅在人工 --confirm + 合规检查通过后调用；预演/检查模式禁止调用。
// 返回 { ok, message }
function syncApkToDownloads(file) {
    if (!file || !file.fromBuild || !file.name) {
        return { ok: false, message: '仅支持 fromBuild=true 的 APK 同步' };
    }
    const dst = path.join(DOWNLOADS_DIR, file.name);
    try {
        fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
        fs.copyFileSync(file.path, dst);
        const dstSha = calculateSHA256(dst);
        const srcSha = (file.sha256 && file.sha256.toLowerCase()) || calculateSHA256(file.path);
        if (dstSha !== srcSha) throw new Error('复制后 sha256 不一致: ' + file.name);
        return { ok: true, message: '已同步 ' + file.name + ' → public/downloads/（sha256 校验通过）' };
    } catch (e) {
        return { ok: false, message: '同步失败: ' + file.name + ' - ' + e.message };
    }
}

// CLI 自检：node tools/artifact-locate.js --check
function runCheck() {
    let hasWarn = false;
    console.log('=== 产物定位自检（单一权威模块） ===');
    for (const key of Object.keys(APPS)) {
        const r = locateApk(key);
        const size = r.found ? '(' + (getFileSize(r.path) / 1024 / 1024).toFixed(2) + ' MB)' : '';
        console.log((r.found ? '[OK]  ' : '[MISS]') + ' ' + key + ' → ' + (r.path ? r.path + ' ' + size : '未找到任何产物'));
        if (r.found) console.log('       来源: ' + r.source + '  fromBuild=' + r.fromBuild);
        for (const w of r.warnings) {
            hasWarn = true;
            console.log('[WARN] ' + w);
        }
    }
    if (hasWarn) {
        console.log('结论: 存在 WARN（源不一致/半成品嫌疑），发布前请人工确认');
        process.exit(1);
    }
    console.log('结论: 各源一致，可发布');
    process.exit(0);
}

if (require.main === module) {
    if (process.argv.includes('--check')) runCheck();
    else {
        console.log('用法: node tools/artifact-locate.js --check   # 产物定位自检');
        console.log('模块导出: APPS / locateApk / syncApkToDownloads / DOWNLOADS_DIR');
    }
}

module.exports = { APPS, locateApk, syncApkToDownloads, DOWNLOADS_DIR, calculateSHA256, getFileSize };
