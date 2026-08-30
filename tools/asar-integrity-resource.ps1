# asar-integrity-resource.ps1 - Embed/verify ElectronAsar integrity PE resource (P1-2)
# See tools/embed-asar-integrity.cjs for full documentation.
# ASCII-only content; UTF-8 BOM per pack-gate P2. Exit codes: 0=OK 1=fail.
param(
    [Parameter(Mandatory = $true)]
    [string]$ExePath,
    [Parameter(Mandatory = $true)]
    [string]$PayloadFile,
    [ValidateSet('embed', 'verify')]
    [string]$Mode = 'embed'
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class AsarIntegrityRes {
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern IntPtr BeginUpdateResource(string pFileName, bool bDeleteExistingResources);
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern bool UpdateResource(IntPtr hUpdate, string lpType, string lpName, ushort wLanguage, byte[] lpData, uint cbData);
    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool EndUpdateResource(IntPtr hUpdate, bool fDiscard);
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern IntPtr FindResource(IntPtr hModule, string lpName, string lpType);
    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern IntPtr LoadResource(IntPtr hModule, IntPtr hResInfo);
    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern IntPtr LockResource(IntPtr hResData);
    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern uint SizeofResource(IntPtr hModule, IntPtr hResInfo);
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern IntPtr LoadLibraryEx(string lpFileName, IntPtr hFile, uint dwFlags);
    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool FreeLibrary(IntPtr hModule);
}
"@

if (-not (Test-Path -LiteralPath $ExePath)) {
    Write-Host '[ASAR-INT][ERROR] exe not found:' $ExePath
    exit 1
}
if (-not (Test-Path -LiteralPath $PayloadFile)) {
    Write-Host '[ASAR-INT][ERROR] payload file not found:' $PayloadFile
    exit 1
}

$payload = [System.IO.File]::ReadAllBytes($PayloadFile)
$resType = 'Integrity'
$resName = 'ElectronAsar'

if ($Mode -eq 'embed') {
    $head = [System.Text.Encoding]::ASCII.GetString($payload, 0, [Math]::Min(1, $payload.Length))
    if ($head -ne '[') {
        Write-Host '[ASAR-INT][ERROR] payload is not a JSON array (must start with [)'
        exit 1
    }

    $h = [AsarIntegrityRes]::BeginUpdateResource($ExePath, $false)
    if ($h -eq [IntPtr]::Zero) {
        Write-Host ('[ASAR-INT][ERROR] BeginUpdateResource failed (file locked by AV?), GLE=' + [Runtime.InteropServices.Marshal]::GetLastWin32Error())
        exit 1
    }
    $ok = [AsarIntegrityRes]::UpdateResource($h, $resType, $resName, [uint16]0, $payload, [uint32]$payload.Length)
    if (-not $ok) {
        [void][AsarIntegrityRes]::EndUpdateResource($h, $true)
        Write-Host ('[ASAR-INT][ERROR] UpdateResource failed, GLE=' + [Runtime.InteropServices.Marshal]::GetLastWin32Error())
        exit 1
    }
    $ok = [AsarIntegrityRes]::EndUpdateResource($h, $false)
    if (-not $ok) {
        Write-Host '[ASAR-INT][ERROR] EndUpdateResource (commit) failed'
        exit 1
    }
    Write-Host ('[ASAR-INT] resource embedded: type=' + $resType + ' name=' + $resName + ' size=' + $payload.Length)
    exit 0
}
else {
    $LOAD_LIBRARY_AS_DATAFILE = 0x2
    $hMod = [AsarIntegrityRes]::LoadLibraryEx($ExePath, [IntPtr]::Zero, $LOAD_LIBRARY_AS_DATAFILE)
    if ($hMod -eq [IntPtr]::Zero) {
        Write-Host '[ASAR-INT][ERROR] LoadLibraryEx failed'
        exit 1
    }
    try {
        $hRes = [AsarIntegrityRes]::FindResource($hMod, $resName, $resType)
        if ($hRes -eq [IntPtr]::Zero) {
            Write-Host '[ASAR-INT][ERROR] ElectronAsar/Integrity resource NOT found in exe'
            exit 1
        }
        $hData = [AsarIntegrityRes]::LoadResource($hMod, $hRes)
        if ($hData -eq [IntPtr]::Zero) {
            Write-Host '[ASAR-INT][ERROR] LoadResource failed'
            exit 1
        }
        $size = [AsarIntegrityRes]::SizeofResource($hMod, $hRes)
        if ($size -ne $payload.Length) {
            Write-Host ('[ASAR-INT][ERROR] size mismatch: resource=' + $size + ' expected=' + $payload.Length)
            exit 1
        }
        $ptr = [AsarIntegrityRes]::LockResource($hData)
        $bytes = New-Object byte[] $size
        [System.Runtime.InteropServices.Marshal]::Copy($ptr, $bytes, 0, $size)
        for ($i = 0; $i -lt $size; $i++) {
            if ($bytes[$i] -ne $payload[$i]) {
                Write-Host ('[ASAR-INT][ERROR] byte mismatch at offset ' + $i)
                exit 1
            }
        }
        Write-Host ('[ASAR-INT] resource verified OK (' + $size + ' bytes, byte-identical)')
        exit 0
    }
    finally {
        [void][AsarIntegrityRes]::FreeLibrary($hMod)
    }
}