@echo off
net session >nul 2>&1
if %errorlevel% neq 0 (
  echo.
  echo  Please RIGHT-CLICK this file and choose "Run as administrator".
  echo.
  pause
  exit /b
)
netsh advfirewall firewall delete rule name="Business Messaging (port 3000)" >nul 2>&1
netsh advfirewall firewall add rule name="Business Messaging (port 3000)" dir=in action=allow protocol=TCP localport=3000 profile=any
netsh advfirewall firewall delete rule name="Business Messaging API (port 4000)" >nul 2>&1
netsh advfirewall firewall add rule name="Business Messaging API (port 4000)" dir=in action=allow protocol=TCP localport=4000 profile=any
echo.
echo  Done. Your phone can now reach this computer on port 3000 (web) and 4000 (API).
echo  (To undo later: Windows Defender Firewall - Inbound Rules - delete the two "Business Messaging" rules)
echo.
pause
