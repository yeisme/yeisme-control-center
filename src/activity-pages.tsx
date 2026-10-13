import { requestDetailTabs } from "./app-shell";
import { demoInvestigation, demoRead } from "./demo-investigation";
import { RequestContent, RequestBody } from "./request-content";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Activity,
  ArrowDownToLine,
  ArrowRight,
  Check,
  Clock3,
  FileText,
  Image,
  RefreshCw,
  Video,
  Volume2,
} from "./icons";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Badge, Button, Empty, Modal, Pick } from "./ui";
import { CopyReference, PanelNotice } from "./workspace";
import {
  AdminPanel,
  AdvancedFilters,
  AdminTabs,
  DataTable,
  MultiSelect,
  DateRange,
  FilterSummary,
  Kpis,
  PageActions,
  SearchInput,
  type DataColumn,
} from "./admin-ui";
import {
  actorNames,
  tenants,
  dateLabel,
  defaultQuery,
  durationLabel,
  filterFacts,
  ownerNames,
  statistics,
  type HistoryQuery,
  type ManagementScope,
  type RequestFact,
} from "./admin-state";

const kindNames: Record<string, string> = {
  gateway: "网关调用",
  generation: "生成任务",
  operation: "业务操作",
};
const money = (r: RequestFact) =>
  r.amount === null
    ? "—"
    : `${r.currency === "CNY" ? "¥" : "$"} ${r.amount.toFixed(2)}`;
