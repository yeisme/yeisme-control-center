import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useSearchParams } from "react-router-dom";
import { ChevronDown, Clock3, FileText, Info, LoaderCircle, LockKeyhole, RefreshCw, SlidersHorizontal } from "../../icons";
import { api, errorClassOf, errorCode, isAbort, type Coverage, type Owner, type RequestPage, type RequestProjection, type RequestQuery, type RequestSummaryResponse } from "../../shared/api/control-center-client";
import { useWorkspace } from "../../app/workspace";
import { useObservationCache } from "../../app/observation-cache";
import { coverageLabels, defaultRequestQuery, type CoverageState } from "../../request-visibility";
import { Button, CoverageChip, EmptyState, InlineNotice, MetricStrip, NoticeStack, PageToolbar, Panel, Pill, ReadStateView, SearchField, Select, SkeletonBlock, StaleNotice, TaskStatePill, ToggleGroup, coverageTone, cx, ownerLabel, type Metric, type Tone } from "../../components/ui";
import { readStatusLabels, statusForFailure, type ReadStatus } from "../../shared/read-model/read-state";
import { reasonLabel } from "../../shared/read-model/labels";
import { formatCount, formatFullTime, formatRelative } from "../../shared/read-model/format";
import { RequestDetail } from "./RequestDetail";

type Window = "24h" | "3d" | "7d";
const windows: { id: Window; label: string; hours: number }[] = [
  { id: "24h", label: "24 小时", hours: 24 },
  { id: "3d", label: "3 天", hours: 72 },
  { id: "7d", label: "7 天", hours: 168 },
];

const kindLabels: Record<string, string> = { gateway: "网关调用", generation: "生成任务", operation: "领域操作" };
const toneText: Record<Tone, string> = { success: "text-success", info: "text-info", warning: "text-warning", danger: "text-danger", review: "text-review", neutral: "text-muted" };
const rowColumns = "md:grid-cols-[minmax(0,2fr)_96px_minmax(0,1fr)_112px_104px]";
const summaryMetrics: { key: keyof Omit<NonNullable<Extract<RequestSummaryResponse["sources"][number], { summary: unknown }>["summary"]>, "coverage" | "from" | "to">; label: string }[] = [
  { key: "gateway", label: "网关调用" },
  { key: "generation", label: "生成任务" },
  { key: "operation", label: "领域操作" },
  { key: "attempts", label: "执行尝试" },
  { key: "outputs", label: "产出" },
  { key: "succeeded", label: "成功" },
  { key: "failed", label: "失败" },
  { key: "uploaded_files", label: "上传文件" },
];

const requestErrors: Record<string, string> = {
  delegation_unavailable: "当前登录没有 owner 委托（个人会话不携带 OIDC 访问令牌）",
  source_not_configured: "服务端未配置该 owner 的请求来源",
  filter_needs_contract: "该来源不支持当前筛选条件",
  owner_forbidden: "owner 拒绝读取",
  owner_unavailable: "owner 暂不可用",
  scope_mismatch: "owner 返回了不属于当前范围的数据",
};

/** Coverage reasons are either one of the codes above or owner-written text; never show an unmapped code verbatim. */
function coverageReason(reason: string | undefined) {
  if (!reason) return undefined;
  return requestErrors[reason] || (/^[a-z][a-z0-9_:]*$/.test(reason) ? reasonLabel(reason) || undefined : reason);
}

interface ListState { status: ReadStatus; rows: RequestProjection[]; coverage: Coverage[]; next?: string; error: string | null; observedAt: string | null; loadingMore: boolean; pages: number }

