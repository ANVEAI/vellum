/**
 * Semantic icon search: Ollama nomic-embed-text query embedding + cosine
 * similarity over the pre-embedded Phosphor icon vectors
 * (scripts/embed-icons.ts → data/icons-vectors.json).
 *
 * Approach derived from Presenton's icon_finder_service (Apache-2.0) — see
 * THIRD_PARTY_LICENSES.md — reimplemented for TypeScript + Ollama.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

interface VectorStore {
  model: string;
  dim: number;
  names: string[];
  vectors: number[][];
}

let store: { names: string[]; vectors: Float32Array[]; model: string } | null =
  null;
let loadFailed = false;

function loadStore() {
  if (store || loadFailed) return store;
  try {
    const raw = JSON.parse(
      readFileSync(
        path.resolve(process.cwd(), "data/icons-vectors.json"),
        "utf8",
      ),
    ) as VectorStore;
    store = {
      names: raw.names,
      vectors: raw.vectors.map((v) => Float32Array.from(v)),
      model: raw.model,
    };
  } catch {
    loadFailed = true;
  }
  return store;
}

function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB) || 1);
}

export function iconUrl(name: string, weight: string): string {
  const suffix = weight === "regular" ? "" : `-${weight}`;
  return `/static/icons/${weight}/${name}${suffix}.svg`;
}

export const ICON_PLACEHOLDER = "/static/icons/placeholder.svg";

/**
 * Batch-resolve icon queries to URLs. Unknown/failed queries map to null.
 * One Ollama embed call for all queries.
 */
export async function resolveIconQueries(
  queries: string[],
  options: { ollamaUrl: string; weight: string },
): Promise<Map<string, string | null>> {
  const result = new Map<string, string | null>();
  const unique = [...new Set(queries.map((q) => q.trim()).filter(Boolean))];
  if (unique.length === 0) return result;

  const vectorStore = loadStore();
  if (!vectorStore) {
    for (const q of unique) result.set(q, null);
    return result;
  }

  try {
    const res = await fetch(`${options.ollamaUrl}/api/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: vectorStore.model, input: unique }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { embeddings: number[][] };

    unique.forEach((query, qi) => {
      const qv = Float32Array.from(data.embeddings[qi]);
      let best = -1;
      let bestScore = -Infinity;
      for (let i = 0; i < vectorStore.vectors.length; i++) {
        const score = cosine(qv, vectorStore.vectors[i]);
        if (score > bestScore) {
          bestScore = score;
          best = i;
        }
      }
      result.set(
        query,
        best >= 0 ? iconUrl(vectorStore.names[best], options.weight) : null,
      );
    });
  } catch {
    for (const q of unique) result.set(q, null);
  }
  return result;
}

/** Top-k search for the icon picker UI. */
export async function searchIcons(
  query: string,
  k: number,
  options: { ollamaUrl: string; weight: string },
): Promise<Array<{ name: string; url: string; score: number }>> {
  const vectorStore = loadStore();
  if (!vectorStore || !query.trim()) return [];
  const res = await fetch(`${options.ollamaUrl}/api/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: vectorStore.model, input: [query] }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return [];
  const data = (await res.json()) as { embeddings: number[][] };
  const qv = Float32Array.from(data.embeddings[0]);
  const scored = vectorStore.names.map((name, i) => ({
    name,
    url: iconUrl(name, options.weight),
    score: cosine(qv, vectorStore.vectors[i]),
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}
