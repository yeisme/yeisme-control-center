import { afterAll, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseRange, planStatic } from "../server/static";

const root = mkdtempSync(join(tmpdir(), "static-files-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
writeFileSync(join(root, "index.html"), "<!doctype html>app");
writeFileSync(join(root, "guide.html"), "<!doctype html>guide");
mkdirSync(join(root, "assets"));
writeFileSync(join(root, "assets", "app-abc123.js"), "export {}");
mkdirSync(join(root, "guide", "showcase"), { recursive: true });
writeFileSync(join(root, "guide", "showcase", "clip.mp4"), Buffer.alloc(1000, 7));

describe("static files", () => {
  it("serves pages, falls back to the app for page addresses only, and never answers a missing file with HTML", () => {
    expect(planStatic(root, "/guide.html")).toMatchObject({ status: 200, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" } });
    expect(planStatic(root, "/").file).toBe(join(root, "index.html"));
    expect(planStatic(root, "/projects").file).toBe(join(root, "index.html"));
    expect(planStatic(root, "/guide/showcase/missing.mp4")).toMatchObject({ status: 404 });
    expect(planStatic(root, "/assets/gone-123.js")).toMatchObject({ status: 404 });
    expect(planStatic(root, "/../../etc/passwd").file ?? "").not.toContain("/etc/passwd");
    expect(planStatic(root, "/%E0%A4%A")).toMatchObject({ status: 400 });
  });

  it("names media types, caches only hashed assets for long, and keeps the content policy strict", () => {
    const video = planStatic(root, "/guide/showcase/clip.mp4");
    expect(video.headers).toMatchObject({ "Content-Type": "video/mp4", "Accept-Ranges": "bytes", "Content-Length": "1000", "Cache-Control": "no-cache" });
    expect(planStatic(root, "/assets/app-abc123.js").headers["Cache-Control"]).toBe("public, max-age=31536000, immutable");
    expect(video.headers["Content-Security-Policy"]).toContain("object-src 'none'");
    expect(video.headers["Content-Security-Policy"]).toContain("form-action 'self'");
    expect(video.headers["Content-Security-Policy"]).toContain("media-src 'self' blob:");
  });

  it("answers one byte range with 206 and an unsatisfiable one with 416", () => {
    expect(planStatic(root, "/guide/showcase/clip.mp4", { range: "bytes=0-99" })).toMatchObject({ status: 206, start: 0, end: 99, headers: { "Content-Range": "bytes 0-99/1000", "Content-Length": "100" } });
    expect(planStatic(root, "/guide/showcase/clip.mp4", { range: "bytes=900-" })).toMatchObject({ status: 206, start: 900, end: 999 });
    expect(planStatic(root, "/guide/showcase/clip.mp4", { range: "bytes=-10" })).toMatchObject({ status: 206, start: 990, end: 999 });
    expect(planStatic(root, "/guide/showcase/clip.mp4", { range: "bytes=2000-" })).toMatchObject({ status: 416, headers: { "Content-Range": "bytes */1000" } });
    expect(parseRange("bytes=0-1,5-6", 1000)).toBe("invalid");
    expect(parseRange("items=0-1", 1000)).toBe("invalid");
    expect(parseRange(undefined, 1000)).toBeNull();
  });

  it("answers an unchanged file with 304", () => {
    const first = planStatic(root, "/guide.html");
    expect(planStatic(root, "/guide.html", { ifModifiedSince: first.headers["Last-Modified"] })).toMatchObject({ status: 304 });
  });
});
