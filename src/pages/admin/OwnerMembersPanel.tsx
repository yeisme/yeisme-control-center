import { LockKeyhole, UsersRound } from "../../icons";
import { api, type OrganizationMember } from "../../shared/api/control-center-client";
import { useScopedRead, useWorkspace } from "../../app/workspace";
import { useListPreferences } from "../../app/preferences";
import { usePagedRows } from "../../app/use-paged-rows";
import { Button, CoverageChip, DataTable, EmptyState, InlineNotice, Pager, Panel, Pill, ReadStateView, SkeletonRows, Unknown, ownerLabel, type Column } from "../../components/ui";
import { initials } from "../../shared/read-model/format";
import { pageSizes } from "../../shared/pager";

const humanize = (value: string) => value.replace(/[_.-]+/g, " ");
const memberTypeLabel = (type: OrganizationMember["type"]) => type === "human" ? "成员" : type === "service" ? "服务账号" : "类型未知";

const memberColumns: Column<OrganizationMember>[] = [
  { id: "member", header: "成员", label: "成员", cell: (member) => <span className="flex min-w-0 items-center gap-2.5">
    <span className="grid size-7 shrink-0 place-items-center rounded-full bg-panel-sunken text-2xs font-semibold text-muted">{initials(member.name || member.id)}</span>
    <span className="min-w-0">
      <span className="block max-w-[220px] truncate font-medium text-ink">{member.name || <Unknown>未提供名称</Unknown>}</span>
      <span className="block max-w-[220px] truncate text-2xs text-muted">{memberTypeLabel(member.type)}<span className="@2xl:hidden"> · {ownerLabel(member.owner)}{member.role ? ` · ${humanize(member.role)}` : ""}</span></span>
    </span>
  </span> },
  { id: "owner", header: "来源", label: "来源", priority: 2, cell: (member) => <span className="whitespace-nowrap text-ink-soft">{ownerLabel(member.owner)}</span> },
  { id: "role", header: "工具里的角色", label: "角色", priority: 2, cell: (member) => member.role ? <Pill size="sm" tone="neutral">{humanize(member.role)}</Pill> : <Unknown /> },
  { id: "team", header: "团队", label: "团队", priority: 3, cell: (member) => member.team ? <span className="whitespace-nowrap text-ink-soft">{member.team}</span> : <Unknown>—</Unknown> },
  { id: "binding", header: "身份绑定", label: "身份绑定", align: "end", cell: (member) => <Pill size="sm" tone={member.binding === "verified" ? "success" : "neutral"}>{member.binding === "verified" ? "已核验" : "未关联"}</Pill> },
];

/**
 * The members each tool reports, listed per source and never merged into one identity. Tools answer only a delegated
 * (organization) sign-in; a personal session says so instead of borrowing another credential.
 */
export function OwnerMembersPanel({ onTab }: { onTab: (tab: "accounts" | "organizations") => void }) {
  const { isAdmin } = useWorkspace();
  const read = useScopedRead((scope, signal) => api.organization(scope, signal), { cacheKey: "organization" });
  const { pageSize, setPageSize } = useListPreferences();
  const sources = read.data?.sources || [];
  const members = sources.flatMap((source) => source.members);
  const allBlocked = sources.length > 0 && sources.every((source) => !["complete", "partial"].includes(source.state));
  const paged = usePagedRows(members, pageSize, [], { prefix: "members-" });
  return <div className="space-y-4">
    {sources.length > 0 && <div className="flex flex-wrap items-center gap-1.5"><span className="mr-1 text-2xs text-muted">来源覆盖</span>{sources.map((source) => <CoverageChip key={source.owner} owner={source.owner} state={source.state} reason={source.reason} />)}</div>}
    {allBlocked && <InlineNotice tone="info" icon={<LockKeyhole />}>
      所有成员来源都不可读。工具里的成员目录要用组织身份登录（委托）才能读；个人账号不会改用其他凭据补齐。
      <span className="mt-2 flex flex-wrap gap-2">
        {isAdmin && <Button size="sm" variant="ghost" onClick={() => onTab("accounts")}>去「账号」管控制中心的账号</Button>}
        <Button size="sm" variant="ghost" onClick={() => onTab("organizations")}>去「组织与团队」分配项目成员</Button>
      </span>
    </InlineNotice>}
    {!allBlocked && <ReadStateView status={read.status} error={read.error} onRetry={read.reload} skeleton={<Panel><SkeletonRows rows={4} /></Panel>}>
      <Panel title="工具成员" actions={<span className="text-meta text-muted">按来源列出，不合并身份</span>} bodyClassName="p-0">
        <DataTable
          label="工具成员"
          columns={memberColumns}
          rows={paged.rows}
          rowKey={(member) => `${member.owner}:${member.id}`}
          empty={<EmptyState icon={<UsersRound />} title="没有可显示的成员" body="只显示各个工具返回的成员、角色和绑定状态；没有数据时保持为空。" />}
        />
        {members.length > 0 && <Pager window={paged} onPage={paged.setPage} noun="位成员" pageSize={pageSize} pageSizes={pageSizes} onPageSize={(value) => { setPageSize(value as typeof pageSize); paged.setPage(1); }} />}
      </Panel>
    </ReadStateView>}
  </div>;
}
