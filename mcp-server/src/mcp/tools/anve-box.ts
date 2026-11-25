/**
 * The two tools ANVE Box's cloud uses to make decks in this Vellum, served on
 * an endpoint of their own (VELLUM_MCP_TOOLSET=anve-box) and never alongside
 * the full set, so a public endpoint lists nothing that deletes or
 * reconfigures.
 *
 * Written to ANVE's brief:
 *   - start_presentation answers within seconds with an id; the deck takes
 *     minutes. Every option has a default, and the fixed choices are enums
 *     with their meaning spelled out, so ANVE's assistant can ask the person
 *     ("visual or detailed?") rather than guess.
 *   - check_presentation is read-only: working, done or failed.
 *   - Descriptions stay under 500 characters, which is all ANVE shows its
 *     model.
 *   - A busy Vellum never makes the start wait: the answer says the deck is
 *     queued and how many are ahead, or that the queue is full.
 *
 * ANVE's local integration pins the full set's definitions, so these are new
 * tools rather than changes to generate_presentation and
 * get_generation_status. They drive the same pipeline.
 */
import { z } from "zod";
import type { ToolDefinition } from "../tool.js";
import type { Services } from "../../domain/services.js";
import type { JobRecord } from "../../domain/jobs.js";
import type { GenerateInput, GenerateResult } from "../../domain/presentations.js";
import { TEMPLATES, TEXT_DENSITIES } from "../../domain/templates.js";
import { busy, generationFailed, VellumMcpError } from "../../infra/errors.js";
import { sleep } from "../../infra/retry.js";
import { sinkFor } from "./index.js";

const DECK_TEMPLATES = TEMPLATES.filter((t) => t.kind === "deck");

/** "general" is no template: the topic alone shapes the deck. */
export const STYLES = ["general", ...DECK_TEMPLATES.map((t) => t.id)] as [string, ...string[]];

/** The New page's tones, in its order; its default is the first. */
export const TONES = ["professional", "casual", "persuasive", "academic"] as const;

/** Vellum's own default and limits for a deck's length (the New page: 8, 1-30). */
export const DEFAULT_SLIDES = 8;
const MIN_SLIDES = 1;
const MAX_SLIDES = 30;

/**
 * How long the start waits for Vellum to create the document, whose id is the
 * durable handle: Vellum keeps it, where a restart of this server loses its
 * job records. Creating it is one small request. The brief gives the start "a
 * few seconds"; past this the job id is returned instead, which
 * check_presentation also accepts.
 */
const DOCUMENT_WAIT_MS = 3_000;
const DOCUMENT_POLL_MS = 25;

/**
 * Minutes one deck holds Vellum's generation slot, for the waits an answer
 * quotes. Eight test decks of 9-12 slides on this machine took 43-67 seconds
 * each from outline to saved slides (17 Oct 2026). Pictures are drawn
 * afterwards and do not hold the slot.
 */
const MINUTES_PER_DECK = 1;

/** A failure reason is one line a person reads in a chat bubble. */
const REASON_MAX_CHARS = 300;

const STYLE_HELP =
  "The kind of deck. general: no template, the topic shapes it (default). " +
  DECK_TEMPLATES.map((t) => `${t.id}: ${t.summary.replace(/\.$/, "")}`).join(". ") +
  ".";

const DETAIL_HELP =
  "How much text per slide. minimal: visual, a few words per point. concise: one short " +
  "sentence per point (default). detailed: points with supporting detail. extensive: full " +
  "context, readable without a presenter.";

/* -------------------------------------------------------------------------- */

type PresentationState =
  | {
      id: string;
      status: "working";
      stage: string;
      progress?: string;
      queued?: true;
      ahead?: number;
    }
  | { id: string; status: "done"; documentId: string; title: string; slides: number }
  | { id: string; status: "failed"; reason: string };

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function failed(id: string, reason: string | null | undefined): PresentationState {
  const line = ((reason ?? "").split(/\r?\n/)[0] ?? "").trim().slice(0, REASON_MAX_CHARS);
  return { id, status: "failed", reason: line || "It failed without saying why." };
}

