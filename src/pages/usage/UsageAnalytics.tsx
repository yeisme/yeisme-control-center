import { useMemo, useState } from "react";
import { CircleAlert, Clock3, Info, Receipt, Table2, Wallet } from "../../icons";
import { api, type UsageEvent } from "../../shared/api/control-center-client";
import { useScopedRead } from "../../app/workspace";
import { Button, CoverageChip, DataTable, EmptyState, InlineNotice, NoticeStack, PageToolbar, Panel, Pill, ReadStateView, Select, SkeletonRows, StaleNotice, StatCard, ToggleGroup, Tooltip, cx, ownerLabel, type Column } from "../../components/ui";
import { formatFullTime, formatMoney, formatRelative } from "../../shared/read-model/format";

type Range = "7" | "14" | "30";
const ownerOrder = ["eikona", "scaena", "sonora", "aigora"];
const ownerColors: Record<string, string> = { eikona: "var(--chart-1)", scaena: "var(--chart-2)", sonora: "var(--chart-3)", aigora: "var(--chart-4)" };
const ownerColor = (owner: string) => ownerColors[owner] || "var(--chart-axis)";
const costStateLabels: Record<string, string> = { confirmed: "已确认", estimated: "估算", pending: "待核算", unknown: "未知" };
const costStateTone = { confirmed: "success", estimated: "info", pending: "warning", unknown: "neutral" } as const;
const unitLabels: Record<string, string> = { image: "张", images: "张", second: "秒", seconds: "秒", character: "字符", characters: "字符", token: "tokens", tokens: "tokens" };
const chartHeight = 220;

/** Deduplicates by owner + source_ref so a replayed receipt is counted once. */
export function dedupeUsage(rows: UsageEvent[]) {
  const unique = new Map<string, UsageEvent>();
  for (const row of rows) {
    const key = row.owner + ":" + row.source_ref;
    if (!unique.has(key)) unique.set(key, row);
  }
  return [...unique.values()];
}

/** Sums only confirmed upstream cost, per currency; unknown cost is never counted as zero. */
export function confirmedTotals(rows: UsageEvent[]) {
  const totals: Record<string, number> = {};
  for (const row of rows) if (row.cost_state === "confirmed" && row.upstream_cost !== null) totals[row.currency] = (totals[row.currency] || 0) + row.upstream_cost;
  return totals;
}

/** 1/2/5 × 10^n step so axis ticks land on round numbers; `top` is the first tick at or above `max`. */
export function niceScale(max: number, target = 4) {
  if (!(max > 0)) return { step: 1, top: 1, decimals: 0 };
  const raw = max / target;
  const exponent = Math.floor(Math.log10(raw));
  const base = raw / 10 ** exponent;
  const step = (base <= 1 ? 1 : base <= 2 ? 2 : base <= 5 ? 5 : 10) * 10 ** exponent;
  return { step, top: Math.ceil(max / step - 1e-9) * step, decimals: step >= 1 ? 0 : Math.min(4, Math.ceil(-Math.log10(step) - 1e-9)) };
}

