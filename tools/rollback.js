#!/usr/bin/env node
// ============================================================================
// rollback.js — 版本回滚工具
//
// 用法：
//   node tools/rollback.js                    # 查看可回滚的版本列表
//   node tools/rollback.js cloud              # 查看 cloud 渠道可回滚版本
//   node tools/rollback.js cloud 1.1.0        # 回滚 cloud 到 1.1.0
//   node tools/rollback.js cloud 1.1.0 --push # 回滚并推送
//
// 工作原理：
//   1. 从 GitHub Releases 列出历史版本
//   2. 修改 latest.json 指向指定版本的下载URL
//   3. git push 触发 Cloudflare Pages 部署
//
// 前提条件：
//   - gh CLI 已安装且已认证
//   - git push 能正常工作
// ============================================================================

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const PROJECT_ROOT = path.resolve(__dirname, '..');

const CHANNELS = {
    cloud: {
        latestJsonPath: path.join(PROJECT_ROOT, 'public', 'updates', 'cloud', 'latest.json'),
        assetPattern: /huikang-cloud.*\.exe$/i,
        name: '云端桌面版'
    },
    dingzhi: {
        latestJsonPath: path.join(PROJECT_ROOT, 'public', 'updates', 'dingzhi', 'latest.json'),
        assetPattern: /huikang-dingzhi.*\.exe$/i,
        name: '定制版桌面版'
    },
    geren: {
        latestJsonPath: path.join(PROJECT_ROOT, 'public', 'updates', 'geren', 'latest.json'),
        assetPattern: /huikang-geren.*\.exe$/i,
        name: '个人版桌面版'
    }
};

function getRepoInfo() {
    try {
        const remote = execSync('git remote get-url origin', { encoding: 'utf8' }).trim();
        const match = remote.match(/github\.com[/:]([^/]+)\/([^/.]+)/);
        if (match) return { owner: match[1], repo: match[2] };
    } catch (e) {}
    return { owner: 'kyt61767126', repo: 'tcm-prescription-system' };
}

// 列出所有 Release 及其 assets
function listReleases(owner, repo, channel) {
    try {
        const cmd = `gh api repos/${owner}/${repo}/releases --paginate --jq ".[] | {tag_name, name, assets: [.assets[] | select(.name | test(\\"${channel.assetPattern.source}\\")) | {name, browser_download_url, size}]} "`;
        const output = execSync(cmd, { encoding: 'utf8', cwd: PROJECT_ROOT });
        // 逐行解析 JSON
        const releases = [];
        let current = null;
        let braceDepth = 0;
        let buffer = '';

        for (const char of output) {
            buffer += char;
            if (char === '{') braceDepth++;
            if (char === '}') {
                braceDepth--;
                if (braceDepth === 0) {
                    try {
                        const obj = JSON.parse(buffer);
                        if (obj.assets && obj.assets.length > 0) {
                            releases.push(obj);
                        }
                    } catch (e) {}
                    buffer = '';
                }
            }
        }
        return releases;
    } catch (e) {
        console.error('[rollback] 获取 Release 列表失败:', e.message);
        return [];
    }
}

// 从文件名提取版本号
function extractVersion(fileName) {
    const m = fileName.match(/(\d+\.\d+\.\d+)/);
    return m ? m[1] : null;
}

