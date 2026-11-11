param(
  [ValidateRange(1,65535)][int]$Port = 4713
)
$ErrorActionPreference = 'Stop'
# This process only forwards an already-running localhost worker. It must not
# create a second worker, edit pairing keys, or copy private data.
$ngrok = (Get-Command ngrok -ErrorAction Stop).Source
Write-Host "Starting ngrok assigned dev domain for localhost:$Port."
Write-Host "Public HTTPS endpoint: keep the existing FamilyHub pairing key and origin restrictions."
& $ngrok http "http://127.0.0.1:$Port"
if ($LASTEXITCODE -ne 0) { throw "ngrok stopped with exit code $LASTEXITCODE." }
