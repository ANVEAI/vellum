# Bring up the full vellum stack. Ollama runs as its own installed service;
# SearXNG and ComfyUI and the app are started here if not already up.
$ErrorActionPreference = "Continue"
# <repo>/vellum/scripts -> <repo>; works under any user account or drive.
$Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)

function Test-Port($port) {
  try {
    $c = New-Object Net.Sockets.TcpClient
    $c.Connect("127.0.0.1", $port); $c.Close(); return $true
  } catch { return $false }
}

# SearXNG :8888
if (-not (Test-Port 8888)) {
  Write-Host "starting SearXNG..."
  $env:SEARXNG_SETTINGS_PATH = "$Root\searxng_config\settings.yml"
  Start-Process -WindowStyle Hidden -FilePath "$Root\searxng\.venv\Scripts\python.exe" `
    -ArgumentList "-m","searx.webapp" -WorkingDirectory "$Root\searxng"
} else { Write-Host "SearXNG already up" }

# ComfyUI :8188 (GPU 1)
if (-not (Test-Port 8188)) {
  Write-Host "starting ComfyUI..."
  Start-Process -WindowStyle Hidden -FilePath "$Root\ComfyUI\.venv\Scripts\python.exe" `
    -ArgumentList "main.py","--listen","127.0.0.1","--port","8188","--cuda-device","1" `
    -WorkingDirectory "$Root\ComfyUI"
} else { Write-Host "ComfyUI already up" }

# Vellum :3210 (production)
if (-not (Test-Port 3210)) {
  Write-Host "starting vellum..."
  Start-Process -WindowStyle Hidden -FilePath "powershell" `
    -ArgumentList "-NoProfile","-ExecutionPolicy","Bypass","-File","$Root\vellum\scripts\start-vellum.ps1"
} else { Write-Host "vellum already up" }

Write-Host "stack starting - vellum will be at http://localhost:3210"
& "$Root\vellum\scripts\lan-url.ps1"
