import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CircleAlert, Info, ListFilter, Receipt, Table2, Wallet } from "../../icons";
import { api, type UsageEvent } from "../../shared/api/control-center-client";
import { useScopedRead } from "../../app/workspace";
import { Button, CoverageChip, EmptyState, InlineNotice, Panel, Pill, ReadStateView, SegmentedTabs, Select, SkeletonRows, StaleNotice, cx, ownerLabel } from "../../components/ui";
import { formatFullTime, formatMoney, formatRelative } from "../../shared/read-model/format";

type Range = "7" | "14" | "30";
const ownerSlots: Record<string, string> = { eikona: "var(--chart-1)", scaena: "var(--chart-2)", sonora: "var(--chart-3)" };
const costStateLabels: Record<string, string> = { confirmed: "已确认", estimated: "估算", pending: "待核算", unknown: "未知" };
const costStateTone = { confirmed: "success", estimated: "info", pending: "warning", unknown: "neutral" } as const;

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

function dayKey(time: number) {
  const date = new Date(time);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export default function UsageAnalytics() {
  const read = useScopedRead((scope, signal) => api.usage(scope, signal));
  const [range, setRange] = useState<Range>("14");
  const [owner, setOwner] = useState("all");
  const [tableView, setTableView] = useState(false);
  const rows = useMemo(() => dedupeUsage(read.data?.rows || []), [read.data]);
  const currencies = useMemo(() => [...new Set(rows.map((row) => row.currency))].sort((a, b) => a === "CNY" ? -1 : b === "CNY" ? 1 : a.localeCompare(b)), [rows]);
  const [currency, setCurrency] = useState<string | null>(null);
  const activeCurrency = currency && currencies.includes(currency) ? currency : currencies[0] || "CNY";

  const now = Date.now();
  const cutoff = now - Number(range) * 86400_000;
  const visible = rows.filter((row) => {
    const time = Date.parse(row.created_at);
    return Number.isFinite(time) && time >= cutoff && (owner === "all" || row.owner === owner);
  });
  const totals = confirmedTotals(visible);
  const pending = visible.filter((row) => row.cost_state !== "confirmed").length;
  const unknownCost = visible.filter((row) => row.upstream_cost === null).length;
  const owners = [...new Set(rows.map((row) => row.owner))];

  const trend = useMemo(() => {
    const days = Number(range);
    const buckets = Array.from({ length: days }, (_, index) => {
      const time = now - (days - 1 - index) * 86400_000;
      return { key: dayKey(time), label: new Date(time).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" }), cost: 0, calls: 0, unconfirmed: 0 };
    });
    const index = new Map(buckets.map((bucket) => [bucket.key, bucket]));
    for (const row of visible) {
      const bucket = index.get(dayKey(Date.parse(row.created_at)));
      if (!bucket) continue;
      bucket.calls += 1;
      if (row.currency !== activeCurrency) continue;
      if (row.cost_state === "confirmed" && row.upstream_cost !== null) bucket.cost += row.upstream_cost;
      else bucket.unconfirmed += 1;
    }
    return buckets.map((bucket) => ({ ...bucket, cost: Number(bucket.cost.toFixed(2)) }));
  }, [visible, range, activeCurrency, now]);

  const byOwner = useMemo(() => ["eikona", "scaena", "sonora"].map((id) => {
    const ownerRows = visible.filter((row) => row.owner === id);
    const confirmed = ownerRows.filter((row) => row.currency === activeCurrency && row.cost_state === "confirmed" && row.upstream_cost !== null).reduce((sum, row) => sum + (row.upstream_cost || 0), 0);
    return { owner: id, calls: ownerRows.length, cost: Number(confirmed.toFixed(2)), unconfirmed: ownerRows.filter((row) => row.cost_state !== "confirmed").length };
  }).filter((item) => item.calls > 0), [visible, activeCurrency]);

  const budget = read.data?.budget;
  const coverage = read.data?.coverage;

  return <div className="page-enter space-y-5" data-page="usage">
    <h1 className="sr-only">用量与成本</h1>
    <div className="flex min-h-8 flex-wrap items-center justify-end gap-2 text-2xs text-muted">
      {coverage && <>
        <CoverageChip state={coverage.state} />
        {coverage.observed_at && <span className="text-2xs text-muted">观察于 {formatRelative(coverage.observed_at)}</span>}
      </>}
    </div>
    {coverage?.reason && <InlineNotice tone="info" icon={<Info />}>{coverage.reason}</InlineNotice>}
    <StaleNotice status={read.status} error={read.error} observedAt={read.observedAt} onRetry={read.reload} />

    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="用量筛选">
      <span className="flex items-center gap-1.5 text-2xs font-medium text-muted"><ListFilter className="size-3.5" />筛选</span>
      <SegmentedTabs label="时间范围" value={range} onChange={setRange} options={[{ id: "7", label: "近 7 天" }, { id: "14", label: "近 14 天" }, { id: "30", label: "近 30 天" }]} />
      <Select aria-label="来源" value={owner} onChange={(event) => setOwner(event.target.value)} className="w-32">
        <option value="all">全部来源</option>
        {owners.map((item) => <option key={item} value={item}>{ownerLabel(item)}</option>)}
      </Select>
      {currencies.length > 1 && <Select aria-label="币种" value={activeCurrency} onChange={(event) => setCurrency(event.target.value)} className="w-28">
        {currencies.map((item) => <option key={item} value={item}>{item}</option>)}
      </Select>}
    </div>

    <ReadStateView status={read.status === "empty" ? "ready" : read.status} error={read.error} onRetry={read.reload} skeleton={<Panel><SkeletonRows rows={4} /></Panel>}>
      <section aria-label="用量概览" className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Kpi label="已确认上游成本" icon={<Wallet />} value={Object.keys(totals).length ? Object.entries(totals).map(([code, amount]) => formatMoney(amount, code)).join(" · ") : "未观察到"} hint="只计入 owner 回执中已确认的费用" muted={!Object.keys(totals).length} />
        <Kpi label="用量回执" icon={<Receipt />} value={visible.length.toLocaleString("zh-CN")} hint="按 owner + source_ref 去重" />
        <Kpi label="待核算" icon={<CircleAlert />} value={pending.toLocaleString("zh-CN")} hint={`其中 ${unknownCost} 条成本未知`} muted={pending === 0} />
        <BudgetTile budget={budget} />
      </section>

      {rows.length === 0 ? <Panel><EmptyState icon={<Receipt />} title="尚无用量回执" body="用量只来自经控制中心提交的 Provider 运行回执；提交门关闭时这里保持为空。历史 owner 账本仍按来源读取。" /></Panel> : <>
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <Panel title={`每日已确认成本 · ${activeCurrency}`} actions={<Button size="sm" variant={tableView ? "secondary" : "ghost"} aria-pressed={tableView} onClick={() => setTableView((value) => !value)} icon={<Table2 className="size-3.5" />}>表格视图</Button>}>
            {tableView ? <TrendTable data={trend} currency={activeCurrency} /> : <div className="h-[260px] px-2 pb-3 pt-4">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={trend} margin={{ top: 8, right: 12, bottom: 0, left: 0 }} barCategoryGap="28%">
                  <CartesianGrid vertical={false} stroke="var(--chart-grid)" strokeWidth={1} />
                  <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: "var(--chart-grid)" }} tick={{ fill: "var(--chart-axis)", fontSize: 11 }} interval="preserveStartEnd" minTickGap={16} />
                  <YAxis tickLine={false} axisLine={false} width={44} tick={{ fill: "var(--chart-axis)", fontSize: 11 }} tickFormatter={(value: number) => value.toLocaleString("zh-CN")} allowDecimals />
                  <Tooltip cursor={{ fill: "color-mix(in srgb, var(--chart-1) 8%, transparent)" }} content={<TrendTooltip currency={activeCurrency} />} />
                  <Bar dataKey="cost" name="已确认成本" fill="var(--chart-1)" radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>}
          </Panel>

          <Panel title={`按来源 · ${activeCurrency}`}>
            <ul className="space-y-4 p-5">
              {byOwner.map((item) => {
                const max = Math.max(...byOwner.map((entry) => entry.cost), 0.01);
                return <li key={item.owner}>
                  <div className="flex items-baseline justify-between gap-3 text-[13px]">
                    <span className="flex items-center gap-2 font-medium"><span aria-hidden="true" className="size-2.5 rounded-[3px]" style={{ background: ownerSlots[item.owner] }} />{ownerLabel(item.owner)}</span>
                    <span className="tabular text-ink">{formatMoney(item.cost, activeCurrency)}</span>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-panel-sunken">
                    <div className="h-full rounded-full" style={{ width: `${(item.cost / max) * 100}%`, background: ownerSlots[item.owner] }} />
                  </div>
                  <p className="mt-1.5 text-2xs text-muted tabular">{item.calls} 条回执{item.unconfirmed ? ` · ${item.unconfirmed} 条未确认成本未计入` : ""}</p>
                </li>;
              })}
              {byOwner.length === 0 && <li className="text-[13px] text-muted">所选范围内没有回执。</li>}
            </ul>
          </Panel>
        </div>

        <Panel title="原始用量回执" actions={<span className="text-2xs text-muted tabular">{visible.length} 条</span>} bodyClassName="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-[13px]">
              <thead>
                <tr className="border-b border-line bg-panel-soft text-left text-2xs text-muted">
                  <th scope="col" className="px-4 py-2 font-medium">时间</th>
                  <th scope="col" className="px-3 py-2 font-medium">来源 · 模型</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">计量</th>
                  <th scope="col" className="px-3 py-2 font-medium">成本状态</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">上游成本</th>
                  <th scope="col" className="px-4 py-2 font-medium">引用</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {visible.slice().sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)).slice(0, 100).map((row) => <tr key={row.owner + row.source_ref} className="hover:bg-panel-soft">
                  <td className="whitespace-nowrap px-4 py-2.5 text-ink-soft tabular" title={formatFullTime(row.created_at)}>{formatRelative(row.created_at)}</td>
                  <td className="max-w-[260px] px-3 py-2.5"><span className="block truncate font-medium">{ownerLabel(row.owner)}</span><span className="block truncate font-mono text-2xs text-muted">{row.model_ref}</span></td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right tabular">{row.quantity === null ? <span className="text-faint">未知</span> : `${row.quantity.toLocaleString("zh-CN")} ${row.unit}`}</td>
                  <td className="px-3 py-2.5"><Pill tone={costStateTone[row.cost_state as keyof typeof costStateTone] || "neutral"}>{costStateLabels[row.cost_state] || row.cost_state}</Pill></td>
                  <td className={cx("whitespace-nowrap px-3 py-2.5 text-right tabular", row.upstream_cost === null && "text-faint")}>{row.upstream_cost === null ? "未知" : formatMoney(row.upstream_cost, row.currency)}</td>
                  <td className="max-w-[200px] px-4 py-2.5"><span className="block truncate font-mono text-2xs text-muted" title={row.source_ref}>{row.source_ref}</span></td>
                </tr>)}
              </tbody>
            </table>
          </div>
        </Panel>
      </>}
    </ReadStateView>
  </div>;
}

