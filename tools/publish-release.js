#!/usr/bin/env node
// ============================================================================
// publish-release.js — 纯终端一键发布到 GitHub Release（绕开网页）
//
// 用法：
//   node tools/publish-release.js --confirm                   # 手动确认后上传所有 APK/exe（默认不 push）
//   node tools/publish-release.js v1.0.0 --confirm --push     # 指定版本号 + 上传 + git push 触发官方页面部署
//   node tools/publish-release.js --target=apk --confirm      # 只上传 APK
//   node tools/publish-release.js --target=exe --confirm      # 只上传 exe
//   node tools/publish-release.js --dry-run                   # 预演不实际上传
//   node tools/publish-release.js --no-push                   # 上传但不 git push（默认本来就不 push）
//
// ★ 规范：打包产物禁止自动上传官方下载网站！
//   - 默认不执行任何上传：必须手动加 --confirm 确认后才会创建 Release 并上传产物。
//   - 默认不 git push：需手动加 --push 才会推送并触发官方下载页面自动部署。
//   - 即：人工检查合规合格后，手动执行带 --confirm [--push] 的命令才算"手动上传"。
//
// 前提条件（无需 gh auth login，无需打开网页）：
//   1. git push 能正常工作（已配置 GitHub HTTPS 凭据，Windows 凭据管理器存有 PAT）
//   2. gh CLI 已安装（winget install GitHub.cli）— 仅用于 gh api 创建 Release
//   3. curl.exe 可用（Windows 10+ 内置）— 用于流式上传大文件
//
// 工作原理：
//   - 从 `git credential fill` 读取 Windows 凭据管理器里的 GitHub PAT
//   - 用 `gh api` 创建 Release（gh release create 有 bug 不可用）
//   - 用 `curl.exe --data-binary @file` 流式上传 asset（支持 75MB+ exe）
//   - 自动更新 public/hash-manifest.json 和 public/updates/{key}/latest.json
//   - git push 触发 Cloudflare Pages 自动部署
//
// 下载 URL 策略：
//   - APK：保留 /downloads/xxx.apk（Cloudflare Pages 主源，国内 CDN 快）
//         同时上传到 Release 作为备份（hash-manifest.json 记录 releaseUrl 字段）
//   - exe：用 GitHub Release 绝对 URL（exe >25MB 超过 Cloudflare Pages 限制）
// ============================================================================

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync, spawnSync } = require('child_process');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const MANIFEST_PATH = path.join(PROJECT_ROOT, 'public', 'hash-manifest.json');
const DOWNLOADS_DIR = path.join(PROJECT_ROOT, 'public', 'downloads');

// 各 APP 配置：APK 文件名、build.gradle 路径、exe 打包输出目录、latest.json 路径
const APP_CONFIG = {
    'cloud': {
        apkName: '惠康中医-云端.apk',
        gradlePath: path.join(PROJECT_ROOT, 'app_project', 'db-yunduan', 'cloud_app', 'app', 'build.gradle'),
        distDir: path.join(PROJECT_ROOT, 'app_project', 'db-yunduan', 'cloud_desktop', 'dist'),
        latestJsonPath: path.join(PROJECT_ROOT, 'public', 'updates', 'cloud', 'latest.json'),
    },
    'dingzhi': {
        apkName: '惠康中医-本地.apk',
        gradlePath: path.join(PROJECT_ROOT, 'app_project', 'db-offline', 'app', 'app', 'build.gradle'),
        distDir: path.join(PROJECT_ROOT, 'app_project', 'db-offline', 'desktop', 'dist'),
        latestJsonPath: path.join(PROJECT_ROOT, 'public', 'updates', 'dingzhi', 'latest.json'),
    },
};

// 从 git credential 读取 GitHub token（无需 gh auth login，无需打开网页）
function getTokenFromGitCredential() {
    try {
        const result = spawnSync('git', ['credential', 'fill'], {
            input: 'protocol=https\nhost=github.com\n\n',
            encoding: 'utf8',
            timeout: 10000
        });
        if (result.status !== 0 || !result.stdout) return null;
        const lines = result.stdout.split('\n');
        for (const line of lines) {
            if (line.startsWith('password=')) {
                return line.substring('password='.length).trim();
            }
        }
        return null;
    } catch (e) {
        return null;
    }
}

