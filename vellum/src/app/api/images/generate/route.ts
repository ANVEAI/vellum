import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getSettings } from "@/lib/settings";
import { generateImage, type ComfyModel } from "@/lib/images/provider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COMFY_MODELS = new Set(["flux-schnell", "qwen-image", "hidream"]);

/** One-off image generation (settings test button, manual regenerate). */
export async function POST(request: NextRequest) {
  const { prompt, shape, model } = (await request.json().catch(() => ({}))) as {
    prompt?: string;
    shape?: "16x9" | "square";
    model?: string;
  };
  if (!prompt?.trim()) {
    return NextResponse.json({ error: "prompt required" }, { status: 400 });
  }
  const settings = await getSettings();
  try {
    const started = Date.now();
    const result = await generateImage(
      settings,
      prompt,
      shape ?? "16x9",
      model && COMFY_MODELS.has(model) ? (model as ComfyModel) : undefined,
    );
    const dir = path.resolve(process.cwd(), "data/images");
    mkdirSync(dir, { recursive: true });
    const filename = `${randomUUID().replace(/-/g, "")}.${result.ext}`;
    writeFileSync(path.join(dir, filename), result.bytes);
    return NextResponse.json({
      url: `/api/images/file/${filename}`,
      seconds: Number(((Date.now() - started) / 1000).toFixed(1)),
      provider: settings.images.provider,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 502 },
    );
  }
}
