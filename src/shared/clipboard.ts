/** Copy without making HTTPS/Clipboard API availability a product capability gate. */
export async function copyReference(value: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // Fall through to the legacy browser path and then to manual copy UI.
  }
  if (typeof document === "undefined") return false;
  const input = document.createElement("textarea");
  input.value = value;
  input.setAttribute("aria-hidden", "true");
  input.style.position = "fixed";
  input.style.top = "0";
  input.style.left = "0";
  input.style.width = "1px";
  input.style.height = "1px";
  input.style.opacity = "0.01";
  document.body.appendChild(input);
  input.focus();
  input.setSelectionRange(0, value.length);
  try { return document.execCommand("copy"); } catch { return false; } finally { input.remove(); }
}
