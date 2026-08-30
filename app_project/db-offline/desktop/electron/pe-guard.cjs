// ============================================================================
//  pe-guard.cjs — PE 自定义区段完整性自校验（P1-[3.1] EXE 签名自校验 · 第二路）
//
//  原理：
//    Authenticode（第一路，WinTrust）依赖正式代码签名证书；本项目发布未配置
//    签名私钥（自签证书会被 SmartScreen 拦截正常用户，违反"不得导致正常用户
//    闪退/拦截"红线），故引入不依赖任何证书的第二路：
//      - 打包时（prepare-win-unpacked / afterPack）向主 exe 追加自定义 PE 区段
//        `.bnzc`，区段内写入"排除该区段自身后的文件 SHA-256"；
//      - 运行时（self-check.js）解析自身 PE，读取 `.bnzc` 期望哈希，重算
//        "排除该区段后的文件哈希"比对，不一致即判定被篡改。
//    攻击者直接改 exe 任意字节会导致重算哈希不匹配；重复 embed 幂等（原地更新）。
//
//  ★ P2-1（2026-08-30）ver=2 双哈希：payload 同时携带 app.asar 全文件 SHA-256。
//    动机：Electron fuse EnableEmbeddedAsarIntegrityValidation 只校验 asar 头
//    （archive_win.cc 只哈希 header JSON），等长篡改 asar 内文件内容（如把试用
//    天数 7 改 7000）头不变 → fuse 检测不到。ver=2 把 asar 全文件哈希也存进
//    .bnzc，运行时 self-check 重算比对，失配阻断（这是桌面端首个强阻断项，
//    正常用户无合法触发场景——asar 为只读资源，管线内三重门禁兜底）。
//    兼容：ver=1 旧区段仍可读（asarSha256hex:null，调用方跳过 asar 校验）；
//    update 模式下旧 rawSize(512 对齐) 足够容纳 192 字节 payload，布局不变。
//
//  兼容性：
//    - 无 `.bnzc` 区段 → verifyZone 返回 present:false（旧版 exe / 开发环境），
//      调用方按"未嵌入"处理，不告警不阻断。
//    - 只追加区段不改动既有区段数据，不影响 Windows 加载。
//    - ★ P0-3（2026-08-26）：哈希已排除 Authenticode 影响区（CheckSum/安全目录
//      项/证书表），与代码签名共存：先 embed 后 sign，两路校验互不破坏。
//
//  纯 Node 实现（fs/crypto），无 electron 依赖，可同时被打包工具与主进程 require。
// ============================================================================

'use strict';

const fs = require('fs');
const crypto = require('crypto');

// .bnzc 区段固定参数
const SECTION_NAME = '.bnzc';
const ZONE_MAGIC = 'BNZC';
const ZONE_VER = 2;
// 区段数据载荷长度：magic(4) + ver(1) + reserved(3) + exeSha(64) + asarSha(64) + 填充 = 192
const ZONE_DATA_LEN = 192;
const ZONE_DATA_LEN_V1 = 128; // ver=1 旧载荷长度（读取兼容）
const SHA256_HEX_LEN = 64;
const EXE_SHA_OFFSET = 8;
const ASAR_SHA_OFFSET = 72;
const EMPTY_SHA_HEX = '0'.repeat(SHA256_HEX_LEN);

function align(n, a) {
    if (!a || a <= 0) return n;
    return Math.ceil(n / a) * a;
}

