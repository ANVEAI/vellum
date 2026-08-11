# Optional companions for Vellum. NOTHING here is required to run the app.
#
# Vellum is standalone: it talks to ComfyUI and SearXNG over HTTP if they
# happen to be running, and degrades gracefully if they are not (no images /
# no research grounding; content generation still works). It has no code
# dependency on presenton or presentation-ai at all.
#
#   .\setup-dependencies.ps1              # show what's available, clone nothing
#   .\setup-dependencies.ps1 -Images      # ComfyUI, for local image generation
#   .\setup-dependencies.ps1 -Research    # SearXNG, for web research
#   .\setup-dependencies.ps1 -Reference   # the projects code was ported from
#   .\setup-dependencies.ps1 -All
#
# All clones are --depth 1 (code only, no history). Sizes below are the code;
# ComfyUI's 17 GB of model weights are a SEPARATE download and are not
# fetched here.
#
# NOTE: keep this file pure ASCII (Windows PowerShell 5.1 reads .ps1 as ANSI).
param(
  [switch]$Images,
  [switch]$Research,
  [switch]$Reference,
  [switch]$All
)
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot

$catalog = @(
  @{ Key = "Images";    Name = "ComfyUI";         Size = "~150 MB code";
     Url = "https://github.com/comfyanonymous/ComfyUI";
     Why = "local image generation on your GPU (port 8188)";
     Extra = "model weights are a separate ~17 GB download - see vellum\scripts\setup-comfyui.ps1" },
  @{ Key = "Research";  Name = "searxng";         Size = "~60 MB code";
     Url = "https://github.com/searxng/searxng.git";
     Why = "local web research so decks cite current facts (port 8888)";
     Extra = "config lives in searxng_config\settings.yml, already in this repo" },
  @{ Key = "Reference"; Name = "presenton";       Size = "~80 MB code";
     Url = "https://github.com/presenton/presenton.git";
     Why = "REFERENCE ONLY - Apache-2.0 project some engine ideas came from";
     Extra = "not used at runtime; clone only if you want to read the source" },
  @{ Key = "Reference"; Name = "presentation-ai"; Size = "~15 MB code";
     Url = "https://github.com/allweonedev/presentation-ai.git";
     Why = "REFERENCE ONLY - MIT project the parser/themes/layouts were ported from";
     Extra = "not used at runtime; clone only if you want to read the source" }
)

$selected = @()
foreach ($item in $catalog) {
  if ($All -or (Get-Variable -Name $item.Key -ValueOnly)) { $selected += $item }
}

if ($selected.Count -eq 0) {
  Write-Host ""
  Write-Host "Vellum runs without any of these. They are all optional:" -ForegroundColor Cyan
  Write-Host ""
  foreach ($item in $catalog) {
    $present = if (Test-Path (Join-Path $Root $item.Name ".git")) { "[installed]" } else { "" }
    Write-Host ("  -{0,-10} {1,-16} {2,-14} {3} {4}" -f $item.Key, $item.Name, $item.Size, $item.Why, $present)
    Write-Host ("  {0,-11} {1}" -f "", $item.Extra) -ForegroundColor DarkGray
  }
  Write-Host ""
  Write-Host "Re-run with the switches you want, e.g.:  .\setup-dependencies.ps1 -Images -Research"
  Write-Host ""
  return
}

foreach ($item in $selected) {
  $path = Join-Path $Root $item.Name
  if (Test-Path (Join-Path $path ".git")) {
    Write-Host ("{0,-16} already present - skipping" -f $item.Name)
    continue
  }
  Write-Host ("{0,-16} cloning {1} ({2})" -f $item.Name, $item.Size, $item.Why)
  git clone --depth 1 $item.Url $path
  if ($item.Extra) { Write-Host ("{0,-16} note: {1}" -f "", $item.Extra) -ForegroundColor DarkGray }
}

Write-Host ""
Write-Host "Done. Vellum itself is set up from vellum\ - see the root README." -ForegroundColor Cyan
