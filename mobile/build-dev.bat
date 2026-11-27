@echo off
rem keep this window open whatever happens
if /i not "%~1"=="__keep" (
  cmd /k ""%~f0" __keep"
  exit /b
)
title Business Messaging - development build
REM Builds the DEVELOPMENT app (like Expo Go, but with this app's own native code, e.g. spoken to-do reminders).
REM Build it ONCE, install it on the phone, then use run-dev.bat every day. Build again only when native code
REM changes (modules\ folder, a new expo-* package, app.json plugins).
REM Needs a free Expo account: https://expo.dev/signup
cd /d "%~dp0"
echo.
echo === 1/4 Installing packages ===
call npm install || goto :err
echo.
echo === 2/4 Sign in to your Expo account ===
call npx eas-cli@latest login || goto :err
echo.
echo === 3/4 Linking this app to your Expo account (answer Y if asked) ===
call npx eas-cli@latest init || goto :err
echo.
echo === 4/4 Building the development app in the cloud (about 10-20 minutes) ===
call npx eas-cli@latest build -p android --profile development || goto :err
echo.
echo Done! Open the link above on your Android phone (or scan its QR code), download and install the APK.
echo The installed app is called "Business Messaging". Then run run-dev.bat on this computer.
pause
exit /b 0
:err
echo.
echo Something went wrong - see the message above.
pause
exit /b 1
