Set shell = CreateObject("WScript.Shell")
Set files = CreateObject("Scripting.FileSystemObject")
folder = files.GetParentFolderName(WScript.ScriptFullName)
script = files.BuildPath(folder, "LogEn-AutoCAD-Helper.ps1")
shell.Run "powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File """ & script & """", 0, False
