"use client";

/**
 * Settings — every field the schema defines, saved on a debounce with an
 * explicit save state. Health is tri-state (checking / reachable / down); it
 * used to render red for "not resolved yet", which read as an outage on
 * every load.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { TopNav } from "@/components/ui/chrome";
import { Icon } from "@/components/ui/icon";
import {
  Button,
  SegmentedControl,
  Skeleton,
  Spinner,
  Switch,
  cx,
} from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { apiFetch, assetUrl } from "@/lib/client/base-path";

interface Settings {
  llm: { ollamaUrl: string; model: string; think: boolean };
  search: { enabled: boolean; searxngUrl: string; maxResults: number };
  images: {
    provider: "comfyui" | "gemini" | "pexels" | "none";
    comfyuiUrl: string;
    comfyuiWorkflow: "16x9" | "square";
    comfyModel: "flux-schnell" | "qwen-image" | "hidream";
    geminiApiKey: string;
    geminiModel: string;
    pexelsApiKey: string;
  };
  icons: { weight: string };
  brand?: { name: string; logoUrl: string; colors: string[] };
}

interface Health {
  services: { db: boolean; ollama: boolean; searxng: boolean; comfyui: boolean };
}

const COMFY_MODELS = [
  { id: "flux-schnell", name: "FLUX.1 schnell", tag: "Fastest — about 2s a frame" },
  { id: "qwen-image", name: "Qwen-Image", tag: "Renders legible text in the image" },
  { id: "hidream", name: "HiDream-I1", tag: "Most photoreal, slowest" },
] as const;

const PROVIDERS = [
  { value: "comfyui" as const, label: "ComfyUI" },
  { value: "gemini" as const, label: "Gemini" },
  { value: "pexels" as const, label: "Pexels" },
  { value: "none" as const, label: "None" },
];

const ICON_WEIGHTS = ["thin", "light", "regular", "bold", "fill", "duotone"];

type SaveState = "idle" | "saving" | "saved" | "error";

/** Tri-state health lamp: unknown until the probe answers. */
function Lamp({ state }: { state: boolean | undefined }) {
  const color =
    state === undefined ? "var(--text-quaternary)" : state ? "var(--success)" : "var(--danger)";
  const label =
    state === undefined ? "Checking…" : state ? "Reachable" : "Not reachable";
  return (
    <span className="t-caption flex items-center gap-1.5 text-ink-3" title={label}>
      <span
        aria-hidden
        className={cx("inline-block h-2 w-2 rounded-full", state === undefined && "animate-pulse")}
        style={{ background: color }}
      />
      {label}
    </span>
  );
}

function Section(props: {
  title: string;
  description?: string;
  /** Present only for sections backed by a health probe. */
  health?: boolean | undefined;
  children: React.ReactNode;
  wide?: boolean;
}) {
  const { title, description, children, wide } = props;
  // "health" may legitimately be undefined (still checking), so presence of
  // the key — not its value — decides whether a lamp belongs here at all.
  const probed = "health" in props;
  return (
    <section className={cx("surface p-5", wide && "md:col-span-2")}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="t-emph font-semibold">{title}</h2>
          {description && <p className="t-caption mt-1 text-ink-3">{description}</p>}
        </div>
        {probed && <Lamp state={props.health} />}
      </div>
      <div className="mt-4 space-y-3.5">{children}</div>
    </section>
  );
}

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
      {/* Optically centred against a 28px control, and stays put when the
          control grows taller than one row. */}
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

