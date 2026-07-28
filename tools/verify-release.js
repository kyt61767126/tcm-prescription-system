#!/usr/bin/env node
// ============================================================================
// verify-release.js — 发布后验证工具
//
// 用法：
//   node tools/verify-release.js                  # 验证最新 hash-manifest.json 中所有 URL
//   node tools/verify-release.js v2026.7.25-1430  # 只验证指定版本的 URL
//
// 工作原理：
//   1. 读取 public/hash-manifest.json
//   2. 遍历每个 appKey (cloud/dingzhi/geren) × type (apk/exe/portable)
//   3. 对每个 URL 执行 HEAD 请求（HTTP 5 秒超时，自动跟随重定向）
//   4. 验证 status code 为 200
//   5. 对 GitHub Release URL 还要验证 Content-Length 与 manifest 中 size 一致
//   6. 输出汇总：✅ 全部通过 / ❌ 失败列表
//
// 退出码：
//   0 = 全部通过（或没有匹配的条目）
//   1 = 有失败（网络错误、超时、非 200、Content-Length 不匹配、manifest 解析失败）
//
// URL 处理：
//   - GitHub Release URL（绝对 URL）直接验证
//     格式: https://github.com/{owner}/{repo}/releases/download/{tag}/{filename}
//   - Cloudflare Pages 相对路径 /downloads/xxx.apk
//     拼接成 https://tcm-prescription-system.pages.dev/downloads/xxx.apk
//
// 错误处理：
//   - manifest 文件不存在或 JSON 解析失败 → 直接退出 (exit 1)
//   - 网络错误、超时、非 200 状态码 → 计为失败
//   - GitHub Release URL 的 Content-Length 与 manifest size 不一致 → 计为失败
//   - HEAD 请求自动跟随 301/302/303/307/308 重定向（最多 5 次）
// ============================================================================

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const MANIFEST_PATH = path.join(PROJECT_ROOT, 'public', 'hash-manifest.json');
const CLOUDFLARE_BASE = 'https://tcm-prescription-system.pages.dev';
const TIMEOUT_MS = 5000;
const MAX_REDIRECTS = 5;

// ANSI 颜色码
const C = {
    reset: '\x1b[0m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    cyan: '\x1b[36m',
    gray: '\x1b[90m',
    bold: '\x1b[1m',
};

function logOk(msg) { console.log(C.green + '[OK]' + C.reset + '  ' + msg); }
function logFail(msg) { console.log(C.red + '[FAIL]' + C.reset + ' ' + msg); }
function logInfo(msg) { console.log(C.cyan + '[INFO]' + C.reset + ' ' + msg); }
function logWarn(msg) { console.log(C.yellow + '[WARN]' + C.reset + ' ' + msg); }

// 将 manifest 中的 url 字段解析为完整 URL
function resolveUrl(rawUrl) {
    if (!rawUrl) return null;
    if (rawUrl.startsWith('http://') || rawUrl.startsWith('https://')) {
        return rawUrl;
    }
    if (rawUrl.startsWith('/')) {
        return CLOUDFLARE_BASE + rawUrl;
    }
    return null;
}

// 发送 HEAD 请求并自动跟随重定向，返回 { statusCode, headers, error, finalUrl }
function headRequest(url, timeoutMs, redirectsLeft) {
    return new Promise((resolve) => {
        let encodedUrl;
        try {
            encodedUrl = encodeURI(url);
        } catch (e) {
            resolve({ statusCode: 0, headers: {}, error: 'URL 编码失败: ' + e.message, finalUrl: url });
            return;
        }
        const lib = encodedUrl.startsWith('https://') ? https : http;
        const req = lib.request(encodedUrl, {
            method: 'HEAD',
            timeout: timeoutMs,
            headers: { 'User-Agent': 'verify-release/1.0' }
        }, (res) => {
            res.resume();
            // 跟随重定向
            if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirectsLeft > 0) {
                let nextUrl;
                try {
                    nextUrl = new URL(res.headers.location, encodedUrl).toString();
                } catch (e) {
                    resolve({ statusCode: res.statusCode, headers: res.headers, error: '重定向 URL 解析失败: ' + e.message, finalUrl: encodedUrl });
                    return;
                }
                resolve(headRequest(nextUrl, timeoutMs, redirectsLeft - 1));
                return;
            }
            resolve({ statusCode: res.statusCode, headers: res.headers, error: null, finalUrl: encodedUrl });
        });
        req.on('error', (err) => {
            resolve({ statusCode: 0, headers: {}, error: err.message, finalUrl: encodedUrl });
        });
        req.on('timeout', () => {
            req.destroy(new Error('请求超时 (' + timeoutMs + 'ms)'));
        });
        req.end();
    });
}

// 判断是否为 GitHub Release 下载 URL
function isGitHubReleaseUrl(url) {
    return url.indexOf('://github.com/') !== -1 && url.indexOf('/releases/download/') !== -1;
}

