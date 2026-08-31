/**
 * Thin 1:1 bindings onto Vellum's HTTP API.
 *
 * Rules for this layer:
 *   - no business logic, no polling loops, no composition
 *   - argument and return shapes mirror the wire exactly
 *   - every non-idempotent call is marked so the client does not retry it
 *
 * Composition lives in `domain/`.
 */
import type { VellumClient } from "../client.js";
import type {
  AssetsResponse,
  DocumentDetail,
  DocumentKind,
  DocumentSummary,
  ExportFormat,
  GenParams,
  HealthResponse,
  IconHit,
  ImportResult,
  WritableDocumentStatus,
} from "../types.js";

/* -------------------------------------------------------------------------- */
/* System                                                                      */
/* -------------------------------------------------------------------------- */

/** `ok` is db && ollama only — it deliberately ignores searxng and comfyui. */
export const getHealth = (c: VellumClient, signal?: AbortSignal) =>
  c.json<HealthResponse>("/api/health", { retryable: true, signal });

/** Returns the full settings object INCLUDING plaintext API keys. Always redact. */
export const getSettings = (c: VellumClient, signal?: AbortSignal) =>
  c.json<Record<string, unknown>>("/api/settings", { retryable: true, signal });

/**
 * Merges per top-level group. Note this mutates GLOBAL state shared with every
 * other client of the Vellum instance, including its web UI.
 */
export const updateSettings = (
  c: VellumClient,
  patch: Record<string, unknown>,
  signal?: AbortSignal,
) => c.json<Record<string, unknown>>("/api/settings", { method: "PUT", body: patch, signal });

export const searchIcons = (c: VellumClient, q: string, k = 12, signal?: AbortSignal) =>
  c.json<IconHit[]>(`/api/icons/search?q=${encodeURIComponent(q)}&k=${k}`, {
    retryable: true,
    signal,
  });

/* -------------------------------------------------------------------------- */
/* Documents                                                                   */
/* -------------------------------------------------------------------------- */

/** Bare array, `updatedAt desc`, 7 projected columns, no pagination. */
export const listDocuments = (c: VellumClient, signal?: AbortSignal) =>
  c.json<DocumentSummary[]>("/api/documents", { retryable: true, signal });

/** Every column plus the joined theme. Median 30 KB — project before returning. */
export const getDocument = (c: VellumClient, id: string, signal?: AbortSignal) =>
  c.json<DocumentDetail>(`/api/documents/${id}`, { retryable: true, signal });

export interface CreateDocumentInput {
  kind: DocumentKind;
  prompt: string;
  templateId?: string;
  useBrandTheme?: boolean;
  genParams?: GenParams;
}

export const createDocument = (c: VellumClient, input: CreateDocumentInput, signal?: AbortSignal) =>
  c.json<DocumentDetail>("/api/documents", { method: "POST", body: input, signal });

export interface PatchDocumentInput {
  title?: string;
  outline?: string;
  /** JSON string of PlateSlide[]. Vellum validates only that it parses. */
  slides?: string;
  themeName?: string;
  customThemeId?: string | null;
  /** JSON *string*. REPLACES rather than merges. */
  genParams?: string;
  researchContext?: string;
  /** "reviewing" is not an accepted target, though a doc may currently be in it. */
  status?: WritableDocumentStatus;
}

export const patchDocument = (
  c: VellumClient,
  id: string,
  patch: PatchDocumentInput,
  signal?: AbortSignal,
) => c.json<DocumentDetail>(`/api/documents/${id}`, { method: "PATCH", body: patch, signal });

export const deleteDocument = (c: VellumClient, id: string, signal?: AbortSignal) =>
  c.json<{ ok: boolean; gc: unknown }>(`/api/documents/${id}`, { method: "DELETE", signal });

export const duplicateDocument = (c: VellumClient, id: string, signal?: AbortSignal) =>
  c.json<DocumentDetail>(`/api/documents/${id}/duplicate`, { method: "POST", signal });

export const applyBrandTheme = (c: VellumClient, id: string, signal?: AbortSignal) =>
  c.json<{ customThemeId: string; name: string }>(`/api/documents/${id}/brand-theme`, {
    method: "POST",
    signal,
  });

/** Fire-and-forget. Read the report back from GET /api/documents/{id}. */
export const startQualityCheck = (c: VellumClient, id: string, signal?: AbortSignal) =>
  c.json<{ started: boolean; reason?: string }>(`/api/documents/${id}/quality`, {
    method: "POST",
    signal,
  });

