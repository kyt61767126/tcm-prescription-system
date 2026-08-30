// ============================================================================
//  惠康中医 - 主进程 exe 签名/完整性自校验（P0-③，2026-08-17）
//
//  原则：★非阻塞★——只记录日志，绝不弹窗退出，符合项目"宁可漏检不可误报、
//       不允许正常用户闪退"的硬性红线。
//  → 仅在 app.isPackaged（正式打包）时执行；开发环境直接跳过。
//  → 用 PowerShell Get-AuthenticodeSignature 读取当前 exe(process.execPath) 的
//    签名状态：Valid(已入信任根) / UnknownError(自签未入信任根，预期) /
//    NotSigned(未签名) / HashMismatch(哈希失配=被篡改)。
//  → P0-3（2026-08-26）：已接入自签发布证书（tools/certs/惠康中医-codesign.pfx，
//    CN=惠康中医软件, O=本能堂中医诊所, C=CN，有效期至 2031-08-26），指纹比对
//    生效：指纹匹配即通过；未签名/被重新签名/哈希失配均 WARN（仅记录不阻断）。
//
//  说明：本模块为主进程 require 模块，位于 electron/**/*，打包自动包含，
//  无需改动 package.json 的 build.files。
// ============================================================================

const { app, dialog } = require('electron');
const { execFile } = require('child_process');
const path = require('path');
const crypto = require('crypto');
// original-fs：未 patch 的原生 fs（避开 Electron asar 路径拦截，直接读 app.asar 磁盘文件）
let rawFs = null;
try { rawFs = require('original-fs'); } catch (e) { rawFs = require('fs'); }
// P1-[3.1] 第二路：PE .bnzc 完整性区段校验（shared/pe-guard.cjs，经 sync-all 同步）
const peGuard = require('./pe-guard.cjs');

// ★ P0-3（2026-08-26）：发布代码签名证书指纹（大写 SHA1，自签证书
//   tools/certs/惠康中医-codesign.pfx，由 build.bat 在 .bnzc 嵌入后签名）。
const EXPECTED_EXE_SIGNER_THUMBPRINT = 'E9D0B883BC0CCFF4A46525EAEB43446B18ABA3C6';

let initialized = false;

function log(tag, message) {
    console.log('[SelfCheck] [' + tag + '] ' + message);
}

/**
 * 异步检测 exe 签名状态，fire-and-forget，绝不阻碍启动。
 * 所有异常/未知状态仅记录，不弹窗、不退出。
 */
