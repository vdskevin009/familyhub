param(
  [Parameter(Mandatory=$true)][string]$DataDirectory,
  [string]$NodePath = 'node',
  [int]$Port = 4713
)
$ErrorActionPreference = 'Stop'
$env:FAMILYHUB_WORKER_DATA = [IO.Path]::GetFullPath($DataDirectory)
$env:FAMILYHUB_WORKER_PORT = [string]$Port
# Use the existing worker only. A failed health check must never spawn a
# competing process or implicitly trigger a Gmail collection.
$mutex = New-Object Threading.Mutex($false, 'Local\FamilyHubInsurerPreviews')
$acquired = $false
try {
  try { $acquired = $mutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $acquired = $true }
  if (-not $acquired) { throw 'An insurer preview runner is already active.' }
  & $NodePath (Join-Path $PSScriptRoot 'insurer-previews.mjs')
  $result = $LASTEXITCODE
} finally {
  if ($acquired) { $mutex.ReleaseMutex() }
  $mutex.Dispose()
}
exit $result
