import { useState } from "react";
import type { ServiceDirectoryEntry } from "../../service-directory";

export type DirectoryFilter = "all" | "integrated" | "configured" | "gaps";

type Rated = Pick<ServiceDirectoryEntry, "integration" | "configuration">;

/**
 * A directory entry that is only a registration: the control center has no contract for it and nothing is configured.
 * These fold into one group; an entry someone did configure stays in the main list, where a problem is seen.
 */
export const isUnintegrated = (service: Rated) => service.integration === "not_integrated" && service.configuration !== "configured";

/** Entries a filter and a search keep. The search reads name, purpose, owner path and gap. */
export function filterDirectory<T extends Rated & Pick<ServiceDirectoryEntry, "name" | "purpose" | "owner_path" | "gap">>(services: T[], filter: DirectoryFilter, query: string): T[] {
  const needle = query.trim().toLocaleLowerCase();
  return services.filter((service) => {
    if (filter === "integrated" && service.integration === "not_integrated") return false;
    if (filter === "configured" && service.configuration !== "configured") return false;
    if (filter === "gaps" && service.integration !== "not_integrated" && service.configuration === "configured") return false;
    return !needle || `${service.name} ${service.purpose} ${service.owner_path} ${service.gap}`.toLocaleLowerCase().includes(needle);
  });
}

export interface DirectoryView<T> {
  /** Integrated entries and entries that need attention, in directory order. */
  listed: T[];
  /** Registered-only entries, in directory order. */
  unintegrated: T[];
  /** How many registered-only entries the directory has before any filter. */
  unintegratedTotal: number;
  /**
   * The reader asked for these entries by typing a search or choosing 缺口. Matches are shown at once instead of
   * waiting behind a closed group, and the group's remembered state is left as it was.
   */
  narrowed: boolean;
}

export function directoryView<T extends Rated & Pick<ServiceDirectoryEntry, "name" | "purpose" | "owner_path" | "gap">>(services: T[], filter: DirectoryFilter, query: string): DirectoryView<T> {
  const rows = filterDirectory(services, filter, query);
  return {
    listed: rows.filter((service) => !isUnintegrated(service)),
    unintegrated: rows.filter(isUnintegrated),
    unintegratedTotal: services.filter(isUnintegrated).length,
    narrowed: query.trim() !== "" || filter === "gaps",
  };
}

/** The group's heading count: `17 项`, or `3 / 17 项` while a filter or search keeps only some of them. */
export const unintegratedCount = (shown: number, total: number) => shown === total ? `${total} 项` : `${shown} / ${total} 项`;

/** One browser preference, like the asset view or the inspector mode: a key in local storage, "1" for on. */
export const unintegratedOpenKey = "yeisme.control.services.unintegrated-open";

export type FlagStorage = Pick<Storage, "getItem" | "setItem">;

function browserStorage(): FlagStorage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    // Reading the property itself throws when storage is blocked.
    return undefined;
  }
}

export function readFlag(storage: FlagStorage | undefined, key: string): boolean {
  try {
    return storage?.getItem(key) === "1";
  } catch {
    return false;
  }
}

export function writeFlag(storage: FlagStorage | undefined, key: string, value: boolean) {
  try {
    storage?.setItem(key, value ? "1" : "0");
  } catch { /* Storage disabled or full: the choice then lasts until the page is closed. */ }
}

/** What a press of the toggle does to the remembered choice: it flips it, writes the new value, and returns it. */
export function toggleFlag(storage: FlagStorage | undefined, key: string, current: boolean): boolean {
  const next = !current;
  writeFlag(storage, key, next);
  return next;
}

/**
 * Whether the folded group is open, remembered per browser (`storage` is this browser's local storage unless a test
 * brings its own). Closed until someone opens it.
 */
export function useUnintegratedOpen(storage: FlagStorage | undefined = browserStorage()): [boolean, () => void] {
  const [open, setOpen] = useState(() => readFlag(storage, unintegratedOpenKey));
  const toggle = () => setOpen(toggleFlag(storage, unintegratedOpenKey, open));
  return [open, toggle];
}
