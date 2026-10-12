# Builds the tournament packages with ucc make (Windows, UT99 469).
# Usage: .\build.ps1 -UT "C:\UnrealTournament"
# Result: <UT>\System\UTTourney_v1.u, and UTTourneyMH_v1.u (Monster Hunt) if MonsterHunt.u is installed.
# Does not modify your UnrealTournament.ini.
param([Parameter(Mandatory = $true)][string]$UT)
$ErrorActionPreference = 'Stop'
$Pkg = 'UTTourney_v1'
$MhPkg = 'UTTourneyMH_v1'

$ucc = @('System64\UCC.exe', 'System\UCC64.exe', 'System\UCC.exe') |
  ForEach-Object { Join-Path $UT $_ } | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $ucc) { throw "no UCC.exe found under $UT" }
$sysDir = Split-Path $ucc
Write-Host "using $ucc"

# Monster Hunt package only where Monster Hunt 613 is installed.
$withMh = (Test-Path (Join-Path $sysDir 'MonsterHunt.u')) -or (Test-Path (Join-Path $UT 'System\MonsterHunt.u'))

foreach ($p in @($Pkg, $MhPkg)) {
  $dir = Join-Path $UT $p
  if (Test-Path $dir) { Remove-Item $dir -Recurse -Force }
  Remove-Item (Join-Path $sysDir "$p.u") -ErrorAction SilentlyContinue
}
New-Item -ItemType Directory -Path (Join-Path $UT "$Pkg\Classes") | Out-Null
Copy-Item (Join-Path $PSScriptRoot 'Classes\*.uc') (Join-Path $UT "$Pkg\Classes")
if ($withMh) {
  New-Item -ItemType Directory -Path (Join-Path $UT "$MhPkg\Classes") | Out-Null
  Copy-Item (Join-Path $PSScriptRoot 'MH\Classes\*.uc') (Join-Path $UT "$MhPkg\Classes")
} else {
  Write-Host "MonsterHunt.u not found: building without the Monster Hunt package ($MhPkg)"
}

$src = Join-Path $sysDir 'UnrealTournament.ini'
if (-not (Test-Path $src)) { $src = Join-Path $UT 'System\UnrealTournament.ini' }
$lines = Get-Content $src
$out = New-Object System.Collections.Generic.List[string]
$inSec = $false; $done = $false; $hasMh = $false
foreach ($line in $lines) {
  if ($line.StartsWith('[')) {
    if ($inSec -and -not $done) {
      $out.Add("EditPackages=$Pkg")
      if ($withMh) { if (-not $hasMh) { $out.Add('EditPackages=MonsterHunt') }; $out.Add("EditPackages=$MhPkg") }
      $done = $true
    }
    $inSec = ($line -eq '[Editor.EditorEngine]')
  }
  if ($inSec -and $line -eq 'EditPackages=MonsterHunt') { $hasMh = $true }
  if (-not ($inSec -and ($line -eq "EditPackages=$Pkg" -or $line -eq "EditPackages=$MhPkg"))) { $out.Add($line) }
}
if ($inSec -and -not $done) {
  $out.Add("EditPackages=$Pkg")
  if ($withMh) { if (-not $hasMh) { $out.Add('EditPackages=MonsterHunt') }; $out.Add("EditPackages=$MhPkg") }
}
Set-Content -Path (Join-Path $sysDir 'TourneyMake.ini') -Value $out -Encoding ASCII

Push-Location $sysDir
try { & $ucc make ini=TourneyMake.ini } finally { Pop-Location }

if (-not (Test-Path (Join-Path $sysDir "$Pkg.u"))) { throw 'build failed, see output above' }
Write-Host "built $(Join-Path $sysDir "$Pkg.u")"
if ($withMh) {
  if (-not (Test-Path (Join-Path $sysDir "$MhPkg.u"))) { throw "build of $MhPkg failed, see output above" }
  Write-Host "built $(Join-Path $sysDir "$MhPkg.u")"
}
