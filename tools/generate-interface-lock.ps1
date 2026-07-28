# ============================================================================
#  generate-interface-lock.ps1
#  生成 .interface-lock.json 界面指纹基线文件
#  提取每个 index.html / login.html 的 <body> 到第一个 <script> 之间的 HTML 结构
#  计算 SHA256 哈希作为界面指纹，安全优化改 script 不会影响指纹
# ============================================================================
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$files = @(
    'cloud_project/cloud_desktop/index.html',
    'public/index.html',
    'offline_project/db-dingzhi/index.html',
    'offline_project/db-geren/index.html',
    'cloud_project/cloud_desktop/electron/login.html',
    'public/electron/login.html',
    'offline_project/db-dingzhi/electron/login.html',
    'offline_project/db-geren/electron/login.html'
)

$result = [ordered]@{
    generated_at = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz')
    description  = 'Interface structure fingerprint. SHA256 of HTML body (before first <script>). Changes to <script> blocks do NOT affect fingerprint.'
    files        = [ordered]@{}
}

foreach ($f in $files) {
    $fullPath = Join-Path $root $f
    if (-not (Test-Path $fullPath)) {
        $result.files[$f] = @{ error = 'file not found' }
        continue
    }
    $content = Get-Content $fullPath -Raw -Encoding UTF8
    $bodyMatch = [regex]::Match($content, '(?s)<body[^>]*>(.*?)<script')
    if (-not $bodyMatch.Success) {
        $result.files[$f] = @{ error = 'body section not found' }
        continue
    }
    $html = $bodyMatch.Groups[1].Value
    $sha = [System.Security.Cryptography.SHA256]::Create()
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($html)
    $hashBytes = $sha.ComputeHash($bytes)
    $hash = ($hashBytes | ForEach-Object { $_.ToString('x2') }) -join ''
    $result.files[$f] = [ordered]@{
        sha256      = $hash
        html_length = $html.Length
    }
    Write-Host ("[OK] {0}  sha256={1}  len={2}" -f $f, $hash, $html.Length)
}

$lockFile = Join-Path $root '.interface-lock.json'
$result | ConvertTo-Json -Depth 5 | Out-File $lockFile -Encoding UTF8
Write-Host ""
Write-Host ("[DONE] Lock file generated: {0}" -f $lockFile)
