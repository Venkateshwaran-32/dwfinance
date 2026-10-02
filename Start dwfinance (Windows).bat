@echo off
rem Double-click to start dwfinance on Windows.
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo dwfinance needs Node.js, which is free.
  echo The download page is opening now. Install the LTS version, then double-click this file again.
  start "" "https://nodejs.org/en/download"
  pause
  exit /b 1
)
node scripts\start.mjs
echo.
echo dwfinance has stopped.
pause
