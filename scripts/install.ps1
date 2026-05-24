param([switch]$Help)

$BANNER = @"

  ___                   ____
 / _ \ _ __   ___ _ __ |  _ \ ___  _ __
| | | | '_ \ / _ \ '_ \| |_) / _ \| '__|
| |_| | |_) |  __/ | | |  __/ (_) | |
 \___/| .__/ \___|_| |_|_|   \___/|_|
      |_|

OpenCron v0.1 — Headless task scheduler for OpenCode

"@

function Show-Help {
  Write-Host $BANNER
  Write-Host "Installation:"
  Write-Host "  .\scripts\install.ps1              Install OpenCron"
  Write-Host "  .\scripts\install.ps1 -Help        Show this help"
  Write-Host ""
  Write-Host "Usage:"
  Write-Host "  .\start.bat                        Start services"
  Write-Host "  http://localhost:4680               Dashboard"
  Write-Host ""
  Write-Host "CLI:"
  Write-Host "  bun x opencode-supertask@latest template add ..."
  Write-Host "  bun x opencode-supertask@latest list"
  Write-Host "  bun x opencode-supertask@latest status"
  exit
}

if ($Help) { Show-Help }

Write-Host $BANNER
Write-Host "Installing OpenCron..." -ForegroundColor Cyan
Write-Host ""

# 1. Check Bun
$bunPath = "$env:USERPROFILE\.bun\bin\bun.exe"
if (-not (Test-Path $bunPath)) {
  Write-Host "[1/5] Bun not found. Installing..." -ForegroundColor Yellow
  powershell -c "irm bun.sh/install.ps1 | iex"
  if (-not (Test-Path $bunPath)) {
    Write-Host "ERROR: Bun installation failed. Install manually: powershell -c `"irm bun.sh/install.ps1 | iex`"" -ForegroundColor Red
    exit 1
  }
} else {
  Write-Host "[1/5] Bun found: $bunPath" -ForegroundColor Green
}

# 2. Check OpenCode
$ocPath = "$env:APPDATA\npm\node_modules\opencode-ai\bin\opencode.exe"
if (-not (Test-Path $ocPath)) {
  Write-Host "[2/5] OpenCode not found. Installing via npm..." -ForegroundColor Yellow
  npm install -g opencode-ai
  if (-not (Test-Path $ocPath)) {
    Write-Host "ERROR: OpenCode installation failed. Install manually: npm install -g opencode-ai" -ForegroundColor Red
    exit 1
  }
} else {
  Write-Host "[2/5] OpenCode found: $ocPath" -ForegroundColor Green
}

# 3. Init supertask
Write-Host "[3/5] Initializing SuperTask database..." -ForegroundColor Cyan
$env:Path += ";$env:USERPROFILE\.bun\bin"
bun x opencode-supertask@latest init 2>&1 | Out-Null
Write-Host "      SQLite database created" -ForegroundColor Green

# 4. Apply patches
Write-Host "[4/5] Applying patches..." -ForegroundColor Cyan
$projectRoot = Split-Path -Parent $PSScriptRoot
$bunCache = "$env:USERPROFILE\.cache\opencode\packages"
$supertaskDir = Get-ChildItem -Path $bunCache -Filter "opencode-supertask@*" -Directory | Sort-Object LastWriteTime -Descending | Select-Object -First 1

if ($supertaskDir) {
  $targetGateway = Join-Path $supertaskDir.FullName "node_modules\opencode-supertask\dist\gateway\index.js"
  $targetWorker = Join-Path $supertaskDir.FullName "node_modules\opencode-supertask\dist\worker\index.js"
  $sourceGateway = Join-Path $projectRoot "dist\gateway\index.js"
  $sourceWorker = Join-Path $projectRoot "dist\worker\index.js"

  if (Test-Path $sourceGateway) {
    Copy-Item -LiteralPath $sourceGateway -Destination $targetGateway -Force
    Write-Host "      Gateway patch applied" -ForegroundColor Green
  }
  if (Test-Path $sourceWorker) {
    Copy-Item -LiteralPath $sourceWorker -Destination $targetWorker -Force
    Write-Host "      Worker patch applied" -ForegroundColor Green
  }
} else {
  Write-Host "      WARNING: supertask cache not found. Apply patches manually." -ForegroundColor Yellow
}

# 5. Create startup shortcut
Write-Host "[5/5] Creating Windows startup shortcut..." -ForegroundColor Cyan
try {
  $startup = [Environment]::GetFolderPath("Startup")
  $wsh = New-Object -ComObject WScript.Shell
  $shortcut = $wsh.CreateShortcut("$startup\OpenCron.lnk")
  $shortcut.TargetPath = Join-Path $projectRoot "start.bat"
  $shortcut.WorkingDirectory = $projectRoot
  $shortcut.WindowStyle = 7
  $shortcut.Save()
  Write-Host "      Shortcut created: $startup\OpenCron.lnk" -ForegroundColor Green
} catch {
  Write-Host "      WARNING: Could not create startup shortcut: $_" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host " OpenCron installed successfully!" -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host " To start services:     .\start.bat"
Write-Host " Dashboard:             http://localhost:4680"
Write-Host " OpenCode serve:        http://localhost:4099"
Write-Host ""
Write-Host " Scheduled tasks (CLI):"
Write-Host "   bun x opencode-supertask@latest template add --name "Daily" --agent "explore" --prompt "..." --type cron --cron "0 9 * * *""
Write-Host ""
