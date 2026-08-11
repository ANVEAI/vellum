# Move a Vellum library between machines.
#
#   .\data-snapshot.ps1 -Mode export -Path C:\vellum-library.zip
#   .\data-snapshot.ps1 -Mode import -Path C:\vellum-library.zip
#
# Carries the SQLite database, the generated images and the icon vector index.
# Deliberately skips data\exports\ (dead since P6, only stale copies) and
# data\models\.
#
# STOP THE APP FIRST. SQLite in WAL mode keeps recent writes in a side file;
# exporting a live database can capture a torn state.
#
# On import, install.ps1 -RestoreFrom does the same thing as part of setup.
#
# NOTE: keep this file pure ASCII (Windows PowerShell 5.1 reads .ps1 as ANSI).
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("export", "import")]
  [string]$Mode,

  [Parameter(Mandatory = $true)]
  [string]$Path,

  [switch]$Force
)

$ErrorActionPreference = "Stop"
$Root    = Split-Path -Parent $PSScriptRoot
$DataDir = Join-Path $Root "vellum\data"

function Test-Port([int]$port) {
  try {
    $c = New-Object Net.Sockets.TcpClient
    $c.Connect("127.0.0.1", $port)
    $c.Close()
    return $true
  } catch { return $false }
}

function Format-Size([long]$bytes) {
  if ($bytes -ge 1GB) { return ("{0:N1} GB" -f ($bytes / 1GB)) }
  if ($bytes -ge 1MB) { return ("{0:N0} MB" -f ($bytes / 1MB)) }
  return ("{0:N0} KB" -f ($bytes / 1KB))
}

if (Test-Port 3210) {
  if ($Force) {
    Write-Host "WARNING: Vellum is running on :3210 and -Force was given. The snapshot may be inconsistent." -ForegroundColor Yellow
  } else {
    Write-Host ""
    Write-Host "Vellum is running on :3210. Stop it first so the database is quiescent," -ForegroundColor Yellow
    Write-Host "or re-run with -Force if you accept a possibly torn snapshot." -ForegroundColor Yellow
    Write-Host ""
    exit 1
  }
}

# Everything worth carrying, relative to vellum\data. app.db-shm is deliberately
# omitted: it is a shared-memory index that SQLite rebuilds from the WAL, and a
# stale one travelling with a fresh WAL is worse than none.
$DbFiles  = @("app.db", "app.db-wal")
$BulkDirs = @("images", "icons-vectors.json")

