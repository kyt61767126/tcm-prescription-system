# ============================================================================
#  credential-vault.ps1 — Windows 凭据管理器读写封装（2026-09-26 M-2 根治）
#
#  用途：把授权链本地锚点（登录闸门拒绝标记 / 7 天宽限起点 / users-backup 单调
#  gen / legacy 退役标记）存进 Windows 凭据管理器（Generic 凭据），替代旧的
#  gate.dat + .license-anchor 两个可被直接删除的文件。凭据按当前 Windows 用户
#  隔离、由 OS 保管，普通 del/双删/资源管理器均无法移除，只能经本脚本 delete。
#
#  调用方式（与 shared/license/license-manager.js 配套）：
#    1) powershell -NoProfile -ExecutionPolicy Bypass -File <本文件>
#         -Action read -Target <名称> [-Value <写入内容>]
#    2) 从 asar 内执行时无法 -File，调用方用 -EncodedCommand 传入本脚本全文，
#         参数经环境变量 BNZC_VAULT_ACTION / BNZC_VAULT_TARGET / BNZC_VAULT_VALUE。
#
#  输出：stdout 最后一行输出单行 JSON（PS 5.1 兼容）：
#    { ok:true, found:true, blob:'...' }   read 命中
#    { ok:true, found:false }              read 无凭据 / delete 目标本就不存在
#    { ok:true }                           write / delete 成功 / probe
#    { ok:false, error:'...' }             调用失败（调用方按 vault 不可用降级）
# ============================================================================
param(
    [ValidateSet('probe', 'read', 'write', 'delete')]
    [string]$Action = '',
    [string]$Target = '',
    [string]$Value = ''
)

$ErrorActionPreference = 'Stop'

# 参数回退环境变量（asar 内 EncodedCommand 调用时无法走命名参数）
if ([string]::IsNullOrEmpty($Action)) { $Action = [string]$env:BNZC_VAULT_ACTION }
if ([string]::IsNullOrEmpty($Target)) { $Target = [string]$env:BNZC_VAULT_TARGET }
if ([string]::IsNullOrEmpty($Value))  { $Value  = [string]$env:BNZC_VAULT_VALUE }
if ([string]::IsNullOrEmpty($Action)) { $Action = 'probe' }

function Out-Json {
    param([hashtable]$Obj)
    [Console]::Out.WriteLine(($Obj | ConvertTo-Json -Compress -Depth 6))
}

# probe：只验证 PowerShell 能启动并解析本脚本——不注册 C#（省每次 Add-Type
# 编译，缩短登录/激活热路径）；凭据 API 在 read/write/delete 时才注册。
if ($Action -eq 'probe') {
    Out-Json @{ ok = $true }
    return
}

