@echo off
setlocal

set "ROOT=%~dp0.."

cd /d "%ROOT%"
node scripts\launch-app.js

if errorlevel 1 (
  echo.
  echo The Foundry desktop launcher hit an error.
  echo Press any key to close this window.
  pause >nul
  exit /b 1
)
