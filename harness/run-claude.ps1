# Runs one headless Claude Code session the way a reader would run it: a plain terminal with
# none of the desktop app's variables, no user-level settings or instruction files, no saved
# session, no auto memory, and only the MCP servers named on the command line.
#
# Usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File run-claude.ps1 -Dir <folder> -Prompt <text>
#       [-Out <file>] [-Model <id>] [-Format stream-json|json|text] [extra claude arguments ...]
#
# The exact claude command line is written at the top of -Out, so the evidence file records
# what was run. The model stays on Opus 5.5 (site rule: never Sonnet or Haiku), which needs
# Claude Code 2.1.280 or newer; on 2.1.123 the alias "opus" resolved to an older model.
[CmdletBinding(PositionalBinding = $false)]   # extra claude arguments must never bind to -Out/-Model/-Format
param(
    [Parameter(Mandatory)] [string]$Dir,
    [Parameter(Mandatory)] [string]$Prompt,
    [string]$Out = '',
    [string]$Model = 'claude-opus-5-5',
    [string]$Format = 'stream-json',
    [Parameter(ValueFromRemainingArguments)] [string[]]$Extra = @()
)
Get-ChildItem Env: | Where-Object { $_.Name -match '^(CLAUDE|ANTHROPIC)' } | ForEach-Object {
    [Environment]::SetEnvironmentVariable($_.Name, $null, 'Process')
}
$env:CLAUDE_CODE_DISABLE_AUTO_MEMORY = '1'
# Background housekeeping calls go to the same model as the session (site rule: no Haiku).
$env:ANTHROPIC_DEFAULT_HAIKU_MODEL = $Model
$env:ANTHROPIC_SMALL_FAST_MODEL = $Model
# The user-level CLAUDE.md and rules load in every session whatever --setting-sources says, so
# they are excluded by path. The settings file lives outside the working folder, and its
# content (a home-directory path) is never published.
$userDir = ($env:USERPROFILE -replace '\\', '/') + '/.claude'
$isolation = Join-Path $env:TEMP ("cc-isolation-{0}.json" -f [guid]::NewGuid().ToString('N'))
'{ "claudeMdExcludes": ["' + $userDir + '/CLAUDE.md", "' + $userDir + '/rules/**"] }' |
    Out-File -FilePath $isolation -Encoding ascii
Set-Location -LiteralPath $Dir
$claudeArgs = @('-p', $Prompt, '--model', $Model, '--setting-sources', 'project,local',
                '--settings', $isolation,
                '--no-session-persistence', '--strict-mcp-config', '--output-format', $Format) + $Extra
if ($Format -eq 'stream-json') { $claudeArgs += '--verbose' }
$shown = 'claude ' + (($claudeArgs | ForEach-Object {
    if ($_ -eq $isolation) { '<isolation settings file>' } elseif ($_ -match '\s') { '"' + $_ + '"' } else { $_ }
}) -join ' ')
if ($Out) {
    "# cwd: $Dir" | Out-File -FilePath $Out -Encoding utf8
    "# $shown" | Out-File -FilePath $Out -Append -Encoding utf8
    & claude @claudeArgs 2>&1 | Out-File -FilePath $Out -Append -Encoding utf8
    "# exit code $LASTEXITCODE" | Out-File -FilePath $Out -Append -Encoding utf8
} else {
    $shown
    & claude @claudeArgs
    "exit code $LASTEXITCODE"
}
[IO.File]::Delete($isolation)
