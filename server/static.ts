import { existsSync, statSync } from "node:fs";
import { extname, resolve, sep } from "node:path";

export const staticTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
};

export const contentSecurityPolicy =
  "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; font-src 'self'; object-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'";

/** One `bytes=a-b` range (or a suffix `bytes=-n`): null when none was asked for, "invalid" when it cannot be served. */
export function parseRange(header: string | undefined, size: number): { start: number; end: number } | null | "invalid" {
  if (!header) return null;
  // One range only: media players ask for one, and several would need a multipart reply.
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (!match[1] && !match[2])) return "invalid";
  let start: number;
  let end: number;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!suffix) return "invalid";
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) return "invalid";
  return { start, end };
}

export interface StaticPlan {
  status: number;
  headers: Record<string, string>;
  /** The file to send, whole or from `start` to `end` inclusive. */
  file?: string;
  start?: number;
  end?: number;
}

/**
 * What to send for a static path. Pure apart from reading file metadata, so tests need no server.
 * Page addresses fall back to the app's index.html; a missing file with an extension (an image, a video, a script)
 * is a 404, never HTML that a media element would fail to decode.
 */
export function planStatic(root: string, pathname: string, request: { range?: string; ifModifiedSince?: string } = {}): StaticPlan {
  let path: string;
  try { path = decodeURIComponent(pathname); } catch { return { status: 400, headers: {} }; }
  const target = resolve(root, "." + path);
  if (!target.startsWith(root + sep) && target !== root) return { status: 404, headers: {} };
  const exists = existsSync(target) && statSync(target).isFile();
  const ext = extname(path);
  const file = exists ? target : ext && ext !== ".html" ? null : resolve(root, "index.html");
  if (!file) return { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } };
  if (!existsSync(file)) return { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } };
  const stat = statSync(file);
  const modified = new Date(Math.floor(stat.mtimeMs / 1000) * 1000);
  const headers: Record<string, string> = {
    "Content-Type": staticTypes[extname(file)] || "application/octet-stream",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "same-origin",
    "Content-Security-Policy": contentSecurityPolicy,
    "Accept-Ranges": "bytes",
    // Built assets carry a content hash in their names; pages and media revalidate.
    "Cache-Control": exists && path.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache",
    "Last-Modified": modified.toUTCString(),
  };
  const range = parseRange(request.range, stat.size);
  if (range === "invalid") return { status: 416, headers: { ...headers, "Content-Range": `bytes */${stat.size}` } };
  if (range) return { status: 206, headers: { ...headers, "Content-Range": `bytes ${range.start}-${range.end}/${stat.size}`, "Content-Length": String(range.end - range.start + 1) }, file, start: range.start, end: range.end };
  const since = request.ifModifiedSince ? Date.parse(request.ifModifiedSince) : NaN;
  if (Number.isFinite(since) && modified.getTime() <= since) return { status: 304, headers };
  return { status: 200, headers: { ...headers, "Content-Length": String(stat.size) }, file };
}
