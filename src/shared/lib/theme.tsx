import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

export type ThemePreference = "light" | "dark" | "system";

const STORAGE_KEY = "liftos-theme";

function systemPrefersDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function resolveTheme(pref: ThemePreference): "light" | "dark" {
  return pref === "system" ? (systemPrefersDark() ? "dark" : "light") : pref;
}

function applyTheme(pref: ThemePreference) {
  const resolved = resolveTheme(pref);
  document.documentElement.dataset.theme = resolved;
  // Keep the browser chrome (status/URL bar) in sync with the ACTUAL applied
  // theme, including a manual override — a media-query-only meta would follow
  // the OS scheme and disagree with a manual light/dark choice.
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", resolved === "dark" ? "#1a1a1a" : "#f4f4f6");
}

/* Runtime theme swaps cross-fade instead of hard-flipping the whole page
   (an abrupt dark↔light brightness jump). The .is-theme-easing class turns on
   a one-beat colour transition (global.css); it's stamped just before the
   data-theme swap and lifted after --dur-move. Rapid re-toggles extend the
   beat rather than stacking timers. */
let easeTimer = 0;

function applyThemeEased(pref: ThemePreference) {
  const root = document.documentElement;
  // Fallback mirrors --dur-move in tokens.css §Motion — keep in lockstep.
  const ms = parseFloat(getComputedStyle(root).getPropertyValue("--dur-move")) || 280;
  root.classList.add("is-theme-easing");
  applyTheme(pref);
  window.clearTimeout(easeTimer);
  easeTimer = window.setTimeout(() => root.classList.remove("is-theme-easing"), ms);
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
  const firstApply = useRef(true);

  useEffect(() => {
    // Initial mount paints the stored theme instantly; only a runtime change
    // (user toggle, or the OS flipping while the app is open) cross-fades.
    if (firstApply.current) {
      firstApply.current = false;
      applyTheme(theme);
    } else {
      applyThemeEased(theme);
    }
    localStorage.setItem(STORAGE_KEY, theme);
    if (theme !== "system") return;
    // Keep "system" live-updating when the OS setting changes while the app is open.
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyThemeEased("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);

  // setTheme is stable (useState); memoize the value so consumers don't re-render
  // on unrelated parent renders — only when the theme actually changes.
  const value = useMemo(() => ({ theme, setTheme }), [theme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
