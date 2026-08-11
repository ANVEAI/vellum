import { NextRequest, NextResponse } from "next/server";
import { db, ensureWal } from "@/lib/db";
import { exportPdf } from "@/lib/export/pdf";
import { exportPptx } from "@/lib/export/pptx";
import { exportDocx } from "@/lib/export/docx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function safeFilename(title: string, ext: string): string {
  const base =
    title
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .slice(0, 60) || "vellum-export";
  return `${base}.${ext}`;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ format: string; id: string }> },
) {
  await ensureWal();
  const { format, id } = await params;
  const document = await db.document.findUnique({ where: { id } });
  if (!document) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // A document with no slides has nothing to render: the print page never
  // signals ready, so the exporter used to spend 30s in a selector timeout and
  // then return a raw Playwright stack trace as the error. Answer immediately
  // and in plain language instead.
  let slideCount = 0;
  try {
    slideCount = (JSON.parse(document.slides) as unknown[]).length;
  } catch {
    slideCount = 0;
  }
  if (slideCount === 0) {
    return NextResponse.json(
      {
        error:
          "This document has no content yet, so there is nothing to export. Generate or add at least one slide first.",
      },
      { status: 409 },
    );
  }

  try {
    let buffer: Buffer;
    let mime: string;
    let ext: string;
    switch (format) {
      case "pdf":
        buffer = await exportPdf(id, document.kind === "doc" ? "doc" : "deck");
        mime = "application/pdf";
        ext = "pdf";
        break;
      case "pptx":
        buffer = await exportPptx(id);
        mime =
          "application/vnd.openxmlformats-officedocument.presentationml.presentation";
        ext = "pptx";
        break;
      case "docx":
        buffer = await exportDocx(id);
        mime =
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
        ext = "docx";
        break;
      default:
        return NextResponse.json(
          { error: "format must be pdf|pptx|docx" },
          { status: 400 },
        );
    }

    // The buffer streams straight to the browser, which saves it via blob.
    // A server-side copy used to be written here too — keyed by title, so it
    // collided across documents, became unmappable after a rename, was never
    // read back by anything, and had grown to hundreds of megabytes.
    const filename = safeFilename(document.title, ext);

    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": mime,
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": String(buffer.length),
      },
    });
  } catch (error) {
    // Playwright errors arrive as multi-line stacks with ANSI colour codes;
    // showing that raw in a toast helps nobody.
    const raw = error instanceof Error ? error.message : String(error);
    const message = raw
      .replace(/\[\d+m/g, "")
      .split("\n")[0]
      .slice(0, 200);
    console.error(`export ${format} failed for ${id}:`, raw);
    return NextResponse.json(
      { error: `Export failed: ${message}` },
      { status: 500 },
    );
  }
}
