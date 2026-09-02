"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { PlateSlide } from "@/lib/generation/parser/slide-parser";
import { ScaledSlide } from "@/components/slides/render/slide-frame";
import { ThemeScope } from "@/components/slides/theme-scope";
import { Icon } from "@/components/ui/icon";
import {
  Button,
  Dialog,
  EmptyState,
  MenuItem,
  Popover,
  SegmentedControl,
  cx,
  useConfirm,
} from "@/components/ui/primitives";
import { downloadExport, formatsFor } from "@/components/ui/export-menu";
import { useToast } from "@/components/ui/toast";
import "@/styles/slides.css";
import { apiFetch } from "@/lib/client/base-path";

export interface LibraryCard {
  id: string;
  kind: string;
  title: string;
  status: string;
  themeName: string;
  updatedAt: string;
  firstSlide: PlateSlide | null;
  slideCount: number;
}

const STATUS_LABEL: Record<string, string> = {
  ready: "Ready",
  draft: "Draft",
  outlining: "Outlining",
  generating: "Generating",
  reviewing: "Reviewing",
  error: "Failed",
};

const KIND_FILTERS = [
  { value: "all", label: "All" },
  { value: "deck", label: "Decks" },
  { value: "doc", label: "Documents" },
] as const;

const SORTS = [
  { value: "recent", label: "Last edited" },
  { value: "title", label: "Title" },
] as const;