function runSelfCheck() {
    if (initialized) return;
    initialized = true;

    if (!app.isPackaged) {
        log('debug', '非打包环境，跳过自校验');
        return;
    }

    const exePath = process.execPath;
    // 在 PowerShell 单引号字符串中安全转义路径
    const escapedPath = "'" + exePath.replace(/'/g, "''") + "'";

    const psCommand =
        '$s = Get-AuthenticodeSignature -FilePath ' + escapedPath + '; ' +
        '$o = [PSCustomObject]@{ ' +
        'Status = $s.Status.ToString(); ' +
        'Subject = $s.SignerCertificate.Subject; ' +
        'Thumbprint = $s.SignerCertificate.Thumbprint }; ' +
        '$o | ConvertTo-Json -Compress';

    execFile(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', psCommand],
        { timeout: 15000, windowsHide: true },
        (err, stdout) => {
            if (err) {
                log('warn', '执行签名检测失败（非致命）: ' + err.message);
                return;
            }
            try {
                const info = JSON.parse((stdout || '').trim()) || {};
                const status = String(info.Status || 'Unknown');
                let detail = '状态=' + status;
                if (info.Subject) detail += '，颁发者=' + info.Subject;
                if (info.Thumbprint) detail += '，指纹=' + info.Thumbprint;

                const expectedUp = EXPECTED_EXE_SIGNER_THUMBPRINT.toUpperCase();
                if (status === 'HashMismatch') {
                    // 哈希失配优先判定：签名后字节被改，即使指纹匹配也是被篡改
                    log('WARN', 'exe 签名哈希失配，文件可能在签名后被篡改/重打包。' + detail);
                } else if (info.Thumbprint && info.Thumbprint.toUpperCase() === expectedUp) {
                    // 指纹匹配发布证书：Valid（证书已入信任根）或 UnknownError
                    // （自签证书未入信任根的预期状态）均视为通过
                    log('debug', 'exe 签名指纹匹配发布证书（自签），自校验通过。' + detail);
                } else if (status === 'NotSigned') {
                    log('WARN', 'exe 未签名（发布产物应带自签证书签名），可能被剥签名/重打包。' + detail);
                } else {
                    log('WARN', 'exe 已签名但指纹与发布证书不符，可能被重新签名/重打包。' + detail);
                }
            } catch (e) {
                log('warn', '解析签名检测结果失败（非致命）: ' + e.message);
            }
        }
    );

    // P1-[3.1] 第二路：PE .bnzc 区段完整性校验（不依赖证书，打包时嵌入）
    // 非阻塞：推迟到事件循环空闲执行，避免启动瞬间同步读 exe 阻塞窗口渲染
    setImmediate(runPeZoneCheck);
}

/**
 * 校验主 exe 的 .bnzc 完整性区段（第二路，不依赖证书）。
 * 非阻塞：任何异常/未知状态仅记录，不弹窗、不退出。
 *  - 无区段（旧版/开发环境）→ 记录 debug 后跳过
 *  - 区段哈希一致 → 通过；ver=2 且带 asar 哈希 → 追加 asar 全文件校验（P2-1）
 *  - 区段哈希失配 → WARN（exe 可能被篡改）
 */
function runPeZoneCheck() {
    if (!app.isPackaged) return;
    let r;
    try {
        r = peGuard.verifyZone(process.execPath);
    } catch (e) {
        log('warn', 'PE 完整性区段校验执行异常（非致命）: ' + e.message);
        return;
    }
    if (r.present === false) {
        log('debug', 'exe 未嵌入 .bnzc 区段（旧版/开发环境，符合预期），跳过 PE 完整性校验');
        return;
    }
    if (r.status === 'ok') {
        log('debug', 'PE 完整性自校验通过（.bnzc 区段哈希一致）。');
        if (r.asarSha256hex) {
            runAsarIntegrityCheck(r.asarSha256hex);
        }
    } else if (r.status === 'bad-zone') {
        log('WARN', 'exe 的 .bnzc 区段格式异常，完整性无法确认。');
    } else if (r.status === 'mismatch') {
        log('WARN', 'exe 可能被篡改：PE 完整性失配（存储=' + (r.stored || '') + ' 实际=' + (r.actual || '') + '）。');
    } else {
        log('warn', 'PE 完整性校验未知状态: ' + r.status);
    }
}

/**
 * ★ P2-1（2026-08-30）ASAR 全文件内容完整性校验（第三路，强阻断）。
 *
 * 动机：Electron fuse EnableEmbeddedAsarIntegrityValidation 只校验 asar 头，
 * 等长篡改 asar 内文件内容（如改试用天数/激活判断）头不变，fuse 检测不到。
 * .bnzc ver=2 携带打包时定稿的 asar 全文件 SHA-256，此处重算比对。
 *
 * 策略（与 .bnzc exe 校验的 WARN-only 不同，本项为强阻断）：
 *  - 失配 → showErrorBox + app.exit(1)。正常用户无合法触发场景：
 *    app.asar 是只读资源，安装/便携版均原样落盘；打包管线三重门禁
 *    （pe-zone-sign verify asar / final-verify / smoke-launch）确保发布
 *    产物嵌入哈希与实际 asar 一致，误报在发布前即被拦截。
 *  - 读取失败/路径缺失 → WARN 不阻断（防非常规布局误伤，宁可漏检不可误报）。
 */
function runAsarIntegrityCheck(expectedAsarSha) {
    if (!app.isPackaged) return;
    const asarPath = path.join(path.dirname(process.execPath), 'resources', 'app.asar');
    const h = crypto.createHash('sha256');
    let stream;
    try {
        stream = rawFs.createReadStream(asarPath, { highWaterMark: 1 << 20 });
    } catch (e) {
        log('warn', 'ASAR 完整性校验启动失败（非致命）: ' + e.message);
        return;
    }
    stream.on('error', (e) => {
        log('warn', 'ASAR 完整性校验读取失败（非致命）: ' + (e && e.message ? e.message : e));
    });
    stream.on('data', (chunk) => h.update(chunk));
    stream.on('end', () => {
        let actual;
        try {
            actual = h.digest('hex');
        } catch (e) {
            log('warn', 'ASAR 完整性校验摘要失败（非致命）: ' + e.message);
            return;
        }
        if (actual === expectedAsarSha) {
            log('debug', 'ASAR 全文件完整性校验通过（.bnzc ver=2，内容级防篡改生效）。');
        } else {
            log('WARN', 'ASAR 内容校验失配：存储=' + expectedAsarSha + ' 实际=' + actual + '，即将退出。');
            try {
                dialog.showErrorBox(
                    '文件完整性校验失败',
                    '程序文件已被修改或损坏，为保障数据安全程序即将退出。\n\n请从官方渠道重新下载安装包并重新安装。'
                );
            } catch (e) { /* 弹窗失败不拦截退出 */ }
            app.exit(1);
        }
    });
}

module.exports = { runSelfCheck, EXPECTED_EXE_SIGNER_THUMBPRINT };