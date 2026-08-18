#!/usr/bin/env node
// ============================================================================
// provenance.js — 发布来源声明（Release Provenance）生成
//
// 目的：零成本提升发布信任度。每次发布/更新下载清单时，把"谁、从哪个仓库、
//       哪个 commit、什么工具、何时"构建声明写入 hash-manifest.json 顶层
//       provenance 字段，任何人都可核对产物对应的源码版本（可复现构建）。
//
// 供 publish-release.js / auto-update-downloads.js / calculate-hash.js 等
// 写 hash-manifest.json 的工具共用，保证"一个事实只有一个权威源"。
//
// 用法：
//   const { getProvenance } = require('./provenance');
//   manifest.provenance = getProvenance({ releaseTag: 'v2026.08.19' });
// ============================================================================

const { execSync } = require('child_process');
const os = require('os');

function git(cmd) {
    try {
        return execSync(cmd, { encoding: 'utf8', cwd: process.cwd() }).trim();
    } catch (e) {
        return '';
    }
}

// 读取"权威源"：优先 .git，缺失时回退环境信息（CI/无 git 场景不报错）
function getProvenance(extra = {}) {
    const commit = git('git rev-parse --short=12 HEAD') || git('git rev-parse HEAD');
    const ref = git('git symbolic-ref --short HEAD') || git('git rev-parse --abbrev-ref HEAD');
    const repo = git('git config --get remote.origin.url');
    const builder = git('git config --get user.name') || os.userInfo().username;

    return Object.assign({
        schemaVersion: 1,
        repo: repo || '',
        commit: commit || '',
        ref: ref || '',
        builder: builder || '',
        builtAt: new Date().toISOString(),
        buildTool: 'publish-release.js@' + process.version
    }, extra);
}

module.exports = { getProvenance };
