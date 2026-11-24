import { History, LoaderCircle, RotateCcw } from "../icons";
import { Button, cx } from "./ui";
import { useTasks } from "../app/tasks-context";
import { readErrorMessage } from "../shared/read-model/read-state";

/**
 * What a task query searched, said plainly: the rows already read, how much history that is, and whether older pages
 * are still unread. Reading deeper is the person's choice, eight pages at a time, and can be stopped.
 */
export function QueryScope({ matched, className }: { matched: number; className?: string }) {
  const tasks = useTasks();
  const { coverage } = tasks;
  if (tasks.status === "loading" && !tasks.rows.length) return null;
  const reading = coverage.deeper.status === "reading";
  const depth = coverage.historyPages
    ? `每个连接的历史读了最近 ${coverage.historyPages} 页${coverage.more ? "（还有更早的）" : "（已经读完）"}`
    : "历史还没有读到";
  return <p data-query-scope className={cx("flex flex-wrap items-center gap-x-3 gap-y-1.5 text-2xs text-muted", className)} aria-live="polite">
    {/* A phone keeps the count on one line; how deep the history goes is said by the button when there is more. */}
    <span className="tabular">在已读取的 {tasks.rows.length} 条里查询，{matched} 条符合<span className="max-sm:hidden"> · {depth}{coverage.deeperRows ? ` · 多读到 ${coverage.deeperRows} 条` : ""}</span></span>
    {reading && <>
      <span className="inline-flex items-center gap-1.5 tabular"><LoaderCircle aria-hidden="true" className="size-3.5 motion-safe:animate-spin" />正在读取更早的历史 {coverage.deeper.done} / {coverage.deeper.total} 页</span>
      <Button size="sm" variant="ghost" onClick={tasks.cancelDeeper}>停止</Button>
    </>}
    {!reading && coverage.deeper.status === "expired" && <>
      <span className="text-warning">历史的读取位置已经过期</span>
      <Button size="sm" variant="ghost" icon={<RotateCcw className="size-3.5" />} onClick={tasks.restartDeeper}>从头读取</Button>
    </>}
    {!reading && coverage.deeper.status === "error" && <span className="text-warning">更早的历史没读到：{readErrorMessage(coverage.deeper.error).replace(/[。.]$/, "")}</span>}
    {!reading && coverage.more && coverage.deeper.status !== "expired" && <Button size="sm" variant="ghost" icon={<History className="size-3.5" />} onClick={() => tasks.readDeeper(8)}>{coverage.deeper.status === "error" ? "再试一次" : "读取更早的历史（再读 8 页）"}</Button>}
  </p>;
}
