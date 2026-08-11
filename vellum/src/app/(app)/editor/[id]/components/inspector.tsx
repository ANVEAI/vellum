"use client";

/**
 * Inspector — Format / Design / Notes, on an 88px right-aligned label grid.
 * Every per-slide action that used to live in a hover-only toolbar has a
 * permanent home here.
 */
import { useEffect, useRef, useState } from "react";
import type { PlateSlide } from "@/lib/generation/parser/slide-parser";
import type { ArchetypeId } from "@/lib/design/archetypes";
import { ARCHETYPE_WEIGHT, accepts, signatureOf } from "@/lib/design/archetypes";
import { IMAGE_STYLE_PRESETS } from "@/lib/images/styles";
import {
  IMAGE_FOCUS_VALUES,
  readPlacement,
  type ImageFit,
  type ImageFocus,
} from "@/lib/slides/image-fit";
import { Icon } from "@/components/ui/icon";
import { Button, SegmentedControl, Spinner, cx } from "@/components/ui/primitives";
import { ThemePickerRow } from "@/components/ui/theme-picker";
import type { QaIssueView } from "@/components/ui/quality-panel";
import { ARCHETYPE_LABEL, ArchetypeGlyph } from "./archetype-glyph";

export type InspectorScope = "format" | "design" | "notes";

const SCOPES = [
  { value: "format" as const, label: "Format" },
  { value: "design" as const, label: "Design" },
  { value: "notes" as const, label: "Notes" },
];

const ALL_ARCHETYPES = Object.keys(ARCHETYPE_WEIGHT) as ArchetypeId[];

export interface ImageState {
  status: string;
  error: string | null;
}

export interface InspectorProps {
  scope: InspectorScope;
  onScope: (scope: InspectorScope) => void;
  slide: PlateSlide | null;
  index: number;
  total: number;
  kind: string;
  hasChart: boolean;
  imageState: ImageState | undefined;
  regenerating: string | null;
  issues: QaIssueView[];
  notesSaved: boolean;
  // theme
  themeName: string;
  hasCustomTheme: boolean;
  themeBusy: boolean;
  imageStyle: string | null;
  brandBusy: boolean;
  // actions
  onArchetype: (id: ArchetypeId) => void;
  onShuffleLayout: () => void;
  onEditText: () => void;
  onEditChart: () => void;
  onRegenerateImage: (prompt: string) => void;
  onUploadImage: (file: File) => void;
  onImageFit: (fit: ImageFit) => void;
  onImageFocus: (focus: ImageFocus) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onRegenerateSlide: (instruction?: string) => void;
  onNote: (note: string) => void;
  onPickTheme: (name: string) => void;
  onAiTheme: () => void;
  onImageStyle: (style: string | null) => void;
  onApplyBrand: () => void;
  onFixIssue: (slideId: string, suggestion: string) => void;
}

