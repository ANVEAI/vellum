# Start vellum in production mode on :3210, reachable from the LAN.
# Always rebuilds: dev and prod share the .next directory, so a stale dev
# build must never be served (and vice versa - don't run `npm run build`
# while `npm run dev` is running).
#
# Next binds :: (dual-stack) by default, which already covers every
# interface. Do NOT pass -H 0.0.0.0; that would drop IPv6.
#
# NOTE: keep this file pure ASCII (Windows PowerShell 5.1 reads .ps1 as ANSI).
# Derived from this script's own location, so the checkout works under any
# user account or drive.
$App = Split-Path -Parent $PSScriptRoot
Set-Location $App
npm run build
if ($LASTEXITCODE -ne 0) { throw "vellum build failed" }
& "$App\scripts\lan-url.ps1"
npm run start
