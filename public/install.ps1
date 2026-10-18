# Installs Odaja's companion (odaja.exe) on Windows, in PowerShell:
#
#   irm https://atanasovskipetar.github.io/odaja/install.ps1 | iex
#
# It downloads the program from the latest GitHub Release into
# %LOCALAPPDATA%\Programs\Odaja and adds that folder to your PATH.
# Run it again to update.
$ErrorActionPreference = "Stop"
$base = if ($env:ODAJA_RELEASE_URL) { $env:ODAJA_RELEASE_URL } else { "https://github.com/AtanasovskiPetar/odaja/releases/latest/download" }
$dir = Join-Path $env:LOCALAPPDATA "Programs\Odaja"
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$exe = Join-Path $dir "odaja.exe"

Write-Host "Downloading Odaja for Windows..."
Invoke-WebRequest -Uri "$base/odaja-windows-x64.exe" -OutFile $exe -UseBasicParsing

$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if (-not (($userPath -split ";") -contains $dir)) {
  [Environment]::SetEnvironmentVariable("Path", (($userPath, $dir) | Where-Object { $_ }) -join ";", "User")
  $env:Path += ";$dir"
}

Write-Host ""
Write-Host "Odaja is installed: $exe"
Write-Host "Start it with:  odaja"
