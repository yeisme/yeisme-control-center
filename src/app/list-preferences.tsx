// The list preferences moved into the account preferences (`./preferences`); this module keeps the old import path.
export { pageSizes, type PageSize } from "../shared/pager";
export type { ListDensity } from "../shared/preferences";
export { AccountPreferencesProvider as ListPreferencesProvider, useListPreferences } from "./preferences";
import type { ListDensity } from "../shared/preferences";

export function densityClass(density: ListDensity) {
  return density === "compact" ? "py-2" : density === "spacious" ? "py-4" : "py-3";
}
