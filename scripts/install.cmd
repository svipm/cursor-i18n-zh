@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0.."
node "%~dp0helper.js" --install
if errorlevel 1 pause
