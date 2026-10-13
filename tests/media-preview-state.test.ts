import { expect, it } from "vitest";
import {
  fitScale,
  formatBytes,
  formatDuration,
  localKind,
  maxLocalBytes,
  maxTextBytes,
  percent,
  planLocalFile,
  stepZoom,
  widthScale,
} from "../src/media-preview-state";

it("classifies local files by MIME first, then text extension", () => {
  expect(localKind({ name: "a.bin", type: "image/png" })).toBe("image");
  expect(localKind({ name: "a.bin", type: "audio/wav" })).toBe("audio");
  expect(localKind({ name: "a.bin", type: "video/mp4" })).toBe("video");
  expect(localKind({ name: "notes.SRT", type: "" })).toBe("text");
  expect(localKind({ name: "a.txt", type: "text/plain" })).toBe("text");
  expect(localKind({ name: "a.pdf", type: "application/pdf" })).toBe("file");
  expect(localKind({ name: "page.html", type: "text/html" })).toBe("file");
});

it("rejects files over 64 MB and flags text over 512 KB without reading it", () => {
  expect(
    planLocalFile({ name: "a.mp4", type: "video/mp4", size: maxLocalBytes + 1 }),
  ).toEqual({ ok: false, reason: "too_large" });
  expect(
    planLocalFile({ name: "a.mp4", type: "video/mp4", size: maxLocalBytes }),
  ).toMatchObject({ ok: true, kind: "video", unsupported: false });
  expect(
    planLocalFile({ name: "a.txt", type: "text/plain", size: maxTextBytes }),
  ).toMatchObject({ ok: true, readText: true, textTooLarge: false });
  expect(
    planLocalFile({ name: "a.txt", type: "text/plain", size: maxTextBytes + 1 }),
  ).toMatchObject({
    ok: true,
    readText: false,
    textTooLarge: true,
    unsupported: true,
  });
});

it("treats documents and unknown formats as metadata-only", () => {
  expect(
    planLocalFile({ name: "a.pdf", type: "application/pdf", size: 10 }),
  ).toMatchObject({ ok: true, kind: "file", readText: false, unsupported: true });
});

it("steps zoom from the ratio on screen using the 25-300% presets", () => {
  expect(stepZoom(1, 1)).toBe(1.5);
  expect(stepZoom(1, -1)).toBe(0.75);
  expect(stepZoom(0.62, 1)).toBe(0.75);
  expect(stepZoom(0.62, -1)).toBe(0.5);
  expect(stepZoom(3, 1)).toBe(3);
  expect(stepZoom(0.25, -1)).toBe(0.25);
  expect(stepZoom(0.7501, 1)).toBe(1);
  // Fit can land outside the presets; a step must not reverse direction.
  expect(stepZoom(0.2, -1)).toBe(0.2);
  expect(stepZoom(0.2, 1)).toBe(0.25);
  expect(stepZoom(7, 1)).toBe(7);
  expect(stepZoom(7, -1)).toBe(3);
});

it("computes fit and width scales without dividing by zero", () => {
  expect(fitScale({ w: 700, h: 600 }, { w: 1400, h: 933 })).toBeCloseTo(0.5, 3);
  expect(fitScale({ w: 700, h: 400 }, { w: 1400, h: 933 })).toBeCloseTo(
    400 / 933,
    3,
  );
  expect(fitScale({ w: 700, h: 400 }, null)).toBe(1);
  expect(fitScale({ w: 0, h: 0 }, { w: 10, h: 10 })).toBe(1);
  expect(widthScale({ w: 700, h: 400 }, { w: 1400, h: 933 })).toBe(0.5);
  expect(widthScale({ w: 700, h: 400 }, { w: 0, h: 0 })).toBe(1);
});

it("formats sizes, durations and percentages", () => {
  expect(formatBytes(900)).toBe("900 B");
  expect(formatBytes(1536)).toBe("1.5 KB");
  expect(formatBytes(5 * 1048576)).toBe("5.0 MB");
  expect(formatDuration(154.7)).toBe("2:34");
  expect(formatDuration(Number.NaN)).toBe("时长未提供");
  expect(formatDuration(Infinity)).toBe("时长未提供");
  expect(percent(0.756)).toBe("76%");
});