export default function SettingsPage() {
  const toast = useToast();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [testing, setTesting] = useState(false);
  const [testingModel, setTestingModel] = useState<string | null>(null);
  const [brandUrl, setBrandUrl] = useState("");
  const [brandBusy, setBrandBusy] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await apiFetch("/api/settings");
      if (!res.ok) throw new Error(`Settings failed to load (${res.status})`);
      setSettings((await res.json()) as Settings);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void load();
    void apiFetch("/api/health")
      .then((r) => r.json())
      .then(setHealth)
      .catch(() =>
        setHealth({ services: { db: false, ollama: false, searxng: false, comfyui: false } }),
      );
  }, [load]);

  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
  }, []);

  /** Optimistic local update; one PUT after 500ms of quiet. */
  const save = useCallback(
    (next: Settings) => {
      setSettings(next);
      setSaveState("saving");
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(async () => {
        try {
          const res = await apiFetch("/api/settings", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(next),
          });
          if (!res.ok) throw new Error(`Save failed (${res.status})`);
          setSaveState("saved");
        } catch (err) {
          setSaveState("error");
          toast({
            title: "Could not save settings",
            description: err instanceof Error ? err.message : String(err),
            tone: "error",
          });
        }
      }, 500);
    },
    [toast],
  );

  const extractBrand = async (input: { url?: string; file?: File }) => {
    setBrandBusy(true);
    try {
      let res: Response;
      if (input.file) {
        const form = new FormData();
        form.append("file", input.file);
        res = await apiFetch("/api/brand", { method: "POST", body: form });
      } else {
        res = await apiFetch("/api/brand", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: input.url }),
        });
      }
      const data = (await res.json()) as {
        name?: string;
        logoUrl?: string;
        colors?: string[];
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? `Extraction failed (${res.status})`);
      setSettings((s) =>
        s
          ? {
              ...s,
              brand: {
                name: data.name ?? "",
                logoUrl: data.logoUrl ?? "",
                colors: data.colors ?? [],
              },
            }
          : s,
      );
      toast({
        title: "Brand kit saved",
        description: `${data.colors?.length ?? 0} colors extracted.`,
        tone: "success",
      });
    } catch (err) {
      toast({
        title: "Brand extraction failed",
        description: err instanceof Error ? err.message : String(err),
        tone: "error",
      });
    } finally {
      setBrandBusy(false);
    }
  };

  const testImage = async (model?: string, name?: string) => {
    if (model) setTestingModel(model);
    else setTesting(true);
    try {
      const res = await apiFetch("/api/images/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt:
            model === "qwen-image"
              ? 'minimalist poster with the word "VELLUM" in bold modern typography, violet gradient background'
              : "abstract geometric shapes, soft gradients, minimal design",
          ...(model ? { model } : {}),
        }),
      });
      const data = (await res.json()) as { seconds?: number; error?: string };
      if (!res.ok) throw new Error(data.error ?? `Failed (${res.status})`);
      toast({
        title: `${name ?? "Image generation"} works`,
        description: `Rendered in ${data.seconds}s.`,
        tone: "success",
      });
    } catch (err) {
      toast({
        title: `${name ?? "Image generation"} failed`,
        description: err instanceof Error ? err.message : String(err),
        tone: "error",
      });
    } finally {
      setTestingModel(null);
      setTesting(false);
    }
  };

  if (loadError) {
    return (
      <main className="min-h-screen">
        <TopNav />
        <div className="mx-auto max-w-md px-6 py-20 text-center">
          <h1 className="t-emph font-semibold">Settings could not load</h1>
          <p className="t-body mt-1.5 text-ink-2">{loadError}</p>
          <Button variant="primary" className="mt-5" icon="regenerate" onClick={() => void load()}>
            Try again
          </Button>
        </div>
      </main>
    );
  }

  if (!settings) {
    return (
      <main className="min-h-screen">
        <TopNav />
        <div className="mx-auto grid max-w-4xl gap-5 px-6 py-8 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="surface p-5">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="mt-4 h-7 w-full" />
              <Skeleton className="mt-3 h-7 w-full" />
            </div>
          ))}
        </div>
      </main>
    );
  }

  const s = settings;

  return (
    <main className="min-h-screen">
      <TopNav
        right={
          <span className="t-caption flex items-center gap-1.5 text-ink-3" aria-live="polite">
            {saveState === "saving" ? (
              <>
                <Spinner size={11} /> Saving…
              </>
            ) : saveState === "saved" ? (
              <>
                <Icon name="check" size={13} /> Saved
              </>
            ) : saveState === "error" ? (
              <span className="text-danger">Not saved</span>
            ) : null}
          </span>
        }
      />

      <div className="mx-auto max-w-4xl px-6 py-8">
        <h1 className="t-title2 font-semibold">Settings</h1>
        <p className="t-body mt-1 text-ink-2">
          Everything runs on this machine. Changes save as you make them.
        </p>

        <div className="mt-6 grid gap-5 md:grid-cols-2">
          <Section
            title="Language model"
            description="Ollama serves every generation."
            health={health?.services.ollama}
          >
            <Row label="Server" htmlFor="set-ollama-url">
              <input
                id="set-ollama-url"
                className="input"
                value={s.llm.ollamaUrl}
                onChange={(e) => save({ ...s, llm: { ...s.llm, ollamaUrl: e.target.value } })}
              />
            </Row>
            <Row label="Model" htmlFor="set-ollama-model">
              <input
                id="set-ollama-model"
                className="input"
                value={s.llm.model}
                onChange={(e) => save({ ...s, llm: { ...s.llm, model: e.target.value } })}
              />
            </Row>
            <Row
              label="Thinking"
              hint="Let the model reason before answering — better structure, noticeably slower."
            >
              <Switch
                label="Enable extended thinking"
                checked={s.llm.think}
                onChange={(think) => save({ ...s, llm: { ...s.llm, think } })}
              />
            </Row>
          </Section>

          <Section
            title="Web research"
            description="SearXNG grounds decks in current facts."
            health={health?.services.searxng}
          >
            <Row label="Enabled">
              <Switch
                label="Research topics before writing"
                checked={s.search.enabled}
                onChange={(enabled) => save({ ...s, search: { ...s.search, enabled } })}
              />
            </Row>
            <Row label="Server" htmlFor="set-searxng-url">
              <input
                id="set-searxng-url"
                className="input"
                value={s.search.searxngUrl}
                onChange={(e) =>
                  save({ ...s, search: { ...s.search, searxngUrl: e.target.value } })
                }
              />
            </Row>
            <Row
              label="Results"
              htmlFor="set-search-results"
              hint="Pages read per query, 1–10. More context, slower outlines."
            >
              <input
                id="set-search-results"
                type="number"
                min={1}
                max={10}
                className="input w-20"
                value={s.search.maxResults}
                onChange={(e) =>
                  save({
                    ...s,
                    search: {
                      ...s.search,
                      maxResults: Math.min(10, Math.max(1, Number(e.target.value) || 5)),
                    },
                  })
                }
              />
            </Row>
          </Section>

          <Section
            title="Images"
            description="Illustration provider for generated slides."
            health={s.images.provider === "comfyui" ? health?.services.comfyui : undefined}
            wide
          >
            <Row label="Provider">
              <SegmentedControl
                label="Image provider"
                options={PROVIDERS}
                value={s.images.provider}
                onChange={(provider) => save({ ...s, images: { ...s.images, provider } })}
              />
            </Row>

            {s.images.provider === "comfyui" && (
              <>
                <Row label="Server" htmlFor="set-comfy-url">
                  <input
                    id="set-comfy-url"
                    className="input"
                    value={s.images.comfyuiUrl}
                    onChange={(e) =>
                      save({ ...s, images: { ...s.images, comfyuiUrl: e.target.value } })
                    }
                  />
                </Row>
                <Row label="Frame" hint="Aspect ratio ComfyUI renders at.">
                  <SegmentedControl
                    label="Image aspect ratio"
                    options={[
                      { value: "16x9" as const, label: "16 : 9" },
                      { value: "square" as const, label: "Square" },
                    ]}
                    value={s.images.comfyuiWorkflow}
                    onChange={(comfyuiWorkflow) =>
                      save({ ...s, images: { ...s.images, comfyuiWorkflow } })
                    }
                  />
                </Row>
                <Row label="Model">
                  <div
                    className="grid gap-2 sm:grid-cols-3"
                    role="radiogroup"
                    aria-label="Image model"
                  >
                    {COMFY_MODELS.map((m) => (
                      <div
                        key={m.id}
                        className={cx(
                          "rounded-[6px] p-2.5",
                          s.images.comfyModel === m.id
                            ? "ring-2 ring-[var(--accent)]"
                            : "ring-1 ring-[var(--hairline)]",
                        )}
                      >
                        <button
                          type="button"
                          role="radio"
                          aria-checked={s.images.comfyModel === m.id}
                          className="block w-full text-left"
                          onClick={() =>
                            save({ ...s, images: { ...s.images, comfyModel: m.id } })
                          }
                        >
                          <span className="t-body block font-medium">{m.name}</span>
                          <span className="t-caption mt-0.5 block text-ink-3">{m.tag}</span>
                        </button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="mt-1.5"
                          disabled={testingModel !== null}
                          onClick={() => void testImage(m.id, m.name)}
                        >
                          {testingModel === m.id ? <Spinner size={11} /> : null}
                          {testingModel === m.id ? "Testing…" : "Test"}
                        </Button>
                      </div>
                    ))}
                  </div>
                </Row>
              </>
            )}

            {s.images.provider === "gemini" && (
              <>
                <Row label="API key" htmlFor="set-gemini-key">
                  <input
                    id="set-gemini-key"
                    type="password"
                    className="input"
                    autoComplete="off"
                    value={s.images.geminiApiKey}
                    onChange={(e) =>
                      save({ ...s, images: { ...s.images, geminiApiKey: e.target.value } })
                    }
                  />
                </Row>
                <Row label="Model" htmlFor="set-gemini-model">
                  <input
                    id="set-gemini-model"
                    className="input"
                    value={s.images.geminiModel}
                    onChange={(e) =>
                      save({ ...s, images: { ...s.images, geminiModel: e.target.value } })
                    }
                  />
                </Row>
              </>
            )}

            {s.images.provider === "pexels" && (
              <Row label="API key" htmlFor="set-pexels-key">
                <input
                  id="set-pexels-key"
                  type="password"
                  className="input"
                  autoComplete="off"
                  value={s.images.pexelsApiKey}
                  onChange={(e) =>
                    save({ ...s, images: { ...s.images, pexelsApiKey: e.target.value } })
                  }
                />
              </Row>
            )}

            {s.images.provider !== "none" && (
              <Row label="">
                <Button disabled={testing} onClick={() => void testImage()}>
                  {testing ? <Spinner /> : <Icon name="image" size={15} />}
                  {testing ? "Testing…" : "Test image generation"}
                </Button>
              </Row>
            )}
          </Section>

          <Section title="Icons" description="Weight used for icons drawn inside slides.">
            <Row label="Weight" htmlFor="set-icon-weight">
              <select
                id="set-icon-weight"
                className="input"
                value={s.icons.weight}
                onChange={(e) => save({ ...s, icons: { weight: e.target.value } })}
              >
                {ICON_WEIGHTS.map((w) => (
                  <option key={w} value={w}>
                    {w.charAt(0).toUpperCase() + w.slice(1)}
                  </option>
                ))}
              </select>
            </Row>
          </Section>

          <Section title="Storage" description="Local database." health={health?.services.db}>
            <p className="t-caption text-ink-3">
              Documents, settings and generated images live in <code>data/</code> next to the
              app. Nothing is uploaded anywhere.
            </p>
          </Section>

          <Section
            title="Brand kit"
            description="Extract once, then theme any document with it."
            wide
          >
            <Row label="Company URL" htmlFor="set-brand-url">
              <div className="flex flex-wrap gap-2">
                <input
                  id="set-brand-url"
                  className="input max-w-xs"
                  placeholder="https://yourcompany.com"
                  value={brandUrl}
                  onChange={(e) => setBrandUrl(e.target.value)}
                />
                <Button
                  disabled={brandBusy || !brandUrl.trim()}
                  onClick={() => void extractBrand({ url: brandUrl.trim() })}
                >
                  {brandBusy && <Spinner />}
                  {brandBusy ? "Extracting…" : "Extract"}
                </Button>
              </div>
            </Row>
            <Row label="Or upload" hint="A logo gives colors; a .pptx also gives the typefaces.">
              <div className="flex flex-wrap gap-2">
                <label className="btn btn-secondary cursor-pointer">
                  <Icon name="image" size={15} />
                  Logo (PNG/JPEG)
                  <input
                    type="file"
                    accept="image/png,image/jpeg"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void extractBrand({ file });
                      e.target.value = "";
                    }}
                  />
                </label>
                <label className="btn btn-secondary cursor-pointer">
                  <Icon name="deck" size={15} />
                  Brand deck (.pptx)
                  <input
                    type="file"
                    accept=".pptx"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void extractBrand({ file });
                      e.target.value = "";
                    }}
                  />
                </label>
              </div>
            </Row>
            {s.brand && s.brand.colors.length > 0 && (
              <Row label="Saved">
                <div className="flex flex-wrap items-center gap-3">
                  {s.brand.logoUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={assetUrl(s.brand.logoUrl)}
                      alt={`${s.brand.name || "Brand"} logo`}
                      className="h-9 max-w-[130px] rounded-[4px] bg-white object-contain p-1"
                      style={{ boxShadow: "inset 0 0 0 1px var(--hairline)" }}
                    />
                  )}
                  <span
                    className="flex overflow-hidden rounded-[4px]"
                    style={{ boxShadow: "0 0 0 1px var(--hairline)" }}
                  >
                    {s.brand.colors.map((c) => (
                      <span key={c} title={c} style={{ background: c, width: 30, height: 24 }} />
                    ))}
                  </span>
                  <span className="t-caption text-ink-3">{s.brand.name || "Brand"}</span>
                </div>
              </Row>
            )}
          </Section>
        </div>
      </div>
    </main>
  );
}
