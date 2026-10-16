import type { PlateSlide } from "@/lib/generation/parser/slide-parser";
import type { Descendant, TElement } from "@/lib/slides/plate-shim";
import { walkNodes } from "@/lib/slides/walk";

/** One generated image per (slide, node). */
export function imageSlotKey(
  slideId: string | null | undefined,
  nodeId: string | null | undefined,
): string {
  return `${slideId ?? ""}|${nodeId ?? ""}`;
}

interface SlotJob {
  id: string;
  slideId: string | null;
  nodeId: string | null;
  createdAt: Date;
}

/**
 * The newest job for each image slot. Only that job may write the slot.
 *
 * A slot can collect several jobs. The quality gate regenerates a slide but
 * keeps its id, and a root image's node id is the constant "__root__", so a
 * job queued for the slide's ORIGINAL content still points at the same slot
 * after the content changed. With no ordering rule, whichever job finished
 * last won — a deck shipped a slide whose image query asked for "a soft
 * violet glow" displaying a picture generated for "a smartphone screen
 * showing maps and a banking interface", gibberish lettering included,
 * because that was the pre-regeneration prompt.
 *
 * Comparing the job's prompt to the node's current query would not work:
 * the editor's regenerate-image action deliberately sends a NEW prompt for
 * the same slot. Recency is the rule that covers both. Ties on createdAt
 * (one createMany batch) fall back to the id, which sorts by creation.
 */
export function newestJobPerSlot<T extends SlotJob>(jobs: T[]): Map<string, T> {
  const newest = new Map<string, T>();
  for (const job of jobs) {
    const key = imageSlotKey(job.slideId, job.nodeId);
    const held = newest.get(key);
    if (
      !held ||
      job.createdAt.getTime() > held.createdAt.getTime() ||
      (job.createdAt.getTime() === held.createdAt.getTime() && job.id > held.id)
    ) {
      newest.set(key, job);
    }
  }
  return newest;
}

/**
 * Set a generated image URL on its target node inside a slides array
 * (mutates in place). nodeId "__root__" targets slide.rootImage; otherwise
 * matches an img node by id, falling back to first query match.
 */
export function applyImageToSlides(
  slides: PlateSlide[],
  slideId: string,
  nodeId: string | null | undefined,
  query: string,
  url: string,
): boolean {
  const slide = slides.find((s) => s.id === slideId);
  if (!slide) return false;

  if (nodeId === "__root__") {
    // Fill only a slot the slide still has. When the quality gate rewrites a
    // slide without an image, a job queued for its ORIGINAL content can still
    // finish — and this used to conjure a root image out of nothing to hold
    // it, so three slides shipped pictures their content never asked for.
    // Recency cannot catch that case: with no image wanted there is no newer
    // job for the slot. The editor's add-image route creates the slot when it
    // queues the job, so a deliberate new image always has somewhere to land.
    const root = slide.rootImage as { query?: string; url?: string } | undefined;
    if (!root || !(root.query || root.url)) return false;
    slide.rootImage = { ...root, url } as PlateSlide["rootImage"];
    return true;
  }

  let applied = false;
  walkNodes(slide.content as Descendant[], (node: TElement) => {
    if (applied || node.type !== "img") return;
    const matchesId = nodeId && node.id === nodeId;
    const matchesQuery =
      !nodeId && typeof node.query === "string" && node.query === query;
    if (matchesId || matchesQuery) {
      node.url = url;
      applied = true;
    }
  });
  return applied;
}
