# Installs or updates Tourney (website + bridge) on Windows 10/11 or Windows Server.
# Run in an administrator PowerShell from the unpacked release bundle:
#   powershell -ExecutionPolicy Bypass -File .\deploy\windows\install.ps1 -UT "C:\UnrealTournament"
# Options: -InstallDir C:\Tourney  -Port 8080  -PublicUrl http://...  -NoWebsite  -NoBridge
# Running it again updates the program files; config\ and data\ are kept.
param(
  [string]$InstallDir = 'C:\Tourney',
  [string]$UT = 'C:\UnrealTournament',
  [int]$Port = 8080,
  [string]$PublicUrl = '',
  [switch]$NoWebsite,
  [switch]$NoBridge
)
$ErrorActionPreference = 'Stop'

function Say($msg) { Write-Host "`n==> $msg" -ForegroundColor Yellow }

$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
  [Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) { throw 'Run this in a PowerShell started as administrator.' }

$bundle = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
if (-not (Test-Path (Join-Path $bundle 'website\dist\main.js'))) {
  throw "Run this from an unpacked release bundle (tourney-<version>), see docs\install-windows.md"
}
$version = (Get-Content (Join-Path $bundle 'VERSION') -ErrorAction SilentlyContinue | Select-Object -First 1)
# The address of the adapter with the default gateway (not a WSL/Hyper-V virtual adapter).
$ip = (Get-NetIPConfiguration -ErrorAction SilentlyContinue |
  Where-Object { $_.IPv4DefaultGateway -and $_.IPv4Address } |
  Select-Object -First 1).IPv4Address.IPAddress
if (-not $ip) { $ip = '127.0.0.1' }
if (-not $PublicUrl) { $PublicUrl = "http://${ip}:$Port" }
Write-Host "Tourney $version ($ip)"

# --- Node.js ---------------------------------------------------------------------------------
Say 'Node.js'
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { throw 'Node.js is missing. Install Node.js 22 LTS: winget install OpenJS.NodeJS.LTS  (then open a new PowerShell)' }
$nv = (& node -p 'process.versions.node').Trim().Split('.')
if ([int]$nv[0] -lt 22 -or ([int]$nv[0] -eq 22 -and [int]$nv[1] -lt 12)) {
  throw "Node.js $($nv -join '.') is too old, 22.12 or newer is needed (winget upgrade OpenJS.NodeJS.LTS)"
}
Write-Host "node $($nv -join '.') at $node"

# --- program files ---------------------------------------------------------------------------
Say "Program files -> $InstallDir"
# Files from a downloaded zip carry the "from the internet" mark: scripts would not run.
Get-ChildItem $bundle -Recurse -File | Unblock-File
if (Test-Path (Join-Path $InstallDir 'deploy\windows\tourney.ps1')) {
  & (Join-Path $InstallDir 'deploy\windows\tourney.ps1') stop all -InstallDir $InstallDir
}
foreach ($d in 'website', 'bridge', 'mod', 'deploy', 'docs') {
  robocopy (Join-Path $bundle $d) (Join-Path $InstallDir $d) /MIR /XD node_modules /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "copying $d failed (robocopy $LASTEXITCODE)" }
}
Copy-Item (Join-Path $bundle 'VERSION'), (Join-Path $bundle 'README.md') $InstallDir -Force
foreach ($d in 'config', 'data\website', 'data\bridge', 'logs') {
  New-Item -ItemType Directory -Force -Path (Join-Path $InstallDir $d) | Out-Null
}
# Everything here runs as SYSTEM and config\ holds secrets: only administrators and SYSTEM may
# change or read it (a new folder under C:\ would let every user modify it).
& icacls $InstallDir /inheritance:r /grant:r '*S-1-5-32-544:(OI)(CI)F' '*S-1-5-18:(OI)(CI)F' /T /C /Q | Out-Null

Say 'npm dependencies'
foreach ($d in 'website', 'bridge') {
  if (($d -eq 'website' -and $NoWebsite) -or ($d -eq 'bridge' -and $NoBridge)) { continue }
  Push-Location (Join-Path $InstallDir $d)
  try {
    & npm ci --omit=dev --no-audit --no-fund --loglevel=error
    if ($LASTEXITCODE -ne 0) { throw "npm ci failed in $d" }
  } finally { Pop-Location }
}

