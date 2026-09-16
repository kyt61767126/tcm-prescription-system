#!/usr/bin/env node
// ============================================================================
//  rollback-hotupdate.cjs — 热更新一键回滚工具（Layer 0 服务端回滚）
//
//  【解决什么】签名合法但内容有 bug 的热包（门禁验完整性≠验正确性）：
//    现状只能"向前修"（再发新包），营业时间用户要顶着 bug 等修复。
//
//  【原理】（已核实 HotUpdateManager.java:165 / hot-update-core.cjs:176）
//    客户端版本判定 =「hotVersion ≠ 本地 && signedAt > 本地」→ 应用。
//    热包是全量快照 → 把旧版内容重新哈希+重签、发布为更高版本号，
//    全体客户端视为"升级"，下次检查即恢复旧内容。
//    零客户端改动、零发版，覆盖全部在装设备（APP 288-292 + 双桌面）。
//    回滚的回滚也成立（对称操作：再回滚到回滚前版本即可）。
//
//  【回滚目标从哪来】git 历史——每个热包发布完整提交在
//    public/hot-update/<channel>/ 下，`git cat-file blob <commit>:path`
//    取字节。重算哈希（不沿用旧清单哈希——自动修正 desktop 渠道
//    CRLF 时代的清单病），git blob 即 LF = 磁盘 = 入库 = 线上四方一致。
//
//  【用法】
//    node tools/rollback-hotupdate.cjs -c app-local --list          # 列历史版本
//    node tools/rollback-hotupdate.cjs -c app-local                  # 整包回滚到上一版
//    node tools/rollback-hotupdate.cjs -c local -v 2026.09.15-7     # 回滚到指定版本
//    node tools/rollback-hotupdate.cjs -c local -f auth-core.js      # 只回滚指定文件（其余保持线上现状）
//    node tools/rollback-hotupdate.cjs -c app-local --dry-run        # 只打印计划不写盘
//    node tools/rollback-hotupdate.cjs --interactive                 # 交互式（一键回滚热包.bat 入口）
//
//  【渠道】app-local（离线APP）| local（离线桌面）| cloud（云桌面）
//
//  【发布】git push → CF Pages 自动部署（2-3 分钟）。恢复时效：
//    APP 292+ 登录页当次生效（智能热重载）；其余设备下次启动生效。
//
//  【私钥】tools/secrets/LICENSE_SIGN_ED25519_PRIVATE_KEY.pem（与两个
//  生成工具同一信任根；公钥常量内置客户端）
// ============================================================================
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PRIVATE_KEY_PATH = path.join(ROOT, 'tools', 'secrets', 'LICENSE_SIGN_ED25519_PRIVATE_KEY.pem');
const PUB_PEM = '-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAIsLN/+7riDHGQj8GAJBeU9kuSGXgVEiUYqvTlrbP2rw=\n-----END PUBLIC KEY-----';
const HOT_VERSION_RE = /^\d{4}\.\d{2}\.\d{2}-\d+$/;
const SAFE_NAME_RE = /^[A-Za-z0-9_.\/-]+$/;
const MAX_FILES = 50;
const MAX_FILE_BYTES = 20 * 1048576;

const CHANNELS = {
    'app-local': { dir: 'public/hot-update/app-local', channel: 'app-local', prefix: 'app-hotupdate-v1', isApp: true, name: '离线APP' },
    'local':     { dir: 'public/hot-update/desktop/local', channel: 'local', prefix: 'desktop-hotupdate-v1', isApp: false, name: '离线桌面' },
    'cloud':     { dir: 'public/hot-update/desktop/cloud', channel: 'cloud', prefix: 'desktop-hotupdate-v1', isApp: false, name: '云桌面' }
};

