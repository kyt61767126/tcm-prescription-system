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
//  兼容性：
//    - 无 `.bnzc` 区段 → verifyZone 返回 present:false（旧版 exe / 开发环境），
//      调用方按"未嵌入"处理，不告警不阻断。
//    - 只追加区段不改动既有区段数据，不影响 Windows 加载；若未来接入正式代码
//      签名，追加区段会破坏 Authenticode，因此本工具应在签名之前调用（当前
//      exe 未签名，无冲突）。
//
//  纯 Node 实现（fs/crypto），无 electron 依赖，可同时被打包工具与主进程 require。
// ============================================================================

'use strict';

const fs = require('fs');
const crypto = require('crypto');

// .bnzc 区段固定参数
const SECTION_NAME = '.bnzc';
const ZONE_MAGIC = 'BNZC';
const ZONE_VER = 1;
// 区段数据载荷长度：magic(4) + ver(1) + reserved(3) + sha256hex(64) + 填充 = 128
const ZONE_DATA_LEN = 128;
const SHA256_HEX_LEN = 64;

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
// 哈希：排除 .bnzc 区段自身的文件 SHA-256
// ---------------------------------------------------------------------------
function hashExcludingZone(buf, pe, zone) {
    const h = crypto.createHash('sha256');
    if (!zone) {
        h.update(buf);
        return h.digest('hex');
    }
    const ptr = zone.rawPtr;
    const size = zone.rawSize;
    if (ptr > 0) h.update(buf.subarray(0, ptr));
    const end = ptr + size;
    if (end < buf.length) h.update(buf.subarray(end));
    return h.digest('hex');
}

// ---------------------------------------------------------------------------
// .bnzc 载荷读写
// ---------------------------------------------------------------------------
function buildZonePayload(sha256hex) {
    if (!/^[0-9a-fA-F]{64}$/.test(sha256hex)) throw new Error('Invalid sha256 hex');
    const p = Buffer.alloc(ZONE_DATA_LEN, 0);
    p.write(ZONE_MAGIC, 0, 4, 'ascii');
    p.writeUInt8(ZONE_VER, 4);
    p.write(sha256hex.toLowerCase(), 8, SHA256_HEX_LEN, 'ascii');
    return p;
}

function readZonePayload(buf, pe, zone) {
    if (!zone || zone.rawSize < ZONE_DATA_LEN) return null;
    const p = Buffer.alloc(ZONE_DATA_LEN);
    buf.copy(p, 0, zone.rawPtr, zone.rawPtr + ZONE_DATA_LEN);
    if (p.toString('ascii', 0, 4) !== ZONE_MAGIC) return null;
    return {
        ver: p.readUInt8(4),
        sha256hex: p.toString('ascii', 8, 8 + SHA256_HEX_LEN)
    };
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
 * @returns {{mode:'embed'|'update', sha256hex:string, exePath:string}}
 */
function embedZone(exePath) {
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
    const payload = buildZonePayload(sha256hex);

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
    const finalBuf = fs.readFileSync(exePath);
    const finalPe = parsePe(finalBuf);
    const layoutProblems = validateLayout(finalBuf, finalPe);
    if (layoutProblems.length > 0) {
        throw new Error('PE layout invalid after embed (exe would not load): ' + layoutProblems.join('; '));
    }
    return { mode, sha256hex, exePath };
}

/**
 * 校验 exe 的 .bnzc 区段完整性（不抛错，返回状态对象）。
 * @returns {{present:boolean, status:'ok'|'no-zone'|'bad-zone'|'mismatch'|'error',
 *            stored?:string, actual?:string, match?:boolean, error?:string}}
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
            match
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
        sha256hex: stored ? stored.sha256hex : null
    };
}

module.exports = {
    SECTION_NAME,
    ZONE_DATA_LEN,
    parsePe,
    hashExcludingZone,
    validateLayout,
    embedZone,
    verifyZone,
    inspectZone
};
