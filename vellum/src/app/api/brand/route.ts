import { mkdirSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { updateSettings } from "@/lib/settings";
import { brandFromUrl, paletteFromImage } from "@/lib/brand/extract";
import { brandFromPptx } from "@/lib/brand/pptx-theme";

export const runtime = "nodejs";

function saveImage(bytes: Buffer, ext: "png" | "jpeg"): string {
  const dir = path.resolve(process.cwd(), "data/images");
  mkdirSync(dir, { recursive: true });
  const filename = `${randomUUID().replace(/-/g, "")}.${ext}`;
  writeFileSync(path.join(dir, filename), bytes);
  return `/api/images/file/${filename}`;
}

/**
 * Extract a brand kit from an uploaded logo (offline) or a company URL
 * (best-effort online), persist it into settings, return it.
 */
export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get("content-type") ?? "";
    let colors: string[] = [];
    let logoUrl = "";
    let name = "";

    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const file = form.get("file");
      if (!(file instanceof File)) {
        return NextResponse.json({ error: "file required" }, { status: 400 });
      }

      // A corporate deck: pull the Office theme's palette + typefaces.
      if (file.name.toLowerCase().endsWith(".pptx")) {
        const extracted = await brandFromPptx(
          Buffer.from(await file.arrayBuffer()),
        );
        const brand = {
          name: extracted.name ?? file.name.replace(/\.pptx$/i, ""),
          logoUrl: "",
          colors: extracted.colors,
        };
        await updateSettings({ brand });
        return NextResponse.json({ ...brand, fonts: extracted.fonts }, { status: 201 });
      }

      const ext = file.type.includes("png") ? "png" : file.type.includes("jpe") ? "jpeg" : null;
      if (!ext) {
        return NextResponse.json(
          { error: "Upload a PNG/JPEG logo or a .pptx brand deck" },
          { status: 415 },
        );
      }
      const bytes = Buffer.from(await file.arrayBuffer());
      colors = await paletteFromImage(bytes);
      if (colors.length === 0) {
        return NextResponse.json(
          { error: "Could not find distinct brand colors in that image" },
          { status: 422 },
        );
      }
      logoUrl = saveImage(bytes, ext);
      name = file.name.replace(/\.[^.]+$/, "");
    } else {
      const { url } = (await request.json().catch(() => ({}))) as { url?: string };
      if (!url?.trim()) {
        return NextResponse.json({ error: "url required" }, { status: 400 });
      }
      const extracted = await brandFromUrl(url.trim());
      colors = extracted.colors;
      name = extracted.name ?? new URL(url.startsWith("http") ? url : `https://${url}`).hostname;
      if (extracted.logoBytes && extracted.logoExt) {
        logoUrl = saveImage(extracted.logoBytes, extracted.logoExt);
      }
    }

    const brand = { name, logoUrl, colors };
    await updateSettings({ brand });
    return NextResponse.json(brand, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 502 },
    );
  }
}
