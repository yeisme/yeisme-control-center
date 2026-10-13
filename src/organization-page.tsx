import { OrganizationNavigation } from "./app-shell";
import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Building2,
  Check,
  CircleUserRound,
  Copy,
  Plus,
  ShieldCheck,
  Users,
} from "./icons";
import { Badge, Button, Field, Modal, Pick } from "./ui";
import {
  CopyReference,
  DraftGuard,
  FormSection,
  PanelNotice,
  WorkspaceEditor,
} from "./workspace";
import {
  AdminPanel,
  AdminTabs,
  ComboBox,
  DataTable,
  Kpis,
  PageActions,
  SearchInput,
} from "./admin-ui";
import {
  actorNames,
  inScope,
  memberChangeError,
  protectedMembership,
  ownerManagementAllowed,
  grantableRoles,
  ownerNames,
  roleCatalog,
  statistics,
  teams,
  tenants,
  type ManagementScope,
  type Member,
  type RequestFact,
} from "./admin-state";
import type { Scenario } from "./data";

export interface OrganizationState {
  members: Member[];
  archived: string[];
  quotas: Record<string, number>;
  events: { id: string; text: string; tenant: string }[];
}
type EditAction =
  | "invite"
  | "role"
  | "suspend"
  | "activate"
  | "remove"
  | "transfer"
  | "archive"
  | "restore"
  | "quota";
const actionNames: Record<EditAction, string> = {
  invite: "添加 / 邀请成员",
  role: "调整成员角色",
  suspend: "暂停成员",
  activate: "激活成员",
  remove: "移除成员",
  transfer: "负责人交接",
  archive: "归档团队",
  restore: "恢复团队",
  quota: "调整团队配额",
};
const memberStatus: Record<string, string> = {
  active: "有效",
  invited: "待接受",
  suspended: "已暂停",
  removed: "已移除",
};
const roleName = (m: Member) =>
  roleCatalog[m.owner]?.find((r) => r.id === m.role)?.name || m.role;