/** Compact currency tick (`¥2`, `$0.5`); unknown currency codes fall back to a suffix instead of throwing. */
export function formatAxisMoney(value: number, currency: string, decimals = 0) {
  try {
    return new Intl.NumberFormat("zh-CN", { style: "currency", currency: currency.toUpperCase(), currencyDisplay: "narrowSymbol", minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(value);
  } catch {
    return `${value.toLocaleString("zh-CN", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })} ${currency}`;
  }
}

function dayKey(time: number) {
  const date = new Date(time);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

interface TrendPoint { key: string; label: string; cost: number; calls: number; unconfirmed: number; byOwner: Record<string, number> }

export default function UsageAnalytics() {
  const read = useScopedRead((scope, signal) => api.usage(scope, signal));
  const [range, setRange] = useState<Range>("14");
  const [owner, setOwner] = useState("all");
  const [tableView, setTableView] = useState(false);
  const rows = useMemo(() => dedupeUsage(read.data?.rows || []), [read.data]);
  const currencies = useMemo(() => [...new Set(rows.map((row) => row.currency))].sort((a, b) => a === "CNY" ? -1 : b === "CNY" ? 1 : a.localeCompare(b)), [rows]);
  const [currency, setCurrency] = useState<string | null>(null);
  const activeCurrency = currency && currencies.includes(currency) ? currency : currencies[0] || "CNY";

  const now = useMemo(() => Date.now(), [read.observedAt, range]);
  const cutoff = now - Number(range) * 86400_000;
  const visible = useMemo(() => rows.filter((row) => {
    const time = Date.parse(row.created_at);
    return Number.isFinite(time) && time >= cutoff && (owner === "all" || row.owner === owner);
  }), [rows, cutoff, owner]);
  const totals = confirmedTotals(visible);
  const pending = visible.filter((row) => row.cost_state !== "confirmed").length;
  const unknownCost = visible.filter((row) => row.upstream_cost === null).length;
  const owners = ownerOrder.concat([...new Set(rows.map((row) => row.owner as string))].filter((id) => !ownerOrder.includes(id))).filter((id) => rows.some((row) => row.owner === id));

  const trend = useMemo<TrendPoint[]>(() => {
    const days = Number(range);
    const buckets: TrendPoint[] = Array.from({ length: days }, (_, index) => {
      const time = now - (days - 1 - index) * 86400_000;
      return { key: dayKey(time), label: new Date(time).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" }), cost: 0, calls: 0, unconfirmed: 0, byOwner: {} };
    });
    const index = new Map(buckets.map((bucket) => [bucket.key, bucket]));
    for (const row of visible) {
      const bucket = index.get(dayKey(Date.parse(row.created_at)));
      if (!bucket) continue;
      bucket.calls += 1;
      if (row.currency !== activeCurrency) continue;
      if (row.cost_state === "confirmed" && row.upstream_cost !== null) {
        bucket.cost += row.upstream_cost;
        bucket.byOwner[row.owner] = (bucket.byOwner[row.owner] || 0) + row.upstream_cost;
      } else bucket.unconfirmed += 1;
    }
    return buckets.map((bucket) => ({ ...bucket, cost: Number(bucket.cost.toFixed(2)) }));
  }, [visible, range, activeCurrency, now]);

  const byOwner = useMemo(() => owners.map((id) => {
    const ownerRows = visible.filter((row) => row.owner === id);
    const confirmed = ownerRows.filter((row) => row.currency === activeCurrency && row.cost_state === "confirmed" && row.upstream_cost !== null).reduce((sum, row) => sum + (row.upstream_cost || 0), 0);
    return { owner: id, calls: ownerRows.length, cost: Number(confirmed.toFixed(2)), unconfirmed: ownerRows.filter((row) => row.cost_state !== "confirmed").length };
  }).filter((item) => item.calls > 0), [visible, activeCurrency, owners.join("|")]);
  const chartOwners = byOwner.filter((item) => item.cost > 0).map((item) => item.owner);

  const budget = read.data?.budget;
  const coverage = read.data?.coverage;
  const sortedRows = useMemo(() => visible.slice().sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)), [visible]);
  const receiptLimit = 100;

  const receiptColumns: Column<UsageEvent>[] = [
    { id: "time", header: "时间", cell: (row) => <span className="whitespace-nowrap tabular text-ink-soft" title={formatFullTime(row.created_at)}>{formatRelative(row.created_at)}</span> },
    { id: "source", header: "来源 · 模型", cell: (row) => <div className="max-w-[260px] min-w-0">
      <span className="flex items-center gap-1.5 font-medium text-ink"><span aria-hidden="true" className="size-2 shrink-0 rounded-[2px]" style={{ background: ownerColor(row.owner) }} /><span className="truncate">{ownerLabel(row.owner)}</span></span>
      <span className="block truncate font-mono text-2xs text-muted">{row.model_ref}</span>
    </div> },
    { id: "quantity", header: "计量", priority: 2, align: "end", cell: (row) => row.quantity === null ? <span className="text-faint">未知</span> : <span className="whitespace-nowrap tabular">{row.quantity.toLocaleString("zh-CN")} {unitLabels[row.unit] || row.unit}</span> },
    { id: "state", header: "成本状态", cell: (row) => <Pill tone={costStateTone[row.cost_state as keyof typeof costStateTone] || "neutral"}>{costStateLabels[row.cost_state] || row.cost_state}</Pill> },
    { id: "cost", header: "上游成本", align: "end", cell: (row) => row.upstream_cost === null ? <span className="text-faint">未知</span> : <span className="whitespace-nowrap tabular">{formatMoney(row.upstream_cost, row.currency)}</span> },
    { id: "ref", header: "引用", priority: 3, cell: (row) => <span className="block max-w-[200px] truncate font-mono text-2xs text-muted" title={row.source_ref}>{row.source_ref}</span> },
  ];

  return <div className="page-enter space-y-5" data-page="usage">
    <h1 className="sr-only">用量与成本</h1>
    <PageToolbar
      summary="只汇总 owner 返回的模型用量回执：已确认成本按币种分别合计，估算与待核算不计入，未知成本不补零。"
      actions={<div role="group" aria-label="用量筛选" className="flex flex-wrap items-center gap-2">
        <ToggleGroup label="时间范围" value={range} onChange={setRange} options={[{ id: "7", label: "近 7 天" }, { id: "14", label: "近 14 天" }, { id: "30", label: "近 30 天" }]} />
        <Select aria-label="来源" value={owner} onChange={(event) => setOwner(event.target.value)} className="w-32">
          <option value="all">全部来源</option>
          {owners.map((item) => <option key={item} value={item}>{ownerLabel(item)}</option>)}
        </Select>
        {currencies.length > 1 && <Select aria-label="币种" value={activeCurrency} onChange={(event) => setCurrency(event.target.value)} className="w-28">
          {currencies.map((item) => <option key={item} value={item}>{item}</option>)}
        </Select>}
      </div>}
      meta={coverage ? <>
        <CoverageChip state={coverage.state} />
        {coverage.observed_at && <Pill size="sm" icon={<Clock3 />}>观察于 {formatRelative(coverage.observed_at)}</Pill>}
      </> : undefined}
    />
    <NoticeStack notices={[
      read.status === "stale" && <StaleNotice key="stale" status={read.status} error={read.error} observedAt={read.observedAt} onRetry={read.reload} />,
      coverage?.reason && <InlineNotice key="coverage" tone="info" icon={<Info />}>{coverage.reason}</InlineNotice>,
    ]} />

    <ReadStateView status={read.status === "empty" ? "ready" : read.status} error={read.error} onRetry={read.reload} skeleton={<Panel><SkeletonRows rows={4} /></Panel>}>
      <section aria-label="用量概览" className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatCard label="已确认上游成本" icon={<Wallet />} value={Object.keys(totals).length ? Object.entries(totals).map(([code, amount]) => formatMoney(amount, code)).join(" · ") : <span className="text-faint">未观察到</span>} hint="只计入 owner 回执中已确认的费用" />
        <StatCard label="用量回执" icon={<Receipt />} value={visible.length.toLocaleString("zh-CN")} hint="按 owner + source_ref 去重" />
        <StatCard label="待核算" icon={<CircleAlert />} tone={pending > 0 ? "warning" : "neutral"} value={pending.toLocaleString("zh-CN")} hint={`其中 ${unknownCost} 条成本未知`} />
        <BudgetCard budget={budget} />
      </section>

      {rows.length === 0 ? <Panel><EmptyState icon={<Receipt />} title="尚无用量回执" body="用量只来自经控制中心提交的 Provider 运行回执；提交门关闭时这里保持为空。历史 owner 账本仍按来源读取。" /></Panel> : <>
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <Panel title={`每日已确认成本 · ${activeCurrency}`} actions={<>
            {!tableView && chartOwners.length > 0 && <ul aria-label="图例" className="hidden items-center gap-3 text-2xs text-ink-soft sm:flex">
              {chartOwners.map((id) => <li key={id} className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="size-2.5 rounded-[3px]" style={{ background: ownerColor(id) }} />{ownerLabel(id)}</li>)}
            </ul>}
            <Button size="sm" variant={tableView ? "secondary" : "ghost"} aria-pressed={tableView} onClick={() => setTableView((value) => !value)} icon={<Table2 className="size-3.5" />}>表格视图</Button>
          </>}>
            {tableView ? <TrendTable data={trend} currency={activeCurrency} /> : <CostChart data={trend} currency={activeCurrency} owners={chartOwners} />}
          </Panel>

          <Panel title={`按来源 · ${activeCurrency}`}>
            <ul className="space-y-4 p-5">
              {byOwner.map((item) => {
                const max = Math.max(...byOwner.map((entry) => entry.cost), 0.01);
                return <li key={item.owner}>
                  <div className="flex items-baseline justify-between gap-3 text-body-sm">
                    <span className="flex items-center gap-2 font-medium text-ink"><span aria-hidden="true" className="size-2.5 rounded-[3px]" style={{ background: ownerColor(item.owner) }} />{ownerLabel(item.owner)}</span>
                    <span className="tabular text-ink">{formatMoney(item.cost, activeCurrency)}</span>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-panel-sunken">
                    <div className="h-full rounded-full" style={{ width: `${(item.cost / max) * 100}%`, background: ownerColor(item.owner) }} />
                  </div>
                  <p className="mt-1.5 text-2xs text-muted tabular">{item.calls} 条回执{item.unconfirmed ? ` · ${item.unconfirmed} 条未确认成本未计入` : ""}</p>
                </li>;
              })}
              {byOwner.length === 0 && <li className="text-body-sm text-muted">所选范围内没有回执。</li>}
            </ul>
          </Panel>
        </div>

        <Panel title="原始用量回执" actions={<span className="text-2xs text-muted tabular">{sortedRows.length > receiptLimit ? `最近 ${receiptLimit} / ${sortedRows.length} 条` : `${sortedRows.length} 条`}</span>} bodyClassName="p-0">
          <DataTable label="原始用量回执" columns={receiptColumns} rows={sortedRows.slice(0, receiptLimit)} rowKey={(row) => row.owner + row.source_ref} empty={<EmptyState compact title="所选范围内没有回执" />} />
        </Panel>
      </>}
    </ReadStateView>
  </div>;
}

function BudgetCard({ budget }: { budget?: { total: number; reserved: number; remaining: number; per_owner: Record<string, number> } }) {
  if (!budget) return <StatCard label="内部预算观察" icon={<Wallet />} value={<span className="text-faint">未提供</span>} hint="服务端未返回预算观察" />;
  const ratio = Math.min(1, budget.reserved / Math.max(budget.total, 0.01));
  const caps = Object.entries(budget.per_owner).map(([id, cap]) => `${ownerLabel(id)} ${formatMoney(cap, "CNY")}`).join(" · ");
  return <div className="min-w-0 rounded-card border border-line bg-panel px-4 py-3 shadow-panel">
    <div className="flex items-center justify-between gap-3">
      <span className="truncate text-meta text-muted">内部预算观察</span>
      <span aria-hidden="true" className="grid size-7 shrink-0 place-items-center rounded-[8px] bg-panel-sunken text-ink-soft [&>svg]:size-3.5"><Wallet /></span>
    </div>
    <span className="tabular mt-1 block truncate text-metric font-semibold tracking-tight text-ink">{formatMoney(budget.remaining, "CNY")}<span className="ml-1.5 text-meta font-normal text-muted">剩余</span></span>
    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-panel-sunken" role="meter" aria-label="预算已预留比例" aria-valuemin={0} aria-valuemax={budget.total} aria-valuenow={budget.reserved}>
      <div className={cx("h-full rounded-full", ratio > 0.85 ? "bg-danger" : ratio > 0.6 ? "bg-warning" : "bg-primary")} style={{ width: `${ratio * 100}%` }} />
    </div>
    <span className="mt-1 block truncate text-2xs text-muted tabular" title={caps || undefined}>已预留 {formatMoney(budget.reserved, "CNY")} / {formatMoney(budget.total, "CNY")}{caps ? ` · ${caps}` : ""}</span>
  </div>;
}

function CostChart({ data, currency, owners }: { data: TrendPoint[]; currency: string; owners: string[] }) {
  const max = Math.max(...data.map((point) => point.cost), 0);
  const { step, top, decimals } = niceScale(max);
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, index) => index * step);
  const labelStep = data.length <= 8 ? 1 : data.length <= 16 ? 2 : 5;
  return <div className="px-5 pb-4 pt-5">
    <div className="flex gap-2">
      <div aria-hidden="true" className="relative w-14 shrink-0" style={{ height: chartHeight }}>
        {ticks.map((tick) => <span key={tick} className="tabular absolute right-0 translate-y-1/2 text-2xs leading-none text-muted" style={{ bottom: `${(tick / top) * 100}%` }}>{formatAxisMoney(tick, currency, decimals)}</span>)}
      </div>
      <div className="relative min-w-0 flex-1">
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0" style={{ height: chartHeight }}>
          {ticks.map((tick) => <div key={tick} className="absolute inset-x-0 border-t border-chart-grid" style={{ bottom: `${(tick / top) * 100}%` }} />)}
        </div>
        <ol role="group" aria-label="每日已确认成本；聚焦单日查看明细，或切换表格视图" className="relative flex items-stretch gap-[3px]" style={{ height: chartHeight }}>
          {data.map((point) => <li key={point.key} className="min-w-0 flex-1">
            <Tooltip content={<TrendTooltip point={point} currency={currency} owners={owners} />}>
              <div tabIndex={0} role="img" aria-label={`${point.label}：已确认成本 ${formatMoney(point.cost, currency)}，${point.calls} 条回执${point.unconfirmed ? `，${point.unconfirmed} 条成本未确认` : ""}`} className="flex h-full w-full cursor-default flex-col-reverse items-center rounded-[6px] outline-none transition-colors hover:bg-primary-soft/50 focus-visible:bg-primary-soft/50 focus-visible:ring-2 focus-visible:ring-focus">
                {point.cost > 0 && <div className="flex w-full max-w-6 flex-col-reverse overflow-hidden rounded-t-[4px]" style={{ height: `max(2px, ${(point.cost / top) * 100}%)` }}>
                  {Object.entries(point.byOwner).sort(([a], [b]) => owners.indexOf(a) - owners.indexOf(b)).map(([id, cost]) => <span key={id} className="block min-h-px" style={{ flex: `${cost} 1 0`, background: ownerColor(id), borderTop: "1px solid var(--panel)" }} />)}
                </div>}
              </div>
            </Tooltip>
          </li>)}
        </ol>
        <ol aria-hidden="true" className="mt-1.5 flex gap-[3px]">
          {data.map((point, index) => <li key={point.key} className="relative h-4 min-w-0 flex-1">
            {(data.length - 1 - index) % labelStep === 0 && <span className="tabular absolute left-1/2 top-0 -translate-x-1/2 whitespace-nowrap text-2xs text-muted">{point.label}</span>}
          </li>)}
        </ol>
        {max === 0 && <p className="pointer-events-none absolute inset-x-0 top-0 grid place-items-center text-body-sm text-muted" style={{ height: chartHeight }}>所选范围内没有已确认成本</p>}
      </div>
    </div>
  </div>;
}

