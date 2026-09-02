"use client";

/**
 * Self-contained document import panel: drop/browse a file or paste text,
 * extract it via /api/import, pick how the content should be used, confirm.
 * Wiring into the creation flow happens at the call site via `onImported`.
 */
import { useRef, useState } from "react";
import { Icon } from "./icon";
import { Button, SegmentedControl, Spinner, cx } from "./primitives";
import { apiFetch } from "@/lib/client/base-path";

type ImportMode = "verbatim" | "summarize";
type Source = "file" | "paste";

interface ImportResponse {
  text: string;
  kind: "pdf" | "docx" | "md" | "txt";
  title?: string;
  chars: number;
  words: number;
}

const ACCEPT = ".pdf,.docx,.md,.markdown,.txt";
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

const SOURCES = [
  { value: "file" as const, label: "Upload file" },
  { value: "paste" as const, label: "Paste text" },
];

const MODES = [
  { value: "verbatim" as const, label: "Keep structure" },
  { value: "summarize" as const, label: "Restructure" },
];

function isSupported(name: string): boolean {
  return /\.(pdf|docx|md|markdown|txt)$/i.test(name);
}

export function ImportPanel({
  onImported,
}: {
  onImported: (r: { text: string; title?: string; mode: ImportMode }) => void;
}) {
  const [source, setSource] = useState<Source>("file");
  const [pasted, setPasted] = useState("");
  const [busy, setBusy] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResponse | null>(null);
  const [sourceName, setSourceName] = useState("");
  const [mode, setMode] = useState<ImportMode>("summarize");
  const fileRef = useRef<HTMLInputElement>(null);

  async function requestImport(body: FormData | string, name: string) {
    setBusy(true);
    setError(null);
    setResult(null);
    setSourceName(name);
    try {
      const res = await apiFetch("/api/import", {
        method: "POST",
        ...(typeof body === "string"
          ? { headers: { "Content-Type": "application/json" }, body }
          : { body }),
      });
      const data = (await res.json().catch(() => null)) as
        | (ImportResponse & { error?: string })
        | null;
      if (!res.ok || !data) {
        throw new Error(data?.error ?? `Import failed (${res.status})`);
      }
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function importFile(file: File) {
    if (!isSupported(file.name)) {
      setError("Unsupported file type — use PDF, DOCX, MD or TXT.");
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setError("That file is over the 25 MB limit.");
      return;
    }
    const form = new FormData();
    form.append("file", file);
    void requestImport(form, file.name);
  }

  function importPasted() {
    const text = pasted.trim();
    if (!text) return;
    void requestImport(JSON.stringify({ text, filename: "pasted.md" }), "Pasted text");
  }

  return (
    <div className="surface p-4 text-left">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="t-eyebrow text-ink-3">Import a document</h3>
        {!result && (
          <SegmentedControl
            label="Import source"
            options={SOURCES}
            value={source}
            onChange={(s) => {
              setSource(s);
              setError(null);
            }}
          />
        )}
      </div>

      {!result && source === "file" && (
        <>
          <button
            type="button"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragActive(false);
              const file = e.dataTransfer.files?.[0];
              if (file) importFile(file);
            }}
            className={cx(
              "mt-3 w-full rounded-[8px] border border-dashed px-6 py-8 text-center transition-colors",
              dragActive
                ? "border-[var(--accent)] bg-[var(--bg-selected)]"
                : "border-[var(--hairline-strong)] hover:bg-[var(--bg-hover)]",
            )}
          >
            {busy ? (
              <span className="t-body flex items-center justify-center gap-2 text-ink-2">
                <Spinner /> Reading {sourceName}…
              </span>
            ) : (
              <span className="block">
                <Icon name="upload" size={20} className="mx-auto text-ink-3" />
                <span className="t-body mt-2 block font-medium">Drop a document here</span>
                <span className="t-caption mt-0.5 block text-ink-3">
                  or click to browse — PDF, DOCX, MD, TXT · up to 25 MB
                </span>
              </span>
            )}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept={ACCEPT}
            aria-label="Choose a document to import"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) importFile(file);
              e.target.value = "";
            }}
          />
        </>
      )}

      {!result && source === "paste" && (
        <div className="mt-3">
          <textarea
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            aria-label="Paste your source text"
            placeholder="Paste notes, an article or a rough draft…"
            rows={6}
            className="textarea resize-none leading-relaxed"
          />
          <div className="mt-2 flex items-center justify-between gap-3">
            <span className="t-caption text-ink-3">
              Markdown headings are kept as structure.
            </span>
            <Button
              variant="primary"
              disabled={busy || pasted.trim().length === 0}
              onClick={importPasted}
            >
              {busy && <Spinner />}
              {busy ? "Reading…" : "Extract text"}
            </Button>
          </div>
        </div>
      )}

      {result && (
        <>
          <div
            className="mt-3 flex items-center gap-3 rounded-[6px] p-3"
            style={{ boxShadow: "inset 0 0 0 1px var(--hairline)" }}
          >
            <Icon name="doc" size={18} className="shrink-0 text-ink-3" />
            <div className="min-w-0 flex-1">
              <p className="t-body truncate font-medium">{sourceName}</p>
              <p className="t-caption mt-0.5 text-ink-3">
                {result.kind.toUpperCase()} · {result.words.toLocaleString()} words
                {result.title ? ` · ${result.title}` : ""}
              </p>
            </div>
            <Button
              className="flex-none"
              onClick={() => {
                setResult(null);
                setError(null);
                setSourceName("");
              }}
            >
              Replace
            </Button>
          </div>

          <div className="mt-4">
            <p className="t-label mb-1.5 text-ink-2">How should Vellum use it?</p>
            <SegmentedControl
              label="How the source is used"
              options={MODES}
              value={mode}
              onChange={setMode}
            />
            <p className="t-caption mt-2 text-ink-3">
              {mode === "verbatim"
                ? "Sections and wording follow the document as written."
                : "The content is distilled and reorganized into a fresh outline."}
            </p>
          </div>

          <div className="mt-4 flex justify-end">
            <Button
              variant="primary"
              iconEnd="forward"
              disabled={result.text.trim().length === 0}
              onClick={() =>
                onImported({
                  text: result.text,
                  ...(result.title ? { title: result.title } : {}),
                  mode,
                })
              }
            >
              Use this content
            </Button>
          </div>
        </>
      )}

      {error && (
        <p className="t-caption mt-3 flex items-start gap-1.5 text-danger" role="alert">
          <Icon name="error" size={13} className="mt-px shrink-0" />
          {error}
        </p>
      )}
    </div>
  );
}