function Kpi({ label, value, hint, icon, muted = false }: { label: string; value: string; hint: string; icon: React.ReactNode; muted?: boolean }) {
  return <div className="flex min-w-0 flex-col gap-1 rounded-card border border-line bg-panel p-4 shadow-panel">
    <span className="flex items-center gap-1.5 text-2xs text-muted [&>svg]:size-3.5">{icon}{label}</span>
    <span className={cx("truncate text-xl font-semibold tracking-tight", muted && "text-faint")}>{value}</span>
    <span className="truncate text-2xs text-faint">{hint}</span>
  </div>;
}

function BudgetTile({ budget }: { budget?: { total: number; reserved: number; remaining: number; per_owner: Record<string, number> } }) {
  if (!budget) return <Kpi label="内部预算观察" icon={<Wallet />} value="未提供" hint="服务端未返回预算观察" muted />;
  const ratio = Math.min(1, budget.reserved / Math.max(budget.total, 0.01));
  return <div className="flex min-w-0 flex-col gap-1 rounded-card border border-line bg-panel p-4 shadow-panel">
    <span className="flex items-center gap-1.5 text-2xs text-muted"><Wallet className="size-3.5" />内部预算观察</span>
    <span className="truncate text-xl font-semibold tracking-tight">{formatMoney(budget.remaining, "CNY")}<span className="ml-1 text-xs font-normal text-muted">剩余</span></span>
    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-primary-soft" role="meter" aria-label="预算已预留比例" aria-valuemin={0} aria-valuemax={budget.total} aria-valuenow={budget.reserved}>
      <div className={cx("h-full rounded-full", ratio > 0.85 ? "bg-danger" : ratio > 0.6 ? "bg-warning" : "bg-primary")} style={{ width: `${ratio * 100}%` }} />
    </div>
    <span className="truncate text-2xs text-faint tabular">已预留 {formatMoney(budget.reserved, "CNY")} / {formatMoney(budget.total, "CNY")} · {Object.entries(budget.per_owner).map(([id, cap]) => `${ownerLabel(id)} ${cap}`).join(" · ")}</span>
  </div>;
}

