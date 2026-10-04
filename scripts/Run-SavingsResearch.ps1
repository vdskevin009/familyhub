param([Parameter(Mandatory=$true)][string]$DataDirectory, [string]$NodePath = 'node', [int]$Port = 4713)
$ErrorActionPreference = 'Stop'
$env:FAMILYHUB_WORKER_DATA = [IO.Path]::GetFullPath($DataDirectory)
$env:FAMILYHUB_WORKER_PORT = [string]$Port
$mutex = New-Object Threading.Mutex($false, 'Local\FamilyHubSavingsResearch')
$acquired = $false
try {
  try { $acquired = $mutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $acquired = $true }
  if (-not $acquired) { throw 'A daily Savings runner is already active.' }
  & $NodePath (Join-Path $PSScriptRoot 'savings-daily.mjs')
  $result = $LASTEXITCODE
} finally {
  if ($acquired) { $mutex.ReleaseMutex() }
  $mutex.Dispose()
}
exit $result
