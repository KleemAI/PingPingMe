@echo off
title Business Messaging - Android phone (USB developer mode)
cd /d "%~dp0"
echo.
echo  ===============================================================
echo    Run the mobile app on your Android phone over USB
echo  ===============================================================
echo.

rem ---- 1. find adb (Android platform-tools) ----
where adb >nul 2>&1
if %errorlevel%==0 goto haveadb
if exist "%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe" (
  set "ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk"
  set "PATH=%LOCALAPPDATA%\Android\Sdk\platform-tools;%PATH%"
  goto haveadb
)
if exist "C:\platform-tools\adb.exe" (
  set "PATH=C:\platform-tools;%PATH%"
  goto haveadb
)
echo  [!] adb was not found.
echo      Download "SDK Platform-Tools for Windows" from:
echo      https://developer.android.com/tools/releases/platform-tools
echo      and unzip it so this file exists:  C:\platform-tools\adb.exe
echo      Then run this file again.
echo.
pause
exit /b

:haveadb
rem ---- 2. check the phone is connected with USB debugging ----
adb start-server >nul 2>&1
set "STATE="
for /f %%s in ('adb get-state 2^>nul') do set "STATE=%%s"
if /i not "%STATE%"=="device" (
  echo  [!] No phone found. Check:
  echo      - Phone connected with a USB DATA cable
  echo      - Settings ^> Developer options ^> USB debugging = ON
  echo      - On the phone, tap "Allow" on the "Allow USB debugging?" popup
  echo      - USB mode set to "File transfer" if it asks
  echo.
  adb devices
  pause
  exit /b
)
echo  Phone connected.

rem ---- 3. let the phone reach this computer through the USB cable ----
adb reverse tcp:4000 tcp:4000 >nul
adb reverse tcp:8081 tcp:8081 >nul
echo  USB tunnel ready (phone localhost:4000 and :8081 -^> this computer).

rem ---- 4. start the backend API (NestJS + Neon) in its own window ----
rem    (skipped when something already listens on port 4000 - the API is running already)
netstat -ano | findstr /r /c:":4000 .*LISTENING" >nul
if %errorlevel%==0 (
  echo  Backend API is already running on port 4000 - using it.
) else (
  start "Business Messaging - API" cmd /c ""%~dp0..\backend\start-backend.bat""
)

rem ---- 5. start the app on the phone (installs Expo Go if needed) ----
rem new packages (e.g. expo-audio for voice notes) are installed automatically
set NEED_INSTALL=
if not exist node_modules\socket.io-client set NEED_INSTALL=1
if not exist node_modules\expo-audio set NEED_INSTALL=1
if not exist node_modules\expo-asset set NEED_INSTALL=1
if not exist node_modules\expo-notifications set NEED_INSTALL=1
if not exist node_modules\@react-native-community\datetimepicker set NEED_INSTALL=1
if not exist node_modules\expo-image-manipulator set NEED_INSTALL=1
if defined NEED_INSTALL (
  echo  Installing app packages, please wait...
  call npm install
)
set "EXPO_PUBLIC_API_URL=http://localhost:4000"
echo.
echo  When the app opens on the phone:
echo    Server address = http://localhost:4000
echo    Tap a demo account (password demo123)
echo.
echo  Keep both windows open. Press r here to reload the app, Ctrl+C to stop.
echo.
call npx expo start --localhost --android --clear
pause