async function verifyEntry(appKey, type, entry, versionFilter) {
    // 版本过滤：若指定了版本号，仅验证 releaseTag 匹配的条目
    if (versionFilter && entry.releaseTag !== versionFilter) {
        return { skipped: true };
    }

    const rawUrl = entry.url;
    const fullUrl = resolveUrl(rawUrl);
    if (!fullUrl) {
        return {
            skipped: false, appKey, type, url: rawUrl,
            ok: false, reason: '无法解析 URL',
        };
    }

    const result = await headRequest(fullUrl, TIMEOUT_MS, MAX_REDIRECTS);

    if (result.error) {
        return {
            skipped: false, appKey, type, url: fullUrl,
            ok: false, reason: result.error,
        };
    }
    if (result.statusCode !== 200) {
        return {
            skipped: false, appKey, type, url: fullUrl,
            ok: false, reason: 'HTTP ' + result.statusCode,
        };
    }

    // GitHub Release URL 额外验证 Content-Length 与 manifest size 一致
    if (isGitHubReleaseUrl(fullUrl) && entry.size) {
        const contentLength = parseInt(result.headers['content-length'] || '0', 10);
        if (contentLength && contentLength !== entry.size) {
            return {
                skipped: false, appKey, type, url: fullUrl,
                ok: false,
                reason: 'Content-Length 不一致: manifest=' + entry.size + ', 实际=' + contentLength,
            };
        }
        if (!contentLength) {
            // Content-Length 缺失，仅警告不视为失败
            return {
                skipped: false, appKey, type, url: fullUrl,
                ok: true, size: entry.size,
                warn: '响应未返回 Content-Length，跳过 size 校验',
            };
        }
    }

    return {
        skipped: false, appKey, type, url: fullUrl,
        ok: true, size: entry.size,
    };
}

async function main() {
    const versionFilter = process.argv[2] || '';

    console.log(C.bold + '============================================' + C.reset);
    console.log(C.bold + '  惠康中医 · 发布后验证工具' + C.reset);
    console.log(C.bold + '============================================' + C.reset);
    console.log();

    // 读取 manifest
    if (!fs.existsSync(MANIFEST_PATH)) {
        logFail('manifest 文件不存在: ' + MANIFEST_PATH);
        process.exit(1);
    }
    let manifest;
    try {
        manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
    } catch (e) {
        logFail('manifest JSON 解析失败: ' + e.message);
        process.exit(1);
    }
    logInfo('已加载 manifest: ' + MANIFEST_PATH);
    if (versionFilter) {
        logInfo('仅验证版本: ' + versionFilter);
    } else {
        logInfo('验证所有版本的 URL');
    }
    console.log();

    // 收集并执行所有验证
    const tasks = [];
    for (const appKey of Object.keys(manifest)) {
        const types = manifest[appKey];
        if (!types || typeof types !== 'object') continue;
        for (const type of Object.keys(types)) {
            const entry = types[type];
            if (!entry || !entry.url) continue;
            tasks.push(verifyEntry(appKey, type, entry, versionFilter));
        }
    }

    const results = await Promise.all(tasks);

    // 输出每个结果
    let passCount = 0;
    let failCount = 0;
    let skipCount = 0;

    for (const r of results) {
        if (r.skipped) {
            skipCount++;
            continue;
        }
        if (r.ok) {
            passCount++;
            const sizeStr = r.size ? ' (' + r.size + ' bytes)' : '';
            logOk('[' + r.appKey + '/' + r.type + ']' + sizeStr + ' ' + r.url);
            if (r.warn) {
                logWarn('  ' + r.warn);
            }
        } else {
            failCount++;
            logFail('[' + r.appKey + '/' + r.type + '] ' + r.url);
            console.log('       ' + C.red + r.reason + C.reset);
        }
    }

    console.log();
    console.log(C.bold + '============================================' + C.reset);
    console.log(C.bold + '  验证汇总' + C.reset);
    console.log(C.bold + '============================================' + C.reset);
    console.log('  通过: ' + C.green + passCount + C.reset);
    console.log('  失败: ' + (failCount > 0 ? C.red : C.reset) + failCount + C.reset);
    console.log('  跳过: ' + C.gray + skipCount + C.reset);
    console.log();

    if (passCount + failCount === 0) {
        logWarn('没有匹配的条目需要验证');
        process.exit(0);
    }

    if (failCount > 0) {
        console.log(C.red + '❌ 有 ' + failCount + ' 个 URL 验证失败' + C.reset);
        process.exit(1);
    } else {
        console.log(C.green + '✅ 全部 ' + passCount + ' 个 URL 验证通过' + C.reset);
        process.exit(0);
    }
}

main().catch((err) => {
    console.error(C.red + '[ERROR] 未捕获异常: ' + err.message + C.reset);
    process.exit(1);
});
