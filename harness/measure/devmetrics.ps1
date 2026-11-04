# devmetrics.ps1 - developer metrics for one client (Windows PowerShell 5.1, ASCII only).
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File devmetrics.ps1 -Client <folder> -Kind dotnet|npm
#       -BuildCommand "<cmd>" [-DevCommand "<cmd>" -DevUrl http://localhost:160x1/] -Out <file.json>
#       [-Runs 3] [-Project <csproj>] [-TrashDir <folder>] [-ClocVersion 2.10.0] [-KeepTrash]
#
# 1. Cold production builds (-Runs, default 3): before each one the folders bin, obj, dist,
#    publish, .angular and node_modules\.vite are MOVED (not deleted) into the trash folder, then
#    the build command runs through cmd.exe in the client folder; wall time per run.
#    MSBuild node reuse and the dotnet build servers are left as they are (a developer's second
#    build gets them too); say so when reporting.
# 2. Dev server start (-Runs): start -DevCommand, poll -DevUrl until HTTP 200 (or -DevTimeoutSec),
#    record the time, kill that process tree (taskkill /T on the cmd.exe this script started).
# 3. Lines of code: cloc via npx (version recorded; cloc needs perl, Git for Windows' perl is put
#    on PATH for that one call when none is found) plus the helper's own non-blank line count.
#    Excluded: node_modules bin obj dist .angular e2e shared publish wwwroot/lib Migrations,
#    lock files, *.Designer.cs.
# 4. Dependencies: npm: direct (package.json) and total (npm ls --all --json, unique name@version);
#    dotnet: dotnet list package --include-transitive --format json.
# 5. Size: node_modules on disk (npm) or the restored NuGet packages listed in obj\project.assets.json.
# The trash folder (default: <fc>\run\_trash, where <fc> is three folders above this script) is deleted at the end unless -KeepTrash; the script
# refuses to delete anything whose path does not contain \run\.
[CmdletBinding(PositionalBinding = $false)]
param(
    [Parameter(Mandatory)] [string]$Client,
    [Parameter(Mandatory)] [ValidateSet('dotnet', 'npm')] [string]$Kind,
    [Parameter(Mandatory)] [string]$BuildCommand,
    [string]$DevCommand = '',
    [string]$DevUrl = '',
    [string]$Out = '',
    [int]$Runs = 3,
    [string]$Project = '',
    [string]$TrashDir = '',
    [string]$ClocVersion = '2.10.0',
    [int]$DevTimeoutSec = 180,
    [switch]$KeepTrash
)
$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
$helper = Join-Path $here 'devmetrics-helper.js'
$clientFull = (Resolve-Path -LiteralPath $Client).Path
if (-not $TrashDir) {
    # This script sits in <fc>\repo\harness\measure; the trash goes to <fc>\run\_trash.
    $fcRoot = Split-Path (Split-Path (Split-Path $here -Parent) -Parent) -Parent
    $TrashDir = Join-Path $fcRoot 'run\_trash'
}
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$work = Join-Path $TrashDir ("devmetrics-" + (Split-Path $clientFull -Leaf) + "-" + $stamp)
New-Item -ItemType Directory -Force -Path $work | Out-Null

