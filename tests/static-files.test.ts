import { afterAll, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isServedPath, parseRange, planStatic, servedEntries, unservedPaths, unservedTopLevel } from "../server/static";

const root = mkdtempSync(join(tmpdir(), "static-files-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
writeFileSync(join(root, "index.html"), "<!doctype html>app");
writeFileSync(join(root, "guide.html"), "<!doctype html>guide");
mkdirSync(join(root, "assets"));
writeFileSync(join(root, "assets", "app-abc123.js"), "export {}");
mkdirSync(join(root, "guide", "showcase"), { recursive: true });
writeFileSync(join(root, "guide", "showcase", "clip.mp4"), Buffer.alloc(1000, 7));
mkdirSync(join(root, "v18"));
writeFileSync(join(root, "v18", "street.jpg"), Buffer.alloc(10, 1));
writeFileSync(join(root, "favicon.svg"), "<svg/>");
// Files that a build once carried along from public/ or docs/, and that must never be sent.
writeFileSync(join(root, "source.zip"), Buffer.alloc(100, 9));
mkdirSync(join(root, "docs", "third-party"), { recursive: true });
writeFileSync(join(root, "docs", "README.md"), "# internal notes");
writeFileSync(join(root, "docs", "third-party", "geist-LICENSE"), "licence text");
writeFileSync(join(root, "server.mjs"), "export {}");

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

  it("names what is served, and sends nothing else even when the file exists", () => {
    expect(servedEntries).toEqual(expect.arrayContaining(["index.html", "guide.html", "assets/", "guide/", "v18/"]));
    expect(servedEntries.every((entry) => !entry.startsWith("/") && !entry.includes(".."))).toBe(true);
    for (const served of ["/", "/index.html", "/guide.html", "/assets/app-abc123.js", "/guide/showcase/clip.mp4", "/v18/street.jpg", "/favicon.svg"])
      expect(planStatic(root, served).status, served).toBe(200);
    // A real file outside the list is a 404, with or without an extension, and never falls back to the app.
    for (const hidden of ["/source.zip", "/docs/README.md", "/docs/third-party/geist-LICENSE", "/server.mjs"]) {
      const plan = planStatic(root, hidden);
      expect(plan.status, hidden).toBe(404);
      expect(plan.file, hidden).toBeUndefined();
      expect(plan.headers["Content-Type"], hidden).toBe("text/plain; charset=utf-8");
    }
    // Range requests and conditional requests do not get around it.
    expect(planStatic(root, "/source.zip", { range: "bytes=0-9" }).status).toBe(404);
    expect(planStatic(root, "/docs/README.md", { ifModifiedSince: new Date(Date.now() + 60_000).toUTCString() }).status).toBe(404);
  });

  it("judges the path that was asked for after resolving it, so dot segments and encodings cannot reach a hidden file", () => {
    for (const sneaky of ["/assets/../source.zip", "/guide/../docs/README.md", "/assets/%2e%2e/source.zip", "/assets/..%2Fdocs%2FREADME.md", "/./docs/README.md", "//docs/README.md", "/v18/../server.mjs"])
      expect(planStatic(root, sneaky).status, sneaky).toBe(404);
    // A sibling directory that merely starts with a served name is not served.
    mkdirSync(join(root, "assets-old"));
    writeFileSync(join(root, "assets-old", "x.js"), "export {}");
    expect(planStatic(root, "/assets-old/x.js").status).toBe(404);
  });

  it("still answers a page address that is not a file with the app, wherever it points", () => {
    expect(planStatic(root, "/docs").file).toBe(join(root, "index.html"));
    expect(planStatic(root, "/docs/overview").file).toBe(join(root, "index.html"));
    expect(planStatic(root, "/docs/missing.md").status).toBe(404);
    expect(planStatic(root, "/missing.zip").status).toBe(404);
  });

  it("shares one list with the build prune and the public-surface check", () => {
    expect(isServedPath("assets/app.js")).toBe(true);
    expect(isServedPath("assets/")).toBe(false);
    expect(isServedPath("assets-old/app.js")).toBe(false);
    expect(isServedPath("index.html")).toBe(true);
    expect(isServedPath("source.zip")).toBe(false);
    expect(isServedPath("docs/README.md")).toBe(false);
    expect(unservedPaths(["index.html", "assets/a.js", "source.zip", "docs/README.md", "docs/third-party/geist-LICENSE", "guide/showcase/a.webp"])).toEqual(["source.zip", "docs/README.md", "docs/third-party/geist-LICENSE"]);
    expect(unservedTopLevel(["assets", "docs", "guide", "guide.html", "index.html", "source.zip", "v18", "favicon.ico"])).toEqual(["docs", "source.zip"]);
  });
});
