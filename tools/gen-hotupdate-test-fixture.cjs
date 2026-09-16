#!/usr/bin/env node
// ============================================================================
//  gen-hotupdate-test-fixture.cjs - 生成离线APP热更新 JUnit 测试 fixture
//
//  【用途】HotUpdateManagerTest.java 需要一份【真实 Ed25519 签名】的 manifest
//    fixture，实现 Node 签发 ↔ Java 验签的跨实现交叉验证（协议互通的终极证明）。
//    fixture 不含私钥（签名是确定性的，预生成入库即可），CI 无私钥也能跑测试。
//
//  【产物】app_project/db-offline/app/app/src/test/resources/hotupdate-fixture.json
//    {
//      "manifest":   { format/channel/hotVersion/minAppCode/files/signedAt/signature },
//      "fileContents": { "<name>": "<文件内容>" }   // 仅测试用，resolveEntry 用例
//    }
//
//  【协议】签名消息与 shared/hot-update-core.cjs（桌面端）同构、前缀不同：
//    'app-hotupdate-v1|<channel>|<hotVersion>|<signedAt>|name1:sha256_1:size1|...'
//    —— Java 侧 HotUpdateManager.buildSignMessage 与本脚本逐字符一致（铁律：
//    改一处必改另一处）。
//
//  【私钥】tools/secrets/LICENSE_SIGN_ED25519_PRIVATE_KEY.pem（不入库）。
//    密钥轮换后须重跑本脚本刷新 fixture（公钥常量两处同步：本脚本 + Java 侧
//    HOT_ED25519_PUBLIC_KEY_HEX + LicenseManager.ED25519_VERIFY_PUBLIC_KEY_HEX）。
// ============================================================================
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const PRIVATE_KEY_PATH = path.join(ROOT, 'tools', 'secrets', 'LICENSE_SIGN_ED25519_PRIVATE_KEY.pem');
const OUT = path.join(ROOT, 'app_project', 'db-offline', 'app', 'app', 'src', 'test', 'resources', 'hotupdate-fixture.json');

// 与 Java HotUpdateManager.buildSignMessage 逐字符一致
function buildSignMessage(channel, hotVersion, signedAt, files) {
    const parts = files.map((f) => f.name + ':' + f.sha256 + ':' + f.size);
    return 'app-hotupdate-v1|' + channel + '|' + hotVersion + '|' + signedAt + '|' + parts.join('|');
}

// 固定值（确定性 fixture：签名确定性 → 每次生成结果完全一致，入库可 diff）
const CHANNEL = 'app-local';
const HOT_VERSION = '2026.09.14-1';
const SIGNED_AT = 1730000000000;
const MIN_APP_CODE = 287;

// fixture 文件集（含子目录形态，覆盖 resolveEntry 目录结构）
const fileContents = {
    'index.html': '<!DOCTYPE html><html><head><title>hot-fixture</title></head><body>hot-update-fixture</body></html>',
    'prescription-core.js': '// fixture business code v1\n',
    'medicine-dict.js': '// fixture dict v1\n',
    'vendor/xlsx.full.min.js': '// fixture vendored lib v1\n'
};

const files = Object.keys(fileContents).map((name) => {
    const buf = Buffer.from(fileContents[name], 'utf8');
    return { name: name, sha256: crypto.createHash('sha256').update(buf).digest('hex'), size: buf.length };
});

const msg = buildSignMessage(CHANNEL, HOT_VERSION, SIGNED_AT, files);
const privateKey = fs.readFileSync(PRIVATE_KEY_PATH, 'utf8');
const signature = crypto.sign(null, Buffer.from(msg, 'utf8'), crypto.createPrivateKey(privateKey)).toString('base64');

