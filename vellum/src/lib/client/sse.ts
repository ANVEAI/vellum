/** Minimal SSE reader for fetch() POST streams. */

export interface SseEvent {
  type: string;
  data: unknown;
}

export async function* readSse(
  response: Response,
): AsyncGenerator<SseEvent, void, unknown> {
  if (!response.body) return;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let sep: number;
    while ((sep = buffer.indexOf("\n\n")) !== -1) {
      const block = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      let type = "message";
      let data = "";
      for (const line of block.split("\n")) {
        if (line.startsWith("event: ")) type = line.slice(7).trim();
        else if (line.startsWith("data: ")) data += line.slice(6);
        // comment lines (heartbeats) start with ":" and are ignored
      }
      if (!data) continue;
      try {
        yield { type, data: JSON.parse(data) };
      } catch {
        yield { type, data };
      }
    }
  }
}
