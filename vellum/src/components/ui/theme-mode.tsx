"use client";

/**
 * App-chrome appearance: system | light | dark, persisted locally.
 * (Distinct from slide themes, which live in --presentation-* vars.)
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";

export type ThemeMode = "system" | "light" | "dark";
const STORAGE_KEY = "vellum-appearance";

/** Runs before paint to stamp the theme — prevents a flash of the wrong mode. */
export const THEME_INIT_SCRIPT = `(function(){try{var m=localStorage.getItem("${STORAGE_KEY}")||"system";var d=m==="dark"||(m==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.setAttribute("data-theme",d?"dark":"light");}catch(e){document.documentElement.setAttribute("data-theme","light");}})();`;

interface ThemeModeValue {
  mode: ThemeMode;
  resolved: "light" | "dark";
  setMode: (mode: ThemeMode) => void;
}

const ThemeModeContext = createContext<ThemeModeValue>({
  mode: "system",
  resolved: "light",
  setMode: () => {},
});

export function useThemeMode() {
  return useContext(ThemeModeContext);
}

function resolve(mode: ThemeMode): "light" | "dark" {
  if (mode !== "system") return mode;
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function ThemeModeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>("system");
  const [resolved, setResolved] = useState<"light" | "dark">("light");

  useEffect(() => {
    const stored = (localStorage.getItem(STORAGE_KEY) as ThemeMode) || "system";
    setModeState(stored);
    setResolved(resolve(stored));
  }, []);

  // Follow the OS while in system mode.
  useEffect(() => {
    if (mode !== "system") return;
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      const next = query.matches ? "dark" : "light";
      setResolved(next);
      document.documentElement.setAttribute("data-theme", next);
    };
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, [mode]);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    localStorage.setItem(STORAGE_KEY, next);
    const applied = resolve(next);
    setResolved(applied);
    document.documentElement.setAttribute("data-theme", applied);
  }, []);

  return (
    <ThemeModeContext.Provider value={{ mode, resolved, setMode }}>
      {children}
    </ThemeModeContext.Provider>
  );
}
