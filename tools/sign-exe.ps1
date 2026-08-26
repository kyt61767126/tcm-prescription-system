# ============================================================================
#  sign-exe.ps1 - Authenticode code signing tool (P0-3, 2026-08-26)
#
#  Signs exe files with the self-signed code signing certificate
#  (tools/certs/*.pfx, password in tools/certs/cert-password.txt).
#
#  CRITICAL ORDER RULE (shared/pe-guard.cjs):
#    .bnzc embed MUST happen BEFORE signing. The .bnzc hash excludes
#    Authenticode-affected regions (CheckSum / security dir entry / cert table),
#    so signing after embed keeps both checks valid. Signing BEFORE embed
#    would invalidate the Authenticode signature.
#
#  Usage:
#    powershell -NoProfile -ExecutionPolicy Bypass -File tools\sign-exe.ps1 `
#        -ExePath "path\to\app.exe" [-VerifyBnzc]
#
#  Parameters:
#    -ExePath     one or more exe files to sign (wildcards allowed)
#    -VerifyBnzc  after signing, run node tools\pe-zone-sign.cjs verify on
#                 each signed file; exit 1 if the .bnzc hash broke (rc=1/3).
#                 rc=2 (no .bnzc zone, e.g. embed was skipped) is a WARN only.
#
#  Exit codes:
#    0 = all files signed OK (or nothing to sign)
#    1 = signing failed / .bnzc broke after signing  -> build MUST abort
#    2 = cert material missing (fresh clone without tools/certs/*.pfx)
#        -> skip signing, non-blocking (unsigned exe, same as pre-P0-3)
#
#  Notes:
#    - Self-signed cert: on machines without the cert in trusted roots,
#      Get-AuthenticodeSignature returns UnknownError (untrusted root) - this
#      is EXPECTED. Success here = signer certificate embedded + no
#      HashMismatch. Runtime fingerprint check lives in self-check.js.
#    - No timestamp server (offline-friendly). Cert expires 2031-08-26.
#    - This file must stay ASCII-only: Windows PowerShell 5.1 reads .ps1
#      without BOM as ANSI, non-ASCII literals would be garbled.
# ============================================================================

param(
    [Parameter(Mandatory = $true)]
    [string[]]$ExePath,
    [switch]$VerifyBnzc
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

$CertDir = Join-Path $PSScriptRoot 'certs'
$PfxPath = Get-ChildItem -Path $CertDir -Filter '*.pfx' -ErrorAction SilentlyContinue |
    Select-Object -First 1
$PwPath = Join-Path $CertDir 'cert-password.txt'

if ($null -eq $PfxPath -or -not (Test-Path $PwPath)) {
    Write-Host '[SIGN][WARN] cert material missing (tools/certs/*.pfx or cert-password.txt), skip signing' -ForegroundColor Yellow
    exit 2
}

$pw = (Get-Content $PwPath -Raw).Trim()
if (-not $pw) {
    Write-Host '[SIGN][ERROR] cert-password.txt is empty' -ForegroundColor Red
    exit 1
}

try {
    $secure = ConvertTo-SecureString $pw -AsPlainText -Force
    $cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($PfxPath.FullName, $secure)
} catch {
    Write-Host ('[SIGN][ERROR] failed to load pfx: ' + $_.Exception.Message) -ForegroundColor Red
    exit 1
}

$peZoneSign = Join-Path $PSScriptRoot 'pe-zone-sign.cjs'
$failed = $false
$signedCount = 0

foreach ($p in $ExePath) {
    $files = @()
    if ($p.Contains('*') -or $p.Contains('?')) {
        $files = @(Get-ChildItem -Path $p -ErrorAction SilentlyContinue)
    } elseif (Test-Path $p) {
        $files = @(Get-Item $p)
    }
    if ($files.Count -eq 0) {
        Write-Host ('[SIGN][WARN] file not found, skipped: ' + $p) -ForegroundColor Yellow
        continue
    }
    foreach ($f in $files) {
        try {
            $sig = Set-AuthenticodeSignature -FilePath $f.FullName -Certificate $cert -HashAlgorithm SHA256
        } catch {
            Write-Host ('[SIGN][ERROR] ' + $f.FullName + ' : ' + $_.Exception.Message) -ForegroundColor Red
            $failed = $true
            continue
        }
        if ($null -eq $sig -or $null -eq $sig.SignerCertificate) {
            Write-Host ('[SIGN][ERROR] ' + $f.FullName + ' signature not applied (SignerCertificate is null)') -ForegroundColor Red
            $failed = $true
            continue
        }
        if ($sig.Status -eq 'HashMismatch') {
            Write-Host ('[SIGN][ERROR] ' + $f.FullName + ' HashMismatch after signing') -ForegroundColor Red
            $failed = $true
            continue
        }
        # Self-signed without trusted root -> status UnknownError is expected.
        $statusNote = ''
        if ($sig.Status -ne 'Valid') { $statusNote = ' (self-signed, untrusted root = expected)' }
        Write-Host ('[SIGN][OK] ' + $f.Name + ' thumbprint=' + $sig.SignerCertificate.Thumbprint + ' status=' + $sig.Status + $statusNote)
        $signedCount++

        if ($VerifyBnzc -and (Test-Path $peZoneSign)) {
            & node $peZoneSign verify $f.FullName | Out-Host
            $rc = $LASTEXITCODE
            if ($rc -eq 1 -or $rc -eq 3) {
                Write-Host ('[SIGN][ERROR] ' + $f.FullName + ' : .bnzc verify failed (rc=' + $rc + ') after signing - hash exclusion logic broken?') -ForegroundColor Red
                $failed = $true
            } elseif ($rc -eq 2) {
                Write-Host ('[SIGN][WARN] ' + $f.Name + ' has no .bnzc zone (embed was skipped), signature-only') -ForegroundColor Yellow
            }
        }
    }
}

if ($failed) { exit 1 }
Write-Host ('[SIGN] done, ' + $signedCount + ' file(s) signed')
exit 0
