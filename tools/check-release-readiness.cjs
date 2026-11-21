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
//        [--allow-regress --regress-reason="原因"]
//        一次性放行版本回退（2026-11-15 新增）：仅把 REGRESS-* 由 BLOCK 降为 WARN，
//        并把原因写入 .build-cache/release-audit.log 留档；判定阈值不变、默认仍阻断，
//        其他 BLOCK（HOT-STALE / HOT-MINAPP 等）照旧拦截。
// ============================================================================
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const ARGS = process.argv.slice(2);
const STRICT = ARGS.indexOf('--strict') >= 0;
const JSON_OUT = ARGS.indexOf('--json') >= 0;
// ★ 2026-11-15 一次性放行版本回退（只是把 REGRESS 降级为 WARN，不改判定阈值）。
const ALLOW_REGRESS = ARGS.indexOf('--allow-regress') >= 0;
let REGRESS_REASON = '';
{
    const eqArg = ARGS.filter(a => a.indexOf('--regress-reason=') === 0)[0];
    const idxArg = ARGS.indexOf('--regress-reason');
    if (eqArg) REGRESS_REASON = eqArg.slice('--regress-reason='.length).trim();
    else if (idxArg >= 0 && ARGS[idxArg + 1] && ARGS[idxArg + 1].indexOf('--') !== 0) REGRESS_REASON = String(ARGS[idxArg + 1]).trim();
    // 供 release-menu.ps1 以环境变量透传（仍是显式设置才生效，无默认值）
    if (!REGRESS_REASON && process.env.ALLOW_REGRESS_REASON) REGRESS_REASON = String(process.env.ALLOW_REGRESS_REASON).trim();
}

// ---- ★ 2026-11-21 第四轮：发布目标作用域收窄 ----
//   单版本发布（如只发云端）时，无关版本的 HOT-STALE / REGRESS 不应硬阻断本次发布，
//   否则会被迫重签/重打与本次无关的通道。--scope 默认 all（= 原全量体检行为不变）。
//   cloud   → 仅检查 cloud-desktop / cloud-app + desktop/cloud 通道
//   dingzhi → 仅检查 local-desktop / local-app + desktop/local / app-local 通道
let SCOPE = 'all';
{
    const eqArg = ARGS.filter(a => a.indexOf('--scope=') === 0)[0];
    const idxArg = ARGS.indexOf('--scope');
    if (eqArg) SCOPE = eqArg.slice('--scope='.length).trim();
    else if (idxArg >= 0 && ARGS[idxArg + 1] && ARGS[idxArg + 1].indexOf('--') !== 0) SCOPE = String(ARGS[idxArg + 1]).trim();
    if (['all', 'cloud', 'dingzhi'].indexOf(SCOPE) < 0) SCOPE = 'all';
}
const SCOPE_UNITS = SCOPE === 'cloud' ? ['cloud-desktop', 'cloud-app']
    : SCOPE === 'dingzhi' ? ['local-desktop', 'local-app']
    : ['cloud-desktop', 'cloud-app', 'local-desktop', 'local-app'];
const SCOPE_CHANNELS = SCOPE === 'cloud' ? ['desktop/cloud']
    : SCOPE === 'dingzhi' ? ['desktop/local', 'app-local']
    : ['desktop/cloud', 'desktop/local', 'app-local'];

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
// 作用域视图：单版本发布只看相关端/通道，避免无关 HOT-STALE/REGRESS 阻断本次发布
const scopeLocalVersions = {};
const scopePub = {};
for (const k of SCOPE_UNITS) { scopeLocalVersions[k] = localVersions[k]; scopePub[k] = pub[k]; }

let pending = 0;
for (const k of SCOPE_UNITS) {
    const cur = localVersions[k], old = pub[k];
    if (cur == null) { add('WARN', 'ARTIFACT-MISSING', labels[k] + ' 未找到本地构建产物', '请先执行打包'); continue; }
    if (old == null) { add('WARN', 'PUBLISHED-MISSING', labels[k] + ' 官网 manifest 缺少对应条目', ''); continue; }
    const d = cmpVersion(cur, old);
    if (d > 0) { pending++; add('PENDING', 'PENDING-' + k, labels[k] + ' 待发布：官网 ' + old + ' → 本地 ' + cur, ''); }
    else if (d === 0) add('OK', 'SAME-' + k, labels[k] + ' 版本与官网一致（' + cur + '）', '');
    else add('BLOCK', 'REGRESS-' + k, labels[k] + ' 版本低于官网：官网 ' + old + ' > 本地 ' + cur, '禁止发布回退版本');
}

