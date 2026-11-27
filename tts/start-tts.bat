@echo off
title To-do voice clips - KittenTTS 2
cd /d "%~dp0"

rem Speaks to-do titles (Hindi + English) for reminder notifications. The backend calls it on http://127.0.0.1:4100
rem Model: set TTS_MODEL=mini below for the bigger, slower model (default nano).
if "%TTS_MODEL%"=="" set TTS_MODEL=nano

if exist .venv\Scripts\python.exe goto run
where python >nul 2>nul
if errorlevel 1 goto nopython
echo Setting up the voice service the first time, please wait a few minutes...
python -m venv .venv
if errorlevel 1 goto failed
.venv\Scripts\python -m pip install -r requirements.txt
if errorlevel 1 goto failed

:run
echo.
echo  Starting the voice service (KittenTTS 2 %TTS_MODEL%) on http://127.0.0.1:4100 ...
echo  Keep this window open next to the backend. Press Ctrl+C to stop.
echo.
.venv\Scripts\python server.py
pause
exit /b

:nopython
echo.
echo  [!] Python 3.12 is not installed. Install it from https://www.python.org then run this file again.
echo.
pause
exit /b

:failed
echo.
echo  [!] Setup failed. Copy the red error text above and send it to Claude.
echo.
pause
exit /b
