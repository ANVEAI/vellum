/**
 * PPTX export — model-driven + geometry-measured, fully headless.
 *
 * Strategy: open /print/[id] in Chromium, measure every top-level block's
 * bounding box, then emit native pptxgenjs text for textual blocks (titles,
 * headings, paragraphs, labels, quotes, callouts, bullets, stats, tables —
 * selectable and editable in PowerPoint) and @2x PNG snapshots for visual
 * blocks (smart layouts, charts, code, columns) at their exact positions.
 * Root images embed the original generated file at full quality.
 *
 * No DOM scraping of content: text comes from the PlateSlide[] model; the
 * DOM only supplies geometry.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import PptxGenJS from "pptxgenjs";
import sharp from "sharp";
import type { Locator } from "playwright";
import { db } from "@/lib/db";
import type { PlateSlide } from "@/lib/generation/parser/slide-parser";
import type { Descendant, TElement, TText } from "@/lib/slides/plate-shim";
import { resolveThemeOrDefault } from "@/lib/themes/resolve";
import type { ThemeProperties } from "@/lib/themes/data";
import { resolveDesignTokens, surfaceOf } from "@/lib/design/tokens";
import { surfaceForSlide } from "@/lib/design/planner";
import { LEGACY_SCALE, type TypeScale } from "@/lib/design/type-scale";
import { fitImage, readPlacement } from "@/lib/slides/image-fit";
import { openPrintPage, withExportPage } from "./browser";

/**
 * PPTX text sizes track the family type scale: the Phase-2 hand-tuned pt
 * values are treated as the baseline for the legacy scale and stretched
 * proportionally per level. Display-tier archetypes boost their lead text.
 */
export interface PtScale {
  title: number;
  h1: number;
  h2: number;
  h3: number;
  h4: number;
  body: number;
  display: number;
}

function ptScaleFor(scale: TypeScale): PtScale {
  return {
    title: (42 * scale.title) / LEGACY_SCALE.title,
    h1: (30 * scale.h1) / LEGACY_SCALE.h1,
    h2: (22 * scale.h2) / LEGACY_SCALE.h2,
    h3: (15 * scale.h3) / LEGACY_SCALE.h3,
    h4: (13 * scale.h4) / LEGACY_SCALE.h4,
    body: (12.5 * scale.body) / LEGACY_SCALE.body,
    display: (42 * scale.display) / LEGACY_SCALE.title,
  };
}

const DISPLAY_ARCHETYPES = new Set([
  "hero",
  "closing",
  "divider",
  "statement",
  "full-bleed",
]);

const PX_PER_IN = 96;
const NATIVE_TYPES = new Set([
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
  "stats",
  "table",
]);

/** chart-* node types with native pptxgenjs equivalents (editable in PPT). */
const NATIVE_CHART_TYPES: Record<string, PptxGenJS.CHART_NAME> = {
  "chart-bar": "bar",
  "chart-line": "line",
  "chart-area": "area",
  "chart-pie": "pie",
  "chart-donut": "doughnut",
  "chart-radar": "radar",
  "chart-scatter": "scatter",
};

/** Playwright boundingBox shape. */
interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Inches-space box for pptxgenjs. */
interface InBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

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

function relBox(el: Box, slide: Box): InBox {
  return {
    x: (el.x - slide.x) / PX_PER_IN,
    y: (el.y - slide.y) / PX_PER_IN,
    w: el.width / PX_PER_IN,
    h: el.height / PX_PER_IN,
  };
}

function hex(color: string): string {
  return color.replace("#", "").slice(0, 6).toUpperCase();
}

/**
 * Places an image into a measured box the way CSS `object-fit` would.
 *
 * pptxgenjs reads `options.w/h` as the image's UNCROPPED size and
 * `sizing.w/h` as the visible window; the rendered box ends up being the
 * sizing one. Passing the same numbers to both — as this exporter used to —
 * makes `crop` compute srcRect(0,0,0,0), i.e. a plain stretch. That silently
 * distorted every image: up to 1.76× horizontally on a vertical band and
 * 2.5× vertically when a 16:9 shot landed in a portrait rail.
 */
