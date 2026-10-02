# Optional local-only insurer credentials. Never pass passwords as arguments or paste them into chat.
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][ValidateSet('bluecross','desjardins')][string]$Insurer,
  [Parameter(Mandatory=$true)][string]$DataDirectory,
  [ValidateSet('Set','Delete','Status','RecoverLock')][string]$Action = 'Set'
)
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'Windows user-scoped DPAPI is required.' }
$privateRoot = [IO.Path]::GetFullPath($DataDirectory)
if (-not (Test-Path -LiteralPath (Join-Path $privateRoot 'pairing-key.txt'))) {
  throw 'Use the existing worker DataDirectory (containing pairing-key.txt).'
}
$portalDirectory = Join-Path $privateRoot $Insurer
$credentialFile = Join-Path $portalDirectory 'login.dpapi'
$controlFile = Join-Path $portalDirectory 'login-control.json'
$lockDirectory = Join-Path $portalDirectory 'collector-lock'
$ownerFile = Join-Path $lockDirectory 'owner.json'
$profileDirectory = Join-Path $portalDirectory 'browser-profile'
[void][IO.Directory]::CreateDirectory($portalDirectory)
if ($Action -eq 'Status') {
  Write-Host ('Windows user: ' + [Security.Principal.WindowsIdentity]::GetCurrent().Name)
  Write-Host ('Automatic login configured: ' + (Test-Path -LiteralPath $credentialFile))
  Write-Host ('Profile locked: ' + (Test-Path -LiteralPath $lockDirectory))
  return
}
if ($Action -eq 'RecoverLock') {
  if (-not (Test-Path -LiteralPath $lockDirectory)) { Write-Host 'No interrupted lock.'; return }
  $owner = Get-Content -LiteralPath $ownerFile -Raw | ConvertFrom-Json
  if ((-not ($owner.pid -is [int]) -and -not ($owner.pid -is [long])) -or $owner.pid -le 0 -or $owner.pid -gt [int]::MaxValue) { throw 'Unknown lock owner; inspect locally before recovery.' }
  if (Get-Process -Id $owner.pid -ErrorAction SilentlyContinue) { throw 'The lock owner is still running. Let its collection finish.' }
  $browsers = Get-CimInstance Win32_Process -Filter "Name='chrome.exe' OR Name='msedge.exe'"
  if ($browsers | Where-Object { $_.CommandLine -and $_.CommandLine.IndexOf($profileDirectory, [StringComparison]::OrdinalIgnoreCase) -ge 0 }) {
    throw 'The insurer browser is still running. Close it before recovering its lock.'
  }
  # Only the two fixed lock paths are removed; profiles and financial data are untouched.
  Remove-Item -LiteralPath $ownerFile
  [IO.Directory]::Delete($lockDirectory)
  Write-Host 'Interrupted lock recovered. Automatic-login retry protection is unchanged.'
  return
}
# New-Item without -Force is exclusive, matching the collector directory lock.
try { [void](New-Item -ItemType Directory -Path $lockDirectory -ErrorAction Stop) }
catch { throw 'This insurer is busy. Wait for collection to finish or recover an interrupted lock.' }
$tempFile = $null
try {
  [IO.File]::WriteAllText($ownerFile, ('{"pid":' + $PID + '}'))
  if ($Action -eq 'Delete') {
    if (Test-Path -LiteralPath $credentialFile) { Remove-Item -LiteralPath $credentialFile }
    Write-Host 'Saved password removed. Existing trusted browser sessions remain available.'
    return
  }
  Write-Host ('Configure ' + $Insurer + ' as ' + [Security.Principal.WindowsIdentity]::GetCurrent().Name)
  Write-Host 'All entries are masked. Use the same Windows user as the existing worker.'
  function Read-Masked([string]$Label) {
    $secureValue = Read-Host $Label -AsSecureString
    $buffer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureValue)
    try { $value = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($buffer) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($buffer); $secureValue.Dispose() }
    if (-not $value -or $value.Length -gt 512 -or $value -match '[\r\n\x00]') { throw 'An entry is empty or invalid. Nothing saved.' }
    return $value
  }
  $credentials = @{ version=1; insurer=$Insurer }
  if ($Insurer -eq 'desjardins') { $credentials.username = Read-Masked 'Identifiant' }
  else {
    $credentials.policy = Read-Masked 'Policy'
    $credentials.certificate = Read-Masked 'ID Number'
    $role = Read-Host 'Sign in as member or spouse'
    if ($role -notin @('member','spouse')) { throw 'Choose member or spouse. Nothing saved.' }
    $credentials.role = $role.ToLowerInvariant()
  }
  $credentials.password = Read-Masked 'Password'
  $plainJson = $credentials | ConvertTo-Json -Compress
  $protected = ConvertTo-SecureString $plainJson -AsPlainText -Force
  try { $encrypted = ConvertFrom-SecureString $protected }
  finally { $protected.Dispose(); $credentials.Clear(); $plainJson = $null }
  $tempFile = $credentialFile + '.' + [Guid]::NewGuid().ToString() + '.tmp'
  [IO.File]::WriteAllText($tempFile, '')
  $acl = Get-Acl -LiteralPath $tempFile
  $acl.SetAccessRuleProtection($true, $false)
  $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
  $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($sid, 'FullControl', 'Allow'))
  Set-Acl -LiteralPath $tempFile -AclObject $acl
  [IO.File]::WriteAllText($tempFile, (@{encrypted=$encrypted} | ConvertTo-Json -Compress), [Text.UTF8Encoding]::new($false))
  if (Test-Path -LiteralPath $credentialFile) { [IO.File]::Replace($tempFile, $credentialFile, [NullString]::Value) }
  else { [IO.File]::Move($tempFile, $credentialFile) }
  $tempFile = $null
  [IO.File]::WriteAllText($controlFile, '{"blocked":false}', [Text.UTF8Encoding]::new($false))
  Write-Host 'Protected login saved. Use Update in Sources for a read-only preview. Apply remains a separate action.'
} finally {
  if ($tempFile -and (Test-Path -LiteralPath $tempFile)) { Remove-Item -LiteralPath $tempFile }
  if (Test-Path -LiteralPath $ownerFile) { Remove-Item -LiteralPath $ownerFile }
  [IO.Directory]::Delete($lockDirectory)
}
