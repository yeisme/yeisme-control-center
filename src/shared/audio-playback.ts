/**
 * Pure helpers for the global audio player: time labels, seek math and the source strategy.
 * The player itself lives in components/audio-player.tsx; nothing here touches the DOM.
 */

/** Audio at or below this size is read once into session memory so seeking and long pauses never re-read the owner. */
export const audioBlobLimitBytes = 16 * 1024 * 1024;

/** Re-grant budget for a streaming source whose short-lived handle expired or failed mid-play. */
export const audioRegrantLimit = 2;
export const audioRegrantWindowMs = 60_000;

export const playbackRates = [1, 1.25, 1.5, 2, 0.75] as const;
export type PlaybackRate = (typeof playbackRates)[number];

export type AudioTransport = "blob" | "stream";

export function audioStrategy(bytes: number | null | undefined, limit = audioBlobLimitBytes): AudioTransport {
  return typeof bytes === "number" && Number.isFinite(bytes) && bytes > 0 && bytes <= limit ? "blob" : "stream";
}

/** "0:05", "3:45", "1:02:03"; unknown durations read as "--:--" rather than a fake zero. */
export function formatPlaybackTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "--:--";
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = String(total % 60).padStart(2, "0");
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}` : `${minutes}:${rest}`;
}

/** Screen-reader time, e.g. "1 分 05 秒". */
export function spokenPlaybackTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "时长未知";
  const total = Math.floor(seconds);
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return minutes ? `${minutes} 分 ${String(rest).padStart(2, "0")} 秒` : `${rest} 秒`;
}

export function clampFraction(value: number) {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

export function playbackFraction(current: number, duration: number) {
  return Number.isFinite(duration) && duration > 0 ? clampFraction(current / duration) : 0;
}

export function clampSeek(seconds: number, duration: number) {
  if (!Number.isFinite(seconds)) return 0;
  const upper = Number.isFinite(duration) && duration > 0 ? duration : Number.POSITIVE_INFINITY;
  return Math.min(upper, Math.max(0, seconds));
}

/** Slider keyboard contract: arrows step 5s (Shift 15s), PageUp/PageDown 30s, Home/End jump. Null means "not a seek key". */
export function seekForKey(key: string, current: number, duration: number, shift = false): number | null {
  const step = shift ? 15 : 5;
  switch (key) {
    case "ArrowRight":
    case "ArrowUp":
      return clampSeek(current + step, duration);
    case "ArrowLeft":
    case "ArrowDown":
      return clampSeek(current - step, duration);
    case "PageUp":
      return clampSeek(current + 30, duration);
    case "PageDown":
      return clampSeek(current - 30, duration);
    case "Home":
      return 0;
    case "End":
      return Number.isFinite(duration) && duration > 0 ? duration : null;
    default:
      return null;
  }
}

export function nextPlaybackRate(current: number): PlaybackRate {
  const index = playbackRates.indexOf(current as PlaybackRate);
  return playbackRates[(index + 1) % playbackRates.length];
}

export function rateLabel(rate: number) {
  return `${Number.isInteger(rate) ? rate.toFixed(1) : String(rate)}×`;
}

/** Keeps only re-grants inside the window and says whether one more is allowed. */
export function regrantAllowed(history: number[], now: number, limit = audioRegrantLimit, windowMs = audioRegrantWindowMs) {
  const recent = history.filter((at) => now - at < windowMs);
  return { allowed: recent.length < limit, recent };
}

/** End of the buffered range that contains the playhead, as seconds. */
export function bufferedEnd(ranges: { length: number; start: (index: number) => number; end: (index: number) => number } | null | undefined, current: number) {
  if (!ranges) return 0;
  for (let index = 0; index < ranges.length; index++) {
    if (ranges.start(index) <= current + 0.5 && ranges.end(index) >= current) return ranges.end(index);
  }
  return ranges.length ? ranges.end(ranges.length - 1) : 0;
}

export type AudioStatus = "idle" | "requesting" | "loading" | "buffering" | "playing" | "paused" | "ended" | "blocked" | "error";

/** What a play button for one result should show while the global player works on (or ignores) it. */
export type TrackPhase = "inactive" | "pending" | "playing" | "paused";

export function trackPhase(state: { track: { key: string } | null; status: AudioStatus; wantsPlay: boolean }, key: string): TrackPhase {
  if (state.track?.key !== key) return "inactive";
  if (state.status === "playing") return "playing";
  if (state.status === "requesting" || state.status === "loading" || state.status === "buffering") return state.wantsPlay ? "pending" : "paused";
  return "paused";
}

/** The track `step` places away from `key` in the queue; null at either end or when `key` is not queued. */
export function queueStep<T extends { key: string }>(queue: readonly T[], key: string, step: -1 | 1): T | null {
  const index = queue.findIndex((item) => item.key === key);
  return index < 0 ? null : queue[index + step] ?? null;
}

/** Queue for a track that starts now: the list it was started from, else the current queue when it holds the track, else the track alone. */
export function queueFor<T extends { key: string }>(track: T, from: readonly T[] | undefined, current: readonly T[]): readonly T[] {
  if (from?.some((item) => item.key === track.key)) return from;
  if (current.some((item) => item.key === track.key)) return current;
  return [track];
}

/** "2 / 6" for a queued track; null when the queue holds only this track or not this track at all. */
export function queueLabel(queue: readonly { key: string }[], key: string) {
  const index = queue.findIndex((item) => item.key === key);
  return index < 0 || queue.length < 2 ? null : `${index + 1} / ${queue.length}`;
}
