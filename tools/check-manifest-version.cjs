#!/usr/bin/env node
// ============================================================================
// check-manifest-version.cjs — manifest APP 版本号 SSOT 格式硬校验（铁闸/门禁8）
//
// 架构目的（2026-09-10 举一反三建门）：杜绝「发布脚本漏拼 versionCode」
//   导致下载页 APP 卡片显示不完整版本号（如 v1.0.0 而非 v1.0.0.283）的
//   问题复发。hash-manifest.json 有两个写入方（publish-release.js 一键
//   发布 / auto-update-downloads.js 手动发布），历史上双轨格式曾不一致
//   （一键写 V1.0.0.283、手动写裸 1.0.0）。本门禁强制：
//
//   规则（针对 {channel}.apk 节点，channel = cloud / local / dingzhi）：
//     ① version 必须匹配 ^V\d+\.\d+\.\d+\.\d+$（带 V 前缀、四段式，
//        尾段即 versionCode）
//     ② versionCode 必须为正整数，且与 version 尾段一致
//     ③ sha256/size/url/fileName/updateTime 五要素必须齐备
//
//   桌面 exe/portable 节点版本为三段式（1.2.x 含构建号），不在本校验范围。
//
// 用法：
//   node tools/check-manifest-version.cjs           # 校验（exit=1 阻断）
//   node tools/check-manifest-version.cjs --json    # JSON 输出（供 CI）
// 已接入 .githooks/pre-push 第八道门。
// ============================================================================
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MANIFEST = path.join(ROOT, 'public', 'hash-manifest.json');
const APP_CHANNELS = ['cloud', 'local', 'dingzhi'];
const REQUIRED_KEYS = ['sha256', 'size', 'url', 'fileName', 'updateTime'];

const jsonMode = process.argv.includes('--json');
const errors = [];
const warnings = [];

function fail(msg) { errors.push(msg); }
function ok(msg) { warnings.push('[OK] ' + msg); }

if (!fs.existsSync(MANIFEST)) {
    // manifest 尚未生成（新克隆/首次构建前）——不阻断，仅提示
    if (jsonMode) { console.log(JSON.stringify({ pass: true, skipped: 'manifest-not-found' })); }
    else { console.log('[manifest-ver] hash-manifest.json 不存在，跳过（首次构建前属正常）'); }
    process.exit(0);
}

let manifest;
try {
    manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
} catch (e) {
    fail('hash-manifest.json JSON 解析失败: ' + e.message);
    report();
    process.exit(1);
}

for (const ch of APP_CHANNELS) {
    const node = manifest[ch] && manifest[ch].apk;
    if (!node) {
        // 渠道未发布过 APK 时 manifest 可能无该节点——不阻断
        ok(ch + ': 无 apk 节点，跳过');
        continue;
    }

    const v = String(node.version || '');
    // ① 四段式带 V 前缀
    if (!/^V\d+\.\d+\.\d+\.\d+$/.test(v)) {
        fail(ch + '.apk.version "' + v + '" 不符合 SSOT 格式 V{versionName}.{versionCode}（如 V1.0.0.283）——'
            + '发布脚本漏拼 versionCode，参考 tools/auto-update-downloads.js L218-225');
        continue;
    }
    // ② versionCode 一致性
    const tail = parseInt(v.split('.').pop(), 10);
    const vc = node.versionCode;
    if (!(Number.isInteger(vc) && vc > 0)) {
        fail(ch + '.apk.versionCode 缺失或非正整数（当前: ' + JSON.stringify(vc) + '）——'
            + '安卓 startApkUpdateCheck 依赖此字段做整数比较，必须显式携带');
    } else if (vc !== tail) {
        fail(ch + '.apk.version 尾段(' + tail + ') ≠ versionCode(' + vc + ')——两字段必须同源同值');
    } else {
        ok(ch + ': V 格式四段式 + versionCode=' + vc + ' 一致');
    }
    // ③ 要素完整性
    for (const k of REQUIRED_KEYS) {
        if (node[k] === undefined || node[k] === null || node[k] === '') {
            fail(ch + '.apk.' + k + ' 缺失——下载页展示/校验必需字段');
        }
    }
}

// local 与 dingzhi 必须镜像一致（历史教训：双 key 不同步）
if (manifest.dingzhi && manifest.dingzhi.apk && manifest.local && manifest.local.apk) {
    if (manifest.dingzhi.apk.version !== manifest.local.apk.version) {
        fail('dingzhi.apk.version(' + manifest.dingzhi.apk.version + ') ≠ local.apk.version('
            + manifest.local.apk.version + ')——download.html 读 local key，两 key 必须镜像');
    }
}

function report() {
    if (jsonMode) {
        console.log(JSON.stringify({ pass: errors.length === 0, errors: errors, checks: warnings }));
    } else {
        warnings.forEach(w => console.log('[manifest-ver] ' + w));
        if (errors.length) {
            console.log('[manifest-ver] FAIL × ' + errors.length + '：');
            errors.forEach(e => console.log('  ✗ ' + e));
        } else {
            console.log('[manifest-ver] manifest APP 版本 SSOT 校验通过（cloud/local/dingzhi）');
        }
    }
}

report();
process.exit(errors.length ? 1 : 0);
