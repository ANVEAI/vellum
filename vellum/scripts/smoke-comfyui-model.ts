/**
 * Per-model ComfyUI smoke test: submit any committed workflow JSON with a test
 * prompt (includes visible "VELLUM" sign text to exercise text rendering),
 * poll, download to data/images/smoke-<workflow>.png.
 *
 *   npx tsx scripts/smoke-comfyui-model.ts qwen-image-16x9.json
 *   npx tsx scripts/smoke-comfyui-model.ts hidream-16x9.json [--prompt "..."]
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { generateComfyuiImage } from "../src/lib/images/comfyui";

const COMFYUI_URL = process.env.COMFYUI_URL ?? "http://127.0.0.1:8188";

const DEFAULT_PROMPT =
  "photorealistic street scene at dusk, a cozy bookshop with a large hanging " +
  'wooden sign that says "VELLUM" in elegant serif letters, warm window light, ' +
  "wet cobblestones, crisp detail";

function parseArgs(argv: string[]): { workflowFile: string; prompt: string } {
  const args = [...argv];
  let prompt = DEFAULT_PROMPT;
  const promptIdx = args.indexOf("--prompt");
  if (promptIdx !== -1) {
    prompt = args[promptIdx + 1] ?? DEFAULT_PROMPT;
    args.splice(promptIdx, 2);
  }
  const workflowFile = args[0];
  if (!workflowFile) {
    console.error(
      "usage: npx tsx scripts/smoke-comfyui-model.ts <workflow.json> [--prompt \"...\"]",
    );
    process.exit(2);
  }
  return { workflowFile, prompt };
}

async function main() {
  const { workflowFile, prompt } = parseArgs(process.argv.slice(2));
  const workflowPath = path.isAbsolute(workflowFile)
    ? workflowFile
    : path.resolve(__dirname, "../assets/comfyui", workflowFile);
  const workflow = JSON.parse(readFileSync(workflowPath, "utf8")) as Record<
    string,
    unknown
  >;

  console.log(`workflow: ${workflowPath}`);
  console.log(`submitting to ${COMFYUI_URL}…`);
  const started = Date.now();
  const bytes = await generateComfyuiImage({
    comfyuiUrl: COMFYUI_URL,
    workflow,
    prompt,
    timeoutMs: 900_000, // first run includes cold model load from disk
  });
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  const out = path.resolve(__dirname, "../data/images");
  mkdirSync(out, { recursive: true });
  const name = `smoke-${path.basename(workflowFile).replace(/\.json$/i, "")}.png`;
  writeFileSync(path.join(out, name), bytes);
  console.log(`OK in ${secs}s — ${bytes.length} bytes → data/images/${name}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
