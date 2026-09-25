#!/usr/bin/env node
// ============================================================================
// rollback.js — 版本回滚工具
//
// 用法：
//   node tools/rollback.js                    # 查看可回滚的版本列表
//   node tools/rollback.js cloud              # 查看 cloud 渠道可回滚版本
//   node tools/rollback.js local              # 查看 local（本地桌面）渠道可回滚版本
//   node tools/rollback.js local 1.1.0        # 回滚 local 到 1.1.0
//   node tools/rollback.js local 1.1.0 --push # 回滚并推送
//   （dingzhi 为 local 旧名兼容别名，自动归一，磁盘路径一律 updates/local）
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
const os = require('os');
const path = require('path');
const { execSync, execFileSync } = require('child_process');

const PROJECT_ROOT = path.resolve(__dirname, '..');

// ★ 2026-09-25 P1-6：本地桌面渠道规范名 local（2026-08-23 dingzhi→local 改名，
//   上传资产 2026-08-31 起统一 huikang-local-* 命名）。dingzhi 保留为命令行兼容别名
//   （与 local 同一对象引用）：旧命令仍可用，但一切磁盘/git 路径一律走 dirName='local'，
//   严禁再写 public/updates/dingzhi（该目录仅由发布/回滚流程维护为 legacy 跳板）。
//   历史坑修复：旧配置 dingzhi 项 latestJsonPath 已指 local 目录，但 git add 仍拼
//   updates/dingzhi 路径（与实际写入的 local 文件不一致，--push 必失败）。
//   assetPattern 用 local|dingzhi 并集：huikang-dingzhi-* 资产（≤1.0.158，共 48 个）
//   仍真实存在于 Releases，保留回滚可见性；新资产（≥1.0.159）均为 huikang-local-*。
const LOCAL_CHANNEL = {
    latestJsonPath: path.join(PROJECT_ROOT, 'public', 'updates', 'local', 'latest.json'),
    assetPattern: /huikang-(?:local|dingzhi).*\.exe$/i,
    name: '本地桌面版',
    dirName: 'local'
};
const CHANNELS = {
    cloud: {
        latestJsonPath: path.join(PROJECT_ROOT, 'public', 'updates', 'cloud', 'latest.json'),
        assetPattern: /huikang-cloud.*\.exe$/i,
        name: '云端桌面版',
        dirName: 'cloud'
    },
    local: LOCAL_CHANNEL,
    dingzhi: LOCAL_CHANNEL
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
        // ★ 2026-09-25 P1-6 修复（双审后复审实锤）：必须 execFileSync + 参数数组。
        //   旧 execSync 字符串模板在 Windows 走 cmd.exe：① jq 正则里的 "|"（并集命名
        //   huikang-(?:local|dingzhi)）被 cmd 当管道符，local 渠道列表确定性失败；
        //   ② jq 字符串字面量中 "\." 是非法转义（云端渠道历史同款 bug，两渠道都列不出）。
        //   数组传参不经 shell 解析；正则源中的单反斜杠替换为双反斜杠以满足 jq 字符串
        //   转义（最终 argv 文本为 test("...\\.exe$")，jq 解析后正则即 \.）；JS 正则的 i
        //   标志不会自动进入 jq，显式传 test(pattern; "i") 保持大小写不敏感（资产名约定
        //   小写，但 flag 不依赖命名约定）。
        const jqPattern = channel.assetPattern.source.replace(/\\/g, '\\\\');
        const jqFilter = '.[] | {tag_name, name, assets: [.assets[] | select(.name | test("'
            + jqPattern + '"; "i")) | {name, browser_download_url, size}]}';
        const output = execFileSync(
            'gh',
            ['api', `repos/${owner}/${repo}/releases`, '--paginate', '--jq', jqFilter],
            { encoding: 'utf8', cwd: PROJECT_ROOT }
        );
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

    const canonical = config.dirName;
    const { owner, repo } = getRepoInfo();
    console.log(`[rollback] 渠道: ${config.name} (${canonical}${channel !== canonical ? `，旧名 ${channel} 已归一` : ''})`);
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
        console.log(`\n用法: node tools/rollback.js ${canonical} <版本号> [--push]`);
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

    // 备份当前版本信息到系统临时目录（禁止写仓库内 .bak：code-quality CI 对 *.bak
    // 残留判红，且发布镜像会把它同步到 site-official）
    const backupPath = path.join(os.tmpdir(), `rollback-${canonical}-${Date.now()}.json`);
    fs.writeFileSync(backupPath, JSON.stringify(latest, null, 4), 'utf8');
    console.log(`[rollback] 已备份当前 latest.json 到 ${backupPath}`);

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

    // ★ 2026-09-25 P1-6：回滚后必须维持与 publish-release 相同的两处不变量，
    // 否则"回滚后~下次发布前"窗口内老客户端仍会收到被撤的坏版本、双 Pages 入口漂移：
    //   ① local 渠道：public/updates/dingzhi legacy 跳板永远等于 local/latest.json
    //      （硬编码旧 URL 的极老客户端只认该文件）；
    //   ② site-official/updates 是 public/updates 的递归镜像（双入口版本一致）。
    // 镜像失败=回滚不完整：大声报错并 exit 1，中止后续 push（与发布链同口径）。
    const addPaths = [
        'public/updates/' + canonical + '/latest.json',
        'site-official/updates/' + canonical + '/latest.json'
    ];
    try {
        if (canonical === 'local') {
            const legacyLatest = path.join(PROJECT_ROOT, 'public', 'updates', 'dingzhi', 'latest.json');
            fs.mkdirSync(path.dirname(legacyLatest), { recursive: true });
            fs.copyFileSync(config.latestJsonPath, legacyLatest);
            addPaths.push('public/updates/dingzhi/latest.json');
            addPaths.push('site-official/updates/dingzhi/latest.json');
        }
        fs.cpSync(
            path.join(PROJECT_ROOT, 'public', 'updates'),
            path.join(PROJECT_ROOT, 'site-official', 'updates'),
            { recursive: true }
        );
        console.log('[rollback] ✓ legacy 跳板与 site-official 镜像已同步');
    } catch (e) {
        console.error('[rollback] 镜像同步失败: ' + e.message);
        console.error('[rollback] latest.json 主文件已回滚但未推送。请手动完成镜像后再提交：');
        if (canonical === 'local') {
            console.error('  Copy-Item public\\updates\\local\\latest.json public\\updates\\dingzhi\\latest.json -Force');
        }
        console.error('  Copy-Item public\\updates site-official\\updates -Recurse -Force');
        console.error('[rollback] 回滚前备份: ' + backupPath);
        process.exit(1);
    }

    // 防静默漂移：cpSync 是目录级、addPaths 是渠道级，若镜像前已存在跨渠道漂移，
    // 会产生本次提交之外的改动——大声列出（不阻断），防紧急回滚后工作区静默留脏。
    try {
        const dirty = execSync('git status --porcelain -- public/updates site-official/updates', {
            cwd: PROJECT_ROOT, encoding: 'utf8'
        }).trim();
        if (dirty) {
            const extra = dirty.split(/\r?\n/)
                .map(l => l.substring(3).trim().replace(/\\/g, '/'))
                .filter(f => f && !addPaths.includes(f));
            if (extra.length) {
                console.warn('[rollback][WARN] 镜像目录存在本次回滚路径之外的改动（不会自动提交，请人工确认）:');
                extra.forEach(f => console.warn('  ' + f));
            }
        }
    } catch (e) { /* git status 探测失败不阻断回滚主流程 */ }

    // 推送
    if (shouldPush) {
        console.log('\n[rollback] 推送到 GitHub...');
        try {
            execSync('git add ' + addPaths.join(' '), {
                cwd: PROJECT_ROOT, stdio: 'ignore'
            });
            execSync(`git commit -m "rollback: ${canonical} ${oldVersion} -> ${targetVersion}"`, {
                cwd: PROJECT_ROOT, stdio: 'ignore'
            });
            execSync('git push origin main', {
                cwd: PROJECT_ROOT, stdio: 'ignore'
            });
            console.log('[rollback] ✓ 推送成功！Cloudflare Pages 将在1-2分钟内自动部署');
            console.log('[rollback] 用户将在下次检查更新时收到回滚版本通知');
        } catch (e) {
            console.error('[rollback] 推送失败:', e.message);
            console.log('[rollback] 请手动执行: git add ' + addPaths.join(' ') + ' && git commit && git push');
            console.log('[rollback] 回滚前备份: ' + backupPath);
        }
    } else {
        console.log('\n[rollback] 未推送（--push 参数可自动推送）');
        console.log('[rollback] 请手动执行: git add ' + addPaths.join(' ') + ' && git commit -m "rollback" && git push');
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
    const listed = new Set();
    for (const val of Object.values(CHANNELS)) {
        if (listed.has(val)) continue;   // dingzhi 与 local 同对象，只列规范名一次
        listed.add(val);
        console.log(`  ${val.dirName.padEnd(10)} ${val.name}`);
    }
    console.log('\n  （dingzhi 为 local 的旧名兼容别名，等价处理）');
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
