import { galleryPageSizes, pageSizes, type GalleryPageSize, type PageSize } from "./pager";

/**
 * Preferences kept per account on this browser, in one entry (`yeisme.prefs.v1:<account>`), so 「全部重置」 is one key and
 * another person signing in on the same machine gets their own. Theme and motion follow the device instead; see
 * `devicePreferences`. Page numbers are never stored here: they live in the address.
 */
export const preferencesPrefix = "yeisme.prefs.v1";
export const devicePreferencesKey = "yeisme.prefs.device.v1";

export type ListDensity = "compact" | "comfortable" | "spacious";
export type AssetsView = "gallery" | "list" | "compact";
export type GalleryLayout = "grid" | "justified";
export type InspectorMode = "fixed" | "floating";
/** The panels that remember docked or floating on their own, as they did before v21: tasks (also home, projects and episodes), works and the tool catalog. */
export type InspectorSurface = "tasks" | "assets" | "catalog";
export const inspectorSurfaces: readonly InspectorSurface[] = ["tasks", "assets", "catalog"];
export type MotionPreference = "system" | "reduced" | "full";

export interface StoredView {
  id: string;
  name: string;
  /** The query as the address carries it (`state=failed&owner=eikona`), so a view opens exactly like a link. */
  query: string;
  created_at: string;
}

export interface AccountPreferences {
  version: 1;
  list: { pageSize: PageSize; density: ListDensity };
  assets: { view: AssetsView; pageSize: GalleryPageSize; tile: number; layout: GalleryLayout };
  inspector: { modes: Record<InspectorSurface, InspectorMode>; width: number | null };
  /** Shortcut id → chord, only for the ones a person changed. */
  keymap: Record<string, string>;
  views: StoredView[];
}

export interface DevicePreferences { version: 1; motion: MotionPreference }

/** Gallery tiles between 140 and 320 px; the default keeps four across a 1440 screen, as before the slider. */
export const tileRange = { min: 140, max: 320, step: 20, fallback: 240 } as const;
/** The docked Inspector between 400 and 720 px; null keeps the default `clamp(400px, 34vw, 520px)`. */
export const inspectorWidthRange = { min: 400, max: 720 } as const;
export const maxSavedViews = 20;

export const defaultAccountPreferences: AccountPreferences = {
  version: 1,
  list: { pageSize: 40, density: "comfortable" },
  assets: { view: "gallery", pageSize: 48, tile: tileRange.fallback, layout: "grid" },
  inspector: { modes: { tasks: "fixed", assets: "fixed", catalog: "fixed" }, width: null },
  keymap: {},
  views: [],
};
export const defaultDevicePreferences: DevicePreferences = { version: 1, motion: "system" };

const pick = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T => allowed.includes(value as T) ? value as T : fallback;
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

export function clampTile(value: unknown) {
  const number = typeof value === "number" && Number.isFinite(value) ? value : tileRange.fallback;
  return Math.min(tileRange.max, Math.max(tileRange.min, Math.round(number / tileRange.step) * tileRange.step));
}

export function clampInspectorWidth(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.min(inspectorWidthRange.max, Math.max(inspectorWidthRange.min, Math.round(value)));
}

function parseViews(value: unknown): StoredView[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((raw) => {
    const view = record(raw);
    const id = typeof view.id === "string" ? view.id.slice(0, 64) : "";
    const name = typeof view.name === "string" ? view.name.trim().slice(0, 40) : "";
    const query = typeof view.query === "string" ? view.query.slice(0, 2000) : "";
    if (!id || !name || seen.has(id)) return [];
    seen.add(id);
    return [{ id, name, query, created_at: typeof view.created_at === "string" ? view.created_at : "" }];
  }).slice(0, maxSavedViews);
}

function parseKeymap(value: unknown): Record<string, string> {
  return Object.fromEntries(Object.entries(record(value)).flatMap(([id, chord]) => typeof chord === "string" && /^[a-z0-9.-]{1,48}$/i.test(id) && chord.length <= 32 ? [[id, chord]] : []));
}