function readVersionName(gradlePath) {
    if (!fs.existsSync(gradlePath)) return '';
    const content = fs.readFileSync(gradlePath, 'utf8');
    const m = content.match(/versionName\s+"([^"]+)"/);
    if (!m) return '';
    let v = m[1];
    // build.gradle 里常用 def BUILD_TIME = new Date().format('yyyyMMdd-HHmm', ...)
    // 然后 versionName "1.0.${BUILD_TIME}"，Gradle 插值在脚本外不会执行
    // 这里用当前时间戳替换 ${BUILD_TIME} 占位符（仅用于 release notes 显示，不影响实际版本）
    if (v.includes('${BUILD_TIME}')) {
        const pad = (n) => String(n).padStart(2, '0');
        const now = new Date();
        const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
        v = v.replace(/\$\{BUILD_TIME\}/g, stamp);
    }
    return v;
}

function calculateSHA256(filePath) {
    const buffer = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(buffer).digest('hex');
}

function getFileSize(filePath) {
    return fs.statSync(filePath).size;
}

// 从 git remote origin 解析 owner/repo
function getRepoInfo() {
    try {
        const url = execSync('git config --get remote.origin.url', { encoding: 'utf8' }).trim();
        const m = url.match(/github\.com[/:]([^/]+)\/([^/]+?)(\.git)?$/);
        if (!m) return null;
        return { owner: m[1], repo: m[2] };
    } catch (e) {
        return null;
    }
}

// 准备上传文件：复制到临时目录并重命名（纯英文文件名，GitHub Release 会过滤中文字符）
//   原文件名: 惠康中医-云端 Setup 1.2.0.exe
//   上传文件名: huikang-cloud-setup-1.2.0.exe
//   原文件名: 惠康中医-云端.apk
//   上传文件名: huikang-cloud.apk
function prepareUploadFile(originalPath, originalName, appKey, type) {
    const RELEASE_TMP_DIR = path.join(PROJECT_ROOT, 'tools', '.release-tmp');
    if (!fs.existsSync(RELEASE_TMP_DIR)) {
        fs.mkdirSync(RELEASE_TMP_DIR, { recursive: true });
    }

    // GitHub Release asset 名不支持中文字符（会被过滤成 -.-.x.x.x.exe）
    // 统一用 huikang-{appKey}[-setup]-{version}.exe 或 huikang-{appKey}.apk
    let safeName;
    if (type === 'apk') {
        safeName = `huikang-${appKey}.apk`;
    } else {
        // exe/portable: 从原文件名提取版本号
        const versionMatch = originalName.match(/(\d+\.\d+\.\d+)/);
        const version = versionMatch ? versionMatch[1] : '0.0.0';
        const isSetup = /\bSetup\b/.test(originalName);
        safeName = `huikang-${appKey}${isSetup ? '-setup' : ''}-${version}.exe`;
    }

    const tmpPath = path.join(RELEASE_TMP_DIR, safeName);
    if (!fs.existsSync(tmpPath) || fs.statSync(tmpPath).size !== fs.statSync(originalPath).size) {
        fs.copyFileSync(originalPath, tmpPath);
    }
    return { path: tmpPath, name: safeName };
}

function cleanupReleaseTmp() {
    const RELEASE_TMP_DIR = path.join(PROJECT_ROOT, 'tools', '.release-tmp');
    if (fs.existsSync(RELEASE_TMP_DIR)) {
        try {
            fs.rmSync(RELEASE_TMP_DIR, { recursive: true, force: true });
        } catch (e) {
            // 忽略清理失败
        }
    }
}

