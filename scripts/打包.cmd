@echo off
rem ============================================================
rem  One-click release build (Windows exe + NSIS setup + Android APK)
rem  Lives in scripts\ next to the other double-click entries, and is a thin
rem  ASCII shell over tools\build-release.ps1 (keep it ASCII + CRLF: cmd.exe).
rem  Default behaviour, in this order:
rem    1) bump version by ONE patch  (e.g. 0.4.8 -> 0.4.9)
rem    2) delete last version exe/apk/setup from src-tauri\dist
rem    3) compile exe (+ installer) and APK
rem    4) rename artifacts to squirrel_fight_<version>_<abi>.apk etc.
rem    5) delete build caches (target\ / gradle build\ / web\, usually 5~10 GB)
rem  Examples:
rem    double-click this file ......... full release, version auto +1
rem    this.cmd -Version 0.5.0 ........ pin an exact version
rem    this.cmd -SkipApk .............. Windows only (saves ~10 min)
rem    this.cmd -KeepCache ............ keep caches for a faster next build
rem    Every switch lives in tools\build-release.ps1 (-DryRun / -DeepClean / ...).
rem ============================================================
setlocal
set "PS=powershell"
where pwsh >nul 2>nul && set "PS=pwsh"
"%PS%" -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\tools\build-release.ps1" %*
set "CODE=%ERRORLEVEL%"
echo.
rem keep the window open when launched by double-click (no arguments)
if "%~1"=="" pause
exit /b %CODE%
