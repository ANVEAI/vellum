# Prints the URL(s) Vellum is reachable at from other machines on the LAN.
#
# Next.js binds :: (dual-stack) by default, so the app already listens on
# every interface. This only resolves which address to hand out. Virtual
# switches (WSL/Hyper-V) and link-local 169.254.x addresses are filtered
# out because they are not reachable from the LAN.
#
# NOTE: keep this file pure ASCII. Windows PowerShell 5.1 reads .ps1 as ANSI
# unless there is a BOM, so UTF-8 punctuation here becomes a parse error.
param([int]$Port = 3210)

$addresses = Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object {
    $_.IPAddress -ne "127.0.0.1" -and
    $_.IPAddress -notlike "169.254.*" -and
    $_.InterfaceAlias -notmatch "Loopback|vEthernet|WSL|Hyper-V|VirtualBox|VMware"
  } |
  Sort-Object -Property @{ Expression = { $_.PrefixOrigin -eq "Dhcp" }; Descending = $true }

if (-not $addresses) {
  Write-Host "No LAN address found - this machine may only have virtual adapters." -ForegroundColor Yellow
  return
}

Write-Host ""
Write-Host "Vellum on the LAN:" -ForegroundColor Cyan
foreach ($a in $addresses) {
  Write-Host ("  http://{0}:{1}   ({2})" -f $a.IPAddress, $Port, $a.InterfaceAlias)
}
Write-Host "  Sign in with APP_PASSWORD from vellum\.env"
Write-Host ""
