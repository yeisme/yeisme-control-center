import type { KeyboardEvent } from "react";
import { moveIndex, type ListLayout } from "../../shared/keyboard";

/** The one button per list item that arrow keys move between and Enter opens. */
export const rowButton = "[data-row-button]";

const visible = (element: HTMLElement) => element.getClientRects().length > 0;

/** List container key handler: arrow keys, Home and End move focus between the items' buttons; Enter stays native. */
export function moveBetweenRows(event: KeyboardEvent<HTMLElement>, layout: ListLayout = "list") {
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  const target = event.target as HTMLElement;
  if (!target.matches?.(rowButton)) return;
  const items = [...event.currentTarget.querySelectorAll<HTMLElement>(rowButton)].filter(visible);
  const next = moveIndex(items.map((item) => item.getBoundingClientRect()), items.indexOf(target), event.key, layout);
  if (next === null) return;
  event.preventDefault();
  items[next].focus();
}

/** Selector of the list entry marked with `attribute="value"`; no `CSS` global needed. */
export const itemSelector = (attribute: string, value: string) => `[${attribute}="${value.replace(/["\\]/g, "\\$&")}"]`;

/** First list item after a search field on the same page, so ↓ in the field enters its list. */
export function firstRowAfter(field: HTMLElement): HTMLElement | null {
  const scope = field.closest("main") || field.ownerDocument.body;
  return [...scope.querySelectorAll<HTMLElement>(rowButton)].find((item) => visible(item) && Boolean(field.compareDocumentPosition(item) & Node.DOCUMENT_POSITION_FOLLOWING)) || null;
}
