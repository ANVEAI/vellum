/**
 * ComfyUI smoke test: submit the committed 16:9 FLUX workflow with a test
 * prompt, poll, download to data/images/smoke.png.
 *
 *   npx tsx scripts/smoke-comfyui.ts
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { generateComfyuiImage } from "../src/lib/images/comfyui";

const COMFYUI_URL = process.env.COMFYUI_URL ?? "http://127.0.0.1:8188";

async function main() {
  const workflow = JSON.parse(
    readFileSync(
      path.resolve(__dirname, "../assets/comfyui/flux-schnell-16x9.json"),
      "utf8",
    ),
  ) as Record<string, unknown>;

  console.log(`submitting to ${COMFYUI_URL}…`);
  const started = Date.now();
  const bytes = await generateComfyuiImage({
    comfyuiUrl: COMFYUI_URL,
    workflow,
    prompt:
      "photorealistic aerial view of a futuristic solar farm at golden hour, dramatic clouds, crisp detail",
  });
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  const out = path.resolve(__dirname, "../data/images");
  mkdirSync(out, { recursive: true });
  writeFileSync(path.join(out, "smoke.png"), bytes);
  console.log(`OK in ${secs}s — ${bytes.length} bytes → data/images/smoke.png`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
