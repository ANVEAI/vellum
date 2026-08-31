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
