import { controlRead } from "./control-api";
import { ConnectionCards, ConnectionFacts, connectionLabel } from "./connection-status";
import { useEffect, useState, useRef } from "react";
import { AdminPanel, DataTable, SearchInput, type DataColumn } from "./admin-ui";
import { Badge, Button, Pick } from "./ui";
import { PanelNotice } from "./workspace";
import type { ServiceDirectory, ServiceDirectoryEntry, ServiceKind } from "./service-directory";

const kindLabels: Record<ServiceKind, string> = {
  service: "远程服务", local_tool: "本地工具", workspace: "专业工作台", design: "设计原型",
};
const configurationLabels = {
  configured: "已登记配置", not_configured: "未配置连接", needs_contract: "待接入合同",
};
const columns: DataColumn<ServiceDirectoryEntry>[] = [
  { id: "name", label: "服务 / 工具", primary: true, value: s => s.name,
    render: s => <div className="record-title"><span><strong>{s.name}</strong><small>{s.purpose}</small><span className="md:hidden text-xs text-muted-foreground">{kindLabels[s.kind]} · {configurationLabels[s.configuration]}</span></span></div> },
  { id: "kind", label: "类型", value: s => kindLabels[s.kind] },
  { id: "configuration", label: "接入配置", value: s => configurationLabels[s.configuration],
    render: s => <Badge state={s.configuration === "configured" ? "configured" : "unknown"} label={configurationLabels[s.configuration]} /> },
  { id: "instances", label: "本范围实例", value: s => s.connections.length,
    render: s => <span>{s.connections.length || "—"}</span> },
  { id: "gap", label: "待确认事项", value: s => s.gap, hidden: true },
];
export function ServiceDirectoryPage({ scope, revision, onSessionExpired, onTasks }: {
  scope: string;
  revision: number;
  onSessionExpired: () => void;
  onTasks: (connection?: string, project?: string) => void;
}) {
  const initialOwner = useRef(new URLSearchParams(location.hash.split("?")[1] || "").get("owner"));
  const [directory, setDirectory] = useState<ServiceDirectory | null>(null);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState("all");
  const [configuration, setConfiguration] = useState("all");
  const [selected, setSelected] = useState<ServiceDirectoryEntry | null>(null);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const update = async () => {
      try {
        const value = await controlRead<ServiceDirectory>("/services?" + new URLSearchParams({ scope, observe: "1" }), controller.signal);
        if (value.schema_version !== "yeisme.service_directory.v1" || !Array.isArray(value.services)) throw Error("needs_contract");
        if (controller.signal.aborted) return;
        setDirectory(value);
        const requestedOwner = initialOwner.current;
        initialOwner.current = null;
        setSelected(current => value.services.find(s => s.id === (current?.id || requestedOwner)) || null);
        setError("");
      } catch (reason) {
        if (controller.signal.aborted) return;
        const code = reason instanceof Error ? reason.message : "source_unavailable";
        setDirectory(null); setSelected(null); setError(code);
        if (["login_required", "identity_not_bound", "scope_not_found"].includes(code)) {
          stopped = true;
          if (code !== "scope_not_found") onSessionExpired();
        }
      } finally {
        if (!controller.signal.aborted && !stopped) timer = setTimeout(update, document.hidden ? 30000 : 15000);
      }
    };
    void update();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [scope, revision, refresh, onSessionExpired]);
  const needle = search.trim().toLocaleLowerCase();
  const rows = (directory?.services || []).filter(s =>
    (kind === "all" || s.kind === kind) && (configuration === "all" || s.configuration === configuration)
    && (!needle || [s.name, s.purpose, s.owner_path].some(v => v.toLocaleLowerCase().includes(needle))),
  );
  return <div className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="text-xl font-semibold">服务与连接</h2><p className="text-sm text-muted-foreground">全部产品目录 · 当前工作区的非秘密配置 · 各服务独立授权</p></div>
      <Button onClick={() => setRefresh(v => v + 1)}>刷新目录</Button>
    </div>
    {directory && <ConnectionCards connections={directory.services.flatMap(s => s.connections.filter(c => c.enabled).map(c => ({
      id: c.id, owner: s.id as "eikona" | "scaena" | "sonora", instance_id: c.instance_id,
      label: c.label, environment: c.environment, project: c.project,
      state: c.runtime?.state || "not_checked", observed_at: c.runtime?.last_success_at || "", runtime: c.runtime,
    })))} onOpen={owner => setSelected(directory.services.find(s => s.id === owner) || null)} />}
    <p className="text-sm text-muted-foreground">核心服务优先 · {directory?.services.length ?? "—"} 项产品目录 · 连接与结果权限分别核验</p>
    {error && <div role="alert" className="rounded-lg border p-4">
      <h3 className="font-medium">{error === "scope_not_found" ? "当前工作区不可访问" : "服务目录暂不可用"}</h3>
      <p className="text-sm text-muted-foreground">旧范围数据已清除。请刷新或重新登录；不会回退到设计样例。</p>
    </div>}
    {!directory && !error && <p role="status">正在读取当前范围的服务目录…</p>}
    {directory && <DataTable
      id={"live.services." + scope} label="服务目录" rows={rows} columns={columns} onOpen={setSelected}
      coverage="产品目录与当前授权范围的配置投影，不是实时健康" empty="没有符合筛选的服务" exportScope="batch"
      filters={<>
        <SearchInput value={search} onChange={setSearch} label="搜索服务、用途或 owner" />
        <Pick label="产品类型" value={kind} onChange={setKind} options={[{ value: "all", label: "全部类型" }, ...Object.entries(kindLabels).map(([value,label]) => ({ value,label }))]} />
        <Pick label="接入配置" value={configuration} onChange={setConfiguration} options={[{ value: "all", label: "全部接入状态" }, ...Object.entries(configurationLabels).map(([value,label]) => ({ value,label }))]} />
        <Button onClick={() => { setSearch(""); setKind("all"); setConfiguration("all"); }}>清除筛选</Button>
      </>}
    />}
    {selected && <AdminPanel open live editing={false} stage="detail" title={selected.name}
      subtitle={kindLabels[selected.kind] + " · 接入详情"} context="服务目录" objectKey={selected.id}
      close={() => setSelected(null)} footer={<Button onClick={() => setSelected(null)}>返回服务目录</Button>}>
      <div className="space-y-5">
        <Badge state="unknown" label={selected.connections.some(c => c.runtime) ? "项目范围观测 · 非主机健康" : "尚无实际观测"} />
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-3 text-sm">
          <dt>维护方</dt><dd className="break-all">{selected.owner_path}</dd>
          <dt>用途</dt><dd>{selected.purpose}</dd>
          <dt>接入配置</dt><dd>{configurationLabels[selected.configuration]}</dd>
        </dl>
        <PanelNotice title="当前边界与下一步">{selected.gap}</PanelNotice>
        <section className="space-y-3" aria-label="当前范围连接">
          <h3 className="font-semibold">当前范围连接</h3>
          {selected.connections.map(c => <article key={c.id} className="rounded-lg border p-3 space-y-2">
            <strong className="break-all">{c.label} · {c.instance_id}</strong>
            <p className="text-sm break-all">{c.environment} / {c.project}</p>
            <p className="text-sm">{c.enabled ? connectionLabel(c.runtime?.state || "not_checked") : "本地连接已停用"}</p>
            <ConnectionFacts runtime={c.runtime} />
            {c.enabled && <Button onClick={() => onTasks(c.id, c.project)}>查看此实例任务</Button>}
            <p className="text-xs text-muted-foreground">内容读取意愿：{c.content_requested ? "已启用" : "关闭"}；取消意愿：{c.cancellation_requested ? "已启用" : "关闭"}。本地开关不能替代 owner 授权。</p>
          </article>)}
          {!selected.connections.length && <p className="text-sm text-muted-foreground">当前范围没有已登记的个人观测连接；不会展示其他工作区的实例。</p>}
        </section>
        {selected.integration === "task_observation" && <Button onClick={() => onTasks()}>查看任务与实际接入状态</Button>}
        <PanelNotice title="安全接入">
          由操作者在控制中心主机运行配置命令，登记固定实例、项目和受限凭据引用。浏览器不收集服务密钥，也不提供远程 Shell、启停或升级操作。
        </PanelNotice>
      </div>
    </AdminPanel>}
  </div>;
}
