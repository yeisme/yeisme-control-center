// What the control center serves from its built directory (dist/), and nothing else. This is plain ESM on purpose: the server
// (bun), the Vite build, the release scripts (bun) and the public-surface check (node) all read this one list, so a file that is
// not named here is neither sent, nor copied into a release, nor allowed to sit in a built directory.
// A trailing "/" marks a directory whose whole subtree is served; every other entry is one file.
export const servedEntries = [
  "index.html",
  // The public guide: same hashed assets, no session, no API.
  "guide.html",
  "favicon.svg",
  "favicon.ico",
  // Hashed scripts, styles and fonts.
  "assets/",
  // Recorded samples the guide plays (pictures, one video, audio).
  "guide/",
  // Design pictures shipped with the first live workspace.
  "v18/",
];

/** Whether a path relative to the built directory (forward slashes, no leading slash, already normalised) may be sent. */
export function isServedPath(relative) {
  return servedEntries.some((entry) => (entry.endsWith("/") ? relative.startsWith(entry) && relative.length > entry.length : relative === entry));
}

/** The paths among `relatives` that must not be in a served directory. */
export function unservedPaths(relatives) {
  return relatives.filter((relative) => !isServedPath(relative));
}

/** The top-level names of a built directory that are not served; each goes whole, file or directory. */
export function unservedTopLevel(names) {
  return names.filter((name) => !servedEntries.includes(name) && !servedEntries.includes(name + "/"));
}
