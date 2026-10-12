# Starts, stops and shows the Tourney services on Windows (scheduled tasks "Tourney Website" and
# "Tourney Bridge" created by install.ps1). Run in an administrator PowerShell:
#   C:\Tourney\deploy\windows\tourney.ps1 status
#   C:\Tourney\deploy\windows\tourney.ps1 restart website
#   C:\Tourney\deploy\windows\tourney.ps1 start bridge
param(
  [ValidateSet('status', 'start', 'stop', 'restart')][string]$Action = 'status',
  [ValidateSet('all', 'website', 'bridge')][string]$App = 'all',
  [string]$InstallDir = ''
)
$ErrorActionPreference = 'Stop'
# Default: the installation this script belongs to (<InstallDir>\deploy\windows\tourney.ps1).
if (-not $InstallDir) { $InstallDir = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path }

$apps = if ($App -eq 'all') { @('website', 'bridge') } else { @($App) }
$taskName = @{ website = 'Tourney Website'; bridge = 'Tourney Bridge' }
# What identifies the processes of an app in their command line.
$marker = @{ website = 'website.env'; bridge = 'bridge.json' }

function Get-AppProcesses($a) {
  Get-CimInstance Win32_Process -Filter "Name = 'node.exe' OR Name = 'cmd.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like "*$InstallDir*" -and $_.CommandLine -like "*$($marker[$a])*" }
}

function Stop-App($a) {
  $t = Get-ScheduledTask -TaskName $taskName[$a] -ErrorAction SilentlyContinue
  if ($t) {
    Stop-ScheduledTask -TaskName $taskName[$a] -ErrorAction SilentlyContinue
    # Disabled, so "restart on failure" does not bring it back; Start-App enables it again.
    Disable-ScheduledTask -TaskName $taskName[$a] -ErrorAction SilentlyContinue | Out-Null
  }
  # Stopping a task does not end the processes it started: end the loop and node ourselves.
  Get-AppProcesses $a | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  if ($a -eq 'bridge') {
    # The UT server the bridge started (it runs with Tourney.ini).
    Get-CimInstance Win32_Process -Filter "Name LIKE 'UCC%'" -ErrorAction SilentlyContinue |
      Where-Object { $_.CommandLine -like '*Tourney.ini*' } |
      ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  }
}

function Start-App($a) {
  $t = Get-ScheduledTask -TaskName $taskName[$a] -ErrorAction SilentlyContinue
  if (-not $t) { throw "task '$($taskName[$a])' does not exist: run install.ps1" }
  if (Get-AppProcesses $a) { Write-Host "$a is already running"; return }
  Enable-ScheduledTask -TaskName $taskName[$a] | Out-Null
  Start-ScheduledTask -TaskName $taskName[$a]
}

foreach ($a in $apps) {
  switch ($Action) {
    'stop' { Stop-App $a; Write-Host "$a stopped" }
    'start' { Start-App $a; Write-Host "$a started (log: $InstallDir\logs\$a.log)" }
    'restart' { Stop-App $a; Start-Sleep -Seconds 2; Start-App $a; Write-Host "$a restarted" }
    'status' {
      $t = Get-ScheduledTask -TaskName $taskName[$a] -ErrorAction SilentlyContinue
      $state = if ($t) { $t.State } else { 'not installed' }
      $running = [bool](Get-AppProcesses $a | Where-Object { $_.Name -eq 'node.exe' })
      Write-Host ("{0,-8} task: {1,-12} node running: {2}" -f $a, $state, $running)
    }
  }
}