async function imagePlacement(
  file: string,
  box: InBox,
  rootImage: unknown,
): Promise<Parameters<PptxSlide["addImage"]>[0]> {
  const { fit, focus } = readPlacement(rootImage);
  let naturalWidth = 0;
  let naturalHeight = 0;
  try {
    const meta = await sharp(file).metadata();
    naturalWidth = meta.width ?? 0;
    naturalHeight = meta.height ?? 0;
  } catch {
    // Unreadable metadata: fall back to filling the box exactly.
  }
  if (!naturalWidth || !naturalHeight) {
    return { path: file, x: box.x, y: box.y, w: box.w, h: box.h };
  }

  const geo = fitImage({
    naturalWidth,
    naturalHeight,
    boxWidth: box.w,
    boxHeight: box.h,
    fit,
    focus,
  });

  if (fit === "contain") {
    // Whole image, letterboxed inside the measured box — no crop needed.
    return {
      path: file,
      x: box.x + geo.offsetX,
      y: box.y + geo.offsetY,
      w: geo.drawWidth,
      h: geo.drawHeight,
    };
  }

  return {
    path: file,
    x: box.x,
    y: box.y,
    // The full scaled image...
    w: geo.drawWidth,
    h: geo.drawHeight,
    // ...of which only this window is shown, offset to the focal point.
    sizing: {
      type: "crop",
      x: geo.offsetX,
      y: geo.offsetY,
      w: geo.visibleWidth,
      h: geo.visibleHeight,
    },
  };
}

function imageFileFromUrl(url: string | undefined): string | null {
  if (!url) return null;
  const match = url.match(/\/api\/images\/file\/([a-z0-9]+\.(?:png|jpe?g))/i);
  if (!match) return null;
  const file = path.resolve(process.cwd(), "data/images", match[1]);
  try {
    readFileSync(file); // existence check
    return file;
  } catch {
    return null;
  }
}

type PptxSlide = ReturnType<PptxGenJS["addSlide"]>;
type TextProps = NonNullable<Parameters<PptxSlide["addText"]>[1]>;

function addNativeText(
  slide: PptxSlide,
  node: TElement,
  box: InBox,
  theme: ThemeProperties,
  pts: PtScale = ptScaleFor(LEGACY_SCALE),
  archetype?: string,
) {
  const headingFont = theme.fonts.heading;
  const bodyFont = theme.fonts.body;
  const headingColor = hex(theme.colors.heading);
  const textColor = hex(theme.colors.text);
  const accent = hex(theme.colors.accent);
  const align =
    (node.alignment as TextProps["align"] | undefined) ?? undefined;
  const display = archetype ? DISPLAY_ARCHETYPES.has(archetype) : false;

  const at = (extra: TextProps): TextProps => ({
    x: box.x,
    y: box.y,
    w: box.w,
    h: box.h,
    valign: "top",
    ...extra,
  });

  switch (node.type) {
    case "presentation-title":
      slide.addText(
        textOf(node.children),
        at({ fontSize: Math.round(display ? pts.display : pts.title), bold: true, color: headingColor, fontFace: headingFont, align: align ?? "left", valign: "middle" }),
      );
      return;
    case "h1":
      slide.addText(
        textOf(node.children),
        at({ fontSize: Math.round(display ? pts.display : pts.h1), bold: true, color: headingColor, fontFace: headingFont, align }),
      );
      return;
    case "h2":
      slide.addText(
        textOf(node.children),
        at({ fontSize: Math.round(display ? pts.display * 0.82 : pts.h2), bold: true, color: headingColor, fontFace: headingFont, align }),
      );
      return;
    case "h3":
      slide.addText(
        textOf(node.children),
        at({ fontSize: Math.round(pts.h3), bold: true, color: headingColor, fontFace: headingFont, align }),
      );
      return;
    case "h4":
    case "h5":
    case "h6":
      slide.addText(
        textOf(node.children),
        at({ fontSize: Math.round(pts.h4), bold: true, color: headingColor, fontFace: headingFont, align }),
      );
      return;
    case "p":
      slide.addText(
        textOf(node.children),
        at({ fontSize: Math.round(pts.body * 2) / 2, color: textColor, fontFace: bodyFont, align }),
      );
      return;
    case "label":
      slide.addText(
        textOf(node.children).toUpperCase(),
        at({ fontSize: 10, bold: true, color: accent, charSpacing: 3, fontFace: bodyFont, valign: "middle" }),
      );
      return;
    case "quote": {
      slide.addShape("rect", {
        x: box.x,
        y: box.y,
        w: 0.04,
        h: box.h,
        fill: { color: accent },
      });
      const author = node.author as string | undefined;
      const runs: PptxGenJS.TextProps[] = [
        {
          text: textOf(node.children),
          options: { fontSize: 16, italic: true, color: headingColor, fontFace: bodyFont, breakLine: true },
        },
      ];
      if (author) {
        runs.push({
          text: `— ${author}`,
          options: { fontSize: 11, color: textColor, fontFace: bodyFont },
        });
      }
      slide.addText(runs, at({ x: box.x + 0.15, w: box.w - 0.15 }));
      return;
    }
    case "callout":
      slide.addShape("roundRect", {
        x: box.x,
        y: box.y,
        w: box.w,
        h: box.h,
        rectRadius: 0.08,
        fill: { color: accent, transparency: 86 },
        line: { color: accent, transparency: 55 },
      });
      slide.addText(
        textOf(node.children),
        at({
          x: box.x + 0.12,
          y: box.y + 0.04,
          w: box.w - 0.24,
          h: box.h - 0.08,
          fontSize: 11.5,
          color: textColor,
          fontFace: bodyFont,
          valign: "middle",
        }),
      );
      return;
    case "bullets": {
      const runs: PptxGenJS.TextProps[] = [];
      for (const item of elements(node)) {
        const heading = elements(item).find((c) =>
          ["h3", "h4"].includes(String(c.type)),
        );
        const body = elements(item).filter((c) => c.type === "p");
        runs.push({
          text: heading ? textOf(heading.children) : textOf(item.children),
          options: {
            bullet: { code: "2022", indent: 12 },
            fontSize: 13,
            bold: true,
            color: headingColor,
            fontFace: headingFont,
            breakLine: true,
            paraSpaceBefore: runs.length ? 8 : 0,
          },
        });
        for (const p of body) {
          runs.push({
            text: textOf(p.children),
            options: {
              fontSize: 11.5,
              color: textColor,
              fontFace: bodyFont,
              breakLine: true,
              indentLevel: 1,
            },
          });
        }
      }
      slide.addText(runs, at({}));
      return;
    }
    case "table": {
      const rows = elements(node).map((tr) =>
        elements(tr).map((cell) => ({
          text: textOf(cell.children),
          options: {
            fontSize: 11,
            color: cell.type === "th" ? headingColor : textColor,
            bold: cell.type === "th",
            fontFace: bodyFont,
            fill:
              cell.type === "th"
                ? { color: accent, transparency: 84 }
                : undefined,
          } as PptxGenJS.TableCellProps,
        })),
      );
      if (rows.length === 0) return;
      slide.addTable(rows as PptxGenJS.TableRow[], {
        x: box.x,
        y: box.y,
        w: box.w,
        border: { type: "solid", color: hex(theme.colors.text), pt: 0.5 },
        autoPage: false,
      });
      return;
    }
    default:
      return;
  }
}

