"use client";

/**
 * Quality report popover: severity legend, jump-to-slide, per-issue fix and
 * an explicit re-run. Uses the shared Popover so outside-click and Escape
 * work — the old panel was a bare div that could only be closed by clicking
 * its own trigger again.
 */
import { Icon } from "./icon";
import { Button, Popover, Spinner, cx } from "./primitives";

export interface QaIssueView {
  slideId: string | null;
  severity: "minor" | "major";
  code: string;
  issue: string;
  suggestion: string;
}
export interface QualityReportView {
  score: number | null;
  lint: QaIssueView[];
  critique: QaIssueView[];
  strengths: string[];
  checkedAt: string;
}

export function scoreColor(score: number | null): string {
  if (score === null) return "var(--text-tertiary)";
  if (score >= 8) return "var(--success)";
  if (score >= 6) return "var(--warning)";
  return "var(--danger)";
}

export function QualityPanel({
  report,
  reviewing,
  fixing,
  slideNumbers,
  onFix,
  onJump,
  onRerun,
}: {
  report: QualityReportView | null;
  reviewing: boolean;
  fixing: string | null;
  /** slide id → 1-based position, for "Slide 4" labels and jump targets. */
  slideNumbers: Map<string, number>;
  onFix: (slideId: string, suggestion: string) => void;
  onJump: (slideId: string) => void;
  onRerun: () => void;
}) {
  const issues = [...(report?.lint ?? []), ...(report?.critique ?? [])];
  const majors = issues.filter((i) => i.severity === "major").length;
  const minors = issues.length - majors;
  const score = report?.score ?? null;

  return (
    <Popover
      label="Quality report"
      width={332}
      trigger={(props) => (
        <button type="button" className="btn btn-secondary" {...props}>
          {reviewing ? (
            <Spinner size={13} />
          ) : (
            <span
              aria-hidden
              className="inline-block h-2 w-2 rounded-full"
              style={{ background: scoreColor(score) }}
            />
          )}
          <span>Quality</span>
          <span className="text-ink-3">
            {reviewing ? "…" : score !== null ? `${score}/10` : "–"}
          </span>
        </button>
      )}
    >
      {() => (
        <div className="p-1">
          <div className="flex items-start justify-between gap-2 px-2 pb-2 pt-1">
            <div className="min-w-0">
              <p className="t-body font-semibold">
                {reviewing
                  ? "Reviewing…"
                  : score !== null
                    ? `Score ${score}/10`
                    : "Not reviewed yet"}
              </p>
              <p className="t-caption mt-0.5 text-ink-3">
                {majors} major · {minors} minor
              </p>
            </div>
            <Button size="sm" icon="regenerate" disabled={reviewing} onClick={onRerun}>
              Re-run
            </Button>
          </div>

          <div className="t-caption flex items-center gap-3 px-2 pb-2 text-ink-3">
            <span className="flex items-center gap-1.5">
              <span
                aria-hidden
                className="inline-block h-2 w-2 rounded-[1px]"
                style={{ background: "var(--danger)" }}
              />
              Major — misleads or weakens
            </span>
          </div>
          <div className="t-caption flex items-center gap-3 px-2 pb-2 text-ink-3">
            <span className="flex items-center gap-1.5">
              <span
                aria-hidden
                className="inline-block h-2 w-2 rounded-[1px]"
                style={{ background: "var(--warning)" }}
              />
              Minor — polish
            </span>
          </div>

          {report?.strengths?.length ? (
            <>
              <div className="menu-sep" />
              <p className="menu-label">Working well</p>
              <ul className="px-2 pb-1">
                {report.strengths.map((s, i) => (
                  <li key={i} className="t-caption flex gap-1.5 py-0.5 text-ink-2">
                    <Icon name="check" size={12} className="mt-0.5 shrink-0 text-success" />
                    {s}
                  </li>
                ))}
              </ul>
            </>
          ) : null}

          <div className="menu-sep" />
          {issues.length === 0 ? (
            <p className="t-caption px-2 py-4 text-center text-ink-3">
              {reviewing ? "Reading the deck…" : "No issues found."}
            </p>
          ) : (
            <>
              <p className="menu-label">
                {issues.length} issue{issues.length === 1 ? "" : "s"}
              </p>
              <div className="space-y-1.5 px-1 pb-1">
                {issues.map((issue, i) => {
                  const number = issue.slideId ? slideNumbers.get(issue.slideId) : undefined;
                  return (
                    <div
                      key={i}
                      className="rounded-[6px] bg-[var(--bg-well)] p-2.5"
                      style={{
                        boxShadow: `inset 2px 0 0 ${
                          issue.severity === "major" ? "var(--danger)" : "var(--warning)"
                        }`,
                      }}
                    >
                      <p className="t-caption font-medium">{issue.issue}</p>
                      <p className="t-caption mt-1 text-ink-3">{issue.suggestion}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        {number !== undefined && (
                          <button
                            type="button"
                            className={cx("btn btn-ghost btn-sm")}
                            onClick={() => onJump(issue.slideId!)}
                          >
                            Slide {number}
                          </button>
                        )}
                        {issue.slideId && issue.code !== "image-pending" && (
                          <Button
                            size="sm"
                            disabled={fixing !== null}
                            onClick={() => onFix(issue.slideId!, issue.suggestion)}
                          >
                            {fixing === issue.slideId ? <Spinner size={11} /> : null}
                            Fix
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}
    </Popover>
  );
}
