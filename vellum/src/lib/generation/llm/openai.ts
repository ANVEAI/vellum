/**
 * OpenAI-compatible chat client — used instead of Ollama when LLM_BASE_URL is set.
 *
 * The case it exists for: Vellum co-hosted with ANVE, whose gateway
 * (`http://127.0.0.1:8100/v1`) serves the workspace's model and logs every
 * call. Any OpenAI-compatible server works the same way.
 *
 * Configured from the environment only — never from the settings table — so
 * the API key stays in the gitignored .env and out of the database and the
 * settings API:
 *
 *   LLM_BASE_URL    e.g. http://127.0.0.1:8100/v1     (turns this client on)
 *   LLM_API_KEY     sent as `Authorization: Bearer`
 *   LLM_MODEL       default "default" (the gateway's default model)
 *   LLM_MAX_TOKENS  default 16384 (a whole deck is written in one call)
 *
 * Same contract as ollama.ts streamChat: deltas go to onDelta, the full text is
 * returned. A structured call (`format`) is sent as response_format json_schema
 * and read in one piece, because servers apply JSON mode to whole replies.
 */
import type { OllamaStreamOptions } from "./ollama";

export interface OpenAIConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  maxTokens: number;
}

/** The OpenAI-compatible provider, or null when Vellum should use Ollama. */
export function openAIConfig(): OpenAIConfig | null {
  const baseUrl = (process.env.LLM_BASE_URL ?? "").trim().replace(/\/+$/, "");
  if (!baseUrl) return null;
  const maxTokens = Number.parseInt(process.env.LLM_MAX_TOKENS ?? "", 10);
  return {
    baseUrl,
    apiKey: (process.env.LLM_API_KEY ?? "").trim(),
    model: (process.env.LLM_MODEL ?? "").trim() || "default",
    maxTokens: Number.isFinite(maxTokens) && maxTokens > 0 ? maxTokens : 16384,
  };
}

function headers(config: OpenAIConfig, documentId?: string): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (config.apiKey) h.Authorization = `Bearer ${config.apiKey}`;
  // Lets ANVE log the call for the person whose deck this is (it files decks
  // by document id). A server that does not know the header ignores it.
  if (documentId) h["X-Vellum-Document"] = documentId;
  return h;
}

interface ChatChunk {
  choices?: Array<{ delta?: { content?: string | null }; message?: { content?: string | null } }>;
  error?: { message?: string } | string;
}

function errorText(err: ChatChunk["error"]): string {
  return typeof err === "string" ? err : (err?.message ?? "unknown error");
}

export async function streamChatOpenAI(
  config: OpenAIConfig,
  options: OllamaStreamOptions,
): Promise<string> {
  const structured = Boolean(options.format);
  const res = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: headers(config, options.documentId),
    body: JSON.stringify({
      // The settings model is an Ollama tag; the gateway's model is LLM_MODEL.
      model: config.model,
      messages: options.messages,
      stream: !structured,
      max_tokens: config.maxTokens,
      // Ollama ran Vellum at the model's own default (qwen: 0.6). Same here.
      temperature: 0.6,
      ...(options.stop ? { stop: options.stop } : {}),
      ...(structured
        ? {
            response_format: {
              type: "json_schema",
              json_schema: { name: "output", schema: options.format },
            },
          }
        : {}),
    }),
    signal: options.signal,
  });

  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => "");
    throw new Error(`LLM HTTP ${res.status}: ${detail.slice(0, 300)}`);
  }

  if (structured) {
    const data = (await res.json()) as ChatChunk;
    if (data.error) throw new Error(`LLM error: ${errorText(data.error)}`);
    const content = data.choices?.[0]?.message?.content ?? "";
    if (content) options.onDelta(content);
    return content;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let raw = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newlineIdx: number;
    while ((newlineIdx = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newlineIdx).trim();
      buffer = buffer.slice(newlineIdx + 1);
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (payload === "[DONE]") return raw;
      let chunk: ChatChunk;
      try {
        chunk = JSON.parse(payload) as ChatChunk;
      } catch {
        continue;
      }
      if (chunk.error) throw new Error(`LLM error: ${errorText(chunk.error)}`);
      const delta = chunk.choices?.[0]?.delta?.content;
      if (delta) {
        raw += delta;
        options.onDelta(delta);
      }
    }
  }
  return raw;
}

/**
 * Health probe: is the server up and the key accepted? Returns the model that
 * will actually answer — for ANVE's "default", the model it resolves to.
 */
export async function probeOpenAI(
  config: OpenAIConfig,
): Promise<{ ok: boolean; model: string }> {
  try {
    const res = await fetch(`${config.baseUrl}/models`, {
      headers: headers(config),
      signal: AbortSignal.timeout(2500),
      cache: "no-store",
    });
    if (!res.ok) return { ok: false, model: config.model };
    const data = (await res.json()) as {
      data?: Array<{ id: string; anve?: { resolves_to?: string } }>;
    };
    const entry = data.data?.find((m) => m.id === config.model);
    return { ok: true, model: entry?.anve?.resolves_to || config.model };
  } catch {
    return { ok: false, model: config.model };
  }
}
