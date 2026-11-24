/** Keyboard conventions shared by the lists, the shell shortcuts and the shortcut reference. */
import { effectiveKeymap, resolveKey, shortcutReference, stepFromEvent, type Keymap, type ShortcutGroup } from "./keymap";

export interface Box { left: number; top: number; width: number; height: number }
export type ListLayout = "list" | "grid";

/**
 * Index focus moves to from `current` for one key, or null when the key does not move it.
 * Lists step by one; grids step along the row with ←/→ and to the closest column of the next row with ↑/↓.
 */
export function moveIndex(boxes: Box[], current: number, key: string, layout: ListLayout): number | null {
  const last = boxes.length - 1;
  if (current < 0 || current > last) return null;
  if (key === "Home") return current === 0 ? null : 0;
  if (key === "End") return current === last ? null : last;
  const forward = layout === "list" ? "ArrowDown" : "ArrowRight";
  const backward = layout === "list" ? "ArrowUp" : "ArrowLeft";
  if (key === forward) return current < last ? current + 1 : null;
  if (key === backward) return current > 0 ? current - 1 : null;
  if (layout === "list" || (key !== "ArrowDown" && key !== "ArrowUp")) return null;
  const from = boxes[current];
  const middle = from.top + from.height / 2;
  const down = key === "ArrowDown";
  const candidates = boxes.map((box, index) => ({ box, index })).filter(({ box }) => down ? box.top >= middle : box.top + box.height <= middle);
  if (!candidates.length) return null;
  const rowTop = down ? Math.min(...candidates.map(({ box }) => box.top)) : Math.max(...candidates.map(({ box }) => box.top));
  const centre = (box: Box) => box.left + box.width / 2;
  return candidates
    .filter(({ box }) => Math.abs(box.top - rowTop) < from.height / 2)
    .reduce((best, item) => Math.abs(centre(item.box) - centre(from)) < Math.abs(centre(best.box) - centre(from)) ? item : best).index;
}

const textEntry = [
  "input:not([type='checkbox']):not([type='radio']):not([type='button']):not([type='submit']):not([type='reset']):not([type='range'])",
  "textarea",
  "select",
  "[contenteditable]:not([contenteditable='false'])",
  "[role='textbox']",
  "[role='combobox']",
].join(", ");

/** True when a key press belongs to text entry rather than to page shortcuts. */
export function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as Element | null;
  return typeof element?.closest === "function" && element.closest(textEntry) !== null;
}

export type ShellShortcut = "search" | "page-search" | "shortcuts";
const shellShortcuts: readonly string[] = ["search", "page-search", "shortcuts"];

/** Which shell shortcut a key press triggers with the default bindings. Page shortcuts never fire while typing or while a dialog owns the keyboard. */
export function shellShortcut(event: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey?: boolean; defaultPrevented: boolean; target: EventTarget | null }, dialogOpen: boolean): ShellShortcut | null {
  const result = resolveKey(stepFromEvent(event), null, effectiveKeymap(), { typing: isTypingTarget(event.target), dialog: dialogOpen, prevented: event.defaultPrevented });
  return result.kind === "run" && shellShortcuts.includes(result.command.id) ? result.command.id as ShellShortcut : null;
}

/** Modifier shown for Ctrl/⌘ shortcuts on this platform. */
export const modifierLabel = (userAgent: string) => /Mac|iPhone|iPad/.test(userAgent) ? "⌘" : "Ctrl";

export type { ShortcutEntry, ShortcutGroup } from "./keymap";

/** The shortcut reference, drawn from the keymap table with the given bindings (the defaults when none are given). */
export function shortcutGroups(modifier: string, keymap: Keymap = effectiveKeymap()): ShortcutGroup[] {
  return shortcutReference(modifier, keymap);
}
