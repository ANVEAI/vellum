/**
 * DOCX export via the `docx` package — native headings/paragraphs/lists/
 * tables/quotes from the PlateSlide[] model; charts and visual smart
 * layouts embedded as PNG snapshots from the print page.
 *
 * Documents (kind "doc") ship with real Word furniture: theme-driven
 * styles (Title/Heading1-3/body/Caption), a cover page, a native
 * TableOfContents field, a running title header, a page-number footer,
 * and numbered figure captions. Decks keep their handout flow.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  AlignmentType,
  BorderStyle,
  Document as DocxDocument,
  Footer,
  Header,
  HeadingLevel,
  ImageRun,
  Packer,
  PageBreak,
  PageNumber,
  Paragraph,
  Table,
  TableCell,
  TableOfContents,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import sharp from "sharp";
import { db } from "@/lib/db";
import type { PlateSlide } from "@/lib/generation/parser/slide-parser";
import type { Descendant, TElement, TText } from "@/lib/slides/plate-shim";
import { resolveThemeOrDefault } from "@/lib/themes/resolve";
import { openPrintPage, withExportPage } from "./browser";

function isText(node: Descendant): node is TText {
  return typeof (node as TText).text === "string" && !(node as TElement).type;
}
function textOf(nodes: Descendant[] | undefined): string {
  if (!nodes) return "";
  return nodes
    .map((n) => (isText(n) ? n.text : textOf((n as TElement).children)))
    .join("");
}
function elements(node: TElement): TElement[] {
  return (node.children ?? []).filter((c): c is TElement => !isText(c));
}

const NATIVE = new Set([
  "presentation-title",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "p",
  "label",
  "quote",
  "callout",
  "bullets",
  "table",
  "li",
]);

/* ---------- theme → Word palette ---------- */

