#!/usr/bin/env node
// ============================================================================
//  check-release-readiness.cjs - 发布前只读体检（2026-10-25）
//
//  【为什么需要】2026-10-25 实测暴露两类「产物已构建但发布链会误判/漏发」的问题：
//    ① 一键打包 -AutoCommit 的 push 失败只 WARN，版本副作用提交留在本地（HEAD 领先远程），
//       直接从这种工作区发布会让「本地产物/提交」与「官网/远程」状态分裂；
//    ② 第二次进入打包菜单时四端全部 SKIP，one-click-pack 把 .build-cache/last-run.json
//       的 built 写成 []；随后 release-menu 的「打包+发布全流程」读到 built=[] 即判定
//       「没有检测到任何源码更新 → 自动跳过发布与验证」，而实际本地产物已比官网新 ——
//       用户会误以为已发布，官网仍是旧版本。
//    ③ 热更包与整包脱节：整包 1.0.302 内含 AuthCore 2026-10-24 注册/升级保护改动，
//       但 desktop/local 热更仍停在 2026.10.23-2（旧 AuthCore）→ 新装客户端首次联网会
//       拉旧热包，把页面运行时代码「降级」回旧版。
//
//  【本工具】只读，不改任何文件、不联网、不发布。输出：
//    [PENDING]  本地产物版本 > 官网 hash-manifest 已发布版本（= 有东西待发布）
//    [HOT]      热更包内容/元数据与本地产物源码不一致（发布前需重签）
//    [TRAP]     last-run.json built=[] + 有 PENDING → 全流程会误跳过发布
//    [OK]/[WARN] 版本严格 +1、产物存在性、热更 minAppCode 等
//  退出码：0 = 无阻断（仅提示）；1 = --strict 模式下存在阻断项。
//  用法：node tools/check-release-readiness.cjs [--strict] [--json]
// ============================================================================
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const ARGS = process.argv.slice(2);
const STRICT = ARGS.indexOf('--strict') >= 0;
const JSON_OUT = ARGS.indexOf('--json') >= 0;

const findings = [];
function add(level, id, msg, detail) {
    findings.push({ level: level, id: id, msg: msg, detail: detail || '' });
}
function sha256(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }
// 注意：上游 PowerShell 写出的 JSON 可能带 UTF-8 BOM（如 .build-cache/last-run.json），
// JSON.parse 遇到 BOM 会抛错 → 必须先剥离，否则检测项会被静默跳过。
function readText(rel) {
    try { return fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/^\uFEFF/, ''); } catch (e) { return null; }
}
function readJson(rel) { const t = readText(rel); if (t == null) return null; try { return JSON.parse(t); } catch (e) { return null; } }
function exists(rel) { return fs.existsSync(path.join(ROOT, rel)); }
function textLf(buf) { return /\r\n/.test(buf.toString('latin1')) ? Buffer.from(buf.toString('utf8').replace(/\r\n/g, '\n'), 'utf8') : buf; }
function isTextFile(name) { return /\.(js|html|json|css|md|txt)$/i.test(name); }

// ---- 1. 本地产物（按打包命名约定取版本；与 dist 实际文件名/包内版本一致）----
function distMaxVersion(dir, re) {
    try {
        const names = fs.readdirSync(path.join(ROOT, dir));
        const vers = names.map(n => { const m = n.match(re); return m ? { name: n, version: m[1] } : null; }).filter(Boolean);
        if (!vers.length) return null;
        vers.sort((a, b) => cmpVersion(a.version, b.version));
        return vers[vers.length - 1];
    } catch (e) { return null; }
}
function cmpVersion(a, b) {
    const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const x = pa[i] || 0, y = pb[i] || 0;
        if (x !== y) return x - y;
    }
    return 0;
}
function readGradleCode(rel) {
    try {
        const m = fs.readFileSync(path.join(ROOT, rel), 'utf8').match(/versionCode\s+(\d+)/);
        return m ? parseInt(m[1], 10) : null;
    } catch (e) { return null; }
}

