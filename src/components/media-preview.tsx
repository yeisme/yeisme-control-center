import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorCode, type ArtifactGrant } from "../shared/api/control-center-client";
import { useWorkspace } from "../app/workspace";
import { useToast } from "./ui";
import type { MediaKind } from "./ui/Kind";
import { resultAction } from "../shared/read-model/tasks";
import type { TaskArtifact, TaskSnapshot } from "../task-observation";
import { mediaCacheKey, mediaSessionCache } from "../app/media-cache";
import { mediaFilename } from "../shared/media-filename";

export interface PreviewTarget {
  key: string;
  task: TaskSnapshot;
  result: TaskArtifact;
  kind: MediaKind;
}

export interface PreviewOptions {
  autoplay?: boolean;
  history?: "push" | "replace";
  source: "asset-card" | "detail-sheet" | "task-row";
  syncQuery?: boolean;
}

export type PreviewStatus = "closed" | "requesting" | "ready" | "blocked" | "error";
export type MediaTransport = "streaming" | "cached" | "blob";

const closedPreview: MediaPreviewState = { status: "closed", target: null, grant: null, sourceUrl: null, transport: null, error: null, autoplay: false, pendingDownload: false };

export interface MediaPreviewState {
  status: PreviewStatus;
  target: PreviewTarget | null;
  grant: ArtifactGrant | null;
  sourceUrl: string | null;
  transport: MediaTransport | null;
  error: string | null;
  autoplay: boolean;
  pendingDownload: boolean;
}

export interface MediaPreviewController extends MediaPreviewState {
  open: (target: PreviewTarget, options: PreviewOptions) => void;
  close: () => void;
  retry: () => void;
  fallback: () => Promise<string>;
  download: (target: PreviewTarget) => Promise<void>;
  reportError: (code: string) => void;
  isActive: (key: string) => boolean;
}

const grantErrors: Record<string, string> = {
  content_not_authorized: "来源拒绝内容读取；不会重试生成。",
  media_grant_expired: "短期句柄已过期，请重新申请。",
  media_handle_expired: "短期句柄已过期，请重新申请。",
  media_needs_contract: "来源未提供符合合同的媒体句柄。",
  media_address_denied: "来源返回的媒体地址未获准。",
  media_source_unauthorized: "Owner 拒绝了媒体读取；请检查结果访问权限。",
  media_source_not_found: "Owner 已找不到该媒体结果，可能已被回收。",
  media_unavailable: "Owner 媒体服务暂时不可用，请重试。",
  media_limits_exceeded: "Owner 返回的媒体格式或大小不符合读取合同。",
  media_range_invalid: "Owner 不接受当前媒体分段请求，正在尝试会话内读取。",
  media_decode_failed: "浏览器无法解码该媒体文件。",
  autoplay_blocked: "浏览器阻止了自动播放，请点击播放按钮。",
  artifact_not_found: "来源已找不到该结果。",
  audit_unavailable: "审计写入不可用，按规则不发起读取。",
  task_not_found: "任务引用已失效，请刷新任务列表。",
  preview_target_missing: "结果已不在当前观察批次中。",
  login_required: "登录已过期，请重新登录。",
};

export function grantErrorLabel(code: string) {
  return grantErrors[code] || `无法获取结果（${code}）`;
}

