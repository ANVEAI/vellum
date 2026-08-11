# Vellum

Local-first AI presentation **and** document generator. One streaming LLM call
produces a whole deck (or a flowing written document) as XML, parsed live into
slide structures, composed by a **layout planner** (16 slide archetypes: hero,
section dividers, big-number statements, KPI grids, team grids, phase cards,
full-bleed images…), themed with 43 themes across **7 design families** —
including four **studio style packs** (Meridian, Foolscap, Prism, Nocturne) —
illustrated fully offline via ComfyUI (FLUX.1-schnell / Qwen-Image /
HiDream-I1) with deck-level art-direction presets, drawn with **11 native
infographics + a FLOW diagram language + annotated ECharts**, held to
research-backed **writing rules with in-loop quality gates**, and exported
headlessly to **PPTX / PDF / DOCX** — native editable charts and shapes,
speaker notes, designed document covers/TOC/page furniture.

Built by combining the strongest parts of
[Presenton](https://github.com/presenton/presenton) (Apache-2.0) and
[ALLWEONE Presentation AI](https://github.com/allweonedev/presentation-ai)
(MIT) — see `THIRD_PARTY_LICENSES.md` and `NOTICE`.

## Stack

| Piece | Choice |
|---|---|
| App | Next.js 15 (single runtime), SQLite via Prisma 6 |
| LLM | Ollama (`qwen3.6:35b`) — one streaming call per deck/document |
| Web research | SearXNG (`:8888`), injected as untrusted reference context |
| Images | ComfyUI on GPU 1, offline: FLUX.1-schnell (fast, ~2s), Qwen-Image (in-image text), HiDream-I1 (photoreal); Google Nano Banana / Pexels switchable |
| Icons | 1,512 Phosphor icons × 6 weights, semantic search via `nomic-embed-text` |
| Charts | ECharts (client + SSR for export) |
| Export | Playwright print → PDF; pptxgenjs with native text + measured geometry → PPTX; `docx` → DOCX |
| Auth | Shared password (`APP_PASSWORD` in `.env`), iron-session cookie |

## Run

```powershell
# everything (SearXNG + ComfyUI + app):
powershell -ExecutionPolicy Bypass -File scripts\start-all.ps1
```

or manually:

```bash
npm run dev      # dev on :3210
npm run build && npm run start   # production on :3210
```

### Access from other machines on the LAN

Nothing to configure — Next binds `::` (dual-stack), so the app already
listens on every interface. Print the address to hand out:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\lan-url.ps1
```

`start-vellum.ps1` and `start-all.ps1` print it automatically. Other devices
open `http://<that-ip>:3210` and sign in with `APP_PASSWORD`. The session
cookie is deliberately `secure: false` / `sameSite: lax`, so plain HTTP over
the LAN works.

Two caveats:

- **Don't pass `-H 0.0.0.0`.** That binds IPv4 only; the default `::` covers
  both stacks.
- **This is HTTP, not HTTPS.** The password crosses the LAN in the clear and
  anyone on the network who has it gets full access to every document. Fine
  for a home or lab network; put it behind a reverse proxy with TLS before
  exposing it anywhere less trusted. Never port-forward :3210 to the internet.

First-time setup pieces (already done on this machine):

- `scripts/setup-comfyui.ps1` — clones ComfyUI, venv, torch cu128, downloads FLUX.1-schnell fp8 (~17 GB)
- `npx tsx scripts/embed-icons.ts` — one-time icon embedding via Ollama
- `npx prisma migrate dev` — database
- `.env` — `APP_PASSWORD`, `SESSION_SECRET`, `DATABASE_URL`

Auto-start on boot (run once, elevated):

```powershell
schtasks /create /tn "VellumStack" /tr "powershell -NoProfile -ExecutionPolicy Bypass -File <repo>\vellum\scripts\start-all.ps1" /sc onstart /ru SYSTEM /rl HIGHEST
```

## Flow

1. **New** → pick a template (16 blueprints: pitch / sales / corporate /
   research / launch / training / marketing / **consulting-strategy /
   SaaS-investor-update / conference-keynote / course-module** decks;
   proposal / report / whitepaper / case-study / one-pager docs) or Blank —
   or **import a PDF / DOCX / Markdown document** (verbatim or summarized) —
   with prompt, slide count, tone, research toggle, per-deck image model,
   **image style preset**, and the **brand theme** (extract colors + logo
   from a URL or file in Settings once)
2. **Outline** streams as markdown (~7 s with research) — templates lock the
   section flow; edit it freely
3. **Generate** streams the whole deck in one LLM call (~15 s for 6–8 slides)
   with live typewriter rendering; icons resolve instantly; images generate in
   the background and patch in as they finish
4. **Design engine**: the layout planner assigns each slide an archetype
   (hero → agenda → dividers → statements → KPI grids → closing) with cadence
   rules — no two identical compositions in a row; hard failures (empty
   slides, broken charts) regenerate in-loop before you ever see them
5. **QA/QC runs automatically**: design lint (word budgets, layout
   repetition, chart sanity, outline coverage) + LLM rubric critique →
   score badge + issue list in the editor, each with one-click **Fix**
6. **Edit everything**: inline text (✎ drawer — fix a typo without an LLM
   reroll), ⇆ try-another-layout, 📊 chart data table, 🖼 image
   regenerate/upload, 🗒 speaker notes, duplicate / add / drag-reorder
   slides, undo (Ctrl+Z), themes (38 built-ins, ✨ AI, or 🏷 brand)
7. **Present** full-screen with a presenter view (press **N**: notes +
   next slide + timer), or **export** PPTX / PDF / DOCX

### Studio style packs

Four complete visual identities, each a design system rather than a recolor —
they change type scale, card policy, density, image grade, and chart palette:

| Pack | Register |
|---|---|
| **Meridian** | Dark block-craft: near-black canvas, hairline tiles, Inter Tight, cool accent spent sparingly |
| **Foolscap** | Warm ivory editorial: serif display that never bolds, clay accent, **surface rhythm** so no two consecutive slides share a background |
| **Prism** / **Prism Light** | Gradient cards and gradient heading fills, always-on rounded tiles |
| **Nocturne** | Charcoal, image-forward: big soft-geometric type, rounded media tiles, dedicated **numeric typeface** for stats |

### Visual vocabulary

Beyond the 15 smart layouts: **11 native infographics** — funnel with
conversion drop-offs, KPI rows with sparklines, progress rings, pictograms,
Harvey-ball comparison tables, 2×2 matrices, org charts, journey maps with
mood curves, Venn diagrams, icebergs — plus **`<FLOW>`**, a Mermaid-subset
diagram language with deterministic layout (no 64 MB dependency, identical on
screen and in exports).

Charts argue a point: `focus="Q4"` greys every other bar, `target=`/`avg=`
draw labeled reference lines, `(f)`-suffixed categories auto-shade as a
forecast band, `facet="true"` splits series into shared-scale small
multiples, plus slope / lollipop / dumbbell / range-bar / range-area types.

### Editable PPTX

Titles, paragraphs, bullets, stats, tables — native text at measured
positions, sized by the theme family's type scale. Charts
(bar/line/area/pie/doughnut/radar/scatter) export as real PowerPoint chart
objects (right-click → Edit Data). Smart layouts (boxes, icon lists, steps,
timelines, arrows, sequences, compare / before-after / pros-cons) export as
native shapes + text with theme-tinted icon PNGs. Speaker notes land in
PowerPoint's notes pane; theme gradient surfaces become slide backgrounds;
full-bleed slides get a native scrim. Cycle / pyramid / staircase / columns /
code fall back to pixel-perfect snapshots.
`npx tsx scripts/verify-export-contract.ts <docId>` asserts the DOM contract
the exporter depends on.

### Designed documents

Exported PDFs open with a designed cover and Contents page, then run with
headers, page numbers, per-section page breaks, numbered figures, editorial
pull quotes, and widow/orphan control. DOCX ships real Word styles, a native
(auto-updating) table of contents, headers/footers, and correctly-sized
images.

## Tests

```bash
npm test          # parser golden tests (recorded real qwen streams)
npx tsx scripts/record-golden.ts   # re-record goldens after prompt changes
npx tsx scripts/smoke-comfyui.ts   # one offline image end-to-end
```

## Service map

| Port | Service | Bound to |
|---|---|---|
| 3210 | Vellum app | all interfaces (LAN-reachable, password-protected) |
| 11434 | Ollama (`qwen3.6:35b` GPU 0, `nomic-embed-text`) | all interfaces — **no auth** |
| 8188 | ComfyUI (FLUX.1-schnell, GPU 1) | 127.0.0.1 only |
| 8888 | SearXNG | 127.0.0.1 only |

Ollama listens on every interface with no authentication, so anyone on the
LAN can run, pull or delete models on this machine. Vellum only needs it on
localhost — to close that off, set `OLLAMA_HOST=127.0.0.1:11434` in the
Ollama service environment and restart it.

## Notes / future work

- Rich per-block text editing (Plate) — the data model is Plate-compatible by
  design; render pipeline is already in place
- Chart data spreadsheet editor; chart types beyond the ECharts core set
- Multi-user auth if ever needed (schema has no user coupling to retrofit)
