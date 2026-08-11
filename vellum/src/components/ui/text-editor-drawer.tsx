"use client";

/**
 * Slide text editor — every text run of the slide as an editable field,
 * grouped visually by role. Lossless: structure/ids never change, so this
 * is the safe path for typo fixes without an LLM reroll.
 */
import { useMemo, useState } from "react";
import type { PlateSlide } from "@/lib/generation/parser/slide-parser";
import {
  collectTextRuns,
  setTextAtPath,
  type TextRun,
} from "@/lib/slides/text-paths";
import { Button, Drawer, cx } from "./primitives";

export function TextEditorDrawer({
  slide,
  slideNumber,
  onApply,
  onClose,
}: {
  slide: PlateSlide;
  slideNumber: number;
  onApply: (next: PlateSlide) => void;
  onClose: () => void;
}) {
  const runs = useMemo(() => collectTextRuns(slide), [slide]);
  const [drafts, setDrafts] = useState<Map<string, string>>(new Map());

  const keyOf = (run: TextRun) => run.path.join(".");
  const valueOf = (run: TextRun) => drafts.get(keyOf(run)) ?? run.text;
  const dirty = runs.some((run) => {
    const draft = drafts.get(keyOf(run));
    return draft !== undefined && draft !== run.text;
  });

  const apply = () => {
    let next = slide;
    for (const run of runs) {
      const draft = drafts.get(keyOf(run));
      if (draft !== undefined && draft !== run.text) {
        next = setTextAtPath(next, run.path, draft);
      }
    }
    onApply(next);
    onClose();
  };

  return (
    <Drawer
      open
      onClose={onClose}
      title="Edit text"
      subtitle={`Slide ${slideNumber} · ${runs.length} text run${runs.length === 1 ? "" : "s"}`}
      footer={
        <>
          <Button variant="primary" className="flex-1" disabled={!dirty} onClick={apply}>
            Apply changes
          </Button>
          <Button onClick={onClose}>Cancel</Button>
        </>
      }
    >
      <div className="space-y-3">
        {runs.map((run) => {
          const id = `run-${keyOf(run)}`;
          return (
            <div key={keyOf(run)}>
              <label htmlFor={id} className="t-eyebrow mb-1 block text-ink-3">
                {run.parentType}
              </label>
              <textarea
                id={id}
                value={valueOf(run)}
                onChange={(e) =>
                  setDrafts((d) => new Map(d).set(keyOf(run), e.target.value))
                }
                rows={Math.min(5, Math.max(1, Math.ceil(valueOf(run).length / 52)))}
                className={cx(
                  "textarea resize-none",
                  run.kind === "heading" && "font-semibold",
                )}
              />
            </div>
          );
        })}
        {runs.length === 0 && (
          <p className="t-body py-8 text-center text-ink-3">
            This slide has no editable text runs.
          </p>
        )}
      </div>
    </Drawer>
  );
}
