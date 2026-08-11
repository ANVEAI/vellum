import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db, ensureWal } from "@/lib/db";
import { gcAfterDocumentDelete } from "@/lib/storage/gc";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  await ensureWal();
  const { id } = await params;
  const document = await db.document.findUnique({
    where: { id },
    include: { customTheme: true },
  });
  if (!document) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(document);
}

const patchSchema = z.object({
  title: z.string().min(1).optional(),
  outline: z.string().optional(),
  slides: z.string().optional(), // JSON PlateSlide[]
  themeName: z.string().optional(),
  customThemeId: z.string().nullable().optional(),
  /** JSON generation params — the editor edits imageStyle through this. */
  genParams: z.string().optional(),
  /** Imported source document (framed) — grounds outline + content. */
  researchContext: z.string().max(80_000).optional(),
  status: z.enum(["draft", "outlining", "generating", "ready", "error"]).optional(),
});

export async function PATCH(request: NextRequest, { params }: Params) {
  await ensureWal();
  const { id } = await params;
  const parsed = patchSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join("; ") },
      { status: 400 },
    );
  }
  if (parsed.data.slides !== undefined) {
    try {
      JSON.parse(parsed.data.slides);
    } catch {
      return NextResponse.json(
        { error: "slides must be valid JSON" },
        { status: 400 },
      );
    }
  }
  try {
    const document = await db.document.update({
      where: { id },
      data: parsed.data,
    });
    return NextResponse.json(document);
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  await ensureWal();
  const { id } = await params;
  try {
    // Cascades the document's GeneratedImage rows (schema.prisma).
    await db.document.delete({ where: { id } });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  // The row is the source of truth; sweeping unreferenced themes and image
  // files is best-effort and must never turn a successful delete into an error.
  const gc = await gcAfterDocumentDelete().catch(() => null);
  return NextResponse.json({ ok: true, gc });
}
