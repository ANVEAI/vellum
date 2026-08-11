import { NextRequest, NextResponse } from "next/server";
import { db, ensureWal } from "@/lib/db";

export const runtime = "nodejs";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  await ensureWal();
  const { id } = await params;
  const source = await db.document.findUnique({ where: { id } });
  if (!source) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const copy = await db.document.create({
    data: {
      kind: source.kind,
      title: `${source.title} (copy)`,
      prompt: source.prompt,
      outline: source.outline,
      researchContext: source.researchContext,
      slides: source.slides,
      themeName: source.themeName,
      customThemeId: source.customThemeId,
      genParams: source.genParams,
      status: source.status,
      rawXml: source.rawXml,
    },
  });
  return NextResponse.json(copy, { status: 201 });
}
