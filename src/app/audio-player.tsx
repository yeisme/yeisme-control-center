import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useSyncExternalStore, type ReactNode } from "react";
import { api, errorCode } from "../shared/api/control-center-client";
import { useWorkspace } from "./workspace";
import { resultAction } from "../shared/read-model/tasks";
import { mediaFilename } from "../shared/media-filename";
import { audioBlobLimitBytes, audioStrategy, bufferedEnd, clampSeek, nextPlaybackRate, queueFor, queueStep, regrantAllowed, trackPhase, type AudioStatus, type AudioTransport, type TrackPhase } from "../shared/audio-playback";
import { ownerLabel, useToast } from "../components/ui";
import { grantErrorLabel, type PreviewTarget } from "../components/media-preview";

/** One playable owner result. Identity is `key`; everything else is display or grant input. */
export interface AudioTrack {
  key: string;
  taskKey: string;
  resultRef: string;
  title: string;
  owner: string;
  context: string;
  mime: string;
  bytes: number | null;
  durationMs: number | null;
  canDownload: boolean;
  /** Owner-side reason the result cannot be read; shown instead of requesting a handle. */
  blocked: string | null;
  /** Detail surface for the result; null when the caller already is that surface. */
  detailsHref: string | null;
}

export function audioTrackFrom(target: PreviewTarget, detailsHref: string | null = null): AudioTrack {
  const preview = resultAction(target.task, "preview");
  return {
    key: target.key,
    taskKey: target.task.task_key || "",
    resultRef: target.result.ref,
    title: target.result.name || "未命名音频",
    owner: target.task.locator.owner,
    context: target.task.title,
    mime: target.result.mime,
    bytes: target.result.bytes ?? null,
    durationMs: target.result.duration_ms ?? null,
    canDownload: resultAction(target.task, "download").enabled,
    blocked: preview.enabled ? null : preview.reason || "content_not_authorized",
    detailsHref,
  };
}

export interface AudioPlayerState {
  track: AudioTrack | null;
  status: AudioStatus;
  /** The listener asked for sound; survives handle re-grants and loading. */
  wantsPlay: boolean;
  error: string | null;
  notice: "autoplay_blocked" | null;
  /** 0..1 while the bytes are read into session memory; null when the size is unknown. */
  loadProgress: number | null;
  transport: AudioTransport | null;
  rate: number;
  volume: number;
  muted: boolean;
  /** The playable list the track was started from, in list order; previous and next move through it. */
  queue: readonly AudioTrack[];
  /** Start the next queued track when one ends. Off by default, because every start requests a handle. */
  autoNext: boolean;
}

export interface AudioClock { current: number; duration: number; buffered: number }

class Store<T extends object> {
  private listeners = new Set<() => void>();
  constructor(private state: T) {}
  get = () => this.state;
  set = (patch: Partial<T>) => {
    const next = { ...this.state, ...patch };
    if ((Object.keys(next) as (keyof T)[]).every((key) => Object.is(next[key], this.state[key]))) return;
    this.state = next;
    for (const listener of this.listeners) listener();
  };
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
}

export interface AudioPlayer {
  store: Store<AudioPlayerState>;
  clock: Store<AudioClock>;
  /** Starts the track, or toggles it when it is already loaded; `queue` is the list it was started from. */
  play: (track: AudioTrack, queue?: readonly AudioTrack[]) => void;
  next: () => void;
  previous: () => void;
  toggleAutoNext: () => void;
  toggle: () => void;
  seek: (seconds: number) => void;
  skip: (delta: number) => void;
  retry: () => void;
  close: () => void;
  setRate: (rate: number) => void;
  cycleRate: () => void;
  toggleMute: () => void;
  setVolume: (volume: number) => void;
  download: () => void;
  currentTime: () => number;
}

const preferenceKey = "yeisme.control.audio";
const fatalReadErrors = new Set(["content_not_authorized", "media_source_unauthorized", "media_source_not_found", "artifact_not_found", "audit_unavailable", "login_required", "task_not_found"]);

