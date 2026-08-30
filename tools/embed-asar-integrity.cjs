#!/usr/bin/env node
// ============================================================================
// embed-asar-integrity.cjs — 上架加固 P1-2：ASAR 完整性资源嵌入（2026-08-30）
//
// 背景：Electron fuse EnableEmbeddedAsarIntegrityValidation 启用后，运行时启动
//   校验 app.asar 头部哈希，期望值存放于 exe 的 PE 资源（type="Integrity"，
//   name="ElectronAsar"，见 Electron 源码 shell/common/asar/archive_win.cc）。
//   asar 头被篡改 / 资源缺失 → 启动即 LOG(FATAL) 崩溃 → 防 asar 篡改最强一环。
//
// 哈希算法（2026-08-30 与 @electron/asar readAsarHeader + electron-builder integrity.js
//   逐字节实测核对一致；运行时校验见 Electron 35 shell/common/asar/archive_win.cc）：
//   asar 布局（chromium pickle 双层）：
//     [0..4)=4（尺寸 pickle 载荷长）；[4..8)=头 pickle 总长 size；
//     [8..8+size)=头 pickle：[0..4)=payloadSize、[4..8)=strLen、[8..8+strLen)=JSON 串
//   hash = SHA256(header JSON 字符串字节，不含 padding)
//
// 资源 payload（JSON 数组，ASCII）：
//   [{"file":"resources\\app.asar","alg":"sha256","value":"<hex小写>"}]
//   file = asar 相对 exe 所在目录的路径，反斜杠 + 小写（运行时查找键，
//   archive_win.cc 对 file 键与运行时相对路径均 ToLowerASCII 后匹配；alg 大小写不敏感）
//
// ★ 2026-08-30 实测坑（嵌入前自动清零残留证书表）：
//   exe 若已带 Authenticode 签名，UpdateResource 重建资源节后旧证书表悬空
//   （Data Directory[4] 指向失效内容）→ 后续 Set-AuthenticodeSignature 报
//   "%1 is not a valid Win32 application"（exe 仍可运行但永远不可再签）。
//   嵌入本身已使任何旧签名失效 → 本工具嵌入前主动清零证书表目录项。
//   （.bnzc 哈希已排除证书表/CheckSum/安全目录项，清零不影响 .bnzc 校验；
//    管线顺序本就是 embed → fuse → .bnzc → 签名，签名在最后重新写证书表。）
//
// 用法：
//   node tools/embed-asar-integrity.cjs <exe路径> <asar路径>
//   退出码：0 成功；1 失败（供 build.bat 红线阻断）
//
// ★ 顺序铁律：本嵌入必须在 fuse 翻转（含 EnableEmbeddedAsarIntegrityValidation）
//   与 .bnzc 嵌入之前执行 —— 后续字节修改（fuse/.bnzc/签名）不影响只读资源；
//   但 fuse 开而资源缺 → 启动即 FATAL。幂等：重复嵌入自动覆盖同一资源条目。
// ============================================================================
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const PS1 = path.resolve(__dirname, 'asar-integrity-resource.ps1');

function fail(msg) {
    console.error('[asar-integrity][ERROR] ' + msg);
    process.exit(1);
}

// 读 asar 头并计算 SHA256（与 Electron 运行时校验完全同源的字节范围）
function headerSha256(asarPath) {
    const fd = fs.openSync(asarPath, 'r');
    try {
        const sizeBuf = Buffer.alloc(8);
        if (fs.readSync(fd, sizeBuf, 0, 8, 0) !== 8) fail('asar 头 8 字节读取失败: ' + asarPath);
        // 双 pickle 布局见文件头注释；size 在文件偏移 4（尺寸 pickle 的载荷），非偏移 0
        const size = sizeBuf.readUInt32LE(4);
        if (size < 12 || size > 512 * 1024 * 1024) fail('asar header size 异常: ' + size);
        const headerBuf = Buffer.alloc(size);
        if (fs.readSync(fd, headerBuf, 0, size, 8) !== size) fail('asar header 读取失败: ' + asarPath);
        const payloadSize = headerBuf.readUInt32LE(0);
        if (payloadSize + 4 !== size) fail('asar payloadSize 不自洽: ' + payloadSize + ' vs ' + size);
        const strLen = headerBuf.readUInt32LE(4);
        if (strLen + 8 > size) fail('asar header strLen 越界: strLen=' + strLen + ' size=' + size);
        const header = headerBuf.slice(8, 8 + strLen);
        if (header.length === 0 || header[0] !== 0x7B /* { */) fail('asar header 不以 { 开头，非合法 asar');
        return crypto.createHash('sha256').update(header).digest('hex').toLowerCase();
    } finally {
        fs.closeSync(fd);
    }
}