# Compress-Archive opens sources with an exclusive share mode, so it cannot read
# a database the app has open - it logs a non-terminating error, skips the file,
# and still reports success. That silently produces an archive full of images
# with no library in it. Stage the small locked files through a tolerant read
# instead, and verify the result before claiming it worked.
function Copy-LockedFile([string]$src, [string]$dst) {
  $share = [IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete
  $in = [IO.File]::Open($src, [IO.FileMode]::Open, [IO.FileAccess]::Read, $share)
  try {
    $out = [IO.File]::Create($dst)
    try { $in.CopyTo($out) } finally { $out.Dispose() }
  } finally { $in.Dispose() }
}

function Get-ZipEntries([string]$zipPath) {
  # Windows PowerShell 5.1 writes backslash separators into entry names, unlike
  # the zip spec and unlike PowerShell 7. Normalize so callers can match either.
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $archive = [IO.Compression.ZipFile]::OpenRead($zipPath)
  try { return @($archive.Entries | ForEach-Object { $_.FullName -replace '\\', '/' }) }
  finally { $archive.Dispose() }
}

if ($Mode -eq "export") {
  if (-not (Test-Path $DataDir)) { throw "no data directory at $DataDir" }
  if ((Test-Path $Path) -and (-not $Force)) { throw "$Path already exists (use -Force to overwrite)" }
  if (-not (Test-Path (Join-Path $DataDir "app.db"))) { throw "no app.db in $DataDir - nothing to export" }

  $stage = Join-Path ([IO.Path]::GetTempPath()) ("vellum-snapshot-" + [Guid]::NewGuid().ToString("N"))
  New-Item -ItemType Directory -Path $stage | Out-Null

  try {
    $sources = @()
    $expectedImages = 0

    foreach ($name in $DbFiles) {
      $src = Join-Path $DataDir $name
      if (-not (Test-Path $src)) { continue }
      $dst = Join-Path $stage $name
      Copy-LockedFile $src $dst
      $sources += $dst
    }

    foreach ($name in $BulkDirs) {
      $src = Join-Path $DataDir $name
      if (Test-Path $src) { $sources += $src }
    }

    $imagesDir = Join-Path $DataDir "images"
    if (Test-Path $imagesDir) {
      $expectedImages = (Get-ChildItem $imagesDir -File -ErrorAction SilentlyContinue).Count
    }

    Write-Host ""
    Write-Host "Packing:"
    foreach ($p in $sources) {
      $size = (Get-ChildItem $p -Recurse -File -ErrorAction SilentlyContinue |
               Measure-Object -Property Length -Sum).Sum
      if ($null -eq $size) { $size = (Get-Item $p).Length }
      Write-Host ("  {0,-24} {1}" -f (Split-Path -Leaf $p), (Format-Size $size))
    }

    if (Test-Path $Path) { Remove-Item $Path -Force }
    Compress-Archive -Path $sources -DestinationPath $Path -CompressionLevel Optimal

    # Verify rather than trust: an archive missing the database looks fine by
    # size alone, and the failure would only surface on the target machine.
    $entries = Get-ZipEntries $Path
    if ($entries -notcontains "app.db") {
      Remove-Item $Path -Force -ErrorAction SilentlyContinue
      throw "app.db did not make it into the archive - snapshot discarded"
    }
    $packedImages = @($entries | Where-Object { $_ -like "images/*" -and $_ -notlike "*/" }).Count
    if ($packedImages -ne $expectedImages) {
      throw ("image count mismatch: {0} on disk, {1} in the archive" -f $expectedImages, $packedImages)
    }

    Write-Host ""
    Write-Host ("Wrote {0} ({1})" -f $Path, (Format-Size (Get-Item $Path).Length)) -ForegroundColor Green
    Write-Host ("Verified: app.db present, {0} images, icon vectors {1}" -f `
      $packedImages, $(if ($entries -contains "icons-vectors.json") { "present" } else { "ABSENT" }))
    Write-Host ""
    Write-Host "On the new machine:"
    Write-Host ("  .\scripts\install.ps1 -RestoreFrom " + $Path)
    Write-Host ""
  }
  finally {
    Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
  }
}
else {
  if (-not (Test-Path $Path)) { throw "snapshot not found: $Path" }

  $existingDb = Join-Path $DataDir "app.db"
  if ((Test-Path $existingDb) -and (-not $Force)) {
    throw "a database already exists at $existingDb - use -Force to overwrite it"
  }

  if (-not (Test-Path $DataDir)) { New-Item -ItemType Directory -Path $DataDir | Out-Null }
  Expand-Archive -Path $Path -DestinationPath $DataDir -Force

  $imageCount = 0
  $imagesDir = Join-Path $DataDir "images"
  if (Test-Path $imagesDir) {
    $imageCount = (Get-ChildItem $imagesDir -File -ErrorAction SilentlyContinue).Count
  }

  Write-Host ""
  Write-Host ("Restored into " + $DataDir) -ForegroundColor Green
  Write-Host ("  images            {0} files" -f $imageCount)
  Write-Host ("  icon vectors      {0}" -f $(if (Test-Path (Join-Path $DataDir "icons-vectors.json")) { "present" } else { "MISSING - run: npx tsx scripts\embed-icons.ts" }))
  Write-Host ""
  Write-Host "Apply any newer migrations before starting:"
  Write-Host "  cd vellum ; npx prisma migrate deploy"
  Write-Host ""
}