function readPreferences() {
  try {
    const stored = JSON.parse(localStorage.getItem(preferenceKey) || "{}") as { rate?: unknown; volume?: unknown; muted?: unknown; autoNext?: unknown };
    return {
      rate: typeof stored.rate === "number" && stored.rate >= 0.5 && stored.rate <= 2 ? stored.rate : 1,
      volume: typeof stored.volume === "number" && stored.volume >= 0 && stored.volume <= 1 ? stored.volume : 1,
      muted: stored.muted === true,
      autoNext: stored.autoNext === true,
    };
  } catch {
    return { rate: 1, volume: 1, muted: false, autoNext: false };
  }
}

type Preferences = Pick<AudioPlayerState, "rate" | "volume" | "muted" | "autoNext">;
const idleState = (preferences: Preferences): AudioPlayerState => ({ track: null, status: "idle", wantsPlay: false, error: null, notice: null, loadProgress: null, transport: null, queue: [], ...preferences });

function failureCode(failure: unknown) {
  const code = errorCode(failure);
  if (code !== "control_center_unavailable") return code;
  return failure instanceof Error && /^[a-z][a-z0-9_]*$/.test(failure.message) ? failure.message : code;
}

async function responseError(response: Response) {
  let code = response.status === 410 ? "media_grant_expired" : response.status === 404 ? "media_source_not_found" : response.status === 403 ? "content_not_authorized" : "media_unavailable";
  try {
    const body = await response.json() as { error?: unknown };
    if (typeof body.error === "string" && body.error) code = body.error;
  } catch {
    // Empty proxy error bodies keep the status mapping.
  }
  return new Error(code);
}

/** Reads the whole handle once so long pauses and seeking never depend on the short-lived URL again. */
async function readAudioBytes(url: string, mime: string, signal: AbortSignal, onProgress: (fraction: number | null) => void) {
  const response = await fetch(url, { credentials: "same-origin", cache: "no-store", signal });
  if (!response.ok) throw await responseError(response);
  const type = response.headers.get("content-type")?.split(";", 1)[0].trim() || mime;
  const total = Number(response.headers.get("content-length")) || 0;
  if (!response.body) return new Blob([await response.arrayBuffer()], { type });
  const reader = response.body.getReader();
  const chunks: BlobPart[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.byteLength;
    if (received > audioBlobLimitBytes * 1.5) {
      await reader.cancel();
      throw new Error("media_limits_exceeded");
    }
    onProgress(total ? Math.min(1, received / total) : null);
  }
  return new Blob(chunks, { type });
}

const AudioPlayerContext = createContext<AudioPlayer | null>(null);

/**
 * Global audio player: one media element for the whole workspace, so playback starts on click,
 * survives page navigation and stops when the scope, epoch or session changes.
 */