function Invoke-Cmd([string]$commandLine, [string]$logName) {
    $log = Join-Path $work ($logName + '.out.txt')
    $err = Join-Path $work ($logName + '.err.txt')
    # Not -Wait: Start-Process -Wait also waits for every descendant, and dotnet leaves MSBuild
    # and compiler server processes running after the build.
    $p = Start-Process -FilePath 'cmd.exe' -ArgumentList ('/c ' + $commandLine) -WorkingDirectory $clientFull `
        -RedirectStandardOutput $log -RedirectStandardError $err -NoNewWindow -PassThru
    $null = $p.Handle   # keeps ExitCode readable after the wait
    $p.WaitForExit()
    return @{ exitCode = $p.ExitCode; out = $log; err = $err }
}

function Invoke-Helper([string[]]$helperArgs) {
    $txt = & node $helper @helperArgs
    if ($LASTEXITCODE -ne 0) { return $null }
    return ($txt | Out-String | ConvertFrom-Json)
}

function Move-BuildOutputs([int]$run) {
    $names = @('bin', 'obj', 'dist', 'publish', '.angular')
    $skip = @('node_modules', 'e2e', 'shared', '.git')
    $moved = @()
    $dest = Join-Path $work ("cold-" + $run)
    $queue = New-Object System.Collections.Queue
    $queue.Enqueue(@($clientFull, 0))
    while ($queue.Count -gt 0) {
        $item = $queue.Dequeue()
        $dir = $item[0]; $depth = $item[1]
        foreach ($d in (Get-ChildItem -LiteralPath $dir -Directory -Force -ErrorAction SilentlyContinue)) {
            if ($skip -contains $d.Name) { continue }
            if ($names -contains $d.Name) {
                $rel = $d.FullName.Substring($clientFull.Length).TrimStart('\') -replace '[\\/]', '__'
                New-Item -ItemType Directory -Force -Path $dest | Out-Null
                Move-Item -LiteralPath $d.FullName -Destination (Join-Path $dest $rel)
                $moved += ($d.FullName.Substring($clientFull.Length).TrimStart('\'))
            } elseif ($depth -lt 3) {
                $queue.Enqueue(@($d.FullName, ($depth + 1)))
            }
        }
    }
    foreach ($v in @('node_modules\.vite', 'node_modules\.vite-temp')) {
        $p = Join-Path $clientFull $v
        if (Test-Path -LiteralPath $p) {
            New-Item -ItemType Directory -Force -Path $dest | Out-Null
            Move-Item -LiteralPath $p -Destination (Join-Path $dest ($v -replace '[\\/]', '__'))
            $moved += $v
        }
    }
    return , $moved
}

function Get-HttpCode([string]$url) {
    $code = & curl.exe -s -o NUL -m 2 -w "%{http_code}" $url
    return "$code"
}

$result = [ordered]@{
    meta = [ordered]@{
        script = 'devmetrics.ps1'
        timestamp = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
        client = (Split-Path $clientFull -Leaf)
        kind = $Kind
        buildCommand = $BuildCommand
        devCommand = $DevCommand
        devUrl = $DevUrl
        runs = $Runs
        node = (& node --version)
        dotnet = (& dotnet --version)
        npm = (& cmd.exe /c 'npm --version')
        os = [Environment]::OSVersion.VersionString
    }
}

# 1. cold builds
$builds = @()
for ($i = 1; $i -le $Runs; $i++) {
    $moved = Move-BuildOutputs $i
    $sw = [Diagnostics.Stopwatch]::StartNew()
    $r = Invoke-Cmd $BuildCommand ("build-" + $i)
    $sw.Stop()
    $builds += [ordered]@{ run = $i; ms = $sw.ElapsedMilliseconds; exitCode = $r.exitCode; moved = $moved }
    Write-Host ("build {0}: {1} ms, exit {2}" -f $i, $sw.ElapsedMilliseconds, $r.exitCode)
}
$result.builds = $builds

# 2. dev server start to first 200
$devRuns = @()
if ($DevCommand -and $DevUrl) {
    for ($i = 1; $i -le $Runs; $i++) {
        if ((Get-HttpCode $DevUrl) -ne '000') {
            $devRuns += [ordered]@{ run = $i; error = 'something already answers on DevUrl; not started' }
            break
        }
        $log = Join-Path $work ("dev-" + $i + ".out.txt")
        $err = Join-Path $work ("dev-" + $i + ".err.txt")
        $sw = [Diagnostics.Stopwatch]::StartNew()
        $p = Start-Process -FilePath 'cmd.exe' -ArgumentList ('/c ' + $DevCommand) -WorkingDirectory $clientFull `
            -RedirectStandardOutput $log -RedirectStandardError $err -NoNewWindow -PassThru
        $code = '000'
        while ($sw.Elapsed.TotalSeconds -lt $DevTimeoutSec) {
            $code = Get-HttpCode $DevUrl
            if ($code -eq '200') { break }
            if ($p.HasExited) { break }
            Start-Sleep -Milliseconds 200
        }
        $ms = $sw.ElapsedMilliseconds
        & taskkill.exe /PID $p.Id /T /F | Out-Null
        for ($w = 0; $w -lt 50; $w++) { if ((Get-HttpCode $DevUrl) -eq '000') { break }; Start-Sleep -Milliseconds 200 }
        $entry = [ordered]@{ run = $i; ms = $(if ($code -eq '200') { $ms } else { $null }); lastStatus = $code }
        $devRuns += $entry
        Write-Host ("dev {0}: {1} ms, status {2}" -f $i, $ms, $code)
    }
}
$result.devServer = $devRuns