// 扫描要上传的文件
function scanFiles(target) {
    const files = [];
    const appKeys = ['all', 'apk', 'exe'].includes(target)
        ? Object.keys(APP_CONFIG)
        : [target];

    for (const key of appKeys) {
        const config = APP_CONFIG[key];
        if (!config) continue;

        // APK（位于 public/downloads/）
        if (target === 'all' || target === 'apk' || target === key) {
            if (config.apkName) {
                const apkPath = path.join(DOWNLOADS_DIR, config.apkName);
                if (fs.existsSync(apkPath)) {
                    files.push({
                        appKey: key,
                        type: 'apk',
                        path: apkPath,
                        name: config.apkName,
                        size: getFileSize(apkPath),
                        sha256: calculateSHA256(apkPath),
                        version: readVersionName(config.gradlePath)
                    });
                }
            }
        }

        // exe（位于各项目 dist/）
        //   惠康中医-xxx Setup X.X.X.exe  → 安装版（type=exe）
        //   惠康中医-xxx X.X.X.exe        → 便携版（type=portable）
        if (target === 'all' || target === 'exe' || target === key) {
            if (config.distDir && fs.existsSync(config.distDir)) {
                const exes = fs.readdirSync(config.distDir).filter(f => f.endsWith('.exe'));
                for (const exe of exes) {
                    const exePath = path.join(config.distDir, exe);
                    const isSetup = /\bSetup\b/.test(exe);
                    // exe/portable 版本取自文件名（如 "惠康中医-云端 Setup 1.2.36.exe" → 1.2.36）
                    // 不能取 build.gradle versionName（软著固定 1.0.0，与桌面版版本号不同）
                    const versionMatch = exe.match(/(\d+\.\d+\.\d+)/);
                    files.push({
                        appKey: key,
                        type: isSetup ? 'exe' : 'portable',
                        path: exePath,
                        name: exe,
                        size: getFileSize(exePath),
                        sha256: calculateSHA256(exePath),
                        version: versionMatch ? versionMatch[1] : readVersionName(config.gradlePath)
                    });
                }
            }
        }
    }

    return files;
}

// 用 gh api 创建 Release（gh release create 有 bug 不可用）
// 返回 { id, htmlUrl, uploadUrl } 或 null
function createReleaseViaApi(token, owner, repo, tag, name, body) {
    const args = [
        'api',
        '--method', 'POST',
        `repos/${owner}/${repo}/releases`,
        '-f', `tag_name=${tag}`,
        '-f', `name=${name}`,
        '-f', `body=${body}`,
        '-H', 'Accept: application/vnd.github+json',
        '--jq', '"{id, html_url, upload_url}"'  // 错误，下面用别的方式
    ];
    // 用 GH_TOKEN 让 gh api 自动认证
    const env = { ...process.env, GH_TOKEN: token };
    // 用 jq 提取需要的字段
    const result = spawnSync('gh', [
        'api', '--method', 'POST',
        `repos/${owner}/${repo}/releases`,
        '-f', `tag_name=${tag}`,
        '-f', `name=${name}`,
        '-f', `body=${body}`,
        '-H', 'Accept: application/vnd.github+json'
    ], { encoding: 'utf8', env, timeout: 60000, cwd: PROJECT_ROOT });

    if (result.status !== 0) {
        return { error: result.stderr || result.stdout || 'unknown error' };
    }
    try {
        const data = JSON.parse(result.stdout);
        return { id: data.id, htmlUrl: data.html_url, uploadUrl: data.upload_url };
    } catch (e) {
        return { error: 'parse json failed: ' + e.message + ', raw: ' + result.stdout };
    }
}

// 用 gh api 查询 Release 是否已存在，返回 release id 或 null
function getReleaseIdByTag(token, owner, repo, tag) {
    const env = { ...process.env, GH_TOKEN: token };
    const result = spawnSync('gh', [
        'api', `repos/${owner}/${repo}/releases/tags/${tag}`,
        '-H', 'Accept: application/vnd.github+json'
    ], { encoding: 'utf8', env, timeout: 30000, cwd: PROJECT_ROOT });
    if (result.status !== 0) return null;
    try {
        const data = JSON.parse(result.stdout);
        return data.id;
    } catch (e) {
        return null;
    }
}

// 用 gh api 删除 Release（回滚用）
function deleteReleaseViaApi(token, owner, repo, releaseId) {
    const env = { ...process.env, GH_TOKEN: token };
    spawnSync('gh', [
        'api', '--method', 'DELETE',
        `repos/${owner}/${repo}/releases/${releaseId}`,
        '-H', 'Accept: application/vnd.github+json'
    ], { encoding: 'utf8', env, timeout: 30000, cwd: PROJECT_ROOT });
}