export function AudioPlayerProvider({ children }: { children: ReactNode }) {
  const { scopeId, session } = useWorkspace();
  const notify = useToast();
  const audioRef = useRef<HTMLAudioElement>(null);
  const stateRef = useRef<Store<AudioPlayerState> | null>(null);
  if (!stateRef.current) stateRef.current = new Store(idleState(readPreferences()));
  const state = stateRef.current;
  const clock = useRef(new Store<AudioClock>({ current: 0, duration: Number.NaN, buffered: 0 })).current;
  const access = useRef({ scopeId, session });
  access.current = { scopeId, session };
  const loadToken = useRef(0);
  const abort = useRef<AbortController | null>(null);
  const objectUrl = useRef<string | null>(null);
  const grant = useRef<{ key: string; url: string; mime: string; expiresAt: number } | null>(null);
  const attached = useRef(false);
  const pendingSeek = useRef<number | null>(null);
  const regrants = useRef<number[]>([]);
  // Set once a page CSP without media-src blob: refuses in-memory audio; later tracks stream instead.
  const blobRefused = useRef(false);

  const release = useCallback(() => {
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = null;
  }, []);

  const detach = useCallback(() => {
    attached.current = false;
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
  }, []);

  const requestGrant = useCallback(async (track: AudioTrack, token: number) => {
    const { scopeId: scope, session: current } = access.current;
    if (!current || !track.taskKey) throw new Error("login_required");
    const reuse = grant.current;
    if (reuse?.key === track.key && reuse.expiresAt - Date.now() > 5000) return reuse;
    const issued = await api.artifactAccess(scope, track.taskKey, track.resultRef, "preview", current.csrf);
    if (token !== loadToken.current) throw new DOMException("stale audio grant", "AbortError");
    const next = { key: track.key, url: issued.url, mime: issued.mime || track.mime, expiresAt: Date.parse(issued.expires_at) };
    grant.current = next;
    return next;
  }, []);

  const startPlayback = useCallback(async () => {
    const audio = audioRef.current;
    state.set({ wantsPlay: true });
    if (!audio || !attached.current) return;
    try {
      await audio.play();
      state.set({ notice: null });
    } catch (failure) {
      // AbortError means a newer source replaced this one; media errors arrive through the error event.
      if (failure instanceof DOMException && failure.name === "NotAllowedError") state.set({ wantsPlay: false, status: "paused", notice: "autoplay_blocked" });
    }
  }, [state]);

  const attach = useCallback((url: string, transport: AudioTransport, at: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    const { rate, volume, muted, wantsPlay } = state.get();
    attached.current = true;
    pendingSeek.current = at > 0 ? at : null;
    audio.src = url;
    audio.defaultPlaybackRate = rate;
    audio.playbackRate = rate;
    audio.volume = volume;
    audio.muted = muted;
    state.set({ transport, loadProgress: null, status: wantsPlay ? "buffering" : "paused" });
    if (wantsPlay) void startPlayback();
  }, [startPlayback, state]);

  const fail = useCallback((code: string) => {
    detach();
    state.set({ status: "error", error: code, wantsPlay: false, loadProgress: null, transport: null });
  }, [detach, state]);

  /** Grants a fresh short-lived handle and attaches it: in memory for small files, as a range stream otherwise. */
  const load = useCallback(async (track: AudioTrack, at: number, mode: "auto" | AudioTransport, fresh: boolean): Promise<void> => {
    const token = ++loadToken.current;
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    detach();
    release();
    if (fresh) grant.current = null;
    if (track.blocked) {
      state.set({ track, status: "blocked", error: track.blocked, wantsPlay: false, notice: null, loadProgress: null, transport: null });
      return;
    }
    state.set({ track, status: "requesting", error: null, notice: null, loadProgress: null, transport: null });
    const transport = mode === "auto" ? (blobRefused.current ? "stream" : audioStrategy(track.bytes)) : mode;
    try {
      const issued = await requestGrant(track, token);
      if (token !== loadToken.current) return;
      if (transport === "stream") {
        attach(issued.url, "stream", at);
        return;
      }
      state.set({ status: "loading", loadProgress: 0 });
      const blob = await readAudioBytes(issued.url, issued.mime, controller.signal, (fraction) => {
        if (token === loadToken.current) state.set({ loadProgress: fraction });
      });
      if (token !== loadToken.current) return;
      objectUrl.current = URL.createObjectURL(blob);
      attach(objectUrl.current, "blob", at);
    } catch (failure) {
      if (token !== loadToken.current || controller.signal.aborted) return;
      const code = failureCode(failure);
      const expired = code === "media_grant_expired" || code === "media_handle_expired";
      // A failed in-memory read can still stream; authorization-class refusals stop here.
      if (mode === "auto" && transport === "blob" && !fatalReadErrors.has(code)) return load(track, at, "stream", expired);
      fail(code);
    }
  }, [attach, detach, fail, release, requestGrant, state]);

  /** A streaming handle expired or the proxy refused a range: re-grant and resume, then try one in-memory read. */
  const recover = useCallback(() => {
    const audio = audioRef.current;
    const { track, transport } = state.get();
    if (!audio?.error || !track || !attached.current || audio.error.code === MediaError.MEDIA_ERR_ABORTED) return;
    const at = clock.get().current;
    if (transport === "blob" && audio.error.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED && !blobRefused.current) {
      blobRefused.current = true;
      void load(track, at, "stream", false);
      return;
    }
    if (transport === "blob" || audio.error.code === MediaError.MEDIA_ERR_DECODE) {
      fail("media_decode_failed");
      return;
    }
    const budget = regrantAllowed(regrants.current, Date.now());
    regrants.current = budget.recent;
    if (budget.allowed) {
      regrants.current.push(Date.now());
      void load(track, at, "stream", true);
      return;
    }
    if (track.bytes === null || audioStrategy(track.bytes, audioBlobLimitBytes * 3) === "blob") {
      regrants.current.push(Date.now());
      void load(track, at, "blob", true);
      return;
    }
    fail("media_unavailable");
  }, [clock, fail, load, state]);
  const recoverRef = useRef(recover);
  recoverRef.current = recover;
  const advanceRef = useRef<() => boolean>(() => false);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const sync = () => {
      const duration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : clock.get().duration;
      clock.set({ current: audio.currentTime, duration, buffered: bufferedEnd(audio.buffered, audio.currentTime) });
    };
    const handlers: Record<string, () => void> = {
      loadedmetadata: () => {
        if (pendingSeek.current !== null) audio.currentTime = clampSeek(pendingSeek.current, audio.duration);
        pendingSeek.current = null;
        sync();
      },
      durationchange: sync,
      timeupdate: sync,
      progress: sync,
      seeked: sync,
      playing: () => { if (attached.current) state.set({ status: "playing", wantsPlay: true, notice: null, error: null }); },
      waiting: () => { if (attached.current && state.get().wantsPlay) state.set({ status: "buffering" }); },
      canplay: () => { if (attached.current && !state.get().wantsPlay && state.get().status === "buffering") state.set({ status: "paused" }); },
      pause: () => {
        if (!attached.current || audio.ended || audio.error || state.get().status === "error") return;
        state.set({ status: "paused", wantsPlay: false });
      },
      ended: () => {
        sync();
        // Continuous play is opt-in: only then does the end of one track request the next track's handle.
        if (state.get().autoNext && advanceRef.current()) return;
        state.set({ status: "ended", wantsPlay: false });
      },
      error: () => recoverRef.current(),
    };
    for (const [name, handler] of Object.entries(handlers)) audio.addEventListener(name, handler);
    return () => { for (const [name, handler] of Object.entries(handlers)) audio.removeEventListener(name, handler); };
  }, [clock, state]);

  const toggle = useCallback(() => {
    const audio = audioRef.current;
    const current = state.get();
    if (!audio || !current.track) return;
    if (current.status === "error") {
      regrants.current = [];
      state.set({ wantsPlay: true });
      void load(current.track, clock.get().current, "auto", true);
      return;
    }
    if (current.status === "blocked") return;
    if (current.status === "requesting" || current.status === "loading") {
      state.set({ wantsPlay: !current.wantsPlay });
      return;
    }
    if (current.wantsPlay) {
      audio.pause();
      state.set({ wantsPlay: false, status: "paused" });
      return;
    }
    void startPlayback();
  }, [clock, load, startPlayback, state]);

  const play = useCallback((track: AudioTrack, queue?: readonly AudioTrack[]) => {
    const current = state.get();
    state.set({ queue: queueFor(track, queue, current.queue) });
    if (current.track?.key === track.key && current.status !== "blocked") {
      toggle();
      return;
    }
    regrants.current = [];
    state.set({ wantsPlay: true });
    clock.set({ current: 0, duration: track.durationMs ? track.durationMs / 1000 : Number.NaN, buffered: 0 });
    void load(track, 0, "auto", false);
  }, [clock, load, state, toggle]);

  /** Moves through the queue; false when there is no track in that direction. */
  const step = useCallback((direction: -1 | 1) => {
    const { track, queue } = state.get();
    const target = track ? queueStep(queue, track.key, direction) : null;
    if (target) play(target);
    return target !== null;
  }, [play, state]);
  advanceRef.current = () => step(1);

  const seek = useCallback((seconds: number) => {
    const audio = audioRef.current;
    const duration = audio && Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : clock.get().duration;
    const target = clampSeek(seconds, duration);
    clock.set({ current: target });
    if (!audio || !attached.current || audio.readyState < HTMLMediaElement.HAVE_METADATA) {
      pendingSeek.current = target;
      return;
    }
    audio.currentTime = target;
    if (state.get().status === "ended") state.set({ status: "paused" });
  }, [clock, state]);

  const skip = useCallback((delta: number) => {
    const audio = audioRef.current;
    const current = audio && attached.current && audio.readyState >= HTMLMediaElement.HAVE_METADATA ? audio.currentTime : pendingSeek.current ?? clock.get().current;
    seek(current + delta);
  }, [clock, seek]);

  const close = useCallback(() => {
    loadToken.current++;
    abort.current?.abort();
    detach();
    release();
    grant.current = null;
    regrants.current = [];
    pendingSeek.current = null;
    const { rate, volume, muted, autoNext } = state.get();
    state.set(idleState({ rate, volume, muted, autoNext }));
    clock.set({ current: 0, duration: Number.NaN, buffered: 0 });
  }, [clock, detach, release, state]);

  const remember = useCallback((patch: Partial<Preferences>) => {
    state.set(patch);
    const { rate, volume, muted, autoNext } = state.get();
    try { localStorage.setItem(preferenceKey, JSON.stringify({ rate, volume, muted, autoNext })); } catch { /* private mode */ }
  }, [state]);

  const setRate = useCallback((rate: number) => {
    const audio = audioRef.current;
    if (audio) { audio.defaultPlaybackRate = rate; audio.playbackRate = rate; }
    remember({ rate });
  }, [remember]);

  const setVolume = useCallback((volume: number) => {
    const audio = audioRef.current;
    const next = Math.min(1, Math.max(0, volume));
    if (audio) { audio.volume = next; audio.muted = next === 0; }
    remember({ volume: next, muted: next === 0 });
  }, [remember]);

  const toggleMute = useCallback(() => {
    const audio = audioRef.current;
    const { muted, volume } = state.get();
    const next = !muted;
    if (audio) { audio.muted = next; if (!next && volume === 0) audio.volume = 1; }
    remember({ muted: next, ...(!next && volume === 0 ? { volume: 1 } : {}) });
  }, [remember, state]);

  const download = useCallback(async () => {
    const { track } = state.get();
    const { scopeId: scope, session: current } = access.current;
    if (!track || !current || !track.canDownload) return;
    try {
      const issued = await api.artifactAccess(scope, track.taskKey, track.resultRef, "download", current.csrf);
      if (!issued.url) throw new Error("media_address_denied");
      const anchor = document.createElement("a");
      anchor.href = issued.url;
      anchor.download = issued.filename || mediaFilename(track.title, issued.mime || track.mime);
      anchor.rel = "noopener";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      notify("下载已开始；结果状态不会因此改变。", "success");
    } catch (failure) {
      notify(grantErrorLabel(failureCode(failure)), "warning");
    }
  }, [notify, state]);

  // A new scope, session or epoch invalidates every handle; nothing keeps playing across that boundary.
  const identity = `${session?.identity || ""}|${session?.epoch || 0}|${scopeId}`;
  useEffect(() => { close(); }, [close, identity]);
  useEffect(() => () => { close(); }, [close]);

  // Operating-system media keys and lock-screen controls follow the same player.
  useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    const media = navigator.mediaSession;
    let lastKey: string | null = null;
    const apply = () => {
      const { track, status, queue } = state.get();
      try {
        if ((track?.key || null) !== lastKey) {
          lastKey = track?.key || null;
          media.metadata = track && typeof MediaMetadata !== "undefined" ? new MediaMetadata({ title: track.title, artist: ownerLabel(track.owner), album: track.context }) : null;
        }
        media.playbackState = !track ? "none" : status === "playing" || status === "buffering" ? "playing" : "paused";
      } catch {
        // Media Session is optional; playback never depends on it.
      }
      // Previous and next track keys exist only while the queue has a track in that direction.
      for (const [action, direction] of [["previoustrack", -1], ["nexttrack", 1]] as const) {
        const available = !!track && queueStep(queue, track.key, direction) !== null;
        try { media.setActionHandler(action, available ? () => { step(direction); } : null); } catch { /* unsupported action */ }
      }
    };
    const actions: [MediaSessionAction, MediaSessionActionHandler][] = [
      ["play", () => { if (!state.get().wantsPlay) toggle(); }],
      ["pause", () => { if (state.get().wantsPlay) toggle(); }],
      ["seekbackward", (details) => skip(-(details.seekOffset || 10))],
      ["seekforward", (details) => skip(details.seekOffset || 10)],
      ["seekto", (details) => { if (typeof details.seekTime === "number") seek(details.seekTime); }],
      ["stop", () => close()],
    ];
    for (const [action, handler] of actions) { try { media.setActionHandler(action, handler); } catch { /* unsupported action */ } }
    apply();
    const unsubscribe = state.subscribe(apply);
    return () => {
      unsubscribe();
      for (const action of [...actions.map(([name]) => name), "previoustrack", "nexttrack"] as MediaSessionAction[]) { try { media.setActionHandler(action, null); } catch { /* unsupported action */ } }
    };
  }, [close, seek, skip, state, step, toggle]);

  // Only one thing makes sound: a video preview pauses the player, and the player pauses other media.
  useEffect(() => {
    const onPlay = (event: Event) => {
      const audio = audioRef.current;
      const target = event.target;
      if (!audio || !(target instanceof HTMLMediaElement)) return;
      if (target !== audio) {
        if (!audio.paused) audio.pause();
        return;
      }
      for (const element of document.querySelectorAll<HTMLMediaElement>("audio, video")) if (element !== audio && !element.paused) element.pause();
    };
    document.addEventListener("play", onPlay, true);
    return () => document.removeEventListener("play", onPlay, true);
  }, []);

  const value = useMemo<AudioPlayer>(() => ({
    store: state,
    clock,
    play,
    next: () => { step(1); },
    previous: () => { step(-1); },
    toggleAutoNext: () => remember({ autoNext: !state.get().autoNext }),
    toggle,
    seek,
    skip,
    retry: () => { const { track } = state.get(); if (track) { regrants.current = []; state.set({ wantsPlay: true }); void load(track, clock.get().current, "auto", true); } },
    close,
    setRate,
    cycleRate: () => setRate(nextPlaybackRate(state.get().rate)),
    toggleMute,
    setVolume,
    download: () => void download(),
    currentTime: () => {
      const audio = audioRef.current;
      return audio && attached.current && audio.readyState >= HTMLMediaElement.HAVE_METADATA ? audio.currentTime : pendingSeek.current ?? clock.get().current;
    },
  }), [clock, close, download, load, play, remember, seek, setRate, setVolume, skip, state, step, toggle, toggleMute]);

  return <AudioPlayerContext.Provider value={value}>
    {children}
    <audio ref={audioRef} preload="auto" hidden data-audio-player />
  </AudioPlayerContext.Provider>;
}

function usePlayer() {
  const value = useContext(AudioPlayerContext);
  if (!value) throw new Error("AudioPlayerProvider missing");
  return value;
}

/** Player actions; stable for the lifetime of the workspace. */
export function useAudioPlayer() {
  return usePlayer();
}

export function useAudioState<T>(select: (state: AudioPlayerState) => T): T {
  const { store } = usePlayer();
  return useSyncExternalStore(store.subscribe, () => select(store.get()));
}

export function useAudioClock() {
  const { clock } = usePlayer();
  return useSyncExternalStore(clock.subscribe, clock.get);
}

const AudioQueueContext = createContext<readonly AudioTrack[] | undefined>(undefined);

/** The playable list around play controls: a track started inside it queues the rest of the list. */
export function AudioQueue({ tracks, children }: { tracks: readonly AudioTrack[]; children: ReactNode }) {
  return <AudioQueueContext.Provider value={tracks}>{children}</AudioQueueContext.Provider>;
}

export function useAudioQueue() {
  return useContext(AudioQueueContext);
}

/** How a play control for one result should look; re-renders only when that phase changes. */
export function useTrackPhase(key: string): TrackPhase {
  return useAudioState((state) => trackPhase(state, key));
}
