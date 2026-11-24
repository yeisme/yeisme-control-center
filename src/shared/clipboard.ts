/**
 * Copy text without making HTTPS or the Clipboard API a product gate.
 *
 * 1. In a secure context, the Clipboard API.
 * 2. Otherwise `execCommand("copy")` from a textarea mounted inside the dialog or menu that has focus. A textarea on
 *    <body> has its focus pulled straight back by the dialog's focus trap, and the copy then takes nothing.
 * 3. The legacy path counts only when the copy event really fired and carried the text. `execCommand` returning true
 *    while nothing reached the clipboard is a failure, so the caller opens the manual-copy box instead.
 */
export async function copyText(value: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText && secureContext()) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      // Refused (permission, document not focused): fall through to the legacy path, then to manual copy.
    }
  }
  if (typeof document === "undefined") return false;
  return legacyCopy(value);
}

/** The older name; every copy goes through `copyText`. */
export const copyReference = copyText;

function secureContext() {
  return typeof window === "undefined" || window.isSecureContext !== false;
}

/** Where focus is trapped, if anywhere: the textarea has to live inside it to keep the focus it needs. */
const trapSelector = '[role="dialog"], [role="alertdialog"], [role="menu"]';

function legacyCopy(value: string): boolean {
  const previous = document.activeElement as HTMLElement | null;
  const host = (previous && previous !== document.body ? previous.closest?.(trapSelector) as HTMLElement | null : null) || document.body;
  const area = document.createElement("textarea");
  area.value = value;
  area.setAttribute("readonly", "");
  area.setAttribute("aria-hidden", "true");
  area.setAttribute("tabindex", "-1");
  Object.assign(area.style, { position: "fixed", top: "0", left: "0", width: "1px", height: "1px", padding: "0", border: "0", opacity: "0", pointerEvents: "none" });
  let carried = false;
  const onCopy = (event: Event) => {
    const data = (event as ClipboardEvent).clipboardData;
    if (!data) return;
    // Set the text outright, so line breaks survive whatever the selection held.
    data.setData("text/plain", value);
    event.preventDefault();
    carried = true;
  };
  document.addEventListener("copy", onCopy, true);
  host.appendChild(area);
  try {
    area.focus({ preventScroll: true });
    area.select();
    area.setSelectionRange(0, value.length);
    return document.execCommand("copy") && carried;
  } catch {
    return false;
  } finally {
    document.removeEventListener("copy", onCopy, true);
    area.remove();
    if (previous && previous !== document.body && typeof previous.focus === "function") previous.focus({ preventScroll: true });
  }
}
