Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
rootDir = fso.GetParentFolderName(scriptDir)
command = "cmd /c cd /d """ & rootDir & """ && node scripts\launch-app.js"

shell.Run command, 0, False
