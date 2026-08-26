# verify-apk-sign-hash.ps1 - Build-time APK cert hash vs fragmented Java constant consistency check
# P1-2 companion tool: reassembles SIGN_FRAGMENTS from Java source and compares with APK cert SHA-256.
# Called by db-offline/app/build-app.bat and db-yunduan/build-app.bat (replaces old inline
# plaintext-regex one-liners that grepped EXPECTED_SIGN_HASH / EXPECTED_APK_SIGNATURE_SHA256).
#
# Usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File verify-apk-sign-hash.ps1 `
#       -ApkFile <apk> -Apksigner <apksigner.bat> -JavaFile <java> [-OldConstantName <name>]
#
# Exit codes: 0 = consistent, 1 = mismatch / extraction error
#
# Fragment scheme (must stay in sync with generate-sign-hash.ps1 and Java
# expectedApkSignatureSha256() / expectedSignHash()):
#   4 fragments x 16 hex chars; each fragment stored as
#   reverse( hexSubstitute(realFragment, +shift) ), shift per fragment index.

param(
    [Parameter(Mandatory = $true)]
    [string]$ApkFile,
    [Parameter(Mandatory = $true)]
    [string]$Apksigner,
    [Parameter(Mandatory = $true)]
    [string]$JavaFile,
    [string]$OldConstantName = ''
)

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# 1. Extract APK certificate SHA-256 via apksigner
$out = & $Apksigner verify --print-certs $ApkFile 2>&1 | Out-String
if ($out -notmatch 'certificate SHA-256 digest:\s*([0-9a-fA-F:]+)') {
    Write-Host '[ERROR] Cannot extract APK cert SHA-256 from apksigner output'
    exit 1
}
$apkHash = ($matches[1] -replace ':', '').ToLower()

# 2. Reassemble fragmented hash from Java source
$shifts = @(5, 11, 3, 9)
$src = Get-Content $JavaFile -Raw -Encoding UTF8
$injected = ''
if ($src -match 'SIGN_FRAGMENTS\s*=\s*\{([^}]*)\}') {
    $fragStr = $matches[1]
    $frags = @([regex]::Matches($fragStr, '"([0-9a-fA-F]*)"') | ForEach-Object { $_.Groups[1].Value })
    if ($frags.Count -eq 4) {
        $sb = ''
        for ($i = 0; $i -lt 4; $i++) {
            if ($frags[$i].Length -ne 16) { $sb = ''; break }
            $rev = $frags[$i].ToCharArray(); [array]::Reverse($rev)
            $shifted = -join $rev
            $sb += -join ($shifted.ToCharArray() | ForEach-Object {
                '{0:x}' -f (([Convert]::ToInt32($_.ToString(), 16) - $shifts[$i] + 16) % 16)
            })
        }
        if ($sb.Length -eq 64) { $injected = $sb.ToLower() }
    }
}

# Backward compatibility: legacy plaintext constant (transition defense only)
if (-not $injected -and $OldConstantName) {
    $oldPattern = [regex]::Escape($OldConstantName) + '\s*=\s*\x22([0-9a-fA-F]{64})\x22'
    if ($src -match $oldPattern) { $injected = $matches[1].ToLower() }
}

if (-not $injected) {
    Write-Host "[ERROR] SIGN_FRAGMENTS not found (or malformed) in $(Split-Path $JavaFile -Leaf)"
    Write-Host '        Run tools/generate-sign-hash.ps1 before building strict-mode APK'
    exit 1
}

# 3. Compare
if ($apkHash -ne $injected) {
    Write-Host "[ERROR] Cert hash mismatch! APK=$apkHash"
    Write-Host "        Injected=$injected"
    Write-Host '        APK will self-exit at runtime (signature check). Aborting build.'
    exit 1
}
Write-Host "[OK] APK cert SHA-256 == fragmented SIGN_FRAGMENTS ($($apkHash.Substring(0, 16))...)"
exit 0
