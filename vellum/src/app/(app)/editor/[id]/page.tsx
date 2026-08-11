"use client";

/**
 * Editor — Keynote-register workspace: navigator | canvas | inspector.
 *
 * Two contracts matter here:
 *  1. Asset polling replaces the slides array wholesale, so ALL editing state
 *     is keyed by slide id, never by array index. (Index keys silently
 *     re-targeted edits at a different slide after a refetch.)
 *  2. Local edits are debounced to disk; a refetch is skipped while a save is
 *     in flight so the server never overwrites something just typed.
 */
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PlateSlide } from "@/lib/generation/parser/slide-parser";
import type { TElement } from "@/lib/slides/plate-shim";
import type { ArchetypeId } from "@/lib/design/archetypes";
import { ScaledSlide } from "@/components/slides/render/slide-frame";
import { DocumentView } from "@/components/slides/render/document-view";
import { SlideMetaContext } from "@/components/slides/render/slide-meta";
import { ThemeScope } from "@/components/slides/theme-scope";
import { CommandButton, Wordmark } from "@/components/ui/chrome";
import { ExportMenu } from "@/components/ui/export-menu";
import { Icon } from "@/components/ui/icon";
import {
  Button,
  IconButton,
  Skeleton,
  Spinner,
  useConfirm,
} from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import {
  QualityPanel,
  type QualityReportView,
} from "@/components/ui/quality-panel";
import { TextEditorDrawer } from "@/components/ui/text-editor-drawer";
import { ChartDataEditor } from "@/components/ui/chart-data-editor";
import { useCommands } from "@/components/ui/command-palette";
import { ShortcutSheet, type ShortcutGroup } from "@/components/ui/shortcut-sheet";
import { rerollArchetype } from "@/lib/design/planner";
import { Navigator } from "./components/navigator";
import { Inspector, type ImageState, type InspectorScope } from "./components/inspector";
import "@/styles/slides.css";
import "@/styles/editor.css";

/** First chart node (with its content index) on a slide, if any. */
function findChartNode(
  slide: PlateSlide,
): { index: number; node: TElement } | null {
  for (let i = 0; i < slide.content.length; i++) {
    const node = slide.content[i] as TElement;
    if (typeof node.type === "string" && node.type.startsWith("chart-")) {
      return { index: i, node };
    }
  }
  return null;
}

function freshSlideId(): string {
  return `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 9)}`;
}

interface DocumentPayload {
  id: string;
  kind: string;
  title: string;
  status: string;
  slides: string;
  themeName: string;
  errorMessage: string | null;
  qualityReport?: string | null;
  sources?: string | null;
  genParams?: string | null;
  customTheme?: { id: string; data: string } | null;
}

function parseSources(doc: DocumentPayload | null) {
  if (!doc?.sources) return undefined;
  try {
    return JSON.parse(doc.sources) as Array<{
      ref: number;
      publisher: string;
      title: string;
      url: string;
    }>;
  } catch {
    return undefined;
  }
}


function parseGenParams(doc: DocumentPayload | null): Record<string, unknown> {
  if (!doc?.genParams) return {};
  try {
    return JSON.parse(doc.genParams) as Record<string, unknown>;
  } catch {
    return {};
  }
}

type SaveState = "idle" | "saving" | "saved";

/** Shallow equality for the slideId → image-status map. */
function sameImageState(
  a: Map<string, ImageState>,
  b: Map<string, ImageState>,
): boolean {
  if (a.size !== b.size) return false;
  for (const [key, value] of a) {
    const other = b.get(key);
    if (!other || other.status !== value.status || other.error !== value.error) {
      return false;
    }
  }
  return true;
}

