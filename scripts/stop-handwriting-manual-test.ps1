[CmdletBinding()]
param(
    [string]$Ref = 'main'
)

$ErrorActionPreference = 'Stop'
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$CliPath = Join-Path $RepoRoot 'scripts/handwriting-manual-test.mjs'

if (-not (Get-Command 'node' -ErrorAction SilentlyContinue)) {
    throw 'Node.js is required.'
}

& node $CliPath 'stop' '--ref' $Ref
exit $LASTEXITCODE