// ---------------------------------------------------------------------------
// PE 解析
// ---------------------------------------------------------------------------
function parsePe(buf) {
    if (buf.length < 0x40 || buf.readUInt16LE(0) !== 0x5A4D) {
        throw new Error('Not a valid PE (MZ header missing)');
    }
    const peOff = buf.readUInt32LE(0x3C);
    if (peOff + 24 > buf.length) throw new Error('PE header out of range');
    if (buf.toString('ascii', peOff, peOff + 4) !== 'PE\u0000\u0000') {
        throw new Error('PE signature missing');
    }
    const numSections = buf.readUInt16LE(peOff + 6);
    const optSize = buf.readUInt16LE(peOff + 20);
    const optOff = peOff + 24;
    if (optOff + optSize > buf.length) throw new Error('Optional header out of range');
    const magic = buf.readUInt16LE(optOff);
    const isPe32Plus = magic === 0x20B;
    // ★ 修复（2026-08-19）：PE32/PE32+ 的 SectionAlignment 均在 optOff+32、
    //   FileAlignment 均在 optOff+36。旧代码 PE32+ 读 optOff+40（那是
    //   MajorOperatingSystemVersion，Electron 是 10.0 → secAlign 误读为 10），
    //   PE32 分支两值互换，导致 .bnzc 的 VA/VirtualSize/SizeOfImage 全算错。
    const sectionAlign = buf.readUInt32LE(optOff + 32);
    const fileAlign = buf.readUInt32LE(optOff + 36);
    const sizeOfImage = buf.readUInt32LE(optOff + 56);
    const sectionTableOff = optOff + optSize;
    const headerSize = sectionTableOff + numSections * 40;
    if (headerSize > buf.length) throw new Error('Section table out of range');

    const sections = [];
    for (let i = 0; i < numSections; i++) {
        const off = sectionTableOff + i * 40;
        sections.push({
            name: buf.toString('ascii', off, off + 8).replace(/\0+$/, ''),
            virtualSize: buf.readUInt32LE(off + 8),
            virtualAddress: buf.readUInt32LE(off + 12),
            rawSize: buf.readUInt32LE(off + 16),
            rawPtr: buf.readUInt32LE(off + 20),
            characteristics: buf.readUInt32LE(off + 36),
            headerOffset: off
        });
    }
    return {
        peOff,
        numSections,
        optOff,
        optSize,
        magic,
        isPe32Plus,
        fileAlign: fileAlign || 0x200,
        sectionAlign: sectionAlign || 0x1000,
        sizeOfImage,
        sizeOfImageOffset: optOff + 56,
        sectionTableOff,
        headerSize,
        sections
    };
}

// ---------------------------------------------------------------------------
// 哈希：排除 .bnzc 区段自身 + Authenticode 签名影响区后的文件 SHA-256
// ---------------------------------------------------------------------------
// ★ 2026-08-26 P0-3 改造：与 Authenticode 代码签名共存。
//   签名（Set-AuthenticodeSignature / signtool）只改动三处：
//     1. Optional Header 的 CheckSum 字段（optOff+64，4 字节）
//     2. Data Directory[4] 安全目录项（RVA+Size，8 字节）
//     3. 文件末尾追加的证书表（WinCertificate blob）
//   哈希排除上述区域后："先 embed .bnzc 后签名"两者共存互不破坏——
//   签名不改其余任何字节 → .bnzc 哈希保持有效；签名摘要覆盖 .bnzc →
//   篡改 .bnzc 或任意字节会同时破坏两路校验。
//   ★ 顺序铁律：embed 必须在签名之前（签名后再 embed 会改写 .bnzc 内容作废签名）。
//   ★ 兼容性：哈希定义变更后，旧版工具 verify 旧产物可能报 mismatch（旧 exe
//     内嵌的是旧定义哈希）；运行时校验用 exe 自带副本，不受影响。
function getAuthenticodeExcludedRanges(buf, pe) {
    const ranges = [];
    // 1. CheckSum 字段（PE32/PE32+ 均在 optOff+64）
    ranges.push([pe.optOff + 64, pe.optOff + 68]);
    // 2. 安全目录项 + 证书表（Data Directory index 4 = Certificate Table）
    try {
        const numRvaOff = pe.isPe32Plus ? pe.optOff + 108 : pe.optOff + 92;
        const dataDirOff = pe.isPe32Plus ? pe.optOff + 112 : pe.optOff + 96;
        if (numRvaOff + 4 <= pe.headerSize) {
            const numRva = buf.readUInt32LE(numRvaOff);
            if (numRva > 4) {
                const secDirOff = dataDirOff + 4 * 8;
                ranges.push([secDirOff, secDirOff + 8]);
                // 证书表 RVA 字段实为文件偏移；范围必须落在文件内
                const certOff = buf.readUInt32LE(secDirOff);
                const certSize = buf.readUInt32LE(secDirOff + 4);
                if (certOff > 0 && certSize > 0 && certOff + certSize <= buf.length) {
                    ranges.push([certOff, certOff + certSize]);
                }
            }
        }
    } catch (e) {
        // 解析失败按"无证书"处理：只排除 .bnzc（与旧版行为一致）
    }
    return ranges;
}

