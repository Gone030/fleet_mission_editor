@echo off
setlocal

cd /d "%~dp0\..\.."

echo Fleet Mission Editor Desktop Build
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

set "PYTHON=%CD%\.venv\Scripts\python.exe"

echo Installing build requirements and building app...
powershell -NoProfile -ExecutionPolicy Bypass -File "%CD%\desktop\windows\build_desktop_windows.ps1"
set "BUILD_STATUS=%ERRORLEVEL%"

echo.
if "%BUILD_STATUS%"=="0" (
  echo Build complete.
  echo Opening dist folder...
  start "" "%CD%\dist"
) else (
  echo Build failed with status %BUILD_STATUS%.
)

echo.
pause
exit /b %BUILD_STATUS%
