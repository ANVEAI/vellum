import { NextRequest, NextResponse } from "next/server";
import { db, ensureWal } from "@/lib/db";
import { kickImageQueue } from "@/lib/generation/pipeline/asset-queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  await ensureWal();
  const { id } = await params;
  const images = await db.generatedImage.findMany({
    where: { documentId: id },
    select: {
      id: true,
      slideId: true,
      nodeId: true,
      status: true,
      path: true,
      error: true,
      prompt: true,
    },
    orderBy: { createdAt: "asc" },
  });
  const pending = images.filter(
    (i) => i.status === "pending" || i.status === "running",
  ).length;
  // Nudge the in-process queue — covers server restarts mid-batch.
  if (pending > 0) kickImageQueue();
  return NextResponse.json({ images, pending });
}

/** Retry failed images for this document. */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  await ensureWal();
  const { id } = await params;
  const updated = await db.generatedImage.updateMany({
    where: { documentId: id, status: "failed" },
    data: { status: "pending", error: null },
  });
  kickImageQueue();
  return NextResponse.json({ retried: updated.count });
}
