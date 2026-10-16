# Vellum — architecture notes and load-bearing constraints

Things that are not obvious from reading the code, and rules that will silently
break the product if violated. Written for whoever (or whatever) picks this up
next.

---

## The generation pipeline

**One streaming LLM call produces an entire deck or document.** Not one call
per slide. This is a deliberate consequence of the hardware: Ollama at a
262144 context runs a single parallel slot (the KV cache is per slot), so
per-slide calls would serialise anyway and lose all cross-slide coherence.

The model emits XML-ish markup (`<PRESENTATION><SECTION>…`) which a ported
`SlideParser` turns into `PlateSlide[]` — the canonical model everything else
reads: editor, present mode, PPTX, PDF, DOCX.

### Parser contract (do not violate)

```
reset() → parseChunk(entire cumulative text) → finalize()      // every tick
```

Feed it the **whole buffer every time**, not the delta. `getAllSlides()`
without a preceding `reset()` accumulates duplicates. Slide ids are
deterministic FNV-1a hashes so they stay stable across re-parses, which is
what lets the editor keep selection and image jobs attached to the right slide.

`tests/parser-streaming.test.ts` locks this: a streamed parse must equal a
single whole-string parse at every chunk boundary, down to 1 byte.

### Layout planning is backward-looking, on purpose

`planDeck` decides slide *i*'s archetype using only slides `0..i`. That is what
makes the streaming preview prefix-stable — a slide that has already rendered
never re-lays-out when later slides arrive. The client and server run the
identical planner, so the preview matches what gets persisted.

`scripts/e2e-create.ts` asserts this against a real generation: zero archetype
flips on settled slides.

### Headings are inline-only

The model regularly leaves a `<TITLE>` or `<H1>` unclosed, or nests the rest
of the slide inside it. XML recovery then makes every following element a
child of the heading, and the heading builders flatten all text descendants
into one run — a whole slide became one display-size title (one measured 90
words, ~3,000px tall). `liftBlocksOutOfHeadings` runs before the section
fingerprint and moves any block content back out as siblings, so the id is
also taken from the clean heading rather than one that grows every tick.

### Void tags self-close

HTML void elements — `<br>`, `<img>`, `<hr>` and the rest — never have content,
so the parser closes them whether or not the model wrote the slash. Without
this, a non-self-closing tag recursed until it found a closing tag that never
comes, and then stopped parsing its parent: `Harsh Tiwari<br>Founding Member…`
lost its second line, and the slide's root `<IMG>` landed inside the paragraph.
`<br>` becomes a space in the text run.

### One word budget

`slideWordBudget` (`src/lib/design/budget.ts`) — the theme family's
`maxWordsPerSlide` scaled by the requested density — is the only budget. The
prompt states it, the generation gate and the QA panel judge by it (with 15%
tolerance). They used to carry four different numbers.

### The quality gate keeps a rewrite only if it is better

Up to five slides with hard faults are rewritten, worst first. The request is
an edit of the slide as it stands with a numeric limit — resending the brief
made the model reproduce the brief's long text. A rewrite replaces the slide
only when it has fewer hard faults, or the same number and fewer words.

### Image slots: newest job wins, and only for a slot that exists

One image per (slide, node). Several jobs can target a slot: the gate keeps a
regenerated slide's id, and a root image's node is always `__root__`. Only the
newest job for a slot may write it (`newestJobPerSlot`), and a root job only
fills a `rootImage` the slide still has — it never creates one. Comparing the
job's prompt to the slot's query would be wrong: the editor's regenerate
action deliberately sends a new prompt. The editor's add-image route creates
the slot when it queues the job.

The planner drops a root image whose prompt an earlier slide used, or that
asks for slide furniture (a chart, diagram, timeline, icon…). It lives in the
planner because the planner is the one function the client preview and the
server share, and the check only looks backwards.

### Never invent a figure

