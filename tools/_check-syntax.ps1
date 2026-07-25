$tokens = $null
$errors = $null
[System.Management.Automation.Language.Parser]::ParseFile('d:\trae_projects\kyt-zy\tools\pack.ps1', [ref]$tokens, [ref]$errors) | Out-Null
if ($errors -and $errors.Count -gt 0) {
    Write-Host "Syntax errors found: $($errors.Count)" -ForegroundColor Red
    $errors | ForEach-Object {
        Write-Host ("  Line {0}: {1}" -f $_.Extent.StartLineNumber, $_.Message) -ForegroundColor Red
    }
    exit 1
} else {
    Write-Host "OK: pack.ps1 syntax valid" -ForegroundColor Green
    exit 0
}