export default function RequestsPage() {
  const { scopeId, generation, expire, noteEpoch } = useWorkspace();
  const cache = useObservationCache();
  const [params, setParams] = useSearchParams();
  const timeWindow = (windows.some((item) => item.id === params.get("window")) ? params.get("window") : "24h") as Window;
  const owner = params.get("owner") || "all";
  const state = params.get("state") || "all";
  const search = params.get("q") || "";
  const outputs = params.get("outputs") || "all";
  const selectedKey = params.get("request");
  const [showFilters, setShowFilters] = useState(() => !!(params.get("state") || params.get("outputs")));
  const [debounced, setDebounced] = useState(search);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(search), 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  const query = useMemo<RequestQuery>(() => {
    const now = new Date();
    const base = defaultRequestQuery(now);
    const hours = windows.find((item) => item.id === timeWindow)!.hours;
    return { ...base, from: new Date(+now - hours * 3600_000).toISOString(), to: now.toISOString(), owner, state, search: debounced, outputs, limit: 50 };
  }, [timeWindow, owner, state, debounced, outputs]);
  const queryKey = JSON.stringify([timeWindow, owner, state, debounced, outputs]);

  const [list, setList] = useState<ListState>({ status: "loading", rows: [], coverage: [], error: null, observedAt: null, loadingMore: false, pages: 0 });
  const [summary, setSummary] = useState<{ status: ReadStatus; data: RequestSummaryResponse | null; error: string | null }>({ status: "loading", data: null, error: null });
  const [tick, setTick] = useState(0);
  const identity = `${scopeId}|${generation}|${queryKey}|${tick}`;
  const identityRef = useRef(identity);
  identityRef.current = identity;

  const update = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) {
      if (value && value !== "all") next.set(key, value);
      else next.delete(key);
    }
    setParams(next, { replace: true });
  };

  useEffect(() => {
    const controller = new AbortController();
    const requested = identity;
    setList({ status: "loading", rows: [], coverage: [], error: null, observedAt: null, loadingMore: false, pages: 0 });
    setSummary({ status: "loading", data: null, error: null });
    const fail = (error: unknown) => {
      if (isAbort(error) || identityRef.current !== requested) return null;
      if (errorClassOf(error) === "login_required") { expire(); return null; }
      return errorCode(error);
    };
    const listKey = `requests:${scopeId}:${queryKey}`;
    const summaryKey = `request-summary:${scopeId}:${queryKey}`;
    const cachedList = cache.peek<RequestPage>(listKey);
    if (cachedList) setList({ status: cachedList.stale ? "stale" : cachedList.data.rows.length ? "ready" : "empty", rows: cachedList.data.rows, coverage: cachedList.data.coverage, next: cachedList.data.next_cursor, error: null, observedAt: new Date().toISOString(), loadingMore: false, pages: 1 });
    const cachedSummary = cache.peek<RequestSummaryResponse>(summaryKey);
    if (cachedSummary) setSummary({ status: cachedSummary.stale ? "stale" : "ready", data: cachedSummary.data, error: null });
    cache.read(listKey, () => api.requests(scopeId, query, controller.signal), 10_000, 60_000).then(({ data: page }) => {
      if (identityRef.current !== requested) return;
      noteEpoch(page.epoch);
      setList({ status: page.rows.length ? "ready" : "empty", rows: page.rows, coverage: page.coverage, next: page.next_cursor, error: null, observedAt: new Date().toISOString(), loadingMore: false, pages: 1 });
    }).catch((error) => {
      const code = fail(error);
      if (code) setList((current) => ({ ...current, status: statusForFailure(errorClassOf(error), code, current.rows.length > 0), error: code }));
    });
    cache.read(summaryKey, () => api.requestSummary(scopeId, query, controller.signal), 10_000, 60_000).then(({ data }) => {
      if (identityRef.current !== requested) return;
      setSummary({ status: "ready", data, error: null });
    }).catch((error) => {
      const code = fail(error);
      if (code) setSummary((current) => ({ status: statusForFailure(errorClassOf(error), code, current.data !== null), data: current.data, error: code }));
    });
    return () => controller.abort();
  }, [identity]);

  const loadMore = useCallback(async () => {
    if (!list.next || list.loadingMore) return;
    const requested = identityRef.current;
    setList((current) => ({ ...current, loadingMore: true }));
    try {
      const page = await api.requests(scopeId, { ...query, cursor: list.next });
      if (identityRef.current !== requested) return;
      setList((current) => {
        const seen = new Set(current.rows.map((row) => row.owner + ":" + row.id));
        return { ...current, rows: [...current.rows, ...page.rows.filter((row) => !seen.has(row.owner + ":" + row.id))], coverage: page.coverage, next: page.next_cursor, loadingMore: false, pages: current.pages + 1 };
      });
    } catch (error) {
      if (identityRef.current !== requested) return;
      // A changed filter or epoch invalidates the signed cursor; restart from the first page once.
      if (errorClassOf(error) === "conflict") { setTick((value) => value + 1); return; }
      setList((current) => ({ ...current, loadingMore: false, error: errorCode(error) }));
    }
  }, [list.next, list.loadingMore, scopeId, query]);

  const selected = selectedKey ? list.rows.find((row) => row.owner + ":" + row.id === selectedKey) : undefined;
  const [selectedOwner, ...selectedIdParts] = (selectedKey || "").split(":");
  const delegationMissing = list.coverage.length > 0 && list.coverage.every((item) => item.reason === "delegation_unavailable" || item.reason === "source_not_configured");
  const refresh = () => setTick((value) => value + 1);
  const batchCount = (state: string) => list.rows.filter((row) => row.state === state).length;
  const failed = batchCount("failed");
  const undetermined = batchCount("unknown");
  const running = batchCount("running");
  const batchMetrics: Metric[] = [
    { label: "批次请求", value: formatCount(list.rows.length) ?? "0", hint: list.next ? "仍有下一批" : undefined },
    { label: "失败", value: failed, tone: failed ? "danger" : "neutral" },
    { label: "结果未知", value: undetermined, tone: undetermined ? "warning" : "neutral" },
    { label: "执行中", value: running, tone: running ? "info" : "neutral" },
  ];
  const batchLoading = list.status === "loading" && list.rows.length === 0;

  return <div className="page-enter space-y-5" data-page="requests">
    <h1 className="sr-only">请求记录</h1>
    <PageToolbar
      summary="先核对各来源的汇总，再用时间窗与筛选读取请求批次；请求正文需说明用途后按需读取，并写入审计。"
      metrics={batchLoading ? <SkeletonBlock className="h-[50px] w-72 max-w-full rounded-control" /> : list.rows.length > 0 ? <MetricStrip label="当前批次概况" items={batchMetrics} /> : undefined}
      meta={list.observedAt ? <span className="inline-flex items-center gap-1.5 text-2xs text-muted"><Clock3 className="size-3.5" />读取于 {formatRelative(list.observedAt)}</span> : undefined}
      actions={<Button size="sm" onClick={refresh} icon={<RefreshCw className="size-3.5" />}>刷新</Button>}
    />

    <NoticeStack notices={[
      list.status === "stale" && <StaleNotice key="stale" status="stale" error={list.error} observedAt={list.observedAt} onRetry={refresh} />,
      delegationMissing && <InlineNotice key="delegation" tone="info" icon={<LockKeyhole />}>
        所有请求来源都需要 owner 委托：个人会话不携带组织身份令牌，因此请求、正文和成员读取保持不可用。任务观测不受影响。
      </InlineNotice>,
    ]} />

    <SummaryPanel summary={summary} />

    <Panel bodyClassName="p-0">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
        <ToggleGroup<Window> label="时间窗" value={timeWindow} onChange={(value) => update({ window: value === "24h" ? null : value })} options={windows.map((item) => ({ id: item.id, label: item.label }))} />
        <Select aria-label="来源" value={owner} onChange={(event) => update({ owner: event.target.value })} className="w-36">
          <option value="all">全部来源</option>
          {(["aigora", "eikona", "scaena", "sonora"] as Owner[]).map((item) => <option key={item} value={item}>{ownerLabel(item)}</option>)}
        </Select>
        <div className="ml-auto flex w-full items-center gap-2 sm:w-auto">
          <SearchField value={search} onChange={(value) => update({ q: value || null })} placeholder="标题、引用、执行者" label="搜索请求" className="flex-1 sm:w-60 sm:flex-none" />
          <Button size="sm" variant={showFilters ? "secondary" : "ghost"} aria-expanded={showFilters} onClick={() => setShowFilters((value) => !value)} icon={<SlidersHorizontal className="size-3.5" />}>筛选</Button>
        </div>
      </div>
      {showFilters && <div className="fade-in grid grid-cols-2 gap-2 border-b border-line bg-panel-soft px-4 py-3 sm:grid-cols-4">
        <Select aria-label="状态" value={state} onChange={(event) => update({ state: event.target.value })}>
          <option value="all">全部状态</option>
          <option value="succeeded">成功</option>
          <option value="failed">失败</option>
          <option value="running">执行中</option>
          <option value="unknown">结果未知</option>
          <option value="cancelled">已取消</option>
        </Select>
        <Select aria-label="产出" value={outputs} onChange={(event) => update({ outputs: event.target.value })}>
          <option value="all">有无产出均可</option>
          <option value="yes">有产出</option>
          <option value="no">无产出</option>
        </Select>
      </div>}

      {list.coverage.length > 0 && <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-4 py-2.5">
        <span className="mr-1 text-meta text-muted">来源覆盖</span>
        {list.coverage.map((item) => <CoverageChip key={item.owner} owner={item.owner} state={item.state} reason={coverageReason(item.reason)} />)}
      </div>}

      <ReadStateView status={list.status === "empty" ? "ready" : list.status} error={list.error} onRetry={refresh} skeleton={<RequestListSkeleton />}>
        {list.rows.length === 0 ? <EmptyState icon={<FileText />} title="当前批次没有请求" body={list.coverage.some((item) => item.state !== "complete") ? "部分来源没有完整返回，空列表不代表没有请求，请查看上方来源覆盖。" : "所选时间窗内没有记录。"} /> : <>
          <RequestListHeader />
          <ul className="divide-y divide-line" aria-label="请求列表">
            {list.rows.map((row, index) => <RequestRow key={row.owner + ":" + row.id} row={row} index={index} selected={selectedKey === row.owner + ":" + row.id} onOpen={() => update({ request: row.owner + ":" + row.id })} />)}
          </ul>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-3 text-meta text-muted">
            <span className="tabular">当前批次 {list.rows.length} 条（{list.pages} 页，按来源分批）</span>
            {list.next && <Button size="sm" variant="ghost" disabled={list.loadingMore} onClick={() => void loadMore()} icon={list.loadingMore ? <LoaderCircle className="size-3.5 motion-safe:animate-spin" /> : <ChevronDown className="size-3.5" />}>加载下一批</Button>}
          </div>
        </>}
      </ReadStateView>
    </Panel>

    {selectedKey && <RequestDetail
      key={selectedKey}
      owner={selectedOwner as Owner}
      id={selectedIdParts.join(":")}
      initial={selected}
      onClose={() => update({ request: null })}
    />}
  </div>;
}