const manifest = readJson('public/hash-manifest.json') || {};
const dist = {
    'cloud-desktop': distMaxVersion('app_project/db-yunduan/cloud_desktop/dist', /Setup\s+(\d+\.\d+\.\d+)\.exe$/),
    'local-desktop': distMaxVersion('app_project/db-offline/desktop/dist', /Setup\s+(\d+\.\d+\.\d+)\.exe$/)
};
const localVersions = {
    'cloud-desktop': dist['cloud-desktop'] ? dist['cloud-desktop'].version : null,
    'cloud-app': readGradleCode('app_project/db-yunduan/cloud_app/app/build.gradle'),
    'local-desktop': dist['local-desktop'] ? dist['local-desktop'].version : null,
    'local-app': readGradleCode('app_project/db-offline/app/app/build.gradle')
};

// ---- 2. 已发布版本（hash-manifest；线上实测与仓库一致，故读仓库即权威）----
const pub = {
    'cloud-desktop': manifest.cloud && manifest.cloud.exe ? manifest.cloud.exe.version : null,
    'cloud-app': manifest.cloud && manifest.cloud.apk ? manifest.cloud.apk.versionCode : null,
    'local-desktop': manifest.local && manifest.local.exe ? manifest.local.exe.version : null,
    'local-app': manifest.local && manifest.local.apk ? manifest.local.apk.versionCode : null
};
const labels = { 'cloud-desktop': '云端桌面', 'cloud-app': '云端 APP', 'local-desktop': '离线桌面', 'local-app': '离线 APP' };

let pending = 0;
for (const k of Object.keys(localVersions)) {
    const cur = localVersions[k], old = pub[k];
    if (cur == null) { add('WARN', 'ARTIFACT-MISSING', labels[k] + ' 未找到本地构建产物', '请先执行打包'); continue; }
    if (old == null) { add('WARN', 'PUBLISHED-MISSING', labels[k] + ' 官网 manifest 缺少对应条目', ''); continue; }
    const d = cmpVersion(cur, old);
    if (d > 0) { pending++; add('PENDING', 'PENDING-' + k, labels[k] + ' 待发布：官网 ' + old + ' → 本地 ' + cur, ''); }
    else if (d === 0) add('OK', 'SAME-' + k, labels[k] + ' 版本与官网一致（' + cur + '）', '');
    else add('BLOCK', 'REGRESS-' + k, labels[k] + ' 版本低于官网：官网 ' + old + ' > 本地 ' + cur, '禁止发布回退版本');
}

// ---- 3. last-run.json 全 SKIP 陷阱 ----
const lastRun = readJson('.build-cache/last-run.json');
const builtArr = lastRun && Array.isArray(lastRun.built) ? lastRun.built : null;
if (pending > 0 && builtArr && builtArr.length === 0) {
    add('BLOCK', 'FULLFLOW-TRAP',
        '存在 ' + pending + ' 端待发布，但 .build-cache/last-run.json 的 built=[]（上次打包四端全 SKIP）',
        '一键发布「打包+发布全流程」会因此判定「无源码更新」自动跳过发布！请改用「仅发布」菜单，或设 NO_BUILD_SKIP=1 强制重打包后再走全流程。');
}

