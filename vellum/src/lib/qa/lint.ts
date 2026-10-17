/**
 * Deterministic quality lint over generated slides. Pure + unit-testable.
 */
import type { PlateSlide } from "@/lib/generation/parser/slide-parser";
import type { Descendant, TElement, TText } from "@/lib/slides/plate-shim";
import {
  columnLanes,
  contentItems,
  leadHeadingIndex,
  walkNodes,
} from "@/lib/slides/walk";
import { parseOutlineMarkdown } from "@/lib/generation/prompts/outline";
import { SUPPORTED_CHART_TYPES } from "@/lib/charts/build-option";
import { isSignOff, signatureOf } from "@/lib/design/archetypes";
import { CONTENT_FLOOR } from "@/lib/design/budget";

export interface QaIssue {
  slideId: string | null;
  severity: "minor" | "major";
  code: string;
  issue: string;
  suggestion: string;
}

function isText(n: Descendant): n is TText {
  return typeof (n as TText).text === "string" && !(n as TElement).type;
}
function textOf(nodes: Descendant[] | undefined): string {
  if (!nodes) return "";
  return nodes
    .map((n) => (isText(n) ? n.text : textOf((n as TElement).children)))
    .join("");
}
/** The slide's title, as the renderer marks it (see leadHeadingIndex). */
function headingOf(slide: PlateSlide): string {
  const lead = slide.content[leadHeadingIndex(slide.content)] as TElement | undefined;
  return lead ? textOf(lead.children as Descendant[]).trim() : "";
}
const GROUPS = new Set([
  "bullets", "icons", "boxes", "steps", "timeline", "cycle", "pyramid",
  "staircase", "compare", "before-after", "pros-cons", "stats",
  "arrow-vertical", "arrows",
]);

// ---- content-excellence regexes (research-backed; see plan W5) ----
const VERB_CUE =
  /\b(?:is|are|was|were|has|have|had|will|can|must|should|does|do|grew|grow(?:s|ing)?|fell|fall(?:s|ing)?|rose|rise(?:s|n)?|drop(?:s|ped|ping)?|lead(?:s)?|drive(?:s|n)?|deliver(?:s|ed)?|reduce[sd]?|increase[sd]?|cut(?:s)?|beat(?:s)?|exceed(?:s|ed)?|outperform(?:s|ed)?|lag(?:s|ged)?|remain(?:s|ed)?|shift(?:s|ed)?|expand(?:s|ed)?|add(?:s|ed)?|gain(?:s|ed)?|lose[sd]?|lost|need(?:s)?|require[sd]?|cost(?:s)?|save[sd]?|win(?:s)?|won|double[sd]?|tripled?|hit(?:s)?|miss(?:es|ed)?|launch(?:es|ed)?|ship(?:s|ped)?|make(?:s)?|made|turn(?:s|ed)?|prove[sd]?|show(?:s|ed)?|mean(?:s)?|now|still|already|only|why|how|what)\b/i;

const HEDGE =
  /\b(?:might|may|could|perhaps|possibly|potentially|arguably|seemingly|somewhat|fairly|relatively|generally|typically|tends?\s+to|appears?\s+to|seems?\s+to|more\s+or\s+less|to\s+some\s+extent)\b/i;

const BUZZ =
  /\b(?:leverag(?:e|es|ed|ing)|synerg\w+|holistic|seamless(?:ly)?|world[-\s]class|best[-\s]in[-\s]class|cutting[-\s]edge|state[-\s]of[-\s]the[-\s]art|paradigm\s+shift|game[-\s]?chang\w+|unlock\w*\s+value|empower(?:s|ed|ing)?|revolutioniz\w+|move\s+the\s+needle|low[-\s]hanging\s+fruit|circle\s+back|deep\s+dive)\b/i;

const VAGUE =
  /\b(?:significant(?:ly)?|substantial(?:ly)?|considerable|dramatic(?:ally)?|massive|numerous|various|a\s+number\s+of|a\s+variety\s+of|a\s+lot\s+of)\b/i;

const WEAK_OPEN =
  /^(?:there\s+(?:is|are|was|were)|it\s+is|this\s+is|these\s+are|we\s+(?:believe|think|feel)|in\s+order\s+to)\b/i;

/** Breath archetypes are exempt from quantification demands. */
const BREATH_ARCHETYPES = new Set([
  "hero", "divider", "statement", "quote-full", "full-bleed", "closing",
  "testimonial", "team-grid", "agenda",
]);