function TrendTooltip({ point, currency, owners }: { point: TrendPoint; currency: string; owners: string[] }) {
  const parts = Object.entries(point.byOwner).sort(([a], [b]) => owners.indexOf(a) - owners.indexOf(b));
  return <div className="space-y-1">
    <p className="tabular font-semibold">{formatMoney(point.cost, currency)}<span className="ml-1.5 font-normal opacity-80">{point.label} · 已确认成本</span></p>
    {parts.map(([id, cost]) => <p key={id} className="tabular flex items-center gap-1.5"><span aria-hidden="true" className="size-2 rounded-[2px] ring-1 ring-panel/70" style={{ background: ownerColor(id) }} />{ownerLabel(id)} {formatMoney(Number(cost.toFixed(2)), currency)}</p>)}
    <p className="tabular opacity-80">{point.calls} 条回执{point.unconfirmed ? ` · ${point.unconfirmed} 条成本未确认` : ""}</p>
  </div>;
}

function TrendTable({ data, currency }: { data: TrendPoint[]; currency: string }) {
  return <div className="max-h-[276px] overflow-y-auto">
    <table aria-label="每日已确认成本" className="w-full text-body-sm">
      <thead className="sticky top-0 bg-panel-soft"><tr className="text-left text-2xs text-muted"><th scope="col" className="px-4 py-2 font-medium">日期</th><th scope="col" className="px-3 py-2 text-right font-medium">已确认成本</th><th scope="col" className="px-3 py-2 text-right font-medium">回执</th><th scope="col" className="px-4 py-2 text-right font-medium">未确认</th></tr></thead>
      <tbody className="divide-y divide-line">
        {data.map((row) => <tr key={row.key}><td className="px-4 py-2 tabular">{row.key}</td><td className="px-3 py-2 text-right tabular">{formatMoney(row.cost, currency)}</td><td className="px-3 py-2 text-right tabular">{row.calls}</td><td className="px-4 py-2 text-right tabular">{row.unconfirmed}</td></tr>)}
      </tbody>
    </table>
  </div>;
}
