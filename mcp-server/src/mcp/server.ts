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
import { runTool, type ToolDefinition } from "./tool.js";
import { TOOLS } from "./tools/index.js";
import { ANVE_BOX_TOOLS } from "./tools/anve-box.js";

export const SERVER_NAME = "vellum";
export const SERVER_VERSION = "0.1.0";

type Toolset = Services["config"]["toolset"];

const INSTRUCTIONS: Record<Toolset, string> = {
  full:
    "Vellum generates presentation-grade decks and long-form documents entirely on local " +
    "hardware. Typical flow: vellum.health to confirm the stack is up, " +
    "vellum.generate_presentation to start (it returns a job handle because generation takes " +
    "minutes), vellum.get_generation_status to poll, then vellum.export_document. " +
    "Only ONE generation runs at a time across the whole system, so avoid starting several. " +
    "Documents are addressed by documentId, which is valid the moment a generation begins.",
  "anve-box":
    "Vellum makes slide decks. Start one with start_presentation, which answers at once with " +
    "an id, then call check_presentation with that id every 15-30 seconds until it says done " +
    "or failed. Vellum makes one deck at a time, so a new one may wait in a queue.",
};

/** The tools a server advertises: one set per process (VELLUM_MCP_TOOLSET). */
export function toolsFor(toolset: Toolset): readonly ToolDefinition[] {
  return toolset === "anve-box" ? ANVE_BOX_TOOLS : TOOLS;
}

export function buildServer(services: Services): McpServer {
  const toolset = services.config.toolset;
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      capabilities: { tools: {} },
      instructions: INSTRUCTIONS[toolset],
    },
  );

  // Registered in the authored order of the set — deterministic, and workflow
  // ordered rather than alphabetical so the most useful tools come first.
  for (const def of toolsFor(toolset)) {
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