// 回滚到指定版本
function rollback(channel, targetVersion, shouldPush) {
    const config = CHANNELS[channel];
    if (!config) {
        console.error(`[rollback] 未知渠道: ${channel}`);
        console.log('可用渠道: ' + Object.keys(CHANNELS).join(', '));
        return;
    }

    const { owner, repo } = getRepoInfo();
    console.log(`[rollback] 渠道: ${config.name} (${channel})`);
    console.log(`[rollback] 目标版本: ${targetVersion || '(列出可选项)'}`);
    console.log();

    // 列出所有 Release
    const releases = listReleases(owner, repo, config);
    if (releases.length === 0) {
        console.log('[rollback] 未找到任何历史 Release');
        return;
    }

    // 如果未指定版本，列出可选版本
    if (!targetVersion) {
        console.log('可回滚的版本:');
        console.log('─'.repeat(80));
        for (const rel of releases) {
            for (const asset of rel.assets) {
                const ver = extractVersion(asset.name);
                if (ver) {
                    const sizeMB = (asset.size / 1024 / 1024).toFixed(1);
                    console.log(`  ${ver.padEnd(10)} | ${asset.name} (${sizeMB}MB) | ${rel.tag_name}`);
                }
            }
        }
        console.log('─'.repeat(80));
        console.log(`\n用法: node tools/rollback.js ${channel} <版本号> [--push]`);
        return;
    }

    // 查找目标版本
    let foundAsset = null;
    let foundPortable = null;
    let foundTag = null;
    for (const rel of releases) {
        for (const asset of rel.assets) {
            const ver = extractVersion(asset.name);
            if (ver === targetVersion) {
                if (/setup|installer/i.test(asset.name)) {
                    foundAsset = asset;
                } else if (/portable/i.test(asset.name) || !/setup/i.test(asset.name)) {
                    foundPortable = asset;
                }
                foundTag = rel.tag_name;
            }
        }
    }

    if (!foundAsset && !foundPortable) {
        console.error(`[rollback] 未找到版本 ${targetVersion} 的下载文件`);
        console.log('可回滚的版本见上方列表');
        return;
    }

    console.log(`[rollback] 找到版本 ${targetVersion}:`);
    if (foundAsset) console.log(`  安装版: ${foundAsset.browser_download_url}`);
    if (foundPortable) console.log(`  便携版: ${foundPortable.browser_download_url}`);
    console.log();

    // 读取当前 latest.json
    const latest = JSON.parse(fs.readFileSync(config.latestJsonPath, 'utf8'));
    const oldVersion = latest.version;

    // 备份当前版本信息
    const backupPath = config.latestJsonPath + '.bak';
    fs.writeFileSync(backupPath, JSON.stringify(latest, null, 4), 'utf8');
    console.log(`[rollback] 已备份当前 latest.json 到 ${path.basename(backupPath)}`);

    // 更新 latest.json
    latest.version = targetVersion;
    latest.releaseDate = new Date().toISOString().substring(0, 10);
    if (foundAsset) latest.url = foundAsset.browser_download_url;
    if (foundPortable) latest.portableUrl = foundPortable.browser_download_url;
    latest.releaseNotes = `[回滚] 从 ${oldVersion} 回滚到 ${targetVersion}`;

    // 回滚时移除SHA256（旧版本没有对应hash）
    delete latest.sha256;

    // 回滚时设为全量推送
    latest.rolloutPercentage = 100;

    fs.writeFileSync(config.latestJsonPath, JSON.stringify(latest, null, 4), 'utf8');
    console.log(`[rollback] ✓ latest.json 已更新: ${oldVersion} → ${targetVersion}`);

    // 推送
    if (shouldPush) {
        console.log('\n[rollback] 推送到 GitHub...');
        try {
            execSync('git add public/updates/' + channel + '/latest.json', {
                cwd: PROJECT_ROOT, stdio: 'ignore'
            });
            execSync(`git commit -m "rollback: ${channel} ${oldVersion} -> ${targetVersion}"`, {
                cwd: PROJECT_ROOT, stdio: 'ignore'
            });
            execSync('git push origin main', {
                cwd: PROJECT_ROOT, stdio: 'ignore'
            });
            console.log('[rollback] ✓ 推送成功！Cloudflare Pages 将在1-2分钟内自动部署');
            console.log('[rollback] 用户将在下次检查更新时收到回滚版本通知');
        } catch (e) {
            console.error('[rollback] 推送失败:', e.message);
            console.log('[rollback] 请手动执行: git add public/updates/' + channel + '/latest.json && git commit && git push');
        }
    } else {
        console.log('\n[rollback] 未推送（--push 参数可自动推送）');
        console.log('[rollback] 请手动执行: git add public/updates/' + channel + '/latest.json && git commit -m "rollback" && git push');
    }
}

// 入口
const args = process.argv.slice(2);
const shouldPush = args.includes('--push');
const positional = args.filter(a => !a.startsWith('--'));

if (positional.length === 0) {
    console.log('惠康中医 - 版本回滚工具\n');
    console.log('用法:');
    console.log('  node tools/rollback.js                    # 查看所有渠道');
    console.log('  node tools/rollback.js <channel>          # 查看渠道可回滚版本');
    console.log('  node tools/rollback.js <channel> <ver>    # 回滚到指定版本');
    console.log('  node tools/rollback.js <channel> <ver> --push  # 回滚并推送\n');
    console.log('渠道:');
    for (const [key, val] of Object.entries(CHANNELS)) {
        console.log(`  ${key.padEnd(10)} ${val.name}`);
    }
    process.exit(0);
}

const channel = positional[0];
const targetVersion = positional[1];

if (!CHANNELS[channel]) {
    console.error(`未知渠道: ${channel}`);
    console.log('可用渠道: ' + Object.keys(CHANNELS).join(', '));
    process.exit(1);
}

rollback(channel, targetVersion, shouldPush);