# Win32 Credential API（仅在当前进程未注册时注册，避免重复 Add-Type 报错）
$__sig = @'
using System;
using System.Runtime.InteropServices;
public static class CredApi {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct CREDENTIAL {
        public uint Flags;
        public uint Type;
        public string TargetName;
        public string Comment;
        public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
        public uint CredentialBlobSize;
        public IntPtr CredentialBlob;
        public uint Persist;
        public uint AttributeCount;
        public IntPtr Attributes;
        public string TargetAlias;
        public string UserName;
    }
    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern bool CredWrite(ref CREDENTIAL credential, uint flags);
    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern bool CredRead(string target, uint type, uint reservedFlags, out IntPtr credential);
    [DllImport("advapi32.dll", SetLastError = true)]
    public static extern bool CredFree(IntPtr cred);
    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern bool CredDelete(string target, uint type, uint flags);
}
'@
# Add-Type 需写临时程序集；用户 TEMP 被重定向到文件/不可写目录会导致永久
# addtype-failed。兜底到真实可写目录（LOCALAPPDATA\Temp → Windows\Temp）。
# 注意：候选只能用字符串拼接——Join-Path 会校验盘符存在性，坏盘符会在
# 数组构造阶段抛异常（此时脚本无任何输出）。
$cands = New-Object System.Collections.Generic.List[string]
foreach ($base in @($env:TEMP, $env:TMP, "$env:LOCALAPPDATA\Temp", "$env:SystemRoot\Temp")) {
    try {
        if ([string]::IsNullOrWhiteSpace($base)) { continue }
        $b = $base.TrimEnd('\')
        if (-not $cands.Contains($b)) { [void]$cands.Add($b) }
    } catch { }
}
foreach ($d in $cands) {
    try {
        if (-not (Test-Path -LiteralPath $d)) { New-Item -ItemType Directory -Path $d -Force | Out-Null }
        $probeF = Join-Path $d ("w$([Guid]::NewGuid().ToString('N')).tmp")
        [IO.File]::WriteAllText($probeF, 'x')
        Remove-Item -LiteralPath $probeF -Force
        $env:TEMP = $d; $env:TMP = $d
        break
    } catch { }
}
try {
    if (-not ('CredApi' -as [type])) { Add-Type -TypeDefinition $__sig }
} catch {
    Out-Json @{ ok = $false; error = 'addtype-failed' }
    return
}

# Win32 常量
$CRED_TYPE_GENERIC = 1
$CRED_PERSIST_LOCAL_MACHINE = 2
$ERROR_NOT_FOUND = 1168

switch ($Action) {
    'read' {
        if ([string]::IsNullOrEmpty($Target)) { Out-Json @{ ok = $false; error = 'empty-target' }; break }
        $__ptr = [IntPtr]::Zero
        if ([CredApi]::CredRead($Target, $CRED_TYPE_GENERIC, 0, [ref]$__ptr)) {
            try {
                $__c = [Runtime.InteropServices.Marshal]::PtrToStructure($__ptr, [Type][CredApi+CREDENTIAL])
                $__blob = ''
                if ($__c.CredentialBlobSize -gt 0) {
                    $__buf = New-Object byte[] $__c.CredentialBlobSize
                    [Runtime.InteropServices.Marshal]::Copy($__c.CredentialBlob, $__buf, 0, $__c.CredentialBlobSize)
                    $__blob = [Text.Encoding]::UTF8.GetString($__buf)
                }
                Out-Json @{ ok = $true; found = ($__blob.Length -gt 0); blob = $__blob }
            } finally {
                [void][CredApi]::CredFree($__ptr)
            }
        } else {
            $__err = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
            if ($__err -eq $ERROR_NOT_FOUND) { Out-Json @{ ok = $true; found = $false } }
            else { Out-Json @{ ok = $false; error = "CredRead win32=$__err" } }
        }
    }
    'write' {
        if ([string]::IsNullOrEmpty($Target)) { Out-Json @{ ok = $false; error = 'empty-target' }; break }
        if ([string]::IsNullOrEmpty($Value))  { Out-Json @{ ok = $false; error = 'empty-value' }; break }
        $__bytes = [Text.Encoding]::UTF8.GetBytes($Value)
        # Credential blob 上限 CRED_MAX_CREDENTIAL_BLOB_SIZE = 2560；锚点密文远小于此
        if ($__bytes.Length -gt 2560) { Out-Json @{ ok = $false; error = "blob-too-large=$($__bytes.Length)" }; break }
        $__ptr = [Runtime.InteropServices.Marshal]::AllocHGlobal($__bytes.Length)
        try {
            [Runtime.InteropServices.Marshal]::Copy($__bytes, 0, $__ptr, $__bytes.Length)
            $__c = New-Object CredApi+CREDENTIAL
            $__c.Flags = 0
            $__c.Type = $CRED_TYPE_GENERIC
            $__c.TargetName = $Target
            $__c.CredentialBlob = $__ptr
            $__c.CredentialBlobSize = [uint32]$__bytes.Length
            $__c.Persist = $CRED_PERSIST_LOCAL_MACHINE
            $__c.UserName = [Security.Principal.WindowsIdentity]::GetCurrent().Name
            if ([CredApi]::CredWrite([ref]$__c, 0)) {
                Out-Json @{ ok = $true }
            } else {
                Out-Json @{ ok = $false; error = "CredWrite win32=$([Runtime.InteropServices.Marshal]::GetLastWin32Error())" }
            }
        } finally {
            [Runtime.InteropServices.Marshal]::FreeHGlobal($__ptr)
        }
    }
    'delete' {
        if ([string]::IsNullOrEmpty($Target)) { Out-Json @{ ok = $false; error = 'empty-target' }; break }
        if ([CredApi]::CredDelete($Target, $CRED_TYPE_GENERIC, 0)) {
            Out-Json @{ ok = $true }
        } else {
            $__err = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
            if ($__err -eq $ERROR_NOT_FOUND) { Out-Json @{ ok = $true; found = $false } }
            else { Out-Json @{ ok = $false; error = "CredDelete win32=$__err" } }
        }
    }
}
