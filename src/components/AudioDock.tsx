import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Check, Download, ExternalLink, LoaderCircle, MoreHorizontal, Pause, Play, RotateCcw, RotateCw, SkipBack, SkipForward, Volume2, VolumeX, X } from "../icons";
import { useAudioClock, useAudioPlayer, useAudioQueue, useAudioState, useTrackPhase, type AudioPlayerState, type AudioTrack } from "../app/audio-player";
import { clampFraction, formatPlaybackTime, playbackFraction, playbackRates, queueLabel, queueStep, rateLabel, seekForKey, spokenPlaybackTime } from "../shared/audio-playback";
import { Button, MenuCheckboxItem, MenuContent, MenuItem, MenuLabel, MenuRoot, MenuSeparator, MenuTrigger, cx, ownerLabel } from "./ui";
import { grantErrorLabel } from "./media-preview";

/** Four bars that move while sound plays and rest at fixed heights otherwise. */
export function Equalizer({ className }: { className?: string }) {
  return <span aria-hidden="true" className={cx("audio-eq", className)}><i /><i /><i /><i /></span>;
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
export function AudioScrubber({ className, label = "播放进度" }: { className?: string; label?: string }) {
  const player = useAudioPlayer();
  const clock = useAudioClock();
  const status = useAudioState((state) => state.status);
  const loadProgress = useAudioState((state) => state.loadProgress);
  const transport = useAudioState((state) => state.transport);
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

  return <div className={cx("audio-scrubber", className)} data-pending={pending || undefined}>
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
      className="audio-rail"
      style={{ "--played": played, "--buffered": buffered } as CSSProperties}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => { dragging.current = false; setDrag(null); }}
      onPointerLeave={() => setHover(null)}
      onKeyDown={onKeyDown}
    >
      <span className="audio-rail-track"><span className="audio-rail-buffer" /><span className="audio-rail-fill" /></span>
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
        <span className={cx("audio-dock-cover", sounding && "is-playing")}><Equalizer /></span>
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

/** Inspector stage for an audio result: one play button and, once loaded, the same seek rail as the dock. */
export function AudioStage({ track, className }: { track: AudioTrack; className?: string }) {
  const phase = useTrackPhase(track.key);
  const state = useAudioState((value) => value.track?.key === track.key ? value : null);
  const active = phase !== "inactive";
  const line = state ? statusLine(state) : track.blocked ? grantErrorLabel(track.blocked) : "点播放后在页面底部的播放器里继续，切换页面不会中断。";
  return <div className={cx("audio-stage", className)} data-audio-stage={phase}>
    <div className="flex items-center gap-3">
      <span className={cx("audio-stage-cover", phase === "playing" && "is-playing")}><Equalizer /></span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-body-sm font-semibold text-ink">{track.title}</p>
        <p className={cx("mt-0.5 line-clamp-2 text-2xs", state?.status === "error" || state?.status === "blocked" || track.blocked ? "text-warning" : "text-muted")}>{line}</p>
      </div>
      <AudioPlayButton track={track} variant="primary" size="md" />
    </div>
    {active && <AudioScrubber className="mt-3" label={`${track.title} 播放进度`} />}
  </div>;
}
