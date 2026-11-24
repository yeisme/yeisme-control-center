// Runs before React mounts so a dark preference never flashes the light canvas (CSP forbids inline scripts).
const stored = localStorage.getItem("yeisme.v18.theme");
const dark = stored === "dark" || (stored !== "light" && window.matchMedia?.("(prefers-color-scheme: dark)").matches === true);
document.documentElement.dataset.theme = dark ? "dark" : "light";
// This device's motion choice applies from the first frame too; without one the system's preference applies.
try {
  const motion = (JSON.parse(localStorage.getItem("yeisme.prefs.device.v1") || "null") as { motion?: unknown } | null)?.motion;
  if (motion === "reduced" || motion === "full") document.documentElement.dataset.motion = motion;
} catch {
  // A damaged entry means the system decides, as without one.
}
