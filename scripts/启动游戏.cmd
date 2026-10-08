@echo off
rem  SSDZ Classic - fallback launcher (lives in scripts\, next to start-game.ps1).
rem
rem  PRIMARY Windows entry is squirrel_fight.exe in the game root folder --
rem  just double-click that exe. This .cmd is the fallback for the cases the exe
rem  cannot cover: no exe built yet, WebView2 missing, or you want the browser
rem  route / read-only mode. It also accepts the options below.
rem
rem  All logic lives in start-game.ps1 in this same folder: cmd.exe
rem  mis-parses UTF-8 Chinese inside .cmd files (it reads Chinese comment bytes as
rem  bogus commands, so the server never started), therefore this file is ASCII-only.
rem
rem  What it does:
rem    1) if squirrel_fight.exe exists in the game root or in this folder -> open the
rem       native window (real desktop app, no browser involved);
rem    2) otherwise -> start the local server (node, else python) on port 8080 and
rem       open a Chrome/Edge "app window" (no tab bar, no address bar), then wait.
rem
rem  Options when run from a terminal:
rem    launcher.cmd [port] [--no-save] [--browser] [--stop]
rem      --no-save  read-only, do not write save\progress.json
rem      --browser  skip the native window, use the browser app-window route
rem      --stop     stop the background local server started by an earlier run
setlocal
cd /d "%~dp0"
set "PS=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
if not exist "%PS%" set "PS=powershell"
rem  helper script sits next to this file; the older flat layout also works
set "PS1=%~dp0start-game.ps1"
if not exist "%PS1%" set "PS1=%~dp0scripts\start-game.ps1"
"%PS%" -NoProfile -ExecutionPolicy Bypass -File "%PS1%" %*
set "CODE=%errorlevel%"
if not "%CODE%"=="0" (
  echo.
  echo Launcher stopped ^(exit code %CODE%^).
  pause
)
endlocal
exit /b %CODE%