// 清零 PE 证书表目录项（Data Directory[4]，IMAGE_DIRECTORY_ENTRY_SECURITY）
function stripCertTable(exePath) {
    const fd = fs.openSync(exePath, 'r+');
    try {
        const head = Buffer.alloc(0x400);
        if (fs.readSync(fd, head, 0, 0x400, 0) !== 0x400) fail('exe 头读取失败: ' + exePath);
        const peOff = head.readUInt32LE(0x3c);
        if (head.readUInt32LE(peOff) !== 0x4550) fail('非 PE 文件: ' + exePath);
        const optStart = peOff + 4 + 20;
        const magic = head.readUInt16LE(optStart);
        const ddOff = optStart + (magic === 0x20b ? 112 : 96);
        const va = head.readUInt32LE(ddOff + 32);
        const size = head.readUInt32LE(ddOff + 36);
        if (va !== 0 || size !== 0) {
            const zeros = Buffer.alloc(8);
            fs.writeSync(fd, zeros, 0, 8, ddOff + 32);
            console.log('[asar-integrity] 已清零残留证书表（VA=0x' + va.toString(16) + ' size=' + size + '）— 防悬空证书表卡死后续签名（实测教训 2026-08-30）');
        }
    } finally {
        fs.closeSync(fd);
    }
}

function runPs(mode, exePath, payloadFile) {
    const r = spawnSync('powershell.exe', [
        '-NoProfile', '-ExecutionPolicy', 'Bypass',
        '-File', PS1,
        '-ExePath', exePath,
        '-PayloadFile', payloadFile,
        '-Mode', mode,
    ], { encoding: 'utf8', timeout: 120000 });
    const out = ((r.stdout || '') + (r.stderr || '')).trim();
    if (out) console.log(out.split('\n').map(l => '  ' + l.trim()).join('\n'));
    return r.status === 0;
}

function main() {
    const [exeArg, asarArg] = process.argv.slice(2);
    if (!exeArg || !asarArg) {
        console.error('用法: node embed-asar-integrity.cjs <exe路径> <asar路径>');
        process.exit(1);
    }
    const exeAbs = path.resolve(exeArg);
    const asarAbs = path.resolve(asarArg);
    if (!fs.existsSync(exeAbs)) fail('exe 不存在: ' + exeAbs);
    if (!fs.existsSync(asarAbs)) fail('asar 不存在: ' + asarAbs);

    // file 键 = asar 相对 exe 目录路径，反斜杠 + 小写（archive_win.cc 查找键）
    let rel = path.relative(path.dirname(exeAbs), asarAbs).split(path.sep).join('\\').toLowerCase();
    if (!rel.endsWith('.asar')) fail('asar 不在 exe 目录树下（相对路径: ' + rel + '），Electron 不会校验它');

    const hash = headerSha256(asarAbs);
    const payload = JSON.stringify([{ file: rel, alg: 'sha256', value: hash }]);
    console.log('[asar-integrity] asar   : ' + asarAbs);
    console.log('[asar-integrity] exe    : ' + exeAbs);
    console.log('[asar-integrity] file   : ' + rel);
    console.log('[asar-integrity] sha256 : ' + hash);

    // payload 写临时文件（UTF-8 无 BOM，纯 ASCII）
    const tmp = path.join(os.tmpdir(), 'asar-int-' + process.pid + '-' + Date.now() + '.json');
    fs.writeFileSync(tmp, payload, 'utf8');
    try {
        stripCertTable(exeAbs); // ★ UpdateResource 前清零残留签名（见文件头注释实测坑）
        let ok = runPs('embed', exeAbs, tmp);
        if (!ok) {
            // Defender/杀软瞬时锁定 exe → 3 秒后重试一次
            console.log('[asar-integrity] 嵌入失败，3 秒后重试一次（AV 锁定常见）...');
            const until = Date.now() + 3000;
            while (Date.now() < until) { /* busy wait 3s */ }
            ok = runPs('embed', exeAbs, tmp);
            if (!ok) fail('PE 资源嵌入失败（BeginUpdateResource/EndUpdateResource）');
        }
        if (!runPs('verify', exeAbs, tmp)) fail('嵌入后回读校验失败（资源与 payload 不一致）');
        console.log('[asar-integrity] ASAR 完整性资源嵌入并回读校验通过 ✓（fuse 开启后 asar 篡改即拒启）');
        process.exit(0);
    } finally {
        try { fs.rmSync(tmp, { force: true }); } catch (_) { }
    }
}

main();