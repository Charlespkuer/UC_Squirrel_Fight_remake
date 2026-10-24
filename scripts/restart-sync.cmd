@echo off
rem  SSDZ Classic - restart the background sync service (ASCII-named twin of the Chinese one).
rem
rem  Why an ASCII-named copy exists:
rem    * cmd.exe mis-parses UTF-8 Chinese INSIDE .cmd files, so this file stays ASCII-only;
rem      an ASCII file NAME is also easier to call from other scripts.
rem    * during the folder re-layout it is the one helper an older peer still accepts.
rem
rem  It simply runs scripts\sync\sync.js restart:
rem    - re-reads scripts\sync\sync.config.json (token changes take effect),
rem    - re-registers the "SSDZ Sync" scheduled task (5-minute watchdog, survives logoff),
rem    - and picks up a newer scripts\sync\sync.js if you just received one.
rem
rem  Command line equivalent:  node scripts\sync\sync.js restart
rem
rem  chcp 65001 = let the console decode UTF-8 (node prints Chinese as UTF-8;
rem  without this the restart report shows up as mojibake). Same fix as the
rem  Chinese-named twin, 重启同步服务.cmd -- reported 2026-10.
setlocal
cd /d "%~dp0.."
chcp 65001 >nul 2>nul
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js not found. Install it from https://nodejs.org first.
  pause
  exit /b 1
)
set "SYNCJS=%~dp0sync\sync.js"
if not exist "%SYNCJS%" set "SYNCJS=%~dp0tools\sync\sync.js"
node "%SYNCJS%" restart
echo.
echo Done. Press any key to close.
pause >nul
endlocal
