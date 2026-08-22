# fix-bat-crlf.ps1 - Self-heal guard: force CRLF line endings on .bat/.cmd files
#
# WHY THIS EXISTS (recurrence chain, fixed 2026-08-23):
#   AI/editing tools sometimes write .bat files with LF-only line endings directly
#   to disk. cmd.exe mis-parses UTF-8 Chinese multibyte sequences when lines end
#   in lone LF -> parse-time abort (exit 255) -> double-click window flash-close,
#   no build output (KNOWLEDGE 2.42). git stores LF internally (*.bat text eol=crlf),
#   so the corruption is INVISIBLE to git status and keeps coming back.
#   The existing fixer inside ensure-build-env.ps1 runs too late: it lives INSIDE
#   build.bat/build-app.bat, which crash at parse time before reaching it.
#   This guard runs from the ASCII-only entry bats (pack-desktop/pack-app*) BEFORE
#   the vulnerable downstream scripts are parsed, closing the recurrence loop.
#
# Usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File fix-bat-crlf.ps1 <file1.bat> [file2.bat ...]
#
# Safety rules:
#   - Only rewrites files that contain lone LF bytes (CRLF files untouched)
#   - Only rewrites strict-valid UTF-8 content (pure ASCII is a UTF-8 subset);
#     anything else (e.g. GBK) is skipped with [SKIP] so it is never corrupted
#   - Content unchanged except line endings (git renormalizes, no content diff)
#   - Always exits 0 so the calling batch is never blocked by this guard
param(
    [Parameter(Mandatory = $true, ValueFromRemainingArguments = $true)]
    [string[]]$Files
)

$utf8NoBom  = New-Object System.Text.UTF8Encoding($false)
$utf8Strict = New-Object System.Text.UTF8Encoding($false, $true)
$fixed = 0

foreach ($p in $Files) {
    if (-not (Test-Path -LiteralPath $p)) { continue }
    $full = (Resolve-Path -LiteralPath $p).Path
    $bytes = [System.IO.File]::ReadAllBytes($full)

    $loneLf = $false
    for ($i = 0; $i -lt $bytes.Length; $i++) {
        if ($bytes[$i] -eq 0x0A -and ($i -eq 0 -or $bytes[$i - 1] -ne 0x0D)) { $loneLf = $true; break }
    }
    if (-not $loneLf) { continue }

    $hasBom = ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF)
    $off = 0
    if ($hasBom) { $off = 3 }

    $text = $null
    try { $text = $utf8Strict.GetString($bytes, $off, $bytes.Length - $off) } catch {
        Write-Host "[SKIP] not valid UTF-8, left untouched: $p"
        continue
    }

    $text = $text.Replace("`r`n", "`n").Replace("`n", "`r`n")
    $enc = if ($hasBom) { New-Object System.Text.UTF8Encoding($true) } else { $utf8NoBom }
    [System.IO.File]::WriteAllText($full, $text, $enc)
    $fixed++
    Write-Host "[FIX] CRLF restored (was LF-corrupted): $p"
}

if ($fixed -gt 0) {
    Write-Host "[SELF-HEAL] $fixed file(s) fixed LF -> CRLF (prevents double-click flash crash)"
} else {
    Write-Host "[OK] bat line endings check passed (all CRLF)"
}
exit 0
