param(
  [ValidateRange(1,65535)][int]$Port = 4713,
  [switch]$AcknowledgePublicEndpoint
)
$ErrorActionPreference = 'Stop'
if (-not $AcknowledgePublicEndpoint) {
  throw 'ngrok creates a PUBLIC internet endpoint. Read docs/STABLE-TUNNEL-NGROK.md and rerun with -AcknowledgePublicEndpoint to opt in.'
}
$ngrok = (Get-Command ngrok -ErrorAction Stop).Source
$runner = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'Run-StableTunnel.ps1'))
if (-not (Test-Path -LiteralPath $runner)) { throw 'Stable tunnel runner not found.' }
foreach ($value in @($ngrok, $runner)) {
  if ($value.Contains('"')) { throw 'Path cannot contain double quotes.' }
}
# The user must configure their personal ngrok authtoken locally first.
& $ngrok config check | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'ngrok agent configuration is invalid; configure the free account on this PC first.' }
$windowsPowerShell = Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe'
$arguments = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + $runner + '" -Port ' + $Port
$action = New-ScheduledTaskAction -Execute $windowsPowerShell -Argument $arguments
$identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $identity
$principal = New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName 'FamilyHub Stable HTTPS Tunnel' -Description 'Owner-opted-in ngrok forwarding of existing local FamilyHub worker; no worker startup, importer or credential changes.' -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
Write-Host 'Scheduled tunnel at Windows user logon. It does not start the FamilyHub worker.'
Write-Host 'Run: Start-ScheduledTask -TaskName "FamilyHub Stable HTTPS Tunnel"'
Write-Host 'Inspect: Invoke-RestMethod http://127.0.0.1:4040/api/tunnels'
