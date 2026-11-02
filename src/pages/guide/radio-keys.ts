import type { KeyboardEvent } from "react";
import { moveIndex, type Box } from "../../shared/keyboard";

// A radio group is one-dimensional, so only how many radios there are matters to `moveIndex`.
const slot: Box = { left: 0, top: 0, width: 0, height: 0 };

/**
 * Which radio a key press moves to, or null when it moves nowhere. Follows the WAI-ARIA radio group pattern: → and ↓
 * step to the next radio, ← and ↑ to the previous one, wherever the buttons wrap on screen, and the ends wrap round.
 * Home and End go to the first and last. `moveIndex` does the stepping; it stops at the ends, so the wrapping is added here.
 */
export function radioTarget(count: number, current: number, key: string): number | null {
  if (count < 2) return null;
  const step = key === "ArrowRight" ? "ArrowDown" : key === "ArrowLeft" ? "ArrowUp" : key;
  const next = moveIndex(Array.from({ length: count }, () => slot), current, step, "list");
  if (next !== null) return next;
  if (step === "ArrowDown" && current === count - 1) return 0;
  if (step === "ArrowUp" && current === 0) return count - 1;
  return null;
}

/**
 * The tab stop of a radio group: the checked radio, or the first when none is checked, so Tab enters the group once and
 * the arrow keys move inside it.
 */
export const radioTabIndex = (index: number, checked: number): 0 | -1 => index === (checked < 0 ? 0 : checked) ? 0 : -1;

/**
 * The group's key handler. Moving focus also checks the radio, as radio buttons do; `select` receives its index.
 * Keys with a modifier and keys the group does not use are left to the browser.
 */
export function moveBetweenRadios(event: KeyboardEvent<HTMLElement>, select: (index: number) => void) {
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  const radios = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]')];
  const next = radioTarget(radios.length, radios.indexOf(event.target as HTMLElement), event.key);
  if (next === null) return;
  event.preventDefault();
  radios[next].focus();
  select(next);
}
