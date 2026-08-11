# Vellum — handoff

**Paste this file into a new chat, or just point at it.** It carries everything a
fresh session needs that isn't derivable from the code.

Read order: this file → [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) (the
invariants) → the code.

---

## 1. What this is

Vellum generates polished presentations and documents **entirely on the local
machine**. No cloud APIs, nothing leaves the box. A local LLM writes the
content, a local diffusion model illustrates it, a local search engine grounds
it in facts, and PowerPoint / PDF / Word exports are rendered headlessly from
the same canonical model the editor shows.

It is finished and in daily use — not a prototype. 55 documents in the library
(417 slides), 187 tests, `tsc` and `lint` clean.

| Layer | Choice |
|---|---|
| App | Next.js 15.5 App Router + Turbopack, TypeScript, port **3210** |
| Data | SQLite via Prisma 6.16 (`vellum/data/app.db`) |
| Text | Ollama `qwen3.6:35b` on :11434 |
| Images | ComfyUI on :8188 (FLUX.1-schnell / Qwen-Image / HiDream) — optional |
| Research | SearXNG on :8888 — optional |
| Auth | one shared password + signed session cookie |
| Tests | Vitest (unit/route) + Playwright (browser E2E scripts) |

The design engine: 7 type families, 16 slide archetypes, 4 style packs, 11
native infographics, a FLOW diagram DSL, and premium chart treatments.

---

## 2. Repository map

```
aai-ppt/
  HANDOFF.md            <- you are here
  README.md             setup + what's deliberately not committed
  docs/
    ARCHITECTURE.md     READ THIS before touching generation/layout/export
    p6-hardening-report.md    the last hardening pass, with root causes
    ui-redesign-checklist.md  the Apple-HIG UI pass
  scripts/
    install.ps1         one-command setup (see below)
    data-snapshot.ps1   move the library between machines
    setup-dependencies.ps1    optional companions; downloads nothing by default
  searxng_config/       SearXNG settings
  vellum/               the application
    src/lib/generation/ prompts, streaming parser, pipeline
    src/lib/design/     families, archetypes, planner, type scale
    src/lib/export/     pptx.ts, docx.ts, pdf via the print route
    src/lib/slides/     image-fit.ts (shared crop geometry)
    src/lib/storage/    paths.ts, gc.ts (reference-counted asset GC)
    src/components/slides/render/   renderer + slide-frame (ScaledSlide)
    src/styles/         slides.css, archetypes.css, packs.css, variants.css
    scripts/            verification + E2E (see section 7)
    tests/              187 tests
    data/               NOT in git: db, images, icon vectors
```

---

## 3. Get it running

```powershell
git clone https://github.com/ANVEAI/vellum aai-ppt
cd aai-ppt
powershell -ExecutionPolicy Bypass -File scripts\install.ps1
```

That installs dependencies, writes `.env` with a generated password and session
secret, creates the database, pulls the two Ollama models, builds the icon
search index, builds the app, and starts it on **http://localhost:3210**. It
prints the login password and the LAN URL at the end. Re-running it is safe —
every step is skipped if already done.

Useful switches:

| Switch | Effect |
|---|---|
| `-Password "your-pass"` | set the login password instead of generating one |
| `-RestoreFrom lib.zip` | restore an existing library (see section 9) |
| `-SkipModels` | don't pull Ollama models (23 GB) |
| `-NoStart` | set up but don't build/launch |

Day-to-day afterwards:

```powershell
powershell -ExecutionPolicy Bypass -File vellum\scripts\start-all.ps1
```

---

## 4. How the user works — match this

Learned over the build, and worth honouring:

- **Diagnose before modifying.** Every fix in this codebase was root-caused with
  a live reproduction first. "Probably this" patches get rejected. The 9-slide
  navigator shake, for example, was proven to be a scrollbar feedback loop with
  379 measured samples before a line changed.
- **No magic numbers.** If a constant appears, it must be derived from a token
  or explained. Ten ad-hoc `gap:` values were the reason the UI "felt off".
- **Deterministic over clever.** One-way transforms, no feedback loops, cached
  results that can't disagree between views.
- **Don't break the architecture to fix a bug.** The `PlateSlide[]` model and
  the `[data-block-idx]` export contract are frozen; fixes go around them.
- **Accessibility is not optional** — labels, focus rings, keyboard paths, hit
  targets. `ui-check.ts` enforces it.
- **Regression test every fixed bug.** Each of the numbered bugs has a test or
  a script that would catch it coming back.
- **Report honestly.** If something wasn't reproduced, say so. If a claim turns
  out wrong, correct it plainly. Overstating a diagnosis has been called out
  more than once — verify, then speak.
- **Don't download gigabytes uninvited.** Anything large is opt-in and its size
  is stated up front.

Working style: terse answers, direct claims, no preamble. When something is
verified, say it plainly; when it isn't, say that too.

---

## 5. Current state

Everything through phase P6 is shipped, verified and pushed.

Recent fixes, all with reproductions and regression coverage:

