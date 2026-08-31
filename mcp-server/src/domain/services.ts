/**
 * The service surface the MCP layer consumes.
 *
 * The MCP layer imports THIS and never `vellum/` directly. That is what keeps
 * the tool definitions free of HTTP knowledge and the domain testable without
 * a protocol harness.
 */
import * as api from "../vellum/endpoints/index.js";
import type { VellumClient } from "../vellum/client.js";
import type { Config } from "../infra/config.js";
import type { Logger } from "../infra/logger.js";
import { PRESENT } from "../infra/redact.js";
import { DocumentService } from "./documents.js";
import { ExportService } from "./exports.js";
import { PresentationService } from "./presentations.js";
import { GenerationMutex } from "./mutex.js";
import { JobRegistry } from "./jobs.js";
import { summarizeAssets, assetFailures } from "./projection.js";

export interface Services {
  config: Config;
  logger: Logger;
  client: VellumClient;
  mutex: GenerationMutex;
  jobs: JobRegistry;
  presentations: PresentationService;
  documents: DocumentService;
  exports: ExportService;
  assets: AssetService;
  system: SystemService;
}

/* -------------------------------------------------------------------------- */

export class AssetService {
  constructor(private readonly client: VellumClient) {}

  async status(documentId: string, signal: AbortSignal) {
    const assets = await api.getAssets(this.client, documentId, signal);
    return {
      documentId,
      ...summarizeAssets(assets),
      failures: assetFailures(assets),
    };
  }

  async retryFailed(documentId: string, signal: AbortSignal) {
    const { retried } = await api.retryFailedImages(this.client, documentId, signal);
    return { documentId, retried };
  }

  async requestSlideImage(
    documentId: string,
    input: { slideId: string; nodeId?: string; prompt: string },
    signal: AbortSignal,
  ) {
    const { jobId } = await api.queueSlideImage(this.client, documentId, input, signal);
    return {
      documentId,
      jobId,
      note: "Queued. Poll vellum.get_asset_status until pending reaches 0.",
    };
  }

  async generateStandalone(
    input: { prompt: string; shape?: "16x9" | "square"; model?: string },
    signal: AbortSignal,
  ) {
    return api.generateImage(this.client, input, signal);
  }
}

/* -------------------------------------------------------------------------- */

export class SystemService {
  constructor(
    private readonly client: VellumClient,
    private readonly mutex: GenerationMutex,
    private readonly config: Config,
  ) {}

  async health(signal: AbortSignal) {
    let vellum: unknown = null;
    let reachable = true;
    let error: string | undefined;

    try {
      vellum = await api.getHealth(this.client, signal);
    } catch (err) {
      reachable = false;
      error = err instanceof Error ? err.message : String(err);
    }

    const v = vellum as
      | { ok: boolean; services: Record<string, boolean>; settings: Record<string, string> }
      | null;
    const advisories: string[] = [];

    if (!reachable) {
      advisories.push(
        `Vellum is not reachable at ${this.config.vellumBaseUrl}. Generation and export will fail.`,
      );
    } else if (v) {
      if (!v.services.ollama) {
        advisories.push(
          "Ollama is down — every generation tool will fail after a long wait. Fix this first.",
        );
      }
      if (!v.services.comfyui && v.settings.imageProvider === "comfyui") {
        advisories.push("ComfyUI is down — slides will generate without images.");
      }
      if (!v.services.searxng) {
        advisories.push("SearXNG is down — outlines will be written without web research.");
      }
    }

    const heldMs = this.mutex.heldForMs;
    if (heldMs > 15 * 60_000) {
      advisories.push(
        `A generation has held this server's queue for ${Math.round(heldMs / 60_000)} minutes. ` +
          `Vellum's own lock has no timeout; if it has leaked, only restarting Vellum clears it.`,
      );
    }

    return {
      mcp: { ok: true, transport: this.config.transport, queueDepth: this.mutex.depth },
      vellumReachable: reachable,
      vellum: v,
      generation: {
        available: reachable && Boolean(v?.services.ollama) && !this.mutex.isHeld,
        busy: this.mutex.isHeld,
        holder: this.mutex.holder,
        heldForSeconds: Math.round(heldMs / 1000),
        queueDepth: this.mutex.depth,
      },
      vellumBaseUrl: this.config.vellumBaseUrl,
      advisories,
      ...(error ? { error } : {}),
    };
  }

  /**
   * Settings, projected through an ALLOWLIST.
   *
   * Vellum returns `geminiApiKey` and `pexelsApiKey` in plaintext. An allowlist
   * fails closed when Vellum adds another secret field; a denylist would fail
   * open. The keys are reported as configured-or-not, never by value.
   */
  async settings(signal: AbortSignal) {
    const raw = (await api.getSettings(this.client, signal)) as Record<string, any>;
    return {
      llm: {
        ollamaUrl: raw.llm?.ollamaUrl,
        model: raw.llm?.model,
        think: raw.llm?.think,
      },
      search: {
        enabled: raw.search?.enabled,
        searxngUrl: raw.search?.searxngUrl,
        maxResults: raw.search?.maxResults,
      },
      images: {
        provider: raw.images?.provider,
        comfyuiUrl: raw.images?.comfyuiUrl,
        comfyuiWorkflow: raw.images?.comfyuiWorkflow,
        comfyModel: raw.images?.comfyModel,
        geminiModel: raw.images?.geminiModel,
        geminiApiKey: raw.images?.geminiApiKey ? PRESENT : "",
        pexelsApiKey: raw.images?.pexelsApiKey ? PRESENT : "",
      },
      icons: { weight: raw.icons?.weight },
      brand: {
        name: raw.brand?.name,
        logoUrl: raw.brand?.logoUrl,
        colors: raw.brand?.colors ?? [],
      },
    };
  }

  async updateSettings(patch: Record<string, unknown>, signal: AbortSignal) {
    await api.updateSettings(this.client, patch, signal);
    return this.settings(signal);
  }

  async searchIcons(q: string, k: number, signal: AbortSignal) {
    const hits = await api.searchIcons(this.client, q, k, signal);
    return { query: q, count: hits.length, icons: hits };
  }

  async importSource(input: { text: string; filename?: string }, signal: AbortSignal) {
    const r = await api.importText(this.client, input, signal);
    return {
      ...r,
      note:
        "This extracted text only; no document was created. Pass it as `sourceText` to " +
        "vellum.generate_presentation to ground a generation on it.",
    };
  }
}

/* -------------------------------------------------------------------------- */

export function buildServices(
  config: Config,
  logger: Logger,
  client: VellumClient,
): Services {
  const mutex = new GenerationMutex({
    maxDepth: config.queueDepth,
    maxWaitMs: config.queueWaitMs,
    logger,
  });
  const jobs = new JobRegistry({
    ttlMs: config.jobTtlMs,
    maxJobs: config.maxJobs,
    logger,
  });

  return {
    config,
    logger,
    client,
    mutex,
    jobs,
    presentations: new PresentationService(client, mutex, logger),
    documents: new DocumentService(client, logger),
    exports: new ExportService(client, mutex, logger, {
      exportDir: config.exportDir,
      timeoutMs: config.exportTimeoutMs,
      ttlMs: config.artifactTtlMs,
      maxBytes: config.artifactMaxBytes,
    }),
    assets: new AssetService(client),
    system: new SystemService(client, mutex, config),
  };
}