function relativeDate(iso: string): string {
  const then = new Date(iso).getTime();
  const days = Math.floor((Date.now() - then) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export function Library({ cards }: { cards: LibraryCard[] }) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<(typeof KIND_FILTERS)[number]["value"]>("all");
  const [sort, setSort] = useState<(typeof SORTS)[number]["value"]>("recent");
  const [busy, setBusy] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<LibraryCard | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [removed, setRemoved] = useState<ReadonlySet<string>>(new Set());

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return cards
      .filter((c) => !removed.has(c.id))
      .filter((c) => (kind === "all" ? true : c.kind === kind))
      .filter((c) => !q || c.title.toLowerCase().includes(q))
      .sort((a, b) =>
        sort === "title"
          ? a.title.localeCompare(b.title)
          : new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      );
  }, [cards, kind, query, sort, removed]);

  const duplicate = async (card: LibraryCard) => {
    setBusy(card.id);
    try {
      const res = await apiFetch(`/api/documents/${card.id}/duplicate`, { method: "POST" });
      if (!res.ok) throw new Error(`Duplicate failed (${res.status})`);
      toast({ title: "Duplicated", description: card.title, tone: "success" });
      router.refresh();
    } catch (error) {
      toast({
        title: "Could not duplicate",
        description: error instanceof Error ? error.message : String(error),
        tone: "error",
      });
    } finally {
      setBusy(null);
    }
  };

  const rename = async () => {
    const card = renaming;
    const title = renameDraft.trim();
    setRenaming(null);
    if (!card || !title || title === card.title) return;
    try {
      const res = await apiFetch(`/api/documents/${card.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      if (!res.ok) throw new Error(`Rename failed (${res.status})`);
      router.refresh();
    } catch (error) {
      toast({
        title: "Could not rename",
        description: error instanceof Error ? error.message : String(error),
        tone: "error",
      });
    }
  };

  const exportAs = async (card: LibraryCard, ext: "pptx" | "pdf" | "docx") => {
    const format = formatsFor(card.kind).find((f) => f.ext === ext);
    if (!format) return;
    setBusy(card.id);
    toast({ title: `Preparing ${format.label} export…`, duration: 2500 });
    try {
      await downloadExport(card.id, format, card.title);
      toast({ title: `${format.label} downloaded`, tone: "success" });
    } catch (error) {
      toast({
        title: `${format.label} export failed`,
        description: error instanceof Error ? error.message : String(error),
        tone: "error",
        action: { label: "Try again", onClick: () => void exportAs(card, ext) },
      });
    } finally {
      setBusy(null);
    }
  };

  const remove = async (card: LibraryCard) => {
    if (busy) return;
    const ok = await confirm({
      title: `Delete “${card.title}”?`,
      description:
        "This permanently removes the document, its generated images and its theme. This can’t be undone.",
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    setBusy(card.id);
    // Hide it immediately; put it back if the server disagrees.
    setRemoved((current) => new Set(current).add(card.id));
    try {
      const res = await apiFetch(`/api/documents/${card.id}`, { method: "DELETE" });
      // 404 means it is already gone — that is the desired end state.
      if (!res.ok && res.status !== 404) {
        throw new Error(`Delete failed (${res.status})`);
      }
      toast({ title: "Deleted", description: card.title, tone: "success" });
      router.refresh();
    } catch (error) {
      setRemoved((current) => {
        const next = new Set(current);
        next.delete(card.id);
        return next;
      });
      toast({
        title: "Could not delete",
        description: error instanceof Error ? error.message : String(error),
        tone: "error",
      });
    } finally {
      setBusy(null);
    }
  };

  if (cards.length === 0) {
    return (
      <EmptyState
        icon="sparkle"
        title="Create your first piece"
        description="A polished deck or a written document — generated in about half a minute, fully on this machine."
        action={
          <Link href="/new" className="btn btn-primary">
            <Icon name="plus" size={16} />
            New presentation
          </Link>
        }
      />
    );
  }

  return (
    <>
      <div className="mt-6 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1 max-w-xs">
          <Icon
            name="search"
            size={14}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3"
          />
          <input
            className="input pl-8"
            placeholder="Search library"
            aria-label="Search library"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <SegmentedControl
          label="Filter by kind"
          options={KIND_FILTERS}
          value={kind}
          onChange={setKind}
        />
        <div className="flex-1" />
        <SegmentedControl label="Sort by" options={SORTS} value={sort} onChange={setSort} />
      </div>

      {visible.length === 0 ? (
        <p className="t-body py-16 text-center text-ink-3">
          Nothing matches those filters.
        </p>
      ) : (
        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((card) => (
            <article
              key={card.id}
              className={cx(
                "surface group/card relative overflow-hidden transition-colors",
                busy === card.id && "opacity-60",
              )}
            >
              <Link
                href={`/editor/${card.id}`}
                className="block focus-visible:outline-offset-[-2px]"
                aria-label={`Open ${card.title}`}
              >
                {/* Each thumbnail is a full 1280×720 slide DOM; with a hundred
                    cards that is a lot of layout. Skip rendering the ones that
                    are off-screen, reserving their box so scrolling is stable. */}
                <div
                  className="hairline-b relative aspect-video overflow-hidden bg-well"
                  style={{
                    contentVisibility: "auto",
                    containIntrinsicSize: "auto 180px",
                  }}
                >
                  {card.firstSlide ? (
                    <div aria-hidden className="pointer-events-none origin-top-left">
                      <ThemeScope themeName={card.themeName}>
                        <ScaledSlide slide={card.firstSlide} index={0} />
                      </ThemeScope>
                    </div>
                  ) : (
                    <div className="grid h-full w-full place-items-center text-ink-4">
                      <Icon name={card.kind === "doc" ? "doc" : "deck"} size={28} />
                    </div>
                  )}
                </div>
              </Link>

              <div className="flex items-start gap-2 p-3.5">
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/editor/${card.id}`}
                    className="t-body block truncate font-medium hover:underline"
                  >
                    {card.title}
                  </Link>
                  <p className="t-caption mt-1 flex items-center gap-1.5 text-ink-3">
                    <Icon name={card.kind === "doc" ? "doc" : "deck"} size={12} />
                    {card.slideCount} {card.kind === "doc" ? "sections" : "slides"}
                    <span aria-hidden>·</span>
                    {relativeDate(card.updatedAt)}
                    {card.status !== "ready" && (
                      <span
                        className={cx(
                          "badge ml-0.5",
                          card.status === "error" && "badge-danger",
                        )}
                      >
                        {STATUS_LABEL[card.status] ?? card.status}
                      </span>
                    )}
                  </p>
                </div>

                <Popover
                  label={`Actions for ${card.title}`}
                  width={200}
                  trigger={(props) => (
                    <button
                      type="button"
                      className="btn btn-icon btn-ghost btn-sm shrink-0"
                      aria-label={`Actions for ${card.title}`}
                      {...props}
                    >
                      <Icon name="more" size={16} />
                    </button>
                  )}
                >
                  {(close) => (
                    <>
                      <MenuItem
                        icon="text"
                        onClick={() => {
                          close();
                          router.push(`/editor/${card.id}`);
                        }}
                      >
                        Open
                      </MenuItem>
                      {card.kind !== "doc" && (
                        <MenuItem
                          icon="present"
                          onClick={() => {
                            close();
                            router.push(`/present/${card.id}`);
                          }}
                        >
                          Present
                        </MenuItem>
                      )}
                      <MenuItem
                        icon="duplicate"
                        disabled={busy === card.id}
                        onClick={() => {
                          close();
                          void duplicate(card);
                        }}
                      >
                        Duplicate
                      </MenuItem>
                      <MenuItem
                        icon="text"
                        onClick={() => {
                          close();
                          setRenameDraft(card.title);
                          setRenaming(card);
                        }}
                      >
                        Rename…
                      </MenuItem>
                      <div className="menu-sep" />
                      <p className="menu-label">Export</p>
                      {formatsFor(card.kind).map((format) => (
                        <MenuItem
                          key={format.ext}
                          icon="download"
                          disabled={busy === card.id}
                          onClick={() => {
                            close();
                            void exportAs(card, format.ext);
                          }}
                        >
                          {format.label}
                        </MenuItem>
                      ))}
                      <div className="menu-sep" />
                      <MenuItem
                        icon="trash"
                        danger
                        disabled={busy === card.id}
                        onClick={() => {
                          close();
                          void remove(card);
                        }}
                      >
                        Delete
                      </MenuItem>
                    </>
                  )}
                </Popover>
              </div>
            </article>
          ))}
        </div>
      )}

      <Dialog
        open={renaming !== null}
        onClose={() => setRenaming(null)}
        title="Rename"
        footer={
          <>
            <Button onClick={() => setRenaming(null)}>Cancel</Button>
            <Button variant="primary" disabled={!renameDraft.trim()} onClick={() => void rename()}>
              Rename
            </Button>
          </>
        }
      >
        <label htmlFor="rename-title" className="t-label mb-1.5 block text-ink-2">
          Title
        </label>
        <input
          id="rename-title"
          className="input"
          value={renameDraft}
          onChange={(e) => setRenameDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void rename();
          }}
        />
      </Dialog>
    </>
  );
}

export { Button };
