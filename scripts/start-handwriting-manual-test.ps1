[CmdletBinding()]
param(
    [switch]$PreflightOnly,
    [string]$Ref = 'main'
)

$ErrorActionPreference = 'Stop'
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$CliPath = Join-Path $RepoRoot 'scripts/handwriting-manual-test.mjs'

if (-not (Get-Command 'node' -ErrorAction SilentlyContinue)) {
    throw 'Node.js is required.'
}

$commandName = if ($PreflightOnly) { 'preflight' } else { 'start' }
& node $CliPath $commandName '--ref' $Ref
exit $LASTEXITCODE
