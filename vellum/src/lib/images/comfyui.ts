/**
 * ComfyUI image provider.
 *
 * Faithful TypeScript port of Presenton's ComfyUI integration (Apache-2.0,
 * servers/fastapi/services/image_generation_service.py:430-843) — see
 * THIRD_PARTY_LICENSES.md and NOTICE. Behavior preserved: "Input Prompt"
 * titled-node injection with preferred keys + link following, recursive
 * seed randomization (including linked seed-source nodes), POST /prompt,
 * poll /history, download via /view.
 */
import { randomUUID } from "node:crypto";

type Json = Record<string, unknown>;
type WorkflowNode = { inputs?: Record<string, unknown>; _meta?: { title?: string } };

const PREFERRED_KEYS = [
  "text",
  "value",
  "prompt",
  "string",
  "content",
  "instruction",
  "input",
  "query",
];
const IGNORE_KEYS = new Set([
  "filename_prefix",
  "ckpt_name",
  "clip_name",
  "vae_name",
  "unet_name",
  "sampler_name",
  "scheduler",
  "type",
  "device",
  "model",
  "lora_name",
]);
const SEED_SOURCE_VALUE_KEYS = new Set(["value", "int", "integer", "number"]);
const MAX_SEED = 2 ** 53 - 1;

function norm(x: unknown): string {
  return String(x ?? "").trim().toLowerCase();
}

function isLink(v: unknown): v is [string | number, number] {
  return (
    Array.isArray(v) &&
    v.length >= 2 &&
    (typeof v[0] === "string" || typeof v[0] === "number") &&
    typeof v[1] === "number"
  );
}

function nodeIndex(workflow: Json): Map<string, WorkflowNode> {
  const index = new Map<string, WorkflowNode>();
  for (const [id, node] of Object.entries(workflow)) {
    if (node && typeof node === "object") index.set(id, node as WorkflowNode);
  }
  return index;
}

export function injectPromptIntoWorkflow(workflow: Json, prompt: string): Json {
  const index = nodeIndex(workflow);
  const visited = new Set<string>();

  function trySet(nodeId: string): boolean {
    nodeId = String(nodeId);
    if (visited.has(nodeId)) return false;
    visited.add(nodeId);
    const node = index.get(nodeId);
    if (!node) return false;
    const inputs = (node.inputs ??= {});

    for (const key of PREFERRED_KEYS) {
      if (key in inputs && typeof inputs[key] === "string") {
        inputs[key] = prompt;
        return true;
      }
    }
    const stringCandidates = Object.entries(inputs)
      .filter(([k, v]) => typeof v === "string" && !IGNORE_KEYS.has(k))
      .map(([k]) => k);
    if (stringCandidates.length === 1) {
      inputs[stringCandidates[0]] = prompt;
      return true;
    }
    for (const v of Object.values(inputs)) {
      if (isLink(v)) {
        if (trySet(String(v[0]))) return true;
      } else if (Array.isArray(v)) {
        for (const item of v) {
          if (isLink(item) && trySet(String(item[0]))) return true;
        }
      }
    }
    return false;
  }

  const promptNodes = [...index.entries()]
    .filter(([, node]) => norm(node._meta?.title) === "input prompt")
    .map(([id]) => id);

  if (promptNodes.length === 0) {
    throw new Error(
      "Could not find node with title 'Input Prompt'. Rename your prompt node to 'Input Prompt'.",
    );
  }
  for (const id of promptNodes) {
    if (trySet(id)) return workflow;
  }
  throw new Error(
    "Found 'Input Prompt', but no writable prompt string field was found directly or through linked nodes.",
  );
}

function isSeedKey(key: unknown): boolean {
  const normalized = norm(key).replace(/_/g, "");
  return normalized === "seed" || normalized.endsWith("seed");
}

function isSeedValue(value: unknown): boolean {
  if (typeof value === "boolean") return false;
  if (typeof value === "number" && Number.isInteger(value)) return true;
  if (typeof value === "string") {
    const raw = value.trim();
    return /^-?\d+$/.test(raw);
  }
  return false;
}

function newSeed(): number {
  return Math.floor(Math.random() * MAX_SEED);
}

