param(
  [string]$DataDirectory = (Join-Path $env:USERPROFILE '.familyhub-worker'),
  [string]$NodePath = 'node',
  [string]$CodexPath = '',
  [int]$Port = 4713
)
$ErrorActionPreference = 'Stop'
$env:FAMILYHUB_WORKER_DATA = [IO.Path]::GetFullPath($DataDirectory)
$env:FAMILYHUB_WORKER_PORT = [string]$Port
$env:FAMILYHUB_WORKER_HOST = '127.0.0.1'
if ($CodexPath) { $env:FAMILYHUB_CODEX_PATH = $CodexPath }
$entry = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../apps/worker/dist/index.js'))
$collector = Join-Path $PSScriptRoot '../apps/worker/dist/collect-once.js'
if (-not (Test-Path -LiteralPath (Join-Path $DataDirectory 'gmail-credentials.dpapi'))) { throw 'Connect Gmail on the PC before running daily collection.' }
function Get-WorkerHealth {
  $keyFile = Join-Path $DataDirectory 'pairing-key.txt'
  if (-not (Test-Path -LiteralPath $keyFile)) { return $null }
  $pairingKey = (Get-Content -LiteralPath $keyFile -Raw).Trim()
  try { return Invoke-RestMethod "http://127.0.0.1:$Port/health" -Headers @{ 'x-familyhub-key' = $pairingKey } -TimeoutSec 5 } catch { return $null }
}
$health = Get-WorkerHealth
if (-not $health) {
  $node = (Get-Command $NodePath -ErrorAction Stop).Source
  Start-Process -FilePath $node -ArgumentList @('"' + $entry + '"') -WorkingDirectory (Split-Path $entry) -WindowStyle Hidden -RedirectStandardOutput (Join-Path $DataDirectory 'worker.log') -RedirectStandardError (Join-Path $DataDirectory 'worker-error.log') | Out-Null
  for ($attempt = 0; $attempt -lt 20; $attempt++) {
    Start-Sleep -Milliseconds 500
    $health = Get-WorkerHealth
    if ($health) { break }
  }
}
if (-not $health) { throw 'The worker could not start. Check worker-error.log; another process may already use this port.' }
if ([version]$health.version -lt [version]'2.1.0') { throw 'An older FamilyHub worker is using this port. Restart it with the updated worker before collecting.' }
& $NodePath $collector
if ($LASTEXITCODE -ne 0) { throw 'Daily collection failed. Check the account status in FamilyHub Inbox.' }
