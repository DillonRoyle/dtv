@echo off
title DTV
cd /d "%~dp0"
where npm >nul 2>nul
if errorlevel 1 (
  echo Node.js isn't installed. Get the LTS version from https://nodejs.org then run this again.
  start https://nodejs.org
  pause
  exit /b 1
)
if not exist node_modules (
  echo First run: downloading what DTV needs, this takes a few minutes...
  call npm install
)
call npm start
