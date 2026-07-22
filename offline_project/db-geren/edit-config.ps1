# edit-config.ps1 - Thin wrapper, calls tools/pack.ps1 -Target config
# Kept as compatibility entry for build-app.bat
# Actual config editing logic is in tools/pack.ps1 Edit-ClinicConfig function
$version = (Split-Path $PSScriptRoot -Leaf) -replace '^db-', ''
& "$PSScriptRoot\..\..\tools\pack.ps1" -Version $version -Target config
