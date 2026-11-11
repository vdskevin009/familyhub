param(
  [ValidateRange(1,65535)][int]$Port = 4713
)
$ErrorActionPreference = 'Stop'
# This process forwards only the existing localhost worker. It never creates
# a second worker, rotates pairing, opens the firewall or imports claims.
$ngrok = (Get-Command ngrok -ErrorAction Stop).Source

# Fail closed before exposing a different application accidentally listening
# on the same port, or a worker bound to every network interface.
$listeners = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
if ($listeners.Count -eq 0) { throw "No existing FamilyHub localhost worker is listening on port $Port. Start the original worker before opening the tunnel." }
foreach ($listener in $listeners) {
  if ($listener.LocalAddress -notin @('127.0.0.1', '::1')) {
    throw "Port $Port has a non-loopback listener. Refusing to expose it through ngrok."
  }
}

# HTTP inspection/replay may contain private claim PDFs and pairing headers.
# The caller's installed ngrok binary MUST support the disabling flag.
$helpText = (& $ngrok http --help 2>&1 | Out-String)
if ($LASTEXITCODE -ne 0 -or $helpText -notmatch [regex]::Escape('--inspect')) {
  throw 'Cannot confirm that this ngrok version supports disabling local HTTP inspection. No tunnel started. Verify compatible ngrok configuration before proceeding.'
}

Write-Host "Starting a stable PUBLIC HTTPS ngrok endpoint for existing localhost:$Port."
Write-Host 'Local traffic inspection is disabled. Cloud Traffic Inspector Full Capture must also remain OFF.'
Write-Host 'Existing FamilyHub pairing key and browser origin restrictions are required.'
& $ngrok http "http://127.0.0.1:$Port" --inspect=false --host-header=rewrite
if ($LASTEXITCODE -ne 0) { throw "ngrok stopped with exit code $LASTEXITCODE." }
