// Runs before React mounts so a dark preference never flashes the light canvas (CSP forbids inline scripts).
const stored = localStorage.getItem("yeisme.v18.theme");
const dark = stored === "dark" || (stored !== "light" && window.matchMedia?.("(prefers-color-scheme: dark)").matches === true);
document.documentElement.dataset.theme = dark ? "dark" : "light";
