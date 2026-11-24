/**
 * What the player draws for a track it has read into memory: peaks, levels, quiet and clipped stretches and a coarse
 * spectrogram, all computed from the decoded samples in the page. Only numbers are kept; the samples are dropped.
 * Levels are sample peak and RMS in dBFS, not loudness (LUFS).
 */

export const waveformBuckets = 1024;
export const spectrumBands = 24;
/** Below this level for at least `silenceMinSeconds` counts as a quiet stretch. */
export const silenceThresholdDb = -50;
export const silenceMinSeconds = 0.4;
/** A run of samples at full scale, at least this long, counts as clipping. */
export const clipLevel = 0.999;
const clipMinSamples = 3;
const fftSize = 1024;
const spectrumRate = 11025;
const maxFrames = 2048;
const floorDb = -120;
/** The spectrogram maps this range onto 0..255. */
const spectrumRangeDb: [number, number] = [-80, 0];

export interface AudioSpan { start: number; end: number }

export interface AudioAnalysis {
  duration: number;
  sampleRate: number;
  channels: number;
  /** Per bucket, the largest absolute sample (0..1). */
  peaks: Float32Array;
  /** Per bucket, the RMS level (0..1). */
  rms: Float32Array;
  silences: AudioSpan[];
  clips: AudioSpan[];
  peakDb: number;
  rmsDb: number;
  spectrum: { frameSeconds: number; frames: number; bands: number; levels: Uint8Array; edges: number[] };
  /** Set by the page when the decoder resampled the file: `sampleRate` is then the analysis rate, not the file's. */
  resampled?: boolean;
}

export interface AnalyzeOptions {
  signal?: AbortSignal;
  /** Called between slices of work so a long file never blocks the page; resolves when work may continue. */
  pause?: () => Promise<void>;
}

const toDb = (value: number) => value > 0 ? Math.max(floorDb, 20 * Math.log10(value)) : floorDb;
const defaultPause = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function aborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException("audio analysis cancelled", "AbortError");
}

/** In-place radix-2 FFT; `re` and `im` have a power-of-two length. */
export function fft(re: Float32Array, im: Float32Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const step = (-2 * Math.PI) / size;
    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < size / 2; k++) {
        const cos = Math.cos(step * k), sin = Math.sin(step * k);
        const a = start + k, b = a + size / 2;
        const tr = re[b] * cos - im[b] * sin, ti = re[b] * sin + im[b] * cos;
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
      }
    }
  }
}

/** Log-spaced band edges in Hz from 60 Hz up to the Nyquist frequency of the analysed rate. */
export function bandEdges(rate: number, bands = spectrumBands) {
  const low = 60, high = rate / 2;
  return Array.from({ length: bands + 1 }, (_, i) => low * Math.pow(high / low, i / bands));
}

function spans(flags: (index: number) => boolean, count: number, seconds: number, minCount: number, mergeGap = 0): AudioSpan[] {
  const found: AudioSpan[] = [];
  let start = -1;
  for (let i = 0; i <= count; i++) {
    const on = i < count && flags(i);
    if (on && start < 0) start = i;
    if (!on && start >= 0) {
      if (i - start >= minCount) {
        const span = { start: start * seconds, end: i * seconds };
        const last = found[found.length - 1];
        if (last && span.start - last.end <= mergeGap) last.end = span.end;
        else found.push(span);
      }
      start = -1;
    }
  }
  return found;
}

