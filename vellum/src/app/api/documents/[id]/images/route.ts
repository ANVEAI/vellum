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
    select: { id: true, slides: true },
  });
  if (!document) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }
  // A root image is only written into a slot the slide already has (see
  // applyImageToSlides). Adding a picture to a slide that had none is a
  // deliberate request, so the slot is created here, before the job can
  // finish — the editor records the query too, but only after this returns.
  if ((nodeId ?? "__root__") === "__root__") {
    try {
      const slides = JSON.parse(document.slides) as Array<{
        id: string;
        rootImage?: { query?: string; url?: string };
      }>;
      const slide = slides.find((s) => s.id === slideId);
      if (slide && !(slide.rootImage?.query || slide.rootImage?.url)) {
        slide.rootImage = { ...(slide.rootImage ?? {}), query: prompt.trim() };
        await db.document.update({
          where: { id },
          data: { slides: JSON.stringify(slides) },
        });
      }
    } catch {
      // Unreadable slides: the job still queues; the editor's own save of the
      // query will create the slot.
    }
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
