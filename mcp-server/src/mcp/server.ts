/**
 * Builds the MCP server and registers every tool.
 *
 * This is the only layer that knows about @modelcontextprotocol/sdk. It knows
 * nothing about Vellum's HTTP API — that is what makes the domain testable
 * without a protocol harness and the server portable to another backend.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Services } from "../domain/services.js";
import { anonymousContext } from "../infra/context.js";
import { runTool } from "./tool.js";
import { TOOLS } from "./tools/index.js";

export const SERVER_NAME = "vellum";
export const SERVER_VERSION = "0.1.0";

export function buildServer(services: Services): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      capabilities: { tools: {} },
      instructions:
        "Vellum generates presentation-grade decks and long-form documents entirely on local " +
        "hardware. Typical flow: vellum.health to confirm the stack is up, " +
        "vellum.generate_presentation to start (it returns a job handle because generation takes " +
        "minutes), vellum.get_generation_status to poll, then vellum.export_document. " +
        "Only ONE generation runs at a time across the whole system, so avoid starting several. " +
        "Documents are addressed by documentId, which is valid the moment a generation begins.",
    },
  );

  // Registered in the authored order of TOOLS — deterministic, and workflow
  // ordered rather than alphabetical so the most useful tools come first.
  for (const def of TOOLS) {
    server.registerTool(
      def.name,
      {
        title: def.title,
        description: def.description,
        inputSchema: def.inputSchema as never,
        annotations: def.annotations,
      },
      (async (args: Record<string, unknown>) => {
        // One context per call. Today the subject is anonymous; the shape is
        // already here so a host can supply identity later without any tool
        // signature changing.
        const ctx = anonymousContext({ signal: new AbortController().signal });
        return runTool(def, args ?? {}, ctx, services);
      }) as never,
    );
  }

  return server;
}

/** Exported for tests that want to assert the advertised surface. */
export function toolNames(): string[] {
  return TOOLS.map((t) => t.name);
}