export async function analyzeChannels(channels: Float32Array[], sampleRate: number, options: AnalyzeOptions = {}): Promise<AudioAnalysis> {
  const { signal, pause = defaultPause } = options;
  aborted(signal);
  const length = channels[0]?.length || 0;
  const mono = new Float32Array(length);
  for (const channel of channels) for (let i = 0; i < length; i++) mono[i] += channel[i] / channels.length;
  const duration = sampleRate > 0 ? length / sampleRate : 0;

  // Peaks and RMS per bucket, overall levels and clipped runs in one pass.
  const peaks = new Float32Array(waveformBuckets);
  const rms = new Float32Array(waveformBuckets);
  const perBucket = length / waveformBuckets;
  let peak = 0, energy = 0;
  const clips: AudioSpan[] = [];
  let clipStart = -1;
  const slice = 1 << 18;
  let sinceRest = 0;
  for (let bucket = 0; bucket < waveformBuckets; bucket++) {
    const from = Math.floor(bucket * perBucket), to = Math.max(from, Math.floor((bucket + 1) * perBucket));
    let top = 0, sum = 0;
    for (let i = from; i < to; i++) {
      const value = mono[i], size = Math.abs(value);
      if (size > top) top = size;
      sum += value * value;
      if (size >= clipLevel) { if (clipStart < 0) clipStart = i; }
      else if (clipStart >= 0) {
        if (i - clipStart >= clipMinSamples) clips.push({ start: clipStart / sampleRate, end: i / sampleRate });
        clipStart = -1;
      }
    }
    peaks[bucket] = top;
    rms[bucket] = to > from ? Math.sqrt(sum / (to - from)) : 0;
    if (top > peak) peak = top;
    energy += sum;
    sinceRest += to - from;
    if (sinceRest >= slice) { sinceRest = 0; await pause(); aborted(signal); }
  }
  if (clipStart >= 0 && length - clipStart >= clipMinSamples) clips.push({ start: clipStart / sampleRate, end: length / sampleRate });
  const mergedClips = clips.reduce<AudioSpan[]>((all, span) => {
    const last = all[all.length - 1];
    if (last && span.start - last.end <= 0.05) last.end = span.end;
    else all.push({ ...span });
    return all;
  }, []);

  // Quiet stretches over 10 ms windows.
  const window = Math.max(1, Math.round(sampleRate * 0.01));
  const windows = Math.floor(length / window);
  const quiet = Math.pow(10, silenceThresholdDb / 20);
  const windowRms = new Float32Array(windows);
  for (let w = 0; w < windows; w++) {
    let sum = 0;
    for (let i = w * window; i < (w + 1) * window; i++) sum += mono[i] * mono[i];
    windowRms[w] = Math.sqrt(sum / window);
  }
  const silences = spans((w) => windowRms[w] < quiet, windows, window / sampleRate, Math.ceil(silenceMinSeconds * sampleRate / window));
  await pause();
  aborted(signal);

  // Coarse spectrogram: decimate to about 11 kHz, Hann-windowed FFT frames, log-spaced bands.
  const factor = Math.max(1, Math.floor(sampleRate / spectrumRate));
  const rate = sampleRate / factor;
  const reduced = new Float32Array(Math.floor(length / factor));
  for (let i = 0; i < reduced.length; i++) {
    let sum = 0;
    for (let k = 0; k < factor; k++) sum += mono[i * factor + k];
    reduced[i] = sum / factor;
  }
  const edges = bandEdges(rate);
  const hop = Math.max(256, Math.ceil(Math.max(0, reduced.length - fftSize) / (maxFrames - 1)));
  const frames = reduced.length >= fftSize ? Math.floor((reduced.length - fftSize) / hop) + 1 : reduced.length ? 1 : 0;
  const levels = new Uint8Array(frames * spectrumBands);
  const hann = Float32Array.from({ length: fftSize }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (fftSize - 1)));
  const re = new Float32Array(fftSize), im = new Float32Array(fftSize);
  const binHz = rate / fftSize;
  // A full-scale sine lands near 0 dB: amplitude spectrum scaled by the window's coherent gain (N/4 for Hann).
  const scale = 4 / fftSize;
  const [lowDb, highDb] = spectrumRangeDb;
  for (let frame = 0; frame < frames; frame++) {
    const offset = frame * hop;
    for (let i = 0; i < fftSize; i++) { re[i] = (reduced[offset + i] || 0) * hann[i]; im[i] = 0; }
    fft(re, im);
    for (let band = 0; band < spectrumBands; band++) {
      const from = Math.max(1, Math.floor(edges[band] / binHz)), to = Math.min(fftSize / 2, Math.max(from + 1, Math.ceil(edges[band + 1] / binHz)));
      let top = 0;
      for (let bin = from; bin < to; bin++) {
        const magnitude = Math.hypot(re[bin], im[bin]) * scale;
        if (magnitude > top) top = magnitude;
      }
      const db = toDb(top);
      levels[frame * spectrumBands + band] = Math.round(255 * Math.min(1, Math.max(0, (db - lowDb) / (highDb - lowDb))));
    }
    if (frame % 128 === 127) { await pause(); aborted(signal); }
  }

  return {
    duration,
    sampleRate,
    channels: channels.length,
    peaks,
    rms,
    silences,
    clips: mergedClips,
    peakDb: toDb(peak),
    rmsDb: length ? Math.max(floorDb, 10 * Math.log10(energy / length || 0)) : floorDb,
    spectrum: { frameSeconds: hop / rate, frames, bands: spectrumBands, levels, edges },
  };
}

/** Levels 0..1 for `bars` groups of bands at a playback position; all zero outside the track. */
export function levelsAt(analysis: AudioAnalysis, seconds: number, bars = 4): number[] {
  const { frames, bands, levels, frameSeconds } = analysis.spectrum;
  const frame = Math.floor(seconds / frameSeconds);
  if (!frames || frame < 0 || frame >= frames || !Number.isFinite(seconds)) return Array(bars).fill(0);
  const per = bands / bars;
  return Array.from({ length: bars }, (_, bar) => {
    let top = 0;
    for (let band = Math.floor(bar * per); band < Math.floor((bar + 1) * per); band++) top = Math.max(top, levels[frame * bands + band]);
    return top / 255;
  });
}

/** The band index holding the most energy over the whole track; used to check analysis against a known tone. */
export function dominantBand(analysis: AudioAnalysis) {
  const { frames, bands, levels } = analysis.spectrum;
  const totals = new Array(bands).fill(0);
  for (let frame = 0; frame < frames; frame++) for (let band = 0; band < bands; band++) totals[band] += levels[frame * bands + band];
  return totals.indexOf(Math.max(...totals));
}

/** `-12.3 dBFS`, or 「静音」 at the floor. */
export function formatDbfs(value: number) {
  return value <= floorDb ? "静音" : `${value.toFixed(1)} dBFS`;
}
