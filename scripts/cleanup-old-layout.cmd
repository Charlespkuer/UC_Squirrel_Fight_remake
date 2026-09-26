@echo off
rem  SSDZ Classic - one-time cleanup of the OLD flat layout on Windows.
rem
rem  All logic lives in cleanup-old-layout.ps1 next to this file: cmd.exe
rem  mis-parses UTF-8 Chinese inside .cmd files (and the files to remove have
rem  Chinese names), therefore this file is ASCII-only and only forwards.
rem
rem  What it does: removes the old copies that now live in scripts\ instead
rem  (serve.js, serve.py, start-game.ps1, the four helper scripts, tools\sync\).
rem  It lists everything first and asks for confirmation; it never touches
rem  index.html, css, js, images, audio, save, scripts, or the rest of tools.
setlocal
cd /d "%~dp0"
set "PS=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
if not exist "%PS%" set "PS=powershell"
"%PS%" -NoProfile -ExecutionPolicy Bypass -File "%~dp0cleanup-old-layout.ps1"
set "CODE=%errorlevel%"
if not "%CODE%"=="0" (
  echo.
  echo Cleanup stopped ^(exit code %CODE%^).
  pause
)
endlocal
exit /b %CODE%
