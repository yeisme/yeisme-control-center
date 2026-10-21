import { Download, Eye, LoaderCircle, LockKeyhole, ShieldQuestion } from "../icons";
import { Button, KindBadge, cx } from "./ui";
import { kindLabel, type MediaKind } from "./ui/Kind";
import { resultAction, resultMeta } from "../shared/read-model/tasks";
import type { TaskArtifact, TaskSnapshot } from "../task-observation";
import { InlineMediaPreview, type MediaPreviewController, type PreviewTarget } from "./media-preview";
import { grantErrorLabel } from "./media-preview";

/** Result metadata, actions and the compact Inspector preview surface. */
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
  const selected = preview.target?.key === target.key && preview.status !== "closed";
  const requesting = preview.status === "requesting" && preview.target?.key === target.key;
  const targetError = preview.target?.key === target.key ? preview.error : null;

  const openPreview = () => {
    if (!previewAction.enabled) return;
    preview.open(target, { source: "detail-sheet", autoplay: kind !== "audio", history: "replace" });
  };

  return <div className={cx("rounded-[12px] border border-line bg-panel", compact ? "p-3" : "p-3.5")}>
    <div className="flex items-start gap-3">
      <KindBadge kind={kind} size="sm" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium text-ink">{result.name || "未命名结果"}</p>
        <p className="mt-0.5 truncate text-2xs text-muted">{[kindLabel(kind), ...resultMeta(result)].join(" · ")}{result.state ? ` · ${result.state}` : ""}</p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button size="sm" variant={active ? "primary" : "ghost"} disabled={!previewAction.enabled || requesting} title={previewAction.reason || "申请短期预览句柄"} aria-label={`${kind === "audio" ? "播放" : "预览"} ${result.name || "未命名结果"}`} onClick={openPreview} icon={requesting ? <LoaderCircle className="size-3.5 motion-safe:animate-spin" /> : <Eye className="size-3.5" />}>{active ? "已预览" : kind === "audio" ? "播放" : "预览"}</Button>
        <Button size="sm" variant="ghost" disabled={!downloadAction.enabled || preview.pendingDownload} title={downloadAction.reason || "申请短期下载句柄"} onClick={() => void preview.download(target)} icon={preview.pendingDownload ? <LoaderCircle className="size-3.5 motion-safe:animate-spin" /> : <Download className="size-3.5" />}>下载</Button>
      </div>
    </div>
    {selected && showPreview && <div className="mt-3 space-y-2"><InlineMediaPreview controller={preview} /><p className="rounded-[9px] bg-primary-soft px-2.5 py-2 text-2xs text-primary">媒体预览已在右侧栏打开。</p></div>}
    {!previewAction.enabled && <p className="mt-3 flex items-center gap-1.5 text-2xs text-muted"><LockKeyhole className="size-3" />{previewAction.reason}</p>}
    {targetError && <div className="mt-3 flex items-center gap-2 text-2xs text-warning"><ShieldQuestion className="size-3.5 shrink-0" /><span className="min-w-0 flex-1">{grantErrorLabel(targetError)}</span>{previewAction.enabled && <button type="button" className="font-medium hover:underline" onClick={preview.retry}>重新申请</button>}</div>}
  </div>;
}
