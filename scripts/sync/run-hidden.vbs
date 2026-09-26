' ============================================================
'  scripts/sync/run-hidden.vbs
'
'  Purpose: start the SSDZ sync service with NO console window.
'
'  Why this file exists: Task Scheduler runs the task in the interactive
'  session, so a plain "node sync.js serve" would leave a black console
'  window on the desktop for as long as the service runs. WScript.Shell.Run
'  with window style 0 launches it hidden, and wscript.exe exits at once.
'
'  How the scheduled task calls it (absolute paths, so PATH does not matter):
'      wscript.exe //B //Nologo "<this file>" "<node.exe>" "<sync.js>"
'  With no arguments it just uses "node" from PATH.
'
'  Intentionally ASCII-only: wscript reads .vbs as ANSI by default.
' ============================================================
Option Explicit
Dim fso, sh, here, root, q, cmd
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh  = CreateObject("WScript.Shell")

here = fso.GetParentFolderName(WScript.ScriptFullName)          ' ...\scripts\sync
root = fso.GetParentFolderName(fso.GetParentFolderName(here))   ' the game root
sh.CurrentDirectory = root

q = Chr(34)
If WScript.Arguments.Count >= 2 Then
  cmd = q & WScript.Arguments(0) & q & " " & q & WScript.Arguments(1) & q & " serve"
Else
  cmd = q & "node" & q & " " & q & here & "\sync.js" & q & " serve"
End If

sh.Run cmd, 0, False