| # | Symptom | Actual cause |
|---|---|---|
| 1 | Navigator "shakes" at exactly 9 slides | `ScaledSlide` derived pixel height from a JS-measured width inside an `overflow:auto` scroller — the scrollbar closed the loop. 9 was a property of window height, not slide count. Now height comes from CSS `aspect-ratio` and JS only drives `transform: scale()`. |
| 2 | "Can't delete a presentation" | The card menu rendered inside an `overflow:hidden` card and was clipped — **1 of 8 items was hittable**. Popover now portals to `<body>` at `position:fixed` with flip/clamp. 8/8 after. |
| 3 | Images cropped / stretched / blurry | PPTX passed the same box to `options` and `sizing`, which makes pptxgenjs emit `srcRect(0,0,0,0)` — a pure stretch on every image. Now computes real cover-crop from probed natural dimensions. Verified 0 stretched against the embedded media bytes. |
| 4 | Template slide count overrode the user's choice | Both the outline prompt and the route read `template.sections.length` instead of `nCards`. Now `nCards` is authoritative, with top-up and trim at both stages. Regression test covers Pitch Deck 8 → 10. |
| 5 | Parser dropped a trailing tag fragment | A force-close on an incomplete `<TAG` at the buffer edge emitted it as text (`Unknown top-level tag: NOTES</SECTION`). Now trimmed before close. |
| — | Spacing / typography felt amateur | Introduced `--v-gap-1..5` × `--v-density` and a one-way text autofit that exports identically. |

Also: reference-counted asset GC (files and themes are shared between
duplicates, so ownership is unanswerable — liveness is a text scan over all DB
content), `VELLUM_DATA_DIR` so tests can't sweep the real library, and a
download-manager fallback for exports.

Full detail with numbers: [`docs/p6-hardening-report.md`](docs/p6-hardening-report.md).

---

## 6. The five things that will silently break it

Expanded in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md); the headlines:

1. **Feed the parser the whole cumulative buffer each tick**, wrapped in
   `reset() → parseChunk(full) → finalize()`. Never the delta.
2. **Layout planning must stay backward-looking** — slide *i* sees only
   `0..i`, which is what makes the streaming preview prefix-stable.
3. **Never derive a slide's height from a measured width.** Use
   `aspect-ratio`. This is bug #1 and it will come back.
4. **`[data-block-idx]` is a frozen contract** — one wrapper per model node, in
   model order. New looks add modifier classes; they never restructure.
5. **In pptxgenjs, `options.w/h` is the uncropped image and `sizing.w/h` is the
   visible window.** Equal values mean stretch.

Plus, on Windows: `.ps1` files must be pure ASCII (PowerShell 5.1 reads them as
ANSI — a UTF-8 em dash is a parse error), and never run `npm run build` while
the dev server is up; they share `.next`.

---

## 7. Verification

Server must be running for anything browser-based.

```powershell
cd vellum
npm test                                          # 187 tests
npx tsc --noEmit
npm run lint
npx tsx scripts\ui-check.ts <deckId> <docId>      # 48 screenshots, a11y, menus
npx tsx scripts\e2e-editor.ts <deckId>            # 26 editor interactions
npx tsx scripts\e2e-create.ts                     # real generation, no re-layouts
npx tsx scripts\e2e-export.ts <deckId>            # PDF + real browser download
npx tsx scripts\e2e-template-count.ts pitch-deck 6 10 12
npx tsx scripts\nav-stability.ts <deckId>         # the 8/9/10 boundary
npx tsx scripts\export-parity.ts <deckId>         # no stretched images
npx tsx scripts\verify-export-contract.ts <deckId>
npx tsx scripts\gc-orphans.ts                     # dry run by default
```

---

## 8. Open items

Nothing is broken. These are known and deliberate:

- PPTX line breaks differ from the browser (PowerPoint has its own text
  engine). Box geometry and font sizes match; wrap parity is out of scope.
- Annotated charts export as 192-DPI images rather than editable natives;
  plain charts stay native.
- Regenerating a slide resets its image fit/focal choice.
- `allowedSplits`, `maxItemsPerRow`, `maxItems` are declared per family and
  still unconsumed — wiring them is a planner change, not CSS.
- No LICENSE file (the repo is private).
- Bulk multi-select delete on the dashboard was deferred.

---

## 9. Moving to the new machine (same port 3210)

The library — 55 documents, 417 slides, 248 image files, a 229 MB archive — is
not in git. To carry it over:

**On the old machine**, stop the app first so SQLite is quiescent, then:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\data-snapshot.ps1 -Mode export -Path C:\vellum-library.zip
```

**On the new machine**, hand the zip to the installer:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install.ps1 -RestoreFrom C:\vellum-library.zip
```

The snapshot carries the database, the generated images, and the icon vector
index (which otherwise needs a fresh embedding run). It skips `data/exports/`
(dead since P6, stale copies only) and `app.db-shm` (SQLite rebuilds it; a
stale one is worse than none). After packing it reopens the archive and
verifies the database is in it and the image count matches — a snapshot that
silently lost the database would look fine by size alone and only fail on the
target machine.

Cutover checklist:

1. New machine: run `install.ps1` with the snapshot; confirm 55 documents and
   that thumbnails render.
2. Confirm Ollama has `qwen3.6:35b` and `nomic-embed-text`, and that icon
   search returns results (Settings → the icon picker).
3. Run one real generation end to end, then export it to PPTX and PDF.
4. Only then stop 3210 on the old machine.
5. Point any bookmarks at the new LAN address — `vellum\scripts\lan-url.ps1`
   prints it. Allow Node through the Windows firewall on the private profile if
   other devices can't reach it.

Fresh sessions get the running server the same way any process is reached — it
is a plain localhost service, and every verification script above works against
it unchanged.