function TrendTooltip({ active, payload, currency }: { active?: boolean; payload?: { payload: { label: string; cost: number; calls: number; unconfirmed: number } }[]; currency: string }) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  return <div className="rounded-[10px] border border-line bg-panel px-3 py-2 text-xs shadow-float">
    <p className="font-semibold text-ink tabular">{formatMoney(point.cost, currency)}</p>
    <p className="mt-0.5 flex items-center gap-1.5 text-muted"><span aria-hidden="true" className="h-0.5 w-3 rounded-full" style={{ background: "var(--chart-1)" }} />{point.label} · 已确认成本</p>
    <p className="mt-1 text-muted tabular">{point.calls} 条回执{point.unconfirmed ? ` · ${point.unconfirmed} 条成本未确认` : ""}</p>
  </div>;
}

function TrendTable({ data, currency }: { data: { key: string; label: string; cost: number; calls: number; unconfirmed: number }[]; currency: string }) {
  return <div className="max-h-[276px] overflow-y-auto">
    <table className="w-full text-[13px]">
      <thead className="sticky top-0 bg-panel-soft"><tr className="text-left text-2xs text-muted"><th scope="col" className="px-4 py-2 font-medium">日期</th><th scope="col" className="px-3 py-2 text-right font-medium">已确认成本</th><th scope="col" className="px-3 py-2 text-right font-medium">回执</th><th scope="col" className="px-4 py-2 text-right font-medium">未确认</th></tr></thead>
      <tbody className="divide-y divide-line">
        {data.map((row) => <tr key={row.key}><td className="px-4 py-2 tabular">{row.key}</td><td className="px-3 py-2 text-right tabular">{formatMoney(row.cost, currency)}</td><td className="px-3 py-2 text-right tabular">{row.calls}</td><td className="px-4 py-2 text-right tabular">{row.unconfirmed}</td></tr>)}
      </tbody>
    </table>
  </div>;
}
