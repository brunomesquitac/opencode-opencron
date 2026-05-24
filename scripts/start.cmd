@echo off
cd /d "%~dp0.."
set BUN="%USERPROFILE%\.bun\bin\bun.exe"
set OPENCODE="%APPDATA%\npm\node_modules\opencode-ai\bin\opencode.exe"
set WRAPPER="scripts\supertask-gateway.mjs"
set LOG="scripts\opencron.log"

echo %DATE% %TIME% - Starting OpenCron... >> %LOG%

start "OpenCode-Serve" %OPENCODE% serve --port 4099
timeout /t 12 /nobreak >nul
start "OpenCron-Gateway" %BUN% run %WRAPPER%
echo %DATE% %TIME% - Started >> %LOG%
