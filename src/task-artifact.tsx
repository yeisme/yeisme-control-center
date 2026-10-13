import { useEffect, useLayoutEffect, useRef, useState, type SyntheticEvent } from "react";
import { Button, Dialog } from "./ui";
import { Download, Eye, FileImage, FileText, Video, Volume2, X } from "./icons";
import { contentActionEnabled, contentStateMessage, type ConnectionObservation, type TaskArtifact, type TaskSnapshot } from "./task-observation";
import { mediaErrorCode, mediaErrorMessage, mediaKind, mediaKindLabel, mediaPreviewKind } from "./media-kind";

interface PreviewGrant { url: string; mime: string; expires_at: string }

export function TaskArtifactView({ artifact, task, scope, csrf, allowedActions, content, onSessionExpired }: {
  artifact: TaskArtifact;
  task: string;
  scope: string;
  csrf: string;
  allowedActions: TaskSnapshot["allowed_actions"];
  content?: ConnectionObservation["content"];
  onSessionExpired?: () => void;
}) {
  const kind = mediaKind(artifact.mime, artifact.ref);
  const previewable = artifact.mime.trim()
    ? mediaPreviewKind(artifact.mime) !== "unknown"
    : ["image", "video", "audio"].includes(kind);
  const canPreview = previewable && contentActionEnabled(allowedActions, content, "preview");
  const canDownload = contentActionEnabled(allowedActions, content, "download");
  const [grant, setGrant] = useState<PreviewGrant | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const card = useRef<HTMLElement | null>(null);
  const media = useRef<HTMLMediaElement | null>(null);
  const position = useRef(0);
  const request = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const Icon = kind === "image" ? FileImage : kind === "video" ? Video : kind === "audio" ? Volume2 : FileText;

  const releaseMedia = (rememberPosition: boolean) => {
    const element = media.current;
    if (element) {
      if (rememberPosition && Number.isFinite(element.currentTime)) position.current = element.currentTime;
      element.pause();
      element.removeAttribute("src");
      element.load();
    }
    if (!rememberPosition) position.current = 0;
  };
  const closePreview = () => {
    generation.current++;
    request.current?.abort();
    releaseMedia(false);
    setGrant(null);
    setBusy(false);
    setError("");
    setPreviewOpen(false);
  };

  // Invalidate in-flight grants before paint on identity or permission changes.
  useLayoutEffect(() => {
    generation.current++;
    request.current?.abort();
    releaseMedia(false);
    setGrant(null);
    setBusy(false);
    setError(previewOpen ? (canPreview ? "media_unavailable" : previewable ? "content_not_authorized" : "media_unsupported") : "");
    return () => {
      generation.current++;
      request.current?.abort();
      releaseMedia(false);
    };
  }, [scope, task, artifact.ref, csrf, canPreview, canDownload, content]);

  useEffect(() => {
    if (!previewOpen || !grant) return;
    let timer: number;
    const expire = () => {
      const remaining = Date.parse(grant.expires_at) - Date.now();
      if (remaining > 0) {
        timer = window.setTimeout(expire, Math.min(remaining, 2147483647));
        return;
      }
      releaseMedia(true);
      setGrant(null);
      setError("media_grant_expired");
    };
    expire();
    return () => clearTimeout(timer);
  }, [previewOpen, grant]);

  const access = async (purpose: "preview" | "download") => {
    if (busy || (purpose === "preview" ? !canPreview : !canDownload)) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const version = ++generation.current;
    if (purpose === "preview") {
      releaseMedia(true);
      setGrant(null);
      setPreviewOpen(true);
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch(
        "/api/control-center/v1/tasks/" + encodeURIComponent(task) +
        "/artifacts/" + encodeURIComponent(artifact.ref) + "/access?scope=" + encodeURIComponent(scope),
        {
          method: "POST", credentials: "same-origin", signal: controller.signal,
          headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
          body: JSON.stringify({ purpose }),
        },
      );
      const body = await response.json().catch(() => null);
      if (controller.signal.aborted || version !== generation.current) return;
      if (!response.ok) {
        const code = mediaErrorCode(body?.error, response.status);
        if (code === "login_required") onSessionExpired?.();
        throw Error(code);
      }
      if (!body || typeof body.url !== "string" ||
          !/^\/api\/control-center\/v1\/media\/[A-Za-z0-9_-]+(?:\?scope=[^&#]*)?$/.test(body.url))
        throw Error("media_address_denied");
      const address = new URL(body.url, location.origin);
      if (address.origin !== location.origin || (address.searchParams.has("scope") && address.searchParams.get("scope") !== scope))
        throw Error("media_address_denied");
      if (typeof body.mime !== "string" || !body.mime.trim() ||
          typeof body.expires_at !== "string" || !Number.isFinite(Date.parse(body.expires_at)))
        throw Error("media_needs_contract");
      if (Date.parse(body.expires_at) <= Date.now()) throw Error("media_grant_expired");
      if (mediaPreviewKind(body.mime) === "unknown") throw Error("media_unsupported");
      if (purpose === "preview") {
        setGrant({ url: body.url, mime: body.mime, expires_at: body.expires_at });
      } else {
        const anchor = document.createElement("a");
        anchor.href = body.url;
        anchor.download = artifact.name || "result";
        anchor.click();
      }
    } catch (caught) {
      if (!controller.signal.aborted && version === generation.current)
        setError(mediaErrorCode(caught instanceof Error ? caught.message : undefined, 0));
    } finally {
      if (!controller.signal.aborted && version === generation.current) setBusy(false);
    }
  };
  const failed = () => {
    releaseMedia(true);
    setGrant(null);
    setError("media_unavailable");
  };
  const restorePosition = (event: SyntheticEvent<HTMLMediaElement>) => {
    const element = event.currentTarget;
    if (position.current > 0 && Number.isFinite(element.duration)) {
      try { element.currentTime = Math.min(position.current, element.duration); }
      catch { /* Metadata does not guarantee the source is seekable. */ }
    }
  };
  const renderer = grant ? mediaPreviewKind(grant.mime) : "unknown";
  const metadata = [
    artifact.width != null && artifact.height != null ? `${artifact.width} × ${artifact.height}` : "尺寸未提供",
    artifact.duration_ms != null ? `${(artifact.duration_ms / 1000).toLocaleString()} 秒` : "时长未提供",
  ].join(" · ");

  return (
    <article ref={card} tabIndex={-1} className="task-artifact-card">
      <div className="task-artifact-body">
        <strong>{artifact.name || artifact.ref}</strong>
        <p className="text-sm">{mediaKindLabel(kind)} · {artifact.mime || "MIME 未提供"} · {artifact.bytes === null ? "大小未知" : `${artifact.bytes} bytes`}</p>
        <p className="text-xs text-muted-foreground">{metadata}</p>
        <p className="break-all text-xs text-muted-foreground">{artifact.ref}</p>
        <p role="status" className="text-sm task-artifact-permission">{contentStateMessage(content)}</p>
        {!previewable && <p className="text-sm">当前来源未提供可预览媒体。</p>}
        <div className="task-artifact-actions">
          <Button disabled={busy || !canPreview} onClick={(event) => { trigger.current = event.currentTarget; void access("preview"); }}>
            <Eye size={15} /> 预览
          </Button>
          <Button disabled={busy || !canDownload} onClick={() => void access("download")}><Download size={15} /> 下载结果</Button>
        </div>
        {content === "supported" && (!canPreview || !canDownload) && <p className="text-xs text-muted-foreground">未启用的动作不代表已获授权；请检查来源的逐结果权限。</p>}
        {busy && !previewOpen && <p role="status">正在获取下载句柄…</p>}
        {error && !previewOpen && <p role="alert" className="task-artifact-error">{mediaErrorMessage(error)}</p>}
      </div>
      <Dialog.Root open={previewOpen} onOpenChange={(open) => { if (!open) closePreview(); }}>
        <Dialog.Portal>
          <Dialog.Overlay className="modal-overlay task-preview-overlay" data-task-preview />
          <Dialog.Content
            className="task-preview-dialog" data-task-preview
            onEscapeKeyDown={(event) => { event.preventDefault(); event.stopPropagation(); closePreview(); }}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              if (trigger.current?.isConnected && !trigger.current.disabled) trigger.current.focus({ preventScroll: true });
              else card.current?.focus({ preventScroll: true });
            }}
          >
            <div className="task-preview-heading">
              <div>
                <Dialog.Title>{artifact.name || mediaKindLabel(kind)}</Dialog.Title>
                <Dialog.Description className="task-preview-description">{grant?.mime || artifact.mime || "MIME 未提供"} · {artifact.ref}</Dialog.Description>
              </div>
              <Dialog.Close className="icon-button" aria-label="关闭预览"><X size={18} /></Dialog.Close>
            </div>
            {busy && <div className="task-preview-state" role="status">正在获取受控预览…</div>}
            {!busy && error && <div className="task-preview-state">
              <p role="alert">{mediaErrorMessage(error)}</p>
              <Button disabled={!canPreview} onClick={() => void access("preview")}>重新获取预览</Button>
            </div>}
            {!busy && grant && canPreview && renderer === "image" && <img src={grant.url} alt={artifact.name || "任务结果图片"} className="task-preview-media" onError={failed} />}
            {!busy && grant && canPreview && renderer === "video" && <video ref={media as React.RefObject<HTMLVideoElement | null>} aria-label={artifact.name || "任务视频"} className="task-preview-media" controls preload="metadata" src={grant.url} onLoadedMetadata={restorePosition} onError={failed} />}
            {!busy && grant && canPreview && renderer === "audio" && <audio ref={media as React.RefObject<HTMLAudioElement | null>} aria-label={artifact.name || "任务音频"} className="task-preview-audio" controls preload="metadata" src={grant.url} onLoadedMetadata={restorePosition} onError={failed} />}
            <p className="text-xs text-muted-foreground">{metadata}</p>
            {grant && <p className="text-xs text-muted-foreground">有效至 {new Date(grant.expires_at).toLocaleTimeString()}；续期需要手动重新获取。</p>}
            <p className="text-xs text-muted-foreground">预览不代表人工接受或采用。</p>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </article>
  );
}
