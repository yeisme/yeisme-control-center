import type { ReactNode } from "react";
import { CheckCircle2, CircleAlert, CircleDashed, CircleSlash, Clock3, Eye, LoaderCircle, LockKeyhole, Plug, ShieldQuestion } from "../../icons";
import { cx } from "./cx";
import { taskStateLabels } from "../../task-observation";
import { coverageLabels, type CoverageState } from "../../request-visibility";

export type Tone = "success" | "info" | "warning" | "danger" | "review" | "neutral";

const toneClass: Record<Tone, string> = {
  success: "bg-success-soft text-success",
  info: "bg-info-soft text-info",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
  review: "bg-review-soft text-review",
  neutral: "bg-neutral-soft text-neutral",
};

const dotClass: Record<Tone, string> = {
  success: "bg-success",
  info: "bg-info",
  warning: "bg-warning",
  danger: "bg-danger",
  review: "bg-review",
  neutral: "bg-neutral",
};

export function Pill({ tone = "neutral", icon, children, className, title, size = "md" }: { tone?: Tone; icon?: ReactNode; children: ReactNode; className?: string; title?: string; size?: "sm" | "md" }) {
  return <span title={title} className={cx("inline-flex max-w-full shrink-0 items-center gap-1 rounded-chip font-medium leading-none whitespace-nowrap [&>svg]:shrink-0", size === "sm" ? "h-5 px-1.5 text-2xs [&>svg]:size-3" : "h-6 px-2 text-xs [&>svg]:size-3.5", toneClass[tone], className)}>
    {icon}
    <span className="truncate">{children}</span>
  </span>;
}

export function Dot({ tone = "neutral", ring = false, className }: { tone?: Tone; ring?: boolean; className?: string }) {
  return <span aria-hidden="true" className={cx("inline-flex size-2 shrink-0 rounded-full", dotClass[tone], ring && "ring-4 ring-current/15", className)} />;
}

const activeStates = new Set(["queued", "pending", "created", "running", "cancel_requested"]);

export function taskTone(state: string): Tone {
  if (["succeeded", "completed", "handoff_ready", "dry_run"].includes(state)) return "success";
  if (state === "running" || state === "cancel_requested") return "info";
  if (["queued", "pending", "created", "cancelled", "canceled"].includes(state)) return "neutral";
  if (["failed", "rejected", "partial_failed"].includes(state)) return "danger";
  if (state === "waiting_review") return "review";
  return "warning";
}

export function taskStateLabel(state: string) {
  return taskStateLabels[state] || (state ? state : "结果未知");
}

export function TaskStatePill({ state, className }: { state: string; className?: string }) {
  const tone = taskTone(state);
  const icon = state === "running" ? <LoaderCircle className="motion-safe:animate-spin [animation-duration:2.4s]" /> : tone === "success" ? <CheckCircle2 /> : tone === "danger" ? <CircleAlert /> : tone === "review" ? <Eye /> : activeStates.has(state) ? <Clock3 /> : tone === "warning" ? <ShieldQuestion /> : <CircleDashed />;
  return <Pill tone={tone} icon={icon} className={className}>{taskStateLabel(state)}</Pill>;
}

export function coverageTone(state: CoverageState | string): Tone {
  if (state === "complete") return "success";
  if (state === "partial" || state === "pending") return "info";
  if (state === "forbidden" || state === "integrity_failed") return "danger";
  if (state === "unavailable" || state === "expired") return "warning";
  if (state === "needs_contract") return "review";
  return "neutral";
}

export function CoverageChip({ state, owner, reason, className }: { state: CoverageState | string; owner?: string; reason?: string; className?: string }) {
  const label = coverageLabels[state as CoverageState] || state;
  const icon = state === "forbidden" ? <LockKeyhole /> : state === "needs_contract" ? <Plug /> : state === "unavailable" ? <CircleSlash /> : state === "complete" ? <CheckCircle2 /> : <CircleDashed />;
  return <Pill tone={coverageTone(state)} icon={icon} className={className} title={reason ? `${owner ? ownerLabel(owner) + " · " : ""}${reason}` : undefined}>
    {owner ? <><span className="font-semibold">{ownerLabel(owner)}</span><span className="opacity-80"> · {label}</span></> : label}
  </Pill>;
}

export const ownerNames: Record<string, string> = { eikona: "Eikona", scaena: "Scaena", sonora: "Sonora", aigora: "Aigora", gateway: "MCP Gateway", auctra: "Auctra", muweave: "MuWeave" };
export function ownerLabel(owner: string) {
  return ownerNames[owner] || owner;
}
