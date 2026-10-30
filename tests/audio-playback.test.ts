import { describe, expect, it } from "vitest";
import { audioBlobLimitBytes, audioStrategy, bufferedEnd, clampSeek, formatPlaybackTime, nextPlaybackRate, playbackFraction, queueFor, queueLabel, queueStep, rateLabel, regrantAllowed, seekForKey, spokenPlaybackTime, trackPhase } from "../src/shared/audio-playback";

describe("audio playback helpers", () => {
  it("reads small known sizes into memory and streams large or unknown ones", () => {
    expect(audioStrategy(2 * 1024 * 1024)).toBe("blob");
    expect(audioStrategy(audioBlobLimitBytes)).toBe("blob");
    expect(audioStrategy(audioBlobLimitBytes + 1)).toBe("stream");
    expect(audioStrategy(null)).toBe("stream");
    expect(audioStrategy(0)).toBe("stream");
  });

  it("formats clock and spoken times without inventing a duration", () => {
    expect(formatPlaybackTime(5.9)).toBe("0:05");
    expect(formatPlaybackTime(225)).toBe("3:45");
    expect(formatPlaybackTime(3723)).toBe("1:02:03");
    expect(formatPlaybackTime(Number.NaN)).toBe("--:--");
    expect(spokenPlaybackTime(65)).toBe("1 分 05 秒");
    expect(spokenPlaybackTime(9)).toBe("9 秒");
    expect(spokenPlaybackTime(Number.POSITIVE_INFINITY)).toBe("时长未知");
  });

  it("clamps seeks and maps the slider keyboard contract", () => {
    expect(clampSeek(-3, 100)).toBe(0);
    expect(clampSeek(120, 100)).toBe(100);
    expect(clampSeek(42, Number.NaN)).toBe(42);
    expect(seekForKey("ArrowRight", 10, 100)).toBe(15);
    expect(seekForKey("ArrowLeft", 3, 100)).toBe(0);
    expect(seekForKey("ArrowRight", 10, 100, true)).toBe(25);
    expect(seekForKey("PageUp", 90, 100)).toBe(100);
    expect(seekForKey("Home", 50, 100)).toBe(0);
    expect(seekForKey("End", 50, 100)).toBe(100);
    expect(seekForKey("End", 50, Number.NaN)).toBeNull();
    expect(seekForKey("a", 50, 100)).toBeNull();
  });

  it("computes fractions, rates and buffered ends", () => {
    expect(playbackFraction(25, 100)).toBe(0.25);
    expect(playbackFraction(25, Number.NaN)).toBe(0);
    expect(playbackFraction(200, 100)).toBe(1);
    expect(nextPlaybackRate(1)).toBe(1.25);
    expect(nextPlaybackRate(0.75)).toBe(1);
    expect(nextPlaybackRate(3)).toBe(1);
    expect(rateLabel(1)).toBe("1.0×");
    expect(rateLabel(1.25)).toBe("1.25×");
    const ranges = { length: 2, start: (i: number) => [0, 40][i], end: (i: number) => [20, 80][i] };
    expect(bufferedEnd(ranges, 10)).toBe(20);
    expect(bufferedEnd(ranges, 50)).toBe(80);
    expect(bufferedEnd(null, 5)).toBe(0);
  });

  it("limits handle re-grants inside the window", () => {
    expect(regrantAllowed([], 10_000).allowed).toBe(true);
    expect(regrantAllowed([1_000, 2_000], 10_000).allowed).toBe(false);
    const later = regrantAllowed([1_000, 2_000], 70_000);
    expect(later.allowed).toBe(true);
    expect(later.recent).toEqual([]);
  });

  it("derives one result's button phase from the global player", () => {
    const base = { track: { key: "a" }, status: "playing" as const, wantsPlay: true };
    expect(trackPhase(base, "b")).toBe("inactive");
    expect(trackPhase(base, "a")).toBe("playing");
    expect(trackPhase({ ...base, status: "loading" }, "a")).toBe("pending");
    expect(trackPhase({ ...base, status: "loading", wantsPlay: false }, "a")).toBe("paused");
    expect(trackPhase({ ...base, status: "error", wantsPlay: false }, "a")).toBe("paused");
    expect(trackPhase({ track: null, status: "idle", wantsPlay: false }, "a")).toBe("inactive");
  });
});

describe("audio queue", () => {
  const list = ["a", "b", "c"].map((key) => ({ key }));

  it("steps to neighbours and stops at the ends", () => {
    expect(queueStep(list, "a", 1)?.key).toBe("b");
    expect(queueStep(list, "b", -1)?.key).toBe("a");
    expect(queueStep(list, "c", 1)).toBeNull();
    expect(queueStep(list, "a", -1)).toBeNull();
    expect(queueStep(list, "missing", 1)).toBeNull();
  });

  it("keeps the list a track was started from, then the current queue, then the track alone", () => {
    const other = [{ key: "x" }, { key: "b" }];
    expect(queueFor({ key: "b" }, other, list)).toBe(other);
    expect(queueFor({ key: "c" }, undefined, list)).toBe(list);
    expect(queueFor({ key: "c" }, other, list)).toBe(list);
    expect(queueFor({ key: "z" }, other, list)).toEqual([{ key: "z" }]);
  });

  it("labels the position only when there is somewhere to go", () => {
    expect(queueLabel(list, "b")).toBe("2 / 3");
    expect(queueLabel([{ key: "a" }], "a")).toBeNull();
    expect(queueLabel(list, "z")).toBeNull();
  });
});
