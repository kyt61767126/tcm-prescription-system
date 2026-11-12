#!/usr/bin/env node
/**
 * strip-e2e-bypass.cjs —— 构建期剥离 E2E 旁路判定代码（P1-1 方案 B）
 *
 * 背景：E2E 回归需要「未签名 exe + 可注入 inspector + 跳过服务端试用登记」，
 *       这些判定块若随正式包发布，等于把旁路条件（环境变量名、marker 文件名、
 *       状态位）连同判定逻辑一起交给逆向者。定案：判定块在源码里用
 *       `BNZC_E2E_GUARD_BEGIN/END` 标记包裹，正式包重新打包前整块移除。
 *
 * 用法（build.bat 在 E2E 通过后调用）：
 *   node tools/strip-e2e-bypass.cjs --dir <desktop项目目录>            # 剥离（自动备份到系统临时目录）
 *   node tools/strip-e2e-bypass.cjs --dir <desktop项目目录> --restore  # 还原
 *   node tools/strip-e2e-bypass.cjs --check-asar <app.asar 路径>       # 断言产物内搜不到旁路字符串
 *
 * 安全设计：
 *   - 剥离后逐个 node --check，语法不通或仍残留旁路字符串 → 自动还原并退出码 1；
 *   - 备份放在系统临时目录（不进仓库、不进 asar）；--dir 会先自动还原上次遗留备份，
 *     构建中断后重跑可自愈；
 *   - 正式包验收用 --check-asar，命中即失败，杜绝「以为剥离了其实没剥」。
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const MARK_BEGIN = 'BNZC_E2E_GUARD_BEGIN';
const MARK_END = 'BNZC_E2E_GUARD_END';
const FORBIDDEN = ['BNZC_E2E', 'e2e-enabled.marker', 'e2e-bypass'];

// 需要检查/剥离的打包内文件（相对 desktop 项目目录）
const CANDIDATES = [
    'electron/main.js',
    'electron/self-check.js',
    'electron/license-manager.js',
    'electron/desktop-license-ipc.cjs',
    'license/license-manager.js'
];

function log(msg) { console.log(`[strip-e2e] ${msg}`); }
function fail(msg) { console.error(`[strip-e2e][FAIL] ${msg}`); process.exit(1); }

function backupDirOf(projectDir) {
    const key = crypto.createHash('sha1').update(path.resolve(projectDir)).digest('hex').slice(0, 16);
    return path.join(os.tmpdir(), 'bnzc-e2e-strip', key);
}

function walkFiles(rootDir) {
    const out = [];
    for (const ent of fs.readdirSync(rootDir, { withFileTypes: true })) {
        const abs = path.join(rootDir, ent.name);
        if (ent.isDirectory()) out.push(...walkFiles(abs));
        else out.push(abs);
    }
    return out;
}

function restore(projectDir, quiet) {
    const dir = backupDirOf(projectDir);
    if (!fs.existsSync(dir)) {
        if (!quiet) log('无可还原备份（已是原始源码）');
        return 0;
    }
    let n = 0;
    for (const abs of walkFiles(dir)) {
        const dst = path.join(projectDir, path.relative(dir, abs));
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        fs.copyFileSync(abs, dst);
        n++;
    }
    fs.rmSync(dir, { recursive: true, force: true });
    if (!quiet) log(`已还原 ${n} 个文件`);
    return n;
}

function stripBlocks(text) {
    const re = new RegExp(
        '^[ \\t]*/\\* ' + MARK_BEGIN + '[^\\n]*\\n[\\s\\S]*?/\\* ' + MARK_END + ' \\*/[ \\t]*\\r?\\n?',
        'gm'
    );
    let count = 0;
    const out = text.replace(re, () => { count++; return ''; });
    return { out, count };
}

function apply(projectDir) {
    // 上次构建中断可能留下已剥离源码，先还原再剥，保证可重复执行
    const healed = restore(projectDir, true);
    if (healed) log(`检测到上次遗留的剥离备份，已先还原 ${healed} 个文件`);

    const backupDir = backupDirOf(projectDir);
    const pending = [];
    let totalBlocks = 0;

    for (const rel of CANDIDATES) {
        const abs = path.join(projectDir, rel);
        if (!fs.existsSync(abs)) continue;
        const src = fs.readFileSync(abs, 'utf8');
        const beginCnt = (src.match(new RegExp(MARK_BEGIN, 'g')) || []).length;
        const endCnt = (src.match(new RegExp(MARK_END, 'g')) || []).length;
        if (beginCnt !== endCnt) fail(`${rel} 标记不成对（BEGIN=${beginCnt} END=${endCnt}），请先修复源码`);
        if (beginCnt === 0) continue;
        const { out, count } = stripBlocks(src);
        if (count !== beginCnt) fail(`${rel} 实剥 ${count} 块 ≠ 标记 ${beginCnt} 块，疑似标记格式不符`);
        pending.push({ rel, abs, src, out, count });
        totalBlocks += count;
    }

    if (pending.length === 0) fail('未找到任何 E2E 判定块——源码可能已剥离或标记丢失，拒绝继续打包');

    // 先备份再写盘
    fs.mkdirSync(backupDir, { recursive: true });
    for (const p of pending) {
        const dst = path.join(backupDir, p.rel);
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        fs.writeFileSync(dst, p.src, 'utf8');
        fs.writeFileSync(p.abs, p.out, 'utf8');
    }

    // 自检：语法 + 无残留
    try {
        for (const p of pending) {
            execFileSync(process.execPath, ['--check', p.abs], { stdio: 'pipe' });
            const now = fs.readFileSync(p.abs, 'utf8');
            for (const s of FORBIDDEN) {
                if (now.includes(s)) throw new Error(`${p.rel} 剥离后仍残留字符串: ${s}`);
            }
        }
    } catch (e) {
        restore(projectDir, true);
        fail(`剥离自检未过，已自动还原源码：${e && e.message}`);
    }

    for (const p of pending) log(`已剥离 ${p.rel}（${p.count} 块）`);
    log(`共剥离 ${totalBlocks} 块判定代码；备份: ${backupDir}`);
}

function checkAsar(asarPath) {
    if (!fs.existsSync(asarPath)) fail(`asar 不存在: ${asarPath}`);
    const buf = fs.readFileSync(asarPath);
    const text = buf.toString('latin1');
    const hits = FORBIDDEN.filter(s => text.includes(s));
    if (hits.length) fail(`正式包内仍含旁路字符串: ${hits.join(', ')} —— 剥离不完整，禁止交付`);
    log(`asar 校验通过：未发现 ${FORBIDDEN.join(' / ')}（${(buf.length / 1024 / 1024).toFixed(1)} MB）`);
}

const argv = process.argv.slice(2);
const dirArg = argv.includes('--dir') ? argv[argv.indexOf('--dir') + 1] : null;
const asarArg = argv.includes('--check-asar') ? argv[argv.indexOf('--check-asar') + 1] : null;

if (asarArg) {
    checkAsar(path.resolve(asarArg));
} else if (dirArg) {
    const projectDir = path.resolve(dirArg);
    if (!fs.existsSync(projectDir)) fail(`目录不存在: ${projectDir}`);
    if (argv.includes('--restore')) restore(projectDir, false);
    else apply(projectDir);
} else {
    console.log('用法: node tools/strip-e2e-bypass.cjs --dir <desktop项目目录> [--restore]');
    console.log('      node tools/strip-e2e-bypass.cjs --check-asar <app.asar>');
    process.exit(2);
}
