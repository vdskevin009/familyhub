param(
  [ValidateRange(1,65535)][int]$Port = 4713,
  [string]$NgrokConfig = ''
)
$ErrorActionPreference = 'Stop'
# Forwards ONLY the existing localhost worker. No duplicate worker, key change,
# firewall rule or private claim import is ever performed by this script.
$ngrok = (Get-Command ngrok -ErrorAction Stop).Source
$listeners = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
if ($listeners.Count -eq 0) {
  throw "No FamilyHub worker listening on port $Port. Start the original localhost worker before exposing it."
}
foreach ($listener in $listeners) {
  if ($listener.LocalAddress -notin @('127.0.0.1', '::1')) {
    throw "Non-loopback listener detected on port $Port. Refusing public exposure."
  }
}

$arguments = @('http', "http://127.0.0.1:$Port", '--host-header=rewrite')
if ($NgrokConfig) {
  # Newer ngrok agents support agent.inspect_db_size: -1 in their version-3
  # configuration. Use the actual existing config containing the operator's
  # local auth token; never copy, print, commit or overwrite it.
  $resolvedConfig = [IO.Path]::GetFullPath($NgrokConfig)
  if (-not (Test-Path -LiteralPath $resolvedConfig -PathType Leaf)) {
    throw 'Provided ngrok config does not exist. No tunnel started.'
  }
  $inAgent = $false
  $inspectionValues = @()
  foreach ($line in [IO.File]::ReadAllLines($resolvedConfig)) {
    if ($line -match '^\s*#') { continue }
    if ($line -match '^agent:\s*$') { $inAgent = $true; continue }
    if ($line -match '^[^\s#]') { $inAgent = $false }
    if ($inAgent -and $line -match '^  inspect_db_size:\s*(-?\d+)\s*(?:#.*)?$') {
      $inspectionValues += [int]$Matches[1]
    }
  }
  if ($inspectionValues.Count -ne 1 -or $inspectionValues[0] -ne -1) {
    throw 'The ngrok v3 config must contain exactly one agent.inspect_db_size: -1 setting. No tunnel started.'
  }
  & $ngrok config check --config $resolvedConfig | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'ngrok rejected the privacy-safe config. No tunnel started.' }
  $arguments += @('--config', $resolvedConfig)
} else {
  # Legacy CLI fallback: refuse to start when disabling local traffic capture
  # cannot be confirmed. Current ngrok v3 operators should use -NgrokConfig.
  $helpText = (& $ngrok http --help 2>&1 | Out-String)
  if ($LASTEXITCODE -ne 0 -or $helpText -notmatch '--inspect') {
    throw 'Cannot disable local HTTP inspection with the installed CLI. Configure agent.inspect_db_size: -1 in ngrok v3 and pass -NgrokConfig. No tunnel started.'
  }
  $arguments += '--inspect=false'
}

Write-Host "Starting a stable PUBLIC ngrok HTTPS endpoint for existing localhost:$Port."
Write-Host 'Local inspection is disabled; keep Cloud Traffic Inspector Full Capture OFF.'
Write-Host 'Keep the original FamilyHub pairing key and exact browser origins.'
& $ngrok @arguments
if ($LASTEXITCODE -ne 0) { throw "ngrok stopped with exit code $LASTEXITCODE." }
