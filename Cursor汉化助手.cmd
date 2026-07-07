@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
node "%~dp0scripts\helper.js"
if errorlevel 1 pause
