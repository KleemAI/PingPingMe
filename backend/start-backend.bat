@echo off
title Business Messaging API - NestJS + Neon + Socket.IO
cd /d "%~dp0"

rem ---- already running? ----
powershell -NoProfile -Command "try { Invoke-RestMethod http://localhost:4000/api/v1/health -TimeoutSec 3 | Out-Null; exit 0 } catch { exit 1 }" >nul 2>nul
if not errorlevel 1 goto already

where node >nul 2>nul
if errorlevel 1 goto nonode
if not exist .env goto noenv
findstr /c:"PASTE_YOUR_NEON" .env >nul
if not errorlevel 1 goto nourl

if exist node_modules goto run
echo Installing packages the first time, please wait 1-2 minutes...
call npm install
if errorlevel 1 goto installfailed

:run
echo.
echo  Starting the API on http://localhost:4000/api/v1 ...
echo  Keep this window open. Press Ctrl+C to stop.
echo.
call npm run start:dev
echo.
echo  The API stopped. If you see red error text above, copy it and send it to Claude.
pause
exit /b

:nonode
echo.
echo  [!] Node.js is not installed. Install the LTS version from https://nodejs.org
echo      then double-click this file again.
echo.
pause
exit /b

:noenv
echo.
echo  [!] backend\.env is missing.
echo      Copy .env.example to .env and paste your Neon connection string into DATABASE_URL.
echo.
pause
exit /b

:nourl
echo.
echo  [!] DATABASE_URL in backend\.env is not set yet.
echo      Open backend\.env in Notepad and replace PASTE_YOUR_NEON_CONNECTION_STRING_HERE
echo      with your Neon connection string from neon.tech - your project - Connect.
echo.
pause
exit /b

:installfailed
echo.
echo  [!] npm install failed. Copy the red error text above and send it to Claude.
echo.
pause
exit /b

:already
echo.
echo  The backend is ALREADY RUNNING on http://localhost:4000 - nothing to do.
echo  Use the window where it is running. To restart it: close that window, then run this file again.
echo.
pause
exit /b
