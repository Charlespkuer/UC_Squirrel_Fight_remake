@echo off
rem  SSDZ Classic - Windows launcher (ASCII shim).
rem
rem  The real work is in start-win.ps1 on purpose: cmd.exe mis-parses UTF-8
rem  Chinese text inside .cmd files (changing the code page mid-file desyncs its
rem  parser, so Chinese comment/echo lines get read as bogus commands) - that
rem  made the launcher silently fail to start the save-capable server.
rem  This shim stays pure ASCII; PowerShell handles the Chinese messages.
rem
rem  Usage: start-win.cmd [port] [--no-save] [--browser]
setlocal
cd /d "%~dp0"
set "PS=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
if not exist "%PS%" set "PS=powershell"
"%PS%" -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-win.ps1" %*
set "CODE=%errorlevel%"
if not "%CODE%"=="0" (
  echo.
  echo Launcher stopped ^(exit code %CODE%^).
  pause
)
endlocal
exit /b %CODE%