const stateOptions = ["succeeded", "failed", "running", "unknown", "cancelled"];
const stateNames: Record<string, string> = {
  succeeded: "成功",
  failed: "失败",
  running: "运行中",
  unknown: "结果未知",
  cancelled: "已取消",
  waiting_review: "待审阅",
};
export function ActivityFilters({
  query,
  onChange,
  rows,
  dates = true,
}: {
  query: HistoryQuery;
  onChange: (q: HistoryQuery) => void;
  rows: RequestFact[];
  dates?: boolean;
}) {
  return (
    <>
      <SearchInput
        value={query.search}
        onChange={(search) => onChange({ ...query, search })}
        label="搜索请求、项目或引用"
      />
      {dates && <DateRange query={query} onChange={onChange} />}
      <Pick
        label="请求状态"
        value={query.state}
        onChange={(state) => onChange({ ...query, state })}
        options={[
          { value: "all", label: "全部状态" },
          ...stateOptions.map((s) => ({ value: s, label: stateNames[s] })),
        ]}
      />
      <AdvancedFilters
        count={
          [
            query.owner,
            query.actor,
            query.projectRef,
            query.inputType,
            query.hasAttachments,
            query.hasOutputs,
          ].filter((v) => v && v !== "all").length +
          (query.kind === defaultQuery.kind ? 0 : 1)
        }
        onClear={() =>
          onChange({
            ...defaultQuery,
            search: query.search,
            days: query.days,
            state: query.state,
          })
        }
      >
        <Pick
          label="服务筛选"
          value={query.owner}
          onChange={(owner) => onChange({ ...query, owner })}
          options={[
            { value: "all", label: "全部服务" },
            ...[...new Set(rows.map((r) => r.owner))].map((o) => ({
              value: o,
              label: ownerNames[o] || o,
            })),
          ]}
        />
        <Pick
          label="调用者筛选"
          value={query.actor}
          onChange={(actor) => onChange({ ...query, actor })}
          options={[
            { value: "all", label: "全部调用者" },
            ...[...new Set(rows.map((r) => r.actor))].map((a) => ({
              value: a,
              label: actorNames[a] || a,
            })),
          ]}
        />
        <Pick
          label="历史项目"
          value={query.projectRef || "all"}
          onChange={(projectRef) => onChange({ ...query, projectRef })}
          options={[
            { value: "all", label: "全部项目" },
            ...[...new Set(rows.map((r) => r.project))].map((value) => ({
              value,
              label:
                rows.find((r) => r.project === value)!.projectName +
                " · " +
                (tenants.find(
                  (t) => t.id === rows.find((r) => r.project === value)!.tenant,
                )?.name || ""),
            })),
          ]}
        />
        <MultiSelect
          label="记录类型"
          value={query.kind}
          onChange={(kind) => onChange({ ...query, kind })}
          options={Object.entries(kindNames).map(([value, label]) => ({
            value,
            label,
          }))}
        />
        <Pick
          label="输入类型"
          value={query.inputType || "all"}
          onChange={(inputType) => onChange({ ...query, inputType })}
          options={[
            { value: "all", label: "全部输入" },
            { value: "text", label: "文本" },
            { value: "image", label: "图像附件" },
            { value: "audio", label: "音频附件" },
            { value: "video", label: "视频附件" },
          ]}
        />
        <Pick
          label="附件筛选"
          value={query.hasAttachments || "all"}
          onChange={(hasAttachments) => onChange({ ...query, hasAttachments })}
          options={[
            { value: "all", label: "全部附件状态" },
            { value: "yes", label: "有输入附件" },
            { value: "no", label: "无已关联附件" },
          ]}
        />
        <Pick
          label="产出筛选"
          value={query.hasOutputs || "all"}
          onChange={(hasOutputs) => onChange({ ...query, hasOutputs })}
          options={[
            { value: "all", label: "全部产出状态" },
            { value: "yes", label: "有产出" },
            { value: "no", label: "无已关联产出" },
          ]}
        />
      </AdvancedFilters>
    </>
  );
}
export function requestColumns(
  finance: boolean,
  platform = false,
): DataColumn<RequestFact>[] {
  return [
    {
      id: "title",
      label: "请求 / 任务",
      primary: true,
      width: 235,
      value: (r) => r.title,
      render: (r) => (
        <div className="record-title">
          <span>
            <strong>{r.title}</strong>
            <small>
              {r.id.split(":").at(-1)} · {kindNames[r.kind]}
            </small>
          </span>
        </div>
      ),
    },
    {
      id: "time",
      label: "发起时间",
      value: (r) => r.createdAt,
      render: (r) => (
        <span className="tabular muted">{dateLabel(r.createdAt)}</span>
      ),
      width: 122,
    },
    {
      id: "owner",
      label: "服务",
      value: (r) => ownerNames[r.owner] || r.owner,
    },
    {
      id: "actor",
      label: "调用者",
      value: (r) => actorNames[r.actor] || r.actor,
      render: (r) => (
        <span className="person-cell">{actorNames[r.actor] || r.actor}</span>
      ),
    },
    { id: "project", label: "项目", value: (r) => r.projectName },
    {
      id: "tenant",
      label: "租户",
      value: (r) => tenants.find((t) => t.id === r.tenant)?.name || r.tenant,
      hidden: !platform,
    },
    {
      id: "state",
      label: "状态",
      value: (r) => stateNames[r.state] || r.state,
      render: (r) => <Badge state={r.state} />,
    },
    {
      id: "duration",
      label: "耗时",
      value: (r) => r.duration,
      render: (r) => durationLabel(r.duration),
      numeric: true,
    },
    { id: "model", label: "模型 / 能力", value: (r) => r.model, hidden: true },
    {
      id: "attempts",
      label: "尝试次数",
      value: (r) => r.attempts,
      numeric: true,
      hidden: true,
    },
    {
      id: "outputs",
      label: "产出",
      value: (r) => r.outputs,
      numeric: true,
      hidden: true,
    },
    ...(finance
      ? [
          {
            id: "cost",
            label: "费用",
            value: money,
            numeric: true,
            hidden: true,
          },
        ]
      : []),
  ];
}
export function RequestDetail({
  record,
  close,
  scope,
  onChange,
  onLegacy,
  writable,
}: {
  record: RequestFact;
  close: () => void;
  scope: ManagementScope;
  onChange: (r: RequestFact, newAttempt?: RequestFact) => void;
  onLegacy: (id: string) => void;
  writable: boolean;
}) {
  const [tab, setTab] = useState("概况"),
    [confirm, setConfirm] = useState(false),
    [confirmAction, setConfirmAction] = useState("retry"),
    [ack, setAck] = useState(false),
    [pending, setPending] = useState(false),
    [receipt, setReceipt] = useState("");
  const busy = useRef(false),
    alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );
  const submit = (action: string) => {
    if (busy.current || !writable) return;
    busy.current = true;
    setPending(true);
    setTimeout(() => {
      if (!alive.current) return;
      if (action === "reconcile")
        onChange({
          ...record,
          state: "waiting_review",
          native: "result_recovered",
          outputs: record.kind === "generation" ? 1 : 0,
          assetRefs:
            record.kind === "generation" ? [`demo:asset:${record.id}`] : [],
          reason: "已恢复原请求；未产生第二次提交",
        });
      if (action === "cancel")
        onChange({
          ...record,
          state: "cancelled",
          native: "cancelled",
          reason: "原操作已取消；已发生费用不撤销",
        });
      if (action === "retry")
        onChange(record, {
          ...record,
          id: record.id + ":retry-1",
          legacy: undefined,
          parentRef: record.id,
          attempts: 1,
          state: "queued",
          native: "queued",
          amount: null,
          costState: "unknown",
          chargeRef: record.chargeRef + ":retry-1",
          assetRefs: [],
          outputs: 0,
          reason: "经单独费用确认的新请求",
        });
      setReceipt(`demo:receipt:${action}:${record.id}`);
      setPending(false);
      busy.current = false;
      setConfirm(false);
    }, 400);
  };
  return (
    <AdminPanel
      open
      editing={false}
      title={record.title}
      subtitle={ownerNames[record.owner] + " · " + kindNames[record.kind]}
      icon={<Activity size={18} />}
      status={<Badge state={record.state} />}
      stage="请求详情"
      context="演示记录 · 原始引用保留"
      objectKey={record.id}
      close={() => {
        if (!pending) close();
      }}
      tabs={
        <AdminTabs value={tab} onChange={setTab} items={requestDetailTabs} />
      }
      footer={
        <>
          {record.legacy ? (
            <Button
              onClick={() => {
                onLegacy(record.legacy!);
                close();
              }}
            >
              打开原任务
              <ArrowRight size={14} />
            </Button>
          ) : (
            writable && (
              <>
                {record.state === "unknown" && (
                  <Button
                    variant="primary"
                    disabled={pending || !!receipt}
                    onClick={() => submit("reconcile")}
                  >
                    查询原结果
                  </Button>
                )}
                {record.state === "failed" && (
                  <Button
                    disabled={pending || !!receipt}
                    onClick={() => {
                      setConfirmAction("retry");
                      setAck(false);
                      setConfirm(true);
                    }}
                  >
                    预览重新生成
                  </Button>
                )}
                {["running", "queued"].includes(record.state) && (
                  <Button
                    disabled={pending || !!receipt}
                    onClick={() => {
                      setConfirmAction("cancel");
                      setAck(false);
                      setConfirm(true);
                    }}
                  >
                    取消任务
                  </Button>
                )}
              </>
            )
          )}
        </>
      }
    >
      {receipt && (
        <PanelNotice title="演示回执已返回">
          <CopyReference value={receipt} />
          <p>保留原请求身份，可继续查看当前结果。</p>
        </PanelNotice>
      )}
      {tab === "概况" && (
        <>
          <div className="detail-object">
            <span className="detail-object-icon">
              <Activity size={24} />
            </span>
            <p>{record.reason}</p>
          </div>
          <dl className="admin-properties">
            {[
              ["项目", record.projectName],
              ["调用者", actorNames[record.actor] || record.actor],
              ["模型 / 能力", record.model],
              ["发起时间", dateLabel(record.createdAt)],
              ["耗时", durationLabel(record.duration)],
              ["执行尝试", String(record.attempts)],
              ["原始状态", record.native],
            ].map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
          <div className="detail-section">
            <h4>原请求引用</h4>
            <CopyReference value={record.id} />
            <h4>父请求</h4>
            {record.parentRef ? (
              <CopyReference value={record.parentRef} />
            ) : (
              <p className="muted">未关联 · 没有明确的跨服务引用</p>
            )}
          </div>
        </>
      )}
      {tab === "内容" && (
        <RequestBody record={demoInvestigation(record)} read={demoRead} />
      )}
      {tab === "执行" && (
        <div className="admin-timeline">
          {[
            { title: "请求已接收", text: dateLabel(record.createdAt) },
            {
              title: "执行尝试",
              text: `${record.attempts} 次 · 未提供尝试引用，不补造执行链`,
            },
            {
              title: stateNames[record.state] || record.state,
              text: record.reason,
            },
          ].map((s, i) => (
            <div key={i}>
              <span />
              <section>
                <strong>{s.title}</strong>
                <p>{s.text}</p>
              </section>
            </div>
          ))}
        </div>
      )}
      {tab === "内容" &&
        (record.assetRefs.length ? (
          <div className="detail-section">
            <PanelNotice title={`${record.outputs} 项产出`}>
              演示仅提供资产引用；真实媒体预览需要 owner 的授权读取合同。
            </PanelNotice>
            {record.assetRefs.map((a) => (
              <div className="linked-record" key={a}>
                <FileText size={18} />
                <CopyReference value={a} />
                <Badge state="waiting_review" />
              </div>
            ))}
          </div>
        ) : (
          <Empty
            title="尚无可关联的产出"
            description="已完成的请求也可能不产生媒体资产。"
          />
        ))}
      {tab === "概况" && scope.role === "admin" && (
        <>
          <dl className="admin-properties">
            <div>
              <dt>客户费用</dt>
              <dd>{money(record)}</dd>
            </div>
            <div>
              <dt>确认状态</dt>
              <dd>
                <Badge state={record.costState} />
              </dd>
            </div>
            <div>
              <dt>上游成本</dt>
              <dd>未知</dd>
            </div>
          </dl>
          <CopyReference value={record.chargeRef} />
          <PanelNotice title="费用口径">
            按账单引用去重。费用未知不代表免费；客户费用与上游成本分别核对。
          </PanelNotice>
        </>
      )}
      {tab === "执行" && (
        <div className="detail-section">
          <h4>owner 返回的状态</h4>
          <code>{record.native}</code>
          <p>{record.reason}</p>
          <PanelNotice title="恢复路径">
            结果未知先查询原操作；重新生成需单独确认费用。关联证据不足时不自动拼接请求链。
          </PanelNotice>
          <CopyReference value={record.id} />
        </div>
      )}
      <Modal
        open={confirm}
        close={() => !pending && setConfirm(false)}
        title={
          confirmAction === "retry" ? "确认新的生成请求" : "确认取消原任务"
        }
        description={
          confirmAction === "retry"
            ? "原请求保持不变。这次操作可能产生新的费用，实际金额未知。"
            : "取消当前执行，已发生的费用不会撤销。"
        }
      >
        <label className="confirmation-field">
          <input
            type="checkbox"
            checked={ack}
            onChange={(e) => setAck(e.target.checked)}
          />
          <span>
            {confirmAction === "retry"
              ? "我已确认新的请求与可能产生的费用"
              : "我已确认取消影响和原任务范围"}
          </span>
        </label>
        <div className="dialog-actions">
          <Button onClick={() => setConfirm(false)}>返回</Button>
          <Button
            variant="primary"
            disabled={!ack || pending}
            onClick={() => submit(confirmAction)}
          >
            {pending
              ? "提交中…"
              : confirmAction === "retry"
                ? "确认重新生成"
                : "确认取消"}
          </Button>
        </div>
      </Modal>
    </AdminPanel>
  );
}
export function RequestsPage({
  rows,
  scope,
  queue,
  tab,
  setTab,
  query,
  setQuery,
  onLegacy,
  onChange,
  writable,
  onPending,
}: {
  rows: RequestFact[];
  scope: ManagementScope;
  queue: ReactNode;
  tab: string;
  setTab: (s: string) => void;
  query: HistoryQuery;
  setQuery: (q: HistoryQuery) => void;
  onLegacy: (id: string) => void;
  onChange: (r: RequestFact, next?: RequestFact) => void;
  writable: boolean;
  onPending: () => void;
}) {
  const [selected, setSelected] = useState<string | null>(null),
    [batch, setBatch] = useState<string[]>([]),
    [showBatch, setShowBatch] = useState(false);
  const alertResults = useRef<string[]>([]);
  const record = rows.find((r) => r.id === selected),
    base =
      tab === "generation" ? rows.filter((r) => r.kind === "generation") : rows,
    filtered = filterFacts(base, query);
  const columns = useMemo(
    () =>
      requestColumns(scope.role === "admin", scope.perspective === "platform"),
    [scope.role, scope.perspective],
  );
  const stats = statistics(filtered);
  return (
    <>
      <div className="page-tabs-row">
        <AdminTabs
          value={tab}
          onChange={(v) => {
            setTab(v);
            setSelected(null);
            setBatch([]);
          }}
          items={[
            { id: "queue", label: "运行队列" },
            { id: "history", label: "请求历史" },
            {
              id: "generation",
              label: "生成记录",
            },
          ]}
        />
        <Button variant="ghost" onClick={onPending}>
          待处理 <ArrowRight size={14} />
        </Button>
      </div>
      {tab === "queue" ? (
        queue
      ) : (
        <>
          <div className="results-summary" aria-label="请求摘要">
            <span>
              <b>{filtered.length}</b> 条记录
            </span>
            <span>
              已决成功率{" "}
              <b>
                {stats.rate === null
                  ? "—"
                  : (stats.rate * 100).toFixed(1) + "%"}
              </b>
              <small>
                {" "}
                · {stats.success} / {stats.denominator}
              </small>
            </span>
            <span>
              结果未知 <b>{stats.unknown}</b>
            </span>
            <span>
              关联产出 <b>{stats.outputs}</b>
            </span>
          </div>
          <FilterSummary query={query} onChange={setQuery} />
          <DataTable
            id={"requests." + JSON.stringify(scope) + "." + tab}
            label={tab === "generation" ? "生成记录" : "请求历史"}
            rows={filtered}
            columns={columns}
            onOpen={(r) => setSelected(r.id)}
            viewState={query}
            onRestoreView={(q) =>
              setQuery({ ...defaultQuery, ...(q as Partial<HistoryQuery>) })
            }
            filters={
              <ActivityFilters
                query={query}
                onChange={setQuery}
                rows={base}
                dates
              />
            }
            selection={batch}
            onSelection={setBatch}
            actions={(picked) => (
              <Button
                disabled={!writable}
                onClick={() => {
                  const result = picked.map((r) => {
                    if (r.state === "unknown" && !r.legacy) {
                      onChange({
                        ...r,
                        state: "waiting_review",
                        native: "result_recovered",
                      });
                      return `${r.id}：已查询原结果`;
                    }
                    return `${r.id}：未执行，${r.legacy ? "请在原任务操作" : "不支持原结果恢复"}`;
                  });
                  setBatch([]);
                  alertResults.current = result;
                  setShowBatch(true);
                }}
              >
                查询原结果
              </Button>
            )}
          />
        </>
      )}
      {record && (
        <RequestDetail
          key={record.id}
          record={record}
          close={() => setSelected(null)}
          scope={scope}
          onChange={onChange}
          onLegacy={onLegacy}
          writable={writable}
        />
      )}
      <Modal
        open={showBatch}
        close={() => setShowBatch(false)}
        title="逐项恢复结果"
        description="每一项保留原请求身份；未处理项没有自动重新提交。"
      >
        <div className="batch-results">
          {alertResults.current.map((r) => (
            <p key={r}>{r}</p>
          ))}
        </div>
      </Modal>
    </>
  );
}

