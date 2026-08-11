# Vellum — local-first AI presentation & document generator

Generates polished presentations and documents entirely on your own machine.
No cloud APIs, nothing leaves the box: a local LLM writes the content, a local
diffusion model illustrates it, a local search engine grounds it in facts, and
exports to PowerPoint, PDF and Word are produced headlessly from the same
canonical model.

The application lives in **[`vellum/`](vellum/)** — see
[`vellum/README.md`](vellum/README.md) for architecture and day-to-day use.

## What's in this repository

| Path | What it is |
|---|---|
| `vellum/` | The application. Next.js 15, TypeScript, SQLite/Prisma. |
| `searxng_config/` | Local SearXNG settings used for research grounding. |
| `scripts/` | One-time setup for the upstream dependencies. |

## What's *not* in this repository — and what you actually need

**Vellum runs standalone.** The only hard requirement is
[Ollama](https://ollama.com) with a model pulled. Everything below is optional
and off by default:

| Project | Needed for | If missing | License |
|---|---|---|---|
| [ComfyUI](https://github.com/comfyanonymous/ComfyUI) | generated images | slides render without images | GPL-3.0 |
| [SearXNG](https://github.com/searxng/searxng) | research grounding | content is written from the model's own knowledge | AGPL-3.0 |
| [presenton](https://github.com/presenton/presenton) | **nothing** — reference only | — | Apache-2.0 |
| [presentation-ai](https://github.com/allweonedev/presentation-ai) | **nothing** — reference only | — | MIT |

The last two are the projects some code was ported *from*; there is no runtime
dependency on either. `scripts/setup-dependencies.ps1` clones whichever you
ask for (`-Images`, `-Research`, `-Reference`) — run it with no arguments and
it just lists the options and their sizes without downloading anything. Clones
are `--depth 1`, so ~150 MB for ComfyUI's code, not gigabytes; its **model
weights are a separate ~17 GB download** you opt into via
`vellum/scripts/setup-comfyui.ps1`.

Generated content is also excluded: the SQLite database, generated images,
exports and the icon embedding index all live under `vellum/data/`, which is
ignored. A fresh clone starts with an empty library.

Attribution for the ported code is in
[`vellum/THIRD_PARTY_LICENSES.md`](vellum/THIRD_PARTY_LICENSES.md).

## Setup on a new machine

```powershell
git clone <this-repo> aai-ppt
cd aai-ppt
powershell -ExecutionPolicy Bypass -File scripts\setup-dependencies.ps1
```

Then:

```powershell
cd vellum
npm install
copy .env.example .env      # set APP_PASSWORD and a 64-hex SESSION_SECRET
npx prisma migrate deploy   # creates data\app.db
npx tsx scripts\fetch-fonts.ts
npx tsx scripts\embed-icons.ts   # icon search index; needs Ollama running
```

Start everything:

```powershell
powershell -ExecutionPolicy Bypass -File vellum\scripts\start-all.ps1
```

The app comes up on <http://localhost:3210>; the script also prints the LAN
address for other devices on your network.

### Services it expects

| Port | Service | Notes |
|---|---|---|
| 3210 | Vellum | password from `.env` |
| 11434 | Ollama | `qwen3.6:35b` + `nomic-embed-text` |
| 8188 | ComfyUI | FLUX.1-schnell / Qwen-Image / HiDream |
| 8888 | SearXNG | research grounding |

Vellum degrades gracefully: without ComfyUI you get no images, without SearXNG
no research — content generation still works.

## Security note

Authentication is a single shared password over plain HTTP, designed for a
machine you control on a network you trust. Don't port-forward it to the
internet; put it behind a TLS reverse proxy first if you need remote access.
