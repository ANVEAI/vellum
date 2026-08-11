import { NextRequest, NextResponse } from "next/server";
import { db, ensureWal } from "@/lib/db";
import { runQualityCheck } from "@/lib/qa/run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Re-run the quality check on demand. Returns immediately; the editor polls
 * `status: "reviewing"` and picks the report up when it flips to "ready".
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  await ensureWal();
  const { id } = await params;
  const document = await db.document.findUnique({
    where: { id },
    select: { id: true, status: true },
  });
  if (!document) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }
  if (document.status === "reviewing") {
    return NextResponse.json({ started: false, reason: "already-running" });
  }
  void runQualityCheck(id);
  return NextResponse.json({ started: true });
}