function done(
  id: string,
  doc: { documentId: string; title: string; slideCount?: number },
): PresentationState {
  return { id, status: "done", documentId: doc.documentId, title: doc.title, slides: doc.slideCount ?? 0 };
}

function working(id: string, job: JobRecord, s: Services): PresentationState {
  const ahead = job.documentId
    ? s.mutex.aheadOf((label) => label.endsWith(`:${job.documentId}`))
    : 0;
  if (ahead > 0) {
    return {
      id,
      status: "working",
      queued: true,
      ahead,
      stage: `Waiting for ${plural(ahead, "deck")} ahead of it.`,
    };
  }
  return {
    id,
    status: "working",
    stage: job.statusMessage ?? "Starting.",
    ...(job.progress ? { progress: `${job.progress.current} of ${job.progress.total} slides` } : {}),
  };
}

/** The newest start_presentation job for an id — a job id or a document id. */
function findJob(id: string, s: Services): JobRecord | undefined {
  const byJobId = s.jobs.get(id);
  if (byJobId) return byJobId;
  return s.jobs
    .list()
    .filter((j) => j.documentId === id)
    .sort((a, b) => b.createdAt - a.createdAt)[0];
}

async function readStatus(documentId: string, s: Services, signal: AbortSignal) {
  try {
    return await s.documents.status(documentId, signal);
  } catch (err) {
    if ((err as { kind?: string }).kind === "not_found") return undefined;
    throw err;
  }
}

async function checkPresentation(
  id: string,
  s: Services,
  signal: AbortSignal,
): Promise<PresentationState> {
  const job = findJob(id, s);
  const documentId = job ? job.documentId : id;

  if (job?.status === "failed") return failed(id, job.error?.message);
  if (job?.status === "cancelled") return failed(id, "It was cancelled.");
  const result = job?.status === "completed" ? (job.result as GenerateResult | undefined) : undefined;
  if (result?.phase === "failed") return failed(id, result.errorMessage);

  const doc = documentId ? await readStatus(documentId, s, signal) : undefined;
  // Done once every slide is saved, even while pictures are still being drawn.
  if (doc && (doc.status === "ready" || doc.status === "reviewing") && doc.slideCount > 0 && !doc.truncated) {
    return done(id, doc);
  }
  if (result) return done(id, result);
  if (job?.status === "working") return working(id, job, s);

  // No job record: this server restarted, or the record expired. Vellum's own
  // record says the rest.
  if (!doc) {
    throw new VellumMcpError({
      kind: "not_found",
      message: `No presentation has the id "${id}". Use the id start_presentation returned.`,
      details: { id },
    });
  }
  if (doc.status === "error") return failed(id, doc.errorMessage);
  if (doc.status === "outlining" || doc.status === "generating") {
    return { id, status: "working", stage: "Vellum is writing it." };
  }
  if (doc.slideCount > 0) {
    return failed(
      id,
      `It stopped before it finished: ${doc.slideCount} of ${doc.cardCount} slides were made.`,
    );
  }
  return failed(id, "It stopped before it finished. Start it again.");
}

/** Wait briefly for the document row, whose id outlives this server's job records. */
async function documentIdOf(job: JobRecord): Promise<string | undefined> {
  const until = Date.now() + DOCUMENT_WAIT_MS;
  while (!job.documentId && job.status === "working" && Date.now() < until) {
    await sleep(DOCUMENT_POLL_MS);
  }
  return job.documentId;
}

