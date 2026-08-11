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

### Slide count is the user's, not the template's

`genParams.nCards` is authoritative everywhere. A template's `sections` array
supplies the *default* count and the narrative arc — never a cap. Enforcement
is symmetric at both stages: the outline tops up (max 2 retries) **and** trims;
the content stage trims surplus sections from the tail. Historically both
layers read `template.sections.length` and silently ignored the user.

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

### Text autofit is one-way

`useAutoFit` multiplies **only the type scale** (`--presentation-fs-*` derive
from raw `--v-fs-*` times `--v-fit`). Smaller text cannot change its
container, so there is no feedback loop. Results are cached per slide, which
both avoids a hundred dashboard thumbnails each running a measuring pass and
guarantees a thumbnail can never disagree with the full canvas. The print
route runs the identical path, and `pptx.ts` reads the resulting `data-fit`
attribute to scale its point sizes — without that, exported text would exceed
boxes measured around shrunken text.

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
| `npm test` | 187 unit/integration tests |
| `npx tsx scripts/ui-check.ts <deck> <doc>` | 48 screenshots, 2 themes × 4 widths; console errors, overflow, unlabelled controls, hit targets, native dialogs, focus rings, menu reachability |
| `npx tsx scripts/e2e-editor.ts <deck>` | 26 editor interactions on a throwaway copy |
| `npx tsx scripts/e2e-create.ts` | real generation; asserts zero mid-stream re-layouts |
| `npx tsx scripts/e2e-export.ts <deck>` | PDF structure + a real browser download, byte-compared |
| `npx tsx scripts/e2e-template-count.ts pitch-deck 6 10 12` | slide count honours the request |
| `npx tsx scripts/nav-stability.ts <deck>` | navigator geometry at the 8/9/10 boundary |
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
