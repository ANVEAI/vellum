"use client";

/**
 * ⌘K command palette. Screens register their own actions with useCommands(),
 * so the palette is also the app's teaching surface: every command shows the
 * shortcut that runs it directly.
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Icon, type IconName } from "./icon";
import { cx } from "./primitives";
import { useThemeMode } from "./theme-mode";

export interface Command {
  id: string;
  label: string;
  group: string;
  icon?: IconName;
  shortcut?: string;
  keywords?: string;
  disabled?: boolean;
  run: () => void;
}

interface Registry {
  register: (source: string, commands: Command[]) => void;
  open: () => void;
}

const CommandContext = createContext<Registry>({
  register: () => undefined,
  open: () => undefined,
});

/**
 * Registers a screen's commands for as long as it is mounted. `commands` is
 * read through a ref, so callers do not need to memoize it.
 */
export function useCommands(source: string, commands: Command[]) {
  const { register } = useContext(CommandContext);
  const serialized = commands
    .map((c) => `${c.id}:${c.label}:${c.disabled ? 1 : 0}`)
    .join("|");
  const latest = useRef(commands);
  latest.current = commands;
  useEffect(() => {
    register(source, latest.current);
    return () => register(source, []);
    // Re-register when the visible set changes, not on every render.
  }, [register, source, serialized]);
}

export function useCommandPalette() {
  return useContext(CommandContext).open;
}

/** Subsequence match with a small bonus for word-start hits. */
function score(haystack: string, needle: string): number {
  if (!needle) return 1;
  const h = haystack.toLowerCase();
  const n = needle.toLowerCase();
  if (h.includes(n)) return 1000 - h.indexOf(n);
  let hi = 0;
  let hits = 0;
  for (let ni = 0; ni < n.length; ni++) {
    const found = h.indexOf(n[ni], hi);
    if (found === -1) return 0;
    if (found === 0 || h[found - 1] === " ") hits += 2;
    else hits += 1;
    hi = found + 1;
  }
  return hits;
}

interface RecentDoc {
  id: string;
  kind: string;
  title: string;
}

