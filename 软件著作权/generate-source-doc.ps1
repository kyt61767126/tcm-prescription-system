# Generate Source Code Document for Software Copyright Registration
# Software: Huikang TCM Clinic Management System V1.0.0
# Copyright Owner: Gaobeidian Huikangtang TCM Clinic Co., Ltd.
#
# Source code document strategy:
#   - Front 30 pages: self-developed core business modules
#   - Back 30 pages: data storage and permission modules
#   - 50 lines per page, 60 pages total
#   - Header: software name + copyright owner

# Software name in Chinese: HuiKang TCM Clinic Management System V1.0.0
$softwareName = [char]0x60E0 + [char]0x5EB7 + [char]0x4E2D + [char]0x533B + [char]0x8BCA + [char]0x6240 + [char]0x7BA1 + [char]0x7406 + [char]0x7CFB + [char]0x7EDF + " V1.0.0"

# Copyright owner in Chinese: Copyright Owner: Gaobeidian Huikangtang TCM Clinic Co., Ltd.
$copyrightLabel = [char]0x8457 + [char]0x4F5C + [char]0x6743 + [char]0x4EBA + [char]0xFF1A
$ownerName = [char]0x9AD8 + [char]0x7891 + [char]0x5E97 + [char]0x60E0 + [char]0x5EB7 + [char]0x5802 + [char]0x4E2D + [char]0x533B + [char]0x8BCA + [char]0x6240 + [char]0x6709 + [char]0x9650 + [char]0x516C + [char]0x53F8

$separatorChar = [char]0xFF5C
$headerLine = $softwareName + " " + $separatorChar + " " + $copyrightLabel + $ownerName

$desktopDir = "d:\trae_projects\kyt-zy\app_project\db-offline\desktop"
$electronDir = "$desktopDir\electron"
$outputFile = "d:\trae_projects\kyt-zy\software_copyright\source-code-document.txt"

# File order: self-developed core modules first
$files = @(
    "$desktopDir\index.html",
    "$desktopDir\prescription-core.js",
    "$desktopDir\medicine-dict.js",
    "$desktopDir\auth-core.js",
    "$desktopDir\security-guard.js",
    "$desktopDir\permission.js",
    "$desktopDir\patient-archive.js",
    "$desktopDir\print-utils.js",
    "$desktopDir\db-adapter.js",
    "$desktopDir\performance-utils.js",
    "$desktopDir\debug-logger.js",
    "$desktopDir\afterPack.js",
    "$electronDir\main.js",
    "$electronDir\preload.js",
    "$electronDir\video-recorder.js",
    "$electronDir\update-notifier.js",
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
Write-Host ""
Write-Host "Total source lines: $totalLines" -ForegroundColor Cyan

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

Write-Host ""
Write-Host "Generating document..." -ForegroundColor Cyan

$output = @()
$pageNum = 0
$separator = "=" * 80

# Document cover
$output += $separator
$output += ("  " + $softwareName)
$output += ("  " + $copyrightLabel + $ownerName)
$output += "  Source Code Document (60 pages)"
$output += $separator
$output += ""

for ($i = 0; $i -lt $frontContent.Count; $i += $linesPerPage) {
    $pageNum++
    $endIdx = [math]::Min($i + $linesPerPage - 1, $frontContent.Count - 1)
    $pageLines = $frontContent[$i..$endIdx]

    $pageLabel = "  Source Code  Page " + $pageNum + " / " + $totalPages
    $output += $separator
    $output += ("  " + $headerLine)
    $output += $pageLabel
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

        $pageLabel = "  Source Code  Page " + $pageNum + " / " + $totalPages
        $output += $separator
        $output += ("  " + $headerLine)
        $output += $pageLabel
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
Write-Host ""
Write-Host "Source code document generated: $outputFile" -ForegroundColor Green
Write-Host "Total pages: $pageNum | File size: $([math]::Round($fileSize/1024, 1)) KB" -ForegroundColor Green
