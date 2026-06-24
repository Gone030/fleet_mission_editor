@echo off
setlocal

cd /d "%~dp0"

echo Fleet Mission Editor
echo Project root: %CD%
echo.

where py >nul 2>nul
if %ERRORLEVEL% EQU 0 (
  set "PY_CMD=py -3"
) else (
  where python >nul 2>nul
  if %ERRORLEVEL% EQU 0 (
    set "PY_CMD=python"
  ) else (
    echo ERROR: Python 3 was not found.
    echo Install Python 3, then run this batch file again.
    echo.
    pause
    exit /b 1
  )
)

if not exist ".venv\Scripts\python.exe" (
  echo Creating .venv...
  %PY_CMD% -m venv .venv
  if %ERRORLEVEL% NEQ 0 (
    echo ERROR: failed to create .venv.
    echo.
    pause
    exit /b 1
  )
)

set "VENV_PY=%CD%\.venv\Scripts\python.exe"

echo Installing backend requirements...
"%VENV_PY%" -m pip install -r backend\requirements.txt
if %ERRORLEVEL% NEQ 0 (
  echo ERROR: failed to install backend requirements.
  echo.
  pause
  exit /b 1
)

set "URL=http://127.0.0.1:8000"
echo.
echo Opening %URL% ...
start "" powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 1; Start-Process '%URL%'"

echo Starting FastAPI backend. Keep this Command Prompt window open.
echo Stop server: Ctrl-C
echo.
"%VENV_PY%" -m uvicorn backend.server:app --host 127.0.0.1 --port 8000
set "SERVER_STATUS=%ERRORLEVEL%"

echo.
echo Backend stopped with status %SERVER_STATUS%.
pause