Rule 3 of the writing rules asks for the numbers the request, outline or
research supplies — and forbids inventing one. It used to demand "at least one
specific number" on every content slide, and `no-quantification` was a hard
gate whose rewrite said "add a figure", so slides whose point had no number
came back with made-up percentages. It is now advice only. Its honest
counterpart, `stats-without-figures`, is a hard fault: a STATS block whose
values are mostly zero is a list in the wrong component.

### Slide count is the user's, not the template's

`genParams.nCards` is authoritative everywhere. A template's `sections` array
supplies the *default* count and the narrative arc — never a cap. Enforcement
is symmetric at both stages: the outline tops up (max 2 retries) **and** trims;
the content stage trims surplus sections from the tail. Historically both
layers read `template.sections.length` and silently ignored the user.

**A request that numbers its own slides keeps them.** When it lists three or
more ("Slide 1: …"), `isScriptedRequest` is true, the template's sections
stand aside in both the outline and the content prompt, and only the
template's overall direction applies. A 20-slide lecture brief run through a
9-section template otherwise got the template's arc, lost its own slide 9,
gained two invented ones, and shipped 19.

---

## Rendering geometry

### Never derive height from a measured width

`ScaledSlide` sizes its box with CSS `aspect-ratio: 1280/720`. A
ResizeObserver drives only `transform: scale()` — paint, never layout.

The reason: height-from-width inside an `overflow: auto` container is a closed
loop. Scrollbar appears → element narrows → shortens → content fits →
scrollbar disappears → widens → lengthens → overflows → repeat, forever. It
manifested as "the navigator shakes with exactly 9 slides" (9 was simply the
count whose content height straddled the container at that window size).

