Set WshShell = CreateObject("WScript.Shell")
Set FSO = CreateObject("Scripting.FileSystemObject")
basePath = FSO.GetParentFolderName(WScript.ScriptFullName) & "\.."

WshShell.Run """" & WshShell.ExpandEnvironmentStrings("%APPDATA%") & "\npm\node_modules\opencode-ai\bin\opencode.exe"" serve --port 4099", 0, False
WScript.Sleep 12000
WshShell.Run """" & WshShell.ExpandEnvironmentStrings("%USERPROFILE%") & "\.bun\bin\bun.exe"" run """ & basePath & "\scripts\supertask-gateway.mjs""", 0, False