export function formatSeconds(value: number) {
  if (!Number.isFinite(value) || value < 0) return "00:00";
  const total = Math.floor(value);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export function useMediaPreview({ previewKey, resolve, onPreviewKeyChange, urlParam }: {
  previewKey: string | null;
  resolve: (key: string) => PreviewTarget | null;
  onPreviewKeyChange: (key: string | null, history: "push" | "replace") => void;
  /** The query parameter that carries the preview in the URL; browser Back and Forward then close the viewer at once. */
  urlParam?: string;
}): MediaPreviewController {
  const { scopeId, session, generation } = useWorkspace();
  const notify = useToast();
  const [state, setState] = useState<MediaPreviewState>({ status: "closed", target: null, grant: null, sourceUrl: null, transport: null, error: null, autoplay: false, pendingDownload: false });
  const [retryNonce, setRetryNonce] = useState(0);
  const identityRef = useRef("");
  const expiryRef = useRef<number | undefined>(undefined);
  const loadNonce = useRef(0);

  const target = previewKey ? resolve(previewKey) : null;
  const identity = `${scopeId}|${generation}|${previewKey || ""}|${target?.task.task_key || ""}|${target?.result.ref || ""}`;
  const cacheIdentity = `${session?.identity}|${scopeId}|${generation}|${session?.epoch || 0}`;

  const fetchBlob = useCallback(async (url: string, expiresAt: number) => {
    const response = await fetch(url, { credentials: "same-origin", cache: "no-store" });
    if (!response.ok) {
      let code = response.status === 410 ? "media_grant_expired" : response.status === 404 ? "media_source_not_found" : "media_unavailable";
      try {
        const body = await response.json() as { error?: unknown };
        if (typeof body.error === "string" && body.error) code = body.error;
      } catch {
        // The proxy may return an empty error response; keep the status mapping.
      }
      throw new Error(code);
    }
    const blob = await response.blob();
    return { blob, expiresAt };
  }, []);

  const fallbackToBlob = useCallback(async (next: PreviewTarget, grant: ArtifactGrant) => {
    const key = mediaCacheKey(scopeId, session?.epoch, next.task.task_key || next.task.locator.task_ref, next.result.ref + "|" + (next.result.version || next.task.revision), grant.mime || next.result.mime);
    const expiresAt = Date.parse(grant.expires_at);
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) throw new Error("media_grant_expired");
    const value = await mediaSessionCache.load(key, () => fetchBlob(grant.url, expiresAt),);
    if (!value) throw new Error("media_unavailable");
    return value;
  }, [fetchBlob, scopeId, session?.epoch]);

  const reportError = useCallback((code: string) => {
    setState((current) => ({ ...current, status: "error", grant: null, sourceUrl: null, transport: null, error: code }));
  }, []);

  useEffect(() => {
    identityRef.current = identity;
    mediaSessionCache.setIdentity(cacheIdentity);
    loadNonce.current += 1;
    window.clearTimeout(expiryRef.current);
    if (!previewKey) {
      setState({ status: "closed", target: null, grant: null, sourceUrl: null, transport: null, error: null, autoplay: false, pendingDownload: false });
      return;
    }
    if (!target) {
      setState({ status: "error", target: null, grant: null, sourceUrl: null, transport: null, error: "preview_target_missing", autoplay: false, pendingDownload: false });
      return;
    }
    if (!session || !target.task.task_key) {
      setState({ status: "error", target, grant: null, sourceUrl: null, transport: null, error: "login_required", autoplay: false, pendingDownload: false });
      return;
    }
    const action = resultAction(target.task, "preview");
    if (!action.enabled) {
      setState({ status: "blocked", target, grant: null, sourceUrl: null, transport: null, error: action.reason || "content_not_authorized", autoplay: false, pendingDownload: false });
      return;
    }
    let cancelled = false;
    const requestId = loadNonce.current;
    setState((current) => ({ status: "requesting", target, grant: null, sourceUrl: null, transport: null, error: null, autoplay: current.autoplay, pendingDownload: false }));
    void api.artifactAccess(scopeId, target.task.task_key, target.result.ref, "preview", session.csrf)
      .then(async (grant) => {
        if (cancelled || identityRef.current !== identity || requestId !== loadNonce.current) return;
        const expiresAt = Date.parse(grant.expires_at);
        const key = mediaCacheKey(scopeId, session.epoch, target.task.task_key || target.task.locator.task_ref, target.result.ref + "|" + (target.result.version || target.task.revision), grant.mime || target.result.mime);
        const cached = mediaSessionCache.get(key);
        const shouldPreload = target.kind === "image" || (target.result.bytes !== null && target.result.bytes <= 8 * 1024 * 1024);
        let sourceUrl = grant.url;
        let transport: MediaTransport = "streaming";
        if (cached) {
          sourceUrl = cached.url;
          transport = "cached";
        } else if (shouldPreload) {
          try {
            const value = await mediaSessionCache.load(key, () => fetchBlob(grant.url, expiresAt));
            if (value) {
              sourceUrl = value.url;
              transport = "blob";
            }
          } catch {
            // Keep the short-lived stream as the first source; playback can retry through Blob on error.
          }
        }
        if (cancelled || identityRef.current !== identity || requestId !== loadNonce.current) return;
        setState((current) => ({ ...current, status: "ready", target, grant, sourceUrl, transport, error: null }));
        const remaining = Date.parse(grant.expires_at) - Date.now();
        if (Number.isFinite(remaining) && remaining > 0) {
          expiryRef.current = window.setTimeout(() => {
            if (identityRef.current === identity) {
              mediaSessionCache.remove(key);
              setState((current) => ({ ...current, status: "error", grant: null, sourceUrl: null, transport: null, error: "media_grant_expired" }));
            }
          }, remaining);
        }
      })
      .catch((failure) => {
        if (cancelled || identityRef.current !== identity) return;
        setState((current) => ({ ...current, status: "error", target, grant: null, sourceUrl: null, transport: null, error: failure instanceof Error ? failure.message : errorCode(failure) }));
      });
    return () => { cancelled = true; window.clearTimeout(expiryRef.current); };
  }, [cacheIdentity, fetchBlob, identity, previewKey, target, scopeId, session, generation, retryNonce]);

  const open = useCallback((next: PreviewTarget, options: PreviewOptions) => {
    // Switching to another result drops the previous source at once, so no surface paints old media under the new name.
    setState((current) => current.target?.key === next.key
      ? { ...current, target: next, autoplay: options.autoplay === true, error: null }
      : { status: "requesting", target: next, grant: null, sourceUrl: null, transport: null, error: null, autoplay: options.autoplay === true, pendingDownload: false });
    if (options.syncQuery !== false) onPreviewKeyChange(next.key, options.history || "push");
  }, [onPreviewKeyChange]);

  const close = useCallback(() => {
    // Close at once, as `open` opens at once: the URL change is a transition that may commit later, and if the opening
    // URL never committed, the closing one would not read as a change at all.
    setState((current) => current.status === "closed" ? current : closedPreview);
    onPreviewKeyChange(null, "replace");
  }, [onPreviewKeyChange]);

  // For the same reason a Back that returns to the last committed URL leaves `previewKey` unchanged, so the browser's
  // own history event decides: once the URL no longer carries the preview, the viewer closes.
  useEffect(() => {
    if (!urlParam) return;
    const follow = () => {
      const hash = window.location.hash;
      const index = hash.indexOf("?");
      if (new URLSearchParams(index >= 0 ? hash.slice(index + 1) : "").get(urlParam)) return;
      setState((current) => current.status === "closed" ? current : closedPreview);
    };
    window.addEventListener("popstate", follow);
    return () => window.removeEventListener("popstate", follow);
  }, [urlParam]);

  const retry = useCallback(() => {
    if (previewKey) setRetryNonce((value) => value + 1);
  }, [previewKey]);

  const fallback = useCallback(async () => {
    if (!state.target || !state.grant) throw new Error("media_grant_expired");
    const key = mediaCacheKey(scopeId, session?.epoch, state.target.task.task_key || state.target.task.locator.task_ref, state.target.result.ref + "|" + (state.target.result.version || state.target.task.revision), state.grant.mime || state.target.result.mime);
    try {
      const value = await fallbackToBlob(state.target, state.grant);
      setState((current) => ({ ...current, status: "ready", sourceUrl: value.url, transport: "blob", error: null }));
      return value.url;
    } catch (error) {
      mediaSessionCache.remove(key);
      throw error;
    }
  }, [fallbackToBlob, scopeId, session?.epoch, state.grant, state.target]);

  const download = useCallback(async (next: PreviewTarget) => {
    if (!session || !next.task.task_key || !resultAction(next.task, "download").enabled || state.pendingDownload) return;
    setState((current) => ({ ...current, pendingDownload: true, error: null }));
    try {
      const grant = await api.artifactAccess(scopeId, next.task.task_key, next.result.ref, "download", session.csrf);
      const key = mediaCacheKey(scopeId, session.epoch, next.task.task_key || next.task.locator.task_ref, next.result.ref + "|" + (next.result.version || next.task.revision), grant.mime || next.result.mime);
      const cached = mediaSessionCache.get(key);
      const url = cached?.url || grant.url;
      if (!url) throw new Error("media_address_denied");
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = grant.filename || mediaFilename(next.result.name, grant.mime || next.result.mime);
      anchor.rel = "noopener";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      notify("下载已开始；结果状态不会因此改变。", "success");
    } catch (failure) {
      const code = errorCode(failure);
      setState((current) => ({ ...current, error: code }));
      notify(grantErrorLabel(code), "warning");
    } finally {
      setState((current) => ({ ...current, pendingDownload: false }));
    }
  }, [notify, scopeId, session, state.pendingDownload]);

  return {
    ...state,
    open,
    close,
    retry,
    fallback,
    download,
    reportError,
    isActive: (key: string) => state.target?.key === key && state.status === "ready",
  };
}