/** Normalize a CSS hex color to docx's bare RRGGBB form. */
function hexColor(input: string | undefined, fallback: string): string {
  const raw = (input ?? "").trim().replace(/^#/, "");
  if (/^[0-9a-f]{6}$/i.test(raw)) return raw.toUpperCase();
  if (/^[0-9a-f]{3}$/i.test(raw)) {
    return raw
      .split("")
      .map((c) => c + c)
      .join("")
      .toUpperCase();
  }
  return fallback;
}

function channels(hex6: string): [number, number, number] {
  const n = parseInt(hex6, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex(r: number, g: number, b: number): string {
  return [r, g, b]
    .map((c) =>
      Math.max(0, Math.min(255, Math.round(c)))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")
    .toUpperCase();
}

function luminance(hex6: string): number {
  const [r, g, b] = channels(hex6);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

/** Blend a color toward white; `share` is how much of the color survives. */
function mixWithWhite(hex6: string, share: number): string {
  const [r, g, b] = channels(hex6);
  const mix = (c: number) => c * share + 255 * (1 - share);
  return toHex(mix(r), mix(g), mix(b));
}

/**
 * Ink for white paper: dark-theme palettes carry near-white text/heading
 * colors, which would vanish in a Word document, so overly light colors
 * are darkened while keeping their hue.
 */
function inkColor(input: string | undefined, fallback: string): string {
  const hex = hexColor(input, fallback);
  if (luminance(hex) <= 0.72) return hex;
  const [r, g, b] = channels(hex);
  return toHex(r * 0.35, g * 0.35, b * 0.35);
}

/** First font family of a CSS-ish font list, unquoted, for Word. */
function fontFamily(input: string | undefined, fallback: string): string {
  const first = (input ?? "").split(",")[0]?.trim().replace(/^["']|["']$/g, "");
  return first || fallback;
}

/* ---------- images ---------- */

function imageBuffer(url: string | undefined): Buffer | null {
  if (!url) return null;
  const match = url.match(/\/api\/images\/file\/([a-z0-9]+\.(?:png|jpe?g))/i);
  if (!match) return null;
  try {
    return readFileSync(path.resolve(process.cwd(), "data/images", match[1]));
  } catch {
    return null;
  }
}

type ImageDims = { w: number; h: number; type: "png" | "jpg" };

/** Probe real pixel dimensions so embeds keep their true aspect ratio. */
async function imageDimensions(buffer: Buffer): Promise<ImageDims> {
  try {
    const meta = await sharp(buffer).metadata();
    return {
      w: meta.width || 1280,
      h: meta.height || 720,
      type: meta.format === "jpeg" ? "jpg" : "png",
    };
  } catch {
    return { w: 1280, h: 720, type: "png" };
  }
}

function imageParagraph(data: Buffer, dims: ImageDims): Paragraph {
  const maxW = 595; // 6.2in at 96dpi inside the page margins
  const scale = Math.min(1, maxW / dims.w);
  return new Paragraph({
    children: [
      new ImageRun({
        type: dims.type,
        data,
        transformation: {
          width: Math.round(dims.w * scale),
          height: Math.round(dims.h * scale),
        },
      }),
    ],
    spacing: { before: 160, after: 160 },
  });
}

export async function exportDocx(documentId: string): Promise<Buffer> {
  const document = await db.document.findUnique({
    where: { id: documentId },
    include: { customTheme: true },
  });
  if (!document) throw new Error("Document not found");
  const slides = JSON.parse(document.slides) as PlateSlide[];
  const isDoc = document.kind === "doc";

  let customThemeData: unknown = null;
  if (document.customTheme) {
    try {
      customThemeData = JSON.parse(document.customTheme.data);
    } catch {
      customThemeData = null;
    }
  }
  const theme = resolveThemeOrDefault(document.themeName, customThemeData);

  const accent = inkColor(theme.colors.accent, "4F46E5");
  const headingInk = inkColor(theme.colors.heading, "1A1A2E");
  const textInk = inkColor(theme.colors.text, "222222");
  const mutedInk = mixWithWhite(textInk, 0.6);
  const calloutFill = mixWithWhite(accent, 0.12);
  const tableHeadFill = mixWithWhite(accent, 0.1);
  const headingFont = fontFamily(theme.fonts.heading, "Calibri Light");
  const bodyFont = fontFamily(theme.fonts.body, "Calibri");

  // Snapshot every non-native block once, keyed "slideIdx-blockIdx".
  const snapshots = new Map<string, { png: Buffer; w: number; h: number }>();
  await withExportPage(async (page, origin) => {
    await openPrintPage(page, origin, documentId);
    for (let i = 0; i < slides.length; i++) {
      const contentEls = slides[i].content.filter(
        (n): n is TElement => typeof (n as TElement).type === "string",
      );
      for (let j = 0; j < contentEls.length; j++) {
        const node = contentEls[j];
        const type = String(node.type);
        if (NATIVE.has(type) || type === "img" || type === "contributor") {
          continue;
        }
        const locator = page.locator(
          `[data-slide-idx="${i}"] [data-block-idx="${j}"], .v-doc-section:nth-of-type(${i + 1}) [data-block-idx="${j}"]`,
        );
        // Document print view doesn't mark blocks; fall back to section snapshot
        const target = (await locator.count())
          ? locator.first()
          : page.locator(`[data-slide-idx="${i}"]`);
        if ((await target.count()) === 0) continue;
        const box = await target.first().boundingBox();
        if (!box || box.width < 2 || box.height < 2) continue;
        const png = await target.first().screenshot({ type: "png" });
        snapshots.set(`${i}-${j}`, { png, w: box.width, h: box.height });
      }
    }
  });

  const children: (Paragraph | Table)[] = [];
  let figureNumber = 0;

  const renderNode = async (
    node: TElement,
    slideIdx: number,
    blockIdx: number,
  ): Promise<void> => {
    const type = String(node.type);
    switch (type) {
      case "presentation-title":
        children.push(
          new Paragraph({
            heading: HeadingLevel.TITLE,
            alignment: AlignmentType.LEFT,
            children: [new TextRun({ text: textOf(node.children) })],
            spacing: { after: 240 },
          }),
        );
        return;
      case "h1":
        children.push(
          new Paragraph({
            heading: HeadingLevel.HEADING_1,
            children: [new TextRun({ text: textOf(node.children) })],
          }),
        );
        return;
      case "h2":
        children.push(
          new Paragraph({
            heading: HeadingLevel.HEADING_2,
            children: [new TextRun({ text: textOf(node.children) })],
          }),
        );
        return;
      case "h3":
      case "h4":
      case "h5":
      case "h6":
        children.push(
          new Paragraph({
            heading: HeadingLevel.HEADING_3,
            children: [new TextRun({ text: textOf(node.children) })],
          }),
        );
        return;
      case "label":
        children.push(
          new Paragraph({
            children: [
              new TextRun({
                text: textOf(node.children).toUpperCase(),
                bold: true,
                size: 18,
                color: accent,
                font: headingFont,
                characterSpacing: 30,
              }),
            ],
            spacing: { after: 80 },
          }),
        );
        return;
      case "p":
        children.push(
          new Paragraph({
            children: [new TextRun({ text: textOf(node.children) })],
            spacing: { after: 140 },
          }),
        );
        return;
      case "quote": {
        const author = node.author as string | undefined;
        children.push(
          new Paragraph({
            children: [
              new TextRun({
                text: textOf(node.children),
                italics: true,
                size: 24,
              }),
              ...(author
                ? [
                    new TextRun({
                      text: `  — ${author}`,
                      size: 20,
                      color: mutedInk,
                    }),
                  ]
                : []),
            ],
            border: {
              left: { style: BorderStyle.SINGLE, size: 18, color: accent },
            },
            indent: { left: 260 },
            spacing: { before: 160, after: 160 },
          }),
        );
        return;
      }
      case "callout":
        children.push(
          new Paragraph({
            children: [new TextRun({ text: textOf(node.children) })],
            shading: { fill: calloutFill },
            border: {
              left: { style: BorderStyle.SINGLE, size: 18, color: accent },
            },
            spacing: { before: 120, after: 120 },
          }),
        );
        return;
      case "bullets":
        for (const item of elements(node)) {
          const heading = elements(item).find((c) =>
            ["h3", "h4"].includes(String(c.type)),
          );
          const body = elements(item)
            .filter((c) => c.type === "p")
            .map((p) => textOf(p.children))
            .join(" ");
          children.push(
            new Paragraph({
              bullet: { level: 0 },
              children: [
                new TextRun({
                  text: heading ? textOf(heading.children) : textOf(item.children),
                  bold: true,
                }),
                ...(body ? [new TextRun({ text: ` — ${body}` })] : []),
              ],
              spacing: { after: 80 },
            }),
          );
        }
        return;
      case "table": {
        const rows = elements(node).map(
          (tr) =>
            new TableRow({
              children: elements(tr).map(
                (cell) =>
                  new TableCell({
                    children: [
                      new Paragraph({
                        children: [
                          new TextRun({
                            text: textOf(cell.children),
                            bold: cell.type === "th",
                            size: 20,
                          }),
                        ],
                      }),
                    ],
                    shading:
                      cell.type === "th" ? { fill: tableHeadFill } : undefined,
                  }),
              ),
            }),
        );
        if (rows.length) {
          children.push(
            new Table({
              rows,
              width: { size: 100, type: WidthType.PERCENTAGE },
            }),
          );
          children.push(new Paragraph({ spacing: { after: 120 } }));
        }
        return;
      }
      case "img": {
        const buffer = imageBuffer(node.url as string | undefined);
        if (buffer) {
          children.push(imageParagraph(buffer, await imageDimensions(buffer)));
          if (isDoc) {
            figureNumber += 1;
            const alt = String((node.query as string | undefined) ?? "").trim();
            children.push(
              new Paragraph({
                style: "Caption",
                children: [
                  new TextRun({
                    text: alt
                      ? `Figure ${figureNumber} — ${alt}`
                      : `Figure ${figureNumber}`,
                  }),
                ],
              }),
            );
          }
        }
        return;
      }
      case "contributor":
        return;
      default: {
        const snap = snapshots.get(`${slideIdx}-${blockIdx}`);
        if (snap) {
          children.push(
            imageParagraph(snap.png, { w: snap.w, h: snap.h, type: "png" }),
          );
        }
        return;
      }
    }
  };

  for (let i = 0; i < slides.length; i++) {
    const slide = slides[i];
    // Deck-kind exports read as a handout: root image then blocks.
    if (document.kind === "deck") {
      const rootBuffer = imageBuffer(
        (slide.rootImage as { url?: string } | undefined)?.url,
      );
      if (rootBuffer) {
        children.push(
          imageParagraph(rootBuffer, await imageDimensions(rootBuffer)),
        );
      }
    }
    const contentEls = slide.content.filter(
      (n): n is TElement => typeof (n as TElement).type === "string",
    );
    for (let j = 0; j < contentEls.length; j++) {
      await renderNode(contentEls[j], i, j);
    }
  }

  // Front matter (docs only): cover page, then a native Contents field.
  const dateLine = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const front: (Paragraph | TableOfContents)[] = [
    new Paragraph({
      children: [
        new TextRun({
          text: `Document — ${dateLine}`.toUpperCase(),
          bold: true,
          size: 16,
          color: accent,
          font: headingFont,
          characterSpacing: 30,
        }),
      ],
      spacing: { before: 480, after: 240 },
    }),
    new Paragraph({
      heading: HeadingLevel.TITLE,
      children: [new TextRun({ text: document.title })],
      spacing: { before: 4400, after: 220 },
    }),
    new Paragraph({
      border: {
        bottom: { style: BorderStyle.SINGLE, size: 16, color: accent, space: 1 },
      },
      spacing: { after: 300 },
    }),
    new Paragraph({
      children: [new TextRun({ text: dateLine, size: 20, color: mutedInk })],
      spacing: { before: 2400 },
    }),
    new Paragraph({ children: [new PageBreak()] }),
    new Paragraph({
      children: [
        new TextRun({
          text: "Contents",
          bold: true,
          size: 32,
          color: headingInk,
          font: headingFont,
        }),
      ],
      spacing: { after: 240 },
    }),
    new TableOfContents("Contents", {
      hyperlink: true,
      headingStyleRange: "1-3",
    }),
    new Paragraph({ children: [new PageBreak()] }),
  ];

  const bodyHeader = new Header({
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({ text: document.title, size: 16, color: mutedInk }),
        ],
      }),
    ],
  });
  const bodyFooter = new Footer({
    children: [
      new Paragraph({
        alignment: AlignmentType.RIGHT,
        children: [
          new TextRun({
            children: [PageNumber.CURRENT],
            size: 16,
            color: mutedInk,
          }),
        ],
      }),
    ],
  });

  const docx = new DocxDocument({
    title: document.title,
    ...(isDoc ? { features: { updateFields: true } } : {}),
    styles: {
      default: {
        document: {
          run: { font: bodyFont, size: 22, color: textInk },
        },
        title: {
          run: { font: headingFont, size: 56, bold: true, color: headingInk },
        },
        heading1: {
          run: { font: headingFont, size: 34, bold: true, color: headingInk },
          paragraph: { spacing: { before: 320, after: 160 } },
        },
        heading2: {
          run: { font: headingFont, size: 27, bold: true, color: headingInk },
          paragraph: { spacing: { before: 240, after: 120 } },
        },
        heading3: {
          run: { font: headingFont, size: 23, bold: true, color: headingInk },
          paragraph: { spacing: { before: 200, after: 100 } },
        },
      },
      paragraphStyles: [
        {
          id: "Caption",
          name: "Caption",
          basedOn: "Normal",
          next: "Normal",
          run: { font: bodyFont, size: 18, italics: true, color: mutedInk },
          paragraph: { spacing: { before: 40, after: 200 } },
        },
      ],
    },
    sections: isDoc
      ? [
          { children: front },
          {
            properties: { page: { pageNumbers: { start: 1 } } },
            headers: { default: bodyHeader },
            footers: { default: bodyFooter },
            children,
          },
        ]
      : [{ children }],
  });
  return Buffer.from(await Packer.toBuffer(docx));
}
