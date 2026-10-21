import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ChevronDown, FileText, Info, LoaderCircle, LockKeyhole, RefreshCw, SlidersHorizontal } from "../../icons";
import { api, errorClassOf, errorCode, isAbort, type Coverage, type Owner, type RequestPage, type RequestProjection, type RequestQuery, type RequestSummaryResponse } from "../../shared/api/control-center-client";
import { useWorkspace } from "../../app/workspace";
import { useObservationCache } from "../../app/observation-cache";
import { coverageLabels, defaultRequestQuery } from "../../request-visibility";
import { Button, CoverageChip, EmptyState, InlineNotice, Panel, Pill, ReadStateView, SearchField, SegmentedTabs, Select, SkeletonRows, StaleNotice, TaskStatePill, cx, ownerLabel } from "../../components/ui";
import { statusForFailure, type ReadStatus } from "../../shared/read-model/read-state";
import { formatCount, formatRelative } from "../../shared/read-model/format";
import { RequestDetail } from "./RequestDetail";

type Window = "24h" | "3d" | "7d";
const windows: { id: Window; label: string; hours: number }[] = [
  { id: "24h", label: "24 小时", hours: 24 },
  { id: "3d", label: "3 天", hours: 72 },
  { id: "7d", label: "7 天", hours: 168 },
];