function hashExcludingZone(buf, pe, zone) {
    const h = crypto.createHash('sha256');
    const ranges = [];
    if (zone && zone.rawSize > 0 && zone.rawPtr >= 0) {
        ranges.push([zone.rawPtr, zone.rawPtr + zone.rawSize]);
    }
    if (pe) {
        for (const r of getAuthenticodeExcludedRanges(buf, pe)) ranges.push(r);
    }
    ranges.sort((a, b) => a[0] - b[0]);
    let pos = 0;
    for (const range of ranges) {
        const start = range[0];
        const end = range[1];
        if (start >= buf.length || end <= pos) continue;
        const s = start > pos ? start : pos;
        if (s > pos) h.update(buf.subarray(pos, s));
        if (end > pos) pos = end;
    }
    if (pos < buf.length) h.update(buf.subarray(pos));
    return h.digest('hex');
}

// ---------------------------------------------------------------------------
// .bnzc 载荷读写
// ---------------------------------------------------------------------------
function buildZonePayload(sha256hex, asarSha256hex) {
    if (!/^[0-9a-fA-F]{64}$/.test(sha256hex)) throw new Error('Invalid sha256 hex');
    const asarHex = asarSha256hex ? String(asarSha256hex).toLowerCase() : EMPTY_SHA_HEX;
    if (!/^[0-9a-f]{64}$/.test(asarHex)) throw new Error('Invalid asar sha256 hex');
    const p = Buffer.alloc(ZONE_DATA_LEN, 0);
    p.write(ZONE_MAGIC, 0, 4, 'ascii');
    p.writeUInt8(ZONE_VER, 4);
    p.write(sha256hex.toLowerCase(), EXE_SHA_OFFSET, SHA256_HEX_LEN, 'ascii');
    p.write(asarHex, ASAR_SHA_OFFSET, SHA256_HEX_LEN, 'ascii');
    return p;
}

function readZonePayload(buf, pe, zone) {
    if (!zone || zone.rawSize < ZONE_DATA_LEN_V1) return null;
    // 先按 ver=1 长度探底，再按 ver 决定实际读取长度（ver=1 旧区段兼容）
    const probe = Buffer.alloc(ZONE_DATA_LEN_V1);
    buf.copy(probe, 0, zone.rawPtr, zone.rawPtr + ZONE_DATA_LEN_V1);
    if (probe.toString('ascii', 0, 4) !== ZONE_MAGIC) return null;
    const ver = probe.readUInt8(4);
    if (ver >= 2) {
        if (zone.rawSize < ZONE_DATA_LEN) return null;
        const p = Buffer.alloc(ZONE_DATA_LEN);
        buf.copy(p, 0, zone.rawPtr, zone.rawPtr + ZONE_DATA_LEN);
        const asarHex = p.toString('ascii', ASAR_SHA_OFFSET, ASAR_SHA_OFFSET + SHA256_HEX_LEN);
        return {
            ver,
            sha256hex: p.toString('ascii', EXE_SHA_OFFSET, EXE_SHA_OFFSET + SHA256_HEX_LEN),
            asarSha256hex: asarHex === EMPTY_SHA_HEX ? null : asarHex
        };
    }
    // ver=1（或未知低版本）：只有 exe 哈希
    return {
        ver,
        sha256hex: probe.toString('ascii', EXE_SHA_OFFSET, EXE_SHA_OFFSET + SHA256_HEX_LEN),
        asarSha256hex: null
    };
}

// ---------------------------------------------------------------------------
// 文件 SHA-256（流式，供 asar 全文件哈希使用；16MB 级文件毫秒级）
// ---------------------------------------------------------------------------
function sha256File(filePath) {
    return new Promise((resolve, reject) => {
        const h = crypto.createHash('sha256');
        const stream = fs.createReadStream(filePath, { highWaterMark: 1 << 20 });
        stream.on('data', (chunk) => h.update(chunk));
        stream.on('error', reject);
        stream.on('end', () => resolve(h.digest('hex').toLowerCase()));
    });
}

function sha256FileSync(filePath) {
    const h = crypto.createHash('sha256');
    h.update(fs.readFileSync(filePath));
    return h.digest('hex').toLowerCase();
}

