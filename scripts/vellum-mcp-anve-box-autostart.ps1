# Keep Vellum's public MCP endpoint for ANVE Box's cloud answering - at boot,
# and after a crash. Two processes:
#
#   1. the MCP server on 127.0.0.1:8766 (the full tool set since 26 Nov 2026;
#      before that the two-tool "anve-box" set), configured by
#      mcp-server\.env.anve-box (tool set, token, allowed client address);
#   2. the Cloudflare tunnel that publishes it as https://vellum-mcp.anveai.com/mcp
#      (and /exports/<file>), configured by the tunnel file (-TunnelConfig).
#
#   powershell -ExecutionPolicy Bypass -File scripts\vellum-mcp-anve-box-autostart.ps1 -Register
#       registers a scheduled task that runs this script as SYSTEM, once at
#       system startup and again every 5 minutes.
#
#   powershell -ExecutionPolicy Bypass -File scripts\vellum-mcp-anve-box-autostart.ps1
#       one check. Starts whichever of the two is not running; exits at once
#       when both are, so the 5-minute repeat is cheap and cannot cause a
#       restart storm.
#
# The private endpoint on :8765 (all 26 tools, no token) is vellum-mcp-autostart.ps1's
# and is not touched here.
#
# CONFIG COMES FROM THE .env FILE ONLY. node's --env-file never overrides a
# variable that is already set, and an interactive account here carries stale
# VELLUM_* user variables (a different port, a base URL without /vellum), so
# every inherited VELLUM_* variable is cleared before the server starts.
#
# NOTE: keep this file pure ASCII (Windows PowerShell 5.1 reads .ps1 as ANSI).
param(
  [switch]$Register,
  [string]$TaskName = "VellumMCPAnveBox",
  [string]$TunnelConfig = (Join-Path $env:ProgramData "Vellum\vellum-mcp-tunnel.yml")
)

$ErrorActionPreference = "Stop"

# <repo>/scripts -> <repo>; works under any user account or drive.
$Root    = Split-Path -Parent $PSScriptRoot
$App     = Join-Path $Root "mcp-server"
$EnvFile = ".env.anve-box"
$Port    = 8766
$LogDir  = Join-Path $env:ProgramData "Vellum"
$LogFile = Join-Path $LogDir "mcp-anve-box-autostart.log"

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

function Get-Cloudflared {
  $candidates = @(
    (Join-Path ${env:ProgramFiles(x86)} "cloudflared\cloudflared.exe"),
    (Join-Path $env:ProgramFiles "cloudflared\cloudflared.exe")
  )
  foreach ($c in $candidates) { if (Test-Path $c) { return $c } }
  return $null
}

function Test-Tunnel {
  $procs = Get-CimInstance Win32_Process -Filter "Name='cloudflared.exe'" -ErrorAction SilentlyContinue
  foreach ($p in $procs) {
    if ($p.CommandLine -and $p.CommandLine.ToLower().Contains($TunnelConfig.ToLower())) { return $true }
  }
  return $false
}

# ---------------------------------------------------------------------------
if ($Register) {
  $self = Join-Path $PSScriptRoot "vellum-mcp-anve-box-autostart.ps1"

  $action = New-ScheduledTaskAction -Execute "powershell.exe" `
    -Argument ('-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + $self + '" -TunnelConfig "' + $TunnelConfig + '"')
  $atBoot  = New-ScheduledTaskTrigger -AtStartup
  $repeat  = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
    -RepetitionInterval (New-TimeSpan -Minutes 5)
  $principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 10)

  Register-ScheduledTask -TaskName $TaskName `
    -Description "Keep Vellum's MCP endpoint for ANVE Box (:8766 and its Cloudflare tunnel) running; re-check every 5 minutes." `
    -Action $action -Trigger $atBoot, $repeat -Principal $principal -Settings $settings -Force | Out-Null

  Write-Host ("registered scheduled task '" + $TaskName + "' (SYSTEM, at startup + every 5 min)") -ForegroundColor Green
  Write-Host ("  script  " + $self)
  Write-Host ("  tunnel  " + $TunnelConfig)
  Write-Host ("  log     " + $LogFile)
  return
}

# ---------------------------------------------------------------------------
# 1. The MCP server.
if (-not (Test-Port $Port)) {
  Write-Log ("port " + $Port + " not answering - starting the mcp server for ANVE Box")
  if (-not (Test-Path (Join-Path $App "dist\index.js"))) {
    Write-Log ("FAILED: no build at " + $App + "\dist - run npm run build")
    exit 1
  }
  if (-not (Test-Path (Join-Path $App $EnvFile))) {
    Write-Log ("FAILED: no " + $EnvFile + " at " + $App + " - it holds the token and settings")
    exit 1
  }

  Get-ChildItem Env: | Where-Object { $_.Name -like "VELLUM_*" } | ForEach-Object {
    Remove-Item ("Env:" + $_.Name)
  }

  # node.exe by full path: SYSTEM's PATH is not the interactive user's.
  $node = Join-Path $env:ProgramFiles "nodejs\node.exe"
  if (-not (Test-Path $node)) { $node = "node.exe" }

  Start-Process -WindowStyle Hidden -FilePath $node `
    -ArgumentList ("--env-file=" + $EnvFile), "dist/index.js", "--transport=http" -WorkingDirectory $App

  $up = $false
  foreach ($i in 1..30) {
    Start-Sleep -Seconds 1
    if (Test-Port $Port) { $up = $true; break }
  }
  if ($up) { Write-Log ("started - listening on " + $Port) }
  else      { Write-Log "FAILED: the mcp server did not come up within 30s" }
}

# 2. The tunnel.
if (-not (Test-Tunnel)) {
  $cloudflared = Get-Cloudflared
  if (-not $cloudflared) {
    Write-Log "FAILED: cloudflared.exe not found under Program Files"
    exit 1
  }
  if (-not (Test-Path $TunnelConfig)) {
    Write-Log ("FAILED: no tunnel config at " + $TunnelConfig)
    exit 1
  }
  Write-Log ("tunnel not running - starting cloudflared with " + $TunnelConfig)
  Start-Process -WindowStyle Hidden -FilePath $cloudflared `
    -ArgumentList "tunnel", "--config", ('"' + $TunnelConfig + '"'), "run"
  Start-Sleep -Seconds 5
  if (Test-Tunnel) { Write-Log "tunnel started" } else { Write-Log "FAILED: cloudflared exited at once - see its logfile" }
}
