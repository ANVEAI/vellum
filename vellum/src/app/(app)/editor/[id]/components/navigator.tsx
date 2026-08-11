"use client";

/**
 * Slide navigator: thumbnails, drag-reorder with a real insertion line,
 * keyboard reorder (Alt+Arrow), and a per-slide menu that is visible for the
 * selected slide (never hover-only — every action also lives in the
 * inspector). Below 1024px the same DOM becomes a horizontal filmstrip.
 */
import { useRef, useState } from "react";
import type { PlateSlide } from "@/lib/generation/parser/slide-parser";
import { ScaledSlide } from "@/components/slides/render/slide-frame";
import { ThemeScope } from "@/components/slides/theme-scope";
import { Icon } from "@/components/ui/icon";
import { MenuItem, Popover } from "@/components/ui/primitives";

export interface NavigatorProps {
  slides: PlateSlide[];
  selectedId: string | null;
  themeName: string;
  customThemeData: unknown;
  kind: string;
  regenerating: string | null;
  onSelect: (id: string) => void;
  onReorder: (from: number, to: number) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onRegenerate: (id: string) => void;
  onAdd: (afterIndex?: number) => void;
}

export function Navigator({
  slides,
  selectedId,
  themeName,
  customThemeData,
  kind,
  regenerating,
  onSelect,
  onReorder,
  onDuplicate,
  onDelete,
  onRegenerate,
  onAdd,
}: NavigatorProps) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const unit = kind === "doc" ? "section" : "slide";

  /** Which edge of item `i` shows the insertion line for the current drag. */
  const dropEdge = (i: number): "before" | "after" | undefined => {
    if (dragIndex === null || dropIndex === null) return undefined;
    if (dropIndex === i && dragIndex !== i && dragIndex !== i - 1) return "before";
    if (dropIndex === slides.length && i === slides.length - 1 && dragIndex !== i)
      return "after";
    return undefined;
  };

  const onKeyDown = (e: React.KeyboardEvent, index: number) => {
    const last = slides.length - 1;
    if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowLeft") && index > 0) {
      e.preventDefault();
      onReorder(index, index - 1);
    } else if (e.altKey && (e.key === "ArrowDown" || e.key === "ArrowRight") && index < last) {
      e.preventDefault();
      onReorder(index, index + 2);
    } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
      e.preventDefault();
      if (index > 0) onSelect(slides[index - 1].id);
    } else if (e.key === "ArrowDown" || e.key === "ArrowRight") {
      e.preventDefault();
      if (index < last) onSelect(slides[index + 1].id);
    }
  };

  return (
    <nav className="editor-nav" aria-label={`${unit} navigator`}>
      <div ref={listRef} className="editor-navlist scroll-thin" role="listbox" aria-label={`${unit}s`}>
        {slides.map((slide, i) => {
          const selected = slide.id === selectedId;
          return (
            <div
              key={slide.id}
              className="nav-item"
              data-selected={selected}
              data-dragging={dragIndex === i}
              data-drop={dropEdge(i)}
              draggable
              onDragStart={(e) => {
                setDragIndex(i);
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", String(i));
              }}
              onDragEnd={() => {
                setDragIndex(null);
                setDropIndex(null);
              }}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                const box = e.currentTarget.getBoundingClientRect();
                const horizontal = window.innerWidth <= 1024;
                const past = horizontal
                  ? e.clientX > box.left + box.width / 2
                  : e.clientY > box.top + box.height / 2;
                setDropIndex(past ? i + 1 : i);
              }}
              onDrop={(e) => {
                e.preventDefault();
                const from = Number(e.dataTransfer.getData("text/plain"));
                if (Number.isInteger(from) && dropIndex !== null) onReorder(from, dropIndex);
                setDragIndex(null);
                setDropIndex(null);
              }}
            >
              <span className="nav-item-num" aria-hidden>
                {i + 1}
              </span>
              <button
                type="button"
                role="option"
                aria-selected={selected}
                aria-label={`${unit} ${i + 1}`}
                className="nav-item-frame block w-full"
                onClick={() => onSelect(slide.id)}
                onKeyDown={(e) => onKeyDown(e, i)}
              >
                <span aria-hidden className="pointer-events-none block">
                  <ThemeScope themeName={themeName} customThemeData={customThemeData}>
                    <ScaledSlide slide={slide} index={i} />
                  </ThemeScope>
                </span>
              </button>

              <div className="nav-item-menu">
                <Popover
                  label={`${unit} ${i + 1} actions`}
                  width={196}
                  trigger={(props) => (
                    <button
                      type="button"
                      className="btn btn-icon btn-sm btn-secondary"
                      aria-label={`Actions for ${unit} ${i + 1}`}
                      {...props}
                    >
                      <Icon name="more" size={13} />
                    </button>
                  )}
                >
                  {(close) => (
                    <>
                      <MenuItem
                        icon="plus"
                        onClick={() => {
                          close();
                          onAdd(i);
                        }}
                      >
                        Insert after
                      </MenuItem>
                      <MenuItem
                        icon="duplicate"
                        shortcut="⌘D"
                        onClick={() => {
                          close();
                          onDuplicate(slide.id);
                        }}
                      >
                        Duplicate
                      </MenuItem>
                      <MenuItem
                        icon="regenerate"
                        disabled={regenerating !== null}
                        onClick={() => {
                          close();
                          onRegenerate(slide.id);
                        }}
                      >
                        Regenerate
                      </MenuItem>
                      <div className="menu-sep" />
                      <MenuItem
                        icon="moveUp"
                        disabled={i === 0}
                        onClick={() => {
                          close();
                          onReorder(i, i - 1);
                        }}
                      >
                        Move up
                      </MenuItem>
                      <MenuItem
                        icon="moveDown"
                        disabled={i === slides.length - 1}
                        onClick={() => {
                          close();
                          onReorder(i, i + 2);
                        }}
                      >
                        Move down
                      </MenuItem>
                      <div className="menu-sep" />
                      <MenuItem
                        icon="trash"
                        danger
                        onClick={() => {
                          close();
                          onDelete(slide.id);
                        }}
                      >
                        Delete
                      </MenuItem>
                    </>
                  )}
                </Popover>
              </div>
            </div>
          );
        })}
      </div>

      <div className="editor-nav-add hairline-t p-2">
        <button
          type="button"
          className="btn btn-ghost w-full"
          onClick={() => onAdd()}
          title={`Add ${unit} at the end`}
        >
          <Icon name="plus" size={15} />
          Add {unit}
        </button>
      </div>
    </nav>
  );
}
