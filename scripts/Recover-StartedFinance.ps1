param(
  [Parameter(Mandatory=$true)][string]$DataDirectory,
  [Parameter(Mandatory=$true)][string]$AdmissionFile,
  [Parameter(Mandatory=$true)][string]$BaselineFile,
  [Parameter(Mandatory=$true)][string]$ProofFile,
  [Parameter(Mandatory=$true)][string]$OwnerEvidenceFile,
  [Parameter(Mandatory=$true)][string]$NodePath
)
$ErrorActionPreference = 'Stop'
# Explicitly reviewed offline recovery only. Never invoke from a scheduled runner.
# FileShare.Read excludes writes AND replacement/deletion, including existing writers.
# Missing files and reparse points are unsupported and fail closed.
function Get-RegularPath([string]$Value) {
  $full = [IO.Path]::GetFullPath($Value)
  $item = Get-Item -LiteralPath $full -Force
  if ($item.PSIsContainer) { throw 'Regular file required.' }
  $cursor = $item
  while ($null -ne $cursor) {
    if (($cursor.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Reparse points are not supported.' }
    $cursor = $cursor.Parent
    if ($null -eq $cursor -and $item -is [IO.FileInfo]) { $cursor = $item.Directory; $item = $cursor }
  }
  return $full
}
function Get-ChildPath([string]$Root, [string]$Name) {
  $base = [IO.Path]::GetFullPath($Root).TrimEnd('\') + '\'
  if ([IO.Path]::IsPathRooted($Name) -or $Name.Contains('\')) { throw 'Relative forward-slash path required.' }
  $full = [IO.Path]::GetFullPath([IO.Path]::Combine($base, $Name))
  if (-not $full.StartsWith($base, [StringComparison]::OrdinalIgnoreCase)) { throw 'Path escapes reviewed root.' }
  return Get-RegularPath $full
}
$handles = [Collections.Generic.List[IO.FileStream]]::new()
$mutexes = [Collections.Generic.List[string]]::new()
$encoding = [Text.UTF8Encoding]::new($false)
function Get-BytesHash([byte[]]$Bytes) { return [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($Bytes)).ToLowerInvariant() }
function Write-Exclusive([string]$File, [string]$Value) {
  $stream = [IO.File]::Open($File,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Read)
  try { $raw=$encoding.GetBytes($Value); $stream.Write($raw,0,$raw.Length); $stream.Flush($true) } finally { $stream.Dispose() }
  if ([IO.File]::ReadAllText($File) -cne $Value) { throw 'Durable readback failed.' }
}
function Read-Plan {
  $output = & $NodePath --import tsx (Join-Path $PSScriptRoot 'Recover-StartedFinance.mjs') $DataDirectory $AdmissionFile $BaselineFile $ProofFile $OwnerEvidenceFile
  if ($LASTEXITCODE -ne 0) { throw 'Independent recovery plan rejected; retain evidence.' }
  return ($output | ConvertFrom-Json)
}
function Assert-PlanState($Plan) {
  Get-RegularPath $stateFile | Out-Null
  if (Test-Path -LiteralPath $leaseFile) { Get-RegularPath $leaseFile | Out-Null }
  if ([DateTimeOffset]::UtcNow -ge [DateTimeOffset]::Parse($owner.expiresAt)) { throw 'Owner evidence expired.' }
  if ((Get-BytesHash ([IO.File]::ReadAllBytes($stateFile))) -cne $Plan.stateSha256) { throw 'Recovery state drift.' }
  if ($null -eq $Plan.leaseSha256) { if (Test-Path -LiteralPath $leaseFile) { throw 'Unexpected lease.' } }
  elseif ((Get-BytesHash ([IO.File]::ReadAllBytes($leaseFile))) -cne $Plan.leaseSha256) { throw 'Recovery lease drift.' }
}
try {
  # Lock proof/owner envelopes before parsing their file lists.
  $proofPath = Get-RegularPath $ProofFile
  $ownerPath = Get-RegularPath $OwnerEvidenceFile
  foreach ($file in @($proofPath,$ownerPath)) { $handles.Add([IO.File]::Open($file,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)) }
  $proof = Get-Content -LiteralPath $proofPath -Raw | ConvertFrom-Json
  $owner = Get-Content -LiteralPath $ownerPath -Raw | ConvertFrom-Json
  $paths = @((Get-RegularPath $AdmissionFile),(Get-RegularPath $BaselineFile))
  foreach ($property in $proof.files.PSObject.Properties) { $paths += Get-ChildPath $DataDirectory $property.Name }
  foreach ($entry in $owner.owners) { $paths += Get-ChildPath ([IO.Path]::GetDirectoryName($ownerPath)) $entry.evidenceFile }
  foreach ($file in ($paths | Select-Object -Unique)) { $handles.Add([IO.File]::Open($file,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)) }
  $admission = Get-Content -LiteralPath $AdmissionFile -Raw | ConvertFrom-Json
  if ($admission.token -notmatch '^[a-f0-9]{64}$') { throw 'Invalid admission.' }
  $tokenDigest = Get-BytesHash ($encoding.GetBytes('"'+$admission.token+'"'))
  $gate = Join-Path $DataDirectory 'finance-feed/daily-gate'
  $stateFile = Join-Path $gate 'state.json'
  $leaseFile = Join-Path $gate 'lease.lock'
  Get-RegularPath $stateFile | Out-Null
  if (Test-Path -LiteralPath $leaseFile) { Get-RegularPath $leaseFile | Out-Null }
  $existingArtifact = Join-Path $gate ('started-recovery-'+$tokenDigest+'.json')
  if (Test-Path -LiteralPath $existingArtifact) { Get-RegularPath $existingArtifact | Out-Null }
  $marker = Get-RegularPath (Join-Path $gate ('started-'+$tokenDigest+'.json'))
  $handles.Add([IO.File]::Open($marker,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read))
  $mutexBytes = '{"kind":"started-recovery-holder","admissionDigest":"'+$proof.admissionDigest+'"}'
  foreach ($name in @(('phase-'+$tokenDigest+'.lock'),'finalize.lock')) {
    $file=Join-Path $gate $name; Write-Exclusive $file $mutexBytes; $mutexes.Add($file)
  }
  $plan = Read-Plan
  if ($plan.tokenDigest -cne $tokenDigest -or $plan.artifactName -cne ('started-recovery-'+$tokenDigest+'.json')) { throw 'Plan binding mismatch.' }
  Assert-PlanState $plan
  $artifactFile = Join-Path $gate $plan.artifactName
  $artifactBytes = $plan.artifactBytes
  if ($plan.action -eq 'archive') {
    Write-Exclusive $artifactFile $artifactBytes
    $plan = Read-Plan
  }
  if ($plan.artifactBytes -cne $artifactBytes -or [IO.File]::ReadAllText($artifactFile) -cne $artifactBytes) { throw 'Immutable artifact drift.' }
  if ($plan.action -eq 'commit') {
    Assert-PlanState $plan
    $temporary = Join-Path $gate ('recovery-state-'+[Guid]::NewGuid().ToString('N')+'.tmp')
    Write-Exclusive $temporary $plan.afterStateBytes
    Assert-PlanState $plan
    # The process that holds every deny-write/delete stream performs the mutation.
    # Killing it releases exclusion only after this code has stopped; its Node child
    # can finish reading but has no mutation path.
    [IO.File]::Move($temporary,$stateFile,$true)
    if ([IO.File]::ReadAllText($stateFile) -cne $plan.afterStateBytes) { throw 'State readback failed; retain lease.' }
    $plan = Read-Plan
  }
  if ($plan.action -eq 'release') {
    Assert-PlanState $plan
    if ($plan.artifactBytes -cne $artifactBytes -or [IO.File]::ReadAllText($artifactFile) -cne $artifactBytes) { throw 'Immutable artifact drift.' }
    Remove-Item -LiteralPath $leaseFile
  } elseif ($plan.action -ne 'done') { throw 'Unexpected recovery phase.' }
  Write-Output '{"complete":false,"writeOutcome":"not-applied","reason":"recovered-retry-later"}'
} finally {
  foreach ($file in $mutexes) {
    if ([IO.File]::ReadAllText($file) -cne $mutexBytes) { throw 'Mutex ownership changed; retain for review.' }
    Remove-Item -LiteralPath $file
  }
  foreach ($handle in $handles) { $handle.Dispose() }
}
