import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useWorkspace } from "./workspace";

export type ListDensity = "compact" | "comfortable" | "spacious";
export const pageSizes = [20, 40, 80, 120] as const;
export type PageSize = (typeof pageSizes)[number];

interface StoredPreferences {
  version: 1;
  pageSize: PageSize;
  density: ListDensity;
  pages: Record<string, number>;
}

interface ListPreferencesValue {
  pageSize: PageSize;
  density: ListDensity;
  page: (list: string) => number;
  setPage: (list: string, page: number) => void;
  setPageSize: (value: PageSize) => void;
  setDensity: (value: ListDensity) => void;
  resetPage: (list: string) => void;
}

const storagePrefix = "yeisme.control.list-preferences.v1";
const defaults: StoredPreferences = { version: 1, pageSize: 40, density: "comfortable", pages: {} };
const ListPreferencesContext = createContext<ListPreferencesValue | null>(null);

function validPageSize(value: unknown): PageSize {
  return pageSizes.includes(value as PageSize) ? value as PageSize : defaults.pageSize;
}

export function parseListPreferences(value: string | null): StoredPreferences {
  try {
    const raw = JSON.parse(value || "null") as Partial<StoredPreferences> | null;
    if (!raw || raw.version !== 1) return defaults;
    const pages = raw.pages && typeof raw.pages === "object" ? Object.fromEntries(Object.entries(raw.pages).flatMap(([name, value]) => typeof value === "number" && Number.isFinite(value) && value >= 1 ? [[name, Math.floor(value)]] : [])) : {};
    return { version: 1, pageSize: validPageSize(raw.pageSize), density: raw.density === "compact" || raw.density === "spacious" ? raw.density : "comfortable", pages };
  } catch {
    return defaults;
  }
}

function readPreferences(key: string): StoredPreferences {
  if (typeof window === "undefined") return defaults;
  return parseListPreferences(window.localStorage.getItem(key));
}

export function ListPreferencesProvider({ children }: { children: ReactNode }) {
  const { session } = useWorkspace();
  const identity = session?.identity || session?.username || session?.name || "anonymous";
  const storageKey = `${storagePrefix}:${encodeURIComponent(identity)}`;
  const [preferences, setPreferences] = useState<StoredPreferences>(() => readPreferences(storageKey));

  useEffect(() => setPreferences(readPreferences(storageKey)), [storageKey]);
  useEffect(() => {
    if (typeof window !== "undefined") window.localStorage.setItem(storageKey, JSON.stringify(preferences));
  }, [preferences, storageKey]);

  const page = useCallback((list: string) => Math.max(1, preferences.pages[list] || 1), [preferences.pages]);
  const setPage = useCallback((list: string, value: number) => {
    setPreferences((current) => ({ ...current, pages: { ...current.pages, [list]: Math.max(1, Math.floor(value)) } }));
  }, []);
  const setPageSize = useCallback((value: PageSize) => setPreferences((current) => ({ ...current, pageSize: validPageSize(value) })), []);
  const setDensity = useCallback((value: ListDensity) => setPreferences((current) => ({ ...current, density: value })), []);
  const resetPage = useCallback((list: string) => setPage(list, 1), [setPage]);

  const value = useMemo(() => ({ pageSize: preferences.pageSize, density: preferences.density, page, setPage, setPageSize, setDensity, resetPage }), [preferences.density, preferences.pageSize, page, setPage, setPageSize, setDensity, resetPage]);
  return <ListPreferencesContext.Provider value={value}>{children}</ListPreferencesContext.Provider>;
}

export function useListPreferences() {
  const value = useContext(ListPreferencesContext);
  if (!value) throw new Error("ListPreferencesProvider missing");
  return value;
}

export function densityClass(density: ListDensity) {
  return density === "compact" ? "py-2" : density === "spacious" ? "py-4" : "py-3";
}
