"use client";

/**
 * Creation flow: describe → review the outline → watch it generate.
 *
 * The streaming contract is load-bearing and unchanged: every chunk appends to
 * a cumulative buffer, and a 90ms-coalesced tick does reset() + parseChunk(all)
 * + finalize(), then runs the SAME backward-looking planner the server uses at
 * persist time. Anything else makes finished slides re-layout mid-stream.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { readSse } from "@/lib/client/sse";
import {
  SlideParser,
  type PlateSlide,
} from "@/lib/generation/parser/slide-parser";
import { planDeck } from "@/lib/design/planner";
import { IMAGE_STYLE_PRESETS } from "@/lib/images/styles";
import { ImportPanel } from "@/components/ui/import-panel";
import { parseOutlineMarkdown } from "@/lib/generation/prompts/outline";
import {
  getTemplate,
  templates,
  type TemplateBlueprint,
} from "@/lib/templates/library";
import { templateIcon } from "@/lib/templates/icons";
import { ScaledSlide } from "@/components/slides/render/slide-frame";
import { ThemeScope } from "@/components/slides/theme-scope";
import { Wordmark } from "@/components/ui/chrome";
import { Icon } from "@/components/ui/icon";
import { ThemeSwatch } from "@/components/ui/theme-picker";
import {
  Button,
  IconButton,
  SegmentedControl,
  Skeleton,
  Spinner,
  Switch,
  cx,
  useConfirm,
} from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import "@/styles/slides.css";
import { apiFetch } from "@/lib/client/base-path";

type Step = "form" | "outline" | "generating";

const STEPS: Array<{ id: Step; label: string }> = [
  { id: "form", label: "Describe" },
  { id: "outline", label: "Outline" },
  { id: "generating", label: "Generate" },
];

const TONES = [
  { value: "professional", label: "Professional" },
  { value: "casual", label: "Casual" },
  { value: "persuasive", label: "Persuasive" },
  { value: "academic", label: "Academic" },
] as const;

const IMAGE_MODELS = [
  { value: "", label: "Follow Settings" },
  { value: "flux-schnell", label: "FLUX Schnell — fastest" },
  { value: "qwen-image", label: "Qwen Image — renders text" },
  { value: "hidream", label: "HiDream — most photoreal" },
] as const;

interface OutlineCard {
  heading: string;
  bullets: string;
}

function cardsFromMarkdown(md: string): { title: string; cards: OutlineCard[] } {
  const { title, cards } = parseOutlineMarkdown(md);
  return {
    title,
    cards: cards.map((c) => {
      const lines = c.split(/\r?\n/);
      const heading = (lines[0] ?? "").replace(/^##\s+/, "").trim();
      const bullets = lines
        .slice(1)
        .map((l) => l.replace(/^-\s*/, "").trim())
        .filter(Boolean)
        .join("\n");
      return { heading, bullets };
    }),
  };
}

function markdownFromCards(title: string, cards: OutlineCard[]): string {
  const parts = [`# ${title}`];
  for (const card of cards) {
    parts.push(
      `## ${card.heading}\n${card.bullets
        .split(/\r?\n/)
        .filter(Boolean)
        .map((b) => `- ${b}`)
        .join("\n")}`,
    );
  }
  return parts.join("\n\n");
}

