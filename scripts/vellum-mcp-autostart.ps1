# Keep the Vellum MCP server answering on :8765 - at boot, and after a crash.
#
#   powershell -ExecutionPolicy Bypass -File scripts\vellum-mcp-autostart.ps1 -Register
#       registers a scheduled task that runs this script as SYSTEM, once at
#       system startup and again every 5 minutes.
#
#   powershell -ExecutionPolicy Bypass -File scripts\vellum-mcp-autostart.ps1
#       one health check. Exits immediately if :8765 already answers, so the
#       5-minute repeat is cheap and cannot cause a restart storm.
#
# Mirrors vellum-autostart.ps1. Runs as SYSTEM so an unattended reboot brings the
# server back with nobody logged on.
#
# CONFIG COMES FROM .env, AND NOTHING LOADS IT AUTOMATICALLY. This package has no
# dotenv dependency - it reads process.env directly - so the .env file is passed
# with node's own --env-file flag. Started any other way it exits 78 with
# "Invalid configuration: VELLUM_APP_PASSWORD: Required" and never binds.
#
# VELLUM_BASE_URL in that .env must carry Vellum's URL prefix
# (http://127.0.0.1:3210/vellum), because Vellum runs under NEXT_PUBLIC_BASE_PATH.
#
# NOTE: keep this file pure ASCII (Windows PowerShell 5.1 reads .ps1 as ANSI).
param(
  [switch]$Register,
  [string]$TaskName = "VellumMCP"
)

$ErrorActionPreference = "Stop"

# <repo>/scripts -> <repo>; works under any user account or drive.
$Root    = Split-Path -Parent $PSScriptRoot
$App     = Join-Path $Root "mcp-server"
$Port    = 8765
$LogDir  = Join-Path $env:ProgramData "Vellum"
$LogFile = Join-Path $LogDir "mcp-autostart.log"

function Write-Log($text) {
  if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir -Force | Out-Null }
  $line = "{0}  {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $text
  Add-Content -Path $LogFile -Value $line -Encoding ascii
}

function Test-Port([int]$port) {
  try {
    $c = New-Object Net.Sockets.TcpClient
    $c.Connect("127.0.0.1", $port)
    $c.Close()
    return $true
  } catch { return $false }
}

# ---------------------------------------------------------------------------
if ($Register) {
  $self = Join-Path $PSScriptRoot "vellum-mcp-autostart.ps1"

  $action = New-ScheduledTaskAction -Execute "powershell.exe" `
    -Argument ('-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + $self + '"')
  $atBoot  = New-ScheduledTaskTrigger -AtStartup
  $repeat  = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
    -RepetitionInterval (New-TimeSpan -Minutes 5)
  $principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 10)

  Register-ScheduledTask -TaskName $TaskName `
    -Description "Start the Vellum MCP server on :8765 at boot; re-check every 5 minutes and restart if it stops answering." `
    -Action $action -Trigger $atBoot, $repeat -Principal $principal -Settings $settings -Force | Out-Null

  Write-Host ("registered scheduled task '" + $TaskName + "' (SYSTEM, at startup + every 5 min)") -ForegroundColor Green
  Write-Host ("  script  " + $self)
  Write-Host ("  log     " + $LogFile)
  return
}

# ---------------------------------------------------------------------------
if (Test-Port $Port) { exit 0 }

Write-Log ("port " + $Port + " not answering - starting vellum mcp server")

if (-not (Test-Path (Join-Path $App "dist\index.js"))) {
  Write-Log ("FAILED: no build at " + $App + "\dist - run npm run build")
  exit 1
}
if (-not (Test-Path (Join-Path $App ".env"))) {
  Write-Log ("FAILED: no .env at " + $App + " - the server cannot start without VELLUM_APP_PASSWORD")
  exit 1
}

# node.exe by full path: SYSTEM's PATH is not the interactive user's.
$node = Join-Path $env:ProgramFiles "nodejs\node.exe"
if (-not (Test-Path $node)) { $node = "node.exe" }

Start-Process -WindowStyle Hidden -FilePath $node `
  -ArgumentList "--env-file=.env", "dist/index.js", "--transport=http" -WorkingDirectory $App

$up = $false
foreach ($i in 1..30) {
  Start-Sleep -Seconds 1
  if (Test-Port $Port) { $up = $true; break }
}

if ($up) { Write-Log ("started - listening on " + $Port) }
else      { Write-Log "FAILED: did not come up within 30s" }
