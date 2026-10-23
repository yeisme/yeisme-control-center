import { ArrowRight } from "../../icons";
import { EmptyState, Facts, InlineNotice, Pill, TaskStatePill, ownerLabel, CopyRef } from "../../components/ui";
import type { StoryboardOutline } from "../../shared/drama";
import { formatRelative } from "../../shared/read-model/format";
import { cameraAngleLabel, cameraMovementLabel, formatShotDuration, railStateInfo, shotSizeLabel } from "../../shared/read-model/drama";
import type { TaskSnapshot } from "../../task-observation";
import { railShapeIcons } from "./StageRail";

export function OutlineSection({ outline, emptyReason }: { outline?: StoryboardOutline; emptyReason: string }) {
  if (!outline) return <EmptyState compact title="还没有分镜拆解" body={emptyReason} />;
  const info = railStateInfo[outline.head_state];
  return <div className="space-y-3">
    {outline.truncated && <InlineNotice tone="info">Scaena 还有更早的拆解尝试未读取；这里只展示最新一次。</InlineNotice>}
    <Facts columns={2} items={[
      { label: "当前拆解", value: <CopyRef value={outline.head_breakdown_ref} label="拆解引用" /> },
      { label: "状态", value: <Pill tone={info.tone} icon={railShapeIcons[info.shape]}>{info.label}</Pill> },
      { label: "场 / 镜", value: `${outline.scene_count} 场 · ${outline.shot_count} 镜` },
      { label: "总时长", value: formatShotDuration(outline.duration_ms) },
      { label: "审阅发现", value: outline.finding_count === null ? "未提供" : `${outline.finding_count} 项` },
      { label: "更早尝试", value: outline.older_attempts ? `${outline.older_attempts} 次` : "无" },
    ]} />
    {outline.scenes.length === 0
      ? <p className="text-body-sm text-muted">Scaena 没有返回场景结构，只提供了数量。</p>
      : <div className="space-y-2">{outline.scenes.map((scene, index) => <details key={scene.scene_ref} open={index === 0} className="rounded-control border border-line bg-panel-soft">
        <summary className="flex cursor-pointer select-none items-center gap-2 px-3 py-2 text-body-sm font-medium text-ink">
          <span className="text-2xs tabular text-muted">场 {scene.order}</span>
          <span className="min-w-0 flex-1 truncate">{scene.heading || scene.scene_ref}</span>
          <span className="text-2xs font-normal text-muted">{scene.shots.length} 镜</span>
        </summary>
        {scene.shots.length > 0 && <div className="overflow-x-auto border-t border-line">
          <table className="w-full min-w-[420px] text-left text-2xs">
            <caption className="sr-only">{scene.heading || scene.scene_ref} 的镜头</caption>
            <thead className="text-muted"><tr><th scope="col" className="px-3 py-1.5 font-medium">镜</th><th scope="col" className="px-3 py-1.5 font-medium">景别</th><th scope="col" className="px-3 py-1.5 font-medium">角度</th><th scope="col" className="px-3 py-1.5 font-medium">运镜</th><th scope="col" className="px-3 py-1.5 text-right font-medium">时长</th></tr></thead>
            <tbody className="divide-y divide-line">{scene.shots.map((shot) => <tr key={shot.shot_ref}>
              <th scope="row" className="px-3 py-1.5 font-mono font-normal text-ink-soft" title={shot.shot_ref}>{shot.order}</th>
              <td className="px-3 py-1.5">{shotSizeLabel(shot.shot_size)}</td>
              <td className="px-3 py-1.5">{cameraAngleLabel(shot.camera_angle)}</td>
              <td className="px-3 py-1.5">{cameraMovementLabel(shot.camera_movement)}</td>
              <td className="tabular px-3 py-1.5 text-right">{formatShotDuration(shot.duration_ms)}</td>
            </tr>)}</tbody>
          </table>
        </div>}
      </details>)}</div>}
  </div>;
}

export function TaskSection({ tasks, onOpen }: { tasks: TaskSnapshot[]; onOpen: (task: TaskSnapshot) => void }) {
  if (!tasks.length) return <p className="text-body-sm text-muted">没有任务带有这一集的引用。任务状态只表示机器执行，不代表审阅或采用。</p>;
  return <div className="space-y-2">
    <ul className="divide-y divide-line rounded-control border border-line bg-panel-soft">
      {tasks.slice(0, 8).map((task) => <li key={task.task_key || task.locator.task_ref}>
        <button type="button" onClick={() => onOpen(task)} className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-panel-sunken focus-visible:outline-2 focus-visible:outline-focus">
          <span className="min-w-0 flex-1">
            <span className="block truncate text-body-sm font-medium text-ink">{task.title}</span>
            <span className="block truncate text-2xs text-muted">{ownerLabel(task.locator.owner)} · {task.results.length} 个结果 · {formatRelative(task.updated_at || task.created_at)}</span>
          </span>
          <TaskStatePill state={task.state} />
          <ArrowRight className="size-3.5 shrink-0 text-faint" />
        </button>
      </li>)}
    </ul>
    {tasks.length > 8 && <p className="text-2xs text-muted">另有 {tasks.length - 8} 个任务，可在任务中心查看。</p>}
    <p className="text-2xs text-muted">任务状态只表示机器执行，不代表审阅或采用。</p>
  </div>;
}
