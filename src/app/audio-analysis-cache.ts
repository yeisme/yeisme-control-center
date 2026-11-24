import { useSyncExternalStore } from "react";
import { analyzeChannels, type AudioAnalysis, type AnalyzeOptions } from "../shared/audio-analysis";

export type TrackAnalysis =
  | { state: "idle" | "analyzing" | "unsupported" | "failed" }
  | { state: "ready"; analysis: AudioAnalysis };

/**
 * The decoded channels of one file; the page uses an offline audio context, tests pass their own. `native` says the
 * samples are at the file's own rate; otherwise the decoder resampled them and the rate is not the file's.
 */
export type AudioDecoder = (bytes: ArrayBuffer) => Promise<{ channels: Float32Array[]; sampleRate: number; native?: boolean }>;

export const analysisCacheLimit = 24;
const idle: TrackAnalysis = { state: "idle" };

/** The sample rate a WAV file declares in its `fmt ` chunk, or null for anything else. */
export function wavSampleRate(bytes: ArrayBuffer): number | null {
  const view = new DataView(bytes);
  const tag = (at: number) => String.fromCharCode(view.getUint8(at), view.getUint8(at + 1), view.getUint8(at + 2), view.getUint8(at + 3));
  if (bytes.byteLength < 36 || tag(0) !== "RIFF" || tag(8) !== "WAVE") return null;
  for (let at = 12; at + 8 <= bytes.byteLength;) {
    const size = view.getUint32(at + 4, true);
    if (tag(at) === "fmt " && at + 16 <= bytes.byteLength) return view.getUint32(at + 12, true) || null;
    at += 8 + size + (size % 2);
  }
  return null;
}

/**
 * Decodes with an OfflineAudioContext: no realtime context, so playback never routes through Web Audio. A WAV decodes at
 * its own rate, so peaks and the rate shown are the file's; other formats are resampled to 44.1 kHz.
 */
export const offlineDecoder: AudioDecoder | null = typeof OfflineAudioContext === "undefined" ? null : async (bytes) => {
  const declared = wavSampleRate(bytes);
  const rate = declared && declared >= 3000 && declared <= 768000 ? declared : 44100;
  const buffer = await new OfflineAudioContext(1, 1, rate).decodeAudioData(bytes);
  return { channels: Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i)), sampleRate: buffer.sampleRate, native: rate === declared };
};

/**
 * Analyses of tracks the player already read into memory, in this tab only. Nothing is fetched for analysis, nothing
 * persists, and `clear()` (new scope, session or epoch) drops results and any analysis still running for the old one.
 */
export class AudioAnalysisCache {
  private entries = new Map<string, TrackAnalysis>();
  private running = new Map<string, AbortController>();
  private listeners = new Set<() => void>();
  private generation = 0;

  constructor(private decoder: AudioDecoder | null = offlineDecoder, private analyze: (channels: Float32Array[], rate: number, options: AnalyzeOptions) => Promise<AudioAnalysis> = analyzeChannels) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  get = (key: string): TrackAnalysis => this.entries.get(key) || idle;

  get size() { return this.entries.size; }

  private put(key: string, value: TrackAnalysis) {
    this.entries.delete(key);
    this.entries.set(key, value);
    while (this.entries.size > analysisCacheLimit) {
      const oldest = [...this.entries.keys()].find((candidate) => !this.running.has(candidate));
      if (!oldest) break;
      this.entries.delete(oldest);
    }
    for (const listener of this.listeners) listener();
  }

  /** Analyse bytes the player holds for `key`; a key that already has a result or is running is left alone. */
  async offer(key: string, blob: Blob): Promise<void> {
    const current = this.entries.get(key);
    if (current && current.state !== "idle") {
      this.put(key, current);
      return;
    }
    if (!this.decoder) {
      this.put(key, { state: "unsupported" });
      return;
    }
    const generation = this.generation;
    const controller = new AbortController();
    this.running.set(key, controller);
    this.put(key, { state: "analyzing" });
    try {
      const decoded = await this.decoder(await blob.arrayBuffer());
      if (controller.signal.aborted) return;
      const analysis = await this.analyze(decoded.channels, decoded.sampleRate, { signal: controller.signal });
      if (generation === this.generation && !controller.signal.aborted) this.put(key, { state: "ready", analysis: { ...analysis, resampled: !decoded.native } });
    } catch {
      if (generation === this.generation && !controller.signal.aborted) this.put(key, { state: "failed" });
    } finally {
      if (this.running.get(key) === controller) this.running.delete(key);
    }
  }

  clear() {
    this.generation++;
    for (const controller of this.running.values()) controller.abort();
    this.running.clear();
    if (!this.entries.size) return;
    this.entries.clear();
    for (const listener of this.listeners) listener();
  }
}

export const audioAnalysisCache = new AudioAnalysisCache();

/** The analysis for a track key, re-rendering only when that entry changes. */
export function useTrackAnalysis(key: string | null | undefined): TrackAnalysis {
  return useSyncExternalStore(audioAnalysisCache.subscribe, () => key ? audioAnalysisCache.get(key) : idle);
}
