# Launch ComfyUI pinned to GPU 1 (Ollama keeps GPU 0), localhost:8188.
$Comfy = Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) "ComfyUI"
$Python = Join-Path $Comfy ".venv\Scripts\python.exe"
Set-Location $Comfy
& $Python main.py --listen 127.0.0.1 --port 8188 --cuda-device 1
