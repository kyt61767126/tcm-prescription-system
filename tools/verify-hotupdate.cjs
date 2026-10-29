#!/usr/bin/env node
// ============================================================================
//  verify-hotupdate.cjs - 三通道热更包离线校验（签名 + 清单 + 逐文件哈希）
//
//  用途：发布链「热更签发」阶段的自检（tools/hotupdate-stage.ps1 -Mode Verify 调用），
//  也可手工跑：node tools/verify-hotupdate.cjs [desktop/cloud desktop/local app-local]
//
//  校验项：
//    1) version.json 存在且可解析、files 非空；
//    2) 清单每个文件在磁盘存在，size / sha256 与清单一致（防半写、防漏写）；
//    3) Ed25519 签名按客户端同款消息构造复验：
//         desktop/cloud、desktop/local → shared/hot-update-core.cjs（前缀 desktop-hotupdate-v1）
//         app-local                    → tools/generate-app-hotupdate.cjs 导出（前缀 app-hotupdate-v1）
//
//  ★ 公钥单一权威源：桌面用 core.HOT_PUBLIC_KEY_PEM，APP 用 appGen.APP_HOT_PUBLIC_KEY_PEM，
//    本脚本不内联任何公钥常量（轮换时不会漏改）。
//  退出码：0=全部通过；1=有不通过项
// ============================================================================
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const core = require(path.join(ROOT, 'shared', 'hot-update-core.cjs'));
const appGen = require(path.join(__dirname, 'generate-app-hotupdate.cjs'));

const ALL_CHANNELS = ['desktop/cloud', 'desktop/local', 'app-local'];
const argv = process.argv.slice(2).filter(function (a) { return !a.startsWith('-'); });
const channels = argv.length ? argv : ALL_CHANNELS;

function sha256(buf) {
    return crypto.createHash('sha256').update(buf).digest('hex');
}

function verifyOne(channel) {
    const problems = [];
    const dir = path.join(ROOT, 'public', 'hot-update', channel);
    const vp = path.join(dir, 'version.json');
    if (!fs.existsSync(vp)) {
        return { channel: channel, ok: false, hot: '', app: '', problems: ['version.json 缺失'] };
    }
    let m;
    try {
        m = JSON.parse(fs.readFileSync(vp, 'utf8'));
    } catch (e) {
        return { channel: channel, ok: false, hot: '', app: '', problems: ['version.json 解析失败: ' + e.message] };
    }
    const files = Array.isArray(m.files) ? m.files : [];
    if (!files.length) problems.push('清单为空');

    for (const f of files) {
        const fp = path.join(dir, f.name);
        if (!fs.existsSync(fp)) { problems.push('文件缺失: ' + f.name); continue; }
        const buf = fs.readFileSync(fp);
        if (buf.length !== f.size) problems.push('大小不符: ' + f.name + '（' + buf.length + ' != ' + f.size + '）');
        else if (sha256(buf) !== f.sha256) problems.push('哈希不符: ' + f.name);
    }

    let sigOk = false;
    try {
        if (channel === 'app-local') {
            const msg = appGen.buildSignMessage(m.channel, m.hotVersion, m.signedAt, files);
            sigOk = crypto.verify(null, Buffer.from(msg, 'utf8'),
                crypto.createPublicKey(appGen.APP_HOT_PUBLIC_KEY_PEM),
                Buffer.from(String(m.signature || ''), 'base64'));
        } else {
            const msg = core.buildSignMessage(m.channel, m.hotVersion, m.signedAt, files);
            sigOk = crypto.verify(null, Buffer.from(msg, 'utf8'),
                crypto.createPublicKey(core.HOT_PUBLIC_KEY_PEM),
                Buffer.from(String(m.signature || ''), 'base64'));
        }
    } catch (e) {
        problems.push('验签异常: ' + e.message);
    }
    if (!sigOk) problems.push('签名校验失败');

    return {
        channel: channel,
        ok: sigOk && problems.length === 0,
        hot: m.hotVersion || '',
        app: m.appVersion || '',
        problems: problems
    };
}

let failed = 0;
console.log('[HotVerify] 校验通道: ' + channels.join(', '));
for (const ch of channels) {
    const r = verifyOne(ch);
    if (r.ok) {
        console.log('[HotVerify] [OK]   ' + ch.padEnd(14) + ' hot=' + r.hot + ' app=' + r.app);
    } else {
        failed++;
        console.log('[HotVerify] [FAIL] ' + ch.padEnd(14) + ' hot=' + r.hot + ' app=' + r.app);
        for (const p of r.problems) console.log('[HotVerify]        - ' + p);
    }
}
if (failed) {
    console.log('[HotVerify] ' + failed + '/' + channels.length + ' 通道校验未通过');
    process.exit(1);
}
console.log('[HotVerify] 全部通过（签名 + 清单 + 逐文件哈希一致）');
