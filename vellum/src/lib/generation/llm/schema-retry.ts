/**
 * Structured output with validation-feedback retries.
 *
 * Ported pattern from Presenton (Apache-2.0) servers/fastapi/utils/
 * llm_utils.py `generate_structured_with_schema_retries` — see
 * THIRD_PARTY_LICENSES.md. Inner loop retries parse failures with backoff;
 * outer loop re-prompts with the validation errors appended.
 */
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { chatOnce, type ChatMessage } from "./ollama";

export async function generateStructuredWithRetries<T>(options: {
  baseUrl: string;
  model: string;
  messages: ChatMessage[];
  schema: z.ZodType<T>;
  parseRetries?: number;
  validationLoops?: number;
  signal?: AbortSignal;
}): Promise<T> {
  const parseRetries = options.parseRetries ?? 3;
  const validationLoops = options.validationLoops ?? 4;
  const jsonSchema = zodToJsonSchema(options.schema, {
    $refStrategy: "none",
  }) as object;

  const conversation: ChatMessage[] = [...options.messages];
  let lastError = "unknown error";

  for (let loop = 0; loop < validationLoops; loop++) {
    let raw = "";
    for (let attempt = 0; attempt < parseRetries; attempt++) {
      try {
        raw = await chatOnce({
          baseUrl: options.baseUrl,
          model: options.model,
          think: false,
          format: jsonSchema,
          messages: conversation,
          signal: options.signal,
        });
        break;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        if (attempt === parseRetries - 1) throw new Error(lastError);
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
      }
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      conversation.push(
        { role: "assistant", content: raw },
        {
          role: "user",
          content:
            "That response was not valid JSON. Return ONLY a valid JSON object matching the schema.",
        },
      );
      lastError = "model returned invalid JSON";
      continue;
    }

    const result = options.schema.safeParse(parsed);
    if (result.success) return result.data;

    lastError = result.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    conversation.push(
      { role: "assistant", content: raw },
      {
        role: "user",
        content: `The JSON failed validation with these errors:\n${lastError}\nReturn a corrected JSON object that fixes every error. Output only the JSON.`,
      },
    );
  }
  throw new Error(`Structured generation failed after retries: ${lastError}`);
}
