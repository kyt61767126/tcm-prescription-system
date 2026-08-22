# ============================================================================
# build-lock.ps1 - Global build mutex (prevents concurrent builds)
#
# WHY (KNOWLEDGE 2.49, 2026-08-23): a cloud desktop build and a cloud APP build
# running at the same time collided on shared files (obfuscate.js rewriting
# cloud_desktop sources, node_modules, git index, electron-builder cache).
# The desktop build died mid-way -> dist left EMPTY, artifacts lost.
#
# USAGE:
#   powershell -File tools\build-lock.ps1 acquire -LockPath <file> -Owner <tag>
#       exit 0 = lock acquired (or stale lock taken over)
#       exit 2 = another build is running (caller must abort)
#   powershell -File tools\build-lock.ps1 release -LockPath <file> -Owner <tag>
#       exit 0 = released (idempotent: missing lock is also 0)
#
# STALE LOCK POLICY ("prefer missing detection over false blocking"):
#   A lock is considered STALE (takeover allowed) when EITHER:
#     - the PID recorded in the lock no longer exists, OR
#     - the lock is older than -StaleMinutes (default 45)
#   If a stale takeover happens, a takeover notice is printed.
# ============================================================================

param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('acquire', 'release')]
    [string]$Action,

    [Parameter(Mandatory = $true)]
    [string]$LockPath,

    [string]$Owner = 'unknown',

    [int]$StaleMinutes = 45
)

$ErrorActionPreference = 'Stop'

function Read-LockContent([string]$path) {
    $map = @{}
    if (-not (Test-Path -LiteralPath $path)) { return $null }
    foreach ($line in [System.IO.File]::ReadAllLines($path)) {
        $idx = $line.IndexOf('=')
        if ($idx -gt 0) {
            $map[$line.Substring(0, $idx)] = $line.Substring($idx + 1)
        }
    }
    return $map
}

if ($Action -eq 'acquire') {
    $existing = Read-LockContent $LockPath

    # Record the CALLER's PID (the cmd.exe running the build script), not this
    # short-lived powershell PID. When the build cmd exits (finish OR crash),
    # the recorded PID dies -> lock auto-detected as stale next run.
    $callerPid = $PID
    try {
        $callerPid = (Get-CimInstance Win32_Process -Filter "ProcessId=$PID").ParentProcessId
        if (-not $callerPid) { $callerPid = $PID }
    } catch { $callerPid = $PID }

    # REENTRANT (must run BEFORE the BUSY check): same cmd chain re-acquiring
    # (build-pack.bat -> build-app.bat run in ONE cmd process via `call`).
    # If the lock is held by our own PID, pass through WITHOUT touching it:
    # the chain entry owns the lock and the chain entry's release
    # (owner-checked) is what finally removes it.
    if ($null -ne $existing) {
        $reentrantPid = 0
        [int]::TryParse($existing['pid'], [ref]$reentrantPid) | Out-Null
        if ($reentrantPid -eq $callerPid) {
            Write-Host ("[BUILD-LOCK] Reentrant acquire by {0} (chain pid={1}, held by {2})" -f $Owner, $callerPid, $existing['owner'])
            exit 0
        }
    }

    if ($null -ne $existing) {
        $lockPid = 0
        [int]::TryParse($existing['pid'], [ref]$lockPid) | Out-Null
        $lockAge = [TimeSpan]::Zero
        $started = [datetime]::MinValue
        if ([datetime]::TryParse($existing['started'], [ref]$started)) {
            $lockAge = (Get-Date) - $started
        }

        $pidAlive = $false
        if ($lockPid -gt 0) {
            $pidAlive = [bool](Get-Process -Id $lockPid -ErrorAction SilentlyContinue)
        }

        $isStale = (-not $pidAlive) -or ($lockAge.TotalMinutes -gt $StaleMinutes)

        if (-not $isStale) {
            Write-Host ("[BUILD-LOCK] BUSY: another build is running (owner={0}, pid={1}, age={2:n0} min)" -f $existing['owner'], $lockPid, $lockAge.TotalMinutes)
            Write-Host ("[BUILD-LOCK] Wait for it to finish, then retry. If you are SURE nothing is building, delete: {0}" -f $LockPath)
            exit 2
        }

        Write-Host ("[BUILD-LOCK] Stale lock taken over (owner={0}, pid={1}, alive={2}, age={3:n0} min)" -f $existing['owner'], $lockPid, $pidAlive, $lockAge.TotalMinutes)
    }

    $dir = Split-Path $LockPath -Parent
    if ($dir -and -not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }

    $content = @(
        "owner=$Owner",
        "pid=$callerPid",
        ("started={0}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'))
    ) -join "`r`n"
    [System.IO.File]::WriteAllText($LockPath, $content)
    Write-Host ("[BUILD-LOCK] Acquired by {0} (cmd pid={1})" -f $Owner, $callerPid)
    exit 0
}

if ($Action -eq 'release') {
    if (Test-Path -LiteralPath $LockPath) {
        $existing = Read-LockContent $LockPath
        if ($null -ne $existing -and $existing['owner'] -ne $Owner) {
            # Not ours - leave it alone (another build may own it after a takeover)
            Write-Host ("[BUILD-LOCK] Skip release: lock owned by {0}, not {1}" -f $existing['owner'], $Owner)
            exit 0
        }
        Remove-Item -LiteralPath $LockPath -Force -ErrorAction SilentlyContinue
        Write-Host ("[BUILD-LOCK] Released by {0}" -f $Owner)
    }
    exit 0
}
