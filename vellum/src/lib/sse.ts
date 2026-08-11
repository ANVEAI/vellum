/**
 * SSE response helper with heartbeats.
 *
 * Long LLM calls can sit silent for 30-60s; some layer in any stack may treat
 * that silence as a dead connection (a failure mode debugged extensively on
 * this machine). A `: ping` comment every 5s keeps bytes flowing; EventSource
 * clients ignore comment lines.
 */

export interface SseWriter {
  /** Send a named event with JSON data. */
  event(type: string, data: unknown): void;
  /** Close the stream (idempotent). */
  close(): void;
  readonly closed: boolean;
}

export function sseResponse(
  run: (writer: SseWriter) => Promise<void>,
  init?: { signal?: AbortSignal },
): Response {
  const encoder = new TextEncoder();
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const writer: SseWriter = {
        event(type, data) {
          if (closed) return;
          controller.enqueue(
            encoder.encode(
              `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`,
            ),
          );
        },
        close() {
          if (closed) return;
          closed = true;
          if (heartbeat) clearInterval(heartbeat);
          try {
            controller.close();
          } catch {
            // already closed by cancel
          }
        },
        get closed() {
          return closed;
        },
      };

      heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`));
        } catch {
          closed = true;
          if (heartbeat) clearInterval(heartbeat);
        }
      }, 5000);

      init?.signal?.addEventListener("abort", () => writer.close());

      run(writer)
        .catch((error) => {
          writer.event("error", {
            detail: error instanceof Error ? error.message : String(error),
          });
        })
        .finally(() => writer.close());
    },
    cancel() {
      closed = true;
      if (heartbeat) clearInterval(heartbeat);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
