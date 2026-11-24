import { useEffect, useRef, type CSSProperties } from "react";
import type { AudioAnalysis } from "../shared/audio-analysis";
import { cx } from "./ui";

export type WaveformView = "wave" | "spectrum";

/** Redraws when the canvas resizes or the theme changes; colours come from the canvas's own computed `color`. */
function useCanvas(draw: (canvas: HTMLCanvasElement, context: CanvasRenderingContext2D, width: number, height: number) => void, deps: unknown[]) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawRef = useRef(draw);
  drawRef.current = draw;
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const paint = () => {
      const rect = canvas.getBoundingClientRect();
      const ratio = Math.min(3, window.devicePixelRatio || 1);
      const width = Math.max(1, Math.round(rect.width * ratio)), height = Math.max(1, Math.round(rect.height * ratio));
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) return;
      context.clearRect(0, 0, width, height);
      drawRef.current(canvas, context, width, height);
    };
    paint();
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(paint);
    resize?.observe(canvas);
    const theme = new MutationObserver(paint);
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const scheme = window.matchMedia?.("(prefers-color-scheme: dark)");
    scheme?.addEventListener?.("change", paint);
    return () => { resize?.disconnect(); theme.disconnect(); scheme?.removeEventListener?.("change", paint); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return ref;
}

/** Bars from the per-bucket peaks, scaled to the track's own peak so a quiet take is still readable. */
function drawBars(canvas: HTMLCanvasElement, context: CanvasRenderingContext2D, width: number, height: number, analysis: AudioAnalysis) {
  const ratio = width / Math.max(1, canvas.getBoundingClientRect().width);
  const bar = Math.max(1, Math.round(2 * ratio)), gap = Math.max(1, Math.round(1 * ratio));
  const count = Math.max(1, Math.floor((width + gap) / (bar + gap)));
  const { peaks } = analysis;
  let top = 0;
  for (const value of peaks) top = Math.max(top, value);
  const scale = top > 0 ? 1 / top : 0;
  context.fillStyle = getComputedStyle(canvas).color;
  const middle = height / 2, floor = Math.max(1, ratio);
  for (let i = 0; i < count; i++) {
    const from = Math.floor((i / count) * peaks.length), to = Math.max(from + 1, Math.floor(((i + 1) / count) * peaks.length));
    let value = 0;
    for (let k = from; k < to; k++) value = Math.max(value, peaks[k]);
    const size = Math.max(floor, value * scale * (height - 2 * ratio));
    context.fillRect(i * (bar + gap), middle - size / 2, bar, size);
  }
}

function drawSpectrum(canvas: HTMLCanvasElement, context: CanvasRenderingContext2D, width: number, height: number, analysis: AudioAnalysis) {
  const { frames, bands, levels } = analysis.spectrum;
  if (!frames) return;
  const image = new ImageData(frames, bands);
  const probe = getComputedStyle(canvas).color.match(/[\d.]+/g)?.map(Number) || [0, 0, 0];
  for (let frame = 0; frame < frames; frame++) {
    for (let band = 0; band < bands; band++) {
      // Low bands at the bottom.
      const at = ((bands - 1 - band) * frames + frame) * 4;
      image.data[at] = probe[0]; image.data[at + 1] = probe[1]; image.data[at + 2] = probe[2];
      image.data[at + 3] = levels[frame * bands + band];
    }
  }
  const source = document.createElement("canvas");
  source.width = frames;
  source.height = bands;
  source.getContext("2d")?.putImageData(image, 0, 0);
  context.imageSmoothingEnabled = true;
  context.drawImage(source, 0, 0, width, height);
}

const spanStyle = (start: number, end: number, duration: number): CSSProperties => ({ left: `${(start / duration) * 100}%`, width: `max(2px, ${((end - start) / duration) * 100}%)` });

/**
 * A decoded track drawn once: the waveform (or spectrogram) in a base colour, the same drawing in the played colour
 * clipped by `--played` from the enclosing rail, and quiet and clipped stretches marked. Purely visual: the slider
 * semantics stay on the rail around it.
 */
export function AudioWaveform({ analysis, view = "wave", className, marks = true }: { analysis: AudioAnalysis; view?: WaveformView; className?: string; marks?: boolean }) {
  const draw = view === "wave" ? drawBars : drawSpectrum;
  const base = useCanvas((canvas, context, width, height) => draw(canvas, context, width, height, analysis), [analysis, view]);
  const played = useCanvas((canvas, context, width, height) => draw(canvas, context, width, height, analysis), [analysis, view]);
  const duration = analysis.duration || 1;
  return <span aria-hidden="true" className={cx("audio-wave", className)} data-wave-view={view}>
    {marks && analysis.silences.map((span) => <span key={`s${span.start}`} className="audio-wave-silence" style={spanStyle(span.start, span.end, duration)} />)}
    <canvas ref={base} className="audio-wave-base" />
    <canvas ref={played} className="audio-wave-played" />
    {marks && analysis.clips.map((span) => <span key={`c${span.start}`} className="audio-wave-clip" style={spanStyle(span.start, span.end, duration)} />)}
  </span>;
}
