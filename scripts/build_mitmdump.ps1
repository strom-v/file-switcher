# Windows-эквивалент scripts/build_mitmdump.sh: собирает mitmdump.exe в resources/bin/win/.
# PyInstaller не кросс-компилирует — этот скрипт запускается на Windows-машине.
# Использование: powershell -File scripts/build_mitmdump.ps1 [-Force]

param([switch]$Force)

$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')

# бинарник закоммичен в репозиторий — по умолчанию ничего не пересобираем, чтобы свежий клон
# собирался без Python/PyInstaller; пересборка (после обновления mitmproxy) — с флагом -Force
if (-not $Force -and (Test-Path 'resources\bin\win\mitmdump.exe')) {
  Write-Host 'resources\bin\win\mitmdump.exe уже существует — пропускаю (пересборка: -Force)'
  exit 0
}

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
