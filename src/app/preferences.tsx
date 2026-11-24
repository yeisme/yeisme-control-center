import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useWorkspace } from "./workspace";
import { pageSizes, type PageSize } from "../shared/pager";
import { clampInspectorWidth, defaultAccountPreferences, loadAccountPreferences, saveAccountPreferences, type AccountPreferences, type InspectorMode, type InspectorSurface, type ListDensity } from "../shared/preferences";
import { inspectorWidthValue } from "../shared/inspector-size";

interface AccountPreferencesValue {
  /** Who the preferences belong to; the same value the recent list and desktop notifications key on. */
  account: string;
  prefs: AccountPreferences;
  update: (change: (current: AccountPreferences) => AccountPreferences) => void;
  reset: () => void;
}

const AccountPreferencesContext = createContext<AccountPreferencesValue | null>(null);

function storage(): Storage | null {
  try { return typeof window === "undefined" ? null : window.localStorage; } catch { return null; }
}

function load(account: string) {
  const store = storage();
  return store ? loadAccountPreferences(store, account) : structuredClone(defaultAccountPreferences);
}

/** This account's preferences on this browser: list sizes, gallery, Inspector, shortcuts and saved views. */
export function AccountPreferencesProvider({ children }: { children: ReactNode }) {
  const { session } = useWorkspace();
  const account = session?.identity || session?.username || session?.name || "anonymous";
  const [state, setState] = useState(() => ({ account, prefs: load(account) }));
  // Another account on the same browser starts from its own entry, never from the last person's choices.
  if (state.account !== account) setState({ account, prefs: load(account) });
  const prefs = state.account === account ? state.prefs : defaultAccountPreferences;
  const update = useCallback((change: (current: AccountPreferences) => AccountPreferences) => {
    setState((current) => {
      const next = change(current.prefs);
      const store = storage();
      if (store) saveAccountPreferences(store, current.account, next);
      return { account: current.account, prefs: next };
    });
  }, []);
  const reset = useCallback(() => update(() => structuredClone(defaultAccountPreferences)), [update]);
  const value = useMemo(() => ({ account, prefs, update, reset }), [account, prefs, update, reset]);
  // The docked Inspector's width is on <html>: the page beside it and the audio dock give way by the same amount.
  const width = prefs.inspector.width;
  useEffect(() => {
    const css = inspectorWidthValue(width);
    const root = document.documentElement;
    if (css) root.style.setProperty("--inspector-width", css);
    else root.style.removeProperty("--inspector-width");
  }, [width]);
  return <AccountPreferencesContext.Provider value={value}>{children}</AccountPreferencesContext.Provider>;
}

export function useAccountPreferences() {
  const value = useContext(AccountPreferencesContext);
  if (!value) throw new Error("AccountPreferencesProvider missing");
  return value;
}

/** Page size and density for every list; the page number itself lives in the address (`usePagedRows`). */
export function useListPreferences() {
  const { prefs, update } = useAccountPreferences();
  const setPageSize = useCallback((value: PageSize) => update((current) => ({ ...current, list: { ...current.list, pageSize: pageSizes.includes(value) ? value : current.list.pageSize } })), [update]);
  const setDensity = useCallback((value: ListDensity) => update((current) => ({ ...current, list: { ...current.list, density: value } })), [update]);
  return { pageSize: prefs.list.pageSize, density: prefs.list.density, setPageSize, setDensity };
}

/** Docked or floating, remembered per panel: tasks (with home, projects and episodes), works, and the tool catalog. */
export function useInspectorMode(surface: InspectorSurface = "tasks") {
  const { prefs, update } = useAccountPreferences();
  const setMode = useCallback((mode: InspectorMode) => update((current) => ({ ...current, inspector: { ...current.inspector, modes: { ...current.inspector.modes, [surface]: mode } } })), [surface, update]);
  return [prefs.inspector.modes[surface], setMode] as const;
}

/** The docked Inspector's width this account chose, or null for the default that follows the window. */
export function useInspectorWidth() {
  const { prefs, update } = useAccountPreferences();
  const setWidth = useCallback((width: number | null) => update((current) => ({ ...current, inspector: { ...current.inspector, width: width === null ? null : clampInspectorWidth(width) } })), [update]);
  return [prefs.inspector.width, setWidth] as const;
}

/** How the works page lays out: the view, how many per gallery page, tile size and grid or justified rows. */
export function useAssetsPreferences() {
  const { prefs, update } = useAccountPreferences();
  const set = useCallback((patch: Partial<AccountPreferences["assets"]>) => update((current) => ({ ...current, assets: { ...current.assets, ...patch } })), [update]);
  return { ...prefs.assets, set };
}

/** This account's saved task views (at most 20), kept with the other preferences. */
export function useSavedViews() {
  const { prefs, update } = useAccountPreferences();
  const setViews = useCallback((change: (views: AccountPreferences["views"]) => AccountPreferences["views"]) => update((current) => ({ ...current, views: change(current.views) })), [update]);
  return [prefs.views, setViews] as const;
}
