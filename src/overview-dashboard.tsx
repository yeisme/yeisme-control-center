import type { ReactNode } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Activity,
  ArrowRight,
  AudioLines,
  Box,
  CheckCircle2,
  CircleAlert,
  Layers,
  RefreshCw,
} from "./icons";
import { Card, CardContent, CardHeader, Button } from "./components/ui";
import {
  defaultQuery,
  filterFacts,
  statistics,
  type HistoryQuery,
  type RequestFact,
} from "./admin-state";

export function OverviewDashboard({
  rows,
  onHistory,
  onAssets,
  children,
}: {
  rows: RequestFact[];
  onHistory: (query?: HistoryQuery) => void;
  onAssets: () => void;
  children: ReactNode;
}) {
  const visible = filterFacts(rows, defaultQuery);
  const facts = [
    ...new Map(visible.map((row) => [row.owner + ":" + row.id, row])).values(),
  ];
  const stats = statistics(facts);
  const groups = new Map<string, RequestFact[]>();
  facts.forEach((row) => {
    const day = new Date(Date.parse(row.createdAt) + 8 * 3600000)
      .toISOString()
      .slice(0, 10);
    groups.set(day, [...(groups.get(day) || []), row]);
  });
  const trend = [...groups]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, values]) => ({
      date,
      day: date.slice(5),
      ...statistics(values),
    }));
  const cards = [
    {
      label: "网关调用",
      value: String(stats.gateway),
      note: "近 7 天 · 网关请求",
      key: "gateway",
      icon: Activity,
      action: () => onHistory({ ...defaultQuery, kind: "gateway" }),
    },
    {
      label: "生成任务",
      value: String(stats.generation),
      note: "按原始任务独立统计",
      key: "generation",
      icon: Layers,
      action: () => onHistory({ ...defaultQuery, kind: "generation" }),
    },
    {
      label: "执行尝试",
      value: String(stats.attempts),
      note: "包含重试与恢复尝试",
      key: "attempts",
      icon: RefreshCw,
      action: () => onHistory(),
    },
    {
      label: "关联产出",
      value: String(stats.outputs),
      note: "沿明确的资产引用查看",
      key: "outputs",
      icon: Box,
      action: onAssets,
    },
    {
      label: "已决成功率",
      value: stats.rate === null ? "—" : (stats.rate * 100).toFixed(1) + "%",
      note: `${stats.success} 成功 / ${stats.denominator} 个已决结果`,
      key: "success",
      icon: CheckCircle2,
      action: () => onHistory({ ...defaultQuery, state: "succeeded" }),
    },
    {
      label: "结果未知",
      value: String(stats.unknown),
      note: "先查询原请求，再决定恢复",
      key: "unknown",
      icon: CircleAlert,
      action: () => onHistory({ ...defaultQuery, state: "unknown" }),
    },
  ];
  return (
    <div className="sales-dashboard">
      <div className="sales-kpis">
        {cards
          .filter((_, i) => [0, 1, 5].includes(i))
          .map((card) => (
            <Card
              key={card.label}
              className="sales-metric"
              role="button"
              tabIndex={0}
              aria-label={card.label + " " + card.value}
              onClick={card.action}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  card.action();
                }
              }}
            >
              <div className="metric-top">
                <span className="metric-symbol">
                  <card.icon size={16} />
                </span>
                <strong className="metric-value">{card.value}</strong>
              </div>
              <div>
                <h2>{card.label}</h2>
                <p className="metric-note">{card.note}</p>
              </div>
            </Card>
          ))}
      </div>
      <div className="overview-secondary">
        {cards
          .filter((_, i) => [2, 3, 4].includes(i))
          .map((card) => (
            <button
              key={card.label}
              className="sales-metric metric-inline"
              aria-label={card.label + " " + card.value}
              onClick={card.action}
            >
              <span>{card.label}</span>
              <strong className="metric-value">{card.value}</strong>
              <small>{card.note}</small>
            </button>
          ))}
      </div>
      <div className="sales-grid">
        <Card className="sales-trend">
          <CardHeader>
            <div>
              <h2>请求趋势</h2>
              <p className="health-note">近 7 天 · Asia/Shanghai</p>
            </div>
            <div className="chart-legend">
              <span>
                <i />
                网关调用
              </span>
              <span>
                <i />
                生成任务
              </span>
            </div>
          </CardHeader>
          <CardContent>
            <div
              className="trend-chart"
              role="img"
              aria-label={`近7天：${stats.gateway}次网关调用，${stats.generation}个生成任务；点击日期查看记录`}
            >
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={trend}
                  barGap={4}
                  margin={{ left: -22, right: 0, top: 8, bottom: 0 }}
                  accessibilityLayer
                  onClick={(state) => {
                    const day = trend.find((t) => t.day === state.activeLabel);
                    if (day)
                      onHistory({
                        ...defaultQuery,
                        days: "custom",
                        from: day.date,
                        to: day.date,
                      });
                  }}
                >
                  <CartesianGrid
                    vertical={false}
                    stroke="var(--border)"
                    strokeDasharray="3 4"
                  />
                  <XAxis
                    dataKey="day"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 12, fill: "var(--muted)" }}
                  />
                  <YAxis
                    allowDecimals={false}
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 12, fill: "var(--muted)" }}
                  />
                  <Tooltip
                    cursor={{ fill: "var(--hover)" }}
                    contentStyle={{
                      background: "var(--panel)",
                      border: "1px solid var(--border)",
                      borderRadius: 8,
                      fontSize: 12,
                      color: "var(--text)",
                    }}
                  />
                  <Bar
                    isAnimationActive={false}
                    dataKey="gateway"
                    name="网关调用"
                    fill="var(--chart-teal)"
                    radius={[5, 5, 0, 0]}
                    maxBarSize={24}
                  />
                  <Bar
                    isAnimationActive={false}
                    dataKey="generation"
                    name="生成任务"
                    fill="var(--chart-orange)"
                    radius={[5, 5, 0, 0]}
                    maxBarSize={24}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="health-note">
              网关调用、领域任务和执行尝试分别统计，不相加为总请求。
              <button className="text-button" onClick={() => onHistory()}>
                查看明细 <ArrowRight size={13} />
              </button>
            </div>
          </CardContent>
        </Card>
        <Card className="sales-health">
          <CardHeader>
            <h2>执行结果</h2>
            <AudioLines size={18} />
          </CardHeader>
          <CardContent>
            <div>
              <div className="health-rate">
                {stats.rate === null
                  ? "—"
                  : (stats.rate * 100).toFixed(1) + "%"}
              </div>
              <p className="health-note">
                成功率 · {stats.success} / {stats.denominator} 已决结果
              </p>
            </div>
            <div className="health-track" aria-hidden="true">
              <span style={{ width: (stats.rate || 0) * 100 + "%" }} />
            </div>
            <div className="health-breakdown">
              <div>
                <strong>{stats.success}</strong>
                <small>成功</small>
              </div>
              <div>
                <strong>{stats.failed}</strong>
                <small>失败</small>
              </div>
              <div>
                <strong>{stats.running}</strong>
                <small>运行中</small>
              </div>
            </div>
            <p className="health-note">
              取消 {stats.cancelled} · 未知 {stats.unknown}
              <br />
              不计入成功率分母。没有可比较的前期数据，不显示增长率。
            </p>
            <Button onClick={() => onHistory()} variant="primary">
              查看请求历史 <ArrowRight size={14} />
            </Button>
          </CardContent>
        </Card>
      </div>
      {children}
    </div>
  );
}
