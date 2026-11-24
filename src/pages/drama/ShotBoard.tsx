import { Bot, CheckCircle2, CircleDashed, Sparkles } from "../../icons";
import { Button, EmptyState, InlineNotice, cx, moveBetweenRows } from "../../components/ui";
import type { StoryboardOutline, StoryboardOutlineShot } from "../../shared/drama";
import { cameraAngleLabel, cameraMovementLabel, formatShotDuration, shotSizeLabel } from "../../shared/read-model/drama";
import { shotLine } from "../../shared/read-model/production";

export type BoardShot = StoryboardOutlineShot & { scene_ref: string; heading?: string };

/**
 * The episode as a storyboard: scenes in order, each shot as a card with its camera words, length, and the two flags
 * Scaena gives (ready to generate, keyframe bound). A missing flag stays blank instead of reading as "no". Given
 * `onOpen`, a card opens its shot in the right-hand panel, and the arrow keys move between cards across the scenes.
 */
export function ShotBoard({ outline, emptyReason, onHandOff, onOpen, openShot }: { outline?: StoryboardOutline; emptyReason: string; onHandOff: (shot: BoardShot) => void; onOpen?: (shot: string) => void; openShot?: string | null }) {
  if (!outline) return <EmptyState compact title="还没有分镜拆解" body={emptyReason} />;
  const shots = outline.scenes.flatMap((scene) => scene.shots);
  const summary = {
    total: outline.shot_count || shots.length,
    ...(shots.some((shot) => typeof shot.generation_ready === "boolean") ? { generation_ready: shots.filter((shot) => shot.generation_ready).length } : {}),
    ...(shots.some((shot) => shot.frame_state) ? { frames_ready: shots.filter((shot) => shot.frame_state === "ready").length } : {}),
  };
  return <div className="space-y-5" data-shot-board onKeyDown={onOpen ? (event) => moveBetweenRows(event, "grid") : undefined}>
    <p className="text-body-sm text-muted">{outline.scene_count} 场 · {shotLine(summary)} · 总长 {formatShotDuration(outline.duration_ms)}</p>
    {outline.truncated && <InlineNotice tone="info">Scaena 还有更早的拆解尝试没有读取；这里只看最新一次。</InlineNotice>}
    {outline.scenes.length === 0 && <p className="text-body-sm text-muted">Scaena 只给了数量，没有给场景结构。</p>}
    {outline.scenes.map((scene) => <section key={scene.scene_ref} aria-labelledby={`scene-${scene.scene_ref}`} className="space-y-3">
      <h3 id={`scene-${scene.scene_ref}`} className="flex items-baseline gap-2">
        <span className="text-2xs tabular text-muted">第 {scene.order} 场</span>
        <span className="font-display text-[18px] font-semibold text-ink">{scene.heading || scene.scene_ref}</span>
        <span className="text-2xs text-muted">{scene.shots.length} 镜</span>
      </h3>
      {scene.shots.length > 0 && <ul className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(180px,1fr))]">
        {scene.shots.map((shot) => <li key={shot.shot_ref} data-shot={shot.shot_ref} data-frame={shot.frame_state || "unknown"} data-selected={openShot === shot.shot_ref || undefined} className={cx("relative flex min-w-0 flex-col rounded-[16px] border bg-panel p-3.5 shadow-card transition-[border-color,box-shadow] duration-150", openShot === shot.shot_ref ? "border-primary shadow-selected" : "border-line hover:border-line-strong")}>
          {onOpen && <button type="button" data-row-button aria-label={`打开第 ${scene.order} 场镜头 ${shot.order} 的详情`} aria-current={openShot === shot.shot_ref || undefined} onClick={() => onOpen(shot.shot_ref)} className="absolute inset-0 z-[1] rounded-[16px] focus-visible:outline-2 focus-visible:outline-focus focus-visible:outline-offset-[-3px]" />}
          <div className="flex items-center justify-between gap-2">
            <span className="font-display text-[20px] font-semibold leading-none tabular text-ink">{String(shot.order).padStart(2, "0")}</span>
            <span className="tabular text-2xs text-muted">{formatShotDuration(shot.duration_ms)}</span>
          </div>
          <p className="mt-2 text-body-sm text-ink-soft">{[shotSizeLabel(shot.shot_size), cameraAngleLabel(shot.camera_angle), cameraMovementLabel(shot.camera_movement)].filter((part) => part !== "—").join(" · ") || "镜头信息未提供"}</p>
          <p className="mt-1 truncate font-mono text-2xs text-faint" title={shot.shot_ref}>{shot.shot_ref}</p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {shot.frame_state && <span className={cx("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-2xs font-medium", shot.frame_state === "ready" ? "bg-success-soft text-success" : "bg-panel-sunken text-ink-soft")}>{shot.frame_state === "ready" ? <CheckCircle2 aria-hidden="true" className="size-3" /> : <CircleDashed aria-hidden="true" className="size-3" />}{shot.frame_state === "ready" ? "画面已绑定" : "待绑定画面"}</span>}
            {shot.generation_ready === true && <span className="inline-flex items-center gap-1 rounded-full bg-primary-soft px-2 py-0.5 text-2xs font-medium text-primary"><Sparkles aria-hidden="true" className="size-3" />可生成</span>}
          </div>
          <Button size="sm" variant="ghost" className="relative z-[2] mt-3 -ml-2 self-start" icon={<Bot className="size-3.5" />} aria-label={`把镜头 ${shot.order} 交给 Agent`} onClick={() => onHandOff({ ...shot, scene_ref: scene.scene_ref, heading: scene.heading })}>交给 Agent</Button>
        </li>)}
      </ul>}
    </section>)}
  </div>;
}