/** Whatever is stored, read section by section: one bad section falls back alone and never costs the others. */
export function parseAccountPreferences(raw: string | null): AccountPreferences {
  let value: Record<string, unknown> = {};
  try { value = record(JSON.parse(raw || "null")); } catch { value = {}; }
  if (value.version !== 1) return structuredClone(defaultAccountPreferences);
  const list = record(value.list);
  const assets = record(value.assets);
  const inspector = record(value.inspector);
  const defaults = defaultAccountPreferences;
  return {
    version: 1,
    list: {
      pageSize: pageSizes.includes(list.pageSize as PageSize) ? list.pageSize as PageSize : defaults.list.pageSize,
      density: pick(list.density, ["compact", "comfortable", "spacious"] as const, defaults.list.density),
    },
    assets: {
      view: pick(assets.view, ["gallery", "list", "compact"] as const, defaults.assets.view),
      pageSize: galleryPageSizes.includes(assets.pageSize as GalleryPageSize) ? assets.pageSize as GalleryPageSize : defaults.assets.pageSize,
      tile: clampTile(assets.tile),
      layout: pick(assets.layout, ["grid", "justified"] as const, defaults.assets.layout),
    },
    inspector: {
      modes: Object.fromEntries(inspectorSurfaces.map((surface) => [surface, pick(record(inspector.modes)[surface], ["fixed", "floating"] as const, "fixed")])) as Record<InspectorSurface, InspectorMode>,
      width: clampInspectorWidth(inspector.width),
    },
    keymap: parseKeymap(value.keymap),
    views: parseViews(value.views),
  };
}

export function parseDevicePreferences(raw: string | null): DevicePreferences {
  let value: Record<string, unknown> = {};
  try { value = record(JSON.parse(raw || "null")); } catch { value = {}; }
  return { version: 1, motion: pick(value.motion, ["system", "reduced", "full"] as const, "system") };
}

export const accountPreferencesKey = (account: string) => `${preferencesPrefix}:${encodeURIComponent(account || "anonymous")}`;

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** The keys preferences lived under before v21; read once, then removed. */
export const legacyKeys = {
  list: (account: string) => `yeisme.control.list-preferences.v1:${encodeURIComponent(account || "anonymous")}`,
  taskInspector: "yeisme.control.tasks.inspector-mode",
  assetInspector: "yeisme.control.assets.inspector-mode",
  catalogInspector: "yeisme.control.catalog.inspector-mode",
  assetsView: "yeisme.control.assets.view",
} as const;

/**
 * This account's preferences. The first read after the upgrade carries the old list, inspector and gallery choices
 * over and removes the old keys.
 */
export function loadAccountPreferences(storage: StorageLike, account: string): AccountPreferences {
  const key = accountPreferencesKey(account);
  const stored = storage.getItem(key);
  if (stored !== null) return parseAccountPreferences(stored);
  const next = structuredClone(defaultAccountPreferences);
  let migrated = false;
  try {
    const legacyList = record(JSON.parse(storage.getItem(legacyKeys.list(account)) || "null"));
    if (legacyList.version === 1) {
      if (pageSizes.includes(legacyList.pageSize as PageSize)) next.list.pageSize = legacyList.pageSize as PageSize;
      next.list.density = pick(legacyList.density, ["compact", "comfortable", "spacious"] as const, next.list.density);
      migrated = true;
    }
  } catch { /* An unreadable old entry is simply dropped. */ }
  const legacyModes: Array<[InspectorSurface, string]> = [["tasks", legacyKeys.taskInspector], ["assets", legacyKeys.assetInspector], ["catalog", legacyKeys.catalogInspector]];
  for (const [surface, name] of legacyModes) {
    const mode = storage.getItem(name);
    if (mode === null) continue;
    next.inspector.modes[surface] = mode === "floating" ? "floating" : "fixed";
    migrated = true;
  }
  const view = storage.getItem(legacyKeys.assetsView);
  if (view !== null) { next.assets.view = pick(view, ["gallery", "list", "compact"] as const, next.assets.view); migrated = true; }
  if (migrated) {
    saveAccountPreferences(storage, account, next);
    for (const name of [legacyKeys.list(account), legacyKeys.taskInspector, legacyKeys.assetInspector, legacyKeys.catalogInspector, legacyKeys.assetsView]) storage.removeItem(name);
  }
  return next;
}

export function saveAccountPreferences(storage: StorageLike, account: string, value: AccountPreferences) {
  try { storage.setItem(accountPreferencesKey(account), JSON.stringify(value)); } catch { /* Storage full or disabled: the choice lasts until reload. */ }
}

export function loadDevicePreferences(storage: Pick<Storage, "getItem">): DevicePreferences {
  return parseDevicePreferences(storage.getItem(devicePreferencesKey));
}

export function saveDevicePreferences(storage: Pick<Storage, "setItem">, value: DevicePreferences) {
  try { storage.setItem(devicePreferencesKey, JSON.stringify(value)); } catch { /* See above. */ }
}
