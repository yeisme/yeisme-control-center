import { describe, expect, it } from "vitest";
import { isPlaceholderName, resultDisplayName, taskFamilyLabel } from "../src/shared/read-model/labels";

const at = new Date(2026, 10, 8, 14, 20).toISOString();

describe("result names", () => {
  it("keeps a name the tool gave", () => {
    expect(resultDisplayName({ name: "  雨夜街道 v2 ", family: "music-job", at })).toBe("雨夜街道 v2");
  });

  it("names a placeholder by the kind of work and when it was made", () => {
    for (const name of ["Owner result", "owner result", "result", "Output 2", "artifact", "", null, "未命名结果"]) expect(isPlaceholderName(name)).toBe(true);
    expect(resultDisplayName({ name: "Owner result", family: "music-job", at })).toBe("音乐生成 · 11-08 14:20");
    expect(resultDisplayName({ name: "Owner result", family: "video-task", at })).toBe("视频任务 · 11-08 14:20");
  });

  it("falls back to the task title, the raw family, then the media kind", () => {
    expect(resultDisplayName({ name: "Owner result", title: "片头配乐", at })).toBe("片头配乐 · 11-08 14:20");
    expect(resultDisplayName({ name: "Owner result", title: "Owner result", family: "storyboard_render", at })).toBe("storyboard render · 11-08 14:20");
    expect(resultDisplayName({ name: "", kind: "audio" })).toBe("音频结果");
    expect(resultDisplayName({ name: "", at: "not a time" })).toBe("未命名结果");
  });

  it("shares the task family labels the task detail uses", () => {
    expect(taskFamilyLabel("music-job")).toBe("音乐生成");
    expect(taskFamilyLabel(null)).toBe("类型未提供");
  });
});