const kindLabels: Record<string, string> = { gateway: "网关调用", generation: "生成任务", operation: "领域操作" };
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

  return <div className="page-enter space-y-5" data-page="requests">
    <h1 className="sr-only">请求记录</h1>
    <div className="flex justify-end"><Button size="sm" onClick={() => setTick((value) => value + 1)} icon={<RefreshCw className="size-3.5" />}>刷新</Button></div>

    {delegationMissing && <InlineNotice tone="info" icon={<LockKeyhole />}>
      所有请求来源都需要 owner 委托：个人会话不携带组织身份令牌，因此请求、正文和成员读取保持不可用。任务观测不受影响。
    </InlineNotice>}

    <SummaryPanel summary={summary} />

    <Panel bodyClassName="p-0">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
        <SegmentedTabs label="时间窗" value={timeWindow} onChange={(value) => update({ window: value === "24h" ? null : value })} options={windows.map((item) => ({ id: item.id, label: item.label }))} />
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
        <span className="mr-1 text-2xs text-muted">来源覆盖</span>
        {list.coverage.map((item) => <CoverageChip key={item.owner} owner={item.owner} state={item.state} reason={item.reason ? requestErrors[item.reason] || item.reason : undefined} />)}
      </div>}

      <StaleNoticeWrapper list={list} />

      <ReadStateView status={list.status === "empty" ? "ready" : list.status} error={list.error} onRetry={() => setTick((value) => value + 1)} skeleton={<SkeletonRows rows={6} />}>
        {list.rows.length === 0 ? <EmptyState icon={<FileText />} title="当前批次没有请求" body={list.coverage.some((item) => item.state !== "complete") ? "部分来源没有完整返回，空列表不代表没有请求，请查看上方来源覆盖。" : "所选时间窗内没有记录。"} /> : <>
          <ul className="divide-y divide-line">
            {list.rows.map((row, index) => <RequestRow key={row.owner + ":" + row.id} row={row} index={index} onOpen={() => update({ request: row.owner + ":" + row.id })} />)}
          </ul>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-3 text-2xs text-muted">
            <span className="tabular">当前批次 {list.rows.length} 条（{list.pages} 页，按来源分批）{list.observedAt ? ` · 读取于 ${formatRelative(list.observedAt)}` : ""}</span>
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

function StaleNoticeWrapper({ list }: { list: ListState }) {
  return list.status === "stale" ? <div className="px-4 pt-3"><StaleNotice status="stale" error={list.error} observedAt={list.observedAt} /></div> : null;
}

function RequestRow({ row, index, onOpen }: { row: RequestProjection; index: number; onOpen: () => void }) {
  return <li className="stagger-in" style={{ "--i": index } as React.CSSProperties}>
    <button type="button" data-request={row.owner + ":" + row.id} onClick={onOpen} className="group grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-4 py-3 text-left hover:bg-panel-soft md:grid-cols-[minmax(0,2fr)_110px_minmax(0,1fr)_120px_96px]">
      <span className="min-w-0">
        <span className="block truncate text-[13px] font-medium text-ink group-hover:text-primary dark:group-hover:text-accent">{row.title || row.id}</span>
        <span className="block truncate text-2xs text-muted">{ownerLabel(row.owner)} · <span className="font-mono">{row.id}</span></span>
      </span>
      <span className="hidden md:block"><Pill tone="neutral">{kindLabels[row.kind] || row.kind}</Pill></span>
      <span className="hidden min-w-0 truncate text-[13px] text-ink-soft md:block">{row.model || <span className="text-faint">模型未提供</span>}</span>
      <span className="justify-self-end md:justify-self-start"><TaskStatePill state={row.state} /></span>
      <span className="col-span-2 truncate text-2xs text-muted md:col-span-1 md:text-right tabular">{formatRelative(row.created_at)}{row.coverage.state !== "complete" ? ` · ${coverageLabels[row.coverage.state]}` : ""}</span>
    </button>
  </li>;
}

function SummaryPanel({ summary }: { summary: { status: ReadStatus; data: RequestSummaryResponse | null; error: string | null } }) {
  if (summary.status === "loading") return <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8">{Array.from({ length: 8 }, (_, index) => <div key={index} className="skeleton h-[72px] rounded-[12px]" />)}</div>;
  if (!summary.data) return <InlineNotice tone="neutral" icon={<Info />}>全范围汇总暂不可读（{summary.error}）；列表批次仍可单独查看。</InlineNotice>;
  const sources = summary.data.sources;
  const withSummary = sources.filter((source) => source.summary);
  return <Panel
    title="全范围汇总"
    actions={<span className="text-2xs text-muted">{summary.data.complete ? "所有来源完整" : "部分来源不完整"} · 各来源分别计数，不相加为总量</span>}
    bodyClassName="p-0"
  >
    {withSummary.length === 0 ? <div className="flex flex-wrap gap-1.5 px-4 py-3">{sources.map((source) => <CoverageChip key={source.owner} owner={source.owner} state={source.coverage?.state || "unknown"} reason={source.coverage?.reason ? requestErrors[source.coverage.reason] || source.coverage.reason : undefined} />)}</div> : <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-[13px]">
        <thead>
          <tr className="border-b border-line bg-panel-soft text-left text-2xs text-muted">
            <th scope="col" className="px-4 py-2 font-medium">来源</th>
            {summaryMetrics.map((metric) => <th key={metric.key} scope="col" className="px-3 py-2 text-right font-medium">{metric.label}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {sources.map((source) => <tr key={source.owner}>
            <th scope="row" className="px-4 py-2.5 text-left font-medium">
              <span className="flex items-center gap-2">{ownerLabel(source.owner)}{source.coverage && <CoverageChip state={source.coverage.state} reason={source.coverage.reason ? requestErrors[source.coverage.reason] || source.coverage.reason : undefined} />}{source.summary?.coverage?.[0] && source.summary.coverage[0].state !== "complete" && <CoverageChip state={source.summary.coverage[0].state} />}</span>
            </th>
            {summaryMetrics.map((metric) => {
              const value = source.summary?.[metric.key];
              return <td key={metric.key} className={cx("px-3 py-2.5 text-right tabular", value?.state !== "complete" && "text-muted")} title={value ? coverageLabels[value.state] : undefined}>
                {value && value.value !== null ? formatCount(value.value) : <span className="text-faint">—</span>}
              </td>;
            })}
          </tr>)}
        </tbody>
      </table>
    </div>}
  </Panel>;
}