// 用 gh api 删除已上传的 asset（覆盖同名用）
function deleteAssetViaApi(token, owner, repo, assetId) {
    const env = { ...process.env, GH_TOKEN: token };
    spawnSync('gh', [
        'api', '--method', 'DELETE',
        `repos/${owner}/${repo}/releases/assets/${assetId}`,
        '-H', 'Accept: application/vnd.github+json'
    ], { encoding: 'utf8', env, timeout: 30000, cwd: PROJECT_ROOT });
}

// 查询 Release 下所有 asset，返回 [{ id, name, browser_download_url }]
function listAssetsViaApi(token, owner, repo, releaseId) {
    const env = { ...process.env, GH_TOKEN: token };
    const result = spawnSync('gh', [
        'api', `repos/${owner}/${repo}/releases/${releaseId}/assets`,
        '-H', 'Accept: application/vnd.github+json'
    ], { encoding: 'utf8', env, timeout: 30000, cwd: PROJECT_ROOT });
    if (result.status !== 0) return [];
    try {
        return JSON.parse(result.stdout);
    } catch (e) {
        return [];
    }
}

// 用 curl.exe 流式上传 asset（支持大文件）
// 返回 { browser_download_url, state, size } 或 { error }
function uploadAssetViaCurl(token, owner, repo, releaseId, filePath, fileName) {
    const uploadUrl = `https://uploads.github.com/repos/${owner}/${repo}/releases/${releaseId}/assets?name=${encodeURIComponent(fileName)}`;
    const result = spawnSync('curl.exe', [
        '-s',                     // 静默模式
        '--ssl-no-revoke',        // ★ 跳过证书吊销检查（Windows Schannel 默认会检查 CRL/OCSP，国内网络常失败）
        '-X', 'POST',
        '-H', `Authorization: Bearer ${token}`,
        '-H', 'Accept: application/vnd.github+json',
        '-H', 'Content-Type: application/octet-stream',
        '--data-binary', `@${filePath}`,
        '-w', '\n%{http_code}',   // 末尾输出 HTTP 状态码
        '--max-time', '600',      // 最多 10 分钟
        '--retry', '3',           // 失败自动重试 3 次
        '--retry-delay', '5',     // 每次重试间隔 5 秒
        uploadUrl
    ], { encoding: 'utf8', timeout: 660000, cwd: PROJECT_ROOT, maxBuffer: 10 * 1024 * 1024 });

    if (result.status !== 0) {
        return { error: 'curl.exe failed: ' + (result.stderr || result.stdout || 'unknown') };
    }
    // 输出格式：JSON + 换行 + HTTP 状态码
    const output = result.stdout.trim();
    const lastNewline = output.lastIndexOf('\n');
    const httpCode = lastNewline >= 0 ? output.substring(lastNewline + 1).trim() : '';
    const jsonStr = lastNewline >= 0 ? output.substring(0, lastNewline).trim() : output;

    if (httpCode && !httpCode.startsWith('2')) {
        return { error: `HTTP ${httpCode}: ${jsonStr}` };
    }
    try {
        const data = JSON.parse(jsonStr);
        if (data.message && !data.browser_download_url) {
            return { error: data.message };
        }
        return {
            browser_download_url: data.browser_download_url,
            state: data.state,
            size: data.size
        };
    } catch (e) {
        return { error: 'parse json failed: ' + e.message + ', raw: ' + jsonStr.substring(0, 500) };
    }
}

// 生成版本号 v{YYYY}.{MM}.{DD}
function generateVersionTag() {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `v${now.getFullYear()}.${pad(now.getMonth() + 1)}.${pad(now.getDate())}`;
}