export function OrganizationPage({
  scope,
  store,
  setStore,
  rows,
  scenario,
  onMemberHistory,
  onTenant,
  onDirty,
}: {
  scope: ManagementScope;
  store: OrganizationState;
  setStore: (s: OrganizationState) => void;
  rows: RequestFact[];
  scenario: Scenario;
  onMemberHistory: (actor: string) => void;
  onTenant: (tenant: string) => void;
  onDirty: (dirty: boolean, discard?: () => void) => void;
}) {
  const [tab, setTab] = useState(
      scope.perspective === "platform"
        ? "tenants"
        : scope.perspective === "personal"
          ? "access"
          : "members",
    ),
    [search, setSearch] = useState(""),
    [ownerFilter, setOwnerFilter] = useState("all"),
    [statusFilter, setStatusFilter] = useState("all");
  useEffect(() => {
    const listener = (event: Event) => {
      const next = (event as CustomEvent).detail;
      if (
        [
          "tenants",
          "invitations",
          "teams",
          "members",
          "accounts",
          "access",
          "quotas",
        ].includes(next)
      )
        setTab(next);
    };
    window.addEventListener("organization-section", listener);
    return () => window.removeEventListener("organization-section", listener);
  }, []);
  const [selected, setSelected] = useState<string | null>(null),
    [detailTab, setDetailTab] = useState("概况"),
    [action, setAction] = useState<EditAction | null>(null),
    [teamId, setTeamId] = useState("production");
  const [draft, setDraft] = useState({
      owner: "drivebridge",
      actor: "xu",
      role: "viewer",
      team: "production",
      note: "",
      quota: "200",
    }),
    [baseRevision, setBaseRevision] = useState(1),
    [stage, setStage] = useState("edit"),
    [errors, setErrors] = useState<Record<string, string>>({}),
    [ack, setAck] = useState(false),
    [busy, setBusy] = useState(false),
    [dirty, setDirty] = useState(false),
    [leaving, setLeaving] = useState(false),
    [receipt, setReceipt] = useState("");
  const lock = useRef(false),
    alive = useRef(true),
    conflictOnce = useRef(false),
    pendingClose = useRef<(() => void) | null>(null);
  useEffect(
    () => () => {
      alive.current = false;
      onDirty(false);
    },
    [],
  );
  useEffect(() => {
    onDirty(dirty, () => {
      setAction(null);
      setDirty(false);
      setReceipt("");
    });
  }, [dirty]);
  const writable =
    scope.role === "admin" &&
    scope.perspective !== "personal" &&
    !["permission", "offline", "auth", "capability"].includes(scenario);
  const members = store.members.filter((m) =>
    inScope({ ...scope, project: "all" }, m),
  );
  const scopedTeams = teams.filter(
    (t) =>
      (scope.tenant === "all" || scope.tenant === t.tenant) &&
      (scope.team === "all" || scope.team === t.id) &&
      (scope.perspective !== "personal" ||
        members.some((m) => m.team === t.id)),
  );
  const filtered = members.filter(
    (m) =>
      (ownerFilter === "all" || m.owner === ownerFilter) &&
      (statusFilter === "all" || m.status === statusFilter) &&
      `${m.name} ${m.id} ${m.role}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const member = members.find((m) => m.id === selected),
    team = teams.find((t) => t.id === teamId),
    catalog = roleCatalog[draft.owner] || [];
  const guard = (fn: () => void) => {
    if (busy) return;
    if (dirty) {
      pendingClose.current = fn;
      setLeaving(true);
    } else fn();
  };
  const close = () =>
    guard(() => {
      setSelected(null);
      setAction(null);
      setReceipt("");
    });
  const open = (m: Member) =>
    guard(() => {
      setSelected(m.id);
      setDetailTab("概况");
      setAction(null);
      setReceipt("");
    });
  const begin = (a: EditAction, m?: Member, t?: string) => {
    setAction(a);
    if (m) setSelected(m.id);
    setTeamId(t || m?.team || scopedTeams[0]?.id || "production");
    const targetTeam = t || m?.team || scopedTeams[0]?.id || "production";
    const owner =
      m?.owner ||
      teams.find((x) => x.id === targetTeam)?.owner ||
      "drivebridge";
    setDraft({
      owner,
      actor: "xu",
      role: m?.role || (owner === "drivebridge" ? "member" : "viewer"),
      team: targetTeam,
      note: "",
      quota: String(
        store.quotas[targetTeam] ??
          teams.find((x) => x.id === targetTeam)?.quota ??
          200,
      ),
    });
    setBaseRevision(m?.revision || 1);
    setStage("edit");
    setErrors({});
    setAck(false);
    setDirty(false);
    setReceipt("");
    conflictOnce.current = false;
  };
  const change = (key: keyof typeof draft, value: string) => {
    setDraft((v) => ({
      ...v,
      [key]: value,
      ...(key === "owner"
        ? { role: value === "drivebridge" ? "member" : "viewer" }
        : {}),
    }));
    setDirty(true);
    setErrors((v) => ({ ...v, [key]: "" }));
  };
  const validate = () => {
    const e: Record<string, string> = {};
    if (!ownerManagementAllowed(scope, store.members, draft.owner, draft.team))
      e.scope = "当前用户没有该 owner 在此范围的管理授权。";
    if (
      ["role", "invite"].includes(action || "") &&
      !grantableRoles(scope, store.members, draft.owner, draft.team).some(
        (r) => r.id === draft.role,
      )
    )
      e.role = "当前 owner 授权不允许授予此角色。";
    if (action === "invite") {
      if (!draft.actor) e.actor = "请选择已存在的账号。";
      if (
        store.members.some(
          (m) =>
            m.tenant === scope.tenant &&
            m.team === draft.team &&
            m.owner === draft.owner &&
            m.actor === draft.actor &&
            m.status !== "removed",
        )
      )
        e.actor = "该账号已在此项目或团队中，请查看原成员关系。";
      if (scope.tenant === "all") e.scope = "先选择具体租户，再创建邀请。";
      if (store.archived.includes(draft.team))
        e.scope = "团队已归档，请先恢复团队。";
    }
    if (action === "role" && member) {
      const message = memberChangeError(
        member,
        "role",
        draft.role,
        scope.actor,
      );
      if (message) e.role = message;
    }
    if (
      action === "transfer" &&
      !members.some(
        (m) =>
          m.actor === draft.actor &&
          m.owner === member?.owner &&
          m.tenant === member?.tenant &&
          m.status === "active" &&
          m.id !== member?.id,
      )
    )
      e.actor = "请选择相同 owner 下的另一位有效成员。";
    if (
      action === "quota" &&
      (!draft.quota.trim() ||
        !Number.isInteger(Number(draft.quota)) ||
        Number(draft.quota) < 1 ||
        Number(draft.quota) > 100000)
    )
      e.quota = "填写 1–100000 之间的整数（演示约束）。";
    if (
      ["remove", "suspend", "archive"].includes(action || "") &&
      !draft.note.trim()
    )
      e.note = "请填写变更原因。";
    if (member && ["remove", "suspend", "activate"].includes(action || "")) {
      const message = memberChangeError(
        member,
        action!,
        draft.role,
        scope.actor,
      );
      if (message) e.scope = message;
    }
    setErrors(e);
    if (Object.keys(e).length) {
      requestAnimationFrame(() =>
        document
          .querySelector<HTMLElement>(".inspector [aria-invalid=true]")
          ?.focus(),
      );
      return false;
    }
    return true;
  };
  const save = () => {
    if (
      lock.current ||
      !writable ||
      !action ||
      !ack ||
      !ownerManagementAllowed(scope, store.members, draft.owner, draft.team)
    )
      return;
    lock.current = true;
    setBusy(true);
    setTimeout(() => {
      if (!alive.current) return;
      if (scenario === "save_error") {
        setErrors({ server: "保存失败，草稿已保留。可重试同一操作。" });
        setBusy(false);
        lock.current = false;
        return;
      }
      if (
        member &&
        (member.revision !== baseRevision ||
          (scenario === "conflict" && !conflictOnce.current))
      ) {
        if (!conflictOnce.current && scenario === "conflict")
          setStore({
            ...store,
            members: store.members.map((m) =>
              m.id === member.id ? { ...m, revision: m.revision + 1 } : m,
            ),
          });
        conflictOnce.current = true;
        setErrors({ conflict: "成员版本已变化，读取新版本后必须重新预览。" });
        setBusy(false);
        lock.current = false;
        return;
      }
      let next = {
        ...store,
        members: [...store.members],
        archived: [...store.archived],
        quotas: { ...store.quotas },
      };
      if (action === "invite")
        next.members.push({
          id: `demo:member:${Date.now()}`,
          tenant: scope.tenant,
          team: draft.team,
          actor: draft.actor,
          name: actorNames[draft.actor] || draft.actor,
          type: draft.actor === "agent" ? "service" : "human",
          owner: draft.owner,
          role: draft.role,
          status: "invited",
          revision: 1,
          mapping: "unlinked",
        });
      if (member && ["role", "suspend", "activate", "remove"].includes(action))
        next.members = next.members.map((m) =>
          m.id === member.id
            ? {
                ...m,
                revision: m.revision + 1,
                ...(action === "role"
                  ? { role: draft.role }
                  : {
                      status: (
                        {
                          suspend: "suspended",
                          activate: "active",
                          remove: "removed",
                        } as const
                      )[action as "suspend" | "activate" | "remove"],
                    }),
              }
            : m,
        );
      if (action === "transfer" && member)
        next.members = next.members.map((m) =>
          m.id === member.id
            ? {
                ...m,
                role:
                  m.owner === "aigora"
                    ? "tenant_admin"
                    : m.owner === "drivebridge"
                      ? "admin"
                      : "editor",
                revision: m.revision + 1,
              }
            : m.actor === draft.actor &&
                m.owner === member.owner &&
                m.tenant === member.tenant
              ? { ...m, role: member.role, revision: m.revision + 1 }
              : m,
        );
      if (action === "archive") next.archived.push(teamId);
      if (action === "restore")
        next.archived = next.archived.filter((id) => id !== teamId);
      if (action === "quota") next.quotas[teamId] = Number(draft.quota);
      const ref = `demo:organization:${action}:${member?.id || teamId}:${baseRevision}`;
      next.events = [
        {
          id: ref,
          text: actionNames[action] + " · 演示回执已返回",
          tenant: member?.tenant || scope.tenant,
        },
        ...next.events,
      ];
      setStore(next);
      setReceipt(ref);
      setStage("receipt");
      setDirty(false);
      setBusy(false);
      lock.current = false;
    }, 400);
  };
  const inviteAction = writable ? (
    <Button
      variant="primary"
      disabled={
        scope.tenant === "all" ||
        !scopedTeams.some((t) =>
          ownerManagementAllowed(scope, store.members, t.owner, t.id),
        )
      }
      onClick={() => begin("invite")}
    >
      <Plus size={16} />
      邀请成员
    </Button>
  ) : undefined;
  return (
    <>
      <OrganizationNavigation
        value={tab}
        onChange={(v) =>
          guard(() => {
            setTab(v);
            setSelected(null);
            setAction(null);
          })
        }
      />
      {tab === "tenants" && (
        <DataTable
          id={"tenants." + scope.role}
          label="租户目录"
          rows={tenants.filter(
            (t) => scope.tenant === "all" || scope.tenant === t.id,
          )}
          columns={[
            {
              id: "name",
              label: "租户",
              primary: true,
              value: (r) => r.name,
              render: (r) => (
                <div className="record-title">
                  <span className="record-icon">
                    <Building2 size={18} />
                  </span>
                  <span>
                    <strong>{r.name}</strong>
                    <small>{r.note}</small>
                  </span>
                </div>
              ),
            },
            {
              id: "team",
              label: "团队数",
              value: (r) => teams.filter((t) => t.tenant === r.id).length,
              numeric: true,
            },
            {
              id: "members",
              label: "有效成员关系",
              value: (r) =>
                store.members.filter(
                  (m) => m.tenant === r.id && m.status === "active",
                ).length,
              numeric: true,
            },
            {
              id: "requests",
              label: "可见请求",
              value: (r) => rows.filter((x) => x.tenant === r.id).length,
              numeric: true,
            },
            {
              id: "source",
              label: "状态",
              value: () => "演示租户",
              render: () => <Badge state="healthy" label="演示租户" />,
            },
          ]}
          onOpen={(r) => onTenant(r.id)}
        />
      )}
      {["members", "invitations", "accounts"].includes(tab) && (
        <DataTable
          id={"members." + JSON.stringify(scope) + tab}
          label={
            tab === "accounts"
              ? "服务账号"
              : tab === "members"
                ? "成员列表"
                : "邀请记录"
          }
          rows={filtered.filter((m) =>
            tab === "invitations"
              ? m.status === "invited"
              : tab === "accounts"
                ? m.type === "service"
                : m.type !== "service",
          )}
          onOpen={open}
          toolbarActions={inviteAction}
          filters={
            <>
              <SearchInput
                value={search}
                onChange={setSearch}
                label="搜索成员或引用"
              />
              <Pick
                label="成员权限来源"
                value={ownerFilter}
                onChange={setOwnerFilter}
                options={[
                  { value: "all", label: "全部权限来源" },
                  ...Object.keys(roleCatalog).map((o) => ({
                    value: o,
                    label: ownerNames[o],
                  })),
                ]}
              />
              <Pick
                label="成员状态"
                value={statusFilter}
                onChange={setStatusFilter}
                options={[
                  { value: "all", label: "全部状态" },
                  ...Object.entries(memberStatus).map(([value, label]) => ({
                    value,
                    label,
                  })),
                ]}
              />
            </>
          }
          columns={[
            {
              id: "name",
              label: "成员",
              primary: true,
              value: (m) => m.name,
              render: (m) => (
                <div className="record-title">
                  <span className={"member-avatar " + m.type}>
                    {m.type === "service" ? (
                      <ShieldCheck size={17} />
                    ) : (
                      m.name.slice(0, 1)
                    )}
                  </span>
                  <span>
                    <strong>{m.name}</strong>
                    <small>
                      {ownerNames[m.owner]} · {m.id}
                    </small>
                  </span>
                </div>
              ),
            },
            {
              id: "team",
              label: "所属团队",
              value: (m) => teams.find((t) => t.id === m.team)?.name || m.team,
            },
            {
              id: "role",
              label: "来源角色",
              value: roleName,
              render: (m) => <span className="role-label">{roleName(m)}</span>,
            },
            {
              id: "owner",
              label: "权限来源",
              value: (m) => ownerNames[m.owner],
              hidden: true,
            },
            {
              id: "status",
              label: "状态",
              value: (m) => memberStatus[m.status],
              render: (m) => (
                <Badge
                  state={
                    m.status === "active"
                      ? "active"
                      : m.status === "invited"
                        ? "waiting_review"
                        : "cancelled"
                  }
                  label={memberStatus[m.status]}
                />
              ),
            },
            {
              id: "mapping",
              label: "身份映射",
              value: (m) =>
                m.mapping === "verified" ? "已明确关联" : "未关联",
              hidden: true,
            },
            {
              id: "revision",
              label: "版本",
              value: (m) => "v" + m.revision,
              hidden: true,
            },
          ]}
        />
      )}
      {tab === "teams" && (
        <div className="team-grid">
          {scopedTeams.map((t) => (
            <section className="team-card" key={t.id}>
              <div>
                <span className="team-symbol">
                  <Users size={22} />
                </span>
                <Badge
                  state={
                    store.archived.includes(t.id) ? "cancelled" : "healthy"
                  }
                  label={store.archived.includes(t.id) ? "已归档" : "有效"}
                />
              </div>
              <h3>{t.name}</h3>
              <p>
                {tenants.find((x) => x.id === t.tenant)?.name} ·{" "}
                {ownerNames[t.owner]}
              </p>
              <div className="team-figures">
                <span>
                  <strong>
                    {
                      members.filter(
                        (m) => m.team === t.id && m.status === "active",
                      ).length
                    }
                  </strong>
                  有效成员关系
                </span>
                <span>
                  <strong>{rows.filter((r) => r.team === t.id).length}</strong>
                  可见请求
                </span>
              </div>
              <div className="team-footer">
                <Button
                  onClick={() => {
                    setTab("members");
                    setSearch("");
                    setOwnerFilter(t.owner);
                  }}
                >
                  查看成员
                </Button>
                {writable && (
                  <Button
                    variant="ghost"
                    onClick={() =>
                      begin(
                        store.archived.includes(t.id) ? "restore" : "archive",
                        undefined,
                        t.id,
                      )
                    }
                  >
                    {store.archived.includes(t.id) ? "恢复团队" : "归档"}
                  </Button>
                )}
              </div>
            </section>
          ))}
        </div>
      )}
      {tab === "access" && (
        <>
          <div className="section-heading">
            <h3>项目授权</h3>
            <p>有效权限以各 owner 返回的授权为准。</p>
          </div>
          <DataTable
            id={"permissions." + JSON.stringify(scope)}
            label="授权矩阵"
            rows={members.filter((m) => m.status === "active")}
            columns={[
              {
                id: "member",
                label: "成员",
                primary: true,
                value: (m) => m.name,
              },
              {
                id: "owner",
                label: "权限来源",
                value: (m) => ownerNames[m.owner],
              },
              { id: "role", label: "角色", value: roleName },
              {
                id: "permission",
                label: "授权范围",
                value: (m) =>
                  roleCatalog[m.owner]?.find((r) => r.id === m.role)
                    ?.permissions || "未知",
              },
            ]}
            onOpen={open}
          />
        </>
      )}
      {tab === "quotas" && (
        <>
          <div className="section-heading">
            <h3>团队配额</h3>
            <p>配置值、生效值与实际用量分别呈现。</p>
          </div>
          <div className="quota-list">
            {scopedTeams.map((t) => (
              <section key={t.id}>
                <div>
                  <strong>{t.name}</strong>
                  <small>
                    {ownerNames[t.owner]} · {t.unit}
                  </small>
                </div>
                <dl>
                  <div>
                    <dt>配置值</dt>
                    <dd>{store.quotas[t.id] ?? t.quota}</dd>
                  </div>
                  <div>
                    <dt>演示有效值</dt>
                    <dd>
                      {t.owner === "yeitra"
                        ? "待接入"
                        : (store.quotas[t.id] ?? t.quota)}
                    </dd>
                  </div>
                  <div>
                    <dt>实际用量</dt>
                    <dd>
                      {t.owner === "yeitra" ? "未知" : t.used + "（样例）"}
                    </dd>
                  </div>
                </dl>
                {t.owner !== "yeitra" && (
                  <progress
                    max={store.quotas[t.id] ?? t.quota}
                    value={t.used}
                  />
                )}
                {writable && (
                  <Button
                    disabled={t.owner === "yeitra"}
                    onClick={() => begin("quota", undefined, t.id)}
                  >
                    {t.owner === "yeitra" ? "需要公开合同" : "调整配额"}
                  </Button>
                )}
              </section>
            ))}
          </div>
        </>
      )}
      {!writable && (
        <PanelNotice title="当前范围为只读">
          只展示已有授权。管理动作需要当前用户与对应 owner 的共同授权。
        </PanelNotice>
      )}
      <AdminPanel
        open={!!member || !!action}
        editing={!!action}
        compact
        title={action ? actionNames[action] : member?.name || ""}
        subtitle={
          action
            ? ownerNames[draft.owner] +
              " · " +
              (tenants.find((t) => t.id === scope.tenant)?.name || "当前租户")
            : member
              ? ownerNames[member.owner] + " · " + roleName(member)
              : ""
        }
        icon={<CircleUserRound size={19} />}
        close={close}
        back={
          action
            ? () =>
                guard(() => {
                  setAction(null);
                  setReceipt("");
                })
            : undefined
        }
        stage={action ? stage : "成员详情"}
        context="设计演示 · 领域权限由 owner 持有"
        objectKey={member?.id || action || "empty"}
        tabs={
          !action && member ? (
            <AdminTabs
              value={detailTab}
              onChange={setDetailTab}
              items={["概况", "项目授权", "活动"].map((id) => ({
                id,
                label: id,
              }))}
            />
          ) : undefined
        }
        footer={
          !action &&
          member &&
          writable &&
          member.type === "human" &&
          ownerManagementAllowed(
            { ...scope, tenant: member.tenant },
            store.members,
            member.owner,
            member.team,
          ) ? (
            <>
              <Button
                disabled={
                  protectedMembership(member, members) ||
                  member.actor === scope.actor ||
                  member.status === "removed"
                }
                onClick={() => begin("role", member)}
              >
                调整角色
              </Button>
              {protectedMembership(member, members) ? (
                <Button
                  disabled={
                    member.actor !== scope.actor || member.owner !== "aigora"
                  }
                  onClick={() => begin("transfer", member)}
                >
                  交接负责人
                </Button>
              ) : (
                <>
                  <Button
                    disabled={
                      member.actor === scope.actor ||
                      member.status === "removed" ||
                      member.status === "invited" ||
                      member.owner !== "aigora"
                    }
                    onClick={() =>
                      begin(
                        member.status === "active" ? "suspend" : "activate",
                        member,
                      )
                    }
                  >
                    {member.status === "invited"
                      ? "等待本人接受"
                      : member.owner !== "aigora"
                        ? "暂停合同待接入"
                        : member.status === "active"
                          ? "暂停"
                          : "激活"}
                  </Button>
                  <Button
                    variant="danger"
                    disabled={
                      member.actor === scope.actor ||
                      member.status === "removed"
                    }
                    onClick={() => begin("remove", member)}
                  >
                    移除
                  </Button>
                </>
              )}
            </>
          ) : undefined
        }
      >
        {action ? (
          <WorkspaceEditor
            busy={busy}
            footer={
              stage === "receipt" ? (
                <Button
                  variant="primary"
                  onClick={() => {
                    setAction(null);
                    setReceipt("");
                  }}
                >
                  完成
                </Button>
              ) : (
                <>
                  <Button
                    disabled={busy}
                    onClick={() =>
                      stage === "preview"
                        ? (setStage("edit"), setAck(false))
                        : close()
                    }
                  >
                    {stage === "preview" ? "返回修改" : "取消"}
                  </Button>
                  <Button
                    variant="primary"
                    disabled={
                      busy ||
                      !writable ||
                      (stage === "preview" && !ack) ||
                      (action === "role" && draft.role === member?.role) ||
                      (action === "quota" &&
                        draft.quota ===
                          String(store.quotas[teamId] ?? team?.quota))
                    }
                    onClick={() =>
                      stage === "edit"
                        ? validate() && setStage("preview")
                        : save()
                    }
                  >
                    {busy
                      ? "正在提交…"
                      : stage === "edit"
                        ? "预览变更"
                        : "确认提交"}
                  </Button>
                </>
              )
            }
          >
            {errors.server || errors.scope ? (
              <PanelNotice title="无法提交" tone="error">
                {errors.server || errors.scope}
              </PanelNotice>
            ) : null}
            {stage === "receipt" ? (
              <>
                <div className="receipt-success">
                  <Check size={24} />
                  <h3>{action === "invite" ? "邀请已创建" : "变更已确认"}</h3>
                  <p>
                    {action === "invite"
                      ? "待指定账号接受；没有发送真实邮件。"
                      : "当前仅更新演示会话。"}
                  </p>
                </div>
                <CopyReference value={receipt} />
                <dl className="admin-properties">
                  <div>
                    <dt>权限来源</dt>
                    <dd>{ownerNames[draft.owner]}</dd>
                  </div>
                  <div>
                    <dt>执行结果</dt>
                    <dd>演示成功</dd>
                  </div>
                  <div>
                    <dt>恢复位置</dt>
                    <dd>{member?.name || team?.name || "成员列表"}</dd>
                  </div>
                </dl>
              </>
            ) : stage === "preview" ? (
              <>
                <PanelNotice
                  title="变更影响"
                  tone={
                    ["remove", "suspend", "archive", "transfer"].includes(
                      action,
                    )
                      ? "warning"
                      : "info"
                  }
                >
                  {action === "archive"
                    ? "归档后保持已有读取权限，停止新写入并撤销临时授权。"
                    : action === "transfer"
                      ? "原负责人将降为管理员或编辑成员，目标成员成为负责人。"
                      : action === "remove"
                        ? "移除该 owner 的成员关系，不删除其他项目账号或历史成果。"
                        : action === "quota"
                          ? "仅调整当前团队的演示配额；正式生效必须读取 owner 回执。"
                          : "仅修改所列 owner 与当前团队范围。"}
                </PanelNotice>
                <dl className="admin-properties">
                  <div>
                    <dt>对象</dt>
                    <dd>
                      {member?.name || team?.name || actorNames[draft.actor]}
                    </dd>
                  </div>
                  <div>
                    <dt>动作</dt>
                    <dd>{actionNames[action]}</dd>
                  </div>
                  <div>
                    <dt>变更内容</dt>
                    <dd>
                      {action === "role"
                        ? `${roleName(member!)} → ${catalog.find((r) => r.id === draft.role)?.name}`
                        : action === "quota"
                          ? `${store.quotas[teamId] ?? team?.quota} → ${draft.quota}`
                          : action === "transfer"
                            ? actorNames[draft.actor]
                            : draft.note ||
                              catalog.find((r) => r.id === draft.role)?.name}
                    </dd>
                  </div>
                  <div>
                    <dt>当前版本</dt>
                    <dd>v{baseRevision}</dd>
                  </div>
                </dl>
                {errors.conflict && (
                  <PanelNotice title="版本冲突" tone="warning">
                    {errors.conflict}
                    <Button
                      onClick={() => {
                        setBaseRevision(member?.revision || 1);
                        setStage("edit");
                        setAck(false);
                        setErrors({});
                      }}
                    >
                      读取新版本并重新编辑
                    </Button>
                  </PanelNotice>
                )}
                <label className="confirmation-field">
                  <input
                    type="checkbox"
                    checked={ack}
                    onChange={(e) => {
                      setAck(e.target.checked);
                      setDirty(true);
                    }}
                  />
                  <span>我已确认对象、权限来源与影响范围</span>
                </label>
              </>
            ) : (
              <>
                <div className="form-edit-context">
                  <span>
                    {tenants.find((t) => t.id === scope.tenant)?.name ||
                      "请先选择具体租户"}{" "}
                    / {teams.find((t) => t.id === draft.team)?.name}
                  </span>
                  {member && (
                    <small>
                      {member.name} · v{baseRevision}
                    </small>
                  )}
                </div>
                {action === "invite" && (
                  <FormSection title="账号与权限">
                    <Field label="权限来源">
                      <Pick
                        label="邀请权限来源"
                        value={draft.owner}
                        onChange={(v) => change("owner", v)}
                        options={Object.keys(roleCatalog).map((value) => ({
                          value,
                          label: ownerNames[value],
                        }))}
                      />
                    </Field>
                    <Field
                      label="现有账号"
                      required
                      error={errors.actor}
                      hint="邀请绑定已存在的账号，不按邮箱自动关联身份。"
                    >
                      <ComboBox
                        label="邀请账号"
                        value={draft.actor}
                        onChange={(v) => change("actor", v)}
                        options={Object.entries(actorNames)
                          .filter(([k]) =>
                            scope.tenant === "north"
                              ? k.startsWith("north")
                              : !k.startsWith("north"),
                          )
                          .map(([value, label]) => ({ value, label }))}
                      />
                    </Field>
                  </FormSection>
                )}
                {["invite", "role"].includes(action) && (
                  <FormSection title="项目角色">
                    <Field label="角色" required error={errors.role}>
                      <Pick
                        label="选择项目角色"
                        value={draft.role}
                        onChange={(v) => change("role", v)}
                        options={grantableRoles(
                          scope,
                          store.members,
                          draft.owner,
                          draft.team,
                        ).map((r) => ({ value: r.id, label: r.name }))}
                      />
                    </Field>
                    <PanelNotice title="此角色包含">
                      {catalog.find((r) => r.id === draft.role)?.permissions ||
                        "请选择角色"}
                    </PanelNotice>
                  </FormSection>
                )}
                {action === "transfer" && (
                  <Field label="新的负责人" required error={errors.actor}>
                    <Pick
                      label="新的负责人"
                      value={draft.actor}
                      onChange={(v) => change("actor", v)}
                      options={members
                        .filter(
                          (m) =>
                            m.owner === member?.owner &&
                            m.tenant === member?.tenant &&
                            m.id !== member?.id &&
                            m.status === "active",
                        )
                        .map((m) => ({ value: m.actor, label: m.name }))}
                    />
                  </Field>
                )}
                {action === "quota" && (
                  <Field
                    label="配置上限"
                    required
                    error={errors.quota}
                    hint={team?.unit + " · 演示整数范围 1–100000"}
                  >
                    <input
                      aria-label="配置上限"
                      value={draft.quota}
                      inputMode="numeric"
                      onChange={(e) => change("quota", e.target.value)}
                      onBlur={validate}
                    />
                  </Field>
                )}
                {["remove", "suspend", "archive"].includes(action) && (
                  <Field label="变更原因" required error={errors.note}>
                    <textarea
                      aria-label="变更原因"
                      value={draft.note}
                      onChange={(e) => change("note", e.target.value)}
                      onBlur={validate}
                      placeholder="填写协作调整或停用原因"
                    />
                  </Field>
                )}
                {["activate", "restore"].includes(action) && (
                  <PanelNotice title="恢复后重新核对权限">
                    恢复成员或团队状态；过往临时授权、分享链接和 Agent
                    访问不会自动恢复。
                  </PanelNotice>
                )}
              </>
            )}
          </WorkspaceEditor>
        ) : (
          member && (
            <>
              {detailTab === "概况" && (
                <>
                  <div className="member-detail-head">
                    <span className="member-avatar">
                      {member.name.slice(0, 1)}
                    </span>
                    <strong>{member.name}</strong>
                    <Badge
                      state={
                        member.status === "active"
                          ? "healthy"
                          : "waiting_review"
                      }
                      label={memberStatus[member.status]}
                    />
                  </div>
                  <dl className="admin-properties">
                    {[
                      [
                        "账号类型",
                        member.type === "human" ? "人类成员" : "服务账号",
                      ],
                      [
                        "租户",
                        tenants.find((t) => t.id === member.tenant)?.name ||
                          member.tenant,
                      ],
                      [
                        "团队",
                        teams.find((t) => t.id === member.team)?.name ||
                          member.team,
                      ],
                      ["身份来源", ownerNames[member.owner]],
                      ["角色", roleName(member)],
                      [
                        "身份映射",
                        member.mapping === "verified"
                          ? "明确主体绑定"
                          : "未关联",
                      ],
                      ["版本", "v" + member.revision],
                    ].map(([k, v]) => (
                      <div key={k}>
                        <dt>{k}</dt>
                        <dd>{v}</dd>
                      </div>
                    ))}
                  </dl>
                  <div className="detail-section">
                    <h4>成员引用</h4>
                    <CopyReference value={member.id} />
                    <PanelNotice title="跨项目身份">
                      只根据可信绑定合并显示。同名用户和独立 owner
                      的成员关系分别保留。
                    </PanelNotice>
                  </div>
                </>
              )}
              {detailTab === "项目授权" && (
                <div className="detail-section">
                  {members
                    .filter(
                      (m) =>
                        m.actor === member.actor &&
                        (m.mapping === "verified" || m.id === member.id),
                    )
                    .map((m) => (
                      <div key={m.id} className="access-record">
                        <ShieldCheck size={17} />
                        <div>
                          <strong>
                            {ownerNames[m.owner]} · {roleName(m)}
                          </strong>
                          <p>
                            {
                              roleCatalog[m.owner]?.find((r) => r.id === m.role)
                                ?.permissions
                            }
                          </p>
                          <small>
                            {memberStatus[m.status]} ·{" "}
                            {m.mapping === "unlinked"
                              ? "未关联"
                              : "明确主体绑定"}
                          </small>
                        </div>
                      </div>
                    ))}
                </div>
              )}
              {detailTab === "活动" && (
                <div className="detail-section">
                  <Kpis
                    items={[
                      {
                        label: "当前范围请求",
                        value: rows.filter((r) => r.actor === member.actor)
                          .length,
                        note: "按明确调用者引用筛选",
                      },
                      {
                        label: "产出",
                        value: statistics(
                          rows.filter((r) => r.actor === member.actor),
                        ).outputs,
                        note: "不包含无权访问的结果",
                      },
                    ]}
                  />
                  <Button onClick={() => onMemberHistory(member.actor)}>
                    查看请求历史
                    <ArrowRight size={14} />
                  </Button>
                  {store.events
                    .filter((e) => e.tenant === member.tenant)
                    .map((e) => (
                      <p key={e.id}>{e.text}</p>
                    ))}
                </div>
              )}
            </>
          )
        )}
      </AdminPanel>
      <DraftGuard
        open={leaving}
        cancel={() => setLeaving(false)}
        discard={() => {
          setDirty(false);
          setLeaving(false);
          setAction(null);
          pendingClose.current?.();
          pendingClose.current = null;
        }}
      />
    </>
  );
}
