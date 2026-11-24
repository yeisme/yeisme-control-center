import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Check, Download, ExternalLink, LoaderCircle, MoreHorizontal, Pause, Play, RotateCcw, RotateCw, SkipBack, SkipForward, Volume2, VolumeX, X } from "../icons";
import { useAudioClock, useAudioPlayer, useAudioQueue, useAudioState, useTrackPhase, type AudioPlayerState, type AudioTrack } from "../app/audio-player";
import { clampFraction, formatPlaybackTime, playbackFraction, playbackRates, queueLabel, queueStep, rateLabel, seekForKey, spokenPlaybackTime } from "../shared/audio-playback";
import { Button, MenuCheckboxItem, MenuContent, MenuItem, MenuLabel, MenuRoot, MenuSeparator, MenuTrigger, cx, ownerLabel } from "./ui";
import { grantErrorLabel } from "./media-preview";
import { useTrackAnalysis, type TrackAnalysis } from "../app/audio-analysis-cache";
import { formatDbfs, levelsAt } from "../shared/audio-analysis";
import { prefersReducedMotion } from "../shared/motion/reduced";
import { AudioWaveform, type WaveformView } from "./AudioWaveform";

/**
 * Four bars that rest at fixed heights. While sound plays they follow the decoded track's own band levels at the
 * playhead when the player has analysed it, and fall back to a generic bounce otherwise. Still under reduced motion.
 */
export function Equalizer({ className, trackKey }: { className?: string; trackKey?: string }) {
  const player = useAudioPlayer();
  const current = useAudioState((state) => state.track?.key === trackKey && state.status === "playing");
  const analysis = useTrackAnalysis(trackKey && current ? trackKey : null);
  const ref = useRef<HTMLSpanElement>(null);
  const live = analysis.state === "ready" && !prefersReducedMotion();
  useEffect(() => {
    if (!live || analysis.state !== "ready") return;
    const bars = ref.current ? Array.from(ref.current.children) as HTMLElement[] : [];
    let frame = 0;
    const tick = () => {
      levelsAt(analysis.analysis, player.currentTime(), bars.length).forEach((level, index) => bars[index]?.style.setProperty("--level", String(0.18 + 0.82 * level)));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(frame); for (const bar of bars) bar.style.removeProperty("--level"); };
  }, [analysis, live, player]);
  return <span ref={ref} aria-hidden="true" className={cx("audio-eq", className)} data-eq-live={live || undefined}><i /><i /><i /><i /></span>;
}

/** Why a track has no waveform, for the stage; null when it has one or there is nothing to say. */
function waveformNote(analysis: TrackAnalysis, transport: string | null) {
  if (analysis.state === "ready") return null;
  if (transport === "stream") return "文件较大，边下边播，没有生成波形。";
  if (analysis.state === "analyzing") return "正在生成波形…";
  if (analysis.state === "unsupported") return "这个浏览器不能解码音频，没有生成波形。";
  if (analysis.state === "failed") return "这段音频没能解码，没有生成波形；播放不受影响。";
  return null;
}

function statusLine(state: AudioPlayerState) {
  const track = state.track;
  if (!track) return "";
  if (state.status === "error" || state.status === "blocked") return grantErrorLabel(state.error || "media_unavailable");
  if (state.notice === "autoplay_blocked") return "浏览器拦截了自动播放，点一下播放继续";
  if (state.status === "requesting") return "正在申请播放句柄…";
  if (state.status === "loading") return state.loadProgress === null ? "正在载入音频…" : `正在载入 ${Math.round(state.loadProgress * 100)}%`;
  if (state.status === "buffering" && state.wantsPlay) return "正在缓冲…";
  if (state.status === "ended") return `播放完毕 · ${track.context}`;
  return `${ownerLabel(track.owner)} · ${track.context}`;
}

