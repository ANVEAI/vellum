# Vellum P6 — Production hardening report

Three reported issues, each treated as an entry point into the underlying class
of bug. All findings below were reproduced and measured, not inferred.

---

## 1. Root causes

### 1.1 Navigator "shakes at exactly 9 slides" — a width↔height feedback loop

`ScaledSlide` derived its container's **pixel height from a JS-measured width**
(`ResizeObserver → setScale → height: 720 × scale`), and `.editor-navlist` is
`overflow-y: auto` with no `scrollbar-gutter`. Inside a scroll container, width
depends on whether a scrollbar is showing — so the two chased each other:

> scrollbar appears → thumbnails narrow → shorter → content fits → scrollbar
> disappears → wider → taller → overflows → scrollbar appears → …

The loop runs whenever the container height falls between the with- and
without-scrollbar content heights. At `--w-navigator: 196px`, a thumbnail is
87.19px tall without a scrollbar and ~81px with one, so nine of them straddle
the available height at a maximised 1080p window (innerHeight ≈ 920–950).
Eight and ten sit outside that band. **The "9" was a property of the window
size, not the slide count** — at viewport widths ≤1280px the same bug appears
at 11 slides, and below 1024px it cannot happen at all because the filmstrip
gives items a fixed 116px width.

Measured on this machine, Chromium suppressed the oscillation
("ResizeObserver loop completed with undelivered notifications") and froze
**inconsistent** geometry instead: frames 117px wide with 71.44px heights (the
height for a 127px frame), and the 1280px slide surface painting at 127px
inside a 117px box — **the right edge of every thumbnail clipped by 10px**,
stable across 379 samples over 19s.

Contributing factors found in the same area: `.v-slide` carried
`transition: all 0.2s`, easing every geometry change across nine thumbnails at
once; the asset poll allocated a new `Map` every 2s and the reviewer poll
replaced the slides array every 3s while idle; `customThemeData` was re-parsed
into a new object on every render, invalidating every `ThemeScope` memo below
it; and `.editor-shell` had a hard `calc(100vh − 82px)` height, so an error
banner above it pushed the status bar off an `overflow-hidden` page.

### 1.2 "Cannot delete a presentation" — the card menu was clipped to one item

Delete *existed* (card ⋯ menu → confirm dialog → DELETE → toast), but the
shared `Popover` rendered its menu **absolutely inside the trigger's DOM**.
Dashboard cards are `overflow: hidden` (they clip thumbnail corners), and the
menu opens from the card's bottom row.

Measured before the fix: **the menu extended 252px past the card edge and
exactly 1 of 8 items was hittable** — on every card, at every scroll position.
The user's "it just shows Open" was literally accurate. Rename, all three
Export formats and Delete had been unreachable since the P5 redesign.

Deletion also left everything on disk: no code path anywhere in `src/` called
`unlink`. Complicating any cleanup, **assets are shared** — duplicating a
document copies the slides JSON verbatim (same `/api/images/file/…` URLs) and
reuses the same `customThemeId`, without copying `GeneratedImage` rows — and
three writers create files with **no DB row at all** (upload, the settings
image test, brand-logo extraction). Separately, every export wrote a
server-side copy keyed by *title*, which nothing ever read.

### 1.3 Image fidelity — five systemic defects

1. **Every PPTX image was stretched, never cropped.** The exporter passed the
   placement box as *both* `options.w/h` and `sizing.w/h`. Reading pptxgenjs's
   own source confirms `options.w/h` is the image's uncropped size and
   `sizing.w/h` the visible window; identical values make its `crop` helper
   emit `<a:srcRect l="0" r="0" t="0" b="0"/>` — a pure stretch. Worst cases:
   1.76× horizontal on a vertical band, 2.5× vertical for a 16:9 shot in a
   portrait rail. (DOCX did the math correctly — the in-repo counter-example.)
2. **Wrong shapes for slots.** `accepts("full-bleed")` didn't require the
   background layout, so 16:9 images landed in ~40% rails losing 60% of their
   width; the `wide` shape (1536×640, 2.4:1) never fits a vertical band
   (4.2–5.1:1), discarding 43–53% of every such image; Pexels always requested
   landscape; Gemini got no aspect hint at all.
