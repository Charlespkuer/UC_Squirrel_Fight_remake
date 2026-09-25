@echo off
rem  SSDZ Classic - double-click launcher (project root).
rem
rem  All logic lives in start-game.ps1 next to this file: cmd.exe
rem  mis-parses UTF-8 Chinese inside .cmd files (it reads Chinese comment bytes as
rem  bogus commands, so the server never started), therefore this file is ASCII-only.
rem
rem  What it does:
rem    1) if src-tauri\...\ssdz-classic.exe exists -> open the native
rem       window (real desktop app, no browser involved);
rem    2) otherwise -> start the local server (node, else python) on port 8080 and
rem       open a Chrome/Edge "app window" (no tab bar, no address bar), then wait.
rem
rem  Options when run from a terminal:
rem    launcher.cmd [port] [--no-save] [--browser]
rem      --no-save  read-only, do not write save\progress.json
rem      --browser  skip the native window, use the browser app-window route
setlocal
cd /d "%~dp0"
set "PS=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
if not exist "%PS%" set "PS=powershell"
rem  helper scripts live in the scripts\ subfolder (older flat layouts still work)
set "PS1=%~dp0scripts\start-game.ps1"
if not exist "%PS1%" set "PS1=%~dp0start-game.ps1"
"%PS%" -NoProfile -ExecutionPolicy Bypass -File "%PS1%" %*
set "CODE=%errorlevel%"
if not "%CODE%"=="0" (
  echo.
  echo Launcher stopped ^(exit code %CODE%^).
  pause
)
endlocal
exit /b %CODE%
