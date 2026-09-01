/**
 * Streamable HTTP transport (MCP 2026-07-28).
 *
 * Stateless: no `Mcp-Session-Id`, a fresh Server + transport per POST. The
 * container — and therefore the Vellum session and the job registry — is a
 * process singleton shared across requests. See container.ts for why that split
 * is load-bearing rather than stylistic.
 *
 * Binds to loopback by default. There is no inbound authentication in this
 * version, so anything that can reach the port has full read/write access to
 * the Vellum library; do not expose it beyond a trusted network.
 */
import { createReadStream, statSync, type Stats } from "node:fs";
import path from "node:path";
import express from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Container } from "../../container.js";
import { buildServer } from "../server.js";

export async function startHttp(container: Container): Promise<void> {
  const { config, logger, services } = container;
  const app = express();
  app.use(express.json({ limit: "8mb" }));

  // Liveness. Deliberately does NOT touch Vellum: gating this on Vellum would
  // make a Vellum restart kill the MCP container too.
  app.get("/healthz", (_req, res) => {
    res.json({ ok: true, service: "vellum-mcp", transport: "http" });
  });

  // Readiness — does reach Vellum, so it is cached to avoid hammering it.
  let readyCache: { at: number; body: unknown } | null = null;
  app.get("/readyz", async (_req, res) => {
    if (readyCache && Date.now() - readyCache.at < 5_000) {
      res.json(readyCache.body);
      return;
    }
    try {
      const health = await services.system.health(new AbortController().signal);
      readyCache = { at: Date.now(), body: health };
      res.status(health.vellumReachable ? 200 : 503).json(health);
    } catch (err) {
      res.status(503).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  /**
   * Serve an exported artifact.
   *
   * This is what makes `resource_link` usable: the URI handed back by
   * vellum.export_document points here, on this server's own origin, so a host
   * that refuses off-origin fetches (correctly — a server-supplied URL is an
   * SSRF vector) can still retrieve the file.
   *
   * Two guards, because this is the only route that maps a caller-supplied
   * string onto the filesystem:
   *   1. a strict allowlist matching the artifact naming scheme, and
   *   2. a resolved-path prefix check against the export directory.
   */
  const ARTIFACT_NAME = /^[A-Za-z0-9_-]+\.(pdf|pptx|docx)$/;
  const ARTIFACT_MIME: Record<string, string> = {
    pdf: "application/pdf",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  };

  app.get("/exports/:file", (req, res) => {
    const name = req.params.file;
    if (!ARTIFACT_NAME.test(name)) {
      res.status(400).json({ error: "Invalid artifact name" });
      return;
    }
    const dir = path.resolve(config.exportDir);
    const full = path.resolve(dir, name);
    if (full !== path.join(dir, name) || !full.startsWith(dir + path.sep)) {
      res.status(400).json({ error: "Invalid artifact path" });
      return;
    }
    let stat: Stats;
    try {
      stat = statSync(full);
    } catch {
      res.status(404).json({ error: "Artifact not found or expired" });
      return;
    }
    const ext = name.slice(name.lastIndexOf(".") + 1);
    res.setHeader("Content-Type", ARTIFACT_MIME[ext] ?? "application/octet-stream");
    res.setHeader("Content-Length", String(stat.size));
    res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
    createReadStream(full).pipe(res);
  });

  app.post("/mcp", async (req, res) => {
    // A new Server + transport per request; the container is shared.
    const server = buildServer(services);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless
      enableJsonResponse: true,
    });

    res.on("close", () => {
      void transport.close();
      void server.close();
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      logger.error("http request failed", {
        reason: err instanceof Error ? err.message : String(err),
      });
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  });

  // Without sessions there is no server-initiated stream to attach to.
  app.get("/mcp", (_req, res) => res.status(405).json({ error: "Method Not Allowed" }));
  app.delete("/mcp", (_req, res) => res.status(405).json({ error: "Method Not Allowed" }));

  await new Promise<void>((resolve) => {
    app.listen(config.httpPort, config.httpHost, () => {
      logger.info("mcp server ready", {
        transport: "http",
        url: `http://${config.httpHost}:${config.httpPort}/mcp`,
        vellumBaseUrl: config.vellumBaseUrl,
      });
      resolve();
    });
  });
}
