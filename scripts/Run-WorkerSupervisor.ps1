param(
  [Parameter(Mandatory=$true)][string]$DataDirectory,
  [Parameter(Mandatory=$true)][string]$NodePath,
  [ValidateRange(1,65535)][int]$Port = 4713,
  [string]$AllowedOrigins = 'https://vdskevin009.github.io'
)
$ErrorActionPreference = 'Stop'
$data = [IO.Path]::GetFullPath($DataDirectory)
$entry = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../apps/worker/dist/index.js'))
$node = (Get-Command $NodePath -ErrorAction Stop).Source
if (-not (Test-Path -LiteralPath $entry -PathType Leaf)) { throw 'Installed worker build is missing.' }
if (-not (Test-Path -LiteralPath (Join-Path $data 'pairing-key.txt') -PathType Leaf)) { throw 'Existing pairing key is required; supervisor never initializes a new installation.' }
$key = [IO.File]::ReadAllText((Join-Path $data 'pairing-key.txt')).Trim()
if (-not $key) { throw 'Existing pairing key is empty; no worker started.' }
if ($AllowedOrigins -ne 'https://vdskevin009.github.io') { throw 'This production supervisor requires the exact FamilyHub Pages origin.' }
$mutex = New-Object Threading.Mutex($false, ('Local\FamilyHubWorkerSupervisor-' + $Port))
$ownsMutex = $false
try {
  try { $ownsMutex = $mutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $ownsMutex = $true }
  if (-not $ownsMutex) { return }
  $env:FAMILYHUB_WORKER_DATA = $data
  $env:FAMILYHUB_WORKER_HOST = '127.0.0.1'
  $env:FAMILYHUB_WORKER_PORT = [string]$Port
  $env:FAMILYHUB_ALLOWED_ORIGINS = $AllowedOrigins
  $unhealthy = 0
  while ($true) {
    $listeners = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
    $processes = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object {
      $_.ExecutablePath -eq $node -and $_.CommandLine -and $_.CommandLine.Contains('"' + $entry + '"')
    })
    if ($processes.Count -gt 1) { throw 'Multiple installed worker processes detected; manual inspection required.' }
    foreach ($listener in $listeners) {
      if ($listener.LocalAddress -ne '127.0.0.1' -or $listener.OwningProcess -notin @($processes.ProcessId)) {
        throw 'Unexpected listener; supervisor will not replace or expose it.'
      }
    }
    if ($processes.Count -eq 0 -and $listeners.Count -eq 0) {
      # Worker 2.30.1 acquires its port before initializing data, so a race with
      # the existing daily launcher cannot mutate private state concurrently.
      Start-Process -FilePath $node -ArgumentList @('"' + $entry + '"') -WorkingDirectory (Split-Path $entry) -WindowStyle Hidden -RedirectStandardOutput (Join-Path $data 'worker.log') -RedirectStandardError (Join-Path $data 'worker-error.log') | Out-Null
      Start-Sleep -Seconds 5
    }
    try {
      $response = Invoke-WebRequest "http://127.0.0.1:$Port/health" -Headers @{'x-familyhub-key'=$key; Origin=$AllowedOrigins} -UseBasicParsing -TimeoutSec 5
      $health = $response.Content | ConvertFrom-Json
      if ($health.status -ne 'ok' -or [version]$health.version -lt [version]'2.30.1' -or $response.Headers['X-Content-Type-Options'] -ne 'nosniff') { throw 'Unexpected worker health.' }
      $unhealthy = 0
    } catch {
      $unhealthy++
      # Never kill an active collector or retry an unknown write to fix health.
      if ($unhealthy -ge 12) { throw 'Worker health unavailable; existing process and data retained.' }
    }
    Start-Sleep -Seconds 10
  }
} finally {
  if ($ownsMutex) { $mutex.ReleaseMutex() }
  $mutex.Dispose()
}
