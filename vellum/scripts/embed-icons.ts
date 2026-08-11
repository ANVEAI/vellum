/**
 * One-time icon embedding: base Phosphor icons (1,512) → Ollama
 * nomic-embed-text vectors → data/icons-vectors.json.
 *
 * Chosen over the prebuilt MiniLM vectorstore to avoid a native
 * onnxruntime dependency: nomic-embed-text is already installed in the
 * local Ollama and runs as its own small model runner.
 *
 *   npx tsx scripts/embed-icons.ts
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://localhost:11434";
const MODEL = "nomic-embed-text";
const WEIGHT_SUFFIXES = ["-bold", "-duotone", "-fill", "-light", "-thin"];

interface IconEntry {
  name: string;
  tags: string;
  style: string;
}

async function embedBatch(inputs: string[]): Promise<number[][]> {
  const res = await fetch(`${OLLAMA_URL}/api/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, input: inputs }),
  });
  if (!res.ok) throw new Error(`embed failed: HTTP ${res.status}`);
  const data = (await res.json()) as { embeddings: number[][] };
  return data.embeddings;
}

async function main() {
  const raw = JSON.parse(
    readFileSync(
      path.resolve(__dirname, "../assets/icons/icons.json"),
      "utf8",
    ),
  ) as { icons: IconEntry[] };

  const base = raw.icons.filter(
    (icon) => !WEIGHT_SUFFIXES.some((s) => icon.name.endsWith(s)),
  );
  console.log(`base icons: ${base.length} (of ${raw.icons.length} entries)`);

  const docs = base.map(
    (icon) => `${icon.name.replace(/-/g, " ")}. ${icon.tags.replace(/\*/g, "")}`,
  );

  const vectors: number[][] = [];
  const BATCH = 128;
  for (let i = 0; i < docs.length; i += BATCH) {
    const batch = docs.slice(i, i + BATCH);
    vectors.push(...(await embedBatch(batch)));
    process.stdout.write(`\rembedded ${Math.min(i + BATCH, docs.length)}/${docs.length}`);
  }
  console.log();

  const outDir = path.resolve(__dirname, "../data");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(
    path.join(outDir, "icons-vectors.json"),
    JSON.stringify({
      model: MODEL,
      dim: vectors[0]?.length ?? 0,
      names: base.map((icon) => icon.name),
      vectors,
    }),
  );
  console.log(
    `wrote data/icons-vectors.json (${base.length} icons, dim ${vectors[0]?.length})`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
