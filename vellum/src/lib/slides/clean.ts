/**
 * Generated slide content, cleaned before anyone sees it.
 *
 * The parser builds exactly what the model wrote, and the model writes things
 * that never belong on a slide:
 *
 * - Notes about its own editing. Asked by the quality gate to rewrite a
 *   slide, it answered with a callout reading "Slide 9: Removed duplicate
 *   'Accounting & audit' entries. Reordered list for clarity." — and that
 *   callout became the slide.
 * - Empty items and containers. A bullet with no text still draws its dot; an
 *   empty lane still claims a grid track.
 * - The same item twice in one list.
 * - "Slide 3:" in front of a heading, copied from the numbered outline the
 *   prompt hands it.
 *
 * It runs inside the parser, so the streaming preview, the saved deck, the
 * quality gate's rewrites and single-slide regeneration all see the same
 * content. It is never applied to what a user types in the editor: these
 * rules describe the model's habits, not a person's intent.
 */
import type { Descendant, TElement, TText } from "@/lib/slides/plate-shim";
import { hasContent, isElement } from "@/lib/slides/walk";

/** Groups whose children are its items, one per bullet, card, step or lane. */
const ITEM_GROUPS = new Set([
  "bullets",
  "icons",
  "boxes",
  "steps",
  "timeline",
  "cycle",
  "pyramid",
  "staircase",
  "compare",
  "before-after",
  "pros-cons",
  "stats",
  "arrow-vertical",
  "arrows",
  "snake",
  "circular-grid",
  "connected-circles",
  "slope",
  "column_group",
]);

/** Blocks that are made of their text: without any, they are nothing. */
const TEXT_BLOCKS = new Set([
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "presentation-title",
  "label",
  "blockquote",
  "quote",
  "callout",
  "button",
  "column",
]);

const HEADINGS = new Set([
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "presentation-title",
  "label",
]);

/**
 * Content this pass never edits or descends into: data, media and drawn
 * structures, whose emptiness means something different (a blank table cell
 * is part of a grid) or whose substance lives in attributes. Icons decorate
 * the item they sit in and are kept with it.
 */
function isOpaque(type: string): boolean {
  return (
    type === "table" ||
    type === "img" ||
    type === "icon" ||
    type === "contributor" ||
    type === "code_block" ||
    type.startsWith("chart-") ||
    [
      "antv-infographic",
      "funnel-flow",
      "kpi-row",
      "progress-rings",
      "pictogram",
      "harvey-table",
      "matrix",
      "org-chart",
      "journey",
      "venn",
      "iceberg",
      "flow-diagram",
    ].includes(type)
  );
}

function textOf(node: Descendant): string {
  if (!isElement(node)) return (node as TText).text ?? "";
  return (node.children ?? []).map((c) => textOf(c as Descendant)).join(" ");
}

/* ---------- notes about the edit ---------- */

/** Past-tense editing verbs, as the model reports what it did to a slide. */
const EDIT_VERBS =
  "removed|deleted|dropped|reordered|re-ordered|rearranged|reorganized|reorganised|condensed|shortened|trimmed|tightened|rewrote|rewritten|reworded|rephrased|merged|combined|consolidated|deduplicated|de-duplicated|simplified|restructured|moved|kept|cut|split|replaced|updated|revised|fixed|corrected|reduced|changed|added";

/** "Slide 9: Removed duplicate entries" — a changelog line about a slide. */
const SLIDE_CHANGELOG = new RegExp(
  `^(?:slide|section)\\s*#?\\d{1,3}\\s*[:.)\\-–—]\\s*(?:i(?:'ve| have)?\\s+)?(?:${EDIT_VERBS})\\b`,
  "i",
);

/** The assistant addressing the reader about its output. */
const ASSISTANT_PREAMBLE = new RegExp(
  [
    // "Here is the revised slide", "Here's an updated version"
    `^here(?:'s| is| are)\\s+(?:the|a|an|your)\\s+(?:revised|rewritten|updated|condensed|shortened|new|improved|corrected|final|tightened)\\b`,
    // "I've condensed…", "I have removed…"
    `^i(?:'ve| have)\\s+(?:${EDIT_VERBS})\\b`,
    // "I removed the duplicate bullets"
    `^i\\s+(?:${EDIT_VERBS})\\s+(?:the|this|your|a|an)?\\s*(?:duplicate\\s+|redundant\\s+|repeated\\s+)?(?:slide|section|list|heading|headline|title|text|copy|content|wording|bullets?|items?|entries|points|lines|words)\\b`,
    // "Changes:", "Changelog —", "Revision notes:"
    `^(?:changes(?: made)?|change ?log|edits(?: made)?|revision notes?|notes? to (?:the )?(?:editor|user))\\s*[:\\-–—]`,
    // "Word count: 21"
    `^(?:word count|words)\\s*[:=]\\s*\\d+`,
  ].join("|"),
  "i",
);

/** A sentence that opens with an editing verb. */
const EDIT_START = new RegExp(`^(?:${EDIT_VERBS})\\b`, "i");

/** What an edit was done to, when the model describes its own work. */
const EDIT_OBJECT =
  /\b(?:list|lists|entries|entry|items?|bullets?|points?|headings?|headline|title|wording|text|copy|lines?|words|sections?|slide|notes|labels?|duplicates?)\b/i;

