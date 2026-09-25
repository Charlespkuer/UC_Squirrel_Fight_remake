@echo off
rem  SSDZ Classic - restart the background sync service (Windows).
rem
rem  Why this file exists: the sync service reads scripts\sync\sync.config.json
rem  at startup. If you edit the token there, an already running service keeps
rem  the OLD token, and the other machine then gets "wrong token" (403) even
rem  though the files match. Restarting the service picks the new token up.
rem
rem  Newer sync.js reloads the config on every request, so this is only needed
rem  on older copies - but it never hurts to double-click it.
rem
rem  ASCII only on purpose: cmd.exe mis-parses UTF-8 Chinese inside .cmd files.
rem  Command line equivalent:  node scripts\sync\sync.js restart
setlocal
cd /d "%~dp0.."
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js not found. Install it from https://nodejs.org first.
  pause
  exit /b 1
)
rem  this file lives in scripts\ ; sync logic is in scripts\sync\
set "SYNCJS=%~dp0sync\sync.js"
if not exist "%SYNCJS%" set "SYNCJS=%~dp0game\tools\sync\sync.js"
if not exist "%SYNCJS%" set "SYNCJS=%~dp0tools\sync\sync.js"
node "%SYNCJS%" restart
echo.
echo Done. Press any key to close.
pause >nul
endlocal