/**
 * Blocks that carry a slide with few words: figures, data, diagrams,
 * sequences, cards and pictures draw shapes across the canvas. Headings,
 * paragraphs, bullet lists, callouts and quotes are text, and text alone is
 * what leaves a short slide looking empty.
 */
const CARRIES_SLIDE = new Set([
  "icons", "boxes", "steps", "timeline", "cycle", "pyramid", "staircase",
  "compare", "before-after", "pros-cons", "stats", "arrow-vertical", "arrows",
  "snake", "circular-grid", "connected-circles", "slope", "table",
  "code_block", "antv-infographic", "funnel-flow", "kpi-row",
  "progress-rings", "pictogram", "harvey-table", "matrix", "org-chart",
  "journey", "venn", "iceberg", "flow-diagram",
]);

/**
 * Whether something besides text carries the slide. A root picture counts
 * once it has rendered; while the deck is being generated it is only the
 * writer's request, which the picture step may turn down.
 */
function carriesSlide(slide: PlateSlide): boolean {
  if ((slide.rootImage as { url?: string } | undefined)?.url) return true;
  let carried = false;
  walkNodes(slide.content as Descendant[], (node) => {
    const type = String(node.type);
    if (CARRIES_SLIDE.has(type) || type.startsWith("chart-")) carried = true;
    if (type === "img" && (node.url || node.query)) carried = true;
  });
  return carried;
}

function tokenSet(text: string): Set<string> {
  return new Set(text.toLowerCase().match(/\b\w{4,}\b/g) ?? []);
}
function overlapRatio(a: string, b: string): number {
  const ta = tokenSet(a);
  const tb = tokenSet(b);
  if (ta.size === 0) return 0;
  let hit = 0;
  for (const t of ta) if (tb.has(t)) hit++;
  return hit / ta.size;
}

export interface LintOptions {
  /** Word budget per deck slide (token-driven); default matches the prompt's
   *  hard ceiling. */
  maxWordsPerSlide?: number;
  /** Fewest words a content slide may carry; CONTENT_FLOOR by default. */
  minWordsPerSlide?: number;
  /** Size of the citation registry (0 = research off ⇒ citation lints skip). */
  sourceCount?: number;
}

