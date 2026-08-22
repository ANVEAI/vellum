<div align="center">

# Vellum

### Presentation-grade decks and documents, generated entirely on your own machine.

**No cloud APIs. No credits. No subscription. Nothing leaves the box.**

![local-first](https://img.shields.io/badge/local--first-no%20cloud%20APIs-0b7285?style=flat-square)
![offline](https://img.shields.io/badge/works-fully%20offline-2b8a3e?style=flat-square)
![tests](https://img.shields.io/badge/tests-187%20passing-2b8a3e?style=flat-square)
![typescript](https://img.shields.io/badge/TypeScript-strict-3178c6?style=flat-square)
![next](https://img.shields.io/badge/Next.js-15.5-000000?style=flat-square)
![exports](https://img.shields.io/badge/exports-PPTX%20%C2%B7%20PDF%20%C2%B7%20DOCX-c92a2a?style=flat-square)

<img src="docs/images/editor.png" alt="The Vellum editor: slide navigator on the left, canvas in the centre, layout and image controls on the right" width="100%">

</div>

---

A local LLM writes the content. A local diffusion model illustrates it. A local
search engine grounds it in facts. PowerPoint, PDF and Word exports are rendered
headlessly from the **same canonical model the editor shows** — so what you see
is what ships.

It is finished software in daily use, not a prototype: **59 documents** in the
author's library, **187 tests**, `tsc` and `lint` clean.

```powershell
git clone https://github.com/ANVEAI/vellum aai-ppt
cd aai-ppt
powershell -ExecutionPolicy Bypass -File scripts\install.ps1
```

One command. Dependencies, database, models, icon index, build, and a running
server on <http://localhost:3210>.

---

## Why this exists

Every mainstream AI presentation tool is a hosted service. Your prompt, your
outline, your figures and your client's name travel to someone else's
infrastructure, get processed by a model you don't control, and are billed by a
credit meter that resets monthly.

For a consultant under NDA, a clinician handling patient data, a lawyer, or
anyone inside an air-gapped network, that is not a pricing objection — it is a
**disqualifier**.

Vellum takes the other path. The model runs on your GPU. The images are
generated on your GPU. The database is a file on your disk. Unplug the network
cable and everything still works.

There is also the matter of permanence. Tome — the tool everyone called the
"PowerPoint killer" in 2024 — announced its pivot in October 2024, sunset the
product in March 2025, and **deleted user decks that hadn't been exported** when
it shut down on 30 April 2025.[^tome] A generator that lives on your own disk
cannot be sunset out from under you.

## How it compares

Feature parity is not the point — the hosted tools are polished, collaborative
and genuinely good. The point is the axis they all share, and the one Vellum
doesn't.

| | **Vellum** | Gamma | Chronicle | Beautiful.ai | Pitch | presenton |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| **Your content stays on your machine** | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ |
| **Works with no internet at all** | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ |
| **Recurring cost** | **$0** | $12–100/mo | $12–59/user/mo | up to $40/user/mo | $19–29/mo | $0 |
| **Usage metered by credits/tokens** | never | ✅ credits | ✅ tokens | — | ✅ credits | never |
| **Self-hostable** | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ |
| **Source available** | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ Apache-2.0 |
| **PPTX export** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **PDF export** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **DOCX / long-form documents** | ✅ | partial | ❌ | ❌ | ❌ | ❌ |
| **Image generation on your own GPU** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Research grounding with citations** | ✅ local engine | ✅ hosted | ✅ hosted | ❌ | ❌ | ❌ |
| **Real-time collaboration** | ❌ | ✅ | ✅ | ✅ | ✅ | ❌ |
| **Share/publish to the web** | ❌ | ✅ | ✅ | ✅ | ✅ | ❌ |
| **Hosted — nothing to install** | ❌ | ✅ | ✅ | ✅ | ✅ | ❌ |
| **SSO / admin controls** | ❌ | ✅ | ✅ | ✅ | ✅ | ❌ |

<sub>Competitor pricing and features as published in **August 2026**; these
change often — check the vendors directly before relying on the numbers. Sources
at the foot of this file. `presenton` is included deliberately: it is an
open-source, Ollama-capable, genuinely local peer, and Vellum ported ideas from
it.[^attrib]</sub>

**Read the bottom half of that table too.** Vellum has no collaboration, no
share links, no mobile app, no SSO, and you have to install it. If your work is
a team of six iterating on a deck at once, buy Gamma — it is better at that than
Vellum will ever be. If your work must not leave the building, keep reading.

### The cost curve

Hosted tools charge per seat, per month, forever, and meter generation on top.
Vellum's marginal cost is electricity.

| | Year 1 | Year 3 | Year 5 |
|---|---:|---:|---:|
| Gamma Pro, 1 seat | $300 | $900 | $1,500 |
| Chronicle Plus, 5 seats | $1,500 | $4,500 | $7,500 |
| Beautiful.ai Team, 10 seats | $4,800 | $14,400 | $24,000 |
| **Vellum, unlimited seats** | **$0** | **$0** | **$0** |

<sub>Straight-line from published monthly list prices, August 2026. Ignores
annual discounts, and ignores the hardware you already own.</sub>

---

## What it looks like

<table>
<tr>
<td width="50%"><img src="docs/images/library.png" alt="Library view showing generated decks as thumbnail cards"></td>
<td width="50%"><img src="docs/images/present.png" alt="Full-screen present mode, dark theme"></td>
</tr>
<tr>
<td align="center"><sub><b>Library</b> — every deck and document, thumbnailed from the real renderer</sub></td>
<td align="center"><sub><b>Present mode</b> — full-screen, keyboard-driven</sub></td>
</tr>
</table>

## The design engine

Generation is not one prompt and a template. The output is planned.

| | |
|---|---|
| **7 design families** | `swiss` · `editorial` · `corporate` · `bold` · `organic` · `tech` · `studio` — each decides how slides are *built*, not just coloured |
| **16 slide archetypes** | hero, agenda, divider, statement, quote-full, full-bleed, split, three-up, kpi, chart-focus, closing, team-grid, testimonial, phase-cards, metric-bubbles, content |
| **20 templates** | pitch deck, sales deck, research report, whitepaper, case study, executive one-pager, course, keynote, and more |
| **10 native infographics** | timeline · funnel · pyramid · org-chart · matrix · venn · cycle · roadmap · gauge · comparison — rendered as real elements, not flattened images |
| **A FLOW diagram DSL** | describe a diagram in markup; it lays itself out |
| **Cadence planning** | archetypes carry a weight (`breath` / `standard` / `dense`) so a deck breathes instead of hammering |

Slides are typed as `PlateSlide[]` — one canonical model read by the editor,
present mode, the PPTX exporter, the PDF print route and the DOCX writer. There
is no second representation to drift out of sync.

## Architecture

```mermaid
flowchart LR
    P([Your prompt]) --> O[Outline<br/>streamed]
    O --> G[One streaming<br/>LLM call]
    G -->|XML-ish markup| SP[SlideParser]
    SP -->|PlateSlide array| M[(Canonical model)]

    M --> ED[Editor]
    M --> PR[Present mode]
    M --> PX[PPTX]
    M --> PD[PDF]
    M --> DX[DOCX]

    OL[Ollama<br/>:11434] -.writes.-> G
    SX[SearXNG<br/>:8888] -.grounds.-> G
    CF[ComfyUI<br/>:8188] -.illustrates.-> M

    style M fill:#0b7285,stroke:#0b7285,color:#fff
    style G fill:#495057,stroke:#495057,color:#fff
    style P fill:#2b8a3e,stroke:#2b8a3e,color:#fff
```

**One streaming call produces an entire deck**, not one call per slide. That is
a deliberate consequence of the hardware: Ollama at a 262144 context runs a
single parallel slot, so per-slide calls would serialise anyway *and* lose
cross-slide coherence.

> [!IMPORTANT]
> **Read [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) before touching
> generation, layout or export.** It documents invariants that look arbitrary
> and are not — the parser's reset-and-reparse contract, why layout planning is
> backward-looking, why a slide's height must never derive from a measured
> width, the frozen `[data-block-idx]` export contract, and the pptxgenjs
> `options`-vs-`sizing` trap. Each one cost a real debugging session.

---

## Install

Requires [Node.js](https://nodejs.org) 20+ and [Ollama](https://ollama.com).

```powershell
git clone https://github.com/ANVEAI/vellum aai-ppt
cd aai-ppt
powershell -ExecutionPolicy Bypass -File scripts\install.ps1
```

Installs dependencies, writes `.env` with a generated password and a fresh
64-hex session secret, applies migrations, generates the Prisma client, pulls
the Ollama models, builds the icon search index, builds the app, and starts it
on <http://localhost:3210>. It prints the login password and LAN address at the
end. **Re-running is safe** — every step detects whether it is already done.

Fonts are committed, so nothing is fetched from the web during setup beyond npm
packages and the Ollama models.

| Switch | Effect |
|---|---|
| `-Password "..."` | set the login password instead of generating one |
| `-RestoreFrom lib.zip` | restore an existing library |
| `-SkipModels` | skip the Ollama pull (about 23 GB) |
| `-NoStart` | set up without building or launching |
| `-Force` | rewrite `.env` / reinstall dependencies |

Day to day:

```powershell
powershell -ExecutionPolicy Bypass -File vellum\scripts\start-all.ps1
```

To keep it up across reboots and crashes:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\vellum-autostart.ps1 -Register
```

### Services

| Port | Service | Required? | Without it |
|---|---|---|---|
| 3210 | **Vellum** | — | — |
| 11434 | **Ollama** — `qwen3.6:35b` + `nomic-embed-text` | **yes** | nothing generates |
| 8188 | ComfyUI — FLUX.1-schnell / Qwen-Image / HiDream | optional | slides render without images |
| 8888 | SearXNG | optional | content written from model knowledge, no citations |

`scripts/setup-dependencies.ps1` clones the optional companions on request
(`-Images`, `-Research`). Run it with no arguments and it lists the options and
their sizes **without downloading anything**. Clones are `--depth 1`; ComfyUI's
model weights are a separate ~17 GB opt-in via `vellum/scripts/setup-comfyui.ps1`.

### Moving your library between machines

Decks, generated images and the icon index live under `vellum/data/`, which is
not in git. Stop the app, then:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\data-snapshot.ps1 -Mode export -Path C:\vellum-library.zip
```

Hand the zip to the installer on the new machine with `-RestoreFrom`. The
snapshot **reopens the archive and verifies it** after packing — it fails loudly
rather than producing an archive full of images with no database in it.

---

## Verification

Nothing here is aspirational; all of it runs.

```powershell
cd vellum
npm test                                       # 187 tests
npx tsc --noEmit
npm run lint
npx tsx scripts\ui-check.ts <deckId> <docId>   # 48 screenshots, a11y, menus
npx tsx scripts\e2e-create.ts                  # real generation, zero re-layouts
npx tsx scripts\e2e-export.ts <deckId>         # PDF + a real browser download
npx tsx scripts\export-parity.ts <deckId>      # no stretched images in the PPTX
npx tsx scripts\verify-export-contract.ts <deckId>
npx tsx scripts\nav-stability.ts <deckId>      # the 8/9/10 slide boundary
```

`ui-check.ts` is not a smoke test — it fails the build on console errors,
overflow, unlabelled controls, unreachable menu items, missing focus rings and
under-sized hit targets, across two themes and four viewport widths.
**Accessibility is enforced, not aspired to.**

## Repository map

| Path | What it is |
|---|---|
| [`HANDOFF.md`](HANDOFF.md) | Full context in one file — **start here** |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | The load-bearing invariants |
| [`docs/p6-hardening-report.md`](docs/p6-hardening-report.md) | The last hardening pass, with root causes and numbers |
| [`vellum/`](vellum/) | The application — Next.js 15, TypeScript, SQLite/Prisma |
| `scripts/` | `install.ps1`, `data-snapshot.ps1`, `vellum-autostart.ps1` |
| `searxng_config/` | Local SearXNG settings |

## Security

Authentication is **a single shared password over plain HTTP**, designed for a
machine you control on a network you trust.

> [!WARNING]
> Don't port-forward this to the internet. Put it behind a TLS reverse proxy
> with real authentication first.

## Licensing and attribution

Vellum ports ideas and code from two open-source projects, neither of which it
depends on at runtime: [presenton](https://github.com/presenton/presenton)
(Apache-2.0) and
[presentation-ai](https://github.com/allweonedev/presentation-ai) (MIT). Full
attribution is in
[`vellum/THIRD_PARTY_LICENSES.md`](vellum/THIRD_PARTY_LICENSES.md).

Optional companions carry their own licences: ComfyUI is GPL-3.0, SearXNG is
AGPL-3.0. Neither is vendored here.

[^tome]: Tome announced its pivot away from presentations in October 2024,
confirmed the sunset in March 2025, and shut the product down on 30 April 2025;
decks that had not been exported were deleted. The team now builds an AI CRM.

[^attrib]: See `vellum/THIRD_PARTY_LICENSES.md`. Including a direct competitor in
one's own comparison table is unusual; leaving out the one tool that shares
Vellum's core property would have made the table dishonest.

---

<div align="center">
<sub>

**Sources for the comparison** (retrieved August 2026) ·
[Gamma pricing](https://www.eesel.ai/blog/gamma-pricing) ·
[Chronicle pricing](https://www.saasworthy.com/product/chronicle-hq/pricing) ·
[Beautiful.ai / Pitch comparison](https://2slides.com/blog/ai-presentation-maker-pricing-comparison-2026) ·
[Tome shutdown](https://deckary.com/blog/tome-review) ·
[presenton](https://github.com/presenton/presenton)

</sub>
</div>