function Stepper({ step }: { step: Step }) {
  const at = STEPS.findIndex((s) => s.id === step);
  return (
    <ol className="flex items-center gap-1.5" aria-label="Progress">
      {STEPS.map((s, i) => {
        const state = i < at ? "done" : i === at ? "current" : "todo";
        return (
          <li key={s.id} className="flex items-center gap-1.5">
            {i > 0 && <span aria-hidden className="h-px w-5 bg-[var(--hairline-strong)]" />}
            <span
              className="flex items-center gap-1.5"
              aria-current={state === "current" ? "step" : undefined}
            >
              <span
                aria-hidden
                className={cx(
                  "grid h-[18px] w-[18px] place-items-center rounded-full text-[10px] font-semibold",
                  state === "todo" && "bg-[var(--bg-hover)] text-ink-3",
                  state === "current" && "bg-[var(--accent)] text-[var(--text-on-accent)]",
                  state === "done" && "bg-[var(--bg-selected)] text-ink-2",
                )}
              >
                {state === "done" ? <Icon name="check" size={11} /> : i + 1}
              </span>
              <span className={cx("t-label", state === "todo" ? "text-ink-3" : "text-ink")}>
                {s.label}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** Label column + control, the same 88px rhythm the editor inspector uses. */
function Row({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[var(--w-insp-label)_minmax(0,1fr)] items-start gap-4">
      <label htmlFor={htmlFor} className="t-label pt-[7px] text-right text-ink-2">
        {label}
      </label>
      <div className="min-w-0">
        {children}
        {hint && <p className="t-caption mt-1 text-ink-3">{hint}</p>}
      </div>
    </div>
  );
}

export default function NewDocumentPage() {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();

  const [step, setStep] = useState<Step>("form");
  const [kind, setKind] = useState<"deck" | "doc">("deck");
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [nCards, setNCards] = useState(8);
  const [tone, setTone] = useState<string>("professional");
  const [webSearch, setWebSearch] = useState(true);
  const [imageModel, setImageModel] = useState<string>("");
  const [imageStyle, setImageStyle] = useState<string>("");
  const [showImport, setShowImport] = useState(false);
  const [importedWords, setImportedWords] = useState(0);
  const [brandAvailable, setBrandAvailable] = useState(false);
  const [useBrandTheme, setUseBrandTheme] = useState(false);

  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [streamMd, setStreamMd] = useState("");
  const [outlineDone, setOutlineDone] = useState(false);
  const [title, setTitle] = useState("");
  const [cards, setCards] = useState<OutlineCard[]>([]);
  const [slides, setSlides] = useState<PlateSlide[]>([]);
  const [progress, setProgress] = useState(0);
  const [docTheme, setDocTheme] = useState<{ name: string; custom: unknown }>({
    name: "mystique",
    custom: null,
  });

  const importedRef = useRef<{ text: string; mode: "verbatim" | "summarize" } | null>(null);
  const documentIdRef = useRef<string | null>(null);
  const landedRef = useRef(false);
  const parserRef = useRef<SlideParser | null>(null);
  const cumulativeRef = useRef("");
  const renderTimer = useRef<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const selectedTemplate = templateId ? getTemplate(templateId) : undefined;
  const visibleTemplates = useMemo(
    () => templates.filter((t) => t.kind === kind),
    [kind],
  );

  useEffect(() => {
    void apiFetch("/api/settings")
      .then((r) => r.json())
      .then((s: { brand?: { colors?: string[] } }) => {
        if ((s.brand?.colors?.length ?? 0) > 0) setBrandAvailable(true);
      })
      .catch(() => undefined);
  }, []);

  // The coalescing timer and the in-flight stream must not outlive the page.
  useEffect(
    () => () => {
      if (renderTimer.current !== null) window.clearTimeout(renderTimer.current);
      abortRef.current?.abort();
    },
    [],
  );

  function pickTemplate(t: TemplateBlueprint) {
    setTemplateId(t.id);
    setKind(t.kind);
    setNCards(t.nCards);
    setTone(t.tone);
  }

  function pickKind(k: "deck" | "doc") {
    setKind(k);
    if (selectedTemplate && selectedTemplate.kind !== k) setTemplateId(null);
  }

  /** Discard a document that was created but never generated. */
  const discardDraft = useCallback(async () => {
    const id = documentIdRef.current;
    if (!id || landedRef.current) return;
    documentIdRef.current = null;
    await apiFetch(`/api/documents/${id}`, { method: "DELETE" }).catch(() => undefined);
  }, []);

  const leave = useCallback(async () => {
    if (documentIdRef.current && !landedRef.current) {
      const ok = await confirm({
        title: "Discard this draft?",
        description:
          "The outline generated so far will be deleted. Nothing has been saved to your library yet.",
        confirmLabel: "Discard",
        danger: true,
      });
      if (!ok) return;
      abortRef.current?.abort();
      await discardDraft();
    }
    router.push("/dashboard");
  }, [confirm, discardDraft, router]);

  async function startOutline() {
    setError(null);
    setStep("outline");
    setStatus("Creating…");
    setStreamMd("");
    setOutlineDone(false);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      let documentId = documentIdRef.current;
      if (!documentId) {
        const createRes = await apiFetch("/api/documents", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            kind,
            prompt,
            templateId: templateId ?? undefined,
            useBrandTheme: useBrandTheme || undefined,
            genParams: {
              nCards,
              language: "English",
              tone,
              webSearch: importedRef.current ? false : webSearch,
              ...(imageModel ? { imageModel } : {}),
              ...(imageStyle ? { imageStyle } : {}),
              ...(importedRef.current ? { importMode: importedRef.current.mode } : {}),
            },
          }),
        });
        if (!createRes.ok) throw new Error("Could not create the document");
        documentId = ((await createRes.json()) as { id: string }).id;
        documentIdRef.current = documentId;

        // Preview with the theme the document actually got (template pairing
        // or brand kit) instead of falling back to the default.
        void apiFetch(`/api/documents/${documentId}`)
          .then((r) => r.json())
          .then((d: { themeName: string; customTheme?: { data: string } | null }) => {
            let custom: unknown = null;
            try {
              custom = d.customTheme?.data ? JSON.parse(d.customTheme.data) : null;
            } catch {
              custom = null;
            }
            setDocTheme({ name: d.themeName, custom });
          })
          .catch(() => undefined);
      }

      // Imported source grounds the outline instead of web research.
      if (importedRef.current) {
        await apiFetch(`/api/documents/${documentId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            researchContext: `# SOURCE DOCUMENT (authoritative)\n\nThe user provided this source document. Ground every section in its actual content — facts, numbers, and structure come from here.\n\n${importedRef.current.text}`,
          }),
        });
      }

      const res = await apiFetch("/api/generation/outline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({ documentId }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? `Outline failed (${res.status})`);
      }
      let md = "";
      for await (const event of readSse(res)) {
        if (event.type === "status") setStatus((event.data as { status: string }).status);
        else if (event.type === "chunk") {
          md += (event.data as { chunk: string }).chunk;
          setStreamMd(md);
        } else if (event.type === "error") {
          throw new Error((event.data as { detail: string }).detail);
        } else if (event.type === "complete") {
          const parsed = cardsFromMarkdown(md);
          setTitle(parsed.title);
          setCards(parsed.cards);
          setOutlineDone(true);
          setStatus("");
        }
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function startGeneration() {
    const documentId = documentIdRef.current;
    if (!documentId) return;
    setError(null);
    setStep("generating");
    setStatus("Warming up");
    setSlides([]);
    setProgress(4);
    parserRef.current = new SlideParser({ mode: kind === "doc" ? "document" : "deck" });
    cumulativeRef.current = "";
    const controller = new AbortController();
    abortRef.current = controller;

    const renderNow = () => {
      const parser = parserRef.current;
      if (!parser) return;
      parser.reset();
      parser.parseChunk(cumulativeRef.current);
      parser.finalize();
      const parsed = parser.getAllSlides();
      // Same planner the server runs at persist time — backward-looking, so
      // completed slides' archetypes never flip as later slides stream in.
      setSlides(kind === "deck" ? planDeck(parsed) : [...parsed]);
      renderTimer.current = null;
    };
    const schedule = () => {
      renderTimer.current ??= window.setTimeout(renderNow, 90);
    };

    try {
      await apiFetch(`/api/documents/${documentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({ outline: markdownFromCards(title, cards), title }),
      });
      const res = await apiFetch("/api/generation/content", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({ documentId }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? `Generation failed (${res.status})`);
      }
      for await (const event of readSse(res)) {
        if (event.type === "status") setStatus((event.data as { status: string }).status);
        else if (event.type === "chunk") {
          cumulativeRef.current += (event.data as { chunk: string }).chunk;
          schedule();
        } else if (event.type === "progress") {
          const p = event.data as { sections: number; total: number };
          setStatus(
            `Designing ${kind === "doc" ? "section" : "slide"} ${Math.min(p.sections + 1, p.total)} of ${p.total}`,
          );
          setProgress(Math.min(92, 8 + (p.sections / Math.max(1, p.total)) * 84));
        } else if (event.type === "error") {
          throw new Error((event.data as { detail: string }).detail);
        } else if (event.type === "complete") {
          renderNow();
          setProgress(100);
          landedRef.current = true;
          router.replace(`/editor/${documentId}`);
          return;
        }
      }
      landedRef.current = true;
      router.replace(`/editor/${documentId}`);
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function cancelGeneration() {
    abortRef.current?.abort();
    if (renderTimer.current !== null) {
      window.clearTimeout(renderTimer.current);
      renderTimer.current = null;
    }
    setStep("outline");
    setStatus("");
    setProgress(0);
    toast({
      title: "Generation stopped",
      description: "Your outline is intact — edit it and generate again.",
    });
  }

  const unit = kind === "doc" ? "section" : "slide";

  return (
    <main className="min-h-screen">
      <header
        className="hairline-b material sticky top-0 flex items-center gap-4 px-5"
        style={{ height: "var(--h-toolbar)", zIndex: "var(--z-sticky)" as unknown as number }}
      >
        <Link href="/dashboard" onClick={(e) => { e.preventDefault(); void leave(); }}>
          <Wordmark compact />
        </Link>
        <div className="flex-1" />
        <Stepper step={step} />
        <div className="flex-1" />
        <IconButton icon="close" label="Close" onClick={() => void leave()} />
      </header>

      {/* ------------------------------ step 1 ------------------------------ */}
      {step === "form" && (
        <section className="anim-in mx-auto max-w-3xl px-6 pb-24 pt-14">
          <h1 className="t-large text-center font-semibold">
            What would you like to create?
          </h1>
          <p className="t-body mt-2 text-center text-ink-2">
            Describe it — Vellum plans, writes, designs and illustrates it on this machine.
          </p>

          <div className="mt-7 flex justify-center">
            <SegmentedControl
              label="What to create"
              options={[
                { value: "deck", label: "Presentation", icon: "deck" },
                { value: "doc", label: "Document", icon: "doc" },
              ]}
              value={kind}
              onChange={pickKind}
            />
          </div>

          <div className="mt-8">
            <h2 className="t-eyebrow mb-2.5 text-ink-3">Start from a template</h2>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              <button
                type="button"
                role="radio"
                aria-checked={templateId === null}
                onClick={() => setTemplateId(null)}
                className={cx(
                  "surface flex flex-col items-start p-3 text-left transition-shadow",
                  templateId === null && "ring-2 ring-[var(--accent)]",
                )}
              >
                <Icon name="tplBlank" size={18} className="text-ink-2" />
                <span className="t-body mt-2 font-medium">Blank</span>
                <span className="t-caption mt-0.5 line-clamp-2 text-ink-3">
                  Freeform — the model plans the structure
                </span>
              </button>
              {visibleTemplates.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="radio"
                  aria-checked={templateId === t.id}
                  onClick={() => pickTemplate(t)}
                  className={cx(
                    "surface flex flex-col items-start p-3 text-left transition-shadow",
                    templateId === t.id && "ring-2 ring-[var(--accent)]",
                  )}
                >
                  <span className="flex w-full items-center justify-between">
                    <Icon name={templateIcon(t.id, t.kind)} size={18} className="text-ink-2" />
                    <ThemeSwatch name={t.theme} size={14} />
                  </span>
                  <span className="t-body mt-2 truncate font-medium">{t.name}</span>
                  <span className="t-caption mt-0.5 line-clamp-2 text-ink-3">{t.tagline}</span>
                  <span className="t-caption mt-1.5 text-ink-3">{t.nCards} sections</span>
                </button>
              ))}
            </div>
          </div>

          <div className="surface mt-6 overflow-hidden">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              aria-label={`What should this ${kind === "deck" ? "presentation" : "document"} be about?`}
              placeholder={
                selectedTemplate?.promptPlaceholder ??
                (kind === "deck"
                  ? "e.g. An investor pitch for a solar-powered drone delivery startup…"
                  : "e.g. A market briefing on small modular nuclear reactors…")
              }
              rows={4}
              className="w-full resize-none border-0 bg-transparent px-4 py-3.5 outline-none placeholder:text-ink-3"
              style={{ fontSize: "var(--t-emph)" }}
              autoFocus
            />

            <div className="hairline-t space-y-3 p-4">
              <Row label={kind === "deck" ? "Slides" : "Sections"} htmlFor="new-count">
                <div className="flex items-center gap-1">
                  <IconButton
                    icon="minus"
                    size="sm"
                    variant="secondary"
                    label={`One fewer ${unit}`}
                    disabled={nCards <= 1}
                    onClick={() => setNCards((n) => Math.max(1, n - 1))}
                  />
                  <input
                    id="new-count"
                    type="number"
                    min={1}
                    max={30}
                    value={nCards}
                    onChange={(e) =>
                      setNCards(Math.min(30, Math.max(1, Number(e.target.value) || 8)))
                    }
                    className="input w-14 text-center"
                  />
                  <IconButton
                    icon="plus"
                    size="sm"
                    variant="secondary"
                    label={`One more ${unit}`}
                    disabled={nCards >= 30}
                    onClick={() => setNCards((n) => Math.min(30, n + 1))}
                  />
                </div>
              </Row>

              <Row label="Tone">
                <SegmentedControl
                  label="Tone"
                  options={TONES}
                  value={tone}
                  onChange={setTone}
                />
              </Row>

              <Row
                label="Research"
                hint={
                  importedRef.current
                    ? "Disabled — the attached source is the authority."
                    : "Search the web locally with SearXNG before writing."
                }
              >
                <Switch
                  label="Research the topic before writing"
                  checked={webSearch && !importedRef.current}
                  onChange={setWebSearch}
                />
              </Row>

              <Row label="Image model" htmlFor="new-image-model">
                <select
                  id="new-image-model"
                  className="input"
                  value={imageModel}
                  onChange={(e) => setImageModel(e.target.value)}
                >
                  {IMAGE_MODELS.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </Row>

              <Row
                label="Image style"
                htmlFor="new-image-style"
                hint={
                  IMAGE_STYLE_PRESETS.find((p) => p.id === imageStyle)?.tagline ??
                  "Automatic follows the theme's design family."
                }
              >
                <select
                  id="new-image-style"
                  className="input"
                  value={imageStyle}
                  onChange={(e) => setImageStyle(e.target.value)}
                >
                  <option value="">Automatic</option>
                  {IMAGE_STYLE_PRESETS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </Row>

              {brandAvailable && (
                <Row label="Brand kit" hint="Use your saved colors, fonts and logo.">
                  <Switch
                    label="Theme this document with the brand kit"
                    checked={useBrandTheme}
                    onChange={setUseBrandTheme}
                  />
                </Row>
              )}

              <Row label="Source" hint="Rewrite or summarize an existing document instead.">
                {importedRef.current ? (
                  <div className="flex items-center gap-2">
                    <span className="badge">
                      <Icon name="doc" size={11} />
                      {importedWords.toLocaleString()} words attached
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      icon="close"
                      onClick={() => {
                        importedRef.current = null;
                        setImportedWords(0);
                      }}
                    >
                      Remove
                    </Button>
                  </div>
                ) : (
                  <Button
                    size="sm"
                    icon="upload"
                    aria-expanded={showImport}
                    onClick={() => setShowImport(!showImport)}
                  >
                    Attach a document
                  </Button>
                )}
              </Row>

              {showImport && !importedRef.current && (
                <div className="pt-1">
                  <ImportPanel
                    onImported={({ text, title: importTitle, mode }) => {
                      importedRef.current = { text, mode };
                      setImportedWords(text.split(/\s+/).filter(Boolean).length);
                      setShowImport(false);
                      if (!prompt.trim() && importTitle) setPrompt(importTitle);
                    }}
                  />
                </div>
              )}
            </div>

            <div className="hairline-t flex justify-end px-4 py-3">
              <Button
                variant="primary"
                size="lg"
                iconEnd="forward"
                disabled={prompt.trim().length === 0}
                onClick={() => void startOutline()}
              >
                Generate outline
              </Button>
            </div>
          </div>
        </section>
      )}

      {/* ------------------------------ step 2 ------------------------------ */}
      {step === "outline" && (
        <section className="anim-in mx-auto max-w-2xl px-6 py-10">
          {!outlineDone ? (
            <>
              <p
                className="t-body flex items-center justify-center gap-2 text-center text-ink-2"
                aria-live="polite"
              >
                <Spinner /> {status || "Drafting the outline…"}
              </p>
              <div className="surface mt-5 p-5">
                {streamMd ? (
                  <pre className="t-body whitespace-pre-wrap font-sans leading-relaxed text-ink-2">
                    {streamMd}
                  </pre>
                ) : (
                  <div className="space-y-2.5">
                    {[0, 1, 2, 3, 4].map((i) => (
                      <Skeleton key={i} className="h-4" style={{ width: `${88 - i * 11}%` }} />
                    ))}
                  </div>
                )}
              </div>
              <div className="mt-5 flex justify-center">
                <Button icon="close" onClick={() => void leave()}>
                  Cancel
                </Button>
              </div>
            </>
          ) : (
            <>
              <label htmlFor="outline-title" className="t-eyebrow block text-center text-ink-3">
                Title
              </label>
              <input
                id="outline-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="input-bare t-title2 mt-1 text-center font-semibold"
              />
              <p className="t-body mt-1.5 text-center text-ink-2">
                Edit, reorder or remove {unit}s, then generate.
              </p>

              <ol className="mt-6 space-y-2">
                {cards.map((card, i) => (
                  <li key={i} className="surface p-3.5">
                    <div className="flex items-start gap-3">
                      <span
                        aria-hidden
                        className="t-caption mt-1 grid h-6 w-6 flex-none place-items-center rounded-full bg-[var(--bg-hover)] font-semibold text-ink-2"
                      >
                        {i + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <input
                          value={card.heading}
                          aria-label={`${unit} ${i + 1} heading`}
                          onChange={(e) =>
                            setCards(cards.map((c, j) => (j === i ? { ...c, heading: e.target.value } : c)))
                          }
                          className="input-bare t-emph font-semibold"
                        />
                        <textarea
                          value={card.bullets}
                          aria-label={`${unit} ${i + 1} talking points`}
                          onChange={(e) =>
                            setCards(cards.map((c, j) => (j === i ? { ...c, bullets: e.target.value } : c)))
                          }
                          rows={Math.max(2, card.bullets.split("\n").length)}
                          className="input-bare mt-0.5 resize-none leading-relaxed text-ink-2"
                        />
                      </div>
                      {/* Always visible: these were hover-only and unreachable
                          by keyboard or touch. */}
                      <div className="flex flex-none flex-col gap-0.5">
                        <IconButton
                          icon="moveUp"
                          size="sm"
                          label={`Move ${unit} ${i + 1} up`}
                          disabled={i === 0}
                          onClick={() => {
                            const n = [...cards];
                            [n[i - 1], n[i]] = [n[i], n[i - 1]];
                            setCards(n);
                          }}
                        />
                        <IconButton
                          icon="moveDown"
                          size="sm"
                          label={`Move ${unit} ${i + 1} down`}
                          disabled={i === cards.length - 1}
                          onClick={() => {
                            const n = [...cards];
                            [n[i + 1], n[i]] = [n[i], n[i + 1]];
                            setCards(n);
                          }}
                        />
                        <IconButton
                          icon="trash"
                          size="sm"
                          label={`Remove ${unit} ${i + 1}`}
                          className="text-danger"
                          onClick={() => setCards(cards.filter((_, j) => j !== i))}
                        />
                      </div>
                    </div>
                  </li>
                ))}
              </ol>

              <Button
                icon="plus"
                className="mt-2 w-full"
                onClick={() => setCards([...cards, { heading: "New section", bullets: "Key point" }])}
              >
                Add {unit}
              </Button>

              {error && (
                <div className="surface mt-5 p-4">
                  <p className="t-body flex items-start gap-2 text-danger">
                    <Icon name="error" size={15} className="mt-px shrink-0" />
                    {error}
                  </p>
                  <Button
                    className="mt-3"
                    icon="regenerate"
                    onClick={() => {
                      setError(null);
                      setOutlineDone(false);
                      void startOutline();
                    }}
                  >
                    Try the outline again
                  </Button>
                </div>
              )}

              <div className="mt-7 flex items-center justify-center gap-2">
                <Button icon="back" onClick={() => setStep("form")}>
                  Back
                </Button>
                <Button
                  variant="primary"
                  size="lg"
                  icon="sparkle"
                  disabled={cards.length === 0}
                  onClick={() => void startGeneration()}
                >
                  Generate {kind === "deck" ? "presentation" : "document"}
                </Button>
              </div>
            </>
          )}
          {error && !outlineDone && (
            <div className="surface mt-5 p-4 text-center">
              <p className="t-body flex items-center justify-center gap-2 text-danger">
                <Icon name="error" size={15} />
                {error}
              </p>
              <Button
                className="mt-3"
                icon="regenerate"
                onClick={() => {
                  setError(null);
                  void startOutline();
                }}
              >
                Try again
              </Button>
            </div>
          )}
        </section>
      )}

      {/* ------------------------------ step 3 ------------------------------ */}
      {step === "generating" && (
        <section className="anim-in mx-auto max-w-4xl px-6 py-10">
          <div className="mx-auto max-w-md text-center">
            <p className="t-body font-medium text-ink-2" aria-live="polite">
              {status}
            </p>
            <div
              role="progressbar"
              aria-valuenow={Math.round(progress)}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`Generating your ${kind === "deck" ? "presentation" : "document"}`}
              className="mt-3 h-1.5 overflow-hidden rounded-full bg-[var(--bg-hover)]"
            >
              <div
                className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-500"
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className="mt-3 flex justify-center">
              <Button size="sm" icon="stop" onClick={cancelGeneration}>
                Stop
              </Button>
            </div>
          </div>

          {error && (
            <div className="surface mx-auto mt-5 max-w-md p-4 text-center">
              <p className="t-body flex items-center justify-center gap-2 text-danger">
                <Icon name="error" size={15} />
                {error}
              </p>
              <div className="mt-3 flex justify-center gap-2">
                <Button
                  variant="primary"
                  icon="regenerate"
                  onClick={() => {
                    setError(null);
                    void startGeneration();
                  }}
                >
                  Try again
                </Button>
                <Button icon="revert" onClick={() => setStep("outline")}>
                  Back to the outline
                </Button>
              </div>
            </div>
          )}

          <div className="mt-8 flex flex-col gap-7">
            {slides.map((slide, slideIdx) => (
              <div
                key={slide.id}
                className="anim-in overflow-hidden rounded-[10px]"
                style={{ boxShadow: "var(--shadow-drag)" }}
              >
                <ThemeScope themeName={docTheme.name} customThemeData={docTheme.custom}>
                  <ScaledSlide slide={slide} index={slideIdx} />
                </ThemeScope>
              </div>
            ))}
            {slides.length === 0 && (
              <Skeleton className="mx-auto aspect-video w-full max-w-3xl rounded-[10px]" />
            )}
          </div>
        </section>
      )}
    </main>
  );
}
