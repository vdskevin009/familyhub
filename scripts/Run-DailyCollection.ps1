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
$readiness = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../apps/worker/dist/mail-source-policy-cli.js'))
$sourceReadinessJson = & $NodePath $readiness
if ($LASTEXITCODE -ne 0) { throw 'Mail source configuration is unavailable or invalid. Daily collection was not started.' }
try { $sourceReadiness = $sourceReadinessJson | ConvertFrom-Json } catch { throw 'Mail source readiness response is invalid.' }
if ($sourceReadiness.mode -notin @('legacy', 'plugin') -or $sourceReadiness.ready -ne $true) { throw 'Mail source readiness is not confirmed.' }
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
if ([version]$health.version -lt [version]'2.3.0') { throw 'An older FamilyHub worker is using this port. Restart it with the updated worker before collecting.' }
# The source policy is bound to the worker process. Never collect through an old
# legacy process after plugin selection, and never silently restart it here.
$keyFile = Join-Path $DataDirectory 'pairing-key.txt'
$pairingKey = (Get-Content -LiteralPath $keyFile -Raw).Trim()
try { $sourceSnapshot = Invoke-RestMethod "http://127.0.0.1:$Port/invoices" -Headers @{ 'x-familyhub-key' = $pairingKey } -TimeoutSec 30 }
catch { throw 'Could not verify the running worker mail source. Collection was not started.' }
finally { $pairingKey = $null }
if ($sourceSnapshot.setupRequired) { throw 'The running worker mail source is unavailable. Verify its configured source before collecting.' }
if (($sourceReadiness.mode -eq 'plugin' -and $sourceSnapshot.sourceMode -ne 'plugin') -or
    ($sourceReadiness.mode -eq 'legacy' -and $sourceSnapshot.sourceMode -and $sourceSnapshot.sourceMode -ne 'legacy')) {
  throw 'The running worker mail source does not match the validated policy. Restart the intended worker explicitly before collecting.'
}
& $NodePath $collector
if ($LASTEXITCODE -ne 0) { throw 'Daily collection failed. Check the account status in FamilyHub Inbox.' }