Corollary: any scroller holding self-measuring elements needs
`scrollbar-gutter: stable` (`.editor-navlist`, and the `.scroll-stable`
utility for present mode's overview grid).

### A per-slide CSS variable must be declared on the slide

`--presentation-fs-*` are derived from `--v-fs-*` times `--v-fit`. That
derivation is declared on `[data-family], .v-slide` — **both selectors, and
the second one is load-bearing**.

A custom property substitutes its `var()` references on the element that
*declares* it, not on the element where the final value is used. With
`[data-family]` alone, `var(--v-fit, 1)` resolved against the theme wrapper,
where `--v-fit` is never set, so every slide inherited a scale computed at
exactly 1. Autofit wrote `--v-fit` onto the slide and nothing read it: the
factor was computed, published as `data-fit`, consumed by the PPTX exporter
to size its text, and ignored by the browser. Slides clipped at full size
while reporting a fit, and exported text was smaller than rendered text.

Anything else that wants to vary per slide has the same requirement.

### Autofit: type scale, then zoom

`useAutoFit` works in two stages, both one-way — the container is a fixed
1280×720 canvas, so shrinking content cannot change the space available.

1. **Type scale.** `--v-fit` steps down a ladder to 0.65. Text shrinks;
   spacing, icons and padding keep their size.
2. **Zoom.** If that is not enough, every block in `.v-content` gets
   `zoom: var(--v-zoom)`, a continuous factor down to 0.75. Zoom, not
   `transform: scale` — zoom changes layout, so the blocks genuinely take
   less room, whereas an `overflow: hidden` box clips *before* a transform
   could shrink anything. Only the blocks are zoomed, never the box, so
   padding and margins survive.

Below both floors (~49% of the theme size) a slide is too dense to be legible
at any size; it top-aligns so the heading survives, and the generation gate is
what has to stop it being produced.

**The rescue must outrank every layout.** `.v-content--overflow` top-aligns
the box, and it is written at specificity (0,4,0). Cover, Closing and Full
bleed anchor their content to the bottom with `.v-slide[data-archetype="…"]
.v-content` at (0,3,0); while the rescue was a bare class at (0,1,0) it lost
on exactly those layouts, so an overflowing column grew upward, took the
heading off the top, and the slide read as blank. Long words may break only
in this state — breaking them earlier lets them fit without shrinking, so
autofit would never shrink them.

**Measure in layout pixels.** The overrun is the span from the first block's
top to the last block's bottom — not `scrollHeight`, which reports half the
overrun of a centred column. That span comes from `getBoundingClientRect`,
which includes ancestor transforms, so it is divided by the content box's own
visual/layout ratio. The editor (0.11 in the navigator) and present mode
(1.5) render inside a transform; without that division a thumbnail measured
its content at a ninth of its height, settled on fit 1, and cached that for
the canvas. `scripts/fit-audit.ts` checks those paths; the geometry audit
only sees the print route.

**Measure sideways too.** A word wider than the card holding it spills into
the next card or off the slide without making the content taller, so a
height-only check reported "fits" at full size — `₹10,372 Cr` overran its stat
card and "Conversational" ran 30px off the slide on every layout. The overrun
is the larger of the vertical one and the sideways one: anything past the
content box's edges, or wider inside than its own box. SVG is skipped (a
chart's axis labels have no scroll box), as are boxes scrolled on purpose.

**Wait for late content.** Charts draw their SVG after a lazy import and
images take their height on decode. Measuring before them sized a slide
around an empty box; autofit waits (bounded) until neither is pending.

**Content images are capped at half the canvas** (`.v-slide .v-img`), the same
cap the document reader uses. A content image is full width, so uncapped its
height is the width times its aspect: a square generation came out 1152px
tall on a 720px slide and pushed everything else off on every layout. The
root image is untouched — its rail sizes it.

Results are cached per slide, so thumbnails, canvas, present mode and print
always agree. **The cache key is everything the fit depends on**: the text,
the layout (archetype, layout type, whether there is an image rail) and the
theme (its name and faces). With only the text in the key, picking another
layout in the editor reused the fit measured under the previous one, which
is why switching layouts "sometimes" fixed a slide. The print route publishes `data-fit`, `data-zoom` and
`data-fit-settled`; the exporter waits for the last, scales headings and body
by `data-fit` as before, and wraps the slide so **every** native text run is
scaled by `data-zoom` — including the labels, quotes and stats written at
fixed point sizes, which zoom shrinks in the browser too.

### Spacing

`--v-gap-1..5` (8/12/16/24/32 px) times `--v-density`, where density derives
from the family's `whitespace` token: `1 + (whitespace − 0.3) × 0.6`.
Corporate sits at exactly 1.0, which is why legacy decks are pixel-stable.
Never reintroduce literal `gap:` values — they were the source of the
"slightly off" feel.

---

## Export

### The `[data-block-idx]` contract is frozen

Exactly one wrapper element per model node, in model order. Sub-locator
classes (`.v-box`, `.v-stat`, `.v-side`, `.v-item-body`, …) are a public API
that the PPTX exporter measures against. New visual treatments add **modifier**
classes; they never restructure. `scripts/verify-export-contract.ts` checks it.

### pptxgenjs image sizing

`options.w/h` is the image's **uncropped** size; `sizing.w/h` is the **visible
window**. Passing the same box to both makes its `crop` helper emit
`srcRect(0,0,0,0)` — a full stretch. `src/lib/slides/image-fit.ts` computes
cover/contain plus a 9-point focal offset and is shared by the renderer, the
print route and the exporter, so the crop set in the editor is the crop that
ships. `scripts/export-parity.ts` verifies it against the embedded bytes.

### Exports must wait for assets

`networkidle` means the bytes arrived, not that they decoded. `openPrintPage`
waits for every `<img>` to be `complete` with non-zero `naturalWidth`, calls
`decode()`, awaits `document.fonts.ready`, then gives autofit a frame. Skipping
this yields blank image boxes in PDFs.

---

## Storage and deletion

Image files and custom themes are **shared**. Duplicating a document copies the
slides JSON verbatim (same `/api/images/file/…` URLs) and reuses the same
`customThemeId`, without copying `GeneratedImage` rows. Three writers create
files with no DB row at all (upload, the settings image test, brand-logo
extraction).

So "does this document own the file" is unanswerable. The only sound question
is "does anything still reference it", computed by scanning every piece of live
DB text: `Document.slides` ∪ `CustomTheme.data` ∪ `Setting.value` ∪
`GeneratedImage.path`. A 10-minute mtime guard covers the queue's
write-then-record race. See `src/lib/storage/gc.ts`.

`VELLUM_DATA_DIR` overrides the data root — **required** so route tests don't
sweep the real image library.

---

## Platform gotchas (Windows)

- **`.ps1` files must be pure ASCII.** Windows PowerShell 5.1 reads them as
  ANSI unless there's a BOM, so a UTF-8 em dash inside a string is a parse
  error: *"string is missing the terminator"*. Check with
  `[Management.Automation.Language.Parser]::ParseFile`.
- **Never `npm run build` while a dev server runs** — they share `.next`.
  Kill whatever holds port 3210 first.
- CSS `font-family` values containing spaces must be **quoted** inside a custom
  property. `Source Serif 4` unquoted is invalid CSS and the whole declaration
  is dropped, silently falling back to the body face.
- New chart types must be added to `CHART_XML_TYPE_TO_ELEMENT` in
  `slide-parser.ts` or they degrade to bars with no warning.
- `tsx` runs scripts as CJS: top-level `await` fails. Wrap in
  `main().then(…)`.

---

## Verification

Everything below needs the server running (`vellum/scripts/start-vellum.ps1`).

| Command | Checks |
|---|---|
| `npm test` | 267 unit/integration tests |
| `npx tsx scripts/ui-check.ts <deck> <doc>` | 48 screenshots, 2 themes × 4 widths; console errors, overflow, unlabelled controls, hit targets, native dialogs, focus rings, menu reachability |
| `npx tsx scripts/e2e-editor.ts <deck>` | 26 editor interactions on a throwaway copy |
| `npx tsx scripts/e2e-create.ts` | real generation; asserts zero mid-stream re-layouts |
| `npx tsx scripts/e2e-export.ts <deck>` | PDF structure + a real browser download, byte-compared |
| `npx tsx scripts/e2e-template-count.ts pitch-deck 6 10 12` | slide count honours the request |
| `npx tsx scripts/nav-stability.ts <deck>` | navigator geometry at the 8/9/10 boundary |
| `npx tsx scripts/geometry-audit.ts <doc...>` | per slide on the print route: clipped content, blocks escaping the canvas, overlapping blocks |
| `npx tsx scripts/fit-audit.ts <doc> editor\|present` | autofit inside transformed render paths: scale, fit, zoom, true overrun |
| `npx tsx scripts/layout-audit.ts <doc>` | every slide in every layout the picker offers for it: clipping, sideways overflow, text off the slide, heading visible (works on throwaway copies) |
| `npx tsx scripts/layout-switch-e2e.ts <deck> [9,10,20]` | clicks every layout tile twice in the live editor and measures the canvas after each switch (`VERBOSE=1` prints every fit) |
| `npx tsx scripts/regenerate.ts <doc> [theme]` | re-runs a past generation like for like (creates a new document) |
| `npx tsx scripts/export-parity.ts <deck>` | no stretched images in the PPTX |
| `npx tsx scripts/verify-export-contract.ts <deck>` | `[data-block-idx]` intact |
| `npx tsx scripts/gc-orphans.ts` | orphaned assets (dry run by default) |

---

## Known limitations

- PPTX line-breaks differ from the browser (PowerPoint has its own text
  engine). Box geometry and font sizes match; wrap parity is out of scope.
- Native (editable) PPTX charts drop premium annotations; annotated charts are
  still routed through `addChart` rather than the 192-DPI screenshot path.
- Regenerating a slide resets its image fit/focal choice.
- `allowedSplits`, `maxItemsPerRow` and `maxItems` are declared per family and
  still unconsumed — wiring them needs planner changes, not CSS.