async function startPresentation(
  a: Record<string, unknown>,
  s: Services,
  signal: AbortSignal,
): Promise<PresentationState & { message?: string }> {
  const requestId = a.requestId as string | undefined;
  const key = requestId ? `anve-box:${requestId}` : undefined;

  // The same request again: the same deck, as it stands now.
  const repeat = key ? s.jobs.list().find((j) => j.key === key) : undefined;
  if (repeat) return checkPresentation(repeat.documentId ?? repeat.jobId, s, signal);

  // Never wait: a full queue is refused at once, with the wait it would take.
  const ahead = (s.mutex.isHeld ? 1 : 0) + s.mutex.depth;
  if (s.mutex.depth >= s.config.queueDepth) {
    throw busy(
      `busy: ${plural(ahead, "deck")} are being made or waiting; try again in about ` +
        `${plural(ahead * MINUTES_PER_DECK, "minute")}.`,
    );
  }

  const style = (a.style as string | undefined) ?? "general";
  const audience = (a.audience as string | undefined)?.trim();
  const input: GenerateInput = {
    prompt: a.topic as string,
    kind: "deck",
    ...(style !== "general" ? { templateId: style } : {}),
    genParams: {
      nCards: (a.slides as number | undefined) ?? DEFAULT_SLIDES,
      language: (a.language as string | undefined) ?? "English",
      tone: (a.tone as string | undefined) ?? TONES[0],
      textDensity: (a.detail as (typeof TEXT_DENSITIES)[number] | undefined) ?? "concise",
      ...(audience ? { audience } : {}),
    },
    // Another client may be generating: wait for Vellum's slot as long as a
    // queued run is allowed to wait for this server's.
    busyRetryMs: s.config.queueWaitMs,
  };

  const job = s.jobs.start(
    "start_presentation",
    (record, jobSignal) => s.presentations.generate(input, jobSignal, sinkFor(record)),
    key ? { key } : {},
  );
  const documentId = await documentIdOf(job);
  if (job.status === "failed") {
    throw generationFailed(job.error?.message ?? "it could not start.", { stage: "start" });
  }

  const id = documentId ?? job.jobId;
  const next = "Call check_presentation with this id every 15-30 seconds until it says done or failed.";
  if (ahead > 0) {
    return {
      id,
      status: "working",
      queued: true,
      ahead,
      stage: `Waiting for ${plural(ahead, "deck")} ahead of it.`,
      message:
        `Queued behind ${plural(ahead, "other deck")}; it should start in about ` +
        `${plural(ahead * MINUTES_PER_DECK, "minute")}. ${next}`,
    };
  }
  return { id, status: "working", stage: "Starting.", message: `Started. ${next}` };
}

/* -------------------------------------------------------------------------- */

export const ANVE_BOX_TOOLS: ToolDefinition[] = [
  {
    name: "start_presentation",
    title: "Start a presentation",
    description:
      "Start making a slide deck in Vellum. Answers within seconds with an id; the deck takes " +
      "a few minutes, so call check_presentation with that id every 15-30 seconds until it says " +
      "done or failed. Every option has a default: ask the person only what matters to them, " +
      "such as the style, how detailed (visual or text-heavy) and how many slides. Vellum makes " +
      "one deck at a time; if others are waiting, this one is queued and the answer says so.",
    inputSchema: {
      topic: z
        .string()
        .min(1)
        .max(4000)
        .describe("What the deck is about, in the person's words, with any facts, figures or names they gave."),
      slides: z
        .number()
        .int()
        .min(MIN_SLIDES)
        .max(MAX_SLIDES)
        .default(DEFAULT_SLIDES)
        .describe(`How many slides, ${MIN_SLIDES}-${MAX_SLIDES}.`),
      style: z.enum(STYLES).default("general").describe(STYLE_HELP),
      detail: z.enum(TEXT_DENSITIES).default("concise").describe(DETAIL_HELP),
      tone: z.enum(TONES).default(TONES[0]).describe("How the deck sounds."),
      audience: z
        .string()
        .max(200)
        .optional()
        .describe('Who will watch it, e.g. "new hires" or "hospital buyers". Default: no particular audience.'),
      language: z.string().min(2).max(40).default("English").describe("The language the slides are written in."),
      requestId: z
        .string()
        .min(1)
        .max(200)
        .optional()
        .describe("Your id for this request. Sending the same id again returns the same deck instead of starting another."),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    handler: (a, ctx, s) => startPresentation(a, s, ctx.signal),
  },

  {
    name: "check_presentation",
    title: "Check a presentation",
    description:
      "Check a deck started with start_presentation. Answers working (with what it is doing " +
      "now, or how many decks are ahead of it), done (with the deck's title and slide count) or " +
      "failed (with a one-line reason). Read-only: call it every 15-30 seconds until done or failed.",
    inputSchema: {
      id: z.string().min(1).max(200).describe("The id start_presentation returned."),
    },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    handler: (a, ctx, s) => checkPresentation(a.id as string, s, ctx.signal),
  },
];