// ---- 3. last-run.json 全 SKIP 陷阱（★ 2026-10-29 已在 release-menu 修复，降级为 WARN 提示）----
const lastRun = readJson('.build-cache/last-run.json');
const builtArr = lastRun && Array.isArray(lastRun.built) ? lastRun.built : null;
if (pending > 0 && builtArr && builtArr.length === 0) {
    add('WARN', 'FULLFLOW-SKIPPED-PACK',
        '存在 ' + pending + ' 端待发布，但 .build-cache/last-run.json 的 built=[]（上次打包四端全 SKIP）',
        '已修复：全流程不再据此跳过发布，release-menu 会用 auto-publish.js --check 复核官网 manifest；仍待发布就照常上传。');
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
for (const ch of SCOPE_CHANNELS) {
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
    if (SCOPE_UNITS.indexOf('local-app') >= 0 && hot.minAppCode && localVersions['local-app'] && hot.minAppCode > localVersions['local-app']) {
        add('BLOCK', 'HOT-MINAPP-' + ch, '热更 minAppCode=' + hot.minAppCode + ' > 离线 APP versionCode=' + localVersions['local-app'], '旧 APK 装新热包会调不存在的桥方法');
    }
}

// ---- 4.5 一次性放行 REGRESS（显式开关 + 原因留档；判定逻辑本身不变）----
//  2026-11-15：云端桌面版本线重置 1.2.293 → 1.0.x（无外部客户），本地号必然低于官网
//  manifest。只允许用显式 --allow-regress + --regress-reason 放行 REGRESS-* 这一条，
//  其他 BLOCK（HOT-STALE / HOT-MINAPP / 热更 minAppCode）不受影响，仍会中止发布。
const allowedRegress = [];
let regressAuditLog = '';
if (ALLOW_REGRESS) {
    if (!REGRESS_REASON) {
        add('WARN', 'REGRESS-NO-REASON',
            '指定了 --allow-regress 但未提供 --regress-reason，放行不生效（REGRESS 仍为阻断）',
            '补全放行原因后重跑，例如：--allow-regress --regress-reason="原因"');
    } else {
        for (const f of findings) {
            if (f.level === 'BLOCK' && f.id.indexOf('REGRESS-') === 0) {
                const origMsg = f.msg;
                f.level = 'WARN';
                f.msg = origMsg + '（已按一次性开关放行）';
                f.detail = (f.detail ? f.detail + '；' : '') + '一次性放行原因: ' + REGRESS_REASON;
                allowedRegress.push({ id: f.id, finding: origMsg, detail: f.detail });
            }
        }
        if (allowedRegress.length) {
            regressAuditLog = path.join('.build-cache', 'release-audit.log');
            try {
                fs.mkdirSync(path.join(ROOT, '.build-cache'), { recursive: true });
                fs.appendFileSync(path.join(ROOT, regressAuditLog), JSON.stringify({
                    ts: new Date().toISOString(),
                    tool: 'check-release-readiness.cjs',
                    action: 'ALLOW_REGRESS',
                    reason: REGRESS_REASON,
                    argv: ARGS,
                    regress: allowedRegress,
                    localVersions: localVersions,
                    publishedVersions: pub
                }) + '\n', 'utf8');
            } catch (e) {
                regressAuditLog = '';
                add('WARN', 'REGRESS-AUDIT-FAILED', '放行审计写入失败：' + e.message, '放行仍生效，但请手工记录原因');
            }
        }
    }
}

// ---- 5. 输出 ----
const order = { BLOCK: 0, PENDING: 1, WARN: 2, OK: 3 };
findings.sort((a, b) => order[a.level] - order[b.level]);
const blockers = findings.filter(f => f.level === 'BLOCK');
const pend = findings.filter(f => f.level === 'PENDING');
if (JSON_OUT) {
    console.log(JSON.stringify({ ts: new Date().toISOString(), scope: SCOPE, localVersions: scopeLocalVersions, publishedVersions: scopePub, pending, allowRegress: { enabled: ALLOW_REGRESS, reason: REGRESS_REASON, allowed: allowedRegress, auditLog: regressAuditLog }, findings }, null, 2));
} else {
    console.log('============================================');
    console.log('  发布前体检（只读 / 不联网 / 不改文件）' + (SCOPE !== 'all' ? '  [scope=' + SCOPE + ']' : ''));
    console.log('============================================');
    console.log('本地: ' + SCOPE_UNITS.map(k => labels[k] + '=' + scopeLocalVersions[k]).join('  '));
    console.log('官网: ' + SCOPE_UNITS.map(k => labels[k] + '=' + scopePub[k]).join('  '));
    console.log('');
    for (const f of findings) {
        const tag = '[' + f.level + '] ';
        console.log(tag + f.msg);
        if (f.detail) console.log('        → ' + f.detail);
    }
    if (allowedRegress.length) {
        console.log('');
        console.log('[ALLOW-REGRESS] 已放行 ' + allowedRegress.length + ' 条版本回退（一次性开关）');
        console.log('        原因: ' + REGRESS_REASON);
        console.log('        审计留档: ' + (regressAuditLog || '（写入失败，需人工留档）'));
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
