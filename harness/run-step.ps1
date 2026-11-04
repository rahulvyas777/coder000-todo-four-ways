# run-step.ps1 - one metered headless session for one step of one client, by the session
# protocol in SERIES-SPEC.md (steps 1 to 7). Windows PowerShell 5.1, ASCII only.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File harness\run-step.ps1 -Client react -Step 0 -Run 1
#       [-BudgetUsd 6.00] [-TimeoutMinutes 30] [-EvidenceDir <folder>] [-RunClaude <run-claude.ps1>]
#
# Paths: clients.json gives the client folder and its e2e folder relative to <fc> (the parent of
# this repo). -EvidenceDir defaults to $env:FC_EVIDENCE, else <fc>\evidence; it receives
# sessions.jsonl and sessions\<client>-sNN-rN.jsonl (+ .verdict.json). -RunClaude defaults to
# $env:FC_RUN_CLAUDE (the coder000 tools/claude-code/run-claude.ps1; it is not part of this repo).
#
# Order of work:
#   1. start the client's API instance if nothing answers on its port; POST /api/admin/reset
#   2. record the pre-step commit (only when the client folder is the root of its own git repo;
#      otherwise every git step is skipped and the line says gitMode "none")
#   3. run run-claude.ps1 in its own process (prompt from prompts\step.txt or retry.txt,
#      --max-budget-usd, --allowedTools from allowed-tools.txt, --disallowedTools from
#      disallowed-tools.txt); after -TimeoutMinutes the process tree is killed: "timeout"
#   -  rate limit (parse-session.js says so, or the result text mentions it): reset to the
#      pre-step commit, append the line with result "rate_limited", exit 3
#   5. record and revert any change under e2e/ or shared/ ("test_edit") - BEFORE the verdict,
#      so the verdict always runs the frozen suite
#   4. independent verdict: npx playwright test --grep "@step00|...|@stepNN" --reporter=json in
#      the client's e2e folder with the variables of e2e\.env.client
#   6. git add -A; git commit (noreply identity), also after a failed run
#   7. append one JSON line to sessions.jsonl
# Exit codes: 0 verdict passed, 1 verdict failed, 3 rate limited, 4 harness error.
[CmdletBinding(PositionalBinding = $false)]
param(
    [Parameter(Mandatory)] [string]$Client,
    [Parameter(Mandatory)] [ValidateRange(0, 14)] [int]$Step,
    [ValidateSet(1, 2)] [int]$Run = 1,
    [double]$BudgetUsd = 6.00,
    [double]$TimeoutMinutes = 30,
    [double]$VerdictTimeoutMinutes = 20,
    [string]$EvidenceDir = '',
    [string]$RunClaude = ''
)
$ErrorActionPreference = 'Continue'
. (Join-Path $PSScriptRoot 'common.ps1')