/** Seekable progress shared by the dock and the detail stage; pointer drag, hover time and a full slider keyboard contract. */
export function AudioScrubber({ className, label = "播放进度", size = "dock", view = "wave" }: { className?: string; label?: string; size?: "dock" | "stage"; view?: WaveformView }) {
  const player = useAudioPlayer();
  const clock = useAudioClock();
  const trackKey = useAudioState((state) => state.track?.key || null);
  const status = useAudioState((state) => state.status);
  const loadProgress = useAudioState((state) => state.loadProgress);
  const transport = useAudioState((state) => state.transport);
  const analysis = useTrackAnalysis(trackKey);
  const wave = analysis.state === "ready" && transport === "blob" ? analysis.analysis : null;
  const waveState = transport === "stream" ? "too_large" : analysis.state;
  const rail = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const [drag, setDrag] = useState<number | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const duration = clock.duration;
  const known = Number.isFinite(duration) && duration > 0;
  const shown = drag ?? clock.current;
  const played = playbackFraction(shown, duration);
  const buffered = status === "loading" ? clampFraction(loadProgress ?? 0) : transport === "blob" ? 1 : playbackFraction(clock.buffered, duration);
  const pending = status === "requesting" || (status === "loading" && loadProgress === null);

  // Between timeupdate events the playhead follows the media clock directly, without React renders.
  useEffect(() => {
    if (status !== "playing" || !known) return;
    let frame = 0;
    const tick = () => {
      if (!dragging.current) rail.current?.style.setProperty("--played", String(playbackFraction(player.currentTime(), duration)));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [duration, known, player, status]);

  const fractionAt = (clientX: number) => {
    const rect = rail.current?.getBoundingClientRect();
    return rect && rect.width ? clampFraction((clientX - rect.left) / rect.width) : 0;
  };
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!known || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragging.current = true;
    setDrag(fractionAt(event.clientX) * duration);
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!known) return;
    const fraction = fractionAt(event.clientX);
    if (event.pointerType === "mouse") setHover(fraction);
    if (dragging.current) setDrag(fraction * duration);
  };
  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    dragging.current = false;
    setDrag(null);
    player.seek(fractionAt(event.clientX) * duration);
  };
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      player.toggle();
      return;
    }
    const next = seekForKey(event.key, clock.current, duration, event.shiftKey);
    if (next === null) return;
    event.preventDefault();
    player.seek(next);
  };

  return <div className={cx("audio-scrubber", className)} data-pending={pending || undefined} data-waveform={waveState} data-scrubber-size={size}>
    <span className="audio-time" aria-hidden="true">{formatPlaybackTime(shown)}</span>
    <div
      ref={rail}
      role="slider"
      tabIndex={known ? 0 : -1}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={known ? Math.round(duration) : 0}
      aria-valuenow={Math.round(shown)}
      aria-valuetext={`${spokenPlaybackTime(shown)}，共 ${spokenPlaybackTime(duration)}`}
      aria-disabled={known ? undefined : true}
      data-dragging={drag !== null || undefined}
      className={cx("audio-rail", wave && "audio-rail-wave")}
      style={{ "--played": played, "--buffered": buffered } as CSSProperties}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => { dragging.current = false; setDrag(null); }}
      onPointerLeave={() => setHover(null)}
      onKeyDown={onKeyDown}
    >
      {wave ? <AudioWaveform analysis={wave} view={view} /> : <span className="audio-rail-track"><span className="audio-rail-buffer" /><span className="audio-rail-fill" /></span>}
      <span className="audio-rail-head"><span className="audio-rail-thumb" /></span>
      {hover !== null && known && <span className="audio-rail-tip" style={{ left: `${hover * 100}%` }}>{formatPlaybackTime(hover * duration)}</span>}
    </div>
    <span className="audio-time audio-time-end" aria-hidden="true">{formatPlaybackTime(duration)}</span>
  </div>;
}

const phaseCopy = { inactive: "播放", pending: "载入中", playing: "暂停", paused: "继续" } as const;

/** Play control for one result row or card: starts the global player and mirrors its state for that result only. */
export function AudioPlayButton({ track, variant = "ghost", size = "sm", iconOnly = false, stop = false, className }: { track: AudioTrack; variant?: "primary" | "secondary" | "ghost"; size?: "sm" | "md"; iconOnly?: boolean; stop?: boolean; className?: string }) {
  const player = useAudioPlayer();
  const queue = useAudioQueue();
  const phase = useTrackPhase(track.key);
  const label = phaseCopy[phase];
  const icon = phase === "pending" ? <LoaderCircle className="size-3.5 motion-safe:animate-spin" /> : phase === "playing" ? <Pause className="size-3.5" /> : <Play className="size-3.5" />;
  return <Button
    size={iconOnly ? "icon-sm" : size}
    variant={phase === "inactive" ? variant : variant === "ghost" ? "secondary" : variant}
    aria-label={`${label} ${track.title}`}
    title={track.blocked ? grantErrorLabel(track.blocked) : undefined}
    disabled={!!track.blocked}
    data-audio-phase={phase}
    className={className}
    icon={icon}
    onClick={(event) => {
      if (stop) event.stopPropagation();
      player.play(track, queue);
    }}
  >{iconOnly ? null : label}</Button>;
}

