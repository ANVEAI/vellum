import { mkdirSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const EXT_BY_MIME: Record<string, "png" | "jpeg"> = {
  "image/png": "png",
  "image/jpeg": "jpeg",
  "image/jpg": "jpeg",
};

/** User-supplied image (editor "replace image") → data/images, same URL space
 *  as generated files so exports embed it natively. */
export async function POST(request: NextRequest) {
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file required" }, { status: 400 });
  }
  const ext = EXT_BY_MIME[file.type];
  if (!ext) {
    return NextResponse.json(
      { error: "Only PNG or JPEG images are supported" },
      { status: 415 },
    );
  }
  if (file.size > 20 * 1024 * 1024) {
    return NextResponse.json({ error: "Image too large (max 20MB)" }, { status: 413 });
  }
  const dir = path.resolve(process.cwd(), "data/images");
  mkdirSync(dir, { recursive: true });
  const filename = `${randomUUID().replace(/-/g, "")}.${ext}`;
  writeFileSync(path.join(dir, filename), Buffer.from(await file.arrayBuffer()));
  return NextResponse.json({ url: `/api/images/file/${filename}` }, { status: 201 });
}