3. **Hero images generated at exactly 1280×720** — the slide's own size — so
   fullscreen presentation on a 1080p display upscaled them 1.5×, and PDF/PPTX
   placed them at 96 DPI.
4. **Silent export drops:** a background image's 25% wash exported at full
   strength; **citation footnotes were never rendered in the print route**, so
   they were missing from PDF *and* PPTX (and the visual-check probe for them
   always reported false).
5. **No spacing system.** `--presentation-unit` was emitted and consumed by
   nothing; the citation band and brand logo hardcoded 64px/56px insets that
   four archetypes contradict; the split ratio was defined in three places;
   phase-cards reserved a fixed 44px for a numeral sized from `fs-h2` (53px on
   the `bold` family); `metric-bubbles` used fixed 210px cells with no wrap;
   `alignClass` set `align-self`, shrinking centred paragraphs so they wrapped
   differently from their siblings.

**Explicitly not a problem** (checked, ruled out): ECharts uses the SVG
renderer, so charts are vector at every zoom, in present mode and in PDF —
there is no canvas/DPR blur. Fonts are 166 self-hosted woff2 and the export
browser awaits `document.fonts.ready`.

---

## 2. Changes

**Geometry (`slide-frame.tsx`, `editor.css`, `globals.css`, `slides.css`)**
`ScaledSlide` now takes its height from CSS `aspect-ratio: 1280/720` and never
writes a JS height; the ResizeObserver only drives `transform: scale()`, reads
`contentRect.width`, quantises to ~device pixels and skips no-op updates.
`.editor-navlist` gets `scrollbar-gutter: stable` (plus a `.scroll-stable`
utility applied to the present-mode overview, which had the same latent loop).
`.editor-shell` became `flex: 1 1 0; min-height: 0`. `.v-slide`'s
`transition: all` is scoped to `background-color, color`. Editor churn: the
asset-poll Map keeps its identity when unchanged, and `customThemeData` is
memoised on the raw JSON. Dashboard cards get `content-visibility: auto`.

**Deletion (`primitives.tsx`, `library.tsx`, `documents/[id]/route.ts`, new
`lib/storage/{paths,gc}.ts`, new `scripts/gc-orphans.ts`, `export` route,
editor + present pages)**
`Popover` now portals to `<body>` as `position: fixed`, computes placement from
the trigger rect, flips above when there is more room there, clamps to the
viewport, repositions on resize, closes on scroll, and uses `pointerdown` for
outside-close (fixing touch). Every consumer inherits it. Delete/Duplicate gain
busy guards; deletion is optimistic with rollback and treats 404 as success.
`DELETE` now runs a best-effort GC that can never fail the delete: orphaned
themes via one relation sweep, then image files not referenced by **any**
live DB text (`Document.slides` ∪ `CustomTheme.data` ∪ `Setting.value` ∪
`GeneratedImage.path`) with a 10-minute mtime guard against the queue's
write-then-record race. `VELLUM_DATA_DIR` makes the data root overridable so
tests cannot touch the real library. The export route no longer persists
server-side copies. The editor stops autosaving and shows its not-found screen
on a 404 instead of offering "Retry" forever; present mode gained a
`loading|ready|gone` state instead of an eternal "Loading…". "Delete this
presentation…" was added to the editor's ⌘K palette.

**Images (`pptx.ts`, new `lib/slides/image-fit.ts`, `slide-frame.tsx`,
`print-view.tsx`, `archetypes.ts`, `asset-queue.ts`, `provider.ts`,
`inspector.tsx`)**
One shared placement module computes cover/contain geometry and focal offsets;
the browser maps it to `object-fit`/`object-position` and PPTX maps the *same*
numbers to a real `srcRect`. Background washes export at 75% transparency.
The print route now renders the citation band. `full-bleed` requires the
background layout; vertical strips get a new 4:1 `band` shape; 16:9 generates
at 1920×1088; Pexels orientation follows the slot and Gemini gets an aspect
sentence. The inspector gained Cover/Contain plus a 9-point focal picker.

