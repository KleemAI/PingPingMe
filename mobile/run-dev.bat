@echo off
rem keep this window open whatever happens
if /i not "%~1"=="__keep" (
  cmd /k ""%~f0" __keep"
  exit /b
)
title Business Messaging - development app (Wi-Fi)
cd /d "%~dp0"
echo.
echo  ===============================================================
echo    Run the app in the DEVELOPMENT build (install it first with build-dev.bat)
echo    Phone and computer must be on the same Wi-Fi.
echo  ===============================================================
echo.

rem ---- 1. this computer's Wi-Fi address ----
set "IP="
for /f "usebackq delims=" %%i in (`powershell -NoProfile -Command "(Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway -and $_.NetAdapter.Status -eq 'Up' } | Select-Object -First 1).IPv4Address.IPAddress"`) do set "IP=%%i"
if not defined IP (
  echo  [!] Could not find this computer's Wi-Fi address. Is it connected to Wi-Fi?
  pause
  exit /b
)
echo  This computer: %IP%

rem ---- 2. backend API (port 4000) in its own window, unless it already runs ----
netstat -ano | findstr /r /c:":4000 .*LISTENING" >nul
if %errorlevel%==0 (
  echo  Backend API is already running on port 4000 - using it.
) else (
  start "Business Messaging - API" cmd /c ""%~dp0..\backend\start-backend.bat""
)

rem ---- 3. voice service for spoken to-do titles (port 4100) in its own window, unless it already runs ----
netstat -ano | findstr /r /c:":4100 .*LISTENING" >nul
if %errorlevel%==0 (
  echo  Voice service is already running on port 4100 - using it.
) else (
  start "Business Messaging - voice" cmd /c ""%~dp0..\tts\start-tts.bat""
)

rem ---- 4. app packages ----
if not exist node_modules\expo-dev-client (
  echo  Installing app packages, please wait...
  call npm install
)

set "EXPO_PUBLIC_API_URL=http://%IP%:4000"
echo.
echo  On the phone:
echo    1. Open the "Business Messaging" app (the development build, NOT Expo Go)
echo    2. Tap the server it finds, or scan the QR code below with the phone camera
echo    3. On the login screen: Server address = http://%IP%:4000
echo       Tap a demo account (password demo123)
echo.
echo  If the phone can't connect: allow Node.js through Windows Firewall (Private networks).
echo  Keep all windows open. Press r here to reload the app, Ctrl+C to stop.
echo.
call npx expo start --dev-client --lan --clear
pause
