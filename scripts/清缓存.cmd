@echo off
rem ============================================================
rem  Reclaim disk only: delete packaging caches, build nothing.
rem  Thin ASCII shell over tools\build-release.ps1 -CleanOnly (keep ASCII + CRLF).
rem  Cleans src-tauri\target, gen\android\{app\build,build,.gradle,app\.cxx},
rem  src-tauri\web and the same set under the ASCII build root.
rem  It never touches version numbers and never touches existing artifacts
rem  in src-tauri\dist.
rem  Add -DeepClean to also wipe %USERPROFILE%\.gradle\caches (the next build
rem  then re-downloads dependencies).
rem ============================================================
setlocal
set "PS=powershell"
where pwsh >nul 2>nul && set "PS=pwsh"
"%PS%" -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\tools\build-release.ps1" -CleanOnly %*
set "CODE=%ERRORLEVEL%"
echo.
rem keep the window open when launched by double-click (no arguments)
if "%~1"=="" pause
exit /b %CODE%