function RequestListHeader() {
  return <div aria-hidden="true" className={cx("hidden items-center gap-x-4 border-b border-line bg-panel-soft px-4 py-2 text-2xs font-medium text-muted md:grid", rowColumns)}>
    <span>请求</span>
    <span>类型</span>
    <span>模型</span>
    <span>状态</span>
    <span className="text-right">创建时间</span>
  </div>;
}

function RequestRow({ row, index, selected, onOpen }: { row: RequestProjection; index: number; selected: boolean; onOpen: () => void }) {
  const incomplete = row.coverage.state !== "complete";
  const kind = kindLabels[row.kind] || "请求";
  return <li className="stagger-in" style={{ "--i": index } as CSSProperties}>
    <button type="button" data-request={row.owner + ":" + row.id} aria-current={selected || undefined} onClick={onOpen} className={cx("group grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-4 py-3 text-left transition-colors duration-150 hover:bg-panel-soft focus-visible:outline-offset-[-2px]", rowColumns, selected && "bg-primary-soft/50")}>
      <span className="min-w-0">
        <span className="block truncate text-body-sm font-medium text-ink group-hover:text-primary dark:group-hover:text-accent">{row.title || row.id}</span>
        <span className="block truncate text-meta text-muted">{ownerLabel(row.owner)} · <span className="font-mono text-2xs">{row.id}</span><span className="md:hidden"> · {kind}</span>{incomplete && <span className={toneText[coverageTone(row.coverage.state)]}> · {coverageLabels[row.coverage.state as CoverageState] || row.coverage.state}</span>}</span>
      </span>
      <span className="hidden md:block"><span className="sr-only">类型：</span><Pill size="sm">{kind}</Pill></span>
      <span className="hidden min-w-0 truncate text-body-sm text-ink-soft md:block"><span className="sr-only">模型：</span>{row.model || <span className="text-faint">模型未提供</span>}</span>
      <span className="justify-self-end md:justify-self-start"><span className="sr-only">状态：</span><TaskStatePill state={row.state} /></span>
      <span className="col-span-2 truncate text-meta text-muted tabular md:col-span-1 md:text-right" title={formatFullTime(row.created_at)}><span className="sr-only">创建时间：</span>{formatRelative(row.created_at)}</span>
    </button>
  </li>;
}

