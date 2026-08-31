/**
 * The mutex that serializes everything touching Vellum's single generation slot.
 */
import { describe, expect, it } from "vitest";
import { GenerationMutex } from "../../src/domain/mutex.js";
import { nullLogger } from "../../src/infra/logger.js";

const make = (maxDepth = 4, maxWaitMs = 1000) =>
  new GenerationMutex({ maxDepth, maxWaitMs, logger: nullLogger });

describe("GenerationMutex", () => {
  it("serializes in FIFO order", async () => {
    const m = make();
    const order: number[] = [];
    const first = await m.acquire("a");

    const rest = [1, 2, 3].map(async (n) => {
      const release = await m.acquire(`t${n}`);
      order.push(n);
      release();
    });

    first();
    await Promise.all(rest);
    expect(order).toEqual([1, 2, 3]);
  });

  it("never runs two holders at once", async () => {
    const m = make(8); // depth must exceed the contenders, or waiters are rejected by design
    let active = 0;
    let maxActive = 0;

    await Promise.all(
      Array.from({ length: 6 }, async () => {
        const release = await m.acquire("x");
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 5));
        active--;
        release();
      }),
    );
    expect(maxActive).toBe(1);
  });

  it("rejects immediately past the queue depth rather than blocking", async () => {
    const m = make(2);
    const held = await m.acquire("holder");
    const queued = [m.acquire("q1"), m.acquire("q2")];
    await expect(m.acquire("q3")).rejects.toMatchObject({ kind: "busy" });
    held();
    await Promise.all(queued.map(async (p) => (await p)()));
  });

  it("rejects a waiter that exceeds the wait budget", async () => {
    const m = make(4, 50);
    const held = await m.acquire("holder");
    await expect(m.acquire("slow")).rejects.toMatchObject({ kind: "timeout" });
    held();
  });

  it("removes a queued waiter when its caller aborts", async () => {
    const m = make();
    const held = await m.acquire("holder");
    const controller = new AbortController();
    const queued = m.acquire("aborted", controller.signal);
    controller.abort();
    await expect(queued).rejects.toThrow(/Abort/i);
    held();
    // The slot must be usable afterwards — an abandoned waiter must not wedge it.
    const next = await m.acquire("next");
    expect(m.isHeld).toBe(true);
    next();
  });

  it("reports how long the current holder has run", async () => {
    const m = make();
    const release = await m.acquire("long");
    await new Promise((r) => setTimeout(r, 20));
    expect(m.heldForMs).toBeGreaterThan(0);
    expect(m.holder).toBe("long");
    release();
    expect(m.isHeld).toBe(false);
  });
});
