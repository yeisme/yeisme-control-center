import { Download, Eye, LoaderCircle, LockKeyhole, ShieldQuestion } from "../icons";
import { Button, KindBadge, cx } from "./ui";
import { kindLabel, type MediaKind } from "./ui/Kind";
import { resultAction, resultMeta } from "../shared/read-model/tasks";
import type { TaskArtifact, TaskSnapshot } from "../task-observation";
import { type MediaPreviewController, type PreviewTarget } from "./media-preview";
import { grantErrorLabel } from "./media-preview";
import { audioTrackFrom, useTrackPhase } from "../app/audio-player";
import { AudioPlayButton, AudioScrubber } from "./AudioDock";

/** Result metadata and actions; visual previews open the full-screen viewer, audio plays in the global player. */
export function ResultViewer({ task, result, kind, preview, compact = false, showPreview = true }: { task: TaskSnapshot; result: TaskArtifact; kind: MediaKind; preview: MediaPreviewController; compact?: boolean; showPreview?: boolean }) {
  const target: PreviewTarget = {
    key: `${task.task_key || task.locator.task_ref}:${result.ref}`,
    task,
    result,
    kind,
  };
  const previewAction = resultAction(task, "preview");
  const downloadAction = resultAction(task, "download");
  const active = preview.isActive(target.key);
  const requesting = preview.status === "requesting" && preview.target?.key === target.key;
  const targetError = preview.target?.key === target.key ? preview.error : null;

  const openPreview = () => {
    if (!previewAction.enabled || requesting) return;
    // Visual results open the full-screen viewer; Back or Esc returns to this Inspector.
    preview.open(target, { source: "detail-sheet", autoplay: true, history: "push" });
  };
  if (kind === "audio") return <AudioResult target={target} preview={preview} compact={compact} showProgress={showPreview} />;

  return <div className={cx("rounded-[12px] border border-line bg-panel", compact ? "p-3" : "p-3.5")}>
    <div className="flex items-start gap-3">
      <KindBadge kind={kind} size="sm" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium text-ink">{result.name || "未命名结果"}</p>
        <p className="mt-0.5 truncate text-2xs text-muted">{[kindLabel(kind), ...resultMeta(result)].join(" · ")}{result.state ? ` · ${result.state}` : ""}</p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {/* A request in flight keeps both buttons enabled: disabling them swaps in the tooltip wrapper, which remounts the
            button and loses focus, so the viewer opened from here had no button to return focus to. */}
        <Button size="sm" variant={active ? "primary" : "ghost"} disabled={!previewAction.enabled} aria-busy={requesting || undefined} title={previewAction.reason || "申请短期预览句柄"} aria-label={`预览 ${result.name || "未命名结果"}`} onClick={openPreview} icon={requesting ? <LoaderCircle className="size-3.5 motion-safe:animate-spin" /> : <Eye className="size-3.5" />}>{active ? "已预览" : "预览"}</Button>
        <Button size="sm" variant="ghost" disabled={!downloadAction.enabled} aria-busy={preview.pendingDownload || undefined} title={downloadAction.reason || "申请短期下载句柄"} onClick={() => { if (!preview.pendingDownload) void preview.download(target); }} icon={preview.pendingDownload ? <LoaderCircle className="size-3.5 motion-safe:animate-spin" /> : <Download className="size-3.5" />}>下载</Button>
      </div>
    </div>
    {!previewAction.enabled && <p className="mt-3 flex items-center gap-1.5 text-2xs text-muted"><LockKeyhole className="size-3" />{previewAction.reason}</p>}
    {targetError && <div className="mt-3 flex items-center gap-2 text-2xs text-warning"><ShieldQuestion className="size-3.5 shrink-0" /><span className="min-w-0 flex-1">{grantErrorLabel(targetError)}</span>{previewAction.enabled && <button type="button" className="font-medium hover:underline" onClick={preview.retry}>重新申请</button>}</div>}
  </div>;
}

/** Audio results play in the global player; the row mirrors its state and, when asked, its seek rail. */
function AudioResult({ target, preview, compact, showProgress }: { target: PreviewTarget; preview: MediaPreviewController; compact: boolean; showProgress: boolean }) {
  const { task, result } = target;
  const track = audioTrackFrom(target);
  const phase = useTrackPhase(target.key);
  const downloadAction = resultAction(task, "download");
  const previewAction = resultAction(task, "preview");
  return <div className={cx("rounded-[12px] border bg-panel", phase === "inactive" ? "border-line" : "border-kind-audio/35", compact ? "p-3" : "p-3.5")} data-audio-result={phase}>
    <div className="flex items-start gap-3">
      <KindBadge kind="audio" size="sm" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium text-ink">{result.name || "未命名结果"}</p>
        <p className="mt-0.5 truncate text-2xs text-muted">{[kindLabel("audio"), ...resultMeta(result)].join(" · ")}{result.state ? ` · ${result.state}` : ""}</p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {/* Where the parent already renders the audio stage (asset Inspector), the row keeps only download. */}
        {showProgress && (previewAction.enabled ? <AudioPlayButton track={track} /> : <Button size="sm" variant="ghost" disabled title={previewAction.reason || undefined} icon={<Eye className="size-3.5" />}>播放</Button>)}
        <Button size="sm" variant="ghost" disabled={!downloadAction.enabled} aria-busy={preview.pendingDownload || undefined} title={downloadAction.reason || "申请短期下载句柄"} onClick={() => { if (!preview.pendingDownload) void preview.download(target); }} icon={preview.pendingDownload ? <LoaderCircle className="size-3.5 motion-safe:animate-spin" /> : <Download className="size-3.5" />}>下载</Button>
      </div>
    </div>
    {showProgress && phase !== "inactive" && <AudioScrubber className="mt-3" label={`${track.title} 播放进度`} />}
    {!previewAction.enabled && <p className="mt-3 flex items-center gap-1.5 text-2xs text-muted"><LockKeyhole className="size-3" />{previewAction.reason}</p>}
  </div>;
}