// ---------------------------------------------------------------------------
// 追加新区段（仅当 .bnzc 不存在时）
// ---------------------------------------------------------------------------
// ★ 重写（2026-08-19）：旧实现无条件"既有区段 PointerToRawData +40"，
//   破坏 FileAlignment 对齐（合法指针 0x600 → 0x628 非对齐），Windows 加载器
//   直接拒绝加载（STATUS_INVALID_IMAGE_FORMAT，"不是有效应用程序"）——1.0.61
//   起所有桌面 exe 均因此损坏。此前验证只跑 pe-guard 自身哈希校验（不查布局），
//   从未实际启动过被嵌入的 exe，故未暴露。
//
//   新策略：
//     A. 零移动（常态）：section table 结束处到首个 raw 区段之间通常有
//        FileAlignment 填充空隙；空隙 ≥40 字节时把 .bnzc header 写入空隙，
//        新区段数据追加到文件末尾——不改动文件任何既有字节。
//     B. 移动兜底（罕见，空隙 <40）：raw 数据区整体后移 delta 字节，
//        delta = align(headerLen+40, fileAlign) - firstRawPtr，必为
//        fileAlign 倍数，保证所有指针保持对齐；同时更新 SizeOfHeaders。
//   区段 VA 按 SectionAlignment 对齐（旧代码因 secAlign 误读为 10 未对齐）。
// ---------------------------------------------------------------------------
function buildWithNewSection(orig, pe, payload) {
    const fileAlign = pe.fileAlign || 0x200;
    const secAlign = pe.sectionAlign || 0x1000;
    const payloadLen = payload.length;
    const alignedPayloadLen = align(payloadLen, fileAlign);

    const last = pe.sections[pe.sections.length - 1];
    const lastVAEnd = last ? (last.virtualAddress + last.virtualSize) : 0;
    const newVA = align(Math.max(lastVAEnd, secAlign), secAlign);
    const newVirtualSize = payloadLen; // 内存大小=载荷实际长度；需对齐的是 VA 与 SizeOfRawData
    const sizeOfImageDelta = align(payloadLen, secAlign);

    const headerLen = pe.headerSize; // 原 section table 结束位置

    // 既有区段 raw 数据起点（忽略 rawPtr=0 的纯内存区段）
    let firstRawPtr = Infinity;
    for (const s of pe.sections) {
        if (s.rawPtr > 0 && s.rawPtr < firstRawPtr) firstRawPtr = s.rawPtr;
    }
    if (!isFinite(firstRawPtr)) firstRawPtr = align(headerLen, fileAlign);

    let out;
    let zoneRawPtr;
    if (firstRawPtr - headerLen >= 40) {
        // 情形 A：零移动。原文件原样保留（含 overlay），.bnzc header 写入表后空隙。
        zoneRawPtr = align(orig.length, fileAlign);
        const outLen = zoneRawPtr + alignedPayloadLen;
        out = Buffer.alloc(outLen, 0);
        orig.copy(out, 0, 0, orig.length);
    } else {
        // 情形 B：空隙不足，raw 区整体后移（delta 为 fileAlign 倍数，保持对齐）。
        const newFirstRawPtr = align(headerLen + 40, fileAlign);
        const delta = newFirstRawPtr - firstRawPtr; // ≥0 且 ≡0 (mod fileAlign)
        zoneRawPtr = align(orig.length + delta, fileAlign);
        const outLen = zoneRawPtr + alignedPayloadLen;
        out = Buffer.alloc(outLen, 0);
        // 1. header 区（含原 section table）
        orig.copy(out, 0, 0, headerLen);
        // 2. raw 数据区（首个 raw 起，含 overlay）整体后移 delta
        orig.copy(out, newFirstRawPtr, firstRawPtr, orig.length);
        // 3. 既有区段 PointerToRawData +delta（保持 fileAlign 对齐）
        for (let i = 0; i < pe.numSections; i++) {
            const so = pe.sectionTableOff + i * 40;
            const oldPtr = out.readUInt32LE(so + 20);
            if (oldPtr > 0) out.writeUInt32LE(oldPtr + delta, so + 20);
        }
        // 4. SizeOfHeaders 同步为新的 raw 起点保持合法
        out.writeUInt32LE(newFirstRawPtr, pe.optOff + 60);
    }

    // 写入 .bnzc section header（两种情形位置相同：原 table 末尾）
    const hOff = pe.sectionTableOff + pe.numSections * 40;
    out.write(SECTION_NAME.padEnd(8, '\u0000').slice(0, 8), hOff, 8, 'ascii');
    out.writeUInt32LE(newVirtualSize, hOff + 8);
    out.writeUInt32LE(newVA, hOff + 12);
    out.writeUInt32LE(alignedPayloadLen, hOff + 16);
    out.writeUInt32LE(zoneRawPtr, hOff + 20);
    out.writeUInt32LE(0, hOff + 24);
    out.writeUInt32LE(0, hOff + 28);
    out.writeUInt16LE(0, hOff + 32);
    out.writeUInt16LE(0, hOff + 34);
    // INITIALIZED_DATA(0x40) | READ(0x40000000)
    out.writeUInt32LE(0x40000040, hOff + 36);

    // NumberOfSections +1
    out.writeUInt16LE(pe.numSections + 1, pe.peOff + 6);
    // SizeOfImage += 新区段对齐后虚拟大小
    out.writeUInt32LE(pe.sizeOfImage + sizeOfImageDelta, pe.sizeOfImageOffset);

    // .bnzc payload（写入文件末尾的区段数据区）
    payload.copy(out, zoneRawPtr, 0, payloadLen);

    return out;
}

