# Vellum Phase 5 — UI redesign acceptance checklist

Every control from the pre-redesign inventory, mapped to where it lives now.
"Better" means the affordance improved (permanent instead of hover-only,
labelled instead of unlabelled, previewed instead of blind).

Verified by `scripts/ui-check.ts` (48 screenshots, 2 themes × 4 widths),
`scripts/e2e-editor.ts` (26 interaction checks) and `tests/chrome-hygiene.test.ts`.

---

## Editor — was: one scrolling column, 10 hover-only actions

| Was | Now | Status |
| --- | --- | --- |
| `✎ text` hover button | Inspector → Format → **Edit text…**, or double-click the canvas | better |
| `⇆ layout` cycler (14 blind states) | Inspector → Format → **layout picker** with wireframe thumbnails of every compatible archetype + Shuffle | better |
| `📊 data` hover button | Inspector → Format → **Edit chart data…** | better |
| `🖼 image` hover button | Inspector → Format → **Image** section: prompt, Regenerate, Upload, plus per-slide error/queued state | better |
| `🗒 notes` hover button | Inspector → **Notes** tab, autosaves with a save indicator | better |
| `⧉` duplicate | Inspector → Format → Duplicate; navigator menu; `⌘D`; palette | better |
| `↑` / `↓` move | Navigator drag with insertion line; `⌥↑`/`⌥↓`; navigator menu | better |
| `↻ regenerate` | Inspector → Format → Regenerate, **with an optional instruction field**; navigator menu; palette | better |
| `✕` delete + `confirm()` | Inspector → Delete; navigator menu; `⌘⌫` — all via the in-app confirm dialog | better |
| `+ Add slide` via `prompt()` | Navigator **Add slide** / **Insert after**, inserts and opens the text editor | better |
| `⟲` undo (appears only when depth > 0) | Toolbar Undo **and Redo**, always present, disabled when empty | better |
| Quality panel (no outside-click, no Escape) | Quality popover: severity legend, jump-to-slide, per-issue Fix, **Re-run** | better |
| Theme picker (~40-row unsearchable list) | Inspector → Design → searchable picker grouped Studio packs / Themes / Custom | better |
| AI theme (alert on failure) | Same menu entry, busy lock, toast on failure | better |
| Export as raw `<a>` (500 → JSON page) | Export menu, fetch + blob download, toast + retry on failure | better |
| Navigator `hidden lg:block` (vanished < 1024px) | Navigator collapses to a horizontal filmstrip below 1024px; toggle `⌥⌘1` | better |
| — | **Documents get the same workspace**: section outline, regenerate/duplicate/delete per section | new |
| — | Status bar: position, save state, image queue, reviewer state | new |
| — | Image style per document (Design tab) | new |
| — | Apply the brand kit to an existing document (Design tab) | new |
| — | `?` shortcut sheet, `⌘K` palette | new |

**Latent bug fixed:** editing state was keyed by array index while asset
polling replaced the slides array wholesale, so a refetch could retarget an
edit at a different slide. All state is now keyed by slide id.

## Create flow — was: 617 lines, 3 cycling chips, 14 emoji

| Was | Now | Status |
| --- | --- | --- |
| No step indicator | Stepper: Describe → Outline → Generate | new |
| 14 emoji template cards | Phosphor icons + theme swatch + section count, filtered by kind | better |
| Tone as 4 chips | Segmented control | better |
| `🌐 Research` chip | Labelled switch with a hint | better |
| `🎨 Images: …` 4-state cycler | Select | better |
| `🖼 Style: …` **10-state cycler** (9 clicks to reach the last option) | Select with the preset's tagline as the hint | better |
| `🏷 Brand theme` chip | Labelled switch | better |
| Count as a bare number input | Labelled stepper (−/+ and a field), clamped 1–30 | better |
| Outline card ↑/↓/✕ hover-only | Always visible, labelled icon buttons | better |
| Generating: bare progress bar | `role="progressbar"` + **Stop** + **retry on error** | better |
| Preview fell back to `mystique` | Previews with the document's real theme (template pairing or brand kit) | fixed |
| `✕ Close` silently orphaned a DB row | Confirms, then deletes the draft | fixed |
| "A investor pitch" | "An investor pitch" | fixed |
| Import panel (chips, emoji) | Segmented controls, icons, `role="alert"` errors | better |