// ★ 2026-09-16 Layer 1：第二份更旧版本 manifest（rollbackLocal 测试的 previous
//   目标——黑名单拉黑的是版本号，previous 与 current 必须不同版本才能测「恢复后
//   resolveEntry 递归复验通过」链路；独立内容 → 独立真实签名，确定性同上）
const HOT_VERSION_PREV = '2026.09.13-1';
const SIGNED_AT_PREV = 1729000000000;
const fileContentsPrev = {
    'index.html': '<!DOCTYPE html><html><head><title>hot-fixture-prev</title></head><body>hot-update-fixture-prev</body></html>',
    'prescription-core.js': '// fixture business code prev\n',
    'medicine-dict.js': '// fixture dict prev\n',
    'vendor/xlsx.full.min.js': '// fixture vendored lib prev\n'
};
const filesPrev = Object.keys(fileContentsPrev).map((name) => {
    const buf = Buffer.from(fileContentsPrev[name], 'utf8');
    return { name: name, sha256: crypto.createHash('sha256').update(buf).digest('hex'), size: buf.length };
});
const msgPrev = buildSignMessage(CHANNEL, HOT_VERSION_PREV, SIGNED_AT_PREV, filesPrev);
const signaturePrev = crypto.sign(null, Buffer.from(msgPrev, 'utf8'), crypto.createPrivateKey(privateKey)).toString('base64');

// 交叉自验（Node crypto 验一遍，Java 侧 JUnit 再验一遍）
const PUB_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAIsLN/+7riDHGQj8GAJBeU9kuSGXgVEiUYqvTlrbP2rw=
-----END PUBLIC KEY-----`;
if (!crypto.verify(null, Buffer.from(msg, 'utf8'), crypto.createPublicKey(PUB_PEM), Buffer.from(signature, 'base64'))) {
    console.error('[fixture] 自验失败：签名与公钥不匹配（密钥对不一致？）');
    process.exit(1);
}
if (!crypto.verify(null, Buffer.from(msgPrev, 'utf8'), crypto.createPublicKey(PUB_PEM), Buffer.from(signaturePrev, 'base64'))) {
    console.error('[fixture] 自验失败：prev 版本签名与公钥不匹配（密钥对不一致？）');
    process.exit(1);
}

const fixture = {
    _comment: 'HotUpdateManagerTest fixture：真实 Ed25519 签名（Node 签发）。生成工具 tools/gen-hotupdate-test-fixture.cjs，密钥轮换后须重跑。',
    manifest: {
        format: 1,
        channel: CHANNEL,
        hotVersion: HOT_VERSION,
        minAppCode: MIN_APP_CODE,
        appVersion: '1.0.0',
        files: files,
        signedAt: SIGNED_AT,
        signature: signature
    },
    fileContents: fileContents,
    // ★ Layer 1：更旧版本（rollbackLocal 的 previous 目标）
    manifestPrev: {
        format: 1,
        channel: CHANNEL,
        hotVersion: HOT_VERSION_PREV,
        minAppCode: MIN_APP_CODE,
        appVersion: '1.0.0',
        files: filesPrev,
        signedAt: SIGNED_AT_PREV,
        signature: signaturePrev
    },
    fileContentsPrev: fileContentsPrev,
    // Ed25519 独立向量：私钥导出的原始公钥 + 空消息 + 签名
    // （用途：绕开 HOT_ED25519_PUBLIC_KEY_HEX 常量直接测 Java Ed25519 数学正确性）
    ed25519Vector: {
        publicKeyHex: crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'der' }).slice(-32).toString('hex'),
        message: '',
        signatureBase64: crypto.sign(null, Buffer.from('', 'utf8'), crypto.createPrivateKey(privateKey)).toString('base64')
    }
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(fixture, null, 2));
console.log('[fixture] 已生成 ' + path.relative(ROOT, OUT));
console.log('[fixture] 签名=' + signature.slice(0, 24) + '…（' + signature.length + ' chars）');
console.log('[fixture] 文件数=' + files.length + '（含根目录 index.html / 子目录无）');
