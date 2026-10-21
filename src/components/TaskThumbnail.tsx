import { useEffect, useRef, useState } from "react";
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

function stateForError(error: unknown): ThumbnailState {
  const code = errorCode(error);
  if (/forbidden|not_authorized|denied/.test(code)) return "forbidden";
  if (/contract|unsupported/.test(code)) return "needs_contract";
  return "unavailable";
}

export function TaskThumbnail({ task, result, className, size = "sm" }: { task: TaskSnapshot; result?: TaskArtifact; className?: string; size?: "sm" | "md" | "lg" }) {
  const { scopeId, session } = useWorkspace();
  const host = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  const [state, setState] = useState<ThumbnailState>("idle");
  const [src, setSrc] = useState<string | null>(null);
  const kind: MediaKind = kindOf(result?.mime, undefined);
  const image = kind === "image" && !!result && !!task.task_key;

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
    thumbnailSessionCache.setIdentity(`${scopeId}|${session?.epoch || 0}`);
  }, [scopeId, session?.epoch]);

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
    const key = mediaCacheKey(scopeId, session.epoch, task.task_key, result.ref, result.mime);
    const cached = thumbnailSessionCache.get(key);
    if (cached) {
      setSrc(cached.url);
      setState("ready");
      return;
    }
    let cancelled = false;
    setState("loading");
    void thumbnailSessionCache.load(key, () => withThumbnailSlot(async () => {
      const grant = await api.artifactAccess(scopeId, task.task_key!, result.ref, "preview", session.csrf);
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
  const sizeClass = size === "lg" ? "size-full min-h-0 rounded-[12px]" : size === "md" ? "size-16 rounded-[10px]" : "size-10 rounded-[9px]";
  return <span ref={host} className={cx("grid shrink-0 place-items-center overflow-hidden border border-line bg-panel-soft", sizeClass, className)} title={state === "forbidden" ? "缩略图读取未授权" : state === "needs_contract" ? "来源未提供缩略图合同" : undefined}>
    {state === "ready" && src ? <img src={src} alt={result?.name || task.title} className="size-full object-cover" loading="lazy" /> : state === "loading" ? <span className="skeleton size-full" aria-label="加载缩略图" /> : <KindBadge kind={fallbackKind} size="sm" />}
  </span>;
}
