import { CircleAlert, CircleDashed, CheckCircle2, Clock3, Network, RefreshCw } from "../icons";
import type { TaskConnectionState } from "../task-observation";
import type { ServiceDirectoryEntry } from "../service-directory";
import { formatRelative } from "../shared/read-model/format";
import { readErrorMessage, type ReadStatus } from "../shared/read-model/read-state";
import { Button, Pill, Tooltip, cx, type Tone } from "./ui";

type SourceState = "ready" | "partial" | "unavailable" | "forbidden" | "stale" | "needs_contract" | "not_observed";
const sourceOwners = ["aigora", "scaena", "eikona", "sonora"] as const;
const sourceLabels: Record<typeof sourceOwners[number], string> = { aigora: "Aigora", scaena: "Scaena", eikona: "Eikona", sonora: "Sonora" };
const stateMeta: Record<SourceState, { label: string; tone: Tone }> = {
  ready: { label: "可读", tone: "success" },
  partial: { label: "部分可读", tone: "warning" },
  unavailable: { label: "来源不可用", tone: "danger" },
  forbidden: { label: "无权限", tone: "danger" },
  stale: { label: "数据过期", tone: "warning" },
  needs_contract: { label: "待合同", tone: "review" },
  not_observed: { label: "尚未观测", tone: "neutral" },
};

function statusFor(service: ServiceDirectoryEntry | undefined, connections: TaskConnectionState[], readStatus: ReadStatus = "ready") {
  if (readStatus === "unavailable") return "unavailable" as const;
  if (readStatus === "forbidden") return "forbidden" as const;
  if (readStatus === "stale") return "stale" as const;
  if (readStatus === "needs_contract") return "needs_contract" as const;
  if (readStatus === "loading") return "not_observed" as const;
  const states = [
    ...(service?.connections || []).map((connection) => connection.runtime?.state),
    ...connections.filter((connection) => connection.owner === service?.id).map((connection) => connection.state),
  ].filter(Boolean) as string[];
  const coverage = service?.coverage?.state;
  if (states.some((state) => ["forbidden", "needs_authorization", "owner_action_denied"].includes(state)) || coverage === "forbidden") return "forbidden" as const;
  if (states.some((state) => ["source_unavailable", "source_rate_limited", "source_busy"].includes(state)) || coverage === "unavailable") return states.some((state) => state === "ready") ? "partial" as const : "unavailable" as const;
  if (states.some((state) => state === "stale") || coverage === "stale") return "stale" as const;
  if (states.length && states.every((state) => state === "ready")) return "ready" as const;
  if (states.some((state) => ["needs_contract", "owner_action_contract_missing"].includes(state)) || coverage === "needs_contract" || service?.integration === "not_integrated") return "needs_contract" as const;
  return "not_observed" as const;
}

function statusIcon(state: SourceState) {
  if (state === "ready") return <CheckCircle2 />;
  if (state === "unavailable" || state === "forbidden") return <CircleAlert />;
  if (state === "stale") return <Clock3 />;
  if (state === "needs_contract") return <Network />;
  return <CircleDashed />;
}

export function SourceCoverage({ services, connections = [], readStatus = "ready", error, onRetry, className }: { services: ServiceDirectoryEntry[]; connections?: TaskConnectionState[]; readStatus?: ReadStatus; error?: string | null; onRetry?: () => void; className?: string }) {
  const readMessage = readStatus === "unavailable" ? "来源读取失败，未用本地或演示数据补齐。" : readStatus === "forbidden" ? "当前身份没有读取这些来源的权限。" : readStatus === "needs_contract" ? "来源尚未提供可读取合同。" : readStatus === "stale" ? "显示最近一次读取结果，当前来源可能已过期。" : readStatus === "loading" ? "正在读取来源状态。" : error ? readErrorMessage(error) : undefined;
  return <section aria-label="来源覆盖" className={cx("min-w-0 rounded-card border border-line bg-panel px-4 py-3 shadow-panel", className)}>
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <h2 className="shrink-0 text-body-sm font-semibold text-ink">来源覆盖<span className="ml-2 text-2xs font-normal text-muted">只读观察</span></h2>
      <ul className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
        {sourceOwners.map((owner) => {
          const service = services.find((item) => item.id === owner);
          const state = statusFor(service, connections, readStatus);
          const meta = stateMeta[state];
          const observedAt = service?.observed_at || service?.coverage?.observed_at || service?.connections.find((connection) => connection.runtime)?.runtime?.checked_at;
          const explicitReason = service?.connections.find((connection) => connection.runtime?.reason)?.runtime?.reason;
          const reason = explicitReason || (state === "ready" ? undefined : service?.gap);
          const detail = reason || (state === "ready" ? "owner 返回了当前范围的只读观察。" : "没有用本地任务或演示数据补齐来源状态。");
          return <li key={owner}>
            <Tooltip content={<><span className="block">{detail}</span><span className="mt-0.5 block opacity-75">{observedAt ? `观察于 ${formatRelative(observedAt)}` : "观察时间未提供"}</span></>}>
              <span tabIndex={0} className="inline-flex rounded-chip outline-none focus-visible:ring-2 focus-visible:ring-focus">
                <Pill tone={meta.tone} icon={statusIcon(state)}><span className="font-semibold">{sourceLabels[owner]}</span><span className="opacity-80"> · {meta.label}</span></Pill>
              </span>
            </Tooltip>
          </li>;
        })}
      </ul>
      {readMessage && onRetry && <Button size="sm" variant="ghost" onClick={onRetry} icon={<RefreshCw className="size-3.5" />}>重新读取</Button>}
    </div>
    {readMessage && <p className="mt-2 text-2xs text-muted" role={readStatus === "unavailable" || readStatus === "forbidden" ? "alert" : "status"}>{readMessage}</p>}
  </section>;
}
