/**
 * In-process generation lock. Local Ollama at full context runs one request
 * at a time anyway; serializing generations gives honest UX (409 with a
 * clear message) instead of silent queueing behind an invisible LLM queue.
 */

let holder: string | null = null;

export function acquireGenerationLock(owner: string): boolean {
  if (holder !== null) return false;
  holder = owner;
  return true;
}

export function releaseGenerationLock(owner: string): void {
  if (holder === owner) holder = null;
}

export function generationLockHolder(): string | null {
  return holder;
}
