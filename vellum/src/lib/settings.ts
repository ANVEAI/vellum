import { z } from "zod";
import { db, ensureWal } from "@/lib/db";

export const IMAGE_PROVIDERS = ["comfyui", "gemini", "pexels", "anve", "none"] as const;
export type ImageProviderName = (typeof IMAGE_PROVIDERS)[number];

/**
 * IMAGE_PROVIDER in the environment wins over the saved setting, so a server's
 * provider is part of its deployment (ANVE's VM sets `anve`) rather than a row
 * someone has to remember to change in the settings page. Unset or unknown: the
 * saved setting stands.
 */
export function envImageProvider(): ImageProviderName | null {
  const v = (process.env.IMAGE_PROVIDER ?? "").trim().toLowerCase();
  return (IMAGE_PROVIDERS as readonly string[]).includes(v) ? (v as ImageProviderName) : null;
}

function withEnv(s: AppSettings): AppSettings {
  const provider = envImageProvider();
  return provider ? { ...s, images: { ...s.images, provider } } : s;
}

export const settingsSchema = z.object({
  llm: z
    .object({
      ollamaUrl: z.string().default("http://localhost:11434"),
      model: z.string().default("qwen3.6:35b"),
      think: z.boolean().default(false),
    })
    .default({}),
  search: z
    .object({
      enabled: z.boolean().default(true),
      searxngUrl: z.string().default("http://localhost:8888"),
      maxResults: z.number().int().min(1).max(10).default(5),
    })
    .default({}),
  images: z
    .object({
      provider: z.enum(IMAGE_PROVIDERS).default("comfyui"),
      comfyuiUrl: z.string().default("http://127.0.0.1:8188"),
      comfyuiWorkflow: z.enum(["16x9", "square"]).default("16x9"),
      comfyModel: z
        .enum(["flux-schnell", "qwen-image", "hidream"])
        .default("flux-schnell"),
      geminiApiKey: z.string().default(""),
      geminiModel: z.string().default("gemini-3-pro-image-preview"),
      pexelsApiKey: z.string().default(""),
    })
    .default({}),
  icons: z
    .object({
      weight: z
        .enum(["bold", "duotone", "fill", "light", "regular", "thin"])
        .default("bold"),
    })
    .default({}),
  brand: z
    .object({
      name: z.string().default(""),
      logoUrl: z.string().default(""),
      colors: z.array(z.string()).default([]),
    })
    .default({}),
});

export type AppSettings = z.infer<typeof settingsSchema>;

let cache: AppSettings | null = null;

export async function getSettings(): Promise<AppSettings> {
  if (cache) return cache;
  await ensureWal();
  const rows = await db.setting.findMany();
  const raw: Record<string, unknown> = {};
  for (const row of rows) {
    try {
      raw[row.key] = JSON.parse(row.value);
    } catch {
      // ignore malformed rows; defaults win
    }
  }
  cache = withEnv(settingsSchema.parse(raw));
  return cache;
}

export async function updateSettings(
  patch: Partial<AppSettings>,
): Promise<AppSettings> {
  const current = await getSettings();
  const merged = settingsSchema.parse({
    ...current,
    ...patch,
    llm: { ...current.llm, ...(patch.llm ?? {}) },
    search: { ...current.search, ...(patch.search ?? {}) },
    images: { ...current.images, ...(patch.images ?? {}) },
    icons: { ...current.icons, ...(patch.icons ?? {}) },
    brand: { ...current.brand, ...(patch.brand ?? {}) },
  });
  for (const key of Object.keys(settingsSchema.shape) as (keyof AppSettings)[]) {
    await db.setting.upsert({
      where: { key },
      create: { key, value: JSON.stringify(merged[key]) },
      update: { value: JSON.stringify(merged[key]) },
    });
  }
  cache = withEnv(merged);
  return cache;
}

export function invalidateSettingsCache() {
  cache = null;
}
