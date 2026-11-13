param(
    [Parameter(Mandatory = $true)][string]$Docx,
    [string]$SaveAs = "",
    [string]$Pdf = ""
)
$ErrorActionPreference = 'Stop'
$app = New-Object -ComObject KWPS.Application
try {
    $app.Visible = $false
    $app.DisplayAlerts = 0
    $doc = $app.Documents.Open($Docx, $false, $false)
    try {
        $pages0 = $doc.ComputeStatistics(2)
        Write-Output ("PAGES_BEFORE=" + $pages0)
        $tocUpdated = $false
        try {
            if ($doc.TablesOfContents.Count -gt 0) {
                $doc.TablesOfContents.Item(1).Update()
                $tocUpdated = $true
                Write-Output "TOC_UPDATED=1"
            } else {
                Write-Output "TOC_COUNT=0"
            }
        } catch {
            Write-Output ("TOC_UPDATE_ERROR=" + $_.Exception.Message)
        }
        if (-not $tocUpdated) {
            try { $doc.Fields.Update() | Out-Null; Write-Output "FIELDS_UPDATED=1" } catch { Write-Output ("FIELDS_UPDATE_ERROR=" + $_.Exception.Message) }
        }
        $doc.Repaginate()
        $pages = $doc.ComputeStatistics(2)
        Write-Output ("PAGES_AFTER=" + $pages)
        if ($SaveAs -ne "") {
            $doc.SaveAs2($SaveAs, 16)
            Write-Output ("SAVED=" + $SaveAs)
        }
        if ($Pdf -ne "") {
            $doc.ExportAsFixedFormat($Pdf, 17)
            Write-Output ("PDF=" + $Pdf)
        }
    } finally {
        $doc.Close(0)
    }
} finally {
    $app.Quit()
    [System.Runtime.InteropServices.Marshal]::ReleaseComObject($app) | Out-Null
}
