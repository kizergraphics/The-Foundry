@echo off
setlocal

set "ROOT=%~dp0.."

start "Kizer Forge Client" cmd /k "cd /d %ROOT% && npm run dev:client"
start "Kizer Forge API" cmd /k "cd /d %ROOT% && npm run dev:server"

echo Launched Kizer Forge client and API in separate windows.
echo Use npm run dev:inline if you want both processes in the current terminal.