const skeletonWidths = ["w-3/5", "w-1/2", "w-2/3", "w-2/5"];

function RequestListSkeleton() {
  return <div aria-hidden="true">
    <RequestListHeader />
    <div className="divide-y divide-line">
      {Array.from({ length: 7 }, (_, index) => <div key={index} className={cx("grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-4 py-3", rowColumns)}>
        <div className="min-w-0 space-y-1.5"><SkeletonBlock className={cx("h-3.5", skeletonWidths[index % skeletonWidths.length])} /><SkeletonBlock className="h-3 w-1/3" /></div>
        <SkeletonBlock className="hidden h-5 w-16 rounded-chip md:block" />
        <SkeletonBlock className="hidden h-3.5 w-24 md:block" />
        <SkeletonBlock className="h-6 w-16 rounded-chip" />
        <SkeletonBlock className="col-span-2 h-3 w-14 md:col-span-1 md:justify-self-end" />
      </div>)}
    </div>
  </div>;
}

function SummarySkeleton() {
  return <Panel title="全范围汇总" bodyClassName="p-0">
    <div aria-hidden="true" className="overflow-hidden">
      <div className="flex items-center gap-4 border-b border-line bg-panel-soft px-4 py-2.5">
        <SkeletonBlock className="h-3 w-10 shrink-0" />
        {summaryMetrics.map((metric) => <SkeletonBlock key={metric.key} className="ml-auto h-3 w-12 shrink-0" />)}
      </div>
      <div className="divide-y divide-line">
        {Array.from({ length: 4 }, (_, index) => <div key={index} className="flex items-center gap-4 px-4 py-3">
          <SkeletonBlock className="h-4 w-14 shrink-0" />
          {summaryMetrics.map((metric) => <SkeletonBlock key={metric.key} className="ml-auto h-3.5 w-8 shrink-0" />)}
        </div>)}
      </div>
    </div>
  </Panel>;
}

