param([Parameter(Mandatory=$true)][string]$DataDirectory, [string]$At = '09:00', [string]$NodePath = 'node', [int]$Port = 4713)
$ErrorActionPreference = 'Stop'
$resolvedData = [IO.Path]::GetFullPath($DataDirectory)
if (-not (Test-Path -LiteralPath (Join-Path $resolvedData 'pairing-key.txt'))) { throw 'Use the existing worker DataDirectory.' }
if ((Get-TimeZone).Id -notin @('Pacific Standard Time','America/Vancouver')) { throw 'This daily schedule requires the PC Pacific time zone.' }
$node = (Get-Command $NodePath -ErrorAction Stop).Source
$runner = Join-Path $PSScriptRoot 'Run-SavingsResearch.ps1'
foreach ($value in @($resolvedData, $node, $runner)) { if ($value.Contains('"')) { throw 'Paths cannot contain quotes.' } }
$arguments = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + $runner + '" -DataDirectory "' + $resolvedData + '" -NodePath "' + $node + '" -Port ' + $Port
$action = New-ScheduledTaskAction -Execute (Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe') -Argument $arguments
$trigger = New-ScheduledTaskTrigger -Daily -At ([datetime]::ParseExact($At, 'HH:mm', [Globalization.CultureInfo]::InvariantCulture))
$principal = New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -WakeToRun -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 130) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$taskName = 'FamilyHub Daily Savings Research'
$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existing -and ($existing.Actions.Execute -ne $action.Execute -or $existing.Actions.Arguments -ne $arguments)) { throw 'An existing Savings task uses a different configuration; preserve it for review.' }
Register-ScheduledTask -TaskName $taskName -Description 'Daily public offers for shared contracts through the existing FamilyHub agent. No provider contact or financial apply.' -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
$directory = Join-Path $resolvedData 'savings'
New-Item -ItemType Directory -Path $directory -Force | Out-Null
$schedule = @{ enabled=$true; at=$At; timeZone='America/Vancouver'; taskName=$taskName; configuredAt=[datetime]::UtcNow.ToString('o') } | ConvertTo-Json
[IO.File]::WriteAllText((Join-Path $directory 'schedule.json.tmp'), $schedule)
Move-Item -LiteralPath (Join-Path $directory 'schedule.json.tmp') -Destination (Join-Path $directory 'schedule.json') -Force
Get-ScheduledTaskInfo -TaskName $taskName | Select-Object NextRunTime, LastRunTime, LastTaskResult
Write-Host "Daily Savings research installed at $At Pacific time. Keep this Windows user signed in and the existing worker running."