function DockButton({ label, onClick, children, className, disabled }: { label: string; onClick: () => void; children: ReactNode; className?: string; disabled?: boolean }) {
  return <button type="button" aria-label={label} title={label} disabled={disabled} onClick={onClick} className={cx("audio-dock-button", className)}>{children}</button>;
}

const announcements: Partial<Record<AudioPlayerState["status"], string>> = { playing: "正在播放", paused: "已暂停", ended: "播放完毕", error: "播放失败", blocked: "无法播放" };

/** Floating mini player: rises from the bottom when a result starts playing and stays across pages until closed. */
export function AudioDock() {
  const player = useAudioPlayer();
  const state = useAudioState((value) => value);
  const navigate = useNavigate();
  const [shown, setShown] = useState<AudioTrack | null>(state.track);
  const [leaving, setLeaving] = useState(false);
  const open = !!state.track;

  useEffect(() => {
    if (state.track) {
      setShown(state.track);
      setLeaving(false);
      return;
    }
    setLeaving(true);
    const timer = window.setTimeout(() => { setShown(null); setLeaving(false); }, 200);
    return () => window.clearTimeout(timer);
  }, [state.track]);

  useEffect(() => {
    const root = document.documentElement;
    if (open) root.dataset.audioDockOpen = "true";
    else delete root.dataset.audioDockOpen;
    return () => { delete root.dataset.audioDockOpen; };
  }, [open]);

  if (!shown) return null;
  const track = state.track || shown;
  const busy = state.wantsPlay && (state.status === "requesting" || state.status === "loading" || state.status === "buffering");
  const failed = state.status === "error" || state.status === "blocked";
  const sounding = state.status === "playing";
  const primaryLabel = failed ? "重新播放" : state.wantsPlay ? "暂停" : state.status === "ended" ? "重新播放" : "播放";
  const position = queueLabel(state.queue, track.key);
  const [index, total] = position ? position.split(" / ") : [];
  const primaryIcon = busy ? <LoaderCircle className="size-[18px] motion-safe:animate-spin" /> : failed ? <RotateCcw className="size-[18px]" /> : state.wantsPlay ? <Pause className="size-[18px]" fill="currentColor" /> : <Play className="ml-0.5 size-[18px]" fill="currentColor" />;

  return <div className="audio-dock-layer" data-audio-dock={state.status} data-leaving={leaving || undefined}>
    <section role="region" aria-label="音频播放器" className="audio-dock" onKeyDown={(event) => { if (event.key === "Escape" && event.currentTarget.contains(event.target as Node)) player.close(); }}>
      <div className="flex min-w-0 items-center gap-3">
        <span className={cx("audio-dock-cover", sounding && "is-playing")}><Equalizer trackKey={track.key} /></span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-body-sm font-semibold text-ink" title={track.title}>{track.title}</p>
          <p className={cx("truncate text-2xs", failed ? "text-warning" : "text-muted")} data-audio-status-line>
            {position && <><span className="sr-only">第 {index} 条，共 {total} 条</span><span aria-hidden="true" className="tabular" data-audio-position>{position}</span><span aria-hidden="true">{state.autoNext ? " · 连播 · " : " · "}</span></>}
            {statusLine(state)}
          </p>
          <span className="sr-only" aria-live="polite">{announcements[state.status] ? `${announcements[state.status]}：${track.title}` : ""}</span>
        </div>
        <div className="flex shrink-0 items-center gap-0.5 sm:gap-1">
          {position && <DockButton label="上一条" disabled={!queueStep(state.queue, track.key, -1)} onClick={player.previous}><SkipBack className="size-4" /></DockButton>}
          <DockButton label="后退 10 秒" className="max-sm:hidden" disabled={failed} onClick={() => player.skip(-10)}><RotateCcw className="size-4" /></DockButton>
          <button type="button" aria-label={primaryLabel} title={primaryLabel} disabled={state.status === "blocked"} onClick={player.toggle} className="audio-dock-primary" data-audio-primary data-attention={busy || state.notice === "autoplay_blocked" || undefined}>{primaryIcon}</button>
          <DockButton label="前进 10 秒" className="max-sm:hidden" disabled={failed} onClick={() => player.skip(10)}><RotateCw className="size-4" /></DockButton>
          {position && <DockButton label="下一条" disabled={!queueStep(state.queue, track.key, 1)} onClick={player.next}><SkipForward className="size-4" /></DockButton>}
          <button type="button" aria-label={`播放速度 ${rateLabel(state.rate)}，点击切换`} title="播放速度" onClick={player.cycleRate} className="audio-dock-rate max-md:hidden">{rateLabel(state.rate)}</button>
          <DockButton label={state.muted ? "取消静音" : "静音"} className="max-sm:hidden" onClick={player.toggleMute}>{state.muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}</DockButton>
          <MenuRoot>
            <MenuTrigger asChild><button type="button" aria-label="更多播放选项" title="更多" className="audio-dock-button"><MoreHorizontal className="size-4" /></button></MenuTrigger>
            <MenuContent align="end" className="w-52">
              <MenuLabel>播放速度</MenuLabel>
              {playbackRates.map((rate) => <MenuItem key={rate} onSelect={() => player.setRate(rate)} icon={rate === state.rate ? <Check /> : <span aria-hidden="true" className="size-4 shrink-0" />}>{rateLabel(rate)}</MenuItem>)}
              <MenuSeparator />
              {position && <MenuCheckboxItem checked={state.autoNext} onCheckedChange={player.toggleAutoNext}>播完自动播放下一条</MenuCheckboxItem>}
              <MenuItem icon={state.muted ? <Volume2 /> : <VolumeX />} onSelect={player.toggleMute}>{state.muted ? "取消静音" : "静音"}</MenuItem>
              <MenuItem icon={<Download />} disabled={!track.canDownload} onSelect={player.download}>{track.canDownload ? "下载音频" : "来源未开放下载"}</MenuItem>
              {track.detailsHref && <MenuItem icon={<ExternalLink />} onSelect={() => navigate(track.detailsHref!)}>查看结果详情</MenuItem>}
            </MenuContent>
          </MenuRoot>
          <DockButton label="关闭播放器" onClick={player.close}><X className="size-4" /></DockButton>
        </div>
      </div>
      <AudioScrubber className="mt-2" />
    </section>
  </div>;
}

