@echo off
setlocal
cd /d "%~dp0"
title SquirrelAPI Club - Local UI
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-club-local.ps1"
if errorlevel 1 pause
endlocal
