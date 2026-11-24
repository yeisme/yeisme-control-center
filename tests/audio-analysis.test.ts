import { describe, expect, it } from "vitest";
import { analyzeChannels, bandEdges, dominantBand, fft, formatDbfs, levelsAt, waveformBuckets, type AudioAnalysis } from "../src/shared/audio-analysis";
import { AudioAnalysisCache, analysisCacheLimit, wavSampleRate, type AudioDecoder } from "../src/app/audio-analysis-cache";
import { markedWav } from "../scripts/fixtures/audio-world";
import { wav } from "../scripts/fixtures/world";

const rate = 16000;
const now = () => Promise.resolve();
const tone = (seconds: number, frequency: number, amplitude: number) => Float32Array.from({ length: Math.round(rate * seconds) }, (_, i) => amplitude * Math.sin((2 * Math.PI * frequency * i) / rate));
const join = (...parts: Float32Array[]) => {
  const out = new Float32Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) { out.set(part, at); at += part.length; }
  return out;
};

describe("audio analysis", () => {
  it("transforms a pure tone into its own bin", () => {
    const re = Float32Array.from({ length: 64 }, (_, i) => Math.cos((2 * Math.PI * 8 * i) / 64)), im = new Float32Array(64);
    fft(re, im);
    const magnitudes = Array.from(re, (value, i) => Math.hypot(value, im[i]));
    expect(magnitudes.indexOf(Math.max(...magnitudes.slice(0, 32)))).toBe(8);
  });

  it("measures a half-scale 440 Hz tone: peak, RMS, fixed buckets and the band that holds it", async () => {
    const analysis = await analyzeChannels([tone(2, 440, 0.5)], rate, { pause: now });
    expect(analysis.duration).toBeCloseTo(2, 5);
    expect(analysis.peaks).toHaveLength(waveformBuckets);
    expect(analysis.rms).toHaveLength(waveformBuckets);
    expect(Math.abs(analysis.peakDb - 20 * Math.log10(0.5))).toBeLessThan(0.5);
    expect(Math.abs(analysis.rmsDb - 20 * Math.log10(0.5 / Math.SQRT2))).toBeLessThan(0.5);
    const edges = analysis.spectrum.edges;
    const band = dominantBand(analysis);
    expect(edges[band]).toBeLessThanOrEqual(440);
    expect(edges[band + 1]).toBeGreaterThan(440);
    expect(analysis.silences).toEqual([]);
    expect(analysis.clips).toEqual([]);
    expect(formatDbfs(analysis.peakDb)).toBe("-6.0 dBFS");
  });

  it("finds a quiet second and a clipped stretch, and mixes channels down", async () => {
    const clipped = Float32Array.from(tone(0.5, 220, 1.6), (value) => Math.max(-1, Math.min(1, value)));
    const left = join(tone(1, 330, 0.3), new Float32Array(rate), clipped, tone(0.5, 330, 0.3));
    const analysis = await analyzeChannels([left, left], rate, { pause: now });
    expect(analysis.channels).toBe(2);
    expect(analysis.silences).toHaveLength(1);
    expect(analysis.silences[0].start).toBeGreaterThan(0.95);
    expect(analysis.silences[0].end).toBeLessThan(2.05);
    expect(analysis.silences[0].end - analysis.silences[0].start).toBeGreaterThan(0.9);
    // Many short runs at full scale inside half a second merge into one stretch.
    expect(analysis.clips).toHaveLength(1);
    expect(analysis.clips[0].start).toBeGreaterThanOrEqual(2);
    expect(analysis.clips[0].end).toBeLessThanOrEqual(2.5);
    expect(analysis.peakDb).toBeCloseTo(0, 1);
  });

  it("reads levels at the playhead and nothing outside the track", async () => {
    const analysis = await analyzeChannels([join(new Float32Array(rate), tone(1, 2000, 0.8))], rate, { pause: now });
    const quiet = levelsAt(analysis, 0.3);
    const loud = levelsAt(analysis, 1.5);
    expect(quiet).toHaveLength(4);
    expect(Math.max(...quiet)).toBe(0);
    expect(Math.max(...loud)).toBeGreaterThan(0.8);
    expect(levelsAt(analysis, 9)).toEqual([0, 0, 0, 0]);
    expect(levelsAt(analysis, Number.NaN, 3)).toEqual([0, 0, 0]);
  });

  it("keeps band edges inside the analysed range", () => {
    const edges = bandEdges(11025);
    expect(edges).toHaveLength(25);
    expect(edges[0]).toBe(60);
    expect(edges[24]).toBeCloseTo(5512.5, 5);
  });

  it("finds the quiet and clipped stretches in the fixture track, which keeps the plain track's length", async () => {
    const bytes = markedWav(2, 330);
    expect(bytes.length).toBe(wav(2, 330).length);
    const samples = Float32Array.from({ length: (bytes.length - 44) / 2 }, (_, i) => bytes.readInt16LE(44 + i * 2) / 32768);
    const analysis = await analyzeChannels([samples], 16000, { pause: now });
    expect(analysis.silences).toHaveLength(1);
    expect(analysis.silences[0].start).toBeCloseTo(0.6, 1);
    expect(analysis.clips).toHaveLength(1);
    expect(analysis.clips[0].start).toBeGreaterThanOrEqual(1.19);
    expect(analysis.clips[0].end).toBeLessThanOrEqual(1.51);
  });

  it("reads the rate a WAV declares, and none from anything else", () => {
    const bytes = markedWav(1, 330);
    expect(wavSampleRate(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length) as ArrayBuffer)).toBe(16000);
    expect(wavSampleRate(new Uint8Array(64).buffer)).toBeNull();
    expect(wavSampleRate(new TextEncoder().encode("RIFF").buffer as ArrayBuffer)).toBeNull();
  });

  it("stops when cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(analyzeChannels([tone(1, 440, 0.5)], rate, { signal: controller.signal, pause: now })).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("audio analysis cache", () => {
  const decoder: AudioDecoder = async () => ({ channels: [tone(0.5, 440, 0.5)], sampleRate: rate });
  const blob = () => new Blob([new Uint8Array(8)]);

  it("analyses once per key and hands back the result", async () => {
    let decodes = 0;
    const cache = new AudioAnalysisCache(async (bytes) => { decodes++; return decoder(bytes); });
    const seen: string[] = [];
    cache.subscribe(() => seen.push(cache.get("a").state));
    await cache.offer("a", blob());
    await cache.offer("a", blob());
    expect(decodes).toBe(1);
    expect(cache.get("a").state).toBe("ready");
    expect(seen[0]).toBe("analyzing");
    // The test decoder does not say it kept the file's rate, so the rate is not presented as the file's.
    const ready = cache.get("a");
    expect(ready.state === "ready" && ready.analysis.resampled).toBe(true);
    expect(cache.get("other")).toBe(cache.get("missing"));
  });

  it("says unsupported without a decoder and failed when decoding throws", async () => {
    const none = new AudioAnalysisCache(null);
    await none.offer("a", blob());
    expect(none.get("a").state).toBe("unsupported");
    const broken = new AudioAnalysisCache(async () => { throw new Error("bad file"); });
    await broken.offer("a", blob());
    expect(broken.get("a").state).toBe("failed");
  });

  it("drops results and running work on clear, so an old scope's analysis never lands", async () => {
    let release: () => void = () => {};
    let started: () => void = () => {};
    const decoding = new Promise<void>((resolve) => { started = resolve; });
    const slow: AudioDecoder = (bytes) => new Promise((resolve) => { release = () => resolve(decoder(bytes)); started(); });
    const cache = new AudioAnalysisCache(slow);
    const pending = cache.offer("a", blob());
    await decoding;
    cache.clear();
    release();
    await pending;
    expect(cache.get("a").state).toBe("idle");
    expect(cache.size).toBe(0);
  });

  it("keeps at most the limit, evicting the least recently used", async () => {
    const analysis = { duration: 1 } as AudioAnalysis;
    const cache = new AudioAnalysisCache(decoder, async () => analysis);
    for (let i = 0; i <= analysisCacheLimit; i++) await cache.offer(`k${i}`, blob());
    expect(cache.size).toBe(analysisCacheLimit);
    expect(cache.get("k0").state).toBe("idle");
    expect(cache.get(`k${analysisCacheLimit}`).state).toBe("ready");
  });
});
