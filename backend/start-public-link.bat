@echo off
title Business Messaging - public link
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-public-link.ps1"
