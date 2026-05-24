param([switch]$Stop)
$bun = "$env:USERPROFILE\.bun\bin\bun.exe"
$opencode = "$env:APPDATA\npm\node_modules\opencode-ai\bin\opencode.exe"
$wrapper = "G:\Outros computadores\Meu laptop\Documentos\Coding Repositories\SF Gitlab\.opencode\supertask-gateway.mjs"
$log = "G:\Outros computadores\Meu laptop\Documentos\Coding Repositories\SF Gitlab\.opencode\supertask.log"

if ($Stop) {
  Get-Process -Name "opencode" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -match "4099" } | Stop-Process -Force
  Get-Process -Name "bun" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -match "supertask" } | Stop-Process -Force
  "Stopped" | Out-File $log
  return
}

"Starting OpenCode serve :4099..." | Out-File $log
$p1 = Start-Process -WindowStyle Hidden -FilePath $opencode -ArgumentList "serve", "--port", "4099" -PassThru
Start-Sleep -Seconds 10

"Starting SuperTask Gateway :4680..." | Out-File $log -Append
$p2 = Start-Process -WindowStyle Hidden -FilePath $bun -ArgumentList "run", $wrapper -PassThru

"PIDs: $($p1.Id) $($p2.Id)" | Out-File $log -Append
"Dashboard: http://localhost:4680" | Out-File $log -Append
