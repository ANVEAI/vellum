import { NextRequest, NextResponse } from "next/server";
import { db, ensureWal } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { themeDataFromBrand } from "@/lib/brand/theme";

export const runtime = "nodejs";

/**
 * Apply the saved brand kit to an existing document — the same materialize-a
 * -custom-theme path the create flow uses, reachable after generation so a
 * finished deck can be re-branded without regenerating it.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  await ensureWal();
  const { id } = await params;
  const document = await db.document.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!document) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }
  const settings = await getSettings();
  if (settings.brand.colors.length === 0) {
    return NextResponse.json(
      { error: "No brand kit saved yet — add one in Settings." },
      { status: 400 },
    );
  }
  const data = themeDataFromBrand({
    name: settings.brand.name || undefined,
    colors: settings.brand.colors,
    logoUrl: settings.brand.logoUrl || undefined,
  });
  const row = await db.customTheme.create({
    data: { name: String(data.name ?? "Brand"), data: JSON.stringify(data) },
  });
  await db.document.update({
    where: { id },
    data: { themeName: "custom", customThemeId: row.id },
  });
  return NextResponse.json({ customThemeId: row.id, name: row.name });
}
