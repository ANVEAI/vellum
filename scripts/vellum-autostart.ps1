# Keep Vellum answering on :3210 - at boot, and after a crash.
#
#   powershell -ExecutionPolicy Bypass -File scripts\vellum-autostart.ps1 -Register
#       registers a scheduled task that runs this script as SYSTEM, once at
#       system startup and again every 5 minutes.
#
#   powershell -ExecutionPolicy Bypass -File scripts\vellum-autostart.ps1
#       one health check. Exits immediately if :3210 already answers, so the
#       5-minute repeat is cheap and cannot cause a restart storm.
#
# Runs as SYSTEM so an unattended reboot brings Vellum back with nobody logged
# on, and so no Windows password has to be stored anywhere.
#
# EXPORTS NEED PLAYWRIGHT_BROWSERS_PATH. PPTX and PDF both drive headless
# Chromium (src/lib/export/browser.ts). Playwright looks in the CALLING USER's
# profile, and SYSTEM does not share Administrator's. Worse, if the browsers
# were installed from inside a packaged (MSIX) app, the path they appear at -
# %LOCALAPPDATA%\ms-playwright - is a per-container redirection that does not
# exist for any process outside that container. Test-Path returns true for you
# and false for SYSTEM, and the only symptom is "Executable doesn't exist" at
# export time while generation keeps working. So point the machine-wide
# variable at a real location on a plain drive:
#
#   [Environment]::SetEnvironmentVariable('PLAYWRIGHT_BROWSERS_PATH',
#     'D:\vellum-ops\ms-playwright', 'Machine')
#
# NOTE: keep this file pure ASCII (Windows PowerShell 5.1 reads .ps1 as ANSI).
param(
  [switch]$Register,
  [string]$TaskName = "Vellum"
)

$ErrorActionPreference = "Stop"

# <repo>/scripts -> <repo>; works under any user account or drive.
$Root    = Split-Path -Parent $PSScriptRoot
$App     = Join-Path $Root "vellum"
$Port    = 3210
$LogDir  = Join-Path $env:ProgramData "Vellum"
$LogFile = Join-Path $LogDir "autostart.log"

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
  $self = Join-Path $PSScriptRoot "vellum-autostart.ps1"

  $action = New-ScheduledTaskAction -Execute "powershell.exe" `
    -Argument ('-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + $self + '"')
  $atBoot  = New-ScheduledTaskTrigger -AtStartup
  $repeat  = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
    -RepetitionInterval (New-TimeSpan -Minutes 5)
  $principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 10)

  Register-ScheduledTask -TaskName $TaskName `
    -Description "Start Vellum on :3210 at boot; re-check every 5 minutes and restart if it stops answering." `
    -Action $action -Trigger $atBoot, $repeat -Principal $principal -Settings $settings -Force | Out-Null

  Write-Host ("registered scheduled task '" + $TaskName + "' (SYSTEM, at startup + every 5 min)") -ForegroundColor Green
  Write-Host ("  script  " + $self)
  Write-Host ("  log     " + $LogFile)

  # Warn rather than fail: Vellum still runs without this, it just cannot export.
  $browsers = [Environment]::GetEnvironmentVariable('PLAYWRIGHT_BROWSERS_PATH', 'Machine')
  if (-not $browsers) {
    Write-Host "  warn    PLAYWRIGHT_BROWSERS_PATH is not set machine-wide - PPTX/PDF export will fail under SYSTEM" -ForegroundColor Yellow
    Write-Host "          see the header of this script for why and how to set it" -ForegroundColor Yellow
  } elseif (-not (Test-Path $browsers)) {
    Write-Host ("  warn    PLAYWRIGHT_BROWSERS_PATH points at " + $browsers + " which does not exist") -ForegroundColor Yellow
  } else {
    Write-Host ("  ok      PLAYWRIGHT_BROWSERS_PATH " + $browsers)
  }
  return
}

# ---------------------------------------------------------------------------
if (Test-Port $Port) { exit 0 }

Write-Log ("port " + $Port + " not answering - starting vellum")

if (-not (Test-Path (Join-Path $App "package.json"))) {
  Write-Log ("FAILED: no package.json at " + $App)
  exit 1
}
if (-not (Test-Path (Join-Path $App ".next\BUILD_ID"))) {
  Write-Log ("FAILED: no production build at " + $App + "\.next - run npm run build")
  exit 1
}

# npm.cmd, not npm. Start-Process resolves through ShellExecute, where an exact
# filename match beats PATHEXT expansion, and C:\Program Files\nodejs ships an
# extensionless "npm" Bourne script next to npm.cmd. -FilePath "npm" launches
# nothing and returns no error.
Start-Process -WindowStyle Hidden -FilePath "npm.cmd" `
  -ArgumentList "run", "start" -WorkingDirectory $App

$up = $false
foreach ($i in 1..40) {
  Start-Sleep -Seconds 1
  if (Test-Port $Port) { $up = $true; break }
}

if ($up) { Write-Log ("started - listening on " + $Port) }
else      { Write-Log "FAILED: did not come up within 40s" }
