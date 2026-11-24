import { useEffect, useRef, useState, type ReactNode } from "react";
import { api, errorCode } from "../shared/api/control-center-client";
import { useWorkspace } from "../app/workspace";
import { MediaSessionCache, mediaCacheKey } from "../app/media-cache";
import type { TaskArtifact, TaskSnapshot } from "../task-observation";
import { resultAction } from "../shared/read-model/tasks";
import { kindOf, type MediaKind } from "./ui/Kind";
import { KindBadge, cx } from "./ui";

type ThumbnailState = "idle" | "loading" | "ready" | "unavailable" | "forbidden" | "needs_contract";

let thumbnailInFlight = 0;
const thumbnailQueue: (() => void)[] = [];
const thumbnailSessionCache = new MediaSessionCache({ maxEntries: 64, maxBytes: 32 * 1024 * 1024 });
async function withThumbnailSlot<T>(work: () => Promise<T>): Promise<T> {
  if (thumbnailInFlight >= 2) await new Promise<void>((resolve) => thumbnailQueue.push(resolve));
  thumbnailInFlight += 1;
  try {
    return await work();
  } finally {
    thumbnailInFlight -= 1;
    thumbnailQueue.shift()?.();
  }
}

const thumbnailKey = (scopeId: string, epoch: number | undefined, task: TaskSnapshot, result: TaskArtifact) =>
  mediaCacheKey(scopeId, epoch, task.task_key || "", result.ref + "|thumbnail|" + task.revision + "|" + result.thumbnail?.ref, "image/webp");

/**
 * A thumbnail this tab already holds, or null. For previews that must not ask for a media grant of their own (the ⌘K
 * preview): they show a picture only when the list already loaded it.
 */
export function peekThumbnail(scopeId: string, epoch: number | undefined, task: TaskSnapshot, result: TaskArtifact): string | null {
  if (!task.task_key || result.thumbnail?.state !== "ready") return null;
  return thumbnailSessionCache.get(thumbnailKey(scopeId, epoch, task, result))?.url || null;
}

function stateForError(error: unknown): ThumbnailState {
  const code = errorCode(error);
  if (/forbidden|not_authorized|denied/.test(code)) return "forbidden";
  if (/contract|unsupported/.test(code)) return "needs_contract";
  return "unavailable";
}

/**
 * A result's owner thumbnail, requested only once it scrolls into view. `frameless` drops the tile's border and
 * rounding for covers; `fallback` replaces the media-kind badge shown when no picture can be read.
 */
export function TaskThumbnail({ task, result, className, size = "sm", frameless = false, fallback, alt }: { task: TaskSnapshot; result?: TaskArtifact; className?: string; size?: "sm" | "md" | "lg"; frameless?: boolean; fallback?: ReactNode; alt?: string }) {
  const { scopeId, session } = useWorkspace();
  const host = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  const [state, setState] = useState<ThumbnailState>("idle");
  const [src, setSrc] = useState<string | null>(null);
  const kind: MediaKind = kindOf(result?.mime, undefined);
  const image = (kind === "image" || kind === "video") && !!result && !!task.task_key;

  useEffect(() => {
    const node = host.current;
    if (!node || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setVisible(true);
        observer.disconnect();
      }
    }, { rootMargin: "160px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    thumbnailSessionCache.setIdentity(`${session?.identity}|${scopeId}|${session?.epoch || 0}`);
  }, [scopeId, session?.identity, session?.epoch]);

  useEffect(() => {
    if (!image || !visible || !result || !task.task_key || !session) {
      if (!image) setState("unavailable");
      return;
    }
    if (result.thumbnail?.state !== "ready") {
      setState(result.thumbnail?.state || "unavailable");
      return;
    }
    const action = resultAction(task, "preview");
    if (!action.enabled) {
      setState("forbidden");
      return;
    }
    const key = thumbnailKey(scopeId, session.epoch, task, result);
    const cached = thumbnailSessionCache.get(key);
    if (cached) {
      setSrc(cached.url);
      setState("ready");
      return;
    }
    let cancelled = false;
    setState("loading");
    void thumbnailSessionCache.load(key, () => withThumbnailSlot(async () => {
      const grant = await api.artifactAccess(scopeId, task.task_key!, result.ref, "thumbnail", session.csrf);
      const response = await fetch(grant.url, { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) throw new Error(response.status === 403 ? "content_not_authorized" : response.status === 422 ? "media_needs_contract" : "media_unavailable");
      return { blob: await response.blob(), expiresAt: Date.parse(grant.expires_at) };
    })).then((value) => {
      if (cancelled) return;
      if (!value) {
        setState("unavailable");
        return;
      }
      setSrc(value.url);
      setState("ready");
    }).catch((error) => {
      if (!cancelled) setState(stateForError(error));
    });
    return () => { cancelled = true; };
  }, [image, result, scopeId, session, task, visible]);

  const fallbackKind = result ? kindOf(result.mime, undefined) : kindOf(undefined, undefined);
  const sizeClass = frameless ? "size-full min-h-0" : size === "lg" ? "size-full min-h-0 rounded-[12px]" : size === "md" ? "size-16 rounded-[10px]" : "size-10 rounded-[9px]";
  return <span ref={host} className={cx("grid shrink-0 place-items-center overflow-hidden", !frameless && "border border-line bg-panel-soft", sizeClass, className)} title={state === "forbidden" ? "缩略图读取未授权" : state === "needs_contract" ? "来源未提供缩略图合同" : undefined}>
    {state === "ready" && src ? <FadeImage key={src} src={src} alt={alt ?? (result?.name || task.title)} /> : state === "loading" ? <span className="skeleton size-full !rounded-none" role="img" aria-label="加载缩略图" /> : fallback ?? <KindBadge kind={fallbackKind} size="sm" />}
  </span>;
}

/** A thumbnail fades in once decoded instead of popping in line by line. */
function FadeImage({ src, alt }: { src: string; alt: string }) {
  const [loaded, setLoaded] = useState(false);
  return <img src={src} alt={alt} loading="lazy" onLoad={() => setLoaded(true)} className={cx("size-full object-cover transition-opacity duration-200 ease-out", loaded ? "opacity-100" : "opacity-0")} />;
}