function addStatsNative(
  slide: PptxSlide,
  node: TElement,
  itemBoxes: InBox[],
  theme: ThemeProperties,
) {
  const items = elements(node);
  items.forEach((item, i) => {
    const box = itemBoxes[i];
    if (!box) return;
    const heading = elements(item).find((c) =>
      ["h3", "h4"].includes(String(c.type)),
    );
    const body = elements(item).filter((c) => c.type === "p");
    const runs: PptxGenJS.TextProps[] = [
      {
        text: String(item.stat ?? ""),
        options: {
          fontSize: 30,
          bold: true,
          color: hex(theme.colors.accent),
          fontFace: theme.fonts.heading,
          breakLine: true,
        },
      },
    ];
    if (heading) {
      runs.push({
        text: textOf(heading.children),
        options: {
          fontSize: 13,
          bold: true,
          color: hex(theme.colors.heading),
          fontFace: theme.fonts.heading,
          breakLine: true,
        },
      });
    }
    for (const p of body) {
      runs.push({
        text: textOf(p.children),
        options: {
          fontSize: 10.5,
          color: hex(theme.colors.text),
          fontFace: theme.fonts.body,
          breakLine: true,
        },
      });
    }
    slide.addText(runs, {
      x: box.x + 0.12,
      y: box.y + 0.08,
      w: box.w - 0.24,
      h: box.h - 0.16,
      valign: "top",
    });
  });
}

/**
 * Smart layouts exported as native shapes + text (editable in PowerPoint).
 * Geometry comes from per-item sub-locators in the print DOM; any measurement
 * mismatch falls back to the snapshot path.
 */
const NATIVE_LAYOUT_TYPES = new Set([
  "boxes",
  "icons",
  "steps",
  "timeline",
  "arrows",
  "arrow-vertical",
  "compare",
  "before-after",
  "pros-cons",
]);

const PROS_COLOR = "34C98E";
const CONS_COLOR = "E2596F";

/** Rasterized icon cache (svg path + tint → PNG data URI), process-wide. */
const iconPngCache = new Map<string, string | null>();