**Slide geometry (`slides.css`, `archetypes.css`, `packs.css`,
`variants.css`, `renderer.tsx`, `archetypes.ts`)**
`--v-pad-x/-y/-l/-r` and `--v-split` are now the single source of truth for the
text inset and rail width; archetypes override the variables instead of
re-declaring padding, and the citation band and brand logo derive from them.
The phase-cards top reserve is computed from `fs-h2`. `metric-bubbles` wraps
and is capped at 3 bubbles beside an image. `alignClass` no longer sets
`align-self`. A `p` that holds blocks gets `v-p--wrap` so images and stats stop
inheriting body leading and 92% opacity.

---

## 3. Improvements beyond the three reported issues

- The same ScaledSlide loop was latent in the present-mode overview grid and in
  the initial mount (scale 0 → height 0 → jump); both are fixed by the CSS
  ratio.
- Popover clipping also affected navigator row menus; the portal fixes all
  consumers at once.
- `mousedown` → `pointerdown` for outside-close fixes menu dismissal on touch.
- Theme rows were orphaning on *every* brand-theme and AI-theme re-roll, not
  just on delete; the relation sweep collects those too.
- 398 MB of unread, title-keyed export copies are no longer created.
- A deleted-elsewhere document no longer silently accepts edits that can never
  be saved.
- Chart rendering was audited and found correct (SVG, vector everywhere) —
  reported rather than "fixed" speculatively.

---

## 4. Tests

| Added | What it covers |
|---|---|
| `tests/api-documents.test.ts` (8) | Delete + GC against a real SQLite DB in a temp dir: cascade, 404, idempotent double-delete, files shared with a duplicate survive, shared theme survives its last referent, historical theme orphans swept, upload- and settings-pinned files protected, mtime race guard, sweep idempotency. **First API-level test harness in the project.** |
| `tests/image-fit.test.ts` (8) | Aspect never distorts across 5 source/box combinations × cover/contain; cover fills exactly and crops only the overflow; focal point moves the window without resizing it; contain letterboxes; unknown dimensions degrade safely. |
| `scripts/nav-stability.ts` (37) | Calibrates against live geometry, then drives 8/9/10/12 slides × 3 viewport heights straddling the overflow knife-edge; asserts a single settled state, exact 16:9, no surface clipped by its frame, constant column width. |
| `scripts/export-parity.ts` (6) | Unzips the real PPTX, parses every `<p:pic>`, asserts genuine crops exist, none discards the image, all have placement sizes. |
| `scripts/gc-orphans.ts` | Dry-run-by-default sweep sharing the delete route's logic. |
| `scripts/ui-check.ts` (extended) | New menu-reachability audit: every item of the bottom-most card's menu must be hittable via `elementFromPoint`. |

**Results** — all green:

```
npm test                                    174 passed (11 files, was 158)
npx tsc --noEmit                            clean
npm run lint                                0 errors (1 pre-existing warning)
npm run build                               compiled successfully
npx tsx scripts/nav-stability.ts <deck>     37/37
npx tsx scripts/e2e-editor.ts <deck>        26/26
npx tsx scripts/e2e-create.ts               9/9  (0 mid-stream re-layouts)
npx tsx scripts/export-parity.ts <deck>     6/6
npx tsx scripts/verify-export-contract.ts   contract holds
npx tsx scripts/ui-check.ts <deck> <doc>    PASS (48 screenshots)
```

Before/after on the two headline bugs:

| | Before | After |
|---|---|---|
| Navigator thumbnail | 117px frame, 127px surface (10px clipped), frozen | 145px frame, 145px surface, one state |
| Card menu items reachable | 1 of 8 | 8 of 8 |
| PPTX pictures with a real crop | 0 of 9 (all `srcRect 0,0,0,0`) | 3 of 9 cropped, 6 correctly uncropped (aspect already matches) |
| Orphaned image files | 13 (180 MB dir) | 0 (169 MB dir) |

---

## 5. Visual verification

48 screenshots at 1440/1280/1024/768 × light/dark across dashboard, create,
settings, deck editor, document editor and present mode — no console errors, no
horizontal overflow, no unlabelled controls, no undersized hit targets, no
native dialogs, focus ring on every tab stop. Decks exercised include hero,
statement, split, full-bleed, divider, closing, chart and KPI archetypes plus a
6-section document. The GC sweep and a scratch-document delete were run
end-to-end against the live database.

---

## 6. Spacing system and text autofit

Completed after the first pass, on the same principles.