/** A quiet or clipped stretch: seeks the loaded track; before it plays it is listed, not clickable. */
function Mark({ active, onSeek, kind, at, label, children }: { active: boolean; onSeek: (seconds: number) => void; kind: string; at: number; label: string; children: ReactNode }) {
  return active
    ? <button type="button" className="audio-mark" data-mark={kind} onClick={() => onSeek(at)} aria-label={label}>{children}</button>
    : <span className="audio-mark" data-mark={kind}>{children}</span>;
}

/** Where a mark sits: tenths of a second on a short take, where whole seconds would put every mark at 0:00 or 0:01. */
function markTime(seconds: number, duration: number) {
  return duration < 60 ? `${seconds.toFixed(1)} 秒` : formatPlaybackTime(seconds);
}

function spokenMarkTime(seconds: number, duration: number) {
  return duration < 60 ? `${seconds.toFixed(1)} 秒` : spokenPlaybackTime(seconds);
}

/** Inspector stage for an audio result: one play button and, once loaded, the same seek rail as the dock. */
export function AudioStage({ track, className }: { track: AudioTrack; className?: string }) {
  const player = useAudioPlayer();
  const phase = useTrackPhase(track.key);
  const state = useAudioState((value) => value.track?.key === track.key ? value : null);
  const analysis = useTrackAnalysis(track.key);
  const [view, setView] = useState<WaveformView>("wave");
  const active = phase !== "inactive";
  const line = state ? statusLine(state) : track.blocked ? grantErrorLabel(track.blocked) : "点播放后在页面底部的播放器里继续，切换页面不会中断。";
  const note = active ? waveformNote(analysis, state?.transport ?? null) : null;
  const ready = analysis.state === "ready" ? analysis.analysis : null;
  return <div className={cx("audio-stage", className)} data-audio-stage={phase}>
    <div className="flex items-center gap-3">
      <span className={cx("audio-stage-cover", phase === "playing" && "is-playing")}><Equalizer trackKey={track.key} /></span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-body-sm font-semibold text-ink">{track.title}</p>
        <p className={cx("mt-0.5 line-clamp-2 text-2xs", state?.status === "error" || state?.status === "blocked" || track.blocked ? "text-warning" : "text-muted")}>{line}</p>
      </div>
      <AudioPlayButton track={track} variant="primary" size="md" />
    </div>
    {active && <AudioScrubber className="mt-3" size="stage" view={view} label={`${track.title} 播放进度`} />}
    {!active && ready && <AudioWaveform analysis={ready} className="audio-wave-preview mt-3" />}
    {note && <p className="mt-2 text-2xs text-muted" data-waveform-note>{note}</p>}
    {ready && <div className="mt-3 space-y-2" data-audio-facts>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-muted">
        <span className="tabular">{formatPlaybackTime(ready.duration)}</span>
        <span>峰值 <span className="tabular text-ink-soft">{formatDbfs(ready.peakDb)}</span></span>
        <span>平均电平（RMS）<span className="tabular text-ink-soft">{formatDbfs(ready.rmsDb)}</span></span>
        <span>{ready.channels === 1 ? "单声道" : `${ready.channels} 声道`}{!ready.resampled && ` · ${(ready.sampleRate / 1000).toFixed(ready.sampleRate % 1000 ? 1 : 0)} kHz`}</span>
        {active && <span role="group" aria-label="显示方式" className="audio-view-toggle ml-auto">
          <button type="button" aria-pressed={view === "wave"} onClick={() => setView("wave")}>波形</button>
          <button type="button" aria-pressed={view === "spectrum"} onClick={() => setView("spectrum")}>频谱</button>
        </span>}
      </div>
      {(ready.silences.length > 0 || ready.clips.length > 0) && <div className="flex flex-wrap gap-1.5" data-audio-marks>
        {ready.silences.slice(0, 6).map((span) => <Mark active={active} onSeek={player.seek} key={`s${span.start}`} kind="silence" at={span.start} label={`跳到静音段 ${spokenMarkTime(span.start, ready.duration)}`}>静音 {ready.duration < 60 ? `${span.start.toFixed(1)}–${markTime(span.end, ready.duration)}` : `${markTime(span.start, ready.duration)}–${markTime(span.end, ready.duration)}`}</Mark>)}
        {ready.clips.slice(0, 6).map((span) => <Mark active={active} onSeek={player.seek} key={`c${span.start}`} kind="clip" at={Math.max(0, span.start - 0.5)} label={`跳到削波处 ${spokenMarkTime(span.start, ready.duration)}`}>削波 {markTime(span.start, ready.duration)}</Mark>)}
        {ready.silences.length + ready.clips.length > 12 && <span className="text-2xs text-muted">另有 {ready.silences.length + ready.clips.length - 12} 处</span>}
      </div>}
      <p className="text-2xs text-muted">波形和电平在这个页面里根据已读到的音频算出，不是响度（LUFS）；离开这个工作区就清掉。</p>
    </div>}
  </div>;
}

/**
 * A small picture of one track for lists and cards: its waveform once the player has analysed it in this tab, otherwise
 * a plain rail with the owner's duration and a hint that the waveform appears after playing. Never a made-up shape.
 */
export function AudioMiniWave({ trackKey, durationMs, className, bare = false }: { trackKey: string; durationMs?: number | null; className?: string; bare?: boolean }) {
  const analysis = useTrackAnalysis(trackKey);
  if (analysis.state === "ready") return <span className={cx("audio-wave-mini", className)} data-waveform="ready"><AudioWaveform analysis={analysis.analysis} marks={false} /></span>;
  return <span className={cx("audio-wave-mini audio-wave-empty", className)} data-waveform={analysis.state}>
    <span aria-hidden="true" className="audio-wave-empty-rail" />
    {!bare && <span className="audio-wave-empty-label">{analysis.state === "analyzing" ? "正在生成波形…" : [durationMs ? formatPlaybackTime(durationMs / 1000) : null, "播放后显示波形"].filter(Boolean).join(" · ")}</span>}
  </span>;
}