/* -------------------------------------------------------------------------- */
/* Assets                                                                      */
/* -------------------------------------------------------------------------- */

/** Also kicks the image queue as a side effect — polling is load-bearing. */
export const getAssets = (c: VellumClient, id: string, signal?: AbortSignal) =>
  c.json<AssetsResponse>(`/api/documents/${id}/assets`, { retryable: true, signal });

/** Flips every `failed` job back to `pending` and kicks the queue. */
export const retryFailedImages = (c: VellumClient, id: string, signal?: AbortSignal) =>
  c.json<{ retried: number }>(`/api/documents/${id}/assets`, { method: "POST", signal });

export const queueSlideImage = (
  c: VellumClient,
  id: string,
  input: { slideId: string; nodeId?: string; prompt: string },
  signal?: AbortSignal,
) => c.json<{ jobId: string }>(`/api/documents/${id}/images`, { method: "POST", body: input, signal });

/** Synchronous one-off generation; bypasses the queue entirely. */
export const generateImage = (
  c: VellumClient,
  input: { prompt: string; shape?: "16x9" | "square"; model?: string },
  signal?: AbortSignal,
) =>
  c.json<{ url: string; seconds: number; provider: string }>("/api/images/generate", {
    method: "POST",
    body: input,
    signal,
  });

export const uploadImage = (c: VellumClient, form: FormData, signal?: AbortSignal) =>
  c.json<{ url: string }>("/api/images/upload", { method: "POST", form, signal });

/* -------------------------------------------------------------------------- */
/* Generation (SSE)                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Does NOT take Vellum's generation lock.
 *
 * `timeoutMs: 0` disables the fetch deadline deliberately: a deadline here would
 * abort the generation mid-stream. The domain layer runs an inter-byte watchdog
 * and aborts through `signal` instead.
 */
export const streamOutline = (c: VellumClient, documentId: string, signal?: AbortSignal) =>
  c.stream("/api/generation/outline", {
    method: "POST",
    body: { documentId },
    signal,
    timeoutMs: 0,
  });

/** TAKES the process-global generation lock. 409 on contention. See above re timeoutMs. */
export const streamContent = (c: VellumClient, documentId: string, signal?: AbortSignal) =>
  c.stream("/api/generation/content", {
    method: "POST",
    body: { documentId },
    signal,
    timeoutMs: 0,
  });

/** TAKES the lock. Blocking JSON, not SSE. maxDuration 300s. */
export const regenerateSlide = (
  c: VellumClient,
  input: { documentId: string; slideId: string; instruction?: string },
  signal?: AbortSignal,
  timeoutMs?: number,
) =>
  c.json<{ slide: unknown; imageCount: number }>("/api/generation/slide", {
    method: "POST",
    body: input,
    signal,
    timeoutMs,
  });

/** Does NOT take the lock, but does hit Ollama — serialize it anyway. */
export const generateTheme = (
  c: VellumClient,
  input: { documentId: string; hint?: string },
  signal?: AbortSignal,
  timeoutMs?: number,
) =>
  c.json<{ id: string; theme: Record<string, unknown> }>("/api/generation/theme", {
    method: "POST",
    body: input,
    signal,
    timeoutMs,
  });

/* -------------------------------------------------------------------------- */
/* Content input                                                               */
/* -------------------------------------------------------------------------- */

/** Extracts text only — does NOT create a document. 25 MB cap. */
export const importText = (
  c: VellumClient,
  input: { text: string; filename?: string },
  signal?: AbortSignal,
) => c.json<ImportResult>("/api/import", { method: "POST", body: input, signal });

export const importFile = (c: VellumClient, form: FormData, signal?: AbortSignal) =>
  c.json<ImportResult>("/api/import", { method: "POST", form, signal });

/** Mutates the GLOBAL brand kit in settings. */
export const setBrandFromUrl = (c: VellumClient, url: string, signal?: AbortSignal) =>
  c.json<Record<string, unknown>>("/api/brand", { method: "POST", body: { url }, signal });

export const setBrandFromUpload = (c: VellumClient, form: FormData, signal?: AbortSignal) =>
  c.json<Record<string, unknown>>("/api/brand", { method: "POST", form, signal });

/* -------------------------------------------------------------------------- */
/* Export                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Returns raw bytes. All three formats drive headless Chromium, so "try a
 * different format" is never valid remediation for a Playwright failure.
 */
export const exportDocument = (
  c: VellumClient,
  format: ExportFormat,
  id: string,
  signal?: AbortSignal,
  timeoutMs?: number,
) => c.binary(`/api/export/${format}/${id}`, { signal, timeoutMs });