try {
    $ctx = Get-FcContext
    $cfg = Get-ClientConfig $Client $ctx
    # pathPrefix: a folder under <fc> (the portable Node for react and angular) that the session,
    # the verdict and their child processes see first on PATH. Start-Process inherits it.
    if ($cfg.pathPrefix) { $env:PATH = (Join-Path $ctx.fc $cfg.pathPrefix) + ';' + $env:PATH; Write-Host ("PATH prefix: " + (Join-Path $ctx.fc $cfg.pathPrefix)) }
    $stepInfo = @((Get-Content -LiteralPath (Join-Path $ctx.harness 'steps.json') -Raw | ConvertFrom-Json) | Where-Object { $_.n -eq $Step })[0]
    if (-not $stepInfo) { throw "Step $Step not in steps.json" }
    $NN = '{0:D2}' -f $Step
    $tag = "$Client-s$NN-r$Run"
    $dir = (Resolve-Path -LiteralPath (Join-Path $ctx.fc $cfg.folder)).Path
    $e2e = (Resolve-Path -LiteralPath (Join-Path $ctx.fc $cfg.e2e)).Path
    $runDir = Join-Path $ctx.fc ("run\" + $Client)
    New-Item -ItemType Directory -Force -Path $runDir | Out-Null
    if (-not $EvidenceDir) { $EvidenceDir = $env:FC_EVIDENCE }
    if (-not $EvidenceDir) { $EvidenceDir = Join-Path $ctx.fc 'evidence' }
    $sessionsDir = Join-Path $EvidenceDir 'sessions'
    New-Item -ItemType Directory -Force -Path $sessionsDir | Out-Null
    if (-not $RunClaude) { $RunClaude = $env:FC_RUN_CLAUDE }
    if (-not $RunClaude -or -not (Test-Path -LiteralPath $RunClaude)) { throw 'run-claude.ps1 not found: pass -RunClaude or set FC_RUN_CLAUDE' }
    $flags = @()
    Write-Host "run-step $tag : client $dir, e2e $e2e, evidence $EvidenceDir"

    # 1. API
    $apiState = Start-ClientApi $cfg $ctx
    $reset = Get-HttpCode ("http://localhost:" + $cfg.apiPort + "/api/admin/reset") 'POST'
    if ($reset -ne '204') { throw "API reset answered $reset" }

    # 2. pre-step commit
    $gitMode = 'none'
    $pre = $null
    $top = (& git -C $dir rev-parse --show-toplevel 2>$null)
    if ($LASTEXITCODE -eq 0 -and $top -and ((($top -replace '/', '\').TrimEnd('\')) -ieq $dir.TrimEnd('\'))) {
        $gitMode = 'repo'
        $pre = (& git -C $dir rev-parse HEAD 2>$null)
        if ($LASTEXITCODE -ne 0) { $pre = $null; $gitMode = 'no-commits' }
    }
    if ($gitMode -ne 'repo') { $flags += 'git_skipped'; Write-Host "git: $dir is not the root of its own repository with a commit; git steps skipped" }

    # 3. the session
    $template = if ($Run -eq 1) { 'step.txt' } else { 'retry.txt' }
    $prompt = [IO.File]::ReadAllText((Join-Path $ctx.harness ('prompts\' + $template))).Replace('{NN}', $NN).Replace('{NAME}', $stepInfo.name).Trim()
    $promptFile = Join-Path $runDir ($tag + '.prompt.txt')
    Write-Utf8 $promptFile $prompt
    $allowed = Get-ToolList (Join-Path $ctx.harness 'allowed-tools.txt')
    $disallowed = Get-ToolList (Join-Path $ctx.harness 'disallowed-tools.txt')
    $transcript = Join-Path $runDir ($tag + '.jsonl')
    if (Test-Path -LiteralPath $transcript) { Move-Item -LiteralPath $transcript -Destination ($transcript + '.' + (Get-Date -Format 'yyyyMMddHHmmss') + '.old') }
    $q = { param($s) "'" + ($s -replace "'", "''") + "'" }
    $budgetText = $BudgetUsd.ToString('0.00', [Globalization.CultureInfo]::InvariantCulture)
    $wrapper = Join-Path $runDir ($tag + '.session.ps1')
    $wrapperText = @(
        '$ErrorActionPreference = ''Continue''',
        ('$p = [IO.File]::ReadAllText(' + (& $q $promptFile) + ')'),
        ('$extra = @(''--max-budget-usd'', ''' + $budgetText + ''', ''--allowedTools'', ' + (& $q $allowed) + ', ''--disallowedTools'', ' + (& $q $disallowed) + ')'),
        ('& ' + (& $q $RunClaude) + ' -Dir ' + (& $q $dir) + ' -Prompt $p -Out ' + (& $q $transcript) + ' -Format stream-json @extra')
    ) -join "`r`n"
    Write-Utf8 $wrapper $wrapperText
    $startedAt = Get-Date
    $sw = [Diagnostics.Stopwatch]::StartNew()
    $proc = Start-Process -FilePath 'powershell.exe' -ArgumentList ('-NoProfile -ExecutionPolicy Bypass -File "' + $wrapper + '"') -WindowStyle Hidden -PassThru
    $null = $proc.Handle
    $timedOut = -not $proc.WaitForExit([int]($TimeoutMinutes * 60 * 1000))
    if ($timedOut) {
        & taskkill.exe /PID $proc.Id /T /F | Out-Null
        Add-Content -LiteralPath $transcript -Value ("# killed by run-step.ps1 after $TimeoutMinutes minutes (timeout)") -Encoding UTF8
    }
    $sw.Stop()
    $wallMs = $sw.ElapsedMilliseconds
    $left = Stop-PortListener ([int]$cfg.devPort) $startedAt
    if ($left.Count) { $flags += 'stopped_leftover_dev_server' }
    Write-Host ("session: {0} ms{1}" -f $wallMs, $(if ($timedOut) { ' (timeout)' } else { '' }))

    $parsed = (& node (Join-Path $ctx.harness 'parse-session.js') $transcript | Out-String | ConvertFrom-Json)
    $result = $null
    $testEdit = @()
    $verdictJson = $null
    $verdictExit = $null
    $post = $null

    if ($parsed.rate_limited) {
        $result = 'rate_limited'
        if ($gitMode -eq 'repo') {
            & git -C $dir reset --hard $pre | Out-Host
            & git -C $dir clean -fd -e node_modules -e bin -e obj | Out-Host
        }
    } else {
        # 5. test edits: record, then revert (tracked changes and new untracked files)
        if ($gitMode -eq 'repo') {
            $testEdit = @(& git -C $dir status --porcelain -- e2e shared)
            if ($testEdit.Count) {
                & git -C $dir checkout -- e2e shared 2>$null
                & git -C $dir clean -fd -- e2e shared | Out-Host
            }
        }

        # 4. independent verdict
        $grep = (@(0..$Step) | ForEach-Object { '@step{0:D2}' -f $_ }) -join '|'
        $verdictJson = Join-Path $runDir ($tag + '.verdict.json')
        if (Test-Path -LiteralPath $verdictJson) { Move-Item -LiteralPath $verdictJson -Destination ($verdictJson + '.' + (Get-Date -Format 'yyyyMMddHHmmss') + '.old') }
        $envVars = Read-EnvFile (Join-Path $e2e '.env.client')
        $envVars['PLAYWRIGHT_JSON_OUTPUT_NAME'] = $verdictJson
        $saved = @{}
        foreach ($k in $envVars.Keys) { $saved[$k] = [Environment]::GetEnvironmentVariable($k, 'Process'); [Environment]::SetEnvironmentVariable($k, $envVars[$k], 'Process') }
        $vStart = Get-Date
        $vp = Start-Process -FilePath 'cmd.exe' -ArgumentList ('/c npx playwright test --grep "' + $grep + '" --reporter=json') -WorkingDirectory $e2e `
            -RedirectStandardOutput (Join-Path $runDir ($tag + '.verdict.out.txt')) -RedirectStandardError (Join-Path $runDir ($tag + '.verdict.err.txt')) `
            -WindowStyle Hidden -PassThru
        $null = $vp.Handle
        if (-not $vp.WaitForExit([int]($VerdictTimeoutMinutes * 60 * 1000))) { & taskkill.exe /PID $vp.Id /T /F | Out-Null; $flags += 'verdict_timeout' }
        $verdictExit = $vp.ExitCode
        foreach ($k in $saved.Keys) { [Environment]::SetEnvironmentVariable($k, $saved[$k], 'Process') }
        $left2 = Stop-PortListener ([int]$cfg.devPort) $vStart
        $verdict = (& node (Join-Path $ctx.harness 'runner-helper.js') verdict $verdictJson | Out-String | ConvertFrom-Json)
        Write-Host ("verdict: pass={0} expected={1} unexpected={2} flaky={3} skipped={4}" -f $verdict.ok, $verdict.expected, $verdict.unexpected, $verdict.flaky, $verdict.skipped)

        # subtype/terminal_reason, or an explicit stop message in the text; a session that merely wrote the
        # word "budget" in its summary (angular step 14: "against a 15 s budget") is not a budget stop.
        $budgetHit = (("" + $parsed.result_subtype + ' ' + $parsed.terminal_reason) -match 'budget') -or
            (("" + $parsed.result_text) -match 'max.budget|budget.{0,40}(exceed|reached|limit)|(exceed|reached).{0,40}budget')
        if ($timedOut) { $result = 'timeout' }
        elseif ($budgetHit) { $result = 'budget' }
        elseif ($verdict.ok) { $result = 'pass' }
        else { $result = 'fail' }

        # 6. commit, also after a failed run
        if ($gitMode -eq 'repo') {
            & git -C $dir add -A | Out-Host
            $msg = "step ${NN}: " + $stepInfo.name
            if ($Run -eq 2) { $msg += ' (r2)' }
            & git -C $dir -c user.name=rahulvyas777 -c user.email=rahulvyas777@users.noreply.github.com commit --allow-empty -q -m $msg | Out-Host
            $post = (& git -C $dir rev-parse HEAD)
        }
    }
    $finishedAt = Get-Date

    # 7. the line
    $facts = [ordered]@{
        client = $Client; step = $Step; stepName = $stepInfo.name; run = $Run; tag = $tag; result = $result; flags = $flags
        startedAt = $startedAt.ToUniversalTime().ToString('o'); finishedAt = $finishedAt.ToUniversalTime().ToString('o')
        wallMs = $wallMs; timedOut = $timedOut; transcript = $transcript; verdictJson = $verdictJson; verdictExit = $verdictExit
        gitDir = $dir; gitMode = $gitMode; preCommit = $pre; postCommit = $post; testEdit = @($testEdit)
        budgetUsd = $BudgetUsd; timeoutMinutes = $TimeoutMinutes; allowedTools = $allowed; disallowedTools = $disallowed
        apiState = $apiState; fcRoot = $ctx.fc
    }
    $factsFile = Join-Path $runDir ($tag + '.facts.json')
    Write-Utf8 $factsFile ($facts | ConvertTo-Json -Depth 5)
    $line = (& node (Join-Path $ctx.harness 'runner-helper.js') line $factsFile | Out-String).Trim()
    if (-not $line.StartsWith('{')) { throw "runner-helper line failed: $line" }
    Add-Utf8Line (Join-Path $EvidenceDir 'sessions.jsonl') $line
    Write-Utf8 (Join-Path $runDir 'last-line.json') $line
    Copy-Item -LiteralPath $transcript -Destination (Join-Path $sessionsDir ($tag + '.jsonl')) -Force
    if ($verdictJson -and (Test-Path -LiteralPath $verdictJson)) { Copy-Item -LiteralPath $verdictJson -Destination (Join-Path $sessionsDir ($tag + '.verdict.json')) -Force }
    Write-Host ("run-step {0}: {1}" -f $tag, $result)

    if ($result -eq 'rate_limited') { exit 3 }
    if ($verdict -and $verdict.ok) { exit 0 }
    exit 1
} catch {
    Write-Host ("run-step harness error: " + $_.Exception.Message)
    exit 4
}
