/**
 * The tool contract, and the single chokepoint every result passes through.
 *
 * Two rules enforced here rather than in each handler:
 *   1. Everything is redacted on the way out — independently of the logger.
 *   2. Results over the budget are refused with an actionable message rather
 *      than silently truncated, because silent truncation produces confidently
 *      wrong agent behaviour.
 */
import type { ZodRawShape } from "zod";
import type { CallerContext } from "../infra/context.js";
import { redact } from "../infra/redact.js";
import { toMcpError } from "../infra/errors.js";
import type { Services } from "../domain/services.js";

export interface ToolAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface ToolDefinition {
  name: string;
  title: string;
  /** Written for a model: says what it does, what it costs, and what comes next. */
  description: string;
  inputSchema: ZodRawShape;
  annotations: ToolAnnotations;
  handler: (
    args: Record<string, unknown>,
    ctx: CallerContext,
    services: Services,
  ) => Promise<unknown>;
}

/**
 * The content-block shapes we emit.
 *
 * `resource_link` points at bytes the host fetches itself; `resource` embeds
 * them base64. Both are MCP-native, so a browser client on another machine can
 * actually retrieve a file — which a filesystem path never allowed.
 */
export type ContentBlock =
  | { type: "text"; text: string }
  | {
      type: "resource_link";
      uri: string;
      name: string;
      mimeType?: string;
      description?: string;
    }
  | {
      type: "resource";
      resource: { uri: string; mimeType?: string; blob: string };
    };

export interface McpToolResult {
  content: ContentBlock[];
  structuredContent?: unknown;
  isError?: boolean;
}

const CONTENT_MARKER = Symbol.for("vellum.mcp.contentEnvelope");

export interface ContentEnvelope {
  [CONTENT_MARKER]: true;
  blocks: ContentBlock[];
  payload: unknown;
  summary?: string;
}

/**
 * Let a handler return content blocks alongside its JSON payload.
 *
 * The payload still becomes `structuredContent` and is still size-checked; the
 * blocks bypass that check because a base64 blob is legitimately large and is
 * not competing for the model's context the way a JSON body is.
 */
export function withContent(
  payload: unknown,
  blocks: ContentBlock[],
  summary?: string,
): ContentEnvelope {
  return { [CONTENT_MARKER]: true, blocks, payload, ...(summary ? { summary } : {}) };
}

export function isContentEnvelope(value: unknown): value is ContentEnvelope {
  return typeof value === "object" && value !== null && CONTENT_MARKER in value;
}

/** Above this, the JSON is not echoed into the text block as well. */
const INLINE_TEXT_LIMIT = 1_000;
/** Hard ceiling on a single tool result. 64 KB ≈ 16k tokens. */
const MAX_RESULT_BYTES = 65_536;

export function ok(payload: unknown, summary?: string): McpToolResult {
  let extraBlocks: ContentBlock[] = [];
  if (isContentEnvelope(payload)) {
    extraBlocks = payload.blocks;
    summary = summary ?? payload.summary;
    payload = payload.payload;
  }

  const safe = redact(payload);
  const json = JSON.stringify(safe);

  if (json.length > MAX_RESULT_BYTES) {
    return toolError(
      `The result is ${json.length} bytes, over the ${MAX_RESULT_BYTES}-byte limit. ` +
        `Re-call with a narrower view — for example view:"summary", a smaller ` +
        `maxCharsPerSlide, or a slideNumbers subset.`,
      { kind: "result_too_large", bytes: json.length, limit: MAX_RESULT_BYTES },
    );
  }

  // The spec suggests echoing structured content as text for compatibility.
  // Done naively that doubles the token cost of every response, so above a
  // small threshold the text block carries a terse summary instead.
  const text = json.length <= INLINE_TEXT_LIMIT ? json : (summary ?? terse(safe));

  // Blocks first, then the JSON summary — the host renders the artifact, the
  // model still gets something to describe.
  return { content: [...extraBlocks, { type: "text", text }], structuredContent: safe };
}

export function toolError(message: string, details?: Record<string, unknown>): McpToolResult {
  const payload = redact({ ok: false, error: { message, ...details } });
  return {
    content: [{ type: "text", text: message }],
    structuredContent: payload,
    isError: true,
  };
}

/** Wrap a handler so every thrown error becomes an actionable tool error. */
export async function runTool(
  def: ToolDefinition,
  args: Record<string, unknown>,
  ctx: CallerContext,
  services: Services,
): Promise<McpToolResult> {
  const startedAt = Date.now();
  const log = ctx.requestId ? services.logger.child({ tool: def.name, requestId: ctx.requestId }) : services.logger;

  try {
    const result = await def.handler(args, ctx, services);
    log.info("tool ok", { durationMs: Date.now() - startedAt });
    return ok(result);
  } catch (err) {
    const mapped = toMcpError(err);
    log.warn("tool failed", {
      durationMs: Date.now() - startedAt,
      kind: mapped.kind,
      reason: mapped.message,
    });
    return toolError(mapped.message, {
      kind: mapped.kind,
      retryable: mapped.retryable,
      ...mapped.details,
    });
  }
}

/** A short human-readable line for large payloads. */
function terse(payload: unknown): string {
  if (payload && typeof payload === "object") {
    const p = payload as Record<string, unknown>;
    const bits: string[] = [];
    if (p.documentId) bits.push(`document ${String(p.documentId)}`);
    if (p.title) bits.push(`"${String(p.title).slice(0, 60)}"`);
    if (typeof p.slideCount === "number") bits.push(`${p.slideCount} slides`);
    if (typeof p.total === "number") bits.push(`${p.total} results`);
    if (p.phase) bits.push(`phase=${String(p.phase)}`);
    if (p.path) bits.push(`-> ${String(p.path)}`);
    if (bits.length) return `${bits.join(", ")}. Full detail in structuredContent.`;
  }
  return "Result returned in structuredContent.";
}
