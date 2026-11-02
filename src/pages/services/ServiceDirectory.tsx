import { useId, useMemo, useState, type ReactNode } from "react";
import { ChevronRight, LayoutGrid, Palette, Server, Terminal } from "../../icons";
import { CoverageChip, DataTable, Dot, EmptyState, Panel, Pill, SearchField, ToggleGroup, cx, narrowMainColumn, type Column, type Tone } from "../../components/ui";
import type { ServiceDirectoryEntry } from "../../service-directory";
import { labelFrom, needsContractLabel } from "../../shared/read-model/labels";
import { directoryView, unintegratedCount, useUnintegratedOpen, type DirectoryFilter, type FlagStorage } from "./directory-groups";

const kindLabels: Record<string, string> = { service: "服务", local_tool: "本地工具", workspace: "工作区", design: "设计原型" };
const kindIcons: Record<string, ReactNode> = { service: <Server />, local_tool: <Terminal />, workspace: <LayoutGrid />, design: <Palette /> };
const integrationLabels: Record<string, string> = { task_observation: "任务观测", request_projection: "请求投影", collection_projection: "收集投影", operation_projection: "运行投影", not_integrated: "未接入" };
const configurationLabels: Record<string, { label: string; tone: Tone }> = {
  configured: { label: "已配置", tone: "success" },
  not_configured: { label: "未配置", tone: "neutral" },
  needs_contract: { label: needsContractLabel, tone: "review" },
};