// ---------------------------------------------------------------------------
// 布局合法性检查（防回归）：Windows 加载器要求 PointerToRawData 按
// FileAlignment 对齐、VirtualAddress 按 SectionAlignment 对齐；旧版 bug
// 正是破坏对齐导致"不是有效的应用程序"，此函数确保此类损坏永远无法入库。
// ---------------------------------------------------------------------------
function validateLayout(buf, pe) {
    const problems = [];
    for (const s of pe.sections) {
        if (s.rawPtr > 0 && s.rawPtr % pe.fileAlign !== 0) {
            problems.push('section ' + (s.name || '?') + ' rawPtr 0x' + s.rawPtr.toString(16) + ' not aligned to fileAlign 0x' + pe.fileAlign.toString(16));
        }
        if (s.virtualAddress > 0 && s.virtualAddress % pe.sectionAlign !== 0) {
            problems.push('section ' + (s.name || '?') + ' VA 0x' + s.virtualAddress.toString(16) + ' not aligned to sectionAlign 0x' + pe.sectionAlign.toString(16));
        }
        if (s.rawPtr + s.rawSize > buf.length) {
            problems.push('section ' + (s.name || '?') + ' raw range out of file');
        }
    }
    return problems;
}

// ---------------------------------------------------------------------------
// 对外 API
// ---------------------------------------------------------------------------

/**
 * 向 exe 写入/更新 .bnzc 区段（幂等）。写后自动自验证，失败抛错。
 *
 * 两遍法：先追加/复用占位区段固定文件布局，再在该布局下计算"排除区段自身"
 * 的哈希，最后原地写入 payload——保证 embed 前后排除区段哈希一致。
 *
 * P2-1：传入 asarPath 时（打包终版 embed，asar 必须已定稿——本函数之后的
 * 管线步骤不得再改 app.asar，否则运行时校验失配），把 asar 全文件 SHA-256
 * 一并写入 ver=2 payload。不传则 asar 字段为空（调用方跳过 asar 校验）。
 * @returns {{mode:'embed'|'update', sha256hex:string, asarSha256hex:?string, exePath:string}}
 */