/** Why, in an editor's terms rather than the subject's. */
const EDIT_REASON =
  /\b(?:for (?:clarity|brevity|readability|consistency|flow|concision)|to fit|to stay (?:under|within)|as requested|per (?:the|your) (?:request|instructions?|feedback)|word (?:count|budget|limit)|within (?:the )?(?:word )?(?:budget|limit)|(?:in)?to (?:the )?(?:speaker )?notes)\b/i;

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.replace(/^[\s("'“‘\[]+/, "").trim())
    .filter(Boolean);
}

/**
 * Whether a block of text is the model talking about its edit rather than
 * slide content.
 *
 * Deliberately narrow. An editing verb on its own proves nothing — "Removed
 * import duties on solar panels" and "Cut onboarding time in half" are real
 * bullets. A block is a note only when it is addressed to a slide ("Slide 9:
 * Removed…"), when it is the assistant speaking ("Here is the revised slide",
 * "I've condensed…"), or when every sentence opens with an editing verb and
 * one of them names both what was edited and an editor's reason: "Reordered
 * list for clarity".
 */
export function isMetaCommentary(text: string): boolean {
  const flat = text.replace(/\s+/g, " ").replace(/^[\s("'“‘\[]+/, "").trim();
  if (!flat) return false;
  if (SLIDE_CHANGELOG.test(flat) || ASSISTANT_PREAMBLE.test(flat)) return true;
  const parts = sentences(flat);
  if (parts.length === 0 || !parts.every((s) => EDIT_START.test(s))) return false;
  return parts.some((s) => EDIT_OBJECT.test(s) && EDIT_REASON.test(s));
}

/** "Slide 3: " / "Slide 3 — " at the head of a heading. */
const SLIDE_PREFIX = /^\s*slide\s+\d{1,3}\s*[:.\-–—)]\s+/i;

/** A heading without the outline's "Slide N:" in front of it. */
function withoutSlidePrefix(node: TElement): TElement {
  const first = node.children?.[0];
  if (!first || isElement(first)) return node;
  const text = (first as TText).text ?? "";
  const match = SLIDE_PREFIX.exec(text);
  if (!match) return node;
  const rest = text.slice(match[0].length);
  // "Slide 3: " and nothing after it is not a heading with a prefix.
  if (!/\p{L}/u.test(rest) && node.children.length === 1) return node;
  return {
    ...node,
    children: [{ ...(first as TText), text: rest }, ...node.children.slice(1)],
  };
}

/**
 * Typographic slot names the prompt itself uses ("a kicker above it is a
 * LABEL"), copied onto the slide: "KICKER: LET'S BEGIN". Only jargon that is
 * never content — "Title:" or "Label:" can be.
 */
const SLOT_PREFIX = /^\s*(?:kicker|eyebrow|overline)\s*[:\-–—]\s*/i;

/** A kicker is a short line; longer text that happens to start so is not one. */
const KICKER_WORDS = 6;

/** The slot name off, and a paragraph that was meant as a kicker made one. */
function withoutSlotName(node: TElement): TElement {
  const first = node.children?.[0];
  if (!first || isElement(first)) return node;
  const text = (first as TText).text ?? "";
  const match = SLOT_PREFIX.exec(text);
  if (!match || !/\p{L}/u.test(text.slice(match[0].length))) return node;
  const children = [{ ...(first as TText), text: text.slice(match[0].length) }, ...node.children.slice(1)];
  const words = textOf({ ...node, children }).split(/\s+/).filter(Boolean).length;
  return {
    ...node,
    ...(node.type === "p" && words <= KICKER_WORDS ? { type: "label" } : {}),
    children,
  };
}

/* ---------- the pass ---------- */

/** Two nodes that differ only in their ids are the same content. */
function fingerprint(node: Descendant): string {
  return JSON.stringify(node, (key, value) =>
    key === "id" || key === "generating" ? undefined : value,
  );
}

function inlineOnly(node: TElement): boolean {
  return (node.children ?? []).every((c) => !isElement(c as Descendant));
}

function cleanChildren(
  children: Descendant[],
  options: { items: boolean; dedupe: boolean },
): Descendant[] {
  const out: Descendant[] = [];
  const seen = new Set<string>();
  for (const child of children) {
    if (!isElement(child)) {
      out.push(child);
      continue;
    }
    const type = String(child.type);
    if (isOpaque(type)) {
      out.push(child);
      continue;
    }

    let node: TElement = {
      ...child,
      children: cleanChildren(child.children ?? [], {
        items: ITEM_GROUPS.has(type),
        // Repeats are junk among a group's items. Inside one item they can be
        // deliberate — a comparison side listing "Yes", "Yes", "No".
        dedupe: ITEM_GROUPS.has(type),
      }),
    };

    const prunable = options.items || TEXT_BLOCKS.has(type) || ITEM_GROUPS.has(type);
    if (prunable && !hasContent(node)) continue;
    // Before the "Slide N:" prefix comes off: it is half the evidence.
    if (prunable && inlineOnly(node) && isMetaCommentary(textOf(node))) continue;
    if (HEADINGS.has(type)) node = withoutSlidePrefix(node);
    if (HEADINGS.has(type) || type === "p") node = withoutSlotName(node);

    if (options.dedupe && hasContent(node)) {
      const key = fingerprint(node);
      if (seen.has(key)) continue;
      seen.add(key);
    }
    out.push(node);
  }
  // Among blocks, text that carries nothing — the " · " written between
  // three headings set inline — is a separator, drawn as a line of its own.
  if (out.some((child) => isElement(child))) {
    return out.filter((child) => isElement(child) || hasContent(child));
  }
  return out;
}

/**
 * Clean one slide's content: drop the model's notes about its edits, empty
 * items and the containers they leave empty, and exact repeats among a
 * group's items or the slide's own blocks; take "Slide N:" off headings.
 * Everything else is returned as it came, in the same order.
 */
export function cleanSlideContent<T extends Descendant>(nodes: T[]): T[] {
  return cleanChildren(nodes, { items: false, dedupe: true }) as T[];
}