export function CommandProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { mode, setMode } = useThemeMode();
  const [sources, setSources] = useState<Record<string, Command[]>>({});
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [recent, setRecent] = useState<RecentDoc[]>([]);
  const [mounted, setMounted] = useState(false);
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => setMounted(true), []);

  const register = useCallback((source: string, commands: Command[]) => {
    setSources((current) => {
      if (commands.length === 0) {
        if (!(source in current)) return current;
        const next = { ...current };
        delete next[source];
        return next;
      }
      return { ...current, [source]: commands };
    });
  }, []);

  const openPalette = useCallback(() => {
    setQuery("");
    setActive(0);
    setOpen(true);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => {
          if (!v) {
            setQuery("");
            setActive(0);
          }
          return !v;
        });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Recent documents are fetched lazily, only while the palette is open.
  useEffect(() => {
    if (!open) return;
    void fetch("/api/documents")
      .then((r) => r.json())
      .then((docs: RecentDoc[]) => setRecent(docs.slice(0, 6)))
      .catch(() => setRecent([]));
  }, [open]);

  const globals = useMemo<Command[]>(
    () => [
      {
        id: "go-library",
        label: "Go to Library",
        group: "Navigate",
        icon: "folder",
        run: () => router.push("/dashboard"),
      },
      {
        id: "go-new",
        label: "New presentation or document",
        group: "Navigate",
        icon: "plus",
        keywords: "create generate deck doc",
        run: () => router.push("/new"),
      },
      {
        id: "go-settings",
        label: "Go to Settings",
        group: "Navigate",
        icon: "settings",
        run: () => router.push("/settings"),
      },
      {
        id: "theme-light",
        label: "Appearance: Light",
        group: "Appearance",
        icon: "sun",
        disabled: mode === "light",
        run: () => setMode("light"),
      },
      {
        id: "theme-dark",
        label: "Appearance: Dark",
        group: "Appearance",
        icon: "moon",
        disabled: mode === "dark",
        run: () => setMode("dark"),
      },
      {
        id: "theme-system",
        label: "Appearance: Match system",
        group: "Appearance",
        icon: "eye",
        disabled: mode === "system",
        run: () => setMode("system"),
      },
      {
        id: "logout",
        label: "Sign out",
        group: "Account",
        icon: "logout",
        run: () => {
          void fetch("/api/auth/logout", { method: "POST" }).then(() => {
            router.replace("/login");
          });
        },
      },
    ],
    [mode, router, setMode],
  );

  const results = useMemo(() => {
    const registered = Object.values(sources).flat();
    const recentCommands: Command[] = recent.map((doc) => ({
      id: `open-${doc.id}`,
      label: doc.title,
      group: "Recent",
      icon: doc.kind === "doc" ? "doc" : "deck",
      keywords: "open document deck",
      run: () => router.push(`/editor/${doc.id}`),
    }));
    const all = [...registered, ...globals, ...recentCommands];
    const q = query.trim();
    const scored = all
      .map((command) => ({
        command,
        s: Math.max(
          score(command.label, q),
          command.keywords ? score(command.keywords, q) * 0.5 : 0,
        ),
      }))
      .filter((r) => r.s > 0);
    // With no query keep author order (this screen's actions first, Recent
    // last); with a query rank by match quality.
    if (q) scored.sort((a, b) => b.s - a.s);
    return scored.map((r) => r.command).slice(0, 40);
  }, [sources, globals, recent, query, router]);

  useEffect(() => {
    if (active >= results.length) setActive(0);
  }, [results.length, active]);

  const runAt = useCallback(
    (index: number) => {
      const command = results[index];
      if (!command || command.disabled) return;
      setOpen(false);
      command.run();
    },
    [results],
  );

  // Keep the highlighted row in view while arrowing through a long list.
  useEffect(() => {
    if (!open) return;
    listRef.current
      ?.querySelector(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    requestAnimationFrame(() => inputRef.current?.focus());
    return () => {
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, [open]);

  let lastGroup = "";

  return (
    <CommandContext.Provider value={{ register, open: openPalette }}>
      {children}
      {mounted &&
        open &&
        createPortal(
          <div
            className="scrim flex items-start justify-center p-6"
            style={{ zIndex: "var(--z-overlay)" as unknown as number }}
            onMouseDown={() => setOpen(false)}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Command palette"
              className="dialog w-full overflow-hidden"
              style={{ maxWidth: 640, marginTop: "18vh" }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <div className="hairline-b flex items-center gap-2.5 px-4">
                <Icon name="search" size={16} className="shrink-0 text-ink-3" />
                <input
                  ref={inputRef}
                  role="combobox"
                  aria-expanded
                  aria-controls={listId}
                  aria-autocomplete="list"
                  aria-activedescendant={
                    results[active] ? `${listId}-${active}` : undefined
                  }
                  aria-label="Search commands"
                  placeholder="Search commands and documents…"
                  className="w-full bg-transparent py-3 outline-none placeholder:text-ink-3"
                  style={{ fontSize: "var(--t-emph)" }}
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setActive(0);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "ArrowDown") {
                      e.preventDefault();
                      setActive((i) => Math.min(results.length - 1, i + 1));
                    } else if (e.key === "ArrowUp") {
                      e.preventDefault();
                      setActive((i) => Math.max(0, i - 1));
                    } else if (e.key === "Enter") {
                      e.preventDefault();
                      runAt(active);
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      setOpen(false);
                    }
                  }}
                />
                <span className="kbd shrink-0">esc</span>
              </div>

              <div
                ref={listRef}
                id={listId}
                role="listbox"
                aria-label="Commands"
                className="scroll-thin max-h-[min(420px,56vh)] overflow-y-auto p-1.5"
              >
                {results.length === 0 && (
                  <p className="t-body px-3 py-8 text-center text-ink-3">
                    Nothing matches “{query}”.
                  </p>
                )}
                {results.map((command, i) => {
                  const header = command.group !== lastGroup ? command.group : null;
                  lastGroup = command.group;
                  return (
                    <React.Fragment key={command.id}>
                      {header && <p className="menu-label">{header}</p>}
                      <div
                        id={`${listId}-${i}`}
                        role="option"
                        aria-selected={i === active}
                        aria-disabled={command.disabled}
                        data-index={i}
                        data-active={i === active}
                        className={cx("menu-item", command.disabled && "opacity-40")}
                        onMouseMove={() => setActive(i)}
                        onClick={() => runAt(i)}
                      >
                        {command.icon && (
                          <Icon name={command.icon} size={16} className="shrink-0 opacity-70" />
                        )}
                        <span className="min-w-0 flex-1 truncate">{command.label}</span>
                        {command.shortcut && <span className="kbd">{command.shortcut}</span>}
                      </div>
                    </React.Fragment>
                  );
                })}
              </div>
            </div>
          </div>,
          document.body,
        )}
    </CommandContext.Provider>
  );
}