export function lintSlides(
  slides: PlateSlide[],
  outline: string | null,
  kind: "deck" | "doc",
  options?: LintOptions,
): QaIssue[] {
  const issues: QaIssue[] = [];
  const seenHeadings = new Map<string, string>();
  const maxWords = options?.maxWordsPerSlide ?? 90;
  const minWords = options?.minWordsPerSlide ?? CONTENT_FLOOR;
  const sourceCount = options?.sourceCount ?? 0;

  slides.forEach((slide, index) => {
    const label = `${kind === "doc" ? "Section" : "Slide"} ${index + 1}`;
    const allText = textOf(slide.content).trim();
    const heading = headingOf(slide);

    if (allText.length < 20) {
      issues.push({
        slideId: slide.id, severity: "major", code: "empty",
        issue: `${label} is empty or nearly empty.`,
        suggestion: "Regenerate this slide with substantive content.",
      });
      return;
    }
    if (!heading) {
      issues.push({
        slideId: slide.id, severity: "minor", code: "no-heading",
        issue: `${label} has no heading.`,
        suggestion: "Add a clear headline that states the slide's takeaway.",
      });
    }
    const headingKey = heading.toLowerCase();
    if (heading && seenHeadings.has(headingKey)) {
      issues.push({
        slideId: slide.id, severity: "minor", code: "dup-heading",
        issue: `${label} repeats the heading "${heading}".`,
        suggestion: "Give this slide a distinct headline.",
      });
    } else if (heading) {
      seenHeadings.set(headingKey, slide.id);
    }
    const wordCount = allText.split(/\s+/).filter(Boolean).length;
    if (kind === "deck" && wordCount > maxWords) {
      issues.push({
        slideId: slide.id, severity: wordCount > maxWords * 1.6 ? "major" : "minor",
        code: "overflow-risk",
        issue: `${label} carries ~${wordCount} words (budget ${maxWords}) — likely overflows.`,
        suggestion: "Tighten the copy or split this slide into two.",
      });
    }

    // ---- content excellence (decks only) ----
    const archetype = slide.archetype ?? "content";
    const isBreath = BREATH_ARCHETYPES.has(archetype);
    if (kind === "deck" && heading && !isBreath) {
      const headingWords = heading.split(/\s+/).filter(Boolean).length;
      if (
        !VERB_CUE.test(heading) &&
        !/\d/.test(heading) &&
        headingWords <= 6
      ) {
        issues.push({
          slideId: slide.id, severity: "major", code: "topic-heading",
          issue: `${label}: heading "${heading}" names a topic instead of stating the takeaway.`,
          suggestion: 'Rewrite as a full-sentence claim, e.g. "Churn fell to 2.1% after the SSO launch".',
        });
      }
      if (headingWords > 15) {
        issues.push({
          slideId: slide.id, severity: "minor", code: "heading-too-long",
          issue: `${label}: heading runs ${headingWords} words.`,
          suggestion: "Cut the heading to one line (≤15 words).",
        });
      }
    }
    // Advisory, not a fault. This was a MAJOR issue and a hard gate, and the
    // gate's rewrite said "add at least one specific figure" — so a slide
    // whose point had no number (six examples of AI in daily life) came back
    // carrying invented ones: 85%, 92%, 70% and 65%, none of them in the
    // brief. Prompting for evidence is good; manufacturing it is the worst
    // thing a deck can do, so this now only suggests, and only real figures.
    if (kind === "deck" && !isBreath && allText.length >= 40 && !/\d/.test(allText)) {
      issues.push({
        slideId: slide.id, severity: "minor", code: "no-quantification",
        issue: `${label} contains no numbers.`,
        suggestion:
          "If the source has a figure for this point, use it; never invent one.",
      });
    }
    if (kind === "deck") {
      if (BUZZ.test(allText)) {
        issues.push({
          slideId: slide.id, severity: "minor", code: "buzzword",
          issue: `${label} uses buzzword language ("${allText.match(BUZZ)?.[0]}").`,
          suggestion: "Replace with the concrete claim the buzzword is hiding.",
        });
      }
      if (HEDGE.test(heading)) {
        issues.push({
          slideId: slide.id, severity: "minor", code: "hedging",
          issue: `${label}: the heading hedges ("${heading.match(HEDGE)?.[0]}").`,
          suggestion: "State it or cut it — hedged headlines persuade no one.",
        });
      }
      for (const sentence of allText.split(/(?<=[.!?])\s+/)) {
        if (VAGUE.test(sentence) && !/\d/.test(sentence)) {
          issues.push({
            slideId: slide.id, severity: "minor", code: "vague-quantifier",
            issue: `${label}: "${sentence.match(VAGUE)?.[0]}" with no number in the sentence.`,
            suggestion: "Quantify the claim or drop the intensifier.",
          });
          break; // one per slide is enough signal
        }
      }
    }

    let firstItemText = "";
    walkNodes(slide.content as Descendant[], (node) => {
      const type = String(node.type);
      if (GROUPS.has(type)) {
        // Judged on what renders: the renderer leaves out an item with
        // nothing in it, so an empty one is reported, not counted.
        const items = contentItems(node);
        const emptyItems =
          (node.children ?? []).filter((c) => !isText(c)).length - items.length;
        if (emptyItems > 0) {
          issues.push({
            slideId: slide.id, severity: "minor", code: "empty-item",
            issue: `${label}: ${emptyItems} ${type} item${emptyItems === 1 ? " has" : "s have"} no text.`,
            suggestion: "Regenerate the slide, or give each item its text.",
          });
        }
        if (items.length === 1 && !["stats", "bullets"].includes(type)) {
          issues.push({
            slideId: slide.id, severity: "minor", code: "single-item-group",
            issue: `${label}: a ${type} layout has only one item.`,
            suggestion: `Use at least two items in the ${type} layout, or switch to plain text.`,
          });
        }
        if (items.length > 6) {
          issues.push({
            slideId: slide.id, severity: "minor", code: "too-many-items",
            issue: `${label}: a ${type} layout carries ${items.length} items.`,
            suggestion: "Cap groups at 5-6 items; split or consolidate the rest.",
          });
        }
        // Parallelism: same grammatical shape, similar length across items.
        if (kind === "deck" && items.length >= 3 && type !== "stats") {
          const heads = items
            .map((item) => {
              const el = item as TElement;
              const h = (el.children ?? []).find(
                (c) => !isText(c) && /^h[1-6]$/.test(String((c as TElement).type)),
              ) as TElement | undefined;
              return h ? textOf(h.children).trim() : "";
            })
            .filter((h) => h.length > 0);
          if (heads.length >= 3) {
            const gerunds = heads.map((h) => /^\w+ing\b/i.test(h));
            const lengths = heads.map((h) => h.split(/\s+/).length);
            const mixedForm = new Set(gerunds).size > 1;
            const skewed =
              Math.max(...lengths) > Math.min(...lengths) * 3;
            if (mixedForm || skewed) {
              issues.push({
                slideId: slide.id, severity: "minor", code: "non-parallel",
                issue: `${label}: items in the ${type} group are not parallel (${mixedForm ? "mixed grammatical forms" : "3x length skew"}).`,
                suggestion: "Give every item the same grammatical shape and similar length.",
              });
            }
          }
        }
        if (!firstItemText && items.length > 0) {
          firstItemText = textOf([(items[0] as TElement)] as Descendant[]).trim();
        }
        // Weak openers on item text.
        if (kind === "deck") {
          for (const item of items) {
            const text = textOf([item as TElement] as Descendant[]).trim();
            if (WEAK_OPEN.test(text)) {
              issues.push({
                slideId: slide.id, severity: "minor", code: "weak-opener",
                issue: `${label}: an item opens weakly ("${text.slice(0, 40)}…").`,
                suggestion: "Lead with the subject or verb — cut the empty opener.",
              });
              break;
            }
          }
        }
      }
      // Column fan-out is a structural fault, not a style preference. The
      // renderer caps the grid so the slide stays readable, but a model
      // emitting eight lanes has misread the layout — that content is almost
      // always a flat list wearing a column group as a disguise.
      if (type === "column_group") {
        const lanes = columnLanes(node).length;
        if (lanes > 3) {
          issues.push({
            slideId: slide.id, severity: "major", code: "too-many-columns",
            issue: `${label}: a COLUMNS group has ${lanes} lanes.`,
            suggestion:
              "Use 2-3 lanes. A longer list belongs in one BULLETS or BOXES group, not a lane each.",
          });
        }
        const empties =
          (node.children ?? []).filter((c) => !isText(c)).length - lanes;
        if (empties > 0) {
          issues.push({
            slideId: slide.id, severity: "minor", code: "empty-column",
            issue: `${label}: a COLUMNS group has ${empties} empty lane${empties === 1 ? "" : "s"}.`,
            suggestion: "Remove empty <DIV> lanes rather than leaving them blank.",
          });
        }
      }
      if (type === "stats") {
        const statItems = (node.children ?? []).filter((c) => !isText(c));
        // A STATS group whose values are mostly zero or missing is a list
        // wearing the wrong component. A real deck put six industries into
        // STATS — "2 Nobel Prizes", then "0 Banking & Finance", "0
        // Healthcare"… — because the model needed a value for each and had
        // none. It reads as a dashboard reporting zero.
        const empty = statItems.filter((item) =>
          /^\s*[-+]?0*(?:[.,]0+)?\s*%?\s*$/.test(String((item as TElement).stat ?? "")),
        ).length;
        if (statItems.length >= 2 && empty * 2 >= statItems.length) {
          issues.push({
            slideId: slide.id, severity: "major", code: "stats-without-figures",
            issue: `${label}: ${empty} of ${statItems.length} STATS values are zero or missing.`,
            suggestion:
              "STATS is for real figures. Put these items in BULLETS, BOXES or ICONS, and keep only values the source gives.",
          });
        }
        for (const item of statItems) {
          const stat = String((item as TElement).stat ?? "");
          // \p{Sc} is any currency symbol: the old [$€£] flagged "₹10,372 Cr".
          if (stat && !/^[~≈]?\p{Sc}?\s*[-+]?\d/u.test(stat) && !/^\d/.test(stat)) {
            issues.push({
              slideId: slide.id, severity: "minor", code: "stat-not-numeric",
              issue: `${label}: STATS value "${stat}" is not a number.`,
              suggestion: "STATS values must lead with a figure; move prose into the caption.",
            });
            break;
          }
        }
      }
      if (type.startsWith("chart-")) {
        if (!SUPPORTED_CHART_TYPES.has(type)) {
          issues.push({
            slideId: slide.id, severity: "minor", code: "chart-degraded",
            issue: `${label}: chart type "${type.replace("chart-", "")}" has no dedicated rendering and falls back to bars.`,
            suggestion: "Switch to a supported chart type (bar, line, waterfall, treemap, sankey…) for a purpose-built figure.",
          });
        }
        const rows = Array.isArray(node.data)
          ? (node.data as Array<Record<string, unknown>>)
          : [];
        const numericOk =
          rows.length >= 2 &&
          rows.every((r) =>
            Object.values(r).some((v) => Number.isFinite(parseFloat(String(v)))),
          );
        if (!numericOk) {
          issues.push({
            slideId: slide.id, severity: "major", code: "bad-chart-data",
            issue: `${label}: chart has missing or non-numeric data.`,
            suggestion: "Regenerate with a real data table inside the CHART element.",
          });
        }
      }
      // Citation refs must land inside the registry.
      if (sourceCount > 0 && node.source !== undefined) {
        const ref = parseInt(String(node.source), 10);
        if (!Number.isInteger(ref) || ref < 1 || ref > sourceCount) {
          issues.push({
            slideId: slide.id, severity: "minor", code: "dangling-ref",
            issue: `${label}: citation source="${String(node.source)}" is outside the reference list (1-${sourceCount}).`,
            suggestion: "Cite an existing reference number or drop the attribute.",
          });
        }
      }
      if (type === "img") {
        const url = typeof node.url === "string" ? node.url : "";
        const query = typeof node.query === "string" ? node.query : "";
        if (!url && query) {
          issues.push({
            slideId: slide.id, severity: "minor", code: "image-pending",
            issue: `${label}: an image has not been generated yet.`,
            suggestion: "Wait for the image queue or retry failed images.",
          });
        }
      }
    });
    const root = slide.rootImage as { url?: string; query?: string } | undefined;
    if (root?.query && !root.url) {
      issues.push({
        slideId: slide.id, severity: "minor", code: "image-pending",
        issue: `${label}: the main image has not been generated yet.`,
        suggestion: "Wait for the image queue or retry failed images.",
      });
    }

    // The same label printed more than once on one slide.
    //
    // A deck generated from a design brief that described both labelled
    // diagram rings and a definition list came back with "Machine Learning",
    // "Deep Learning" and "Gen AI" each rendered three times on one slide:
    // once as a column heading, once as a ring label, once opening its
    // paragraph. Nothing flagged it, because every existing duplicate check
    // compares ACROSS slides.
    //
    // Short paragraphs and labels count too: a model reproducing "four
    // nested circles" from a brief emitted each ring's caption as its own
    // paragraph, right beside a bold paragraph opening the definition — the
    // same label twice, neither of them a heading.
    const headingCounts = new Map<string, number>();
    walkNodes(slide.content as Descendant[], (node) => {
      const type = String(node.type);
      const isHeading = /^h[1-6]$/.test(type);
      if (!isHeading && type !== "p" && type !== "label") return;
      const text = textOf(node.children as Descendant[])
        .trim()
        .toLowerCase()
        .replace(/[\s:.,;!?]+$/, "");
      const words = text.split(/\s+/).filter(Boolean).length;
      // Single words repeat legitimately (table headers, yes/no); a repeated
      // multi-word label is the model saying the same thing twice. Longer
      // paragraphs are left out: two sentences that share an opening are not
      // a duplicated label.
      if (words < 2 || (!isHeading && words > 6)) return;
      headingCounts.set(text, (headingCounts.get(text) ?? 0) + 1);
    });
    const repeated = [...headingCounts.entries()].filter(([, n]) => n > 1);
    if (kind === "deck" && repeated.length > 0) {
      const [worstText, worstCount] = repeated.sort((a, b) => b[1] - a[1])[0];
      issues.push({
        slideId: slide.id,
        severity: "major",
        code: "repeated-heading",
        issue: `${label}: "${worstText.slice(0, 40)}" appears ${worstCount} times on one slide${repeated.length > 1 ? ` (and ${repeated.length - 1} other repeat${repeated.length > 2 ? "s" : ""})` : ""}.`,
        suggestion:
          "Say each label once. Keep the definition or the diagram caption, not both.",
      });
    }

    // Redundancy: the first item restating the heading (Mayer).
    if (
      kind === "deck" &&
      heading &&
      firstItemText &&
      overlapRatio(heading, firstItemText) > 0.6
    ) {
      issues.push({
        slideId: slide.id, severity: "minor", code: "heading-echo",
        issue: `${label}: the first item restates the heading.`,
        suggestion: "Cut the echo — the first item should advance the claim, not repeat it.",
      });
    }
    const note = slide.speakerNote?.trim() ?? "";
    if (kind === "deck" && note.length > 40 && overlapRatio(note, allText) > 0.6) {
      issues.push({
        slideId: slide.id, severity: "minor", code: "notes-echo",
        issue: `${label}: speaker notes duplicate the slide text.`,
        suggestion: "Notes should carry the spoken argument and caveats, not repeat the slide.",
      });
    }

    // Too little: a heading and a line, or a few bare labels, on a layout
    // built for a claim and its evidence. Only overflow was ever checked, so
    // a minimal keynote shipped 14 slides of 5-15 words — one-word bullets
    // ("Autocomplete", "Copilot", "Agent") with the explanation left in the
    // speaker notes. Last of this slide's checks on purpose: the quality gate
    // rewrites a slide for the last hard issue it reports, and the rewrite
    // for this one also asks for a full-sentence heading.
    const words = signatureOf(slide).wordCount;
    if (
      kind === "deck" &&
      !BREATH_ARCHETYPES.has(archetype) &&
      !isSignOff(heading) &&
      words < minWords &&
      !carriesSlide(slide)
    ) {
      issues.push({
        slideId: slide.id, severity: "major", code: "sparse-slide",
        issue: `${label} carries ${words} words — a heading and a line on a slide built for more (at least ${minWords}).`,
        suggestion:
          "Give each point a few words of explanation or an example from the speaker notes or the outline, or use a component that carries the idea — STEPS for a sequence, BOXES or ICONS for parallel ideas. Never invent facts or figures.",
      });
    }
  });

  // Design rhythm (deck-level, archetype-driven).
  if (kind === "deck" && slides.length >= 4) {
    const archetypes = slides.map((s) => s.archetype ?? "content");
    for (let i = 1; i < archetypes.length; i++) {
      if (
        archetypes[i] !== "content" &&
        archetypes[i] === archetypes[i - 1] &&
        !archetypes[i].startsWith("legacy")
      ) {
        issues.push({
          slideId: slides[i].id, severity: "minor", code: "archetype-repeat",
          issue: `Slides ${i} and ${i + 1} use the same "${archetypes[i]}" composition back to back.`,
          suggestion: "Vary the layout — regenerate one of them or change its structure.",
        });
      }
    }
    const BREATH = new Set(["hero", "divider", "statement", "quote-full", "full-bleed", "closing"]);
    let run = 0;
    let flagged = false;
    for (const a of archetypes) {
      run = BREATH.has(a) ? 0 : run + 1;
      if (run >= 6 && !flagged) {
        flagged = true;
        issues.push({
          slideId: null, severity: "minor", code: "no-breath-run",
          issue: "Six or more consecutive dense slides with no visual pause.",
          suggestion: "Add a section divider, statement, or full-bleed image slide to reset attention.",
        });
      }
    }
    if (
      slides.length >= 6 &&
      archetypes.every((a) => a === "content" || a.startsWith("legacy"))
    ) {
      issues.push({
        slideId: null, severity: "minor", code: "flat-hierarchy",
        issue: "Every slide uses the same standard composition — the deck reads flat.",
        suggestion: "Regenerate with stronger structure: a hero opener, section dividers, and a statement slide.",
      });
    }
  }

  // Outline coverage — fuzzy word-overlap of the whole card (heading +
  // bullets) against full slide text. Slides legitimately rewrite outline
  // headings (templates encourage it), so heading-vs-heading is too strict.
  if (outline) {
    const { cards } = parseOutlineMarkdown(outline);
    const slideTexts = slides.map((s) =>
      `${headingOf(s)} ${textOf(s.content)}`.toLowerCase(),
    );
    for (const card of cards) {
      const cardHeading = (card.split("\n")[0] ?? "").replace(/^##\s+/, "").trim();
      const words = [
        ...new Set(card.toLowerCase().split(/\W+/).filter((w) => w.length > 4)),
      ].slice(0, 24);
      if (words.length < 2) continue;
      const needed = Math.max(2, Math.ceil(words.length / 4));
      const covered = slideTexts.some(
        (t) => words.filter((w) => t.includes(w)).length >= needed,
      );
      if (!covered) {
        issues.push({
          slideId: null, severity: "minor", code: "outline-gap",
          issue: `Planned section "${cardHeading}" has no clearly matching slide.`,
          suggestion: "Verify the deck covers this outline point, or regenerate.",
        });
      }
    }
  }
  return issues;
}
