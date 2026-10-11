# Builds the UTTourney package with ucc make (Windows, UT99 469).
# Usage: .\build.ps1 -UT "C:\UnrealTournament"
# Result: <UT>\System\UTTourney_v1.u   (does not modify your UnrealTournament.ini)
param([Parameter(Mandatory = $true)][string]$UT)
$ErrorActionPreference = 'Stop'
$Pkg = 'UTTourney_v1'

$ucc = @('System64\UCC.exe', 'System\UCC64.exe', 'System\UCC.exe') |
  ForEach-Object { Join-Path $UT $_ } | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $ucc) { throw "no UCC.exe found under $UT" }
$sysDir = Split-Path $ucc
Write-Host "using $ucc"

$pkgDir = Join-Path $UT $Pkg
if (Test-Path $pkgDir) { Remove-Item $pkgDir -Recurse -Force }
New-Item -ItemType Directory -Path (Join-Path $pkgDir 'Classes') | Out-Null
Copy-Item (Join-Path $PSScriptRoot 'Classes\*.uc') (Join-Path $pkgDir 'Classes')
Remove-Item (Join-Path $sysDir "$Pkg.u") -ErrorAction SilentlyContinue

$src = Join-Path $sysDir 'UnrealTournament.ini'
if (-not (Test-Path $src)) { $src = Join-Path $UT 'System\UnrealTournament.ini' }
$out = New-Object System.Collections.Generic.List[string]
$inSec = $false; $done = $false
foreach ($line in Get-Content $src) {
  if ($line.StartsWith('[')) {
    if ($inSec -and -not $done) { $out.Add("EditPackages=$Pkg"); $done = $true }
    $inSec = ($line -eq '[Editor.EditorEngine]')
  }
  if (-not ($inSec -and $line -eq "EditPackages=$Pkg")) { $out.Add($line) }
}
if ($inSec -and -not $done) { $out.Add("EditPackages=$Pkg") }
Set-Content -Path (Join-Path $sysDir 'TourneyMake.ini') -Value $out -Encoding ASCII

Push-Location $sysDir
try { & $ucc make ini=TourneyMake.ini } finally { Pop-Location }

if (Test-Path (Join-Path $sysDir "$Pkg.u")) { Write-Host "built $(Join-Path $sysDir "$Pkg.u")" }
else { throw 'build failed, see output above' }
