# run-client.ps1 - runs the steps of one client in order through run-step.ps1.
# Windows PowerShell 5.1, ASCII only.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File harness\run-client.ps1 -Client react [-From 0] [-To 14]
#       [-BudgetUsd 6.00] [-TimeoutMinutes 30] [-EvidenceDir <folder>] [-RunClaude <run-claude.ps1>]
#       [-WeeklyPause 0.75]
#
# Per step: run 1; when its verdict fails (fail, timeout or budget with failing tests) one retry
# (run 2, retry prompt). When run 2 also fails: <fc>\run\<client>\status.json gets
# state "needs_hand_fix" with the step and the failing test names, exit 2 (the supervising
# agent fixes by hand, commits "step NN: hand fix", and restarts with -From <next step>).
# Exit 3 from run-step (rate limited): sleep until the reset time the rate-limit event gave
# (or 30 minutes when it gave none), then run the same step and run number again.
# After every step: if the seven-day utilisation in the last rate_limit_event is at or above
# -WeeklyPause, status "paused_weekly", exit 5. When the last step passes: status "done", exit 0.
# The client's API instance is started when nothing answers on its port and is left running.
[CmdletBinding(PositionalBinding = $false)]
param(
    [Parameter(Mandatory)] [string]$Client,
    [ValidateRange(0, 14)] [int]$From = 0,
    [ValidateRange(0, 14)] [int]$To = 14,
    [double]$BudgetUsd = 6.00,
    [double]$TimeoutMinutes = 30,
    [string]$EvidenceDir = '',
    [string]$RunClaude = '',
    [double]$WeeklyPause = 0.75,
    [int]$DefaultWaitMinutes = 30
)
$ErrorActionPreference = 'Continue'
. (Join-Path $PSScriptRoot 'common.ps1')
$ctx = Get-FcContext
$cfg = Get-ClientConfig $Client $ctx
$runDir = Join-Path $ctx.fc ("run\" + $Client)
New-Item -ItemType Directory -Force -Path $runDir | Out-Null
$statusFile = Join-Path $runDir 'status.json'

function Set-Status($obj) {
    $obj['client'] = $Client
    $obj['at'] = (Get-Date).ToUniversalTime().ToString('o')
    Write-Utf8 $statusFile (($obj | ConvertTo-Json -Depth 6))
}

function Get-LastLine {
    $f = Join-Path $runDir 'last-line.json'
    if (-not (Test-Path -LiteralPath $f)) { return $null }
    return (Get-Content -LiteralPath $f -Raw | ConvertFrom-Json)
}

$apiState = Start-ClientApi $cfg $ctx
Write-Host "run-client $Client : API $apiState on port $($cfg.apiPort); steps $From to $To"

$stepScript = Join-Path $ctx.harness 'run-step.ps1'
for ($n = $From; $n -le $To; $n++) {
    $run = 1
    while ($true) {
        Set-Status ([ordered]@{ state = 'running'; step = $n; run = $run })
        $argList = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $stepScript, '-Client', $Client, '-Step', $n, '-Run', $run,
            '-BudgetUsd', $BudgetUsd.ToString([Globalization.CultureInfo]::InvariantCulture),
            '-TimeoutMinutes', $TimeoutMinutes.ToString([Globalization.CultureInfo]::InvariantCulture))
        if ($EvidenceDir) { $argList += @('-EvidenceDir', $EvidenceDir) }
        if ($RunClaude) { $argList += @('-RunClaude', $RunClaude) }
        & powershell.exe @argList
        $code = $LASTEXITCODE
        $last = Get-LastLine
        if ($code -eq 3) {
            $wait = $DefaultWaitMinutes * 60
            if ($last -and $last.rate_limit -and $last.rate_limit.resets_at) {
                $resetAt = [DateTimeOffset]::FromUnixTimeSeconds([int64]$last.rate_limit.resets_at).UtcDateTime
                $secs = [int](($resetAt - (Get-Date).ToUniversalTime()).TotalSeconds) + 60
                if ($secs -gt 0) { $wait = $secs }
            }
            Set-Status ([ordered]@{ state = 'rate_limited'; step = $n; run = $run; sleepSeconds = $wait })
            Write-Host "rate limited at step $n run $run; sleeping $wait s"
            Start-Sleep -Seconds $wait
            continue
        }
        if ($code -eq 4 -or $code -lt 0 -or $code -gt 4) {
            Set-Status ([ordered]@{ state = 'harness_error'; step = $n; run = $run; exitCode = $code })
            exit 4
        }
        if ($code -eq 0) { break }
        if ($run -eq 1) { $run = 2; continue }
        $failing = @()
        if ($last -and $last.verdict) { $failing = @($last.verdict.failing | ForEach-Object { $_.title }) }
        Set-Status ([ordered]@{ state = 'needs_hand_fix'; step = $n; run = $run; failing = $failing })
        Write-Host "step $n failed twice; needs a hand fix"
        exit 2
    }
    $last = Get-LastLine
    if ($last -and $last.rate_limit -and $last.rate_limit.windows -and $last.rate_limit.windows.seven_day) {
        $u = [double]$last.rate_limit.windows.seven_day.utilization
        if ($u -ge $WeeklyPause) {
            Set-Status ([ordered]@{ state = 'paused_weekly'; step = $n; sevenDayUtilization = $u })
            Write-Host "seven-day utilisation $u at or above $WeeklyPause; pausing"
            exit 5
        }
    }
}
Set-Status ([ordered]@{ state = 'done'; step = $To })
Write-Host "run-client $Client : done"
exit 0
