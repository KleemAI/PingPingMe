@echo off
title Business Messaging - Android emulator
cd /d "%~dp0"
echo.
echo  ===============================================================
echo    Run the mobile app on the Android emulator (Android Studio)
echo  ===============================================================
echo.

rem ---- 1. find the Android SDK (Android Studio puts it here) ----
if not defined ANDROID_HOME set "ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk"
if not exist "%ANDROID_HOME%\emulator\emulator.exe" (
  echo  [!] Android SDK emulator not found in:
  echo      %ANDROID_HOME%
  echo      Open Android Studio ^> More Actions ^> SDK Manager ^> SDK Tools
  echo      and tick "Android Emulator" and "Android SDK Platform-Tools".
  pause
  exit /b
)
set "ANDROID_SDK_ROOT=%ANDROID_HOME%"
set "PATH=%ANDROID_HOME%\emulator;%ANDROID_HOME%\platform-tools;%PATH%"

rem ---- 2. start an emulator if none is running ----
adb start-server >nul 2>&1
set "RUNNING="
for /f "tokens=1" %%d in ('adb devices ^| findstr /b "emulator-"') do set "RUNNING=%%d"
if defined RUNNING (
  echo  Emulator already running: %RUNNING%
  goto booted
)
set "AVD="
for /f "delims=" %%a in ('emulator -list-avds 2^>nul') do if not defined AVD set "AVD=%%a"
if not defined AVD (
  echo  [!] No emulator found. In Android Studio: More Actions ^> Virtual Device Manager ^> Create device.
  pause
  exit /b
)
echo  Starting emulator %AVD% ...
start "Android emulator" emulator -avd "%AVD%" -netdelay none -netspeed full
echo  Waiting for it to boot (first start can take 1-2 minutes)...
adb wait-for-device
:waitboot
set "BOOT="
for /f %%b in ('adb shell getprop sys.boot_completed 2^>nul') do set "BOOT=%%b"
if not "%BOOT%"=="1" (
  timeout /t 3 /nobreak >nul
  goto waitboot
)
:booted
echo  Emulator ready.

rem ---- 3. let the emulator reach this computer ----
adb reverse tcp:4000 tcp:4000 >nul
adb reverse tcp:8081 tcp:8081 >nul

rem ---- 4. start the backend API (NestJS + Neon) in its own window ----
start "Business Messaging - API" cmd /c ""%~dp0..\backend\start-backend.bat""

rem ---- 5. install new packages if needed, then open the app (installs Expo Go if needed) ----
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
echo  When the app opens in the emulator:
echo    Server address = http://localhost:4000
echo    Tap a demo account (password demo123)
echo.
echo  Keep the windows open. Press r here to reload the app, Ctrl+C to stop.
echo.
call npx expo start --localhost --android --clear
pause
