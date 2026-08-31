/**
 * stdio transport.
 *
 * stdout carries the JSON-RPC framing and NOTHING else — a single stray byte
 * corrupts the protocol stream. The logger already writes only to stderr; this
 * module additionally shims `console.*` so a stray `console.log` anywhere in a
 * dependency cannot break the connection.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Container } from "../../container.js";
import { buildServer } from "../server.js";

export async function startStdio(container: Container): Promise<void> {
  installConsoleShim();

  const server = buildServer(container.services);
  const transport = new StdioServerTransport();

  await server.connect(transport);
  container.logger.info("mcp server ready", {
    transport: "stdio",
    vellumBaseUrl: container.config.vellumBaseUrl,
  });
}

/** Route every console call to stderr so stdout stays protocol-pure. */
function installConsoleShim(): void {
  const toStderr =
    (level: string) =>
    (...args: unknown[]): void => {
      const text = args
        .map((a) => (typeof a === "string" ? a : safeStringify(a)))
        .join(" ");
      process.stderr.write(`[console.${level}] ${text}\n`);
    };

  console.log = toStderr("log");
  console.info = toStderr("info");
  console.warn = toStderr("warn");
  console.error = toStderr("error");
  console.debug = toStderr("debug");
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
