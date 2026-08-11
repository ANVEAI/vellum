import { NextResponse } from "next/server";
import { db, ensureWal } from "@/lib/db";
import { getSettings } from "@/lib/settings";

export const runtime = "nodejs";

async function probe(url: string, timeoutMs = 2500): Promise<boolean> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function GET() {
  const settings = await getSettings();

  const [dbOk, ollama, searxng, comfyui] = await Promise.all([
    ensureWal()
      .then(() => db.$queryRawUnsafe("SELECT 1;"))
      .then(() => true)
      .catch(() => false),
    probe(`${settings.llm.ollamaUrl}/api/version`),
    probe(
      `${settings.search.searxngUrl}/search?q=ping&format=json`,
      4000,
    ),
    probe(`${settings.images.comfyuiUrl}/system_stats`),
  ]);

  return NextResponse.json({
    ok: dbOk && ollama,
    services: {
      db: dbOk,
      ollama,
      searxng,
      comfyui,
    },
    settings: {
      model: settings.llm.model,
      imageProvider: settings.images.provider,
    },
  });
}
