# Synthetic Windows setup acceptance: no browser or live worker is opened.
$ErrorActionPreference = 'Stop'
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ('familyhub-login-setup-' + [Guid]::NewGuid())
$setup = Join-Path $PSScriptRoot '..\scripts\Set-InsurerLogin.ps1'
function Assert($condition, [string]$message) { if (-not $condition) { throw $message } }
function Read-Host {
  param([string]$Prompt, [switch]$AsSecureString)
  $next = $global:familyHubTestEntries.Dequeue()
  if ($next -eq 'CANCEL') { throw 'Synthetic cancellation' }
  if ($AsSecureString) { return ConvertTo-SecureString $next -AsPlainText -Force }
  return $next
}
function Set-Entries([string[]]$values) { $global:familyHubTestEntries = [Collections.Generic.Queue[string]]::new(); foreach($v in $values) { $global:familyHubTestEntries.Enqueue($v) } }
function Read-TestCredential([string]$path) {
  $wrapped = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
  $secureValue = ConvertTo-SecureString $wrapped.encrypted
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureValue)
  try { return ([Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) | ConvertFrom-Json) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr); $secureValue.Dispose() }
}
try {
  [void][IO.Directory]::CreateDirectory($testRoot)
  [IO.File]::WriteAllText((Join-Path $testRoot 'pairing-key.txt'), 'synthetic-test-only')
  Set-Entries @('synthetic-user', 'synthetic-password')
  & $setup -Insurer desjardins -DataDirectory $testRoot
  $file = Join-Path $testRoot 'desjardins\login.dpapi'
  $before = [IO.File]::ReadAllText($file)
  Assert (-not $before.Contains('synthetic-user')) 'Credential was plaintext'
  Assert ((Read-TestCredential $file).username -eq 'synthetic-user') 'DPAPI setup could not be unlocked'
  Assert (Get-Acl -LiteralPath $file).AreAccessRulesProtected 'Credential ACL inherited broad access'
  Set-Entries @('synthetic-replacement', 'CANCEL')
  try { & $setup -Insurer desjardins -DataDirectory $testRoot; throw 'Expected cancellation' } catch { Assert ($_.Exception.Message -eq 'Synthetic cancellation') 'Unexpected setup failure' }
  Assert ([IO.File]::ReadAllText($file) -eq $before) 'Cancellation changed old credentials'
  Set-Entries @('synthetic-replacement', 'synthetic-new-password')
  & $setup -Insurer desjardins -DataDirectory $testRoot
  Assert ((Read-TestCredential $file).username -eq 'synthetic-replacement') 'Replacement failed'
  Assert (Get-Acl -LiteralPath $file).AreAccessRulesProtected 'Replacement weakened the ACL'
  Set-Entries @('synthetic-policy', 'synthetic-id', 'spouse', 'synthetic-password')
  & $setup -Insurer bluecross -DataDirectory $testRoot
  Assert ((Read-TestCredential (Join-Path $testRoot 'bluecross\login.dpapi')).role -eq 'spouse') 'Blue Cross role lost'
  $lock = Join-Path $testRoot 'desjardins\collector-lock'
  [void][IO.Directory]::CreateDirectory($lock)
  [IO.File]::WriteAllText((Join-Path $lock 'owner.json'), ('{"pid":' + $PID + '}'))
  try { & $setup -Insurer desjardins -DataDirectory $testRoot -Action Delete; throw 'Expected busy lock' } catch { Assert ($_.Exception.Message -like 'This insurer is busy*') 'Setup ignored live profile lock' }
  Assert (Test-Path -LiteralPath $file) 'Locked delete removed credentials'
  try { & $setup -Insurer desjardins -DataDirectory $testRoot -Action RecoverLock; throw 'Expected live owner rejection' } catch { Assert ($_.Exception.Message -like 'The lock owner is still running*') 'Recovery stole live lock' }
  Remove-Item -LiteralPath (Join-Path $lock 'owner.json')
  [IO.Directory]::Delete($lock)
  & $setup -Insurer desjardins -DataDirectory $testRoot -Action Delete
  Assert (-not (Test-Path -LiteralPath $file)) 'Delete did not remove credentials'
  Write-Host 'Synthetic setup, replacement, cancellation, ACL, DPAPI, role and lock checks passed.'
} finally {
  $resolvedTest = [IO.Path]::GetFullPath($testRoot)
  $resolvedTemp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
  if (-not $resolvedTest.StartsWith($resolvedTemp, [StringComparison]::OrdinalIgnoreCase) -or -not ([IO.Path]::GetFileName($resolvedTest)).StartsWith('familyhub-login-setup-')) { throw 'Unexpected cleanup path' }
  if (Test-Path -LiteralPath $resolvedTest) { Remove-Item -LiteralPath $resolvedTest -Recurse -Force }
}
