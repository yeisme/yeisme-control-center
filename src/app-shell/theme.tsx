import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type ThemePreference = "light" | "dark" | "system";
const storageKey = "yeisme.v18.theme";

function systemDark() {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches === true;
}

function readPreference(): ThemePreference {
  const stored = localStorage.getItem(storageKey);
  return stored === "light" || stored === "dark" ? stored : "system";
}

function apply(dark: boolean) {
  const root = document.documentElement;
  root.setAttribute("data-theme-switching", "");
  root.dataset.theme = dark ? "dark" : "light";
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#111714" : "#f5f3ee");
  requestAnimationFrame(() => requestAnimationFrame(() => root.removeAttribute("data-theme-switching")));
}

const ThemeContext = createContext<{ preference: ThemePreference; dark: boolean; setPreference: (value: ThemePreference) => void }>({ preference: "system", dark: false, setPreference: () => {} });

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(readPreference);
  const [system, setSystem] = useState(systemDark);
  useEffect(() => {
    const query = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!query) return;
    const onChange = () => setSystem(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  const dark = preference === "dark" || (preference === "system" && system);
  useEffect(() => apply(dark), [dark]);
  const setPreference = useCallback((value: ThemePreference) => {
    if (value === "system") localStorage.removeItem(storageKey);
    else localStorage.setItem(storageKey, value);
    setPreferenceState(value);
  }, []);
  const value = useMemo(() => ({ preference, dark, setPreference }), [preference, dark, setPreference]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
