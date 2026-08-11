import { NextRequest, NextResponse } from "next/server";
import { db, ensureWal } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { kickImageQueue } from "@/lib/generation/pipeline/asset-queue";

export const runtime = "nodejs";

/** Queue one image (re)generation for a slide node — editor "regenerate
 *  image" with an optional replacement prompt. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  await ensureWal();
  const { id } = await params;
  const { slideId, nodeId, prompt } = (await request
    .json()
    .catch(() => ({}))) as {
    slideId?: string;
    nodeId?: string;
    prompt?: string;
  };
  if (!slideId || !prompt?.trim()) {
    return NextResponse.json(
      { error: "slideId and prompt required" },
      { status: 400 },
    );
  }
  const document = await db.document.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!document) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }
  const settings = await getSettings();
  const job = await db.generatedImage.create({
    data: {
      documentId: id,
      slideId,
      nodeId: nodeId ?? "__root__",
      prompt: prompt.trim(),
      provider: settings.images.provider,
    },
  });
  kickImageQueue();
  return NextResponse.json({ jobId: job.id }, { status: 201 });
}
