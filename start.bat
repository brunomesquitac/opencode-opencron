@echo off
cd /d "%~dp0"
set BUN="%USERPROFILE%\.bun\bin\bun.exe"
set OPENCODE="%APPDATA%\npm\node_modules\opencode-ai\bin\opencode.exe"

echo Starting OpenCode server on :4099...
start "OpenCode-Serve" cmd /c %OPENCODE% serve --port 4099

timeout /t 10 /nobreak >nul

echo Starting OpenCron Gateway on :4680...
start "OpenCron-Gateway" cmd /c %BUN% run scripts\gateway.mjs

timeout /t 8 /nobreak >nul

echo.
echo ========================================
echo  OpenCode serve: http://localhost:4099
echo  OpenCron Dashboard: http://localhost:4680
echo ========================================
echo.
echo Press any key to stop all services...
pause >nul

echo Stopping...
taskkill /fi "WINDOWTITLE eq OpenCode-Serve" /f >nul 2>&1
taskkill /fi "WINDOWTITLE eq OpenCron-Gateway" /f >nul 2>&1
echo Done.
