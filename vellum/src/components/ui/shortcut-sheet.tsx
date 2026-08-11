"use client";

/** Keyboard reference, opened with `?`. */
import { Dialog } from "./primitives";

export interface ShortcutGroup {
  title: string;
  items: Array<[keys: string, what: string]>;
}

export function ShortcutSheet({
  open,
  onClose,
  groups,
}: {
  open: boolean;
  onClose: () => void;
  groups: ShortcutGroup[];
}) {
  return (
    <Dialog open={open} onClose={onClose} title="Keyboard shortcuts" width={520}>
      <div className="grid gap-5 sm:grid-cols-2">
        {groups.map((group) => (
          <section key={group.title}>
            <h3 className="t-eyebrow mb-2 text-ink-3">{group.title}</h3>
            <dl className="space-y-1.5">
              {group.items.map(([keys, what]) => (
                <div key={keys} className="flex items-baseline justify-between gap-4">
                  <dt className="t-caption text-ink-2">{what}</dt>
                  <dd className="t-caption shrink-0 font-medium tabular-nums">{keys}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Dialog>
  );
}

/** Platform-correct modifier glyph, resolved once on the client. */
export function modKey(): string {
  if (typeof navigator === "undefined") return "Ctrl";
  return /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl";
}
