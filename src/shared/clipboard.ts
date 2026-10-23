export async function copyReference(value: string): Promise<boolean> {
  try { if (!navigator.clipboard) return false; await navigator.clipboard.writeText(value); return true; } catch { return false; }
}
