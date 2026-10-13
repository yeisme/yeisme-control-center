import { expect, it } from "vitest";
import { mediaErrorCode, mediaErrorMessage, mediaKind, mediaPreviewKind } from "../src/media-kind";

it("lets explicit MIME win even when the reference implies another media type", () => {
  expect(mediaKind("video/mp4", "image.png")).toBe("video");
  expect(mediaKind(" AUDIO/MP4 ; codecs=aac", "clip.webm")).toBe("audio");
  expect(mediaKind("application/octet-stream", "image.png")).toBe("unknown");
  expect(mediaKind("application/x-unknown", "voice.mp3")).toBe("unknown");
});

it("uses safe reference suffixes only when MIME is absent", () => {
  expect(mediaKind("", "artifact://result/clip.webm?signature=hidden")).toBe("video");
  expect(mediaKind(" ", "artifact://result/voice.MP3#segment")).toBe("audio");
  expect(mediaKind("", "asset:photo.png")).toBe("image");
  expect(mediaKind("", "note.pdf")).toBe("document");
  for (const ref of ["asset:no-extension", "file.exe", "file.png/child", "file%2epng", "file.png%00", "file.constructor", "file.__proto__", "file?name=image.png"])
    expect(mediaKind("", ref)).toBe("unknown");
});

it("keeps labels separate from the MediaBridge render whitelist", () => {
  for (const mime of ["image/png", "image/jpeg", "image/gif", "image/webp"])
    expect(mediaPreviewKind(mime)).toBe("image");
  for (const mime of ["video/mp4", "video/webm"])
    expect(mediaPreviewKind(mime)).toBe("video");
  for (const mime of ["audio/wav", "audio/mpeg", "audio/ogg", "audio/mp4", "audio/flac", "audio/aac"])
    expect(mediaPreviewKind(mime)).toBe("audio");
  for (const mime of ["image/svg+xml", "image/avif", "video/quicktime", "audio/x-wav", "application/pdf", "", "constructor"])
    expect(mediaPreviewKind(mime)).toBe("unknown");
  expect(mediaKind("image/svg+xml", "")).toBe("image");
  expect(mediaPreviewKind("VIDEO/WEBM; codecs=vp9")).toBe("video");
});

it("maps HTTP boundaries without exposing unknown source text", () => {
  const cases: [number, string][] = [
    [401, "login_required"], [403, "content_not_authorized"], [404, "artifact_not_found"],
    [410, "media_grant_expired"], [422, "media_needs_contract"], [429, "media_busy"], [503, "media_unavailable"],
  ];
  for (const [status, code] of cases) expect(mediaErrorCode("https://owner/private?token=secret", status)).toBe(code);
  expect(mediaErrorCode("media_limits_exceeded", 422)).toBe("media_limits_exceeded");
  expect(mediaErrorCode("media_capacity", 429)).toBe("media_capacity");
  expect(mediaErrorCode("identity_not_bound", 403)).toBe("login_required");
  expect(mediaErrorMessage("https://owner/private?token=secret")).not.toContain("secret");
  expect(mediaErrorCode("constructor", 500)).toBe("media_unavailable");
});
