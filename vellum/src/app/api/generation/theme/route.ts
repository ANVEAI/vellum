import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db, ensureWal } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { generateStructuredWithRetries } from "@/lib/generation/llm/schema-retry";
import { resolveThemeOrDefault } from "@/lib/themes/resolve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const hexColor = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "must be a #RRGGBB hex color");

// Tight generation schema: everything required so the model can't return an
// empty object (the verified local-model failure mode).
const aiThemeSchema = z.object({
  name: z.string().min(3).max(60),
  description: z.string().min(10).max(200),
  mode: z.enum(["light", "dark"]),
  colors: z.object({
    primary: hexColor,
    accent: hexColor,
    background: hexColor,
    text: hexColor,
    heading: hexColor,
    smartLayout: hexColor,
    cardBackground: hexColor,
  }),
  fonts: z.object({
    heading: z.string().min(2).max(50),
    body: z.string().min(2).max(50),
  }),
});

export async function POST(request: NextRequest) {
  await ensureWal();
  const { documentId, hint } = (await request.json().catch(() => ({}))) as {
    documentId?: string;
    hint?: string;
  };
  if (!documentId) {
    return NextResponse.json({ error: "documentId required" }, { status: 400 });
  }
  const document = await db.document.findUnique({ where: { id: documentId } });
  if (!document) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }
  const settings = await getSettings();

  try {
    const theme = await generateStructuredWithRetries({
      baseUrl: settings.llm.ollamaUrl,
      model: settings.llm.model,
      schema: aiThemeSchema,
      signal: request.signal,
      messages: [
        {
          role: "system",
          content: `You are a presentation design expert. Design one cohesive color+font theme as JSON matching the schema.
Rules:
- All seven colors are #RRGGBB hex.
- Ensure strong contrast: text and heading must be clearly readable on background; cardBackground must sit subtly above background (same family, slightly different lightness).
- accent must pop against background. smartLayout is usually the same hue family as accent.
- Choose real Google Fonts names (e.g. Inter, Lora, Playfair Display, Space Grotesk, Source Serif 4, Manrope).
- The design must fit the topic's mood.`,
        },
        {
          role: "user",
          content: `Topic: ${document.title}\n${document.prompt ? `About: ${document.prompt}\n` : ""}${hint ? `Style direction: ${hint}\n` : ""}Design the theme now.`,
        },
      ],
    });

    // Run it through the ported resolution path (partial-over-mystique) so
    // the stored data always validates as a complete ThemeProperties.
    const resolved = resolveThemeOrDefault("custom", theme);
    const custom = await db.customTheme.create({
      data: {
        name: theme.name,
        data: JSON.stringify({ ...resolved, name: theme.name, description: theme.description }),
      },
    });
    await db.document.update({
      where: { id: documentId },
      data: { customThemeId: custom.id, themeName: "custom" },
    });
    return NextResponse.json({ id: custom.id, theme: resolved });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 502 },
    );
  }
}