**Contract preserved:** the 90 ms coalesced `reset() + parseChunk(all) +
finalize()` tick and the backward-looking `planDeck` call are unchanged, so
finished slides never re-layout mid-stream. `renderTimer` is now cleared on
unmount (it leaked before), and the in-flight stream is aborted.

## Dashboard

| Was | Now | Status |
| --- | --- | --- |
| Hover-only card toolbar | Always-visible overflow menu | better |
| `confirm()` to delete | In-app confirm dialog + toast | better |
| Raw `draft` / `outlining` status text | Humanised badges, danger tone for failures | better |
| No search / filter / sort | Search, kind filter, sort | new |
| — | Rename, Duplicate, Export (all formats), Present | new |
| No loading state | `loading.tsx` skeleton shaped like the grid | new |

## Settings

| Was | Now | Status |
| --- | --- | --- |
| **A `PUT` on every keystroke** | Debounced 500 ms with an explicit Saving / Saved / Not saved state | fixed |
| Health dots red before resolving | Tri-state lamp: Checking… / Reachable / Not reachable | fixed |
| Every message green, including failures | Toasts with the correct tone; errors never auto-dismiss | fixed |
| Infinite "Loading…" if the fetch failed | Skeleton, then an error state with Try again | fixed |
| `icons.weight` — no UI | Select | new |
| `llm.think` — no UI | Switch | new |
| `search.maxResults` — no UI | Number field, clamped 1–10 | new |
| `images.comfyuiWorkflow` — no UI | Segmented 16:9 / Square | new |
| `images.geminiModel` — no UI | Text field | new |

## Present — was: keyboard-only

| Was | Now | Status |
| --- | --- | --- |
| **No mouse or touch navigation at all** | On-screen prev/next, click-to-advance (left third goes back), swipe | fixed |
| Presenter view covered the bottom 38% of the slide | Presenter view **resizes** the stage; the slide is never occluded | fixed |
| Timer reset whenever the presenter view was toggled | Timer owned by the page; survives toggling | fixed |
| — | `f` full screen, `b` blackout, `Home`/`End`, `g` overview grid, `?` shortcuts | new |
| — | `aria-live` slide announcements | new |

## Login

Bound label, `aria-invalid` + `role="alert"` on failure, spinner while
signing in, autocomplete hint, no gradient.

---

## Cross-cutting

- **Design system**: 11 colour tokens → a full Apple-register set (type ramp
  with per-size tracking, 4 px spacing, radii, elevation, motion, z-scale) in
  light **and** dark, following the system by default.
- **Icons**: ~50 emoji → 75 inlined Phosphor glyphs (`currentColor`, offline).
- **Native dialogs**: 5 → **0** (enforced by `tests/chrome-hygiene.test.ts`).
- **Cycling controls**: 3 → 0.
- **`focus-visible`**: 0 occurrences → global rule via `:where()`.
- **Headers**: 4 copy-pasted implementations → 1 `AppHeader`.
- **Hit targets**: everything ≥ 22 px effective (the switch extends its target
  with a pseudo-element rather than growing the track).

## Bugs found and fixed while verifying

1. **Nested `<p>` hydration errors** on the dashboard — the parser emits `p`
   nodes containing block children (`p > p`, `p > img`, `p > stats`, …), which
   is invalid HTML, so the browser re-parented them and React's tree diverged
   from the DOM. The renderer now emits a `div.v-p` when a paragraph has block
   children; the class and `[data-block-idx]` position are unchanged, so the
   export contract still holds (`scripts/verify-export-contract.ts` passes).
2. **Dangling selection after undo** — undoing a duplicate left `selectedId`
   pointing at a slide that no longer existed, blanking the inspector. The
   selection now falls back to whatever occupies that position.
3. **Refetch could clobber unsaved edits** — asset polling replaced the slides
   array even while a save was in flight. Refetches are now skipped while the
   document is dirty.

## Known gaps

- Per-block click-to-select on the canvas is not implemented; the inspector
  lists a slide's block types but selection is slide-level. Double-clicking the
  canvas opens the (lossless) text editor.
- Delete offers a confirm dialog rather than an undo toast: the document delete
  is a hard DB delete with no restore endpoint, so an "Undo" would be a lie.
  Slide deletion inside the editor *is* undoable with `⌘Z`.