function Section({
  title,
  children,
  action,
}: {
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <section className="insp-section">
      <div className="flex items-center justify-between">
        <h3 className="t-eyebrow text-ink-3">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Inspector(props: InspectorProps) {
  const { scope, onScope, slide, kind, index, total } = props;
  const unit = kind === "doc" ? "Section" : "Slide";

  return (
    <aside className="editor-inspector" aria-label="Inspector">
      <div className="hairline-b flex items-center justify-center px-3 py-2">
        <SegmentedControl
          label="Inspector scope"
          options={SCOPES}
          value={scope}
          onChange={onScope}
          className="w-full [&>button]:flex-1"
        />
      </div>

      <div className="editor-inspector-body scroll-thin">
        {!slide ? (
          <p className="t-caption px-5 py-10 text-center text-ink-3">
            Select a {unit.toLowerCase()} to edit it.
          </p>
        ) : scope === "format" ? (
          <FormatScope {...props} slide={slide} unit={unit} />
        ) : scope === "design" ? (
          <DesignScope {...props} />
        ) : (
          <NotesScope {...props} slide={slide} />
        )}
      </div>

      {slide && (
        <div className="hairline-t t-caption px-5 py-2 text-ink-3">
          {unit} {index + 1} of {total}
        </div>
      )}
    </aside>
  );
}

/* ------------------------------ Format ------------------------------ */

function FormatScope({
  slide,
  unit,
  hasChart,
  imageState,
  regenerating,
  onArchetype,
  onShuffleLayout,
  onEditText,
  onEditChart,
  onRegenerateImage,
  onUploadImage,
  onImageFit,
  onImageFocus,
  onDuplicate,
  onDelete,
  onRegenerateSlide,
}: InspectorProps & { slide: PlateSlide; unit: string }) {
  const [instruction, setInstruction] = useState("");
  const [imagePrompt, setImagePrompt] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const busy = regenerating === slide.id;

  const signature = signatureOf(slide);
  const compatible = ALL_ARCHETYPES.filter((id) => accepts(id, signature));
  const current = (slide.archetype as ArchetypeId | undefined) ?? null;
  // Always show the current archetype even if the content drifted out of spec.
  const options =
    current && !compatible.includes(current) ? [current, ...compatible] : compatible;

  const root = slide.rootImage as { query?: string; url?: string } | undefined;
  const placement = readPlacement(slide.rootImage);
  const blocks = slide.content
    .map((n) => (n as { type?: string }).type)
    .filter((t): t is string => typeof t === "string");

  return (
    <>
      <Section
        title="Layout"
        action={
          <Button
            size="sm"
            variant="ghost"
            icon="regenerate"
            onClick={onShuffleLayout}
            title="Try another compatible layout"
          >
            Shuffle
          </Button>
        }
      >
        <div className="layout-grid mt-3" role="radiogroup" aria-label="Slide layout">
          {options.map((id) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={current === id}
              className="layout-tile"
              title={ARCHETYPE_LABEL[id]}
              onClick={() => onArchetype(id)}
            >
              <span className="layout-tile-art block">
                <ArchetypeGlyph id={id} />
              </span>
              <span className="layout-tile-name">{ARCHETYPE_LABEL[id]}</span>
            </button>
          ))}
        </div>
        <p className="t-caption mt-3 text-ink-3">
          {options.length} layout{options.length === 1 ? "" : "s"} fit this content.
        </p>
      </Section>

      <Section title="Content">
        <div className="mt-3 flex flex-col gap-2">
          <Button icon="text" onClick={onEditText} className="justify-start">
            Edit text…
          </Button>
          {hasChart && (
            <Button icon="chart" onClick={onEditChart} className="justify-start">
              Edit chart data…
            </Button>
          )}
        </div>
        {blocks.length > 0 && (
          <p className="t-caption mt-3 text-ink-3">
            Blocks: {blocks.slice(0, 6).join(", ")}
            {blocks.length > 6 ? ` +${blocks.length - 6}` : ""}
          </p>
        )}
      </Section>

      {root && (
        <Section title="Image">
          <label className="t-label mb-1.5 mt-3 block text-ink-2" htmlFor="insp-img-prompt">
            Prompt
          </label>
          <textarea
            id="insp-img-prompt"
            className="textarea"
            rows={3}
            value={imagePrompt}
            placeholder={root.query ?? "Describe the image to generate…"}
            onChange={(e) => setImagePrompt(e.target.value)}
          />
          <div className="mt-2 flex gap-2">
            <Button
              icon="regenerate"
              className="flex-1"
              onClick={() => onRegenerateImage(imagePrompt)}
            >
              Regenerate
            </Button>
            <Button icon="upload" onClick={() => fileRef.current?.click()}>
              Upload
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) onUploadImage(file);
                e.target.value = "";
              }}
            />
          </div>
          {root.url && (
            <>
              <div className="insp-row mt-3">
                <span className="insp-label">Fit</span>
                <SegmentedControl
                  label="How the image fills its frame"
                  options={[
                    { value: "cover" as const, label: "Cover" },
                    { value: "contain" as const, label: "Contain" },
                  ]}
                  value={placement.fit}
                  onChange={(fit) => onImageFit(fit)}
                />
              </div>
              <div className="insp-row insp-row-focus">
                <span className="insp-label" id="insp-focus-label">
                  Focus
                </span>
                <div
                  className="focus-grid"
                  role="radiogroup"
                  aria-labelledby="insp-focus-label"
                >
                  {IMAGE_FOCUS_VALUES.map((value) => (
                    <button
                      key={value}
                      type="button"
                      role="radio"
                      aria-checked={placement.focus === value}
                      aria-label={value.replace("-", " ")}
                      title={value.replace("-", " ")}
                      className="focus-dot"
                      disabled={placement.fit === "contain"}
                      onClick={() => onImageFocus(value)}
                    />
                  ))}
                </div>
              </div>
              <p className="t-caption mt-2 text-ink-3">
                {placement.fit === "contain"
                  ? "The whole image is shown, letterboxed in its frame."
                  : "The image fills the frame; pick which part stays in view when it is cropped."}
              </p>
            </>
          )}
          {imageState?.status === "failed" ? (
            <p className="t-caption mt-2 flex items-start gap-1.5 text-danger">
              <Icon name="error" size={13} className="mt-px shrink-0" />
              {imageState.error || "Image generation failed."}
            </p>
          ) : imageState?.status === "pending" || imageState?.status === "running" ? (
            <p className="t-caption mt-2 flex items-center gap-1.5 text-ink-3">
              <Spinner size={11} /> Generating on the GPU…
            </p>
          ) : null}
        </Section>
      )}

      <Section title={unit}>
        <label className="t-label mb-1.5 mt-3 block text-ink-2" htmlFor="insp-instruction">
          Rewrite instruction
        </label>
        <textarea
          id="insp-instruction"
          className="textarea"
          rows={2}
          value={instruction}
          placeholder="Optional — e.g. “add concrete numbers”"
          onChange={(e) => setInstruction(e.target.value)}
        />
        <Button
          variant="primary"
          className="mt-2 w-full"
          disabled={regenerating !== null}
          onClick={() => onRegenerateSlide(instruction.trim() || undefined)}
        >
          {busy ? <Spinner /> : <Icon name="sparkle" size={15} />}
          {busy ? "Redesigning…" : `Regenerate ${unit.toLowerCase()}`}
        </Button>
        <div className="mt-2 flex gap-2">
          <Button icon="duplicate" className="flex-1" onClick={onDuplicate}>
            Duplicate
          </Button>
          <Button variant="ghost" icon="trash" className="text-danger" onClick={onDelete}>
            Delete
          </Button>
        </div>
      </Section>
    </>
  );
}

