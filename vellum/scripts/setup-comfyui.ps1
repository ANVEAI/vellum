# ComfyUI setup for vellum — Windows Server 2025, 2x NVIDIA H200.
# Idempotent: safe to re-run; each step skips work already done.
# Models: FLUX.1-schnell fp8 (Apache-2.0, ~17 GB, on C:),
#         Qwen-Image fp8 (Apache-2.0) + HiDream-I1 dev fp8 (MIT), ~63 GB total,
#         stored on D:\comfyui-models (C: is nearly full) and registered via
#         ComfyUI's extra_model_paths.yaml.

# "Continue" not "Stop": PS 5.1 converts native-command stderr (pip progress,
# warnings) into ErrorRecords that would abort the script under Stop. Critical
# steps check $LASTEXITCODE explicitly instead.
$ErrorActionPreference = "Continue"
$Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$Comfy = Join-Path $Root "ComfyUI"
$Python = Join-Path $Comfy ".venv\Scripts\python.exe"

Write-Host "== [1/7] Clone ComfyUI =="
if (-not (Test-Path (Join-Path $Comfy "main.py"))) {
  git clone https://github.com/comfyanonymous/ComfyUI $Comfy
} else {
  Write-Host "already cloned"
}

Write-Host "== [2/7] Python venv (uv, CPython 3.11) =="
if (-not (Test-Path $Python)) {
  $env:UV_PYTHON_INSTALL_DIR = "C:\uv_python"
  Set-Location $Comfy
  uv venv --python 3.11 .venv
} else {
  Write-Host "venv exists"
}

Write-Host "== [3/7] PyTorch cu128 + requirements =="
# cmd-level probe: PS 5.1 wraps native stderr into ErrorRecords, which throws
# under ErrorActionPreference=Stop even for an expected import failure.
cmd /c "`"$Python`" -c `"import torch`" >nul 2>nul"
$hasTorch = ($LASTEXITCODE -eq 0)
if (-not $hasTorch) {
  # uv-created venvs ship without pip; drive installs via uv against the venv.
  cmd /c "uv pip install --python `"$Python`" torch torchvision --index-url https://download.pytorch.org/whl/cu128 2>&1"
  if ($LASTEXITCODE -ne 0) { throw "torch install failed" }
  cmd /c "uv pip install --python `"$Python`" -r `"$(Join-Path $Comfy 'requirements.txt')`" 2>&1"
  if ($LASTEXITCODE -ne 0) { throw "requirements install failed" }
} else {
  Write-Host "torch present"
}

Write-Host "== [4/7] CUDA check =="
& $Python -c "import torch; print('cuda:', torch.cuda.is_available(), 'devices:', torch.cuda.device_count())"

Write-Host "== [5/7] FLUX.1-schnell fp8 checkpoint (~17 GB) =="
$ckptDir = Join-Path $Comfy "models\checkpoints"
$ckpt = Join-Path $ckptDir "flux1-schnell-fp8.safetensors"
if (-not (Test-Path $ckpt)) {
  cmd /c "uv pip install --python `"$Python`" huggingface_hub 2>&1"
  cmd /c "`"$Python`" -c `"from huggingface_hub import hf_hub_download; hf_hub_download('Comfy-Org/flux1-schnell','flux1-schnell-fp8.safetensors', local_dir=r'$ckptDir')`" 2>&1"
  if ($LASTEXITCODE -ne 0) { throw "checkpoint download failed" }
} else {
  Write-Host "checkpoint present"
}

Write-Host "== [6/7] extra_model_paths.yaml (large models live on D:) =="
$ModelRoot = "D:\comfyui-models"
foreach ($kind in @("diffusion_models", "text_encoders", "vae", "_hf_staging")) {
  New-Item -ItemType Directory -Force (Join-Path $ModelRoot $kind) | Out-Null
}
$yamlPath = Join-Path $Comfy "extra_model_paths.yaml"
if (-not (Test-Path $yamlPath)) {
  # ASCII on purpose: PS 5.1 utf8 writes a BOM, which some YAML readers choke on.
  @"
# Extra model search paths for ComfyUI (loaded at startup).
# C: is nearly full, so large model weights live on D:.
# Managed by vellum/scripts/setup-comfyui.ps1 — safe to re-run setup.
vellum_d:
    base_path: D:\comfyui-models
    diffusion_models: diffusion_models
    text_encoders: text_encoders
    vae: vae
"@ | Set-Content -Path $yamlPath -Encoding Ascii
} else {
  Write-Host "extra_model_paths.yaml present"
}

Write-Host "== [7/7] Qwen-Image + HiDream-I1 weights (~63 GB total) =="
# Comfy-Org repackaged weights. fp8 variants sized for a 143 GB H200.
# hf_hub_download resumes partial downloads (staging dir), then the finished
# file is moved flat into D:\comfyui-models\<kind>\ where ComfyUI finds it.
$ModelFiles = @(
  @{ Repo = "Comfy-Org/Qwen-Image_ComfyUI"; Path = "split_files/diffusion_models/qwen_image_fp8_e4m3fn.safetensors"; Kind = "diffusion_models" },
  @{ Repo = "Comfy-Org/Qwen-Image_ComfyUI"; Path = "split_files/text_encoders/qwen_2.5_vl_7b_fp8_scaled.safetensors"; Kind = "text_encoders" },
  @{ Repo = "Comfy-Org/Qwen-Image_ComfyUI"; Path = "split_files/vae/qwen_image_vae.safetensors"; Kind = "vae" },
  @{ Repo = "Comfy-Org/HiDream-I1_ComfyUI"; Path = "split_files/diffusion_models/hidream_i1_dev_fp8.safetensors"; Kind = "diffusion_models" },
  @{ Repo = "Comfy-Org/HiDream-I1_ComfyUI"; Path = "split_files/text_encoders/clip_l_hidream.safetensors"; Kind = "text_encoders" },
  @{ Repo = "Comfy-Org/HiDream-I1_ComfyUI"; Path = "split_files/text_encoders/clip_g_hidream.safetensors"; Kind = "text_encoders" },
  @{ Repo = "Comfy-Org/HiDream-I1_ComfyUI"; Path = "split_files/text_encoders/t5xxl_fp8_e4m3fn_scaled.safetensors"; Kind = "text_encoders" },
  @{ Repo = "Comfy-Org/HiDream-I1_ComfyUI"; Path = "split_files/text_encoders/llama_3.1_8b_instruct_fp8_scaled.safetensors"; Kind = "text_encoders" },
  @{ Repo = "Comfy-Org/HiDream-I1_ComfyUI"; Path = "split_files/vae/ae.safetensors"; Kind = "vae" }
)
foreach ($f in $ModelFiles) {
  $leaf = Split-Path $f.Path -Leaf
  $dest = Join-Path (Join-Path $ModelRoot $f.Kind) $leaf
  if (Test-Path $dest) {
    Write-Host "present: $leaf"
    continue
  }
  $stage = Join-Path (Join-Path $ModelRoot "_hf_staging") ($f.Repo.Split("/")[-1])
  Write-Host "downloading: $($f.Repo)/$($f.Path)"
  cmd /c "`"$Python`" -c `"from huggingface_hub import hf_hub_download; import shutil; p = hf_hub_download('$($f.Repo)', '$($f.Path)', local_dir=r'$stage'); shutil.move(p, r'$dest')`" 2>&1"
  if ($LASTEXITCODE -ne 0) { throw "download failed: $($f.Path)" }
}

Write-Host "Setup complete. Start with: scripts\start-comfyui.ps1"
