@echo off
REM Builds an installable Android APK in Expo's cloud (free account needed: https://expo.dev/signup)
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
echo === 4/4 Building the APK in the cloud (about 10-20 minutes) ===
call npx eas-cli@latest build -p android --profile preview || goto :err
echo.
echo Done! Open the link above on your Android phone (or scan its QR code) to download and install the APK.
pause
exit /b 0
:err
echo.
echo Something went wrong - see the message above.
pause
exit /b 1