**Spacing scale.** `--v-gap-1…5` (8/12/16/24/32px) are emitted from
`css-vars.ts` and replace all 56 literal `gap` declarations across the four
slide stylesheets. Each is multiplied by `--v-density`, derived from the
`whitespace` structure token that had been declared per family and consumed by
nothing: `1 + (whitespace − 0.3) × 0.6`. Corporate (0.3) is the identity, so
legacy decks are pixel-stable; swiss lands at 0.94, editorial 1.06, bold 1.15.
Measured live: bold renders a 18.4px content gap and 64.4px vertical inset
against corporate's 16/56, so the families now differ in density as intended.
`--v-pad-y` scales with the same factor. This also silently fixed the *three-up
forks by node type* defect — `.v-boxes` (14px) and `.v-icons` (16px) both
resolve to `--v-gap-3`, so the archetype's geometry no longer depends on which
node the model happened to emit. `.v-stat-value` collapsed from three sizing
strategies to one `--v-stat-size` variable, and the `.v-doc` reader ramp now
derives from the family scale instead of hardcoding 44/30/23/**16.5**px.

**Text autofit.** `useAutoFit` measures `.v-content` scrollHeight against
clientHeight once fonts have settled and picks a factor from
1 / 0.95 / 0.9 / 0.85 / 0.8. The factor multiplies only the type scale — the
`--presentation-fs-*` names every rule already uses are now derived from raw
`--v-fs-*` values times `--v-fit` — so it is strictly one-way: smaller text
cannot change the container, so there is no feedback loop of the kind that
caused the navigator bug. Results are cached per slide, so a hundred dashboard
thumbnails do not each run a measuring pass **and** a thumbnail can never
disagree with the full canvas. The identical path runs in the print route, and
the exporter reads the resulting `data-fit` attribute to scale its point sizes
— without that, PPTX text would have stayed full-size inside boxes measured
around shrunken text. Past the floor the content switches to top-aligned with
a fade, so a slide that still overflows loses its tail rather than its heading.
On the 14-slide Foolscap deck, 3 slides autofit (0.95/0.95/0.9) and none hit
the floor. The QA lint threshold dropped from 1.5× to 1.15× of the word budget
now that a modest overrun is absorbed rather than clipped.

`scripts/export-parity.ts` was upgraded from a heuristic ("something is
cropped") to a real check: it resolves each `<p:pic>` to its embedded media via
the slide rels, reads the PNG/JPEG header, narrows the source rect by the
`srcRect` percentages and compares the *visible* aspect against the placement
box. **0 stretched pictures** across both test decks (12/12 and 9/9 measurable).

## 7. Slide-count contract and export robustness

### The template count overrode the user's choice

Two layers both derived the count from the blueprint instead of the request:
`src/app/api/generation/outline/route.ts` (`nCards = template.sections.length`)
and `buildOutlinePrompt` (same expression, which then wrote "produce exactly
the 8 blueprint entries" into the system prompt). Choosing Pitch Deck and
asking for 10 slides produced 8, every time.

The request is now authoritative in both places, and the blueprint became what
it should always have been — the default count plus the narrative arc. When
the requested count differs, the prompt tells the model how to bend the arc:
split the richest sections to grow, merge the most closely related adjacent
ones to shrink, never dropping the opening or the closing.

Testing the real pipeline exposed two further gaps, both of which are the same
class of bug — a contract enforced in one direction only:

- **Content had a floor but no ceiling.** It retried when the model returned
  too few sections and ignored too many, so a 6-section outline could still
  yield 7 slides. It now trims the surplus (sections are emitted in outline
  order, so the excess is at the tail) and cancels the orphaned image jobs.
- **The outline top-up ran once and never re-checked**, and had no ceiling
  either — a request for 12 landed at 11. It now retries up to twice and
  trims over-delivery.

Verified live end to end, generating real decks: **6 → 6, 10 → 10, 12 → 12**,
each asserted against the persisted `PlateSlide[]`, via
`scripts/e2e-template-count.ts`. `tests/outline-prompt.test.ts` locks the
prompt contract without needing a model, and also asserts every template's
default `nCards` equals its blueprint length so the form and the arc cannot
drift apart.

### PDF export

**I could not reproduce a corrupted download, and I want to be straight about
that.** The server response is a well-formed PDF (`%PDF-1.4` … `%%EOF`, correct
`Content-Type`, `Content-Length` matching the body, 9 pages for a 9-slide
deck); all 39 PDFs already on disk validate; and a real browser download
through the export menu arrives **byte-identical** to the API response.

My first hypothesis — the client revoked the blob URL on the same tick as the
click, which can truncate a large asynchronous download — turned out **not** to
reproduce: I tested both the immediate and deferred patterns against an 11 MB
export and both produced intact files. I changed it anyway, because same-tick
revocation is genuinely unsafe, but it was not the cause and I am not claiming
it as the fix.

What I did find and fix is a real export failure with exactly the reported
shape — a download that yields something unopenable:

- **Exporting a document with no slides** spent 30 seconds inside a
  `waitForSelector` timeout (the print page never signals ready with nothing to
  render) and then returned a raw Playwright stack trace, ANSI escape codes
  included, as the error message. It now answers immediately with 409 and a
  sentence a person can act on. There was exactly one such document in the
  library at the time.
- **Images were never awaited.** `openPrintPage` waited for `networkidle`,
  chart SVGs and fonts, but `networkidle` only means the bytes arrived — an
  `<img>` can still be undecoded when `page.pdf()` runs, which renders as a
  blank image box. It now waits for every image to be `complete` with a
  non-zero `naturalWidth`, then `decode()`s them, and gives autofit a frame to
  settle so exports match the editor.
- Export errors are now logged in full server-side and surfaced to the user as
  a single readable line.

Hardening on the client: the download verifies the received blob against
`Content-Length` and refuses a short read rather than writing a truncated file.

`scripts/e2e-export.ts` covers all of it — the API response, a real browser
download compared byte-for-byte against it, PDF header/trailer/xref/page-count
validation on both, and the empty-document guard. **18/18.**

## 8. Remaining risks and known limitations

- **PPTX text wrapping** can still differ from the browser — PowerPoint has its
  own text engine. Box geometry and font sizes match; line-break parity is not
  achievable and was never in scope.
- **Annotated charts still export via the native `addChart` path**, which
  silently drops focus/target/callout/facet annotations. Routing those to the
  192-DPI screenshot path was planned and is not done.
- **`--v-split` is applied but archetype-level pack overrides** (`bold` family
  split margins) still hardcode their own values; they render correctly today
  but are a second source of truth.
- **Autofit is measured, not predicted.** It needs one layout pass after fonts
  load, so a slide that shrinks does so a frame after first paint. The cache
  makes this happen once per slide rather than once per surface, but the very
  first render of a dense slide can show a brief unshrunk state.
- **`allowedSplits` and `maxItemsPerRow`/`maxItems`** are still declared and
  unconsumed. `whitespace` is now wired; the other three would need planner
  changes rather than CSS, so they stayed out of this pass.
- **The 4-step gap mapping rounded several values** (10→8, 14→16, 18→16,
  20→24, 26→24). Every slide's spacing shifted by up to 4px by design; the
  visual pass across three families confirmed nothing broke, but this is a
  deliberate aesthetic change, not a no-op.
- **The corrupted PDF was never reproduced.** The export path is measurably
  more robust now (empty-document guard, image decode wait, short-read
  detection, readable errors) and covered by a regression test, but if you can
  still produce a bad file, the specific document and the exact size on disk
  would pin it down — a truncated file will be smaller than the
  `Content-Length` the server reports.
- **Slide-count enforcement now trims.** A model that over-delivers has its
  surplus dropped from the tail. That is the right call for honouring the
  user's choice, but it does mean a genuinely useful extra section can be
  discarded rather than surfaced.
- **Count enforcement costs a round trip** when the model under-delivers: up to
  two extra outline continuation calls before giving up and accepting what
  arrived.
- **The 1920×1088 hero generation is untested against a live GPU run** in this
  pass — the change is a latent-size parameter and existing images are
  unaffected, but the first new hero image will take roughly twice as long.
- **`scrollbar-gutter`** is unsupported in older Safari; the `aspect-ratio` fix
  alone breaks the loop everywhere, so the gutter is belt-and-braces.
- `data/exports` still holds **394 MB** of historical export copies. Nothing
  writes there any more; clear them with
  `npx tsx scripts/gc-orphans.ts --yes --exports` (kept manual — they are your
  generated deliverables, and the sweep is irreversible).
