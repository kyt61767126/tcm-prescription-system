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
#        -ExePath "path\to\app.exe" [-VerifyBnzc] [-Strict] [-SelfCheckPath ...\electron\self-check.js]
#
#  Parameters:
#    -ExePath     one or more exe files to sign (wildcards allowed)
#    -VerifyBnzc  after signing, run node tools\pe-zone-sign.cjs verify on
#                 each signed file; exit 1 if the .bnzc hash broke (rc=1/3).
#                 rc=2 (no .bnzc zone, e.g. embed was skipped) is a WARN only.
#    -Strict      release-build gate (P1, 2026-09-24): missing cert material
#                 is a hard error (exit 1) instead of the legacy skip (rc=2).
#                 Release pipelines MUST pass this so an unsigned exe can never
#                 ship silently.
#    -SelfCheckPath  path to the product electron\self-check.js. The loaded
#                 pfx thumbprint MUST equal EXPECTED_EXE_SIGNER_THUMBPRINT
#                 compiled into that file (runtime tamper-detection authority);
#                 mismatch exits 1 BEFORE signing (a renewed/swapped cert would
#                 make every client self-check report 'tampered'). In -Strict
#                 mode a missing/unparseable self-check file also exits 1.
#    -TimestampServer  Timestamp server URL (P1-1, 2026-08-30). Formal-CA-cert
#                 scenario: stamps the signature so it stays valid after the
#                 certificate expires. Empty (default) = offline-friendly, no
#                 timestamp (self-signed cert does not need one). Env fallback:
#                 SIGN_TIMESTAMP_SERVER. Common servers:
#                   http://timestamp.digicert.com
#                   http://timestamp.sectigo.com
#
#  Exit codes:
#    0 = all files signed OK (or nothing to sign)
#    1 = signing failed / .bnzc broke after signing / thumbprint mismatch /
#        cert material or self-check missing under -Strict -> build MUST abort
#    2 = cert material missing (fresh clone without tools/certs/*.pfx)
#        -> skip signing, non-blocking (unsigned exe, same as pre-P0-3);
#           NEVER returned when -Strict is set (becomes exit 1).
#
#  Notes:
#    - Self-signed cert: on machines without the cert in trusted roots,
#      Get-AuthenticodeSignature returns UnknownError (untrusted root) - this
#      is EXPECTED. Success here = signer certificate embedded + no
#      HashMismatch. Runtime fingerprint check lives in self-check.js.
#    - Default: no timestamp server (offline-friendly; self-signed cert
#      expires 2031-08-26). Pass -TimestampServer with a formal CA cert.
#      Timestamp failure degrades to signing WITHOUT timestamp (WARN, not
#      abort) - never break a build over a flaky timestamp server.
#    - This file must stay ASCII-only: Windows PowerShell 5.1 reads .ps1
#      without BOM as ANSI, non-ASCII literals would be garbled.
# ============================================================================

param(
    [Parameter(Mandatory = $true)]
    [string[]]$ExePath,
    [switch]$VerifyBnzc,
    [switch]$Strict,
    [string]$SelfCheckPath = '',
    [string]$TimestampServer = ''
)

# P1-1: env fallback so formal-cert builds can enable timestamping globally
if (-not $TimestampServer) { $TimestampServer = $env:SIGN_TIMESTAMP_SERVER }

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

$CertDir = Join-Path $PSScriptRoot 'certs'
$PfxPath = Get-ChildItem -Path $CertDir -Filter '*.pfx' -ErrorAction SilentlyContinue |
    Select-Object -First 1
$PwPath = Join-Path $CertDir 'cert-password.txt'

