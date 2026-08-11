import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { extractText } from "@/lib/import/extract";

// Auth is enforced by src/middleware.ts for all /api/* routes, matching the
// other API routes (see src/app/api/documents/route.ts).
export const runtime = "nodejs";

/** Upload ceiling — requests above this return 413. */
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

const pasteSchema = z.object({
  text: z.string().min(1, "text must not be empty"),
  filename: z.string().optional(),
});

function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length;
}

function tooLarge() {
  return NextResponse.json(
    { error: "Upload exceeds the 25 MB limit" },
    { status: 413 },
  );
}

export async function POST(request: NextRequest) {
  const declaredBytes = Number(request.headers.get("content-length") ?? "0");
  if (declaredBytes > MAX_UPLOAD_BYTES) return tooLarge();

  const contentType = request.headers.get("content-type") ?? "";
  let buffer: Buffer;
  let filename: string;

  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: 'Expected a "file" field in the form data' },
        { status: 400 },
      );
    }
    if (file.size > MAX_UPLOAD_BYTES) return tooLarge();
    buffer = Buffer.from(await file.arrayBuffer());
    filename = file.name;
  } else {
    const parsed = pasteSchema.safeParse(
      await request.json().catch(() => ({})),
    );
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues.map((i) => i.message).join("; ") },
        { status: 400 },
      );
    }
    if (Buffer.byteLength(parsed.data.text, "utf8") > MAX_UPLOAD_BYTES) {
      return tooLarge();
    }
    buffer = Buffer.from(parsed.data.text, "utf8");
    // Pasted content defaults to markdown so headings survive title detection.
    filename = parsed.data.filename ?? "pasted.md";
  }

  try {
    const { text, kind, title } = await extractText(buffer, filename);
    return NextResponse.json({
      text,
      kind,
      title,
      chars: text.length,
      words: countWords(text),
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to read the document";
    const status = message.startsWith("Unsupported file type") ? 400 : 422;
    return NextResponse.json({ error: message }, { status });
  }
}
