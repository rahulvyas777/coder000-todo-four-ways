# common.ps1 - shared functions for run-step.ps1 and run-client.ps1 (dot-source it).
# Windows PowerShell 5.1, ASCII only. Layout: <fc>\repo\harness\common.ps1, clients and run
# folders are siblings of repo under <fc>.

function Get-FcContext {
    $harness = $PSScriptRoot
    $repo = Split-Path $harness -Parent
    $fc = Split-Path $repo -Parent
    return @{ harness = $harness; repo = $repo; fc = $fc }
}

function Get-ClientConfig([string]$name, $ctx) {
    # FC_CLIENTS may point to another clients.json (used by the harness self-test).
    $file = if ($env:FC_CLIENTS) { $env:FC_CLIENTS } else { Join-Path $ctx.harness 'clients.json' }
    $all = (Get-Content -LiteralPath $file -Raw | ConvertFrom-Json).clients
    $c = @($all | Where-Object { $_.name -eq $name })
    if ($c.Count -ne 1) { throw "Unknown client '$name' (clients.json has: $(($all | ForEach-Object { $_.name }) -join ', '))" }
    return $c[0]
}

function Get-ToolList([string]$file) {
    $lines = Get-Content -LiteralPath $file | ForEach-Object { $_.Trim() } | Where-Object { $_ -and -not $_.StartsWith('#') }
    return (@($lines) -join ',')
}

function Get-HttpCode([string]$url, [string]$method = 'GET') {
    if ($method -eq 'GET') { $code = & curl.exe -s -o NUL -m 10 -w "%{http_code}" $url }
    else { $code = & curl.exe -s -o NUL -m 30 -X $method -w "%{http_code}" $url }
    return "$code"
}

function Write-Utf8([string]$path, [string]$text) {
    [IO.File]::WriteAllText($path, $text, (New-Object Text.UTF8Encoding $false))
}

function Add-Utf8Line([string]$path, [string]$line) {
    $m = New-Object Threading.Mutex($false, 'fc-sessions-jsonl')
    [void]$m.WaitOne()
    try { [IO.File]::AppendAllText($path, $line + "`n", (New-Object Text.UTF8Encoding $false)) }
    finally { $m.ReleaseMutex(); $m.Dispose() }
}

# Builds the API once into <fc>\run\_api (Release) and starts one instance for the client on
# localhost:<apiPort> with <fc>\run\<client>\data.db, unless something already answers there.
# The built DLL is run directly (not dotnet run) so that parallel clients never build the same
# project at the same time. The instance is left running.
function Start-ClientApi($cfg, $ctx, [switch]$Rebuild) {
    $port = $cfg.apiPort
    if ((Get-HttpCode "http://localhost:$port/api/lists") -eq '200') { return 'running' }
    $binDir = Join-Path $ctx.fc 'run\_api'
    $dll = Join-Path $binDir 'TasksApi.dll'
    $m = New-Object Threading.Mutex($false, 'fc-api-build')
    [void]$m.WaitOne()
    try {
        if ($Rebuild -or -not (Test-Path -LiteralPath $dll)) {
            $proj = Join-Path $ctx.repo 'api\TasksApi.csproj'
            & dotnet build $proj -c Release -o $binDir --nologo -v q | Out-Host
            if ($LASTEXITCODE -ne 0) { throw "API build failed (exit $LASTEXITCODE)" }
        }
    } finally { $m.ReleaseMutex(); $m.Dispose() }
    $runDir = Join-Path $ctx.fc ("run\" + $cfg.name)
    New-Item -ItemType Directory -Force -Path $runDir | Out-Null
    $db = Join-Path $runDir 'data.db'
    $p = Start-Process -FilePath 'dotnet' -ArgumentList ('"' + $dll + '" --urls http://localhost:' + $port + ' --db "' + $db + '"') `
        -WorkingDirectory $binDir -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput (Join-Path $runDir 'api.log') -RedirectStandardError (Join-Path $runDir 'api.err.log')
    Write-Utf8 (Join-Path $runDir 'api.pid') ("" + $p.Id)
    for ($i = 0; $i -lt 120; $i++) {
        if ((Get-HttpCode "http://localhost:$port/api/lists") -eq '200') { return 'started' }
        if ($p.HasExited) { throw "API exited early (see $runDir\api.err.log)" }
        Start-Sleep -Milliseconds 500
    }
    throw "API did not answer on port $port within 60 s"
}

# Stops whatever listens on a port, but only a process that started after $since (i.e. one this
# run started, directly or through the session). Returns the stopped process ids.
function Stop-PortListener([int]$port, [datetime]$since) {
    $stopped = @()
    $conns = @(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)
    foreach ($c in $conns) {
        $proc = Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue
        if ($proc -and $proc.StartTime -ge $since) {
            & taskkill.exe /PID $proc.Id /T /F | Out-Null
            $stopped += $proc.Id
        }
    }
    return , $stopped
}

function Read-EnvFile([string]$file) {
    $vars = @{}
    if (-not (Test-Path -LiteralPath $file)) { return $vars }
    foreach ($l in (Get-Content -LiteralPath $file)) {
        $t = $l.Trim()
        if (-not $t -or $t.StartsWith('#')) { continue }
        $i = $t.IndexOf('=')
        if ($i -lt 1) { continue }
        $k = $t.Substring(0, $i).Trim()
        $v = $t.Substring($i + 1).Trim()
        if ($v.Length -ge 2 -and (($v.StartsWith('"') -and $v.EndsWith('"')) -or ($v.StartsWith("'") -and $v.EndsWith("'")))) { $v = $v.Substring(1, $v.Length - 2) }
        $vars[$k] = $v
    }
    return $vars
}
