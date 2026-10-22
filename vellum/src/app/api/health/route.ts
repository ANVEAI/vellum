import { NextResponse } from "next/server";
import { db, ensureWal } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { openAIConfig, probeOpenAI } from "@/lib/generation/llm/openai";
import { anveResearchEnabled } from "@/lib/generation/research/anve";

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
  // LLM_BASE_URL set: an OpenAI-compatible server (ANVE's gateway) serves the
  // model and Ollama is never contacted, so it is not probed either.
  const gateway = openAIConfig();

  const [dbOk, llm, searxng, comfyui] = await Promise.all([
    ensureWal()
      .then(() => db.$queryRawUnsafe("SELECT 1;"))
      .then(() => true)
      .catch(() => false),
    gateway
      ? probeOpenAI(gateway)
      : probe(`${settings.llm.ollamaUrl}/api/version`).then((ok) => ({
          ok,
          model: settings.llm.model,
        })),
    // RESEARCH_PROVIDER=anve: research is ANVE's /web-research on the gateway, so the
    // search lamp follows the gateway rather than a SearXNG nobody runs.
    anveResearchEnabled() && gateway
      ? Promise.resolve(true)
      : probe(`${settings.search.searxngUrl}/search?q=ping&format=json`, 4000),
    probe(`${settings.images.comfyuiUrl}/system_stats`),
  ]);

  return NextResponse.json({
    ok: dbOk && llm.ok,
    services: {
      db: dbOk,
      // "ollama" is the language-model lamp, whichever server answers it
      ollama: llm.ok,
      searxng,
      comfyui,
    },
    settings: {
      model: llm.model,
      provider: gateway ? "openai-compatible" : "ollama",
      imageProvider: settings.images.provider,
      researchProvider: anveResearchEnabled() ? "anve" : "searxng",
    },
  });
}
