# Vellum MCP Server

A standalone [Model Context Protocol](https://modelcontextprotocol.io) server that exposes
[Vellum](../README.md) — a local-first AI presentation and document generator — as
agent-invocable tools.

It is a **pure HTTP adapter**. It imports nothing from `vellum/`, touches no database, and
requires **zero changes to Vellum**. It knows nothing about any particular host platform
and can be lifted into its own repository by copying this folder.

> **Not** the commercial Vellum AI (vellum.ai). That is an unrelated LLM-app platform,
> which is itself an MCP *client*.

---

## Quick start

```bash
npm install
npm run build

VELLUM_BASE_URL=http://localhost:3210 \
VELLUM_APP_PASSWORD='<APP_PASSWORD from vellum/.env>' \
npm run start:stdio
```

Register it with an MCP client:

```jsonc
{
  "mcpServers": {
    "vellum": {
      "command": "node",
      "args": ["D:\\vellum project\\mcp-server\\dist\\index.js", "--transport=stdio"],
      "env": {
        "VELLUM_BASE_URL": "http://localhost:3210",
        "VELLUM_APP_PASSWORD": "..."
      }
    }
  }
}
```

For remote use: `npm run start:http` (Streamable HTTP on `:8080/mcp`, stateless per the
2026-07-28 spec — no `Mcp-Session-Id`). The deprecated HTTP+SSE transport is not offered.

---

## The tools

26 tools, registered in workflow order rather than alphabetically — `tools/list` ordering
is deterministic, which lets clients cache it.

| Group | Tools |
|---|---|
| **Observe** | `health` · `list_templates` · `list_documents` · `get_document` |
| **Create** | `generate_presentation` · `generate_document` · `get_generation_status` · `cancel_generation` |
| **Refine** | `generate_outline` · `set_outline` · `generate_slides_from_outline` · `regenerate_slide` · `set_theme` |
| **Deliver** | `export_document` |
| **Recover** | `repair_document` · `get_asset_status` · `retry_failed_images` · `request_slide_image` · `generate_image` |
| **Manage** | `update_document` · `duplicate_document` · `delete_document` · `import_source` · `search_icons` · `get_settings` · `update_settings` |

### The main workflow

Generation takes **minutes** on a local model, so it never blocks a tool call:

```
vellum.health                       # is Ollama up? catches the common failure in ms
vellum.generate_presentation        # -> { jobId, documentId }
vellum.get_generation_status        # poll every few seconds
vellum.export_document              # -> file as MCP content + JSON summary
```

### How exports come back

`export_document` returns the file as MCP content, not a filesystem path — a path is
useless to a client on another machine.

| File size | Delivery |
|---|---|
| ≤ `VELLUM_MCP_EMBED_MAX_BYTES` (default 5 MB) | embedded `resource` block, base64 |
| larger | `resource_link` pointing at `GET /exports/<file>` on this server |

A JSON summary (`documentId`, `slideCount`, `bytes`, `sha256`) always accompanies it in a
text block, so the model has something to describe.

> [!IMPORTANT]
> The link is built from `VELLUM_MCP_PUBLIC_URL`, defaulting to
> `http://{HTTP_HOST}:{HTTP_PORT}`. **It must match the origin the consuming platform
> registered** — a server-supplied URL is an SSRF vector, and hosts correctly refuse to
> fetch off-origin. If you put this behind a proxy or a different external address, set
> `VELLUM_MCP_PUBLIC_URL` to that address or the link will be rejected.

Under `--transport=stdio` there is no HTTP listener, so a file too large to embed falls
back to a path plus an explicit note rather than a link that would 404.

To review the plan before spending minutes on content — the outline *is* the slide-count
contract, so this is the cheapest quality lever:

```
vellum.generate_presentation { stopAfterOutline: true }
vellum.set_outline { cards: [...] }
vellum.generate_slides_from_outline
```

---

## Things this server has to work around

Vellum was not built to be driven remotely. These are the behaviours the adapter absorbs
so an agent never has to know about them. Each was read out of Vellum's source.

**One generation at a time, globally.** Vellum's lock is a process-wide single slot with
no queue and no TTL; contention returns a bare 409. This server keeps its own FIFO queue in
front of it, so callers wait in order instead of retry-storming.

**Cancelling means aborting, not abandoning.** Vellum releases its lock only from a
`finally` inside the SSE stream, and `streamChat` has no timeout. Simply dropping the
response leaves Vellum generating — lock held — for minutes. So every non-happy exit path
**aborts first, then drains** within a bounded budget. This is the single most important
correctness property here, and it has a live test: cancel a generation, immediately start
another, and assert the second succeeds.

**Errors arrive inside a 200.** Generation failures come back as `event: error` on an
already-committed 200 response. Status-code-only handling misses every one of them.

**"ready" does not mean complete.** An interrupted generation persists a truncated deck
marked `ready` with no marker. Every response therefore carries `truncated`, computed as
`slideCount < cardCount` — strictly less-than, because a sources appendix legitimately adds
one slide.

**A partial quality report appears mid-flight.** Vellum writes `{score: null}` at the same
moment it flips status to `reviewing`, so `qualityReport != null` is not a completion
signal; a score must be present. Quality is also best-effort, so waiting for it is bounded
and never fails the operation.

**A failed outline strands the document forever** at `status:"outlining"` — Vellum's
outline route has no error handling and nothing sweeps it. This server compensates its own
runs, and `repair_document` handles ones stranded by other clients.

**Payloads are large.** A full document row is median 30 KB and includes `rawXml`, raw LLM
debug output no agent decision depends on. `get_document` is projection-only: `summary`
(~450 bytes) is the default, and `rawXml` sits behind its own view.

**Settings leak API keys.** `GET /api/settings` returns `geminiApiKey` and `pexelsApiKey`
in plaintext. The settings view is an **allowlist** projection — it fails closed if Vellum
adds another secret field — and reports keys only as configured-or-not.

---

## Architecture

```
src/
  index.ts        entry; picks transport
  container.ts    composition root  (per-request protocol objects,
                                     process-lifetime infrastructure)
  mcp/            tool definitions, schemas, transports   <- only layer that imports the SDK
  domain/         presentations, documents, exports, assets, jobs, mutex, projections
  vellum/         HTTP client, session, SSE consumer, endpoint bindings
  infra/          config, logging, errors, retry, redaction, caller context
```

Dependency direction is strictly one-way: `mcp/ → domain/ → vellum/ → infra/`. The MCP
layer holds no Vellum knowledge and the Vellum layer holds no MCP knowledge, which is what
makes the domain testable without a protocol and the server portable to another backend.

### Multi-user

`CallerContext` (subject, scopes, requestId, deadline, signal) is threaded through every
layer already; today it carries an anonymous subject. Turning on inbound auth is a config
flag plus a middleware, not a refactor — no tool signature changes.

Genuine multi-tenancy, though, means **one Vellum instance per tenant**. Vellum has no
user, owner or tenant concept anywhere in its schema, a global settings singleton, and
in-process queues; there is no isolation primitive for this server to build on.

---

## Security

- `VELLUM_APP_PASSWORD` comes from the environment only. It is never a tool argument,
  never in a response, never logged.
- A rejected password trips a **permanent circuit breaker**. Vellum rate-limits *failed*
  logins to 5/min per IP against a bucket shared with its own web UI, so a retry loop would
  lock the human operator out of their browser.
- Everything outbound passes `redact()`: registered secrets by value, secret-shaped keys by
  name, session cookies and bearer tokens by pattern.
- **Inbound auth is off by default.** Anything that can reach the port has full read/write
  on the library, including delete. `VELLUM_MCP_REQUIRE_AUTH=true` plus
  `VELLUM_MCP_AUTH_TOKENS` turns it on.

---

## Development

```bash
npm run typecheck
npm test              # 44 unit + contract tests, no live Vellum needed
npm run build
```

Contract tests run against a real `node:http` fake Vellum — real sockets, because the
auth-refresh and 409-classification behaviour only means anything over one.

Requires Node 20+. Vellum must be running for anything beyond `npm test`.
