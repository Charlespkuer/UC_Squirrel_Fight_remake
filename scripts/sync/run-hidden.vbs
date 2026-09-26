' ============================================================
'  scripts/sync/run-hidden.vbs
'
'  Purpose: start the SSDZ sync service with NO console window.
'
'  Why this file exists: Task Scheduler runs the task in the interactive
'  session, so "node sync.js serve" would leave a black console window on
'  the desktop for as long as the service runs. WScript.Shell.Run with
'  window style 0 launches it hidden, and wscript.exe itself exits at once.
'
'  It is intentionally ASCII-only (wscript reads .vbs as ANSI by default).
'  The scheduled task calls:
'      wscript.exe //B //Nologo "<this file>"
' ============================================================
Option Explicit
Dim fso, sh, here, root, cmd
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh  = CreateObject("WScript.Shell")
here = fso.GetParentFolderName(WScript.ScriptFullName)          ' ...\scripts\sync
root = fso.GetParentFolderName(fso.GetParentFolderName(here))   ' the game root
sh.CurrentDirectory = root
cmd = "node """ & here & "\sync.js"" serve"
sh.Run cmd, 0, False
