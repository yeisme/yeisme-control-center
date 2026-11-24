import { useScopedRead } from "../app/workspace";
import { api, isRouteUnavailable, type TaskSnapshot } from "../shared/api/control-center-client";
import { formatRelative } from "../shared/read-model/format";
import { labelFrom } from "../shared/read-model/labels";
import type { TaskReviewRead } from "../shared/task-review";
import { FactsWithGaps } from "./PromptCaptureSummary";

const decisionLabels: Record<string, string> = { pending: "还没有决定", accepted: "已采用", rejected: "未采用", request_revision: "要求修改" };
const admissionLabels: Record<string, string> = { unknown: "未记录", pending: "等待下游", admitted: "已进入下游", refused: "下游拒收" };
const unreadText: Record<string, string> = {
  review_observation_contract_missing: "这个 Eikona 还没有开放审阅状态的只读接口，暂时看不到它的决定。",
  needs_authorization: "这个连接的凭据没有读取审阅状态的权限。",
};

/**
 * Eikona's own review record for one run: its decision and counts, read through the task connection. Read-only;
 * deciding happens in Eikona. Other owners have no such contract, so nothing is shown for them.
 */
export function TaskReviewSummary({ task }: { task: TaskSnapshot }) {
  const key = task.task_key || "";
  const applies = task.locator.owner === "eikona" && task.locator.task_family === "run" && !!key;
  const read = useScopedRead<{ read: TaskReviewRead }>(async (scope, signal) => {
    try {
      const reviews = (await api.taskReviews(scope, [key], signal)).reviews;
      return { read: reviews[key] || { state: "unavailable", reason: "source_unavailable" } };
    } catch (error) {
      if (isRouteUnavailable(error)) return { read: { state: "needs_contract", reason: "review_observation_contract_missing" } };
      throw error;
    }
  }, { key: `task-review|${key}`, enabled: applies });
  if (!applies) return null;
  const review = read.data?.read;
  return <section data-task-review={review?.state || read.status} aria-label="Eikona 审阅记录" className="space-y-2">
    <h3 className="text-body-sm font-semibold text-ink">Eikona 审阅记录</h3>
    {!review && read.status === "loading" && <p className="text-2xs text-muted">正在读取 Eikona 的审阅记录…</p>}
    {!review && read.status !== "loading" && <p className="text-2xs text-muted">暂时读不到审阅记录；任务状态仍以 Eikona 为准。</p>}
    {review?.state === "observed" && <>
      <FactsWithGaps items={[
        { label: "决定", value: labelFrom(decisionLabels, review.review.owner_decision) },
        { label: "候选", value: `${review.review.candidate_count} 个` },
        { label: "待挑选", value: `${review.review.pending_count} 个` },
        { label: "已决定", value: `${review.review.decided_count} 个` },
        { label: "下游", value: labelFrom(admissionLabels, review.review.admission) },
        { label: "决定时间", value: review.review.decided_at ? formatRelative(review.review.decided_at) : null },
      ]} />
      <p className="text-2xs text-muted">挑选和决定都在 Eikona 里做，这里只读，不显示审阅人和理由。</p>
    </>}
    {review && review.state !== "observed" && <p data-review-reason={review.reason} className="text-2xs text-muted">{unreadText[review.reason] || "暂时读不到审阅记录；任务状态仍以 Eikona 为准。"}</p>}
  </section>;
}
