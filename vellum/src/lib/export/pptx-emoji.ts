/**
 * Emoji in the PowerPoint export: runs of their own, set in the emoji font.
 *
 * pptxgenjs writes a run's font into all three of its slots (latin, ea, cs),
 * and the exporter gives every run the theme's text font, which has no
 * emoji. PowerPoint then substitutes a font for each emoji itself, and can
 * land on a black-and-white glyph. When someone types an emoji, PowerPoint
 * sets that run in Segoe UI Emoji instead; this does the same, so the deck
 * names the font the PDF was rendered with (lib/slides/emoji.ts).
 *
 * The emoji keep the size, colour and link of the text around them, and are
 * set upright and regular weight, as the slide sets them.
 */
import type PptxGenJS from "pptxgenjs";
import JSZip from "jszip";
import { EMOJI_FONT, hasEmoji, splitEmoji } from "@/lib/slides/emoji";

type PptxSlide = ReturnType<PptxGenJS["addSlide"]>;
type TextProps = PptxGenJS.TextProps;
type TextOptions = NonNullable<TextProps["options"]>;
type Run = { text?: string; options?: TextOptions };

/**
 * Options that open a new paragraph in pptxgenjs, so only the first piece of
 * a split run may carry them: a bullet on the second piece made a second
 * bullet out of the text after an emoji.
 */
const PARAGRAPH_OPENERS = ["bullet", "softBreakBefore"] as const;

/** One run cut at its emoji, its newlines kept as pptxgenjs reads them. */
function splitRun(run: Run): Run[] {
  const text = run.text ?? "";
  if (!hasEmoji(text)) return [run];
  const lines = text.split(/\r?\n/);
  const out: Run[] = [];
  lines.forEach((line, li) => {
    const pieces = splitEmoji(line);
    const lastLine = li === lines.length - 1;
    pieces.forEach((piece, pi) => {
      const options: TextOptions & Record<string, unknown> = { ...(run.options ?? {}) };
      if (pi > 0) for (const key of PARAGRAPH_OPENERS) delete options[key];
      // A newline ends a paragraph, as it does when pptxgenjs splits a run
      // itself; the run's own line break stays at its end.
      const endOfLine = pi === pieces.length - 1;
      options.breakLine = endOfLine ? (lastLine ? run.options?.breakLine : true) : false;
      if (piece.emoji) {
        options.fontFace = EMOJI_FONT;
        options.bold = false;
        options.italic = false;
      }
      out.push({ text: piece.text, options });
    });
  });
  return out;
}

/**
 * Bold and italic set on the whole text box. pptxgenjs copies a box option
 * into every run whose own value is falsy, so `bold: false` on an emoji run
 * lost to a bold box; carried into the runs instead, each run's own value
 * holds.
 */
function pushDownStyle(runs: Run[], options: TextOptions | undefined): { runs: Run[]; options: TextOptions | undefined } {
  if (!options || (options.bold === undefined && options.italic === undefined)) return { runs, options };
  const { bold, italic, ...rest } = options;
  return {
    runs: runs.map((run) => ({
      ...run,
      options: {
        ...(bold !== undefined ? { bold } : {}),
        ...(italic !== undefined ? { italic } : {}),
        ...(run.options ?? {}),
      },
    })),
    options: rest,
  };
}

/**
 * The text and box options for `addText`, with emoji as runs of their own.
 * Text without emoji comes back as it was passed, so a deck without emoji
 * exports exactly as before.
 */
export function emojiText(
  text: string | Run[],
  options?: TextOptions,
): { text: string | Run[]; options?: TextOptions } {
  const runs: Run[] = typeof text === "string" ? [{ text }] : text;
  if (!runs.some((run) => typeof run === "object" && run && hasEmoji(run.text ?? ""))) {
    return { text, options };
  }
  const pushed = pushDownStyle(runs, options);
  return { text: pushed.runs.flatMap(splitRun), options: pushed.options };
}

type TableRows = Parameters<PptxSlide["addTable"]>[0];

/** Table cells get the same treatment as text boxes, cell by cell. */
function emojiTable(rows: TableRows): TableRows {
  return rows.map((row) =>
    row.map((cell) => {
      const text = (cell as { text?: unknown }).text;
      if (typeof text !== "string" || !hasEmoji(text)) return cell;
      const split = emojiText(text, (cell as { options?: TextOptions }).options);
      return { ...cell, text: split.text, options: split.options } as typeof cell;
    }),
  ) as TableRows;
}

/**
 * A slide whose text boxes and table cells set emoji as runs of their own.
 * A wrapper rather than a change at each call site — the exporter adds text
 * from a dozen places, present and future.
 */
export function withEmojiRuns(slide: PptxSlide): PptxSlide {
  return new Proxy(slide, {
    get(target, prop, receiver) {
      if (prop === "addText") {
        return (text: string | Run[], options?: TextOptions) => {
          const split = emojiText(text, options);
          target.addText(split.text as Parameters<PptxSlide["addText"]>[0], split.options);
          return receiver;
        };
      }
      if (prop === "addTable") {
        return (rows: TableRows, options?: Parameters<PptxSlide["addTable"]>[1]) => {
          target.addTable(emojiTable(rows), options);
          return receiver;
        };
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

/**
 * Each paragraph with one set of paragraph properties, at its start.
 *
 * pptxgenjs 4.0.1 writes an `<a:pPr>` before every run of a paragraph, not
 * once — `<a:p><a:pPr/><a:r/><a:pPr/><a:r/></a:p>` — which the DrawingML
 * schema does not allow (one, first). The exporter never put two runs in a
 * paragraph before emoji got runs of their own, so it never showed. The
 * first set is the paragraph's own (its bullet, indent and spacing); the
 * repeats are dropped.
 */
export function singleParagraphProperties(xml: string): string {
  return xml.replace(/<a:p>([\s\S]*?)<\/a:p>/g, (paragraph, body: string) => {
    let seen = false;
    const fixed = body.replace(/<a:pPr\b[^>]*?(?:\/>|>[\s\S]*?<\/a:pPr>)/g, (pPr) => {
      if (seen) return "";
      seen = true;
      return pPr;
    });
    return fixed === body ? paragraph : `<a:p>${fixed}</a:p>`;
  });
}

/**
 * The finished deck with its slides' paragraphs repaired, or the same
 * buffer when nothing needed it — an export without split runs is returned
 * byte for byte as pptxgenjs wrote it.
 */
export async function repairParagraphs(buffer: Buffer): Promise<Buffer> {
  const zip = await JSZip.loadAsync(buffer);
  let changed = false;
  for (const name of Object.keys(zip.files)) {
    if (!/^ppt\/slides\/slide\d+\.xml$/.test(name)) continue;
    const file = zip.file(name);
    if (!file) continue;
    const xml = await file.async("string");
    const fixed = singleParagraphProperties(xml);
    if (fixed !== xml) {
      zip.file(name, fixed);
      changed = true;
    }
  }
  if (!changed) return buffer;
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}
