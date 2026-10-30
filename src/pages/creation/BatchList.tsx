import { useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../../shared/api/control-center-client";
import { useScopedRead } from "../../app/workspace";
import type { GenerationBatch, GenerationBatchPage, SharedProject } from "../../shared/collaboration";
import { Button, EmptyState, InlineNotice, Panel, Pill, ReadStateView, SkeletonRows, ownerLabel, useToast, type Tone } from "../../components/ui";
import { FilterBar } from "../../components/FilterBar";
import { PromptCaptureSummary } from "../../components/PromptCaptureSummary";
import { formatRelative } from "../../shared/read-model/format";
import { taskStateLabels } from "../../task-observation";
import { connectionStateLabel } from "../../shared/read-model/tasks";
import { batchFilterPrefix, batchListFiltered, batchListQuery, closeOpenedBatch, pageBatchList } from "../../shared/read-model/batch-list";
import { ArrowRight, X } from "../../icons";

const states = ["planned", "blocked", "submitting", "queued", "running", "partial", "succeeded", "failed", "cancelled", "unknown"];
const stateLabels: Record<string, string> = { ...taskStateLabels, planned: "已计划", blocked: "被阻止", submitting: "提交中" };
const stateTone = (state: string): Tone => state === "succeeded" ? "success" : state === "failed" || state === "blocked" ? "danger" : state === "unknown" || state === "partial" ? "warning" : state === "planned" ? "neutral" : "info";
const live = (rows: GenerationBatch[] | undefined) => !!rows?.some((batch) => ["submitting", "queued", "running", "unknown"].includes(batch.state));

export interface BatchListActions {
  canEdit: boolean;
  busy: boolean;
  generationEnabled: boolean;
  onSubmit: (batch: GenerationBatch) => void;
  onReconcile: (batch: GenerationBatch) => void;
}

function BatchCard({ batch, actions, highlighted }: { batch: GenerationBatch; actions: BatchListActions; highlighted?: boolean }) {
  const ready = batch.state === "planned" && !batch.items.some((item) => !!item.reason || item.estimated_cost === null);
  return <article data-batch={batch.id} className={highlighted ? "space-y-2 rounded-control border border-primary/40 bg-primary-soft/30 p-3" : "space-y-2 py-3"}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <h3 className="text-sm font-medium">{batch.name}</h3>
        <Pill size="sm" tone={stateTone(batch.state)}>{stateLabels[batch.state] || batch.state}</Pill>
        <span className="text-2xs text-muted">{formatRelative(batch.created_at)}</span>
      </div>
      <div className="flex gap-2">
        <Button size="sm" disabled={!actions.canEdit || !actions.generationEnabled || !ready} onClick={() => actions.onSubmit(batch)}>确认生成</Button>
        <Button size="sm" variant="secondary" disabled={!actions.canEdit || batch.state === "planned" || actions.busy} onClick={() => actions.onReconcile(batch)}>查询原操作</Button>
      </div>
    </div>
    {batch.items.map((item, index) => <div key={item.id} className="space-y-1 py-1">
      <p className="break-words text-xs text-muted">{index + 1}. {ownerLabel(item.owner)}{item.project_ref ? ` · ${item.project_ref}` : ""} · {item.candidate_count} 个候选 · {stateLabels[item.state] || item.state}{item.reason && ` · ${item.reason}`}</p>
      {item.prompt_capture && <PromptCaptureSummary prompt={item.prompt_capture} compact />}
    </div>)}
  </article>;
}

function SourcesNotice({ page }: { page: Pick<GenerationBatchPage, "coverage" | "sources"> }) {
  if (page.coverage === "complete") return null;
  const gaps = page.sources.filter((source) => source.state !== "ready").map((source) => `${ownerLabel(source.owner)}${source.project_ref ? ` · ${source.project_ref}` : ""}：${connectionStateLabel(source.state)}`);
  return <InlineNotice tone="warning">有批次这次没读到 owner 的最新状态（{gaps.join("；") || "来源未说明"}），先显示上次保存的状态，稍后会再读。</InlineNotice>;
}

/**
 * The project's batches, newest first and one page at a time: filters and the page cursor live in the address, the
 * server observes only the batches it returns, and `?batch=` opens one batch directly even when it is not on this page.
 */
export function BatchList({ project, refresh, actions }: { project: SharedProject; refresh: number; actions: BatchListActions }) {
  const [params, setParams] = useSearchParams();
  const query = batchListQuery(params);
  const signature = JSON.stringify(query);
  const page = useScopedRead((_scope, signal) => api.generationBatches(project.id, query, signal), { key: `${project.id}|${signature}|${refresh}`, poll: (data) => live(data?.rows) ? 5000 : null });
  const opened = params.get("batch") || "";
  const detail = useScopedRead((_scope, signal) => api.generationBatch(project.id, opened, signal), { enabled: !!opened, key: `${project.id}|${opened}|${refresh}`, poll: (data) => live(data ? [data.batch] : undefined) ? 5000 : null });
  const openedRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (opened && detail.data) openedRef.current?.scrollIntoView({ block: "nearest" }); }, [opened, !!detail.data]);
  const setCursor = (cursor: string | null) => setParams((current) => pageBatchList(current, cursor));
  const closeOpened = () => setParams((current) => closeOpenedBatch(current));
  const cursor = query.cursor;
  const notify = useToast();
  // A page cursor lasts 15 minutes and ends when the project or permissions change; the honest recovery is the newest page.
  const lapsed = !!cursor && (page.error === "cursor_expired" || page.error === "cursor_invalid");
  useEffect(() => { if (lapsed) { setCursor(null); notify("翻页位置已失效，已回到最新的批次。", "info"); } }, [lapsed]);
  const filtered = batchListFiltered(params);
  const data = page.data;
  return <Panel title="项目批次" actions={data && <span className="text-2xs text-muted">共 {data.total} 个</span>}>
    <div className="space-y-3 p-4">
      {opened && <div ref={openedRef} className="space-y-2" aria-label="打开的批次">
        <div className="flex items-center justify-between gap-2"><p className="text-xs font-medium text-muted">从提醒或链接打开的批次</p><Button size="sm" variant="ghost" icon={<X className="size-3.5" />} onClick={closeOpened}>收起</Button></div>
        <ReadStateView status={detail.status} error={detail.error} onRetry={detail.reload} skeleton={<SkeletonRows rows={1} />}>
          {detail.data && <><SourcesNotice page={detail.data} /><BatchCard batch={detail.data.batch} actions={actions} highlighted /></>}
        </ReadStateView>
      </div>}
      <FilterBar prefix={batchFilterPrefix} placeholder="搜索批次名称" dates facets={[
        { key: "state", label: "状态", options: states.map((value) => ({ value, label: stateLabels[value] || value })) },
        { key: "owner", label: "工具", options: [{ value: "eikona", label: ownerLabel("eikona") }, { value: "scaena", label: ownerLabel("scaena") }] },
      ]} />
      <ReadStateView status={page.status} error={page.error} onRetry={page.reload} skeleton={<SkeletonRows rows={3} />}>
        {data && <SourcesNotice page={data} />}
        <div className="divide-y divide-line">{data?.rows.filter((batch) => batch.id !== opened).map((batch) => <BatchCard key={batch.id} batch={batch} actions={actions} />)}</div>
        {!data?.rows.length && <EmptyState compact title={filtered ? "没有符合条件的批次" : "暂无生成批次"} body={filtered ? "换个条件，或点“重置”看全部批次。" : "保存计划后显示逐项状态；未知接收状态只查询原操作。"} />}
        {(cursor || data?.next_cursor) && <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
          <Button size="sm" variant="ghost" disabled={!cursor} onClick={() => setCursor(null)}>回到最新</Button>
          <Button size="sm" variant="secondary" disabled={!data?.next_cursor} onClick={() => setCursor(data!.next_cursor)} icon={<ArrowRight className="size-3.5" />}>更早的批次</Button>
        </div>}
      </ReadStateView>
    </div>
  </Panel>;
}
