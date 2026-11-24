import { entryPages, type NavEntryId, type WorkspacePage } from "../app-shell/navigation";

/** What waits inside an entry: the counts of its pages added up (unread reminders, results waiting to be picked). */
export function entryBadgeCount(entry: NavEntryId, badgeOf: (page: WorkspacePage) => number): number {
  return entryPages(entry).reduce((total, item) => total + Math.max(0, badgeOf(item.id) || 0), 0);
}

/** A count as a badge shows it: up to 99, then 99+. */
export const badgeText = (count: number) => count > 99 ? "99+" : String(count);
