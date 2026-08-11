import { NextRequest, NextResponse } from "next/server";
import { getSettings } from "@/lib/settings";
import { searchIcons } from "@/lib/icons/search";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q") ?? "";
  const k = Math.min(
    Number(request.nextUrl.searchParams.get("k") ?? 12) || 12,
    50,
  );
  if (!query.trim()) {
    return NextResponse.json({ error: "q required" }, { status: 400 });
  }
  const settings = await getSettings();
  const results = await searchIcons(query, k, {
    ollamaUrl: settings.llm.ollamaUrl,
    weight: settings.icons.weight,
  });
  return NextResponse.json(results);
}
