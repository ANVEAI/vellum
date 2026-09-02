# Start vellum in production mode on :3210, LOOPBACK ONLY.
# Always rebuilds: dev and prod share the .next directory, so a stale dev
# build must never be served (and vice versa - don't run `npm run build`
# while `npm run dev` is running).
#
# Vellum has one shared password and no per-user ownership, so it is not safe
# on the LAN. It binds 127.0.0.1 (see the -H flag in package.json's start
# script) and users reach its editor only through ANVE's authenticated proxy
# at https://<host>:8443/vellum, which enforces per-user deck ownership.
# Because that is IPv4-only, APP_ORIGIN in .env is pinned to the 127.0.0.1
# literal: "localhost" can resolve to ::1 first, and the headless-Chromium
# exporter would then fail every PDF/PPTX export.
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
