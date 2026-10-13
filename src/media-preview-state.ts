export const maxLocalBytes = 64 * 1024 * 1024;
export const maxTextBytes = 512 * 1024;
export const zoomSteps = [0.25, 0.5, 0.75, 1, 1.5, 2, 3] as const;

export type LocalKind = "image" | "audio" | "video" | "text" | "file";
export interface Size {
  w: number;
  h: number;
}
export type LocalPlan =
  | { ok: false; reason: "too_large" }
  | {
      ok: true;
      kind: LocalKind;
      readText: boolean;
      unsupported: boolean;
      textTooLarge: boolean;
    };

const textExtension = /\.(txt|md|csv|json|log|srt|vtt)$/i;

export function localKind(file: { name: string; type: string }): LocalKind {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("audio/")) return "audio";
  if (file.type.startsWith("video/")) return "video";
  if (file.type === "text/plain" || textExtension.test(file.name))
    return "text";
  return "file";
}

export function planLocalFile(file: {
  name: string;
  type: string;
  size: number;
}): LocalPlan {
  if (file.size > maxLocalBytes) return { ok: false, reason: "too_large" };
  const kind = localKind(file);
  const textTooLarge = kind === "text" && file.size > maxTextBytes;
  return {
    ok: true,
    kind,
    readText: kind === "text" && !textTooLarge,
    unsupported: kind === "file" || textTooLarge,
    textTooLarge,
  };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / 1048576).toFixed(1) + " MB";
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds)) return "时长未提供";
  const whole = Math.floor(seconds);
  return Math.floor(whole / 60) + ":" + String(whole % 60).padStart(2, "0");
}

export function percent(scale: number): string {
  return Math.round(scale * 100) + "%";
}

// Steps move from the ratio actually on screen and never reverse direction;
// at the ends the current ratio is returned so callers can disable the button.
export function stepZoom(current: number, direction: 1 | -1): number {
  const epsilon = 0.005;
  const next =
    direction > 0
      ? zoomSteps.find((step) => step > current + epsilon)
      : [...zoomSteps].reverse().find((step) => step < current - epsilon);
  return next ?? current;
}

export function fitScale(stage: Size, natural: Size | null): number {
  if (!natural || natural.w <= 0 || natural.h <= 0) return 1;
  if (stage.w <= 0 || stage.h <= 0) return 1;
  return Math.min(stage.w / natural.w, stage.h / natural.h);
}

export function widthScale(stage: Size, natural: Size | null): number {
  if (!natural || natural.w <= 0 || stage.w <= 0) return 1;
  return stage.w / natural.w;
}
