/**
 * Structured logging that is safe under the stdio transport.
 *
 * IMPORTANT: in stdio mode, stdout carries the MCP JSON-RPC framing. Writing a
 * single stray byte to stdout corrupts the protocol stream. Every log line
 * therefore goes to **stderr**, unconditionally.
 *
 * Every payload passes through `redact()` on the way out.
 */
import { redact } from "./redact.js";

export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

const ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 100,
};

export interface LogFields {
  [key: string]: unknown;
  /** Correlates every log line emitted while handling one tool call. */
  requestId?: string;
  tool?: string;
  jobId?: string;
  documentId?: string;
  durationMs?: number;
}

export interface Logger {
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
  /** Returns a logger that stamps `fields` onto every subsequent line. */
  child(fields: LogFields): Logger;
}

function write(level: Exclude<LogLevel, "silent">, threshold: LogLevel, base: LogFields, msg: string, fields?: LogFields): void {
  if (ORDER[level] < ORDER[threshold]) return;
  const line = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...redact({ ...base, ...fields }),
  };
  // stderr only — see the file header.
  process.stderr.write(`${JSON.stringify(line)}\n`);
}

export function createLogger(level: LogLevel = "info", base: LogFields = {}): Logger {
  const make = (baseFields: LogFields): Logger => ({
    debug: (m, f) => write("debug", level, baseFields, m, f),
    info: (m, f) => write("info", level, baseFields, m, f),
    warn: (m, f) => write("warn", level, baseFields, m, f),
    error: (m, f) => write("error", level, baseFields, m, f),
    child: (f) => make({ ...baseFields, ...f }),
  });
  return make(base);
}

/** A logger that discards everything — for tests. */
export const nullLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  child() {
    return nullLogger;
  },
};