/* ------------------------------ Design ------------------------------ */

function DesignScope({
  themeName,
  hasCustomTheme,
  themeBusy,
  imageStyle,
  brandBusy,
  onPickTheme,
  onAiTheme,
  onImageStyle,
  onApplyBrand,
}: InspectorProps) {
  return (
    <>
      <Section title="Theme">
        <div className="insp-row">
          <span className="insp-label">Theme</span>
          <ThemePickerRow
            value={themeName}
            hasCustom={hasCustomTheme}
            onPick={onPickTheme}
            onAiTheme={onAiTheme}
            aiBusy={themeBusy}
          />
        </div>
        <p className="t-caption mt-3 text-ink-3">
          Themes carry the palette, typefaces and the whole design family —
          spacing, layout rhythm and image grade all shift with it.
        </p>
      </Section>

      <Section title="Brand">
        <div className="insp-row">
          <span className="insp-label">Brand kit</span>
          <Button className="w-full justify-start" disabled={brandBusy} onClick={onApplyBrand}>
            {brandBusy ? <Spinner /> : <Icon name="brand" size={15} />}
            {brandBusy ? "Applying…" : "Apply brand theme"}
          </Button>
        </div>
        <p className="t-caption mt-3 text-ink-3">
          Uses the palette saved in{" "}
          <a href="/settings" className="underline underline-offset-2">
            Settings
          </a>
          . Add a logo, a brand deck or a company URL there first.
        </p>
      </Section>

      <Section title="Imagery">
        <div className="insp-row">
          <label htmlFor="insp-image-style" className="insp-label">
            Style
          </label>
          <select
            id="insp-image-style"
            className="input"
            value={imageStyle ?? ""}
            onChange={(e) => onImageStyle(e.target.value || null)}
          >
            <option value="">Automatic (match theme)</option>
            {IMAGE_STYLE_PRESETS.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.name}
              </option>
            ))}
          </select>
        </div>
        <p className="t-caption mt-3 text-ink-3">
          {IMAGE_STYLE_PRESETS.find((p) => p.id === imageStyle)?.tagline ??
            "Each style locks a prompt and negative block so every image in the deck matches."}{" "}
          Applies to images you regenerate from here.
        </p>
      </Section>
    </>
  );
}