// ---- 4. 热更包一致性（内容 vs 当前源码，按生成器同规则：文本文件 LF 归一）----
const HOT_CHANNELS = {
    'desktop/cloud': {
        dir: 'public/hot-update/desktop/cloud',
        src: 'public',
        overrides: { 'index.html': 'app_project/db-yunduan/cloud_desktop/index.html', 'button-manager.js': 'app_project/db-yunduan/cloud_desktop/button-manager.js' },
        appVersion: localVersions['cloud-desktop'],
        resignCmd: 'node tools/generate-desktop-hotupdate.cjs -c cloud'
    },
    'desktop/local': {
        dir: 'public/hot-update/desktop/local',
        src: 'app_project/db-offline/desktop',
        overrides: {},
        appVersion: localVersions['local-desktop'],
        resignCmd: 'node tools/generate-desktop-hotupdate.cjs -c local'
    },
    'app-local': {
        dir: 'public/hot-update/app-local',
        src: 'app_project/db-offline/app/app/src/main/assets/public',
        overrides: {},
        appVersion: null,
        resignCmd: 'node tools/generate-app-hotupdate.cjs'
    }
};
for (const ch of Object.keys(HOT_CHANNELS)) {
    const cfg = HOT_CHANNELS[ch];
    const vp = path.join(ROOT, cfg.dir, 'version.json');
    if (!fs.existsSync(vp)) { add('WARN', 'HOT-MISSING-' + ch, '热更包缺失：' + cfg.dir + '/version.json', ''); continue; }
    let hot;
    try { hot = JSON.parse(fs.readFileSync(vp, 'utf8')); } catch (e) { add('WARN', 'HOT-BAD-' + ch, '热更 manifest 解析失败：' + cfg.dir, ''); continue; }
    const stale = [];
    for (const f of hot.files || []) {
        const srcRel = cfg.overrides[f.name] || path.join(cfg.src, f.name);
        const srcAbs = path.join(ROOT, srcRel);
        if (!fs.existsSync(srcAbs)) { stale.push(f.name + '(源缺失)'); continue; }
        let buf = fs.readFileSync(srcAbs);
        if (isTextFile(f.name)) buf = textLf(buf);
        if (sha256(buf) !== f.sha256) stale.push(f.name);
    }
    if (stale.length) {
        add('BLOCK', 'HOT-STALE-' + ch,
            '热更 ' + hot.hotVersion + ' 内容落后于当前源码：' + stale.length + '/' + hot.files.length + ' 个文件不一致（' + stale.slice(0, 4).join(', ') + (stale.length > 4 ? ' …' : '') + '）',
            '发布整包前必须重签，否则新装/存量客户端会拉旧热包把运行时代码降级：' + cfg.resignCmd);
    } else {
        const appV = cfg.appVersion;
        const mismatch = appV != null && String(hot.appVersion) !== String(appV);
        add(mismatch ? 'WARN' : 'OK', 'HOT-OK-' + ch,
            '热更 ' + hot.hotVersion + ' 内容与当前源码一致' + (mismatch ? '，但 appVersion=' + hot.appVersion + ' 落后于整包 ' + appV + '（元数据，可重签刷新）' : ''),
            mismatch ? '建议随整包重签刷新 appVersion：' + cfg.resignCmd : '');
    }
    if (hot.minAppCode && localVersions['local-app'] && hot.minAppCode > localVersions['local-app']) {
        add('BLOCK', 'HOT-MINAPP-' + ch, '热更 minAppCode=' + hot.minAppCode + ' > 离线 APP versionCode=' + localVersions['local-app'], '旧 APK 装新热包会调不存在的桥方法');
    }
}

// ---- 5. 输出 ----
const order = { BLOCK: 0, PENDING: 1, WARN: 2, OK: 3 };
findings.sort((a, b) => order[a.level] - order[b.level]);
const blockers = findings.filter(f => f.level === 'BLOCK');
const pend = findings.filter(f => f.level === 'PENDING');
if (JSON_OUT) {
    console.log(JSON.stringify({ ts: new Date().toISOString(), localVersions, publishedVersions: pub, pending, findings }, null, 2));
} else {
    console.log('============================================');
    console.log('  发布前体检（只读 / 不联网 / 不改文件）');
    console.log('============================================');
    console.log('本地: ' + Object.keys(localVersions).map(k => labels[k] + '=' + localVersions[k]).join('  '));
    console.log('官网: ' + Object.keys(pub).map(k => labels[k] + '=' + pub[k]).join('  '));
    console.log('');
    for (const f of findings) {
        const tag = '[' + f.level + '] ';
        console.log(tag + f.msg);
        if (f.detail) console.log('        → ' + f.detail);
    }
    console.log('');
    console.log('============================================');
    console.log('汇总: 待发布 ' + pending + ' 端 / 阻断 ' + blockers.length + ' 项 / 警告 ' + findings.filter(f => f.level === 'WARN').length + ' 项');
    if (blockers.length) console.log('结论: 存在发布阻断项，处理后再发布（详细命令见上方 → 行）。');
    else if (pending > 0) console.log('结论: 可发布；注意上方 PENDING/WARN 项。');
    else console.log('结论: 无待发布版本。');
    console.log('============================================');
}
process.exit(STRICT && blockers.length ? 1 : 0);