function SummaryPanel({ summary }: { summary: { status: ReadStatus; data: RequestSummaryResponse | null; error: string | null } }) {
  if (summary.status === "loading") return <SummarySkeleton />;
  if (!summary.data) return <InlineNotice tone="neutral" icon={<Info />}>全范围汇总暂不可读（{readStatusLabels[summary.status]}）；列表批次仍可单独查看。</InlineNotice>;
  const sources = summary.data.sources;
  const withSummary = sources.filter((source) => source.summary);
  return <Panel
    title="全范围汇总"
    actions={<span className="flex flex-wrap items-center gap-2 text-meta text-muted">
      {summary.status === "stale" && <Pill size="sm" tone="warning">{readStatusLabels.stale}</Pill>}
      <span>{summary.data.complete ? "所有来源完整" : "部分来源不完整"} · 各来源分别计数，不相加为总量</span>
    </span>}
    bodyClassName="p-0"
  >
    {withSummary.length === 0 ? <div className="flex flex-wrap gap-1.5 px-4 py-3">{sources.map((source) => <CoverageChip key={source.owner} owner={source.owner} state={source.coverage?.state || "unknown"} reason={coverageReason(source.coverage?.reason)} />)}</div> : <div role="region" aria-label="各来源汇总表" tabIndex={0} className="overflow-x-auto">
      <table aria-label="各来源请求汇总" className="w-full min-w-[720px] text-body-sm">
        <thead>
          <tr className="border-b border-line bg-panel-soft text-left text-2xs text-muted">
            <th scope="col" className="px-4 py-2 font-medium">来源</th>
            {summaryMetrics.map((metric) => <th key={metric.key} scope="col" className="whitespace-nowrap px-3 py-2 text-right font-medium">{metric.label}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {sources.map((source) => <tr key={source.owner}>
            <th scope="row" className="px-4 py-2.5 text-left font-medium text-ink">
              <span className="flex flex-wrap items-center gap-2">{ownerLabel(source.owner)}{source.coverage && <CoverageChip state={source.coverage.state} reason={coverageReason(source.coverage.reason)} />}{source.summary?.coverage?.[0] && source.summary.coverage[0].state !== "complete" && <CoverageChip state={source.summary.coverage[0].state} />}</span>
            </th>
            {summaryMetrics.map((metric) => {
              const value = source.summary?.[metric.key];
              const known = !!value && value.value !== null;
              const complete = value?.state === "complete";
              const stateLabel = value ? coverageLabels[value.state] : undefined;
              return <td key={metric.key} className={cx("px-3 py-2.5 text-right tabular", known && complete ? "text-ink" : "text-muted")}>
                {known
                  ? <span title={complete ? undefined : stateLabel} className={cx(!complete && "underline decoration-dotted underline-offset-4")}>{formatCount(value.value)}{!complete && stateLabel && <span className="sr-only">（{stateLabel}）</span>}</span>
                  : <><span aria-hidden="true" className="text-faint">—</span><span className="sr-only">未提供</span></>}
              </td>;
            })}
          </tr>)}
        </tbody>
      </table>
    </div>}
  </Panel>;
}
