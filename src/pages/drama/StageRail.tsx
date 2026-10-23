import type { ReactNode } from "react";
import { Check, CheckCircle2, ChevronRight, CircleAlert, CircleDashed, CircleSlash, Clock3, Eye, LoaderCircle, LockKeyhole, Plug, ShieldQuestion } from "../../icons";
import { Pill, cx } from "../../components/ui";
import type { CreativeFlowStage } from "../../shared/creative-flow";
import type { DramaRailStage } from "../../shared/drama";
import { dramaOwnerNames, dramaStageLabels, railNodeInfo, type RailShape } from "../../shared/read-model/drama";

export const railShapeIcons: Record<RailShape, ReactNode> = {
  check: <CheckCircle2 />,
  tick: <Check />,
  eye: <Eye />,
  spin: <LoaderCircle className="motion-safe:animate-spin [animation-duration:2.4s]" />,
  alert: <CircleAlert />,
  clock: <Clock3 />,
  dashed: <CircleDashed />,
  plug: <Plug />,
  slash: <CircleSlash />,
  lock: <LockKeyhole />,
  question: <ShieldQuestion />,
};

/** The accessible name carries the state in words, so the shape and colour are never the only signal. */
export function stageNodeName(node: DramaRailStage) {
  return `${dramaStageLabels[node.stage]}：${railNodeInfo(node).label}（${dramaOwnerNames[node.owner]}）`;
}

export function StageNode({ node, current, showState = false }: { node: DramaRailStage; current?: boolean; showState?: boolean }) {
  const info = railNodeInfo(node);
  return <Pill
    tone={info.tone}
    size="sm"
    icon={railShapeIcons[info.shape]}
    title={stageNodeName(node)}
    className={cx(current && "ring-1 ring-current")}
  >
    <span aria-hidden="true">{dramaStageLabels[node.stage]}{showState ? ` · ${info.label}` : ""}</span>
    <span className="sr-only">{stageNodeName(node)}</span>
  </Pill>;
}

/** Five fixed stages in pipeline order. `current` marks the stage the owner flags as next. */
export function StageRail({ rail, current, showState = false, className }: { rail: DramaRailStage[]; current?: CreativeFlowStage; showState?: boolean; className?: string }) {
  return <ol aria-label="阶段链" className={cx("flex flex-wrap items-center gap-x-0.5 gap-y-1", className)}>
    {rail.map((node, index) => <li key={node.stage} data-stage={node.stage} data-state={node.state} aria-current={node.stage === current ? "step" : undefined} className="flex items-center gap-0.5">
      {index > 0 && <ChevronRight aria-hidden="true" className="size-3 shrink-0 text-faint" />}
      <StageNode node={node} current={node.stage === current} showState={showState} />
    </li>)}
  </ol>;
}
