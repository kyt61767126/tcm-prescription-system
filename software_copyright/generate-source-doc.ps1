# Generate Source Code Document for Software Copyright Registration
# Software: Huikang TCM Clinic Management System V1.0.0

$softwareName = "HuiKang TCM Clinic Management System V1.0.0"
$softwareNameCN = [char]0x60E0 + [char]0x5EB7 + [char]0x4E2D + [char]0x533B + [char]0x8BCA + [char]0x6240 + [char]0x7BA1 + [char]0x7406 + [char]0x7CFB + [char]0x7EDF + " V1.0.0"
$desktopDir = "d:\trae_projects\kyt-zy\app_project\db-offline\desktop"
$electronDir = "$desktopDir\electron"
$outputFile = "d:\trae_projects\kyt-zy\software_copyright\source-code-document.txt"

$files = @(
    "$desktopDir\index.html",
    "$desktopDir\auth-core.js",
    "$electronDir\main.js",
    "$electronDir\license-manager.js",
    "$electronDir\video-recorder.js",
    "$desktopDir\db-adapter.js",
    "$desktopDir\performance-utils.js",
    "$electronDir\update-notifier.js",
    "$desktopDir\patient-archive.js",
    "$electronDir\login.js",
    "$electronDir\activate.js",
    "$electronDir\prescription-counter.js",
    "$desktopDir\prescription-core.js",
    "$electronDir\hot-update.js",
    "$desktopDir\permission.js",
    "$desktopDir\security-guard.js",
    "$desktopDir\medicine-dict.js",
    "$desktopDir\print-utils.js",
    "$electronDir\preload.js",
    "$electronDir\feature-guard.js",
    "$desktopDir\debug-logger.js",
    "$desktopDir\afterPack.js",
    "$electronDir\prompt-preload.js"
)

Write-Host "Reading source files..." -ForegroundColor Cyan

$allLines = @()
foreach ($file in $files) {
    if (Test-Path $file) {
        $fileName = Split-Path $file -Leaf
        $dirName = Split-Path (Split-Path $file -Parent) -Leaf
        $relativePath = if ($dirName -eq "desktop") { $fileName } else { "electron/$fileName" }
        $allLines += "/********** File: $relativePath **********/"
        $content = Get-Content $file -Encoding UTF8
        $allLines += $content
        $lineCount = $content.Count
        Write-Host "  [$relativePath] $lineCount lines" -ForegroundColor Green
    } else {
        Write-Host "  [SKIP] $file not found" -ForegroundColor Yellow
    }
}

$totalLines = $allLines.Count
Write-Host "`nTotal source lines: $totalLines" -ForegroundColor Cyan

$frontPages = 30
$linesPerPage = 50
$frontLines = $frontPages * $linesPerPage
$backLines = $frontLines

if ($totalLines -le ($frontLines + $backLines)) {
    $frontContent = $allLines
    $backContent = @()
    $totalPages = [math]::Ceiling($totalLines / $linesPerPage)
    Write-Host "Source code less than 60 pages ($totalPages pages), submit all" -ForegroundColor Yellow
} else {
    $frontContent = $allLines[0..($frontLines - 1)]
    $backContent = $allLines[($totalLines - $backLines)..($totalLines - 1)]
    $totalPages = $frontPages * 2
    Write-Host "Source code exceeds 60 pages, extracting first $frontPages + last $frontPages pages" -ForegroundColor Cyan
}

Write-Host "`nGenerating document..." -ForegroundColor Cyan

$output = @()
$pageNum = 0
$separator = "=" * 80

for ($i = 0; $i -lt $frontContent.Count; $i += $linesPerPage) {
    $pageNum++
    $endIdx = [math]::Min($i + $linesPerPage - 1, $frontContent.Count - 1)
    $pageLines = $frontContent[$i..$endIdx]

    $output += $separator
    $output += "  $softwareNameCN"
    $output += "  Source Code  Page $pageNum"
    $output += $separator
    for ($j = 0; $j -lt $pageLines.Count; $j++) {
        $lineNum = $i + $j + 1
        $lineText = "{0,5}: {1}" -f $lineNum, $pageLines[$j]
        $output += $lineText
    }
    $output += ""
}

if ($backContent.Count -gt 0) {
    $output += ""
    $output += $separator
    $output += "  (Following is the last 30 pages of source code)"
    $output += $separator
    $output += ""

    $backStartLine = $totalLines - $backLines + 1
    for ($i = 0; $i -lt $backContent.Count; $i += $linesPerPage) {
        $pageNum++
        $endIdx = [math]::Min($i + $linesPerPage - 1, $backContent.Count - 1)
        $pageLines = $backContent[$i..$endIdx]

        $output += $separator
        $output += "  $softwareNameCN"
        $output += "  Source Code  Page $pageNum"
        $output += $separator
        for ($j = 0; $j -lt $pageLines.Count; $j++) {
            $lineNum = $backStartLine + $i + $j
            $lineText = "{0,5}: {1}" -f $lineNum, $pageLines[$j]
            $output += $lineText
        }
        $output += ""
    }
}

$output | Out-File -FilePath $outputFile -Encoding UTF8
$fileSize = (Get-Item $outputFile).Length
Write-Host "`nSource code document generated: $outputFile" -ForegroundColor Green
Write-Host "Total pages: $pageNum | File size: $([math]::Round($fileSize/1024, 1)) KB" -ForegroundColor Green
