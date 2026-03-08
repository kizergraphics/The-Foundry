@echo off
setlocal

set "ROOT=%~dp0.."
set "APP_URL=http://localhost:3001"

if not exist "%ROOT%\dist\index.html" (
  echo Frontend build not found. Building production bundle...
  call npm run build
  if errorlevel 1 (
    echo Build failed. Press any key to close this window.
    pause >nul
    exit /b 1
  )
)

start "Kizer Forge" cmd /k "cd /d %ROOT% && set NODE_ENV=production && npm start"
timeout /t 2 /nobreak >nul
start "" "%APP_URL%"

echo Kizer Forge is launching at %APP_URL%