// ★ P2优化：从 git log 自动生成变更日志
function generateReleaseNotes() {
    try {
        // 获取最近的 git tag
        let lastTag = '';
        try {
            lastTag = execSync('git describe --tags --abbrev=0 2>nul', {
                cwd: PROJECT_ROOT, encoding: 'utf8'
            }).trim();
        } catch (e) {
            // 无 tag 时取最近 20 条
        }

        // 获取从上一个 tag 到 HEAD 的 commit messages
        const range = lastTag ? `${lastTag}..HEAD` : 'HEAD~20..HEAD';
        const log = execSync(`git log --oneline --no-merges ${range}`, {
            cwd: PROJECT_ROOT, encoding: 'utf8'
        }).trim();

        if (!log) return '';

        const lines = log.split('\n');
        const categorized = {
            '新增': [],
            '修复': [],
            '安全': [],
            '优化': [],
            '其他': []
        };

        for (const line of lines) {
            const msg = line.replace(/^[a-f0-9]+\s+/, '');
            // 跳过 chore/merge commit
            if (/^chore|^merge|^Merge/i.test(msg)) continue;

            if (/^feat|^add|新增|添加/i.test(msg)) {
                categorized['新增'].push(msg);
            } else if (/^fix|修复|修正|bugfix/i.test(msg)) {
                categorized['修复'].push(msg);
            } else if (/^security|安全|漏洞|vulnerability/i.test(msg)) {
                categorized['安全'].push(msg);
            } else if (/^refactor|^perf|优化|改进|提升/i.test(msg)) {
                categorized['优化'].push(msg);
            } else {
                categorized['其他'].push(msg);
            }
        }

        // 构建格式化日志
        const parts = [];
        const labels = { '新增': '✨', '修复': '🐛', '安全': '🔒', '优化': '⚡', '其他': '📋' };
        for (const [cat, items] of Object.entries(categorized)) {
            if (items.length === 0) continue;
            parts.push(`${labels[cat]} ${cat}:`);
            for (const item of items.slice(0, 10)) {
                parts.push(`  - ${item}`);
            }
        }

        const notes = parts.join('\n');
        console.log('  [changelog] 自动生成变更日志:');
        console.log(notes.split('\n').map(l => '    ' + l).join('\n'));
        return notes || '版本更新';
    } catch (e) {
        console.warn('  [WARN] 变更日志生成失败: ' + e.message);
        return '';
    }
}

function formatSize(bytes) {
    return (bytes / 1024 / 1024).toFixed(2) + ' MB';
}

