import { createReadStream, existsSync, statSync } from "node:fs";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { Readable } from "node:stream";

export const runtime = "nodejs";

const IMAGES_DIR = path.resolve(process.cwd(), "data/images");

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  // Strict allowlist: generated filenames are "<cuid>.<png|jpeg>".
  if (!/^[a-z0-9]+\.(png|jpeg|jpg)$/i.test(name)) {
    return NextResponse.json({ error: "Invalid name" }, { status: 400 });
  }
  const file = path.join(IMAGES_DIR, name);
  if (!existsSync(file)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const stream = Readable.toWeb(
    createReadStream(file),
  ) as unknown as ReadableStream;
  return new Response(stream, {
    headers: {
      "Content-Type": name.toLowerCase().endsWith(".png")
        ? "image/png"
        : "image/jpeg",
      "Content-Length": String(statSync(file).size),
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
