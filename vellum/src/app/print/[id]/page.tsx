/**
 * Print/export render surface. Server component: reads the document
 * straight from the DB (no client fetches), renders slides statically at
 * scale 1. The export pipeline drives a headless Chromium at this route
 * with a minted session cookie; per-block data attributes give PPTX its
 * geometry.
 */
import { notFound } from "next/navigation";
import { db, ensureWal } from "@/lib/db";
import type { PlateSlide } from "@/lib/generation/parser/slide-parser";
import { PrintView } from "./print-view";

export const dynamic = "force-dynamic";

export default async function PrintPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await ensureWal();
  const { id } = await params;
  const document = await db.document.findUnique({
    where: { id },
    include: { customTheme: true },
  });
  if (!document) notFound();

  let slides: PlateSlide[] = [];
  try {
    slides = JSON.parse(document.slides) as PlateSlide[];
  } catch {
    slides = [];
  }

  let customThemeData: unknown = null;
  if (document.customTheme) {
    try {
      customThemeData = JSON.parse(document.customTheme.data);
    } catch {
      customThemeData = null;
    }
  }

  let sources: Array<{
    ref: number;
    publisher: string;
    title: string;
    url: string;
  }> = [];
  if (document.sources) {
    try {
      sources = JSON.parse(document.sources);
    } catch {
      sources = [];
    }
  }

  return (
    <PrintView
      kind={document.kind === "doc" ? "doc" : "deck"}
      title={document.title}
      themeName={document.themeName}
      customThemeData={customThemeData}
      slides={slides}
      sources={sources}
    />
  );
}