export function injectRandomSeeds(workflow: Json): number {
  const index = nodeIndex(workflow);
  let count = 0;

  function randomizeInput(inputs: Record<string, unknown>, key: string): boolean {
    const value = inputs[key];
    if (!isSeedValue(value)) return false;
    const seed = newSeed();
    inputs[key] = typeof value === "string" ? String(seed) : seed;
    count += 1;
    return true;
  }

  function randomizeLinkedSource(link: [string | number, number]) {
    const source = index.get(String(link[0]));
    const inputs = source?.inputs;
    if (!inputs) return;
    let updated = false;
    for (const key of Object.keys(inputs)) {
      if (isSeedKey(key)) updated = randomizeInput(inputs, key) || updated;
    }
    if (updated) return;
    const candidates = Object.entries(inputs)
      .filter(
        ([k, v]) => SEED_SOURCE_VALUE_KEYS.has(norm(k)) && isSeedValue(v),
      )
      .map(([k]) => k);
    if (candidates.length === 1) randomizeInput(inputs, candidates[0]);
  }

  for (const node of index.values()) {
    const inputs = node.inputs;
    if (!inputs) continue;
    for (const [key, value] of Object.entries(inputs)) {
      if (!isSeedKey(key)) continue;
      if (isLink(value)) randomizeLinkedSource(value);
      else randomizeInput(inputs, key);
    }
  }
  return count;
}

interface HistoryEntry {
  status?: { completed?: boolean; status_str?: string };
  outputs?: Record<
    string,
    { images?: Array<{ filename: string; subfolder: string; type: string }> }
  >;
}

/** Fill a node titled "Negative" when present (no-op otherwise). */
export function injectNegativePrompt(workflow: Json, negative: string): boolean {
  for (const node of Object.values(workflow)) {
    const candidate = node as WorkflowNode;
    if (norm(candidate?._meta?.title) !== "negative") continue;
    const inputs = (candidate.inputs ??= {});
    if (typeof inputs.text === "string" || inputs.text === undefined) {
      inputs.text = negative;
      return true;
    }
  }
  return false;
}

export async function generateComfyuiImage(options: {
  comfyuiUrl: string;
  workflow: Json;
  prompt: string;
  negativePrompt?: string;
  timeoutMs?: number;
  pollMs?: number;
}): Promise<Buffer> {
  const base = options.comfyuiUrl.replace(/\/+$/, "");
  const workflow = structuredClone(options.workflow);
  injectPromptIntoWorkflow(workflow, options.prompt);
  if (options.negativePrompt) {
    injectNegativePrompt(workflow, options.negativePrompt);
  }
  injectRandomSeeds(workflow);

  const submit = await fetch(`${base}/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: workflow, client_id: randomUUID() }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!submit.ok) {
    const detail = await submit.text().catch(() => "");
    throw new Error(`ComfyUI submit failed HTTP ${submit.status}: ${detail.slice(0, 300)}`);
  }
  const { prompt_id: promptId } = (await submit.json()) as { prompt_id: string };
  if (!promptId) throw new Error("ComfyUI did not return a prompt_id");

  const timeoutMs = options.timeoutMs ?? 300_000;
  const pollMs = options.pollMs ?? 2_000;
  const start = Date.now();
  let history: HistoryEntry | undefined;

  while (true) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`ComfyUI generation timed out after ${timeoutMs / 1000}s`);
    }
    const res = await fetch(`${base}/history/${promptId}`, {
      signal: AbortSignal.timeout(15_000),
    });
    if (res.ok) {
      const data = (await res.json()) as Record<string, HistoryEntry>;
      const entry = data[promptId];
      if (entry?.outputs && Object.keys(entry.outputs).length > 0) {
        history = entry;
        break;
      }
      if (entry?.status?.status_str === "error") {
        throw new Error("ComfyUI reported an execution error");
      }
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }

  for (const output of Object.values(history!.outputs!)) {
    for (const image of output.images ?? []) {
      if (image.type !== "output") continue;
      const url = new URL(`${base}/view`);
      url.searchParams.set("filename", image.filename);
      url.searchParams.set("type", image.type);
      url.searchParams.set("subfolder", image.subfolder ?? "");
      const download = await fetch(url, { signal: AbortSignal.timeout(60_000) });
      if (!download.ok) continue;
      return Buffer.from(await download.arrayBuffer());
    }
  }
  throw new Error("ComfyUI completed but produced no output image");
}
