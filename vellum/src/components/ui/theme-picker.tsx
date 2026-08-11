"use client";

import React, { useMemo, useState } from "react";
import { themes } from "@/lib/themes/data";
import { PACK_THEME_KEYS } from "@/lib/themes/packs";
import { Icon } from "./icon";
import { Button, Popover, Spinner, cx } from "./primitives";

/** Four-stop palette preview for a theme. */
export function ThemeSwatch({
  name,
  size = 18,
}: {
  name: string;
  size?: number;
}) {
  const theme = themes[name];
  const colors = theme
    ? [
        theme.colors.background,
        theme.colors.heading,
        theme.colors.accent,
        theme.colors.primary,
      ]
    : ["var(--bg-surface)", "var(--text-tertiary)", "var(--text-secondary)", "var(--text-primary)"];
  return (
    <span
      aria-hidden
      className="inline-flex flex-none overflow-hidden rounded-[4px]"
      style={{ boxShadow: "inset 0 0 0 1px var(--hairline)" }}
    >
      {colors.map((color, i) => (
        <span key={i} style={{ background: color, width: size / 2, height: size }} />
      ))}
    </span>
  );
}

function displayName(key: string): string {
  if (key === "custom") return "Custom";
  return themes[key]?.name ?? key.charAt(0).toUpperCase() + key.slice(1);
}

/**
 * Searchable theme picker grouped Studio packs / Themes / Custom — replaces
 * the unsearchable ~40-row scroller.
 */
export function ThemePicker({
  value,
  hasCustom,
  onPick,
  onAiTheme,
  aiBusy,
}: {
  value: string;
  hasCustom: boolean;
  onPick: (name: string) => void;
  onAiTheme: () => void;
  aiBusy: boolean;
}) {
  const [query, setQuery] = useState("");

  const { packs, builtins } = useMemo(() => {
    const q = query.trim().toLowerCase();
    const match = (key: string) =>
      !q ||
      key.toLowerCase().includes(q) ||
      displayName(key).toLowerCase().includes(q) ||
      (themes[key]?.description ?? "").toLowerCase().includes(q);
    return {
      packs: PACK_THEME_KEYS.filter(match),
      builtins: Object.keys(themes)
        .filter((k) => !PACK_THEME_KEYS.includes(k))
        .filter(match),
    };
  }, [query]);

  const row = (key: string, close: () => void) => (
    <button
      key={key}
      type="button"
      role="menuitemradio"
      aria-checked={value === key}
      className={cx("menu-item", value === key && "bg-accent-soft")}
      onClick={() => {
        onPick(key);
        close();
      }}
    >
      <ThemeSwatch name={key} />
      <span className="min-w-0 flex-1 truncate">{displayName(key)}</span>
      {value === key && <Icon name="check" size={14} />}
    </button>
  );

  return (
    <Popover
      label="Theme"
      width={288}
      trigger={(props) => (
        <button type="button" className="btn btn-secondary" {...props}>
          <ThemeSwatch name={value === "custom" ? "mystique" : value} />
          <span className="max-w-[9ch] truncate">{displayName(value)}</span>
          <Icon name="chevronDown" size={13} className="opacity-50" />
        </button>
      )}
    >
      {(close) => (
        <>
          <div className="p-1 pb-2">
            <div className="relative">
              <Icon
                name="search"
                size={13}
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3"
              />
              <input
                className="input pl-8"
                placeholder="Search themes"
                aria-label="Search themes"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                autoFocus
              />
            </div>
          </div>

          {!query && (
            <>
              <button
                type="button"
                role="menuitem"
                className="menu-item"
                disabled={aiBusy}
                onClick={() => {
                  onAiTheme();
                  close();
                }}
              >
                {aiBusy ? <Spinner /> : <Icon name="sparkle" size={16} className="opacity-70" />}
                <span className="flex-1 text-left">
                  {aiBusy ? "Designing…" : "Design a theme with AI"}
                </span>
              </button>
              {hasCustom && row("custom", close)}
              <div className="menu-sep" />
            </>
          )}

          {packs.length > 0 && (
            <>
              <p className="menu-label">Studio packs</p>
              {packs.map((key) => row(key, close))}
            </>
          )}
          {builtins.length > 0 && (
            <>
              <p className="menu-label">Themes</p>
              {builtins.map((key) => row(key, close))}
            </>
          )}
          {packs.length === 0 && builtins.length === 0 && (
            <p className="t-caption px-3 py-6 text-center text-ink-3">
              No themes match “{query}”.
            </p>
          )}
        </>
      )}
    </Popover>
  );
}

/** Compact variant for the inspector (full-width trigger). */
export function ThemePickerRow(props: React.ComponentProps<typeof ThemePicker>) {
  return (
    <div className="[&_.btn]:w-full [&_.btn]:justify-start">
      <ThemePicker {...props} />
    </div>
  );
}

export { Button };