function execTxt(cmd) {
    return execSync(cmd, { cwd: ROOT, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
}
function execBuf(cmd) {
    return execSync(cmd, { cwd: ROOT, maxBuffer: 20 * 1024 * 1024 });
}
function fail(msg) {
    console.error('[Rollback] ' + msg);
    process.exit(1);
}

// ---------------------------------------------------------------------------
// git 历史遍历：按发布时间倒序取该渠道全部历史版本（去重）
//   每次热包发布 = 一个改 version.json 的 commit；该 commit 的树上
//   version.json 与散文件是同一份快照（生成工具一体写出、一体提交）
// ---------------------------------------------------------------------------
function listVersions(ch) {
    const rel = CHANNELS[ch].dir + '/version.json';
    let commits;
    try {
        commits = execTxt('git log --format=%H -- ' + rel).trim().split('\n').filter(Boolean);
    } catch (e) { return []; }
    const seen = new Set();
    const out = [];
    for (const c of commits) {
        if (out.length >= 60) break;
        let m;
        try { m = JSON.parse(execTxt('git show ' + c + ':' + rel)); } catch (e) { continue; }
        const hv = m && m.hotVersion;
        if (!hv || !HOT_VERSION_RE.test(hv) || seen.has(hv)) continue;
        seen.add(hv);
        out.push({ hotVersion: hv, commit: c, manifest: m });
    }
    return out;
}

function readBlob(commit, relPath) {
    return execBuf('git cat-file blob ' + commit + ':' + relPath);
}

// ---------------------------------------------------------------------------
// 组装回滚包（纯函数：产出 {files:[{name,sha256,size}], bufs:Map}）
//   整包回滚：文件清单=目标版清单，字节全部取目标版
//   单文件回滚：文件清单=当前线上清单，指定文件取目标版，其余取当前
// ---------------------------------------------------------------------------
function composeRollback(ch, current, target, onlyFiles /* Set|null */) {
    const rel = CHANNELS[ch].dir;
    const files = [];
    const bufs = new Map();
    const list = onlyFiles ? current.manifest.files : target.manifest.files;
    for (const f of list) {
        if (!f || typeof f.name !== 'string' || !SAFE_NAME_RE.test(f.name) || f.name.includes('..')) {
            fail('历史清单文件名非法: ' + JSON.stringify(f && f.name));
        }
        const fromTarget = !onlyFiles || onlyFiles.has(f.name);
        const src = fromTarget ? target : current;
        let buf;
        try {
            buf = readBlob(src.commit, rel + '/' + f.name);
        } catch (e) {
            fail('git 历史缺文件: ' + f.name + ' @' + src.hotVersion + '（' + e.message.split('\n')[0] + '）');
        }
        if (!buf || buf.length === 0 || buf.length > MAX_FILE_BYTES) {
            fail('文件大小越界（1B..20MB）: ' + f.name + ' = ' + buf.length);
        }
        // ★ 重算哈希——绝不沿用旧清单哈希（自动修正 CRLF 时代的清单病）
        bufs.set(f.name, buf);
        files.push({ name: f.name, sha256: crypto.createHash('sha256').update(buf).digest('hex'), size: buf.length });
    }
    if (files.length === 0 || files.length > MAX_FILES) fail('文件数越界（1..' + MAX_FILES + '）: ' + files.length);
    if (!files.some((f) => f.name === 'index.html')) fail('index.html 必须在清单（resolveEntry 入口）');
    return { files: files, bufs: bufs };
}

// 新版本号 = 今日日期-序号，序号跳过历史已占用值（保证全局唯一；
// 客户端判定只要求 hotVersion≠本地 && signedAt 更新，日期无关）
function nextHotVersion(allVersions) {
    const now = new Date();
    const pad = (x) => String(x).padStart(2, '0');
    const today = now.getFullYear() + '.' + pad(now.getMonth() + 1) + '.' + pad(now.getDate());
    const used = new Set(allVersions.map((v) => v.hotVersion));
    let seq = 1;
    while (used.has(today + '-' + seq)) seq++;
    return today + '-' + seq;
}

function buildSignMessage(prefix, channel, hotVersion, signedAt, files) {
    const parts = files.map((f) => f.name + ':' + f.sha256 + ':' + f.size);
    return prefix + '|' + channel + '|' + hotVersion + '|' + signedAt + '|' + parts.join('|');
}

// ---------------------------------------------------------------------------
// 写盘 + 自验（写失败自动 git checkout 还原渠道目录——开工前已校验净树）
// ---------------------------------------------------------------------------
function writePackage(ch, version, bufs, outDirOverride) {
    const outDir = outDirOverride || path.join(ROOT, CHANNELS[ch].dir);
    fs.mkdirSync(outDir, { recursive: true });
    for (const ent of fs.readdirSync(outDir)) {
        fs.rmSync(path.join(outDir, ent), { recursive: true, force: true });
    }
    for (const f of version.files) {
        const dst = path.join(outDir, f.name);
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        fs.writeFileSync(dst, bufs.get(f.name));
    }
    fs.writeFileSync(path.join(outDir, 'version.json'), JSON.stringify(version, null, 2));
    // 回读复验
    for (const f of version.files) {
        const rb = fs.readFileSync(path.join(outDir, f.name));
        if (rb.length !== f.size || crypto.createHash('sha256').update(rb).digest('hex') !== f.sha256) {
            if (!outDirOverride) {
                console.error('[Rollback] 回读复验失败: ' + f.name + '，自动还原渠道目录');
                try { execTxt('git checkout -- ' + CHANNELS[ch].dir); } catch (e) {}
            }
            fail('回读复验失败: ' + f.name);
        }
    }
}

// ---------------------------------------------------------------------------
// 主流程（CLI 模式；interactive 模式组装参数后复用）
// ---------------------------------------------------------------------------
function performRollback(ch, opts) {
    const conf = CHANNELS[ch];
    // 守卫①：渠道目录必须是净树（在脏树上回滚=混乱源）
    const dirty = execTxt('git status --porcelain -- ' + conf.dir).trim();
    if (dirty && !opts.out) fail('渠道目录有未提交改动，先提交/还原再回滚：\n  ' + dirty);

    const versions = listVersions(ch);
    if (versions.length < 2) fail('该渠道历史版本不足 2 个（' + versions.length + '），无可回滚目标');

    const current = versions[0];
    let target = null;
    if (opts.version) {
        target = versions.find((v) => v.hotVersion === opts.version) || null;
        if (!target) fail('历史中找不到目标版本: ' + opts.version + '（--list 查看可用版本）');
    } else {
        target = versions[1];
    }
    if (target.hotVersion === current.hotVersion) fail('目标版本=当前线上版本，无需回滚');

    // 单文件模式校验
    let onlyFiles = null;
    if (opts.files) {
        onlyFiles = new Set(opts.files);
        const curNames = new Set(current.manifest.files.map((f) => f.name));
        const tgtNames = new Set(target.manifest.files.map((f) => f.name));
        for (const n of onlyFiles) {
            if (!curNames.has(n)) fail('当前线上清单无此文件: ' + n);
            if (!tgtNames.has(n)) fail('目标版本清单无此文件: ' + n);
        }
    }

    const newHotVersion = nextHotVersion(versions);
    const signedAt = Date.now();
    const composed = composeRollback(ch, current, target, onlyFiles);

    // minAppCode 策略（仅 app-local）：取当前与目标的较小值=最大送达面
    //   （内容兼容性 ≥288 已由桥依赖论证；防"当前包误抬升"被回滚继承）
    let minAppCode = null;
    if (conf.isApp) {
        const a = current.manifest.minAppCode, b = target.manifest.minAppCode;
        minAppCode = Math.min(
            typeof a === 'number' ? a : 999999,
            typeof b === 'number' ? b : 999999
        );
        if (minAppCode === 999999) minAppCode = (a || b || 1);
    }

    const version = {
        format: 1,
        channel: conf.channel,
        hotVersion: newHotVersion,
        ...(conf.isApp ? { minAppCode: minAppCode } : {}),
        appVersion: conf.isApp ? '1.0.0' : (current.manifest.appVersion || target.manifest.appVersion),
        files: composed.files,
        signedAt: signedAt
    };

    // Ed25519 签名（前缀按渠道：app=app-hotupdate-v1 / 桌面=desktop-hotupdate-v1）
    const msg = buildSignMessage(conf.prefix, conf.channel, newHotVersion, signedAt, composed.files);
    const privateKey = fs.readFileSync(PRIVATE_KEY_PATH, 'utf8');
    version.signature = crypto.sign(null, Buffer.from(msg, 'utf8'), crypto.createPrivateKey(privateKey)).toString('base64');
    // 自验①：公钥验签（防密钥对不一致）
    if (!crypto.verify(null, Buffer.from(msg, 'utf8'), crypto.createPublicKey(PUB_PEM), Buffer.from(version.signature, 'base64'))) {
        fail('签名自验失败（私钥与客户端公钥常量不匹配）');
    }

    // 计划摘要
    const changed = [];
    for (const f of composed.files) {
        const cur = current.manifest.files.find((x) => x.name === f.name);
        if (!cur || cur.sha256 !== f.sha256) changed.push(f.name);
    }
    if (changed.length === 0) {
        // 目标内容与当前线上逐文件一致（如纯哈希修复版）——发布空回滚只会
        // 制造无意义版本跳变，硬中止
        fail('回滚目标内容与当前线上完全一致（0 个文件变化），无需回滚');
    }
    console.log('================ 回滚计划（' + conf.name + ' ' + ch + '）================');
    console.log('当前线上: ' + current.hotVersion + '  →  回滚到: ' + target.hotVersion);
    console.log('发布为:   ' + newHotVersion + '（旧内容+新版本号，客户端视为升级）');
    console.log('范围:     ' + (onlyFiles ? '单文件回滚 ' + [...onlyFiles].join(', ') : '整包回滚（' + composed.files.length + ' 文件）'));
    console.log('实际变化: ' + changed.length + ' 个文件' + (changed.length ? ' → ' + changed.join(', ') : '（无变化，中止更稳妥）'));
    if (conf.isApp) console.log('minAppCode: ' + minAppCode + '（当前' + current.manifest.minAppCode + '/目标' + target.manifest.minAppCode + ' 取小）');
    if (opts.dryRun) {
        console.log('============================================================');
        console.log('[Rollback] --dry-run：未写盘。');
        return { version: version, changedCount: changed.length };
    }

    if (!opts.yes) {
        // 非交互且未 --yes：必须显式确认（交互模式已自行确认，传 yes）
        fail('未传 --yes，拒绝写盘（交互模式无此限制）');
    }

    writePackage(ch, version, composed.bufs, opts.out);
    console.log('============================================================');
    console.log('[Rollback] 已写入 ' + (opts.out ? opts.out : conf.dir) + '（回读复验+验签全过）');
    if (!opts.out) {
        console.log('');
        console.log('下一步（发布）:');
        console.log('  git add ' + conf.dir);
        console.log('  git commit -m "hotfix(热更回滚): ' + ch + ' ' + current.hotVersion + ' → 内容回滚至 ' + target.hotVersion + '"');
        console.log('  git push');
        console.log('');
        console.log('客户端恢复时效: APP 292+ 登录页当次生效（智能热重载）；其余设备下次启动生效。');
        console.log('如需撤销本次回滚: 再跑一次本工具，回滚目标选 ' + current.hotVersion + ' 即可（对称操作）。');
    }
    return { version: version, changedCount: changed.length };
}

// ---------------------------------------------------------------------------
// 参数解析 + 入口
// ---------------------------------------------------------------------------
function parseArgs(argv) {
    const opts = { channel: '', version: '', files: null, list: false, dryRun: false, yes: false, interactive: false, out: '' };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '-c' || a === '--channel') opts.channel = argv[++i] || '';
        else if (a === '-v' || a === '--version') opts.version = argv[++i] || '';
        else if (a === '-f' || a === '--files') opts.files = (argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean);
        else if (a === '--list') opts.list = true;
        else if (a === '--dry-run') opts.dryRun = true;
        else if (a === '--yes' || a === '-y') opts.yes = true;
        else if (a === '--interactive') opts.interactive = true;
        else if (a === '--out') opts.out = argv[++i] || '';
        else fail('未知参数: ' + a);
    }
    if (opts.channel && !CHANNELS[opts.channel]) {
        fail('未知渠道: ' + opts.channel + '（可用: ' + Object.keys(CHANNELS).join(' | ') + '）');
    }
    return opts;
}

