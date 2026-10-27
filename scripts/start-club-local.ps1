$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')
. (Join-Path $PSScriptRoot 'env.ps1')
node (Join-Path $PSScriptRoot 'start-club-local.mjs')
exit $LASTEXITCODE