function main() {
    console.log('============================================');
    console.log('  惠康中医 · GitHub Release 纯终端发布工具');
    console.log('  （无需打开网页，无需 gh auth login）');
    console.log('============================================\n');

    // 解析参数
    const args = process.argv.slice(2);
    let versionTag = '';
    let target = 'all';
    let dryRun = false;
    let doPush = false;
    let confirmed = false;

    for (const arg of args) {
        if (arg.startsWith('--target=')) {
            target = arg.substring('--target='.length);
        } else if (arg === '--dry-run') {
            dryRun = true;
        } else if (arg === '--push') {
            doPush = true;
        } else if (arg === '--confirm' || arg === '--yes') {
            confirmed = true;
        } else if (!arg.startsWith('-')) {
            versionTag = arg;
        }
    }

    const validTargets = ['all', 'apk', 'exe', 'cloud', 'dingzhi'];
    if (!validTargets.includes(target)) {
        console.error(`[ERROR] 未知 target: ${target}，可选: ${validTargets.join('/')}`);
        process.exit(1);
    }

    // 1. 获取 token
    console.log('[1/6] 从 git 凭据获取 GitHub token...');
    const token = getTokenFromGitCredential();
    if (!token) {
        console.error('[ERROR] 无法从 git credential 获取 token');
        console.error('  请确保 git push 能正常工作（git 已配置 GitHub HTTPS 凭据）');
        process.exit(1);
    }
    console.log('  [OK] token 已获取（' + token.substring(0, 4) + '***）\n');

    // 2. 验证 gh CLI + curl.exe
    console.log('[2/6] 验证 gh CLI 和 curl.exe...');
    const env = { ...process.env, GH_TOKEN: token };
    const ghCheck = spawnSync('gh', ['auth', 'status'], { encoding: 'utf8', env, timeout: 15000 });
    if (ghCheck.status !== 0) {
        console.error('[ERROR] gh CLI 验证失败');
        console.error(ghCheck.stderr || ghCheck.stdout);
        process.exit(1);
    }
    const curlCheck = spawnSync('curl.exe', ['--version'], { encoding: 'utf8', timeout: 10000 });
    if (curlCheck.status !== 0) {
        console.error('[ERROR] curl.exe 不可用');
        process.exit(1);
    }
    const accountMatch = (ghCheck.stdout || '').match(/account\s+(\S+)/);
    console.log('  [OK] gh CLI ' + (accountMatch ? '账号 ' + accountMatch[1] : '可用'));
    console.log('  [OK] curl.exe ' + (curlCheck.stdout || '').split('\n')[0].trim());
    console.log();

    // 3. 扫描文件
    console.log('[3/6] 扫描要上传的文件 (target=' + target + ')...');
    const files = scanFiles(target);
    if (files.length === 0) {
        console.error('[ERROR] 没有找到可上传的文件');
        console.error('  APK 位置: public/downloads/*.apk');
        console.error('  exe 位置: 各项目 dist/*.exe');
        console.error('  提示: 先运行 build-app.bat 或 build.bat 打包');
        process.exit(1);
    }
    console.log('  找到 ' + files.length + ' 个文件:');
    for (const f of files) {
        console.log('    - [' + f.appKey + '] ' + f.type + ': ' + f.name + ' (' + formatSize(f.size) + ', v' + f.version + ')');
    }
    console.log();

    if (dryRun) {
        console.log('[DRY-RUN] 预演模式，不实际上传');
        console.log('  版本号: ' + (versionTag || generateVersionTag()));
        console.log('  文件数: ' + files.length);
        return;
    }

    // 4. 版本号
    if (!versionTag) {
        versionTag = generateVersionTag();
        console.log('[4/6] 自动生成版本号: ' + versionTag);
    } else {
        console.log('[4/6] 使用指定版本号: ' + versionTag);
    }
    console.log();

    const repoInfo = getRepoInfo();
    if (!repoInfo) {
        console.error('[ERROR] 无法解析 git remote origin URL');
        process.exit(1);
    }

    // 为每个文件准备临时副本（纯英文文件名，GitHub Release 不支持中文）
    const uploadFiles = files.map(f => {
        const prepared = prepareUploadFile(f.path, f.name, f.appKey, f.type);
        return { ...f, uploadPath: prepared.path, uploadName: prepared.name };
    });

    // ★ 规范：禁止自动上传！必须人工检查合规合格后手动确认
    if (!confirmed) {
        console.log('------------------------------------------------------------');
        console.log('  [规范] 打包产物禁止自动上传官方下载网站！');
        console.log('  已识别 ' + files.length + ' 个待上传文件:');
        for (const f of files) {
            console.log('    - [' + f.appKey + '] ' + f.type + ': ' + f.name + ' (v' + f.version + ')');
        }
        console.log('');
        console.log('  请人工检查优化是否合规合格，确认无误后手动执行:');
        console.log('    node tools/publish-release.js ' + versionTag + ' --target=' + target + ' --confirm [--push]');
        console.log('  --push: 上传完毕后再 git push，触发官方下载页面自动部署');
        console.log('  （当前未确认，本次不创建 Release、不上传任何文件）');
        console.log('------------------------------------------------------------');
        cleanupReleaseTmp();
        process.exit(0);
    }

    // 5. 创建/复用 Release 并上传文件（用 GitHub API + curl.exe）
    console.log('[5/6] 上传文件到 GitHub Release...');
    console.log('  (使用纯英文文件名 huikang-{app}[-setup]-{ver}.exe，避免中文被过滤)');
    console.log('  (使用 gh api 创建 Release + curl.exe 流式上传)\n');

    let releaseId = getReleaseIdByTag(token, repoInfo.owner, repoInfo.repo, versionTag);
    let releaseCreated = false;

    if (releaseId) {
        console.log('  [WARN] Release ' + versionTag + ' 已存在 (id=' + releaseId + ')，覆盖同名文件');
    } else {
        console.log('  [INFO] 创建新 Release ' + versionTag);
        const notesLines = [
            '惠康中医诊所管理系统 ' + versionTag,
            '',
            '包含以下文件:'
        ].concat(uploadFiles.map(f => '- ' + f.uploadName + ' (v' + f.version + ', ' + formatSize(f.size) + ')'));
        const notes = notesLines.join('\n');

        const createResult = createReleaseViaApi(token, repoInfo.owner, repoInfo.repo, versionTag, versionTag, notes);
        if (createResult.error) {
            console.error('[ERROR] 创建 Release 失败:');
            console.error('  ' + createResult.error);
            cleanupReleaseTmp();
            process.exit(1);
        }
        releaseId = createResult.id;
        releaseCreated = true;
        console.log('  [OK] Release 创建成功 (id=' + releaseId + ')');
    }

    // 查询现有 asset，用于覆盖同名
    const existingAssets = listAssetsViaApi(token, repoInfo.owner, repoInfo.repo, releaseId);
    const assetNameToId = {};
    for (const a of existingAssets) {
        assetNameToId[a.name] = a.id;
    }

    // 上传每个文件
    const uploadedAssets = [];  // 记录成功上传的 { file, downloadUrl }
    let failCount = 0;
    for (let fi = 0; fi < uploadFiles.length; fi++) {
        const f = uploadFiles[fi];
        const sizeMB = (f.size / 1024 / 1024).toFixed(1);
        console.log('  [' + (fi + 1) + '/' + uploadFiles.length + '] 上传 ' + f.uploadName + ' (' + sizeMB + ' MB) ...');
        if (f.size > 10 * 1024 * 1024) {
            console.log('      文件较大，上传可能需要几分钟，请耐心等待（勿关闭窗口）...');
        }
        process.stdout.write('      ');

        // 若同名 asset 已存在，先删除
        if (assetNameToId[f.uploadName]) {
            deleteAssetViaApi(token, repoInfo.owner, repoInfo.repo, assetNameToId[f.uploadName]);
        }

        const upResult = uploadAssetViaCurl(token, repoInfo.owner, repoInfo.repo, releaseId, f.uploadPath, f.uploadName);
        if (upResult.error) {
            console.log('失败');
            console.error('    ' + upResult.error.substring(0, 300));
            failCount++;
        } else {
            console.log('OK');
            console.log('      ' + upResult.browser_download_url);
            uploadedAssets.push({ file: f, downloadUrl: upResult.browser_download_url });
        }
    }
    console.log();

    if (uploadedAssets.length === 0) {
        console.error('[ERROR] 所有文件上传失败');
        if (releaseCreated && releaseId) {
            console.log('  回滚：删除空 Release...');
            deleteReleaseViaApi(token, repoInfo.owner, repoInfo.repo, releaseId);
        }
        cleanupReleaseTmp();
        process.exit(1);
    }

    if (failCount > 0) {
        console.log('  [WARN] ' + failCount + ' 个文件上传失败，' + uploadedAssets.length + ' 个成功');
    } else {
        console.log('  [OK] 全部 ' + uploadedAssets.length + ' 个文件上传成功');
    }
    console.log();

    // 6. 更新 hash-manifest.json 和 latest.json
    console.log('[6/6] 更新 hash-manifest.json 和 latest.json...');

    const releaseBaseUrl = 'https://github.com/' + repoInfo.owner + '/' + repoInfo.repo + '/releases/download/' + versionTag;

    let manifest = {};
    try {
        manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
    } catch (e) {
        console.warn('  [WARN] 读取 manifest 失败，创建新的');
    }

    const now = new Date().toISOString();
    const latestUpdates = {};

    for (const { file: f, downloadUrl } of uploadedAssets) {
        if (!manifest[f.appKey]) manifest[f.appKey] = {};
        const releaseUrl = downloadUrl;  // 直接用 GitHub API 返回的 browser_download_url
        const existing = manifest[f.appKey][f.type] || {};

        if (f.type === 'apk') {
            // APK：保留 Cloudflare Pages 相对路径为主源（国内 CDN 快）
            //      同时记录 GitHub Release URL 作为备份源
            manifest[f.appKey][f.type] = {
                version: f.version,
                sha256: f.sha256,
                url: existing.url || ('/downloads/' + f.name),
                releaseUrl: releaseUrl,
                size: f.size,
                updateTime: now,
                fileName: f.name,
                releaseFileName: f.uploadName,
                releaseTag: versionTag
            };
            console.log('  [OK] ' + f.appKey + '.apk → ' + (existing.url || ('/downloads/' + f.name)) + ' (backup: ' + releaseUrl + ')');
        } else {
            // exe/portable：直接用 GitHub Release URL
            manifest[f.appKey][f.type] = {
                version: f.version,
                sha256: f.sha256,
                url: releaseUrl,
                size: f.size,
                updateTime: now,
                fileName: f.name,
                releaseFileName: f.uploadName,
                releaseTag: versionTag
            };
            console.log('  [OK] ' + f.appKey + '.' + f.type + ' → ' + releaseUrl);

            const config = APP_CONFIG[f.appKey];
            if (config && config.latestJsonPath) {
                if (!latestUpdates[f.appKey]) {
                    latestUpdates[f.appKey] = { config: config, exe: null, portable: null };
                }
                if (f.type === 'exe') latestUpdates[f.appKey].exe = releaseUrl;
                if (f.type === 'portable') latestUpdates[f.appKey].portable = releaseUrl;
            }
        }
    }

    fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 4), 'utf8');
    console.log('  [OK] hash-manifest.json 已更新');

    // 更新 latest.json（桌面版自动更新用）
    const latestUpdateKeys = Object.keys(latestUpdates);
    if (latestUpdateKeys.length > 0) {
        // ★ P2优化：自动生成变更日志
        const autoNotes = generateReleaseNotes();
        for (const key of latestUpdateKeys) {
            const info = latestUpdates[key];
            if (!fs.existsSync(info.config.latestJsonPath)) continue;
            let latest = {};
            try {
                latest = JSON.parse(fs.readFileSync(info.config.latestJsonPath, 'utf8'));
            } catch (e) {
                continue;
            }
            if (info.exe) latest.url = info.exe;
            if (info.portable) latest.portableUrl = info.portable;
            // 从文件名提取版本号 "惠康中医-xxx-X.X.X.exe" → "X.X.X"
            const uploaded = uploadedAssets.find(a => a.file.appKey === key && (a.file.type === 'exe' || a.file.type === 'portable'));
            if (uploaded) {
                const vm = uploaded.file.uploadName.match(/(\d+\.\d+\.\d+)/);
                if (vm) {
                    latest.version = vm[1];
                    latest.releaseDate = now.substring(0, 10);
                }
                // 注意：这里不写 latest.sha256！
                // 客户端 update-notifier.js 用单个 sha256 校验实际下载文件，
                // 但 url(安装版) 与 portableUrl(便携版) 是两个不同文件，单一哈希无法同时匹配。
                // 写错会误报"校验失败"并删除下载文件（宁可漏检不可误报）。
                // 哈希展示请用 hash-manifest.json（下载页 SHA-256 栏）。
            }
            // ★ P2优化：自动生成变更日志
            if (autoNotes) {
                latest.releaseNotes = autoNotes;
            }
            // 确保灰度发布字段存在（默认100%）
            if (latest.rolloutPercentage === undefined) {
                latest.rolloutPercentage = 100;
            }
            fs.writeFileSync(info.config.latestJsonPath, JSON.stringify(latest, null, 4), 'utf8');
            console.log('  [OK] ' + key + '/latest.json: url=' + (latest.url || '-') + ', portableUrl=' + (latest.portableUrl || '-'));
        }
    }
    console.log();

    // 清理临时目录
    cleanupReleaseTmp();
    console.log('  [OK] 临时文件已清理\n');

    // 7. git commit + push（触发 Cloudflare Pages 部署）— 默认不 push，需 --push 手动开启
    if (doPush) {
        console.log('提交并推送到 GitHub（--push 手动确认）...');
        try {
            execSync('git add public/hash-manifest.json public/downloads/ public/updates/ .gitignore', { cwd: PROJECT_ROOT, stdio: 'ignore' });
            const status = execSync('git status --porcelain', { cwd: PROJECT_ROOT, encoding: 'utf8' });
            if (status.trim()) {
                execSync('git commit -m "chore(release): 发布 ' + versionTag + ' 到 GitHub Release"', { cwd: PROJECT_ROOT, stdio: 'ignore' });
                execSync('git pull --rebase origin main', { cwd: PROJECT_ROOT, stdio: 'ignore' });
                execSync('git push origin main', { cwd: PROJECT_ROOT, stdio: 'ignore' });
                console.log('  [OK] 推送成功！Cloudflare Pages 将在 1-2 分钟内自动部署\n');
            } else {
                console.log('  [SKIP] 没有变更需要提交\n');
            }
        } catch (e) {
            console.error('  [ERROR] Git 操作失败:', e.message);
            console.error('  请手动执行: git add public/hash-manifest.json public/updates/ && git commit && git push');
        }
    }

    console.log('============================================');
    console.log('  发布成功！');
    console.log('============================================');
    console.log('\nRelease 页面: https://github.com/' + repoInfo.owner + '/' + repoInfo.repo + '/releases/tag/' + versionTag);
    console.log('下载页面: https://tcm-prescription-system.pages.dev/download\n');
}

main();