/* ------------------------------- Notes ------------------------------ */

function NotesScope({
  slide,
  issues,
  notesSaved,
  regenerating,
  onNote,
  onFixIssue,
}: InspectorProps & { slide: PlateSlide }) {
  const [draft, setDraft] = useState(slide.speakerNote ?? "");
  const slideId = slide.id;

  // Re-seed when the selection changes or a refetch replaces the slide.
  useEffect(() => {
    setDraft(slide.speakerNote ?? "");
  }, [slideId, slide.speakerNote]);

  // Autosave: the old editor saved on blur only, so notes were silently lost.
  useEffect(() => {
    if (draft === (slide.speakerNote ?? "")) return;
    const t = setTimeout(() => onNote(draft), 600);
    return () => clearTimeout(t);
  }, [draft, slide.speakerNote, onNote]);

  return (
    <>
      <Section title="Speaker notes">
        <textarea
          className="textarea mt-3"
          rows={8}
          value={draft}
          aria-label="Speaker notes"
          placeholder="Notes for this slide — exported into PowerPoint's notes pane."
          onChange={(e) => setDraft(e.target.value)}
        />
        <p className="t-caption mt-2 flex items-center gap-1.5 text-ink-3">
          {draft !== (slide.speakerNote ?? "") ? (
            <>
              <Spinner size={11} /> Saving…
            </>
          ) : notesSaved ? (
            <>
              <Icon name="check" size={13} /> Saved
            </>
          ) : (
            "Autosaves as you type."
          )}
        </p>
      </Section>

      <Section title="Quality">
        {issues.length === 0 ? (
          <p className="t-caption mt-3 flex items-center gap-1.5 text-ink-3">
            <Icon name="success" size={14} className="text-success" />
            No issues on this slide.
          </p>
        ) : (
          <div className="mt-3 space-y-2">
            {issues.map((issue, i) => (
              <div
                key={i}
                className={cx(
                  "rounded-[6px] p-3",
                  "bg-[var(--bg-well)]",
                )}
                style={{
                  boxShadow: `inset 2px 0 0 ${
                    issue.severity === "major" ? "var(--danger)" : "var(--warning)"
                  }`,
                }}
              >
                <p className="t-caption font-medium">{issue.issue}</p>
                <p className="t-caption mt-1 text-ink-3">{issue.suggestion}</p>
                {issue.slideId && issue.code !== "image-pending" && (
                  <Button
                    size="sm"
                    className="mt-2"
                    disabled={regenerating !== null}
                    onClick={() => onFixIssue(issue.slideId!, issue.suggestion)}
                  >
                    {regenerating === issue.slideId ? <Spinner size={11} /> : null}
                    Fix this slide
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </Section>
    </>
  );
}
