@echo off
rem  SSDZ Classic - two-machine sync menu (project root).
rem
rem  All logic lives in tools\sync\sync-win.ps1 next to this file: cmd.exe
rem  mis-parses UTF-8 Chinese inside .cmd files, therefore this file is ASCII-only.
rem
rem  What it does (Mac <-> Windows over ZeroTier):
rem    1) save data transfer   : save\progress.json, both directions
rem    2) changed files sync   : only files newer on one side, never deletes
rem    3) peer discovery       : scans the ZeroTier /24 for the other machine
rem
rem  Options when run from a terminal:
rem    launcher.cmd status | save-push | save-pull | files-push | files-pull | discover
rem    launcher.cmd <any sync.js argument>   e.g. launcher.cmd push win --save
setlocal
cd /d "%~dp0"
set "PS=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
if not exist "%PS%" set "PS=powershell"
rem  this file lives in scripts\ ; sync logic is in scripts\sync\
set "SYNCPS=%~dp0sync\sync-win.ps1"
if not exist "%SYNCPS%" set "SYNCPS=%~dp0game\tools\sync\sync-win.ps1"
if not exist "%SYNCPS%" set "SYNCPS=%~dp0tools\sync\sync-win.ps1"
"%PS%" -NoProfile -ExecutionPolicy Bypass -File "%SYNCPS%" %*
set "CODE=%errorlevel%"
if not "%CODE%"=="0" (
  echo.
  echo Sync tool stopped ^(exit code %CODE%^).
  pause
)
endlocal
exit /b %CODE%
