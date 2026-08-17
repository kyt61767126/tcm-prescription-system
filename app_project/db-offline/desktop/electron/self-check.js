// ============================================================================
//  惠康中医 - 主进程 exe 签名/完整性自校验（P0-③，2026-08-17）
//
//  原则：★非阻塞★——只记录日志，绝不弹窗退出，符合项目"宁可漏检不可误报、
//       不允许正常用户闪退"的硬性红线。
//  → 仅在 app.isPackaged（正式打包）时执行；开发环境直接跳过。
//  → 用 PowerShell Get-AuthenticodeSignature 读取当前 exe(process.execPath) 的
//    签名状态：Valid(签名有效) / NotSigned(未签名) / HashMismatch(哈希失配=被篡改)。
//  → 预留签名位：EXPECTED_EXE_SIGNER_THUMBPRINT 默认留空（发布库未配置签名私钥，
//    exe 处于未签名态，符合预期）。未来接入代码签名后，把发布证书的 SHA1 指纹
//    填入该常量，即可从"仅记录状态"升级为"指纹比对（被重新签名会告警）"。
//
//  说明：本模块为主进程 require 模块，位于 electron/**/*，打包自动包含，
//  无需改动 package.json 的 build.files。
// ============================================================================

const { app } = require('electron');
const { execFile } = require('child_process');

// ★ 预留：发布代码签名的证书指纹（大写 SHA1）。当前未签名，留空则不比对。
const EXPECTED_EXE_SIGNER_THUMBPRINT = '';

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
                if (status === 'Valid' && EXPECTED_EXE_SIGNER_THUMBPRINT &&
                        info.Thumbprint && info.Thumbprint.toUpperCase() !== expectedUp) {
                    log('WARN', 'exe 已签名但指纹与发布证书不符，可能被重新签名/重打包。' + detail);
                } else if (status === 'Valid') {
                    log('debug', 'exe 签名有效，自校验通过。' + detail);
                } else if (status === 'HashMismatch') {
                    log('WARN', 'exe 签名哈希失配，文件可能在签名后被篡改/重打包。' + detail);
                } else if (status === 'NotSigned') {
                    log('debug', 'exe 未签名（当前发布未配置签名私钥，符合预期）。' + detail);
                } else {
                    log('warn', '签名状态未知：' + detail);
                }
            } catch (e) {
                log('warn', '解析签名检测结果失败（非致命）: ' + e.message);
            }
        }
    );
}

module.exports = { runSelfCheck, EXPECTED_EXE_SIGNER_THUMBPRINT };