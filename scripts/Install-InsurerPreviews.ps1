param(
  [Parameter(Mandatory=$true)][string]$DataDirectory,
  [string]$At = '04:00',
  [string]$NodePath = 'node',
  [int]$Port = 4713
)
$ErrorActionPreference = 'Stop'
$resolvedData = [IO.Path]::GetFullPath($DataDirectory)
if (-not (Test-Path -LiteralPath (Join-Path $resolvedData 'pairing-key.txt'))) { throw 'Use the existing worker DataDirectory.' }
$node = (Get-Command $NodePath -ErrorAction Stop).Source
$runner = Join-Path $PSScriptRoot 'Run-InsurerPreviews.ps1'
foreach ($value in @($resolvedData, $node, $runner)) { if ($value.Contains('"')) { throw 'Paths cannot contain quotes.' } }
$arguments = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + $runner + '" -DataDirectory "' + $resolvedData + '" -NodePath "' + $node + '" -Port ' + $Port
$action = New-ScheduledTaskAction -Execute (Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe') -Argument $arguments
$trigger = New-ScheduledTaskTrigger -Daily -At ([datetime]::ParseExact($At, 'HH:mm', [Globalization.CultureInfo]::InvariantCulture))
$principal = New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -WakeToRun -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 1) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName 'FamilyHub Daily Insurer Previews' -Description 'Sequential read-only Blue Cross and Desjardins previews through the existing running worker. Explicit financial apply remains separate.' -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
Get-ScheduledTaskInfo -TaskName 'FamilyHub Daily Insurer Previews' | Select-Object NextRunTime, LastRunTime, LastTaskResult
Write-Host "Daily insurer previews installed at $At PC local time. Keep this Windows user signed in and the existing worker running. Missed runs start when available; wake depends on Windows power settings."
