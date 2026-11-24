import { useState } from "react";
import { Bot, CheckCircle2, CircleDashed, Sparkles } from "../../icons";
import { Button, CopyRef, Facts, InlineNotice } from "../../components/ui";
import { InspectorShell, type InspectorMode } from "../../components/InspectorShell";
import { cameraAngleLabel, cameraMovementLabel, formatShotDuration, shotSizeLabel } from "../../shared/read-model/drama";
import type { BoardShot } from "./ShotBoard";

/**
 * One shot of the board in the right-hand panel: its camera words and length, the two flags Scaena gives, and its
 * reference. Scaena does not say which picture a shot is bound to, so the panel shows the binding's state only.
 */
export function ShotInspector({ shots, shot, sceneOrder, mode, onModeChange, onClose, onStep, onHandOff }: {
  shots: BoardShot[];
  shot: BoardShot;
  sceneOrder?: number;
  mode: InspectorMode;
  onModeChange: (mode: InspectorMode) => void;
  onClose: () => void;
  /** The shot before or after this one in board order; the page steps from the address, so quick presses add up. */
  onStep: (delta: -1 | 1) => void;
  onHandOff: () => void;
}) {
  const [maximized, setMaximized] = useState(false);
  const index = shots.findIndex((item) => item.shot_ref === shot.shot_ref);
  const previous = shots[index - 1];
  const next = shots[index + 1];
  const unknown = "Scaena 没有给出";
  return <InspectorShell
    open
    mode={mode}
    maximized={maximized}
    onModeChange={onModeChange}
    onMaximize={() => setMaximized((value) => !value)}
    onClose={onClose}
    label="镜头"
    ariaLabel="镜头详情"
    closeAriaLabel="关闭镜头详情"
    dataAttribute="data-shot-inspector"
    itemKey={shot.shot_ref}
    followRow={`li[data-shot="${CSS.escape(shot.shot_ref)}"]`}
    stepper={{ noun: "镜", previous: previous ? () => onStep(-1) : undefined, next: next ? () => onStep(1) : undefined, position: `${index + 1} / ${shots.length}` }}
    header={<div className="min-w-0">
      <p className="text-2xs font-medium text-muted">{sceneOrder ? `第 ${sceneOrder} 场` : "场次未提供"}{shot.heading ? ` · ${shot.heading}` : ""}</p>
      <h2 className="mt-0.5 font-display text-title font-semibold text-ink">镜头 {String(shot.order).padStart(2, "0")}</h2>
      <p className="mt-1 text-body-sm text-muted">{formatShotDuration(shot.duration_ms)}</p>
    </div>}
    sections={[{ id: "camera", label: "镜头" }, { id: "state", label: "状态" }, { id: "reference", label: "引用" }]}
    footer={<Button size="sm" variant="secondary" icon={<Bot className="size-3.5" />} onClick={onHandOff}>把这一镜交给 Agent</Button>}
  >
    <section data-inspector-section="camera" tabIndex={-1} className="scroll-mt-24 space-y-3">
      <h3 className="text-body-sm font-semibold text-ink">镜头</h3>
      <Facts columns={2} items={[
        { label: "景别", value: shotSizeLabel(shot.shot_size) === "—" ? unknown : shotSizeLabel(shot.shot_size) },
        { label: "角度", value: cameraAngleLabel(shot.camera_angle) === "—" ? unknown : cameraAngleLabel(shot.camera_angle) },
        { label: "运镜", value: cameraMovementLabel(shot.camera_movement) === "—" ? unknown : cameraMovementLabel(shot.camera_movement) },
        { label: "时长", value: formatShotDuration(shot.duration_ms) },
      ]} />
    </section>
    <section data-inspector-section="state" tabIndex={-1} className="mt-6 scroll-mt-24 space-y-3">
      <h3 className="text-body-sm font-semibold text-ink">状态</h3>
      <Facts columns={2} items={[
        { label: "可以生成", value: shot.generation_ready === true ? <span className="inline-flex items-center gap-1 text-primary"><Sparkles aria-hidden="true" className="size-3.5" />可以</span> : shot.generation_ready === false ? "还不行" : unknown },
        { label: "画面", value: shot.frame_state === "ready" ? <span className="inline-flex items-center gap-1 text-success"><CheckCircle2 aria-hidden="true" className="size-3.5" />已绑定</span> : shot.frame_state ? <span className="inline-flex items-center gap-1"><CircleDashed aria-hidden="true" className="size-3.5" />待绑定</span> : unknown },
      ]} />
      <InlineNotice tone="neutral">Scaena 只告诉这一镜的画面是否已经绑定，没有说是哪一张，所以这里不显示画面。</InlineNotice>
    </section>
    <section data-inspector-section="reference" tabIndex={-1} className="mt-6 scroll-mt-24 space-y-2">
      <h3 className="text-body-sm font-semibold text-ink">引用</h3>
      <p className="text-2xs text-muted">贴给 Agent 或在 Scaena 里搜索时用。</p>
      <dl className="space-y-1.5">
        <div className="flex min-w-0 items-center gap-3"><dt className="w-10 shrink-0 text-2xs text-muted">镜头</dt><dd className="min-w-0"><CopyRef value={shot.shot_ref} label="镜头引用" /></dd></div>
        <div className="flex min-w-0 items-center gap-3"><dt className="w-10 shrink-0 text-2xs text-muted">场景</dt><dd className="min-w-0"><CopyRef value={shot.scene_ref} label="场景引用" /></dd></div>
      </dl>
    </section>
  </InspectorShell>;
}
