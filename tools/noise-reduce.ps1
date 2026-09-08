# noise-reduce.ps1 - 控制台红字降噪渲染（单一权威源）
# ★ 2026-09-08 背景：PS 5.1 host 会把「未捕获的原生命令 / 子 PowerShell / node 的 stderr」
#   一律渲染成红色——git 正常输出、子脚本无害告警（gradle WARNING / npm 提示等）全部被
#   小白用户当成"打包失败"高频误报（详见 KNOWLEDGE.md 第 5 章红/黄字判读口诀）。
#   本模块提供两个函数，供 one-click-pack.ps1 / release-menu.ps1 / entry-selfheal.ps1
#   dot-source 共用（铁律：降噪渲染逻辑禁止内联复制多份）：
#
#   1) Write-HostLine：管道逐行渲染。ErrorRecord（stderr 行）转黄色降噪（内容保留可事后
#      取证），普通行保持白色。用法：
#        & cmd / powershell / node ... 2>&1 | ForEach-Object { Write-HostLine $_ -Indent '  ' }
#
#   2) Invoke-QuietProcess：经 cmd /c "<命令> ... 2>&1" 运行子命令——stderr 在 cmd 层合并进
#      stdout（白色渲染，PS host 不再染红）；返回真实退出码。两种模式：
#        默认（Start-Process 直连控制台）：子进程彩色输出原样保留、实时输出无管道缓冲、
#          stdout 不混入 PS 函数返回值。适合 release-menu（无 transcript）等纯展示链路。
#        -Capture（PS 管道模式）：输出经 Write-HostLine 流经本进程输出流——可被
#          Start-Transcript 捕获落盘（打包日志事后取证铁律），代价是彩色变白色。
#          适合 one-click-pack（有 pack-*.log transcript）内的子脚本调用。
#      用法：
#        $rc = Invoke-QuietProcess -FilePath 'node' -ArgumentList @('script.js','--a')
#        $rc = Invoke-QuietProcess -FilePath 'powershell' -ArgumentList @(...,'-File',$x) -Capture
#
#   注意：真失败（[ERROR]/[FATAL]/打包失败横幅）仍由调用方 Write-Host -ForegroundColor Red
#   显式标红——本模块只消「过程噪声红字」，绝不吞退出码与失败提示。

function Write-HostLine {
    param(
        [Parameter(ValueFromPipeline = $true)]$Line,
        [string]$Indent = ''
    )
    process {
        if ($Line -is [System.Management.Automation.ErrorRecord]) {
            # stderr 行：转黄降噪（保留内容，不吓人；口诀：看结尾横幅不看中途）
            Write-Host ($Indent + $Line.Exception.Message) -ForegroundColor Yellow
        } else {
            Write-Host ($Indent + $Line)
        }
    }
}

function Invoke-QuietProcess {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [string[]]$ArgumentList = @(),
        [switch]$Capture
    )
    if ($Capture) {
        # 管道模式：输出流经本进程（Start-Transcript 可捕获，落盘 pack-*.log 事后取证），
        # stderr 在 cmd 层合并进 stdout 后仅是普通文本行（无红染），Write-HostLine 统一渲染。
        # 含空格的参数补引号防 cmd 断词；退出码取 $LASTEXITCODE（cmd /c 透传子进程退出码）。
        $quoted = ($ArgumentList | ForEach-Object { if ($_ -match '\s') { '"' + $_ + '"' } else { $_ } }) -join ' '
        & $env:ComSpec /c "$FilePath $quoted 2>&1" | ForEach-Object { Write-HostLine $_ }
        return $LASTEXITCODE
    }
    # 直连模式：尾参 2>&1 由 cmd 在子进程外层把 stderr 合并进 stdout（cmd 层渲染白色）；
    # Start-Process -NoNewWindow 直连控制台：彩色输出保留、实时输出无管道缓冲、返回值干净。
    $procArgs = @('/c', $FilePath) + $ArgumentList + @('2>&1')
    $proc = Start-Process -FilePath "$env:ComSpec" -ArgumentList $procArgs -Wait -NoNewWindow -PassThru
    return $proc.ExitCode
}
