$files = @(
    'cloud_project\cloud_app\app\src\main\assets\video-recorder-inject.js',
    'cloud_project\cloud_app\app\src\main\assets\capacitor.config.json'
)
foreach ($f in $files) {
    $fullPath = (Resolve-Path $f).Path
    $bytes = [System.IO.File]::ReadAllBytes($fullPath)
    $bom = '{0:X2} {1:X2} {2:X2}' -f $bytes[0], $bytes[1], $bytes[2]
    if ($bom -eq 'EF BB BF') {
        Write-Host "$f : Has BOM"
    } else {
        Write-Host "$f : No BOM ($bom)"
    }
}