export function AnalyticsPage({
  rows,
  scope,
  onDrill,
  legacyCosts,
}: {
  rows: RequestFact[];
  scope: ManagementScope;
  onDrill: (q: HistoryQuery) => void;
  legacyCosts: ReactNode;
}) {
  const [query, setQuery] = useState<HistoryQuery>({ ...defaultQuery }),
    [tab, setTab] = useState("requests"),
    [dimension, setDimension] = useState("owner");
  const filtered = filterFacts(rows, query),
    s = statistics(filtered),
    finance = scope.role === "admin";
  const days = new Map<
    string,
    { day: string; gateway: number; generation: number; operation: number }
  >();
  for (const r of filtered) {
    const day = new Date(Date.parse(r.createdAt) + 8 * 3600000)
      .toISOString()
      .slice(5, 10);
    if (!days.has(day))
      days.set(day, { day, gateway: 0, generation: 0, operation: 0 });
    days.get(day)![r.kind]++;
  }
  const trend = [...days.values()].sort((a, b) => a.day.localeCompare(b.day));
  const groups = new Map<string, RequestFact[]>();
  for (const r of filtered) {
    const key =
      dimension === "actor"
        ? r.actor
        : dimension === "project"
          ? r.project
          : dimension === "model"
            ? r.model
            : r.owner;
    groups.set(key, [...(groups.get(key) || []), r]);
  }
  const grouped = [...groups]
    .map(([id, values]) => {
      const n = statistics(values);
      return {
        id,
        name:
          dimension === "actor"
            ? actorNames[id] || id
            : dimension === "project"
              ? values[0].projectName
              : dimension === "owner"
                ? ownerNames[id] || id
                : id,
        ...n,
      };
    })
    .sort((a, b) => b.requests - a.requests);
  const failures = [
    ...new Set(
      filtered.filter((r) => r.state === "failed").map((r) => r.native),
    ),
  ].map((id) => ({
    id,
    count: filtered.filter((r) => r.state === "failed" && r.native === id)
      .length,
  }));
  const durationGroups = [...new Set(filtered.map((r) => r.modality))].map(
    (id) => {
      const n = filtered
        .filter((r) => r.modality === id && r.duration !== null)
        .map((r) => r.duration!)
        .sort((a, b) => a - b);
      return {
        id,
        name: id,
        samples: n.length,
        p50: n.length ? n[Math.ceil(n.length * 0.5) - 1] : null,
        p95: n.length ? n[Math.ceil(n.length * 0.95) - 1] : null,
      };
    },
  );
  const drill = (id: string) =>
    onDrill({
      ...query,
      ...(dimension === "owner"
        ? { owner: id }
        : dimension === "actor"
          ? { actor: id }
          : dimension === "project"
            ? { projectRef: id }
            : { search: id }),
    });
  return (
    <>
      <PageActions action={<DateRange query={query} onChange={setQuery} />} />
      <AdminTabs
        value={tab}
        onChange={setTab}
        items={[
          { id: "requests", label: "运行分析" },
          { id: "generation", label: "生成与质量" },
          ...(finance
            ? [
                { id: "cost", label: "费用与账单" },
                { id: "receipts", label: "原始费用回执" },
              ]
            : []),
        ]}
      />
      {tab === "receipts" ? (
        legacyCosts
      ) : (
        <>
          <div className="analytics-filterbar">
            <Pick
              label="统计服务"
              value={query.owner}
              onChange={(owner) => setQuery({ ...query, owner })}
              options={[
                { value: "all", label: "全部服务" },
                ...[...new Set(rows.map((r) => r.owner))].map((v) => ({
                  value: v,
                  label: ownerNames[v] || v,
                })),
              ]}
            />
            <span>Asia/Shanghai · 演示快照 10/03 08:00</span>
            <Button variant="ghost small" onClick={() => onDrill(query)}>
              查看请求记录
              <ArrowRight size={14} />
            </Button>
          </div>
          <Kpis
            items={
              tab === "cost"
                ? [
                    {
                      label: "已确认 · 人民币",
                      value: `¥ ${s.CNY.toFixed(2)}`,
                      note: "同一账单引用只计一次",
                    },
                    {
                      label: "已确认 · 美元",
                      value: `$ ${s.USD.toFixed(2)}`,
                      note: "保持原币种",
                    },
                    {
                      label: "尚未结算或未知",
                      value: s.unsettled,
                      note: "不并入已确认费用",
                    },
                    { label: "上游成本", value: "—", note: "缺少独立成本来源" },
                  ]
                : [
                    {
                      label: "网关调用",
                      value: s.gateway,
                      note: "Aigora · 模型与 MCP 请求",
                    },
                    {
                      label: "生成任务",
                      value: s.generation,
                      note: `${s.outputs} 项关联产出`,
                    },
                    {
                      label: "执行尝试",
                      value: s.attempts,
                      note: "包含重试，不计为新业务请求",
                    },
                    {
                      label: "已决成功率",
                      value:
                        s.rate === null ? "—" : (s.rate * 100).toFixed(1) + "%",
                      note: `${s.success} / ${s.denominator} · 运行与未知另列`,
                    },
                  ]
            }
          />
          {tab === "cost" ? (
            <>
              <PanelNotice title="费用来源与范围">
                客户费用和上游成本分别展示。估算、待结算及未知费用不代表免费；当前仅覆盖提供账单引用的演示记录。
              </PanelNotice>
              <DataTable
                id={"costs." + JSON.stringify(scope)}
                label="费用明细"
                rows={filtered}
                columns={[
                  {
                    id: "ref",
                    label: "账单引用",
                    primary: true,
                    value: (r) => r.chargeRef,
                    render: (r) => (
                      <span className="reference-cell">{r.chargeRef}</span>
                    ),
                  },
                  {
                    id: "owner",
                    label: "服务",
                    value: (r) => ownerNames[r.owner],
                  },
                  { id: "project", label: "项目", value: (r) => r.projectName },
                  {
                    id: "state",
                    label: "确认状态",
                    value: (r) => r.costState,
                    render: (r) => <Badge state={r.costState} />,
                  },
                  {
                    id: "amount",
                    label: "客户费用",
                    value: money,
                    numeric: true,
                  },
                  { id: "upstream", label: "上游成本", value: () => "未知" },
                ]}
                onOpen={(r) => onDrill({ ...query, search: r.id })}
              />
            </>
          ) : (
            <>
              <div className="analytics-charts">
                <section className="chart-panel">
                  <div className="chart-title">
                    <div>
                      <h3>请求趋势</h3>
                      <p>网关、生成与业务操作分别统计</p>
                    </div>
                    <span className="chart-legend">
                      <i />
                      生成 <i />
                      网关
                    </span>
                  </div>
                  <div
                    className="chart-canvas"
                    role="img"
                    aria-label={`趋势摘要：${s.gateway} 次网关调用，${s.generation} 个生成任务`}
                  >
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart
                        data={trend}
                        onClick={(data) => {
                          if (data.activeLabel)
                            onDrill({
                              ...query,
                              days: "custom",
                              from: "2026-" + String(data.activeLabel),
                              to: "2026-" + String(data.activeLabel),
                            });
                        }}
                        accessibilityLayer
                        margin={{ top: 8, right: 8, left: -24, bottom: 0 }}
                      >
                        <defs>
                          <linearGradient
                            id="blue-fill"
                            x1="0"
                            y1="0"
                            x2="0"
                            y2="1"
                          >
                            <stop
                              offset="0%"
                              stopColor="var(--chart-teal)"
                              stopOpacity={0.18}
                            />
                            <stop
                              offset="100%"
                              stopColor="var(--chart-teal)"
                              stopOpacity={0}
                            />
                          </linearGradient>
                        </defs>
                        <CartesianGrid
                          vertical={false}
                          stroke="var(--border)"
                          strokeDasharray="3 4"
                        />
                        <XAxis
                          dataKey="day"
                          axisLine={false}
                          tickLine={false}
                          fontSize={12}
                        />
                        <YAxis
                          axisLine={false}
                          tickLine={false}
                          fontSize={12}
                        />
                        <Tooltip
                          contentStyle={{
                            background: "var(--panel)",
                            border: "1px solid var(--border)",
                            borderRadius: 8,
                            fontSize: 12,
                          }}
                        />
                        <Area
                          type="monotone"
                          dataKey="generation"
                          name="生成任务"
                          stroke="var(--chart-teal)"
                          fill="url(#blue-fill)"
                          strokeWidth={2}
                          isAnimationActive={false}
                        />
                        <Area
                          type="monotone"
                          dataKey="gateway"
                          name="网关调用"
                          stroke="var(--chart-orange)"
                          fill="transparent"
                          strokeWidth={2}
                          isAnimationActive={false}
                        />
                        <Area
                          type="monotone"
                          dataKey="operation"
                          name="业务操作"
                          stroke="#8a929e"
                          fill="transparent"
                          strokeDasharray="3 3"
                          strokeWidth={1.5}
                          isAnimationActive={false}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </section>
                <section className="chart-panel">
                  <div className="chart-title">
                    <div>
                      <h3>按服务查看</h3>
                      <p>点击柱形查看对应请求</p>
                    </div>
                  </div>
                  <div
                    className="chart-canvas"
                    role="img"
                    aria-label="服务请求分布；下方明细表提供相同数据"
                  >
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={[...new Set(filtered.map((r) => r.owner))].map(
                          (owner) => ({
                            owner,
                            name: ownerNames[owner],
                            count: filtered.filter((r) => r.owner === owner)
                              .length,
                          }),
                        )}
                        layout="vertical"
                        accessibilityLayer
                        margin={{ left: 0, right: 20 }}
                      >
                        <XAxis type="number" hide />
                        <YAxis
                          type="category"
                          dataKey="name"
                          width={80}
                          axisLine={false}
                          tickLine={false}
                          fontSize={12}
                        />
                        <Tooltip
                          cursor={{ fill: "var(--hover)" }}
                          contentStyle={{
                            background: "var(--panel)",
                            border: "1px solid var(--border)",
                          }}
                        />
                        <Bar
                          dataKey="count"
                          name="记录数"
                          fill="var(--chart-teal)"
                          radius={[0, 3, 3, 0]}
                          barSize={12}
                          isAnimationActive={false}
                          onClick={(d) =>
                            onDrill({
                              ...query,
                              owner: String(d.payload.owner),
                            })
                          }
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </section>
              </div>
              {tab === "generation" && (
                <div className="quality-grid">
                  <section className="chart-panel">
                    <h3>失败原因</h3>
                    {failures.map((f) => (
                      <button
                        className="linked-record"
                        key={f.id}
                        onClick={() => onDrill({ ...query, state: "failed" })}
                      >
                        <span>
                          {f.id === "rate_limited" ? "服务限流" : f.id}
                        </span>
                        <strong>{f.count}</strong>
                        <ArrowRight size={14} />
                      </button>
                    ))}
                    {!failures.length && <Empty title="当前范围没有失败记录" />}
                    <p className="muted">
                      另有 {s.unknown} 项结果未知、{s.running} 项运行中、
                      {s.cancelled} 项取消。
                    </p>
                  </section>
                  <DataTable
                    id={"duration." + JSON.stringify(scope)}
                    label="耗时分布"
                    rows={durationGroups}
                    columns={[
                      {
                        id: "type",
                        label: "任务类别",
                        primary: true,
                        value: (r) => r.name,
                      },
                      {
                        id: "samples",
                        label: "有效样本",
                        value: (r) => r.samples,
                        numeric: true,
                      },
                      {
                        id: "p50",
                        label: "P50",
                        value: (r) => durationLabel(r.p50),
                        numeric: true,
                      },
                      {
                        id: "p95",
                        label: "P95",
                        value: (r) => durationLabel(r.p95),
                        numeric: true,
                      },
                    ]}
                  />
                </div>
              )}
              <DataTable
                id={"analytics." + JSON.stringify(scope) + dimension}
                label="统计明细"
                rows={grouped}
                onOpen={(r) => drill(r.id)}
                filters={
                  <>
                    <span className="table-caption">分组明细</span>
                    <Pick
                      label="统计维度"
                      value={dimension}
                      onChange={setDimension}
                      options={[
                        { value: "owner", label: "按服务" },
                        { value: "project", label: "按项目" },
                        { value: "actor", label: "按成员" },
                        { value: "model", label: "按模型 / 能力" },
                      ]}
                    />
                  </>
                }
                columns={[
                  {
                    id: "name",
                    label: "名称",
                    primary: true,
                    value: (r) => r.name,
                  },
                  {
                    id: "requests",
                    label: "记录数",
                    value: (r) => r.requests,
                    numeric: true,
                  },
                  {
                    id: "generation",
                    label: "生成任务",
                    value: (r) => r.generation,
                    numeric: true,
                  },
                  {
                    id: "outputs",
                    label: "产出",
                    value: (r) => r.outputs,
                    numeric: true,
                  },
                  {
                    id: "success",
                    label: "成功 / 已决",
                    value: (r) => `${r.success} / ${r.denominator}`,
                    numeric: true,
                  },
                  {
                    id: "unknown",
                    label: "结果未知",
                    value: (r) => r.unknown,
                    numeric: true,
                  },
                ]}
              />
            </>
          )}
          <div className="coverage-note">
            <span className="status-dot" />
            覆盖 {[...new Set(filtered.map((r) => r.owner))].length} 个服务 ·
            当前筛选 {filtered.length} 条演示记录 ·
            其余服务的请求与统计合同待接入
          </div>
        </>
      )}
    </>
  );
}
