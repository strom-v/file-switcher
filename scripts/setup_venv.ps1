# Windows-эквивалент scripts/setup_venv.sh: создаёт .venv и ставит зависимости mitmproxy.
# Использование: powershell -File scripts/setup_venv.ps1 [-Build]
param([switch]$Build)

$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')

$requirements = if ($Build) { 'requirements-build.txt' } else { 'requirements.txt' }

python -m venv .venv
& .\.venv\Scripts\python.exe -m pip install --upgrade pip
& .\.venv\Scripts\pip.exe install -r $requirements

Write-Host "venv готов: .\.venv\Scripts\Activate.ps1"