function Quiet({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-meta text-muted"><Dot tone={tone} />{children}</span>;
}

/** Pills only mark problems or open gaps; healthy and not-integrated rows stay quiet. */
function DirectoryStatus({ service }: { service: ServiceDirectoryEntry }) {
  const isIntegrated = service.integration !== "not_integrated";
  const coverage = service.coverage?.state;
  const items: ReactNode[] = [];
  if (isIntegrated) {
    if (coverage && coverage !== "complete" && coverage !== "not_recorded") items.push(<CoverageChip key="coverage" state={coverage === "stale" ? "expired" : coverage} />);
    else items.push(<Quiet key="coverage" tone={coverage === "complete" ? "success" : "neutral"}>{coverage === "complete" ? "可读" : coverage === "not_recorded" ? "未采集" : "尚未观测"}</Quiet>);
  }
  if (service.configuration !== "configured") {
    const configuration = configurationLabels[service.configuration] || configurationLabels.not_configured;
    items.push(<Pill key="configuration" tone={configuration.tone}>{configuration.label}</Pill>);
  }
  if (!items.length) items.push(<Quiet key="none">未接入</Quiet>);
  return <span className="inline-flex flex-wrap items-center justify-end gap-1.5">{items}</span>;
}

const serviceColumn: Column<ServiceDirectoryEntry> = {
  id: "service", header: "服务", className: narrowMainColumn, cell: (service) => <div className="flex min-w-0 items-center gap-3">
    <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-control bg-panel-sunken text-muted [&>svg]:size-[17px]">{kindIcons[service.kind] || <Server />}</span>
    <div className="min-w-0">
      <p className="truncate text-body-sm font-semibold text-ink">{service.name}</p>
      <p className="truncate font-mono text-2xs text-faint">{service.owner_path}</p>
      <p className="mt-0.5 line-clamp-2 text-2xs text-muted @2xl:hidden">{service.purpose}</p>
    </div>
  </div>,
};
const purposeColumn: Column<ServiceDirectoryEntry> = {
  id: "purpose", header: "用途 / 缺口", priority: 2, cell: (service) => <div className="max-w-md min-w-0 text-body-sm">
    <p className="line-clamp-2 text-ink-soft">{service.purpose}</p>
    <p className="mt-0.5 line-clamp-2 text-2xs text-muted" title={service.gap}>{service.gap}</p>
  </div>,
};
const listedColumns: Column<ServiceDirectoryEntry>[] = [
  serviceColumn,
  purposeColumn,
  { id: "kind", header: "类型 · 接入", priority: 3, cell: (service) => <div className="whitespace-nowrap">
    <p className="text-body-sm text-ink-soft">{kindLabels[service.kind] || service.kind}</p>
    <p className="text-2xs text-muted">{labelFrom(integrationLabels, service.integration)}</p>
  </div> },
  { id: "status", header: "状态", align: "end", cell: (service) => <DirectoryStatus service={service} /> },
];
// The group's heading already says "未接入", so its rows repeat neither the integration line nor a status pill.
const unintegratedColumns: Column<ServiceDirectoryEntry>[] = [
  serviceColumn,
  purposeColumn,
  { id: "kind", header: "类型", priority: 3, cell: (service) => <span className="whitespace-nowrap text-body-sm text-ink-soft">{kindLabels[service.kind] || service.kind}</span> },
];

/**
 * The directory entries that are only registered, as one disclosure under the list. Closed until someone opens it
 * (`open` is the remembered choice); while a search or the 缺口 filter has asked for these entries (`forced`) the
 * matches are simply listed, under a heading that is not a button, because a closed group would hide the answer.
 */
export function UnintegratedGroup({ rows, total, open, forced, onToggle, className }: { rows: ServiceDirectoryEntry[]; total: number; open: boolean; forced: boolean; onToggle: () => void; className?: string }) {
  const id = useId();
  const expanded = forced || open;
  const title = <>未接入<span className="ml-2 text-2xs font-normal text-muted tabular">{unintegratedCount(rows.length, total)}</span></>;
  return <div data-directory-group="unintegrated" data-expanded={expanded} className={className}>
    <div className="flex min-w-0 items-center gap-3 px-4">
      <h3 className="shrink-0 text-body-sm font-semibold text-ink">
        {forced
          ? <span className="inline-flex min-h-11 items-center">{title}</span>
          : <button type="button" aria-expanded={open} aria-controls={`${id}-body`} onClick={onToggle} className="-mx-1.5 inline-flex min-h-11 items-center gap-1.5 rounded-control px-1.5 text-left hover:bg-panel-soft">
            <ChevronRight aria-hidden="true" className={cx("size-4 shrink-0 text-muted transition-transform duration-150", open && "rotate-90")} />
            {title}
          </button>}
      </h3>
      <p className="min-w-0 truncate text-2xs text-muted max-sm:hidden">仅目录登记：控制中心不读取它们的数据，也不代表已部署或已授权。</p>
    </div>
    <div id={`${id}-body`} hidden={!expanded}>
      <DataTable label="未接入的服务列表" columns={unintegratedColumns} rows={rows} rowKey={(service) => service.id} />
    </div>
  </div>;
}

/**
 * The service directory: what is integrated or needs attention as a table, and the registered-only entries folded below
 * it. `storage` is where the group's open or closed choice is kept; it is this browser's local storage unless a test gives one.
 */
export function ServiceDirectoryPanel({ services, storage }: { services: ServiceDirectoryEntry[]; storage?: FlagStorage }) {
  const [filter, setFilter] = useState<DirectoryFilter>("all");
  const [query, setQuery] = useState("");
  const [open, toggle] = useUnintegratedOpen(storage);
  const view = useMemo(() => directoryView(services, filter, query), [services, filter, query]);
  const shown = view.listed.length + view.unintegrated.length;
  return <Panel
    title="服务目录"
    actions={<span className="text-2xs text-muted tabular">{shown} / {services.length}</span>}
    bodyClassName="p-0"
  >
    <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
      <ToggleGroup label="目录筛选" value={filter} onChange={setFilter} options={[
        { id: "all", label: "全部", count: services.length },
        { id: "integrated", label: "已接入", count: services.filter((service) => service.integration !== "not_integrated").length },
        { id: "configured", label: "已配置", count: services.filter((service) => service.configuration === "configured").length },
        { id: "gaps", label: "缺口", count: services.filter((service) => service.integration === "not_integrated" || service.configuration !== "configured").length },
      ]} />
      <SearchField value={query} onChange={setQuery} placeholder="名称、用途、路径" label="搜索服务" className="ml-auto w-full sm:w-64" />
    </div>
    {view.listed.length > 0 && <DataTable label="服务目录列表" columns={listedColumns} rows={view.listed} rowKey={(service) => service.id} />}
    {shown === 0 && <EmptyState compact title="没有匹配的服务" />}
    {view.unintegrated.length > 0 && <UnintegratedGroup rows={view.unintegrated} total={view.unintegratedTotal} open={open} forced={view.narrowed} onToggle={toggle} className={view.listed.length > 0 ? "border-t border-line" : undefined} />}
  </Panel>;
}
