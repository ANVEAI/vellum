/**
 * Image provider dispatch: comfyui (default, offline) | gemini (Nano
 * Banana) | pexels (stock) | none. Returns raw image bytes + extension.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import type { AppSettings } from "@/lib/settings";
import { generateComfyuiImage } from "./comfyui";

export interface GeneratedImageResult {
  bytes: Buffer;
  ext: "png" | "jpeg";
}

export type ComfyModel = "flux-schnell" | "qwen-image" | "hidream";

/**
 * Image shapes matched to slide slots: 16x9 full-bleed/vertical bands,
 * portrait for the side rail, wide for short strips, square for inline
 * item images. Portrait/wide reuse the 16x9 workflow with the latent node
 * re-dimensioned (all sizes divisible by 16 for Qwen/HiDream).
 */
export type ImageShape = "16x9" | "square" | "portrait" | "wide" | "band";

/**
 * Overridden latent sizes. All divisible by 16 for Qwen/HiDream.
 *
 * `16x9` is rendered at 1920×1088 rather than the slide's own 1280×720: a
 * hero image shown fullscreen on a 1080p display was being upscaled 1.5×, and
 * placed at only 96 DPI in PDF and PowerPoint.
 *
 * `band` exists because a "vertical" layout's image strip is roughly 4.2:1 —
 * feeding it the 2.4:1 `wide` shape threw away 43% of every such image.
 */
const SHAPE_DIMENSIONS: Record<
  "portrait" | "wide" | "band" | "16x9",
  { width: number; height: number }
> = {
  "16x9": { width: 1920, height: 1088 },
  portrait: { width: 832, height: 1216 },
  wide: { width: 1536, height: 640 },
  band: { width: 1536, height: 384 },
};

let workflowCache = new Map<string, Record<string, unknown>>();

function loadWorkflow(
  model: ComfyModel,
  shape: ImageShape,
): Record<string, unknown> {
  const key = `${model}-${shape}`;
  const cached = workflowCache.get(key);
  if (cached) return cached;

  const baseShape = shape === "square" ? "square" : "16x9";
  const file = path.resolve(
    process.cwd(),
    `assets/comfyui/${model}-${baseShape}.json`,
  );
  const workflow = JSON.parse(readFileSync(file, "utf8")) as Record<
    string,
    unknown
  >;
  if (shape !== "square") {
    const dims = SHAPE_DIMENSIONS[shape];
    for (const node of Object.values(workflow)) {
      const candidate = node as {
        class_type?: string;
        inputs?: Record<string, unknown>;
      };
      if (
        candidate?.class_type?.includes("LatentImage") &&
        candidate.inputs &&
        typeof candidate.inputs.width === "number"
      ) {
        candidate.inputs.width = dims.width;
        candidate.inputs.height = dims.height;
      }
    }
  }
  workflowCache.set(key, workflow);
  return workflow;
}

export function invalidateWorkflowCache() {
  workflowCache = new Map();
}

/** Gemini takes no aspect parameter, so the shape has to go in the prompt. */
const SHAPE_HINT: Record<ImageShape, string> = {
  "16x9": "Compose for a 16:9 widescreen frame.",
  square: "Compose for a square frame.",
  portrait: "Compose for a tall 2:3 portrait frame.",
  wide: "Compose for a wide 12:5 banner frame.",
  band: "Compose for a very wide 4:1 letterbox banner frame.",
};

async function generateGeminiImage(
  settings: AppSettings,
  prompt: string,
  shape: ImageShape = "16x9",
): Promise<GeneratedImageResult> {
  const { geminiApiKey, geminiModel } = settings.images;
  if (!geminiApiKey) throw new Error("Gemini API key is not configured");
  prompt = `${prompt} ${SHAPE_HINT[shape]}`;
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": geminiApiKey,
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseModalities: ["IMAGE"] },
      }),
      signal: AbortSignal.timeout(120_000),
    },
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Gemini HTTP ${res.status}: ${detail.slice(0, 200)}`);
  }
  const data = (await res.json()) as {
    candidates?: Array<{
      content?: { parts?: Array<{ inlineData?: { data: string; mimeType: string } }> };
    }>;
  };
  for (const candidate of data.candidates ?? []) {
    for (const part of candidate.content?.parts ?? []) {
      if (part.inlineData?.data) {
        return {
          bytes: Buffer.from(part.inlineData.data, "base64"),
          ext: part.inlineData.mimeType?.includes("png") ? "png" : "jpeg",
        };
      }
    }
  }
  throw new Error("Gemini returned no image data");
}

async function fetchPexelsImage(
  settings: AppSettings,
  prompt: string,
  shape: ImageShape = "16x9",
): Promise<GeneratedImageResult> {
  const key = settings.images.pexelsApiKey;
  if (!key) throw new Error("Pexels API key is not configured");
  const url = new URL("https://api.pexels.com/v1/search");
  url.searchParams.set("query", prompt.slice(0, 100));
  url.searchParams.set("per_page", "1");
  // Follow the slot instead of always asking for landscape — a portrait rail
  // filled with landscape stock lost ~60% of its width to the crop.
  url.searchParams.set(
    "orientation",
    shape === "portrait" ? "portrait" : shape === "square" ? "square" : "landscape",
  );
  const res = await fetch(url, {
    headers: { Authorization: key },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Pexels HTTP ${res.status}`);
  const data = (await res.json()) as {
    photos?: Array<{ src?: { large2x?: string; large?: string } }>;
  };
  const src = data.photos?.[0]?.src?.large2x ?? data.photos?.[0]?.src?.large;
  if (!src) throw new Error("Pexels returned no results");
  const img = await fetch(src, { signal: AbortSignal.timeout(60_000) });
  if (!img.ok) throw new Error(`Pexels download HTTP ${img.status}`);
  return { bytes: Buffer.from(await img.arrayBuffer()), ext: "jpeg" };
}

export async function generateImage(
  settings: AppSettings,
  prompt: string,
  shape: ImageShape = "16x9",
  modelOverride?: ComfyModel,
  negativePrompt?: string,
): Promise<GeneratedImageResult> {
  switch (settings.images.provider) {
    case "comfyui": {
      const bytes = await generateComfyuiImage({
        comfyuiUrl: settings.images.comfyuiUrl,
        workflow: loadWorkflow(
          modelOverride ?? settings.images.comfyModel,
          settings.images.comfyuiWorkflow === "square" && shape === "16x9"
            ? "square"
            : shape,
        ),
        prompt,
        negativePrompt,
      });
      return { bytes, ext: "png" };
    }
    case "gemini":
      return generateGeminiImage(settings, prompt, shape);
    case "pexels":
      return fetchPexelsImage(settings, prompt, shape);
    case "none":
      throw new Error("Image generation is disabled (provider: none)");
  }
}
