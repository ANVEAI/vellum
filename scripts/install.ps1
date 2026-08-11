# Vellum one-command install.
#
#   powershell -ExecutionPolicy Bypass -File scripts\install.ps1
#
# Installs dependencies, writes .env, creates the database, pulls the Ollama
# models, builds the icon search index, builds the app and starts it on :3210.
# Safe to re-run: every step detects whether it is already done.
#
#   -Password "..."      set the login password (otherwise one is generated)
#   -RestoreFrom lib.zip restore a library made by scripts\data-snapshot.ps1
#   -SkipModels          do not pull Ollama models (about 23 GB)
#   -NoStart             set up but do not build or launch
#   -Force               rewrite .env even if it already exists
#
# NOTE: keep this file pure ASCII (Windows PowerShell 5.1 reads .ps1 as ANSI).
param(
  [string]$Password,
  [string]$RestoreFrom,
  [switch]$SkipModels,
  [switch]$NoStart,
  [switch]$Force
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$App  = Join-Path $Root "vellum"

$OllamaApi   = "http://localhost:11434"
$TextModel   = "qwen3.6:35b"
$EmbedModel  = "nomic-embed-text"
$MinNodeMajor = 20

$script:StepNo = 0
$script:Notes  = @()

function Step($text) {
  $script:StepNo++
  Write-Host ""
  Write-Host ("[{0}] {1}" -f $script:StepNo, $text) -ForegroundColor Cyan
}
function Ok($text)   { Write-Host ("    ok    " + $text) -ForegroundColor Green }
function Skip($text) { Write-Host ("    skip  " + $text) -ForegroundColor DarkGray }
function Warn($text) {
  Write-Host ("    warn  " + $text) -ForegroundColor Yellow
  $script:Notes += $text
}
function Die($text) {
  Write-Host ""
  Write-Host ("FAILED: " + $text) -ForegroundColor Red
  exit 1
}

function New-HexSecret([int]$byteCount) {
  $b = New-Object byte[] $byteCount
  $rng = New-Object System.Security.Cryptography.RNGCryptoServiceProvider
  $rng.GetBytes($b)
  return (($b | ForEach-Object { $_.ToString("x2") }) -join "")
}

function New-Passphrase([int]$len) {
  # No ambiguous glyphs: someone will read this off a screen and retype it.
  $alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"
  $b = New-Object byte[] $len
  $rng = New-Object System.Security.Cryptography.RNGCryptoServiceProvider
  $rng.GetBytes($b)
  $out = ""
  foreach ($byte in $b) { $out += $alphabet[$byte % $alphabet.Length] }
  return $out
}

function Test-Port([int]$port) {
  try {
    $c = New-Object Net.Sockets.TcpClient
    $c.Connect("127.0.0.1", $port)
    $c.Close()
    return $true
  } catch { return $false }
}

function Get-OllamaModels {
  try {
    $tags = Invoke-RestMethod "$OllamaApi/api/tags" -TimeoutSec 10
    return @($tags.models | ForEach-Object { ($_.name -replace ':latest$', '') })
  } catch { return @() }
}

function Invoke-Step([string]$exe, [string[]]$argv, [string]$what) {
  & $exe @argv
  if ($LASTEXITCODE -ne 0) { Die "$what (exit $LASTEXITCODE)" }
}

Write-Host ""
Write-Host "Vellum installer" -ForegroundColor Cyan
Write-Host ("  repo   " + $Root)
Write-Host ("  app    " + $App)

if (-not (Test-Path (Join-Path $App "package.json"))) {
  Die "no vellum\package.json under $Root - run this from a full checkout"
}

# ---------------------------------------------------------------------------
Step "Checking prerequisites"

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Die "Node.js is not installed. Get it from https://nodejs.org (LTS), or: winget install OpenJS.NodeJS.LTS"
}
$nodeVersion = (& node -v)
$nodeMajor = 0
if ($nodeVersion -match '^v(\d+)\.') { $nodeMajor = [int]$Matches[1] }
if ($nodeMajor -lt $MinNodeMajor) {
  Die "Node $nodeVersion is too old - Next.js 15 needs $MinNodeMajor or newer"
}
Ok ("Node " + $nodeVersion)

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { Die "npm not found on PATH" }
Ok ("npm " + (& npm -v))

