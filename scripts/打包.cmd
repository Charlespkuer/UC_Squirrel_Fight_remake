@echo off
rem ============================================================
rem  One-click release build (Windows exe + NSIS setup + Android APK + Mac IPA)
rem  Lives in scripts\ next to the other double-click entries, and is a thin
rem  ASCII shell over tools\build-release.ps1 (keep it ASCII + CRLF: cmd.exe).
rem  Default behaviour, in this order:
rem    1) pick the next version: PREFER the version written in the file names that
rem       already sit in src-tauri\dist (the last build's setup/apk), then +0.0.1
rem       patch. If dist is empty/missing/unparsable, fall back to
rem       scripts\version.json patch+1.  (-Version pins it, -NoBump keeps it)
rem    2) delete last version exe/apk/setup from src-tauri\dist
rem    3) compile exe (+ installer), APK, then both iOS IPAs on the Mac
rem    4) rename artifacts to squirrel_fight_<version>_<abi>.apk etc.
rem    5) delete build caches (target\ / gradle build\ / web\, usually 5~10 GB)
rem  Examples:
rem    double-click this file ......... full release, version auto +0.0.1
rem    this.cmd -DryRun ............... print version + artifact names, write nothing
rem    this.cmd -Version 0.5.0 ........ pin an exact version
rem    this.cmd -SkipApk -SkipIos ..... Windows only
rem    this.cmd -SkipIos .............. skip remote Mac build
rem    this.cmd -IosVariant legacy .... only the iOS 15-25 IPA
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
