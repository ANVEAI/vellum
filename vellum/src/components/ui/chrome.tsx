"use client";

/** Shared app chrome: wordmark, app header, appearance control. */
import Link from "next/link";
import { useRouter } from "next/navigation";
import React from "react";
import { Icon } from "./icon";
import { Button, IconButton, MenuItem, Popover, cx } from "./primitives";
import { useCommandPalette } from "./command-palette";
import { useThemeMode, type ThemeMode } from "./theme-mode";
import { apiFetch } from "@/lib/client/base-path";

/** Flat monochrome mark — the chrome carries no gradients. */
export function Wordmark({ compact = false }: { compact?: boolean }) {
  return (
    <span className="inline-flex select-none items-center gap-2">
      <span
        aria-hidden
        className="grid h-6 w-6 place-items-center rounded-[7px] bg-accent text-[13px] font-semibold"
        style={{ color: "var(--text-on-accent)" }}
      >
        V
      </span>
      {!compact && (
        <span className="t-emph font-semibold tracking-tight">Vellum</span>
      )}
    </span>
  );
}

const APPEARANCE_OPTIONS: Array<{ value: ThemeMode; label: string }> = [
  { value: "system", label: "Match system" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

export function AppearanceMenu() {
  const { mode, resolved, setMode } = useThemeMode();
  return (
    <Popover
      label="Appearance"
      width={200}
      trigger={(props) => (
        <button
          type="button"
          className="btn btn-icon btn-ghost"
          aria-label="Appearance"
          title="Appearance"
          {...props}
        >
          <Icon name={resolved === "dark" ? "moon" : "sun"} size={16} />
        </button>
      )}
    >
      {(close) => (
        <>
          <p className="menu-label">Appearance</p>
          {APPEARANCE_OPTIONS.map((option) => (
            <MenuItem
              key={option.value}
              checked={mode === option.value}
              onClick={() => {
                setMode(option.value);
                close();
              }}
            >
              {option.label}
            </MenuItem>
          ))}
        </>
      )}
    </Popover>
  );
}

/**
 * The single app header. Screens pass their own centre/right content; the
 * height, padding and hairline are defined once here.
 */
export function AppHeader({
  left,
  center,
  right,
  bordered = true,
  wide = false,
}: {
  left?: React.ReactNode;
  center?: React.ReactNode;
  right?: React.ReactNode;
  bordered?: boolean;
  wide?: boolean;
}) {
  return (
    <header
      className={cx(
        "material sticky top-0 flex items-center gap-3 px-4",
        bordered && "hairline-b",
      )}
      style={{ height: "var(--h-toolbar)", zIndex: 20 }}
    >
      <div className={cx("flex w-full items-center gap-3", !wide && "mx-auto max-w-6xl")}>
        <div className="flex shrink-0 items-center gap-2">{left}</div>
        {center && <div className="flex min-w-0 flex-1 items-center gap-2">{center}</div>}
        {!center && <div className="flex-1" />}
        <div className="flex shrink-0 items-center gap-1.5">{right}</div>
      </div>
    </header>
  );
}

/** Discoverability for ⌘K — a palette nobody knows about helps nobody. */
export function CommandButton() {
  const open = useCommandPalette();
  return (
    <button
      type="button"
      className="btn btn-ghost btn-sm hidden gap-2 sm:inline-flex"
      onClick={open}
      aria-label="Open the command palette"
      title="Command palette"
    >
      <Icon name="search" size={14} />
      <span className="text-ink-3">Search</span>
      <span className="kbd">⌘K</span>
    </button>
  );
}

/** Standard header for library-level screens. */
export function TopNav({ right }: { right?: React.ReactNode }) {
  const router = useRouter();
  return (
    <AppHeader
      left={
        <Link href="/dashboard" className="rounded-md px-1 py-1">
          <Wordmark />
        </Link>
      }
      right={
        <>
          {right}
          <div className="divider-v mx-1 h-5" />
          <CommandButton />
          <AppearanceMenu />
          <Link href="/settings" className="btn btn-icon btn-ghost" aria-label="Settings" title="Settings">
            <Icon name="settings" size={16} />
          </Link>
          <IconButton
            icon="logout"
            label="Log out"
            onClick={async () => {
              await apiFetch("/api/auth/logout", { method: "POST" });
              router.replace("/login");
            }}
          />
        </>
      }
    />
  );
}

export { Button, IconButton };