$ollamaUp = Test-Port 11434
if ($ollamaUp) {
  Ok "Ollama responding on :11434"
} else {
  if (Get-Command ollama -ErrorAction SilentlyContinue) {
    Warn "Ollama is installed but not running - start it, then re-run this script"
  } else {
    Warn "Ollama not found. Install from https://ollama.com (or: winget install Ollama.Ollama), then re-run"
  }
}

if (Test-Port 3210) {
  # Not a warning: SQLite hands out one writer, so `prisma migrate deploy`
  # fails with "database is locked" while the app holds the connection, and
  # a rebuild would overwrite the .next directory the running server serves
  # from. Both are worth stopping for rather than failing halfway through.
  Write-Host ""
  Write-Host "Something is already serving :3210." -ForegroundColor Yellow
  Write-Host "If that is Vellum, stop it and re-run - the database migration and the" -ForegroundColor Yellow
  Write-Host "build both need exclusive access. To find it:" -ForegroundColor Yellow
  Write-Host ""
  Write-Host '    Get-NetTCPConnection -LocalPort 3210 -State Listen | Select-Object OwningProcess'
  Write-Host '    Stop-Process -Id <pid>'
  Write-Host ""
  exit 1
}

# ---------------------------------------------------------------------------
Step "Installing npm dependencies"

Set-Location $App
if ((Test-Path (Join-Path $App "node_modules")) -and (-not $Force)) {
  Skip "node_modules already present (use -Force to reinstall)"
} else {
  if (Test-Path (Join-Path $App "package-lock.json")) {
    Invoke-Step "npm" @("ci") "npm ci failed"
  } else {
    Invoke-Step "npm" @("install") "npm install failed"
  }
  Ok "dependencies installed"
}

# ---------------------------------------------------------------------------
Step "Writing .env"

$envPath = Join-Path $App ".env"
$loginPassword = $null

if ((Test-Path $envPath) -and (-not $Force)) {
  Skip ".env already exists (use -Force to rewrite)"
  $existing = Get-Content $envPath | Where-Object { $_ -match '^\s*APP_PASSWORD\s*=' } | Select-Object -First 1
  if ($existing) {
    $loginPassword = ($existing -replace '^\s*APP_PASSWORD\s*=\s*', '').Trim('"').Trim("'")
  }
} else {
  if ($Password) { $loginPassword = $Password } else { $loginPassword = New-Passphrase 16 }
  $secret = New-HexSecret 32
  $lines = @(
    'DATABASE_URL="file:../data/app.db"',
    ('APP_PASSWORD="' + $loginPassword + '"'),
    ('SESSION_SECRET="' + $secret + '"')
  )
  Set-Content -Path $envPath -Value $lines -Encoding ascii
  Ok "wrote .env with a fresh 64-hex session secret"
}

# ---------------------------------------------------------------------------
Step "Preparing the data directory"

$dataDir = Join-Path $App "data"
if (-not (Test-Path $dataDir)) { New-Item -ItemType Directory -Path $dataDir | Out-Null }

if ($RestoreFrom) {
  if (-not (Test-Path $RestoreFrom)) { Die "snapshot not found: $RestoreFrom" }
  if ((Test-Path (Join-Path $dataDir "app.db")) -and (-not $Force)) {
    Die "a database already exists at $dataDir\app.db - move it aside, or pass -Force to overwrite it"
  }
  Write-Host "    restoring library from $RestoreFrom ..."
  Expand-Archive -Path $RestoreFrom -DestinationPath $dataDir -Force
  Ok "library restored"
} elseif (Test-Path (Join-Path $dataDir "app.db")) {
  $imgDir = Join-Path $dataDir "images"
  $imgCount = 0
  if (Test-Path $imgDir) { $imgCount = (Get-ChildItem $imgDir -File -ErrorAction SilentlyContinue).Count }
  Skip ("existing library found ({0} image files) - leaving it alone" -f $imgCount)
} else {
  Skip "starting with an empty library (pass -RestoreFrom to import one)"
}

