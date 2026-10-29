@echo off
setlocal
title Building DTV
cd /d "%~dp0"
set LOG=%~dp0build-log.txt
echo DTV build log > "%LOG%"
echo.
echo  ===============================
echo    DTV - building the Windows app
echo  ===============================
echo.

if not exist "%~dp0package.json" goto notunzipped

where npm >nul 2>nul
if errorlevel 1 goto nonode

for /f "delims=" %%v in ('node -v') do set NODEV=%%v
echo  Using Node %NODEV%
echo Node %NODEV% >> "%LOG%"
echo Folder: %~dp0 >> "%LOG%"

echo.
echo  Step 1 of 2: downloading what DTV needs. First time only, takes a few minutes...
call npm install --no-audit --no-fund >> "%LOG%" 2>&1
if errorlevel 1 goto installfail

echo.
echo  Step 2 of 2: building DTV...
set CSC_IDENTITY_AUTO_DISCOVERY=false

call :fixcodesign

echo --- attempt 1: installer + portable >> "%LOG%"
call npx electron-builder --win nsis portable --x64 >> "%LOG%" 2>&1
if not errorlevel 1 goto done

echo  Fixing a Windows permissions problem and trying again...
call :fixcodesign
echo --- attempt 1b: after unpacking winCodeSign >> "%LOG%"
call npx electron-builder --win nsis portable --x64 >> "%LOG%" 2>&1
if not errorlevel 1 goto done

echo  Trying a simpler build...
echo --- attempt 2: without exe editing >> "%LOG%"
call npx electron-builder --win nsis portable --x64 -c.win.signAndEditExecutable=false >> "%LOG%" 2>&1
if not errorlevel 1 goto done

echo  Trying the simplest build, a ready-to-run folder...
echo --- attempt 3: unpacked folder >> "%LOG%"
call npx electron-builder --win dir --x64 -c.win.signAndEditExecutable=false >> "%LOG%" 2>&1
if not errorlevel 1 goto donedir

echo.
echo  The build failed. The details are in build-log.txt next to this file.
echo  Send that file, or a screenshot of the last lines, and it can be fixed.
start "" notepad "%LOG%"
pause
exit /b 1

:done
echo.
echo  Done! The installer and portable app are in the "dist" folder.
start "" "%~dp0dist"
pause
exit /b 0

:donedir
echo.
echo  Done! Open dist\win-unpacked and double-click DTV.exe.
echo  You can right-click DTV.exe and choose "Send to - Desktop" for a shortcut.
start "" "%~dp0dist\win-unpacked"
pause
exit /b 0

:notunzipped
echo  This file needs to run from the unzipped folder.
echo  Right-click DTV.zip, choose "Extract All", then open the dtv folder and run this again.
pause
exit /b 1

:nonode
echo  Node.js isn't installed, or Windows hasn't picked it up yet.
echo  1. Install the LTS version from https://nodejs.org
echo  2. Restart your PC, or at least close and reopen this folder
echo  3. Double-click this file again
start https://nodejs.org
pause
exit /b 1

:installfail
echo.
echo  Downloading failed. Check your internet connection and try again.
echo  The details are in build-log.txt next to this file.
start "" notepad "%LOG%"
pause
exit /b 1

:fixcodesign
rem electron-builder unzips its winCodeSign helper with symlinks turned on, which
rem Windows refuses without admin/Developer Mode. Unzip it ourselves without them.
set "WCS=%LOCALAPPDATA%\electron-builder\Cache\winCodeSign"
if exist "%WCS%\winCodeSign-2.6.0\rcedit-x64.exe" exit /b 0
if not exist "%WCS%" exit /b 0
set "ARC="
for %%f in ("%WCS%\*.7z") do set "ARC=%%f"
if not defined ARC exit /b 0
set "Z=%~dp0node_modules\7zip-bin\win\x64\7za.exe"
if not exist "%Z%" exit /b 0
echo --- unpacking winCodeSign from %ARC% >> "%LOG%"
"%Z%" x -y -bd "%ARC%" "-o%WCS%\winCodeSign-2.6.0" >> "%LOG%" 2>&1
exit /b 0