# --- settings --------------------------------------------------------------------------------
$conf = Join-Path $InstallDir 'config'
$websiteEnv = Join-Path $conf 'website.env'
$bridgeJson = Join-Path $conf 'bridge.json'
if (-not $NoWebsite -and -not (Test-Path $websiteEnv)) {
  Say "Settings $websiteEnv"
  $dataDir = (Join-Path $InstallDir 'data\website') -replace '\\', '/'
  (Get-Content (Join-Path $InstallDir 'website\.env.example')) `
    -replace '^PUBLIC_URL=.*', "PUBLIC_URL=$PublicUrl" `
    -replace '^PORT=.*', "PORT=$Port" `
    -replace '^DATA_DIR=.*', "DATA_DIR=$dataDir" |
    Set-Content -Path $websiteEnv -Encoding ASCII
  Write-Host 'created (add your Discord application there, see docs)'
}
if (-not $NoBridge -and -not (Test-Path $bridgeJson)) {
  Say "Settings $bridgeJson"
  $c = Get-Content (Join-Path $InstallDir 'bridge\bridge.example.json') -Raw | ConvertFrom-Json
  $bytes = New-Object byte[] 24
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $c.mod.sharedKey = ([Convert]::ToBase64String($bytes) -replace '[^A-Za-z0-9]', '')
  $c.dataDir = (Join-Path $InstallDir 'data\bridge')
  $c.server.os = 'windows'
  $c.server.installDir = $UT
  $c.server.publicAddress = "${ip}:7777"
  $c.website.url = "ws://127.0.0.1:$Port/api/agent"
  # UTF-8 without BOM (Windows PowerShell 5.1 would write a BOM with -Encoding UTF8).
  [IO.File]::WriteAllText($bridgeJson, ($c | ConvertTo-Json -Depth 5), (New-Object Text.UTF8Encoding $false))
  Write-Host 'created (agentId and token come from the website, see below)'
}

# --- scheduled tasks (start with Windows, restart after a crash) -------------------------------
function Register-TourneyTask($name, $dir, $nodeArgs, $log) {
  # cmd loop: node is started again 5 s after it ended (crash, restart by the program itself).
  $cmd = "/c for /l %i in (0,0,1) do (`"$node`" $nodeArgs >> `"$log`" 2>&1 & ping -n 6 127.0.0.1 >nul)"
  $action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument $cmd -WorkingDirectory $dir
  $trigger = New-ScheduledTaskTrigger -AtStartup
  $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
  $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 `
    -RestartInterval (New-TimeSpan -Minutes 1) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -Priority 4  # normal priority (the default 7 would slow down the game server)
  Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Principal $principal `
    -Settings $settings -Force | Out-Null
}

Say 'Scheduled tasks'
if (-not $NoWebsite) {
  Register-TourneyTask 'Tourney Website' (Join-Path $InstallDir 'website') `
    "--env-file=`"$websiteEnv`" dist\main.js" (Join-Path $InstallDir 'logs\website.log')
  Start-ScheduledTask -TaskName 'Tourney Website'
  Write-Host "Tourney Website: started ($PublicUrl, log: $InstallDir\logs\website.log)"
}
$bridgeReady = $false
if (-not $NoBridge) {
  Register-TourneyTask 'Tourney Bridge' (Join-Path $InstallDir 'bridge') `
    "dist\cli.js run -c `"$bridgeJson`"" (Join-Path $InstallDir 'logs\bridge.log')
  if (Select-String -Path $bridgeJson -Pattern 'PASTE-THE-TOKEN' -Quiet) {
    Disable-ScheduledTask -TaskName 'Tourney Bridge' | Out-Null
    Write-Host 'Tourney Bridge: not started yet (no website token in config\bridge.json)'
  } elseif (-not (Test-Path (Join-Path $UT 'System'))) {
    Disable-ScheduledTask -TaskName 'Tourney Bridge' | Out-Null
    Write-Host "Tourney Bridge: not started yet (no UT installation in $UT)"
  } else {
    Enable-ScheduledTask -TaskName 'Tourney Bridge' | Out-Null
    Start-ScheduledTask -TaskName 'Tourney Bridge'
    $bridgeReady = $true
    Write-Host "Tourney Bridge: started (log: $InstallDir\logs\bridge.log)"
  }
}

# --- firewall ----------------------------------------------------------------------------------
Say 'Firewall'
if (-not $NoBridge -and -not (Get-NetFirewallRule -DisplayName 'Tourney UT server' -ErrorAction SilentlyContinue)) {
  New-NetFirewallRule -DisplayName 'Tourney UT server' -Direction Inbound -Protocol UDP -LocalPort 7777-7779 -Action Allow | Out-Null
  Write-Host 'UDP 7777-7779 (UT server) opened'
}
if (-not $NoWebsite) {
  # Recreated, so a changed -Port does not leave the old port open.
  Remove-NetFirewallRule -DisplayName 'Tourney website' -ErrorAction SilentlyContinue
  New-NetFirewallRule -DisplayName 'Tourney website' -Direction Inbound -Protocol TCP -LocalPort $Port -Action Allow | Out-Null
  Write-Host "TCP $Port (website) opened"

Say "Done: Tourney $version"
if (-not $NoBridge -and -not $bridgeReady) {
  Write-Host @"
Next steps for the bridge:
  1. UT server: install UT99 with the OldUnreal 469f patch in $UT and build the mod:
       powershell -ExecutionPolicy Bypass -File $InstallDir\mod\build.ps1 -UT "$UT"
  2. Website: Servers -> Add a game server; put "agentId" and "token" into $bridgeJson
  3. Start:   powershell -ExecutionPolicy Bypass -File $InstallDir\deploy\windows\tourney.ps1 start bridge
"@
}
