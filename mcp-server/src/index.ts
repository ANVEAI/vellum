#!/usr/bin/env node
/**
 * Entry point. Picks a transport from `--transport=` or VELLUM_MCP_TRANSPORT.
 *
 *   stdio  — for local MCP clients (Claude Desktop, Cursor, the Inspector)
 *   http   — Streamable HTTP for remote deployment behind a host platform
 *
 * The legacy HTTP+SSE transport is deprecated as of the 2026-07-28 spec and is
 * deliberately not offered.
 */
import { createContainer } from "./container.js";
import { ConfigError } from "./infra/config.js";
import { startStdio } from "./mcp/transports/stdio.js";
import { startHttp } from "./mcp/transports/http.js";

async function main(): Promise<void> {
  let container;
  try {
    container = createContainer();
  } catch (err) {
    if (err instanceof ConfigError) {
      // stderr, never stdout: in stdio mode stdout is the protocol channel.
      process.stderr.write(`\n${err.message}\n\n`);
      process.stderr.write("See .env.example for the full list of settings.\n");
      process.exit(78); // EX_CONFIG
    }
    throw err;
  }

  const stop = async (signal: string) => {
    container.logger.info("signal received", { signal });
    await container.shutdown();
    process.exit(0);
  };
  process.on("SIGINT", () => void stop("SIGINT"));
  process.on("SIGTERM", () => void stop("SIGTERM"));

  if (container.config.transport === "http") {
    await startHttp(container);
  } else {
    await startStdio(container);
  }
}

main().catch((err) => {
  process.stderr.write(`fatal: ${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