export default function EditorPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();

  const [doc, setDoc] = useState<DocumentPayload | null>(null);
  const [slides, setSlides] = useState<PlateSlide[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [scope, setScope] = useState<InspectorScope>("format");
  const [navOpen, setNavOpen] = useState(true);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [images, setImages] = useState<Map<string, ImageState>>(new Map());
  const [pendingImages, setPendingImages] = useState(0);
  const [failedImages, setFailedImages] = useState(0);
  const [regenerating, setRegenerating] = useState<string | null>(null);
  const [themeBusy, setThemeBusy] = useState(false);
  const [brandBusy, setBrandBusy] = useState(false);
  const [textOpen, setTextOpen] = useState(false);
  const [chartOpen, setChartOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  const slidesRef = useRef<PlateSlide[]>([]);
  const dirtyRef = useRef(false);
  const titleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const slideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const undoStack = useRef<PlateSlide[][]>([]);
  const redoStack = useRef<PlateSlide[][]>([]);
  const [depths, setDepths] = useState({ undo: 0, redo: 0 });

  /* ------------------------------ loading ------------------------------ */

  const loadDocument = useRef(async () => {
    // Never clobber edits that have not reached the server yet.
    if (dirtyRef.current) return;
    const res = await fetch(`/api/documents/${params.id}`);
    if (!res.ok) {
      setError(res.status === 404 ? "not-found" : "load-failed");
      return;
    }
    const payload = (await res.json()) as DocumentPayload;
    setDoc(payload);
    let parsed: PlateSlide[] = [];
    try {
      parsed = JSON.parse(payload.slides) as PlateSlide[];
    } catch {
      parsed = [];
    }
    slidesRef.current = parsed;
    setSlides(parsed);
    setSelectedId((current) =>
      current && parsed.some((s) => s.id === current)
        ? current
        : (parsed[0]?.id ?? null),
    );
  });

  useEffect(() => {
    void loadDocument.current();
  }, [params.id]);

  // Below 1024 the inspector floats over the canvas, so it must not start
  // open — it would cover the slide the moment the editor loads.
  useEffect(() => {
    const narrow = window.matchMedia("(max-width: 1024px)");
    if (narrow.matches) setInspectorOpen(false);
  }, []);

  // Poll assets while images generate; refetch when a batch lands.
  useEffect(() => {
    let stopped = false;
    let lastPending = -1;
    const tick = async () => {
      if (stopped) return;
      try {
        const res = await fetch(`/api/documents/${params.id}/assets`);
        if (res.ok) {
          const data = (await res.json()) as {
            pending: number;
            images: Array<{
              slideId: string | null;
              status: string;
              error: string | null;
            }>;
          };
          setPendingImages(data.pending);
          setFailedImages(data.images.filter((i) => i.status === "failed").length);
          const map = new Map<string, ImageState>();
          for (const image of data.images) {
            if (image.slideId) {
              map.set(image.slideId, { status: image.status, error: image.error });
            }
          }
          // Keep the previous Map identity when nothing changed — a fresh Map
          // every 2s re-rendered the whole workspace while merely polling.
          setImages((previous) => (sameImageState(previous, map) ? previous : map));
          if (lastPending !== -1 && data.pending < lastPending) {
            await loadDocument.current();
          }
          lastPending = data.pending;
          if (data.pending > 0) {
            setTimeout(tick, 2000);
            return;
          }
        }
      } catch {
        if (lastPending > 0) setTimeout(tick, 4000);
      }
    };
    void tick();
    return () => {
      stopped = true;
    };
  }, [params.id]);

  // Poll while the AI reviewer runs so the report fills in live.
  useEffect(() => {
    if (doc?.status !== "reviewing") return;
    const t = setInterval(() => void loadDocument.current(), 3000);
    return () => clearInterval(t);
  }, [doc?.status]);

  /* ------------------------------ saving ------------------------------- */

  const flushSlides = useCallback(
    async (next: PlateSlide[]) => {
      setSaveState("saving");
      try {
        const res = await fetch(`/api/documents/${params.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ slides: JSON.stringify(next) }),
        });
        // Deleted from another tab or the library: stop trying. Offering
        // "Retry" forever on a document that cannot come back is a lie.
        if (res.status === 404) {
          if (slideTimer.current) clearTimeout(slideTimer.current);
          dirtyRef.current = false; // before setError, so the unmount beacon skips
          setSaveState("idle");
          setError("not-found");
          return;
        }
        if (!res.ok) throw new Error(`Save failed (${res.status})`);
        dirtyRef.current = false;
        setSaveState("saved");
      } catch (err) {
        dirtyRef.current = false;
        setSaveState("idle");
        toast({
          title: "Could not save changes",
          description: err instanceof Error ? err.message : String(err),
          tone: "error",
          action: { label: "Retry", onClick: () => void flushSlides(next) },
        });
      }
    },
    [params.id, toast],
  );

  const persistSlides = useCallback(
    (next: PlateSlide[], options?: { skipUndo?: boolean }) => {
      if (!options?.skipUndo) {
        undoStack.current.push(slidesRef.current);
        if (undoStack.current.length > 60) undoStack.current.shift();
        redoStack.current = [];
      }
      setDepths({ undo: undoStack.current.length, redo: redoStack.current.length });
      slidesRef.current = next;
      setSlides(next);
      dirtyRef.current = true;
      setSaveState("saving");
      if (slideTimer.current) clearTimeout(slideTimer.current);
      slideTimer.current = setTimeout(() => void flushSlides(next), 400);
    },
    [flushSlides],
  );

  // Flush anything still queued when the editor unmounts.
  useEffect(
    () => () => {
      if (slideTimer.current) clearTimeout(slideTimer.current);
      if (titleTimer.current) clearTimeout(titleTimer.current);
      if (dirtyRef.current) {
        navigator.sendBeacon?.(
          `/api/documents/${params.id}`,
          new Blob([JSON.stringify({ slides: JSON.stringify(slidesRef.current) })], {
            type: "application/json",
          }),
        );
      }
    },
    [params.id],
  );

  const saveTitle = useCallback(
    (title: string) => {
      setDoc((d) => (d ? { ...d, title } : d));
      if (titleTimer.current) clearTimeout(titleTimer.current);
      titleTimer.current = setTimeout(() => {
        void fetch(`/api/documents/${params.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title }),
        });
      }, 600);
    },
    [params.id],
  );

  const undo = useCallback(() => {
    const previous = undoStack.current.pop();
    if (!previous) return;
    redoStack.current.push(slidesRef.current);
    persistSlides(previous, { skipUndo: true });
  }, [persistSlides]);

  const redo = useCallback(() => {
    const next = redoStack.current.pop();
    if (!next) return;
    undoStack.current.push(slidesRef.current);
    persistSlides(next, { skipUndo: true });
  }, [persistSlides]);

  /* ----------------------------- selection ----------------------------- */

  const selectedIndex = useMemo(
    () => slides.findIndex((s) => s.id === selectedId),
    [slides, selectedId],
  );
  const selected = selectedIndex >= 0 ? slides[selectedIndex] : null;

  // Undo/redo and refetches can drop the selected slide out of the array.
  // Fall back to whatever now occupies that position rather than to slide 1,
  // so undoing a duplicate leaves you looking at the original.
  const lastIndexRef = useRef(0);
  useEffect(() => {
    if (selectedIndex >= 0) {
      lastIndexRef.current = selectedIndex;
      return;
    }
    if (slides.length === 0) {
      if (selectedId !== null) setSelectedId(null);
      return;
    }
    setSelectedId(slides[Math.min(lastIndexRef.current, slides.length - 1)].id);
  }, [slides, selectedIndex, selectedId]);
  const slideNumbers = useMemo(
    () => new Map(slides.map((s, i) => [s.id, i + 1])),
    [slides],
  );
  // Parsed once per theme change. Re-parsing inline produced a new object on
  // every render, invalidating every ThemeScope memo beneath it.
  const customThemeJson = doc?.customTheme?.data ?? null;
  const customThemeData = useMemo(() => {
    if (!customThemeJson) return null;
    try {
      return JSON.parse(customThemeJson) as unknown;
    } catch {
      return null;
    }
  }, [customThemeJson]);

  /* ------------------------------ mutations ---------------------------- */

  const replaceSlide = useCallback(
    (id: string, update: (slide: PlateSlide) => PlateSlide, skipUndo = false) => {
      const index = slidesRef.current.findIndex((s) => s.id === id);
      if (index < 0) return;
      const next = [...slidesRef.current];
      next[index] = update(next[index]);
      persistSlides(next, { skipUndo });
    },
    [persistSlides],
  );

  /** Drag/keyboard reorder: splice `from` in front of position `to`. */
  const reorderSlide = useCallback(
    (from: number, to: number) => {
      if (from === to || from < 0 || to < 0) return;
      const next = [...slidesRef.current];
      const [moved] = next.splice(from, 1);
      next.splice(to > from ? to - 1 : to, 0, moved);
      persistSlides(next);
    },
    [persistSlides],
  );

  const deleteSlide = useCallback(
    async (id: string) => {
      const index = slidesRef.current.findIndex((s) => s.id === id);
      if (index < 0) return;
      const unit = doc?.kind === "doc" ? "section" : "slide";
      const ok = await confirm({
        title: `Delete ${unit} ${index + 1}?`,
        description: "You can undo this with ⌘Z while the editor stays open.",
        confirmLabel: "Delete",
        danger: true,
      });
      if (!ok) return;
      const next = slidesRef.current.filter((s) => s.id !== id);
      persistSlides(next);
      setSelectedId(next[Math.min(index, next.length - 1)]?.id ?? null);
    },
    [confirm, doc?.kind, persistSlides],
  );

  const duplicateSlide = useCallback(
    (id: string) => {
      const index = slidesRef.current.findIndex((s) => s.id === id);
      if (index < 0) return;
      const copy = JSON.parse(JSON.stringify(slidesRef.current[index])) as PlateSlide;
      copy.id = freshSlideId();
      const next = [...slidesRef.current];
      next.splice(index + 1, 0, copy);
      persistSlides(next);
      setSelectedId(copy.id);
    },
    [persistSlides],
  );

  const addSlide = useCallback(
    (afterIndex?: number) => {
      const at = afterIndex === undefined ? slidesRef.current.length : afterIndex + 1;
      const fresh: PlateSlide = {
        id: freshSlideId(),
        content: [
          { id: freshSlideId(), type: "h1", children: [{ text: "New slide" }] },
          { id: freshSlideId(), type: "p", children: [{ text: "" }] },
        ] as PlateSlide["content"],
        layoutType: "left",
        alignment: "center",
        archetype: "content",
      } as PlateSlide;
      const next = [...slidesRef.current];
      next.splice(at, 0, fresh);
      persistSlides(next);
      setSelectedId(fresh.id);
      setScope("format");
      setTextOpen(true);
    },
    [persistSlides],
  );

  const setArchetype = useCallback(
    (id: string, archetype: ArchetypeId) =>
      replaceSlide(id, (slide) => ({ ...slide, archetype })),
    [replaceSlide],
  );

  const shuffleLayout = useCallback(
    (id: string) =>
      replaceSlide(id, (slide) => ({
        ...slide,
        archetype: rerollArchetype(slide, slide.archetype),
      })),
    [replaceSlide],
  );

  const saveNote = useCallback(
    (id: string, note: string) =>
      replaceSlide(id, (slide) => ({ ...slide, speakerNote: note }), true),
    [replaceSlide],
  );

  const applyChartRows = useCallback(
    (id: string, rows: Array<Record<string, string | number>>) =>
      replaceSlide(id, (slide) => {
        const chart = findChartNode(slide);
        if (!chart) return slide;
        const content = [...slide.content];
        content[chart.index] = { ...chart.node, data: rows } as TElement;
        return { ...slide, content };
      }),
    [replaceSlide],
  );

  const regenerateImage = useCallback(
    async (id: string, promptOverride?: string) => {
      const slide = slidesRef.current.find((s) => s.id === id);
      if (!slide) return;
      const root = slide.rootImage as { query?: string } | undefined;
      const prompt = promptOverride?.trim() || root?.query;
      if (!prompt) {
        toast({ title: "Add a prompt first", tone: "error" });
        return;
      }
      try {
        const res = await fetch(`/api/documents/${params.id}/images`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ slideId: id, nodeId: "__root__", prompt }),
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(data?.error ?? `Request failed (${res.status})`);
        }
        // Keep the model's query in sync so future regenerations reuse it.
        if (promptOverride?.trim()) {
          replaceSlide(
            id,
            (s) => ({ ...s, rootImage: { ...(s.rootImage ?? {}), query: prompt } }) as PlateSlide,
            true,
          );
        }
        setPendingImages((p) => p + 1);
        toast({ title: "Image queued", description: "Rendering on the GPU…" });
      } catch (err) {
        toast({
          title: "Could not queue the image",
          description: err instanceof Error ? err.message : String(err),
          tone: "error",
        });
      }
    },
    [params.id, replaceSlide, toast],
  );

  const uploadImage = useCallback(
    async (id: string, file: File) => {
      try {
        const form = new FormData();
        form.append("file", file);
        const res = await fetch("/api/images/upload", { method: "POST", body: form });
        if (!res.ok) {
          const data = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(data?.error ?? `Upload failed (${res.status})`);
        }
        const { url } = (await res.json()) as { url: string };
        replaceSlide(
          id,
          (slide) => ({ ...slide, rootImage: { ...(slide.rootImage ?? {}), url } }) as PlateSlide,
        );
        toast({ title: "Image replaced", tone: "success" });
      } catch (err) {
        toast({
          title: "Upload failed",
          description: err instanceof Error ? err.message : String(err),
          tone: "error",
        });
      }
    },
    [replaceSlide, toast],
  );

  const regenerateSlide = useCallback(
    async (slideId: string, instruction?: string) => {
      setRegenerating(slideId);
      try {
        const res = await fetch("/api/generation/slide", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ documentId: params.id, slideId, instruction }),
        });
        if (res.ok) {
          await loadDocument.current();
          setPendingImages((p) => p + 1);
          toast({ title: "Slide regenerated", tone: "success" });
        } else {
          const data = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(data?.error ?? "Regeneration failed");
        }
      } catch (err) {
        toast({
          title: "Regeneration failed",
          description: err instanceof Error ? err.message : String(err),
          tone: "error",
          action: {
            label: "Try again",
            onClick: () => void regenerateSlide(slideId, instruction),
          },
        });
      } finally {
        setRegenerating(null);
      }
    },
    [params.id, toast],
  );

  const generateAiTheme = useCallback(async () => {
    setThemeBusy(true);
    try {
      const res = await fetch("/api/generation/theme", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentId: params.id }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? "Theme generation failed");
      }
      await loadDocument.current();
      toast({ title: "Theme designed", tone: "success" });
    } catch (err) {
      toast({
        title: "Theme generation failed",
        description: err instanceof Error ? err.message : String(err),
        tone: "error",
      });
    } finally {
      setThemeBusy(false);
    }
  }, [params.id, toast]);

  const pickTheme = useCallback(
    (themeName: string) => {
      setDoc((d) => (d ? { ...d, themeName } : d));
      void fetch(`/api/documents/${params.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          themeName === "custom" ? { themeName } : { themeName, customThemeId: null },
        ),
      });
    },
    [params.id],
  );

  const applyBrandTheme = useCallback(async () => {
    setBrandBusy(true);
    try {
      const res = await fetch(`/api/documents/${params.id}/brand-theme`, {
        method: "POST",
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? `Request failed (${res.status})`);
      }
      await loadDocument.current();
      toast({ title: "Brand theme applied", tone: "success" });
    } catch (err) {
      toast({
        title: "Could not apply the brand kit",
        description: err instanceof Error ? err.message : String(err),
        tone: "error",
      });
    } finally {
      setBrandBusy(false);
    }
  }, [params.id, toast]);

  const setImageStyle = useCallback(
    (style: string | null) => {
      const next = { ...parseGenParams(doc), imageStyle: style ?? undefined };
      if (!style) delete next.imageStyle;
      const encoded = JSON.stringify(next);
      setDoc((d) => (d ? { ...d, genParams: encoded } : d));
      void fetch(`/api/documents/${params.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ genParams: encoded }),
      });
    },
    [doc, params.id],
  );

  /** Delete the whole document (not a slide) and return to the library. */
  const deleteDocument = useCallback(async () => {
    const ok = await confirm({
      title: `Delete “${doc?.title ?? "this document"}”?`,
      description:
        "This permanently removes the document, its generated images and its theme. This can’t be undone.",
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    try {
      const res = await fetch(`/api/documents/${params.id}`, { method: "DELETE" });
      if (!res.ok && res.status !== 404) {
        throw new Error(`Delete failed (${res.status})`);
      }
      // Stop the autosave loop before navigating away.
      dirtyRef.current = false;
      if (slideTimer.current) clearTimeout(slideTimer.current);
      router.replace("/dashboard");
    } catch (err) {
      toast({
        title: "Could not delete",
        description: err instanceof Error ? err.message : String(err),
        tone: "error",
      });
    }
  }, [confirm, doc?.title, params.id, router, toast]);

  const rerunQuality = useCallback(async () => {
    try {
      const res = await fetch(`/api/documents/${params.id}/quality`, { method: "POST" });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      setDoc((d) => (d ? { ...d, status: "reviewing" } : d));
      toast({ title: "Re-running the quality check…" });
    } catch (err) {
      toast({
        title: "Could not start the review",
        description: err instanceof Error ? err.message : String(err),
        tone: "error",
      });
    }
  }, [params.id, toast]);

  /* ----------------------------- shortcuts ----------------------------- */

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        target && (/input|textarea|select/i.test(target.tagName) || target.isContentEditable);
      const mod = e.metaKey || e.ctrlKey;

      if (!mod && e.key === "?" && !typing) {
        e.preventDefault();
        setShortcutsOpen((v) => !v);
        return;
      }
      if (mod && e.key.toLowerCase() === "z") {
        if (typing) return;
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && e.altKey && (e.key === "1" || e.key === "2")) {
        e.preventDefault();
        if (e.key === "1") setNavOpen((v) => !v);
        else setInspectorOpen((v) => !v);
        return;
      }
      if (mod && !e.altKey && ["1", "2", "3"].includes(e.key)) {
        e.preventDefault();
        setScope(e.key === "1" ? "format" : e.key === "2" ? "design" : "notes");
        setInspectorOpen(true);
        return;
      }
      if (typing) return;
      if (mod && e.key.toLowerCase() === "d" && selectedId) {
        e.preventDefault();
        duplicateSlide(selectedId);
        return;
      }
      if (mod && (e.key === "Backspace" || e.key === "Delete") && selectedId) {
        e.preventDefault();
        void deleteSlide(selectedId);
        return;
      }
      if (mod && e.shiftKey && e.key.toLowerCase() === "p" && doc?.kind !== "doc") {
        e.preventDefault();
        router.push(`/present/${params.id}`);
        return;
      }
      if (!mod && (e.key === "ArrowDown" || e.key === "PageDown")) {
        if (selectedIndex >= 0 && selectedIndex < slides.length - 1) {
          e.preventDefault();
          setSelectedId(slides[selectedIndex + 1].id);
        }
      } else if (!mod && (e.key === "ArrowUp" || e.key === "PageUp")) {
        if (selectedIndex > 0) {
          e.preventDefault();
          setSelectedId(slides[selectedIndex - 1].id);
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    undo,
    redo,
    selectedId,
    selectedIndex,
    slides,
    duplicateSlide,
    deleteSlide,
    doc?.kind,
    params.id,
    router,
  ]);

  /* -------------------------- command palette -------------------------- */

  const isDeck = doc?.kind !== "doc";
  const unitLabel = isDeck ? "slide" : "section";
  useCommands(
    "editor",
    doc
      ? [
          {
            id: "ed-add",
            label: `Add ${unitLabel}`,
            group: "Slide",
            icon: "plus",
            run: () => addSlide(),
          },
          {
            id: "ed-duplicate",
            label: `Duplicate ${unitLabel}`,
            group: "Slide",
            icon: "duplicate",
            shortcut: "⌘D",
            disabled: !selectedId,
            run: () => selectedId && duplicateSlide(selectedId),
          },
          {
            id: "ed-delete",
            label: `Delete ${unitLabel}`,
            group: "Slide",
            icon: "trash",
            shortcut: "⌘⌫",
            disabled: !selectedId,
            run: () => selectedId && void deleteSlide(selectedId),
          },
          {
            id: "ed-regen",
            label: `Regenerate ${unitLabel} with AI`,
            group: "Slide",
            icon: "sparkle",
            disabled: !selectedId || regenerating !== null,
            run: () => selectedId && void regenerateSlide(selectedId),
          },
          {
            id: "ed-shuffle",
            label: "Try another layout",
            group: "Slide",
            icon: "layout",
            disabled: !selectedId,
            run: () => selectedId && shuffleLayout(selectedId),
          },
          {
            id: "ed-text",
            label: "Edit text",
            group: "Slide",
            icon: "text",
            disabled: !selectedId,
            run: () => setTextOpen(true),
          },
          {
            id: "ed-chart",
            label: "Edit chart data",
            group: "Slide",
            icon: "chart",
            disabled: !selected || findChartNode(selected) === null,
            run: () => setChartOpen(true),
          },
          {
            id: "ed-undo",
            label: "Undo",
            group: "Edit",
            icon: "undo",
            shortcut: "⌘Z",
            disabled: depths.undo === 0,
            run: undo,
          },
          {
            id: "ed-redo",
            label: "Redo",
            group: "Edit",
            icon: "redo",
            shortcut: "⇧⌘Z",
            disabled: depths.redo === 0,
            run: redo,
          },
          {
            id: "ed-nav",
            label: navOpen ? "Hide the navigator" : "Show the navigator",
            group: "View",
            icon: "panelLeft",
            shortcut: "⌥⌘1",
            run: () => setNavOpen((v) => !v),
          },
          {
            id: "ed-insp",
            label: inspectorOpen ? "Hide the inspector" : "Show the inspector",
            group: "View",
            icon: "panelRight",
            shortcut: "⌥⌘2",
            run: () => setInspectorOpen((v) => !v),
          },
          {
            id: "ed-format",
            label: "Inspector: Format",
            group: "View",
            shortcut: "⌘1",
            run: () => {
              setScope("format");
              setInspectorOpen(true);
            },
          },
          {
            id: "ed-design",
            label: "Inspector: Design",
            group: "View",
            shortcut: "⌘2",
            run: () => {
              setScope("design");
              setInspectorOpen(true);
            },
          },
          {
            id: "ed-notes",
            label: "Inspector: Notes",
            group: "View",
            shortcut: "⌘3",
            run: () => {
              setScope("notes");
              setInspectorOpen(true);
            },
          },
          {
            id: "ed-quality",
            label: "Re-run the quality check",
            group: "Document",
            icon: "quality",
            run: () => void rerunQuality(),
          },
          {
            id: "ed-brand",
            label: "Apply the brand theme",
            group: "Document",
            icon: "brand",
            run: () => void applyBrandTheme(),
          },
          {
            id: "ed-ai-theme",
            label: "Design a theme with AI",
            group: "Document",
            icon: "palette",
            disabled: themeBusy,
            run: () => void generateAiTheme(),
          },
          ...(isDeck
            ? [
                {
                  id: "ed-present",
                  label: "Start presenting",
                  group: "Document" as const,
                  icon: "present" as const,
                  shortcut: "⇧⌘P",
                  run: () => router.push(`/present/${params.id}`),
                },
              ]
            : []),
          {
            id: "ed-delete-doc",
            label: `Delete this ${isDeck ? "presentation" : "document"}…`,
            group: "Document",
            icon: "trash",
            run: () => void deleteDocument(),
          },
          {
            id: "ed-shortcuts",
            label: "Keyboard shortcuts",
            group: "Help",
            icon: "keyboard",
            shortcut: "?",
            run: () => setShortcutsOpen(true),
          },
        ]
      : [],
  );

  const SHORTCUT_GROUPS: ShortcutGroup[] = [
    {
      title: "General",
      items: [
        ["⌘K", "Command palette"],
        ["⌘Z / ⇧⌘Z", "Undo / redo"],
        ["?", "This list"],
      ],
    },
    {
      title: isDeck ? "Slides" : "Sections",
      items: [
        ["↑ / ↓", `Previous / next ${unitLabel}`],
        ["⌘D", "Duplicate"],
        ["⌘⌫", "Delete"],
        ["⌥↑ / ⌥↓", "Reorder in the navigator"],
      ],
    },
    {
      title: "Panels",
      items: [
        ["⌘1 / ⌘2 / ⌘3", "Format / Design / Notes"],
        ["⌥⌘1", "Toggle navigator"],
        ["⌥⌘2", "Toggle inspector"],
      ],
    },
    {
      title: "Document",
      items: isDeck ? [["⇧⌘P", "Present"]] : [["Esc", "Close a dialog"]],
    },
  ];

  /* ------------------------------- render ------------------------------ */

  if (error) {
    return (
      <main className="grid min-h-screen place-items-center px-6">
        <div className="surface max-w-md p-6 text-center">
          <h1 className="t-emph font-semibold">
            {error === "not-found" ? "Document not found" : "Could not load this document"}
          </h1>
          <p className="t-body mt-1.5 text-ink-2">
            {error === "not-found"
              ? "It may have been deleted from the library."
              : "The server did not respond as expected."}
          </p>
          <div className="mt-5 flex justify-center gap-2">
            <Button variant="primary" onClick={() => location.reload()}>
              Try again
            </Button>
            <Link href="/dashboard" className="btn btn-secondary">
              Back to library
            </Link>
          </div>
        </div>
      </main>
    );
  }

  if (!doc) {
    return (
      <main className="min-h-screen">
        <div
          className="hairline-b flex items-center gap-3 px-4"
          style={{ height: "var(--h-toolbar)" }}
        >
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-5 w-48" />
        </div>
        <div className="editor-shell">
          <div className="editor-nav p-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="mb-2 aspect-video w-full" />
            ))}
          </div>
          <div className="editor-canvas">
            <div className="editor-stage-area">
              <Skeleton className="editor-stage aspect-video" />
            </div>
          </div>
          <div className="editor-inspector p-4">
            <Skeleton className="h-7 w-full" />
          </div>
        </div>
      </main>
    );
  }

  const genParams = parseGenParams(doc);
  const report = doc.qualityReport
    ? (JSON.parse(doc.qualityReport) as QualityReportView)
    : null;
  const issuesForSelected = selected
    ? [...(report?.lint ?? []), ...(report?.critique ?? [])].filter(
        (issue) => issue.slideId === selected.id,
      )
    : [];
  const isDoc = !isDeck;
  const unit = unitLabel;

  return (
    <SlideMetaContext.Provider value={{ title: doc.title, sources: parseSources(doc) }}>
      <main className="flex h-screen flex-col overflow-hidden">
        <header
          className="hairline-b flex shrink-0 items-center gap-2 px-3"
          style={{ height: "var(--h-toolbar)" }}
        >
          <Link
            href="/dashboard"
            className="btn btn-ghost btn-icon"
            aria-label="Back to library"
            title="Back to library"
          >
            <Icon name="back" size={16} />
          </Link>
          <Link href="/dashboard" className="hidden shrink-0 sm:block">
            <Wordmark compact />
          </Link>

          <input
            value={doc.title}
            onChange={(e) => saveTitle(e.target.value)}
            aria-label="Document title"
            className="input-bare t-emph min-w-0 flex-1 font-semibold"
          />

          <div className="flex shrink-0 items-center gap-1">
            <IconButton
              icon="undo"
              label="Undo (⌘Z)"
              disabled={depths.undo === 0}
              onClick={undo}
            />
            <IconButton
              icon="redo"
              label="Redo (⇧⌘Z)"
              disabled={depths.redo === 0}
              onClick={redo}
            />
            <div className="divider-v mx-1 h-5 self-center" />
            <IconButton
              icon="panelLeft"
              label={navOpen ? "Hide navigator (⌥⌘1)" : "Show navigator (⌥⌘1)"}
              aria-pressed={navOpen}
              className={navOpen ? "bg-[var(--bg-selected)]" : undefined}
              onClick={() => setNavOpen((v) => !v)}
            />
            <IconButton
              icon="panelRight"
              label={inspectorOpen ? "Hide inspector (⌥⌘2)" : "Show inspector (⌥⌘2)"}
              aria-pressed={inspectorOpen}
              className={inspectorOpen ? "bg-[var(--bg-selected)]" : undefined}
              onClick={() => setInspectorOpen((v) => !v)}
            />
            <div className="divider-v mx-1 h-5 self-center" />
            <CommandButton />
            <QualityPanel
              report={report}
              reviewing={doc.status === "reviewing"}
              fixing={regenerating}
              slideNumbers={slideNumbers}
              onFix={(slideId, suggestion) => void regenerateSlide(slideId, suggestion)}
              onJump={(slideId) => {
                setSelectedId(slideId);
                setScope("notes");
                setInspectorOpen(true);
              }}
              onRerun={() => void rerunQuality()}
            />
            <ExportMenu id={doc.id} kind={doc.kind} title={doc.title} />
            {!isDoc && (
              <Link href={`/present/${doc.id}`} className="btn btn-primary">
                <Icon name="present" size={15} />
                Present
              </Link>
            )}
          </div>
        </header>

        {(doc.errorMessage || failedImages > 0) && (
          <div className="hairline-b shrink-0 px-4 py-2">
            {doc.errorMessage && (
              <p className="t-caption flex items-center gap-2 text-danger">
                <Icon name="error" size={14} />
                {doc.errorMessage}
              </p>
            )}
            {failedImages > 0 && pendingImages === 0 && (
              <p className="t-caption flex items-center gap-2 text-warning">
                <Icon name="warning" size={14} />
                {failedImages} image{failedImages > 1 ? "s" : ""} failed to render.
                <button
                  type="button"
                  className="btn btn-sm btn-secondary"
                  onClick={async () => {
                    await fetch(`/api/documents/${params.id}/assets`, { method: "POST" });
                    setFailedImages(0);
                    setPendingImages(1);
                  }}
                >
                  Retry
                </button>
              </p>
            )}
          </div>
        )}

        {slides.length === 0 ? (
          <div className="grid flex-1 place-items-center">
            <div className="max-w-sm text-center">
              <h2 className="t-emph font-semibold">Nothing here yet</h2>
              <p className="t-body mt-1.5 text-ink-2">
                This document has no content. Generate it, or start from a blank {unit}.
              </p>
              <div className="mt-5 flex justify-center gap-2">
                <Button variant="primary" icon="plus" onClick={() => addSlide()}>
                  Add {unit}
                </Button>
                <Link href="/new" className="btn btn-secondary">
                  Generate something
                </Link>
              </div>
            </div>
          </div>
        ) : (
          <div
            className="editor-shell"
            data-nav={navOpen ? "on" : "off"}
            data-inspector={inspectorOpen ? "on" : "off"}
          >
            <Navigator
              slides={slides}
              selectedId={selectedId}
              themeName={doc.themeName}
              customThemeData={customThemeData}
              kind={doc.kind}
              regenerating={regenerating}
              onSelect={setSelectedId}
              onReorder={reorderSlide}
              onDuplicate={duplicateSlide}
              onDelete={(id) => void deleteSlide(id)}
              onRegenerate={(id) => void regenerateSlide(id)}
              onAdd={addSlide}
            />

            <div className="editor-canvas">
              {isDoc ? (
                <div className="editor-doc-area scroll-thin">
                  <ThemeScope themeName={doc.themeName} customThemeData={customThemeData}>
                    <div className="editor-doc-page mx-auto max-w-5xl">
                      <DocumentView slides={slides} />
                    </div>
                  </ThemeScope>
                </div>
              ) : (
                <div className="editor-stage-area">
                  {selected && (
                    <div
                      className="editor-stage"
                      onDoubleClick={() => setTextOpen(true)}
                      title="Double-click to edit this slide’s text"
                    >
                      <ThemeScope themeName={doc.themeName} customThemeData={customThemeData}>
                        <ScaledSlide slide={selected} index={selectedIndex} />
                      </ThemeScope>
                    </div>
                  )}
                </div>
              )}
            </div>

            <Inspector
              scope={scope}
              onScope={setScope}
              slide={selected}
              index={selectedIndex}
              total={slides.length}
              kind={doc.kind}
              hasChart={selected ? findChartNode(selected) !== null : false}
              imageState={selected ? images.get(selected.id) : undefined}
              regenerating={regenerating}
              issues={issuesForSelected}
              notesSaved={saveState === "saved"}
              themeName={doc.themeName}
              hasCustomTheme={Boolean(doc.customTheme)}
              themeBusy={themeBusy}
              imageStyle={(genParams.imageStyle as string | undefined) ?? null}
              brandBusy={brandBusy}
              onArchetype={(id) => selected && setArchetype(selected.id, id)}
              onShuffleLayout={() => selected && shuffleLayout(selected.id)}
              onEditText={() => setTextOpen(true)}
              onEditChart={() => setChartOpen(true)}
              onRegenerateImage={(prompt) =>
                selected && void regenerateImage(selected.id, prompt)
              }
              onUploadImage={(file) => selected && void uploadImage(selected.id, file)}
              onImageFit={(fit) =>
                selected &&
                replaceSlide(selected.id, (s) => ({
                  ...s,
                  rootImage: { ...(s.rootImage ?? {}), fit },
                }) as PlateSlide)
              }
              onImageFocus={(focus) =>
                selected &&
                replaceSlide(selected.id, (s) => ({
                  ...s,
                  rootImage: { ...(s.rootImage ?? {}), focus },
                }) as PlateSlide)
              }
              onDuplicate={() => selected && duplicateSlide(selected.id)}
              onDelete={() => selected && void deleteSlide(selected.id)}
              onRegenerateSlide={(instruction) =>
                selected && void regenerateSlide(selected.id, instruction)
              }
              onNote={(note) => selected && saveNote(selected.id, note)}
              onPickTheme={pickTheme}
              onAiTheme={() => void generateAiTheme()}
              onImageStyle={setImageStyle}
              onApplyBrand={() => void applyBrandTheme()}
              onFixIssue={(slideId, suggestion) => void regenerateSlide(slideId, suggestion)}
            />
          </div>
        )}

        <footer className="editor-status shrink-0">
          <span>
            {slides.length > 0 && selectedIndex >= 0
              ? `${isDoc ? "Section" : "Slide"} ${selectedIndex + 1} of ${slides.length}`
              : `${slides.length} ${unit}s`}
          </span>
          <span aria-hidden>·</span>
          <span
            aria-live="polite"
            className="flex items-center gap-1.5"
          >
            {saveState === "saving" ? (
              <>
                <Spinner size={10} /> Saving…
              </>
            ) : saveState === "saved" ? (
              <>
                <Icon name="check" size={12} /> Saved
              </>
            ) : (
              "Up to date"
            )}
          </span>
          {pendingImages > 0 && (
            <>
              <span aria-hidden>·</span>
              <span className="flex items-center gap-1.5" aria-live="polite">
                <Spinner size={10} />
                Illustrating {pendingImages} image{pendingImages > 1 ? "s" : ""}
              </span>
            </>
          )}
          <span className="flex-1" />
          <span className="hidden sm:inline">
            {doc.status === "reviewing" ? "AI reviewer running…" : ""}
          </span>
        </footer>

        {textOpen && selected && (
          <TextEditorDrawer
            slide={selected}
            slideNumber={selectedIndex + 1}
            onApply={(next) => replaceSlide(selected.id, () => next)}
            onClose={() => setTextOpen(false)}
          />
        )}
        <ShortcutSheet
          open={shortcutsOpen}
          onClose={() => setShortcutsOpen(false)}
          groups={SHORTCUT_GROUPS}
        />
        {chartOpen && selected && (() => {
          const chart = findChartNode(selected);
          if (!chart) return null;
          return (
            <ChartDataEditor
              chartType={String(chart.node.type)}
              rows={
                Array.isArray(chart.node.data)
                  ? (chart.node.data as Array<Record<string, string | number>>)
                  : []
              }
              onApply={(rows) => applyChartRows(selected.id, rows)}
              onClose={() => setChartOpen(false)}
            />
          );
        })()}
      </main>
    </SlideMetaContext.Provider>
  );
}
