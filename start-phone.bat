@echo off
title Business Messaging - server
cd /d "%~dp0"
echo.
echo  ==========================================================
echo     Business Messaging - open the MOBILE APP on your phone
echo  ==========================================================
echo.
echo   1. Connect your phone to the SAME Wi-Fi as this computer.
echo   2. On your phone, open Chrome (Android) or Safari (iPhone)
echo      and type ONE of these addresses:
echo.
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do (
  for /f "tokens=* delims= " %%b in ("%%a") do echo          http://%%b:3000/m
)
echo.
echo   3. Sign in with a demo account (password demo123).
echo   4. Optional: browser menu - "Add to Home screen" to install it.
echo.
echo   Phone can't open it? Right-click allow-phone-access.bat
echo   and choose "Run as administrator" (one time only).
echo.
echo   Keep this window open. Press Ctrl+C to stop the server.
echo  ==========================================================
echo.
if not exist node_modules (
  echo Installing packages the first time, please wait...
  call npm install
)
call npm run dev
pause