async function iconPngDataUri(
  url: string | undefined,
  accent: string,
): Promise<string | null> {
  if (!url) return null;
  const match = url.match(/^\/static\/icons\/([a-z0-9-]+)\/([a-z0-9._-]+\.svg)$/i);
  if (!match) return null;
  const key = `${match[1]}/${match[2]}|${accent}`;
  const cached = iconPngCache.get(key);
  if (cached !== undefined) return cached;
  let out: string | null = null;
  try {
    const file = path.resolve(
      process.cwd(),
      "public/static/icons",
      match[1],
      match[2],
    );
    let svg = readFileSync(file, "utf8");
    svg = svg.replace(/currentColor/gi, `#${accent}`);
    if (!/<svg[^>]*fill=/i.test(svg)) {
      svg = svg.replace(/<svg/i, `<svg fill="#${accent}"`);
    }
    const png = await sharp(Buffer.from(svg))
      .resize(96, 96, {
        fit: "contain",
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png()
      .toBuffer();
    out = `data:image/png;base64,${png.toString("base64")}`;
  } catch {
    out = null;
  }
  iconPngCache.set(key, out);
  return out;
}

function itemIconUrl(item: TElement): string | undefined {
  const direct = item.iconUrl as string | undefined;
  if (direct) return direct;
  const iconNode = elements(item).find((c) => String(c.type) === "icon");
  return iconNode?.url as string | undefined;
}

/** Flatten one group item (heading + paragraphs + nested bullets) to runs. */
function itemRuns(
  item: TElement,
  theme: ThemeProperties,
  opts?: { headingSize?: number; bodySize?: number },
): PptxGenJS.TextProps[] {
  const headingSize = opts?.headingSize ?? 12;
  const bodySize = opts?.bodySize ?? 10.5;
  const headingColor = hex(theme.colors.heading);
  const textColor = hex(theme.colors.text);
  const runs: PptxGenJS.TextProps[] = [];
  const push = (text: string, options: PptxGenJS.TextPropsOptions) => {
    if (text.trim()) runs.push({ text, options: { breakLine: true, ...options } });
  };
  for (const child of elements(item)) {
    const type = String(child.type);
    if (type === "icon") continue;
    if (/^h[1-6]$/.test(type)) {
      push(textOf(child.children), {
        fontSize: headingSize,
        bold: true,
        color: headingColor,
        fontFace: theme.fonts.heading,
        paraSpaceAfter: 2,
      });
    } else if (type === "p") {
      push(textOf(child.children), {
        fontSize: bodySize,
        color: textColor,
        fontFace: theme.fonts.body,
      });
    } else if (type === "bullets") {
      for (const sub of elements(child)) {
        const subHeading = elements(sub).find((c) =>
          /^h[1-6]$/.test(String(c.type)),
        );
        const subBody = elements(sub).filter((c) => c.type === "p");
        push(subHeading ? textOf(subHeading.children) : textOf(sub.children), {
          bullet: { code: "2022", indent: 8 },
          fontSize: bodySize,
          color: textColor,
          fontFace: theme.fonts.body,
        });
        if (subHeading) {
          for (const p of subBody) {
            push(textOf(p.children), {
              fontSize: bodySize - 0.5,
              color: textColor,
              fontFace: theme.fonts.body,
              indentLevel: 1,
            });
          }
        }
      }
    } else {
      push(textOf(child.children), {
        fontSize: bodySize,
        color: textColor,
        fontFace: theme.fonts.body,
      });
    }
  }
  if (runs.length === 0) {
    push(textOf(item.children), {
      fontSize: bodySize,
      color: textColor,
      fontFace: theme.fonts.body,
    });
  }
  return runs;
}

function insetBox(box: InBox, dx = 0.17, dy = 0.14): InBox {
  return {
    x: box.x + dx,
    y: box.y + dy,
    w: Math.max(0.2, box.w - 2 * dx),
    h: Math.max(0.15, box.h - 2 * dy),
  };
}

/** First matching descendant's box relative to the slide, or null. */
async function innerBox(
  scope: Locator,
  selector: string,
  slideBox: Box,
): Promise<InBox | null> {
  const locator = scope.locator(selector).first();
  if ((await locator.count()) === 0) return null;
  const box = (await locator.boundingBox()) as Box | null;
  return box ? relBox(box, slideBox) : null;
}

function addCard(
  out: PptxSlide,
  box: InBox,
  theme: ThemeProperties,
  topBar?: { color: string; transparency?: number },
) {
  out.addShape("roundRect", {
    x: box.x,
    y: box.y,
    w: box.w,
    h: box.h,
    rectRadius: Math.min(0.1, box.h / 4, box.w / 4),
    fill: { color: hex(theme.colors.text), transparency: 93 },
    line: { color: hex(theme.colors.text), transparency: 86 },
  });
  if (topBar) {
    out.addShape("rect", {
      x: box.x + 0.08,
      y: box.y,
      w: Math.max(0.1, box.w - 0.16),
      h: 0.035,
      fill: { color: topBar.color, transparency: topBar.transparency ?? 0 },
    });
  }
}

function addNumBadge(
  out: PptxSlide,
  box: InBox,
  n: number,
  theme: ThemeProperties,
) {
  out.addShape("ellipse", {
    x: box.x,
    y: box.y,
    w: box.w,
    h: box.h,
    fill: { color: hex(theme.colors.accent) },
  });
  out.addText(String(n), {
    x: box.x - 0.08,
    y: box.y - 0.03,
    w: box.w + 0.16,
    h: box.h + 0.06,
    align: "center",
    valign: "middle",
    fontSize: 11,
    bold: true,
    color: hex(theme.colors.background),
    fontFace: theme.fonts.heading,
  });
}

async function addIconGlyph(
  out: PptxSlide,
  box: InBox,
  url: string | undefined,
  theme: ThemeProperties,
) {
  out.addShape("roundRect", {
    x: box.x,
    y: box.y,
    w: box.w,
    h: box.h,
    rectRadius: Math.min(0.08, box.h / 4),
    fill: { color: hex(theme.colors.accent), transparency: 84 },
  });
  const png = await iconPngDataUri(url, hex(theme.colors.accent));
  if (png) {
    const pad = Math.min(box.w, box.h) * 0.2;
    out.addImage({
      data: png,
      x: box.x + pad,
      y: box.y + pad,
      w: box.w - 2 * pad,
      h: box.h - 2 * pad,
    });
  }
}

/**
 * Emit a smart layout as native shapes+text. Returns false (→ snapshot
 * fallback) when the DOM sub-item count doesn't match the model.
 */
async function tryNativeLayout(
  out: PptxSlide,
  blockLocator: Locator,
  node: TElement,
  slideBox: Box,
  theme: ThemeProperties,
): Promise<boolean> {
  const type = String(node.type);
  const items = elements(node);
  if (items.length === 0) return false;
  const accent = hex(theme.colors.accent);

  const itemBoxesFor = async (selector: string): Promise<InBox[] | null> => {
    const locators = await blockLocator.locator(selector).all();
    if (locators.length !== items.length) return null;
    const boxes: InBox[] = [];
    for (const locator of locators) {
      const box = (await locator.boundingBox()) as Box | null;
      if (!box) return null;
      boxes.push(relBox(box, slideBox));
    }
    return boxes;
  };

  switch (type) {
    case "boxes": {
      const boxes = await itemBoxesFor(".v-box");
      if (!boxes) return false;
      for (let i = 0; i < items.length; i++) {
        const scope = blockLocator.locator(".v-box").nth(i);
        addCard(out, boxes[i], theme);
        const numBox = await innerBox(scope, ".v-num", slideBox);
        if (numBox) addNumBadge(out, numBox, i + 1, theme);
        const iconBox = numBox
          ? null
          : await innerBox(scope, ".v-icon", slideBox);
        if (iconBox) {
          await addIconGlyph(out, iconBox, itemIconUrl(items[i]), theme);
        }
        const body =
          (await innerBox(scope, ".v-item-body", slideBox)) ??
          insetBox(boxes[i]);
        out.addText(itemRuns(items[i], theme), { ...body, valign: "top" });
      }
      return true;
    }

    case "icons": {
      const boxes = await itemBoxesFor(".v-icons-item");
      if (!boxes) return false;
      for (let i = 0; i < items.length; i++) {
        const scope = blockLocator.locator(".v-icons-item").nth(i);
        const iconBox = await innerBox(scope, ".v-icon", slideBox);
        if (iconBox) {
          await addIconGlyph(out, iconBox, itemIconUrl(items[i]), theme);
        }
        const body =
          (await innerBox(scope, ".v-item-body", slideBox)) ?? boxes[i];
        out.addText(itemRuns(items[i], theme), { ...body, valign: "top" });
      }
      return true;
    }

    case "steps": {
      const boxes = await itemBoxesFor(".v-step");
      if (!boxes) return false;
      for (let i = 0; i < items.length; i++) {
        const scope = blockLocator.locator(".v-step").nth(i);
        const numBox = await innerBox(scope, ".v-num", slideBox);
        if (numBox) addNumBadge(out, numBox, i + 1, theme);
        const lineBox = await innerBox(scope, ".v-step-line", slideBox);
        if (lineBox) {
          out.addShape("rect", {
            x: lineBox.x,
            y: lineBox.y,
            w: lineBox.w,
            h: Math.max(0.02, lineBox.h),
            fill: { color: accent, transparency: 55 },
          });
        }
        const iconBox = await innerBox(scope, ".v-icon", slideBox);
        if (iconBox) {
          await addIconGlyph(out, iconBox, itemIconUrl(items[i]), theme);
        }
        const body =
          (await innerBox(scope, ".v-item-body", slideBox)) ??
          insetBox(boxes[i], 0, 0.5);
        out.addText(itemRuns(items[i], theme), { ...body, valign: "top" });
      }
      return true;
    }

    case "timeline": {
      const boxes = await itemBoxesFor(".v-timeline-item");
      if (!boxes) return false;
      const lineBox = await innerBox(blockLocator, ".v-timeline-line", slideBox);
      if (lineBox) {
        out.addShape("rect", {
          x: lineBox.x,
          y: lineBox.y,
          w: Math.max(0.02, lineBox.w),
          h: lineBox.h,
          fill: { color: accent, transparency: 50 },
        });
      }
      for (let i = 0; i < items.length; i++) {
        const scope = blockLocator.locator(".v-timeline-item").nth(i);
        const dotBox = await innerBox(scope, ".v-timeline-dot", slideBox);
        if (dotBox) {
          out.addShape("ellipse", {
            ...dotBox,
            fill: { color: accent },
          });
        }
        const cardBox = await innerBox(scope, ".v-timeline-body", slideBox);
        if (cardBox) addCard(out, cardBox, theme);
        const body =
          (await innerBox(scope, ".v-item-body", slideBox)) ??
          insetBox(cardBox ?? boxes[i]);
        out.addText(itemRuns(items[i], theme), { ...body, valign: "top" });
      }
      return true;
    }

    case "arrows": {
      const boxes = await itemBoxesFor(".v-arrow-item");
      if (!boxes) return false;
      for (let i = 0; i < items.length; i++) {
        const scope = blockLocator.locator(".v-arrow-item").nth(i);
        const cardBox = await innerBox(scope, ".v-arrow-shape", slideBox);
        if (cardBox) addCard(out, cardBox, theme);
        const body =
          (await innerBox(scope, ".v-item-body", slideBox)) ??
          insetBox(cardBox ?? boxes[i]);
        out.addText(itemRuns(items[i], theme), { ...body, valign: "top" });
        const sepBox = await innerBox(scope, ".v-arrow-sep", slideBox);
        if (sepBox) {
          out.addText("→", {
            ...sepBox,
            align: "center",
            valign: "middle",
            fontSize: 18,
            bold: true,
            color: accent,
            fontFace: theme.fonts.heading,
          });
        }
      }
      return true;
    }

    case "arrow-vertical": {
      const boxes = await itemBoxesFor(".v-seq-item");
      if (!boxes) return false;
      for (let i = 0; i < items.length; i++) {
        const scope = blockLocator.locator(".v-seq-item").nth(i);
        const numBox = await innerBox(scope, ".v-num", slideBox);
        if (numBox) addNumBadge(out, numBox, i + 1, theme);
        const cardBox = await innerBox(scope, ".v-seq-body", slideBox);
        if (cardBox) addCard(out, cardBox, theme);
        const body =
          (await innerBox(scope, ".v-item-body", slideBox)) ??
          insetBox(cardBox ?? boxes[i]);
        out.addText(itemRuns(items[i], theme), { ...body, valign: "top" });
      }
      return true;
    }

    case "compare":
    case "before-after":
    case "pros-cons": {
      const boxes = await itemBoxesFor(".v-side");
      if (!boxes) return false;
      for (let i = 0; i < items.length; i++) {
        const scope = blockLocator.locator(".v-side").nth(i);
        let topBar: { color: string; transparency?: number };
        if (type === "pros-cons") {
          const isPros = items[i].type === "pros-item" || i === 0;
          topBar = { color: isPros ? PROS_COLOR : CONS_COLOR };
        } else {
          topBar =
            i === 0 ? { color: accent } : { color: accent, transparency: 45 };
        }
        addCard(out, boxes[i], theme, topBar);
        const body =
          (await innerBox(scope, ".v-item-body", slideBox)) ??
          insetBox(boxes[i]);
        out.addText(itemRuns(items[i], theme, { headingSize: 13, bodySize: 11 }), {
          ...body,
          valign: "top",
        });
      }
      if (type !== "pros-cons") {
        const vsBox = await innerBox(blockLocator, ".v-vs", slideBox);
        if (vsBox) {
          out.addShape("ellipse", {
            ...vsBox,
            fill: { color: accent },
          });
          out.addText(type === "compare" ? "VS" : "→", {
            x: vsBox.x - 0.05,
            y: vsBox.y - 0.03,
            w: vsBox.w + 0.1,
            h: vsBox.h + 0.06,
            align: "center",
            valign: "middle",
            fontSize: 10,
            bold: true,
            color: hex(theme.colors.background),
            fontFace: theme.fonts.heading,
          });
        }
      }
      return true;
    }

    default:
      return false;
  }
}

export async function exportPptx(documentId: string): Promise<Buffer> {
  const document = await db.document.findUnique({
    where: { id: documentId },
    include: { customTheme: true },
  });
  if (!document) throw new Error("Document not found");
  const slides = JSON.parse(document.slides) as PlateSlide[];
  let customThemeData: unknown = null;
  if (document.customTheme) {
    try {
      customThemeData = JSON.parse(document.customTheme.data);
    } catch {
      customThemeData = null;
    }
  }
  const theme = resolveThemeOrDefault(document.themeName, customThemeData);
  const tokens = resolveDesignTokens(theme, document.themeName ?? undefined);
  const pts = ptScaleFor(tokens.style.scale);
  const surface = surfaceOf(theme);

  return withExportPage(async (page, origin) => {
    await openPrintPage(page, origin, documentId);

    // Theme gradient surface → one probe screenshot reused as every slide's
    // background image (pptx backgrounds are flat color or image only).
    let surfaceBgData: string | null = null;
    if (surface.includes("gradient")) {
      await page.evaluate((background) => {
        const probe = window.document.createElement("div");
        probe.id = "__vellum_bg_probe";
        probe.style.cssText = `position:fixed;left:0;top:0;width:1280px;height:720px;z-index:99999;background:${background}`;
        window.document.body.appendChild(probe);
      }, surface);
      const shot = await page.screenshot({
        type: "png",
        clip: { x: 0, y: 0, width: 1280, height: 720 },
      });
      await page.evaluate(() => {
        window.document.getElementById("__vellum_bg_probe")?.remove();
      });
      surfaceBgData = `data:image/png;base64,${shot.toString("base64")}`;
    }

    const pptx = new PptxGenJS();
    pptx.defineLayout({ name: "V169", width: 13.333, height: 7.5 });
    pptx.layout = "V169";
    pptx.title = document.title;

    for (let i = 0; i < slides.length; i++) {
      const model = slides[i];
      const slideLocator = page.locator(`[data-slide-idx="${i}"]`);
      const slideBox = (await slideLocator.boundingBox()) as Box | null;
      if (!slideBox) continue;

      const out = pptx.addSlide();
      // The renderer may have shrunk this slide's type to fit. Point sizes are
      // computed from the scale, not read off the DOM, so without this the
      // exported text would be larger than the boxes measured around it.
      const fitAttr = await slideLocator.getAttribute("data-fit");
      const fit = fitAttr ? Number(fitAttr) : 1;
      const slidePts: PtScale =
        Number.isFinite(fit) && fit > 0 && fit < 1
          ? {
              title: pts.title * fit,
              h1: pts.h1 * fit,
              h2: pts.h2 * fit,
              h3: pts.h3 * fit,
              h4: pts.h4 * fit,
              body: pts.body * fit,
              display: pts.display * fit,
            }
          : pts;
      const rhythmSurface = surfaceForSlide(tokens.structure, model, i);
      if (model.bgColor) {
        out.background = { color: hex(model.bgColor) };
      } else if (rhythmSurface) {
        out.background = { color: hex(rhythmSurface) };
      } else if (surfaceBgData) {
        out.background = { data: surfaceBgData };
      } else {
        out.background = { color: hex(theme.colors.background) };
      }

      // Root image: embed the original file at its measured position.
      const rootUrl = (model.rootImage as { url?: string } | undefined)?.url;
      const rootFile = imageFileFromUrl(rootUrl);
      const rootLocator = slideLocator.locator("[data-root-img]");
      const isFullBleed =
        model.layoutType === "background" || model.archetype === "full-bleed";
      if (rootFile && (await rootLocator.count()) > 0) {
        const rb = (await rootLocator.boundingBox()) as Box | null;
        if (rb) {
          const rel = relBox(rb, slideBox);
          const placement = await imagePlacement(rootFile, rel, model.rootImage);
          out.addImage({
            ...placement,
            // A non-full-bleed background image is a 25% wash on screen; it
            // used to export at full strength and drown the text.
            ...(model.layoutType === "background" && !isFullBleed
              ? { transparency: 75 }
              : {}),
          });
          // Scrim so overlaid text stays readable on full-bleed slides
          // (mirrors the CSS gradient scrim with a translucent band).
          if (isFullBleed) {
            out.addShape("rect", {
              x: 0,
              y: 7.5 * 0.36,
              w: 13.333,
              h: 7.5 * 0.64,
              fill: {
                color: hex(theme.colors.background),
                transparency: 32,
              },
              line: { type: "none" },
            });
          }
        }
      }

      const contentEls = model.content.filter(
        (n): n is TElement => typeof (n as TElement).type === "string",
      );
      for (let j = 0; j < contentEls.length; j++) {
        const node = contentEls[j];
        const blockLocator = slideLocator.locator(`[data-block-idx="${j}"]`);
        if ((await blockLocator.count()) === 0) continue;
        const bb = (await blockLocator.boundingBox()) as Box | null;
        if (!bb || bb.width < 2 || bb.height < 2) continue;
        const rel = relBox(bb, slideBox);

        if (node.type === "stats") {
          const statLocators = await blockLocator.locator(".v-stat").all();
          const itemBoxes: InBox[] = [];
          for (const sl of statLocators) {
            const sb = (await sl.boundingBox()) as Box | null;
            if (sb) itemBoxes.push(relBox(sb, slideBox));
          }
          if (itemBoxes.length === elements(node).length) {
            // Card outlines behind native stat text.
            for (const ib of itemBoxes) {
              out.addShape("roundRect", {
                x: ib.x,
                y: ib.y,
                w: ib.w,
                h: ib.h,
                rectRadius: 0.08,
                fill: { color: hex(theme.colors.text), transparency: 94 },
                line: { color: hex(theme.colors.text), transparency: 85 },
              });
            }
            addStatsNative(out, node, itemBoxes, theme);
            continue;
          }
        }

        if (NATIVE_TYPES.has(String(node.type))) {
          addNativeText(out, node, rel, theme, slidePts, model.archetype);
          continue;
        }
        if (node.type === "contributor") continue;

        // Smart layouts → native shapes+text; falls through to snapshot on
        // any geometry mismatch or error.
        if (NATIVE_LAYOUT_TYPES.has(String(node.type))) {
          const handled = await tryNativeLayout(
            out,
            blockLocator,
            node,
            slideBox,
            theme,
          ).catch(() => false);
          if (handled) continue;
        }

        // Native, PowerPoint-editable charts for the common chart types.
        const nativeChart = NATIVE_CHART_TYPES[String(node.type)];
        if (nativeChart && Array.isArray(node.data)) {
          const rows = node.data as Array<Record<string, string | number>>;
          const fields = rows.length ? Object.keys(rows[0]) : [];
          if (rows.length >= 2 && fields.length >= 2) {
            const category = fields[0];
            const seriesFields = fields.slice(1);
            const labels = rows.map((r) => String(r[category] ?? ""));
            const toNum = (v: unknown) => {
              const n = parseFloat(String(v ?? "").replace(/[^0-9.eE+-]/g, ""));
              return Number.isFinite(n) ? n : 0;
            };
            const data = seriesFields.map((s) => ({
              name: s,
              labels,
              values: rows.map((r) => toNum(r[s])),
            }));
            out.addChart(nativeChart, data, {
              x: rel.x,
              y: rel.y,
              w: rel.w,
              h: rel.h,
              chartColors: [
                hex(theme.colors.accent),
                hex(theme.colors.primary),
                "5EC9A9",
                "E8B04E",
                "D96C8A",
                "6C9BD9",
              ],
              catAxisLabelColor: hex(theme.colors.text),
              valAxisLabelColor: hex(theme.colors.text),
              legendColor: hex(theme.colors.text),
              dataLabelColor: hex(theme.colors.text),
              showLegend: seriesFields.length > 1,
              chartColorsOpacity: 100,
            });
            continue;
          }
        }

        // Inline image with a generated file → embed the original natively.
        if (node.type === "img") {
          const file = imageFileFromUrl(node.url as string | undefined);
          if (file) {
            // Inline figures are laid out by their own aspect on screen, so
            // "contain" reproduces what the reader sees.
            out.addImage(await imagePlacement(file, rel, { fit: "contain" }));
            continue;
          }
        }

        // Visual block → clip-rect PNG capture at exact position. Clip-based
        // capture (not locator.screenshot) works even when the block is
        // partially outside the slide's overflow:hidden box.
        const clip = {
          x: Math.max(bb.x, slideBox.x),
          y: Math.max(bb.y, slideBox.y),
          width: Math.min(bb.x + bb.width, slideBox.x + slideBox.width) - Math.max(bb.x, slideBox.x),
          height: Math.min(bb.y + bb.height, slideBox.y + slideBox.height) - Math.max(bb.y, slideBox.y),
        };
        if (clip.width < 2 || clip.height < 2) continue;
        const png = await page.screenshot({ type: "png", clip, fullPage: true });
        const clipRel = relBox(
          { x: clip.x, y: clip.y, width: clip.width, height: clip.height },
          slideBox,
        );
        out.addImage({
          data: `data:image/png;base64,${png.toString("base64")}`,
          x: clipRel.x,
          y: clipRel.y,
          w: clipRel.w,
          h: clipRel.h,
        });
      }

      const note = (model as { speakerNote?: string }).speakerNote;
      if (note) out.addNotes(note);
    }

    const output = (await pptx.write({ outputType: "nodebuffer" })) as Buffer;
    return output;
  });
}
