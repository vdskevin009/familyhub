param([string]$DataDirectory = (Join-Path $env:USERPROFILE '.familyhub-worker'))
$ErrorActionPreference = 'Stop'
$env:FAMILYHUB_WORKER_DATA = [IO.Path]::GetFullPath($DataDirectory)
$entry = Join-Path $PSScriptRoot '../apps/worker/dist/connect-gmail.js'
if (-not (Test-Path -LiteralPath $entry)) { throw 'Build the worker first: npm run build:worker' }
New-Item -ItemType Directory -Force -Path $env:FAMILYHUB_WORKER_DATA | Out-Null
$identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
& icacls.exe $env:FAMILYHUB_WORKER_DATA /inheritance:r /grant:r "${identity}:(OI)(CI)F" 'SYSTEM:(OI)(CI)F' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Could not secure the private data directory.' }
& node $entry
if ($LASTEXITCODE -ne 0) { throw 'Gmail connection did not complete.' }
