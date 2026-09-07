# Windows-эквивалент scripts/build_mitmdump.sh: собирает mitmdump.exe в resources/bin/win/.
# PyInstaller не кросс-компилирует — этот скрипт запускается на Windows-машине.
# Использование: powershell -File scripts/build_mitmdump.ps1

$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')

if (-not (Test-Path .venv)) {
  Write-Error 'venv не найден, сначала запустите: powershell -File scripts/setup_venv.ps1 -Build'
}

& .\.venv\Scripts\python.exe -c 'import PyInstaller' 2>$null
if ($LASTEXITCODE -ne 0) {
  Write-Error 'PyInstaller не установлен, сначала запустите: powershell -File scripts/setup_venv.ps1 -Build'
}

Remove-Item -Recurse -Force build, resources\bin\win -ErrorAction SilentlyContinue
& .\.venv\Scripts\pyinstaller.exe scripts\mitmdump.spec --distpath resources\bin\win --workpath build --noconfirm

Write-Host 'standalone-бинарник собран: resources\bin\win\mitmdump.exe'
