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
'  IMPORTANT: this file must NOT set sh.CurrentDirectory to the game root.
'  It used to (sh.CurrentDirectory = root), and that made the game folder
'  impossible to rename or move: Windows refuses to rename a directory that
'  is some process's current directory -- MoveFileEx returns
'  ERROR_ACCESS_DENIED, which Explorer reports as "the folder is in use" --
'  and this task re-created such a process at every logon and every 5
'  minutes, so even a reboot did not clear it.
'  sync.js derives every path from __dirname and never calls process.cwd(),
'  so no working directory is needed here. Do not put one back.
'
'  Intentionally ASCII-only: wscript reads .vbs as ANSI by default.
' ============================================================
Option Explicit
Dim fso, sh, here, q, cmd
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh  = CreateObject("WScript.Shell")

here = fso.GetParentFolderName(WScript.ScriptFullName)          ' ...\scripts\sync

q = Chr(34)
If WScript.Arguments.Count >= 2 Then
  cmd = q & WScript.Arguments(0) & q & " " & q & WScript.Arguments(1) & q & " serve"
Else
  cmd = q & "node" & q & " " & q & here & "\sync.js" & q & " serve"
End If

sh.Run cmd, 0, False