function embedZone(exePath, asarPath) {
    let asarSha256hex = null;
    if (asarPath) {
        if (!fs.existsSync(asarPath)) throw new Error('asar file not found: ' + asarPath);
        asarSha256hex = sha256FileSync(asarPath);
    }
    const orig = fs.readFileSync(exePath);
    const pe = parsePe(orig);
    const existing = pe.sections.find((s) => s.name === SECTION_NAME);

    let base; // 布局固定后的文件（含占位 .bnzc 或已有 .bnzc）
    let mode;
    if (existing) {
        base = Buffer.from(orig); // 已有区段，布局已定
        mode = 'update';
    } else {
        // 第一遍：追加占位区段（payload 全 0），固定布局
        base = buildWithNewSection(orig, pe, Buffer.alloc(ZONE_DATA_LEN, 0));
        mode = 'embed';
    }

    // 在固定布局下计算排除 .bnzc 自身的哈希
    const pe2 = parsePe(base);
    const zone2 = pe2.sections.find((s) => s.name === SECTION_NAME);
    const sha256hex = hashExcludingZone(base, pe2, zone2);
    const payload = buildZonePayload(sha256hex, asarSha256hex);

    // 原地写入 payload（布局不变）
    if (!zone2 || zone2.rawPtr < 0 || zone2.rawSize < payload.length) {
        throw new Error('unexpected .bnzc section layout');
    }
    payload.copy(base, zone2.rawPtr, 0, payload.length);

    // 原子写：先写临时文件再替换，避免写坏导致 exe 不可用
    const tmp = exePath + '.bnzc.tmp';
    fs.writeFileSync(tmp, base);
    fs.renameSync(tmp, exePath);

    // 自验证：嵌入后必须能通过校验 + PE 布局合法（Windows 可加载）
    const check = verifyZone(exePath);
    if (!check.present || !check.match) {
        throw new Error('self-verify failed after embed: ' + JSON.stringify(check));
    }
    if (asarSha256hex && check.asarSha256hex !== asarSha256hex) {
        throw new Error('asar hash round-trip failed after embed');
    }
    const finalBuf = fs.readFileSync(exePath);
    const finalPe = parsePe(finalBuf);
    const layoutProblems = validateLayout(finalBuf, finalPe);
    if (layoutProblems.length > 0) {
        throw new Error('PE layout invalid after embed (exe would not load): ' + layoutProblems.join('; '));
    }
    return { mode, sha256hex, asarSha256hex, exePath };
}

/**
 * 校验 exe 的 .bnzc 区段完整性（不抛错，返回状态对象）。
 * @returns {{present:boolean, status:'ok'|'no-zone'|'bad-zone'|'mismatch'|'error',
 *            stored?:string, actual?:string, match?:boolean,
 *            ver?:number, asarSha256hex:?string, error?:string}}
 *  asarSha256hex：ver=2 且嵌入了 asar 哈希时非空（调用方据此决定是否校验 asar
 *  文件本身；本函数不读 asar 文件——exe 校验与 asar 校验解耦）。
 */
function verifyZone(exePath) {
    try {
        const buf = fs.readFileSync(exePath);
        const pe = parsePe(buf);
        const zone = pe.sections.find((s) => s.name === SECTION_NAME);
        if (!zone) return { present: false, status: 'no-zone' };
        const stored = readZonePayload(buf, pe, zone);
        if (!stored) return { present: true, status: 'bad-zone' };
        const actual = hashExcludingZone(buf, pe, zone);
        const match = stored.sha256hex === actual;
        return {
            present: true,
            status: match ? 'ok' : 'mismatch',
            stored: stored.sha256hex,
            actual,
            match,
            ver: stored.ver,
            asarSha256hex: stored.asarSha256hex || null
        };
    } catch (e) {
        return { present: false, status: 'error', error: e.message };
    }
}

/**
 * 查看 exe 的 .bnzc 区段状态（调试用）。
 */
function inspectZone(exePath) {
    const buf = fs.readFileSync(exePath);
    const pe = parsePe(buf);
    const zone = pe.sections.find((s) => s.name === SECTION_NAME);
    if (!zone) return { present: false, sectionCount: pe.sections.length };
    const stored = readZonePayload(buf, pe, zone);
    return {
        present: true,
        sectionCount: pe.sections.length,
        virtualAddress: zone.virtualAddress,
        rawPtr: zone.rawPtr,
        rawSize: zone.rawSize,
        characteristics: zone.characteristics,
        ver: stored ? stored.ver : null,
        sha256hex: stored ? stored.sha256hex : null,
        asarSha256hex: stored ? stored.asarSha256hex : null
    };
}

module.exports = {
    SECTION_NAME,
    ZONE_DATA_LEN,
    ZONE_DATA_LEN_V1,
    ZONE_VER,
    parsePe,
    hashExcludingZone,
    validateLayout,
    sha256File,
    sha256FileSync,
    embedZone,
    verifyZone,
    inspectZone
};
