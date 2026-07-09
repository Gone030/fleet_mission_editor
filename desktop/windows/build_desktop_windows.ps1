$ErrorActionPreference = "Stop"

Set-Location -Path (Resolve-Path (Join-Path $PSScriptRoot "..\.."))

$AppName = "FleetMissionEditor"
if ($env:PYTHON) {
  $Python = $env:PYTHON
} else {
  if (-not (Test-Path ".venv\Scripts\python.exe")) {
    $BasePython = if (Get-Command py -ErrorAction SilentlyContinue) { "py -3" } else { "python" }
    Invoke-Expression "$BasePython -m venv .venv"
  }
  $Python = Join-Path (Get-Location) ".venv\Scripts\python.exe"
}

$env:PYINSTALLER_CONFIG_DIR = Join-Path (Get-Location) ".pyinstaller"

& $Python -m pip install -r backend\requirements.txt

Get-ChildItem -Path . -Recurse -Force -Directory -Filter "__pycache__" | Remove-Item -Recurse -Force
Get-ChildItem -Path . -Recurse -Force -File -Include "*.pyc", ".DS_Store" | Remove-Item -Force

& $Python -m PyInstaller `
  --noconfirm `
  --clean `
  --windowed `
  --noconsole `
  --name $AppName `
  --hidden-import backend.server `
  --add-data "index.html;." `
  --add-data "src;src" `
  --add-data "backend;backend" `
  desktop/launcher.py

Write-Host "Built dist\$AppName\$AppName.exe or dist\$AppName.exe"
