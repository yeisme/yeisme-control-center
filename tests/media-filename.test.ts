import { describe, expect, it } from "vitest";
import { mediaFilename } from "../src/shared/media-filename";

describe("media filename", () => {
  it("keeps the owner name and appends the MIME extension", () => {
    expect(mediaFilename("片尾环境音乐", "audio/wav")).toBe("片尾环境音乐.wav");
    expect(mediaFilename("雨巷推镜头", "video/mp4")).toBe("雨巷推镜头.mp4");
  });

  it("repairs a conflicting known extension without changing the basename", () => {
    expect(mediaFilename("雨巷推镜头.mov", "video/mp4")).toBe("雨巷推镜头.mp4");
    expect(mediaFilename("旁白.wav", "audio/wav")).toBe("旁白.wav");
  });

  it("removes path and control characters", () => {
    expect(mediaFilename("../秘密/片段", "video/mp4")).toBe(".._秘密_片段.mp4");
  });

  it("uses a stable fallback when the owner omits a name", () => {
    expect(mediaFilename("", "audio/mpeg")).toBe("result.mp3");
    expect(mediaFilename(undefined, "audio/mp4", "附件")).toBe("附件.m4a");
  });
});