function printVersionList(ch) {
    const conf = CHANNELS[ch];
    const versions = listVersions(ch);
    if (!versions.length) { console.log('（无历史版本）'); return; }
    console.log('==== ' + conf.name + '（' + ch + '）历史版本（新→旧，前 60）====');
    versions.forEach((v, i) => {
        const tag = i === 0 ? '  ← 当前线上' : (i === 1 ? '  ← 默认回滚目标（上一版）' : '');
        const extra = conf.isApp ? ('  minAppCode=' + v.manifest.minAppCode) : '';
        const d = new Date(v.manifest.signedAt || 0);
        const ds = isNaN(d.getTime()) ? '?' : d.toISOString().slice(0, 16).replace('T', ' ');
        console.log('  ' + String(i + 1).padStart(2) + '. ' + v.hotVersion + '  ' + ds + extra + tag);
    });
    console.log('提示: -v <版本号> 指定目标；-f auth-core.js 只回滚单文件；默认=整包回滚上一版');
}

// 交互式（readline 菜单 → 组装参数 → performRollback → 可选自动提交推送）
async function interactive() {
    const readline = require('readline');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    // 队列式 ask：readline 的 line 事件可能在 question 注册前就发出（管道输入
    // 一次性到达的竞态），裸 question 会丢行。改为行队列 + 等待者配对，
    // TTY 与管道两种输入都可靠。
    const lineQueue = [];
    const waiters = [];
    rl.on('line', (l) => {
        const w = waiters.shift();
        if (w) w(l); else lineQueue.push(l);
    });
    const ask = (q) => new Promise((res) => {
        process.stdout.write(q);
        const buffered = lineQueue.shift();
        if (buffered !== undefined) { res(buffered.trim()); return; }
        waiters.push((a) => res(String(a || '').trim()));
    });
    try {
        console.log('');
        console.log('╔══════════════════════════════════════════╗');
        console.log('║   热更新一键回滚（Layer 0 服务端回滚）   ║');
        console.log('║   回滚旧内容+重签发布，全体客户端自动恢复 ║');
        console.log('╚══════════════════════════════════════════╝');
        console.log('');
        console.log('选择渠道:');
        console.log('  1. 离线APP   (app-local)');
        console.log('  2. 离线桌面  (local)');
        console.log('  3. 云桌面    (cloud)');
        const c = await ask('输入 1/2/3: ');
        const map = { '1': 'app-local', '2': 'local', '3': 'cloud' };
        const ch = map[c];
        if (!ch) { console.log('无效选择，退出'); process.exit(1); }
        const conf = CHANNELS[ch];

        printVersionList(ch);
        console.log('');
        let ver = await ask('回滚到哪个版本（回车=上一版，或输入版本号）: ');
        let files = null;
        const scope = await ask('回滚范围（回车=整包回滚，或输入文件名逗号分隔）: ');
        if (scope) files = scope.split(',').map((s) => s.trim()).filter(Boolean);

        const opts = { channel: ch, version: ver || '', files: files, yes: true };
        // 先 dry-run 展示计划
        console.log('');
        performRollback(ch, { ...opts, dryRun: true });
        console.log('');
        const ok = await ask('确认执行写盘？(y/n): ');
        if (ok.toLowerCase() !== 'y' && ok.toLowerCase() !== 'yes') {
            console.log('已取消，未写盘。');
            return;
        }
        performRollback(ch, opts);

        console.log('');
        const push = await ask('立即提交并推送发布（触发 CF Pages 部署）？(Y/n): ');
        if (push.toLowerCase() !== 'n') {
            console.log('[Rollback] 提交推送中...');
            execTxt('git add ' + conf.dir);
            execTxt('git commit -m "hotfix(热更回滚): ' + ch + ' 回滚至 ' + (ver || '上一版') + ' [rollback-hotupdate]"');
            execTxt('git push origin main');
            console.log('[Rollback] 已推送，CF Pages 部署中（2-3 分钟）。');
            console.log('[Rollback] 验证: 浏览器打开 https://tcm-prescription-system.pages.dev/hot-update/' + conf.dir.replace('public/hot-update/', '') + '/version.json 确认 hotVersion 已更新。');
        } else {
            console.log('[Rollback] 已写盘未推送。手动发布:');
            console.log('  git add ' + conf.dir + ' && git commit -m "hotfix(热更回滚): ' + ch + '" && git push');
        }
    } finally {
        rl.close();
    }
}

function main() {
    const argv = process.argv.slice(2);
    if (argv.includes('--interactive')) {
        interactive().catch((e) => fail(e && e.message ? e.message : String(e)));
        return;
    }
    const opts = parseArgs(argv);
    if (!opts.channel) fail('必须指定渠道 -c app-local|local|cloud（或 --interactive 进交互模式）');
    if (opts.list) { printVersionList(opts.channel); return; }
    performRollback(opts.channel, opts);
}

main();