# ---------------------------------------------------------------------------
Step "Creating the database schema"

Invoke-Step "npx" @("prisma", "migrate", "deploy") "prisma migrate deploy failed"
Ok "schema applied to data\app.db"

# ---------------------------------------------------------------------------
Step "Ollama models"

if ($SkipModels) {
  Skip "-SkipModels given"
} elseif (-not (Test-Port 11434)) {
  Warn "Ollama is not running - pull the models later with: ollama pull $TextModel ; ollama pull $EmbedModel"
} elseif (-not (Get-Command ollama -ErrorAction SilentlyContinue)) {
  Warn "ollama.exe not on PATH - pull the models from a normal terminal: ollama pull $TextModel"
} else {
  $have = Get-OllamaModels
  foreach ($m in @($TextModel, $EmbedModel)) {
    if ($have -contains $m) {
      Skip ("$m already present")
    } else {
      Write-Host "    pulling $m (this is the long part) ..."
      & ollama pull $m
      if ($LASTEXITCODE -ne 0) { Warn "could not pull $m - run 'ollama pull $m' by hand" } else { Ok "$m pulled" }
    }
  }
}

# ---------------------------------------------------------------------------
Step "Building the icon search index"

$vectors = Join-Path $dataDir "icons-vectors.json"
if ((Test-Path $vectors) -and (-not $Force)) {
  Skip "icons-vectors.json already present"
} elseif (-not (Test-Port 11434)) {
  Warn "needs Ollama - run later: npx tsx scripts\embed-icons.ts"
} else {
  & npx tsx (Join-Path $App "scripts\embed-icons.ts")
  if ($LASTEXITCODE -ne 0) {
    Warn "icon embedding failed - icon search will return nothing until 'npx tsx scripts\embed-icons.ts' succeeds"
  } else {
    Ok "icon vectors built"
  }
}

# ---------------------------------------------------------------------------
Step "Building the app"

if ($NoStart) {
  Skip "-NoStart given"
} else {
  Invoke-Step "npm" @("run", "build") "next build failed"
  Ok "production build complete"
}

# ---------------------------------------------------------------------------
Step "Starting Vellum on :3210"

if ($NoStart) {
  Skip ("-NoStart given - launch later with: powershell -ExecutionPolicy Bypass -File " + (Join-Path $App "scripts\start-all.ps1"))
} elseif (Test-Port 3210) {
  Warn ":3210 is occupied - not starting"
} else {
  Start-Process -WindowStyle Hidden -FilePath "npm" -ArgumentList "run","start" -WorkingDirectory $App
  $up = $false
  foreach ($i in 1..40) {
    Start-Sleep -Seconds 1
    if (Test-Port 3210) { $up = $true; break }
  }
  if ($up) { Ok "listening on http://localhost:3210" } else { Warn "did not come up within 40s - check the build output" }
}

# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "----------------------------------------------------------------" -ForegroundColor Cyan
Write-Host "Vellum is set up." -ForegroundColor Cyan
Write-Host ""
Write-Host "  URL       http://localhost:3210"
if ($loginPassword) {
  Write-Host ("  Password  " + $loginPassword) -ForegroundColor Yellow
  Write-Host "            (stored in vellum\.env - change APP_PASSWORD to something you like)"
} else {
  Write-Host "  Password  see APP_PASSWORD in vellum\.env"
}

$lanScript = Join-Path $App "scripts\lan-url.ps1"
if (Test-Path $lanScript) { & $lanScript }

if ($script:Notes.Count -gt 0) {
  Write-Host ""
  Write-Host "Still to do:" -ForegroundColor Yellow
  foreach ($n in $script:Notes) { Write-Host ("  - " + $n) }
}

Write-Host ""
Write-Host "Next:"
Write-Host "  day to day     powershell -ExecutionPolicy Bypass -File vellum\scripts\start-all.ps1"
Write-Host "  images (opt)   powershell -ExecutionPolicy Bypass -File scripts\setup-dependencies.ps1 -Images"
Write-Host "  LAN access     allow node.exe on the private firewall profile if other devices cannot connect"
Write-Host "  context        read HANDOFF.md, then docs\ARCHITECTURE.md"
Write-Host ""
