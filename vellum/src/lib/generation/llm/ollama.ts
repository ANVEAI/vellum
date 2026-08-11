/**
 * Minimal Ollama client (native /api/chat) with streaming, think-toggle, and
 * abort support. Plain fetch — no SDK — so we control flush/heartbeat timing.
 */

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface OllamaStreamOptions {
  baseUrl: string;
  model: string;
  messages: ChatMessage[];
  think?: boolean;
  /** JSON schema for structured output (Ollama `format`). */
  format?: object;
  stop?: string[];
  signal?: AbortSignal;
  /** Called for every content delta. */
  onDelta: (delta: string) => void;
}

interface OllamaChatChunk {
  message?: { role: string; content?: string; thinking?: string };
  done?: boolean;
  error?: string;
}

/**
 * Stream a chat completion. Resolves with the full accumulated content.
 * `thinking` channel output (qwen3 etc.) is discarded — only real content is
 * forwarded — and stripThink() is applied as a belt-and-braces safety net for
 * models that inline <think> blocks in content.
 */
export async function streamChat(options: OllamaStreamOptions): Promise<string> {
  const res = await fetch(`${options.baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: options.model,
      messages: options.messages,
      stream: true,
      think: options.think ?? false,
      ...(options.format ? { format: options.format } : {}),
      ...(options.stop ? { options: { stop: options.stop } } : {}),
    }),
    signal: options.signal,
  });

  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Ollama HTTP ${res.status}: ${detail.slice(0, 300)}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let lineBuffer = "";
  let raw = "";

  const stripper = createThinkStripper();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    lineBuffer += decoder.decode(value, { stream: true });

    let newlineIdx: number;
    while ((newlineIdx = lineBuffer.indexOf("\n")) !== -1) {
      const line = lineBuffer.slice(0, newlineIdx).trim();
      lineBuffer = lineBuffer.slice(newlineIdx + 1);
      if (!line) continue;
      let parsed: OllamaChatChunk;
      try {
        parsed = JSON.parse(line) as OllamaChatChunk;
      } catch {
        continue;
      }
      if (parsed.error) throw new Error(`Ollama error: ${parsed.error}`);
      const content = parsed.message?.content;
      if (content) {
        const visible = stripper.push(content);
        if (visible) {
          raw += visible;
          options.onDelta(visible);
        }
      }
    }
  }

  const tail = stripper.flush();
  if (tail) {
    raw += tail;
    options.onDelta(tail);
  }
  return raw;
}

/** Non-streaming structured/one-shot call; returns full content string. */
export async function chatOnce(
  options: Omit<OllamaStreamOptions, "onDelta">,
): Promise<string> {
  let out = "";
  await streamChat({ ...options, onDelta: (d) => (out += d) });
  return out;
}

/**
 * Incremental <think>...</think> remover that works across chunk boundaries.
 * Holds back text from an unmatched "<think" opener until its close tag (or
 * flush) arrives; passes everything else through immediately.
 */
export function createThinkStripper() {
  let inThink = false;
  let pending = ""; // partial tag prefix we can't classify yet

  const OPEN = "<think>";
  const CLOSE = "</think>";

  function push(chunk: string): string {
    let text = pending + chunk;
    pending = "";
    let out = "";

    while (text.length > 0) {
      if (inThink) {
        const closeIdx = text.indexOf(CLOSE);
        if (closeIdx === -1) {
          // keep waiting; retain a possible partial close tag
          const keep = Math.max(0, text.length - (CLOSE.length - 1));
          // inside think block: discard
          pending = text.slice(keep);
          return out;
        }
        inThink = false;
        text = text.slice(closeIdx + CLOSE.length);
        continue;
      }

      const openIdx = text.indexOf(OPEN);
      if (openIdx !== -1) {
        out += text.slice(0, openIdx);
        inThink = true;
        text = text.slice(openIdx + OPEN.length);
        continue;
      }

      // No full opener; check for a partial "<think" prefix at the tail.
      const tailStart = Math.max(0, text.length - (OPEN.length - 1));
      let splitAt = text.length;
      for (let i = tailStart; i < text.length; i++) {
        const candidate = text.slice(i);
        if (OPEN.startsWith(candidate)) {
          splitAt = i;
          break;
        }
      }
      out += text.slice(0, splitAt);
      pending = text.slice(splitAt);
      return out;
    }
    return out;
  }

  function flush(): string {
    // Unterminated think block at stream end: drop it (it was reasoning).
    const rest = inThink ? "" : pending;
    pending = "";
    inThink = false;
    return rest;
  }

  return { push, flush };
}

export async function listModels(baseUrl: string): Promise<string[]> {
  const res = await fetch(`${baseUrl}/api/tags`, {
    signal: AbortSignal.timeout(2500),
    cache: "no-store",
  });
  if (!res.ok) return [];
  const data = (await res.json()) as { models?: Array<{ name: string }> };
  return (data.models ?? []).map((m) => m.name);
}