# 3. lines of code
$clocJson = Join-Path $work 'cloc.json'
$savedPath = $env:PATH
$perl = Get-Command perl -ErrorAction SilentlyContinue
$gitPerlDir = Join-Path $env:ProgramFiles 'Git\usr\bin'
$perlNote = 'perl on PATH'
if (-not $perl) {
    if (Test-Path -LiteralPath (Join-Path $gitPerlDir 'perl.exe')) { $env:PATH = $env:PATH + ';' + $gitPerlDir; $perlNote = 'Git for Windows perl appended to PATH for this call' }
    else { $perlNote = 'no perl found' }
}
$clocCmd = 'npx -y cloc@' + $ClocVersion + ' --json --quiet --exclude-dir=node_modules,bin,obj,dist,.angular,e2e,shared,publish,.git,.vs,test-results,playwright-report --not-match-f="(package-lock\.json|\.Designer\.cs|\.br|\.gz)$" --fullpath --not-match-d="(wwwroot.lib|Migrations)" .'
$cr = Invoke-Cmd $clocCmd 'cloc'
$env:PATH = $savedPath
$cloc = $null
Copy-Item -LiteralPath $cr.out -Destination $clocJson -Force
if ((Get-Item -LiteralPath $clocJson).Length -gt 0) { $cloc = Invoke-Helper @('cloc', $clocJson) }
$result.cloc = [ordered]@{ version = $ClocVersion; exitCode = $cr.exitCode; perl = $perlNote; summary = $cloc }
$result.loc = Invoke-Helper @('loc', $clientFull)

# 4 and 5. dependencies and sizes
if ($Kind -eq 'npm') {
    $ls = Join-Path $work 'npm-ls.json'
    $lr = Invoke-Cmd 'npm ls --all --json' 'npm-ls'
    Copy-Item -LiteralPath $lr.out -Destination $ls -Force
    $result.dependencies = Invoke-Helper @('npmdeps', (Join-Path $clientFull 'package.json'), $ls)
    $result.restoreSize = Invoke-Helper @('dirsize', (Join-Path $clientFull 'node_modules'))
    $result.restoreSize | Add-Member -NotePropertyName what -NotePropertyValue 'node_modules on disk'
} else {
    if (-not $Project) {
        $proj = @(Get-ChildItem -LiteralPath $clientFull -Filter *.csproj -File)
        if ($proj.Count -ne 1) { throw "Pass -Project: found $($proj.Count) csproj files in the client folder" }
        $Project = $proj[0].FullName
    }
    $pl = Join-Path $work 'dotnet-list.json'
    $dr = Invoke-Cmd ('dotnet list "' + $Project + '" package --include-transitive --format json') 'dotnet-list'
    Copy-Item -LiteralPath $dr.out -Destination $pl -Force
    $result.dependencies = Invoke-Helper @('dotnetdeps', $pl)
    $assets = Join-Path (Split-Path $Project -Parent) 'obj\project.assets.json'
    if (Test-Path -LiteralPath $assets) {
        $result.restoreSize = Invoke-Helper @('nugetsize', $assets)
        $result.restoreSize | Add-Member -NotePropertyName what -NotePropertyValue 'restored NuGet packages (sum of package folders)'
    } else {
        $result.restoreSize = [ordered]@{ error = 'obj\project.assets.json not found (did the build restore?)' }
    }
}

$medianOf = {
    param($values)
    $v = @($values | Where-Object { $_ -ne $null } | Sort-Object)
    if ($v.Count -eq 0) { return $null }
    $mid = [math]::Floor($v.Count / 2)
    if ($v.Count % 2 -eq 1) { return $v[$mid] } else { return ($v[$mid - 1] + $v[$mid]) / 2 }
}
$result.summary = [ordered]@{
    buildMsMedian = (& $medianOf ($builds | ForEach-Object { if ($_.exitCode -eq 0) { $_.ms } }))
    buildsFailed = @($builds | Where-Object { $_.exitCode -ne 0 }).Count
    devStartMsMedian = (& $medianOf ($devRuns | ForEach-Object { $_.ms }))
}

$json = $result | ConvertTo-Json -Depth 10
if ($Out) { [IO.File]::WriteAllText($Out, $json, (New-Object Text.UTF8Encoding $false)) }
Write-Host ("devmetrics {0}: build median {1} ms ({2} failed), dev start median {3} ms, loc {4} non-blank lines in {5} files, deps {6}" -f `
    $result.meta.client, $result.summary.buildMsMedian, $result.summary.buildsFailed, $result.summary.devStartMsMedian, `
    $result.loc.nonBlankLines, $result.loc.sourceFiles, ($result.dependencies | ConvertTo-Json -Compress -Depth 3))

if (-not $KeepTrash) {
    if ($work -match '\\run\\') { Remove-Item -LiteralPath $work -Recurse -Force }
    else { Write-Host "Trash folder kept (path has no \run\): $work" }
}
