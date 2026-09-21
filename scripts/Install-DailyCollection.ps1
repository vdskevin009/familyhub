param(
  [string]$DataDirectory = (Join-Path $env:USERPROFILE '.familyhub-worker'),
  [string]$At = '08:00',
  [string]$CodexPath = '',
  [int]$Port = 4713
)
$ErrorActionPreference = 'Stop'
$resolvedData = [IO.Path]::GetFullPath($DataDirectory)
if (-not (Test-Path -LiteralPath (Join-Path $resolvedData 'gmail-credentials.dpapi'))) { throw 'Run Connect-Gmail.ps1 first. An unconnected daily task will not be installed.' }
$node = (Get-Command node -ErrorAction Stop).Source
$runner = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'Run-DailyCollection.ps1'))
foreach ($value in @($resolvedData, $node, $runner, $CodexPath)) { if ($value.Contains('"')) { throw 'Paths cannot contain quotes.' } }
$arguments = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + $runner + '" -DataDirectory "' + $resolvedData + '" -NodePath "' + $node + '" -Port ' + $Port
if ($CodexPath) { $arguments += ' -CodexPath "' + $CodexPath + '"' }
$action = New-ScheduledTaskAction -Execute (Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe') -Argument $arguments
$trigger = New-ScheduledTaskTrigger -Daily -At ([datetime]::ParseExact($At, 'HH:mm', [Globalization.CultureInfo]::InvariantCulture))
$principal = New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 4) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName 'FamilyHub Daily Invoices' -Description 'Read Gmail, classify invoice candidates and expose documents through the paired FamilyHub worker. No claims are submitted.' -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
$installed = Get-ScheduledTask -TaskName 'FamilyHub Daily Invoices'
if ($installed.State -eq 'Disabled') { throw 'The installed task is disabled.' }
Write-Host "FamilyHub daily collection installed at $At in the PC local time zone. This Windows user must be signed in; missed runs start when available."
Get-ScheduledTaskInfo -TaskName 'FamilyHub Daily Invoices' | Select-Object NextRunTime, LastRunTime, LastTaskResult