if ($null -eq $PfxPath -or -not (Test-Path $PwPath)) {
    if ($Strict) {
        Write-Host '[SIGN][ERROR] -Strict release build: cert material missing (tools/certs/*.pfx or cert-password.txt), aborting - unsigned exe must NOT ship' -ForegroundColor Red
        exit 1
    }
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

# P1 (2026-09-24) release-gate thumbprint assertion: the pfx about to sign MUST
# be the certificate hard-coded in electron/self-check.js, otherwise every
# shipped exe would self-report 'tampered' (fingerprint mismatch) on clients.
# Fail fast BEFORE touching any exe.
if ($SelfCheckPath) {
    if (-not (Test-Path $SelfCheckPath)) {
        if ($Strict) {
            Write-Host ('[SIGN][ERROR] -Strict: self-check file not found: ' + $SelfCheckPath) -ForegroundColor Red
            exit 1
        }
        Write-Host ('[SIGN][WARN] SelfCheckPath not found, thumbprint assertion skipped: ' + $SelfCheckPath) -ForegroundColor Yellow
    } else {
        # Read as UTF-8 explicitly: self-check.js is UTF-8 (no BOM) with Chinese
        # comments; PS 5.1 Get-Content -Raw defaults to ANSI/GBK, whose DBCS
        # resync can swallow adjacent LF bytes and silently corrupt the text.
        $scText = Get-Content $SelfCheckPath -Raw -Encoding UTF8
        # Anchor to the single const declaration (line start) and require exactly
        # one match: a loose first-match could be spoofed by a comment/placeholder
        # appearing above the real constant.
        $tpMatches = [regex]::Matches($scText, "(?m)^const\s+EXPECTED_EXE_SIGNER_THUMBPRINT\s*=\s*'([0-9A-Fa-f]{40})'\s*;")
        if ($tpMatches.Count -ne 1) {
            if ($Strict) {
                Write-Host ('[SIGN][ERROR] -Strict: expected exactly 1 const EXPECTED_EXE_SIGNER_THUMBPRINT in ' + $SelfCheckPath + ' (found ' + $tpMatches.Count + ')') -ForegroundColor Red
                exit 1
            }
            Write-Host ('[SIGN][WARN] expected thumbprint const not found/unique (' + $tpMatches.Count + ' matches), assertion skipped') -ForegroundColor Yellow
        } else {
            $expectedTp = $tpMatches[0].Groups[1].Value.ToUpperInvariant()
            $actualTp = $cert.Thumbprint.ToUpperInvariant()
            if ($actualTp -ne $expectedTp) {
                Write-Host ('[SIGN][ERROR] signer thumbprint MISMATCH: pfx=' + $actualTp + ' expected(self-check)=' + $expectedTp) -ForegroundColor Red
                Write-Host '[SIGN][ERROR] Refusing to sign: clients would flag this exe as tampered. Restore the correct tools/certs pfx or update both sides deliberately.' -ForegroundColor Red
                exit 1
            }
            Write-Host ('[SIGN][OK] pfx thumbprint matches self-check expectation: ' + $expectedTp)
        }
    }
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
        $sig = $null
        if ($TimestampServer) {
            # P1-1: formal cert -> timestamp the signature (survives cert expiry).
            # PS 5.1 does NOT throw on timestamp failure - it returns a result
            # object with null SignerCertificate, so detect that and retry bare.
            try {
                $sig = Set-AuthenticodeSignature -FilePath $f.FullName -Certificate $cert -HashAlgorithm SHA256 -TimestampServer $TimestampServer
            } catch {
                $sig = $null
            }
            if ($null -eq $sig -or $null -eq $sig.SignerCertificate) {
                Write-Host ('[SIGN][WARN] timestamp server failed (' + $TimestampServer + '), retrying WITHOUT timestamp') -ForegroundColor Yellow
                $sig = $null
            }
        }
        if ($null -eq $sig) {
            try {
                $sig = Set-AuthenticodeSignature -FilePath $f.FullName -Certificate $cert -HashAlgorithm SHA256
            } catch {
                Write-Host ('[SIGN][ERROR] ' + $f.FullName + ' : ' + $_.Exception.Message) -ForegroundColor Red
                $failed = $true
                continue
            }
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
        $tsNote = ''
        if ($TimestampServer) {
            if ($null -ne $sig.TimeStamperCertificate) {
                $tsNote = ' timestamped=' + $sig.TimeStamperCertificate.Thumbprint
            } else {
                $tsNote = ' NOT-TIMESTAMPED'
                Write-Host ('[SIGN][WARN] ' + $f.Name + ' timestamp missing though -TimestampServer was requested (signature expires with cert)') -ForegroundColor Yellow
            }
        }
        Write-Host ('[SIGN][OK] ' + $f.Name + ' thumbprint=' + $sig.SignerCertificate.Thumbprint + ' status=' + $sig.Status + $statusNote + $tsNote)
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
