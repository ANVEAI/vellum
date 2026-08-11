import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db, ensureWal } from "@/lib/db";
import { getTemplate } from "@/lib/templates/library";
import { getSettings } from "@/lib/settings";
import { themeDataFromBrand } from "@/lib/brand/theme";

export const runtime = "nodejs";

const createSchema = z.object({
  kind: z.enum(["deck", "doc"]),
  prompt: z.string().min(1),
  /** Use the settings brand kit as this document's theme. */
  useBrandTheme: z.boolean().optional(),
  templateId: z
    .string()
    .optional()
    .refine((id) => id === undefined || getTemplate(id) !== undefined, {
      message: "Unknown templateId",
    }),
  genParams: z
    .object({
      nCards: z.number().int().min(1).max(30).optional(),
      language: z.string().default("English"),
      tone: z.string().optional(),
      audience: z.string().optional(),
      textDensity: z
        .enum(["minimal", "concise", "detailed", "extensive"])
        .optional(),
      webSearch: z.boolean().default(true),
      imageModel: z
        .enum(["flux-schnell", "qwen-image", "hidream"])
        .optional(),
      importMode: z.enum(["verbatim", "summarize"]).optional(),
      imageStyle: z
        .enum([
          "auto",
          "editorial-photo",
          "brand-duotone",
          "archive-mono",
          "studio-still",
          "editorial-illustration",
          "technical-line",
          "soft-3d",
          "abstract-field",
          "editorial-dim",
        ])
        .optional(),
    })
    .default({}),
});

export async function GET() {
  await ensureWal();
  const documents = await db.document.findMany({
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      kind: true,
      title: true,
      status: true,
      themeName: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  return NextResponse.json(documents);
}

export async function POST(request: NextRequest) {
  await ensureWal();
  const parsed = createSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join("; ") },
      { status: 400 },
    );
  }
  const { kind, prompt, templateId, useBrandTheme, genParams } = parsed.data;
  // Template defaults seed genParams; explicit user genParams win.
  const template = templateId ? getTemplate(templateId) : undefined;
  const mergedGenParams = template
    ? {
        ...genParams,
        nCards: genParams.nCards ?? template.nCards,
        tone: genParams.tone ?? template.tone,
        textDensity: genParams.textDensity ?? template.textDensity,
      }
    : { ...genParams, nCards: genParams.nCards ?? 8 };

  // Brand theme: materialize the settings brand kit as a custom theme row
  // (beats the template's paired theme when both are requested).
  let brandThemeId: string | null = null;
  if (useBrandTheme) {
    const settings = await getSettings();
    if (settings.brand.colors.length > 0) {
      const data = themeDataFromBrand({
        name: settings.brand.name || undefined,
        colors: settings.brand.colors,
        logoUrl: settings.brand.logoUrl || undefined,
      });
      const row = await db.customTheme.create({
        data: { name: String(data.name ?? "Brand"), data: JSON.stringify(data) },
      });
      brandThemeId = row.id;
    }
  }

  const document = await db.document.create({
    data: {
      kind,
      prompt,
      ...(template ? { templateId: template.id, themeName: template.theme } : {}),
      ...(brandThemeId
        ? { themeName: "custom", customThemeId: brandThemeId }
        : {}),
      genParams: JSON.stringify(mergedGenParams),
      status: "draft",
    },
  });
  return NextResponse.json(document, { status: 201 });
}
