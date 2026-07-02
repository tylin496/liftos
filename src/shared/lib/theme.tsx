import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type ThemePreference = "light" | "dark" | "system";

const STORAGE_KEY = "liftos-theme";

function systemPrefersDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function resolveTheme(pref: ThemePreference): "light" | "dark" {
  return pref === "system" ? (systemPrefersDark() ? "dark" : "light") : pref;
}

function applyTheme(pref: ThemePreference) {
  document.documentElement.dataset.theme = resolveTheme(pref);
}

function readStoredPreference(): ThemePreference {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === "light" || stored === "dark" || stored === "system" ? stored : "system";
}

const ThemeContext = createContext<{
  theme: ThemePreference;
  setTheme: (theme: ThemePreference) => void;
} | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<ThemePreference>(readStoredPreference);

  useEffect(() => {
    applyTheme(theme);
    localStorage.setItem(STORAGE_KEY, theme);
    if (theme !== "system") return;
    // Keep "system" live-updating when the OS setting changes while the app is open.
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
